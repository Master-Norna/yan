// 言 · 差遣：主模型把一件自成一段的子任务交给帮手，帮手另起一段对话做完后回报。桥接在线、且有别的活能交出去时才给；帮手自己不再差遣。
// 同一轮派出的几名帮手同时开工（parallel），活是主模型分的，不重叠靠它分派时留意（工具说明里有交代）。
// 帮手在后台做，不随派它的那一答收尾：主答只剩等待就收尾，回报到了另起一答（见 mailReport）——等着的时候没有谁醒着。
// 收了工的帮手还能续派，带着它先前的经过接着做（见 tellHelper）。行迹里只留一枚签，帮手自己的那条时间线开在差遣面板里（见 08-trail.js）
// 帮手与主答守同一句话：只剩等待就睡，信到了就醒——手上只剩自己挂的后台指令时先交一份进展、睡下，指令结束的消息寄给它自己（见 mailHelper）
defineTool({
  name: "delegate",
  group: "delegate",
  label: "差遣",
  offer: ctx => ctx.offered.some(name => name !== "ask_user"),
  // 思考档位只列这台模型认的几档：通用四档里有它不认的，主模型一挑中，帮手起跑就被接口拒；不认档位的模型不给这一项
  params: (parameters, ctx) => {
    const { effort, ...rest } = parameters.properties,
      levels = profileReasoningLevels(ctx.profile);
    return { ...parameters, properties: levels.length ? { ...rest, effort: { ...effort, enum: levels } } : rest };
  },
  mainOnly: true,
  sideEffect: true,
  parallel: true,
  run: delegateInBackground,
  html: step => delegateStepHtml(step),
  sync: syncDelegateCard,
  digest: step =>
    `差遣「${String(step.title || "").slice(0, 40)}」→ ${step.result || step.status}${subChangedPaths(step).length ? `，改了 ${subChangedPaths(step).slice(0, 8).join("、")}` : ""}`
});
// 给帮手递话：正做着的，话进它的收件口，说到落点时读到（同补言，不掐断）；已收工的即续派，带着先前的经过接着做。
// 叫停只停正做着的那一个，已做的照未完成回报。这一步在行迹里也是一枚签（续派 / 传话 / 叫停），点开是那名帮手
defineTool({
  name: "helper",
  group: "delegate",
  label: "传话",
  offer: ctx => ctx.offered.includes("delegate"),
  mainOnly: true,
  sideEffect: true,
  run: tellHelper,
  html: helperStepHtml,
  sync: syncHelperCard
});
// 作答途中回来的回报（帮手、后台指令）：落在行迹里它到达的那一刻，一小步，点开即那名帮手或挂它的那一步
defineTool({
  name: "relay_note",
  label: "回报",
  offer: false,
  html: relayStepHtml
});
// 递给帮手的话：落在帮手自己的时间线里它到达的那一刻，待递转圈、递到打勾（与补言同一种画法）
defineTool({
  name: "helper_note",
  label: "传话",
  offer: false,
  html: step => noteStepHtml(step, { seal: "传", label: "传话" })
});
/** 这段对话里帮手的每一趟（差遣与续派），按先后 @param {Conversation|null} conversation */
function helperRuns(conversation) {
  return (conversation?.messages || []).flatMap(message => (message.steps || []).filter(step => step.sub));
}
/** 同一名帮手的几趟认同一个 helper（头一趟的 id）；旧对话里没记的就是它自己 @param {Step} step */
const helperKey = step => step.sub?.helper || step.sub?.id || "";
/** @param {string} id */
// 这段对话里由这几条消息派出、还在做的帮手
/** @param {Conversation} c @param {Message[]} messages */
function crewOf(c, messages) {
  const ids = new Set(messages.map(message => message.id));
  return (crews.get(c.id) || []).filter(box => ids.has(box.host?.id));
}
function stopCrew(id) {
  for (const box of crews.get(id) || []) {
    box.halted = true;
    box.controller.abort();
  }
}
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 */
function tellHelper(step, args, ctx) {
  const name = String(args.helper || "").trim(),
    text = String(args.message || "").trim(),
    stop = args.stop === true,
    boxes = crews.get(ctx.conversation.id) || [],
    past = helperRuns(ctx.conversation)
      .filter(run => run.title === name && run !== step)
      .at(-1),
    // 名字对不上、又只有一名在做：多半说的就是它。可名字对得上一名收了工的，那就是要续派那一名
    box = boxes.find(item => item.title === name) || (!past && boxes.length === 1 ? boxes[0] : null),
    gone = () => ({
      ok: false,
      content: prompt("delegate.gone", {
        title: name,
        running: boxes.map(item => `「${item.title}」`).join("、") || "无",
        done:
          [...new Set(helperRuns(ctx.conversation).map(run => run.title))]
            .filter(title => !boxes.some(item => item.title === title))
            .map(title => `「${title}」`)
            .join("、") || "无"
      }),
      display: "没有这名帮手"
    });
  step.title = box?.title || past?.title || name;
  if (stop) {
    step.mode = "stop";
    if (!box) return gone();
    step.ref = box.step.id;
    box.controller.abort();
    return { ok: true, content: prompt("delegate.stopping", { title: box.title }), display: "已叫停" };
  }
  if (!text) return { ok: false, content: "message 不能为空", display: "无话" };
  step.note = text;
  if (box) {
    // 正做着：话落在它自己的时间线里，进它的收件口——正说着就等到句尾再停这一轮递上，正跑工具就等结果交回时递
    const sub = box.sub;
    /** @type {Step} */
    const note = {
      id: `note_${uid().slice(0, 8)}`,
      name: "helper_note",
      arguments: "{}",
      status: "running",
      title: text.split("\n").find(Boolean)?.slice(0, 80) || "",
      note: text,
      at: sub.content.length,
      rat: String(sub.reasoning || "").length
    };
    sub.steps.push(note);
    step.mode = "tell";
    step.ref = box.step.id;
    step.noteId = note.id;
    box.queue.push({ report: prompt("delegate.note", { text }), note });
    if (box.reading) watchSteer(box, sub);
    // 睡着等后台的：叫醒它读这句
    box.wake?.();
    refreshSteps(box.host);
    return { ok: true, content: prompt("delegate.noted", { title: box.title }), display: "已递" };
  }
  if (!past) return gone();
  // 已收工：续派。这一步自己成一趟，在当前的行迹里另起一枚签，点开看的是这一趟
  step.mode = "resume";
  launchHelper(step, { title: past.title, task: text }, ctx, past);
  return { ok: true, background: true, content: prompt("delegate.resumed", { title: past.title }), display: "后台进行中" };
}
// 差遣当即回一句「已开工」，主模型这一轮随即结束、照常往下走；帮手在后台做，做完回报寄给这段对话（见 mailReport）
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 */
function delegateInBackground(step, args, ctx) {
  const task = String(args.task || "").trim();
  step.title =
    String(args.title || "")
      .trim()
      .slice(0, 40) || task.slice(0, 24);
  if (!task) return { ok: false, content: "task 不能为空：请把背景、目标、边界与要回报的内容写全", display: "任务为空" };
  launchHelper(step, args, ctx);
  return { ok: true, background: true, content: prompt("delegate.started", { title: step.title }), display: "后台进行中" };
}
// 起一趟：差遣是头一趟，续派（past 是它上一趟）接着做。做完由它自己收尾这一步，回报寄给这段对话
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 * @param {Step|null} [past]
 */
