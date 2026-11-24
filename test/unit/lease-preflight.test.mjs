import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const createChats = createRequire(import.meta.url)("../../server/chats.js");
function leaseServer() {
  const route = createChats({ chatsHome: () => "" }).routes["POST /api/chats/lease"];
  return async body => {
    let data;
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead() {
        this.headersSent = true;
      },
      end(text) {
        data = JSON.parse(text);
        this.writableEnded = true;
      }
    };
    await route(Readable.from([Buffer.from(JSON.stringify(body))]), res);
    return data;
  };
}

test("认领回话未到时的心跳不释放这段，另一页仍不能认领", async () => {
  const invoke = leaseServer();
  let release, entered;
  const gate = new Promise(resolve => (release = resolve));
  const started = new Promise(resolve => (entered = resolve));
  const f = load([
    "claimConversation",
    "syncLeases",
    "setup: fn => { chatsOnline = () => true; bridge = fn; renderHistory = renderSendButtons = () => {}; }"
  ]);
  f.setup(async (_path, body) => {
    const result = await invoke(body);
    if (body.claim) {
      entered();
      await gate;
    }
    return result;
  });
  const claiming = f.claimConversation("c");
  await started;
  const syncing = f.syncLeases();
  await Promise.resolve();
  // 服务端的认领仍在：检查真实门禁，而不只看页面那张表。
  const other = await invoke({ owner: "other", ids: ["c"], claim: "c" });
  release();
  assert.equal(await claiming, true);
  await syncing;
  assert.deepEqual(other.busy, ["c"]);
});

test("先前的心跳尚未投递时认领：先等旧报到结束，不让迟到的空清单撤回认领", async () => {
  const invoke = leaseServer();
  let release, entered;
  const gate = new Promise(resolve => (release = resolve));
  const started = new Promise(resolve => (entered = resolve));
  const f = load([
    "claimConversation",
    "syncLeases",
    "setup: fn => { chatsOnline = () => true; bridge = fn; renderHistory = renderSendButtons = () => {}; }"
  ]);
  f.setup(async (_path, body) => {
    if (!body.claim) {
      entered();
      await gate;
    }
    return invoke(body);
  });
  const syncing = f.syncLeases();
  await started;
  const claiming = f.claimConversation("c");
  release();
  await syncing;
  assert.equal(await claiming, true);
  assert.deepEqual((await invoke({ owner: "other", ids: ["c"], claim: "c" })).busy, ["c"]);
});

test("心跳已报到、仍在读别处对话时：新认领不等磁盘读取", async () => {
  const invoke = leaseServer();
  await invoke({ owner: "other", ids: ["remote"] });
  let release,
    entered,
    claimed = false;
  const gate = new Promise(resolve => (release = resolve));
  const started = new Promise(resolve => (entered = resolve));
  const f = load([
    "claimConversation",
    "syncLeases",
    "setup: (fn, follow) => { chatsOnline = () => true; bridge = fn; store.conversations = [{ id: 'remote', messages: [] }]; followConversations = follow; renderHistory = renderSendButtons = () => {}; }"
  ]);
  f.setup(
    async (_path, body) => {
      if (body.claim) claimed = true;
      return invoke(body);
    },
    async () => {
      entered();
      await gate;
    }
  );
  const syncing = f.syncLeases();
  await started;
  const claiming = f.claimConversation("c");
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(claimed, true);
    assert.equal(await claiming, true);
    assert.deepEqual((await invoke({ owner: "other", ids: ["remote", "c"], claim: "c" })).busy, ["c"]);
  } finally {
    release();
    await Promise.all([syncing, claiming]);
  }
});

test("慢跟读不拖住心跳，另一页不能接管仍在作答的对话", async t => {
  let now = 100000;
  t.mock.method(Date, "now", () => now);
  const invoke = leaseServer(),
    gate = Promise.withResolvers(),
    entered = Promise.withResolvers();
  await invoke({ owner: "other", ids: ["remote"] });
  const f = load([
    "syncLeases",
    "setup:(fn, follow)=>{ chatsOnline=()=>true; bridge=fn; followConversations=follow; store.conversations=[{id:'remote',messages:[]}]; requestJobs.set('active',{conversationId:'active'}); }"
  ]);
  f.setup(
    (_path, body) => invoke(body),
    async () => {
      entered.resolve();
      await gate.promise;
    }
  );
  const first = f.syncLeases();
  await entered.promise;
  try {
    now += 12000;
    void f.syncLeases();
    // 让第二次报到的请求体读完；跟读仍挂着，不用真实的 15 秒等待。
    await new Promise(resolve => setImmediate(resolve));
    now += 4000;
    const other = await invoke({ owner: "other", ids: ["remote", "active"], claim: "active" });
    assert.deepEqual(other.busy, ["active"]);
  } finally {
    gate.resolve();
    await first;
  }
});

