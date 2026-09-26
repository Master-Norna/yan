import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("对话并发编辑：标题、置顶和同一消息的不同字段都保留", () => {
  const { mergeConversation } = load(["mergeConversation"]);
  const base = {
    id: "one",
    title: "原题",
    pinned: false,
    unread: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [{ id: "m1", content: "原文", note: "旧注" }],
    forks: [],
    threads: []
  };
  const ours = structuredClone(base);
  ours.title = "本机新题";
  ours.messages[0].content = "本机正文";
  const theirs = structuredClone(base);
  theirs.pinned = true;
  theirs.messages[0].note = "别处新注";
  const merged = mergeConversation(ours, theirs, base);
  assert.equal(merged.title, "本机新题");
  assert.equal(merged.pinned, true);
  assert.deepEqual(merged.messages, [{ id: "m1", content: "本机正文", note: "别处新注" }]);
});

test("旧版暂存没有共同起点时，目录字段优先且本机新增消息仍保留", () => {
  const { mergeConversation } = load(["mergeConversation"]);
  const ours = {
    id: "old",
    title: "本机旧题",
    unread: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [
      { id: "m1", content: "本机旧文" },
      { id: "m2", content: "本机新增" }
    ],
    forks: [],
    threads: []
  };
  const theirs = {
    ...ours,
    title: "目录新题",
    updatedAt: "2026-01-02T00:00:00.000Z",
    messages: [{ id: "m1", content: "目录新文" }]
  };
  const merged = mergeConversation(ours, theirs);
  assert.equal(merged.title, "目录新题");
  assert.deepEqual(
    merged.messages.map(item => item.content),
    ["目录新文", "本机新增"]
  );
});

test("作答中保留消息引用，也接收另一处独立修改的置顶", () => {
  const { mergeConversation, requestJobs } = load(["mergeConversation", "requestJobs"]);
  const base = {
    id: "busy",
    title: "原题",
    pinned: false,
    messages: [{ id: "m1", content: "正在写" }],
    forks: [],
    threads: []
  };
  const ours = structuredClone(base);
  const message = ours.messages[0];
  ours.title = "本机标题";
  const theirs = { ...structuredClone(base), pinned: true };
  requestJobs.set("busy", {});
  const merged = mergeConversation(ours, theirs, base);
  assert.equal(merged, ours);
  assert.equal(merged.messages[0], message);
  assert.equal(merged.title, "本机标题");
  assert.equal(merged.pinned, true);
});

test("MCP 配置变更后，旧请求的迟到响应不能覆盖新配置", async () => {
  const f = load([
    "mcp",
    "mcpReady",
    "setMcpEnv: (configs, call) => { apiBase = 'http://localhost'; store.settings.mcpServers = configs; bridge = call; renderMcpStatus = () => {}; }"
  ]);
  const waits = [];
  const call = () => new Promise(resolve => waits.push(resolve));
  f.setMcpEnv({ A: { command: "a" } }, call);
  const first = f.mcpReady();
  f.setMcpEnv({ B: { command: "b" } }, call);
  const second = f.mcpReady();
  waits[1]({ servers: { B: { ok: true, tools: [] } } });
  await second;
  waits[0]({ servers: { A: { ok: true, tools: [] } } });
  await first;
  assert.deepEqual(Object.keys(f.mcp.servers), ["B"]);
  assert.match(f.mcp.key, /"B"/);
});

test("MCP 服务全停用时，旧请求的迟到响应也不能恢复工具", async () => {
  const f = load([
    "mcp",
    "mcpReady",
    "setMcpEnv: (configs, call) => { apiBase = 'http://localhost'; store.settings.mcpServers = configs; bridge = call; renderMcpStatus = () => {}; }"
  ]);
  let finish;
  f.setMcpEnv({ A: { command: "a" } }, () => new Promise(resolve => (finish = resolve)));
  const first = f.mcpReady();
  f.setMcpEnv({}, () => {
    throw Error("没有启用服务时不应请求桥接");
  });
  await f.mcpReady();
  finish({ servers: { A: { ok: true, tools: [] } } });
  await first;
  assert.deepEqual(f.mcp.servers, {});
});

test("MCP 服务失败后到期重试，同一配置不永久缓存失败", async () => {
  const f = load([
    "mcp",
    "mcpReady",
    "setMcpEnv: (configs, call) => { apiBase = 'http://localhost'; store.settings.mcpServers = configs; bridge = call; renderMcpStatus = () => {}; }"
  ]);
  let calls = 0;
  f.setMcpEnv({ A: { command: "a" } }, async () => {
    calls++;
    return { servers: { A: { ok: calls > 1, tools: [] } } };
  });
  await f.mcpReady();
  assert.equal(f.mcp.servers.A.ok, false);
  await f.mcpReady();
  assert.equal(calls, 1);
  f.mcp.retryAt = Date.now() - 1;
  await f.mcpReady();
  assert.equal(calls, 2);
  assert.equal(f.mcp.servers.A.ok, true);
});

test("外部服务迟迟不响应时，发送消息只等短窗口", async () => {
  const f = load([
    "mcpForTurn",
    "setMcpEnv: (configs, call) => { apiBase = 'http://localhost'; store.settings.mcpServers = configs; bridge = call; renderMcpStatus = () => {}; }",
    "setTimer: (timer, warn) => { setTimeout = timer; clearTimeout = () => {}; toast = warn; }"
  ]);
  let finish;
  const waits = [];
  f.setMcpEnv({ slow: { command: "wait" } }, () => new Promise(resolve => (finish = resolve)));
  f.setTimer(
    (callback, ms) => {
      waits.push(ms);
      queueMicrotask(callback);
      return 1;
    },
    message => waits.push(message)
  );
  await f.mcpForTurn();
  assert.equal(waits[0], 10000);
  assert.match(waits[1], /仍在连接/);
  finish({ servers: { slow: { ok: true, tools: [] } } });
});
