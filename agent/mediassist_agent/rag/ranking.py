"""Pure ranking rules for Node 1 suggestions and Node 4 product picks (no DB - unit-testable).

Node 1 - which medicines to suggest for a symptom:
  * a symptom is matched to up to N similar dataset labels (e.g. "fever" -> "Fever",
    "Fever and pain", "Pain & Fever Relief"), weighted by similarity
  * a generic scores high when it is SPECIFIC to those labels: the share of its products carrying the
    label x log(how many products) - so paracetamol beats meloxicam (mostly an arthritis drug) for fever
  * parenteral products (injection/infusion/vial) are never suggested; eye/ear/nasal products only for
    eye/ear/nose symptoms

Node 4 - which dataset product to take the info from for a prescribed medicine:
  * same route/form as prescribed (oral tablet -> not an IV infusion), same strength if possible,
    then the record with the most information
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any, Iterable

PARENTERAL = re.compile(r"\b(inj|injection|infusion|iv|i\.v|vial|vials|ampoule|ampoules|amp|prefilled|syringe)\b", re.I)
LOCAL = re.compile(r"\b(eye|ear|nasal|nose|opthalmic|ophthalmic|otic|optic)\b|\bdrops?\b", re.I)
PAEDIATRIC = re.compile(r"\b(paediatric|pediatric|peadiatric|kids?|child|children|infant|baby|junior)\b", re.I)
TOPICAL = re.compile(r"\b(cream|gel|ointment|lotion|spray|patch|shampoo|soap|suppositor\w*|pessar\w*|vaginal)\b", re.I)
LOCAL_SYMPTOM = re.compile(r"\b(eye|eyes|ear|ears|nose|nasal|conjunctiv\w*|vision|otitis|sinus\w*)\b", re.I)


def product_text(p: dict[str, Any]) -> str:
    return f"{p.get('name') or p.get('medicine_name') or ''} {p.get('generic_name') or ''}"


def suggestible(product: dict[str, Any], symptom: str) -> bool:
    text = product_text(product)
    if PARENTERAL.search(text):
        return False
    if LOCAL.search(text) and not LOCAL_SYMPTOM.search(symptom or ""):
        return False
    return True


def rank_generics(rows: Iterable[dict[str, Any]], label_sims: dict[str, float], totals: dict[str, int],
                  symptom: str, max_n: int) -> list[dict[str, Any]]:
    """rows: products linked to the matched labels [{id, source_dataset, medicine_name, generic_name,
    generic_norm, label, n_info}]; totals: generic_norm -> total product count in the datasets."""
    per_generic: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    candidates: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        g = r.get("generic_norm")
        if not g or not suggestible(r, symptom):
            continue
        per_generic[g][r["label"]].add(r["id"])
        candidates[g].append(r)

    scored = []
    for g, by_label in per_generic.items():
        total = max(totals.get(g, 0), 1)
        score = sum(label_sims.get(lbl, 0.0) * (len(ids) / total) * math.log1p(len(ids))
                    for lbl, ids in by_label.items())
        # representative product: oral first (not topical), then the richest record
        rep = sorted(candidates[g], key=lambda p: (bool(TOPICAL.search(product_text(p))),
                                                   bool(PAEDIATRIC.search(product_text(p))),
                                                   -p.get("n_info", 0), p["id"]))[0]
        scored.append({**{k: rep[k] for k in ("id", "source_dataset", "medicine_name", "generic_name")},
                       "score": round(score, 3), "labels": sorted(by_label)})
    scored.sort(key=lambda x: (-x["score"], x["generic_name"] or ""))
    return scored[:max_n]


def _strength_numbers(text: str | None) -> set[str]:
    return set(re.findall(r"\d+(?:\.\d+)?", text or ""))


def product_preference(p: dict[str, Any], med: dict[str, Any]) -> tuple:
    """Sort key (lower = better) for choosing the dataset product that represents a prescribed medicine."""
    wanted = " ".join(str(med.get(k) or "") for k in ("name", "route", "dose", "instructions"))
    text = product_text(p)
    form_penalty = 0
    if PARENTERAL.search(text) and not PARENTERAL.search(wanted):
        form_penalty = 2
    elif (LOCAL.search(text) or TOPICAL.search(text)) and not (LOCAL.search(wanted) or TOPICAL.search(wanted)):
        form_penalty = 1
    want_strength = _strength_numbers(med.get("strength")) | _strength_numbers(med.get("name"))
    strength_miss = 0 if (not want_strength or want_strength & _strength_numbers(text)) else 1
    return (form_penalty, strength_miss, -len(p.get("info") or {}), p["id"])


def select_labels(label_sims: dict[str, float], top_n: int, margin: float) -> dict[str, float]:
    """Keep the best label plus close runners-up (within `margin` of the best), at most top_n."""
    if not label_sims:
        return {}
    ranked = sorted(label_sims.items(), key=lambda kv: -kv[1])
    best = ranked[0][1]
    return dict(kv for kv in ranked[:top_n] if kv[1] >= best - margin)
