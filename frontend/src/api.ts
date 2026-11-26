import type {
  AuthUser,
  Diagnostic,
  ManagedUser,
  Scenario,
  ScheduleResult,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const AUTH_TOKEN_KEY = "acto-auth-token";
let authToken = window.localStorage.getItem(AUTH_TOKEN_KEY) ?? "";

export class ApiError extends Error {
  diagnostics: Diagnostic[];

  constructor(message: string, diagnostics: Diagnostic[] = []) {
    super(message);
    this.name = "ApiError";
    this.diagnostics = diagnostics;
  }
}

export function setAuthToken(token: string | null) {
  authToken = token ?? "";
  if (authToken) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, authToken);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<T>;
}

export async function restoreSession(): Promise<AuthUser | null> {
  if (!authToken) return null;
  try {
    return await requestJson<AuthUser>("/api/auth/me");
  } catch {
    setAuthToken(null);
    return null;
  }
}

export async function login(
  username: string,
  password: string,
): Promise<AuthUser> {
  const result = await requestJson<{
    token: string;
    user: AuthUser;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setAuthToken(result.token);
  return result.user;
}

export async function logout(): Promise<void> {
  try {
    if (authToken) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: authHeaders(),
      });
    }
  } finally {
    setAuthToken(null);
  }
}

export async function heartbeat(): Promise<void> {
  await requestJson<{ ok: boolean }>("/api/auth/heartbeat", {
    method: "POST",
  });
}

export function fetchUsers(): Promise<ManagedUser[]> {
  return requestJson<ManagedUser[]>("/api/auth/users");
}

export function createUser(input: {
  username: string;
  display_name: string;
  password: string;
  role: "user" | "admin";
}): Promise<AuthUser> {
  return requestJson<AuthUser>("/api/auth/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteUser(userId: number): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/auth/users/${userId}`, {
    method: "DELETE",
  });
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const detail = body.detail;
    if (Array.isArray(detail)) {
      const diagnostics = detail.map((item: Partial<Diagnostic> & { msg?: string }) => ({
        level: item.level ?? "error",
        title: item.title ?? "请求约束无效",
        detail: item.detail ?? item.msg ?? "未提供详细原因",
        task_ids: item.task_ids ?? [],
      })) as Diagnostic[];
      return new ApiError("排程约束无法满足", diagnostics);
    }
    return new ApiError(detail || `请求失败 (${response.status})`);
  } catch {
    return new ApiError(`请求失败 (${response.status})`);
  }
}

export async function fetchDemoScenario(signal?: AbortSignal): Promise<Scenario> {
  const response = await fetch(`${API_BASE}/api/demo`, {
    signal,
    headers: authHeaders(),
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function requestSchedule(
  scenario: Scenario,
  signal?: AbortSignal,
): Promise<ScheduleResult> {
  const response = await fetch(`${API_BASE}/api/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      scenario,
      time_limit_seconds: 60,
      optimize: true,
    }),
    signal,
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

