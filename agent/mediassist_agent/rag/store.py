"""pgvector store for the STATIC Dawaai + DVAGO medicine datasets (Node 1 RAG + Node 4 info).

Three tables in the `medicinedb` schema (MEDICINE_AI_DATABASE_URL, where init.sql installed pgvector):

  agent_medicine          one row per product (19k Dawaai + 9k DVAGO) + its info (how to use,
                          dosage, warnings, ...) as JSONB
  agent_medicine_symptom  product <-> symptom/condition label links
  agent_symptom_label     the ~650 DISTINCT labels ("Fever", "Pain", "Hypertension", ...) with
                          their embedding  <- the only thing that is embedded, ONCE, by the ingest

At runtime the graph only embeds the few standardized symptoms of the current consultation.
"""
from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterable

from ..config import settings
from ..text import norm_generic, norm_name, normalise_symptom
from .ranking import product_preference, rank_generics, select_labels

log = logging.getLogger("mediassist_agent")

# One shared connection per process (opening a new one per query cost ~10 s on Windows/Docker).
# The lock serialises use, so parallel nodes never share the connection at the same time.
_shared: dict[str, Any] = {}
_lock = threading.RLock()

DDL = """
CREATE TABLE IF NOT EXISTS {med} (
    id              TEXT PRIMARY KEY,
    source_dataset  TEXT NOT NULL,
    name            TEXT NOT NULL,
    name_norm       TEXT NOT NULL,
    generic_name    TEXT,
    generic_norm    TEXT,
    info            JSONB,
    url             TEXT
);
CREATE INDEX IF NOT EXISTS {med_name_idx}    ON {med} (name_norm);
CREATE INDEX IF NOT EXISTS {med_generic_idx} ON {med} (generic_norm);

CREATE TABLE IF NOT EXISTS {label} (
    symptom_norm  TEXT PRIMARY KEY,
    symptom_text  TEXT NOT NULL,
    embedding     VECTOR({dim})
);
CREATE INDEX IF NOT EXISTS {label_vec_idx} ON {label} USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS {link} (
    medicine_id   TEXT NOT NULL REFERENCES {med}(id) ON DELETE CASCADE,
    symptom_norm  TEXT NOT NULL REFERENCES {label}(symptom_norm) ON DELETE CASCADE,
    PRIMARY KEY (medicine_id, symptom_norm)
);
CREATE INDEX IF NOT EXISTS {link_sym_idx} ON {link} (symptom_norm);
"""


