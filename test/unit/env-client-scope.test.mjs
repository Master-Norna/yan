// 本页换根要马上丢环境状态；旧页请示、迟到的回话与轮询都不能跟去新处。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const deferred = () => Promise.withResolvers();
const where = root => ({ root, chats: `${root}/对话`, archive: `${root}/卷宗`, files: `${root}/附件` });
const initial = { state: { packs: ["office"] }, packs: [{ id: "office", name: "办公" }], job: { running: true } };

function page({ call = async () => null, confirm = async () => true } = {}) {
  const requests = [],
    toasts = [];
  const f = load([
    "bindEnvEvents",
    "refreshEnv",
    "switchStoreRoot",
    "resetEnvStatus",
    `setup:(call, confirm, toasts, where, initial)=>{
      bootstrap.store=where; bootstrap.work={};
      store.settings.env={packs:[], pip:'', npm:''};
      envStatus=initial;
      envPoll=setTimeout(()=>{},60_000);
      bridge=call; askConfirm=confirm; toast=message=>toasts.push(message);
      renderEnvStatus=()=>{};
      syncChatsWithDisk=async()=>{}; readChatSpills=async()=>true; reconcileTimers=async()=>{}; flushConversations=()=>{}; adoptConfig=render=rewatchBackground=()=>{};
      const old=document.querySelector;
      document.querySelector=()=>({addEventListener:(name, handler)=>{
        if(name==='click') click=handler;
      }});
      let click;
      try { bindEnvEvents(); } finally { document.querySelector=old; }
      return id=>click({target:{closest:()=>({id,dataset:{}})}});
    }`,
    "snapshot:()=>({status:envStatus, timer:envPoll})"
  ]);
  const click = f.setup(
    (route, payload) => {
      requests.push({ route, payload });
      return call(route, payload);
    },
    confirm,
    toasts,
    where("A"),
    initial
  );
  return { ...f, click, requests, toasts, move: root => f.switchStoreRoot({ ...where(root), adopted: true }) };
}

for (const action of ["Prepare", "Clear"]) {
  test(`环境 ${action} 确认框跨过换根（含切回同一路）不能发请求`, async () => {
    const gate = deferred();
    let confirmations = 0;
    const f = page({
      confirm: () => {
        confirmations++;
        return gate.promise;
      }
    });
    const pending = f.click(`env${action}`);
    assert.equal(confirmations, 1);
    await f.move("B");
    await f.move("A");
    gate.resolve(true);
    await pending;
    assert.deepEqual(
      f.requests.map(request => request.route),
      ["/api/store/config/load", "/api/store/config/load"]
    );
  });
}

for (const action of ["status", "prepare", "clear"]) {
  test(`环境 ${action} 定根发出；旧成功回话不重建状态和轮询`, async () => {
    const gate = deferred(),
      loaded = deferred();
    const f = page({ call: route => (route === "/api/store/config/load" ? loaded.promise : gate.promise) });
    try {
      const pending = action === "status" ? f.refreshEnv() : f.click(`env${action[0].toUpperCase()}${action.slice(1)}`);
      await Promise.resolve(); // 确认框点下，发往 A。
      assert.equal(f.requests[0].route, `/api/env/${action}`);
      assert.equal(f.requests[0].payload.root, "A");
      const before = f.snapshot().timer;
      const moving = f.move("B"); // 新处配置尚未对齐完成，旧状态和旧候已同步清掉。
      assert.deepEqual(f.snapshot(), { status: null, timer: 0 });
      assert.equal(before._destroyed, true);
      loaded.resolve(null);
      await moving;
      await f.move("A");
      gate.resolve(initial);
      await pending;
      assert.deepEqual(f.snapshot(), { status: null, timer: 0 });
      assert.deepEqual(f.toasts, []);
    } finally {
      gate.resolve(null);
      loaded.resolve(null);
      f.resetEnvStatus();
    }
  });
}

test("当前根的环境请求照常更新状态并轮询，错误照实提示", async () => {
  const fresh = { ...initial, home: "A/环境" };
  const f = page({
    call: async route => {
      if (route === "/api/env/clear") throw Error("环境正在准备，稍候再清");
      return fresh;
    }
  });
  try {
    await f.click("envPrepare");
    assert.equal(f.snapshot().status, fresh);
    assert.ok(f.snapshot().timer);
    await f.click("envClear");
    assert.deepEqual(f.toasts, ["环境正在准备，稍候再清"]);
  } finally {
    f.resetEnvStatus();
  }
});

test("别页换根后，旧页收到换根拒绝即清掉缓存与轮询", async () => {
  const moved = "存储位置已变化，请刷新页面后重试";
  const f = page({
    call: async () => {
      throw Error(moved);
    }
  });
  await f.refreshEnv();
  assert.deepEqual(f.snapshot(), { status: null, timer: 0 });
  assert.deepEqual(f.toasts, [moved]);
});
