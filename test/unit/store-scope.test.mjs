// 换根是一次明确的生命周期：在途请求、配置同步状态与候，都不能把旧处的状态带到新处。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const require = createRequire(import.meta.url),
  createStore = require("../../server/store.js"),
  createTimers = require("../../server/timers.js");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const failed of [false, true])
  test(failed ? "换根前写配置失败：说明原因并留在当前根" : "换根前等配置写稳：等待期间继续改的也存下", async () => {
    const gate = deferred(),
      writes = [],
      realFetch = globalThis.fetch;
    const f = load([
      "settleConfig",
      "resetConfigSync",
      `setup:()=>{bootstrap.store={root:'A'};store.settings.name='第一版';toast=()=>{};}`,
      "rename:text=>{store.settings.name=text;}",
      "root:()=>bootstrap.store.root"
    ]);
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      writes.push(body);
      if (writes.length === 1) await gate.promise;
      return new Response(JSON.stringify(failed ? { error: "暂时不能写" } : { savedAt: body.savedAt }), { status: failed ? 500 : 200 });
    };
    f.setup();
    try {
      const saving = f.settleConfig();
      f.rename("等待期间改的第二版");
      gate.resolve();
      if (failed) await assert.rejects(saving, /配置尚未写入存储目录/);
      else {
        await saving;
        assert.deepEqual(
          writes.map(w => w.config.settings.name),
          ["第一版", "等待期间改的第二版"]
        );
        assert.ok(writes.every(w => w.root === "A"));
      }
      assert.equal(f.root(), "A");
    } finally {
      gate.resolve();
      f.resetConfigSync();
      globalThis.fetch = realFetch;
    }
  });

