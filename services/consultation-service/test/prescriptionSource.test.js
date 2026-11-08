import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, DOCTOR_ID, OTHER_DOCTOR_ID, validPatient } from './helpers.js';

// GET /internal/consultations/{id}/prescription-source: design doc 5.5 (for the Prescription Service).
describe('GET /internal/consultations/{consultationId}/prescription-source', () => {
  let ctx;

  const AI_RESULT = {
    soap: {
      plan: {
        prescription: [
          {
            name: 'Panadol',
            generic_name: 'Paracetamol',
            dose: '1 tablet',
            frequency: 'twice a day',
            duration: '3 days',
            info: { indication: 'Fever and pain', warnings: 'Do not take more than 8 tablets a day.' },
          },
          { name: 'Brufen', generic_name: 'Ibuprofen', dose: '1 tablet', frequency: 'three times a day', info: null },
        ],
        for_doctor_review: [{ name: 'Act-On', generic_name: 'Domperidone', info: { indication: 'Vomiting' } }],
      },
    },
  };

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.as().post('/clinical-patients').send({ ...validPatient, email: 'bilal@example.com' });
    await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
  });

  const getSource = (doctorId = DOCTOR_ID, consultationId = 1) =>
    request(ctx.app).get(`/internal/consultations/${consultationId}/prescription-source?doctorId=${doctorId}`);

  const info = (fields) => ({
    indication: null,
    sideEffects: null,
    contraindications: null,
    warnings: null,
    precautions: null,
    drugInteractions: null,
    dosageReference: null,
    howToUse: null,
    mechanism: null,
    matchedProducts: [],
    sources: [],
    urls: [],
    ...fields,
  });

  it('returns the patient, the plan as notes and the AI prescribed medicines when the doctor did not edit them', async () => {
    ctx.addSoapNote(1, { plan: 'Warm salt water gargles.', aiResult: AI_RESULT });

    const res = await getSource();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      consultationId: 1,
      doctorId: DOCTOR_ID,
      patient: { name: 'Bilal Hussain', age: 45, gender: 'male', phone: '03214567890', email: 'bilal@example.com' },
      notes: 'Warm salt water gargles.',
      medicines: [
        {
          name: 'Panadol',
          genericName: 'Paracetamol',
          dose: '1 tablet',
          frequency: 'twice a day',
          duration: '3 days',
          instructions: null,
          source: 'doctor_prescribed',
          referenceInfo: info({ indication: 'Fever and pain', warnings: 'Do not take more than 8 tablets a day.' }),
        },
        {
          name: 'Brufen',
          genericName: 'Ibuprofen',
          dose: '1 tablet',
          frequency: 'three times a day',
          duration: null,
          instructions: null,
          source: 'doctor_prescribed',
          referenceInfo: null,
        },
      ],
    });
  });

  it('returns the doctor’s edited prescription with the source of each medicine', async () => {
    ctx.addSoapNote(1, {
      aiResult: AI_RESULT,
      prescription: [
        { aiIndex: 0, reviewIndex: null, name: 'Panadol', genericName: 'Paracetamol', dose: '2 tablets', frequency: 'twice a day', duration: '5 days', instructions: 'After food' },
        { aiIndex: null, reviewIndex: 0, name: 'Act-On', genericName: 'Domperidone', dose: '1 tablet', frequency: null, duration: null, instructions: null },
        { aiIndex: null, reviewIndex: null, name: 'Strepsils', genericName: null, dose: null, frequency: null, duration: null, instructions: null },
      ],
    });

    const res = await getSource();

    expect(res.status).toBe(200);
    expect(res.body.medicines).toEqual([
      {
        name: 'Panadol',
        genericName: 'Paracetamol',
        dose: '2 tablets',
        frequency: 'twice a day',
        duration: '5 days',
        instructions: 'After food',
        source: 'doctor_prescribed',
        referenceInfo: info({ indication: 'Fever and pain', warnings: 'Do not take more than 8 tablets a day.' }),
      },
      expect.objectContaining({ name: 'Act-On', source: 'ai_accepted', referenceInfo: info({ indication: 'Vomiting' }) }),
      expect.objectContaining({ name: 'Strepsils', source: 'doctor_added', referenceInfo: null }),
    ]);
    // Brufen was removed by the doctor.
    expect(res.body.medicines.map((m) => m.name)).not.toContain('Brufen');
  });

  it('returns an empty list when the doctor removed every medicine', async () => {
    ctx.addSoapNote(1, { aiResult: AI_RESULT, prescription: [] });
    const res = await getSource();
    expect(res.body.medicines).toEqual([]);
  });

  it('returns an empty list when the note has no AI answer and no edits', async () => {
    ctx.addSoapNote(1);
    const res = await getSource();
    expect(res.status).toBe(200);
    expect(res.body.medicines).toEqual([]);
  });

  it('leaves out an AI medicine without a name', async () => {
    ctx.addSoapNote(1, { aiResult: { soap: { plan: { prescription: [{ dose: '1 tablet' }, { name: 'Panadol' }] } } } });
    const res = await getSource();
    expect(res.body.medicines.map((m) => m.name)).toEqual(['Panadol']);
  });

  it('returns 409 SOAP_NOT_READY when there is no note yet', async () => {
    const res = await getSource();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SOAP_NOT_READY');
  });

  it('returns 404 CONSULTATION_NOT_FOUND when the consultation belongs to another doctor', async () => {
    ctx.addSoapNote(1, { aiResult: AI_RESULT });
    const res = await getSource(OTHER_DOCTOR_ID);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
  });

  it('returns 404 CONSULTATION_NOT_FOUND for a consultation that does not exist', async () => {
    const res = await getSource(DOCTOR_ID, 99);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONSULTATION_NOT_FOUND');
  });

  it.each([
    ['no doctorId', ''],
    ['a text doctorId', '?doctorId=abc'],
    ['a negative doctorId', '?doctorId=-1'],
  ])('returns 400 VALIDATION_ERROR for %s', async (_, query) => {
    const res = await request(ctx.app).get(`/internal/consultations/1/prescription-source${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
