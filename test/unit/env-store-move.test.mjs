// 真实桥接、临时存储根、可暂停的环境替身：争抢不是靠固定睡眠造出来的。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once, on } from "node:events";
import { fork } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

function envHome(root) {
  return path.join(root, "环境");
}
function fakeTools(root) {
  for (const file of ["bin/uv.exe", "py/Scripts/python.exe"]) {
    const target = path.join(envHome(root), file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "替身，不执行");
  }
}
async function fixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-env-move-")),
    a = path.join(base, "A", ".yan"),
    b = path.join(base, "B", ".yan"),
    signal = AbortSignal.timeout(10000);
  const child = fork(fileURLToPath(new URL("../helpers/env-bridge.cjs", import.meta.url)), [], {
    env: { ...process.env, YAN_HOME: a, YAN_PORT: "0", YAN_BUILTIN_SKILLS: "", HTTP_PROXY: "http://127.0.0.1:1" },
    stdio: ["ignore", "ignore", "inherit", "ipc"]
  });
  const exited = once(child, "exit"),
    messages = on(child, "message", { signal, close: ["exit"] });
  async function entered(kind) {
    const message = (await messages.next()).value?.[0];
    assert.equal(message?.kind, kind);
    return message;
  }
  try {
    fakeTools(a);
    const { port } = await entered("listen");
    function request(route) {
      let req;
      const result = new Promise((resolve, reject) => {
        // 用系统分配的端口，桥接的 Host 仍按配置的 YAN_PORT 校验。
        req = http.request({ port, host: "127.0.0.1", path: route, method: "POST", headers: { Host: "127.0.0.1:0" }, signal }, res => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", chunk => (text += chunk));
          res.on("error", reject);
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(text) });
            } catch (error) {
              reject(error);
            }
          });
        });
        req.on("error", reject);
      });
      return { req, result };
    }
    function post(route, body = {}) {
      const { req, result } = request(route);
      req.end(JSON.stringify(body));
      return result;
    }
    const status = async () => (await post("/api/env/status")).data;
    const finished = async () => {
      for (;;) {
        const snapshot = await status();
        assert.ok(snapshot.job, "作业未留下状态");
        if (!snapshot.job.running) return snapshot;
        await sleep(10, undefined, { signal });
      }
    };
    const move = parent => post("/api/store/move", { parent });
    const release = (kind, fail) => child.send({ kind, fail });
    await run({ a, b, entered, release, request, post, status, finished, move });
  } finally {
    child.kill();
    await exited;
    await messages.return();
    fs.rmSync(base, { recursive: true, force: true });
  }
}

for (const fail of [false, true]) {
  test(`准备期间换根和清空均拒绝，准备${fail ? "失败" : "完成"}后放行且不带旧日志`, async () => {
    await fixture(async ({ a, b, entered, release, post, status, finished, move }) => {
      const preparing = post("/api/env/prepare");
      await entered("prepare"); // 停在下载源探测；没有装任何东西。
      const start = await preparing;
      assert.equal(start.status, 200);
      assert.equal(start.data.job.running, true);
      assert.deepEqual(await post("/api/env/prepare"), start, "重复准备只返回原作业");
      const blocked = await move(b);
      assert.equal(blocked.status, 400);
      assert.match(blocked.data.error, /有环境作业还在跑/);
      assert.equal(fs.existsSync(b), false, "拒绝换根不建目标目录");
      assert.equal((await status()).home, envHome(a));
      const clear = await post("/api/env/clear");
      assert.equal(clear.status, 400);
      assert.match(clear.data.error, /环境正在准备/);
      release("prepare", fail);
      const done = await finished();
      if (fail) assert.equal(done.job.error, "替身作业失败");
      else {
        assert.equal(done.state.python, "Python 3.12.0 (替身)");
        assert.ok(done.job.log.includes(`替身 uv: ${path.join(envHome(a), "bin", "uv.exe")}`));
      }
      assert.equal((await move(a)).data.moved, false);
      assert.deepEqual((await status()).job, done.job, "没有换根时保留本处日志");
      assert.equal((await move(b)).data.root, b);
      const fresh = await status();
      assert.equal(fresh.home, envHome(b));
      assert.equal(fresh.job, null);
      assert.equal(fresh.state, null);
      assert.equal(fs.existsSync(envHome(b)), false, "换新根不复制环境");
      assert.equal((await move(a)).data.root, a);
      assert.equal((await status()).job, null, "切回也不复活旧进度");
      if (!fail) assert.deepEqual((await status()).state, done.state, "换根不删除旧处已备状态");
    });
  });

  test(`清空期间换根、准备和再次清空均拒绝，清空${fail ? "失败" : "完成"}后放行`, async () => {
    await fixture(async ({ a, b, entered, release, post, status, move }) => {
      const clearing = post("/api/env/clear");
      await entered("clear"); // 停在 rm 等待中。
      try {
        const blocked = await move(b);
        assert.equal(blocked.status, 400);
        assert.match(blocked.data.error, /有环境作业还在跑/);
        assert.equal(fs.existsSync(b), false);
        for (const route of ["prepare", "clear"]) {
          const result = await post(`/api/env/${route}`);
          assert.equal(result.status, 400);
          assert.match(result.data.error, /环境正在清空/);
        }
      } finally {
        release("clear", fail);
        const done = await clearing;
        assert.equal(done.status, fail ? 400 : 200);
        if (fail) assert.match(done.data.error, /替身作业失败/);
      }
      assert.equal(fs.existsSync(envHome(a)), fail);
      assert.equal((await move(b)).data.root, b);
      assert.equal((await status()).job, null);
    });
  });
}

test("准备在首个等待点前失败也释放忙态", async () => {
  await fixture(async ({ a, b, post, finished, move }) => {
    // 旧状态合法 JSON，但 packs 为 null，准备读取旧状态时就报错（还没到下载源）。
    fs.writeFileSync(path.join(envHome(a), "已备.json"), JSON.stringify({ packs: null }));
    assert.equal((await post("/api/env/prepare")).status, 200);
    const done = await finished();
    assert.match(done.job.error, /includes/);
    assert.equal((await move(b)).data.root, b);
  });
});

test("换根之后拒绝显式带旧根的环境请求，目标根不受影响", async () => {
  await fixture(async ({ a, b, post, move }) => {
    assert.equal((await move(b)).data.root, b);
    fakeTools(b);
    for (const route of ["prepare", "clear"]) {
      const result = await post(`/api/env/${route}`, { root: a });
      assert.equal(result.status, 400);
      assert.match(result.data.error, /存储位置已变化/);
    }
    assert.ok(fs.existsSync(path.join(envHome(b), "bin", "uv.exe")));
  });
});
