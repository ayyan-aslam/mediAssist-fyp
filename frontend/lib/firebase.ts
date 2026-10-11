import { FirebaseError, getApps, initializeApp } from "firebase/app";
import {
  applyActionCode,
  confirmPasswordReset,
  getAuth,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  verifyPasswordResetCode,
} from "firebase/auth";
import { env } from "@/lib/env";
import { PASSWORD_HINT } from "@/lib/password";

// Firebase client SDK: login, email verification and password reset (design doc 5.1, 7.3, 7.4).
// In mock mode these calls do nothing, so the screens work without Firebase.

function getFirebaseAuth() {
  const app = getApps()[0] ?? initializeApp(env.firebase);
  return getAuth(app);
}

// Firebase restores its saved session after the page loads, so wait for it before reading the user.
async function currentUser() {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  return auth.currentUser;
}

// Where Firebase's own page sends the user after the link, when the custom action URL
// (/auth/action, see README) is not set in the Firebase console.
function continueUrl(path: string) {
  return { url: `${window.location.origin}${path}` };
}

// Signs in and returns the Firebase ID token for POST /auth/login.
// In mock mode the token carries the email, so the mocks can answer per user.
export async function firebaseSignIn(email: string, password: string) {
  if (env.useMocks) return `mock:${email}`;
  const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  return credential.user.getIdToken();
}

// Sends the verification email to the signed-in Firebase user.
// Returns false when no one is signed in (the user must log in again to get a new email).
export async function firebaseSendVerificationEmail() {
  if (env.useMocks) return true;
  const user = await currentUser();
  if (!user) return false;
  await sendEmailVerification(user, continueUrl("/login?verified=1"));
  return true;
}

// After sign-up: sign in with Firebase and send the verification email in the background,
// so the "check your email" screen opens at once. That screen waits for the result.
let pendingVerificationEmail: Promise<boolean> | null = null;

export function startVerificationEmail(email: string, password: string) {
  pendingVerificationEmail = (async () => {
    await firebaseSignIn(email, password);
    return firebaseSendVerificationEmail();
  })().catch(() => false);
}

// true when the email was sent (or no send was started on this page load), false when it failed.
export function verificationEmailResult() {
  return pendingVerificationEmail ?? Promise.resolve(true);
}

// When the signed-in Firebase user has verified the email: a fresh ID token for POST /auth/login.
// The token is refreshed, because the old one still says the email is not verified. Otherwise null.
export async function firebaseVerifiedIdToken() {
  if (env.useMocks) return null;
  const user = await currentUser();
  if (!user) return null;
  await user.reload();
  if (!user.emailVerified) return null;
  return user.getIdToken(true);
}

export async function firebaseSendPasswordReset(email: string) {
  if (env.useMocks) return;
  await sendPasswordResetEmail(getFirebaseAuth(), email, continueUrl("/login"));
}

// The links in the Firebase emails open /auth/action with ?mode=...&oobCode=...
export async function firebaseApplyEmailVerification(oobCode: string) {
  if (env.useMocks) return;
  await applyActionCode(getFirebaseAuth(), oobCode);
}

// Checks a password reset link and returns the email of the account.
export async function firebaseCheckPasswordResetCode(oobCode: string) {
  if (env.useMocks) return "sara@example.com";
  return verifyPasswordResetCode(getFirebaseAuth(), oobCode);
}

export async function firebaseConfirmPasswordReset(oobCode: string, newPassword: string) {
  if (env.useMocks) return;
  await confirmPasswordReset(getFirebaseAuth(), oobCode, newPassword);
}

export async function firebaseSignOut() {
  if (env.useMocks) return;
  await signOut(getFirebaseAuth()).catch(() => {});
}

// The email of the signed-in Firebase user, if any (used by the "check your email" screen).
export async function firebaseCurrentEmail() {
  if (env.useMocks) return null;
  return (await currentUser())?.email ?? null;
}

// Simple messages for Firebase errors (design doc 2.2: say what went wrong and what to do next).
const FIREBASE_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "The email or password is not correct. Please try again.",
  "auth/wrong-password": "The email or password is not correct. Please try again.",
  "auth/user-not-found": "The email or password is not correct. Please try again.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/user-disabled": "Your account is suspended. Please contact support.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "Cannot reach the server. Check your internet connection and try again.",
  "auth/expired-action-code": "This link has expired. Please ask for a new one.",
  "auth/invalid-action-code": "This link is not valid or was already used. Please ask for a new one.",
  "auth/weak-password": PASSWORD_HINT,
  // Also returned at login for an old password made before the policy was set.
  "auth/password-does-not-meet-requirements":
    "Your password does not meet the new password rules. Please set a new one with “Forgot password?”.",
};

export function firebaseErrorMessage(err: unknown) {
  if (err instanceof FirebaseError && FIREBASE_MESSAGES[err.code]) return FIREBASE_MESSAGES[err.code];
  return "Something went wrong. Please try again.";
}

export function isFirebaseError(err: unknown): err is FirebaseError {
  return err instanceof FirebaseError;
}