async function fixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-store-scope-")),
    a = path.join(base, "A", ".yan"),
    b = path.join(base, "B", ".yan");
  for (const [root, name, savedAt] of [
    [a, "A", 1000],
    [b, "B", 100]
  ]) {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "配置.json"), JSON.stringify({ settings: { name }, savedAt }));
  }
  const saved = process.env.YAN_HOME;
  process.env.YAN_HOME = a;
  let timers;
  const store = createStore({ onMove: () => timers.sync() });
  timers = createTimers({ home: () => path.join(store.paths().root, "候"), known: () => true, route: store.scopedRoute });
  const incoming = deferred(),
    waitingEntered = deferred();
  const routes = { ...store.routes, ...timers.routes };
  const server = http
    .createServer((req, res) => {
      if (req.url === "/api/store/config/save") incoming.resolve();
      if (req.url === "/api/timer/wait") req.once("end", () => setImmediate(waitingEntered.resolve));
      routes[`POST ${req.url}`](req, res);
    })
    .listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`,
    post = (route, body, signal = AbortSignal.timeout(5000)) =>
      fetch(url + route, { method: "POST", body: JSON.stringify(body), signal }).then(async r => ({
        status: r.status,
        data: await r.json()
      }));
  try {
    await run({ a, b, store, timers, server, url, post, incoming, waitingEntered });
  } finally {
    if (saved === undefined) delete process.env.YAN_HOME;
    else process.env.YAN_HOME = saved;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(base), os.tmpdir());
    fs.rmSync(base, { recursive: true, force: true });
  }
}

for (const back of [false, true])
  test(`配置请求体尚未收全时${back ? "往返换根" : "换到已有根"}：旧请求不能落盘`, async () =>
    fixture(async ({ a, b, server, url, post, incoming }) => {
      const raw = JSON.stringify({ root: a, config: { settings: { name: "旧根在途" } }, base: 1000, savedAt: 1100 });
      let req;
      const saved = new Promise((resolve, reject) => {
        req = http.request(url + "/api/store/config/save", { method: "POST" }, res => {
          let text = "";
          res.on("data", d => (text += d));
          res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
        });
        req.on("error", reject);
        req.write(raw.slice(0, 10));
      });
      await incoming.promise;
      assert.equal((await post("/api/store/move", { parent: b })).status, 200);
      assert.equal((await post("/api/store/config/load", { root: b })).data.config.settings.name, "B");
      if (back) assert.equal((await post("/api/store/move", { parent: a })).status, 200);
      req.end(raw.slice(10));
      const result = await saved;
      assert.equal(result.status, 400);
      assert.match(result.data.error, /存储位置已变化/);
      assert.equal(JSON.parse(fs.readFileSync(path.join(a, "配置.json"), "utf8")).settings.name, "A");
      assert.equal(JSON.parse(fs.readFileSync(path.join(b, "配置.json"), "utf8")).settings.name, "B");
    }));

test("换根主动重排候并唤回旧等待：新根无需先查列表，旧根也不能认领新信", async () =>
  fixture(async ({ a, b, store, post, waitingEntered }) => {
    // 准备已有数据的 .yan 根，覆盖产品里「沿用那边原有数据」的路径。
    const next = b,
      home = path.join(next, "候");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(next, "配置.json"), JSON.stringify({ settings: { name: "B" }, savedAt: 100 }));
    fs.writeFileSync(
      path.join(home, "约.json"),
      JSON.stringify({ seq: 1, timers: [{ id: "t1", to: "c", step: "s", note: "B 的候", due: Date.now() + 200, created: 1 }] })
    );
    const waiting = post("/api/timer/wait", { root: a });
    await waitingEntered.promise;
    const moved = await post("/api/store/move", { parent: b });
    assert.equal(moved.data.adopted, true);
    assert.deepEqual((await waiting).data.fired, []);
    assert.equal(store.paths().root, next);
    const fired = (await post("/api/timer/wait", { root: next })).data.fired;
    assert.equal(fired[0].timer.note, "B 的候");
    const ids = fired.map(item => item.id);
    assert.equal((await post("/api/timer/take", { root: a, ids })).status, 400);
    assert.equal((await post("/api/timer/take", { root: next, ids })).data.fired.length, 1);
  }));

for (const result of ["success", "conflict", "failure"])
  test(`切根后旧配置保存的${result}回话不改新基准，也不释放新请求的锁`, async () => {
    const first = deferred(),
      second = deferred(),
      realFetch = globalThis.fetch;
    const f = load([
      "saveConfigNow",
      "switchStoreRoot",
      "doc:()=>document",
      `setup:()=>{
        bootstrap.store={root:'A'};store.settings.name='A';store.conversations=[];
        configSyncedAt=100;configBase=JSON.stringify(metaOf());
        writeMeta=applyAppearance=renderHeader=renderHistory=renderQuota=()=>{};
        syncChatsWithDisk=async()=>{};flushConversations=()=>{};
        bridge=async()=>({config:{version:STORE_VERSION,settings:{name:'B'},profiles:[],memory:{items:[]},drafts:{}},savedAt:200});
        document.querySelector=()=>({classList:{contains:()=>true}});
      }`,
      "state:()=>({base:JSON.parse(configBase).settings.name,name:store.settings.name,saving:configSaving,failures:configSaveFailures})"
    ]);
    const query = f.doc().querySelector;
    let calls = 0;
    globalThis.fetch = () => (++calls === 1 ? first.promise : second.promise);
    try {
      f.setup();
      f.saveConfigNow();
      await f.switchStoreRoot({ root: "B", chats: "B/chats", archive: "B/archive", files: "B/files", adopted: true });
      f.saveConfigNow();
      if (result === "failure") first.reject(Error("old request failed"));
      else
        first.resolve(
          new Response(
            JSON.stringify({
              savedAt: 500,
              ...(result === "conflict" ? { config: { settings: { name: "A_remote" }, profiles: [] } } : {})
            }),
            { status: result === "conflict" ? 409 : 200 }
          )
        );
      for (let i = 0; i < 4; i++) await tick();
      assert.deepEqual(f.state(), { base: "B", name: "B", saving: true, failures: 0 });
      second.resolve(new Response(JSON.stringify({ savedAt: 600 })));
      for (let i = 0; i < 4; i++) await tick();
      assert.equal(f.state().saving, false);
      assert.equal(calls, 2);
    } finally {
      first.resolve(new Response("{}"));
      second.resolve(new Response("{}"));
      globalThis.fetch = realFetch;
      f.doc().querySelector = query;
    }
  });
