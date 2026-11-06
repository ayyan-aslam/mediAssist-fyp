"""ONE-TIME ingestion of the Dawaai + DVAGO datasets into pgvector.

Not part of the LangGraph workflow. Run it once (and again only when a dataset file changes):

    python -m mediassist_agent.rag.ingest                 # both files from agent/data/
    python -m mediassist_agent.rag.ingest --dry-run       # parse + report only, no DB / no OpenAI

Re-running is safe and cheap:
  * products are upserted by id (source + url), so nothing is duplicated
  * only symptom labels that have NO embedding yet are sent to OpenAI (~650 labels in total the
    first time, zero on later runs)
"""
from __future__ import annotations

import argparse
import json
import logging
import re
from collections import Counter
from pathlib import Path
from typing import Any

from ..config import AGENT_DIR
from ..text import norm_generic, norm_name, normalise_symptom

log = logging.getLogger("mediassist_agent.ingest")
BATCH = 256
DATA_DIR = AGENT_DIR / "data"

# --------------------------------------------------------------------------------------
# Column mapping per dataset. Edit here if a file's columns change.
#   symptoms: columns tried in order (first non-empty wins), split on `sep`
#   info:     MedicineInfo field -> dataset column
# --------------------------------------------------------------------------------------
DATASETS: dict[str, dict[str, Any]] = {
    "dawaai": {
        "file": "dawaai_medicines.xlsx",
        "name": "name",
        "generic": "generic_formula",
        "symptoms": ["diseases_symptoms", "primary_uses"],
        "sep": r";",
        "info": {
            "indication": "indications",
            "how_to_use": "how_to_use",
            "side_effects": "side_effects",
            "warnings": "warnings",
            "contraindications": "contraindications",
            "precautions": "expert_advice",
        },
        "extra": ["manufacturer", "category"],
    },
    "dvago": {
        "file": "dvago_medicines.xlsx",
        "name": "name",
        "generic": "generics",
        "symptoms": ["used_for_symptom", "sub_category"],
        "sep": r";",
        "info": {
            "indication": "indication",
            "mechanism": "how_it_works",
            "dosage_reference": "dosage",
            "side_effects": "side_effects",
            "drug_interactions": "drug_interactions",
            "contraindications": "when_not_to_use",
            "precautions": "precautions",
            "warnings": "warnings",
        },
        "extra": ["brand_manufacturer", "category", "sub_category", "storage"],
    },
}


def _clean(v: Any) -> str | None:
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s if s and s.lower() not in ("nan", "none", "null", "-") else None


