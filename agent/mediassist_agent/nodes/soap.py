"""SOAP node - builds the structured JSON response for the front end.

Inputs: Node 4's tagged, symptom-linked medicines + Node 3's previous history (+ Node 1 symptoms).
  * The LLM writes ONLY the narrative (subjective / objective / assessment / plan notes).
  * Medicines are placed by CODE from their tags, never rewritten by the model:
        doctor_prescribed -> soap.plan.prescription
        rag_suggested     -> soap.plan.for_doctor_review
        Node 3 history    -> soap.medication_history
  * Response envelope: schema_version, consultation/patient/doctor ids, timestamp, status, warnings.
If the narrative LLM call fails, the structure is still returned with empty narrative + a warning.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from ..config import settings
from ..fallback import firmer
from ..grounding import Transcript, warning
from ..llm import extract
from ..schemas import SoapNarrative
from . import prompts

log = logging.getLogger("mediassist_agent")

_SECTION_FOR_NODE = {
    "node1_symptoms_rag": "Symptom matching / suggested medicines",
    "node2_prescription": "Doctor prescription extraction",
    "node3_history": "Previous medical history",
    "node4_compare": "Medicine comparison / medicine info",
    "soap_narrative": "SOAP narrative (S/O/A)",
    "clean": "Transcript",
}


def _narrative(state: dict) -> tuple[SoapNarrative | None, dict | None]:
    context = {
        "present_symptoms": [s.get("standardized") for s in state.get("symptoms", [])],
        "previous_history": state.get("medical_history", []),
        "prescribed_medicines": [m["name"] for m in state.get("reconciled_medicines", [])
                                 if m["tag"] == "doctor_prescribed"],
    }
    user_text = f"{state.get('transcript', '')}\n\nEXTRACTED DATA (for reference):\n{json.dumps(context, ensure_ascii=False)}"
    last = None
    for attempt in range(settings.max_retries + 1):
        try:
            return extract(SoapNarrative, firmer(prompts.SOAP, attempt), user_text), None
        except Exception as exc:
            last = exc
            log.warning("soap narrative attempt=%d failed: %s", attempt, exc)
    return None, {"node": "soap_narrative", "error": f"{type(last).__name__}: {str(last)[:300]}",
                  "attempts": settings.max_retries + 1}


def build_response(state: dict, narrative: SoapNarrative | None, extra_errors: list[dict]) -> dict:
    meds = state.get("reconciled_medicines", [])
    errors = list(state.get("errors", [])) + extra_errors
    return {
        "schema_version": settings.soap_schema_version,
        "consultation_id": state.get("consultation_id"),
        "patient_id": state.get("patient_id"),
        "doctor_id": state.get("doctor_id"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "draft",  # front end -> doctor edits -> "approved" on confirm
        "soap": {
            "subjective": narrative.subjective if narrative else "",
            "objective": narrative.objective if narrative else None,
            "assessment": narrative.assessment if narrative else None,
            "plan": {
                "notes": narrative.plan_notes if narrative else None,
                "prescription": [m for m in meds if m["tag"] == "doctor_prescribed"],
                "for_doctor_review": [m for m in meds if m["tag"] == "rag_suggested"],
            },
            "medication_history": state.get("medical_history", []),
        },
        "symptoms": [
            {
                "symptom": s.get("standardized"),
                "mention": s.get("mention"),
                "source_text": s.get("source_text"),
                "matched_labels": next((m.get("labels") or [m.get("dataset_symptom")]
                                        for m in state.get("symptom_matches", [])
                                        if m["symptom"] == s.get("standardized")), []),
            }
            for s in state.get("symptoms", [])
        ],
        "warnings": [
            {
                "section": _SECTION_FOR_NODE.get(e.get("node"), e.get("node")),
                "node": e.get("node"),
                "type": e.get("kind", "failure"),  # "verification" = something was removed/cleared/flagged
                "message": e.get("error") if e.get("kind") == "verification"
                else "This part could not be generated automatically - please review.",
                "detail": e.get("error"),
            }
            for e in errors
        ],
    }


def _verify_narrative(narrative: SoapNarrative, transcript: str) -> list[dict]:
    """Every number in the narrative (temperature, BP, days, doses...) must occur in the transcript."""
    tx = Transcript(transcript)
    out = []
    for field in ("subjective", "objective", "assessment", "plan_notes"):
        text = getattr(narrative, field)
        if text and not tx.has_numbers(text):
            out.append(warning("soap_narrative", f"SOAP {field} mentions a number that is not in the transcript - please check it."))
    return out


def soap_node(state: dict) -> dict:
    narrative, errs = None, []
    if state.get("transcript"):
        narrative, err = _narrative(state)
        if err:
            errs.append(err)
        if narrative:
            errs += _verify_narrative(narrative, state["transcript"])
    return {"soap_response": build_response(state, narrative, errs)}
