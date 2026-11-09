// Mock mode (NEXT_PUBLIC_USE_MOCKS=true): answers with the example responses
// from design doc Sections 5.2 and 5.5, so screens can be built without the backend.
//
// Two small changes from the doc examples:
// - /auth/login returns the doctor from the GET /users/me example (the doc example is a patient),
//   so the doctor area can be opened.
// - The access token is a JWT-shaped (unsigned) token with that user, because the app
//   reads the user from the token after a page reload.
//
// To see the error screens, use these values (messages as in the Auth & User Service):
// - Sign-up: email taken@example.com, phone 03000000000, CNIC 1111111111111 or registration no PMDC-00000.
// - Login: unverified@example.com (EMAIL_NOT_VERIFIED) or suspended@example.com (ACCOUNT_SUSPENDED).
// - Profile: phone 03000000000 (PHONE_TAKEN). Saved changes are kept until the page is reloaded.
// - New consultation: phone 03214567890 is a saved patient (the doc example). Other numbers are new.
//   Patients added or edited here are kept until the page is reloaded.
// - Recording: every audio part is saved (201) and stop always succeeds.
// - SOAP note: every consultation has the doc example note. Saved changes are kept until the page is reloaded.
// - Patients, history, recent notes and search: every saved patient has one note (consultation 41, the doc example).
// - Prescription (design doc 5.7 example): finalize saves the note's prescription. Send-options use the
//   patient's saved email (Bilal has none: add one to send). A send is "sent" after 4 seconds, or
//   "failed" when the email starts with "fail".

const DOCTOR = {
  userId: 16,
  fullName: "Dr. Sara Ahmed",
  email: "sara@example.com",
  phone: "03111234567",
  role: "doctor",
  registrationNo: "PMDC-12345",
  specialty: { specialtyId: 3, name: "Cardiologist" } as { specialtyId: number; name: string } | null,
};

const SPECIALTIES = [
  { specialtyId: 1, name: "General Physician" },
  { specialtyId: 3, name: "Cardiologist" },
];

const ADMIN_USER = {
  userId: 16,
  fullName: "Dr. Sara Ahmed",
  email: "sara@example.com",
  phone: "03111234567",
  role: "doctor",
  accountStatus: "active",
  specialty: { specialtyId: 3, name: "Cardiologist" },
  createdAt: "2026-10-01T09:15:00Z",
};

// The example of GET /admin/audit-logs (design doc 5.10).
const AUDIT_LOG = {
  logId: 5012,
  user: { userId: 16, fullName: "Dr. Sara Ahmed", role: "doctor" },
  action: "prescription_send",
  details: "Prescription 33 sent by WhatsApp",
  ipAddress: "39.45.12.8",
  createdAt: "2026-10-07T09:41:00Z",
};

const CLINICAL_PATIENTS: Record<string, unknown>[] = [
  { clinicalPatientId: 7, fullName: "Bilal Hussain", phone: "03214567890", email: null, age: 45, gender: "male", createdAt: "2026-10-07T09:00:00Z" },
];

