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
  return { post, page, records };
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
