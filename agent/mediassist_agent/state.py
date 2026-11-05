"""Shared LangGraph state.

Values are stored as plain dicts/lists (model_dump of the Pydantic models) so
the state is always JSON-serialisable. Parallel nodes (1, 2, 3) write to
different keys, so they never collide; `errors` uses an add-reducer so every
node can append to it in the same step.
"""
from __future__ import annotations

import operator
from typing import Annotated, Any, Optional, TypedDict


class AgentState(TypedDict, total=False):
    # Input
    consultation_id: str
    patient_id: Optional[str]
    doctor_id: Optional[str]
    raw_transcript: str

    # Step 0 - RE cleaning
    transcript: str                    # cleaned, speaker-tagged text
    turns: list[dict[str, str]]        # [{"speaker": "Doctor", "text": "..."}]

    # Node 1
    symptoms: list[dict[str, Any]]           # present symptoms only (ExtractedSymptom)
    symptom_matches: list[dict[str, Any]]    # SymptomMatch
    rag_medicines: list[dict[str, Any]]      # RagMedicine (flattened, deduped)

    # Node 2
    prescribed_medicines: list[dict[str, Any]]  # PrescribedMedicine

    # Node 3
    medical_history: list[dict[str, Any]]       # HistoryItem

    # Node 4
    reconciled_medicines: list[dict[str, Any]]  # ReconciledMedicine

    # SOAP node
    soap_response: dict[str, Any]

    # Fallback flags from any node
    errors: Annotated[list[dict[str, Any]], operator.add]
