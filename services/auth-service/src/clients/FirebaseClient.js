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

  // A disabled account cannot log in by any method (design doc Diagram 11).
  async disableUser(uid) {
    await this.auth.updateUser(uid, { disabled: true });
  }

  async enableUser(uid) {
    await this.auth.updateUser(uid, { disabled: false });
  }

  // Ends the Firebase sessions on every device.
  async revokeRefreshTokens(uid) {
    await this.auth.revokeRefreshTokens(uid);
  }

  // For scripts/create-admin.js. Returns the UID, or null when no Firebase user has this email.
  async findUidByEmail(email) {
    try {
      return (await this.auth.getUserByEmail(email)).uid;
    } catch (err) {
      if (err.code === 'auth/user-not-found') return null;
      throw err;
    }
  }

  // For scripts/create-admin.js: an admin needs no verification email. Returns the UID.
  async saveAdminUser(uid, { email, password, displayName }) {
    const fields = { email, password, displayName, emailVerified: true, disabled: false };
    const user = uid ? await this.auth.updateUser(uid, fields) : await this.auth.createUser(fields);
    return user.uid;
  }

  // Throws when the token is not valid or has expired.
  async verifyIdToken(idToken) {
    const decoded = await this.auth.verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email, emailVerified: decoded.email_verified === true };
  }
}
