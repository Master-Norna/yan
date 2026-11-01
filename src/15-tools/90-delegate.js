// 言 · 差遣：主模型把一件自成一段的子任务交给帮手，帮手另起一段对话做完后回报。桥接在线、且有别的活能交出去时才给；帮手自己不再差遣。
// 同一轮派出的几名帮手同时开工（parallel），活是主模型分的，不重叠靠它分派时留意（工具说明里有交代）。
// 帮手在后台做，不随派它的那一答收尾：主答只剩等待就收尾，回报到了另起一答（见 mailReport）——等着的时候没有谁醒着。
// 收了工的帮手还能续派，带着它先前的经过接着做（见 tellHelper）。行迹里只留一枚签，帮手自己的那条时间线开在差遣面板里（见 08-trail/20-helper.js）
// 帮手与主答守同一句话：只剩等待就睡，信到了就醒——手上只剩自己挂的后台指令时先交一份进展、睡下，指令结束的消息寄给它自己（见 mailHelper）
defineTool({
  name: "delegate",
  group: "delegate",
  label: t("差遣"),
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
  // 断着的写明在等人续：主模型知道它没回来、也不会自己回来
  digest: step =>
    t`差遣「${String(step.title || "").slice(0, 40)}」→ ${step.status === "interrupted" ? t`中辍（${step.result || ""}），等用户续上` : step.result || step.status}${subChangedPaths(step).length ? t`，改了 ${subChangedPaths(step).slice(0, 8).join("、")}` : ""}`
});
// 给帮手递话：正做着的，话进它的收件口，说到落点时读到（同补言，不掐断）；已收工的即续派，带着先前的经过接着做。
// 叫停只停正做着的那一个，已做的照未完成回报；翻看只读它的经过（见 helperTrail）。这一步在行迹里也是一枚签（续派 / 传话 / 叫停 / 翻看），点开是那名帮手
defineTool({
  name: "helper",
  group: "delegate",
  label: t("传话"),
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
  label: t("回报"),
  offer: false,
  html: relayStepHtml,
  replay: replayReport
});
// 回报、传话递上时的原话记在那一步上（见 deliverSupplements），往后重装这一答照原样插回原处。
// 几份回报并作一问的，原文都在头一份上，其余几份没有可重装的；早先存下、没记原话的也一样
/** @param {Step} step */
function replayReport(step) {
  return step.report ? { role: "user", content: step.report } : null;
}
// 递给帮手的话：落在帮手自己的时间线里它到达的那一刻，待递转圈、递到打勾（与补言同一种画法）
defineTool({
  name: "helper_note",
  label: t("传话"),
  offer: false,
  html: step => noteStepHtml(step, { seal: t("传"), label: t("传话") }),
  replay: replayReport
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
        running: boxes.map(item => `「${item.title}」`).join("、") || t("无"),
        done:
          [...new Set(helperRuns(ctx.conversation).map(run => run.title))]
            .filter(title => !boxes.some(item => item.title === title))
            .map(title => `「${title}」`)
            .join("、") || t("无")
      }),
      display: "没有这名帮手"
    });
  step.title = box?.title || past?.title || name;
  if (args.read === true) {
    step.mode = "read";
    const runs = helperRuns(ctx.conversation).filter(run => run !== step && run.title === name),
      key = runs.length ? helperKey(runs.at(-1)) : "",
      mine = helperRuns(ctx.conversation).filter(run => run !== step && helperKey(run) === key);
    if (!mine.length) return gone();
    step.ref = mine.at(-1).id;
    return {
      ok: true,
      content: clipForModel(helperTrail(mine), 30000, { tail: true, hint: t("中间的经过从略") }),
      display: `${mine.length} 趟`
    };
  }
  if (stop) {
    step.mode = "stop";
    if (!box) return gone();
    step.ref = box.step.id;
    box.controller.abort();
    return { ok: true, content: prompt("delegate.stopping", { title: box.title }), display: "叫停" };
  }
  if (!text) return { ok: false, content: t("message 不能为空"), display: "无话" };
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
    releaseForeground(ctx.conversation.id, sub.id);
    // 睡着等后台的：叫醒它读这句
    box.wake?.();
    refreshSteps(box.host);
    return { ok: true, content: prompt("delegate.noted", { title: box.title }), display: "" };
  }
  if (!past) return gone();
  // 已收工：续派。这一步自己成一趟，在当前的行迹里另起一枚签，点开是这名帮手那一页、停在这一趟
  step.mode = "resume";
  launchHelper(step, { title: past.title, task: text }, ctx, past);
  return { ok: true, background: true, content: prompt("delegate.resumed", { title: past.title }), display: "后台进行中" };
}
// 翻看帮手的经过：回报是它的结论，要核对（跑了哪些指令、出了什么）就看行迹。照差遣面板那条时间线写：领的命、它说的话与做的步骤按先后穿插，
// 指令带输出。工具结果的原文不存，别的步骤只有签上的字；还在做的也翻得到，做到哪写到哪
/** @param {Step[]} runs 同一名帮手的几趟，按先后 */
function helperTrail(runs) {
  return runs
    .map((run, i) => {
      const sub = /** @type {SubAgent} */ (run.sub),
        content = String(sub.content || ""),
        lines = [
          t`第 ${i + 1} 趟（${run.status === "running" ? t("还在做") : stepText(run.result) || run.status}）· 领命：${clipForModel(sub.task, 1500)}`
        ],
        said = text => {
          if (text.trim()) lines.push(t`【帮手】${clipForModel(text.trim(), 1500, { tail: true })}`);
        };
      let from = 0;
      for (const step of sub.steps) {
        if (isFold(step)) continue;
        const at = Math.min(Math.max(from, Number(step.at) || 0), content.length);
        said(content.slice(from, at));
        from = at;
        if (step.name === "helper_note") {
          lines.push(t`【传话】${step.note || step.title || ""}`);
          continue;
        }
        const digest = TOOLS.get(step.name)?.digest;
        lines.push(
          `· ${typeof digest === "function" ? digest(step) : `${step.name} ${String(step.title || "").slice(0, 200)} → ${step.status === "skipped" ? t("用户跳过") : stepText(step.result) || step.status}`}`
        );
        if (step.output) lines.push(clipForModel(String(step.output).trim(), 1200, { tail: true }).replace(/^/gm, "  "));
      }
      said(content.slice(from));
      return lines.join("\n");
    })
    .join("\n\n");
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
  if (!task) return { ok: false, content: t("task 不能为空：请把背景、目标、边界与要回报的内容写全"), display: "任务为空" };
  launchHelper(step, args, ctx);
  return { ok: true, background: true, content: prompt("delegate.started", { title: step.title }), display: "后台进行中" };
}
// 起一趟：差遣是头一趟，续派（past 是它上一趟）接着做，resume 是断着的这一趟从断处接着做（见 resumeHelper）。
// 做完由它自己收尾这一步，回报寄给这段对话
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 * @param {Step|null} [past]
 * @param {boolean} [resume]
 * @param {Profile|null} [profile] 续写时在认领前拿住，等待期间换了对话也不改用别处的模型
 */
