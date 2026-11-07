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
        aiInsights: null,
      });
      expect(ctx.editSessionStore.sessions.get(1)).toMatchObject({
        doctorId: DOCTOR_ID,
        ipAddress: DOCTOR_IP,
        changed: false,
      });
    });

    it('returns the AI Pipeline answer as aiInsights, in camelCase', async () => {
      ctx.addSoapNote(1, {
        aiResult: {
          symptoms: [{ symptom: 'fever', mention: 'bukhar', source_text: 'Patient: 3 din se bukhar hai.', matched_labels: ['Fever'] }],
          soap: {
            plan: {
              notes: 'Rest.',
              prescription: [
                {
                  name: 'Paracetamol 500 mg',
                  generic_name: 'Paracetamol',
                  strength: '500 mg',
                  frequency: 'every 6 hours',
                  match_status: 'matched',
                  linked_symptoms: ['fever'],
                  info: { side_effects: 'Rare.', sources: ['dawaai'], urls: ['https://dawaai.pk/x'], matched_products: ['Panadol'] },
                },
              ],
              for_doctor_review: [{ name: 'Act-On', generic_name: 'Domperidone', suggestion_reason: 'For vomiting.', info: null }],
            },
            medication_history: [{ medicine_name: 'Glucophage', condition: 'diabetes', status: 'currently_taking' }],
          },
          warnings: [{ section: 'Symptom matching', node: 'node1', type: 'failure', message: 'Please review.', detail: 'timeout' }],
        },
      });

      const res = await ctx.as().get('/consultations/1/soap-note');

      expect(res.status).toBe(200);
      const { aiInsights } = res.body;
      expect(aiInsights.symptoms).toEqual([
        { aiIndex: 0, symptom: 'fever', mention: 'bukhar', sourceText: 'Patient: 3 din se bukhar hai.', matchedLabels: ['Fever'] },
      ]);
      expect(aiInsights).toMatchObject({ symptomsEdited: false, prescriptionEdited: false });
      expect(aiInsights.prescription[0]).toMatchObject({
        name: 'Paracetamol 500 mg',
        genericName: 'Paracetamol',
        frequency: 'every 6 hours',
        dose: null,
        linkedSymptoms: ['fever'],
        info: { sideEffects: 'Rare.', contraindications: null, sources: ['dawaai'], matchedProducts: ['Panadol'] },
      });
      expect(aiInsights.forDoctorReview).toEqual([
        expect.objectContaining({ name: 'Act-On', suggestionReason: 'For vomiting.', info: null, linkedSymptoms: [] }),
      ]);
      expect(aiInsights.medicationHistory).toEqual([
        { medicineName: 'Glucophage', condition: 'diabetes', duration: null, frequency: null, status: 'currently_taking', sourceText: null },
      ]);
      expect(aiInsights.warnings).toEqual([{ section: 'Symptom matching', message: 'Please review.', detail: 'timeout' }]);
    });

    it('keeps the dataset info of an accepted AI suggestion in the edited prescription', async () => {
      ctx.addSoapNote(1, {
        aiResult: {
          soap: {
            plan: {
              prescription: [],
              for_doctor_review: [
                { name: 'Act-On', generic_name: 'Domperidone', match_status: 'rag_only', linked_symptoms: ['vomiting'], suggestion_reason: 'For vomiting.', info: { side_effects: 'Dry mouth.' } },
              ],
            },
          },
        },
        prescription: [{ aiIndex: null, reviewIndex: 0, name: 'Act-On', genericName: 'Domperidone', dose: '10 mg', frequency: 'Three times a day', duration: null, instructions: null }],
      });

      const { aiInsights } = (await ctx.as().get('/consultations/1/soap-note')).body;

      expect(aiInsights.forDoctorReview[0]).toMatchObject({ aiIndex: null, reviewIndex: 0, name: 'Act-On' });
      expect(aiInsights.prescription).toEqual([
        expect.objectContaining({
          aiIndex: null,
          reviewIndex: 0,
          name: 'Act-On',
          dose: '10 mg',
          frequency: 'Three times a day',
          matchStatus: 'rag_only',
          linkedSymptoms: ['vomiting'],
          suggestionReason: null,
          info: expect.objectContaining({ sideEffects: 'Dry mouth.' }),
        }),
      ]);
    });

    it('gives empty lists for a partial AI answer', async () => {
      ctx.addSoapNote(1, { aiResult: { soap: { plan: null }, symptoms: 'not a list' } });

      const res = await ctx.as().get('/consultations/1/soap-note');

      expect(res.body.aiInsights).toEqual({
        symptoms: [],
        symptomsEdited: false,
        prescription: [],
        prescriptionEdited: false,
        forDoctorReview: [],
        medicationHistory: [],
        warnings: [],
      });
    });

    it('shows the doctor’s edited prescription and symptoms instead of the AI ones', async () => {
      const info = { side_effects: 'Rare.' };
      ctx.addSoapNote(1, {
        aiResult: {
          symptoms: [
            { symptom: 'fever', source_text: 'Patient: bukhar hai.', matched_labels: ['Fever'] },
            { symptom: 'cough', source_text: 'Patient: khansi hai.', matched_labels: ['Cough'] },
          ],
          soap: { plan: { prescription: [{ name: 'Panadol 500 mg', strength: '500 mg', linked_symptoms: ['fever'], match_status: 'matched', info }] } },
        },
        prescription: [
          { aiIndex: 0, name: 'panadol 500 mg', genericName: null, dose: '1 tablet', frequency: 'twice a day', duration: '3 days', instructions: null },
          { aiIndex: null, name: 'ORS', genericName: null, dose: '1 sachet', frequency: null, duration: null, instructions: 'In 1 litre of water' },
        ],
        symptoms: [{ aiIndex: 0, symptom: 'Fever' }, { aiIndex: 1, symptom: 'dry cough' }, { aiIndex: null, symptom: 'weakness' }],
      });

      const { aiInsights } = (await ctx.as().get('/consultations/1/soap-note')).body;

      expect(aiInsights.prescriptionEdited).toBe(true);
      // Same medicine (case does not matter): the dataset info and linked symptoms stay.
      expect(aiInsights.prescription[0]).toMatchObject({
        aiIndex: 0,
        dose: '1 tablet',
        frequency: 'twice a day',
        matchStatus: 'matched',
        linkedSymptoms: ['fever'],
        info: { sideEffects: 'Rare.' },
      });
      expect(aiInsights.prescription[1]).toMatchObject({ aiIndex: null, reviewIndex: null, name: 'ORS', matchStatus: 'doctor_added', info: null });
      expect(aiInsights.symptomsEdited).toBe(true);
      expect(aiInsights.symptoms.map((s) => [s.symptom, s.sourceText, s.matchedLabels])).toEqual([
        ['Fever', 'Patient: bukhar hai.', ['Fever']],
        ['dry cough', null, []],
        ['weakness', null, []],
      ]);
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

    it('saves the edited prescription and symptoms, and null goes back to the AI version', async () => {
      const note = ctx.addSoapNote(1);

      const res = await ctx
        .as()
        .patch('/consultations/1/soap-note')
        .send({
          prescription: [{ aiIndex: 0, name: ' Panadol 500 mg ', dose: '1 tablet', frequency: '', duration: '3 days' }],
          symptoms: [{ symptom: 'fever' }],
        });

      expect(res.status).toBe(200);
      expect(note.prescription).toEqual([
        {
          aiIndex: 0,
          reviewIndex: null,
          name: 'Panadol 500 mg',
          genericName: null,
          dose: '1 tablet',
          frequency: null,
          duration: '3 days',
          instructions: null,
        },
      ]);
      expect(note.symptoms).toEqual([{ aiIndex: null, symptom: 'fever' }]);
      expect(ctx.editSessionStore.sessions.get(1)).toMatchObject({ changed: true });

      await ctx.as().patch('/consultations/1/soap-note').send({ prescription: null });
      expect(note.prescription).toBeNull();
      expect(note.symptoms).toEqual([{ aiIndex: null, symptom: 'fever' }]);
    });

    it.each([
      ['a medicine without a name', { prescription: [{ name: ' ' }] }],
      ['an unknown medicine field', { prescription: [{ name: 'Panadol', price: 10 }] }],
      ['an empty symptom', { symptoms: [{ symptom: '' }] }],
      ['too many symptoms', { symptoms: Array.from({ length: 51 }, () => ({ symptom: 'x' })) }],
    ])('returns 400 VALIDATION_ERROR for %s', async (_, body) => {
      ctx.addSoapNote(1);
      const res = await ctx.as().patch('/consultations/1/soap-note').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
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
