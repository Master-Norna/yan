// 言 · 指令：run_command 与后台指令的 check_command。言与行都有，言里落在卷宗目录、行里落在工作目录。
// 三档权限：问而后行（只读免问）、审而后行（不请示，桥接代判放行或回绝）、径行；逐段对话设置，请示条上按「径行」即切过去
defineTool({
  name: "run_command",
  group: "work",
  label: "运行",
  offer: ctx => ctx.files,
  sideEffect: true,
  audit: true,
  writes: true,
  html: workStepHtml,
  approval: commandApprovalHtml,
  digest: true,
  async run(step, args, ctx) {
    const { conversation, signal } = ctx,
      { workdir, sandbox } = workScope(conversation);
    step.title = args.command.trim();
    if (!step.title) return { ok: false, content: "指令为空", display: "指令为空" };
    step.readOnly = isReadOnlyCommand(step.title);
    const background = args.background === true;
    if (background) step.background = true;
    let policy = commandPolicyOf(conversation);
    // 问而后行开着沙箱：先问一声严的沙箱会不会拦。会拦的也请示（只读的也不例外），请示条写明原因；批了这一条就出沙箱跑
    if (policy === "ask" && sandbox) {
      const screened = await bridge("/api/work/screen", { workdir, command: step.title }, signal).catch(() => null);
      step.sandboxWhy = screened?.why || undefined;
    }
    let escalated = false;
    if (policy === "ask" && (!step.readOnly || step.sandboxWhy)) {
      if (!(await askApproval(step, ctx))) {
        step.skipped = true;
        return { ok: false, content: prompt("assistant.declined"), display: "已跳过" };
      }
      escalated = !!step.sandboxWhy;
    }
    // 用户可能在请示条上把这一段对话切成了径行：执行前再取一次，不沿用旧档位
    policy = commandPolicyOf(conversation);
    const data = await bridge(
      "/api/work/run",
      {
        workdir,
        sandbox: sandbox && !escalated,
        permission: policy,
        command: step.title,
        timeout: Number(args.timeout) || 120,
        background
      },
      signal
    );
    const seconds = (data.durationMs / 1000).toFixed(data.durationMs < 10000 ? 1 : 0),
      marks = `${escalated ? " · 出沙箱" : ""}${step.readOnly && policy === "ask" && !step.sandboxWhy ? " · 只读免确认" : ""}`;
    step.output = commandOutput(data);
    if (background) {
      step.exitCode = data.exitCode ?? undefined;
      // 还在跑的：等它结束再叫醒开它的那一个——主答（这段对话），或帮手自己（帮手手上有它就睡着等，见 90-delegate.js）
      if (data.running) {
        step.bg = { id: data.id, key: data.key, state: "running" };
        watchBackground(conversation, ctx.assistant, step);
      }
      return {
        ok: data.running || data.exitCode === 0,
        content: `${data.running ? prompt("work.bgStarted", { id: data.id, seconds }) : `后台指令 ${data.id} 已结束，退出码：${data.exitCode}`}\n--- stdout ---\n${data.stdout || "(空)"}\n--- stderr ---\n${data.stderr || "(空)"}`,
        display: `后台 ${data.id} · ${data.running ? "进行中" : `已结束 · 退出码 ${data.exitCode}`}${marks}`
      };
    }
    step.exitCode = data.exitCode;
    return {
      ok: !data.timedOut && data.exitCode === 0,
      content: `退出码：${data.exitCode}${data.timedOut ? "（超时被终止）" : ""}\n--- stdout ---\n${data.stdout || "(空)"}\n--- stderr ---\n${data.stderr || "(空)"}`,
      display: `${data.timedOut ? `超时终止 · ${seconds}s` : data.exitCode === 0 ? `完成 · ${seconds}s` : `退出码 ${data.exitCode} · ${seconds}s`}${marks}`
    };
  }
});

// 后台指令：取上次之后的新输出，可顺带等一会儿，或结束它；跟着 run_command 走——言里也能开后台指令，开了就得看得了
defineTool({
  name: "check_command",
  group: "work",
  label: "后台",
  offer: ctx => ctx.files,
  html: workStepHtml,
  async run(step, args, { conversation, assistant, signal }) {
    const id = args.id.trim(),
      stop = args.stop === true,
      started = bgStepOf(conversation, id);
    step.title = `${id}${stop ? " · 结束" : ""}`;
    // 模型亲手结束它：不必再叫醒一回
    if (stop && started) bgWatches.get(started.id)?.abort();
    const data = await bridge("/api/work/check", { id, stop, wait: Number(args.wait) || 0 }, signal);
    step.output = commandOutput(data);
    if (!data.running) {
      step.exitCode = data.exitCode;
      if (started) settleBackground(started, stop ? "stopped" : "done", data.exitCode, assistant);
    }
    return {
      ok: true,
      content: `${data.running ? `${data.id} 还在进行` : `${data.id} 已结束，退出码：${data.exitCode}`}\n--- 新的 stdout ---\n${data.stdout || "(空)"}\n--- 新的 stderr ---\n${data.stderr || "(空)"}`,
      display: data.running ? "进行中" : stop ? "已结束" : `已结束 · 退出码 ${data.exitCode}`
    };
  }
});

