import { accessToken } from "./auth";

export type Result = "solved" | "hint" | "not-solved";
export type HistoryEntry = {
  problemIndex: number;
  cycle: number;
  result: Result;
  heuristic: string;
  finishedAt: string;
  durationSeconds?: number;
};
export type Progress = {
  index: number;
  cycle: number;
  version: number;
  totalSessions: number;
  updatedAt?: string;
  history: HistoryEntry[];
  isEmpty: boolean;
};
export type LocalProgress = Pick<Progress, "index" | "cycle" | "history">;

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
export const apiConfigured = Boolean(apiUrl);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "api_error",
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!apiUrl) throw new Error("VITE_API_URL is not configured.");
  const token = await accessToken(!retry);
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && retry) return request<T>(path, init, false);
  const payload = await response.json().catch(() => ({})) as {
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new ApiError(
      payload.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      payload.error?.code,
    );
  }
  return payload as T;
}

export async function loadProgress() {
  const data = await request<{ progress: Progress }>("/v1/progress");
  return data.progress;
}

export function saveSession(input: {
  expectedIndex: number;
  expectedCycle: number;
  expectedVersion: number;
  result: Result;
  heuristic: string;
  durationSeconds: number;
}) {
  return request<{ progress: Progress; entry: HistoryEntry; idempotent: boolean }>("/v1/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function undoSession(expectedVersion: number) {
  const data = await request<{ progress: Progress }>("/v1/progress/undo", {
    method: "POST",
    body: JSON.stringify({ expectedVersion }),
  });
  return data.progress;
}

export async function createHistorySession(input: {
  problemIndex: number;
  cycle: number;
  expectedVersion: number;
  result: Result;
  heuristic: string;
  finishedAt: string;
  durationSeconds?: number;
}) {
  const data = await request<{ progress: Progress; entry: HistoryEntry }>("/v1/sessions/manual", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.progress;
}

export async function updateHistorySession(
  locator: Pick<HistoryEntry, "cycle" | "problemIndex">,
  input: Pick<HistoryEntry, "result" | "heuristic" | "finishedAt" | "durationSeconds"> & { expectedVersion: number },
) {
  const data = await request<{ progress: Progress }>(`/v1/sessions/${locator.cycle}/${locator.problemIndex}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.progress;
}

export async function deleteHistorySession(
  locator: Pick<HistoryEntry, "cycle" | "problemIndex">,
  expectedVersion: number,
) {
  const data = await request<{ progress: Progress }>(`/v1/sessions/${locator.cycle}/${locator.problemIndex}`, {
    method: "DELETE",
    body: JSON.stringify({ expectedVersion }),
  });
  return data.progress;
}

export async function setNextProblem(input: { index: number; cycle: number; expectedVersion: number }) {
  const data = await request<{ progress: Progress }>("/v1/progress", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return data.progress;
}

export async function importLocalProgress(progress: LocalProgress) {
  const data = await request<{ progress: Progress; importedHistoryCount: number }>("/v1/progress/import", {
    method: "POST",
    body: JSON.stringify({ progress }),
  });
  return data.progress;
}