const SOAP_NOTE = {
  soapNoteId: 39,
  consultationId: 41,
  subjective: "Patient has sore throat for 3 days...",
  objective: "Temperature 100 F. Throat is red.",
  assessment: "Viral throat infection.",
  plan: "Panadol 500 mg twice a day for 3 days. Warm salt water gargles.",
  updatedAt: "2026-10-07T09:19:12Z",
  aiInsights: {
    symptoms: [
      {
        aiIndex: 0,
        symptom: "sore throat",
        mention: "gala kharab hai",
        sourceText: "Patient: Doctor sahab, 3 din se gala kharab hai.",
        matchedLabels: ["Sore Throat"],
      },
      {
        aiIndex: 1,
        symptom: "fever",
        mention: "halka bukhar",
        sourceText: "Patient: Raat ko halka bukhar bhi hota hai.",
        matchedLabels: ["Fever"],
      },
    ],
    symptomsEdited: false,
    prescriptionEdited: false,
    prescription: [
      {
        aiIndex: 0,
        reviewIndex: null,
        name: "Panadol 500 mg",
        genericName: "Paracetamol (500mg)",
        strength: "500 mg",
        dose: null,
        frequency: "twice a day",
        duration: "3 days",
        route: null,
        instructions: null,
        matchStatus: "matched",
        linkedSymptoms: ["fever"],
        suggestionReason: null,
        info: {
          indication: "Dawaai: Used for pain and fever.\n\nDVAGO: Fast relief from headache, fever and body pain.",
          sideEffects: "Rare. An allergic reaction is uncommon.",
          contraindications: "Severe liver or kidney disease.",
          warnings: "Do not take more than 4000 mg in 24 hours.",
          precautions: null,
          drugInteractions: "May increase the effect of warfarin with regular daily use.",
          dosageReference: "Adults: 1–2 tablets every 4 to 6 hours. At most 8 tablets in 24 hours.",
          howToUse: "Take by mouth with water.",
          mechanism: null,
          matchedProducts: ["Panadol", "Panadol Tablets 500mg"],
          sources: ["dawaai", "dvago"],
          urls: ["https://dawaai.pk/", "https://www.dvago.pk/"],
        },
      },
    ],
    forDoctorReview: [
      {
        aiIndex: null,
        reviewIndex: 0,
        name: "Strepsils",
        genericName: "Amylmetacresol + Dichlorobenzyl alcohol",
        strength: null,
        dose: null,
        frequency: null,
        duration: null,
        route: null,
        instructions: null,
        matchStatus: "rag_only",
        linkedSymptoms: ["sore throat"],
        suggestionReason: "Lozenges can soothe a sore throat.",
        info: { indication: "Relief of sore throat.", sideEffects: null, contraindications: null, warnings: null, precautions: null, drugInteractions: null, dosageReference: null, howToUse: null, mechanism: null, matchedProducts: ["Strepsils"], sources: ["dawaai"], urls: [] },
      },
    ],
    medicationHistory: [
      { medicineName: "Glucophage 500", condition: "diabetes", duration: "5 years", frequency: "twice a day", status: "currently_taking", sourceText: null },
    ],
    warnings: [],
  },
};
let soapNoteChanged = false;
let followUpDate: string | null = null;

type MockPrescription = { prescriptionId: number; consultationId: number; [field: string]: unknown };
let prescription: MockPrescription | null = null;
const sends: { sendId: number; recipient: string; requestedAt: number }[] = [];
const SEND_TAKES_MS = 4000;

const maskEmail = (email: string) => {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
};

function finalize(consultationId: number): [number, unknown] {
  if (prescription) return [409, { error: { code: "PRESCRIPTION_EXISTS", message: "This prescription is already final.", prescriptionId: prescription.prescriptionId } }];
  const edited = (SOAP_NOTE as Record<string, unknown>).prescription as Record<string, unknown>[] | undefined;
  const medicines = (edited ?? SOAP_NOTE.aiInsights.prescription) as Record<string, unknown>[];
  if (medicines.length === 0) return error(409, "PRESCRIPTION_EMPTY", "The prescription has no medicines.");
  prescription = {
    prescriptionId: 33,
    consultationId,
    status: "final",
    patientName: "Bilal Hussain",
    notes: SOAP_NOTE.plan,
    createdAt: new Date().toISOString(),
    items: medicines.map((m, i) => ({
      itemId: 101 + i,
      position: i + 1,
      medicineName: m.name,
      genericName: m.genericName ?? null,
      dose: m.dose ?? null,
      frequency: m.frequency ?? null,
      duration: m.duration ?? null,
      instructions: m.instructions ?? null,
      source: m.reviewIndex != null ? "ai_accepted" : m.aiIndex != null ? "doctor_prescribed" : "doctor_added",
      referenceInfo: null,
    })),
  };
  return [201, prescription];
}

function delivery(send: (typeof sends)[number]) {
  const done = Date.now() - send.requestedAt >= SEND_TAKES_MS;
  const failed = send.recipient.startsWith("fail");
  return {
    sendId: send.sendId,
    channel: "email",
    recipient: maskEmail(send.recipient),
    status: done ? (failed ? "failed" : "sent") : "sending",
    errorMessage: done && failed ? "The email address was not accepted." : null,
    requestedAt: new Date(send.requestedAt).toISOString(),
    completedAt: done ? new Date(send.requestedAt + SEND_TAKES_MS).toISOString() : null,
  };
}

