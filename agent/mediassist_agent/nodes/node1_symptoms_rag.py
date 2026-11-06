"""Node 1 - Symptoms + RAG (the only node that uses embeddings).

  cleaned transcript
    -> LLM extracts symptoms, classifies present/denied/uncertain AND standardizes wording (one call)
    -> keep only PRESENT symptoms
    -> for each: exact match in dataset, else semantic search (pgvector) on the standardized symptom
    -> matched  -> shortlist of candidate medicines (record_id carried forward to Node 4)
    -> no match -> discard
    -> LLM REVIEW: keep/drop each candidate for this symptom in this patient (never adds a medicine)
"""
from __future__ import annotations

import json
import logging

from ..fallback import firmer, resilient_node
from ..grounding import Transcript, warning
from ..llm import embed, extract
from ..rag.store import SymptomMedicineStore
from ..text import norm_generic, norm_name, normalise_symptom
from ..schemas import RagMedicine, SuggestionReview, SymptomExtraction, SymptomMatch
from ..config import settings
from . import prompts

log = logging.getLogger("mediassist_agent")

EMPTY = {"symptoms": [], "symptom_matches": [], "rag_medicines": []}


def _dedupe_present(extraction: SymptomExtraction) -> list:
    seen, out = set(), []
    for s in extraction.symptoms:
        key = normalise_symptom(s.standardized)
        if s.status == "present" and key and key not in seen:
            seen.add(key)
            out.append(s)
    return out


def _match_symptoms(symptoms: list, store: SymptomMedicineStore) -> list[SymptomMatch]:
    names = [s.standardized for s in symptoms]
    vectors = embed(names) if names else []  # one batched embedding call for this consultation only
    matches: list[SymptomMatch] = []
    for name, vec in zip(names, vectors):
        hit = store.search(name, vec)
        if not hit:
            log.info("node1: no dataset match for %r -> discarded", name)
            continue
        # store already returns the best medicines (one product per generic, most common first)
        meds = {
            norm_generic(r["generic_name"]) or norm_name(r["medicine_name"]): RagMedicine(
                record_id=r["id"], name=r["medicine_name"], generic_name=r["generic_name"],
                source_dataset=r["source_dataset"], similarity=hit["similarity"], linked_symptoms=[name],
            )
            for r in hit["medicines"][: settings.rag_candidates_per_symptom]
        }
        matches.append(SymptomMatch(
            symptom=name, dataset_symptom=hit["dataset_symptom"], match_type=hit["match_type"],
            similarity=hit["similarity"], labels=hit.get("labels", []), medicines=list(meds.values()),
        ))
    return matches


def _review(matches: list[SymptomMatch], symptoms: list, transcript: str, attempt: int) -> None:
    """One LLM call: keep/drop every candidate (in place). Raises on failure -> node fallback."""
    if not any(m.medicines for m in matches):
        return
    described = {s.standardized: s.mention for s in symptoms}
    cands, by_id = [], {}
    for m in matches:
        for med in m.medicines:
            cid = f"c{len(by_id) + 1}"
            by_id[cid] = med
            cands.append({"candidate_id": cid, "symptom": m.symptom, "patient_said": described.get(m.symptom),
                          "medicine": med.name, "generic": med.generic_name})
    text = (f"{transcript}\n\nCANDIDATES (JSON):\n{json.dumps(cands, ensure_ascii=False)}")
    prompt = prompts.SUGGESTION_REVIEW.format(max_keep=settings.rag_max_medicines_per_symptom)
    review = extract(SuggestionReview, firmer(prompt, attempt), text)

    keep = {d.candidate_id: d.reason for d in review.decisions if d.keep and d.candidate_id in by_id}
    for m in matches:
        kept = []
        for med in m.medicines:
            cid = next(k for k, v in by_id.items() if v is med)
            if cid in keep:
                med.review_reason = keep[cid]
                kept.append(med)
        m.medicines = kept[: settings.rag_max_medicines_per_symptom]
    log.info("node1: review kept %d of %d candidates", sum(len(m.medicines) for m in matches), len(by_id))


def _flatten(matches: list[SymptomMatch]) -> list[dict]:
    """One entry per medicine; a medicine suggested for several symptoms keeps all of them."""
    by_key: dict[str, RagMedicine] = {}
    for m in matches:
        for med in m.medicines:
            key = norm_generic(med.generic_name) or norm_name(med.name)
            if key in by_key:
                for s in med.linked_symptoms:
                    if s not in by_key[key].linked_symptoms:
                        by_key[key].linked_symptoms.append(s)
            else:
                by_key[key] = med.model_copy(deep=True)
    return [m.model_dump() for m in by_key.values()]


@resilient_node("node1_symptoms_rag", EMPTY)
def node1_symptoms_rag(state: dict, attempt: int) -> dict:
    extraction = extract(SymptomExtraction, firmer(prompts.SYMPTOMS, attempt), state["transcript"])
    present = _dedupe_present(extraction)
    tx = Transcript(state["transcript"])
    checks = []
    grounded = []
    for s in present:
        if tx.has_quote(s.source_text) or tx.has_name(s.mention):
            grounded.append(s)
        else:
            checks.append(warning("node1_symptoms_rag", f"Symptom '{s.mention}' was removed: not found in the transcript."))
    present = grounded

    try:
        store = SymptomMedicineStore()
        matches = _match_symptoms(present, store)
        rag_error = None
    except Exception as exc:  # DB down / not ingested: keep the symptoms, flag the RAG part
        log.warning("node1: RAG unavailable: %s", exc)
        matches, rag_error = [], f"{type(exc).__name__}: {str(exc)[:200]}"

    review_error = None
    if matches and settings.rag_llm_review:
        for review_attempt in range(settings.max_retries + 1):
            try:
                _review(matches, present, state["transcript"], review_attempt)
                review_error = None
                break
            except Exception as exc:
                review_error = exc
                log.warning("node1: suggestion review attempt=%d failed: %s", review_attempt, exc)
        if review_error is not None:
            # unreviewed suggestions are not shown - symptoms are kept, the doctor sees a warning
            for m in matches:
                m.medicines = []
            rag_error = f"suggestion review failed, no suggestions shown - {type(review_error).__name__}: {str(review_error)[:150]}"
    elif matches:
        for m in matches:
            m.medicines = m.medicines[: settings.rag_max_medicines_per_symptom]

    update = {
        "symptoms": [s.model_dump() for s in present],
        "symptom_matches": [m.model_dump() for m in matches],
        "rag_medicines": _flatten(matches),
    }
    if checks:
        update["errors"] = checks
    if rag_error:
        msg = rag_error if rag_error.startswith("suggestion review") else f"RAG search unavailable - {rag_error}"
        update["errors"] = checks + [{"node": "node1_symptoms_rag", "error": msg, "attempts": 1}]
    return update
