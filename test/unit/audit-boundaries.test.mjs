// 外部体检报的几处边界：Mac 上的绝对路认得出；等的工夫里点了「止」工具不再动手；回报另起一答先认领
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("本地链接：Mac 上 / 起头的是绝对路，Windows 上不是；file:// 两边都认", () => {
  const f = load(["localLinkTarget", "setPlatform: platform => { bootstrap = { work: { platform } }; }"]);
  f.setPlatform("darwin");
  const mac = { workdir: "/Users/me/proj" };
  assert.deepEqual(f.localLinkTarget("/Users/me/proj/out/报告.md", mac), { root: "/Users/me/proj", path: "out/报告.md" });
  assert.deepEqual(f.localLinkTarget("file:///Users/me/Desktop/a.png", mac), { root: "/Users/me/Desktop", path: "a.png" });
  assert.deepEqual(f.localLinkTarget("out/a.txt", mac), { root: "/Users/me/proj", path: "out/a.txt" });
  assert.equal(f.localLinkTarget("sandbox:/mnt/data/a.txt", mac), null);
  f.setPlatform("win32");
  const win = { workdir: "D:\\proj" };
  assert.equal(f.localLinkTarget("/mnt/data/a.txt", win), null);
  assert.deepEqual(f.localLinkTarget("file:///D:/proj/a.txt", win), { root: "D:\\proj", path: "a.txt" });
  assert.deepEqual(f.localLinkTarget("E:\\别处\\b.txt", win), { root: "E:/别处", path: "b.txt" });
});

test("审查等着时点了「止」：审查回来也不再动手", async () => {
  let ran = false,
    answer;
  const f = load([
    "runTool",
    `setup: (run, review) => {
      defineTool({ name: "t_write", sideEffect: true, schema: { parameters: {} }, run });
      warmConversation = async () => {};
      keepHook = async () => null;
      reviewHook = review;
    }`
  ]);
  f.setup(
    () => ((ran = true), { ok: true, content: "" }),
    () => new Promise(resolve => (answer = resolve))
  );
  const stop = new AbortController();
  const running = f.runTool({ name: "t_write", arguments: "{}" }, { conversation: {}, assistant: {}, signal: stop.signal });
  await new Promise(resolve => setImmediate(resolve));
  stop.abort();
  answer(null);
  await assert.rejects(running, { name: "AbortError" });
  assert.equal(ran, false);
});

test("回报另起一答：先认领，别处正作答就不起", async () => {
  const f = load([
    "wakeWithReports",
    "remoteBusy",
    `setup: (claim, started) => {
      const c = { id: "c1", messages: [] };
      store.conversations = [c];
      claimConversation = claim;
      requestJob = () => null;
      profiles = () => [];
      activeProfile = () => ({ id: "p" });
      quotaBlocked = () => false;
      startTurn = async () => started.push(c.id);
      return c;
    }`
  ]);
  const item = { report: "到点", step: { id: "s1" }, profile: null, relay: { step: "s1", title: "t", ok: true } };
  const started = [];
  let c = f.setup(async () => false, started);
  await f.wakeWithReports(c, [item]);
  assert.deepEqual(started, [], "认领不到不起");
  c = f.setup(async () => true, started);
  f.remoteBusy.add("c1");
  await f.wakeWithReports(c, [item]);
  assert.deepEqual(started, [], "别处握着的不去认领");
  f.remoteBusy.clear();
  await f.wakeWithReports(c, [item]);
  assert.deepEqual(started, ["c1"]);
});
