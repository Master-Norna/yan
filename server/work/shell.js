// 言 · 桥接 · 执事的 shell：起指令（输出转 UTF-8、机密环境变量按沙箱去掉）、整棵收掉进程树、后台指令；桥接退出时一并收掉
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const sandbox = require("../sandbox.js");
const { OWN_GROUP, killTree, killTreeSync } = require("../platform.js");
const { tail, decodeClixml, encodePowerShell } = require("./text.js");

// Windows 上有 PowerShell 7（pwsh）就用它：被 Select-Object -First 截断的原生程序不再报退出码 -1、&& 与 || 可用、
// 原生程序的 stderr 经 2>&1 不再裹成一串 NativeCommandError；没装的退回系统自带的 Windows PowerShell 5.1
const PWSH = process.platform === "win32" && spawnSync("where.exe", ["pwsh"], { windowsHide: true }).status === 0;
const WORK_SHELL = process.platform !== "win32" ? "sh" : PWSH ? "PowerShell 7" : "Windows PowerShell 5.1";
// 包在指令外的一层：先把输入输出切到 UTF-8，再把指令（经环境变量 YAN_COMMAND 递进来）当作一段脚本解析、在当前作用域执行。
// 指令若直接拼进来，写错了（bash 的 heredoc 之类）整段解析不过、切编码那行也没跑，报错按系统代码页吐出来就成了乱码；
// 分开解析，报错是读得懂的字，模型一看就知道改。末尾追记的 $? 是指令最后一句成没成（包成脚本块后外头的 $? 不再是它）。
// 原生程序的退出码在 $LASTEXITCODE；cmdlet 出错不设它，靠那个 $? 兜底，让模型能从退出码看出失败。
// 5.1 下原生程序经 2>&1 写了 stderr（git clone、npm install 的进度）也会让 $? 为假、$LASTEXITCODE 却是 0：最近一条错是
// NativeCommandError 的就不算失败，退出码以 $LASTEXITCODE 为准。
// 5.1 的读写文件 cmdlet 默认按系统代码页、> 写 UTF-16：统一成 UTF-8（写出带 BOM，5.1 读 .ps1 才不当 ANSI），与 write_file 写出的读得通
const POWERSHELL_WRAPPER = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'
if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }
if ($PSVersionTable.PSVersion.Major -lt 6) { foreach ($__c in 'Get-Content','Set-Content','Add-Content','Out-File','Export-Csv','Import-Csv','Select-String') { $PSDefaultParameterValues["$($__c):Encoding"] = 'utf8' } }
try { $__yan = [ScriptBlock]::Create($env:YAN_COMMAND + [Environment]::NewLine + '$__yanOk = $?') }
catch { [Console]::Error.WriteLine("PowerShell 解析不了这条指令：" + $(if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message })); exit 1 }
Remove-Item Env:YAN_COMMAND
$__yanOk = $true
. $__yan
if ($LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $__yanOk -and -not ($Error.Count -and "$($Error[0].FullyQualifiedErrorId)" -like 'NativeCommandError*')) { exit 1 }`;
const WORK_OUTPUT_LIMIT = 20000;
// 交给模型的输出：stderr 里 PowerShell 的 CLIXML 还原成字，终端的颜色控制符（pytest、PowerShell 7 的报错都会带）去掉，过长的留尾
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const shownOutput = (text, stderr = false) =>
  tail((stderr && process.platform === "win32" ? decodeClixml(text) : text).replace(ANSI, ""), WORK_OUTPUT_LIMIT);
module.exports = function createShell({ toolEnv }) {
  // 起一个 shell 跑指令（Windows 上外面包一层，见 POWERSHELL_WRAPPER）；指令经环境变量递进去，比塞进命令行能长两倍多
  function spawnShell(command, cwd, { boxed = false, env = {} } = {}) {
    const win = process.platform === "win32";
    const args = win
      ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(POWERSHELL_WRAPPER)]
      : ["-c", command];
    const child = spawn(win ? (PWSH ? "pwsh.exe" : "powershell.exe") : "/bin/sh", args, {
      cwd,
      windowsHide: true,
      ...OWN_GROUP,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...toolEnv(boxed ? sandbox.sandboxEnv(process.env) : process.env),
        TERM: "dumb",
        NO_COLOR: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        CI: "1",
        // 窗口是隐藏的、没有输入：git 要在控制台问凭据、问主机指纹、开编辑器写提交说明，只会挂到超时。
        // 让它当场失败、把原因报出来（凭据管理器的登录窗不受影响）；用户自己设了的照旧
        GIT_TERMINAL_PROMPT: "0",
        GIT_EDITOR: process.env.GIT_EDITOR || "true",
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
        ...env,
        ...(win ? { YAN_COMMAND: command } : {})
      }
    });
    // 按字交出输出：一块一块各自解码，汉字恰好跨在两块之间就被劈成两个 �
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    runningShells.add(child);
    // 外壳退了、它起的孙进程（start /b 起的服务、会常驻的工具）还攥着输出管道：close 要等它们都退才来，指令一直挂着，
    // 超时与停止也收不到（外壳已不在，killTree 无从下手）。外壳退后稍等片刻，管道还没合上就松手，按外壳的退出收尾
    child.once("exit", () => {
      const timer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
      }, 1500);
      child.once("close", () => clearTimeout(timer));
    });
    child.on("close", () => runningShells.delete(child));
    child.on("error", () => runningShells.delete(child));
    return child;
  }
  // 正在跑的 shell（前台与后台）：桥接退出时整棵收掉，不留在后台改文件、占端口
  const runningShells = new Set();
  function runShell(command, cwd, timeoutMs, signal = null, { boxed = false, env = {} } = {}) {
    return new Promise(resolve => {
      const child = spawnShell(command, cwd, { boxed, env });
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
          stdout: shownOutput(stdout),
          stderr: shownOutput(stderr, true),
          timedOut,
          aborted
        });
      });
    });
  }
  // ---- 后台指令：开发服务器、监听构建这类不会自己结束的，放到后台跑，先回头几秒的输出与一个编号，之后用 check_command 取新输出或结束它。
  // 桥接退出时一并收掉。只记最近的若干个，跑完的旧账先清
  const BACKGROUND_KEEP = 24,
    backgroundJobs = new Map();
  let backgroundSeq = 0;
  // 编号在桥接重启后从 bg1 重数：另记一个带这次启动标记的 key，页面刷新后重新等上时按它认，不会等到别的指令上
  const BOOT = Date.now().toString(36);
  function startBackground(command, workdir, boxed) {
    return enlist(spawnJob(command, workdir, boxed));
  }
  // 起进程、接住两路输出，先不编号：前台指令也这样起，跑完了就不占编号与名额，转入后台时才登记（enlist）
  function spawnJob(command, workdir, boxed) {
    const child = spawnShell(command, workdir, { boxed }),
      job = {
        id: "",
        key: "",
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
    // 结束了（或压根没起来）：等着它的页面据此叫醒模型（见 watchBackground）
    job.ended = new Promise(resolve => {
      child.once("close", resolve);
      child.once("error", resolve);
    });
    return job;
  }
  function enlist(job) {
    job.id = `bg${++backgroundSeq}`;
    job.key = `${BOOT}-${backgroundSeq}`;
    for (const [id, old] of backgroundJobs) if (backgroundJobs.size >= BACKGROUND_KEEP && old.exitCode !== null) backgroundJobs.delete(id);
    backgroundJobs.set(job.id, job);
    return job;
  }
  // ---- 前台指令（run_command 不带 background）：起法同后台指令，等它结束再回话。等满 waitMs 还没完、或页面说有话要递
  // （用户补言、主模型递话给帮手，见 releaseForeground），就编号转入后台接着跑，不掐——模型当即拿回结果去做别的、读插话，
  // 结束时照后台指令的路子叫醒它。页面停止生成（signal）才连整棵进程树收掉
  const releases = new Map();
  async function runForeground(command, workdir, boxed, waitMs, signal, ticket) {
    const job = spawnJob(command, workdir, boxed);
    let timer, onAbort;
    const why = await Promise.race([
      job.ended.then(() => "ended"),
      new Promise(resolve => {
        timer = setTimeout(resolve, waitMs, "waited");
        releases.set(ticket, () => resolve("released"));
        onAbort = () => resolve("aborted");
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      })
    ]);
    clearTimeout(timer);
    releases.delete(ticket);
    signal?.removeEventListener("abort", onAbort);
    if (why === "aborted") {
      killTree(job.child);
      return { job, report: null };
    }
    if (why !== "ended") enlist(job);
    return { job, report: { ...(await backgroundReport(job, 0)), ...(why === "ended" ? {} : { handedOff: why }) } };
  }
  function releaseForeground(ticket) {
    const release = releases.get(String(ticket || ""));
    release?.();
    return { released: !!release };
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
      key: job.key,
      running: job.exitCode === null,
      exitCode: job.exitCode,
      stdout: shownOutput(out),
      stderr: shownOutput(err, true),
      durationMs: Date.now() - job.started
    };
  }
  // 尚未把编号交给页面便断开：无人能再凭编号叫停它，立即撤去并收掉进程。
  function discardBackground(job) {
    backgroundJobs.delete(job.id);
    job.reported = true;
    killTree(job.child);
  }
  // 桥接退出时把还在跑的指令（前台的与后台的）一并收掉，连根
  process.on("exit", () => {
    for (const child of runningShells) killTreeSync(child);
  });
  // check_command：取后台指令的新输出；stop 时先收掉它（最多等三秒）
  // key：页面收口时带上（编号在桥接重启后重数，不带 key 可能收到别的指令上）
  async function checkBackground(id, stop, waitMs, key = "") {
    const job = backgroundJobs.get(String(id || ""));
    if (!job || (key && job.key !== key)) throw Error(`没有编号为 ${id} 的后台指令（桥接重启过的话，之前的后台指令已随之结束）`);
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
    const report = await backgroundReport(job, waitMs);
    // 模型自己看到它结束了：不必再叫醒一回
    if (!report.running) job.reported = true;
    return report;
  }
  // 等后台指令结束再回话：页面据此叫醒模型，模型挂上就能收尾去睡，不必轮询。结束只报一回——
  // 几处页面都在等、或刷新后重新等上的，后来的接手，先前的作罢（superseded）；报过的不再报（reported）；
  // 桥接重启过，旧编号已不在（lost）
  // 模型自己用 check_command 看到它结束了的，也算报过（reported，带上退出码，页面只把签改成已结束）
  async function watchBackground(id, key, signal) {
    const job = backgroundJobs.get(String(id || ""));
    if (!job || (key && job.key !== key)) return { id, lost: true };
    if (job.reported) return { id, reported: true, exitCode: job.exitCode };
    const ticket = (job.watchTicket = (job.watchTicket || 0) + 1);
    await Promise.race([job.ended, new Promise(resolve => signal?.addEventListener("abort", resolve, { once: true }))]);
    if (ticket !== job.watchTicket || signal?.aborted) return { id, superseded: true };
    if (job.reported) return { id, reported: true, exitCode: job.exitCode };
    job.reported = true;
    return { ...(await backgroundReport(job, 0)), command: job.command };
  }
  return {
    WORK_SHELL,
    runShell,
    runForeground,
    releaseForeground,
    startBackground,
    backgroundReport,
    discardBackground,
    checkBackground,
    watchBackground,
    // 还有后台指令在跑：言.exe 起的桥接据此不随页面退出（见 server.js 的 --exit-with-page）
    backgroundRunning: () => [...backgroundJobs.values()].some(job => job.exitCode === null)
  };
};
