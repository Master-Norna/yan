// 导入走真实的配置／对话／附件保存路径。桥接响应和浏览器事务由测试控制。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const chat = id => ({ id, title: id, messages: [{ id: "u", role: "user", content: "早" }] });
const file = id => ({ id, kind: "text", name: `${id}.txt`, data: id });
const response = (body, status = 200) => Response.json(body, { status });
const denied = () => response({ error: "磁盘写入失败" }, 400);

function setup(t, { remote, noLocal = false, commit = () => true, attachments = [], incomingChats = [chat("c1")], config = true } = {}) {
  const notes = [],
    requests = [],
    transactions = [],
    saved = new Map();
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = url.split("?")[0];
    let id;
    if (path === "/api/chats/save") id = JSON.parse(options.body).conversation.id;
    if (path === "/api/files/put") {
      const head = Number(new URL(url, "http://localhost").searchParams.get("head"));
      id = JSON.parse(await options.body.slice(0, head).text()).record.id;
    }
    requests.push({ path, id });
    return remote?.(path, id) || (path === "/api/files/get" ? response({ error: "没有原件" }, 404) : response({}));
  });
  const db = {
    transaction(name, mode) {
      let wrote = false;
      const tx = {
        objectStore: () => ({
          put: value => request(value.id, value),
          get: id => {
            const req = { result: saved.get(`${name}:${id}`) };
            queueMicrotask(() => req.onsuccess?.());
            return req;
          },
          delete: id => request(id, null)
        })
      };
      if (mode === "readwrite")
        setImmediate(() => {
          if (!wrote) tx.oncomplete?.();
        });
      function request(id, value) {
        wrote = true;
        const key = `${name}:${id}`,
          req = { result: mode === "readonly" ? saved.get(key) : id };
        queueMicrotask(() => {
          req.onsuccess?.();
          if (mode === "readonly") return;
          const finish = ok => {
            if (!ok) return tx.onabort?.();
            if (value === null) saved.delete(key);
            else saved.set(key, value);
            tx.oncomplete?.();
          };
          if (value === null) return finish(true);
          transactions.push({ key, finish });
          const ok = commit(id);
          if (ok !== undefined) finish(ok);
        });
        return req;
      }
      return tx;
    }
  };
  const page = load([
    "importData",
    "pendingChatDeletes",
    "STORE_VERSION",
    `current: () => store`,
    `baseMemory: (item) => {
      store.memory.items = [item];
      const baseline = JSON.parse(JSON.stringify(metaOf()));
      rememberConfigBase(JSON.stringify(baseline), 1);
      return baseline;
    }`,
    `prepare: ({db, notes, noLocal}) => {
      bootstrap.store = { root: "test" };
      bootstrap.work = { chats: "test/chats", files: "test/files" };
      store.conversations = [];
      openStateDb = openFileDb = async () => db;
      render = renderSettings = () => {};
      toast = text => notes.push(text);
      localStorage = { setItem: () => { if (noLocal) throw Error("quota"); } };
      readFile = async file => file.text();
    }`
  ]);
  page.prepare({ db, notes, noLocal });
  const data = {
    version: page.STORE_VERSION,
    conversations: incomingChats,
    settings: config ? { groups: [{ id: "g1", name: "新组" }] } : {},
    attachments
  };
  const backup = new Blob([JSON.stringify(data)]);
  return { page, notes, requests, transactions, saved, data, run: (input = backup) => page.importData(input) };
}

const notified = notes => notes.some(text => /^(已写入存储目录|已在此浏览器暂存|只留在本页)/.test(text));
const deny =
  (...routes) =>
  path =>
    routes.includes(path) ? denied() : null;

test("配置已落盘，仍要等本批对话的在途保存失败和浏览器事务提交", async t => {
  const writing = Promise.withResolvers();
  const f = setup(t, { remote: path => (path === "/api/chats/save" ? writing.promise : null), commit: () => undefined });
  const done = f.run();
  await new Promise(setImmediate);
  assert.ok(f.requests.some(r => r.path === "/api/store/config/save"));
  assert.ok(f.requests.some(r => r.path === "/api/chats/save"));
  assert.equal(notified(f.notes), false);
  writing.resolve(denied());
  await new Promise(setImmediate);
  assert.equal(f.transactions.length, 1);
  assert.equal(notified(f.notes), false, "put.onsuccess 不等于事务提交");
  f.transactions[0].finish(true);
  await done;
  assert.match(f.notes.at(-1), /已写入存储目录：配置.*已在此浏览器暂存：1 段对话/);
  assert.ok(f.saved.has("conversations:test/chats,c1"));
});

