"""Node 3 - Previous history (past conditions + past medicines). Goes straight to the SOAP node.

Verified against the transcript: an item is kept only if its quote, its medicine name or its condition
can be found in the transcript; numbers in duration/frequency must occur in the transcript.
"""
from __future__ import annotations

from ..fallback import firmer, resilient_node
from ..grounding import Transcript, warning
from ..llm import extract
from ..schemas import HistoryExtraction
from . import prompts


@resilient_node("node3_history", {"medical_history": []})
def node3_history(state: dict, attempt: int) -> dict:
    result = extract(HistoryExtraction, firmer(prompts.HISTORY, attempt), state["transcript"])
    tx = Transcript(state["transcript"])
    items, checks = [], []
    for i in result.items:
        if not (i.condition or i.medicine_name):
            continue
        label = i.medicine_name or i.condition
        grounded = tx.has_quote(i.source_text) or (i.medicine_name and tx.has_name(i.medicine_name)) \
            or (i.condition and tx.has_name(i.condition))
        if not grounded:
            checks.append(warning("node3_history", f"History item '{label}' was removed: not found in the transcript."))
            continue
        if i.medicine_name and not tx.has_name(i.medicine_name):
            checks.append(warning("node3_history", f"History medicine '{i.medicine_name}' was cleared: name not in the transcript."))
            i.medicine_name = None
        for field in ("duration", "frequency"):
            value = getattr(i, field)
            if value and not tx.numbers_in_context(value, i.medicine_name or i.condition, i.source_text):
                setattr(i, field, None)
                checks.append(warning("node3_history", f"{label}: {field} '{value}' was cleared - number not in the transcript."))
        items.append(i)
    update = {"medical_history": [i.model_dump() for i in items]}
    if checks:
        update["errors"] = checks
    return update
