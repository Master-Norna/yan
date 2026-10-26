import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { allocateSplitWidths } = load(["allocateSplitWidths"]);
const sum = widths => widths.reduce((a, b) => a + b, 0);

test("preferred widths that fit are kept", () => {
  assert.deepEqual(allocateSplitWidths([420, 360, 360, 360], 1574), [420, 360, 360, 360]);
});

test("four panes at the 960 budget land exactly on the 240 minimum", () => {
  const widths = allocateSplitWidths([360, 360, 360, 360], 960);
  assert.deepEqual(widths, [240, 240, 240, 240]);
  assert.equal(sum(widths), 960);
});

test("a tight budget scales down without going below 240", () => {
  const widths = allocateSplitWidths([420, 360, 360, 360], 1294);
  assert.equal(sum(widths), 1294);
  assert.ok(widths.every(width => width >= 240));
  assert.ok(widths.every(width => width <= 420));
});

test("a budget below four minimums leaves a scrollable rail", () => {
  const widths = allocateSplitWidths([360, 360, 360, 360], 754);
  assert.deepEqual(widths, [240, 240, 240, 240]);
  assert.ok(sum(widths) > 754);
});

test("an empty list allocates nothing", () => {
  assert.deepEqual(allocateSplitWidths([], 960), []);
});
