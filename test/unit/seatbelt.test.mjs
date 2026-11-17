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
// MAC 只判「是 macOS」；有没有 sandbox-exec 单列：缺二进制时 test 1 显式报红点名，
// 其余要真 seatbelt 的用例跳过——不然整份文件在没二进制的 macOS 上静默全 SKIP 也没人知道
const MAC = process.platform === "darwin";
const HAS_SEATBELT = MAC && fs.existsSync("/usr/bin/sandbox-exec");
const ONLY_MAC = { skip: !MAC, timeout: 30000 };
const NEED_SEATBELT = { skip: !HAS_SEATBELT, timeout: 30000 };

const tmpParent = fs.realpathSync(os.tmpdir()),
  home = os.homedir();
function tempRoot() {
  return fs.mkdtempSync(path.join(tmpParent, "yan-seatbelt-"));
}
function dropRoot(root) {
  if (path.dirname(fs.realpathSync(root)) !== tmpParent || !path.basename(root).startsWith("yan-seatbelt-")) throw Error("测试清理越界");
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
}
// 目录外写入的落点：每轮在家目录下起一个带随机尾巴的独用目录——不在 seatbelt 白名单里，也不是系统目录；
// 并发的几轮各用各的，也不会把同名旧目录里的东西误清掉（非 macOS 整文件跳过，占个名即可不必建目录）
const outsideBase = MAC ? path.basename(fs.mkdtempSync(path.join(home, "yan-seatbelt-out-"))) : "yan-seatbelt-out-x";
const outsideRoot = path.join(home, outsideBase);
// 每轮独用的名字尾巴：家目录里的软链落点、$TMPDIR 临时文件都带它，几份 checkout 并行互不干扰
const runTag = outsideBase.replace("yan-seatbelt-out-", "");
const linkName = `yan-seatbelt-link-${runTag}.txt`;
const tmpName = `yan-seatbelt-tmp-${runTag}.txt`;
// 家目录的落点统一在文件收尾清：只跑部分用例、断言半途挂掉都不留尾巴
// （不然留下的 link 文件会让下一轮对着「不该存在」的断言一直红）
test.after(() => {
  if (!MAC) return;
  dropOutside();
  fs.rmSync(path.join(home, linkName), { force: true });
});
function dropOutside() {
  const real = fs.existsSync(outsideRoot) && fs.realpathSync(outsideRoot);
  if (real && path.dirname(real) === fs.realpathSync(home) && path.basename(real).startsWith("yan-seatbelt-out-"))
    fs.rmSync(outsideRoot, { recursive: true, force: true });
}
// 静态筛查看不见的目录外写入：路径在跑的时候才拼出来，能拦它的只有 seatbelt
const OUTSIDE_WRITE = name => `h=$(echo ~); mkdir -p "$h/${outsideBase}/${name}" && echo hi > "$h/${outsideBase}/${name}/f"`;
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
  assert.ok(HAS_SEATBELT, "这台 macOS 上没有 /usr/bin/sandbox-exec，严档回归无从谈起");
  const root = tempRoot();
  const { post, close } = await boot(root);
  try {
    const result = await post("/api/work/run", {
      workdir: root,
      command: `echo ok > inside.txt; echo tmp > "$TMPDIR/${tmpName}"`,
      sandbox: true
    });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.equal(fs.readFileSync(path.join(root, "inside.txt"), "utf8").trim(), "ok");
    const reading = await post("/api/work/run", { workdir: root, command: "cat /etc/hosts", sandbox: true });
    assert.equal(reading.exitCode, 0, JSON.stringify(reading));
    assert.match(reading.stdout, /localhost/, "读 /etc/hosts 被误拦");
    const tmpFile = path.join(fs.realpathSync(os.tmpdir()), tmpName);
    assert.equal(fs.readFileSync(tmpFile, "utf8").trim(), "tmp");
    fs.rmSync(tmpFile, { force: true });
  } finally {
    await close().catch(() => {});
    dropRoot(root);
  }
});

