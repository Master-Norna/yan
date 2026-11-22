// 页面落盘与桥接的对话路由联跑；只用临时目录，IndexedDB 用内存表代替。
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const require = createRequire(import.meta.url);
const createChats = require("../../server/chats.js");
const createFiles = require("../../server/files.js");
const nativeFetch = globalThis.fetch;

async function fixture(t, { attachments = false, intercept = (route, options, send) => send() } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-chat-resync-")),
    chats = path.join(home, "chats"),
    files = path.join(home, "files"),
    { routes } = createChats({ chatsHome: () => chats }),
    fileRoutes = createFiles({ filesHome: () => files }).routes,
    server = http
      .createServer((req, res) => {
        const key = `${req.method} ${new URL(req.url, "http://127.0.0.1").pathname}`,
          route = routes[key] || fileRoutes[key];
        if (route) return route(req, res);
        res.writeHead(404).end();
      })
      .listen(0, "127.0.0.1");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  });
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, payload = {}) => {
    const response = await nativeFetch(`${origin}/api/${route}`, {
      method: "POST",
      body: JSON.stringify({ root: chats, ...payload }),
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  t.mock.method(globalThis, "fetch", (route, options) => intercept(route, options, () => nativeFetch(origin + route, options)));
  const keyOf = id => (Array.isArray(id) ? JSON.stringify(id) : id),
    records = new Map(),
    shelf = new Map(),
    local = new Map(),
    storage = {
      get length() {
        return local.size;
      },
      key: i => [...local.keys()][i] ?? null,
      getItem: key => local.get(key) ?? null,
      setItem: (key, value) => local.set(key, value),
      removeItem: key => local.delete(key)
    },
    faults = { db: false, abort: false };
  function oldFile(id) {
    fs.mkdirSync(files, { recursive: true });
    for (const extension of ["txt", "json"]) {
      const target = path.join(files, `${id}.${extension}`),
        old = (Date.now() - 48 * 3600 * 1000) / 1000;
      fs.writeFileSync(target, extension === "txt" ? "原件" : JSON.stringify({ id, file: `${id}.txt`, kind: "text" }));
      fs.utimesSync(target, old, old);
    }
  }
  const request = result => {
    const req = { result };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  const db = {
    transaction: (name, mode) => {
      if (faults.db) throw Error("暂存开不出");
      const tx = {
        objectStore: () =>
          name === "conversations"
            ? {
                getAll: () => request([...records.values()]),
                get: id => request(records.get(keyOf(id))),
                put: record => {
                  records.set(keyOf(record.id), structuredClone(record));
                  return request(record.id);
                },
                delete: id => request(faults.abort ? false : records.delete(keyOf(id)))
              }
            : { get: () => request(undefined) }
      };
      if (mode === "readwrite") setImmediate(() => (faults.abort ? tx.onabort?.() : tx.oncomplete?.()));
      return tx;
    }
  };
  const page = () => {
    const f = load([
      "store",
      "bootstrap",
      "switchStoreRoot",
      "flushImportedConversations",
      "chatJson",
      "saveStore",
      "writeConversation",
      "hydrateStore",
      "flushOnUnload",
      "syncChatsWithDisk",
      "catchUpFromDisk",
      "warmConversation",
      "requestJobs",
      "syncLeases",
      "pendingChatWrites",
      "remoteBusy",
      "pendingChatDeletes",
      "discardedChatSpills",
      "deleteStoredConversations",
      `savePreferences: () => { store.settings.language = "en"; writeMeta({ disk: false }); }`,
      `install: (db, attachments, shelf, storage) => {
        stateDb = db;
        stateDbPromise = Promise.resolve(db);
        localStorage = storage;
        render = closeHelperPanel = closeSidePanel = renderHeader = renderHistory = renderQuota = applyAppearance = toast = () => {};
        settingsInputFocused = () => true;
        reconcileTimers = async () => {}; rewatchBackground = () => {};
        let files;
        if (attachments) {
          const settle = settleAttachmentStore;
          settleAttachmentStore = ready => (files = settle(ready));
          fileStoreRequest = async (_mode, action) => action({ getAllKeys: () => [...shelf.keys()], get: id => shelf.get(id), delete: id => shelf.delete(id) });
        } else settleAttachmentStore = async () => {};
        const clearSaved = clearSavedChatSpills;
        let clearingSaved;
        clearSavedChatSpills = (...args) => (clearingSaved = clearSaved(...args));
        const clear = clearDiscardedChatSpills;
        let clearing;
        clearDiscardedChatSpills = () => (clearing = clear());
        return async () => {
          await Promise.all([files, clearing, clearingSaved]);
          await Promise.all([...chatWritePromises.values()]);
        };
      }`
    ]);
    f.bootstrap.work = { chats, files };
    f.bootstrap.store = { root: home };
    const idle = f.install(db, attachments, shelf, storage);
    return {
      ...f,
      sync: async () => {
        await f.syncChatsWithDisk();
        await idle();
      }
    };
  };
  return { post, page, records, chats, oldFile, files, shelf, faults, local, keyOf };
}

const conversation = title => ({
  id: "c1",
  title,
  messages: [{ id: "question", role: "user", content: "问题", attachments: [] }],
  forks: [],
  threads: []
});

test("离页暂存比磁盘更新晚，重新开页也不丢磁盘上的答复", async t => {
  const { post, page, records, keyOf, chats } = await fixture(t);
  const base = conversation("旧题"),
    baseAt = Date.now() - 3000,
    reply = { id: "reply", role: "assistant", content: "另一页已存的答复", status: "complete" };
  await post("chats/save", { conversation: base, savedAt: baseAt });
  const a = page();
  await a.sync();
  a.store.conversations[0].title = "离页才存的新题";
  await post("chats/save", {
    conversation: { ...base, messages: [...base.messages, reply], pinned: true },
    base: baseAt,
    savedAt: baseAt + 1000
  });
  a.flushOnUnload();
  await new Promise(setImmediate);
  const record = records.get(keyOf([chats, base.id]));
  assert.ok(record.savedAt > baseAt + 1000, "离页时间比另一页保存更晚");
  assert.equal(JSON.parse(record.baseJson).title, base.title);

  const reopened = page();
  await reopened.hydrateStore();
  await reopened.sync();
  const { items } = await post("chats/load");
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].conversation.messages, [...base.messages, reply], "磁盘仍有另一页保存的答复");
  assert.equal(items[0].conversation.pinned, true);
  assert.equal(items[0].conversation.title, "离页才存的新题");
  assert.equal(records.size, 0, "合并版落盘后再清暂存");
});

test("合并结果仍只是暂存版时，等另一页松手再落盘，不提前清暂存", async t => {
  const { post, page, records, keyOf, chats } = await fixture(t);
  const base = conversation("旧题");
  await post("chats/save", { conversation: base, savedAt: Date.now() - 3000 });
  const a = page();
  await a.sync();
  a.store.conversations[0].title = "还没落盘的新题";
  a.flushOnUnload();

  const reopened = page();
  await reopened.hydrateStore();
  reopened.remoteBusy.add(base.id);
  await reopened.sync();
  assert.equal((await post("chats/load")).items[0].conversation.title, base.title);
  assert.ok(records.has(keyOf([chats, base.id])), "被租约挡住的本地改动还在暂存表里");
  reopened.remoteBusy.delete(base.id);
  await reopened.sync();
  assert.equal((await post("chats/load")).items[0].conversation.title, "还没落盘的新题");
  assert.equal(records.size, 0);
});

// 只数顶层就是夹具对话的 JSON.stringify，不数路由信封、单条消息、暂存键等小对象。
function countChatJson(t, ids) {
  const stringify = JSON.stringify,
    counts = new Map();
  t.mock.method(JSON, "stringify", (value, ...args) => {
    if (ids.includes(value?.id) && Array.isArray(value.messages) && Array.isArray(value.forks) && Array.isArray(value.threads))
      counts.set(value.id, (counts.get(value.id) || 0) + 1);
    return stringify(value, ...args);
  });
  return counts;
}

for (const status of ["complete", "stopped"])
  test(`全量跟读接回冷行迹后才决定清暂存：${status}`, async t => {
    const { post, page, records, keyOf, chats } = await fixture(t);
    const base = conversation("磁盘旧题"),
      at = Date.now() - 3000,
      trail = "reply-0001",
      reasoning = "已经接回的思绪";
    base.messages[0].content = "问".repeat(1024 * 1024);
    base.messages.push({ id: "reply", role: "assistant", status: "complete", content: "正文", cold: { key: trail } });
    await post("chats/save", { conversation: base, savedAt: at });
    await post("chats/trail/put", { id: base.id, key: trail, piece: { reasoning } });
    const a = page();
    await a.sync();
    const previous = a.store.conversations[0],
      newer = structuredClone(previous);
    newer.title = "磁盘新题";
    newer.messages[1].status = status;
    assert.equal(await a.warmConversation(previous), 1);
    await post("chats/save", { conversation: newer, base: at, savedAt: at + 1000 });
    const id = [chats, base.id],
      key = keyOf(id),
      json = a.chatJson(newer);
    records.set(key, { id, dir: chats, savedAt: at + 1000, json });
    a.remoteBusy.add(base.id); // 别页握着租约，本轮不能提前写回。
    const counts = countChatJson(t, [base.id]);
    await a.sync();
    const serializations = counts.get(base.id) || 0;
    t.diagnostic(`${json.length} 字符，整段 JSON.stringify ${serializations} 次`);

    const current = a.store.conversations[0];
    assert.equal(current.title, newer.title);
    assert.equal(current.messages[1].reasoning, reasoning, "跟读接回先前已暖的行迹");
    assert.equal(a.chatJson(current) === json, status === "complete", "未收尾的答接回行迹后，落盘正文不再相同");
    assert.equal(records.has(key), status !== "complete", "只有跟读结果等于磁盘版才清暂存");
    assert.equal((await post("chats/load")).items[0].savedAt, at + 1000, "持有远端租约时没有写回");
    assert.ok(serializations <= 3, `全量跟读最多序列化三次，实际 ${serializations} 次`);
  });

test("全量跟读保留正作答的对话与答复对象，并写回双方改动", async t => {
  const { post, page } = await fixture(t);
  const base = conversation("旧题"),
    at = Date.now() - 3000;
  base.messages.push({ id: "reply", role: "assistant", status: "streaming", content: "正在写" });
  await post("chats/save", { conversation: base, savedAt: at });
  const a = page();
  await a.sync();
  const live = a.store.conversations[0],
    reply = live.messages[1];
  reply.content = "这一页还在往下写";
  a.requestJobs.set(live.id, { conversationId: live.id });
  await a.syncLeases();
  await post("chats/save", { conversation: { ...base, pinned: true }, base: at, savedAt: at + 1000 });
  await a.sync();

  assert.equal(a.store.conversations[0], live);
  assert.equal(live.messages[1], reply);
  const disk = (await post("chats/load")).items[0].conversation;
  assert.equal(disk.pinned, true);
  assert.equal(disk.messages[1].content, "这一页还在往下写");
});

test("离页直接暂存待写与在途对话，空闲对话仍用指纹兜住未标脏的改动", async t => {
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  const { post, page, records, chats, keyOf } = await fixture(t, {
    intercept: async (route, options, send) => {
      if (route === "/api/chats/save" && JSON.parse(options.body).conversation.id === "active") {
        entered.resolve();
        await release.promise;
      }
      return send();
    }
  });
  const ids = ["clean", "dirty", "pending", "active", "deleted"],
    at = Date.now() - 3000;
  for (const id of ids) await post("chats/save", { conversation: { ...conversation(id), id }, savedAt: at });
  const a = page();
  await a.sync();
  const get = id => a.store.conversations.find(c => c.id === id),
    baseJson = new Map(ids.map(id => [id, a.chatJson(get(id))]));
  const writing = a.flushImportedConversations(["active"]);
  try {
    await entered.promise;
    a.pendingChatWrites.set("pending", { force: true });
    get("dirty").title = "没标脏的新题";
    get("deleted").title = "不暂存待删的对话";
    a.pendingChatDeletes.set("deleted", at + 1000);
    const counts = countChatJson(t, ids);
    a.flushOnUnload();
    await new Promise(setImmediate);
    const serializations = [...counts.values()].reduce((sum, count) => sum + count, 0);
    t.diagnostic(`五种状态合计整段 JSON.stringify ${serializations} 次`);

    assert.equal(records.size, 3);
    for (const id of ["active", "pending", "dirty"]) {
      const row = records.get(keyOf([chats, id]));
      assert.equal(row?.baseJson, baseJson.get(id), `${id} 暂存保留磁盘基准`);
      assert.deepEqual(JSON.parse(row.json), JSON.parse(a.chatJson(get(id))), `${id} 暂存当前正文`);
    }
    assert.ok(serializations <= 5, `离页快照最多序列化五次，实际 ${serializations} 次`);
  } finally {
    release.resolve();
    await writing;
  }
});

test("定向读只短路已见、同版本且唯一的标准文件；取消条件时仍取全份", async t => {
  const { post, page, chats } = await fixture(t);
  const c = conversation("看旧对话"),
    savedAt = Date.now() - 3000,
    { file } = await post("chats/save", { conversation: c, savedAt }),
    target = path.join(chats, file),
    query = { ids: [c.id], known: { [c.id]: savedAt } };
  const a = page();
  await a.sync();
  const readFile = fs.readFileSync;
  let reads = 0;
  t.mock.method(fs, "readFileSync", (name, ...args) => {
    if (name === target) reads += 1;
    return readFile(name, ...args);
  });

  await a.catchUpFromDisk([c.id]);
  assert.equal(reads, 0, "回前台读旧对话，不重读磁盘正文");
  assert.deepEqual((await post("chats/load", query)).items, []);
  assert.equal(reads, 0);
  assert.equal((await post("chats/load", { ids: query.ids })).items[0].savedAt, savedAt);
  assert.equal((await post("chats/load", { known: query.known })).items[0].savedAt, savedAt, "启动与重连全量不条件读");
  assert.equal(reads, 2);

  // 同名短码还可能有改名前留下的文件；平时的去重不能被「已见到一份」吞掉。
  const newer = { ...c, title: "已经换题" },
    duplicate = path.join(chats, file.replace(c.title, newer.title));
  fs.writeFileSync(duplicate, JSON.stringify({ 言: "对话", version: 1, savedAt: savedAt + 1, conversation: newer }));
  assert.equal((await post("chats/load", query)).items[0].conversation.title, newer.title);
  assert.equal(reads, 3);
  assert.equal(fs.existsSync(target), false, "仍清理较旧文件");
  await a.catchUpFromDisk([c.id]);
  assert.equal(a.store.conversations[0].title, newer.title, "真正更新照旧跟上");
});

test("定向读不能仅凭文件名或 savedAt 省正文", async t => {
  const { post, chats } = await fixture(t);
  const c = conversation("旧版或手动整理"),
    savedAt = Date.now() - 3000,
    { file } = await post("chats/save", { conversation: c, savedAt }),
    target = path.join(chats, file),
    query = { ids: [c.id], known: { [c.id]: savedAt } };
  for (const doc of [
    { version: 1, savedAt, conversation: c },
    { 言: "对话", version: 1, savedAt: savedAt + 0.5, conversation: c },
    { 言: "对话", version: 1, savedAt, conversation: { ...c, id: "不是这一段" } },
    { 言: "对话", version: 1, savedAt, conversation: { title: c.title, ...c } }
  ]) {
    fs.writeFileSync(target, JSON.stringify(doc));
    const { items } = await post("chats/load", query);
    assert.equal(items.length, 1);
    assert.equal(items[0].savedAt, doc.savedAt);
    assert.deepEqual(items[0].conversation, doc.conversation);
  }
  fs.writeFileSync(target, `{"言":"对话","version":1,"savedAt":${savedAt},"conversation":`);
  assert.equal((await post("chats/load", query)).skipped, 1);
});

test("批量跟读短路的标准文件仍压过别的短码下放错的副本", async t => {
  const { post, chats } = await fixture(t);
  const a = conversation("标准文件"),
    b = { ...conversation("错放副本的位置"), id: "c2" },
    savedAt = Date.now() - 3000;
  await post("chats/save", { conversation: a, savedAt });
  const { file } = await post("chats/save", { conversation: b, savedAt });
  fs.writeFileSync(
    path.join(chats, file),
    JSON.stringify({ 言: "对话", version: 1, savedAt: savedAt + 1, conversation: { ...a, title: "误放的副本" } })
  );
  const ids = [a.id, b.id];
  assert.deepEqual(
    (await post("chats/load", { ids })).items.map(item => item.conversation.title),
    [a.title]
  );
  assert.deepEqual((await post("chats/load", { ids, known: { [a.id]: savedAt, [b.id]: savedAt } })).items, []);
  assert.ok(fs.existsSync(path.join(chats, file)), "用户的错名副本仍不删");
});

function assertOriginal(files, id, present = true) {
  for (const extension of ["txt", "json"])
    assert.equal(fs.existsSync(path.join(files, `${id}.${extension}`)), present, `${id}.${extension}`);
}

const withFile = (c, id) => ({ ...c, messages: [{ ...c.messages[0], attachments: [{ id, name: `${id}.txt`, kind: "text" }] }] });

test("补删保留时重读快照后写入的新版本；暂存库不可用也恢复对话和引用", async t => {
  let update,
    targeted = 0;
  const { post, page, oldFile, files, faults } = await fixture(t, {
    attachments: true,
    intercept: async (route, options, send) => {
      if (route === "/api/chats/delete") await update();
      if (route === "/api/chats/load" && JSON.parse(options.body).ids) targeted++;
      return send();
    }
  });
  const before = conversation("删除前"),
    latest = withFile(conversation("快照之后写成"), "used"),
    now = Date.now();
  oldFile("used");
  oldFile("unused");
  await post("chats/save", { conversation: before, savedAt: now - 3000 });
  update = () => post("chats/save", { conversation: latest, savedAt: now - 1000 });
  faults.db = true;
  const f = page();
  f.pendingChatDeletes.set(before.id, now - 2000);
  await f.sync();
  assert.equal(targeted, 1);
  assert.equal(f.store.conversations[0]?.title, latest.title);
  assert.equal(f.pendingChatDeletes.size, 0, "不再补删磁盘");
  assert.equal(f.discardedChatSpills.size, 1, "只留本机清理记号");
  assertOriginal(files, "used");
  assertOriginal(files, "unused", true); // 读不了暂存，不能断定没有新版引用。
  faults.db = false;
  await f.sync();
  assertOriginal(files, "used");
  assertOriginal(files, "unused", false);
});

for (const trouble of ["删除回包断流", "定向读取缺正文"]) {
  test(`${trouble}时只推附件暂存，等完整回包再清原件`, async t => {
    let fail = true;
    const { post, page, oldFile, files, shelf } = await fixture(t, {
      attachments: true,
      intercept: async (route, options, send) => {
        const response = await send();
        if (fail && route === "/api/chats/delete" && trouble === "删除回包断流") {
          await response.body.cancel();
          return { ok: true, status: 200, json: () => Promise.reject(Error("正文断流")) };
        }
        if (fail && route === "/api/chats/load" && JSON.parse(options.body).ids && trouble === "定向读取缺正文") {
          await response.body.cancel();
          return Response.json({ items: [], skipped: 1 });
        }
        return response;
      }
    });
    oldFile("used");
    oldFile("unused");
    shelf.set("queued", { id: "queued", name: "queued.txt", kind: "text", data: "暂存附件" });
    const c = withFile(conversation("明确保留前不能清它的附件"), "used"),
      now = Date.now();
    await post("chats/save", { conversation: c, savedAt: now - 1000 });
    const f = page();
    f.pendingChatDeletes.set(c.id, now - 2000);
    await f.sync();
    assert.equal(f.pendingChatDeletes.size, 1);
    assert.deepEqual(f.store.conversations, []);
    assertOriginal(files, "used");
    assertOriginal(files, "unused");
    assertOriginal(files, "queued");
    assert.equal(shelf.size, 0, "暂存照常推进");
    fail = false;
    await f.sync();
    assert.equal(f.store.conversations[0]?.title, c.title);
    assert.equal(f.pendingChatDeletes.size, 0);
    assertOriginal(files, "used");
    assertOriginal(files, "unused", false);
  });
}

for (const kept of [false, true]) {
  test(`${kept ? "磁盘保留" : "补删返回 removed: 0"}后浏览器事务中止，刷新不读回旧暂存`, async t => {
    const { post, page, records, faults } = await fixture(t),
      stale = conversation("旧 IndexedDB 暂存"),
      latest = conversation("磁盘正本"),
      now = Date.now();
    if (kept) await post("chats/save", { conversation: latest, savedAt: now - 1000 });
    const initial = page();
    initial.pendingChatDeletes.set(stale.id, now - 2000);
    records.set(stale.id, { id: stale.id, savedAt: now - 3000, json: JSON.stringify(stale) });
    faults.abort = true;
    await initial.sync();
    assert.equal(initial.pendingChatDeletes.size, 0);
    assert.ok(records.has(stale.id), "事务未提交，旧行还在");
    assert.deepEqual(
      initial.store.conversations.map(c => c.title),
      kept ? [latest.title] : []
    );
    page().savePreferences(); // 不知删除记号的别页另存配置，也不能把记号冲掉。
    const reopened = page();
    await reopened.hydrateStore();
    assert.deepEqual(reopened.store.conversations, [], "重开时旧行不进入内存");
    faults.abort = false;
    await reopened.sync();
    assert.equal(records.size, 0);
    assert.equal(reopened.discardedChatSpills.size, 0);
    assert.deepEqual(
      (await post("chats/load")).items.map(item => item.conversation.title),
      kept ? [latest.title] : []
    );
  });
}

test("挂起的旧根补删回包不能挡住新根同步或用于新根清扫", async t => {
  const started = Promise.withResolvers(),
    release = Promise.withResolvers(),
    cleans = [];
  const { page, chats, post, records } = await fixture(t, {
    attachments: true,
    intercept: async (route, options, send) => {
      const body = JSON.parse(options.body);
      if (route === "/api/chats/delete" && body.root === chats) {
        const result = await send();
        started.resolve();
        await release.promise;
        return result;
      }
      if (route === "/api/files/clean") cleans.push(body);
      return send();
    }
  });
  const f = page(),
    nextRoot = path.join(path.dirname(chats), "next"),
    nextChats = path.join(nextRoot, "chats"),
    old = conversation("旧根对话"),
    next = conversation("新根里同 ID 的对话"),
    now = Date.now();
  await post("chats/save", { conversation: old, savedAt: now - 2000 });
  await post("chats/save", { root: nextChats, conversation: next, savedAt: now - 2000 });
  f.pendingChatDeletes.set(old.id, now - 1000);
  const previous = f.sync();
  try {
    await started.promise;
    f.bootstrap.store = { root: nextRoot };
    f.bootstrap.work = { chats: nextChats };
    await f.sync();
    assert.deepEqual(
      f.store.conversations.map(c => c.title),
      [next.title]
    );
  } finally {
    release.resolve();
    await previous;
  }
  assert.deepEqual(
    f.store.conversations.map(c => c.title),
    [next.title]
  );
  assert.deepEqual(
    cleans.map(body => body.root),
    [nextRoot]
  );
});

test("在线删除也要等对话裁定；确认删除才立即除去附件", async t => {
  const deletedFiles = [];
  const { post, page, oldFile, files } = await fixture(t, {
    attachments: true,
    intercept: (route, options, send) => {
      if (route === "/api/files/delete") deletedFiles.push(...JSON.parse(options.body).ids);
      return send();
    }
  });
  const kept = withFile(conversation("别页已存新版"), "used"),
    removed = withFile({ ...conversation("确认删成"), id: "c2" }, "unused");
  oldFile("used");
  oldFile("unused");
  await post("chats/save", { conversation: kept, savedAt: Date.now() + 20000 });
  await post("chats/save", { conversation: removed, savedAt: Date.now() - 20000 });
  const f = page();
  await f.sync();
  f.store.conversations = [];
  await f.deleteStoredConversations([
    [kept.id, ["used"]],
    [removed.id, ["unused"]]
  ]);
  assert.equal(f.store.conversations[0]?.title, kept.title);
  assert.deepEqual(deletedFiles, ["unused"]);
  assertOriginal(files, "used");
  assertOriginal(files, "unused", false);
});

test("补删保留后，浏览器才有的新版与它引用的附件经两轮同步仍在", async t => {
  const { post, page, files, oldFile, records, chats } = await fixture(t, { attachments: true });
  const now = Date.now(),
    original = conversation("删除前"),
    disk = { ...original, title: "别页写到磁盘" },
    staged = withFile({ ...original, title: "后来的浏览器暂存" }, "staged");
  oldFile("staged");
  await post("chats/save", { conversation: disk, savedAt: now - 1000 });
  const f = page();
  f.pendingChatDeletes.set(disk.id, now - 2000);
  records.set(disk.id, { id: disk.id, dir: chats, savedAt: now - 100, json: JSON.stringify(staged), baseJson: JSON.stringify(original) });
  await f.sync();
  assertOriginal(files, "staged");
  assert.equal(f.store.conversations[0]?.title, staged.title);
  await f.sync();
  assert.equal((await post("chats/load")).items[0]?.conversation.title, staged.title);
  assertOriginal(files, "staged");
});

test("旧根已确认的删除也不能丢掉另一根同 ID 的较早暂存", async t => {
  const { post, page, records, chats, faults } = await fixture(t),
    now = Date.now(),
    nextRoot = path.join(path.dirname(chats), "next"),
    nextChats = path.join(nextRoot, "chats"),
    base = conversation("新根磁盘版"),
    local = { ...base, title: "新根浏览器版" };
  const a = page();
  faults.abort = true;
  a.pendingChatDeletes.set(base.id, now - 1000);
  await a.sync();
  assert.equal(a.discardedChatSpills.size, 1);
  assert.equal(a.pendingChatDeletes.size, 0);
  await post("chats/save", { root: nextChats, savedAt: now - 3000, conversation: base });
  records.set(base.id, { id: base.id, dir: nextChats, savedAt: now - 2000, json: JSON.stringify(local), baseJson: JSON.stringify(base) });
  const b = page();
  b.bootstrap.store = { root: nextRoot };
  b.bootstrap.work = { chats: nextChats };
  faults.abort = false;
  await b.hydrateStore();
  await b.sync();
  assert.equal((await post("chats/load", { root: nextChats })).items[0]?.conversation.title, local.title);
});

for (const receipt of [200, 409, 410, 400])
  test(`接用已有根：旧保存的 ${receipt} 回执既不并入新对话，也不清新根的同 ID 暂存`, async t => {
    const entered = Promise.withResolvers(),
      release = Promise.withResolvers();
    const requests = [];
    let held = false;
    const { post, page, records, chats, keyOf } = await fixture(t, {
      intercept: async (route, options, send) => {
        const body = JSON.parse(options.body);
        if (route === "/api/chats/save") {
          requests.push(body);
          if (!held && body.root === chats && body.conversation.title === "A 待写") {
            held = true;
            entered.resolve();
            await release.promise;
            return Response.json(
              receipt === 409
                ? { item: { id: "c1", savedAt: Date.now(), conversation: conversation("A 冲突") } }
                : { error: receipt === 410 ? "这段对话已在别处删除" : "临时失败" },
              { status: receipt }
            );
          }
        }
        return send();
      }
    });
    const a = page(),
      aRoot = a.bootstrap.store.root,
      bRoot = path.join(aRoot, "B"),
      bDir = path.join(bRoot, "chats"),
      now = Date.now();
    const target = conversation("B 正本"),
      before = conversation("A 正本");
    await post("chats/save", { conversation: before, savedAt: now - 2000 });
    await post("chats/save", { conversation: { ...before, id: "a-only" }, savedAt: now - 2000 });
    await post("chats/save", { root: bDir, conversation: target, savedAt: now - 2000 });
    const bOnly = { ...conversation("B 独有暂存"), id: "b-only" };
    records.set(bOnly.id, { id: bOnly.id, dir: bDir, savedAt: now - 1000, json: a.chatJson(bOnly) });
    await a.sync();
    a.store.conversations.find(c => c.id === before.id).title = "A 待写";
    const writing = a.flushImportedConversations([before.id]);
    try {
      await entered.promise;
      a.pendingChatDeletes.set("a-only", now - 1000);
      await a.switchStoreRoot({ adopted: true, root: bRoot, chats: bDir });
      assert.deepEqual(a.store.conversations.map(c => c.title).sort(), ["B 正本", "B 独有暂存"].sort());
      const staged = { ...target, title: "B 另一页新暂存" };
      records.set(keyOf([bDir, target.id]), { id: [bDir, target.id], dir: bDir, savedAt: now + 1000, json: a.chatJson(staged) });
    } finally {
      release.resolve();
      await writing;
    }
    assert.equal(a.store.conversations.find(c => c.id === target.id).title, target.title);
    assert.equal(JSON.parse(records.get(keyOf([bDir, target.id])).json).title, "B 另一页新暂存");
    assert.equal(JSON.parse(records.get(keyOf([chats, target.id])).json).title, "A 待写");
    assert.ok(requests.filter(body => body.root === bDir).every(body => !body.conversation.title.startsWith("A")));
    await a.switchStoreRoot({ adopted: true, root: aRoot, chats });
    assert.equal(a.store.conversations.find(c => c.id === before.id).title, "A 待写");
    await a.sync();
  });

for (const variant of ["different", "cold", "same", "foreign"])
  test(`普通写回执按同根正文核对当前暂存：${variant}`, async t => {
    const entered = Promise.withResolvers(),
      release = Promise.withResolvers();
    let written;
    const { post, page, records, chats, keyOf } = await fixture(t, {
      intercept: async (route, options, send) => {
        if (route !== "/api/chats/save") return send();
        written = JSON.parse(options.body).conversation;
        const answer = await send();
        entered.resolve();
        await release.promise;
        return answer;
      }
    });
    const before = conversation("磁盘旧题");
    if (variant === "cold")
      before.messages.push({ id: "reply", role: "assistant", status: "complete", content: "正文", cold: { key: "legacy-pointer" } });
    await post("chats/save", { conversation: before, savedAt: Date.now() - 1000 });
    const b = page();
    await b.sync();
    b.store.conversations[0].pinned = true;
    const pending = b.flushImportedConversations([before.id]);
    let key;
    try {
      await entered.promise;
      const after = structuredClone(written),
        dir = variant === "foreign" ? chats + "-other" : chats;
      if (variant === "different") after.title = "另一页最新改名";
      if (variant === "cold") {
        delete after.messages[1].cold;
        after.messages[1].reasoning = "仅浏览器有的冷正文";
      }
      const id = [dir, after.id];
      key = keyOf(id);
      records.set(key, { id, dir, savedAt: Date.now() + 1000, baseJson: b.chatJson(before), json: b.chatJson(after) });
    } finally {
      release.resolve();
      await pending;
    }
    assert.equal(records.has(key), variant !== "same");
  });

test("拷贝到空根仍迁递本页未落盘的内容；重新接用原根仍读回原根暂存", async t => {
  const { post, page, records, chats, keyOf } = await fixture(t);
  const a = page(),
    aRoot = a.bootstrap.store.root,
    bRoot = path.join(aRoot, "B"),
    bDir = path.join(bRoot, "chats");
  const before = conversation("A 正本");
  const at = Date.now() - 1000;
  await post("chats/save", { conversation: before, savedAt: at });
  await post("chats/save", { root: bDir, conversation: before, savedAt: at }); // 磁盘拷贝看到的是 A 旧正本。
  await a.sync();
  a.store.conversations[0].title = "只在内存的改名";
  await a.switchStoreRoot({ adopted: false, root: bRoot, chats: bDir });
  assert.equal(JSON.parse(records.get(keyOf([chats, before.id])).json).title, "只在内存的改名");
  await a.sync();
  assert.equal((await post("chats/load", { root: bDir })).items[0].conversation.title, "只在内存的改名");
  assert.equal((await post("chats/load")).items[0].conversation.title, "A 正本");
  await a.switchStoreRoot({ adopted: true, root: aRoot, chats });
  assert.equal(a.store.conversations[0].title, "只在内存的改名");
  await a.sync();
  assert.equal((await post("chats/load")).items[0].conversation.title, "只在内存的改名");
});

test("旧字符串键、无目录旧离线删除和带目录暂存只进归属根一次", async t => {
  const { post, page, records, chats, keyOf, local } = await fixture(t);
  const a = page(),
    aRoot = a.bootstrap.store.root,
    bRoot = path.join(aRoot, "B"),
    bDir = path.join(bRoot, "chats"),
    now = Date.now();
  const before = conversation("A 磁盘题"),
    edited = { ...before, title: "老带目录行改的题" };
  await post("chats/save", { conversation: before, savedAt: now - 3000 });
  await post("chats/save", { root: bDir, conversation: { ...before, title: "B 磁盘题" }, savedAt: now - 3000 });
  local.set("yan-store-root", aRoot);
  local.set("yan-chat-delete:old-deleted", JSON.stringify({ at: now - 1000 }));
  const removed = { ...before, id: "old-deleted" };
  await post("chats/save", { conversation: removed, savedAt: now - 2000 });
  await post("chats/save", { root: bDir, conversation: removed, savedAt: now - 2000 });
  records.set(before.id, { id: before.id, dir: chats, savedAt: now - 1000, baseJson: a.chatJson(before), json: a.chatJson(edited) });
  const key = keyOf([chats, before.id]);
  records.set(key, {
    id: [chats, before.id],
    dir: chats,
    savedAt: now - 500,
    baseJson: a.chatJson(before),
    json: a.chatJson({ ...before, pinned: true })
  });
  await a.hydrateStore();
  assert.equal(records.has(before.id), false, "升级到复合键不能留下重复行");
  await a.sync();
  let disk = (await post("chats/load")).items;
  assert.equal(disk.length, 1);
  assert.equal(disk[0].conversation.title, edited.title);
  assert.equal(disk[0].conversation.pinned, true);
  await a.switchStoreRoot({ adopted: true, root: bRoot, chats: bDir });
  assert.equal(a.store.conversations.length, 2);
  assert.equal(a.store.conversations.find(c => c.id === before.id).title, "B 磁盘题");
  await a.switchStoreRoot({ adopted: true, root: aRoot, chats });
  await a.sync();
  disk = (await post("chats/load")).items;
  assert.equal(disk.length, 1);
  assert.equal(disk[0].conversation.title, edited.title);
  assert.equal(records.size, 0);
});
