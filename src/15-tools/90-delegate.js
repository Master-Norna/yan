// 言 · 差遣：主模型把一件自成一段的子任务交给帮手，帮手另起一段对话做完后回报。桥接在线、且有别的活能交出去时才给；帮手自己不再差遣。
// 同一轮派出的几名帮手同时开工（parallel），活是主模型分的，不重叠靠它分派时留意（工具说明里有交代）。
// 行迹里只留一枚签，帮手自己的那条时间线开在差遣面板里（见 08-trail.js）
defineTool({
  name: "delegate",
  group: "delegate",
  label: "差遣",
  offer: ctx => ctx.bridge && ctx.offered.some(name => name !== "ask_user"),
  mainOnly: true,
  sideEffect: true,
  parallel: true,
  run: runDelegate,
  html: delegateStepHtml,
  sync: syncDelegateCard,
  digest: step =>
    `差遣「${String(step.title || "").slice(0, 40)}」→ ${step.result || step.status}${subChangedPaths(step).length ? `，改了 ${subChangedPaths(step).slice(0, 8).join("、")}` : ""}`
});
/** @param {Step} step */
function subChangedPaths(step) {
  return [...new Set((step.sub?.steps || []).filter(s => s.change && s.status === "done").map(s => s.change.path))];
}
// 差遣：主模型把一件自成一段的子任务交给帮手。帮手用同一个模型、同一套工具（不再差遣、不请示用户）另起一段对话跑自己的工具轮次（上限见设置），
// 步骤都画在主对话这条消息的差遣卡片里（指令照样问而后行），做完把最后一轮的回报连同改动摘要作为工具结果交回主模型
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 */
async function runDelegate(step, args, ctx) {
  const { conversation, assistant, signal } = ctx;
  const task = args.task.trim();
  step.title = args.title.trim().slice(0, 40) || task.slice(0, 24);
  if (!task) return { ok: false, content: "task 不能为空：请把背景、目标、边界与要回报的内容写全", display: "任务为空" };
  const job = requestJob(conversation.id),
    profile = job?.profile || activeProfile();
  if (!profile) return { ok: false, content: "没有可用的模型", display: "无模型" };
  const tools = toolDefinitions(conversation, { sub: true });
  if (!tools) return { ok: false, content: "此对话里没有可交给帮手的工具", display: "无工具可用" };
  /** @type {SubAgent} */
  const sub = { id: `sub-${uid()}`, task, content: "", reasoning: "", steps: [], status: "streaming", usage: null, rounds: 0 };
  step.sub = sub;
  const history = [{ role: "user", content: task }];
  const overrides = {
    systemPrompt: systemPrompt(conversation, tools, { role: "sub" }),
    tools,
    reasoning: conversation.reasoning || "",
    // 跑得久了上下文会满：任务说明之后的往来由 readReply 按需压成工作笔记（见 keepInWindow），帮手接着做
    head: history.length,
    onFold: busy => job && setJobLabel(conversation, job, busy ? "帮手整理上下文" : "帮手工作中")
  };
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    toolCache = new Map(),
    started = performance.now();
  // 帮手的话是逐字流进来的，卡片每隔一小会儿刷一次，不必每个字都重画
  let painted = "";
  const paint = () => {
    const sig = `${sub.content.length}|${sub.reasoning.length}|${sub.status}|${sub.steps.map(s => s.status).join("")}`;
    if (sig === painted) return;
    painted = sig;
    refreshSteps(assistant);
  };
  const ticker = setInterval(paint, 350);
  let reportStart = 0,
    failure = "",
    resumed = 0;
  try {
    for (;;) {
      sub.toolCalls = null;
      sub.usage = null;
      const roundStart = sub.content.length;
      if (!resumed) reportStart = roundStart;
      try {
        await readReply(profile, history, signal, overrides, sub);
      } catch (error) {
        // 与主答一样：写到一半断了，稍候接着写，最多两回
        if (!error.midStream || signal.aborted || resumed >= AUTO_RESUMES) throw error;
        resumed += 1;
        const said = sub.content.slice(roundStart);
        sub.toolCalls = null;
        if (said.trim()) history.push({ role: "assistant", content: said }, { role: "user", content: prompt("assistant.resume") });
        await restFor(2000 * resumed, signal);
        continue;
      }
      resumed = 0;
      if (sub.usage) for (const key of Object.keys(usage)) usage[key] += Number(sub.usage[key] || 0);
      const calls = (sub.toolCalls || []).filter(call => call.name);
      if (!calls.length || !overrides.tools) break;
      // 进 history 的只是这一轮新写的：断线前那截在接续时已经单独进过 history 了（reportStart 管的是回报，续写前的也算在内）
      if (++sub.rounds > subRoundLimit()) {
        const said = sub.content.slice(roundStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push({ role: "user", content: prompt("delegate.limit") });
        overrides.tools = null;
        sub.content = paragraphBreak(sub.content);
        continue;
      }
      /** @type {Step[]} */
      const steps = calls.map(call => ({
        id: call.id || `call_${uid().slice(0, 8)}`,
        name: call.name,
        arguments: call.arguments || "{}",
        status: "running",
        at: sub.content.length,
        rat: String(sub.reasoning || "").length,
        scope: sub.id
      }));
      sub.steps.push(...steps);
      refreshSteps(assistant);
      history.push({
        role: "assistant",
        content: sub.content.slice(roundStart) || null,
        tool_calls: steps.map(s => ({ id: s.id, type: "function", function: { name: s.name, arguments: replayArguments(s.arguments) } })),
        ...(sub.thinkingBlocks?.length ? { thinking_blocks: sub.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, signal, toolCache);
      for (const s of steps) history.push({ role: "tool", tool_call_id: s.id, content: outcomes.get(s.id) ?? "" });
      sub.content = paragraphBreak(sub.content);
      if (job) setJobLabel(conversation, job, "帮手工作中");
    }
    sub.status = "complete";
  } catch (error) {
    if (error.name === "AbortError") {
      sub.status = "stopped";
      throw error;
    }
    sub.status = "error";
    failure = friendlyError(String(error.message || error));
  } finally {
    clearInterval(ticker);
    sub.usage = usage.total_tokens ? usage : null;
    sub.durationMs = Math.round(performance.now() - started);
    sub.report = sub.content.slice(reportStart).trim();
    // 裁掉开头的空行就得把步骤记的偏移一起前移，否则帮手那条时间线上每一段话都错位、被切在字中间
    // （主循环里是补偿了的，见 streamReply 的 leadTrim）
    const leadTrim = sub.content.match(/^\n*/)[0].length;
    sub.content = sub.content.replace(/^\n+|\n+$/g, "");
    if (leadTrim) for (const s of sub.steps) if (typeof s.at === "number") s.at = Math.max(0, s.at - leadTrim);
    if (job) setJobLabel(conversation, job, "生成中");
    paint();
  }
  const changed = subChangedPaths(step),
    stats = changeStats({ steps: [step] }),
    changedNote = changed.length ? `，改了 ${changed.length} 个文件：${changed.join("、")}（+${stats.added} −${stats.removed}）` : "",
    seconds = Math.round(sub.durationMs / 1000),
    display = `${sub.steps.length} 步${changed.length ? ` · 改 ${changed.length} 个文件` : ""}${overrides.folds ? ` · 压缩 ${overrides.folds} 回` : ""} · ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分`}`;
  if (sub.status !== "complete")
    return {
      ok: false,
      content: prompt("delegate.failed", {
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
      content: prompt("delegate.failed", { reason: "帮手没有写回报", steps: sub.steps.length, changed: changedNote, partial: "" }),
      display: `${display} · 无回报`
    };
  return {
    ok: true,
    content: prompt("delegate.report", { steps: sub.steps.length, changed: changedNote, report: sub.report.slice(0, 16000) }),
    display
  };
}
// 行迹里只留一枚签：差遣是并行的活，塞进线性的时间线会把后面的东西一直往下顶。
// 这里只记「此刻遣了谁、做到哪一步」——那确实是这一刻发生的事；回报与帮手自己的那条小时间线都在面板里，
// 签上不铺回报：主模型接着会把它消化进正文，几名帮手的回报叠在行迹里，正文就被顶到几屏之下了。
/** @param {Step} step */
function delegateStepHtml(step) {
  const { sub, status, meta } = delegateSubState(step);
  return `<div class="tool-step tool-step-delegate" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head" role="button" tabindex="0" title="展开帮手的行迹"><span class="tool-label"><span class="seal sub-seal" aria-hidden="true">遣</span>差遣</span><span class="tool-title" title="${escapeHtml(sub?.task || step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "未完成") : ""}">${escapeHtml(meta)}</span>${stepStateHtml(status)}</div></div>`;
}
// 行迹里那枚签的就地更新：只动头上的状态与标题。帮手自己的时间线与回报不在这儿，在面板里
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
}
