import type { ApiResponse, AuthSession, AuthTokens } from '@bday/shared';
import { API_URL } from './config';
import { loadRefreshToken, saveRefreshToken } from './storage';

/**
 * API client.
 *
 * The access token lives in memory; the refresh token in secure storage. A 401
 * triggers one shared refresh. Errors always surface as `ApiError` carrying the
 * server's machine code and a message that is safe to show (spec §51).
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  get isNetwork(): boolean {
    return this.code === 'NETWORK_ERROR';
  }
}

let accessToken: string | null = null;
let refreshing: Promise<AuthSession | null> | null = null;
let sessionListener: ((session: AuthSession | null) => void) | null = null;

export function onSessionChange(listener: (session: AuthSession | null) => void): void {
  sessionListener = listener;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export async function setTokens(tokens: AuthTokens | null): Promise<void> {
  accessToken = tokens?.accessToken ?? null;
  await saveRefreshToken(tokens?.refreshToken ?? null);
}

export async function refreshSession(): Promise<AuthSession | null> {
  refreshing ??= (async () => {
    const refreshToken = await loadRefreshToken();
    if (!refreshToken) return null;
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (response.status === 401 || response.status === 403) {
        await setTokens(null);
        sessionListener?.(null);
        return null;
      }
      const body = (await response.json()) as ApiResponse<AuthSession>;
      if (!body.success) return null;
      await setTokens(body.data.tokens);
      sessionListener?.(body.data);
      return body.data;
    } catch {
      // Offline: keep the stored token so the session resumes when back online.
      throw new ApiError(0, 'NETWORK_ERROR', 'You appear to be offline.');
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return `${API_URL}/api/v1${path}${params ? `?${params}` : ''}`;
}

async function request<T>(method: string, path: string, options: { body?: unknown; query?: Query; form?: FormData; retry?: boolean } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Can’t reach the server. Check your connection and try again.');
  }

  if (response.status === 401 && options.retry !== false) {
    const session = await refreshSession().catch(() => null);
    if (session) return request<T>(method, path, { ...options, retry: false });
  }

  if (response.status === 204) return undefined as T;

  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(response.status, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  }
  if (!body.success) throw new ApiError(response.status, body.code, body.message, body.errors);
  return body.data;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, { body }),
  upload: async (kind: 'avatar' | 'wishlist' | 'card' | 'memory' | 'voice' | 'chat', file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append('file', file as unknown as Blob);
    return request<{ url: string; key: string; contentType: string; size: number }>('POST', `/uploads/${kind}`, { form });
  },
};

/** Friendly message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

export function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError) || !error.fieldErrors) return undefined;
  return error.fieldErrors[`body.${field}`]?.[0] ?? error.fieldErrors[field]?.[0];
}

/** Client-generated idempotency key for payment-carrying requests. */
export function idempotencyKey(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
