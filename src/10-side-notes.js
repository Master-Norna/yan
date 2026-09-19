// 言 · 旁注：锚点、面板、侧线请求
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 旁注：附在正文某条消息某一处的旁支小对话。它读得到正文（到所注消息为止），正文永远读不到它 ----------
let sideThreadId = null; // 面板里正打开的旁注（内存态，刷新后收起，旁注本身仍在）
let sideIndexFor = null; // 目录页是从哪条消息打开的：目录里「另起一条」落在它上面
const noteCounts = new Map(); // messageId → 旁注数；参与消息签名，数量变了那条才重画
/** @param {Conversation} c */
function threadsOf(c) {
  return c?.threads || [];
}
// 旁注跟着它所注的那一问一答走：换到另一条分支，注在被换下去的那几条上的旁注便不在眼前（仍在册，换回来就回来）
/** @param {Conversation} c */
function visibleThreads(c) {
  const live = new Set((c?.messages || []).map(m => m.id));
  return threadsOf(c).filter(t => live.has(t.anchor?.messageId));
}
function currentThread() {
  return visibleThreads(currentConversation()).find(t => t.id === sideThreadId) || null;
}
/** @param {Conversation} c */
function refreshNoteCounts(c) {
  noteCounts.clear();
  for (const t of threadsOf(c)) if (t.anchor?.messageId) noteCounts.set(t.anchor.messageId, (noteCounts.get(t.anchor.messageId) || 0) + 1);
}
// 锚点只认消息 id：编辑与重答不会删掉旧消息，只会把它移进另一版本，所以旁注永远找得到它所注的那条
/**
 * @param {Conversation} c
 * @param {Thread} thread
 */
