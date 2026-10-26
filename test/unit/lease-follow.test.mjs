import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { leaseFollowIds } = load(["leaseFollowIds"]);

test("no current and no visible conversations: nothing to follow", () => {
  assert.deepEqual(leaseFollowIds(null, new Set(["x"]), [], []), []);
});

test("the current conversation is followed while busy or just released", () => {
  assert.deepEqual(leaseFollowIds("a", new Set(["a"]), [], []), ["a"]);
  assert.deepEqual(leaseFollowIds("a", new Set(), ["a"], []), ["a"]);
  assert.deepEqual(leaseFollowIds("a", new Set(), [], []), []);
});

test("conversations open in panes are followed even when not current", () => {
  assert.deepEqual(leaseFollowIds("a", new Set(["a", "b"]), [], ["b"]), ["a", "b"]);
});

test("unrelated busy conversations are not followed", () => {
  assert.deepEqual(leaseFollowIds("a", new Set(["x", "y"]), [], []), []);
  assert.deepEqual(leaseFollowIds("a", new Set(["a", "x"]), [], ["b"]), ["a"]);
});

test("current and visible entries are deduplicated", () => {
  assert.deepEqual(leaseFollowIds("a", new Set(["a", "b"]), [], ["a", "b"]), ["a", "b"]);
});

test("a released conversation is followed even when it is not visible here", () => {
  assert.deepEqual(leaseFollowIds(null, new Set(), ["z"], []), ["z"]);
  assert.deepEqual(leaseFollowIds("a", new Set(), ["z"], []), ["z"]);
});
