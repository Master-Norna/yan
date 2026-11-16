// 后台指令结束、结果还没报过时，不被后起的指令挤出记录：页面关着时结束的，再开页要凭它把结果补报上去
// （rewatchBackground）。被挤出去，页面只会拿到 lost，按「随桥接重启而止」处理——结果丢了，原因也说错了。
// 报过的旧账照旧可以清，表不会无限长（见 server/work/shell.js 的 enlist）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const createWork = createRequire(import.meta.url)("../../server/work/index.js");

test("未报结果的后台不被后起的指令挤出记录；报过的照旧清", { timeout: 120000 }, async () => {
  const parent = fs.realpathSync(os.tmpdir()),
    root = fs.mkdtempSync(path.join(parent, "yan-bg-evict-"));
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  const server = http.createServer((req, res) => {
    const handler = work.routes[`POST ${req.url}`];
    if (handler) return handler(req, res);
    res.statusCode = 404;
    res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, body) => {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return response.json();
  };
  // 起一条后台：交回编号之后没人 watch，它的结果还没报过
  const background = () => post("/api/work/run", { workdir: root, command: "echo x", background: true });
  try {
    const first = await background();
    assert.ok(first.id, "应拿到编号");
    const rest = await Promise.all(Array.from({ length: 24 }, background));
    assert.equal(new Set([first, ...rest].map(report => report.id)).size, 25);
    // 页面关着时结束、再开页重挂：第一条仍应报得出结果，不能被挤成 lost
    const watched = await post("/api/work/watch", { id: first.id, key: first.key });
    assert.equal(watched.id, first.id);
    assert.notEqual(watched.lost, true, "未报结果的后台被挤出了记录");
    assert.ok(!watched.reported, "没报过的不该带 reported");
    assert.equal(watched.exitCode, 0);
    // 报过之后就是旧账：表已满，再起一条就会把最早那条已报过的清掉（表不无限长）
    await background();
    const again = await post("/api/work/watch", { id: first.id, key: first.key });
    assert.equal(again.lost, true, "报过的旧账应照旧清掉");
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    // 结果文件出完不等于 shell 已退出，Windows 上还拿临时目录当当前目录时删不掉（EPERM/EBUSY）：
    // 先等后台都结束，再删，并留出退出的余地重试
    for (let i = 0; i < 100 && work.backgroundRunning(); i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (path.dirname(fs.realpathSync(root)) !== parent || !path.basename(root).startsWith("yan-bg-evict-")) throw Error("测试清理越界");
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
