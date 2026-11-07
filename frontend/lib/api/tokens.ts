// The access token lives only in memory. The refresh token is kept in localStorage,
// so the user stays logged in after a page reload.

const REFRESH_TOKEN_KEY = "mediassist.refreshToken";

let accessToken: string | null = null;

export function getAccessToken() {
  return accessToken;
}

export function getRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setTokens(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  } catch {
    // Storage is blocked (private mode). The session then lasts until the page is closed.
  }
}

export function clearTokens() {
  accessToken = null;
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Nothing to remove.
  }
}

// When the access token expires, in milliseconds since 1970 (the JWT "exp" claim). null if unknown.
export function getAccessTokenExpiry() {
  if (!accessToken) return null;
  try {
    const part = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(part)) as { exp?: number };
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}
