"""Medicine information for Node 4, merged across the Dawaai and DVAGO datasets.

For every medicine in the reconciled list (doctor-prescribed and RAG-suggested) we look it up in
BOTH datasets with keyed queries (no semantic search):
    pinned record id (RAG meds)  ->  brand name  ->  generic / active ingredient
If it is found in both, every available field from both is brought in:
    only one source has the field   -> that text
    both have it, same text         -> once
    both have it, different text    -> "Dawaai: ...\n\nDVAGO: ..."
"""
from __future__ import annotations

from typing import Any, Optional

from .schemas import MedicineInfo

SOURCE_LABEL = {"dawaai": "Dawaai", "dvago": "DVAGO"}
SOURCE_ORDER = ["dawaai", "dvago"]
INFO_FIELDS = [
    "indication", "how_to_use", "mechanism", "dosage_reference", "precautions", "warnings",
    "contraindications", "side_effects", "drug_interactions",
]


def merge_info(hits: dict[str, dict[str, Any]]) -> Optional[MedicineInfo]:
    """hits: {source: {"name", "info": {...}, "url"}} -> merged MedicineInfo (None if nothing found)."""
    if not hits:
        return None
    sources = [s for s in SOURCE_ORDER if s in hits] + [s for s in hits if s not in SOURCE_ORDER]
    merged: dict[str, Any] = {}
    for field in INFO_FIELDS:
        texts = [(s, (hits[s].get("info") or {}).get(field)) for s in sources]
        texts = [(s, t.strip()) for s, t in texts if t and t.strip()]
        distinct = list(dict.fromkeys(t for _, t in texts))
        if len(distinct) == 1:
            merged[field] = distinct[0]
        elif len(distinct) > 1:
            merged[field] = "\n\n".join(f"{SOURCE_LABEL.get(s, s)}: {t}" for s, t in texts)
    return MedicineInfo(
        **merged,
        sources=sources,
        urls=[hits[s]["url"] for s in sources if hits[s].get("url")],
        matched_products=[hits[s]["name"] for s in sources if hits[s].get("name")],
    )
