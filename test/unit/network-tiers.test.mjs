// 联网三件（翻网页 / 问接口 / 下载）撞上「本机或内网」那道门时照档位再判一次：
// 径行直连、审而后行交审查准了再发一次、问而后行照拒并说明切到哪一档；首跳就撞门时桥接一个字节都没发出去，
// 重发是安全的；若是公网地址把请求转到内网（detail 带 sent），那一跳已经发出去了，不重放、只如实交回
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup(approve) {
  const f = load([
    "bridgePrivate",
    `setup: approve => {
      globalThis.__calls = [];
      bridge = async (path, payload) => {
        globalThis.__calls.push({
          path,
          allowPrivate: payload.allowPrivate === true || payload.allowPrivateFirstHop === true,
          scoped: payload.allowPrivateFirstHop === true
        });
        if (payload.allowPrivate !== true && payload.allowPrivateFirstHop !== true)
          throw Object.assign(Error("不允许访问本机或内网地址"), { data: { private: true } });
        return { ok: true, path };
      };
      reviewOn = () => approve !== "off";
      reviewGate = async (step, args, ctx, flag) => {
        if (approve === "deny") return { ok: false, content: "驳回", display: "审查未准" };
        // 真的 reviewGate 准了会记下 step.reviewed；"error" 这一档模拟审查没成：回 null 却没记
        if (approve === "allow") step.reviewed = { ok: true, why: "", kind: flag.kind };
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
  assert.deepEqual(globalThis.__calls.map(call => call.scoped), [false, true]);
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

test("公网地址跳到内网：不重发、不送审，把要跟的地址交回", async () => {
  const f = load([
    "bridgePrivate",
    `setup: () => {
      globalThis.__calls = 0;
      bridge = async () => {
        globalThis.__calls++;
        throw Object.assign(Error("不允许访问本机或内网地址"), {
          data: { private: true, sent: true, at: "http://192.168.1.1/next" }
        });
      };
      reviewOn = () => true;
      reviewGate = async () => { throw Error("不该送审"); };
    }`
  ]);
  f.setup();
  const { denied } = await f.bridgePrivate("/api/http", { url: "https://a.example/", method: "POST" }, newStep(), args, ctx("review"));
  assert.equal(globalThis.__calls, 1, "没有第二次");
  assert.equal(denied.display, "跳转未跟");
  assert.match(denied.content, /192\.168\.1\.1\/next/, "交回要跟的地址");
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

test("外发已经审准，仍须核准新发现的内网地址；审查失败不能沿用旧定夺", async () => {
  const f = setup("error"),
    step = { ...newStep(), reviewed: { ok: true, why: "", kind: "http-post" } };
  const { denied } = await f.bridgePrivate("/api/http", { url: args.url, method: "POST" }, step, args, ctx("review"));
  assert.equal(denied.display, "审查未成");
  assert.deepEqual(
    globalThis.__calls.map(call => call.allowPrivate),
    [false]
  );
});

test("外发已经审准，新发现的内网地址经审查准了才连", async () => {
  const f = setup("allow"),
    step = { ...newStep(), reviewed: { ok: true, why: "", kind: "http-post" } };
  const { data } = await f.bridgePrivate("/api/http", { url: args.url, method: "POST" }, step, args, ctx("review"));
  assert.equal(data.ok, true);
  assert.equal(step.reviewed.kind, "private-address");
});

test("审准首跳后再遇内网重定向：不重放，仍交回目标", async () => {
  const f = load([
    "bridgePrivate",
    `setup: () => {
      globalThis.__calls = [];
      bridge = async (path, payload) => {
        globalThis.__calls.push(payload);
        if (!payload.allowPrivateFirstHop)
          throw Object.assign(Error("内网"), { data: { private: true } });
        throw Object.assign(Error("内网"), {
          data: { private: true, sent: true, at: "http://192.168.1.2/next" }
        });
      };
      reviewOn = () => true;
      reviewGate = async (step, args, ctx, flag) => {
        step.reviewed = { ok: true, kind: flag.kind };
        return null;
      };
    }`
  ]);
  f.setup();
  const { denied } = await f.bridgePrivate("/api/http", { url: args.url, method: "POST" }, newStep(), args, ctx("review"));
  assert.equal(denied.display, "跳转未跟");
  assert.match(denied.content, /192\.168\.1\.2\/next/);
  assert.equal(globalThis.__calls.length, 2);
  assert.equal(globalThis.__calls[1].allowPrivateFirstHop, true);
  assert.equal(globalThis.__calls[1].allowPrivate, undefined);
});
