"""Pydantic models for every node's input/output.

Rule agreed in design: only the core field (e.g. medicine name) is required.
Everything else is Optional and stays None when the consultation didn't say it.
The models never invent values.
"""
from __future__ import annotations

from typing import Literal, Optional

from typing import Any

from pydantic import BaseModel as _PydanticBaseModel, Field, model_validator

_NULL_STRINGS = {"null", "none", "n/a", "na", "nil", "unknown", "not stated", "not mentioned", "-", ""}


class BaseModel(_PydanticBaseModel):
    """Treats string placeholders like "null" / "none" / "N/A" from the LLM as a real null."""

    @model_validator(mode="before")
    @classmethod
    def _null_strings(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: (None if isinstance(v, str) and v.strip().lower() in _NULL_STRINGS
                        and cls.model_fields.get(k) is not None and not cls.model_fields[k].is_required()
                        else v)
                    for k, v in data.items()}
        return data

# --------------------------------------------------------------------------
# Node 1 - symptoms + RAG
# --------------------------------------------------------------------------


class ExtractedSymptom(BaseModel):
    mention: str = Field(description="Symptom as the patient/doctor said it.")
    status: Literal["present", "denied", "uncertain"] = Field(
        description="present = patient has it now; denied = patient says no; uncertain = unclear."
    )
    standardized: str = Field(
        description="Short standard clinical wording, lowercase, e.g. 'headache', 'dry cough', 'fever'."
    )
    source_text: Optional[str] = Field(default=None, description="Exact transcript line(s) it came from.")


class SymptomExtraction(BaseModel):
    symptoms: list[ExtractedSymptom] = Field(default_factory=list)


class RagMedicine(BaseModel):
    record_id: Optional[str] = None          # primary key in the dataset table, carried forward to Node 4
    name: str
    generic_name: Optional[str] = None
    source_dataset: Optional[str] = None
    similarity: Optional[float] = None
    linked_symptoms: list[str] = Field(default_factory=list)
    review_reason: Optional[str] = None      # why the LLM review kept this suggestion


class SymptomMatch(BaseModel):
    symptom: str                              # standardized symptom from the consultation
    dataset_symptom: Optional[str] = None     # what it matched in the dataset
    match_type: Literal["exact", "semantic"]
    similarity: Optional[float] = None
    labels: list[str] = Field(default_factory=list)  # all dataset labels used for this symptom
    medicines: list[RagMedicine] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Node 2 - doctor prescription
# --------------------------------------------------------------------------


class PrescribedMedicine(BaseModel):
    name: str = Field(description="Medicine name exactly as the doctor prescribed it.")
    prescription_status: Literal["new", "continued"] = Field(
        default="new",
        description="'new' = prescribed in this consultation; 'continued' = doctor explicitly told the "
                    "patient to continue a medicine they already take.")
    generic_name: Optional[str] = Field(default=None, description="Generic/active ingredient ONLY if stated.")
    strength: Optional[str] = Field(default=None, description="e.g. '500 mg'")
    dose: Optional[str] = Field(default=None, description="e.g. '1 tablet'")
    frequency: Optional[str] = Field(default=None, description="e.g. 'twice a day'")
    duration: Optional[str] = Field(default=None, description="e.g. '5 days'")
    route: Optional[str] = Field(default=None, description="e.g. 'oral'")
    instructions: Optional[str] = Field(default=None, description="e.g. 'after meals'")
    source_text: Optional[str] = Field(default=None, description="Transcript line(s) with the prescription.")


class PrescriptionExtraction(BaseModel):
    medicines: list[PrescribedMedicine] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Node 3 - previous history (past conditions + past medicines)
# --------------------------------------------------------------------------


class HistoryItem(BaseModel):
    condition: Optional[str] = Field(default=None, description="Past disease/problem the patient reported.")
    medicine_name: Optional[str] = Field(default=None, description="Medicine taken before (for that condition if linked).")
    duration: Optional[str] = Field(default=None, description="How long / when, e.g. '2 years ago', 'last week'.")
    frequency: Optional[str] = None
    reason: Optional[str] = Field(default=None, description="Why it was taken, if said.")
    status: Optional[Literal["stopped", "currently_taking"]] = Field(
        default=None, description="Only if clearly stated; otherwise null."
    )
    source_text: Optional[str] = None


class HistoryExtraction(BaseModel):
    items: list[HistoryItem] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Node 4 - reconciled list
# --------------------------------------------------------------------------


class MedicineInfo(BaseModel):
    """Merged from every dataset the medicine was found in (Dawaai and/or DVAGO).
    When both sources have a field with different text, both are kept, each prefixed by its source."""

    indication: Optional[str] = None
    how_to_use: Optional[str] = None
    mechanism: Optional[str] = None          # how the medicine works (DVAGO "how_it_works")
    dosage_reference: Optional[str] = None
    precautions: Optional[str] = None
    warnings: Optional[str] = None
    contraindications: Optional[str] = None
    side_effects: Optional[str] = None
    drug_interactions: Optional[str] = None
    sources: list[str] = Field(default_factory=list)   # e.g. ["dawaai", "dvago"]
    urls: list[str] = Field(default_factory=list)
    matched_products: list[str] = Field(default_factory=list)  # dataset product names used


class ReconciledMedicine(BaseModel):
    name: str
    generic_name: Optional[str] = None
    tag: Literal["doctor_prescribed", "rag_suggested"]
    match_status: Literal["matched", "doctor_only", "rag_only"]
    prescription_status: Optional[Literal["new", "continued"]] = None  # doctor-prescribed only
    suggestion_reason: Optional[str] = None                            # rag-suggested only (LLM review)
    # Doctor's fields - copied unchanged from Node 2 (never overwritten by RAG).
    strength: Optional[str] = None
    dose: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None
    route: Optional[str] = None
    instructions: Optional[str] = None
    linked_symptoms: list[str] = Field(default_factory=list)
    record_id: Optional[str] = None
    info: Optional[MedicineInfo] = None


# --------------------------------------------------------------------------
# SOAP node
# --------------------------------------------------------------------------


class SoapNarrative(BaseModel):
    """The only part of the SOAP note an LLM writes. Medicines are filled in by code."""

    subjective: str = Field(description="Chief complaint and history of present illness, from the patient.")
    objective: Optional[str] = Field(
        default=None, description="Only findings/vitals actually stated in the consultation; null if none."
    )
    assessment: Optional[str] = Field(
        default=None, description="The doctor's stated impression/diagnosis; null if the doctor gave none."
    )
    plan_notes: Optional[str] = Field(
        default=None, description="Non-medicine plan items the doctor said (tests, follow-up, advice)."
    )


# --------------------------------------------------------------------------
# Node 1 - LLM review of retrieved suggestions (keep/drop only, never add)
# --------------------------------------------------------------------------


class SuggestionDecision(BaseModel):
    candidate_id: str = Field(description="The id of the candidate exactly as given, e.g. 'c3'.")
    keep: bool = Field(description="true only if appropriate for THIS symptom in THIS patient.")
    reason: str = Field(description="One short clinical reason (max ~15 words).")


class SuggestionReview(BaseModel):
    decisions: list[SuggestionDecision] = Field(default_factory=list)
