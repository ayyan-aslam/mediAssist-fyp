// Seeds the SPECIALTY table with common specialities in Pakistan.
// Safe to run again: names that already exist are skipped.
import { createPrismaClient } from '../src/db/prisma.js';

const SPECIALTIES = [
  'General Physician',
  'Gynecologist',
  'Cardiologist',
  'Dermatologist',
  'Pediatrician',
  'ENT Specialist',
  'Eye Specialist',
  'Dentist',
  'Orthopedic Surgeon',
  'General Surgeon',
  'Neurologist',
  'Neurosurgeon',
  'Psychiatrist',
  'Psychologist',
  'Gastroenterologist',
  'Hepatologist',
  'Pulmonologist',
  'Nephrologist',
  'Urologist',
  'Endocrinologist',
  'Diabetologist',
  'Rheumatologist',
  'Oncologist',
  'Hematologist',
  'Infectious Disease Specialist',
  'Plastic Surgeon',
  'Physiotherapist',
  'Nutritionist',
];

const prisma = createPrismaClient(process.env.AUTH_DATABASE_URL);

try {
  const result = await prisma.specialty.createMany({
    data: SPECIALTIES.map((name) => ({ name })),
    skipDuplicates: true,
  });
  console.log(`Specialities added: ${result.count}. Already there: ${SPECIALTIES.length - result.count}.`);
} finally {
  await prisma.$disconnect();
}
