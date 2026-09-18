import type { ApiFailure, ApiResponse, AuthSession, AuthTokens } from '@bday/shared';

/**
 * Admin API client.
 *
 * The access token lives in memory only; the refresh token in sessionStorage,
 * so closing the tab ends the admin session. A 401 triggers exactly one refresh
 * attempt, shared across concurrent requests.
 */

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const REFRESH_KEY = 'bday.admin.refresh';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(status: number, body: Partial<ApiFailure>) {
    super(body.message ?? 'Something went wrong.');
    this.status = status;
    this.code = body.code ?? 'INTERNAL_ERROR';
    this.fieldErrors = body.errors;
  }
}

export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler;
}

export function storeTokens(tokens: AuthTokens | null): void {
  accessToken = tokens?.accessToken ?? null;
  try {
    if (tokens) sessionStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    else sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    // Storage can be unavailable (private mode); the session just won't survive reloads.
  }
}

export function hasStoredSession(): boolean {
  try {
    return Boolean(sessionStorage.getItem(REFRESH_KEY));
  } catch {
    return false;
  }
}

export async function refreshSession(): Promise<AuthSession | null> {
  let refreshToken: string | null = null;
  try {
    refreshToken = sessionStorage.getItem(REFRESH_KEY);
  } catch {
    refreshToken = null;
  }
  if (!refreshToken) return null;
  const response = await fetch(`${BASE}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    storeTokens(null);
    return null;
  }
  const body = (await response.json()) as ApiResponse<AuthSession>;
  if (!body.success) return null;
  storeTokens(body.data.tokens);
  return body.data;
}

async function refreshOnce(): Promise<boolean> {
  refreshing ??= refreshSession()
    .then((session) => session != null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: unknown; query?: Query; retry?: boolean } = {},
): Promise<T> {
  const response = await fetch(`${BASE}/api/v1${withQuery(path, options.query)}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && options.retry !== false && hasStoredSession()) {
    if (await refreshOnce()) return apiRequest<T>(method, path, { ...options, retry: false });
    onSignedOut?.();
  }

  if (response.status === 204) return undefined as T;

  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(response.status, { message: `The server returned ${response.status}.` });
  }
  if (!body.success) throw new ApiError(response.status, body);
  return body.data;
}

export const api = {
  get: <T>(path: string, query?: Query) => apiRequest<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>('PATCH', path, { body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>('DELETE', path, { body }),
};