const patientEmail = () => CLINICAL_PATIENTS[0].email as string | null;
const prescriptionOr404 = (id: string, then: () => [number, unknown?]) =>
  prescription?.prescriptionId === Number(id) ? then() : error(404, "PRESCRIPTION_NOT_FOUND", "This prescription was not found.");

// A paged list (design doc 5.1.2) of the given rows.
function paged(rows: unknown[], query: URLSearchParams): [number, unknown] {
  const page = Number(query.get("page") ?? 1);
  const pageSize = Number(query.get("pageSize") ?? 20);
  return [200, { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length }];
}

const matches = (patient: Record<string, unknown>, q: string) =>
  String(patient.fullName).toLowerCase().includes(q.toLowerCase()) || String(patient.phone).includes(q);

// GET /soap-notes and /soap-notes/search items: one note per saved patient.
const noteItems = (q?: string) =>
  CLINICAL_PATIENTS.filter((p) => !q || matches(p, q)).map((p) => ({
    consultationId: SOAP_NOTE.consultationId,
    date: "2026-10-07",
    patient: { clinicalPatientId: p.clinicalPatientId, fullName: p.fullName, phone: p.phone },
  }));

function base64Url(value: object) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mockAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = { userId: DOCTOR.userId, role: DOCTOR.role, name: DOCTOR.fullName, email: DOCTOR.email, iat: now, exp: now + 900 };
  return `${base64Url({ alg: "none" })}.${base64Url(payload)}.mock`;
}

type Handler = (body: Record<string, unknown>, params: string[], query: URLSearchParams) => [number, unknown?];

const error = (status: number, code: string, message: string): [number, unknown] => [status, { error: { code, message } }];

function registerDoctor(body: Record<string, unknown>): [number, unknown?] {
  if (body.email === "taken@example.com") return error(409, "EMAIL_TAKEN", "This email is already registered.");
  if (body.phone === "03000000000") return error(409, "PHONE_TAKEN", "This phone number is already registered.");
  if (body.cnic === "1111111111111") return error(409, "CNIC_TAKEN", "This CNIC is already registered.");
  if (body.registrationNo === "PMDC-00000")
    return error(409, "REGISTRATION_NO_TAKEN", "This registration number is already registered.");
  return [201, { userId: 16, message: "Account created. Please verify your email before logging in." }];
}

// In mock mode the "Firebase token" is "mock:<email>" (see lib/firebase.ts).
function login(body: Record<string, unknown>): [number, unknown?] {
  const email = String(body.firebaseToken ?? "").replace(/^mock:/, "");
  if (email === "unverified@example.com") return error(403, "EMAIL_NOT_VERIFIED", "Please verify your email before logging in.");
  if (email === "suspended@example.com") return error(403, "ACCOUNT_SUSPENDED", "Your account is suspended. Please contact support.");
  return [
    200,
    {
      accessToken: mockAccessToken(),
      refreshToken: "c1f9a2...",
      expiresIn: 900,
      user: { userId: DOCTOR.userId, fullName: DOCTOR.fullName, email: DOCTOR.email, role: DOCTOR.role },
    },
  ];
}

