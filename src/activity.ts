import type { HistoryEntry } from "./api";

export type ActivitySummary = {
  byDay: Map<string, number>;
  currentStreak: number;
  bestStreak: number;
  activeDays: number;
};

export type CalendarDay = {
  date: Date;
  key: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  sessions: number;
};

export function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousDay(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return dayKey(new Date(year, month - 1, day - 1));
}

function ordinal(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function summarizeActivity(history: HistoryEntry[], now = new Date()): ActivitySummary {
  const byDay = new Map<string, number>();
  for (const entry of history) {
    const date = new Date(entry.finishedAt);
    if (!Number.isFinite(date.getTime())) continue;
    const key = dayKey(date);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  const today = dayKey(now);
  const yesterday = previousDay(today);
  let cursor = byDay.has(today) ? today : byDay.has(yesterday) ? yesterday : "";
  let currentStreak = 0;
  while (cursor && byDay.has(cursor)) {
    currentStreak += 1;
    cursor = previousDay(cursor);
  }

  const active = [...byDay.keys()].sort();
  let bestStreak = 0;
  let running = 0;
  let priorOrdinal: number | undefined;
  for (const key of active) {
    const currentOrdinal = ordinal(key);
    running = priorOrdinal !== undefined && currentOrdinal === priorOrdinal + 1 ? running + 1 : 1;
    bestStreak = Math.max(bestStreak, running);
    priorOrdinal = currentOrdinal;
  }

  return { byDay, currentStreak, bestStreak, activeDays: active.length };
}

export function calendarDays(month: Date, byDay: Map<string, number>, now = new Date()): CalendarDay[] {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, monthIndex, 1 - mondayOffset);
  const today = dayKey(now);

  return Array.from({ length: 42 }, (_, position) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + position);
    const key = dayKey(date);
    return {
      date,
      key,
      dayNumber: date.getDate(),
      inMonth: date.getMonth() === monthIndex,
      isToday: key === today,
      sessions: byDay.get(key) ?? 0,
    };
  });
}
