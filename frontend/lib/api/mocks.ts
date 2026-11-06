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

const CLINICAL_PATIENTS: Record<string, unknown>[] = [
  { clinicalPatientId: 7, fullName: "Bilal Hussain", phone: "03214567890", email: null, age: 45, gender: "male", createdAt: "2026-10-07T09:00:00Z" },
];

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
    "PATCH",
    /^\/clinical-patients\/(\d+)$/,
    (body, [id]) => {
      const patient = CLINICAL_PATIENTS.find((p) => p.clinicalPatientId === Number(id));
      if (!patient) return error(404, "PATIENT_NOT_FOUND", "This patient was not found.");
      Object.assign(patient, body);
      return [200, patient];
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
        followUpDate: null,
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
  ["GET", /^\/admin\/users$/, () => [200, { items: [ADMIN_USER], page: 1, pageSize: 20, total: 1 }]],
  ["GET", /^\/admin\/users\/(\d+)$/, () => [200, ADMIN_USER]],
  ["POST", /^\/admin\/users\/(\d+)\/suspend$/, (_, [id]) => [200, { userId: Number(id), accountStatus: "suspended" }]],
  ["POST", /^\/admin\/users\/(\d+)\/activate$/, (_, [id]) => [200, { userId: Number(id), accountStatus: "active" }]],
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
