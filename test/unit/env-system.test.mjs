// 言 · macOS 接系统工具链：不备环境包，探系统里现成的 Python、Node、ffmpeg
//（先 brew 两处 prefix 再 PATH——Finder / start.command 起的桥接 PATH 往往很窄）；
// 探到的接进指令环境的 PATH 与 ENV.toolPath()（预览视频换壳的 ffmpeg 即由此来）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
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
    // 期望是「按优先序第一个跑得通的」：先 brew 两处 prefix，再 PATH（与实现同序）。
    // 两处 prefix 都装着 ffmpeg 时不能同时要求等于两个路——那是必红的写法
    const candidates = [...["/opt/homebrew/bin", "/usr/local/bin"], ...(process.env.PATH || "").split(path.delimiter)].filter(Boolean);
    const runs = file => {
      try {
        execFileSync(file, ["-version"], { stdio: "ignore", timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    };
    const firstRun = candidates.map(dir => path.join(dir, "ffmpeg")).find(runs);
    if (firstRun) assert.equal(status.system.ffmpeg?.path, firstRun, "该按优先序取第一个跑得通的 ffmpeg");
    // toolPath：.cmd 入口查不到时退回系统那一份
    if (status.system.ffmpeg) assert.equal(env.toolPath("ffmpeg"), status.system.ffmpeg.path);
    assert.equal(env.toolPath("yan-不存在的工具"), "");
    // apply：brew 存在的 bin 目录排在原 PATH 前，窄 PATH 也能直接用
    const applied = env.apply({ PATH: "/usr/bin:/bin" });
    const expected = ["/opt/homebrew/bin", "/usr/local/bin"].filter(dir => fs.existsSync(dir));
    assert.deepEqual(
      applied.PATH.split(":")
        .filter(dir => expected.includes(dir))
        .sort(),
      [...expected].sort(),
      "brew 两处的 bin 都该接进 PATH（brew 里别的工具照旧找得着）"
    );
    assert.ok(applied.PATH.endsWith("/usr/bin:/bin"), "原 PATH 殿后");
    // 探测与实际执行同一份：敲名字命中的，得就是 status 报的那一件——某处那份坏了、探测跳到别处时，
    // PATH 若还按目录先后排，敲 python3 仍先撞上坏的，状态卡报的版本与实际跑的不是同一件
    for (const tool of Object.values(status.system)) {
      const name = path.basename(tool.path),
        hit = execFileSync("/bin/sh", ["-c", `command -v ${name}`], { env: { PATH: applied.PATH }, encoding: "utf8" }).trim();
      assert.equal(hit, tool.path, `${name}：PATH 与探测得同果，敲名字该命中探测报的那一份`);
    }
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
