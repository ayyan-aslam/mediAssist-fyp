import { beforeEach, describe, expect, it } from 'vitest';
import { EditSessionChecker } from '../src/services/EditSessionChecker.js';
import { createTestContext, DOCTOR_ID, DOCTOR_IP, OTHER_DOCTOR_ID, validPatient } from './helpers.js';

// SOAP note endpoints: design doc 5.5 and Diagram 12.
describe('SOAP notes', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.as().post('/clinical-patients').send(validPatient);
    await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
  });

  const auditEvents = () => ctx.eventPublisher.publish.mock.calls.filter(([type]) => type === 'audit.event');

  describe('GET /consultations/{id}/soap-note', () => {
    it('returns the note and starts an editing session', async () => {
      ctx.addSoapNote(1);

      const res = await ctx.as().get('/consultations/1/soap-note');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        soapNoteId: 1,
        consultationId: 1,
        subjective: 'Sore throat for 3 days.',
        objective: 'Temperature 100 F.',
        assessment: 'Viral throat infection.',
        plan: 'Panadol 500 mg twice a day.',
        updatedAt: expect.stringMatching(/Z$/),
      });
      expect(ctx.editSessionStore.sessions.get(1)).toMatchObject({
        doctorId: DOCTOR_ID,
        ipAddress: DOCTOR_IP,
        changed: false,
      });
    });

    it('returns 409 SOAP_NOT_READY while the note is not ready', async () => {
      const res = await ctx.as().get('/consultations/1/soap-note');

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'SOAP_NOT_READY', message: 'The SOAP note is not ready yet.' } });
      expect(ctx.editSessionStore.sessions.size).toBe(0);
    });

    it.each([['another doctor’s', '/consultations/1/soap-note', OTHER_DOCTOR_ID], ['a missing', '/consultations/9/soap-note'], ['a bad', '/consultations/abc/soap-note']])(
      'returns 404 CONSULTATION_NOT_FOUND for %s consultation',
      async (_, url, doctorId) => {
        ctx.addSoapNote(1);
        const res = await ctx.as(doctorId).get(url);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
        expect(ctx.editSessionStore.sessions.size).toBe(0);
      },
    );
  });

  describe('PATCH /consultations/{id}/soap-note', () => {
    it('saves only the sent parts and returns the new updatedAt', async () => {
      const note = ctx.addSoapNote(1, { updatedAt: new Date('2026-10-07T09:19:12Z') });

      const res = await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'Panadol for 5 days.' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updatedAt: note.updatedAt.toISOString() });
      expect(note.updatedAt > new Date('2026-10-07T09:19:12Z')).toBe(true);
      expect(note).toMatchObject({ plan: 'Panadol for 5 days.', subjective: 'Sore throat for 3 days.' });
      expect(ctx.editSessionStore.sessions.get(1)).toMatchObject({ changed: true, doctorId: DOCTOR_ID });
    });

    it('saves an empty part (null) as an empty string', async () => {
      const note = ctx.addSoapNote(1);
      await ctx.as().patch('/consultations/1/soap-note').send({ objective: null, assessment: '' });
      expect(note).toMatchObject({ objective: '', assessment: '' });
    });

    it('accepts four full parts of Urdu text', async () => {
      const note = ctx.addSoapNote(1);
      const part = 'سر'.repeat(5000);

      const res = await ctx.as().patch('/consultations/1/soap-note').send({
        subjective: part,
        objective: part,
        assessment: part,
        plan: part,
      });

      expect(res.status).toBe(200);
      expect(note.plan).toBe(part);
    });

    it('sends no audit event for an auto-save', async () => {
      ctx.addSoapNote(1);
      await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'A' });
      await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'B' });
      expect(auditEvents()).toHaveLength(0);
    });

    it.each([
      ['an empty body', {}],
      ['an unknown part', { history: 'x' }],
      ['a number', { plan: 5 }],
      ['a part that is too long', { plan: 'x'.repeat(10_001) }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_, body) => {
      ctx.addSoapNote(1);
      const res = await ctx.as().patch('/consultations/1/soap-note').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 409 SOAP_NOT_READY while the note is not ready', async () => {
      const res = await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'x' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SOAP_NOT_READY');
    });

    it('returns 404 for another doctor’s note and changes nothing', async () => {
      const note = ctx.addSoapNote(1);

      const res = await ctx.as(OTHER_DOCTOR_ID).patch('/consultations/1/soap-note').send({ plan: 'Hacked' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
      expect(note.plan).toBe('Panadol 500 mg twice a day.');
      expect(ctx.editSessionStore.sessions.size).toBe(0);
    });
  });

  describe('POST /consultations/{id}/soap-note/finish-editing', () => {
    it('sends one audit event soap_note_change when the note was changed, only once', async () => {
      ctx.addSoapNote(1);
      await ctx.as().get('/consultations/1/soap-note');
      await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'A' });
      await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'B' });

      const first = await ctx.as().post('/consultations/1/soap-note/finish-editing');
      const second = await ctx.as().post('/consultations/1/soap-note/finish-editing');

      expect(first.status).toBe(200);
      expect(first.body).toEqual({ changed: true });
      expect(second.body).toEqual({ changed: false });
      expect(auditEvents()).toEqual([
        [
          'audit.event',
          {
            userId: DOCTOR_ID,
            action: 'soap_note_change',
            details: 'SOAP note of consultation 1 edited',
            ipAddress: DOCTOR_IP,
            occurredAt: expect.stringMatching(/Z$/),
          },
        ],
      ]);
    });

    it('sends no audit event when nothing was changed', async () => {
      ctx.addSoapNote(1);
      await ctx.as().get('/consultations/1/soap-note');

      const res = await ctx.as().post('/consultations/1/soap-note/finish-editing');

      expect(res.body).toEqual({ changed: false });
      expect(auditEvents()).toHaveLength(0);
      expect(ctx.editSessionStore.sessions.size).toBe(0);
    });

    it('returns 404 for another doctor’s consultation and keeps the session', async () => {
      ctx.addSoapNote(1);
      await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'A' });

      const res = await ctx.as(OTHER_DOCTOR_ID).post('/consultations/1/soap-note/finish-editing');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
      expect(ctx.editSessionStore.sessions.get(1).changed).toBe(true);
      expect(auditEvents()).toHaveLength(0);
    });

    it('sends the audit event only once when finish-editing and the edit session check both run', async () => {
      const checker = new EditSessionChecker({
        editSessionStore: ctx.editSessionStore,
        eventPublisher: ctx.eventPublisher,
        logger: ctx.logger,
      });
      ctx.addSoapNote(1);
      await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'A' });

      await Promise.all([ctx.as().post('/consultations/1/soap-note/finish-editing'), checker.check(0)]);
      await checker.check(0);

      expect(auditEvents()).toHaveLength(1);
    });

    it('keeps the session when the audit event cannot be sent, so it is sent later', async () => {
      ctx.addSoapNote(1);
      await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'A' });
      ctx.eventPublisher.publish.mockRejectedValueOnce(new Error('RabbitMQ is not connected.'));

      const res = await ctx.as().post('/consultations/1/soap-note/finish-editing');

      expect(res.body).toEqual({ changed: true });
      expect(ctx.editSessionStore.sessions.get(1).changed).toBe(true);
    });
  });

  describe('GET /clinical-patients/{id}/soap-notes', () => {
    beforeEach(async () => {
      // Consultation 1 has a note, 2 failed, 3 has a note. Newest first: 3, 2, 1.
      await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
      await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
      ctx.consultations.forEach((c, i) => (c.startedAt = new Date(Date.UTC(2026, 9, 7 + i, 9))));
      ctx.addSoapNote(1, { assessment: 'First visit.' });
      Object.assign(ctx.consultations[1], { status: 'failed', failureReason: 'AI_TIMEOUT' });
      ctx.addSoapNote(3, { assessment: 'Third visit.' });
    });

    it('lists the patient’s notes newest first as a paged list', async () => {
      const res = await ctx.as().get('/clinical-patients/1/soap-notes');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          { consultationId: 3, date: '2026-10-09', status: 'completed', assessment: 'Third visit.' },
          { consultationId: 2, date: '2026-10-08', status: 'failed', assessment: null },
          { consultationId: 1, date: '2026-10-07', status: 'completed', assessment: 'First visit.' },
        ],
        page: 1,
        pageSize: 20,
        total: 3,
      });
    });

    it('returns the asked page', async () => {
      const res = await ctx.as().get('/clinical-patients/1/soap-notes?page=2&pageSize=2');

      expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
      expect(res.body.items.map((i) => i.consultationId)).toEqual([1]);
    });

    it.each(['page=0', 'pageSize=101', 'page=abc'])('returns 400 VALIDATION_ERROR for %s', async (query) => {
      const res = await ctx.as().get(`/clinical-patients/1/soap-notes?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 PATIENT_NOT_FOUND for another doctor’s patient', async () => {
      const res = await ctx.as(OTHER_DOCTOR_ID).get('/clinical-patients/1/soap-notes');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PATIENT_NOT_FOUND');
    });
  });

  describe('GET /soap-notes', () => {
    beforeEach(async () => {
      await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
      await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
      await ctx.as(OTHER_DOCTOR_ID).post('/clinical-patients').send(validPatient);
      await ctx.as(OTHER_DOCTOR_ID).post('/consultations').send({ clinicalPatientId: 2 });
      ctx.consultations.forEach((c, i) => (c.startedAt = new Date(Date.UTC(2026, 9, 7 + i, 9))));
      // Consultation 2 has no note yet: not listed.
      [1, 3, 4].forEach((id) => ctx.addSoapNote(id));
    });

    it('lists the doctor’s own notes newest first, only consultations with a note', async () => {
      const res = await ctx.as().get('/soap-notes?pageSize=5');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          {
            consultationId: 3,
            date: '2026-10-09',
            patient: { clinicalPatientId: 1, fullName: 'Bilal Hussain', phone: '03214567890' },
          },
          {
            consultationId: 1,
            date: '2026-10-07',
            patient: { clinicalPatientId: 1, fullName: 'Bilal Hussain', phone: '03214567890' },
          },
        ],
        page: 1,
        pageSize: 5,
        total: 2,
      });
    });

    it('returns 400 VALIDATION_ERROR for a wrong page size', async () => {
      const res = await ctx.as().get('/soap-notes?pageSize=0');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /soap-notes/search', () => {
    beforeEach(async () => {
      await ctx.as().post('/clinical-patients').send({ ...validPatient, fullName: 'Ayesha Khan', phone: '03001112233' });
      await ctx.as().post('/consultations').send({ clinicalPatientId: 2 });
      // The other doctor's patient with the same name: never in this doctor's results.
      await ctx.as(OTHER_DOCTOR_ID).post('/clinical-patients').send(validPatient);
      await ctx.as(OTHER_DOCTOR_ID).post('/consultations').send({ clinicalPatientId: 3 });
      ctx.consultations.forEach((c, i) => (c.startedAt = new Date(Date.UTC(2026, 9, 7 + i, 9))));
      [1, 2, 3].forEach((id) => ctx.addSoapNote(id));
    });

    it('finds notes by part of the name, only of the doctor’s own patients', async () => {
      const res = await ctx.as().get('/soap-notes/search?q=BIL');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          {
            consultationId: 1,
            date: '2026-10-07',
            patient: { clinicalPatientId: 1, fullName: 'Bilal Hussain', phone: '03214567890' },
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    });

    it('finds notes by part of the phone', async () => {
      const res = await ctx.as().get('/soap-notes/search?q=1112');
      expect(res.body.items.map((i) => i.consultationId)).toEqual([2]);
    });

    it('returns an empty list when nothing matches', async () => {
      const res = await ctx.as(OTHER_DOCTOR_ID).get('/soap-notes/search?q=ayesha');
      expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });

    it.each(['', 'q=b', 'q=%20b%20', 'q=bil&pageSize=0'])('returns 400 VALIDATION_ERROR for "%s"', async (query) => {
      const res = await ctx.as().get(`/soap-notes/search?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
