import type { ApiErrorBody } from '@cfe/shared-types';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

/** API origin: the app's own origin in production, http://localhost:4000 locally (inlined at build; checked in next.config). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL!;

let refreshing: Promise<boolean> | null = null;

/** Rotates the session using the refresh cookie (scoped to the API's /api/v1/auth path). */
export async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * API client. Session cookies live on the API host (in production the app's own origin) and are
 * sent with credentials. On 401 it rotates the session once; if that fails the user is sent to /login.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, init, true);
    if (typeof window !== 'undefined') window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body?.details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const fetcher = <T,>(path: string) => api<T>(path);

export function upload<T>(path: string, form: FormData) {
  return api<T>(path, { method: 'POST', body: form });
}

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  const str = s.toString();
  return str ? `?${str}` : '';
}
