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

test("内置游目按随包 Playwright 自己的标注认只读，外部服务仍只认人名", () => {
  const f = load(["mcpReadOnly", "store"]);
  f.store.settings.mcpServers = {};
  f.store.settings.stage = { enabled: true };
  // 游目的 type 标注（readOnly / assertion）由随包的 Playwright 给出：browser_find 这类纯读工具不该逐次请示
  assert.equal(f.mcpReadOnly({ name: "browser_find", annotations: { readOnlyHint: true } }, "游目"), true);
  assert.equal(f.mcpReadOnly({ name: "browser_snapshot", annotations: { readOnlyHint: true } }, "游目"), true);
  // browser_evaluate / run_code 之类在 Playwright 那边就是 action，仍然请示
  assert.equal(f.mcpReadOnly({ name: "browser_evaluate", annotations: { readOnlyHint: false } }, "游目"), false);
  assert.equal(f.mcpReadOnly({ name: "browser_evaluate" }, "游目"), false);
  // 别处接的同名服务不在例外之列
  f.store.settings.mcpServers = { 游目2: { url: "http://127.0.0.1:1/mcp" } };
  assert.equal(f.mcpReadOnly({ name: "browser_find", annotations: { readOnlyHint: true } }, "游目2"), false);
});