const routes: [string, RegExp, Handler][] = [
  ["POST", /^\/auth\/patient\/register$/, () => [201, { userId: 15, message: "Account created. Please verify your email before logging in." }]],
  ["POST", /^\/auth\/doctor\/register$/, registerDoctor],
  ["POST", /^\/auth\/login$/, login],
  [
    "POST",
    /^\/auth\/social-login$/,
    () => [
      200,
      {
        accessToken: mockAccessToken(),
        refreshToken: "c1f9a2...",
        expiresIn: 900,
        user: { userId: 15, fullName: "Ali Khan", email: "ali@example.com", role: "patient" },
        isNewUser: false,
      },
    ],
  ],
  ["POST", /^\/auth\/refresh$/, () => [200, { accessToken: mockAccessToken(), refreshToken: "9b7e44...", expiresIn: 900 }]],
  ["POST", /^\/auth\/logout$/, () => [204]],
  ["GET", /^\/users\/me$/, () => [200, DOCTOR]],
  [
    "PATCH",
    /^\/users\/me$/,
    (body) => {
      if (body.phone === "03000000000") return error(409, "PHONE_TAKEN", "This phone number is already registered.");
      const { specialtyId, ...rest } = body;
      if (specialtyId !== undefined) DOCTOR.specialty = SPECIALTIES.find((s) => s.specialtyId === specialtyId) ?? null;
      Object.assign(DOCTOR, rest);
      return [200, DOCTOR];
    },
  ],
  ["GET", /^\/specialties$/, () => [200, { items: SPECIALTIES }]],
  [
    "GET",
    /^\/clinical-patients$/,
    (_, __, query) => {
      if (!query.has("phone")) {
        const q = query.get("q");
        return paged([...CLINICAL_PATIENTS].reverse().filter((p) => !q || matches(p, q)), query);
      }
      const patient = CLINICAL_PATIENTS.find((p) => p.phone === query.get("phone"));
      return [200, patient ? { found: true, patient } : { found: false, patient: null }];
    },
  ],
  [
    "POST",
    /^\/clinical-patients$/,
    (body) => {
      if (CLINICAL_PATIENTS.some((p) => p.phone === body.phone))
        return error(409, "PHONE_ALREADY_SAVED", "You have already saved a patient with this phone number.");
      const patient = { clinicalPatientId: CLINICAL_PATIENTS.length + 7, ...body, createdAt: new Date().toISOString() };
      CLINICAL_PATIENTS.push(patient);
      return [201, patient];
    },
  ],
  [
    "GET",
    /^\/clinical-patients\/(\d+)$/,
    (_, [id]) => {
      const patient = CLINICAL_PATIENTS.find((p) => p.clinicalPatientId === Number(id));
      return patient ? [200, patient] : error(404, "PATIENT_NOT_FOUND", "This patient was not found.");
    },
  ],
  [
    "PATCH",
    /^\/clinical-patients\/(\d+)$/,
    (body, [id]) => {
      const patient = CLINICAL_PATIENTS.find((p) => p.clinicalPatientId === Number(id));
      if (!patient) return error(404, "PATIENT_NOT_FOUND", "This patient was not found.");
      Object.assign(patient, body);
      return [200, patient];
    },
  ],
  [
    "GET",
    /^\/clinical-patients\/(\d+)\/soap-notes$/,
    (_, [id], query) => {
      if (!CLINICAL_PATIENTS.some((p) => p.clinicalPatientId === Number(id)))
        return error(404, "PATIENT_NOT_FOUND", "This patient was not found.");
      const item = { consultationId: SOAP_NOTE.consultationId, date: "2026-10-07", status: "completed", assessment: SOAP_NOTE.assessment };
      return paged([item], query);
    },
  ],
  ["GET", /^\/soap-notes$/, (_, __, query) => paged(noteItems(), query)],
  [
    "GET",
    /^\/soap-notes\/search$/,
    (_, __, query) => {
      const q = (query.get("q") ?? "").trim();
      if (q.length < 2) return error(400, "VALIDATION_ERROR", "q: Too small: expected string to have >=2 characters");
      return paged(noteItems(q), query);
    },
  ],
  ["POST", /^\/consultations$/, () => [201, { consultationId: 41, status: "recording", startedAt: new Date().toISOString() }]],
  [
    "GET",
    /^\/consultations\/(\d+)$/,
    (_, [id]) => [
      200,
      {
        consultationId: Number(id),
        patient: { clinicalPatientId: 7, fullName: "Bilal Hussain", phone: "03214567890" },
        status: "recording",
        failureReason: null,
        followUpDate,
        startedAt: new Date().toISOString(),
        endedAt: null,
      },
    ],
  ],
  // The FormData body is not read here, so the answer does not carry the real part number.
  ["POST", /^\/consultations\/(\d+)\/audio-parts$/, () => [201, { partNo: 1, saved: true }]],
  [
    "POST",
    /^\/consultations\/(\d+)\/stop$/,
    (_, [id]) => [200, { consultationId: Number(id), status: "processing", endedAt: new Date().toISOString() }],
  ],
  ["POST", /^\/consultations\/(\d+)\/retry$/, (_, [id]) => [200, { consultationId: Number(id), status: "processing" }]],
  ["DELETE", /^\/consultations\/(\d+)$/, () => [204]],
  ["GET", /^\/consultations\/(\d+)\/soap-note$/, (_, [id]) => [200, { ...SOAP_NOTE, consultationId: Number(id) }]],
  [
    "PATCH",
    /^\/consultations\/(\d+)\/soap-note$/,
    (body) => {
      Object.assign(SOAP_NOTE, body, { updatedAt: new Date().toISOString() });
      soapNoteChanged = true;
      return [200, { updatedAt: SOAP_NOTE.updatedAt }];
    },
  ],
  [
    "POST",
    /^\/consultations\/(\d+)\/soap-note\/finish-editing$/,
    () => {
      const changed = soapNoteChanged;
      soapNoteChanged = false;
      return [200, { changed }];
    },
  ],
  [
    "PUT",
    /^\/consultations\/(\d+)\/follow-up$/,
    (body, [id]) => {
      const date = body.followUpDate as string | null;
      if (date !== null && date < new Date().toISOString().slice(0, 10)) return error(400, "DATE_IN_PAST", "The follow-up date cannot be in the past.");
      followUpDate = date;
      return [200, { consultationId: Number(id), followUpDate, patientReminder: date !== null && patientEmail() !== null }];
    },
  ],
  ["POST", /^\/prescriptions$/, (body) => finalize(Number(body.consultationId))],
  [
    "GET",
    /^\/prescriptions$/,
    (_, __, query) =>
      prescription && prescription.consultationId === Number(query.get("consultationId"))
        ? [200, prescription]
        : error(404, "PRESCRIPTION_NOT_FOUND", "This prescription was not found."),
  ],
  // The answer is not a real PDF; it only starts the download.
  ["GET", /^\/prescriptions\/(\d+)\/pdf$/, (_, [id]) => prescriptionOr404(id, () => [200, { mock: "prescription PDF" }])],
  [
    "GET",
    /^\/prescriptions\/(\d+)\/send-options$/,
    (_, [id]) =>
      prescriptionOr404(id, () => {
        const email = patientEmail();
        return [
          200,
          {
            email: email ? { available: true, recipient: maskEmail(email) } : { available: false, recipient: null },
            whatsapp: { available: false, reason: "Coming later" },
          },
        ];
      }),
  ],
  [
    "POST",
    /^\/prescriptions\/(\d+)\/send$/,
    (body, [id]) =>
      prescriptionOr404(id, () => {
        if (body.channel !== "email") return error(400, "CHANNEL_NOT_AVAILABLE", "This channel is not available.");
        const email = patientEmail();
        if (!email) return error(409, "NO_EMAIL", "This patient has no email address.");
        const send = { sendId: sends.length + 9, recipient: email, requestedAt: Date.now() };
        sends.unshift(send);
        return [202, { sendId: send.sendId, status: "sending" }];
      }),
  ],
  [
    "GET",
    /^\/prescriptions\/(\d+)\/deliveries$/,
    (_, [id], query) => prescriptionOr404(id, () => paged(sends.map(delivery), query)),
  ],
  ["GET", /^\/admin\/users$/, () => [200, { items: [ADMIN_USER], page: 1, pageSize: 20, total: 1 }]],
  ["GET", /^\/admin\/users\/(\d+)$/, () => [200, ADMIN_USER]],
  ["POST", /^\/admin\/users\/(\d+)\/suspend$/, (_, [id]) => [200, { userId: Number(id), accountStatus: "suspended" }]],
  ["POST", /^\/admin\/users\/(\d+)\/activate$/, (_, [id]) => [200, { userId: Number(id), accountStatus: "active" }]],
  ["GET", /^\/admin\/audit-logs$/, () => [200, { items: [AUDIT_LOG], page: 1, pageSize: 20, total: 1 }]],
];

const DELAY_MS = 400;

export async function mockFetch(path: string, init: RequestInit): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));

  const method = init.method ?? "GET";
  const [pathname, search = ""] = path.split("?");
  const body = typeof init.body === "string" ? JSON.parse(init.body) : {};

  for (const [routeMethod, pattern, handler] of routes) {
    const match = pathname.match(pattern);
    if (routeMethod === method && match) {
      const [status, data] = handler(body, match.slice(1), new URLSearchParams(search));
      return new Response(data === undefined ? null : JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(
    JSON.stringify({ error: { code: "ROUTE_NOT_FOUND", message: `No mock for ${method} ${pathname}.` } }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}
