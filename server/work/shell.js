// 言 · 桥接 · 执事的 shell：起指令（输出转 UTF-8、机密环境变量按沙箱去掉）、整棵收掉进程树、后台指令；桥接退出时一并收掉
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const sandbox = require("../sandbox.js");
const { tail, decodeClixml, encodePowerShell } = require("./text.js");

const WORK_SHELL = process.platform === "win32" ? "PowerShell" : "sh";
const WORK_OUTPUT_LIMIT = 20000;
// 杀整棵进程树：PowerShell 起的子进程（node、python、构建脚本）不能只杀 shell 本身，否则用户点了停止，脚本还在后台改文件
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform !== "win32") return child.kill("SIGKILL");
  // taskkill 能把孙进程一起收掉，但受限环境里可能被系统拒绝；那时至少要终止直属 shell，不能让指令继续写文件。
  const killShell = () => {
    if (child.exitCode !== null || child.signalCode) return;
    try {
      child.kill("SIGKILL");
    } catch {}
  };
  const killer = spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" }),
    fallback = setTimeout(killShell, 750);
  killer.once("error", killShell);
  killer.once("close", code => {
    clearTimeout(fallback);
    if (code) killShell();
  });
}
module.exports = function createShell({ toolEnv }) {
  // 起一个 shell 跑指令：PowerShell 默认按系统代码页输出，中文会成乱码；先把输入输出都切到 UTF-8。
  // 原生程序的退出码在 $LASTEXITCODE；cmdlet 出错不设它，靠 $? 兜底，让模型能从退出码看出失败
  function spawnShell(command, cwd, { boxed = false } = {}) {
    const win = process.platform === "win32";
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'
  ${command}
  $ok = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $ok) { exit 1 }`;
    const args = win
      ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)]
      : ["-c", command];
    const child = spawn(win ? "powershell.exe" : "/bin/sh", args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...toolEnv(boxed ? sandbox.sandboxEnv(process.env) : process.env),
        TERM: "dumb",
        NO_COLOR: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        CI: "1"
      }
    });
    // 按字交出输出：一块一块各自解码，汉字恰好跨在两块之间就被劈成两个 �
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    runningShells.add(child);
    child.on("close", () => runningShells.delete(child));
    child.on("error", () => runningShells.delete(child));
    return child;
  }
  // 正在跑的 shell（前台与后台）：桥接退出时整棵收掉，不留在后台改文件、占端口
  const runningShells = new Set();
  function runShell(command, cwd, timeoutMs, signal = null, { boxed = false } = {}) {
    return new Promise(resolve => {
      const win = process.platform === "win32";
      const child = spawnShell(command, cwd, { boxed });
      let stdout = "",
        stderr = "",
        timedOut = false;
      const cap = (prev, chunk) => (prev + chunk.toString("utf8")).slice(-WORK_OUTPUT_LIMIT * 2);
      child.stdout.on("data", chunk => {
        stdout = cap(stdout, chunk);
      });
      child.stderr.on("data", chunk => {
        stderr = cap(stderr, chunk);
      });
      let aborted = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      // 页面停止生成（请求被中止）：连整棵进程树一起收掉
      const onAbort = () => {
        aborted = true;
        killTree(child);
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", error => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({ exitCode: -1, stdout, stderr: `${stderr}\n无法启动 shell：${error.message}`.trim(), timedOut, aborted });
      });
      child.on("close", (code, signalName) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve({
          exitCode: code ?? (timedOut ? 124 : signalName || aborted ? 1 : 0),
          stdout: tail(stdout, WORK_OUTPUT_LIMIT),
          stderr: tail(win ? decodeClixml(stderr) : stderr, WORK_OUTPUT_LIMIT),
          timedOut,
          aborted
        });
      });
    });
  }
  // ---- 后台指令：开发服务器、监听构建这类不会自己结束的，放到后台跑，先回头几秒的输出与一个编号，之后用 check_command 取新输出或结束它。
  // 后台指令不拿目录锁（它一直跑着，锁住了别的指令就都得排队）；桥接退出时一并收掉。只记最近的若干个，跑完的旧账先清
  const BACKGROUND_KEEP = 24,
    backgroundJobs = new Map();
  let backgroundSeq = 0;
  function startBackground(command, workdir, boxed) {
    const child = spawnShell(command, workdir, { boxed }),
      job = {
        id: `bg${++backgroundSeq}`,
        command,
        child,
        exitCode: null,
        started: Date.now(),
        grew: Date.now(),
        // 两路输出各留最近一截；base 是已裁掉的字数、read 是已交出去的位置（都按从头算的绝对位置记，裁了也对得上）
        text: { out: "", err: "" },
        base: { out: 0, err: 0 },
        read: { out: 0, err: 0 }
      };
    const take = (key, chunk) => {
      job.text[key] += chunk.toString("utf8");
      job.grew = Date.now();
      const cut = job.text[key].length - WORK_OUTPUT_LIMIT * 4;
      if (cut > 0) {
        job.text[key] = job.text[key].slice(cut);
        job.base[key] += cut;
      }
    };
    child.stdout.on("data", chunk => take("out", chunk));
    child.stderr.on("data", chunk => take("err", chunk));
    child.on("error", error => {
      take("err", `无法启动 shell：${error.message}`);
      job.exitCode = -1;
    });
    child.on("close", code => {
      job.exitCode = code ?? 1;
    });
    for (const [id, old] of backgroundJobs) if (backgroundJobs.size >= BACKGROUND_KEEP && old.exitCode !== null) backgroundJobs.delete(id);
    backgroundJobs.set(job.id, job);
    return job;
  }
  // 等到指令结束、输出停了一会儿（服务器起好了往往就不再出声）或时间到；交出去的是上次取过之后的新输出
  async function backgroundReport(job, waitMs) {
    const start = Date.now(),
      until = start + waitMs;
    while (Date.now() < until && job.exitCode === null && Date.now() - Math.max(job.grew, start) < 1500)
      await new Promise(resolve => setTimeout(resolve, 200));
    const fresh = key => {
      const text = job.text[key].slice(Math.max(0, job.read[key] - job.base[key]));
      job.read[key] = job.base[key] + job.text[key].length;
      return text;
    };
    const out = fresh("out"),
      err = fresh("err");
    return {
      id: job.id,
      running: job.exitCode === null,
      exitCode: job.exitCode,
      stdout: tail(out, WORK_OUTPUT_LIMIT),
      stderr: tail(process.platform === "win32" ? decodeClixml(err) : err, WORK_OUTPUT_LIMIT),
      durationMs: Date.now() - job.started
    };
  }
  // 桥接退出时把还在跑的指令（前台的与后台的）一并收掉（退出时起不了异步的 taskkill，用同步的）
  process.on("exit", () => {
    for (const child of runningShells)
      if (child.pid && child.exitCode === null && !child.signalCode)
        try {
          if (process.platform === "win32")
            spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" });
          else child.kill("SIGKILL");
        } catch {}
  });
  // check_command：取后台指令的新输出；stop 时先收掉它（最多等三秒）
  async function checkBackground(id, stop, waitMs) {
    const job = backgroundJobs.get(String(id || ""));
    if (!job) throw Error(`没有编号为 ${id} 的后台指令（桥接重启过的话，之前的后台指令已随之结束）`);
    if (stop && job.exitCode === null) {
      killTree(job.child);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 3000);
        job.child.once("close", () => {
          clearTimeout(timer);
          resolve(null);
        });
      });
    }
    return await backgroundReport(job, waitMs);
  }
  return { WORK_SHELL, killTree, runShell, startBackground, backgroundReport, checkBackground };
};
