// 言 · 对话引擎 · 作答：一答从开工到收尾
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 * @param {Profile} profile
 */
async function streamReply(conversation, assistant, profile, { resume = false } = {}) {
  // queue 是这一答的收件口：用户的补言（user）与后台帮手的回报（report）
  /** @type {{ controller: AbortController, assistantId: string, label: string, profile: Profile, queue: Array<{ user?: Message, step: Step, report?: string }>, round: AbortController|null, reading: boolean, roundStart: number, steerTimer: number }} */
  const job = {
    controller: new AbortController(),
    assistantId: assistant.id,
    label: "",
    profile,
    queue: [],
    round: null,
    reading: false,
    roundStart: 0,
    steerTimer: 0
  };
  requestJobs.set(conversation.id, job);
  renderSendButtons();
  renderHistory();
  const started = performance.now(),
    spentBefore = resume ? Number(assistant.durationMs) || 0 : 0;
  const gaugeTicker = conversation.id === currentId ? setInterval(updateContextGauge, 600) : null;
  // 行迹题头的用时边做边走：长指令跑着时没有新字进来、不会重画，另起一只每秒一跳的钟。续写接着此前的用时走，不从零起
  assistant.startedAt = Date.now() - spentBefore;
  const clock = setInterval(() => tickTrailClock(assistant), 1000);
  // 言里做文件：记下开工前卷宗的样子，收尾时新出的、改过的成品挂在答末
  const archiveBefore = !isWork(conversation) ? new Map((archiveEntries || []).map(e => [e.path, e.modifiedAt])) : null;
  // 用量在 finally 里结算：停止、断网、工具链中途出错，前面几轮已经花掉的墨也得记上，不能只在整答顺利收尾时记账
  const tally = newTally(),
    stepsBefore = (assistant.steps || []).length,
    // 续写时上一截还在后台做的帮手：它若在这一截里做完，墨由这一截记（它见这一答在作答就不自己记）
    helpersBefore = new Set((assistant.steps || []).filter(step => step.sub?.status === "streaming")),
    // 续写前已耗的墨：这一截的用量另算，收尾时加回去，浮签上仍是这一答的总数
    prior = resume ? { usage: assistant.usage, tokens: Number(assistant.tokenCount) || 0, estimated: !!assistant.tokenEstimated } : null;
  if (prior) delete assistant.tokenCount;
  /** @type {Array<Record<string, any>>} 送给接口的消息列表 */
  let history = [];
  let releaseQuota = () => {};
  /** @type {ReturnType<typeof takeHeldReports>} */
  let held = [];
  try {
    const budget = inlineTextBudget(profile),
      resumeFrom = resume ? assistant.content : "";
    let lastUserId = "";
    // 这一问之前的历史：上次压缩的摘要、此后的往来、续写时已写的那截。开头装一次；作答途中压了前文（compactHead）再装一次
    const buildHead = async () => {
      // 只取这一答之前的：在中间某一答上点「继续生成」时，它后面的问答不能混进来
      const at = conversation.messages.findIndex(m => m.id === assistant.id),
        before = at < 0 ? conversation.messages : conversation.messages.slice(0, at),
        contextIndex = before.map(m => m.role).lastIndexOf("context");
      const source = before
        .slice(contextIndex + 1)
        .filter(m => m.id !== assistant.id && m.status !== "error" && ["user", "assistant"].includes(m.role));
      lastUserId = source.filter(m => m.role === "user").at(-1)?.id;
      const head = summaryMessages(contextIndex >= 0 ? before[contextIndex] : null);
      head.push(...(await historyForApi(source, lastUserId, budget)));
      // 这一问的首段往后各问里一字不差，标作缓存点：下一问时连它在内的整段历史都从缓存读（桥接只给 Claude 留着这个标，别家去掉）。
      // 账本只附在这一问（之前的问不带，免得一份账本背上几十遍），所以接在后面另起一段——冠在开头，这一问每问都变，缓存只接得到上一答之前
      const ask = head.findLast(entry => entry.role === "user"),
        ledger = ledgerNote(conversation);
      if (ask) {
        if (typeof ask.content === "string") ask.content = [{ type: "text", text: ask.content }];
        ask.content[0].cache_control = { type: "ephemeral" };
        if (ledger) ask.content.push({ type: "text", text: ledger.trimEnd() });
      }
      // 续写只递已写的话，做过的步骤也得让它知道（另发一句「继续」时上一答的行迹本就随着去），不然从头再做一遍
      if (resumeFrom) {
        const trail = stepsDigest(assistant);
        head.push(
          { role: "assistant", content: resumeFrom },
          { role: "user", content: `${trail ? `${trail}\n\n` : ""}${prompt("assistant.resume")}` }
        );
      }
      return head;
    };
    await loadLedger(conversation, job.controller.signal);
    history = await buildHead();
    // 上一答断着时回来的回报（见 wakeWithReports）：开工即递上，模型续写时就知道帮手怎样了
    held = takeHeldReports(conversation, job);
    if (held.length) await deliverSupplements(job, history, budget, assistant);
    // 先把这一答预计的用量记到预留里（提示 + 最大输出），别的对话同时开工时看得见；收尾时换成实际用量
    // 预留只是估个数：一答的输出按八千算，不必与接口实际的上限一致
    releaseQuota = reserveTokens(profile, estimateTokens(history) + (Number(profile.maxTokens) || 8192));
    if (profile.tools !== false) await mcpForTurn();
    const tools = profile.tools !== false ? toolDefinitions(conversation, { profile }) : null;
    const overrides = {
      systemPrompt: systemPrompt(conversation, tools),
      tools,
      reasoning: conversation.reasoning || "",
      head: history.length,
      onFold: busy => setJobLabel(conversation, job, busy ? "上下文将满 · 整理中" : ""),
      // 放不下的是这一问之前的对话：压成摘要落成分隔（下一问也用得上），换掉 history 里这一问之前的那截
      compactHead: async signal => {
        const user = conversation.messages.find(m => m.id === lastUserId);
        if (!user || !(await compactContext(conversation, { auto: true, before: user, profile, signal }))) return false;
        const head = await buildHead();
        history.splice(0, overrides.head, ...head);
        overrides.head = head.length;
        return true;
      }
    };
    await runRounds(assistant, history, {
      profile,
      conversation,
      host: assistant,
      signal: job.controller.signal,
      overrides,
      tally,
      roundLimit: toolRoundLimit(),
      inbox: job,
      budget,
      onStatus: label => setJobLabel(conversation, job, label)
    });
    trimReply(assistant);
    if (!assistant.content)
      throw Error(
        assistant.steps?.length
          ? "模型执行工具后未返回正文，可继续生成以收尾"
          : anthropicLike(profile)
            ? "模型未返回正文，可在模型的高级配置里调高 max_tokens 后重试"
            : "模型未返回正文，可重试"
      );
    assistant.status = "complete";
    conversation.updatedAt = now();
    // 言里动过文件的，卷宗目录多半有了新东西：重新翻一遍，新出的、改过的成品挂在答末，侧栏的件数跟着更新
    if (archiveBefore && allSteps(assistant).some(step => TOOLS.get(step.name)?.writes)) {
      await refreshArchive();
      assistant.deliverables = (archiveEntries || [])
        .filter(entry => archiveBefore.get(entry.path) !== entry.modifiedAt)
        .map(entry => ({ path: entry.path, name: entry.name, size: entry.size }));
      if (!assistant.deliverables.length) delete assistant.deliverables;
    }
  } catch (error) {
    // 一个字没等到就又断了：模型没读到那几份回报，原样还回去等下一答
    if (!tally.opened) returnHeldReports(conversation, assistant, held);
    settleSteps(assistant, error.name === "AbortError" ? "已停止" : "已中断");
    if (error.name === "AbortError") assistant.status = "stopped";
    else if (assistant.content || assistant.reasoning || assistant.steps?.length) {
      assistant.status = "interrupted";
      assistant.error = friendlyError(error.message);
      assistant.interruptedAt = now();
      noteBreak(assistant, assistant.error);
    } else {
      assistant.status = "error";
      assistant.error = friendlyError(error.message);
    }
  } finally {
    if (gaugeTicker) clearInterval(gaugeTicker);
    if (clock) clearInterval(clock);
    assistant.durationMs = spentBefore + Math.round(performance.now() - started);
    delete assistant.startedAt;
    // 帮手（差遣）自己跑的几轮也是这一答花的墨：这一次新起的步骤里已做完的帮手用量一并计入（续写时此前的已经记过）；
    // 还在后台做的，做完再记回这一答（见 chargeHelper）
    // 记过的（帮手收工时自己记回、或上一截已算）打了 charged，不再计
    for (const [i, step] of (assistant.steps || []).entries())
      if ((i >= stepsBefore || helpersBefore.has(step)) && step.sub?.usage && step.sub.status !== "streaming" && !step.sub.charged) {
        step.sub.charged = true;
        tally.usageKnown = true;
        for (const key of Object.keys(tally.usage)) tally.usage[key] += Number(step.sub.usage[key] || 0);
      }
    assistant.usage = tally.usageKnown ? tally.usage : null;
    releaseQuota();
    accountUsage(profile, assistant, history, conversation, {
      opened: tally.opened,
      partialRound: tally.roundOpen,
      roundStart: tally.roundStart,
      steered: tally.steered
    });
    if (prior) {
      if (prior.usage) {
        const sum = { ...prior.usage };
        for (const [key, value] of Object.entries(assistant.usage || {})) sum[key] = Number(sum[key] || 0) + Number(value || 0);
        assistant.usage = sum;
      }
      if (prior.tokens) {
        assistant.tokenCount = prior.tokens + (Number(assistant.tokenCount) || 0);
        assistant.tokenEstimated = prior.estimated || !!assistant.tokenEstimated;
      }
    }
    if (requestJobs.get(conversation.id) === job) requestJobs.delete(conversation.id);
    settleSupplements(conversation, assistant, job, profile);
    if (currentId !== conversation.id || view !== "chat") conversation.unread = true;
    markDirty(conversation.id);
    saveStore();
    renderHistory();
    if (currentId === conversation.id && view === "chat") {
      finalizeAssistant(conversation, assistant);
      renderChatMeta(conversation);
      renderOutline();
      updateContextGauge();
    }
    renderSendButtons();
    // 压前文排在这一答撤下作业之后：之前排的话，言里收尾还在等卷宗重翻，这段仍算在作答，压缩会悄悄作罢
    if (assistant.status === "complete") {
      setTimeout(() => maybeAutoCompact(conversation, profile), 0);
      void maybeAutoTitle(conversation, profile);
    }
  }
}
