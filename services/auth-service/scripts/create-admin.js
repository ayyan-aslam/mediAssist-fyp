// Creates the admin account from ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (design doc FR-14: no admin sign-up).
// It makes the Firebase user (email already verified) and the USERS row with role admin.
// Safe to run again: an existing admin gets the name and password from .env.
// Run: npm run create-admin -w services/auth-service
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@mediassist/common';
import { z } from 'zod';
import { FirebaseClient } from '../src/clients/FirebaseClient.js';
import { createPrismaClient } from '../src/db/prisma.js';
import { UserRepository } from '../src/repositories/UserRepository.js';
import { passwordSchema } from '../src/validators/RequestValidator.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const config = loadConfig(
  z.object({
    AUTH_DATABASE_URL: z.url(),
    FIREBASE_PROJECT_ID: z.string().min(1),
    FIREBASE_SERVICE_ACCOUNT_PATH: z
      .string()
      .min(1)
      .transform((value) => path.resolve(repoRoot, value)),
    ADMIN_NAME: z.string().trim().min(1).max(100),
    ADMIN_EMAIL: z.string().trim().toLowerCase().max(150).pipe(z.email()),
    ADMIN_PASSWORD: passwordSchema,
  }),
);

const prisma = createPrismaClient(config.AUTH_DATABASE_URL);
const userRepository = new UserRepository(prisma);
const firebaseClient = new FirebaseClient({
  projectId: config.FIREBASE_PROJECT_ID,
  serviceAccountPath: config.FIREBASE_SERVICE_ACCOUNT_PATH,
});
const { ADMIN_NAME: fullName, ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = config;

try {
  const existing = await userRepository.findByEmail(email);
  // Never turn a patient or doctor account into an admin.
  if (existing && existing.role !== 'admin') {
    throw new Error(`${email} already belongs to a ${existing.role} account. Use another ADMIN_EMAIL.`);
  }

  const foundUid = await firebaseClient.findUidByEmail(email);
  if (existing && foundUid && foundUid !== existing.firebaseUid) {
    throw new Error(`The Firebase user of ${email} does not match the USERS row. Check both by hand.`);
  }
  const firebaseUid = await firebaseClient.saveAdminUser(foundUid ?? existing?.firebaseUid, {
    email,
    password,
    displayName: fullName,
  });

  if (existing) {
    await userRepository.updateFullName(existing.userId, fullName);
    console.log(`The admin ${email} already exists (user ${existing.userId}). Name and password updated.`);
  } else {
    const userId = await userRepository.createAdmin({ firebaseUid, fullName, email });
    console.log(`Admin ${email} created (user ${userId}).`);
  }
} catch (err) {
  console.error(`Could not create the admin: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
// The Firebase Admin SDK keeps connections open, so the script ends here.
process.exit();
