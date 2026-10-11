// 言 · 对话引擎 · 发送：开工前的闸、起一问、补言、停止
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 准备工作目录或重连桥接时还没有生成任务；这段等待里再次点发送、重答、改问、续写都不能再起一问。
let sendPreparing = false;
// 消息上的重答、改问、续写与发送共用这一道闸
async function preparing(task) {
  if (sendPreparing) return false;
  sendPreparing = true;
  renderSendButtons();
  try {
    return await task();
  } finally {
    sendPreparing = false;
    renderSendButtons();
  }
}
// 开工前：工作目录立起来，再向桥接认领这段对话——两页同时开工，桥接按先来后到只放一页（见 claimConversation）
/** @param {Conversation} c */
async function prepareTurn(c) {
  if (!(await ensureWorkReady(c))) return false;
  if (!(await claimConversation(c.id))) {
    toast("此对话正在另一页面作答，稍后再发");
    return false;
  }
  // 等的这一会儿，后台回报可能已在这段里另起了一答，这段也可能已被删掉
  return !conversationRunning(c.id) && store.conversations.includes(c);
}
async function sendOrStop() {
  if (sendPreparing) return;
  // 作答途中：输入框里有话就是补言，递给正在作答的模型；空着才是停止
  if (conversationRunning()) return composerHasContent() ? sendSupplement() : stopGeneration();
  if (crewRunning() && !composerHasContent()) return stopGeneration();
  // 另一个页面正在这段对话里作答：这边只跟着看，写完再说（话留在输入框里）
  if (runningElsewhere()) return toast("此对话正在另一页面作答，稍后再发");
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
  const text = input.value.trim();
  if (!text && !pendingAttachments.length && !pendingQuote) return;
  sendPreparing = true;
  renderSendButtons();
  let releaseAttachments = () => {};
  try {
    const profile = activeProfile();
    if (!profile) {
      toast("请先接入模型");
      return openSettings("models");
    }
    if (quotaBlocked(profile)) {
      if (currentConversation()) renderConversation();
      toast(quotaExhausted(profile) ? "余墨已尽，请调高上限或更换模型" : "余墨不足：进行中的对话已占去余量，请稍候或调高上限");
      return;
    }
    // 案上的东西在点发送这一刻就定下：下面要等工作目录立起来，这期间用户可能已换到别的对话，
    // 输入框、待发的附件与引文都换成了那一段的草稿，不能等完了再去读
    const sendingDraftKey = draftKey(),
      snapshot = composerSnapshot(input);
    releaseAttachments = holdAttachments(snapshot.attachments);
    let c = currentConversation(),
      fresh = false;
    if (c && !(await prepareTurn(c))) return;
    if (!c) {
      const pending = (store.settings.pendingWorkdir || "").trim() || pendingGroup()?.workdir || "";
      // 行：先把工作目录立起来，立不起来就不发
      if (pending && profile.tools === false) {
        toast("当前模型已关闭本机工具，请在模型高级配置中开启");
        return;
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
        presetId: presetOf(null)?.id || "",
        groupId: pendingGroup()?.id || "",
        commandPolicy: normalizeCommandPolicy(presetOf(null)?.policy || store.settings.commandPolicyDefault),
        reasoning: normalizeReasoning(profile.reasoning)
      };
      if (!(await ensureWorkReady(c))) return;
      fresh = true;
    }
    // 还在点发送的那个输入框前：照常收走案上的东西；已换走了：发的是当时那份，那份草稿里减去发出的、等待时接着写的留着，
    // 眼前这段的输入框不动，也不把人拉回来
    const stayed = draftKey() === sendingDraftKey;
    if (fresh) {
      delete store.settings.pendingGroupId;
      closeChipPop();
      store.conversations.unshift(c);
      if (stayed) currentId = c.id;
    }
    let user;
    if (stayed) user = takeComposer(input, sendingDraftKey, snapshot);
    else {
      user = composerMessage(snapshot);
      const rest = composerRest(normalizeDraft(store.drafts?.[sendingDraftKey]), snapshot);
      store.drafts ||= {};
      if (rest.text || rest.attachments.length || rest.quote) store.drafts[sendingDraftKey] = { ...rest, updatedAt: now() };
      else delete store.drafts[sendingDraftKey];
    }
    return startTurn(c, user, profile);
  } finally {
    releaseAttachments();
    sendPreparing = false;
    renderSendButtons();
  }
}
// 案上此刻的东西：话、附件、引文（换对话时 restoreDraft 会把附件、引文整个换成另一份，这里拿住的仍是这一份）
function composerSnapshot(input) {
  return { content: input.value.trim(), attachments: [...pendingAttachments], quote: pendingQuote };
}
/** @returns {Message} */
function composerMessage({ content, attachments, quote }) {
  return { id: uid(), role: "user", content, timestamp: now(), attachments, ...(quote ? { quote } : {}) };
}
// 案上（或已换走时存下的草稿）减去发出去的那份：等待开工的工夫里接着写的、又置入的留着。草稿里的附件、引文是副本，按 id、按文认
/** @param {Draft} draft */
function composerRest({ text, attachments, quote = null }, snapshot) {
  const typed = text.trim(),
    sent = new Set(snapshot.attachments.map(file => file.id));
  return {
    text: typed.startsWith(snapshot.content) ? typed.slice(snapshot.content.length).trim() : typed,
    attachments: attachments.filter(file => !sent.has(file.id)),
    quote: quote && quote.text === snapshot.quote?.text ? null : quote
  };
}
// 把案上的东西（话、附件、引文）收成一条用户消息，输入框与草稿随之清空。
// snapshot：点发送那一刻拍下的；等待开工的工夫里接着写的、又置入的不在其中，留在案上
/** @returns {Message} */
function takeComposer(input, key = draftKey(), snapshot = composerSnapshot(input)) {
  const user = composerMessage(snapshot),
    rest = composerRest({ text: input.value, attachments: pendingAttachments, quote: pendingQuote }, snapshot);
  input.value = rest.text;
  input.style.height = "auto";
  pendingAttachments = rest.attachments;
  pendingQuote = rest.quote;
  delete store.drafts[key];
  // 新对话在点发送后才有 id：留下的那点草稿记到它名下
  if (rest.text || pendingAttachments.length || pendingQuote)
    store.drafts[draftKey()] = {
      text: rest.text,
      attachments: pendingAttachments.map(file => ({ ...file })),
      quote: pendingQuote,
      updatedAt: now()
    };
  if (rest.text) grow(input);
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
async function startTurn(c, user, profile, { follow = true } = {}) {
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  c.messages.push(user, assistant);
  c.updatedAt = now();
  c.profileId = profile.id;
  saveStore();
  // 亲手发的问滚到底；回报唤起的、补言另起的不是这一刻发的，正往上翻着读的人不拽下去
  if (currentId === c.id) render(follow || followBottom);
  else renderHistory();
  // 头一问一发出就拟题，与作答并行：侧栏里立刻是个像样的名字，不用等一答写完；没拟成的，那一答收尾时再试
  if (c.messages.filter(m => m.role === "user").length === 1) void maybeAutoTitle(c, profile);
  await streamReply(c, assistant, profile);
}
// 补言：模型作答途中用户再寄来的话，是引导不是排队。先落在行迹里它到达的那一刻（一步「补言 · 待寄」）；模型正在写着，
// 就等它说到一个自然的落点（见 watchSteer：思考写完、句尾或段落尾、代码围栏闭合）把这一轮的流停下、已写的留着，随即连同补言
// 再请它开口——它读了这句接着写，可就此改道；正在拟工具调用或跑着工具时不停，等结果交回、模型再开口之前递上；
// 这一答若已在收尾、不再有下一回合，就在落笔后作为新的一问送出。引导是为了答得更好，默认不硬掐；
// 急时由用户点那一步上的折箭头，不等落点当场递上（sendSupplementNow）
// 断线后请模型接着写的那句话：手点「继续生成」与自动续写共用
const AUTO_RESUMES = 2;
// 一轮说完、下一轮起笔前隔一个空段；这一轮什么也没说（只调了工具）就不隔，免得正文攒下一串空行
function paragraphBreak(text) {
  return /\S/.test(text) && !text.endsWith("\n\n") ? `${text}\n\n` : text;
}
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
// 补言那一步上的折箭头：不等落点，当场停下这一轮递上，已写的正文与思绪都留着——留给特殊情况，平时仍等自然落点。
// 工具正跑着时本就没有这一轮可停，结果一交回就递
function sendSupplementNow() {
  const job = requestJob();
  if (!job?.queue?.some(item => item.user)) return;
  if (!job.reading || !job.round) return toast("工具执行完毕即递上");
  clearInterval(job.steerTimer);
  job.steerTimer = 0;
  job.round.abort();
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
// 回合边界：把收件口里排着的递给模型（历史里接在工具结果之后，或接在被掐断的半截话之后）——补言的那一步打勾；
// 帮手的回报原样作一条消息递上（它那一步在帮手做完时已收尾）；主模型递给帮手的话（note）同回报一样递，那一步打勾
async function deliverSupplements(job, history, budget, assistant, { steer = false } = {}) {
  const queue = job.queue || [];
  job.queue = [];
  for (const { user, step, report, note } of queue) {
    if (report !== undefined) {
      // 几份回报并作一问的：原文都在头一份上，其余几份只落行迹里那一步
      if (report) history.push({ role: "user", content: report });
      if (note) {
        note.status = "done";
        note.result = steer ? "已递 · 引路" : "已递";
      }
      continue;
    }
    history.push(await supplementForApi(user, budget, { latest: true, steer }));
    // 那一步挪到递上的地方：到达之后、递上之前写下的话（想着想着起笔的一句、拟调用前的一段）是模型读到补言之前写的，
    // 往后重装历史按 at 拆开这一答（见 replyParts），留在到达处，模型下一问看到的先后就与当时不同
    step.at = assistant.content.length;
    step.rat = String(assistant.reasoning || "").length;
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
  const queue = (job.queue || []).filter(item => item.user),
    reports = (job.queue || []).filter(item => item.report !== undefined);
  job.queue = [];
  // 回报在行迹里落的那一步还没递到：撤下，回报另起一答（那里有它自己的细线）
  const unsent = new Set(reports.map(item => item.note?.id).filter(Boolean));
  if (unsent.size) assistant.steps = (assistant.steps || []).filter(step => !unsent.has(step.id));
  for (const item of reports) delete item.note;
  // 收尾前才到、没来得及递的帮手回报：照没在作答时寄（见 mailReport）。补言若另起一问，回报就并进那一答——
  // 所以先排补言的那一问、后寄回报。用户按了停的，帮手一并停了，已到的回报也不再另起一答
  const mail = () => assistant.status !== "stopped" && reports.forEach(item => mailReport(conversation, item));
  if (!queue.length) return mail();
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
    setTimeout(() => void startTurn(conversation, user, profile, { follow: false }), 0);
    return mail();
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
  mail();
}
function titleFrom(text, attachments) {
  // 按码点截：截在 emoji 中间会留下半个字
  const chars = [...(text || `关于 ${attachments[0]?.name || "附件"}`).replace(/\s+/g, " ").trim()];
  return chars.slice(0, 28).join("") + (chars.length > 28 ? "…" : "");
}
// 停止：这一答连同这段对话后台的帮手一起停（帮手停了不回报，也就不再叫醒谁）
function stopGeneration(id = currentId) {
  stopCrew(id);
  const job = requestJob(id);
  if (!job) return renderSendButtons();
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
}
function stopAllGenerations() {
  for (const id of crews.keys()) stopCrew(id);
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
