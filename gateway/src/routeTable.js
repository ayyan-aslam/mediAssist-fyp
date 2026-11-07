// Every route the apps can call. Paths are relative to /api/v1.
// roles: who may call the route ("Who" in design doc Section 5). PUBLIC routes need no access token.
// Paths that end in /events are SSE streams (design doc Section 5.1.4).
export const PUBLIC = 'public';

const DOCTOR = ['doctor'];

export const ROUTES = [
  // Auth & User Service (Section 5.2)
  { method: 'POST', path: '/auth/doctor/register', service: 'auth', roles: PUBLIC },
  { method: 'POST', path: '/auth/login', service: 'auth', roles: PUBLIC },
  // The access token may have expired here, so the refresh token is the only check.
  { method: 'POST', path: '/auth/refresh', service: 'auth', roles: PUBLIC },
  { method: 'POST', path: '/auth/logout', service: 'auth', roles: ['patient', 'doctor', 'admin'] },
  { method: 'GET', path: '/users/me', service: 'auth', roles: ['patient', 'doctor', 'admin'] },
  { method: 'PATCH', path: '/users/me', service: 'auth', roles: ['patient', 'doctor'] },
  { method: 'GET', path: '/specialties', service: 'auth', roles: PUBLIC },

  // Consultation Service (Section 5.5)
  { method: 'POST', path: '/clinical-patients', service: 'consultation', roles: DOCTOR },
  { method: 'GET', path: '/clinical-patients', service: 'consultation', roles: DOCTOR },
  { method: 'GET', path: '/clinical-patients/:patientId', service: 'consultation', roles: DOCTOR },
  { method: 'PATCH', path: '/clinical-patients/:patientId', service: 'consultation', roles: DOCTOR },
  { method: 'GET', path: '/clinical-patients/:patientId/soap-notes', service: 'consultation', roles: DOCTOR },
  { method: 'GET', path: '/soap-notes', service: 'consultation', roles: DOCTOR },
  { method: 'GET', path: '/soap-notes/search', service: 'consultation', roles: DOCTOR },
  { method: 'POST', path: '/consultations', service: 'consultation', roles: DOCTOR },
  // Before /consultations/:consultationId, so "events" is not read as an ID.
  { method: 'GET', path: '/consultations/events', service: 'consultation', roles: DOCTOR },
  { method: 'POST', path: '/consultations/:consultationId/audio-parts', service: 'consultation', roles: DOCTOR },
  { method: 'POST', path: '/consultations/:consultationId/stop', service: 'consultation', roles: DOCTOR },
  { method: 'POST', path: '/consultations/:consultationId/retry', service: 'consultation', roles: DOCTOR },
  { method: 'GET', path: '/consultations/:consultationId', service: 'consultation', roles: DOCTOR },
  { method: 'GET', path: '/consultations/:consultationId/soap-note', service: 'consultation', roles: DOCTOR },
  { method: 'PATCH', path: '/consultations/:consultationId/soap-note', service: 'consultation', roles: DOCTOR },
  {
    method: 'POST',
    path: '/consultations/:consultationId/soap-note/finish-editing',
    service: 'consultation',
    roles: DOCTOR,
  },
  { method: 'GET', path: '/consultations/:consultationId/soap-note/pdf', service: 'consultation', roles: DOCTOR },
  { method: 'PUT', path: '/consultations/:consultationId/follow-up', service: 'consultation', roles: DOCTOR },
];

export function isSseRoute(route) {
  return route.path.endsWith('/events');
}
