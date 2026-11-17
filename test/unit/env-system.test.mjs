// 言 · macOS 接系统工具链：不备环境包，探系统里现成的 Python、Node、ffmpeg
//（先 brew 两处 prefix 再 PATH——Finder / start.command 起的桥接 PATH 往往很窄）；
// 探到的接进指令环境的 PATH 与 ENV.toolPath()（预览视频换壳的 ffmpeg 即由此来）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createEnv = createRequire(import.meta.url)("../../server/env/index.js");
const MAC = process.platform === "darwin";
const ONLY_MAC = { skip: !MAC, timeout: 30000 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function tempRoot() {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "yan-env-"));
}
// 把 env 的路由原样挂到一个 http 服务上（与 test/helpers/work-bridge.mjs 同构）
async function boot(env) {
  const server = http.createServer((req, res) => {
    const route = env.routes[`${req.method} ${req.url}`];
    if (!route) return res.writeHead(404).end();
    route(req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const post = (url, body = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(response => response.json());
  const close = async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  return { post, close };
}

test("macOS：status 报系统探测、toolPath 退回系统、apply 把 brew 的 bin 接进 PATH", ONLY_MAC, async () => {
  const root = tempRoot();
  const env = createEnv({ envHome: () => root });
  const { post, close } = await boot(env);
  try {
    const status = await post("/api/env/status");
    assert.ok(status.system && typeof status.system === "object", "status 没带 system 探测结果");
    for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"])
      if (fs.existsSync(path.join(dir, "ffmpeg"))) assert.equal(status.system.ffmpeg?.path, path.join(dir, "ffmpeg"));
    // toolPath：.cmd 入口查不到时退回系统那一份
    if (status.system.ffmpeg) assert.equal(env.toolPath("ffmpeg"), status.system.ffmpeg.path);
    assert.equal(env.toolPath("yan-不存在的工具"), "");
    // apply：brew 存在的 bin 目录排在原 PATH 前，窄 PATH 也能直接用
    const applied = env.apply({ PATH: "/usr/bin:/bin" });
    const expected = ["/opt/homebrew/bin", "/usr/local/bin"].filter(dir => fs.existsSync(dir));
    assert.equal(applied.PATH, [...expected, "/usr/bin:/bin"].join(":"));
  } finally {
    await close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("macOS：prepare 重探系统工具并写进已备.json", ONLY_MAC, async () => {
  const root = tempRoot();
  const env = createEnv({ envHome: () => root });
  const { post, close } = await boot(env);
  try {
    let status = await post("/api/env/prepare", {});
    for (let i = 0; i < 100 && status.job?.running; i++) {
      await sleep(50);
      status = await post("/api/env/status");
    }
    assert.ok(!status.job?.running, "探测 job 没跑完");
    assert.ok(!status.job?.error, `探测报错了：${status.job?.error}`);
    const state = JSON.parse(fs.readFileSync(path.join(root, "已备.json"), "utf8"));
    assert.ok(state.system && typeof state.system === "object", "已备.json 没记 system 探测结果");
    assert.equal(state.言, "系统环境");
  } finally {
    await close().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});
