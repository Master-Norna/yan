// 补删带的是当初点删除的那一刻（at）。断的这段里别处写过、保存过的那份，savedAt 比它晚，那是「删了以后又存」：
// 保存侧认这种情况为真要它、删除记录作废（见 server/chats.js 的 handleSave），删除侧也得同一口径——
// 否则补删会先擦掉本该保留的新版；反过来，删除较新时，较早的迟到保存也不能把它复活。
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const createChats = createRequire(import.meta.url)("../../server/chats.js");

const conversation = (id, title) => ({ id, title, messages: [], forks: [], threads: [] });

test("补删不删断的这段里别处写的那份；真晚于它才删", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "yan-del-at-"));
  const { routes } = createChats({ chatsHome: () => home });
  const server = http.createServer((req, res) => routes[`POST ${new URL(req.url, "http://x").pathname}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify({ root: home, ...body }) }).then(r =>
      r.json()
    );
  try {
    // 断之前写的一份；页面 A 断着时点了删除（at 夹在中间），页面 B 在这段里又写了更晚的一份
    const now = Date.now(),
      at = now - 2000;
    await post("/api/chats/save", { savedAt: now - 3000, conversation: conversation("c1", "旧") });
    await post("/api/chats/save", { savedAt: now - 1000, conversation: conversation("c1", "新") });
    assert.deepEqual(await post("/api/chats/delete", { id: "c1", at }), { removed: 0, kept: true }, "别处的更新赢：不删");
    assert.equal(readdirSync(home).filter(name => name.includes("·")).length, 1, "文件还在，没被补删带走");
    assert.equal((await post("/api/chats/load", {})).items.find(item => item.id === "c1")?.savedAt, now - 1000, "目录里仍是别处写的那份");
    // 删除晚于那份：照删
    assert.deepEqual(await post("/api/chats/delete", { id: "c1", at: now }), { removed: 1 });
    // 墓碑是 now：更早的迟到保存不再把它复活
    const late = await post("/api/chats/save", { savedAt: now - 500, conversation: conversation("c1", "迟到") });
    assert.match(String(late.error || ""), /已在别处删除/);
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("恢复删除的对话写盘失败时，删除墓碑仍在，旧页面不能复活它", async () => {
  const fs = createRequire(import.meta.url)("node:fs");
  const home = mkdtempSync(path.join(tmpdir(), "yan-tombstone-"));
  const { routes } = createChats({ chatsHome: () => home });
  const server = http.createServer((req, res) => routes[`POST ${new URL(req.url, "http://x").pathname}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST",
      body: JSON.stringify({ root: home, ...body })
    }).then(r => r.json());
  const original = fs.renameSync;
  try {
    const now = Date.now();
    await post("/api/chats/save", { savedAt: now - 3000, conversation: conversation("c1", "旧") });
    await post("/api/chats/delete", { id: "c1", at: now - 2000 });
    const before = (await post("/api/chats/load", {})).deleted.c1;
    assert.equal(before, now - 2000);
    fs.renameSync = (src, dest) => {
      if (String(dest).includes("·") && String(dest).endsWith(".json")) throw Object.assign(Error("disk unavailable"), { code: "EACCES" });
      return original(src, dest);
    };
    const saved = await post("/api/chats/save", { savedAt: now, conversation: conversation("c1", "新") });
    assert.match(saved.error, /对话未能落盘/);
    assert.equal((await post("/api/chats/load", {})).deleted.c1, before, "保存失败不能撤销墓碑");
    assert.equal(readdirSync(home).filter(name => name.includes("·")).length, 0, "新正文未成功写入");
  } finally {
    fs.renameSync = original;
    await new Promise(resolve => server.close(resolve));
    rmSync(home, { recursive: true, force: true });
  }
});
