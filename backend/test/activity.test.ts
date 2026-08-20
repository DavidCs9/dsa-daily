import assert from "node:assert/strict";
import test from "node:test";
import { calendarDays, dayKey, summarizeActivity } from "../../src/activity.js";
import type { HistoryEntry } from "../../src/api.js";

function entry(year: number, month: number, day: number, problemIndex: number): HistoryEntry {
  return {
    problemIndex,
    cycle: 1,
    result: "solved",
    heuristic: "",
    finishedAt: new Date(year, month, day, 12).toISOString(),
  };
}

test("calculates current and best daily streaks from unique active days", () => {
  const history = [
    entry(2026, 7, 10, 0),
    entry(2026, 7, 11, 1),
    entry(2026, 7, 12, 2),
    entry(2026, 7, 18, 3),
    entry(2026, 7, 19, 4),
    entry(2026, 7, 20, 5),
    entry(2026, 7, 20, 6),
  ];

  const summary = summarizeActivity(history, new Date(2026, 7, 20, 18));
  assert.equal(summary.currentStreak, 3);
  assert.equal(summary.bestStreak, 3);
  assert.equal(summary.activeDays, 6);
  assert.equal(summary.byDay.get(dayKey(new Date(2026, 7, 20))), 2);
});

test("keeps a streak alive through yesterday and expires it after a missed day", () => {
  const history = [entry(2026, 7, 18, 0), entry(2026, 7, 19, 1)];
  assert.equal(summarizeActivity(history, new Date(2026, 7, 20, 8)).currentStreak, 2);
  assert.equal(summarizeActivity(history, new Date(2026, 7, 21, 8)).currentStreak, 0);
});

test("builds a six-week Monday-first calendar with activity counts", () => {
  const summary = summarizeActivity([entry(2026, 8, 1, 0)], new Date(2026, 8, 2));
  const days = calendarDays(new Date(2026, 8, 1), summary.byDay, new Date(2026, 8, 2));

  assert.equal(days.length, 42);
  assert.equal(dayKey(days[0].date), "2026-08-31");
  assert.equal(days.find((day) => day.key === "2026-09-01")?.sessions, 1);
  assert.equal(days.find((day) => day.key === "2026-09-02")?.isToday, true);
});
