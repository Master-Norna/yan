// 言 · 对话引擎：历史装配、发送、流式回合、工具定义与系统提示
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function summarize(text, name, label) {
  const value = String(text || "");
  return value.length > HISTORY_TEXT_CHARS
    ? `\n\n--- 附件：${name}（${label}，摘要）---\n${value.slice(0, HISTORY_TEXT_CHARS)}\n[全文共 ${value.length} 字，此前已完整发送]`
    : `\n\n--- 附件：${name}（${label}）---\n${value}`;
}
/** @param {Message} message */
function quotedText(message) {
  const quote = message.quote?.text;
  if (!quote) return message.content;
  return `${quote
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join("\n")}\n\n${message.content || "请就所引用的内容作答。"}`;
}
// 上一答动过文件、请示过、差遣过、检索翻阅过的，压成一行带给下一问：模型才记得自己读过、改过哪些文件、查到过哪几条，不必从头再探
// label 是方括号里的标头：进历史时写「上一答的行迹」（见 historyForApi），存卷宗与压缩转写里写「行迹」
/** @param {Message} message */
function stepsDigest(message, label = "行迹") {
  const steps = (message.steps || []).filter(
    step =>
      WORK_TOOLS.has(step.name) ||
      ["ask_user", "delegate", "search_web", "fetch_page", "user_note", "download_file", "update_plan"].includes(step.name)
  );
  if (!steps.length) return "";
  const items = steps.slice(0, 16).map(step =>
    step.name === "user_note"
      ? `用户补言「${String(step.note || "").slice(0, 200)}」`
      : step.name === "ask_user"
        ? `请示 → ${step.answers ? String(step.note || "").slice(0, 200) : "用户未作答"}`
        : step.name === "delegate"
          ? `差遣「${String(step.title || "").slice(0, 40)}」→ ${step.result || step.status}${subChangedPaths(step).length ? `，改了 ${subChangedPaths(step).slice(0, 8).join("、")}` : ""}`
          : step.name === "search_web"
            ? `检索「${String(step.title || "").slice(0, 60)}」→ ${
                (step.results || [])
                  .slice(0, 3)
                  .map(r => `${String(r.title || "").slice(0, 40)}（${r.url}）`)
                  .join("；") ||
                step.result ||
                step.status
              }`
            : step.name === "fetch_page"
              ? `翻阅 ${String(step.title || step.url || "").slice(0, 60)}${step.url && step.title ? `（${step.url}）` : ""} → ${step.status === "done" ? "已读" : step.result || step.status}`
              : step.name === "update_plan"
                ? `计划 → ${(step.plan || []).map(item => `${{ done: "✓", doing: "▶", skipped: "–" }[item.status] || "○"}${item.text.slice(0, 40)}`).join("；")}`
                : `${step.name} ${String(step.title || "").slice(0, 80)} → ${step.status === "skipped" ? "用户跳过" : step.result || step.status}`
  );
  return `［${label}］${items.join("；")}${steps.length > 16 ? `；…共 ${steps.length} 步` : ""}`;
}
// 最新一问的文本附件能整份随消息送出的上限：按模型窗口的一成半算（没填窗口按 24k token）。超过的只给一行元数据，
// 模型要看就用 read_document 按页、按关键词取——有 read_document 在，没必要把一整本硬塞进提示把窗口撑爆
/** @param {Profile} profile */
function inlineTextBudget(profile = activeProfile()) {
  const window = Number(profile?.contextWindow) || 0;
  return window ? Math.max(4000, Math.floor(window * 0.15)) : 24000;
}
// 一件文本附件（或文档的提取文本）在这一问里占多少 token：最新一问按预算内联、超预算只剩一行；早先的只带 HISTORY_TEXT_CHARS 字的摘要
function attachmentTokens(file, latest, budget) {
  const tokens = Number(file.tokens) || Math.ceil(Number(file.size || 0) / 3);
  if (!latest) return Math.min(tokens, HISTORY_TEXT_CHARS);
  return tokens > budget ? 40 : tokens;
}
function tooLongToInline(text, budget) {
  return estimateText(text) > budget;
}
// 上次压缩以来的往来装成送给接口的历史。每一答的行迹摘要不接在助手自己的话后面——那样模型会把「［行迹］…」学成自己回复的
// 格式，答末照样写一行出来；而是冠在下一问的开头，当作系统附上的记录。末尾的一答后面没有下一问时（旁注锚在一答上）才退回接在它话后
async function historyForApi(source, lastUserId, budget = inlineTextBudget()) {
  const history = [];
  let trail = "";
  for (const m of source) {
    const entry = await messageForApi(m, m.id === lastUserId, budget);
    if (m.role === "assistant") trail = stepsDigest(m, "上一答的行迹");
    else if (trail && m.role === "user") {
      if (typeof entry.content === "string") entry.content = `${trail}\n\n${entry.content}`;
      else entry.content[0].text = `${trail}\n\n${entry.content[0].text}`;
      trail = "";
    }
    history.push(entry);
  }
  const last = history.at(-1);
  if (trail && last) last.content = `${last.content || ""}\n\n${trail}`.trim();
  return history;
}
/** @param {Message} message */
async function messageForApi(message, latest, budget = inlineTextBudget()) {
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  if (message.role !== "user" || !message.attachments?.length)
    return { role: message.role, content: message.role === "user" ? quotedText(message) : message.content };
  /** @type {Array<Record<string, any>>} 多段内容：首段文字，其后图片与文件原件 */
  const content = [{ type: "text", text: quotedText(message) || "请查看附件。" }];
  for (const metadata of message.attachments) {
    const file = metadata.data !== undefined ? metadata : await getAttachment(metadata.id);
    if (!file) {
      content[0].text += `\n\n[附件 ${metadata.name} 的原件在此浏览器中已不可用]`;
      continue;
    }
    if (file.kind === "text") {
      content[0].text += latest
        ? tooLongToInline(file.data, budget)
          ? `\n\n[附件 ${file.name}：文本 ${String(file.data).length} 字，过长未随消息附上；需要时用 read_document 按页或关键词读取]`
          : `\n\n--- 附件：${file.name} ---\n${file.data}`
        : summarize(file.data, file.name, "文本");
      continue;
    }
    if (file.kind !== "image" && file.extractedText) {
      content[0].text += latest
        ? tooLongToInline(file.extractedText, budget)
          ? `\n\n[附件 ${file.name}：本机提取文本 ${String(file.extractedText).length} 字，过长未随消息附上；需要时用 read_document 按页或关键词读取]`
          : `\n\n--- 附件：${file.name}（本机提取）---\n${file.extractedText}`
        : summarize(file.extractedText, file.name, "本机提取");
      continue;
    }
    if (!latest) {
      content[0].text += `\n\n[${file.kind === "image" ? "图片" : "文件"}：${file.name}，${formatFileSize(file.size)}，已在此前发送]`;
      continue;
    }
    if (file.kind === "image") content.push({ type: "image_url", image_url: { url: file.data, detail: "auto" } });
    else content.push({ type: "file", file: { filename: file.name, file_data: String(file.data).replace(/^data:[^,]*,/, "") } });
  }
  return { role: "user", content };
}
async function sendOrStop() {
  // 作答途中：输入框里有话就是补言，递给正在作答的模型；空着才是停止
  if (conversationRunning()) return composerHasContent() ? sendSupplement() : stopGeneration();
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
  const text = input.value.trim();
  if (!text && !pendingAttachments.length && !pendingQuote) return;
  let profile = activeProfile();
  if (!profile) {
    toast("请先接入模型");
    return openSettings("models");
  }
  if (profile.tools !== false && apiBase === null) {
    await ensureLocalBridge();
    profile = activeProfile() || profile;
  }
  if (quotaBlocked(profile)) {
    if (currentConversation()) renderConversation();
    toast(quotaExhausted(profile) ? "余墨已尽，请调高上限或更换模型" : "余墨不足：进行中的对话已占去余量，请稍候或调高上限");
    return;
  }
  const sendingDraftKey = draftKey();
  let c = currentConversation();
  if (c && !(await ensureWorkReady(c))) return;
  if (!c) {
    const pending = (store.settings.pendingWorkdir || "").trim();
    if (pending) {
      // 行：先把工作目录立起来，立不起来就不发
      if (profile.tools === false) {
        toast("当前模型已关闭本机工具，请在模型高级配置中开启");
        return;
      }
      if (apiBase === null && !(await ensureLocalBridge())) {
        toast("执事需要本机桥接，请先运行 start.cmd");
        return;
      }
    }
    c = {
      id: uid(),
      title: titleFrom(text || pendingQuote?.text || "", pendingAttachments),
      forks: [],
      threads: [],
      createdAt: now(),
      updatedAt: now(),
      profileId: profile.id,
      messages: [],
      workdir: pending,
      commandPolicy: normalizeCommandPolicy(store.settings.commandPolicyDefault),
      reasoning: normalizeReasoning(profile.reasoning)
    };
    if (!(await ensureWorkReady(c))) return;
    closeChipPop();
    store.conversations.unshift(c);
    currentId = c.id;
  }
  const user = takeComposer(input, sendingDraftKey);
  await startTurn(c, user, profile);
}
// 把案上的东西（话、附件、引文）收成一条用户消息，输入框与草稿随之清空
/** @returns {Message} */
function takeComposer(input, key = draftKey()) {
  /** @type {Message} */
  const user = {
    id: uid(),
    role: "user",
    content: input.value.trim(),
    timestamp: now(),
    attachments: pendingAttachments,
    ...(pendingQuote ? { quote: pendingQuote } : {})
  };
  input.value = "";
  input.style.height = "auto";
  delete store.drafts[key];
  pendingAttachments = [];
  pendingQuote = null;
  renderAttachments();
  renderQuote();
  return user;
}
// 起一问：用户消息与待写的一答一起入册，随即向模型要回复
/**
 * @param {Conversation} c
 * @param {Message} user
 * @param {Profile} profile
 */
