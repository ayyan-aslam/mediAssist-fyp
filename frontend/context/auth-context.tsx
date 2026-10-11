"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api/auth";
import { ApiError, restoreSession, setSessionExpiredHandler } from "@/lib/api/client";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "@/lib/api/tokens";
import type { SessionUser } from "@/lib/api/types";
import { firebaseSignIn, firebaseSignOut, firebaseVerifiedIdToken } from "@/lib/firebase";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  user: SessionUser | null;
  status: AuthStatus;
  // Firebase sign-in, then POST /auth/login. Throws the Firebase error or the ApiError.
  login: (email: string, password: string) => Promise<SessionUser>;
  // After the email is verified: POST /auth/login with the Firebase user who signed up on this device,
  // so the user does not type the password again. Returns null when that user is not verified (or not here).
  loginAfterVerification: () => Promise<SessionUser | null>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

// The access token carries userId, role, name and email (design doc 7.4).
// After a refresh, the user is read from the new token.
function userFromAccessToken(token: string): SessionUser | null {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return { userId: claims.userId, fullName: claims.name, email: claims.email, role: claims.role };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const endSession = useCallback(() => {
    clearTokens();
    setUser(null);
    setStatus("unauthenticated");
    firebaseSignOut();
  }, []);

  // On page load: get a new access token with the saved refresh token.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = getRefreshToken() !== null && (await restoreSession());
      const token = getAccessToken();
      const restored = ok && token ? userFromAccessToken(token) : null;
      if (cancelled) return;
      if (!restored) clearTokens();
      setUser(restored);
      setStatus(restored ? "authenticated" : "unauthenticated");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A refresh failed inside the API client: log out and go to the login page.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      endSession();
      router.replace("/login");
    });
  }, [endSession, router]);

  const loginWithFirebaseToken = useCallback(async (firebaseToken: string) => {
    let res;
    try {
      res = await authApi.login(firebaseToken);
    } catch (err) {
      // Stay signed in to Firebase only when the email is not verified, so the screen can send the email again.
      if (!(err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED")) firebaseSignOut();
      throw err;
    }
    setTokens(res);
    setUser(res.user);
    setStatus("authenticated");
    return res.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => loginWithFirebaseToken(await firebaseSignIn(email, password)),
    [loginWithFirebaseToken],
  );

  const loginAfterVerification = useCallback(async () => {
    const firebaseToken = await firebaseVerifiedIdToken();
    return firebaseToken ? loginWithFirebaseToken(firebaseToken) : null;
  }, [loginWithFirebaseToken]);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) await authApi.logout(refreshToken).catch(() => {});
    endSession();
    router.replace("/login");
  }, [endSession, router]);

  const value = useMemo(
    () => ({ user, status, login, loginAfterVerification, logout }),
    [user, status, login, loginAfterVerification, logout],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
