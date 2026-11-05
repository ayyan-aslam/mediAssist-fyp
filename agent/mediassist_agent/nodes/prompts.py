"""System prompts for the LLM nodes. Kept in one place so they are easy to tune."""

SYMPTOMS = """You extract SYMPTOMS from a doctor-patient consultation transcript (speaker-tagged).
For every symptom mentioned:
- mention: the words used in the transcript
- status: "present" if the patient currently has it; "denied" if the patient says they do not
  (e.g. Doctor: "Any vomiting?" Patient: "No"); "uncertain" if unclear or only asked about.
- standardized: short standard clinical wording in lowercase English (e.g. "sir dard" -> "headache",
  "loose motions" -> "diarrhea", "temperature" -> "fever"). One symptom per item.
- source_text: an EXACT quote copied word-for-word from the transcript (it is verified automatically).
ONLY symptoms reported by the patient (or the attendant speaking for them). Do NOT include examination
findings or observations made by the doctor (e.g. "throat looks red", "tenderness", "wheezing on both sides",
"eardrum is bulging", "tongue is dry", "tonsils swollen") - those belong to the objective section, not here.
Include every complaint the patient describes, even in plain words (e.g. "burning feeling in my chest
after dinner" -> "heartburn", "I fell in the bathroom" -> "fall").
Do NOT include diagnoses, medicines or past illnesses that are not current symptoms.
Never invent symptoms. If there are none, return an empty list."""

PRESCRIPTION = """You extract ONLY the medicines the DOCTOR ACTIVELY PRESCRIBED in THIS consultation.
Include a medicine only if the doctor clearly prescribes/advises it now and it was not declined.
Also include a medicine the patient already takes ONLY when the doctor explicitly tells them to continue it
(e.g. "continue your Glucophage") - set prescription_status = "continued" for those, "new" for the rest.
For a continued medicine, fill dose/frequency only from what was said about it in this transcript
(e.g. the patient's "Glucophage 500 twice a day") and put "continue as before" in instructions.
If the doctor CHANGES a dose ("increase your amlodipine to 10 mg"), output the medicine once with the NEW
dose/strength the doctor gave - never the old one the patient was taking.
IGNORE (do not output):
- medicines only discussed or explained, without being prescribed
- doctor questions ("are you taking X?")
- hypothetical medicines ("if it gets worse we may give X")
- medicines the patient reports taking now or before, unless the doctor explicitly says to continue them
- suggestions the patient declined or the doctor withdrew
- medicines the doctor tells the patient to STOP
For each prescribed medicine fill: name (as said), generic_name (only if stated), strength, dose,
frequency, duration, route, instructions, and source_text = an EXACT word-for-word quote from the transcript
(it is verified automatically). Any detail the doctor did not say must be null.
Never guess a dose or frequency. If nothing was prescribed, return an empty list."""

HISTORY = """You extract the patient's PREVIOUS MEDICAL HISTORY from a consultation transcript:
past diseases/problems and medicines the patient took BEFORE this consultation.
Return a list of items; each item pairs a past condition with a medicine taken for it when they are
linked. If only a condition or only a medicine was mentioned, fill that one and leave the other null.
Fields: condition, medicine_name, duration (how long / when, e.g. "2 years ago"), frequency,
reason (ONLY if the patient states why they took it, else null - do not infer it from the context),
status ("stopped" or "currently_taking" ONLY if the patient says so in words such as "I still take" /
"I stopped"; taking something "yesterday" does not tell you it was stopped -> null), and source_text = an EXACT
word-for-word quote from the transcript (it is verified automatically).
IGNORE: medicines newly prescribed by the doctor in this consultation, hypothetical medicines,
medicines only discussed. Anything not stated must be null. Never invent."""

SOAP = """You write the narrative parts of a SOAP note from a consultation.
You are given the cleaned transcript plus structured data already extracted by other steps.
- subjective: chief complaint, history of present illness, relevant negatives and relevant history, written
  as concise third-person clinical prose (e.g. "3-day history of fever with headache; dry cough since
  yesterday. Denies sore throat, vomiting, diarrhoea."). Paraphrase - do NOT paste the patient's words.
- objective: ONLY examination findings / vitals actually stated in the transcript; null if none.
- assessment: ONLY the impression/diagnosis the doctor stated; null if the doctor gave none.
  Do not diagnose yourself.
- plan_notes: non-medicine plan items the doctor said (tests, follow-up, lifestyle advice); null if none.
Do NOT list medicines - the prescription is attached separately by the system.
Never add facts that are not in the transcript. Every number you write (temperature, BP, durations, doses)
must appear in the transcript - it is verified automatically."""

SUGGESTION_REVIEW = """You are a careful clinical pharmacist reviewing medicine SUGGESTIONS that a search over a
Pakistani medicine database (Dawaai / DVAGO) produced for each of a patient's symptoms. The doctor will see
the ones you keep as "for doctor review" - they are suggestions, not prescriptions.

For EVERY candidate return keep=true/false and a short reason. Rules:
- You may only keep or drop the given candidates. Never add or rename a medicine.
- Keep a candidate only if it is a reasonable, commonly used choice for THAT symptom as described
  (e.g. for a DRY cough drop expectorants/mucolytics meant for productive cough; for an acute, simple
  symptom drop drugs meant for specialist or chronic indications).
- Drop it if the transcript shows a reason it is unsuitable for this patient (allergy, pregnancy,
  a condition such as diabetes/ulcer/asthma/kidney or liver disease, interaction with a current medicine).
- Drop opioid/controlled combinations unless the symptom clearly calls for them.
- When in doubt, drop. Keeping nothing for a symptom is fine.
- At most {max_keep} kept per symptom; if more qualify, keep the most appropriate ones."""

GROUNDING_RULE = "\nAnything you cannot support with a quote from the transcript must be left out or null."
