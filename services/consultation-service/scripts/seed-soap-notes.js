// Fills ConsultationDB with SOAP notes for one doctor and times the SOAP note search (design doc 2.2, FR-12).
// The search must take under 2 seconds.
//
//   npm run seed:soap-notes -w services/consultation-service                  (doctor 900001, 10,000 notes)
//   npm run seed:soap-notes -w services/consultation-service -- --doctor-id=16 --count=10000
//
// Use the ID of a real doctor (USERS.user_id) to try the search in the app. Running it again only adds the
// notes that are missing, so the doctor has --count notes in the end.
import { parseArgs } from 'node:util';
import { createPrismaClient } from '../src/db/prisma.js';
import { SoapNoteRepository } from '../src/repositories/SoapNoteRepository.js';

const { values } = parseArgs({
  options: {
    'doctor-id': { type: 'string', default: '900001' },
    count: { type: 'string', default: '10000' },
  },
});
const doctorId = Number(values['doctor-id']);
const count = Number(values.count);
if (!Number.isInteger(doctorId) || !Number.isInteger(count) || count < 1) {
  console.error('Use --doctor-id=<number> and --count=<number>.');
  process.exit(1);
}
if (!process.env.CONSULTATION_DATABASE_URL) {
  console.error('CONSULTATION_DATABASE_URL is not set. Add it to the root .env file.');
  process.exit(1);
}

const NOTES_PER_PATIENT = 5;
const BATCH = 1000;
const FIRST_NAMES = ['Bilal', 'Ayesha', 'Usman', 'Fatima', 'Hamza', 'Zainab', 'Ali', 'Maryam', 'Ahmed', 'Hira',
  'Imran', 'Sana', 'Kashif', 'Nadia', 'Faisal', 'Amna', 'Tariq', 'Rabia', 'Saad', 'Iqra'];
const LAST_NAMES = ['Hussain', 'Khan', 'Malik', 'Butt', 'Chaudhry', 'Qureshi', 'Sheikh', 'Raza', 'Iqbal', 'Mirza',
  'Abbasi', 'Siddiqui', 'Javed', 'Akhtar', 'Anwar'];
const ASSESSMENTS = ['Viral throat infection.', 'Seasonal allergy.', 'High blood pressure, controlled.',
  'Acute gastritis.', 'Type 2 diabetes follow-up.', 'Lower back strain.'];

// The same index always gives the same patient, so a second run finds the patients it made before.
const patientAt = (i) => ({
  doctorId,
  fullName: `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(i / FIRST_NAMES.length) % LAST_NAMES.length]}`,
  phone: `0399${String(i).padStart(7, '0')}`,
  age: 18 + (i % 70),
  gender: i % 2 ? 'female' : 'male',
});

const prisma = createPrismaClient(process.env.CONSULTATION_DATABASE_URL);
const soapNoteRepository = new SoapNoteRepository(prisma);

try {
  const existing = await prisma.soapNote.count({ where: { consultation: { clinicalPatient: { doctorId } } } });
  const missing = Math.max(0, count - existing);
  console.log(`Doctor ${doctorId} has ${existing} SOAP notes. Adding ${missing}.`);

  if (missing > 0) {
    const patientCount = Math.ceil(count / NOTES_PER_PATIENT);
    await prisma.clinicalPatient.createMany({
      data: Array.from({ length: patientCount }, (_, i) => patientAt(i)),
      skipDuplicates: true,
    });
    const patients = await prisma.clinicalPatient.findMany({
      where: { doctorId, phone: { startsWith: '0399' } },
      select: { clinicalPatientId: true },
      orderBy: { clinicalPatientId: 'asc' },
    });

    for (let done = 0; done < missing; done += BATCH) {
      const size = Math.min(BATCH, missing - done);
      // Spread over the last 2 years.
      const consultations = await prisma.consultation.createManyAndReturn({
        data: Array.from({ length: size }, (_, i) => {
          const startedAt = new Date(Date.now() - Math.floor(Math.random() * 730 * 24 * 3600 * 1000));
          return {
            clinicalPatientId: patients[(done + i) % patients.length].clinicalPatientId,
            status: 'completed',
            startedAt,
            endedAt: new Date(startedAt.getTime() + 10 * 60_000),
          };
        }),
        select: { consultationId: true },
      });
      await prisma.soapNote.createMany({
        data: consultations.map(({ consultationId }, i) => ({
          consultationId,
          subjective: 'Patient has sore throat for 3 days.',
          objective: 'Temperature 100 F. Throat is red.',
          assessment: ASSESSMENTS[(done + i) % ASSESSMENTS.length],
          plan: 'Panadol 500 mg twice a day for 3 days. Warm salt water gargles.',
        })),
      });
      console.log(`  ${done + size} / ${missing}`);
    }
    // Fresh table statistics, so PostgreSQL plans the search with the new rows.
    await prisma.$executeRaw`ANALYZE clinical_patient, consultation, soap_note`;
  }

  const total = await prisma.soapNote.count({ where: { consultation: { clinicalPatient: { doctorId } } } });
  console.log(`\nDoctor ${doctorId} now has ${total} SOAP notes. Search times (first page of 20, must be under 2 s):`);
  let slowest = 0;
  for (const q of ['bil', 'Hussain', 'ayesha kh', '0399000', '12345', 'zz']) {
    const started = performance.now();
    const { total: found } = await soapNoteRepository.search(doctorId, q, { page: 1, pageSize: 20 });
    const ms = performance.now() - started;
    slowest = Math.max(slowest, ms);
    console.log(`  q="${q}": ${found} notes in ${ms.toFixed(1)} ms`);
  }
  console.log(slowest < 2000 ? `\nOK: slowest search ${slowest.toFixed(1)} ms.` : `\nTOO SLOW: ${slowest.toFixed(1)} ms.`);
  if (slowest >= 2000) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
