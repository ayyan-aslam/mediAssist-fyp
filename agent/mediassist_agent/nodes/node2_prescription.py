"""Node 2 - Prescription extraction (LLM on the raw cleaned text, no embeddings).

Keeps STRICTLY the medicines the doctor actively prescribed in this consultation (plus medicines the doctor
explicitly says to continue, tagged "continued"). Every result is verified against the transcript:
  * the medicine name must occur in the transcript, otherwise the medicine is removed
  * every number in strength / dose / frequency / duration must occur in the transcript lines about
    THAT medicine ("twice a day" is a frequency, it can't justify "two tablets"), otherwise the field
    is set to null (never guessed)
"""
from __future__ import annotations

from ..fallback import firmer, resilient_node
from ..grounding import Transcript, warning
from ..llm import extract
from ..schemas import PrescriptionExtraction
from . import prompts

import re

NUMERIC_FIELDS = ("strength", "dose", "frequency", "duration")

# "twice a day", "3 times daily", "at night", "BD", "teen dafa" ... is a FREQUENCY, not a dose
_FREQUENCY_LIKE = re.compile(
    r"\b(once|twice|thrice|times?|daily|a day|per day|every|hourly|at night|at bedtime|in the morning|"
    r"when needed|as needed|prn|od|bd|bid|tds|tid|qid|hs|dafa|baar|martaba)\b", re.I)
_DOSE_UNIT = re.compile(r"\b(tab|tablet|cap|capsule|ml|puff|sachet|drop|spoon|teaspoon|tsp|mg|unit|patch)s?\b", re.I)


def _fix_misplaced_frequency(m) -> None:
    """Some models put "twice a day" in `dose`. Move it to `frequency` (only if frequency is empty)."""
    if m.dose and _FREQUENCY_LIKE.search(m.dose) and not _DOSE_UNIT.search(m.dose):
        if not m.frequency:
            m.frequency = m.dose
        m.dose = None


@resilient_node("node2_prescription", {"prescribed_medicines": []})
def node2_prescription(state: dict, attempt: int) -> dict:
    result = extract(PrescriptionExtraction, firmer(prompts.PRESCRIPTION, attempt), state["transcript"])
    tx = Transcript(state["transcript"])
    meds, checks = [], []
    for m in result.medicines:
        if not (m.name and m.name.strip()):
            continue
        if not tx.has_name(m.name):
            checks.append(warning("node2_prescription", f"Medicine '{m.name}' was removed: name not found in the transcript."))
            continue
        _fix_misplaced_frequency(m)
        for field in NUMERIC_FIELDS:
            value = getattr(m, field)
            if value and not tx.numbers_in_context(value, m.name, m.source_text):
                checks.append(warning("node2_prescription",
                                      f"{m.name}: {field} '{value}' was cleared - that number is not in the transcript."))
                setattr(m, field, None)
        if m.generic_name and not tx.has_name(m.generic_name):
            m.generic_name = None  # only keep a generic the doctor actually said (Node 4 looks it up otherwise)
        meds.append(m)
    update = {"prescribed_medicines": [m.model_dump() for m in meds]}
    if checks:
        update["errors"] = checks
    return update
