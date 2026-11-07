import { beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, OTHER_DOCTOR_ID, validPatient } from './helpers.js';

// Reads the PDF answer as a Buffer.
const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

const pageCount = (pdf) => pdf.toString('latin1').match(/\/Type \/Page\b/g).length;

// GET /consultations/{id}/soap-note/pdf: design doc 5.5.
describe('GET /consultations/{id}/soap-note/pdf', () => {
  let ctx;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.as().post('/clinical-patients').send(validPatient);
    await ctx.as().post('/consultations').send({ clinicalPatientId: 1 });
  });

  const download = (doctorId) =>
    ctx
      .as(doctorId)
      .get('/consultations/1/soap-note/pdf')
      .set('x-user-name', encodeURIComponent('Dr. Ayesha Khan'))
      .buffer(true)
      .parse(binary);

  it('makes the PDF on download, continues long notes on new pages, and only for the own doctor', async () => {
    // Not ready yet.
    const notReady = await download();
    expect(notReady.status).toBe(409);
    expect(JSON.parse(notReady.body.toString()).error.code).toBe('SOAP_NOT_READY');

    ctx.addSoapNote(1);
    const short = await download();
    expect(short.status).toBe(200);
    expect(short.headers['content-type']).toBe('application/pdf');
    expect(short.headers['content-disposition']).toBe('attachment; filename="soap-note-1.pdf"');
    expect(short.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(short.body)).toBe(1);

    await ctx.as().patch('/consultations/1/soap-note').send({ plan: 'Panadol 500 mg twice a day. '.repeat(350) });
    expect(pageCount((await download()).body)).toBeGreaterThan(1);

    // With the AI symptoms, history and prescription (the doctor's edited version), still a valid PDF.
    const note = ctx.soapNotes[0];
    note.aiResult = {
      symptoms: [{ symptom: 'fever' }, { symptom: 'headache' }],
      soap: { medication_history: [{ medicine_name: 'Glucophage 500', condition: 'diabetes', status: 'currently_taking' }] },
    };
    note.prescription = Array.from({ length: 40 }, (_, i) => ({
      aiIndex: null,
      name: `Medicine ${i + 1}`,
      genericName: 'Generic name',
      dose: '1 tablet',
      frequency: 'Twice a day',
      duration: '5 days',
      instructions: 'After meals with a full glass of water',
    }));
    note.plan = 'Rest.';
    const withAi = await download();
    expect(withAi.status).toBe(200);
    expect(withAi.body.subarray(0, 5).toString()).toBe('%PDF-');
    // 40 medicines do not fit on one page: the table goes on, with its header, on the next.
    expect(pageCount(withAi.body)).toBeGreaterThan(1);

    // Another doctor gets 404, not 403.
    const other = await download(OTHER_DOCTOR_ID);
    expect(other.status).toBe(404);
    expect(JSON.parse(other.body.toString()).error.code).toBe('CONSULTATION_NOT_FOUND');
  });
});