// ---------- 后台指令结束即叫醒 ----------
// 桥接那头等它结束再回话（/api/work/watch，走总线不占连接），结果照帮手回报的路子寄给这段对话（mailReport）：
// 正作答就在回合边界递上，没在作答就另起一答。模型挂上就能收尾去睡，不必轮询；要过一阵再做的，挂一条先等待的后台指令即是定时。
// 页面刷新后重新等上（rewatchBackground）；桥接那头只报一回，几处页面同等着也不会叫醒两次
/** @param {Conversation} conversation @param {Message} assistant @param {Step} step */
function watchBackground(conversation, assistant, step) {
  if (bgWatches.has(step.id) || !step.bg) return;
  // 叫醒时用这段对话自己的模型（续答与记账都归它），不是页面此刻开着的那段的
  const controller = new AbortController(),
    profile = requestJob(conversation.id)?.profile || profiles().find(p => p.id === conversation.profileId) || activeProfile();
  bgWatches.set(step.id, controller);
  holdAwake();
  bridge("/api/work/watch", { id: step.bg.id, key: step.bg.key }, controller.signal)
    .then(
      data => {
        if (data.superseded) return;
        if (data.lost) return settleBackground(step, "lost", undefined, assistant);
        // 模型自己看过它结束了（check_command），只把签改成已结束，不再叫醒
        const fresh = !data.reported;
        if (fresh) step.output = trimOutput([step.output, commandOutput(data)].filter(Boolean).join("\n"));
        settleBackground(step, "done", data.exitCode, assistant);
        if (!fresh) return;
        mailReport(conversation, {
          report: prompt("work.bgDone", {
            id: data.id,
            command: String(data.command || step.title).slice(0, 200),
            exitCode: data.exitCode,
            duration: spokenDuration(data.durationMs),
            stdout: data.stdout || "(空)",
            stderr: data.stderr || "(空)"
          }),
          step,
          profile,
          relay: { step: step.id, title: data.id, ok: data.exitCode === 0, kind: "bg", exitCode: data.exitCode }
        });
      },
      error => {
        if (error.name === "AbortError") return;
        // 桥接断了一下（重启、睡眠醒来）：稍候再等；重启过的，那时会回 lost
        setTimeout(() => {
          if (store.conversations.includes(conversation) && step.bg?.state === "running") watchBackground(conversation, assistant, step);
        }, 10000);
      }
    )
    .finally(() => {
      if (bgWatches.get(step.id) === controller) bgWatches.delete(step.id);
      holdAwake();
    });
}
// 签上写它此刻的样子：结束了（退出码）、亲手结束、随桥接重启而没了
/** @param {Step} step @param {"done"|"stopped"|"lost"} state @param {Message} assistant */
function settleBackground(step, state, exitCode, assistant) {
  if (!step.bg || step.bg.state !== "running") return;
  bgWatches.get(step.id)?.abort();
  step.bg.state = state;
  if (exitCode !== undefined) step.exitCode = exitCode;
  step.result =
    state === "lost"
      ? `后台 ${step.bg.id} · 随桥接重启而止`
      : `后台 ${step.bg.id} · 已结束${exitCode !== undefined && exitCode !== null ? ` · 退出码 ${exitCode}` : ""}`;
  const conversation = store.conversations.find(c => c.messages.includes(assistant));
  if (conversation) markDirty(conversation.id);
  saveStoreSoon();
  refreshSteps(assistant);
  // 帮手开的：它若睡着等，叫它看一眼——有信就接着做，等的都了结了就收工（随桥接重启而止的不寄信，见 mailHelper）
  if (step.scope && conversation) (crews.get(conversation.id) || []).find(box => box.sub.id === step.scope)?.wake?.();
}
// 这段对话里编号为 id 的那条后台指令（编号在桥接重启后会重数：取最近的一条）
/** @param {Conversation} conversation */
function bgStepOf(conversation, id) {
  return (
    conversation.messages
      .flatMap(message => message.steps || [])
      .filter(step => step.bg?.id === id)
      .at(-1) || null
  );
}
// 开页时：还记着「在等」的后台指令重新等上（桥接没重启过，它们多半还在跑，或已结束等着报）；别处正作答的那几段留给别处
function rewatchBackground() {
  for (const conversation of store.conversations) {
    if (remoteBusy.has(conversation.id)) continue;
    for (const message of conversation.messages)
      for (const step of message.steps || []) if (step.bg?.state === "running") watchBackground(conversation, message, step);
  }
}
/** @param {number} ms */
function spokenDuration(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  return seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.round(seconds / 60)} 分` : `${(seconds / 3600).toFixed(1)} 小时`;
}
function commandOutput(data) {
  return trimOutput([data.stdout, data.stderr].filter(Boolean).join(data.stdout && data.stderr ? "\n--- stderr ---\n" : ""));
}
// 文件与指令工具发给桥接的共同几样：落在哪个目录、能不能出目录、沙箱开没开、这段对话的档位
/** @param {Conversation} conversation */
function workScope(conversation) {
  const workdir = workRoot(conversation);
  if (!workdir) throw Error("此对话没有可用的目录（本机桥接不在线）");
  return { workdir, roam: roamAllowed(), sandbox: sandboxed(), permission: commandPolicyOf(conversation) };
}
// 文件工具能不能出目录：设置里的「可及范围」，默认全盘（系统级配置、别处的资料本就该读得到）
function roamAllowed() {
  return store.settings.toolReach !== "inside";
}

// 「问而后行」里的本机规则：明确只读才免确认。系统检查纳入白名单；只允许一组纯展示管道，脚本块、远程会话与重定向仍去请示
const READ_ONLY_COMMAND =
    /^(?:git\s+(?:status|log|diff|show|rev-parse|ls-files|remote\s+-v)\b|git\s+branch(?:\s+(?:-a|-r|-v|-vv|--list))*\s*$|(?:ls|dir|tree|pwd|cat|type|head|tail|wc|grep|findstr|which|where|whoami|hostname|uname|uptime|free|df|du|ps|lscpu|lsmem|lsblk|lspci|lsusb|mount|id|groups|sw_vers|vm_stat)\b|Get-(?:ChildItem|Content|Location|Command|Item|ItemProperty|Date|ComputerInfo|CimInstance|WmiObject|Process|Service|NetAdapter|NetIPConfiguration|NetIPAddress|NetRoute|NetTCPConnection|NetUDPEndpoint|DnsClientServerAddress|Volume|Disk|Partition|PhysicalDisk|StorageReliabilityCounter|MpComputerStatus|HotFix|WinEvent|EventLog|ScheduledTask|LocalUser|LocalGroup|Acl|Package)\b|Select-String\b|(?:systeminfo|tasklist|driverquery|ipconfig|netstat)\b|sc(?:\.exe)?\s+query\b|wmic(?:\.exe)?\b[^\n]*\bget\b|wsl(?:\.exe)?\s+(?:--status|--version|-l\b|--list\b)|docker\s+(?:version|info|ps|images)\b|(?:node|npm|npx|python|python3|pip|dotnet|java|go|cargo|rustc|ruby|php|git)\s+(?:-v|-V|--version|version)\s*$)/i,
  READ_ONLY_PIPE =
    /^(?:Select-Object|Sort-Object|Format-Table|Format-List|ConvertTo-Json|Measure-Object|Group-Object|findstr|grep|head|tail|wc)\b/i;
function isReadOnlyCommand(command) {
  const text = String(command || "").trim();
  if (/[;&<>`\n{}]|\$\(|\|\|/.test(text) || /-(?:ComputerName|CimSession|Session|Credential)\b/i.test(text)) return false;
  // git log / diff 带 --output 会写文件，--ext-diff 会跑外部程序：都不算只读
  if (/--output\b|--ext-diff\b/i.test(text)) return false;
  const parts = text.split("|").map(part => part.trim());
  return !!parts[0] && READ_ONLY_COMMAND.test(parts[0]) && parts.slice(1).every(part => READ_ONLY_PIPE.test(part));
}
// 沙箱会拦下的指令：请示时写明原因（去掉「沙箱拒绝：」的前缀），批了这一条就出沙箱跑
/** @param {Step} step */
function sandboxWhyHtml(step) {
  return step.sandboxWhy
    ? `<div class="approval-sandbox">沙箱会拦下：${escapeHtml(step.sandboxWhy.replace(/^沙箱拒绝：/, ""))}。运行即在沙箱外执行这一条。</div>`
    : "";
}
/** @param {Step} step */
function commandApprovalHtml(step) {
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title">${isWork(currentConversation()) ? "执事请示" : "本机请示"} · 运行此指令${step.background ? "（后台）" : ""}</span><span class="approval-hint" title="输入框留空时，Enter 即运行">Enter 运行</span></div><pre class="approval-cmd">${escapeHtml(step.title)}</pre>${sandboxWhyHtml(step)}<div class="approval-actions"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="径行：此对话中后续指令不再询问">径行</button></div>`;
}
