// The parts of the AI Pipeline answer (soap_note.ai_result) the doctor's app shows next to the note:
// symptoms, prescribed medicines with their info, suggestions for the doctor to review, medication
// history and warnings. The doctor's edited prescription and symptoms (soap_note.prescription and
// .symptoms) replace the AI lists when they exist. Field names are turned into camelCase like the rest
// of the API. Anything missing or of the wrong type becomes null or an empty list, so an older or
// partial answer still works.

const list = (value) => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []);
const str = (value) => (typeof value === 'string' && value.trim() ? value : null);
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);

function toMedicineInfo(info) {
  if (!info || typeof info !== 'object') return null;
  return {
    indication: str(info.indication),
    sideEffects: str(info.side_effects),
    contraindications: str(info.contraindications),
    warnings: str(info.warnings),
    precautions: str(info.precautions),
    drugInteractions: str(info.drug_interactions),
    dosageReference: str(info.dosage_reference),
    howToUse: str(info.how_to_use),
    mechanism: str(info.mechanism),
    matchedProducts: strings(info.matched_products),
    sources: strings(info.sources),
    urls: strings(info.urls),
  };
}

// aiIndex for a prescribed medicine, reviewIndex for a suggestion: its position in that AI list.
const toMedicine = (item, { aiIndex = null, reviewIndex = null }) => ({
  aiIndex,
  reviewIndex,
  name: str(item.name),
  genericName: str(item.generic_name),
  strength: str(item.strength),
  dose: str(item.dose),
  frequency: str(item.frequency),
  duration: str(item.duration),
  route: str(item.route),
  instructions: str(item.instructions),
  matchStatus: str(item.match_status),
  linkedSymptoms: strings(item.linked_symptoms),
  suggestionReason: str(item.suggestion_reason),
  info: toMedicineInfo(item.info),
});

const toSymptom = (s, index) => ({
  aiIndex: index,
  symptom: str(s.symptom),
  mention: str(s.mention),
  sourceText: str(s.source_text),
  matchedLabels: strings(s.matched_labels),
});

const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
const fromAi = (aiItems, aiIndex) => (Number.isInteger(aiIndex) ? aiItems[aiIndex] : undefined);

// The doctor's edited medicine on top of the AI medicine it came from: a prescribed one (aiIndex) or an
// accepted suggestion (reviewIndex). The dataset info and the linked symptoms are kept only while the
// name is the same, because they belong to that medicine.
function editedMedicine(edit, aiItems, reviewItems) {
  const prescribed = fromAi(aiItems, edit.aiIndex);
  const suggested = prescribed ? undefined : fromAi(reviewItems, edit.reviewIndex);
  const base = prescribed ?? suggested;
  const sameMedicine = base && sameText(base.name, edit.name);
  return {
    aiIndex: prescribed ? edit.aiIndex : null,
    reviewIndex: suggested ? edit.reviewIndex : null,
    name: str(edit.name),
    genericName: str(edit.genericName),
    strength: sameMedicine ? base.strength : null,
    dose: str(edit.dose),
    frequency: str(edit.frequency),
    duration: str(edit.duration),
    route: sameMedicine ? base.route : null,
    instructions: str(edit.instructions),
    matchStatus: sameMedicine ? base.matchStatus : 'doctor_added',
    linkedSymptoms: sameMedicine ? base.linkedSymptoms : [],
    suggestionReason: null,
    info: sameMedicine ? base.info : null,
  };
}

// The doctor's edited symptom; the transcript line and dataset labels are kept while the text is the same.
function editedSymptom(edit, aiItems) {
  const base = fromAi(aiItems, edit.aiIndex);
  const same = base && sameText(base.symptom, edit.symptom);
  return {
    aiIndex: base ? edit.aiIndex : null,
    symptom: str(edit.symptom),
    mention: same ? base.mention : null,
    sourceText: same ? base.sourceText : null,
    matchedLabels: same ? base.matchedLabels : [],
  };
}

// null when the note has no AI answer and no edits (for example, one saved before ai_result existed).
// edits: the doctor's saved prescription and symptoms lists (null when not edited).
export function toAiInsights(aiResult, { prescription: editedPrescription = null, symptoms: editedSymptoms = null } = {}) {
  const hasEdits = Array.isArray(editedPrescription) || Array.isArray(editedSymptoms);
  if ((!aiResult || typeof aiResult !== 'object') && !hasEdits) return null;
  const result = aiResult && typeof aiResult === 'object' ? aiResult : {};
  const soap = result.soap && typeof result.soap === 'object' ? result.soap : {};
  const plan = soap.plan && typeof soap.plan === 'object' ? soap.plan : {};
  const aiPrescription = list(plan.prescription).map((item, i) => toMedicine(item, { aiIndex: i }));
  const aiReview = list(plan.for_doctor_review).map((item, i) => toMedicine(item, { reviewIndex: i }));
  const aiSymptoms = list(result.symptoms).map(toSymptom);
  return {
    symptoms: Array.isArray(editedSymptoms) ? list(editedSymptoms).map((s) => editedSymptom(s, aiSymptoms)) : aiSymptoms,
    symptomsEdited: Array.isArray(editedSymptoms),
    prescription: Array.isArray(editedPrescription)
      ? list(editedPrescription).map((m) => editedMedicine(m, aiPrescription, aiReview))
      : aiPrescription,
    prescriptionEdited: Array.isArray(editedPrescription),
    forDoctorReview: aiReview,
    medicationHistory: list(soap.medication_history).map((m) => ({
      medicineName: str(m.medicine_name),
      condition: str(m.condition),
      duration: str(m.duration),
      frequency: str(m.frequency),
      status: str(m.status),
      sourceText: str(m.source_text),
    })),
    warnings: list(result.warnings).map((w) => ({
      section: str(w.section),
      message: str(w.message),
      detail: str(w.detail),
    })),
  };
}