async function startTurn(c, user, profile) {
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  c.messages.push(user, assistant);
  c.updatedAt = now();
  c.profileId = profile.id;
  saveStore();
  if (currentId === c.id) render(true);
  else renderHistory();
  // 头一问一发出就拟题，与作答并行：侧栏里立刻是个像样的名字，不用等一答写完；没拟成的，那一答收尾时再试
  if (c.messages.filter(m => m.role === "user").length === 1) void maybeAutoTitle(c, profile);
  await streamReply(c, assistant, profile);
}
// 补言：模型作答途中用户再寄来的话，是引导不是排队。先落在行迹里它到达的那一刻（一步「补言 · 待寄」）；模型正在写着，
// 就等它说到一个自然的落点（见 watchSteer：思考写完、句尾或段落尾、代码围栏闭合）把这一轮的流停下、已写的留着，随即连同补言
// 再请它开口——它读了这句接着写，可就此改道；正在拟工具调用或跑着工具时不停，等结果交回、模型再开口之前递上；
// 这一答若已在收尾、不再有下一回合，就在落笔后作为新的一问送出。引导是为了答得更好，从不硬掐
const SUPPLEMENT_PREFIX = "［用户在你作答途中补充的话］",
  STEER_PREFIX = "［用户在你作答途中插了一句，你写到此处暂停。读后接着作答，可据此改变方向；不必重复已写的内容］";
