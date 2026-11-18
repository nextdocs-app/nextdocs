'use strict';

const { sleep, warn } = require('../../lib/proc');

const USER_AGENT = 'nextdocs-seed/1.0';
const MAX_ATTEMPTS = 6;

class ApiError extends Error {
  constructor(status, message, body, url) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

function describeBody(body) {
  if (body == null) return '';
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function jitter(ms) {
  return ms + Math.floor(Math.random() * Math.max(1, Math.round(ms * 0.4)));
}

function retryAfterMs(response) {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(250, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(250, date - Date.now()) : null;
}

function cookiesFrom(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  return values;
}

function readCookie(setCookies, name) {
  for (const cookie of setCookies) {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie);
    if (match) return match[1];
  }
  return null;
}

/**
 * One authenticated seed caller.
 *
 * The seed logs in only a small actor pool because auth is rate-limited per IP. Access
 * tokens live 15 minutes while a realistic seed can outlast that, so the session keeps
 * the refresh cookie and rotates proactively instead of re-authenticating (which would
 * spend the auth bucket).
 */
class Session {
  constructor(client, user, token, refreshCookie) {
    this.client = client;
    this.user = user;
    this.token = token;
    this.refreshCookie = refreshCookie;
    this.tokenIssuedAt = Date.now();
    // Spread a large actor pool's refreshes over a couple of minutes: login and refresh
    // share one per-IP bucket, so twenty sessions crossing the threshold together would
    // spend it in a single burst.
    this.refreshAfterMs = 10 * 60 * 1000 + Math.floor(Math.random() * 120_000);
  }

  /**
   * Rotate the access token, falling back to a fresh login when the cookie is gone.
   *
   * This call runs before `Client.request`'s attempt loop, so it owns its recovery: a
   * transport error or a 429/5xx would otherwise abort a seed that every other request
   * would have retried. A non-transient response, or a 200 that carries no token, falls
   * through to login; a lost rotation response degrades the same way.
   */
  async refresh() {
    if (this.refreshCookie) {
      for (let attempt = 0; ; attempt += 1) {
        let response;
        try {
          response = await this.client.fetchRaw('/api/v1/auth/refresh', {
            method: 'POST',
            headers: { Cookie: `rt=${this.refreshCookie}` },
          });
        } catch (err) {
          if (attempt >= MAX_ATTEMPTS - 1) {
            throw new ApiError(0, `Refresh failed: ${err.message}`, null, '/api/v1/auth/refresh');
          }
          await sleep(jitter(500 * 2 ** attempt));
          continue;
        }

        if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
          const wait = retryAfterMs(response) || jitter(1000 * (attempt + 1));
          if (this.client.verbose) {
            warn(`${response.status} on POST /api/v1/auth/refresh; retrying in ${wait}ms`);
          }
          await sleep(wait);
          continue;
        }

        if (response.ok) {
          const payload = await response.json().catch(() => null);
          const token = payload?.data?.accessToken;
          // Without a usable token the old one keeps its original expiry: installing a
          // fresh timestamp here would hide an expired token from ensureFreshToken().
          if (token) {
            const cookie = readCookie(cookiesFrom(response), 'rt');
            if (cookie) this.refreshCookie = cookie;
            this.token = token;
            this.tokenIssuedAt = Date.now();
            return;
          }
        }
        break;
      }
    }

    // A rotated/expired cookie cannot be repaired; one extra login is better than
    // failing a long seed halfway through. Adopt the session login returned: keeping
    // this object's old token made the retry 401 again even though the login succeeded.
    const session = await this.client.login(this.user.email, this.client.password);
    this.token = session.token;
    this.refreshCookie = session.refreshCookie;
    this.tokenIssuedAt = session.tokenIssuedAt;
  }

  async ensureFreshToken() {
    if (Date.now() - this.tokenIssuedAt > this.refreshAfterMs) {
      await this.refresh();
    }
  }

  async request(method, path, options = {}) {
    return this.client.request(method, path, { ...options, token: this.token, session: this });
  }
}

class Client {
  constructor({ apiBaseUrl, realtimeBaseUrl, password, verbose = false }) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
    this.realtimeBaseUrl = realtimeBaseUrl.replace(/\/$/, '');
    this.password = password;
    this.verbose = verbose;
  }

