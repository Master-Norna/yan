import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const createWork = createRequire(import.meta.url)("../../server/work/index.js");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const cancel of [true, false])
  test(cancel ? "后台编号尚未交付便取消：进程不再写文件" : "后台编号已交付：断开请求仍继续运行", { timeout: 15000 }, async () => {
    const parent = fs.realpathSync(os.tmpdir()),
      root = fs.mkdtempSync(path.join(parent, "yan-bg-delivery-"));
    const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
    const server = http.createServer((req, res) =>
      (req.url === "/watch" ? work.routes["POST /api/work/watch"] : work.routes["POST /api/work/run"])(req, res)
    );
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const controller = new AbortController();
    let report;
    try {
      const command =
        process.platform === "win32"
          ? "Set-Content ready.txt ready; Start-Sleep -Milliseconds 3000; Set-Content result.txt written"
          : "printf ready > ready.txt; sleep 3; printf written > result.txt";
      const request = fetch(`http://127.0.0.1:${server.address().port}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workdir: root, command, background: true }),
        signal: controller.signal
      });
      if (cancel) {
        const caught = request.catch(error => error);
        for (let i = 0; i < 50 && !fs.existsSync(path.join(root, "ready.txt")); i++) await sleep(50);
        assert.ok(fs.existsSync(path.join(root, "ready.txt")));
        controller.abort();
        assert.equal((await caught).name, "AbortError");
      } else {
        const response = await request;
        report = await response.json();
        assert.equal(response.status, 200);
        assert.ok(report.id && report.running);
      }
      if (cancel) await sleep(3400);
      else {
        for (let i = 0; i < 160 && !fs.existsSync(path.join(root, "result.txt")); i++) await sleep(50);
        // 文件落地不代表进程已退：写盘的 shell 仍以 root 为当前目录，finally 清目录在 Windows 上会撞 EBUSY；
        // 凭已交付的编号等它真正结束，再进清理
        const done = await fetch(`http://127.0.0.1:${server.address().port}/watch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: report.id, key: report.key })
        }).then(r => r.json());
        assert.equal(done.running, false);
      }
      assert.equal(fs.existsSync(path.join(root, "result.txt")), !cancel);
    } finally {
      controller.abort();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      if (path.dirname(fs.realpathSync(root)) !== parent || !path.basename(root).startsWith("yan-bg-delivery-"))
        throw Error("测试清理越界");
      // 取消那一路拿不到编号，没法凭 watch 等它退：那条命令写完还要收尾，目录可能仍被它
      // 占着作当前目录（Windows 上就是 EPERM/EBUSY），重试到它退出为止，不拿固定等待当判据
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
    }
  });

test("后台完成回报未写完即断开，重连仍能领取退出码", { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-bg-watch-retry-"));
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  let cut = true;
  const server = http.createServer((req, res) => {
    if (req.url === "/watch" && cut) {
      // 在真正响应写完前模拟连接丢失，确定性地打中回报窗口。
      res.end = function () {
        this.destroy();
        return this;
      };
    }
    return work.routes[req.url === "/watch" ? "POST /api/work/watch" : "POST /api/work/run"](req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  });
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST",
      body: JSON.stringify(body)
    }).then(res => res.json());
  const job = await post("/run", { workdir: root, command: "echo finished", background: true });
  const identity = { id: job.id, key: job.key };
  await assert.rejects(post("/watch", identity));
  cut = false;
  const done = await post("/watch", identity);
  assert.equal(done.exitCode, 0);
  assert.equal(done.reported, undefined);
  assert.equal((await post("/watch", identity)).reported, true);
});

test("前台转后台的编号写出途中断开：进程不会成为孤儿", { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-fg-handoff-"));
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  let handoff;
  const server = http.createServer((req, res) => {
    if (req.url === "/run")
      res.end = function (body) {
        handoff = JSON.parse(body);
        this.destroy();
        return this;
      };
    return work.routes[req.url === "/run" ? "POST /api/work/run" : "POST /api/work/watch"](req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(res => res.json());
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  });
  const command =
    process.platform === "win32"
      ? "Start-Sleep -Milliseconds 4000; Set-Content result.txt written"
      : "sleep 4; printf written > result.txt";
  await assert.rejects(post("/run", { workdir: root, command, ticket: "test-ticket", timeout: 1 }));
  assert.equal(handoff.handedOff, "waited");
  assert.ok(handoff.running && handoff.id);
  const report = await post("/watch", { id: handoff.id, key: handoff.key });
  assert.equal(report.lost, true, "未交付的后台编号应撤掉");
  await sleep(4500);
  assert.equal(fs.existsSync(path.join(root, "result.txt")), false, "孤儿进程不应再产生副作用");
});