function sendSupplement() {
  const c = currentConversation(),
    job = c && requestJob(c.id),
    assistant = c?.messages.find(message => message.id === job?.assistantId);
  if (!c || !job || !assistant || assistant.status !== "streaming") return stopGeneration();
  const user = takeComposer($("#chatInput"));
  const text = user.quote ? quotedText(user) : user.content;
  /** @type {Step} */
  const step = {
    id: `note_${uid().slice(0, 8)}`,
    name: "user_note",
    arguments: "{}",
    status: "running",
    title: text.split("\n").find(Boolean)?.slice(0, 80) || "",
    note: text,
    attachments: user.attachments?.length ? user.attachments : undefined,
    at: assistant.content.length,
    rat: String(assistant.reasoning || "").length
  };
  (job.queue ||= []).push({ user, step });
  (assistant.steps ||= []).push(step);
  saveStoreSoon();
  refreshSteps(assistant);
  renderSendButtons();
  if (followBottom) scrollBottom();
  // 模型正写着：盯着它说到落点再停这一轮，streamReply 的循环接手——已写的留下，补言递上，随即再请它开口
  if (job.reading) watchSteer(job, assistant);
}
// 补言到了不是立刻停——像人插话也等对方一句说完，且不设时限：正在思考就等思考写完（正文起笔），想多久都等；
// 正在拟工具调用就不停，等结果交回时递；正在写正文就等到句尾或段落尾、且不在代码围栏里（围栏等它闭合）。
// 每 120ms 看一眼；流自己先到头了就不停（回合边界或收尾处理）
/** @param {Message} assistant */
function watchSteer(job, assistant) {
  if (job.steerTimer) return;
  job.steerTimer = setInterval(() => {
    const stop = () => {
      clearInterval(job.steerTimer);
      job.steerTimer = 0;
    };
    if (!job.reading || !job.round) return stop();
    if (assistant.toolCalls?.length) return; // 正在拟调用：等它拟完，结果交回时递
    const said = assistant.content.slice(job.roundStart || 0);
    if (!said.trim()) return; // 还在想（或还没开口）：等
    const fenced = (said.match(/^\s*```/gm) || []).length % 2 === 1;
    if (fenced || !/[\n。！？!?]\s*$/.test(said)) return;
    stop();
    job.round.abort();
  }, 120);
}
// 停的位置若略过了句尾，把多出的那几个字退回去，落点干净
function trimToBoundary(text) {
  const match = text.match(/^([\s\S]*[\n。！？!?])[^\n。！？!?]*$/);
  return match && text.length - match[1].length < 120 ? match[1] : text;
}
// 回合边界：把排着的补言递给模型（历史里接在工具结果之后，或接在被掐断的半截话之后），行迹里那一步打勾
async function deliverSupplements(job, history, budget, assistant, { steer = false } = {}) {
  const queue = job.queue || [];
  job.queue = [];
  for (const { user, step } of queue) {
    const entry = await messageForApi(user, true, budget),
      prefix = steer ? STEER_PREFIX : SUPPLEMENT_PREFIX;
    if (typeof entry.content === "string") entry.content = `${prefix}${entry.content}`;
    else entry.content[0].text = `${prefix}${entry.content[0].text}`;
    history.push(entry);
    step.status = "done";
    step.result = steer ? "已递 · 引路" : "已递";
  }
  // 递出去就立刻打勾。不补这一下，纯文字作答里没有下一个工具轮来顺带重画，
  // 那枚「待寄」会一直转到整答写完——模型早读到了，页面上还像没送出去
  if (queue.length) {
    saveStoreSoon();
    refreshSteps(assistant);
  }
}
// 收尾时还没递出去的补言：从行迹里撤下，整答顺利写完的作为新的一问接着送；停了、断了的放回案上，话不能丢
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 * @param {Profile} profile
 */
function settleSupplements(conversation, assistant, job, profile) {
  const queue = job.queue || [];
  job.queue = [];
  if (!queue.length) return;
  const ids = new Set(queue.map(item => item.step.id));
  assistant.steps = (assistant.steps || []).filter(step => !ids.has(step.id));
  if (!assistant.steps.length) delete assistant.steps;
  const users = queue.map(item => item.user),
    quote = users.find(u => u.quote)?.quote || null;
  if (assistant.status === "complete") {
    /** @type {Message} */
    const user = {
      id: uid(),
      role: "user",
      content: users
        .map(u => u.content)
        .filter(Boolean)
        .join("\n\n"),
      timestamp: now(),
      attachments: users.flatMap(u => u.attachments || []),
      ...(quote ? { quote } : {})
    };
    setTimeout(() => void startTurn(conversation, user, profile), 0);
    return;
  }
  const key = draftKey(conversation.id),
    draft = draftRecord(conversation.id);
  store.drafts ||= {};
  store.drafts[key] = {
    text: [draft.text, ...users.map(u => u.content)].filter(Boolean).join("\n\n"),
    attachments: [...draft.attachments, ...users.flatMap(u => u.attachments || [])],
    quote: draft.quote || quote,
    updatedAt: now()
  };
  if (currentId === conversation.id && view === "chat") restoreDraft();
  toast("这一答未写完，补言已放回案上");
}
function titleFrom(text, attachments) {
  const value = (text || `关于 ${attachments[0]?.name || "附件"}`).replace(/\s+/g, " ").trim();
  return value.slice(0, 28) + (value.length > 28 ? "…" : "");
}
function stopGeneration(id = currentId) {
  const job = requestJob(id);
  if (!job) return;
  requestJobs.delete(id);
  markDirty(id);
  job.controller.abort();
  const conversation = store.conversations.find(item => item.id === id),
    assistant =
      conversation?.messages.find(message => message.id === job.assistantId) ||
      [...(conversation?.messages || [])].reverse().find(message => message.status === "streaming");
  if (assistant?.status === "streaming") {
    assistant.status = "stopped";
    settleSteps(assistant, "已停止");
  }
  saveStore();
  renderHistory();
  renderSendButtons();
  if (currentId === id) setConnection("idle", "已停止");
}
function stopAllGenerations() {
  for (const [id, job] of requestJobs) {
    job.controller.abort();
    const conversation = store.conversations.find(item => item.id === (job.conversationId || id));
    const assistant = job.threadId
      ? conversation?.threads?.find(t => t.id === job.threadId)?.messages.find(m => m.id === job.assistantId)
      : conversation?.messages.find(message => message.id === job.assistantId);
    if (assistant?.status === "streaming") {
      assistant.status = "stopped";
      settleSteps(assistant, "已停止");
    }
    markDirty(conversation?.id);
  }
  requestJobs.clear();
}

/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 * @param {Profile} profile
 */
async function streamReply(conversation, assistant, profile, { resume = false } = {}) {
  // 这一答是不是执事的，记在消息自己身上：生成期间用户可能翻去欢迎页或卷宗，页面上一时没有「当前对话」，时间线不能因此改画法
  assistant.work = isWork(conversation);
  /** @type {{ controller: AbortController, assistantId: string, label: string, profile: Profile, queue: Array<{ user: Message, step: Step }>, round: AbortController|null, reading: boolean, roundStart: number, steerTimer: number }} */
  const job = {
    controller: new AbortController(),
    assistantId: assistant.id,
    label: "生成中",
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
  setJobLabel(conversation, job, "生成中");
  const started = performance.now();
  let leadTrim = 0;
  const gaugeTicker = conversation.id === currentId ? setInterval(updateContextGauge, 600) : null;
  // 言里做文件：记下开工前卷宗的样子，收尾时新出的、改过的成品挂在答末
  const archiveBefore = !isWork(conversation) && archiveOnline() ? new Map((archiveEntries || []).map(e => [e.path, e.modifiedAt])) : null;
  // 用量在 finally 里结算：停止、断网、工具链中途出错，前面几轮已经花掉的墨也得记上，不能只在整答顺利收尾时记账
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    stepsBefore = (assistant.steps || []).length;
  /** @type {Array<Record<string, any>>} 送给接口的消息列表 */
  let history = [];
  let usageKnown = false,
    roundOpen = false,
    opened = false,
    steered = false,
    roundStart = 0,
    releaseQuota = () => {};
  try {
    const contextIndex = conversation.messages.map(m => m.role).lastIndexOf("context");
    const source = conversation.messages
      .slice(contextIndex + 1)
      .filter(m => m.id !== assistant.id && m.status !== "error" && ["user", "assistant"].includes(m.role));
    const lastUserId = source.filter(m => m.role === "user").at(-1)?.id,
      budget = inlineTextBudget(profile);
    history = summaryMessages(contextIndex >= 0 ? conversation.messages[contextIndex] : null);
    history.push(...(await historyForApi(source, lastUserId, budget)));
    // 先把这一答预计的用量记到预留里（提示 + 最大输出），别的对话同时开工时看得见；收尾时换成实际用量
    // 预留只是估个数：一答的输出按八千算，不必与接口实际的上限一致
    releaseQuota = reserveTokens(profile, estimateTokens(history) + (Number(profile.maxTokens) || 8192));
    if (resume && assistant.content) {
      history.push({ role: "assistant", content: assistant.content });
      history.push({ role: "user", content: "上一条回复在此处因连接中断。请仅从中断处继续，不要重复已生成的内容。" });
    }
    const tools = profile.tools !== false ? toolDefinitions(conversation) : null;
    const overrides = {
      systemPrompt: assistantHint(profile, tools, conversation),
      tools,
      reasoning: conversation.reasoning || ""
    };
    const toolCache = new Map();
    let rounds = 0;
    for (;;) {
      assistant.toolCalls = null;
      assistant.usage = null;
      roundStart = job.roundStart = assistant.content.length;
      roundOpen = false;
      // 每一轮自己一个中止器：补言只停这一轮的流，整答的 controller 留给「停止」
      const round = new AbortController(),
        stopRound = () => round.abort();
      job.round = round;
      job.controller.signal.addEventListener("abort", stopRound, { once: true });
      job.reading = true;
      try {
        await readReply(profile, history, round.signal, overrides, assistant, false, () => (roundOpen = opened = true));
      } catch (error) {
        if (error.name !== "AbortError" || job.controller.signal.aborted || !job.queue?.length) throw error;
        // 补言停下的：这一轮写到落点为止（花的墨按估算记上），已写的话与补言一起进历史，没执行的工具调用一律作废，随即再开一轮
        const said = trimToBoundary(assistant.content.slice(roundStart)).replace(/\n+$/, "");
        assistant.content = assistant.content.slice(0, roundStart) + said;
        for (const { step } of job.queue) if (typeof step.at === "number") step.at = Math.min(step.at, assistant.content.length);
        if (roundOpen) {
          const spent = estimateTokens(history) + estimateTokens([{ content: said }]);
          usage.prompt_tokens += spent;
          usage.total_tokens += spent;
          usageKnown = steered = true;
          roundOpen = false;
        }
        assistant.toolCalls = null;
        if (said.trim()) history.push({ role: "assistant", content: said });
        await deliverSupplements(job, history, budget, assistant, { steer: true });
        if (assistant.content) assistant.content += "\n\n";
        continue;
      } finally {
        job.reading = false;
        job.round = null;
        clearInterval(job.steerTimer);
        job.steerTimer = 0;
        job.controller.signal.removeEventListener("abort", stopRound);
      }
      if (assistant.usage) {
        usageKnown = true;
        roundOpen = false;
        for (const key of Object.keys(usage)) usage[key] += Number(assistant.usage[key] || 0);
      }
      const calls = (assistant.toolCalls || []).filter(call => call.name);
      if (!calls.length || !overrides.tools) break;
      // 轮次到顶：不再受理这一批调用，收回工具，让模型就已有结果收尾
      if (++rounds > toolRoundLimit()) {
        const said = assistant.content.slice(roundStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push({ role: "user", content: "工具调用轮次已达上限，请不要再调用工具，直接根据已有结果作答，并说明尚未完成的部分。" });
        overrides.tools = null;
        if (assistant.content) assistant.content += "\n\n";
        continue;
      }
      // 模型请求调用工具：记录步骤、执行、把结果作为 tool 消息回传，再让模型继续；历史里只带本轮新写的正文，前几轮的已经在各自的 assistant 消息里
      /** @type {Step[]} */
      const steps = calls.map(call => ({
        id: call.id || `call_${uid().slice(0, 8)}`,
        name: call.name,
        arguments: call.arguments || "{}",
        status: "running",
        at: assistant.content.length,
        rat: String(assistant.reasoning || "").length
      }));
      (assistant.steps ||= []).push(...steps);
      refreshSteps(assistant);
      setJobLabel(conversation, job, isWork(conversation) ? "执行中" : "查阅中");
      history.push({
        role: "assistant",
        content: assistant.content.slice(roundStart) || null,
        tool_calls: steps.map(step => ({ id: step.id, type: "function", function: { name: step.name, arguments: step.arguments } })),
        ...(assistant.thinkingBlocks?.length ? { thinking_blocks: assistant.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, job.controller.signal, toolCache);
      for (const step of steps) history.push({ role: "tool", tool_call_id: step.id, content: outcomes.get(step.id) ?? "" });
      await deliverSupplements(job, history, budget, assistant);
      if (assistant.content) assistant.content += "\n\n";
      setJobLabel(conversation, job, "生成中");
    }
    leadTrim = assistant.content.match(/^\n*/)[0].length;
    assistant.content = assistant.content.replace(/^\n+|\n+$/g, "");
    if (leadTrim) for (const step of assistant.steps || []) if (typeof step.at === "number") step.at = Math.max(0, step.at - leadTrim);
    if (!assistant.content)
      throw Error(
        assistant.steps?.length ? "模型执行工具后未返回正文，可点「继续生成」请它收尾" : "模型未返回正文，请适当提高最大输出长度后重试"
      );
    assistant.status = "complete";
    conversation.updatedAt = now();
    setTimeout(() => maybeAutoCompact(conversation), 0);
    // 言里动过文件的，卷宗目录多半有了新东西：重新翻一遍，新出的、改过的成品挂在答末，侧栏的件数跟着更新
    if (archiveBefore && allSteps(assistant).some(step => WORK_TOOLS.has(step.name))) {
      await refreshArchive();
      assistant.deliverables = (archiveEntries || [])
        .filter(entry => archiveBefore.get(entry.path) !== entry.modifiedAt)
        .map(entry => ({ path: entry.path, name: entry.name, size: entry.size }));
      if (!assistant.deliverables.length) delete assistant.deliverables;
    }
  } catch (error) {
    settleSteps(assistant, error.name === "AbortError" ? "已停止" : "已中断");
    if (error.name === "AbortError") assistant.status = "stopped";
    else if (assistant.content || assistant.reasoning || assistant.steps?.length) {
      assistant.status = "interrupted";
      assistant.error = friendlyError(error.message);
      assistant.interruptedAt = now();
    } else {
      assistant.status = "error";
      assistant.error = friendlyError(error.message);
    }
  } finally {
    if (gaugeTicker) clearInterval(gaugeTicker);
    assistant.durationMs = Math.round(performance.now() - started);
    // 帮手（差遣）自己跑的几轮也是这一答花的墨：这一次新起的步骤里的帮手用量一并计入（续写时此前的已经记过）
    for (const step of (assistant.steps || []).slice(stepsBefore))
      if (step.sub?.usage) {
        usageKnown = true;
        for (const key of Object.keys(usage)) usage[key] += Number(step.sub.usage[key] || 0);
      }
    assistant.usage = usageKnown ? usage : null;
    releaseQuota();
    accountUsage(profile, assistant, history, conversation, { opened, partialRound: roundOpen, roundStart, steered });
    if (requestJobs.get(conversation.id) === job) requestJobs.delete(conversation.id);
    settleSupplements(conversation, assistant, job, profile);
    if (currentId !== conversation.id || view !== "chat") conversation.unread = true;
    markDirty(conversation.id);
    saveStore();
    renderHistory();
    if (currentId === conversation.id && view === "chat") {
      finalizeAssistant(conversation, assistant, leadTrim);
      renderChatMeta(conversation);
      renderOutline();
      updateContextGauge();
    }
    renderSendButtons();
    refreshConnection();
    if (assistant.status === "complete") void maybeAutoTitle(conversation, profile);
  }
}
// 向模型要一轮回复，写进 target（正文、思绪、工具调用、用量）：流式按 SSE 逐字进，否则整段一次到
// onOpen：接口接下请求、开始回话时叫一声——从这一刻起这一轮就在花墨了，中途停止也得记账；onFrame 逐帧交给 readSse（旁注面板用来跟随滚动）
/**
 * @param {Profile} profile
 * @param {Message|SubAgent} target 主消息或帮手（拟题 / 压缩的临时对象也按 Message 的样子造）
 */
async function readReply(profile, history, signal, overrides, target, retried = false, onOpen = null, onFrame = null) {
  target.thinkingBlocks = null;
  const response = await requestChat(profile, history, signal, overrides);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // 桥接回的 error 是一句话；直连 Anthropic 回的是 { error: { message } }
    const message = (typeof data.error === "string" ? data.error : data.error?.message) || `请求失败（${response.status}）`;
    // 接口不认这个思考档位：记下它认的几档，换成最接近的一档重发一次；再不行才算失败
    const sent = reasoningFields(profile, overrides.reasoning).reasoning_effort;
    if (!retried && sent && learnReasoningLevels(profile, message, sent)) {
      const level = nearestReasoning(profile, overrides.reasoning);
      toast(`此模型的思考档位为 ${profileReasoningLevels(profile).map(reasoningLabel).join(" / ")}，已改用「${reasoningLabel(level)}」`);
      renderModelTriggers();
      return readReply(profile, history, signal, overrides, target, true, onOpen, onFrame);
    }
    throw Error(message);
  }
  onOpen?.();
  const type = response.headers.get("content-type") || "";
  // 帮手与消息的流式字段一致（content / reasoning / toolCalls / usage），readSse 按消息处理
  const sink = /** @type {Message} */ (target);
  if (type.includes("text/event-stream")) return readSse(response, sink, { onFrame });
  const data = await response.json(),
    message = data?.choices?.[0]?.message;
  target.content += extractContent(data);
  // 与流式一致：有的接口把思考放在 reasoning 而不是 reasoning_content
  target.reasoning = normalizeContent(message?.reasoning_content ?? message?.reasoning) || target.reasoning;
  splitInlineThink(sink);
  target.usage = data.usage || null;
  if (Array.isArray(message?.tool_calls))
    target.toolCalls = message.tool_calls.map(call => ({
      id: call.id,
      name: call.function?.name || "",
      arguments: call.function?.arguments || ""
    }));
}
// 把一批工具调用跑完，返回各步回给模型的结果。相邻的只读调用一起跑（读、搜、翻网页、翻记忆彼此无关）；会改状态或要请示的按原顺序逐个来。
// 主模型与帮手共用这一段：assistant 是页面上那条消息（帮手的步骤也画在它的行迹里）
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runSteps(steps, conversation, assistant, signal, toolCache) {
  const outcomes = new Map();
  const runOne = async step => {
    const stepStarted = performance.now();
    const cacheable = !WORK_TOOLS.has(step.name) && !MEMORY_TOOLS.has(step.name) && step.name !== "delegate",
      cacheKey = toolCacheKey(step),
      cached = cacheable ? toolCache.get(cacheKey) : null;
    let outcome;
    if (cached) {
      Object.assign(step, structuredClone(cached.presentation));
      step.cached = true;
      outcome = structuredClone(cached.outcome);
      outcome.display = `复用 · ${outcome.display}`;
    } else {
      outcome = await runTool(step, conversation, assistant, signal);
      // 只缓存成功的：临时的 502、超时若也缓存，模型想重试只会一直拿到同一个旧失败
      if (cacheable && outcome.ok) toolCache.set(cacheKey, { outcome: structuredClone(outcome), presentation: toolPresentation(step) });
    }
    const remaining = MIN_TOOL_STATUS_MS - (performance.now() - stepStarted);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    step.status = step.skipped ? "skipped" : outcome.ok ? "done" : "error";
    step.result = outcome.display;
    outcomes.set(step.id, String(outcome.content).slice(0, 60000));
    refreshSteps(assistant);
    saveStore();
  };
  for (let i = 0; i < steps.length; ) {
    if (!PARALLEL_TOOLS.has(steps[i].name)) {
      await runOne(steps[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < steps.length && PARALLEL_TOOLS.has(steps[j].name)) j += 1;
    await Promise.all(steps.slice(i, j).map(runOne));
    i = j;
  }
  return outcomes;
}
// opened：接口至少接下过一次请求（没接下的——400、连不上——不花墨）；partialRound：最后一轮开了头却没等到它的 usage（停止、断网），
// 那一轮按估算补上——提示全文加上这一轮写出的字；一次 usage 都没拿到的（直连不回 usage）整答按估算
/**
 * @param {Profile} profile
 * @param {Message} assistant
 * @param {Conversation} conversation
 */
function accountUsage(
  profile,
  assistant,
  requestMessages,
  conversation,
  { opened = true, partialRound = false, roundStart = 0, steered = false } = {}
) {
  const exact = Number(assistant.usage?.total_tokens || 0);
  const estimate = from => estimateTokens(requestMessages) + estimateTokens([{ content: String(assistant.content || "").slice(from) }]);
  const consumed = exact > 0 ? exact + (partialRound ? estimate(roundStart) : 0) : opened ? estimate(0) : 0;
  if (!(consumed > 0)) return;
  profile.usedTokens = Math.max(0, Number(profile.usedTokens || 0)) + consumed;
  assistant.tokenCount = consumed;
  assistant.tokenEstimated = !(exact > 0) || partialRound || steered;
  if (quotaExhausted(profile)) toast("此答写毕，余墨已尽；换个模型可续");
  renderQuota();
}
// 首次问答完成后请模型拟一个短标题；用户手动改过题（titleAuto === false）就不再动。
// titled 只在标题真正写入后才置真：临时的网络错误不该让这段对话从此再也拟不上题，之后几答收尾时会再试（最多三次）
const titlingIds = new Set(),
  titleRetries = new Set();
/** @param {Conversation} conversation 用户亲手改过题（拟题期间也可能改，收尾前得再看一眼） */
const renamedByHand = conversation => conversation.titleAuto === false;
/**
 * @param {Conversation} conversation
 * @param {Profile} profile
 */
async function maybeAutoTitle(conversation, profile) {
  if (!store.settings.autoTitle || conversation.titleAuto === false || conversation.titled) return;
  // 首问发出时拟题与正文并行；若正文先写完，收尾处会再来一次。此时不能另发一份重复请求，
  // 但要把「原请求若失败，随后再试」记下来，否则原请求稍后超时便再也没人触发重试。
  if (titlingIds.has(conversation.id)) {
    if (conversation.messages.some(message => message.role === "assistant" && message.status === "complete"))
      titleRetries.add(conversation.id);
    return;
  }
  if (quotaExhausted(profile) || (conversation.titleTries || 0) >= 3) return;
  const first = conversation.messages.find(m => m.role === "user"),
    reply = conversation.messages.find(m => m.role === "assistant" && m.status === "complete");
  if (!first) return;
  titlingIds.add(conversation.id);
  conversation.titleTries = (conversation.titleTries || 0) + 1;
  try {
    const ask = prompt("assistant.title", {
      user: String(first.content || (first.attachments || []).map(a => a.name).join("、") || "（附件）").slice(0, 1200),
      assistant: reply ? `\n\n助手：${String(reply.content).slice(0, 1200)}` : ""
    });
    // 题目只有几个字，可它是与一答并行发出的：接口忙、模型慢起（会思考的先想再写）时三十秒常常不够，三次都超时就再也拟不上题。
    // 超时给到两分钟；输出上限不能只按题目本身算——会思考的模型把思考也计在 max_tokens 里；开了思考档位的降到最低一档，拟题用不着深想
    const response = await requestChat(profile, [{ role: "user", content: ask }], AbortSignal.timeout(120000), {
      maxTokens: 4000,
      temperature: 0.3,
      systemPrompt: "",
      reasoning: conversation.reasoning ? "low" : ""
    });
    if (!response.ok) return;
    /** @type {Message} */
    const temp = { id: `title-${uid()}`, role: "assistant", content: "", timestamp: now() };
    if ((response.headers.get("content-type") || "").includes("text/event-stream")) await readSse(response, temp);
    else {
      const data = await response.json();
      temp.content = extractContent(data);
      temp.usage = data.usage;
    }
    const spent = Number(temp.usage?.total_tokens || 0) || estimateTokens([{ content: ask }, { content: temp.content }]);
    profile.usedTokens = Math.max(0, Number(profile.usedTokens || 0)) + spent;
    renderQuota();
    const title =
      temp.content
        .split("\n")
        .map(line => line.trim())
        .find(Boolean)
        ?.replace(/^[\s"'“”‘’《》「」【】#*]+|[\s"'“”‘’《》「」【】。！？!?.、,，]+$/g, "")
        .slice(0, 24) || "";
    if (!title || renamedByHand(conversation)) return;
    conversation.title = title;
    conversation.titleAuto = true;
    conversation.titled = true;
    delete conversation.titleTries;
    markDirty(conversation.id);
    saveStore();
    renderHistory();
    // 用户正在页面上方改着标题：不把拟好的题写进去盖掉他的字，他落笔（blur）时以他写的为准
    if (currentId === conversation.id) {
      if (document.activeElement !== $("#chatTitle")) $("#chatTitle").textContent = title;
      syncDocumentTitle();
    }
  } catch {
  } finally {
    titlingIds.delete(conversation.id);
    const retry = titleRetries.delete(conversation.id);
    if (retry && !conversation.titled && !renamedByHand(conversation) && store.settings.autoTitle)
      setTimeout(() => void maybeAutoTitle(conversation, profile), 0);
  }
}
// 可读的文档：对话附件、浏览器内的旧卷宗，以及（设置允许时）磁盘卷宗里的文本与 Office / PDF——后者用到时才取回并抽正文
const ARCHIVE_DOC_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp"]);
/** @param {Conversation} conversation */
function availableDocuments(conversation) {
  const seen = new Map();
  for (const file of [...(conversation?.messages || []).flatMap(m => m.attachments || []), ...store.library])
    if (file.id && !seen.has(file.name) && (file.kind === "text" || (file.kind === "file" && file.extracted))) seen.set(file.name, file);
  if (store.settings.archiveRead !== false && archiveOnline())
    for (const entry of archiveEntries || []) {
      const extension = String(entry.name).split(".").pop().toLowerCase();
      if (seen.has(entry.name) || !(ARCHIVE_DOC_EXTENSIONS.has(extension) || isTextFile({ name: entry.name, type: "" }))) continue;
      seen.set(entry.name, { name: entry.name, archive: entry.path, size: entry.size, modifiedAt: entry.modifiedAt, kind: "archive" });
    }
  return [...seen.values()];
}
// sub：给帮手的一套——同样的工具，但不再差遣、也不请示用户
/** @param {Conversation} conversation */
function toolDefinitions(conversation, { sub = false, lookup = false } = {}) {
  // 描述与参数说明在 prompts/tools.js；这里只决定哪些工具在此对话里可用
  // 言（对谈）的文件工具只为产出。带 brief 的用短说明，且不带 edit_file / search_files
  // lookup：旁注用的只查不改的一套——检索、翻网页、翻文档、翻记忆与旧谈；不动文件、不请示、不差遣、不记不忘
  const work = isWork(conversation) && !lookup;
  const define = (name, vars = {}) => {
    const spec = PROMPTS.tools?.[name];
    if (!spec) {
      console.error(`缺少工具定义：${name}`);
      return null;
    }
    const text = !work && spec.brief ? prompt(`tools.${name}.brief`, vars) : prompt(`tools.${name}.description`, vars);
    return { type: "function", function: { name, description: text, parameters: spec.parameters } };
  };
  const tools = [];
  if (apiBase !== null) tools.push(define("search_web"), define("fetch_page"));
  // 调接口能发 POST，不算纯查阅，旁注不给；算一段 JS 在浏览器里的隔离沙箱跑，不经桥接，谁都有
  if (apiBase !== null && !lookup) tools.push(define("http_request"));
  tools.push(define("run_js"));
  // 文件工具：绑了目录是执事的六件，落在工作目录；没绑是言的四件，落在卷宗；都要桥接在线。下载也落在同一处
  if (workRoot(conversation) && !lookup)
    tools.push(...(work ? [...WORK_TOOLS] : CHAT_FILE_TOOLS).map(name => define(name)), define("download_file"));
  // 计划：行里给用户看的清单，只有主模型维护
  if (work && !sub) tools.push(define("update_plan"));
  if (!sub && !lookup) tools.push(define("ask_user"));
  // 帮手与旁注对记忆只读：翻记忆、查旧谈可以，记与忘留给主模型
  if (memoryEnabled())
    tools.push(...[...MEMORY_TOOLS].filter(name => (!sub && !lookup) || !MEMORY_WRITE_TOOLS.has(name)).map(name => define(name)));
  const docs = availableDocuments(conversation);
  if (docs.length) tools.push(define("read_document", { docs: docs.map(d => d.name).join("、") }));
  // 有桥接、且有别的活能交出去时才可差遣；帮手自己不再差遣
  if (!sub && !lookup && apiBase !== null && tools.some(tool => tool && tool.function.name !== "ask_user")) tools.push(define("delegate"));
  const usable = tools.filter(Boolean);
  return usable.length ? usable : null;
}
// 附加给模型的提示：日期、目录与做法（执事的，或言里卷宗的）、联网分寸、记忆分寸、页内可视化的写法。工具各自做什么、何时用，在工具说明里说，这里不重复
/** @param {Conversation} conversation */
function workHint(conversation) {
  const win = (bootstrap.work?.platform || "win32") === "win32",
    shell = bootstrap.work?.shell || (win ? "PowerShell" : "sh");
  return prompt(isWork(conversation) ? "work.hint" : "work.archive", {
    workdir: workRoot(conversation),
    scratch: scratchRel(conversation),
    reach: prompt(sandboxed() ? "work.reachSandbox" : roamAllowed() ? "work.reachAnywhere" : "work.reachInside"),
    platform: win ? "Windows" : bootstrap.work?.platform || "类 Unix",
    shell,
    shellNote: win ? prompt("work.windowsShell") : ""
  });
}
/**
 * @param {Profile} profile
 * @param {Conversation} conversation
 */
function assistantHint(profile, tools, conversation = null) {
  const lines = [
    prompt("assistant.today", { day: formatDay(now()), iso: new Date().toISOString().slice(0, 10) }),
    prompt("assistant.judgement")
  ];
  const names = new Set((tools || []).map(tool => tool?.function?.name));
  if (names.has("run_command") && conversation) lines.push(workHint(conversation));
  if (names.has("search_web")) lines.push(prompt("assistant.search"));
  if (names.has("ask_user")) lines.push(prompt("assistant.asking"));
  // 何时差遣写在工具说明里；这一句只给行——对谈里差遣是少数，不必每问都背着
  if (names.has("delegate") && conversation && isWork(conversation)) lines.push(prompt("assistant.delegating"));
  if (names.has("remember")) lines.push(prompt("memory.hint", { count: store.memory.items.length }));
  lines.push(prompt("assistant.drawing"));
  if (!conversation || !isWork(conversation)) lines.push(prompt("assistant.manner"));
  const base = String(profile.systemPrompt || "").trim();
  return base ? `${base}\n\n${lines.join("\n")}` : lines.join("\n");
}
