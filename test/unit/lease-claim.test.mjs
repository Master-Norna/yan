import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const createChats = createRequire(import.meta.url)("../../server/chats.js");

test("两页同时认领同一段对话：先到的得手，后到的看见它已有主、自己的报到不记", async () => {
  const lease = createChats({ chatsHome: () => "" }).routes["POST /api/chats/lease"];
  const server = http.createServer((req, res) => lease(req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = body =>
    fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  try {
    const first = await post({ owner: "A", ids: ["c"], claim: "c" });
    const second = await post({ owner: "B", ids: ["c"], claim: "c" });
    assert.deepEqual(first.busy, []);
    assert.deepEqual(second.busy, ["c"]);
    // B 让开了：A 的报到里看不到 B 握着 c
    assert.deepEqual((await post({ owner: "A", ids: ["c"] })).busy, []);
  } finally {
    server.close();
  }
});

test("不同页面相交目录的退回与开工互斥，普通并行与不相交目录仍可认领", async () => {
  const lease = createChats({ chatsHome: () => "" }).routes["POST /api/chats/lease"];
  const server = http.createServer((req, res) => lease(req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = body =>
    fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  const claim = (owner, id, root, rewind = false) => post({ owner, ids: [id], claim: id, scopes: { [id]: { root, rewind } } });
  try {
    assert.equal((await claim("A", "a", "/project")).blocked, undefined);
    assert.equal((await claim("B", "b", "/project/sub")).blocked, undefined, "普通并行不拦");
    assert.equal((await claim("C", "c", "/project", true)).blocked, true, "写入在途不退回");
    await post({ owner: "A", ids: [] });
    await post({ owner: "B", ids: [] });
    assert.equal((await claim("C", "c", "/project", true)).blocked, undefined);
    assert.equal((await claim("A", "a", "/project/sub")).blocked, true, "退回在途不启动相交目录");
    assert.equal((await claim("D", "d", "/project-other")).blocked, undefined, "不相交目录不拦");
    await post({ owner: "C", ids: [] });
    assert.equal((await claim("A", "a", "/project/sub")).blocked, undefined, "松手后可启动");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("真实目录与链接别名的租约互斥，尚未建立的子目录也按真实父目录比较", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-lease-")),
    root = path.join(base, "work"),
    alias = path.join(base, "alias");
  fs.mkdirSync(root);
  const lease = createChats({ chatsHome: () => "" }).routes["POST /api/chats/lease"];
  const server = http.createServer((req, res) => lease(req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = body =>
    fetch(`http://127.0.0.1:${server.address().port}/`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  const claim = (owner, id, root, rewind = false) => post({ owner, ids: [id], claim: id, scopes: { [id]: { root, rewind } } });
  try {
    fs.symlinkSync(root, alias, "junction");
    assert.equal((await claim("A", "a", path.join(alias, "future"))).blocked, undefined);
    assert.equal((await claim("B", "b", root, true)).blocked, true);
    await post({ owner: "A", ids: [] });
    assert.equal((await claim("B", "b", root, true)).blocked, undefined);
    assert.equal((await claim("A", "a", alias)).blocked, true);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  }
});
