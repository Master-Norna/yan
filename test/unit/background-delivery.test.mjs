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
    const server = http.createServer((req, res) => work.routes["POST /api/work/run"](req, res));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const controller = new AbortController();
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
        const response = await request,
          report = await response.json();
        assert.equal(response.status, 200);
        assert.ok(report.id && report.running);
      }
      if (cancel) await sleep(3400);
      else for (let i = 0; i < 160 && !fs.existsSync(path.join(root, "result.txt")); i++) await sleep(50);
      assert.equal(fs.existsSync(path.join(root, "result.txt")), !cancel);
    } finally {
      controller.abort();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      if (path.dirname(fs.realpathSync(root)) !== parent || !path.basename(root).startsWith("yan-bg-delivery-"))
        throw Error("测试清理越界");
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
