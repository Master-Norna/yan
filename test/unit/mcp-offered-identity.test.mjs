import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("MCP 清洗名字时不依赖工具清单的次序", () => {
  const { mcpFunctionName } = load(["mcpFunctionName"]);
  assert.notEqual(mcpFunctionName("S", "read.file"), mcpFunctionName("S", "readfile"));
  assert.notEqual(mcpFunctionName("a__b", "c"), mcpFunctionName("a", "b__c"));
  assert.notEqual(mcpFunctionName("S", "." + "x".repeat(80)), mcpFunctionName("S", "x".repeat(80)));
  assert.equal(mcpFunctionName("S", "readfile"), "mcp__S__readfile");
});

test("旧答的 MCP 身份与当前登记不同，不执行", async () => {
  const f = load(["runTool", "TOOLS"]);
  const name = "mcp__S__readfile";
  let called = false;
  f.TOOLS.set(name, {
    name,
    label: "S",
    mcp: true,
    mcpIdentity: "new",
    run: () => {
      called = true;
      return { ok: true, content: "", display: "" };
    }
  });
  const outcome = await f.runTool(
    { id: "x", name, arguments: "{}" },
    {
      conversation: { id: "c" },
      assistant: {},
      signal: new AbortController().signal,
      offered: new Set([name]),
      offeredMcp: new Map([[name, "old"]])
    }
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.display, "工具已变");
  assert.equal(called, false);
});
