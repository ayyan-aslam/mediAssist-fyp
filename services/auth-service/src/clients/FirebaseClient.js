import { AppError } from '@mediassist/common';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// Wraps the Firebase Admin SDK.
export class FirebaseClient {
  constructor({ projectId, serviceAccountPath }) {
    const app = initializeApp({ credential: cert(serviceAccountPath), projectId });
    this.auth = getAuth(app);
  }

  // Returns the new Firebase UID.
  async createUser({ email, password, displayName }) {
    try {
      const user = await this.auth.createUser({ email, password, displayName });
      return user.uid;
    } catch (err) {
      // The email is in Firebase but not in UserDB, for example after a manual delete.
      if (err.code === 'auth/email-already-exists') {
        throw new AppError(409, 'EMAIL_TAKEN', 'This email is already registered.');
      }
      throw err;
    }
  }

  async deleteUser(uid) {
    await this.auth.deleteUser(uid);
  }

  // Throws when the token is not valid or has expired.
  async verifyIdToken(idToken) {
    const decoded = await this.auth.verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email, emailVerified: decoded.email_verified === true };
  }
}
