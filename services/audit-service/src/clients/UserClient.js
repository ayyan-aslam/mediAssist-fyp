import { serviceUnavailableError } from '../errors.js';

// Calls the Auth & User Service at GET /internal/users (design doc 5.2) for the user names and roles of
// the log screen. Kept small, so tests can replace it.
export class UserClient {
  constructor({ baseUrl, timeoutMs = 5000 }) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  // Returns [{ userId, fullName, role }]. The Auth & User Service leaves out unknown IDs.
  async getUsers(userIds) {
    const url = new URL('/internal/users', this.baseUrl);
    url.searchParams.set('ids', userIds.join(','));
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw serviceUnavailableError();
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body?.items)) throw serviceUnavailableError();
    return body.items;
  }
}
