export class ApiClientError extends Error {
  status: number;
  details?: Record<string, string>;

  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const TOKEN_KEY = "nobryn.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * One centralized API base URL for the whole application.
 *
 * Production (Vercel frontend + Render backend): set `VITE_API_URL` to the
 * deployed backend origin, e.g. `https://nobryn.onrender.com`. Every API call
 * is then prefixed with that base, so requests go to
 * `https://nobryn.onrender.com/api/...`.
 *
 * Local development: leave `VITE_API_URL` unset and keep using the Vite dev
 * server's `/api` proxy to the local Express backend on `API_PORT` (default
 * `4000`). In that mode the client sends relative `/api/...` paths and the
 * proxy forwards them, so no backend secret is ever exposed to the browser.
 */
function apiBase(): string {
  // `import.meta.env` is statically replaced at build time by Vite.
  const base = import.meta.env.VITE_API_URL;
  if (base && base.trim()) {
    // Strip a trailing slash so we can safely append `/api/...`.
    return base.trim().replace(/\/+$/, "");
  }
  return "";
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const url = apiBase() + path;
  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    throw new ApiClientError(
      0,
      "Network error. We couldn't reach the Nobryn service. Check your connection and try again."
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      (body as { error?: string }).error ?? "Something went wrong. Please try again.",
      (body as { details?: Record<string, string> }).details
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
};
