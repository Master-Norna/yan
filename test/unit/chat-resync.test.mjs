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
const nativeFetch = globalThis.fetch;

async function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-chat-resync-")),
    chats = path.join(home, "chats"),
    { routes } = createChats({ chatsHome: () => chats }),
    server = http
      .createServer((req, res) => {
        const route = routes[`${req.method} ${new URL(req.url, "http://127.0.0.1").pathname}`];
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
  t.mock.method(globalThis, "fetch", (route, options) => nativeFetch(origin + route, options));
  const records = new Map();
  const request = result => {
    const req = { result };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  const db = {
    transaction: name => ({
      objectStore: () =>
        name === "conversations"
          ? {
              getAll: () => request([...records.values()]),
              put: record => {
                records.set(record.id, structuredClone(record));
                return request(record.id);
              },
              delete: id => request(records.delete(id))
            }
          : { get: () => request(undefined) }
    })
  };
  const page = () => {
    const f = load([
      "store",
      "bootstrap",
      "hydrateStore",
      "flushOnUnload",
      "syncChatsWithDisk",
      "catchUpFromDisk",
      "remoteBusy",
      `install: db => {
        stateDb = db;
        stateDbPromise = Promise.resolve(db);
        writeMeta = renderHeader = renderHistory = toast = () => {};
        settleAttachmentStore = async () => {};
        return () => Promise.all([...chatWritePromises.values()]);
      }`
    ]);
    f.bootstrap.work = { chats };
    const idle = f.install(db);
    return {
      ...f,
      sync: async () => {
        await f.syncChatsWithDisk();
        await idle();
      }
    };
  };
  return { post, page, records, chats };
}

const conversation = title => ({
  id: "c1",
  title,
  messages: [{ id: "question", role: "user", content: "问题", attachments: [] }],
  forks: [],
  threads: []
});

test("离页暂存比磁盘更新晚，重新开页也不丢磁盘上的答复", async t => {
  const { post, page, records } = await fixture(t);
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
  const record = records.get(base.id);
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
  const { post, page, records } = await fixture(t);
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
  assert.ok(records.has(base.id), "被租约挡住的本地改动还在暂存表里");
  reopened.remoteBusy.delete(base.id);
  await reopened.sync();
  assert.equal((await post("chats/load")).items[0].conversation.title, "还没落盘的新题");
  assert.equal(records.size, 0);
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