def read_rows(path: Path) -> list[dict[str, Any]]:
    """Read .xlsx / .csv into [{column: value}] using pure-Python libraries (no pandas/numpy)."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        import csv

        with path.open(newline="", encoding="utf-8-sig") as fh:
            return list(csv.DictReader(fh))
    if suffix in (".xlsx", ".xlsm"):
        from openpyxl import load_workbook

        wb = load_workbook(path, read_only=True, data_only=True)
        try:
            rows = wb.worksheets[0].iter_rows(values_only=True)
            header = [str(h).strip() if h is not None else "" for h in next(rows)]
            return [dict(zip(header, r)) for r in rows if r and any(v is not None for v in r)]
        finally:
            wb.close()
    if suffix == ".xls":
        import xlrd

        sh = xlrd.open_workbook(str(path)).sheet_by_index(0)
        header = [str(h).strip() for h in sh.row_values(0)]
        return [dict(zip(header, sh.row_values(i))) for i in range(1, sh.nrows)]
    raise ValueError(f"Unsupported file type: {path.suffix} (use .xlsx, .xls or .csv)")


def prepare(source: str, cfg: dict[str, Any], path: Path) -> tuple[list[dict], dict[str, str]]:
    """Returns (products, labels{norm: display text}). Pure Python - testable without DB/OpenAI."""
    products, labels = [], {}
    for i, row in enumerate(read_rows(path)):
        name = _clean(row.get(cfg["name"]))
        if not name:
            continue
        url = _clean(row.get("url"))
        generic = _clean(row.get(cfg["generic"]))
        raw_sym = next((v for c in cfg["symptoms"] if (v := _clean(row.get(c)))), None)
        syms = []
        for part in re.split(cfg["sep"], raw_sym or ""):
            text = _clean(part)
            norm = normalise_symptom(text)
            if norm and norm not in syms:
                syms.append(norm)
                labels.setdefault(norm, text.title() if text.isupper() else text)
        info = {k: v for k, col in cfg["info"].items() if (v := _clean(row.get(col)))}
        for col in cfg.get("extra", []):
            if (v := _clean(row.get(col))):
                info[col] = v
        products.append({
            "id": f"{source}:{url or i}", "source": source, "name": name, "name_norm": norm_name(name),
            "generic": generic, "generic_norm": norm_generic(generic), "info": info, "url": url,
            "symptoms": syms,
        })
    return products, labels


def ingest(sources: list[str], data_dir: Path, dry_run: bool) -> None:
    all_products, all_labels = [], {}
    for src in sources:
        cfg = DATASETS[src]
        path = data_dir / cfg["file"]
        products, labels = prepare(src, cfg, path)
        linked = sum(1 for p in products if p["symptoms"])
        log.info("%s: %d products (%d with a symptom label), %d distinct labels  <- %s",
                 src, len(products), linked, len(labels), path.name)
        all_products += products
        for k, v in labels.items():
            all_labels.setdefault(k, v)
    log.info("total: %d products, %d distinct symptom labels", len(all_products), len(all_labels))

    if dry_run:
        top = Counter(s for p in all_products for s in p["symptoms"]).most_common(15)
        log.info("most common labels: %s", ", ".join(f"{all_labels[k]} ({n})" for k, n in top))
        log.info("dry run - nothing written")
        return

    from ..llm import embed
    from .store import DDL, SymptomMedicineStore, to_vector_literal

    import time

    store = SymptomMedicineStore()
    log.info("connecting to Postgres ...")
    t0 = time.perf_counter()
    with store.connect() as conn:
        log.info("connected in %.1fs; creating tables if missing", time.perf_counter() - t0)
        conn.execute(store.sql(DDL))
        log.info("tables ready")
        have = {r[0] for r in conn.execute(store.sql("SELECT symptom_norm FROM {label} WHERE embedding IS NOT NULL"))}
        missing = sorted(k for k in all_labels if k not in have)
        log.info("embedding %d new labels (%d already embedded)", len(missing), len(have))
        with conn.cursor() as cur:
            for k in range(0, len(missing), BATCH):
                chunk = missing[k:k + BATCH]
                vectors = embed([all_labels[n] for n in chunk])
                cur.executemany(store.sql(
                    "INSERT INTO {label} (symptom_norm, symptom_text, embedding) VALUES (%s, %s, %s::vector) "
                    "ON CONFLICT (symptom_norm) DO UPDATE SET embedding = EXCLUDED.embedding"),
                    [(n, all_labels[n], to_vector_literal(v)) for n, v in zip(chunk, vectors)])
                log.info("  embedded %d/%d", min(k + BATCH, len(missing)), len(missing))

            log.info("writing %d products (one transaction) ...", len(all_products))
            conn.autocommit = False  # one commit for the bulk writes = much faster than 60k autocommits
            cur.executemany(store.sql(
                "INSERT INTO {med} (id, source_dataset, name, name_norm, generic_name, generic_norm, info, url) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "
                "name_norm = EXCLUDED.name_norm, generic_name = EXCLUDED.generic_name, "
                "generic_norm = EXCLUDED.generic_norm, info = EXCLUDED.info, url = EXCLUDED.url"),
                [(p["id"], p["source"], p["name"], p["name_norm"], p["generic"], p["generic_norm"],
                  json.dumps(p["info"], ensure_ascii=False), p["url"]) for p in all_products])
            log.info("upserted %d products", len(all_products))

            cur.executemany(store.sql(
                "INSERT INTO {link} (medicine_id, symptom_norm) VALUES (%s, %s) ON CONFLICT DO NOTHING"),
                [(p["id"], s) for p in all_products for s in p["symptoms"]])
            conn.commit()
            conn.autocommit = True
            log.info("linked products to symptom labels")
    log.info("done")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="One-time embedding of the Dawaai + DVAGO datasets into pgvector.")
    ap.add_argument("--source", choices=sorted(DATASETS), action="append",
                    help="Dataset to ingest (repeatable). Default: all.")
    ap.add_argument("--data-dir", type=Path, default=DATA_DIR)
    ap.add_argument("--dry-run", action="store_true", help="Parse and report only; no DB, no OpenAI calls.")
    a = ap.parse_args()
    ingest(a.source or sorted(DATASETS), a.data_dir, a.dry_run)


if __name__ == "__main__":
    main()
