import type { ApiErrorBody } from "@pinely/shared/types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** `"api"` reads the live backend; `"sample"` is an explicit demo mode. */
export const DATA_SOURCE = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "api";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Checks whether the API endpoint is reachable from the current client context.
 * Guards against HTTPS -> HTTP Mixed Content blocking when deployed on Vercel/production.
 */
export function isApiReachable(): boolean {
  if (typeof window === "undefined") return true;
  if (DATA_SOURCE !== "api") return false;
  if (
    window.location.protocol === "https:" &&
    API_BASE_URL.startsWith("http://") &&
    !API_BASE_URL.includes("localhost") &&
    !API_BASE_URL.includes("127.0.0.1")
  ) {
    return false;
  }
  return true;
}

// --- Session token (Bearer fallback next to the HttpOnly cookie) ---

const SESSION_TOKEN_KEY = "pinely_session_token";

export function getStoredSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      localStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(SESSION_TOKEN_KEY) || null
    );
  } catch {
    // Storage can be blocked (private mode, disabled site data).
    return null;
  }
}

export function setStoredSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // Ignore: storage is unavailable in this browser context.
  }
  try {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    // Ignore: storage is unavailable in this browser context.
  }
}

export function clearStoredSessionToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Ignore: storage is unavailable in this browser context.
  }
  try {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Ignore: storage is unavailable in this browser context.
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getStoredSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// --- Errors ---

/**
 * Error raised for every failed API call. `status` is the HTTP status, or `0` when no response
 * arrived (`network_error`, `timeout`). `code` is the backend `error` field when it sent one.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  /** The backend answered, but its indexer is down: show "unavailable", never zeros. */
  get isIndexerUnavailable(): boolean {
    return this.status === 503 && this.code === "indexer_unavailable";
  }

  /** The session is missing or expired: the user must sign in again. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** React Query retry policy: retry only transient failures, never a definitive 4xx. */
export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isApiError(error)) return true;
  if (error.status === 0) return true; // network error or timeout
  return error.status >= 500 && !error.isIndexerUnavailable;
}

// --- Request helper ---

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON-serialised request body. */
  body?: unknown;
  /** Send the operator session (Bearer token + cookie). Reads are public, so it defaults to true only for writes. */
  auth?: boolean;
  timeoutMs?: number;
}

async function readErrorBody(res: Response): Promise<Partial<ApiErrorBody>> {
  try {
    const json: unknown = await res.json();
    return typeof json === "object" && json !== null ? (json as Partial<ApiErrorBody>) : {};
  } catch {
    return {};
  }
}

/**
 * Single entry point for every backend call: one base URL, one timeout, one error type. A non-2xx
 * answer, a dropped connection or a timeout always rejects with `ApiError`; callers never receive a
 * silent fallback value.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const auth = options.auth ?? method !== "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) Object.assign(headers, getAuthHeaders());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(0, "The request timed out. Try again.", "timeout");
    }
    throw new ApiError(0, "Cannot reach the PINELY API. Check your connection.", "network_error");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await readErrorBody(res);
    const message = body.message ?? body.error ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, body.error);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(res.status, "The API returned an unreadable response.", "invalid_response");
  }
}