def to_vector_literal(vec: Iterable[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


class SymptomMedicineStore:
    def __init__(self, dsn: str | None = None, prefix: str | None = None):
        self.dsn = dsn or settings.medicine_db_url
        self.prefix = prefix or settings.rag_table_prefix
        if not self.dsn:
            raise RuntimeError("MEDICINE_AI_DATABASE_URL is not set (root .env).")

    # -- helpers -------------------------------------------------------------
    def _dsn(self) -> str:
        # On Windows "localhost" can resolve to IPv6 ::1 first while Docker only listens on 127.0.0.1.
        # Use the IPv4 address directly (agent only; .env untouched).
        return self.dsn.replace("@localhost:", "@127.0.0.1:").replace("@localhost/", "@127.0.0.1/")

    def new_connection(self):
        import psycopg

        t0 = time.perf_counter()
        conn = psycopg.connect(self._dsn(), autocommit=True, connect_timeout=10)
        log.info("db: connected in %.1fs", time.perf_counter() - t0)
        return conn

    @contextmanager
    def connect(self):
        """Yield the shared connection (re-opened automatically if it was closed or broke)."""
        import psycopg

        with _lock:
            conn = _shared.get(self.dsn)
            if conn is None or conn.closed:
                conn = _shared[self.dsn] = self.new_connection()
            try:
                yield conn
            except psycopg.OperationalError:
                conn.close()
                _shared.pop(self.dsn, None)
                raise

    def sql(self, template: str):
        from psycopg import sql

        p = self.prefix
        ids = {
            "med": f"{p}_medicine", "label": f"{p}_symptom_label", "link": f"{p}_medicine_symptom",
            "med_name_idx": f"{p}_medicine_name_idx", "med_generic_idx": f"{p}_medicine_generic_idx",
            "label_vec_idx": f"{p}_symptom_label_vec_idx", "link_sym_idx": f"{p}_medicine_symptom_sym_idx",
        }
        return sql.SQL(template).format(dim=sql.Literal(settings.embedding_dim),
                                        **{k: sql.Identifier(v) for k, v in ids.items()})

    def ensure_tables(self) -> None:
        with self.connect() as conn:
            conn.execute(self.sql(DDL))

    # -- Node 1: symptom -> similar labels -> ranked medicines --------------
    def search(self, symptom: str, embedding: list[float] | None) -> dict[str, Any] | None:
        """Match a symptom to its closest dataset labels and rank the medicines linked to them.

        Exact label match counts as similarity 1.0; semantic matches must reach rag_min_similarity.
        Returns {"match_type", "dataset_symptom", "similarity", "labels", "medicines": [...]} or None.
        """
        norm = normalise_symptom(symptom)
        with self.connect() as conn:
            sims: dict[str, float] = {}
            texts: dict[str, str] = {}
            row = conn.execute(self.sql("SELECT symptom_norm, symptom_text FROM {label} WHERE symptom_norm = %s"),
                               (norm,)).fetchone()
            exact = row[0] if row else None
            if row:
                sims[row[0]], texts[row[0]] = 1.0, row[1]
            if embedding is not None:
                vec = to_vector_literal(embedding)
                for r in conn.execute(self.sql(
                        "SELECT symptom_norm, symptom_text, 1 - (embedding <=> %s::vector) AS sim FROM {label} "
                        "WHERE embedding IS NOT NULL ORDER BY embedding <=> %s::vector LIMIT %s"),
                        (vec, vec, settings.rag_label_top_n)).fetchall():
                    if float(r[2]) >= settings.rag_min_similarity or r[0] == exact:
                        sims[r[0]], texts[r[0]] = float(r[2]), r[1]  # real cosine, also for the exact label
            sims = select_labels(sims, settings.rag_label_top_n, settings.rag_label_margin)
            if exact and exact not in sims:
                sims[exact] = 1.0
            if not sims:
                return None
            rows = conn.execute(self.sql(
                "SELECT m.id, m.source_dataset, m.name, m.generic_name, m.generic_norm, l.symptom_norm, "
                "       (SELECT count(*) FROM jsonb_object_keys(m.info)) "
                "FROM {link} l JOIN {med} m ON m.id = l.medicine_id "
                "WHERE l.symptom_norm = ANY(%s) AND coalesce(m.generic_norm, '') <> ''"), (list(sims),)).fetchall()
            generics = sorted({r[4] for r in rows})
            totals = dict(conn.execute(self.sql(
                "SELECT generic_norm, count(*) FROM {med} WHERE generic_norm = ANY(%s) GROUP BY generic_norm"),
                (generics,)).fetchall()) if generics else {}
        products = [{"id": r[0], "source_dataset": r[1], "medicine_name": r[2], "generic_name": r[3],
                     "generic_norm": r[4], "label": r[5], "n_info": r[6] or 0} for r in rows]
        meds = rank_generics(products, sims, totals, symptom, settings.rag_candidates_per_symptom)
        best = max(sims, key=sims.get)
        return {
            "match_type": "exact" if sims[best] == 1.0 else "semantic",
            "dataset_symptom": texts[best],
            "similarity": round(sims[best], 4),
            "labels": [texts[k] for k in sorted(sims, key=lambda k: -sims[k])],
            "medicines": meds,
        }

    # -- Node 4: keyed lookups in BOTH datasets (no semantic search) ----------
    def lookup_products(self, meds: list[dict[str, Any]]) -> list[dict[str, dict[str, Any]]]:
        """Find each medicine in every dataset separately. ONE query for the whole list.

        meds: [{"name", "generic_name", "record_id"?}]
        Returns per medicine {source: {"id", "name", "generic_name", "generic_norm", "info", "url"}}.
        Per source the match order is: pinned record_id -> brand name -> generic. If a medicine was
        only found by brand in one dataset, its generic from that hit is used to find it in the other.
        """
        keyed = []
        for m in meds:
            name_key = norm_name(m.get("name"))
            gen_key = norm_generic(m.get("generic_name")) or norm_generic(m.get("name"))
            keyed.append((m.get("record_id"), name_key, gen_key))
        ids = sorted({k[0] for k in keyed if k[0]})
        keys = sorted({k for t in keyed for k in t[1:] if k})
        if not ids and not keys:
            return [{} for _ in meds]
        with self.connect() as conn:
            rows = conn.execute(self.sql(
                "SELECT id, source_dataset, name, name_norm, generic_name, generic_norm, info, url FROM {med} "
                "WHERE id = ANY(%s) OR name_norm = ANY(%s) OR generic_norm = ANY(%s)"),
                (ids, keys, keys)).fetchall()
            # second pass: generics learned from brand-name hits, to find the same medicine in the other dataset
            extra = sorted({r[5] for r in rows if r[5]} - set(keys))
            if extra:
                rows += conn.execute(self.sql(
                    "SELECT id, source_dataset, name, name_norm, generic_name, generic_norm, info, url FROM {med} "
                    "WHERE generic_norm = ANY(%s)"), (extra,)).fetchall()
        prods = [{"id": r[0], "source": r[1], "name": r[2], "name_norm": r[3], "generic_name": r[4],
                  "generic_norm": r[5], "info": r[6] or {}, "url": r[7]} for r in rows]
        out = []
        for med, (record_id, name_key, gen_key) in zip(meds, keyed):
            # per medicine: same form/route and strength as prescribed first, then the richest record
            prods.sort(key=lambda p: product_preference(p, med))
            hits: dict[str, dict] = {}
            pinned = next((p for p in prods if record_id and p["id"] == record_id), None)
            if pinned:
                hits[pinned["source"]] = pinned
            # brand name. One brand can cover several formulas (e.g. "Panadol" plain vs a cold/flu combo),
            # so prefer the formula most brand hits agree on across both datasets.
            brand = [p for p in prods if name_key and p["name_norm"] == name_key]
            if brand:
                counts: dict[str, int] = {}
                for p in brand:
                    counts[p["generic_norm"]] = counts.get(p["generic_norm"], 0) + 1
                consensus = max(counts, key=lambda g: (counts[g], -g.count("+")))
                for p in brand:  # a different formula under the same brand is NOT the same medicine
                    if p["generic_norm"] == consensus and p["source"] not in hits:
                        hits[p["source"]] = p
            generics = {gen_key} | {h["generic_norm"] for h in hits.values() if h["generic_norm"]}
            for p in prods:  # generic / active ingredient
                if p["generic_norm"] and p["generic_norm"] in generics and p["source"] not in hits:
                    hits[p["source"]] = p
            out.append(hits)
        return out
