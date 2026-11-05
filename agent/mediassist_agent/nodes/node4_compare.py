"""Node 4 - Medicine comparison (joins Node 1 + Node 2; Node 3 does NOT come here).

  look up every medicine in BOTH datasets (Dawaai + DVAGO) with keyed queries - one DB round trip
     -> a doctor brand name with no generic gets its generic from the dataset (better matching)
  identity check: same medicine if NAME or GENERIC / ACTIVE INGREDIENT matches
  compare lists ->
     matched      : keep the DOCTOR's version unchanged, drop the RAG duplicate  -> tag doctor_prescribed
     doctor-only  : keep unchanged                                               -> tag doctor_prescribed
     additional RAG (not prescribed), duplicates removed                         -> tag rag_suggested
  attach medicine info, MERGED from every dataset the medicine was found in

Pure code - no LLM - so the doctor's prescription can never be altered by a model.
"""
from __future__ import annotations

import logging

from ..fallback import resilient_node
from ..medicine_info import merge_info
from ..schemas import PrescribedMedicine, RagMedicine, ReconciledMedicine
from ..text import norm_generic, norm_name

log = logging.getLogger("mediassist_agent")


def _keys(name: str | None, generic: str | None) -> set[str]:
    return {k for k in (norm_name(name), norm_generic(generic)) if k}


def same_medicine(a_name, a_generic, b_name, b_generic) -> bool:
    return bool(_keys(a_name, a_generic) & _keys(b_name, b_generic))


def ingredients(name: str | None, generic: str | None) -> set[str]:
    g = norm_generic(generic) or norm_generic(name)
    return {x for x in g.split(" + ") if x}


def shares_ingredient(doc: PrescribedMedicine, r: RagMedicine) -> bool:
    """A suggestion containing an ingredient the doctor already prescribed (e.g. paracetamol + caffeine
    when paracetamol is prescribed) would double the dose - treat it as covered by the prescription."""
    return bool(ingredients(doc.name, doc.generic_name) & ingredients(r.name, r.generic_name))


def reconcile(prescribed: list[PrescribedMedicine], rag: list[RagMedicine]) -> list[ReconciledMedicine]:
    out: list[ReconciledMedicine] = []
    used_rag: set[int] = set()

    for doc in prescribed:
        linked, record_id = [], None
        for i, r in enumerate(rag):
            exact = same_medicine(doc.name, doc.generic_name, r.name, r.generic_name)
            if exact or shares_ingredient(doc, r):
                used_rag.add(i)
                linked.extend(s for s in r.linked_symptoms if s not in linked)
                if exact:  # a combo product (e.g. paracetamol + caffeine) must not supply the info for plain paracetamol
                    record_id = record_id or r.record_id
        out.append(ReconciledMedicine(
            name=doc.name, generic_name=doc.generic_name, tag="doctor_prescribed",
            match_status="matched" if linked else "doctor_only", prescription_status=doc.prescription_status,
            strength=doc.strength, dose=doc.dose, frequency=doc.frequency, duration=doc.duration,
            route=doc.route, instructions=doc.instructions, linked_symptoms=linked, record_id=record_id,
        ))

    suggested: list[ReconciledMedicine] = []
    for i, r in enumerate(rag):
        if i in used_rag:
            continue
        dup = next((s for s in suggested if same_medicine(s.name, s.generic_name, r.name, r.generic_name)), None)
        if dup:  # remove duplicate suggestions, keep all linked symptoms
            dup.linked_symptoms.extend(s for s in r.linked_symptoms if s not in dup.linked_symptoms)
            continue
        suggested.append(ReconciledMedicine(
            name=r.name, generic_name=r.generic_name, tag="rag_suggested", match_status="rag_only",
            linked_symptoms=list(r.linked_symptoms), record_id=r.record_id, suggestion_reason=r.review_reason,
        ))
    return out + suggested


def _fill_doctor_generics(prescribed: list[PrescribedMedicine], hits: list[dict]) -> None:
    """Brand only (e.g. 'Panadol') -> add the generic from the dataset so it can match RAG meds.
    Only the generic is added; the doctor's dose/frequency/duration/instructions are never touched."""
    for doc, h in zip(prescribed, hits):
        if not doc.generic_name and h:
            gen = next((p["generic_name"] for p in h.values() if p.get("generic_name")), None)
            if gen:
                doc.generic_name = gen


@resilient_node("node4_compare", {"reconciled_medicines": []}, max_retries=0)
def node4_compare(state: dict, attempt: int) -> dict:
    prescribed = [PrescribedMedicine.model_validate(m) for m in state.get("prescribed_medicines", [])]
    rag = [RagMedicine.model_validate(m) for m in state.get("rag_medicines", [])]

    store, db_error = None, None
    try:
        from ..rag.store import SymptomMedicineStore
        store = SymptomMedicineStore()
        doc_hits = store.lookup_products([m.model_dump() for m in prescribed])
        _fill_doctor_generics(prescribed, doc_hits)
    except Exception as exc:
        log.warning("node4: dataset lookup unavailable, comparing without it: %s", exc)
        store, db_error = None, exc

    meds = reconcile(prescribed, rag)

    if store is not None and meds:
        try:
            for m, hits in zip(meds, store.lookup_products([m.model_dump() for m in meds])):
                m.info = merge_info(hits)
        except Exception as exc:
            log.warning("node4: medicine info lookup failed: %s", exc)
            return {"reconciled_medicines": [m.model_dump() for m in meds],
                    "errors": [{"node": "node4_compare", "error": f"medicine info unavailable - {exc}"[:300],
                                "attempts": 1}]}
    update = {"reconciled_medicines": [m.model_dump() for m in meds]}
    if db_error is not None and meds:
        update["errors"] = [{"node": "node4_compare", "error": f"medicine info unavailable - {db_error}"[:300],
                             "attempts": 1}]
    return update