function anchorState(c, thread) {
  const id = thread.anchor?.messageId;
  return { live: c.messages.some(m => m.id === id), any: allMessages(c).some(m => m.id === id) };
}
/** @param {Thread} thread */
function sideJob(thread) {
  return thread ? requestJobs.get(`side:${thread.id}`) || null : null;
}
// 起一条旁注：划了一段就注在那一段上；没划（text 为空）就是就整条回复而谈——同一条回复上可以有几条
function createThread(anchor) {
  const c = currentConversation();
  if (!c || !anchor?.messageId) return;
  const whole = !String(anchor.text || "").trim();
  const thread = {
    id: uid(),
    anchor: {
      messageId: anchor.messageId,
      text: whole ? "" : String(anchor.text).slice(0, 1200),
      occurrence: whole ? 0 : Number(anchor.occurrence) || 0
    },
    createdAt: now(),
    updatedAt: now(),
    messages: []
  };
  (c.threads ||= []).push(thread);
  saveStore();
  renderConversation(false);
  openSidePanel(thread.id);
}
function openSidePanel(threadId) {
  sideThreadId = threadId;
  sideFollow = true;
  bindSideScroll();
  showNow($("#sidePanel"));
  renderSidePanel();
  syncActiveAnchor();
  setTimeout(() => $("#sideInput")?.focus(), 0);
}
// 目录页：这段对话里的旁注都列在这里，点哪条开哪条；从一条回复的「旁注」进来的，还能就那条回复另起一条
function openSideIndex(messageId = null) {
  sideThreadId = null;
  sideIndexFor = messageId;
  showNow($("#sidePanel"));
  renderSidePanel();
  syncActiveAnchor();
}
function sidePanelOpen() {
  const panel = $("#sidePanel");
  return !!panel && !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
function closeSidePanel() {
  sideThreadId = null;
  sideIndexFor = null;
  syncActiveAnchor();
  const panel = $("#sidePanel");
  if (panel && !panel.classList.contains("hidden")) hideWithFade(panel);
}
function syncActiveAnchor() {
  for (const mark of document.querySelectorAll("#messages mark.note-anchor, #messages sup.note-ref"))
    mark.classList.toggle("active", mark.dataset.thread === sideThreadId);
}
// 所注段落在正文里的落点：把锚文本在这条消息渲染后的文字里找出来包成 <mark>，点它即打开那条旁注。按文字节点逐段包，跨行内元素也能落上
// 每次都从干净的正文重新落：先拆掉上一回包的 mark 与小标，再逐条旁注去找——重画过的段落（时间线里重画的话、就地换过的图表）不会留下漏标，
// 两条旁注划的段落有重叠也各自落得上（里面那条嵌在外面那条的 mark 里）
function decorateNoteAnchors(article) {
  const c = currentConversation();
  if (!c || !article?.dataset?.message || article.dataset.status === "streaming") return;
  const bodies = [...article.querySelectorAll(".markdown, .user-bubble")].filter(
    body => !body.closest(".message-editor") && !body.parentElement?.closest(".markdown")
  );
  for (const body of bodies) clearNoteAnchors(body);
  const threads = threadsOf(c).filter(t => t.anchor.messageId === article.dataset.message && t.anchor.text);
  if (!threads.length || !bodies.length) return; // 整条回复的旁注没有落点，靠元信息行的「注」标进入
  // 正文可能不止一段（执事时间线里边做边说的话各在自己的分组里，末尾才是总结）：哪段里找得到就落在哪段
  threads.forEach((thread, index) => bodies.some(body => markAnchor(body, thread, index + 1)));
}
function clearNoteAnchors(body) {
  if (!body.querySelector("mark.note-anchor, sup.note-ref")) return;
  body.querySelectorAll("sup.note-ref").forEach(node => node.remove());
  body.querySelectorAll("mark.note-anchor").forEach(mark => mark.replaceWith(...mark.childNodes));
  body.normalize();
}
function textNodesIn(root) {
  const nodes = [],
    walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node =>
        node.parentElement?.closest(".viz, .html-app, .math-pending, sup.note-ref") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}
// 第 n 次出现的位置（n 从 0 起）；不够 n 次就退到第一次，一次也没有才是 -1
function nthIndexOf(haystack, needle, n) {
  if (!needle) return -1;
  let at = haystack.indexOf(needle);
  for (let i = 0; i < n && at >= 0; i++) {
    const next = haystack.indexOf(needle, at + 1);
    if (next < 0) break;
    at = next;
  }
  return at;
}
/** @param {Thread} thread */
function markAnchor(body, thread, ordinal) {
  const nodes = textNodesIn(body);
  if (!nodes.length) return false;
  const starts = [];
  let joined = "";
  for (const node of nodes) {
    starts.push(joined.length);
    joined += node.data;
  }
  // 同样的词在这条回复里出现不止一次时，按记下的「第几次」落；这一版里没那么多次了（改过、另一版本）就退到第一处
  const needle = thread.anchor.text,
    occurrence = Number(thread.anchor.occurrence) || 0;
  let from = nthIndexOf(joined, needle, occurrence),
    to = from + needle.length;
  if (from < 0) {
    // 划选得到的文字与渲染文字在空白上多半不一致（换行、缩进；跨段划选时段与段之间有换行、而文字节点连起来没有）：
    // 两边把空白全去掉再找，再把位置映射回原文
    const map = [];
    let folded = "";
    for (let i = 0; i < joined.length; i++) {
      if (/\s/.test(joined[i])) continue;
      folded += joined[i];
      map.push(i);
    }
    const target = needle.replace(/\s+/g, ""),
      at = nthIndexOf(folded, target, occurrence);
    if (at < 0 || !target) return false;
    from = map[at];
    to = map[at + target.length - 1] + 1;
  }
  // 从后往前包：splitText 只影响后面的节点，前面的偏移保持有效；句末（最后一段）缀一枚小标，像脚注号
  let tagged = false;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i],
      nodeStart = starts[i],
      nodeEnd = nodeStart + node.data.length;
    const s = Math.max(from, nodeStart),
      e = Math.min(to, nodeEnd);
    if (s >= e) continue;
    let target = node;
    if (s > nodeStart) target = node.splitText(s - nodeStart);
    if (e < nodeEnd) target.splitText(e - s);
    const mark = document.createElement("mark");
    mark.className = "note-anchor";
    mark.dataset.thread = thread.id;
    mark.title = "打开这条旁注";
    target.replaceWith(mark);
    mark.append(target);
    if (!tagged) {
      const ref = document.createElement("sup");
      ref.className = "note-ref";
      ref.dataset.thread = thread.id;
      ref.textContent = String(ordinal);
      ref.title = "打开这条旁注";
      mark.after(ref);
      tagged = true;
    }
  }
  return tagged;
}
function renderSidePanel() {
  const c = currentConversation(),
    thread = currentThread();
  if (!c) return closeSidePanel();
  if (!thread) return renderSideIndex(c);
  $("#sidePanel").dataset.mode = "thread";
  const list = visibleThreads(c),
    at = list.indexOf(thread) + 1;
  $("#sideNav").innerHTML =
    list.length > 1
      ? `<button class="message-action" type="button" data-side-nav="-1" title="上一条旁注" ${at <= 1 ? "disabled" : ""}>‹</button><span>${at}/${list.length}</span><button class="message-action" type="button" data-side-nav="1" title="下一条旁注" ${at >= list.length ? "disabled" : ""}>›</button>`
      : "";
  // 所注的一段列在顶上，点它回到出处；就整条回复起的旁注没有范围可言，不列
  const { live, any } = anchorState(c, thread),
    anchorEl = $("#sideAnchor");
  anchorEl.textContent = thread.anchor.text;
  anchorEl.classList.toggle("hidden", !thread.anchor.text);
  anchorEl.classList.toggle("lost", !live);
  anchorEl.disabled = !live;
  anchorEl.title = live ? "回到出处" : any ? "所注段落在另一版本中" : "所注段落已不在此对话中";
  const host = $("#sideMessages");
  if (!thread.messages.length) host.innerHTML = `<div class="side-empty" data-message="__empty">就此处追问<br>所答不入正文</div>`;
  else {
    const { added } = syncNodes(
      host,
      thread.messages.map(m => ({ key: m.id, message: m, branch: null, side: true })),
      false
    );
    for (const node of added) renderEnhancements(node);
  }
  renderSideSend();
  // 生成中用户往上翻了就不再拉回底部；换了旁注、发出新一问时照旧到底
  const scroller = $("#sideScroll");
  if (sideFollow) scroller.scrollTop = scroller.scrollHeight;
}
// 目录：按所注消息在对话里的先后排，同一条消息上的按起注时间排；每条列所注的一段（整条回复的列第一问），
// 下面一行是落在第几答、几问几答、最近一次动笔
/** @param {Conversation} c */
function renderSideIndex(c) {
  $("#sidePanel").dataset.mode = "index";
  $("#sideNav").innerHTML = "";
  $("#sideAnchor").classList.add("hidden");
  const order = new Map(c.messages.map((m, i) => [m.id, i])),
    list = [...visibleThreads(c)].sort(
      (a, b) => order.get(a.anchor.messageId) - order.get(b.anchor.messageId) || String(a.createdAt).localeCompare(String(b.createdAt))
    );
  const where = thread => {
    const index = order.get(thread.anchor.messageId),
      message = c.messages[index],
      nth = c.messages.slice(0, index + 1).filter(m => m.role === message.role).length;
    return `第${chineseNumber(nth)}${message.role === "user" ? "问" : "答"}`;
  };
  const items = list
    .map((thread, i) => {
      const asked = thread.messages.filter(m => m.role === "user").length,
        lead = thread.anchor.text || thread.messages.find(m => m.role === "user")?.content || "尚未落笔",
        running = !!sideJob(thread);
      return `<button type="button" class="side-index-item${thread.anchor.messageId === sideIndexFor ? " here" : ""}" data-side-open="${escapeHtml(thread.id)}"><span class="side-index-num">${i + 1}</span><span class="side-index-copy"><strong>${escapeHtml(lead)}</strong><small>${escapeHtml(where(thread))} · ${asked ? `${escapeHtml(chineseNumber(asked, true))}问` : "未问"}${running ? " · 作答中" : ""} · ${escapeHtml(formatDay(thread.updatedAt || thread.createdAt))}</small></span></button>`;
    })
    .join("");
  // 「＋」另起一条：正文里划着一段就注在那一段上；没划就是就整条回复而谈（从哪条回复进来的就是哪条，否则是最末一答）
  $("#sideMessages").innerHTML =
    `<div class="side-index" data-message="__index"><button type="button" class="side-index-new" data-side-new title="划选正文中的一段即注在那一段上；未划选则就整条回复而谈"><span>＋</span>另起一条</button>${
      items || `<div class="side-empty">还没有旁注<br>划选正文中的一段，或按上面的「＋」</div>`
    }</div>`;
  renderSideSend();
}
// 目录页「＋」落在哪条消息上：划着正文就是那一段；否则是打开目录时的那条回复，再不然是最末一答
/** @param {Conversation} c */
function indexNewAnchor(c) {
  const picked = selectionAnchor();
  if (picked) return { messageId: picked.messageId, text: picked.text, occurrence: picked.occurrence };
  const id =
    (sideIndexFor && c.messages.some(m => m.id === sideIndexFor) ? sideIndexFor : null) ||
    [...c.messages].reverse().find(m => m.role === "assistant" && m.status !== "streaming")?.id ||
    [...c.messages].reverse().find(m => m.role !== "context")?.id;
  return id ? { messageId: id, text: "" } : null;
}
// 旁注面板的跟随：贴着底部时随生成往下走，往上翻就停，翻回底部再跟——与正文那侧一个规矩
let sideFollow = true;
function bindSideScroll() {
  const el = $("#sideScroll");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  el.addEventListener(
    "wheel",
    e => {
      if (e.deltaY < 0) sideFollow = false;
    },
    { passive: true }
  );
  el.addEventListener("scroll", () => {
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap < 8) sideFollow = true;
    else if (gap > FOLLOW_THRESHOLD) sideFollow = false;
  });
}
function renderSideSend() {
  const running = !!sideJob(currentThread()),
    button = $("#sideSend");
  if (!button) return;
  sealGlyph(button, running);
  button.title = running ? "停止" : "发送";
  button.classList.toggle("stop-btn", running);
  button.classList.toggle("empty", !running && !$("#sideInput")?.value.trim());
}
function setupSidePanel() {
  $("#sideClose").onclick = closeSidePanel;
  $("#sideExpand").onclick = () => {
    const panel = $("#sidePanel"),
      wide = !panel.classList.contains("wide");
    panel.classList.toggle("wide", wide);
    const b = $("#sideExpand");
    b.textContent = wide ? "窄" : "阔";
    b.title = wide ? "收窄面板" : "放宽面板";
    b.setAttribute("aria-pressed", String(wide));
  };
  $("#chatMeta").addEventListener("click", e => {
    if (!e.target.closest("[data-open-notes]")) return;
    if (visibleThreads(currentConversation()).length) openSideIndex();
  });
  $("#sideIndexBtn").onclick = () => openSideIndex(currentThread()?.anchor.messageId || null);
  // 按「＋」前不让这一下把正文里的划选清掉，落点才认得出来
  $("#sideMessages").addEventListener("pointerdown", e => {
    if (e.target.closest("[data-side-new]")) e.preventDefault();
  });
  $("#sideMessages").addEventListener("click", e => {
    const open = e.target.closest("[data-side-open]");
    if (open) return openSidePanel(open.dataset.sideOpen);
    if (!e.target.closest("[data-side-new]")) return;
    const c = currentConversation(),
      anchor = c && indexNewAnchor(c);
    if (!anchor) return toast("这段对话里还没有可注的回复");
    getSelection()?.removeAllRanges();
    createThread(anchor);
  });
  $("#sideSend").onclick = () => void sendSide();
  const input = $("#sideInput");
  input.addEventListener("input", () => {
    grow(input);
    renderSideSend();
  });
  input.addEventListener("keydown", e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendSide();
    }
  });
  $("#sideNav").addEventListener("click", e => {
    const button = e.target.closest("[data-side-nav]");
    if (!button) return;
    const list = visibleThreads(currentConversation()),
      index = list.findIndex(t => t.id === sideThreadId) + Number(button.dataset.sideNav);
    if (list[index]) openSidePanel(list[index].id);
  });
  $("#sideAnchor").onclick = () => {
    const thread = currentThread();
    if (!thread) return;
    const source = document.querySelector(`#messages [data-message="${CSS.escape(thread.anchor.messageId)}"]`);
    if (!source) return toast("所注段落不在当前版本中");
    followBottom = false;
    scrollChatTo(source, "center");
    source.classList.remove("flash");
    void source.offsetWidth;
    source.classList.add("flash");
  };
  $("#sideRemove").onclick = async () => {
    const c = currentConversation(),
      thread = currentThread();
    if (!c || !thread) return;
    if (
      thread.messages.length &&
      !(await askConfirm({ title: "移除这条旁注？", body: "旁注里的问答将一并移除，正文不受影响。", ok: "移除" }))
    )
      return;
    const job = sideJob(thread);
    if (job) {
      job.controller.abort();
      requestJobs.delete(`side:${thread.id}`);
    }
    c.threads = threadsOf(c).filter(t => t !== thread);
    saveStore();
    renderConversation(false);
    if (visibleThreads(c).length) openSideIndex(thread.anchor.messageId);
    else closeSidePanel();
  };
  $("#sideMessages").addEventListener("click", async e => {
    const button = e.target.closest("[data-action]");
    if (!button) return;
    const c = currentConversation(),
      thread = currentThread(),
      id = button.closest("[data-message]")?.dataset.message,
      index = thread ? thread.messages.findIndex(m => m.id === id) : -1,
      message = index >= 0 ? thread.messages[index] : null;
    if (!c || !thread || !message) return;
    const action = button.dataset.action;
    if (action === "copy") {
      await copyText(message.content);
      return toast("已复制");
    }
    if (sideJob(thread)) return toast("生成中，稍后再改");
    if (action === "cancel-edit") {
      editingMessageId = null;
      return renderSidePanel();
    }
    if (action === "edit") {
      editingMessageId = message.id;
      renderSidePanel();
      requestAnimationFrame(() => {
        const input = document.querySelector(`#sideMessages [data-message="${CSS.escape(message.id)}"] .message-edit-input`);
        growEditor(input);
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
      return;
    }
    if (action === "save-edit") {
      const text = button.closest("[data-message]").querySelector(".message-edit-input").value.trim();
      editingMessageId = null;
      if (!text) return renderSidePanel();
      message.content = text;
      message.timestamp = now();
      return askSideAgain(c, thread, index + 1);
    }
    // 重新生成：换掉这一答（及其后的往来），就上一问再答一次
    if (action === "regenerate") {
      const question = thread.messages.slice(0, index).findLastIndex(m => m.role === "user");
      if (question < 0) return;
      return askSideAgain(c, thread, question + 1);
    }
  });
  $("#messages").addEventListener("click", e => {
    const anchor = e.target.closest("mark.note-anchor, sup.note-ref");
    if (anchor) {
      if (getSelection()?.isCollapsed !== false) {
        e.preventDefault();
        openSidePanel(anchor.dataset.thread);
      }
      return;
    }
    const pick = e.target.closest("[data-pick-model]");
    if (pick) {
      e.preventDefault();
      e.stopPropagation();
      $("#chatInput")?.closest(".composer")?.querySelector(".model-trigger")?.click();
      return;
    }
    const local = e.target.closest("[data-open-memory], [data-open-talk]");
    if (local) {
      e.preventDefault();
      if (local.dataset.openTalk) {
        if (store.conversations.some(c => c.id === local.dataset.openTalk)) openConversation(local.dataset.openTalk);
        else toast("这段对话已不在");
      } else openSettings("memory");
      return;
    }
    const mark = e.target.closest("[data-note-mark]");
    if (!mark) return;
    e.preventDefault();
    e.stopPropagation();
    const id = mark.closest("[data-message]")?.dataset.message,
      list = threadsOf(currentConversation()).filter(t => t.anchor.messageId === id);
    if (!list.length) return;
    if (list.length === 1) openSidePanel(list[0].id);
    else openSideIndex(id); // 同一条消息上有几条旁注时，到目录里挑
  });
}
async function sendSide() {
  const c = currentConversation(),
    thread = currentThread();
  if (!c || !thread) return;
  const job = sideJob(thread);
  if (job) {
    requestJobs.delete(`side:${thread.id}`);
    job.controller.abort();
    return;
  }
  const input = $("#sideInput"),
    text = input.value.trim();
  if (!text) return;
  const profile = activeProfile();
  if (!profile) {
    toast("请先接入模型");
    return openSettings("models");
  }
  if (parseTokenLimit(profile.quota) === null) {
    toast("请先为该模型设置用量上限");
    return openSettings("models");
  }
  if (quotaBlocked(profile))
    return toast(quotaExhausted(profile) ? "余墨已尽，请调高上限或更换模型" : "余墨不足：进行中的对话已占去余量，请稍候");
  /** @type {Message} */
  const user = { id: uid(), role: "user", content: text, timestamp: now() };
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  thread.messages.push(user, assistant);
  thread.updatedAt = now();
  input.value = "";
  grow(input);
  saveStore();
  sideFollow = true;
  renderSidePanel();
  await streamSideReply(c, thread, assistant, profile);
}
// 就旁注里的某一问再答：截掉从 from 起的往来（那一问之后的），另起一答。编辑后重问与重新生成都走这里
/**
 * @param {Conversation} c
 * @param {Thread} thread
 */
async function askSideAgain(c, thread, from) {
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (parseTokenLimit(profile.quota) === null) return toast("请先为该模型设置用量上限");
  if (quotaBlocked(profile)) return toast(quotaExhausted(profile) ? "余墨已尽，请调高上限或更换模型" : "余墨不足，请稍候");
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  thread.messages = [...thread.messages.slice(0, from), assistant];
  thread.updatedAt = now();
  saveStore();
  sideFollow = true;
  renderSidePanel();
  await streamSideReply(c, thread, assistant, profile);
}
// 旁注的上下文：正文到所注消息为止（尊重此前的压缩）+ 一句说明 + 这条旁注自己的往来。只带查阅类工具；正文的请求从不读 threads
/**
 * @param {Conversation} conversation
 * @param {Thread} thread
 * @param {Message} assistant
 * @param {Profile} profile
 */
async function streamSideReply(conversation, thread, assistant, profile) {
  const key = `side:${thread.id}`,
    job = { controller: new AbortController(), assistantId: assistant.id, threadId: thread.id, conversationId: conversation.id };
  requestJobs.set(key, job);
  renderSideSend();
  // 旁注是折起注脚式的行迹，不是执事的时间线（正文那侧的画法记在消息上，见 streamReply）
  assistant.work = false;
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  /** @type {Array<Record<string, any>>} */
  let history = [];
  let opened = false,
    usageKnown = false;
  try {
    const anchorIndex = conversation.messages.findIndex(m => m.id === thread.anchor.messageId);
    const main = anchorIndex >= 0 ? conversation.messages.slice(0, anchorIndex + 1) : conversation.messages;
    const contextIndex = main.map(m => m.role).lastIndexOf("context");
    const source = main
      .slice(contextIndex + 1)
      .filter(m => m.status !== "error" && m.status !== "streaming" && ["user", "assistant"].includes(m.role));
    history = summaryMessages(contextIndex >= 0 ? main[contextIndex] : null);
    history.push(...(await historyForApi(source, null)));
    const own = thread.messages.filter(m => m.id !== assistant.id && m.status !== "error" && (m.role === "user" || m.content));
    own.forEach((m, index) =>
      history.push({
        role: m.role,
        content:
          m.role === "user" && index === 0 && thread.anchor.text ? quotedText({ ...m, quote: { text: thread.anchor.text } }) : m.content
      })
    );
    // 旁注带只查不改的工具（检索、翻网页、翻文档、翻记忆）：模型说「我去查一下」就真能查，不会说完就断在那里；
    // 没有工具可用时（模型关了本机工具、没桥接）在提示里说明，免得它许诺去查
    const tools = profile.tools !== false ? toolDefinitions(conversation, { lookup: true }) : null;
    const systemPrompt = `${assistantHint(profile, tools, conversation)}\n\n${prompt(thread.anchor.text ? "side.passage" : "side.whole")}${tools ? "" : `\n${prompt("side.noTools")}`}`;
    const overrides = { systemPrompt, tools, enableSearch: false, reasoning: conversation.reasoning || "" };
    const onFrame = () => {
      if (sideThreadId !== thread.id || !sideFollow) return;
      const el = $("#sideScroll");
      if (el) el.scrollTop = el.scrollHeight;
    };
    const toolCache = new Map();
    let rounds = 0;
    for (;;) {
      assistant.toolCalls = null;
      assistant.usage = null;
      const roundStart = assistant.content.length;
      await readReply(profile, history, job.controller.signal, overrides, assistant, false, () => (opened = true), onFrame);
      if (assistant.usage) {
        usageKnown = true;
        for (const key of Object.keys(usage)) usage[key] += Number(assistant.usage[key] || 0);
      }
      const calls = (assistant.toolCalls || []).filter(call => call.name);
      if (!calls.length || !overrides.tools) break;
      if (++rounds > toolRoundLimit()) {
        const said = assistant.content.slice(roundStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push({ role: "user", content: "工具调用轮次已达上限，请不要再调用工具，直接根据已有结果作答。" });
        overrides.tools = null;
        if (assistant.content) assistant.content += "\n\n";
        continue;
      }
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
      history.push({
        role: "assistant",
        content: assistant.content.slice(roundStart) || null,
        tool_calls: steps.map(step => ({ id: step.id, type: "function", function: { name: step.name, arguments: step.arguments } }))
      });
      const outcomes = await runSteps(steps, conversation, assistant, job.controller.signal, toolCache);
      for (const step of steps) history.push({ role: "tool", tool_call_id: step.id, content: outcomes.get(step.id) ?? "" });
      if (assistant.content) assistant.content += "\n\n";
    }
    const leadTrim = assistant.content.match(/^\n*/)[0].length;
    assistant.content = assistant.content.replace(/^\n+|\n+$/g, "");
    if (leadTrim) for (const step of assistant.steps || []) if (typeof step.at === "number") step.at = Math.max(0, step.at - leadTrim);
    if (!assistant.content) throw Error(assistant.steps?.length ? "模型查阅后未返回正文" : "模型未返回正文");
    assistant.status = "complete";
    thread.updatedAt = now();
  } catch (error) {
    settleSteps(assistant, error.name === "AbortError" ? "已停止" : "已中断");
    if (error.name === "AbortError") assistant.status = "stopped";
    else {
      assistant.status = "error";
      assistant.error = friendlyError(error.message);
    }
  } finally {
    // 停止或中断也结算：接口接下了请求就花了墨；查阅了几轮的，各轮用量相加
    assistant.usage = usageKnown ? usage : null;
    accountUsage(profile, assistant, history, conversation, { opened });
    if (requestJobs.get(key) === job) requestJobs.delete(key);
    saveStore();
    if (sideThreadId === thread.id && currentId === conversation.id) renderSidePanel();
    else renderSideSend();
  }
}