function launchHelper(step, args, ctx, past = null) {
  const { conversation, assistant } = ctx,
    profile = requestJob(conversation.id)?.profile || activeProfile();
  // 进展：帮手只剩等后台、睡下之前交的那一份。这一步仍在做，回报照常寄
  const progress = outcome =>
    mailReport(conversation, {
      report: outcome.content,
      step,
      profile,
      relay: { step: step.id, title: String(step.title || ""), ok: true }
    });
  void runDelegate(step, args, ctx, profile, past, progress)
    .then(
      outcome => {
        step.status = outcome.ok ? "done" : "error";
        step.result = outcome.display;
        // 交过进展后没再做什么就收工了（等的后台随桥接重启而止）：进展已是最后的话，不再重报
        if (!outcome.quiet) mailReport(conversation, { report: outcome.content, step, profile });
      },
      error => {
        step.status = "error";
        // 用户停的（停止、刷新）：不回报，也就不再叫醒谁
        if (error.name === "AbortError") return void (step.result = "已停止");
        step.result = friendlyError(String(error.message || error));
        mailReport(conversation, {
          report: prompt("delegate.failed", {
            title: step.title,
            reason: step.result,
            steps: step.sub?.steps.length || 0,
            changed: "",
            partial: ""
          }),
          step,
          profile
        });
      }
    )
    .finally(() => {
      refreshSteps(assistant);
      markDirty(conversation.id);
      saveStore();
      renderHistory();
      if (currentId === conversation.id) renderSendButtons();
    });
  renderHistory();
}
// 帮手的回报（后台指令结束也走这里，见 20-command.js）：这段对话正在作答（模型布置完还在干别的），就进那一答的收件口，
// 在回合边界递上，行迹里它到达的那一刻落一小步「回报」（与补言同样大小，递到打勾）；
// 没在作答（主答只剩等待时已收尾），同一刻到的几份攒成一问另起一答——回报作这一问，两答之间是一道细线（见 relayHtml），不是用户的话。
// relay 是那一项的画法（谁回来了），不给就按帮手画
/** @type {Map<string, Array<{ report: string, step: Step, profile: Profile|null, relay?: any }>>} */
const mailbags = new Map();
/** @param {Conversation} conversation */
function mailReport(conversation, item) {
  // 帮手开的后台指令，结束时叫醒的是帮手自己（见 mailHelper），不是主对话
  if (item.step?.scope) return void mailHelper(conversation, item.step.scope, item);
  const job = requestJob(conversation.id);
  if (job) return void deliverInline(conversation, job, item);
  const bag = mailbags.get(conversation.id);
  if (bag) return void bag.push(item);
  mailbags.set(conversation.id, [item]);
  setTimeout(() => {
    const items = mailbags.get(conversation.id) || [];
    mailbags.delete(conversation.id);
    wakeWithReports(conversation, items);
  }, 0);
}
/** @returns {{ step: string, title: string, ok: boolean, kind?: "bg", exitCode?: number }} */
function relayOf({ step, relay }) {
  return relay || { step: step.id, title: String(step.title || ""), ok: step.status === "done" };
}
// 作答途中到的：行迹里落一步「回报」，递上后打勾（deliverSupplements 按 note 打勾）；这一答没来得及递就收尾了，
// settleSupplements 把这一步撤下、回报另起一答
/** @param {Conversation} conversation */
function deliverInline(conversation, job, item) {
  const host = conversation.messages.find(message => message.id === job.assistantId);
  if (host) {
    const relay = relayOf(item);
    /** @type {Step} */
    const note = {
      id: `relay_${uid().slice(0, 8)}`,
      name: "relay_note",
      arguments: "{}",
      status: "running",
      title: relay.title,
      relay,
      at: host.content.length,
      rat: String(host.reasoning || "").length
    };
    (host.steps ||= []).push(note);
    item = { ...item, note };
    refreshSteps(host);
  }
  job.queue.push(item);
}
// 寄给帮手的（它自己开的后台指令结束了）：与寄给主答同一个样子——它自己的时间线里落一小步「回报」，信进它的收件口，
// 正做着就在回合边界递上，睡着就叫醒它。它已收工（做完、叫停、页面刷新过），信就不送了，那一步的签照旧改成已结束
/** @param {Conversation} conversation @param {string} scope 帮手的 sub.id */
function mailHelper(conversation, scope, item) {
  const box = (crews.get(conversation.id) || []).find(entry => entry.sub.id === scope);
  if (!box) return;
  const relay = relayOf(item);
  /** @type {Step} */
  const note = {
    id: `relay_${uid().slice(0, 8)}`,
    name: "relay_note",
    arguments: "{}",
    status: "running",
    title: relay.title,
    relay,
    at: box.sub.content.length,
    rat: String(box.sub.reasoning || "").length
  };
  box.sub.steps.push(note);
  box.queue.push({ ...item, note });
  box.wake?.();
  refreshSteps(box.host);
}
// 帮手手上还在跑的后台指令：收工时有它们，帮手就睡下等
/** @param {SubAgent} sub */
function helperWaits(sub) {
  return sub.steps.filter(step => step.bg?.state === "running");
}
// 睡到有信来（或等的后台都了结了）：不发请求、没有谁醒着；叫停、停止照样打断
function sleepUntilMail(box) {
  const signal = box.controller.signal;
  return new Promise((resolve, reject) => {
    const stop = () => {
      box.wake = null;
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    box.wake = () => {
      box.wake = null;
      signal.removeEventListener("abort", stop);
      resolve(null);
    };
  });
}
/** @param {Conversation} conversation */
function wakeWithReports(conversation, items) {
  if (!items.length || !store.conversations.includes(conversation)) return;
  // 攒着的这一会儿里有人开了一答（用户发了话、上一答收尾时补言另起了一问）：交给它
  const job = requestJob(conversation.id);
  if (job) return void items.forEach(item => deliverInline(conversation, job, item));
  const profile = profiles().find(p => p.id === items[0].profile?.id) || activeProfile(),
    ready = profile && !quotaBlocked(profile);
  // 上一答断着（断网中断、报错）：另起一答会在断处底下留一截，续上那一答时它就成了残留，主线也从此分成两头。
  // 回报先记在这段对话上，下一答开工时递上（见 takeHeldReports）；中断的那一答就此续上，还断着就原样记着，等下一回
  const last = conversation.messages.at(-1);
  if (last?.role === "assistant" && (last.status === "interrupted" || last.status === "error")) {
    (conversation.heldReports ||= []).push(...items.map(item => ({ report: item.report, relay: relayOf(item) })));
    markDirty(conversation.id);
    saveStore();
    if (last.status === "interrupted" && ready) void resumeAnswer(conversation, last, profile);
    return;
  }
  /** @type {Message} */
  const user = {
    id: uid(),
    role: "user",
    content: items
      .map(item => item.report)
      .filter(Boolean)
      .join("\n\n"),
    timestamp: now(),
    relay: items.map(relayOf)
  };
  if (ready) return void startTurn(conversation, user, profile, { follow: false });
  // 没有可用的模型或余墨已尽：回报先记下，等用户换了模型再问
  conversation.messages.push(user);
  conversation.updatedAt = now();
  markDirty(conversation.id);
  saveStore();
  if (currentId === conversation.id && view === "chat") renderConversation();
  else renderHistory();
  toast(profile ? "余墨已尽，帮手的回报先记下了" : "没有可用的模型，帮手的回报先记下了");
}
// 断着时记下的回报交给开工的这一答：行迹里落一步「回报」，随后当即递上。派它的那一步已不在眼前这条路上的（重答把那一答收成了版本）不递，
// 免得张冠李戴。返回交出去的几项，这一答一个字没等到就又断了，原样还回去
/** @param {Conversation} conversation @returns {Array<{ report: string, relay: any, note?: Step }>} */
function takeHeldReports(conversation, job) {
  const held = conversation.heldReports || [];
  delete conversation.heldReports;
  const onPath = new Set(conversation.messages.flatMap(message => (message.steps || []).map(step => step.id)));
  return held
    .filter(item => onPath.has(item.relay.step))
    .map(item => {
      deliverInline(conversation, job, item);
      return job.queue.at(-1);
    });
}
/** @param {Conversation} conversation @param {Message} host */
function returnHeldReports(conversation, host, taken) {
  if (!taken.length) return;
  const notes = new Set(taken.map(item => item.note?.id));
  host.steps = (host.steps || []).filter(step => !notes.has(step.id));
  if (!host.steps.length) delete host.steps;
  conversation.heldReports = [...taken.map(({ report, relay }) => ({ report, relay })), ...(conversation.heldReports || [])];
}
// 续写一答时，它底下只有回报另起、又没写出东西就断了或停了的几答（断网时帮手回报的常见残留）：收回来，回报交给续上的这一答
/** @param {Conversation} conversation @param {Message} message */
function foldRelayTail(conversation, message) {
  const at = conversation.messages.indexOf(message),
    tail = conversation.messages.slice(at + 1),
    ids = new Set([message.id, ...tail.map(m => m.id)]);
  const empty = m =>
    m.role === "user" ? !!m.relay?.length : m.role === "assistant" && m.status !== "streaming" && !m.content.trim() && !m.steps?.length;
  if (at < 0 || !tail.length || !tail.every(empty) || (conversation.forks || []).some(fork => ids.has(fork.parentId))) return;
  conversation.messages = conversation.messages.slice(0, at + 1);
  const folded = tail
    .filter(m => m.role === "user")
    .flatMap(m => (m.relay || []).map((relay, i) => ({ report: i ? "" : m.content, relay })));
  conversation.heldReports = [...folded, ...(conversation.heldReports || [])];
}
// 派它的那一答收尾时它还没做完，墨没算进去：做完了记回那一答
/** @param {Message} assistant @param {Profile|null} profile */
function chargeHelper(assistant, usage, profile) {
  const spent = Number(usage?.total_tokens || 0);
  if (!spent || !profile) return;
  assistant.usage ||= { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  for (const key of Object.keys(usage)) assistant.usage[key] = Number(assistant.usage[key] || 0) + Number(usage[key] || 0);
  assistant.tokenCount = Number(assistant.tokenCount || 0) + spent;
  spendTokens(profile, spent);
  renderQuota();
}
// 续派时帮手先前的经过：每一趟一问一答（所领之命 → 回报），上一趟的行迹冠在下一趟的命前，与主对话的历史同一个写法
/** @param {Conversation} conversation @param {Step} past */
function helperHistory(conversation, past) {
  const runs = helperRuns(conversation),
    key = helperKey(past),
    mine = runs.slice(0, runs.indexOf(past) + 1).filter(run => helperKey(run) === key),
    history = [];
  mine.forEach((run, i) => {
    const trail = i ? stepsDigest(mine[i - 1].sub, "上一答的行迹") : "";
    history.push(
      { role: "user", content: `${trail ? `${trail}\n\n` : ""}${run.sub.task}` },
      { role: "assistant", content: String(run.sub.report || run.sub.content || "").trim() || "（未留回报）" }
    );
  });
  return history;
}
/** @param {Step} step */
function subChangedPaths(step) {
  return [...new Set((step.sub?.steps || []).filter(s => s.change && s.status === "done").map(s => s.change.path))];
}
// 一趟差遣：帮手用同一个模型、同一套工具（不再差遣、不请示用户）另起一段对话跑自己的工具轮次（上限见设置），
// 步骤都画在派它的那一答的差遣卡片里（指令照样问而后行），做完把最后一轮的回报连同改动摘要交回
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 * @param {Profile|null} profile
 * @param {Step|null} past 续派时它的上一趟
 * @param {(outcome: { ok: boolean, content: string, display: string }) => void} progress 只剩等后台、睡下之前交一份进展
 */
async function runDelegate(step, args, ctx, profile, past, progress) {
  const { conversation, assistant } = ctx;
  const task = String(args.task).trim();
  if (!profile) return { ok: false, content: "没有可用的模型", display: "无模型" };
  const tools = toolDefinitions(conversation, { sub: true });
  if (!tools) return { ok: false, content: "此对话里没有可交给帮手的工具", display: "无工具可用" };
  const id = `sub-${uid()}`;
  // 思考强度：主模型按活的难易给（省略即同主答），续派沿用这名帮手上一趟的；记下的是模型实际认的那一档，卡片上标出
  const asked = REASONING_ORDER.includes(args.effort) ? args.effort : past?.sub?.effort || conversation.reasoning || "",
    effort = nearestReasoning(profile, asked);
  /** @type {SubAgent} */
  const sub = {
    id,
    helper: past ? helperKey(past) : id,
    task,
    content: "",
    reasoning: "",
    steps: [],
    status: "streaming",
    usage: null,
    ...(effort ? { effort } : {})
  };
  step.sub = sub;
  // 领命时附上主对话的账本（只读）：目标与约束它也得知道，开头提过的一条小约束才不会在分出去的活里丢了。
  // 领命这一刻现读：「先定下约束、再派活」最常见，开工时读的那份往往是旧的，甚至还没有
  await loadLedger(conversation, ctx.signal);
  // 读账本这一会儿里按了「止」：它把中止吞了，这里补上——帮手还没登记，过了这里 stopCrew 就找不到它
  ctx.signal?.throwIfAborted();
  const lead = past ? stepsDigest(past.sub, "上一答的行迹") : "";
  const history = [
    ...(past ? helperHistory(conversation, past) : []),
    { role: "user", content: `${ledgerNote(conversation, "sub", profile)}${lead ? `${lead}\n\n` : ""}${task}` }
  ];
  const overrides = {
    systemPrompt: systemPrompt(conversation, tools, { role: "sub" }),
    tools,
    reasoning: effort,
    // 跑得久了上下文会满：任务说明（续派时连同先前的几趟）之后的往来由 readReply 按需压成工作笔记（见 keepInWindow），帮手接着做
    head: history.length,
    onFold: busy => {
      const job = requestJob(conversation.id);
      if (job) setJobLabel(conversation, job, busy ? "帮手整理上下文" : "");
    }
  };
  // 帮手自己的收件口与中止器，与主答的 job 同形，轮次循环照收：主模型经 helper 递来的话等它说到落点再递（同补言）。
  // 叫停（halted 为假）只停它一个、已做的照未完成回报；用户按停止（halted）则不回报
  const box = {
    controller: new AbortController(),
    queue: [],
    round: null,
    reading: false,
    roundStart: 0,
    steerTimer: 0,
    halted: false,
    // 睡着等后台时由 sleepUntilMail 挂上：来信（mailHelper、传话）或等的指令了结（settleBackground）即叫醒
    /** @type {(() => void)|null} */
    wake: null,
    sub,
    step,
    host: assistant,
    title: step.title
  };
  crews.set(conversation.id, [...(crews.get(conversation.id) || []), box]);
  const tally = newTally(),
    started = performance.now();
  sub.startedAt = Date.now();
  // 帮手的话是逐字流进来的，卡片每隔一小会儿刷一次，不必每个字都重画
  let painted = "";
  const paint = () => {
    const sig = `${sub.content.length}|${sub.reasoning.length}|${sub.status}|${sub.steps.map(s => s.status).join("")}|${Math.floor((Date.now() - sub.startedAt) / 1000)}`;
    if (sig === painted) return;
    painted = sig;
    refreshSteps(assistant);
  };
  const ticker = setInterval(paint, 350);
  let failure = "",
    quiet = false;
  try {
    for (;;) {
      // 与主答同一个轮次循环；步骤记在帮手身上、画在派它的那一答的差遣卡里
      await runRounds(sub, history, {
        profile,
        conversation,
        host: assistant,
        signal: box.controller.signal,
        inbox: box,
        overrides,
        tally,
        roundLimit: subRoundLimit(),
        scope: sub.id
      });
      // 只剩等待就睡，信到了就醒——与主答同一句话：手上还有后台指令在跑，先把此刻的话作为进展交给主对话（主模型不干等，
      // 也不会被一条忘了停的开发服务器挂住），随即睡下；等的指令结束（或主对话递来话）就醒来接着做，做完再交一次差。
      // 醒来没有信（等的那几条随桥接重启而止）便就此收工：进展已是它最后的话，不再重报
      if (!box.queue.length) {
        if (!helperWaits(sub).length) break;
        progress(waitingOutcome(step, sub, tally, overrides));
        sub.waiting = true;
        refreshSteps(assistant);
        try {
          while (!box.queue.length && helperWaits(sub).length) await sleepUntilMail(box);
        } finally {
          delete sub.waiting;
        }
        if (!box.queue.length) {
          quiet = true;
          break;
        }
      }
      await deliverSupplements(box, history, undefined, assistant);
      sub.content = paragraphBreak(sub.content);
    }
    sub.status = "complete";
  } catch (error) {
    if (error.name === "AbortError") {
      sub.status = "stopped";
      if (box.halted) throw error;
      // 主模型叫停的：照未完成回报，它已做的一并交回
      failure = "已按吩咐叫停";
    } else {
      sub.status = "error";
      failure = friendlyError(String(error.message || error));
    }
  } finally {
    clearInterval(ticker);
    clearInterval(box.steerTimer);
    const left = (crews.get(conversation.id) || []).filter(item => item !== box);
    if (left.length) crews.set(conversation.id, left);
    else crews.delete(conversation.id);
    // 停了、断了：没跑完的步骤收束；收工前才到、没来得及递的话标出来
    if (sub.status !== "complete") settleStepList(sub.steps, sub.status === "stopped" ? "已停止" : "已中断");
    for (const { note } of box.queue)
      if (note) {
        note.status = "error";
        note.result = "帮手已收工，未递到";
      }
    sub.usage = tally.usageKnown ? tally.usage : null;
    sub.durationMs = Math.round(performance.now() - started);
    delete sub.startedAt;
    // 派它的那一答还在作答：墨由那一答收尾时一并算；已收尾了（只剩等待就收尾）就在这里记回去
    // 按「止」时主答的 job 已先撤下、它的收尾也会来算这名帮手：谁先记谁打 charged，另一边跳过
    if (!sub.charged && requestJob(conversation.id)?.assistantId !== assistant.id) {
      sub.charged = true;
      chargeHelper(assistant, sub.usage, profile);
    }
    // 回报是最后一段话；裁掉开头的空行，偏移跟着前移
    const lead = trimReply(sub);
    sub.report = sub.content.slice(Math.max(0, tally.replyStart - lead)).trim();
    paint();
  }
  const { changedNote, display } = helperSummary(step, sub, overrides, sub.durationMs);
  if (sub.status !== "complete")
    return {
      ok: false,
      content: prompt("delegate.failed", {
        title: step.title,
        reason: failure || "未收到回报",
        steps: sub.steps.length,
        changed: changedNote,
        partial: sub.report ? `它最后说：${sub.report.slice(0, 4000)}` : ""
      }),
      display: `${display} · 未完成`
    };
  if (!sub.report)
    return {
      ok: false,
      content: prompt("delegate.failed", {
        title: step.title,
        reason: "帮手没有写回报",
        steps: sub.steps.length,
        changed: changedNote,
        partial: ""
      }),
      display: `${display} · 无回报`
    };
  return {
    ok: true,
    content: prompt("delegate.report", {
      title: step.title,
      steps: sub.steps.length,
      changed: changedNote,
      report: sub.report.slice(0, 16000)
    }),
    display,
    ...(quiet ? { quiet } : {})
  };
}
// 签上与回报里那一句计数：几步、改了哪些文件、压缩几回、用时
/** @param {Step} step @param {SubAgent} sub @param {number} ms */
function helperSummary(step, sub, overrides, ms) {
  const changed = subChangedPaths(step),
    stats = changeStats({ steps: [step] }),
    seconds = Math.round(ms / 1000);
  return {
    changedNote: changed.length ? `，改了 ${changed.length} 个文件：${changed.join("、")}（+${stats.added} −${stats.removed}）` : "",
    display: `${sub.steps.length} 步${changed.length ? ` · 改 ${changed.length} 个文件` : ""}${overrides.folds ? ` · 压缩 ${overrides.folds} 回` : ""} · ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分`}`
  };
}
// 睡下之前交的进展：此刻说的话，连同在等哪几条后台指令；主模型读了知道它还在、结束后会再回报
/** @param {Step} step @param {SubAgent} sub */
function waitingOutcome(step, sub, tally, overrides) {
  const { changedNote, display } = helperSummary(step, sub, overrides, Date.now() - Number(sub.startedAt || Date.now())),
    ids = helperWaits(sub)
      .map(s => s.bg?.id)
      .join("、");
  return {
    ok: true,
    content: prompt("delegate.waiting", {
      title: step.title,
      steps: sub.steps.length,
      changed: changedNote,
      ids,
      report: sub.content.slice(tally.replyStart).trim().slice(0, 16000) || "（未留话）"
    }),
    display: `${display} · 等后台`
  };
}
// 行迹里只留一枚签：差遣是并行的活，塞进线性的时间线会把后面的东西一直往下顶。
// 这里只记「此刻遣了谁、做到哪一步」——那确实是这一刻发生的事；回报与帮手自己的那条小时间线都在面板里，
// 签上不铺回报：主模型接着会把它消化进正文，几名帮手的回报叠在行迹里，正文就被顶到几屏之下了。
// 续派是同一名帮手的又一趟，签上标「续派」与「已更新」
/** @param {Step} step @param {string} [kind] 签上的标签：差遣 / 续派 */
function delegateStepHtml(step, kind = "差遣") {
  const { sub, status, meta } = delegateSubState(step);
  return `<div class="tool-step tool-step-delegate" data-step-id="${escapeHtml(step.id)}" data-kind="${kind}" data-status="${escapeHtml(status)}"><div class="tool-step-head" role="button" tabindex="0" title="展开帮手的行迹"><span class="tool-label"><span class="seal sub-seal" aria-hidden="true">遣</span>${kind}</span><span class="tool-title" title="${escapeHtml(sub?.task || step.title || "")}">${escapeHtml(step.title || "")}</span>${kind === "差遣" ? "" : `<span class="helper-fresh">已更新</span>`}<span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "未完成") : ""}">${escapeHtml(meta)}</span>${stepStateHtml(status)}</div></div>`;
}
// 行迹里那枚签的就地更新：只动头上的状态与标题。帮手自己的时间线与回报不在这儿，在面板里。返回真即已就地画好
/** @param {Step} step */
function syncDelegateCard(el, step, prev) {
  const { sub, status, meta } = delegateSubState(step);
  el.dataset.status = status;
  const head = el.querySelector(":scope > .tool-step-head");
  rollText(head.querySelector(".tool-meta"), meta);
  if (!prev || prev.status !== status) head.querySelector(".tool-state").outerHTML = stepStateHtml(status);
  // 标题在领命时才定下来，签却在那之前就画出来了
  const title = head.querySelector(".tool-title");
  if (title.textContent !== String(step.title || "")) {
    title.textContent = step.title || "";
    title.title = sub?.task || step.title || "";
  }
  return true;
}
// 传话、叫停、续派的签：与差遣同一种签，点开是那名帮手——传话开到递去的那句话，续派开的是这一趟
/** @param {Step} step */
function helperKind(step) {
  if (step.sub) return "续派";
  if (step.mode) return step.mode === "stop" ? "叫停" : "传话";
  const parsed = parseToolArguments(step.arguments);
  return parsed.ok && parsed.args.stop === true ? "叫停" : "传话";
}
/** @param {Step} step */
function helperStepHtml(step) {
  const kind = helperKind(step);
  if (kind === "续派") return delegateStepHtml(step, kind);
  const parsed = parseToolArguments(step.arguments),
    name = step.title || String((parsed.ok && parsed.args.helper) || ""),
    text = step.note || String((parsed.ok && parsed.args.message) || ""),
    status = step.status || "done",
    said = text.split("\n").find(Boolean) || "",
    fresh = kind === "传话" && status !== "error";
  return `<div class="tool-step tool-step-delegate" data-step-id="${escapeHtml(step.id)}" data-kind="${kind}" data-status="${escapeHtml(status)}"${step.ref ? ` data-ref="${escapeHtml(step.ref)}"` : ""}${step.noteId ? ` data-note="${escapeHtml(step.noteId)}"` : ""}><div class="tool-step-head" role="button" tabindex="0" title="${step.ref ? "看这名帮手" : ""}"><span class="tool-label"><span class="seal sub-seal" aria-hidden="true">遣</span>${kind}</span><span class="tool-title" title="${escapeHtml(text)}">${escapeHtml(name)}${said ? `<span class="helper-said">${escapeHtml(said.slice(0, 80))}</span>` : ""}</span>${fresh ? `<span class="helper-fresh">已更新</span>` : ""}<span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "") : ""}">${status === "running" ? "" : escapeHtml(step.result || "")}</span>${stepStateHtml(status)}</div></div>`;
}
/** @param {Step} step */
function relayStepHtml(step) {
  const relay = step.relay || { step: "", title: "", ok: true },
    status = step.status || "done",
    bg = relay.kind === "bg",
    what = bg
      ? `后台 ${relay.title} 已结束${relay.ok ? "" : ` · 退出码 ${relay.exitCode ?? "?"}`}`
      : `帮手「${relay.title}」${relay.ok ? "回报" : "未完成"}`,
    target = bg ? `data-relay-reveal="${escapeHtml(relay.step)}"` : `data-relay-step="${escapeHtml(relay.step)}"`;
  return `<div class="tool-step tool-step-note tool-step-relay" data-tool="relay_note" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head" role="button" tabindex="0" ${target} title="${bg ? "回到挂它的那一步" : "看这一趟的经过"}"><span class="tool-label"><span class="seal note-seal" aria-hidden="true">${bg ? "候" : "遣"}</span>回报</span><span class="tool-title">${escapeHtml(what)}</span><span class="tool-meta">${status === "running" ? "待递" : escapeHtml(step.result || "已递")}</span>${stepStateHtml(status)}</div></div>`;
}
// 签的种类变了（参数拟完才知道是续派还是传话）就整张换；续派的签与差遣一样就地更新
/** @param {Step} step */
function syncHelperCard(el, step, prev) {
  if (el.dataset.kind !== helperKind(step)) return false;
  return step.sub ? syncDelegateCard(el, step, prev) : false;
}
