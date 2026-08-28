export type ReminderKind = "practice" | "streak";

export type ReminderHistoryEntry = {
  finishedAt: string;
};

export type ReminderDecision = {
  shouldSend: boolean;
  completedToday: boolean;
  currentStreak: number;
  today: string;
};

function previousDay(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1));
  return [
    date.getUTCFullYear(),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

export function dayKeyInTimeZone(value: Date | string, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function evaluateReminder(
  kind: ReminderKind,
  history: ReminderHistoryEntry[],
  now: Date,
  timeZone: string,
): ReminderDecision {
  const today = dayKeyInTimeZone(now, timeZone);
  const activeDays = new Set(
    history
      .map((entry) => dayKeyInTimeZone(entry.finishedAt, timeZone))
      .filter(Boolean),
  );
  const completedToday = activeDays.has(today);
  let cursor = completedToday ? today : previousDay(today);
  let currentStreak = 0;
  while (activeDays.has(cursor)) {
    currentStreak += 1;
    cursor = previousDay(cursor);
  }

  return {
    shouldSend: !completedToday && (kind === "practice" || currentStreak > 0),
    completedToday,
    currentStreak,
    today,
  };
}
