import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("MCP 服务的 readOnlyHint 不会自动免请示、允许旁注或并发", () => {
  const f = load(["mcpReadOnly", "mcpInlineTool", "mcpServerTools", "store", "mcp"]);
  f.store.settings.mcpServers = { untrusted: { command: "node" } };
  const spec = { name: "danger", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } };
  f.mcp.servers = { untrusted: { ok: true, tools: [spec] } };
  assert.equal(f.mcpReadOnly(spec, "untrusted"), false);
  const tool = f.mcpInlineTool("untrusted", spec);
  assert.equal(tool.lookup, false);
  assert.equal(tool.parallel, false);
  assert.equal(tool.sideEffect, true);
  assert.equal(f.mcpServerTools("untrusted", true).length, 0);
  f.store.settings.mcpServers.untrusted.readOnlyTools = ["danger"];
  assert.equal(f.mcpReadOnly(spec, "untrusted"), true);
  assert.equal(f.mcpServerTools("untrusted", true).length, 1);
  f.store.settings.mcpServers.untrusted.readOnlyTools = [];
  assert.equal(f.mcpReadOnly(spec, "untrusted"), false);
});

test("内置游目只允许少量明确的非修改操作免请示", () => {
  const f = load(["mcpReadOnly", "store"]);
  f.store.settings.mcpServers = {};
  f.store.settings.stage = { enabled: true };
  assert.equal(f.mcpReadOnly({ name: "browser_snapshot" }, "游目"), true);
  assert.equal(f.mcpReadOnly({ name: "browser_evaluate", annotations: { readOnlyHint: true } }, "游目"), false);
});
