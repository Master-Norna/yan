import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => (resolve = done));
  return { promise, resolve };
};

function stageFixture(reply) {
  const calls = [],
    visibility = { shown: true },
    f = load([
      "stageAttach",
      "stageWake",
      "stage",
      "workEnter",
      "work",
      `setup: (reply, calls, visibility) => {
        stage.ws = {}; stage.current = 'A';
        stageVisible = () => visibility.shown && !work.open;
        workFollowConversation = () => false;
        stageRender = () => {};
        workRefresh = async () => {};
        stageSync = stageResetPage = stageReadHistory = stageFit = stageFrame = () => {};
        stageInkAttach = async () => {};
        stageSend = async (method, params, session) => {
          calls.push({method, params, session});
          const result = await reply(method, params, session);
          if (result !== undefined) return result;
          if (method === 'Target.attachToTarget') return {sessionId:'session-' + params.targetId};
          if (method === 'Page.captureScreenshot') return {data:''};
          if (method === 'Page.getLayoutMetrics') return {cssVisualViewport:{clientWidth:1280,clientHeight:720}};
          return {};
        };
      }`
    ]);
  f.setup(reply, calls, visibility);
  return {
    ...f,
    calls,
    hide: () => {
      visibility.shown = false;
      f.stageWake();
    }
  };
}

for (const phase of ["Target.attachToTarget", "Page.enable"])
  test(`游目在 ${phase} 等待时收起：迟到的连接不能开始推流`, async () => {
    const gate = deferred(),
      reached = deferred(),
      f = stageFixture(async method => {
        if (method === phase) {
          reached.resolve();
          await gate.promise;
        }
      });
    const attaching = f.stageAttach();
    await reached.promise;
    f.hide();
    gate.resolve();
    await attaching;
    await tick();
    assert.equal(f.stage.session, "");
    assert.equal(f.stage.attached, "");
    assert.ok(!f.calls.some(call => call.method === "Page.startScreencast"));
    assert.ok(f.calls.some(call => call.method === "Target.detachFromTarget"));
  });

test("游目开始推流的回话迟到：收起后仍会停掉迟到的推流", async () => {
  const gate = deferred(),
    reached = deferred();
  let streaming = false;
  const f = stageFixture(async method => {
    if (method === "Page.startScreencast") {
      reached.resolve();
      await gate.promise;
      streaming = true;
    } else if (method === "Page.stopScreencast") streaming = false;
  });
  const attaching = f.stageAttach();
  await reached.promise;
  f.hide();
  gate.resolve();
  await attaching;
  await tick();
  assert.equal(streaming, false);
  assert.equal(f.stage.session, "");
  assert.ok(!f.calls.some(call => call.method === "Page.captureScreenshot"));
});

test("游目 A → B → A：旧 A 的连接迟到也不能占用新 A 的会话", async () => {
  const first = deferred();
  let requests = 0;
  const f = stageFixture(async method => {
    if (method === "Target.attachToTarget") {
      const n = ++requests;
      if (n === 1) await first.promise;
      return { sessionId: `session-${n}` };
    }
  });
  const old = f.stageAttach();
  await tick();
  f.stage.current = "B";
  await f.stageAttach();
  f.stage.current = "A";
  await f.stageAttach();
  first.resolve();
  await old;
  await tick();
  assert.equal(f.stage.session, "session-3");
  assert.ok(f.calls.some(call => call.method === "Target.detachFromTarget" && call.params.sessionId === "session-1"));
  assert.ok(!f.calls.some(call => call.method === "Page.startScreencast" && call.session === "session-1"));
});

test("游目连接本身出错：不留已连着的空壳，同一页还能再接上", async () => {
  let fail = true;
  const f = stageFixture(async method => {
    if (method === "Target.attachToTarget" && fail) throw Error("No target with given id");
  });
  await f.stageAttach();
  assert.equal(f.stage.attached, "");
  fail = false;
  await f.stageAttach();
  assert.equal(f.stage.session, "session-A");
  assert.ok(f.calls.some(call => call.method === "Page.startScreencast" && call.session === "session-A"));
});

test("切入工作区即停推流，不等 ResizeObserver 通知", async () => {
  const f = stageFixture(async () => {});
  await f.stageAttach();
  assert.equal(f.stage.session, "session-A");
  f.workEnter();
  assert.equal(f.work.open, true);
  assert.equal(f.stage.session, "");
  assert.equal(f.stage.attached, "");
  await tick();
  assert.ok(f.calls.some(call => call.method === "Page.stopScreencast"));
});
