import { toast } from "sonner";
import { env } from "@/lib/env";
import { mockFetch } from "@/lib/api/mocks";
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "@/lib/api/tokens";
import type { ApiErrorBody, RefreshResponse } from "@/lib/api/types";

// Error thrown by api() when the backend answers with the shared error shape (design doc 5.1.3).
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  // false for public routes (sign-up, login, refresh): no token and no refresh on 401.
  auth?: boolean;
  // true when the caller shows the error itself, so no toast is shown.
  silent?: boolean;
}

const NETWORK_ERROR_MESSAGE = "Cannot reach the server. Check your internet connection and try again.";
const SESSION_ENDED_MESSAGE = "Your session has ended. Please log in again.";

// The AuthContext sets this, so a failed refresh logs the user out and opens the login page.
let onSessionExpired: () => void = () => {};

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

function send(path: string, options: ApiOptions, token: string | null) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  };
  return env.useMocks ? mockFetch(path, init) : fetch(`${env.apiUrl}${path}`, init);
}

async function readError(res: Response) {
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(
    res.status,
    body?.error?.code ?? "UNKNOWN_ERROR",
    body?.error?.message ?? "Something went wrong. Please try again.",
  );
}

// One refresh call at a time. Requests that fail together all wait for the same promise.
let refreshing: Promise<boolean> | null = null;

function refreshOnce() {
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function refreshTokens() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await send("/auth/refresh", { method: "POST", body: { refreshToken } }, null);
    if (!res.ok) return false;
    setTokens((await res.json()) as RefreshResponse);
    return true;
  } catch {
    return false;
  }
}

// Asks for new tokens with the saved refresh token. Used by the AuthContext on page load.
export function restoreSession() {
  return refreshOnce();
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const useAuth = options.auth ?? true;

  try {
    const token = useAuth ? getAccessToken() : null;
    let res = await send(path, options, token);

    if (res.status === 401 && useAuth) {
      // Another request may have refreshed the token while this one was running.
      const current = getAccessToken();
      const refreshed = (current !== null && current !== token) || (await refreshOnce());
      if (!refreshed) {
        clearTokens();
        toast.error(SESSION_ENDED_MESSAGE, { id: "session-ended" });
        onSessionExpired();
        throw new ApiError(401, "SESSION_ENDED", SESSION_ENDED_MESSAGE);
      }
      res = await send(path, options, getAccessToken());
    }

    if (!res.ok) throw await readError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    const error =
      err instanceof ApiError ? err : new ApiError(0, "NETWORK_ERROR", NETWORK_ERROR_MESSAGE);
    if (!options.silent && error.code !== "SESSION_ENDED") toast.error(error.message);
    throw error;
  }
}
