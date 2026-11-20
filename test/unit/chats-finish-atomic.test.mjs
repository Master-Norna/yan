// 落盘与删除都得「要么成立、要么没动」，别停在中间：
// ①保存时正本已经写好，旧名的文件删不掉（被索引器、杀软占着，或设成只读）不该把整次保存判成失败——
//   页面按失败处理就会写浏览器暂存、每 3 秒重试，盘上还留着两份同 id 的；
// ②删除时对话文件已经删了，行迹删不掉不该让回执是 400、墓碑也不写——这段时间别的页面读到的是
//   「对话没了、也没有删除记录」，手上留着的那份还能把它写回来，检查点也一直清不掉。
// 两处的「删不掉」都拿真删不动的东西现造：同名的一个目录（不带 recursive 的 rmSync 必失败），或行迹目录整个换成文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const createChats = createRequire(import.meta.url)("../../server/chats.js");
const conversation = (id, title) => ({ id, title, messages: [], forks: [], threads: [] });

async function bridge(home) {
  const { routes } = createChats({ chatsHome: () => home });
  const server = http.createServer((req, res) => routes[`POST ${new URL(req.url, "http://x").pathname}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify({ root: home, ...body }) }).then(r =>
      r.json()
    );
  return { post, close: () => server.close() };
}

test("旧名的文件删不掉：正本已写好，保存照旧算成", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "yan-save-stale-")),
    { post, close } = await bridge(home);
  try {
    await post("/api/chats/save", { conversation: conversation("c1", "甲") });
    const first = readdirSync(home).find(name => name.includes("·"));
    // 换成同名的一个目录：rmSync 不带 recursive 必失败（Windows 上是 EPERM，POSIX 上是 EISDIR）
    rmSync(path.join(home, first));
    mkdirSync(path.join(home, first));
    const saved = await post("/api/chats/save", { conversation: conversation("c1", "乙") });
    assert.equal(saved.error, undefined, "正本落盘了就算成，不为旧名回绝");
    assert.match(String(saved.file), /^乙·/);
    assert.ok(existsSync(path.join(home, saved.file)), "新名那份在盘上");
    assert.equal(readdirSync(home).filter(name => name.includes("·")).length, 2, "旧名留着（删不掉），下次读目录按 savedAt 取新的那份");
  } finally {
    close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("行迹删不掉：对话照删，墓碑照写，回执不是失败", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "yan-delete-trail-")),
    { post, close } = await bridge(home),
    fsMod = createRequire(import.meta.url)("node:fs"),
    realRm = fsMod.rmSync;
  try {
    const saved = await post("/api/chats/save", { conversation: conversation("c2", "丙") }),
      code = String(saved.file).match(/·([^·]+)\.json$/)[1],
      trail = path.join(home, "行迹", code);
    mkdirSync(trail, { recursive: true });
    writeFileSync(path.join(trail, "a1.json"), "{}");
    // 真让删行迹那一下失败（被占着、盘坏了都是这一种）：桥接与测试同一个 fs 模块，换掉这一个函数就好
    fsMod.rmSync = (target, options) => {
      if (String(target).startsWith(trail)) throw Object.assign(Error("被占着"), { code: "EBUSY" });
      return realRm(target, options);
    };
    const result = await post("/api/chats/delete", { id: "c2" });
    assert.equal(result.error, undefined, "删不成行迹不该让整次删除回 400");
    assert.equal(result.removed, 1);
    assert.equal(readdirSync(home).filter(name => name.includes("·")).length, 0, "对话文件已删");
    const tombstones = JSON.parse(
      existsSync(path.join(home, "删除记录.json")) ? readFileSync(path.join(home, "删除记录.json"), "utf8") : "{}"
    );
    assert.ok(tombstones.deleted?.c2 > 0, "墓碑写了：别处晚到的保存不能把它写回来");
  } finally {
    fsMod.rmSync = realRm;
    close();
    rmSync(home, { recursive: true, force: true });
  }
});
