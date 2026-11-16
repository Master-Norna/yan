// 言 · macOS 严档（问而后行）seatbelt 的原生回归：经桥接的指令由 /usr/bin/sandbox-exec 把写盘收进
// 工作目录与临时、缓存目录——静态筛查管不住的现拼路径、经目录内软链指外的写入都要拦；读照旧。
// 审而后行、径行与用户批准出沙箱的指令不套这一层；后台停止与桥接退出后不留子进程；
// 机器上没有 sandbox-exec 时按约定退回原 shell。只在 macOS 上跑（见 server/work/shell.js 的 MAC_SEATBELT）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const createWork = createRequire(import.meta.url)("../../server/work/index.js");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAC = process.platform === "darwin" && fs.existsSync("/usr/bin/sandbox-exec");
const ONLY_MAC = { skip: !MAC, timeout: 30000 };

const tmpParent = fs.realpathSync(os.tmpdir()),
  home = os.homedir();
function tempRoot() {
  return fs.mkdtempSync(path.join(tmpParent, "yan-seatbelt-"));
}
function dropRoot(root) {
  if (path.dirname(fs.realpathSync(root)) !== tmpParent || !path.basename(root).startsWith("yan-seatbelt-")) throw Error("测试清理越界");
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
// 目录外写入的落点：家目录顶层不在 seatbelt 白名单里，也不是系统目录（宽档与审查不拦）；用完即清
const outsideRoot = path.join(home, "yan-seatbelt-out");
function dropOutside() {
  const real = fs.existsSync(outsideRoot) && fs.realpathSync(outsideRoot);
  if (real && path.dirname(real) === fs.realpathSync(home) && path.basename(real) === "yan-seatbelt-out")
    fs.rmSync(outsideRoot, { recursive: true, force: true });
}
// 静态筛查看不见的目录外写入：路径在跑的时候才拼出来，能拦它的只有 seatbelt
const OUTSIDE_WRITE = name => `h=$(echo ~); mkdir -p "$h/yan-seatbelt-out/${name}" && echo hi > "$h/yan-seatbelt-out/${name}/f"`;
const OUTSIDE_PROBE = name => `{ ${OUTSIDE_WRITE(name)} ; } || echo denied > verdict.txt`;

async function boot(root) {
  const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
  const server = http.createServer((req, res) => {
    const route = work.routes[`${req.method} ${req.url}`];
    if (!route) return res.writeHead(404).end();
    route(req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const post = (url, body) =>
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
// 等一个文件出现（后台指令异步落盘）
async function untilFile(file, tries = 100) {
  for (let i = 0; i < tries && !fs.existsSync(file); i++) await sleep(50);
  return fs.existsSync(file);
}
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function untilDead(pid, tries = 60) {
  for (let i = 0; i < tries && alive(pid); i++) await sleep(50);
  return !alive(pid);
}
// sh 写下的 $$ 可能不等于 spawn 出去的 pid（sandbox-exec 会先替换成自己）：进程组号按它查
function groupOf(pid) {
  const out = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" });
  return Number(out.stdout.trim());
}
// 起一个最小桥接子进程（test/helpers/work-bridge.mjs）：回 { child, port, post }
async function bootHelper(root, extraEnv = {}) {
  const helper = fileURLToPath(new URL("../helpers/work-bridge.mjs", import.meta.url)),
    child = spawn(process.execPath, [helper], {
      env: { ...process.env, YAN_TEST_ROOT: root, ...extraEnv },
      stdio: ["ignore", "pipe", "inherit"]
    });
  const port = await new Promise((resolve, reject) => {
    let text = "";
    child.stdout.on("data", chunk => {
      text += chunk;
      const found = text.match(/PORT (\d+)/);
      if (found) resolve(Number(found[1]));
    });
    child.once("exit", () => reject(Error("helper 早退")));
    child.once("error", reject);
  });
  const post = (url, body) =>
    fetch(`http://127.0.0.1:${port}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(response => response.json());
  return { child, port, post };
}

test("严档下工作目录与临时目录可写、读照旧", ONLY_MAC, async () => {
  const root = tempRoot();
  const { post, close } = await boot(root);
  try {
    const result = await post("/api/work/run", {
      workdir: root,
      command: 'echo ok > inside.txt; echo tmp > "$TMPDIR/yan-seatbelt-tmp.txt"',
      sandbox: true
    });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(root, "inside.txt"), "utf8").trim(), "ok");
    const reading = await post("/api/work/run", { workdir: root, command: "cat /etc/hosts", sandbox: true });
    assert.equal(reading.exitCode, 0, JSON.stringify(reading));
    assert.match(reading.stdout, /localhost/, "读 /etc/hosts 被误拦");
    const tmpFile = path.join(fs.realpathSync(os.tmpdir()), "yan-seatbelt-tmp.txt");
    assert.equal(fs.readFileSync(tmpFile, "utf8").trim(), "tmp");
    fs.rmSync(tmpFile, { force: true });
  } finally {
    await close().catch(() => {});
    dropRoot(root);
  }
});

test("严档拦下现拼的目录外写入与经目录内软链指外的写入", ONLY_MAC, async () => {
  const root = tempRoot();
  const { post, close } = await boot(root);
  try {
    dropOutside();
    const run = command => post("/api/work/run", { workdir: root, command, sandbox: true });
    // 路径在执行时才拼出：静态筛查放行，拦它的是 seatbelt
    const outside = await run(OUTSIDE_PROBE("strict"));
    assert.equal(outside.exitCode, 0, JSON.stringify(outside));
    assert.equal(fs.readFileSync(path.join(root, "verdict.txt"), "utf8").trim(), "denied");
    assert.ok(!fs.existsSync(path.join(outsideRoot, "strict")), "目录外真写进去了");
    // 目录内的软链指向家目录：落点按真实路径判，一样拦
    fs.rmSync(path.join(root, "verdict.txt"));
    fs.symlinkSync(home, path.join(root, "homelink"));
    const link = await run("{ echo hi > ./homelink/yan-seatbelt-link.txt ; } || echo denied > verdict.txt");
    assert.equal(link.exitCode, 0, JSON.stringify(link));
    assert.equal(fs.readFileSync(path.join(root, "verdict.txt"), "utf8").trim(), "denied");
    assert.ok(!fs.existsSync(path.join(home, "yan-seatbelt-link.txt")), "经软链写进了家目录");
  } finally {
    await close().catch(() => {});
    dropRoot(root);
    dropOutside();
  }
});

test("严档对前台、显式后台、前台转后台是同一张约束", ONLY_MAC, async () => {
  const root = tempRoot();
  const { post, close } = await boot(root);
  try {
    dropOutside();
    const probe = tag => `echo ok > inside-${tag}.txt; ${OUTSIDE_PROBE(tag)}`;
    const seen = async tag => {
      const verdict = path.join(root, "verdict.txt");
      assert.ok(await untilFile(verdict), `${tag} 没跑出判定`);
      assert.equal(fs.readFileSync(verdict, "utf8").trim(), "denied", `${tag} 的目录外写入没被拦`);
      assert.ok(fs.existsSync(path.join(root, `inside-${tag}.txt`)), `${tag} 连工作目录都写不进`);
      assert.ok(!fs.existsSync(path.join(outsideRoot, tag)), `${tag} 目录外真写进去了`);
      fs.rmSync(verdict);
    };
    // 前台：POST 直接等到指令完
    await post("/api/work/run", { workdir: root, command: probe("fg"), sandbox: true });
    await seen("fg");
    // 显式后台：编号交付后照样等它跑完
    const bg = await post("/api/work/run", { workdir: root, command: probe("bg"), background: true, sandbox: true });
    assert.ok(bg.id, JSON.stringify(bg));
    await seen("bg");
    if (bg.running) {
      const done = await post("/api/work/watch", { id: bg.id, key: bg.key });
      assert.equal(done.running, false);
    }
    // 前台转后台：带 ticket 的指令跑到一半经 release 转入后台，约束不变
    const pending = post("/api/work/run", { workdir: root, command: `sleep 1; ${probe("handed")}`, ticket: "t-hand", sandbox: true });
    await sleep(300);
    const released = await post("/api/work/release", { ticket: "t-hand" });
    assert.equal(released.released, true);
    const report = await pending;
    assert.equal(report.handedOff, "released", JSON.stringify(report));
    const done = await post("/api/work/watch", { id: report.id, key: report.key });
    assert.equal(done.running, false);
    await seen("handed");
  } finally {
    await close().catch(() => {});
    dropRoot(root);
    dropOutside();
  }
});

test("审而后行、径行与用户批准出沙箱不套 seatbelt", ONLY_MAC, async () => {
  const root = tempRoot();
  const { post, close } = await boot(root);
  try {
    dropOutside();
    // 同一条现拼目录外写入：严档拦（上个用例），这几档都不拦——seatbelt 只属问而后行
    for (const [tag, extra] of [
      ["review", { permission: "review" }],
      ["approved", { permission: "review", reviewed: true }],
      ["auto", { permission: "auto" }],
      ["unsandboxed", { sandbox: false }]
    ]) {
      const body = { workdir: root, command: OUTSIDE_WRITE(tag), sandbox: true, ...extra };
      const result = await post("/api/work/run", body);
      assert.equal(result.exitCode, 0, `${tag}: ${JSON.stringify(result)}`);
      assert.equal(fs.readFileSync(path.join(outsideRoot, tag, "f"), "utf8").trim(), "hi", `${tag} 的目录外写入没落成`);
    }
  } finally {
    await close().catch(() => {});
    dropRoot(root);
    dropOutside();
  }
});

test("严档后台指令停下后整棵进程树收掉", ONLY_MAC, async () => {
  const root = tempRoot();
  const { post, close } = await boot(root);
  try {
    const report = await post("/api/work/run", {
      workdir: root,
      command: "echo $$ > pid.txt; sleep 300",
      background: true,
      sandbox: true
    });
    assert.ok(report.id, JSON.stringify(report));
    assert.ok(await untilFile(path.join(root, "pid.txt")), "pid.txt 没落下");
    const pid = Number(fs.readFileSync(path.join(root, "pid.txt"), "utf8")),
      pgid = groupOf(pid);
    assert.ok(alive(pid) && pgid > 0, `pid=${pid} pgid=${pgid}`);
    const stopped = await post("/api/work/check", { id: report.id, key: report.key, stop: true });
    assert.equal(stopped.running, false);
    assert.ok(await untilDead(pid), `sh ${pid} 没停`);
    assert.ok(await untilDead(-pgid), `进程组 ${pgid} 里还有残留（sleep 300 之类）`);
  } finally {
    await close().catch(() => {});
    dropRoot(root);
  }
});

test("桥接退出时严档后台指令一并收掉", ONLY_MAC, async () => {
  const root = tempRoot(),
    { child, post } = await bootHelper(root);
  try {
    const report = await post("/api/work/run", {
      workdir: root,
      command: "echo $$ > pid.txt; sleep 300",
      background: true,
      sandbox: true
    });
    assert.ok(report.id, JSON.stringify(report));
    assert.ok(await untilFile(path.join(root, "pid.txt")), "pid.txt 没落下");
    const pid = Number(fs.readFileSync(path.join(root, "pid.txt"), "utf8")),
      pgid = groupOf(pid);
    assert.ok(alive(pid), `指令没跑起来（pid=${pid}）`);
    // 杀掉桥接：它的 exit 钩子把 runningShells 连进程组收掉
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
    assert.ok(await untilDead(pid), `sh ${pid} 没随桥接退`);
    assert.ok(await untilDead(-pgid), `进程组 ${pgid} 里还有残留`);
  } finally {
    if (!child.killed) child.kill("SIGKILL");
    dropRoot(root);
  }
});

test("机器上没有 sandbox-exec 时按约定退回原 shell", ONLY_MAC, async () => {
  const root = tempRoot(),
    { child, post } = await bootHelper(root, { YAN_TEST_NO_SEATBELT: "1" });
  try {
    dropOutside();
    // 降级后问而后行仍是严档筛查加普通 shell：指令照跑、目录外写不被 seatbelt 收（也没有它能收）
    const result = await post("/api/work/run", {
      workdir: root,
      command: "echo ok > inside.txt; " + OUTSIDE_WRITE("fallback"),
      sandbox: true
    });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.ok(fs.existsSync(path.join(root, "inside.txt")), "降级后连工作目录都没写成");
    assert.ok(fs.existsSync(path.join(outsideRoot, "fallback", "f")), "降级后仍被收住写盘");
  } finally {
    child.kill("SIGKILL");
    dropRoot(root);
    dropOutside();
  }
});
