// Thin fetch wrapper for AgentLair /v1/* REST API.
// Self-contained — no Astro-specific imports.

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

let getAuthHeader: (() => string | null) | null = null;

/** Called once by AuthProvider to inject the auth getter. */
export function setAuthHeaderProvider(fn: () => string | null) {
  getAuthHeader = fn;
}

export async function apiCall<T = unknown>(
  path: string,
  opts?: RequestInit & { body?: string }
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.headers as Record<string, string>),
  };

  const authValue = getAuthHeader?.();
  if (authValue) {
    headers["Authorization"] = authValue;
  }

  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}) as T);
  return { ok: res.ok, status: res.status, data };
}
