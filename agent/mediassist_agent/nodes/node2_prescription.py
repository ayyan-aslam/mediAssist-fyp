"""Node 2 - Prescription extraction (LLM on the raw cleaned text, no embeddings).

Keeps STRICTLY the medicines the doctor actively prescribed in this consultation (plus medicines the doctor
explicitly says to continue, tagged "continued"). Every result is verified against the transcript:
  * the medicine name must occur in the transcript, otherwise the medicine is removed
  * every number in strength / dose / frequency / duration must occur in the transcript lines about
    THAT medicine ("twice a day" is a frequency, it can't justify "two tablets"), otherwise the field
    is set to null (never guessed)
  * a frequency that is a whole copied sentence, or a question (the patient asking "can I stop it?"), is
    cleared, and the strength is taken out of the name ("DPN, 5 mg" -> "DPN" with strength "5 mg")
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


# A schedule is a few words ("twice a day", "every 6 hours after meals"); a longer value is a copied sentence.
_MAX_FREQUENCY_WORDS = 6


def _drop_copied_sentences(m) -> list[str]:
    """Clears a frequency that is a whole sentence, and a frequency or instruction that is a question (the
    patient asking, not the doctor deciding). Returns the names of the cleared fields."""
    cleared = []
    if m.frequency and (len(m.frequency.split()) > _MAX_FREQUENCY_WORDS or m.frequency.strip().endswith("?")):
        m.frequency, cleared = None, cleared + ["frequency"]
    if m.instructions and m.instructions.strip().endswith("?"):
        m.instructions, cleared = None, cleared + ["instructions"]
    return cleared


def _strip_strength_from_name(m) -> None:
    """"DPN, 5 mg" / "DPN 5mg" with strength "5 mg" -> name "DPN". The strength has its own field."""
    if not (m.name and m.strength):
        return
    tokens = re.findall(r"\d+(?:\.\d+)?|[^\W\d_]+", m.strength)
    if not tokens:
        return
    trailing = re.compile(r"[\s,;:\-]*" + r"\s*".join(map(re.escape, tokens)) + r"\s*$", re.I)
    cut = trailing.sub("", m.name.strip())
    if cut:
        m.name = cut


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
        for field in _drop_copied_sentences(m):
            checks.append(warning("node2_prescription",
                                  f"{m.name}: {field} was cleared - it was a copied sentence or a question, not a schedule."))
        for field in NUMERIC_FIELDS:
            value = getattr(m, field)
            if value and not tx.numbers_in_context(value, m.name, m.source_text):
                checks.append(warning("node2_prescription",
                                      f"{m.name}: {field} '{value}' was cleared - that number is not in the transcript."))
                setattr(m, field, None)
        if m.generic_name and not tx.has_name(m.generic_name):
            m.generic_name = None  # only keep a generic the doctor actually said (Node 4 looks it up otherwise)
        _strip_strength_from_name(m)
        meds.append(m)
    update = {"prescribed_medicines": [m.model_dump() for m in meds]}
    if checks:
        update["errors"] = checks
    return update
