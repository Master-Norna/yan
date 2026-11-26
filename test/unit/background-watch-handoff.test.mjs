import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
const createWork = createRequire(import.meta.url)("../../server/work/index.js");

// 只挂真实桥接路由；子进程读到放行文件才输出并退出，请求次序由服务端事件确认。
async function fixture(t, noisy = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-watch-handoff-"));
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  const requests = new Map();
  let seq = 0;
  const server = http.createServer((req, res) => {
    const [, route, id] = req.url.split("/"),
      control = requests.get(id);
    requests.delete(id);
    res.once("close", control.closed);
    if (control.hold) {
      const end = res.end.bind(res);
      res.end = body => {
        // 桥接已算好结果，但还没写完：测试可以让它继续，也可以从客户端真断掉。
        control.writing({ body: JSON.parse(body), finish: () => end(body) });
        return res;
      };
    }
    void work.routes[`POST /api/work/${route}`](req, res).then(control.handled);
    // 路由先注册读请求体的 end 监听；进入路由后才会唤醒测试。
    req.once("end", control.entered);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const release = () => fs.writeFileSync(path.join(root, "go"), "go");
  const waitForExit = async () => {
    for (let i = 0; i < 200 && work.backgroundRunning(); i++) await sleep(25);
    assert.equal(work.backgroundRunning(), false, "shell 应已退出");
  };
  t.after(async () => {
    release();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await waitForExit();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  function post(route, body, hold = false) {
    const id = String(++seq),
      controller = new AbortController(),
      entered = Promise.withResolvers(),
      closed = Promise.withResolvers(),
      handled = Promise.withResolvers(),
      writing = Promise.withResolvers();
    requests.set(id, { entered: entered.resolve, closed: closed.resolve, handled: handled.resolve, writing: writing.resolve, hold });
    const result = fetch(`http://127.0.0.1:${server.address().port}/${route}/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: controller.signal
    }).then(async res => {
      assert.equal(res.status, 200);
      return res.json();
    });
    // 用例某一步断言失败后也会关闭余下的连接；不用未等待的拒绝掩盖原断言。
    void result.catch(() => {});
    return {
      entered: entered.promise,
      closed: closed.promise,
      handled: handled.promise,
      writing: writing.promise,
      result,
      abort: () => controller.abort()
    };
  }
  const pulse = noisy ? "echo pulse; " : "",
    command =
      process.platform === "win32"
        ? `while (-not (Test-Path go)) { ${pulse}Start-Sleep -Milliseconds 25 }; echo final-output`
        : `while [ ! -f go ]; do ${pulse}sleep 0.025; done; echo final-output`;
  const first = await post("run", { workdir: root, command, background: true }).result;
  assert.equal(first.running, true);
  const identity = { id: first.id, key: first.key };
  return {
    watch: hold => post("watch", identity, hold),
    check: (hold, options) => post("check", { ...identity, ...options }, hold),
    release,
    waitForExit,
    id: first.id
  };
}

function assertReport(data) {
  assert.equal(data.running, false);
  assert.equal(data.exitCode, 0);
  assert.equal(data.stdout.trim(), "final-output");
  assert.equal(data.reported, undefined);
}
async function disconnect(request) {
  request.abort();
  await assert.rejects(request.result, { name: "AbortError" });
  await request.closed;
}

test("后挂的监听先断开，仍在等的监听收到回报", { timeout: 15000 }, async t => {
  const job = await fixture(t);
  const a = job.watch();
  await a.entered;
  const b = job.watch();
  await b.entered;
  await disconnect(b);
  job.release();
  assertReport(await a.result);
  assert.deepEqual(await job.watch().result, { id: job.id, reported: true, exitCode: 0 });
});

test("两个监听都在，仍由后挂的回报一次；回报写到一半，新接的只收已报签", { timeout: 15000 }, async t => {
  const job = await fixture(t);
  const a = job.watch();
  await a.entered;
  const b = job.watch(true);
  await b.entered;
  job.release();
  const { finish } = await b.writing;
  const c = job.watch();
  await c.entered;
  finish();
  assertReport(await b.result);
  assert.deepEqual(await a.result, { id: job.id, superseded: true });
  assert.deepEqual(await c.result, { id: job.id, reported: true, exitCode: 0 });
});

test("后挂的监听写完回报前断开，先前的监听接替", { timeout: 15000 }, async t => {
  const job = await fixture(t);
  const a = job.watch();
  await a.entered;
  const b = job.watch(true);
  await b.entered;
  job.release();
  assertReport((await b.writing).body);
  await disconnect(b);
  assertReport(await a.result);
});

test("只读查看已结束的指令，写完前断开不消费回报或输出", { timeout: 15000 }, async t => {
  const job = await fixture(t);
  job.release();
  await job.waitForExit();
  const check = job.check(true);
  assertReport((await check.writing).body);
  const watch = job.watch();
  await watch.entered;
  await disconnect(check);
  assertReport(await watch.result);
});

test("只读查看已结束的指令，写完才消费回报与输出", { timeout: 15000 }, async t => {
  const job = await fixture(t);
  job.release();
  await job.waitForExit();
  const check = job.check(true);
  const { finish } = await check.writing;
  const watch = job.watch();
  await watch.entered;
  finish();
  assertReport(await check.result);
  assert.deepEqual(await watch.result, { id: job.id, reported: true, exitCode: 0 });
  assert.equal((await job.check().result).stdout, "");
});

test("主动停止的响应断开：监听仍能收停止签，不走普通唤醒", { timeout: 15000 }, async t => {
  const job = await fixture(t);
  const stop = job.check(true, { stop: true });
  assert.equal((await stop.writing).body.running, false);
  await disconnect(stop);
  const data = await job.watch().result;
  assert.equal(data.running, false);
  assert.equal(data.stopped, true, "调用方见 stopped 只收签，不发 mailReport");
  assert.deepEqual(await job.watch().result, { id: job.id, reported: true, exitCode: data.exitCode });
});

test("查看在等其他响应写完时断开：不再占着请求等待", { timeout: 15000 }, async t => {
  const job = await fixture(t);
  const first = job.check(true);
  const { body, finish } = await first.writing;
  assert.equal(body.running, true);
  const queued = job.check();
  await queued.entered;
  await disconnect(queued);
  await queued.handled; // 第一份仍没写完，断开的请求应已返回。
  job.release();
  await job.waitForExit();
  finish();
  await first.result;
  // 第一份写完时进程虽已退出，它交出去的却只是进行中的快照。
  assertReport(await job.watch().result);
});

test("查看在等持续输出时断开：不再等到 waitMs 到期", { timeout: 15000 }, async t => {
  const job = await fixture(t, true);
  const check = job.check(false, { wait: 120 });
  await check.entered;
  await disconnect(check);
  await check.handled; // 子进程仍在持续输出，不能靠进程退出或输出静下来放行。
  job.release();
  await job.waitForExit();
});