  async fetchRaw(path, { method = 'GET', body, headers = {}, absolute = false } = {}) {
    const url = absolute ? path : `${this.apiBaseUrl}${path}`;
    return fetch(url, {
      method,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  }

  /**
   * Logs in one seed actor.
   *
   * Login shares the per-IP auth bucket with every refresh, so a burst of actors can hit
   * 429 even though the request itself is valid. Retrying here — as {@link request} does
   * for the API calls that follow — keeps the first phase of a large seed from failing
   * outright.
   */
  async login(email, password) {
    const path = '/api/v1/auth/login';
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await this.fetchRaw(path, { method: 'POST', body: { email, password } });
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS - 1) {
          throw new ApiError(0, `Login failed for ${email}: ${err.message}`, null, path);
        }
        await sleep(jitter(500 * 2 ** attempt));
        continue;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_ATTEMPTS - 1) {
        const wait = retryAfterMs(response) || jitter(1000 * (attempt + 1));
        if (this.verbose) warn(`${response.status} on POST ${path}; retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success !== true) {
        throw new ApiError(
          response.status,
          `Login failed for ${email}: ${describeBody(payload)}`,
          payload,
          path
        );
      }
      const cookie = readCookie(cookiesFrom(response), 'rt');
      return new Session(this, payload.data.user, payload.data.accessToken, cookie);
    }
  }

  /**
   * Retries the failures a seed actually sees: auth throttling (429), a transient
   * Yhub read (503), and network hiccups. A validation error is never retried — the
   * fixture is wrong and waiting will not fix it.
   *
   * `withStatus` returns `{ status, data }` instead of `data`, for callers that assert
   * on the response code rather than the body.
   */
  async request(method, path, options = {}) {
    const {
      session,
      body,
      headers = {},
      absolute = false,
      attempts = MAX_ATTEMPTS,
      withStatus = false,
    } = options;
    // `let`: a 401 below replaces this with the token the refresh returned.
    let { token } = options;
    let refreshed = false;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (session) {
        await session.ensureFreshToken();
        // The proactive refresh can rotate the token; send the one it installed, not the
        // value captured before the await.
        token = session.token;
      }
      let response;
      try {
        response = await this.fetchRaw(path, {
          method,
          body,
          absolute,
          headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
      } catch (err) {
        if (method !== 'GET' || attempt === attempts - 1) {
          throw new ApiError(0, `${method} ${path} failed: ${err.message}`, null, path);
        }
        await sleep(jitter(500 * 2 ** attempt));
        continue;
      }

      if (response.status === 429) {
        const wait = retryAfterMs(response) || jitter(1000 * (attempt + 1));
        if (this.verbose) warn(`429 on ${method} ${path}; retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }

      // Retrying a 401 on the final attempt only replaces a usable status with the
      // generic "exhausted retries" error, which then reports a 401 as a 429. Let the
      // last attempt fall through to the error handling below.
      if (response.status === 401 && session && !refreshed && attempt < attempts - 1) {
        refreshed = true;
        await session.refresh();
        token = session.token;
        continue;
      }

      if (response.status >= 500) {
        if (method !== 'GET' || attempt === attempts - 1) {
          const payload = await response.json().catch(() => null);
          throw new ApiError(
            response.status,
            `${method} ${path} → ${response.status}`,
            payload,
            path
          );
        }
        await sleep(jitter(500 * 2 ** attempt));
        continue;
      }

      if (response.status === 204) {
        return withStatus ? { status: response.status, data: null } : null;
      }

      const payload = await response.json().catch(() => null);
      if (!response.ok || (payload && payload.success === false)) {
        const detail = payload?.error || payload?.message || describeBody(payload);
        throw new ApiError(
          response.status,
          `${method} ${path} → ${response.status}: ${detail}`,
          payload,
          path
        );
      }
      const data = payload?.data ?? null;
      return withStatus ? { status: response.status, data } : data;
    }

    // Only reachable through throttling: a 401 or a 5xx on the last attempt reports its
    // own status from inside the loop.
    throw new ApiError(429, `${method} ${path} exhausted retries`, null, path);
  }

  get(path, options) {
    return this.request('GET', path, options);
  }

  post(path, body, options = {}) {
    return this.request('POST', path, { ...options, body });
  }

  patch(path, body, options = {}) {
    return this.request('PATCH', path, { ...options, body });
  }

  delete(path, options = {}) {
    return this.request('DELETE', path, options);
  }

  /** Realtime's anchor endpoint lives on the Yhub wrapper, not the API. */
  async anchor(documentId, threadId, selection, token, { attempts = 5 } = {}) {
    const path = `${this.realtimeBaseUrl}/api/anchor/v1/nextdocs/${documentId}`;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ threadId, selection }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response.json().catch(() => null);
      const payload = await response.json().catch(() => null);
      // Retry only while another attempt remains: waiting and then reporting 429 for a
      // final 503 would hide realtime being unavailable behind a throttle error.
      if ((response.status === 429 || response.status >= 500) && attempt < attempts - 1) {
        const wait = retryAfterMs(response) || jitter(1000 * (attempt + 1));
        await sleep(wait);
        continue;
      }
      throw new ApiError(
        response.status,
        `Anchor failed for thread ${threadId}: ${describeBody(payload)}`,
        payload,
        path
      );
    }
    // Only reachable with attempts <= 0; a real final response keeps its own status.
    throw new ApiError(0, `Anchor for thread ${threadId} exhausted retries`, null, path);
  }
}

module.exports = { ApiError, Client, Session, describeBody };
