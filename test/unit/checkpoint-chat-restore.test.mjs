// 检查点与对话共用删除记录：删除后的迟到请求不落册，从备份恢复同一 id 后的新答立即可以拍。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createChats = require("../../server/chats.js"),
  createCheckpoints = require("../../server/checkpoints.js");

test("真实对话删除记录：迟到拍摄不收，恢复同一 id 后立即收新答", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-restore-")),
    root = path.join(base, "work");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "a.txt"), "原件");
  const chats = createChats({ chatsHome: () => path.join(base, "对话"), onDelete: id => points.dropConversation(id) }),
    points = createCheckpoints({ home: () => path.join(base, "检查点"), deleted: id => chats.deleted(id) }),
    routes = { ...chats.routes, ...points.routes },
    server = http.createServer((req, res) => routes[`POST ${req.url}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const conversation = { id: "c1", title: "恢复的对话", messages: [] },
    key = { root, conversation: conversation.id };
  try {
    await post("/api/chats/save", { conversation });
    await post("/api/checkpoint/take", { ...key, answer: "before" });
    await post("/api/chats/delete", { id: conversation.id });
    assert.equal((await post("/api/checkpoint/take", { ...key, answer: "late" })).discarded, true);
    await post("/api/chats/save", { conversation, savedAt: Date.now() + 1 });
    assert.equal((await post("/api/checkpoint/take", { ...key, answer: "restored" })).discarded, undefined);
    assert.deepEqual((await post("/api/checkpoint/diff", { ...key, answer: "restored" })).changes, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  }
});
