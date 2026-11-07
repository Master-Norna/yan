// 探档位写在该写的那一份上（src/16-api.js 的 probeReasoningLevels / learnReasoningLevels）：
// 请求途中配置同步（adoptConfig）可能已把 store.profiles 整份换掉，写进旧对象就永远不落盘——
// 白探、下次还探。先例：spendTokens（同一个文件里早写着「记在此刻表里的那一份上」）。
// 改动前本文件红：写的是旧对象，store.profiles 里那份没有 level。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup() {
  return load([
    "probeReasoningLevels",
    "REASONING_DEFAULT_LEVELS",
    "current: () => store",
    `setup: (initial) => {
      store = initial;
      requestChat = async () => {
        // 探着的时候配置同步：整份换掉（同 id 的新对象）
        store = { ...store, profiles: store.profiles.map(item => ({ ...item })) };
        return { ok: true };
      };
      saveStoreSoon = () => {};
    }`
  ]);
}

test("探档位写在此刻表里的那一份上（配置同步换掉 store.profiles 之后仍落盘）", async () => {
  const f = setup();
  const profile = { id: "p1", name: "假", model: "m", baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", usedTokens: 0 };
  f.setup({ settings: {}, profiles: [{ ...profile }], conversations: [], drafts: {} });
  const learned = await f.probeReasoningLevels(profile);
  assert.deepEqual(learned, f.REASONING_DEFAULT_LEVELS);
  assert.equal(f.current().profiles[0].reasoningLevels, f.REASONING_DEFAULT_LEVELS.join(", "), "写进了此刻表里的那一份");
});

function setupSwap(swap) {
  return load([
    "probeReasoningLevels",
    "learnReasoningLevels",
    "nearestReasoning",
    "reasoningProbeKey",
    "current: () => store",
    `setup: (initial, swap) => {
      store = initial;
      requestChat = async () => {
        store = swap(store);
        return { ok: true };
      };
      saveStoreSoon = () => {};
    }`
  ]);
}
const stale = () => ({ id: "p1", name: "假", model: "m", baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", usedTokens: 0 });

test("学到的档位两份都记：表里那份落盘，手里这份给这一答的重发用", () => {
  const f = setupSwap();
  const profile = stale();
  f.setup({ settings: {}, profiles: [stale()], conversations: [], drafts: {} }, s => s);
  assert.equal(f.learnReasoningLevels(profile, "Supported values are: 'low', 'medium', and 'xhigh'", "high"), true);
  assert.equal(f.current().profiles[0].reasoningLevels, "low, medium, xhigh", "表里那份落盘");
  assert.notEqual(f.nearestReasoning(profile, "high"), "high", "重发不再送被拒的那档");
});

test("探着的时候配置同步带来了手填的档位：探的结果作废，手填的不被盖", async () => {
  const f = setupSwap();
  const profile = stale();
  f.setup({ settings: {}, profiles: [stale()], conversations: [], drafts: {} }, s => ({
    ...s,
    profiles: s.profiles.map(item => ({ ...item, reasoningLevels: "low", reasoningProbed: `manual|${f.reasoningProbeKey(item)}` }))
  }));
  assert.equal(await f.probeReasoningLevels(profile), null);
  assert.equal(f.current().profiles[0].reasoningLevels, "low");
  assert.match(f.current().profiles[0].reasoningProbed, /^manual\|/);
});
