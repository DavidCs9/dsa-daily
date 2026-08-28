import assert from "node:assert/strict";
import test from "node:test";
import { dayKeyInTimeZone, evaluateReminder, type ReminderHistoryEntry } from "../src/reminder-domain.js";

const timeZone = "America/Mexico_City";

function entry(timestamp: string): ReminderHistoryEntry {
  return { finishedAt: timestamp };
}

test("uses the configured timezone for activity days", () => {
  assert.equal(dayKeyInTimeZone("2026-08-29T04:30:00.000Z", timeZone), "2026-08-28");
  assert.equal(dayKeyInTimeZone("not-a-date", timeZone), "");
});

test("sends the 3 PM reminder whenever today's practice is missing", () => {
  const now = new Date("2026-08-28T21:00:00.000Z");
  assert.deepEqual(evaluateReminder("practice", [], now, timeZone), {
    shouldSend: true,
    completedToday: false,
    currentStreak: 0,
    today: "2026-08-28",
  });
  assert.equal(evaluateReminder("practice", [entry("2026-08-28T18:00:00.000Z")], now, timeZone).shouldSend, false);
});

test("sends the 8 PM fallback only while an existing streak is at risk", () => {
  const now = new Date("2026-08-29T02:00:00.000Z");
  const active = [
    entry("2026-08-25T18:00:00.000Z"),
    entry("2026-08-26T18:00:00.000Z"),
    entry("2026-08-27T18:00:00.000Z"),
  ];
  const atRisk = evaluateReminder("streak", active, now, timeZone);
  assert.equal(atRisk.shouldSend, true);
  assert.equal(atRisk.currentStreak, 3);

  assert.equal(evaluateReminder("streak", [entry("2026-08-20T18:00:00.000Z")], now, timeZone).shouldSend, false);
  assert.equal(evaluateReminder("streak", [...active, entry("2026-08-28T22:00:00.000Z")], now, timeZone).shouldSend, false);
});
