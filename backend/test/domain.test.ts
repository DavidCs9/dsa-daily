import assert from "node:assert/strict";
import test from "node:test";
import {
  advance,
  parseDeleteSessionInput,
  parseImportInput,
  parseManualSessionInput,
  parseProgressRepairInput,
  parseSessionInput,
  parseSessionLocator,
  parseSessionUpdateInput,
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
    durationSeconds: 615,
  }), {
    expectedIndex: 3,
    expectedCycle: 1,
    expectedVersion: 3,
    result: "hint",
    heuristic: "Sliding window",
    durationSeconds: 615,
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
      durationSeconds: 600,
    }],
  } });

  assert.equal(imported.history[0].finishedAt, "2026-08-20T18:00:00.000Z");
  assert.equal(imported.history[0].durationSeconds, 600);
});

test("validates manual history CRUD inputs", () => {
  assert.deepEqual(parseSessionLocator("2", "149"), { cycle: 2, problemIndex: 149 });
  assert.deepEqual(parseManualSessionInput({
    problemIndex: 4,
    cycle: 3,
    expectedVersion: 7,
    result: "not-solved",
    heuristic: "  Revisit the invariant  ",
    finishedAt: "2026-08-20T14:00:00-06:00",
    durationSeconds: 754,
  }), {
    problemIndex: 4,
    cycle: 3,
    expectedVersion: 7,
    result: "not-solved",
    heuristic: "Revisit the invariant",
    finishedAt: "2026-08-20T20:00:00.000Z",
    durationSeconds: 754,
  });
  assert.deepEqual(parseSessionUpdateInput({
    expectedVersion: 8,
    result: "solved",
    heuristic: "Two pointers",
    finishedAt: "2026-08-20T20:00:00.000Z",
  }), {
    expectedVersion: 8,
    result: "solved",
    heuristic: "Two pointers",
    finishedAt: "2026-08-20T20:00:00.000Z",
  });
  assert.deepEqual(parseDeleteSessionInput({ expectedVersion: 9 }), { expectedVersion: 9 });
  assert.throws(
    () => parseSessionUpdateInput({
      expectedVersion: 8,
      result: "solved",
      heuristic: "",
      finishedAt: "2026-08-20T20:00:00.000Z",
      durationSeconds: 14_401,
    }),
    RequestError,
  );
});

test("validates explicit next-problem repairs", () => {
  assert.deepEqual(parseProgressRepairInput({ index: 149, cycle: 4, expectedVersion: 12 }), {
    index: 149,
    cycle: 4,
    expectedVersion: 12,
  });
  assert.throws(
    () => parseProgressRepairInput({ index: 150, cycle: 4, expectedVersion: 12 }),
    RequestError,
  );
});
