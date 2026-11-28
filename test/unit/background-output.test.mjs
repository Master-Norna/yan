import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const createWork = createRequire(import.meta.url)("../../server/work/index.js");

const ROUTES = { "/run": "POST /api/work/run", "/check": "POST /api/work/check", "/watch": "POST /api/work/watch" };
async function bridge(t) {
  const parent = fs.realpathSync(os.tmpdir()),
    root = fs.mkdtempSync(path.join(parent, "yan-output-"));
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  const server = http.createServer((req, res) => work.routes[ROUTES[req.url] || ROUTES["/run"]](req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(response => response.json());
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (path.dirname(fs.realpathSync(root)) !== parent || !path.basename(root).startsWith("yan-output-")) throw Error("测试清理越界");
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  });
  return { root, post };
}

const MORE = /\n…（还有后续输出，可再取）$/;
async function drain(post, job, limit = 40) {
  let text = "",
    stderr = "";
  const feed = part => {
    text += String(part.stdout || "").replace(MORE, "");
    stderr += String(part.stderr || "").replace(MORE, "");
  };
  feed(job);
  for (let i = 0; i < limit; i++) {
    const part = await post("/check", { id: job.id, key: job.key });
    feed(part);
    if (!part.running && !part.more) break;
    // 进程还在跑、这一批又空：等一下再取；已结束但还有后续，就立刻接着取
    if (part.running) await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { text, stderr };
}

test("后台输出分批交付，下一轮从实际交到的位置接着取", { timeout: 40000 }, async t => {
  const { root, post } = await bridge(t),
    count = 26010;
  const job = await post("/run", {
    workdir: root,
    command: `node -e "process.stdout.write('x'.repeat(${count}))"`,
    background: true
  });
  const { text } = await drain(post, job);
  assert.equal(text.length, count);
  assert.equal(text, "x".repeat(count));
});

test("终端按桥接收到的先后显示 stdout 与 stderr", { timeout: 40000 }, async t => {
  const { root, post } = await bridge(t);
  const job = await post("/run", {
    workdir: root,
    command: `node -e "process.stderr.write('ERR1\\n');setTimeout(()=>process.stdout.write('OUT2\\n'),80);setTimeout(()=>process.stderr.write('ERR3\\n'),160)"`,
    background: true,
    terminal: true
  });
  const { text, stderr } = await drain(post, job);
  const at = ["ERR1", "OUT2", "ERR3"].map(mark => text.indexOf(mark));
  assert.ok(
    at.every(index => index >= 0),
    JSON.stringify({ text, stderr })
  );
  assert.ok(at[0] < at[1] && at[1] < at[2], JSON.stringify({ text }));
  assert.equal(stderr, "");
});

test("停止请求与自然退出分开报：回执里有没有 stopped 就是两回事", { timeout: 40000 }, async t => {
  const { root, post } = await bridge(t);
  const job = await post("/run", {
    workdir: root,
    command: process.platform === "win32" ? "Start-Sleep -Seconds 5" : "sleep 5",
    background: true
  });
  let part = await post("/check", { id: job.id, key: job.key, stop: true });
  assert.equal(part.stopped, true);
  for (let i = 0; i < 20 && part.running; i++) part = await post("/check", { id: job.id, key: job.key, stop: true });
  assert.equal(part.running, false);
  assert.equal(part.stopped, true);

  // 进程先自己退了，停止请求后到：回执里不带 stopped，页面据此报退出码而不是「已停止」
  const quick = await post("/run", { workdir: root, command: `node -e "process.exit(0)"`, background: true });
  await post("/watch", { id: quick.id, key: quick.key });
  const late = await post("/check", { id: quick.id, key: quick.key, stop: true });
  assert.equal(late.running, false);
  assert.equal(late.exitCode, 0);
  assert.equal(late.stopped, undefined);
});
