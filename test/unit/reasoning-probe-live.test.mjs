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