test("配置落盘成功也不能盖住对话事务中止；附件恢复失败和已写成的原件分开报", async t => {
  const f = setup(t, {
    attachments: [file("a1"), file("a2")],
    commit: () => false,
    remote: (path, id) => (path === "/api/chats/save" || id === "a1" ? denied() : null)
  });
  await f.run();
  assert.match(f.notes.at(-1), /已写入存储目录：1 件附件原件、配置.*只留在本页：1 段对话.*请先别关闭页面.*1 件附件原件未能恢复/);
  assert.equal(f.page.current().conversations.length, 1);
  assert.equal(f.saved.size, 0);
  assert.ok(!f.notes.some(text => text.includes("先暂存在浏览器里")), "暂存失败时不得先说已经暂存");
});

test("配置只在缓存、附件只在 IndexedDB 时分别按浏览器暂存算", async t => {
  const f = setup(t, { attachments: [file("a1")], remote: deny("/api/store/config/save", "/api/files/put") });
  await f.run();
  assert.match(f.notes.at(-1), /已写入存储目录：1 段对话；已在此浏览器暂存：1 件附件原件、配置/);
  assert.ok(f.saved.has("attachments:a1"));
});

test("配置缓存失败也照实说只留在本页", async t => {
  const f = setup(t, { noLocal: true, incomingChats: [], remote: deny("/api/store/config/save") });
  await f.run();
  assert.match(f.notes.at(-1), /^只留在本页：配置.*请先别关闭页面/);
});

test("大备份截断时，按实报读完且写成的原件", async t => {
  const f = setup(t, { config: false });
  const bytes = new TextEncoder().encode(`${JSON.stringify(f.data).replace(/\[\]\}$/, `[${JSON.stringify(file("a1"))}, {`)}`);
  await f.run({ size: 128 * 1024 * 1024, arrayBuffer: async () => bytes.buffer });
  assert.match(f.notes.at(-1), /已写入存储目录：1 段对话、1 件附件原件；未能读完备份：备份文件不完整/);
});

test("在等删除裁定的同 ID 对话不计入本轮导入", async t => {
  const f = setup(t, { config: false });
  f.page.pendingChatDeletes.set("c1", Date.now());
  await f.run();
  assert.deepEqual(f.page.current().conversations, []);
  assert.equal(f.requests.length, 0);
  assert.equal(f.notes.at(-1), "1 段对话尚在等删除确认，未导入");
});

test("并发落盘保留别页记忆时，导入未保留的同类文字不算写成", async t => {
  let latest,
    conflict = true;
  const f = setup(t, {
    incomingChats: [],
    config: false,
    remote: path => {
      if (path !== "/api/store/config/save" || !conflict) return null;
      conflict = false;
      return response({ config: latest, savedAt: 2 }, 409);
    }
  });
  const item = { id: "m1", category: "笔记", text: "共同起点", updatedAt: "2026-01-01T00:00:00Z" };
  latest = f.page.baseMemory(item);
  latest.memory.items[0].text = "别人先保存了";
  f.data.memory = { items: [{ ...item, text: "备份里的新句" }] };
  await f.run(new Blob([JSON.stringify(f.data)]));
  assert.equal(f.page.current().memory.items[0].text, "别人先保存了");
  assert.equal(f.notes.at(-1), "1 类记忆与存储目录里的版本冲突，未并入");
});

test("行迹另存成功而对话写盘失败，浏览器仍得到完整的思绪而不是磁盘指针", async t => {
  const c = chat("c1"),
    reasoning = "思".repeat(20000);
  c.messages.push({ id: "r", role: "assistant", status: "complete", content: "回话", reasoning });
  const f = setup(t, { config: false, incomingChats: [c], remote: deny("/api/chats/save") });
  await f.run();
  assert.ok(f.requests.some(r => r.path === "/api/chats/trail/put"));
  const saved = JSON.parse(f.saved.get("conversations:test/chats,c1").json).messages[1];
  assert.equal(saved.reasoning, reasoning);
  assert.equal(saved.cold, undefined);
  assert.match(f.notes.at(-1), /^已在此浏览器暂存：1 段对话/);
});

test("导入附件遇到桥接换根，停止而不跨根写入或回退暂存", async t => {
  const f = setup(t, {
    config: false,
    attachments: [file("a1")],
    remote: path => {
      if (path === "/api/files/put") return response({ error: "附件未能落盘：存储位置已变化，请刷新页面后重试" }, 400);
    }
  });
  await f.run();
  assert.deepEqual(
    f.requests.map(r => r.path),
    ["/api/files/get", "/api/files/put"]
  );
  assert.equal(f.notes.at(-1), "导入期间存储位置已变化，请检查已保存的内容");
  assert.equal(f.saved.size, 0);
});
