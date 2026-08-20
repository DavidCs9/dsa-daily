import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  parseImportInput,
  parseSessionInput,
  RequestError,
  sessionKey,
} from "../src/domain.js";

test("advances in order and starts a new cycle after problem 150", () => {
  assert.deepEqual(advance(10, 2), { index: 11, cycle: 2 });
  assert.deepEqual(advance(149, 2), { index: 0, cycle: 3 });
});

test("creates sortable session keys", () => {
  assert.equal(sessionKey(1, 0), "SESSION#00000001#000");
  assert.ok(sessionKey(2, 0) > sessionKey(1, 149));
});

test("validates a session write at the API boundary", () => {
  assert.deepEqual(parseSessionInput({
    expectedIndex: 3,
    expectedCycle: 1,
    expectedVersion: 3,
    result: "hint",
    heuristic: "  Sliding window  ",
  }), {
    expectedIndex: 3,
    expectedCycle: 1,
    expectedVersion: 3,
    result: "hint",
    heuristic: "Sliding window",
  });

  assert.throws(
    () => parseSessionInput({ expectedIndex: 150, expectedCycle: 1, expectedVersion: 0, result: "solved" }),
    RequestError,
  );
});

test("normalizes imported local history", () => {
  const imported = parseImportInput({ progress: {
    index: 1,
    cycle: 1,
    history: [{
      problemIndex: 0,
      cycle: 1,
      result: "solved",
      heuristic: "Set membership",
      finishedAt: "2026-08-20T12:00:00-06:00",
    }],
  } });

  assert.equal(imported.history[0].finishedAt, "2026-08-20T18:00:00.000Z");
});