test("远端松手但终稿还没读回：不认领、不从旧副本接候", async () => {
  const invoke = leaseServer(),
    entered = Promise.withResolvers(),
    gate = Promise.withResolvers(),
    watched = [];
  await invoke({ owner: "other", ids: ["remote"] });
  const f = load([
    "syncLeases",
    "claimConversation",
    "runningElsewhere",
    `setup:(fn, watched)=>{ chatsOnline=()=>true; bridge=fn;
      store.conversations=[{id:'remote',messages:[],title:'未完'}];
      chatDiskStamps.set('remote', 1);
      chatStamps.set('remote', 20); // 本页暂存较晚，不代表已见过终稿
      renderHistory=renderClepsydra=renderSendButtons=()=>{};
      rewatchBackground=()=>{if (!remoteBusy.has('remote')) watched.push(store.conversations[0].title);};
    }`
  ]);
  const loads = [];
  f.setup(async (route, body) => {
    if (route === "/api/chats/lease") return invoke(body);
    if (loads.push(body) === 1) {
      entered.resolve();
      await gate.promise;
      return { items: [] };
    }
    if (loads.length === 2) return {}; // 200 但正文没收全，不是空目录的确认
    if (loads.length === 3) return { items: [], skipped: 1 };
    return { items: [{ id: "remote", savedAt: 10, conversation: { id: "remote", title: "终稿", messages: [] } }] };
  }, watched);
  const first = f.syncLeases();
  await entered.promise;
  try {
    await invoke({ owner: "other", ids: [] });
    void f.syncLeases();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.runningElsewhere("remote"), true);
    assert.equal(await f.claimConversation("remote"), false);
  } finally {
    gate.resolve();
    await first;
  }
  assert.deepEqual(watched, []);
  for (let i = 0; i < 2; i += 1) {
    await f.syncLeases();
    assert.equal(f.runningElsewhere("remote"), true);
    assert.equal(await f.claimConversation("remote"), false);
    assert.deepEqual(watched, []);
  }
  await f.syncLeases();
  assert.equal(f.runningElsewhere("remote"), false);
  assert.deepEqual(watched, ["终稿"]);
  assert.deepEqual(loads[0].known, { remote: 1 }, "在途只带已见过的磁盘戳，不拿本页暂存时间冒充");
  assert.ok(
    loads.slice(1).every(body => body.known === undefined),
    "松手后的读回仍要取完整结果"
  );
  assert.equal(await f.claimConversation("remote"), true);
});

test("认领别段收到远端重新持有，旧的松手跟读不能放行", async () => {
  const invoke = leaseServer(),
    entered = Promise.withResolvers(),
    gate = Promise.withResolvers(),
    watched = [];
  await invoke({ owner: "other", ids: ["remote"] });
  const f = load([
    "syncLeases",
    "claimConversation",
    "runningElsewhere",
    `setup:(fn,watched)=>{ chatsOnline=()=>true; bridge=fn;
      store.conversations=[{id:'remote',messages:[]}];
      renderHistory=renderClepsydra=renderSendButtons=()=>{};
      rewatchBackground=()=>{if (!remoteBusy.has('remote')) watched.push('remote');};
    }`
  ]);
  let loads = 0;
  f.setup(async (route, body) => {
    if (route === "/api/chats/lease") return invoke(body);
    if (++loads === 2) {
      entered.resolve();
      await gate.promise;
    }
    return { items: [] };
  }, watched);
  await f.syncLeases();
  await invoke({ owner: "other", ids: [] });
  const followRelease = f.syncLeases();
  await entered.promise;
  try {
    assert.deepEqual((await invoke({ owner: "other", ids: ["remote"], claim: "remote" })).busy, []);
    assert.equal(await f.claimConversation("unrelated"), true);
  } finally {
    gate.resolve();
    await followRelease;
  }
  assert.equal(f.runningElsewhere("remote"), true);
  assert.deepEqual(watched, []);
});

test("共享目录认领超时或回执不完整不能冒充成功；本地离线仍可开工", async () => {
  const f = load([
    "claimConversation",
    "leaseHold",
    `setup: (online, request) => {
      chatsOnline = () => online;
      bridge = request;
    }`
  ]);
  f.setup(true, async () => {
    throw Error("timeout");
  });
  assert.equal(await f.claimConversation("c"), false);
  assert.equal(f.leaseHold.has("c"), false);
  f.setup(true, async () => ({}));
  assert.equal(await f.claimConversation("c"), false);
  assert.equal(f.leaseHold.has("c"), false);
  f.setup(false, async () => {
    throw Error("should not request");
  });
  assert.equal(await f.claimConversation("c"), true);
});
