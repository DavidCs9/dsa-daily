export const PROBLEM_COUNT = 150;
export const MAX_HEURISTIC_LENGTH = 160;
export const IMPORTED_HISTORY_LIMIT = 90;

export type SessionResult = "solved" | "hint" | "not-solved";

export type HistoryEntry = {
  problemIndex: number;
  cycle: number;
  result: SessionResult;
  heuristic: string;
  finishedAt: string;
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

export class RequestError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = "invalid_request",
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RequestError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function result(value: unknown): SessionResult {
  if (value === "solved" || value === "hint" || value === "not-solved") return value;
  throw new RequestError("result must be solved, hint, or not-solved.");
}

function heuristic(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > MAX_HEURISTIC_LENGTH) {
    throw new RequestError(`heuristic must be at most ${MAX_HEURISTIC_LENGTH} characters.`);
  }
  return value.trim();
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new RequestError("finishedAt must be an ISO timestamp.");
  }
  return new Date(value).toISOString();
}

export function advance(index: number, cycle: number) {
  return index === PROBLEM_COUNT - 1
    ? { index: 0, cycle: cycle + 1 }
    : { index: index + 1, cycle };
}

export function sessionKey(cycle: number, problemIndex: number) {
  return `SESSION#${cycle.toString().padStart(8, "0")}#${problemIndex.toString().padStart(3, "0")}`;
}

export function parseSessionInput(value: unknown) {
  if (!isRecord(value)) throw new RequestError("A JSON object is required.");
  return {
    expectedIndex: integer(value.expectedIndex, "expectedIndex", 0, PROBLEM_COUNT - 1),
    expectedCycle: integer(value.expectedCycle, "expectedCycle", 1, Number.MAX_SAFE_INTEGER),
    expectedVersion: integer(value.expectedVersion, "expectedVersion", 0, Number.MAX_SAFE_INTEGER),
    result: result(value.result),
    heuristic: heuristic(value.heuristic),
  };
}

export function parseUndoInput(value: unknown) {
  if (!isRecord(value)) throw new RequestError("A JSON object is required.");
  return {
    expectedVersion: integer(value.expectedVersion, "expectedVersion", 1, Number.MAX_SAFE_INTEGER),
  };
}

export function parseImportInput(value: unknown) {
  if (!isRecord(value) || !isRecord(value.progress)) {
    throw new RequestError("progress must be a JSON object.");
  }
  const progress = value.progress;
  const rawHistory = Array.isArray(progress.history) ? progress.history : [];
  if (rawHistory.length > 10_000) throw new RequestError("history is too large to import.");

  const history = rawHistory.map((entry, position): HistoryEntry => {
    if (!isRecord(entry)) throw new RequestError(`history[${position}] must be an object.`);
    return {
      problemIndex: integer(entry.problemIndex, `history[${position}].problemIndex`, 0, PROBLEM_COUNT - 1),
      cycle: integer(entry.cycle, `history[${position}].cycle`, 1, Number.MAX_SAFE_INTEGER),
      result: result(entry.result),
      heuristic: heuristic(entry.heuristic),
      finishedAt: timestamp(entry.finishedAt),
    };
  });

  return {
    index: integer(progress.index, "progress.index", 0, PROBLEM_COUNT - 1),
    cycle: integer(progress.cycle, "progress.cycle", 1, Number.MAX_SAFE_INTEGER),
    history,
  };
}