test("严档拦下现拼的目录外写入与经目录内软链指外的写入", NEED_SEATBELT, async () => {
  const root = tempRoot();
  const { post, close } = await boot(root);
  try {
    dropOutside();
    const run = command => post("/api/work/run", { workdir: root, command, sandbox: true });
    // 路径在执行时才拼出：静态筛查放行，拦它的是 seatbelt
    const outside = await run(`echo ok > inside-strict.txt; ${OUTSIDE_PROBE("strict")}`);
    assert.equal(outside.exitCode, 0, JSON.stringify(outside));
    // 先证明指令真跑起来、工作目录可写：verdict=denied 才算 seatbelt 拦的，不是别的原因没写成
    assert.ok(fs.existsSync(path.join(root, "inside-strict.txt")), "工作目录都没写成，denied 不能算 seatbelt 的账");
    assert.equal(fs.readFileSync(path.join(root, "verdict.txt"), "utf8").trim(), "denied");
    assert.ok(!fs.existsSync(path.join(outsideRoot, "strict")), "目录外真写进去了");
    // 目录内的软链指向家目录：落点按真实路径判，一样拦
    fs.rmSync(path.join(root, "verdict.txt"));
    fs.symlinkSync(home, path.join(root, "homelink"));
    const link = await run(`echo ok > inside-link.txt; { echo hi > ./homelink/${linkName} ; } || echo denied > verdict.txt`);
    assert.equal(link.exitCode, 0, JSON.stringify(link));
    assert.ok(fs.existsSync(path.join(root, "inside-link.txt")), "工作目录都没写成，denied 不能算 seatbelt 的账");
    assert.equal(fs.readFileSync(path.join(root, "verdict.txt"), "utf8").trim(), "denied");
    assert.ok(!fs.existsSync(path.join(home, linkName)), "经软链写进了家目录");
  } finally {
    await close().catch(() => {});
    dropRoot(root);
    dropOutside();
  }
});

