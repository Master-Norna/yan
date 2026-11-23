// 联网三件（翻网页 / 问接口 / 下载）撞上「本机或内网」那道门时照档位再判一次：
// 径行直连、审而后行交审查准了再发一次、问而后行照拒并说明切到哪一档；桥接在连之前就拒，重发是安全的
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup(approve) {
  const f = load([
    "bridgePrivate",
    `setup: approve => {
      globalThis.__calls = [];
      bridge = async (path, payload) => {
        globalThis.__calls.push({ path, allowPrivate: payload.allowPrivate === true });
        if (payload.allowPrivate !== true)
          throw Object.assign(Error("不允许访问本机或内网地址"), { data: { private: true } });
        return { ok: true, path };
      };
      reviewOn = () => approve !== "off";
      reviewGate = async step => {
        if (approve === "deny") return { ok: false, content: "驳回", display: "审查未准" };
        // 真的 reviewGate 准了会记下 step.reviewed；"error" 这一档模拟审查没成：回 null 却没记
        if (approve === "allow") step.reviewed = { ok: true, why: "" };
        return null;
      };
    }`
  ]);
  f.setup(approve);
  return f;
}

const args = { url: "http://192.168.1.1/" };
const newStep = () => ({ id: "s1", name: "fetch_page" });
const ctx = policy => ({
  conversation: { commandPolicy: policy, messages: [] },
  assistant: { id: "a1" },
  signal: new AbortController().signal
});

test("径行：一开始就带 allowPrivate，一次连上", async () => {
  const f = setup("off");
  const { data } = await f.bridgePrivate("/api/fetch", { url: args.url }, newStep(), args, ctx("auto"));
  assert.equal(data.ok, true);
  assert.deepEqual(
    globalThis.__calls.map(call => call.allowPrivate),
    [true]
  );
});

test("审而后行：先不带；审准了带 allowPrivate 再发一次", async () => {
  const f = setup("allow");
  const step = newStep();
  const { data } = await f.bridgePrivate("/api/fetch", { url: args.url }, step, args, ctx("review"));
  assert.equal(data.ok, true);
  assert.deepEqual(
    globalThis.__calls.map(call => call.allowPrivate),
    [false, true]
  );
});

test("审而后行：驳了不再发", async () => {
  const f = setup("deny");
  const { denied } = await f.bridgePrivate("/api/fetch", { url: args.url }, newStep(), args, ctx("review"));
  assert.equal(denied.display, "审查未准");
  assert.deepEqual(
    globalThis.__calls.map(call => call.allowPrivate),
    [false],
    "没有第二次"
  );
});

test("审而后行：审查没成时不放——审查只该让它更容易过，不该更容易", async () => {
  const f = setup("error");
  const { denied } = await f.bridgePrivate("/api/fetch", { url: args.url }, newStep(), args, ctx("review"));
  assert.equal(denied.display, "审查未成");
  assert.deepEqual(
    globalThis.__calls.map(call => call.allowPrivate),
    [false]
  );
});

test("问而后行：照拒，回一句指路的话", async () => {
  const f = setup("off");
  const { denied } = await f.bridgePrivate("/api/fetch", { url: args.url }, newStep(), args, ctx("ask"));
  assert.match(denied.content, /审而后行/);
  assert.deepEqual(
    globalThis.__calls.map(call => call.allowPrivate),
    [false]
  );
});

test("不是内网门禁的错：照原样抛，不吞", async () => {
  const f = load([
    "bridgePrivate",
    `setup: () => {
      bridge = async () => { throw Object.assign(Error("连不上"), { data: {} }); };
      reviewOn = () => true;
      reviewGate = async () => null;
    }`
  ]);
  f.setup();
  await assert.rejects(f.bridgePrivate("/api/fetch", { url: args.url }, newStep(), args, ctx("review")), /连不上/);
});