function launchHelper(
  step,
  args,
  ctx,
  past = null,
  resume = false,
  profile = requestJob(ctx.conversation.id)?.profile || activeProfile(ctx.conversation)
) {
  const { conversation, assistant } = ctx;
  // 进展：帮手只剩等后台、睡下之前交的那一份。这一步仍在做，回报照常寄
  const progress = outcome =>
    mailReport(conversation, {
      report: outcome.content,
      step,
      profile,
      relay: { step: step.id, title: String(step.title || ""), ok: true }
    });
  void runDelegate(step, args, ctx, profile, past, progress, resume)
    .then(
      outcome => {
        // 断了：挂着等人续，不回报——断网时主模型多半也连不上，叫醒它只是让它跟着断
        if (outcome.held) return holdHelper(step, outcome.display, conversation);
        step.status = outcome.ok ? "done" : "error";
        step.result = outcome.display;
        // 交过进展后没再做什么就收工了（等的后台随桥接重启而止）：进展已是最后的话，不再重报
        if (!outcome.quiet) mailReport(conversation, { report: outcome.content, step, profile });
      },
      error => {
        // 用户停的（停止、刷新）：不回报，也就不再叫醒谁
        if (error.name === "AbortError") return void Object.assign(step, { status: "error", result: "已止" });
        const reason = bridgeErrorText(String(error.message || error));
        // 领命途中断的（读账本连不上之类）：同样挂着等人续
        if (step.sub) return holdHelper(step, reason, conversation);
        step.status = "error";
        step.result = reason;
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
// 帮手手上还在跑的后台指令：收工时有它们，帮手就睡下等
/** @param {SubAgent} sub */
function helperWaits(sub) {
  return sub.steps.filter(step => step.bg?.state === "running");
}
// ---------- 断着与续上 ----------
// 不是谁叫停的就断了（连不上接口、额度用完、页面刷新）：挂着等人，签上状态位换成续写那一笔（设计稿/97 甲）。
// 不按报错分类——连不上、额度、鉴权，主模型都救不了，只有人换 Key、调上限、等网回来；人点「续」从断处接着做，做完照常回报
// 做着做着断的（传了 conversation）弹一条桌面通知；页面刷新时收束断着的那些不弹
/** @param {Step} step @param {string} reason @param {Conversation} [conversation] */
function holdHelper(step, reason, conversation) {
  step.status = "interrupted";
  step.result = reason;
  if (step.sub) {
    settleStepList(step.sub.steps, "已中断");
    step.sub.status = "interrupted";
  }
  if (conversation) notifyDesktop(conversation, t`帮手「${step.title || ""}」断了，待你续：${reason}`);
}
/** 同一名帮手另起了新的一趟（续派）：先前断着的那几趟作罢 @param {Conversation} conversation @param {Step} step */
function retireHeldRuns(conversation, step) {
  const key = helperKey(step);
  if (!key) return;
  for (const run of helperRuns(conversation))
    if (run !== step && run.status === "interrupted" && helperKey(run) === key) {
      run.status = "error";
      run.result = t("已另起一趟");
      run.sub.status = "stopped";
    }
}
/** 这段对话里断着的帮手 @param {Conversation} conversation */
function heldHelpers(conversation) {
  return helperRuns(conversation).filter(step => step.status === "interrupted");
}
// 续上断着的帮手（不传 steps 即这段对话里断着的全部）：照主答续写的办法接着做，用的还是原来那张签。
// 主模型歇着也续得上——帮手本就挂在这段对话名下独自跑，做完的回报照常叫醒主模型
/** @param {Conversation} conversation @param {Step[]} [steps] */
async function resumeHelpers(conversation, steps = heldHelpers(conversation)) {
  steps = steps.filter(step => step.status === "interrupted" && step.sub);
  if (!steps.length) return;
  if (runningElsewhere(conversation.id)) return toast(t("此对话正在另一页面作答，稍后再续"));
  const profile = requestJob(conversation.id)?.profile || activeProfile(conversation);
  if (!profile) return openSettings("models");
  if (quotaBlocked(profile)) return toast(t("余墨已尽，请调高上限或更换模型"));
  // 认领一回：几处页面同开时，只有一处续得上
  if (!(await claimConversation(conversation.id))) return toast(t("此对话正在另一页面作答，稍后再续"));
  if (!store.conversations.includes(conversation)) return;
  for (const asked of steps) {
    if (asked.status !== "interrupted") continue;
    // 旧版记录里可能几趟都断着：只续最后一趟、先前断着的收掉；点的是旧签，续的也是最后那一趟，不另开一个自己
    const runs = helperRuns(conversation).filter(run => helperKey(run) === helperKey(asked)),
      step = runs.at(-1) || asked;
    retireHeldRuns(conversation, step);
    const host = conversation.messages.find(message => (message.steps || []).includes(step));
    if (!host || step.status !== "interrupted") continue;
    const past = runs[runs.indexOf(step) - 1] || null;
    step.status = "running";
    step.result = "";
    launchHelper(
      step,
      { title: step.title, task: step.sub.task },
      /** @type {ToolContext} */ ({ conversation, assistant: host }),
      past,
      true,
      profile
    );
    refreshSteps(host);
  }
  markDirty(conversation.id);
  saveStore();
  if (currentId === conversation.id) renderSendButtons();
}
/** @param {string} id 点签上或面板里的「续」 */
function resumeHelperStep(id) {
  const conversation = currentConversation(),
    step = conversation && helperRuns(conversation).find(run => run.id === id);
  if (step) void resumeHelpers(conversation, [step]);
}
// 派它的那一答收尾时它还没做完，墨没算进这一答：做完了记回那一答（余墨各轮已当场扣过，见 runRounds 的 spend）
/** @param {Message} assistant */
function chargeHelper(assistant, usage) {
  const spent = Number(usage?.total_tokens || 0);
  if (!spent) return;
  assistant.usage = usageSum(assistant.usage, usage);
  assistant.tokenCount = Number(assistant.tokenCount || 0) + spent;
}
// 续派时帮手先前的经过：每一趟一问一答（所领之命 → 回报），上一趟的行迹冠在下一趟的命前，与主对话的历史同一个写法
/** @param {Conversation} conversation @param {Step} past */
function helperHistory(conversation, past) {
  const runs = helperRuns(conversation),
    key = helperKey(past),
    mine = runs.slice(0, runs.indexOf(past) + 1).filter(run => helperKey(run) === key),
    history = [];
  mine.forEach((run, i) => {
    const trail = i ? settledDigest(mine[i - 1].sub) : "";
    history.push(
      { role: "user", content: `${trail ? `${trail}\n\n` : ""}${run.sub.task}` },
      { role: "assistant", content: String(run.sub.report || run.sub.content || "").trim() || t("（未留回报）") }
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
 * @param {boolean} [resume] 断着的这一趟从断处接着做：沿用 step.sub，已写的话与做过的步骤照主答续写的写法排进历史
 * @returns {Promise<{ ok: boolean, held?: boolean, quiet?: boolean, content: string, display: string }>} held：断了，挂着等人续
 */
async function runDelegate(step, args, ctx, profile, past, progress, resume = false) {
  const { conversation, assistant } = ctx;
  const task = resume ? String(step.sub.task) : String(args.task).trim();
  // 续的时候缺模型、缺工具：仍挂着，换好了再续
  if (!profile) return { ok: false, held: resume, content: t("没有可用的模型"), display: "无模型" };
  const tools = toolDefinitions(conversation, { sub: true });
  if (!tools) return { ok: false, held: resume, content: t("此对话里没有可交给帮手的工具"), display: "无工具可用" };
  // 思考强度：主模型按活的难易给（省略即同主答），续派沿用这名帮手上一趟的；记下的是模型实际认的那一档，卡片上标出
  const asked = resume
      ? step.sub.effort || ""
      : REASONING_ORDER.includes(args.effort)
        ? args.effort
        : past?.sub?.effort || conversation.reasoning || "",
    effort = nearestReasoning(profile, asked);
  /** @type {SubAgent} */
  let sub;
  // 续上：此前已耗的墨与用时接着算；已记进哪一答的那份（charged）收工时不再记一遍
  const prior = resume
    ? { usage: step.sub.usage || null, billed: step.sub.charged ? step.sub.usage || null : null, ms: Number(step.sub.durationMs) || 0 }
    : null;
  if (resume) {
    sub = step.sub;
    sub.status = "streaming";
    sub.usage = null;
    sub.charged = false;
    delete sub.report;
  } else {
    const id = `sub-${uid()}`;
    sub = {
      id,
      helper: past ? helperKey(past) : id,
      task,
      at: new Date().toISOString(),
      content: "",
      reasoning: "",
      steps: [],
      status: "streaming",
      usage: null,
      ...(effort ? { effort } : {})
    };
    step.sub = sub;
  }
  // 新一趟已有 helper 身份后，才能收掉同一名帮手先前断着的几趟，免得旧签还能续出第二个自己。
  if (!resume) retireHeldRuns(conversation, step);
  const history = [];
  const overrides = {
    systemPrompt: systemPrompt(conversation, tools, { role: "sub" }),
    tools,
    reasoning: effort,
    // 跑得久了上下文会满：任务说明（续派时连同先前的几趟）之后的往来由 readReply 按需压成工作笔记（见 keepInWindow），帮手接着做
    head: 0,
    onFold: busy => {
      const job = requestJob(conversation.id);
      if (job) setJobLabel(conversation, job, busy ? t("帮手正删繁就简") : "");
      refreshSteps(assistant);
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
  // 读账本、装历史之前就入册：准备中的帮手也能被停止、收信、报到。主答的中止只跟到准备结束，之后仍独自在后台做。
  const stopStarting = () => {
    box.halted = true;
    box.controller.abort();
  };
  ctx.signal?.addEventListener("abort", stopStarting, { once: true });
  if (ctx.signal?.aborted) stopStarting();
  crews.set(conversation.id, [...(crews.get(conversation.id) || []), box]);
  const tally = newTally(),
    started = performance.now();
  // 回报从这回新说的算起：续上的一趟还没开轮就停了，断前的旧话不当作它最后说的
  if (resume) tally.replyStart = sub.content.length;
  sub.startedAt = Date.now() - (prior?.ms || 0);
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
    box.controller.signal.throwIfAborted();
    // 领命这一刻现读主对话的账本（只读）：「先定下约束、再派活」时，开页读的那份往往还没有。
    const ledger = await loadLedger(conversation, box.controller.signal, "sub");
    // 先前几趟的行迹若已另存出去，接回来再写进它的历史
    await warmConversation(conversation);
    box.controller.signal.throwIfAborted();
    const lead = past ? settledDigest(past.sub) : "";
    history.push(...(past ? helperHistory(conversation, past) : []), {
      role: "user",
      content: `${ledgerNote(conversation, "sub", profile, ledger)}${lead ? `${lead}\n\n` : ""}${task}`
    });
    // 续上：已写的话与传话照原处排上，做过的步骤也让它知道，再请它接着做。
    if (resume) {
      const before = { content: sub.content, steps: [...sub.steps] },
        parts = (await answerForApi(before)).filter(part => part.role !== "assistant" || part.content),
        trail = stepsDigest(before);
      box.controller.signal.throwIfAborted();
      if (parts.length || trail)
        history.push(...parts, { role: "user", content: `${trail ? `${trail}\n\n` : ""}${prompt("assistant.resume")}` });
      sub.content = paragraphBreak(sub.content);
    }
    overrides.head = history.length;
    ctx.signal?.removeEventListener("abort", stopStarting);
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
      // 末轮已接收完、仍在逐字显示时停止，读流可能照常返回；寄进展、记完成前仍须认中止。
      box.controller.signal.throwIfAborted();
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
      await deliverSupplements(box, history, undefined, assistant, { target: sub });
      sub.content = paragraphBreak(sub.content);
    }
    box.controller.signal.throwIfAborted();
    sub.status = "complete";
  } catch (error) {
    if (error.name === "AbortError") {
      sub.status = "stopped";
      if (box.halted) throw error;
      // 主模型叫停的：照未完成回报，它已做的一并交回
      failure = t("已按吩咐叫停");
    } else {
      // 不是谁叫停的就是断了：挂着等人续（见 holdHelper）
      sub.status = "interrupted";
      failure = friendlyError(String(error.message || error));
    }
  } finally {
    ctx.signal?.removeEventListener("abort", stopStarting);
    clearInterval(ticker);
    clearInterval(box.steerTimer);
    const left = (crews.get(conversation.id) || []).filter(item => item !== box);
    if (left.length) crews.set(conversation.id, left);
    else crews.delete(conversation.id);
    // 停了、断了：没跑完的步骤收束；收工前才到、没来得及递的话标出来
    if (sub.status !== "complete") settleStepList(sub.steps, sub.status === "stopped" ? "已止" : "已中断");
    for (const { note } of box.queue)
      if (note) {
        note.status = "error";
        note.result = sub.status === "interrupted" ? "帮手断了，未递到" : "帮手已收工，未递到";
      }
    const fresh = tally.usageKnown ? tally.usage : null;
    sub.usage = usageSum(prior?.usage, fresh);
    sub.durationMs = (prior?.ms || 0) + Math.round(performance.now() - started);
    delete sub.startedAt;
    // 派它的那一答还在作答：墨由那一答收尾时一并算；已收尾了（只剩等待就收尾）就在这里记回去
    // 按「止」时主答的 job 已先撤下、它的收尾也会来算这名帮手：谁先记谁打 charged，另一边跳过。
    // 续上的这一趟：断前那份已记过的（billed）不再记，只记这回新耗的
    if (!sub.charged && requestJob(conversation.id)?.assistantId !== assistant.id) {
      sub.charged = true;
      chargeHelper(assistant, prior?.billed ? fresh : sub.usage);
    } else if (!sub.charged && prior?.billed) sub.billed = prior.billed;
    // 回报是最后一段话；裁掉开头的空行，偏移跟着前移
    const lead = trimReply(sub);
    sub.report = sub.content.slice(Math.max(0, tally.replyStart - lead)).trim();
    paint();
  }
  const { changedNote, display } = helperSummary(step, sub, overrides, sub.durationMs);
  if (sub.status === "interrupted") return { ok: false, held: true, content: "", display: failure };
  if (sub.status !== "complete")
    return {
      ok: false,
      content: prompt("delegate.failed", {
        title: step.title,
        reason: failure || t("未收到回报"),
        steps: sub.steps.length,
        changed: changedNote,
        partial: sub.report ? t`它最后说：${sub.report.slice(0, 4000)}` : ""
      }),
      display: `${display} · 未完成`
    };
  if (!sub.report)
    return {
      ok: false,
      content: prompt("delegate.failed", {
        title: step.title,
        reason: t("帮手没有写回报"),
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
      report: clipForModel(sub.report, 16000, { tail: true })
    }),
    display,
    ...(quiet ? { quiet } : {})
  };
}
// 签上与回报里那一句计数：几步、改了哪些文件、压缩几回、用时
/** @param {Step} step @param {SubAgent} sub @param {number} ms */
function helperSummary(step, sub, overrides, ms) {
  const changed = subChangedPaths(step),
    stats = changeStats({ steps: [step] });
  return {
    changedNote: changed.length ? t`，改了 ${changed.length} 个文件：${changed.join("、")}（+${stats.added} −${stats.removed}）` : "",
    display: `${sub.steps.filter(s => !isFold(s)).length} 步${changed.length ? ` · 改 ${changed.length} 个文件` : ""}${overrides.folds ? ` · 撮要 ${overrides.folds} 回` : ""} · ${spanText(ms)}`
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
      report: clipForModel(sub.content.slice(tally.replyStart).trim(), 16000, { tail: true }) || t("（未留话）")
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
  return `<div class="tool-step tool-step-delegate" data-step-id="${escapeHtml(step.id)}" data-kind="${kind}" data-status="${escapeHtml(status)}"><div class="tool-step-head" role="button" tabindex="0" title="${t(`看这名帮手`)}"><span class="tool-label"><span class="seal sub-seal" aria-hidden="true">${t(`遣`)}</span>${t(kind)}</span><span class="tool-title" title="${escapeHtml(sub?.task || step.title || "")}">${escapeHtml(step.title || "")}</span>${kind === "差遣" ? "" : `<span class="helper-fresh">${t(`已更新`)}</span>`}<span class="tool-meta" title="${status === "error" || status === "interrupted" ? escapeHtml(stepText(step.result) || t("未完成")) : ""}">${escapeHtml(meta)}</span>${stepStateHtml(status)}</div></div>`;
}
// 行迹里那枚签的就地更新：只动头上的状态与标题。帮手自己的时间线与回报不在这儿，在面板里。返回真即已就地画好
/** @param {Step} step */
function syncDelegateCard(el, step, prev) {
  const { sub, status, meta } = delegateSubState(step);
  el.dataset.status = status;
  const head = el.querySelector(":scope > .tool-step-head");
  rollText(head.querySelector(".tool-meta"), meta);
  if (!prev || prev.status !== status) {
    head.querySelector(".tool-state").outerHTML = stepStateHtml(status);
    head.querySelector(".tool-meta").title = status === "error" || status === "interrupted" ? stepText(step.result) || t("未完成") : "";
  }
  // 标题在领命时才定下来，签却在那之前就画出来了
  const title = head.querySelector(".tool-title");
  if (title.textContent !== String(step.title || "")) {
    title.textContent = step.title || "";
    title.title = sub?.task || step.title || "";
  }
  return true;
}
// 传话、叫停、翻看、续派的签：与差遣同一种签，点开是那名帮手——传话开到递去的那句话，续派开的是这一趟
/** @param {Step} step */
function helperKind(step) {
  // 内里用中文的种类名（比对、data-kind 都认它），画到签上时才照语言换
  if (step.sub) return "续派";
  if (step.mode) return { stop: "叫停", read: "翻看" }[step.mode] || "传话";
  const parsed = parseToolArguments(step.arguments);
  return parsed.ok && parsed.args.read === true ? "翻看" : parsed.ok && parsed.args.stop === true ? "叫停" : "传话";
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
  return `<div class="tool-step tool-step-delegate" data-step-id="${escapeHtml(step.id)}" data-kind="${kind}" data-status="${escapeHtml(status)}"${step.ref ? ` data-ref="${escapeHtml(step.ref)}"` : ""}${step.noteId ? ` data-note="${escapeHtml(step.noteId)}"` : ""}><div class="tool-step-head" role="button" tabindex="0" title="${step.ref ? t("看这名帮手") : ""}"><span class="tool-label"><span class="seal sub-seal" aria-hidden="true">${t(`遣`)}</span>${t(kind)}</span><span class="tool-title" title="${escapeHtml(text)}">${escapeHtml(name)}${said ? `<span class="helper-said">${escapeHtml(said.slice(0, 80))}</span>` : ""}</span>${fresh ? `<span class="helper-fresh">${t(`已更新`)}</span>` : ""}<span class="tool-meta" title="${status === "error" ? escapeHtml(stepText(step.result) || "") : ""}">${status === "running" ? "" : escapeHtml(stepText(step.result) || "")}</span>${stepStateHtml(status)}</div></div>`;
}
/** @param {Step} step */
function relayStepHtml(step) {
  const relay = step.relay || { step: "", title: "", ok: true },
    status = step.status || "done",
    { seal, name, gist } = relayLabel(relay),
    what = gist ? `${name} · ${gist}` : name,
    target = !relay.kind ? `data-relay-step="${escapeHtml(relay.step)}"` : `data-relay-reveal="${escapeHtml(relay.step)}"`,
    hint = !relay.kind ? t("看这一趟的经过") : t("回到挂它的那一步");
  return `<div class="tool-step tool-step-note tool-step-relay" data-tool="relay_note" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head" role="button" tabindex="0" ${target} title="${hint}"><span class="tool-label"><span class="seal note-seal" aria-hidden="true">${seal}</span>${t(`回报`)}</span><span class="tool-title">${escapeHtml(what)}</span><span class="tool-meta">${status === "running" ? t("待递") : escapeHtml(stepText(step.result))}</span>${stepStateHtml(status)}</div></div>`;
}
// 签的种类变了（参数拟完才知道是续派还是传话）就整张换；续派的签与差遣一样就地更新
/** @param {Step} step */
function syncHelperCard(el, step, prev) {
  if (el.dataset.kind !== helperKind(step)) return false;
  return step.sub ? syncDelegateCard(el, step, prev) : false;
}