test("严档对前台、显式后台、前台转后台是同一张约束", NEED_SEATBELT, async () => {
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
    const pending = post("/api/work/run", { workdir: root, command: `sleep 3; ${probe("handed")}`, ticket: "t-hand", sandbox: true });
    // release 要等指令先把 ticket 挂上：轮询到真放为止，不拿固定等待当判据
    let released = {};
    for (let i = 0; i < 40 && released.released !== true; i++) {
      released = await post("/api/work/release", { ticket: "t-hand" });
      if (released.released !== true) await sleep(50);
    }
    assert.equal(released.released, true, JSON.stringify(released));
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

test("审而后行、径行与用户批准出沙箱不套 seatbelt", NEED_SEATBELT, async () => {
  const root = tempRoot();
  const { post, close } = await boot(root);
  try {
    dropOutside();
    // 同一条现拼目录外写入：严档拦（上个用例），这几档都不拦——seatbelt 只属问而后行；
    // reviewed 是「审而后行 + 审查模型准了」，sandbox:false 才是用户批准出沙箱
    for (const [tag, extra] of [
      ["review", { permission: "review" }],
      ["reviewed", { permission: "review", reviewed: true }],
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

test("严档后台指令停下后整棵进程树收掉", NEED_SEATBELT, async () => {
  const root = tempRoot();
  const { post, close } = await boot(root);
  let report = {},
    pgid = 0;
  try {
    report = await post("/api/work/run", {
      workdir: root,
      command: "echo $$ > pid.txt; sleep 30",
      background: true,
      sandbox: true
    });
    assert.ok(report.id, JSON.stringify(report));
    assert.ok(await untilFile(path.join(root, "pid.txt")), "pid.txt 没落下");
    const pid = Number(fs.readFileSync(path.join(root, "pid.txt"), "utf8"));
    pgid = groupOf(pid);
    assert.ok(alive(pid) && pgid > 0, `pid=${pid} pgid=${pgid}`);
    const stopped = await post("/api/work/check", { id: report.id, key: report.key, stop: true });
    assert.equal(stopped.running, false);
    assert.ok(await untilDead(pid), `sh ${pid} 没停`);
    assert.ok(await untilDead(-pgid), `进程组 ${pgid} 里还有残留（sleep 30 之类）`);
  } finally {
    // 断言挂了也尽力把后台指令收掉：活着的 sleep 挂着管道，node --test 要等它跑完才肯退
    if (report.id) await post("/api/work/check", { id: report.id, key: report.key, stop: true }).catch(() => {});
    if (pgid > 0)
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {}
    await close().catch(() => {});
    dropRoot(root);
  }
});

test("桥接退出时严档后台指令一并收掉，exit 钩子也跑完", NEED_SEATBELT, async () => {
  const root = tempRoot(),
    { child, post } = await bootHelper(root);
  let pgid = 0;
  try {
    const report = await post("/api/work/run", {
      workdir: root,
      command: "echo $$ > pid.txt; sleep 30",
      background: true,
      sandbox: true
    });
    assert.ok(report.id, JSON.stringify(report));
    assert.ok(await untilFile(path.join(root, "pid.txt")), "pid.txt 没落下");
    const pid = Number(fs.readFileSync(path.join(root, "pid.txt"), "utf8"));
    pgid = groupOf(pid);
    assert.ok(alive(pid) && pgid > 0, `pid=${pid} pgid=${pgid}`);
    // 杀掉桥接：它的信号兜底先收指令，再经 process.exit 让 exit 事件上的收口（标记文件）也跑完
    child.kill("SIGTERM");
    // exit 可能已经发过：先查再挂 once，不然挂个永不 resolve 的等待
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once("exit", resolve));
    assert.ok(await untilFile(path.join(root, "bridge-exit-mark")), "exit 钩子没跑（信号走了绕过 exit 收口的退场）");
    assert.ok(await untilDead(pid), `sh ${pid} 没随桥接退`);
    assert.ok(await untilDead(-pgid), `进程组 ${pgid} 里还有残留`);
  } finally {
    if (pgid > 0)
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {}
    // killed 只代表信号发出去了；真没退才补刀
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    dropRoot(root);
  }
});

test("宿主还听着信号时它只收到一次，指令照样收掉", NEED_SEATBELT, async () => {
  const root = tempRoot(),
    { child, post } = await bootHelper(root, { YAN_TEST_HOST_LISTENS: "1" });
  let pgid = 0;
  try {
    const report = await post("/api/work/run", {
      workdir: root,
      command: "echo $$ > pid.txt; sleep 30",
      background: true,
      sandbox: true
    });
    assert.ok(report.id, JSON.stringify(report));
    assert.ok(await untilFile(path.join(root, "pid.txt")), "pid.txt 没落下");
    const pid = Number(fs.readFileSync(path.join(root, "pid.txt"), "utf8"));
    pgid = groupOf(pid);
    assert.ok(alive(pid) && pgid > 0, `pid=${pid} pgid=${pgid}`);
    child.kill("SIGTERM");
    assert.ok(await untilFile(path.join(root, "host-hits")), "宿主的 SIGTERM 监听没被叫到");
    assert.ok((await untilDead(pid)) && (await untilDead(-pgid)), "宿主有监听时指令也该随桥接收掉");
    // 多等一拍看会不会有第二笔：信号被重发的话宿主的常驻监听会再吃一次
    await sleep(300);
    assert.equal(fs.readFileSync(path.join(root, "host-hits"), "utf8").trim(), "x", "宿主监听收到了第二次（信号被重发）");
    assert.ok(alive(child.pid), "宿主有监听时桥接该交还宿主，不该自己退");
  } finally {
    if (pgid > 0)
      try {
        process.kill(-pgid, "SIGKILL");
      } catch {}
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
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
