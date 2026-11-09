import { describe, expect, it } from 'vitest';
import { PrescriptionPdf } from '../src/services/PrescriptionPdf.js';

const pageCount = (pdf) => pdf.toString('latin1').match(/\/Type \/Page\b/g).length;

const item = (position, changes = {}) => ({
  position,
  medicineName: 'Panadol',
  genericName: 'Paracetamol',
  dose: '1 tablet',
  frequency: 'twice a day',
  duration: '3 days',
  instructions: 'After meals',
  source: 'doctor_prescribed',
  ...changes,
});

const input = (items, notes = 'Warm salt water gargles.') => ({
  doctorName: 'Dr. Sara Ahmed',
  patient: { name: 'Ali Raza', age: 34, gender: 'male' },
  date: new Date('2026-10-07T09:25:00Z'),
  items,
  notes,
});

describe('PrescriptionPdf', () => {
  it('builds a one-page PDF, with AI-accepted and empty fields', async () => {
    const pdf = await new PrescriptionPdf().build(
      input([item(1), item(2, { source: 'ai_accepted', medicineName: 'Act-On', genericName: 'Domperidone' }), item(3, { dose: null, frequency: null, duration: null, instructions: null, genericName: null })]),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
  });

  it('continues a long medicines list and long notes on new pages', async () => {
    const items = Array.from({ length: 30 }, (_, i) => item(i + 1, { instructions: 'Take with water. '.repeat(8) }));
    const pdf = await new PrescriptionPdf().build(input(items, 'Rest and drink fluids. '.repeat(300)));
    expect(pageCount(pdf)).toBeGreaterThan(2);
  });

  it('builds the PDF without notes', async () => {
    const pdf = await new PrescriptionPdf().build(input([item(1)], null));
    expect(pageCount(pdf)).toBe(1);
  });
});
