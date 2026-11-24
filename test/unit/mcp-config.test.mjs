// mcp_config：模型手里那份 MCP 配置——看（密钥遮着）、按名字改（只报要改的键，env / headers 按键合并、null 即删）、
// 删、写坏了不动原配置、落盘没成照实说。
// 遮着的密钥原样送回来即沿用原值（见 17-settings/50-mcp.js 的 mcpUnmask）：看完照着改，不会把密钥弄丢
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup(initial) {
  const f = load([
    "store",
    "mcp",
    "TOOLS",
    `setup: initial => {
      store.settings.mcpServers = structuredClone(initial);
      mcp.servers = {};
      mcp.lazy = [];
      let saved = 0, flush = true;
      saveStore = () => { saved += 1; };
      flushConfig = async () => flush;
      renderMcpStatus = () => {};
      mcpReady = async () => {};
      return { saved: () => saved, setFlush: value => { flush = value; } };
    }`
  ]);
  const handle = f.setup(initial);
  return { f, handle };
}

const ctx = {
  conversation: { id: "c1", commandPolicy: "auto", messages: [] },
  assistant: { id: "a1" },
  signal: new AbortController().signal
};

async function run(f, args = {}) {
  const step = { id: "s1", name: "mcp_config", arguments: JSON.stringify(args) };
  return f.TOOLS.get("mcp_config").run(step, args, ctx);
}

test("看：列服务与状态，密钥遮着", async () => {
  const { f } = setup({ gh: { url: "https://api.example/mcp", headers: { Authorization: "Bearer sk-live" } } });
  const out = await run(f, {});
  assert.equal(out.ok, true);
  assert.match(out.content, /【gh】远端 · 未连/);
  assert.match(out.content, /已隐藏/);
  assert.ok(!out.content.includes("sk-live"), "密钥不露出来");
});

test("看：一个服务都没有时给出写法", async () => {
  const { f } = setup({});
  const out = await run(f, {});
  assert.match(out.content, /尚未接入任何服务/);
  assert.match(out.content, /mcpServers|command/);
});

test("改：只报要改的键，其余照旧；遮蔽的密钥沿用原值", async () => {
  const { f, handle } = setup({
    gh: { url: "https://api.example/mcp", headers: { Authorization: "Bearer sk-live" }, timeout: 60 }
  });
  const out = await run(f, { servers: { gh: { timeout: 120, headers: { Authorization: "******（已隐藏）" } } } });
  assert.equal(out.ok, true);
  const config = f.store.settings.mcpServers.gh;
  assert.equal(config.url, "https://api.example/mcp", "没给的键照旧");
  assert.equal(config.timeout, 120);
  assert.equal(config.headers.Authorization, "Bearer sk-live", "遮着的占位沿用原值");
  assert.equal(handle.saved(), 1);
});

test("env 按键合并，值给 null 即删", async () => {
  const { f } = setup({ box: { command: "node", args: ["server.js"], env: { A: "1", B: "2" } } });
  await run(f, { servers: { box: { env: { B: null, C: "3" } } } });
  assert.deepEqual(f.store.settings.mcpServers.box.env, { A: "1", C: "3" });
  assert.equal(f.store.settings.mcpServers.box.command, "node");
});

test("删：remove 去掉服务；不认识的照实说", async () => {
  const { f } = setup({ a: { url: "https://a" }, b: { url: "https://b" } });
  const out = await run(f, { remove: ["a", "nope"] });
  assert.deepEqual(Object.keys(f.store.settings.mcpServers), ["b"]);
  assert.match(out.content, /没有名为「nope」的服务/);
});

test("写坏了不动原配置：没有 command / url 的报错回去", async () => {
  const { f } = setup({ a: { url: "https://a" } });
  const out = await run(f, { servers: { bad: { timeout: 5 } } });
  assert.equal(out.ok, false);
  assert.match(out.content, /要有 command/);
  assert.deepEqual(Object.keys(f.store.settings.mcpServers), ["a"]);
});

test("落盘没成照实说：别把本页已改当成已经存住", async () => {
  const { f, handle } = setup({ a: { url: "https://a" } });
  handle.setFlush(false);
  const out = await run(f, { servers: { a: { timeout: 9 } } });
  assert.match(out.content, /还没写进存储目录/);
});

test("要看原文时只给模型看，行迹里仍遮着", async () => {
  const { f } = setup({ gh: { url: "https://x", headers: { Authorization: "Bearer sk-live" } } });
  const step = { id: "s2", name: "mcp_config", arguments: "{}" };
  const out = await f.TOOLS.get("mcp_config").run(step, { reveal: true }, ctx);
  assert.match(out.content, /sk-live/, "模型要原文时给原文");
  assert.ok(!String(step.output).includes("sk-live"), "行迹里不留原文");
  assert.match(String(step.output), /已隐藏/);
});

test("审而后行：改 MCP 配置交审查，交给审查的参数里密钥遮着", async () => {
  const f = load(["reviewFlag"]);
  const flag = await f.reviewFlag(
    { id: "s1", name: "mcp_config" },
    { servers: { gh: { url: "https://x", headers: { Authorization: "Bearer sk-live" } } } },
    {
      conversation: { commandPolicy: "review", messages: [{ role: "user", content: "接一下这个服务" }] },
      signal: new AbortController().signal
    }
  );
  assert.equal(flag.kind, "mcp-config");
  const seen = JSON.stringify(flag.args);
  assert.match(seen, /已隐藏/);
  assert.ok(!seen.includes("sk-live"), "密钥不送去审查模型那里");
});
