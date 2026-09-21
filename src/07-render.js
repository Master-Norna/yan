// 言 · 整体渲染：顶栏、模型菜单、历史、对话与消息
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function render(shouldScroll = false) {
  rememberPlace();
  const c = currentConversation(),
    library = view === "library";
  // 人在卷宗页时这段对话的一答写完了，记了「有新回复」；回到它眼前就算看过了，不必再点一次侧栏
  if (c && !library && c.unread) {
    c.unread = false;
    saveStoreSoon();
  }
  renderHeader();
  renderHistory();
  syncDocumentTitle();
  requestAnimationFrame(() => syncJumpBottom());
  $("#library").classList.toggle("hidden", !library);
  $("#welcome").classList.toggle("hidden", library || !!c);
  $("#chat").classList.toggle("hidden", library || !c);
  $("#chatScrollGrabber").classList.toggle("hidden", library || !c);
  $("#composerArea").classList.toggle("hidden", library || !c);
  $("#openLibrary").classList.toggle("active", library);
  if (library) renderLibrary();
  else if (c) renderConversation(shouldScroll);
  else renderOutline();
  restoreDraft();
  renderAttachments();
  renderSendButtons();
  renderApprovalBar();
  renderHelperBar();
  requestAnimationFrame(syncChatScrollGrabber);
}
function renderHeader() {
  renderModelTriggers();
  $("#welcomeMode").textContent = workMode() ? "执事" : "对谈";
  $("#displayNameSidebar").textContent = store.settings.name;
  $("#avatar").textContent = store.settings.name.trim().slice(0, 1) || "客";
  const dark = document.documentElement.dataset.theme === "dark",
    toggle = $("#themeToggle");
  toggle.dataset.theme = dark ? "dark" : "light";
  toggle.title = dark ? "天光 · 亮色" : "落墨 · 暗色";
  $("#greeting").textContent = greeting();
  renderModeSwitch();
  renderWelcome();
  renderQuota();
  renderModelMenu();
  renderLibraryCount();
  refreshConnection();
}
function renderQuota() {
  const p = activeProfile(),
    parsed = p ? parseTokenLimit(p.quota) : null,
    cap = parsed === null ? 0 : parsed,
    used = Math.max(0, Number(p?.usedTokens || 0));
  const remaining = cap ? Math.max(0, cap - used) : 0,
    ratio = p && parsed !== null ? (cap ? remaining / cap : 1) : 0,
    status = $("#quotaStatus");
  const percent = Math.min(100, Math.round(ratio * 100));
  $("#quotaFill").style.width = `${percent}%`;
  status.style.setProperty("--ink-level", `${percent}%`);
  $("#quotaText").textContent = !p ? "—" : parsed === null ? "未设" : formatTokens(remaining);
  status.classList.toggle("dry", cap > 0 && remaining === 0);
  status.classList.toggle("empty", !p || parsed === null);
  status.title = !p ? "尚未接入模型" : parsed === null ? "尚未设定用量上限" : `余墨 ${formatTokens(remaining)} · 上限 ${formatTokens(cap)}`;
  status.setAttribute("aria-label", status.title);
}
function renderModelTriggers() {
  const p = activeProfile(),
    c = currentConversation(),
    level = (c ? c.reasoning : store.settings.reasoning) || "";
  // 标签写实际会送出的那一档：模型不认所选的就落到最接近的；模型不认思考档位（探过是 none）就不写
  const used = level ? nearestReasoning(p, level) : "";
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.querySelector(".model-name").textContent = p?.name || "尚未接入模型";
    button.querySelector(".model-extra").textContent = used ? `· 思考 ${reasoningLabel(used)}` : "";
  });
}
function closeModelMenu() {
  const menu = $("#modelMenu");
  hideWithFade(menu);
  document.querySelectorAll(".model-trigger").forEach(button => button.setAttribute("aria-expanded", "false"));
}
function positionModelMenu(button) {
  const menu = $("#modelMenu");
  if (!button || menu.classList.contains("hidden")) return;
  menu.classList.remove("drop-up");
  menu.style.removeProperty("max-height");
  const rect = button.getBoundingClientRect(),
    gap = 9,
    edge = 12;
  const below = Math.max(0, innerHeight - rect.bottom - gap - edge),
    above = Math.max(0, rect.top - gap - edge);
  const dropUp = below < Math.min(menu.scrollHeight, 220) && above > below;
  menu.classList.toggle("drop-up", dropUp);
  menu.style.maxHeight = `${Math.max(96, Math.min(dropUp ? above : below, 420))}px`;
}
function renderModelMenu() {
  const all = profiles();
  $("#modelMenu").innerHTML = all.length
    ? all
        .map(p => {
          const active = p.id === store.settings.activeProfileId;
          // 只列显示名：模型原名与接口地址长短不一，行高参差；要看去模型设置
          return `<button class="model-option${active ? " active" : ""}" data-profile="${escapeHtml(p.id)}"${active ? ' aria-current="true"' : ""} title="${escapeHtml(p.model)}"><strong><span class="model-dot"></span><span class="model-option-name">${escapeHtml(p.name)}</span></strong></button>`;
        })
        .join("")
    : `<button class="model-option" id="configureFirst"><strong>接入模型</strong><small>任何 OpenAI 兼容接口</small></button>`;
  const c = currentConversation(),
    level = (c ? c.reasoning : store.settings.reasoning) || "",
    profile = activeProfile(),
    choices = reasoningChoices(profile),
    // 选过的档位这个模型不认（换了模型、或刚学到它的档位）：菜单上点亮它实际会落到的那一档
    shown = choices.includes(level) ? level : nearestReasoning(profile, level) || "";
  if (all.length)
    $("#modelMenu").insertAdjacentHTML(
      "beforeend",
      `<div class="menu-section"><div class="menu-section-title"><span>思考深度</span><span title="留空由接口决定；各模型所认的档位不同，可在模型高级配置中填写，接口拒绝时亦会自动记下">${c ? "本段对话" : "新对话默认"}</span></div>${choices.length > 1 ? `<div class="segmented">${choices.map(value => `<button type="button" data-reasoning="${value}" class="${value === shown ? "active" : ""}">${reasoningLabel(value)}</button>`).join("")}</div>` : `<div class="menu-section-note">此模型不认思考档位</div>`}</div><button class="model-option model-manage" data-manage>模型设置</button>`
    );
  $("#configureFirst")?.addEventListener("click", () => openSettings("models"));
  $("#modelMenu [data-manage]")?.addEventListener("click", e => {
    e.stopPropagation();
    closeModelMenu();
    openSettings("models");
  });
}
function renderHistory() {
  const query = historyQuery.trim().toLowerCase();
  const matches = c =>
    !query ||
    String(c.title).toLowerCase().includes(query) ||
    (c.messages || []).some(m => typeof m.content === "string" && m.content.toLowerCase().includes(query));
  const sorted = [...store.conversations].filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // 一条时间线：绑了目录的对话归在各自的「工」组里，组按组内最近动过的那条排（一条有动静，整组靠前），组内按时间；
  // 没绑目录的对话按自己的时间散在其间；置顶另列。组可收起，收起时只露出当前打开的那条；查找时不收
  const collapsed = new Set(store.settings.collapsedRepos || []),
    pinned = sorted.filter(c => c.pinned),
    repos = new Map(),
    nodes = [];
  for (const c of sorted) {
    if (c.pinned) continue;
    if (!isWork(c)) {
      nodes.push({ kind: "chat", at: c.updatedAt, c });
      continue;
    }
    let node = repos.get(c.workdir);
    if (!node) {
      node = { kind: "repo", dir: c.workdir, at: c.updatedAt, items: [] };
      repos.set(c.workdir, node);
      nodes.push(node);
    }
    node.items.push(c);
  }
  nodes.sort((a, b) => b.at.localeCompare(a.at));
  const buckets = new Map([["置顶", pinned.map(c => ({ kind: "chat", c }))]]);
  for (const label of ["今天", "过去七天", "更早"]) buckets.set(label, []);
  for (const node of nodes) buckets.get(dayBucket(node.at)).push(node);
  // 正改着名时侧栏也可能重画（别的对话拟好了题、后台一答收尾）：改到一半的字与光标得留住，不能被原标题冲掉
  const editing = $("#history .history-rename"),
    typed =
      editing && renamingId && editing.closest("[data-conversation]")?.dataset.conversation === renamingId
        ? { value: editing.value, start: editing.selectionStart, end: editing.selectionEnd }
        : null;
  const item = c => {
    if (renamingId === c.id)
      return `<div class="history-item active" data-conversation="${escapeHtml(c.id)}"><input class="history-rename" value="${escapeHtml(typed ? typed.value : c.title)}" maxlength="60" aria-label="重命名对话"></div>`;
    const job = requestJob(c.id),
      running = !!job,
      waiting = job?.label === "等待确认";
    const state = waiting
      ? `<span class="history-state waiting" title="有指令等待确认" aria-label="有指令等待确认">问</span>`
      : running
        ? `<span class="history-state running" title="后台生成中" aria-label="后台生成中"></span>`
        : c.unread
          ? `<span class="history-state unread" title="有新回复" aria-label="有新回复"></span>`
          : "";
    return `<div class="history-item ${c.id === currentId ? "active" : ""} ${running ? "is-running" : ""} ${c.unread ? "has-unread" : ""} ${isWork(c) ? "is-work" : ""}" data-conversation="${escapeHtml(c.id)}"><button class="history-open" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>${state}<span class="history-tools"><button class="history-tool history-more" data-history-action="menu" title="更多" aria-label="更多" aria-haspopup="menu">⋯</button></span></div>`;
  };
  const repoHtml = node => {
    const name = node.dir.split(/[\\/]/).filter(Boolean).pop() || node.dir || "未定目录",
      fold = collapsed.has(node.dir) && !query,
      shown = fold ? node.items.filter(c => c.id === currentId) : node.items,
      running = node.items.filter(c => c.id !== currentId && requestJob(c.id)).length;
    return `<div class="history-repo-group${fold ? " collapsed" : ""}" data-repo="${escapeHtml(node.dir)}"><div class="history-repo-head"><button type="button" class="history-repo" data-repo-toggle="${escapeHtml(node.dir)}" title="${escapeHtml(node.dir)}\n${fold ? "展开" : "收起"}" aria-expanded="${fold ? "false" : "true"}"><span class="repo-seal" aria-hidden="true">工</span><span class="history-repo-name">${escapeHtml(name)}</span><small>${node.items.length}${fold && running ? ` · ${running} 生成中` : ""}</small><span class="repo-caret" aria-hidden="true">›</span></button><button type="button" class="history-tool repo-new" data-history-workdir="${escapeHtml(node.dir)}" title="在此目录翻页">＋</button></div>${shown.length ? `<div class="history-repo-items">${shown.map(item).join("")}</div>` : ""}</div>`;
  };
  $("#history").innerHTML =
    [...buckets]
      .filter(([, items]) => items.length)
      .map(
        ([label, items]) =>
          `<div class="history-group"><div class="history-label">${label}</div>${items.map(node => (node.kind === "repo" ? repoHtml(node) : item(node.c))).join("")}</div>`
      )
      .join("") || `<div class="history-empty">${query ? "没有匹配的对话" : "尚无旧墨"}</div>`;
  const input = $("#history .history-rename");
  if (input) {
    input.focus();
    if (typed) input.setSelectionRange(typed.start, typed.end);
    else input.select();
  }
}
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
function restoreScrollPosition(snapshot) {
  const host = $("#chatScroll");
  if (!host || !snapshot) return;
  followBottom = !!snapshot.follow;
  const anchor = snapshot.anchorId ? host.querySelector(`[data-message="${CSS.escape(snapshot.anchorId)}"]`) : null;
  if (anchor) host.scrollTop += anchor.getBoundingClientRect().top - host.getBoundingClientRect().top - snapshot.anchorOffset;
  else host.scrollTop = Math.min(snapshot.top, Math.max(0, host.scrollHeight - host.clientHeight));
}
// 标题下的元信息行：日期、几问、旁注、目录签、存入卷宗；一答收尾后也刷一次（存入卷宗要等有完整的答才出现）
/** @param {Conversation} c */
function renderChatMeta(c) {
  $("#chatMeta").innerHTML =
    `${escapeHtml(formatDay(c.createdAt))} · ${escapeHtml(chineseNumber(c.messages.filter(m => m.role === "user").length, true))}问${visibleThreads(c).length ? ` · <button class="chat-meta-notes" type="button" data-open-notes title="打开旁注">旁注 ${visibleThreads(c).length}</button>` : ""}${isWork(c) ? ` · <button type="button" class="chat-meta-path" data-workdir-bind title="工作目录">${escapeHtml(c.workdir || "")}</button>` : c.ended ? "" : ` · <button type="button" class="chat-meta-bind" data-workdir-bind title="绑定工作目录，此后指令与改动落于其中">绑定目录</button>`}${c.messages.some(m => m.role === "assistant" && m.status === "complete") ? ` · <button type="button" class="chat-meta-bind" data-export-md title="${archiveOnline() ? "以 Markdown 存入卷宗" : "以 Markdown 下载"}">${archiveOnline() ? "存入卷宗" : "存为 Markdown"}</button>` : ""}`;
}
function renderConversation(shouldScroll = false) {
  const c = currentConversation();
  if (!c) return;
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
    requestAnimationFrame(() => restoreScrollPosition(snapshot));
  }
  // 主题、朱色或字体变了：留在原地的图表就地换色，不必重画整段
  const themeKey = vizThemeKey();
  if (themeKey !== lastVizThemeKey) {
    lastVizThemeKey = themeKey;
    rethemeViz($("#messages"));
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
    /** @type {{ view: "chat"|"library", id: string }} */
    next = { view: view === "library" ? "library" : "chat", id: view === "library" ? "" : currentId || "" };
  if (s.lastView === next.view && (s.lastConversationId || "") === next.id) return;
  s.lastView = next.view;
  s.lastConversationId = next.id;
  saveStoreSoon();
}
function restorePlace() {
  const { lastView, lastConversationId } = store.settings;
  if (lastView === "library") view = "library";
  else if (lastConversationId && store.conversations.some(c => c.id === lastConversationId)) {
    currentId = lastConversationId;
    const c = currentConversation();
    c.unread = false;
    if (c.profileId) selectProfile(c.profileId, false);
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
// 正在流式生成的那条由 readSse 就地更新，这里一律不碰。
// 只有会改变呈现的字段才算变化；展开/收起这类界面状态用户已经在页面上操作过了，不必因此重画
const UI_STATE_FIELDS = new Set(["toolsOpen", "toolsTouched", "reasoningOpen", "reasoningTouched", "showCompacted"]);
/** @param {Message} message */
function messageSig(message, branch) {
  return `${branch ? `${branch.at}/${branch.total}|` : ""}${editingMessageId === message.id ? "e|" : ""}${noteCounts.get(message.id) || 0}|${JSON.stringify(message, (key, value) => (UI_STATE_FIELDS.has(key) ? undefined : value))}`;
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
    let next = node;
    const streaming = node && item.message?.status === "streaming" && node.dataset.status === "streaming";
    if (!streaming) {
      const sig = item.html ?? messageSig(item.message, item.branch);
      if (!node || nodeSig.get(node) !== sig) {
        template.innerHTML = item.html ?? renderMessage(item.message, item.branch, item.side);
        next = template.content.firstElementChild;
        nodeSig.set(next, sig);
        added.push(next);
        if (!node && !converged) next.classList.add("is-new");
      } else node.classList.remove("is-new");
    }
    if (node && next !== node) {
      if (node === cursor) cursor = cursor.nextElementSibling;
      disposeChartsIn(node);
      node.remove();
    }
    if (next === cursor) cursor = cursor.nextElementSibling;
    else host.insertBefore(next, cursor);
  }
  // 游标之后全是没被点到名的旧节点（删掉的消息、重生成时截掉的尾巴、旧的收尾提示）
  while (cursor) {
    const stale = cursor;
    cursor = cursor.nextElementSibling;
    disposeChartsIn(stale);
    stale.remove();
  }
  return { added };
}
function vizThemeKey() {
  return `${document.documentElement.dataset.theme}|${cssVar("--accent")}|${cssVar("--body")}`;
}
function rethemeViz(root) {
  for (const chart of vizCharts) {
    const canvas = chart.getDom(),
      el = canvas?.closest('.viz[data-viz="echarts"]');
    if (!el || !root.contains(canvas)) continue;
    try {
      chart.setOption(themedEchartsOption(parseVizJson(el.querySelector(".viz-source")?.textContent || ""), canvas), true);
    } catch {}
  }
  const stale = [...root.querySelectorAll('.viz[data-viz="mermaid"][data-rendered].viz-ok')];
  if (stale.length) {
    for (const el of stale) delete el.dataset.rendered;
    void renderViz(stale);
  }
}
/** @param {Message} message */
function noteMarkHtml(message) {
  const count = noteCounts.get(message.id) || 0;
  return count
    ? `<button class="note-mark" type="button" data-note-mark title="查看这条消息的旁注">注${count > 1 ? ` ${count}` : ""}</button>`
    : "";
}
/** @param {Message} message */
function renderMessage(message, branch = null, side = false) {
  if (message.role === "context")
    return message.summary
      ? `<div class="context-divider has-summary" data-message="${escapeHtml(message.id)}"><details class="context-summary"><summary>前文已压成摘要 · ${escapeHtml(chineseNumber(message.compacted || 0, true))}条</summary><div class="context-summary-body">${renderMarkdown(message.summary)}</div></details><button type="button" class="context-toggle" data-toggle-compacted>展开前文</button></div>`
      : `<div class="context-divider" data-message="${escapeHtml(message.id)}"><span>上下文由此重新开始</span></div>`;
  if (message.role === "user") {
    if (editingMessageId === message.id)
      return `<article class="message user" data-message="${escapeHtml(message.id)}"><div class="message-editor"><textarea class="message-edit-input">${escapeHtml(message.content)}</textarea><div class="edit-actions"><button class="message-action" data-action="cancel-edit">取消</button><button class="message-action edit-save" data-action="save-edit">保存并重答</button></div></div></article>`;
    const files = message.attachments?.length
      ? `<div class="sent-attachments">${message.attachments.map(file => attachmentCard(file, null, true)).join("")}</div>`
      : "";
    const quote = message.quote?.text
      ? `<div class="user-quote" data-quote-source="${escapeHtml(message.quote.messageId || "")}" title="回到出处">${escapeHtml(message.quote.text)}</div>`
      : "";
    return `<article class="message user" data-message="${escapeHtml(message.id)}">${side ? "" : noteMarkHtml(message)}${files}${quote}${message.content ? `<div class="user-bubble">${escapeHtml(message.content)}</div>` : ""}<div class="message-actions${branch ? " has-branch" : ""}">${branchNavHtml(branch)}${actionIcon("copy", "复制消息", icons.copy)}${actionIcon("edit", "编辑消息", icons.edit)}</div></article>`;
  }
  // 旁注里的答：复制、重新生成（不分叉，直接换掉）；出错或停止了也能重来
  const actions = side
    ? message.status === "streaming"
      ? ""
      : `${message.content ? actionIcon("copy", "复制回复", icons.copy) : ""}${actionIcon("regenerate", message.status === "complete" ? "重新生成" : "重试", icons.regenerate)}`
    : assistantActionsHtml(message) + branchNavHtml(branch);
  message = inlineThinkView(message);
  return `<article class="message assistant" data-message="${escapeHtml(message.id)}" data-status="${escapeHtml(message.status || "complete")}"><div class="message-meta"><span class="meta-seal" aria-hidden="true">言</span><span>${escapeHtml(message.modelName || "模型")} · ${formatTime(message.timestamp)}</span>${side ? "" : noteMarkHtml(message)}</div><div class="assistant-block">${trailWork(message) ? stepsHtml(message) + reasoningHtml(message) : reasoningHtml(message) + stepsHtml(message)}${assistantMainHtml(message)}${deliverablesHtml(message)}${changeSummaryHtml(message)}${sourceCardsHtml(message)}</div>${actions ? `<div class="message-actions${branch ? " has-branch" : ""}">${actions}</div>` : ""}</article>`;
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
      ? `<div class="resume-note">连接中断，已生成的内容均已保留，可由此续写。</div>`
      : "";
}
/** @param {Message} message */
function assistantMainHtml(message) {
  const base = trailBase(message),
    text = base
      ? String(message.content || "")
          .slice(base)
          .trim()
      : message.content;
  if (!message.content && message.status === "streaming") return `<div class="thinking">正在凝神</div>`;
  if (!message.content && message.status === "stopped") return `<div class="thinking">搁笔于此</div>`;
  let rendered = "";
  if (text) {
    const previous = suppressViz;
    suppressViz = message.status === "streaming";
    try {
      rendered = renderMarkdown(text);
    } finally {
      suppressViz = previous;
    }
  }
  return `${text ? `<div class="markdown" data-cut="${base}" data-base="${base}">${rendered}</div>` : ""}${assistantNoteHtml(message)}`;
}
/** @param {Message} message */
function assistantActionsHtml(message) {
  return message.status === "streaming"
    ? ""
    : message.status === "error"
      ? actionIcon("retry", "重试", icons.retry)
      : message.status === "interrupted"
        ? `${message.content ? actionIcon("copy", "复制已生成内容", icons.copy) : ""}${actionIcon("resume", "继续生成", icons.resume)}${actionIcon("retry", "从头重试", icons.retry)}`
        : `${actionIcon("copy", "复制回复", icons.copy)}${actionIcon("regenerate", "重新生成", icons.regenerate)}${actionIcon("note", "旁注", icons.note)}${messageCostHtml(message)}`;
}
// 这一答耗了多少墨：各轮请求的用量之和（含帮手），接口报了用量就用实数，没报则按字数估；当前上下文有多大另看右下角
/** @param {Message} message */
function messageCostHtml(message) {
  const n = Number(message.tokenCount) || 0;
  if (!n) return "";
  const heavy = n >= CONTEXT_HEAVY;
  return `<span class="message-cost${heavy ? " heavy" : ""}" title="这一答共耗约 ${formatTokens(n)} token${message.tokenEstimated ? "（估算）" : ""}${heavy ? "；上下文已重，可压缩前文" : ""}">耗墨 ${message.tokenEstimated ? "≈ " : ""}${formatTokens(n)}</span>`;
}
// 流式结束只就地收尾这一条消息：不重建整段对话，图表、沙箱、展开状态和滚动位置都原样保留，收笔时不再闪一下
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
function finalizeAssistant(conversation, assistant, leadTrim = 0) {
  const article = document.querySelector(`#messages [data-message="${CSS.escape(assistant.id)}"]`),
    block = article?.querySelector(".assistant-block");
  if (!block || conversation.ended) return renderConversation(followBottom);
  // 步骤可能收尾时全撤了（只排着补言、没递出去就停了）：行迹整块撤掉
  if (assistant.steps?.length) refreshSteps(assistant);
  else block.querySelector(":scope > .tool-stack")?.remove();
  if (assistant.deliverables?.length && !block.querySelector(":scope > .deliver-bar"))
    (block.querySelector(":scope > .change-bar") || block.querySelector(":scope > .markdown") || block).insertAdjacentHTML(
      "afterend",
      deliverablesHtml(assistant)
    );
  block.querySelector(".thinking")?.remove();
  const reasoning = block.querySelector(":scope > .reasoning"),
    thought = String(assistant.reasoning || "").slice(trailReasoningBase(assistant));
  if (reasoning && thought.trim()) {
    reasoning.querySelector(".reasoning-body").textContent = thought;
    reasoning.dataset.state = "done";
  } else if (reasoning) reasoning.remove();
  else if (thought.trim()) {
    const stack = block.querySelector(":scope > .tool-stack");
    if (stack) stack.insertAdjacentHTML("afterend", reasoningHtml(assistant, thought));
    else block.insertAdjacentHTML("afterbegin", reasoningHtml(assistant, thought));
  }
  block.querySelectorAll(".message-error, .resume-note, .source-stack").forEach(node => node.remove());
  block.querySelector(".tool-stack.is-work .trail-group.trail-live")?.remove();
  block.querySelectorAll(".trail-drafting").forEach(node => node.remove());
  const markdown = block.querySelector(":scope > .markdown");
  if (!assistant.content) {
    markdown?.remove();
    block.insertAdjacentHTML("beforeend", assistantMainHtml(assistant));
  } else if (markdown?.querySelector(".md-tail")) {
    // 已渲染的稳定段保持不动，只把尾段按最终文本重绘一次——此时 mermaid / echarts / html 才真正成图
    const cut = Math.max(trailBase(assistant), Math.min(Number(markdown.dataset.cut || 0) - leadTrim, assistant.content.length)),
      tail = markdown.querySelector(".md-tail");
    markdown.dataset.cut = String(cut);
    tail.innerHTML = renderMarkdown(assistant.content.slice(cut));
    renderEnhancements(tail);
    block.insertAdjacentHTML("beforeend", assistantNoteHtml(assistant));
  } else {
    markdown?.remove();
    block.insertAdjacentHTML("beforeend", assistantMainHtml(assistant));
    renderEnhancements(block);
  }
  // 改动条生成中就已实时累加，这里只挪到收尾正文之后（原节点搬家，展开状态不丢）再对一次数；来源卡片压在最底
  const bar = block.querySelector(":scope > .change-bar");
  if (bar) {
    bar.classList.remove("is-new");
    block.append(bar);
  }
  syncChangeBar(block, assistant);
  block.insertAdjacentHTML("beforeend", sourceCardsHtml(assistant));
  block.querySelectorAll(".message-error, .resume-note, .source-stack").forEach(node => node.classList.add("is-new"));
  const branch = branchAt(conversation, conversation.messages.indexOf(assistant));
  article.querySelector(".message-actions")?.remove();
  const actions = assistantActionsHtml(assistant) + branchNavHtml(branch);
  if (actions) article.insertAdjacentHTML("beforeend", `<div class="message-actions${branch ? " has-branch" : ""}">${actions}</div>`);
  article.dataset.status = assistant.status;
  if (assistant.status === "complete") article.querySelector(".meta-seal")?.classList.add("stamped");
  nodeSig.set(article, messageSig(assistant, branch));
  decorateNoteAnchors(article);
  $("#chatScroll").classList.remove("generating");
  renderHelperBar();
  if (followBottom) requestAnimationFrame(scrollBottom);
}
