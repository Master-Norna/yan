// 言 · 渲染 · 对话：一段对话与其中各条消息的画法、就地同步与收尾
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
let lastRenderedConvId = null,
  convergeTimer = null;
const nodeSig = new WeakMap();
let lastVizThemeKey = "";
function scrollSnapshot() {
  const host = $("#chatScroll");
  if (!host || !currentId || view !== "chat") return null;
  const hostTop = host.getBoundingClientRect().top,
    anchor = [...host.querySelectorAll("#messages [data-message]")].find(node => node.getBoundingClientRect().bottom > hostTop + 1);
  return {
    top: host.scrollTop,
    gap: Math.max(0, host.scrollHeight - host.scrollTop - host.clientHeight),
    follow: followBottom,
    anchorId: anchor?.dataset.message || "",
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - hostTop : 0
  };
}
function rememberScrollPosition() {
  const snapshot = scrollSnapshot();
  if (snapshot && currentId) scrollPositions.set(currentId, snapshot);
}
// follow：连同跟随与否一起恢复。下一帧补的那一回只校位置——这一帧里别处（翻版本、点出处）刚改过跟随，不能被旧快照改回去
function restoreScrollPosition(snapshot, { follow = true } = {}) {
  const host = $("#chatScroll");
  if (!host || !snapshot) return;
  if (follow) followBottom = !!snapshot.follow;
  const anchor = snapshot.anchorId ? host.querySelector(`[data-message="${CSS.escape(snapshot.anchorId)}"]`) : null;
  if (anchor) host.scrollTop += anchor.getBoundingClientRect().top - host.getBoundingClientRect().top - snapshot.anchorOffset;
  else host.scrollTop = Math.min(snapshot.top, Math.max(0, host.scrollHeight - host.clientHeight));
}
// 标题下的元信息行：日期、几问、旁注、目录签、存入卷宗；一答收尾后也刷一次（存入卷宗要等有完整的答才出现）
/** @param {Conversation} c */
function renderChatMeta(c) {
  $("#chatMeta").innerHTML =
    `${escapeHtml(formatDay(c.createdAt))} · ${escapeHtml(chineseNumber(c.messages.filter(m => m.role === "user" && !m.relay).length, true))}问${visibleThreads(c).length ? ` · <button class="chat-meta-notes" type="button" data-open-notes title="打开旁注">旁注 ${visibleThreads(c).length}</button>` : ""}${isWork(c) ? ` · <button type="button" class="chat-meta-path" data-workdir-bind title="工作目录">${escapeHtml(c.workdir || "")}</button>` : ` · <button type="button" class="chat-meta-bind" data-workdir-bind title="绑定工作目录，此后指令与改动落于其中">绑定目录</button>`}${c.messages.some(m => m.role === "assistant" && m.status === "complete") ? ` · <button type="button" class="chat-meta-bind" data-export-md title="以 Markdown 存入卷宗">存入卷宗</button>` : ""}`;
  renderRunningHead();
  requestAnimationFrame(syncRunningHead);
}
// 书眉：标题滚出视口后才显出题名与问数。字随 renderChatMeta 与改标题刷新（renderRunningHead），滚动时只切显隐（syncRunningHead）
function renderRunningHead() {
  const c = currentConversation(),
    head = $("#runningHead");
  if (c) {
    const notes = visibleThreads(c).length;
    head.querySelector(".running-head-title").textContent = c.title;
    head.querySelector(".running-head-meta").textContent =
      `${chineseNumber(c.messages.filter(m => m.role === "user" && !m.relay).length, true)}问${notes ? ` · 旁注 ${notes}` : ""}`;
  }
  syncRunningHead();
}
// 翻到一段摊开的行迹中间——它的题头已滚上去、身子还占着眼前——顶栏右侧、对话那一列的右缘处浮出一枚「收起行迹」：一点即收，停回题头处。
// 行迹一长，最上面那行题头就滚出屏外，要收得先翻回去找。左边的书眉照旧是题名，不跟着换（见 设计稿/12-改动条与行迹 三·甲）
function trailUnderHead() {
  const top = $("#chatScroll").getBoundingClientRect().top;
  for (const stack of document.querySelectorAll("#messages .assistant-block > details.tool-stack[open]")) {
    const summary = stack.querySelector(":scope > summary");
    if (summary && summary.getBoundingClientRect().bottom < top + 4 && stack.getBoundingClientRect().bottom > top + 90) return stack;
  }
  return null;
}
function syncRunningHead() {
  $("#runningHead").classList.toggle(
    "shown",
    !!currentConversation() && $("#chatTitle").getBoundingClientRect().bottom < $("#chatScroll").getBoundingClientRect().top + 4
  );
  const fold = $("#trailFold"),
    trail = currentConversation() ? trailUnderHead() : null;
  fold._trail = trail;
  fold.classList.toggle("shown", !!trail);
}
function renderConversation(shouldScroll = false) {
  const c = currentConversation();
  // 人在卷宗、分组页时（后台压缩收尾、关改问之类直接调到这里）：对话区藏着，量不出滚动位置，按「没有快照」走会把跟随置真；
  // 回到对话页时 render 会重画
  if (!c || view !== "chat") return;
  const snapshot = c.id === lastRenderedConvId ? scrollSnapshot() : scrollPositions.get(c.id);
  // 同一段对话原地重画（换主题、压缩收尾）时，正改着的标题不动
  if (c.id !== lastRenderedConvId || document.activeElement !== $("#chatTitle")) $("#chatTitle").textContent = c.title;
  renderChatMeta(c);
  renderWorkAuto();
  renderModelTriggers();
  const scrollHost = $("#chatScroll");
  scrollHost.classList.toggle(
    "generating",
    c.messages.some(message => message.status === "streaming")
  );
  // 切换对话时整列淡入（带轻微交错）；流式结束、主题切换等原地重绘则保持安静
  const converged = c.id !== lastRenderedConvId;
  lastRenderedConvId = c.id;
  scrollHost.classList.remove("converge");
  refreshNoteCounts(c);
  const { added } = syncMessages(c, converged);
  if (converged) {
    const articles = scrollHost.querySelectorAll("#messages .message");
    scrollHost.classList.add("converge");
    articles.forEach((el, i) => el.style.setProperty("--converge-delay", `${Math.min(i * 35, 240)}ms`));
    clearTimeout(convergeTimer);
    convergeTimer = setTimeout(() => scrollHost.classList.remove("converge"), 1000);
  }
  const dry = conversationDry(c);
  $("#chatInput").disabled = dry;
  $("#chatInput").placeholder = dry ? "余墨已尽，换个模型再续" : "续言于此";
  renderSendButtons();
  if (shouldScroll || !snapshot) {
    followBottom = true;
    requestAnimationFrame(scrollBottom);
  } else {
    restoreScrollPosition(snapshot);
    requestAnimationFrame(() => restoreScrollPosition(snapshot, { follow: false }));
  }
  // 主题、朱色或字体变了：留在原地的交互内容就地换色，不必重画整段
  const themeKey = vizThemeKey();
  if (themeKey !== lastVizThemeKey) {
    lastVizThemeKey = themeKey;
    rethemeHtmlApps($("#messages"));
  }
  for (const node of added) {
    void loadThumbnails(node);
    renderEnhancements(node);
    decorateNoteAnchors(node);
  }
  syncActiveAnchor();
  foldCompacted(c);
  renderOutline();
  updateContextGauge();
}
// 停在哪一页记在设置里：刷新后回到原处——正看着的那段对话、或卷宗；开机时由 boot 读回
function rememberPlace() {
  const s = store.settings,
    /** @type {{ view: "chat"|"library"|"groups", id: string }} */
    next = { view: view === "library" || view === "groups" ? view : "chat", id: view === "chat" ? currentId || "" : "" };
  if (s.lastView === next.view && (s.lastConversationId || "") === next.id) return;
  s.lastView = next.view;
  s.lastConversationId = next.id;
  saveStoreSoon();
}
function restorePlace() {
  const { lastView, lastConversationId } = store.settings;
  if (lastView === "library" || lastView === "groups") view = lastView;
  else if (lastConversationId && store.conversations.some(c => c.id === lastConversationId)) {
    currentId = lastConversationId;
    const c = currentConversation();
    c.unread = false;
  }
}
// 压缩过的前文在页面上折起（记录都在，只是不占地方）；最近一次压缩的分隔上有「展开前文 / 收起前文」
/** @param {Conversation} c */
function foldCompacted(c) {
  const host = $("#messages"),
    index = c.messages.map(m => (m.role === "context" && m.summary ? 1 : 0)).lastIndexOf(1);
  const before = new Set(index > 0 ? c.messages.slice(0, index).map(m => m.id) : []);
  for (const node of host.children) {
    const id = node.dataset.message;
    if (!id) continue;
    node.classList.toggle("compacted", before.has(id) && !c.showCompacted);
  }
  for (const button of host.querySelectorAll("[data-toggle-compacted]")) {
    const own = button.closest("[data-message]")?.dataset.message === c.messages[index]?.id;
    button.classList.toggle("hidden", !own || !before.size);
    button.textContent = c.showCompacted ? "收起前文" : "展开前文";
  }
}
// 消息列表按 id 增量同步：没变的节点原样留下（图表、沙箱、展开状态都不动），只插入、替换或移除有变化的那几条。
// 回复就地重画（见 07-paint.js，画法是幂等的，正在写的那条也一样画）；用户消息、分隔与提示签名一变整条换。
// 只有会改变呈现的字段才算变化；展开/收起这类界面状态用户已经在页面上操作过了，不必因此重画
const UI_STATE_FIELDS = new Set(["toolsOpen", "toolsTouched", "reasoningOpen", "reasoningTouched", "showCompacted"]);
/** @param {Message} message */
function messageSig(message, branch) {
  return `${branch ? `${branch.at}/${branch.total}|` : ""}${editingMessageId === message.id ? `e${editingDropped.size}|` : ""}${noteCounts.get(message.id) || 0}|${JSON.stringify(message, (key, value) => (UI_STATE_FIELDS.has(key) ? undefined : value))}`;
}
/** @param {Conversation} c */
function syncMessages(c, converged) {
  /** @type {Array<{ key: string, message?: Message, branch?: any, html?: string, side?: boolean }>} */
  const items = c.messages.map((message, index) => ({ key: message.id, message, branch: branchAt(c, index) }));
  if (compactingIds.has(c.id))
    items.push({
      key: "__compacting",
      html: `<div class="context-divider compacting" data-message="__compacting"><span>正在把前文压成摘要…</span></div>`
    });
  if (conversationDry(c))
    items.push({
      key: "__dry",
      html: `<div class="server-notice ended-notice" data-message="__dry"><span>此模型余墨已尽。更换模型或调高上限，即可在此续写。</span><button type="button" class="outline-btn" data-pick-model>更换模型</button></div>`
    });
  const result = syncNodes($("#messages"), items, converged);
  if (document.documentElement.classList.contains("work-mode") && !$("#messages").querySelector(".work-expanded")) closeExpandedWork();
  return result;
}
function syncNodes(host, items, converged) {
  const existing = new Map(),
    added = [],
    template = document.createElement("template");
  for (const node of host.children) if (node.dataset.message) existing.set(node.dataset.message, node);
  let cursor = host.firstElementChild;
  for (const item of items) {
    const node = existing.get(item.key);
    existing.delete(item.key);
    const sig = item.html ?? messageSig(item.message, item.branch),
      reply = item.message?.role === "assistant";
    let next = node;
    if (!node || (!reply && nodeSig.get(node) !== sig)) {
      template.innerHTML = item.html ?? (reply ? assistantShellHtml(item.message) : renderMessage(item.message, item.branch, item.side));
      next = template.content.firstElementChild;
      added.push(next);
      if (!node && !converged) next.classList.add("is-new");
    } else node.classList.remove("is-new");
    if (node && next !== node) {
      if (node === cursor) cursor = cursor.nextElementSibling;
      node.remove();
    }
    if (next === cursor) cursor = cursor.nextElementSibling;
    else host.insertBefore(next, cursor);
    // 先挂上再画：交互内容、开合动效都要在页上才量得准
    if (reply && (next !== node || item.message.status === "streaming" || nodeSig.get(next) !== sig))
      paintAssistant(next, item.message, { side: !!item.side, branch: item.branch });
    nodeSig.set(next, sig);
  }
  // 游标之后全是没被点到名的旧节点（删掉的消息、重生成时截掉的尾巴、旧的收尾提示）
  while (cursor) {
    const stale = cursor;
    cursor = cursor.nextElementSibling;
    stale.remove();
  }
  return { added };
}
function vizThemeKey() {
  return `${document.documentElement.dataset.theme}|${cssVar("--accent")}|${cssVar("--body")}`;
}
/** @param {Message} message */
function noteMarkHtml(message) {
  const count = noteCounts.get(message.id) || 0;
  return count
    ? `<button class="note-mark" type="button" data-note-mark title="查看这条消息的旁注">注${count > 1 ? ` ${count}` : ""}</button>`
    : "";
}
// 用户消息与上下文分隔的整条 HTML；回复另有画法（见 07-paint.js）
/** @param {Message} message */
// 帮手的回报（或后台指令结束）另起的一问：不是用户的话，画成一道细线——谁回来了，点名字开它的那一趟（后台指令则回到挂它的那一步）
/** @param {Message} message */
function relayHtml(message, branch = null) {
  const items = message.relay || [],
    names = items
      .map(item =>
        item.kind === "bg"
          ? `<button type="button" class="relay-name" data-relay-reveal="${escapeHtml(item.step)}" title="回到所在一步">后台 ${escapeHtml(item.title)} 已结束${item.ok ? "" : ` · 退出码 ${escapeHtml(String(item.exitCode ?? "?"))}`}</button>`
          : `<button type="button" class="relay-name" data-relay-step="${escapeHtml(item.step)}" title="查看经过">帮手「${escapeHtml(item.title)}」${item.ok ? "回报" : "未完成"}</button>`
      )
      .join(`<span class="relay-sep" aria-hidden="true">·</span>`),
    seal = items.every(item => item.kind === "bg") ? "候" : "遣";
  return `<article class="message relay" data-message="${escapeHtml(message.id)}"><div class="relay-line"><span class="seal sub-seal" aria-hidden="true">${seal}</span>${names}</div>${branch ? `<div class="message-actions has-branch">${branchNavHtml(branch)}</div>` : ""}</article>`;
}
function renderMessage(message, branch = null, side = false) {
  if (message.role === "context")
    return message.summary
      ? `<div class="context-divider has-summary" data-message="${escapeHtml(message.id)}"><details class="context-summary"><summary>前文已压成摘要 · ${escapeHtml(chineseNumber(message.compacted || 0, true))}条</summary><div class="context-summary-body">${renderMarkdown(message.summary)}</div></details><button type="button" class="context-toggle" data-toggle-compacted>展开前文</button></div>`
      : `<div class="context-divider" data-message="${escapeHtml(message.id)}"><span>上下文由此重新开始</span></div>`;
  if (message.role === "user" && message.relay) return relayHtml(message, branch);
  if (message.role === "user") {
    if (editingMessageId === message.id) {
      // 改问时附件也摆出来，可以去掉（如模型吃不下的图）；旁注里的改问不动附件，不摆
      const kept = side
        ? []
        : (message.attachments || []).filter(file => file.id && !quoteImageOf(file, message.quote) && !editingDropped.has(file.id));
      return `<article class="message user" data-message="${escapeHtml(message.id)}">${kept.length ? `<div class="sent-attachments">${kept.map(file => attachmentCard(file, null, false, true)).join("")}</div>` : ""}<div class="message-editor"><textarea class="message-edit-input">${escapeHtml(message.content)}</textarea><div class="edit-actions"><button class="message-action" data-action="cancel-edit">取消</button><button class="message-action edit-save" data-action="save-edit">保存并重答</button></div></div></article>`;
    }
    // 随引文的画面画在引文里（字在上、图在下，随问句靠右），不在件条里再列一回
    const listed = (message.attachments || []).filter(file => !quoteImageOf(file, message.quote)),
      shot = message.quote?.image && message.attachments?.some(file => quoteImageOf(file, message.quote));
    const files = listed.length
      ? `<div class="sent-attachments">${listed.map(file => attachmentCard(file, null, true)).join("")}</div>`
      : "";
    const quote = message.quote?.text
      ? `<div class="user-quote${shot ? " has-shot" : ""}" data-quote-source="${escapeHtml(message.quote.messageId || "")}"${message.quote.url ? ` data-quote-url="${escapeHtml(message.quote.url)}"` : ""} title="回到出处">${shot ? `<span class="user-quote-text">${escapeHtml(message.quote.text)}</span>${quoteShotHtml(message.quote.image, message.quote.text)}` : escapeHtml(message.quote.text)}</div>`
      : "";
    return `<article class="message user" data-message="${escapeHtml(message.id)}">${side ? "" : noteMarkHtml(message)}${files}${quote}${message.content ? `<div class="user-bubble">${escapeHtml(message.content)}</div>` : ""}<div class="message-actions${branch ? " has-branch" : ""}">${branchNavHtml(branch)}${actionIcon("copy", "复制消息")}${actionIcon("edit", "编辑消息")}</div></article>`;
  }
  return assistantShellHtml(message);
}
// 正文开头带 <think>…</think> 的旧消息（导入或此前的版本）：渲染时按思考 + 正文拆开看，不改动存下的原文
const INLINE_THINK = /^\s*<think>([\s\S]*?)<\/think>\s*/;
function inlineThinkView(message) {
  const match =
    message.status !== "streaming" && !message.reasoning && typeof message.content === "string"
      ? message.content.match(INLINE_THINK)
      : null;
  return match ? { ...message, reasoning: match[1].trim(), content: message.content.slice(match[0].length) } : message;
}
/** @param {Message} message */
function splitInlineThink(message) {
  const view = inlineThinkView(message);
  if (view !== message) {
    message.reasoning = view.reasoning;
    message.content = view.content;
  }
}
/** @param {Message} message */
function assistantNoteHtml(message) {
  return message.status === "error"
    ? `<div class="message-error">${escapeHtml(message.error || "请求失败")}</div>`
    : message.status === "interrupted"
      ? `<div class="resume-note">${message.error ? `${escapeHtml(message.error.replace(/[。.\s]+$/, ""))}。` : "连接中断，"}已生成的内容均已保留，可由此续写。</div>`
      : "";
}
/** @param {Message} message */
function assistantActionsHtml(message) {
  return message.status === "streaming"
    ? ""
    : message.status === "error"
      ? actionIcon("retry", "重试")
      : message.status === "interrupted"
        ? `${message.content ? actionIcon("copy", "复制已生成内容") : ""}${actionIcon("resume", "继续生成")}${actionIcon("retry", "从头重试")}`
        : `${actionIcon("copy", "复制回复")}${message.status === "stopped" && (message.content || message.steps?.length) ? actionIcon("resume", "继续生成") : ""}${actionIcon("regenerate", "重新生成")}${actionIcon("note", "旁注")}${messageCostHtml(message)}`;
}
// 这一答耗了多少墨：各轮请求的用量之和（含帮手），接口报了用量就用实数，没报则按字数估；当前上下文有多大另看右下角
/** @param {Message} message */
function messageCostHtml(message) {
  const n = Number(message.tokenCount) || 0;
  if (!n) return "";
  const heavy = n >= CONTEXT_HEAVY,
    prompt = Number(message.usage?.prompt_tokens) || 0,
    cached = Number(message.usage?.cached_tokens) || 0,
    hit = prompt && cached ? `；提示里 ${Math.round((cached / prompt) * 100)}% 读自缓存` : "";
  return `<span class="message-cost${heavy ? " heavy" : ""}" title="这一答共耗约 ${formatTokens(n)} token${message.tokenEstimated ? "（估算）" : ""}${hit}${heavy ? "；上下文已重，可压缩前文" : ""}">耗墨 ${message.tokenEstimated ? "≈ " : ""}${formatTokens(n)}</span>`;
}
// 一答收尾：就地画成定稿的样子（图表、沙箱、展开状态和滚动位置都原样保留，收笔时不再闪一下）；这条不在页上就整段重画
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
function finalizeAssistant(conversation, assistant) {
  const article = document.querySelector(`#messages [data-message="${CSS.escape(assistant.id)}"]`);
  if (!article) return renderConversation(followBottom);
  paintAssistant(/** @type {HTMLElement} */ (article), assistant);
  nodeSig.set(article, messageSig(assistant, branchFor(assistant)));
  $("#chatScroll").classList.remove("generating");
  renderHelperBar();
  if (followBottom) requestAnimationFrame(scrollBottom);
}
