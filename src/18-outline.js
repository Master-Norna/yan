// 言 · 读的时候：右下角的上下文计数（点开可压缩）、右侧的问题导航条
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统

// ---------- 上下文计数：下一问会送出多少（估算），随输入、流式生成实时变；作答中改显本答这一轮的请求 ----------
// 与真正发送时的拼法同源（系统提示 + 工具定义 + 上次撮要以来的往来 + 行迹摘要 + 草稿 + 案上待发的附件与引文
// + 这一问之后附的目录记忆与意），附件按入库时记下的字数估。
// 作答中每轮先估这一轮送出的请求，接口有报提示用量再校正。一答之内撮要压掉往来，下一问的估算看不出来，本答的请求才看得出来。
/** @param {Conversation} c */
function contextEstimate(c, draft = "", pending = null, profile = activeProfile(c)) {
  if (!c) return 0;
  const budget = inlineTextBudget(profile);
  let n = 0;
  if (profile) {
    const tools = profile.tools !== false ? toolDefinitions(c, { profile }) : null;
    n += estimateText(systemPrompt(c, tools));
    if (tools) n += estimateText(JSON.stringify(tools));
  }
  const contextIndex = lastContextIndex(c.messages),
    marker = contextIndex >= 0 ? c.messages[contextIndex] : null;
  if (marker?.summary) n += 12 + estimateText(marker.summary);
  const source = c.messages.slice(contextIndex + 1).filter(m => m.status !== "error" && ["user", "assistant"].includes(m.role)),
    // 案上有待发的东西时，下一问就是它；历史里最后一问不再是「最新一问」，它的附件只按摘要算
    lastUser = pending ? null : source.findLast(m => m.role === "user"),
    // 用户发的图只留最新的一批（见 keptImageQuestion）
    pictured = keptImageQuestion(source, lastUser?.id);
  const filesOf = (files, latest, images = latest) => {
    let sum = 0;
    for (const file of files || [])
      sum +=
        file.kind === "image"
          ? images
            ? 1000
            : 20
          : file.kind === "text" || file.extracted
            ? attachmentTokens(file, latest, budget)
            : latest
              ? 2000
              : 20;
    return sum;
  };
  for (const m of source) {
    n += 4 + estimateText(String(m.content || "")) + (m.quote?.text ? estimateText(m.quote.text) : 0);
    if (m.role === "assistant") {
      n += estimateText(stepsDigest(m));
      // 途中递进来、往后插回这一答的话（见 answerParts）：按那一步记下的原话估，不必真去装（补言会去取附件原件）
      for (const step of m.steps || [])
        if (step.status === "done" && TOOLS.get(step.name)?.replay) n += 4 + estimateText(String(step.report ?? step.note ?? ""));
    }
    n += filesOf(m.attachments, m === lastUser, m === lastUser || m.id === pictured);
  }
  if (pending)
    n +=
      4 +
      estimateText(pending.text || "") +
      (pending.quote?.text ? estimateText(pending.quote.text) : 0) +
      filesOf(pending.attachments, true);
  else if (draft) n += 4 + estimateText(draft);
  // 这一问之后还附上目录记忆与意（见 20-stream.js 的 buildHead）：与前文无关、每一问都带，不数它们，
  // 右下角的读数与自动压缩的门槛都比真正送出去的少一截，压前文那次也就压晚一拍
  const ledger = ledgerNoteText(c, "main", profile);
  if (ledger) n += estimateText(ledger.text);
  n += estimateText(intentNote(c));
  return Math.round(n);
}
let gaugeTimer = null;
// 作答中每轮发送前先按装好的请求估算，随后有实测才校正（见 30-rounds.js）；撮要后的回落也不必等接口报数。
// 一答之内撮要压掉较早的往来后，这个数会明显回落。空闲时仍估下一问——被撮掉的工具往来本就不随下一问重装，
// 那个估算撮要前后不动（见 60-context.js 的 foldByModel），撮要有没有用只有看本答的请求才看得出
function updateContextGauge() {
  const gauge = $("#contextGauge");
  if (!gauge) return;
  const c = currentConversation();
  if (!c || view !== "chat") return gauge.classList.add("hidden");
  const draft = $("#chatInput").value,
    job = requestJob(c.id),
    // 作答中沿用开工时的模型窗口；空闲时才按眼前所选的模型估下一问。
    profile = job?.profile || activeProfile(c),
    live = Number(job?.promptTokens) || 0,
    n =
      live ||
      contextEstimate(
        c,
        draft,
        draft || pendingAttachments.length || pendingQuote ? { text: draft, attachments: pendingAttachments, quote: pendingQuote } : null,
        profile
      ),
    window = Number(profile?.contextWindow) || 0,
    heavy = window ? n >= window * 0.75 : n >= CONTEXT_HEAVY,
    share = window ? t`，占此模型窗口 ${formatTokens(window)} 的 ${Math.round((n / window) * 100)}%` : "",
    tail = heavy ? t("\n上下文已重，可撮要前文") : t("\n撮要前文");
  gauge.classList.remove("hidden");
  gauge.classList.toggle("heavy", heavy);
  gauge.classList.toggle("has-window", !!window);
  gauge.style.setProperty("--ratio", window ? `${Math.min(100, Math.round((n / window) * 100))}%` : "0%");
  rollText(gauge.querySelector(".context-gauge-value"), formatTokens(n));
  gauge.querySelector(".context-gauge-window").textContent = window ? `/ ${formatTokens(window)}` : "";
  gauge.title = live
    ? t`本答这一轮送出约 ${formatTokens(n)} token${share}（含系统提示、工具定义、历史与本答的往来）${window ? t("；过七成半自动撮要") : t("；放不下时自动撮要")}${tail}`
    : t`下一问约送出 ${formatTokens(n)} token${share}（估算，含系统提示、工具定义与上次撮要以来的往来）${window ? t("；过七成半自动撮要") : t("；放不下时自动撮要")}${tail}`;
}
function scheduleContextGauge(delay = 160) {
  clearTimeout(gaugeTimer);
  gaugeTimer = setTimeout(updateContextGauge, delay);
}
// 点右下角的计数：问一句就压，压缩期间计数处显示「压缩中」
async function openContextMenu(anchor) {
  const c = currentConversation();
  if (!c || anchor.dataset.busy) return;
  const source = compactable(c),
    turns = source.filter(m => m.role === "user").length;
  if (turns < 2) return toast(conversationRunning(c.id) || runningElsewhere(c.id) ? t("作答中，稍后再撮") : t("对话还短，不必撮要"));
  const ok = await askConfirm({
    title: t("撮要前文？"),
    body: t`此前的 ${turns} 问 ${source.length - turns} 答会由模型撮要成一份（目标、事实、决定、改过的文件、待办），此后每一问只带这份撮要与其后的消息。页面上的记录都还在，只是折起来。`,
    ok: t("撮要")
  });
  if (!ok) return;
  anchor.dataset.busy = "1";
  anchor.querySelector(".context-gauge-label").textContent = t("撮要中");
  try {
    await compactContext(c);
  } finally {
    delete anchor.dataset.busy;
    anchor.querySelector(".context-gauge-label").textContent = t("上下文");
    updateContextGauge();
  }
}

// ---------- 右侧的问题导航条：一问一格，点一下回到那一问；随滚动标出当前所在 ----------
let outlineRaf = 0,
  outlineLockUntil = 0;
/** @param {Message} message */
function outlineLabel(message) {
  const text = String(message.content || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || (message.attachments?.length ? t`附件 ${message.attachments[0].name}` : message.quote?.text ? t("就引文追问") : "…");
}
function renderOutline() {
  const rail = $("#outline");
  if (!rail) return;
  // 压缩过的前文在页上折着，导航条上也不列它们的问；「展开前文」后再列出来
  const c = currentConversation(),
    foldAt = c && !c.showCompacted ? lastContextIndex(c.messages, { withSummary: true }) : -1,
    users = c && view === "chat" ? c.messages.slice(foldAt + 1).filter(m => m.role === "user" && !m.relay) : [];
  if (users.length < 2) {
    rail.classList.add("hidden");
    rail.innerHTML = "";
    return;
  }
  rail.classList.remove("hidden");
  rail.classList.toggle("dense", users.length > 18);
  rail.innerHTML = users
    .map(
      (m, i) =>
        `<button type="button" class="outline-item" data-target="${escapeHtml(m.id)}" title="${t`第 ${i + 1} 问 · ${escapeHtml(outlineLabel(m).slice(0, 80))}`}"><span class="outline-label"><span>${escapeHtml(outlineLabel(m).slice(0, 16))}</span></span><span class="outline-tick" aria-hidden="true"></span></button>`
    )
    .join("");
  syncOutline();
}
function syncOutline() {
  cancelAnimationFrame(outlineRaf);
  outlineRaf = requestAnimationFrame(() => {
    const rail = $("#outline"),
      host = $("#chatScroll");
    if (!rail || rail.classList.contains("hidden") || Date.now() < outlineLockUntil) return;
    const items = rail.querySelectorAll(".outline-item"),
      height = host.clientHeight;
    // 滚到了底便是最后一问：末一轮短问短答时，它的顶未必越得过阅读线
    let current = items[items.length - 1];
    if (host.scrollHeight - host.scrollTop - height >= 8) {
      // 当帧扫一次消息节点，不逐问查 DOM，也不跨帧留着可能被换掉的节点。重号仍取 DOM 里的第一项。
      const articles = new Map();
      for (const article of host.querySelectorAll("#messages [data-message]")) {
        const id = article.getAttribute("data-message");
        if (!articles.has(id)) articles.set(id, article);
      }
      const line = host.getBoundingClientRect().top + Math.min(120, height * 0.25);
      current = items[0];
      // 取导航顺序里最后一个越过阅读线的问；倒着找，命中就停。
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i],
          article = articles.get(item.dataset.target);
        if (article && article.getBoundingClientRect().top <= line) {
          current = item;
          break;
        }
      }
    }
    rail.querySelectorAll(".outline-item.active").forEach(item => item !== current && item.classList.remove("active"));
    current?.classList.add("active");
  });
}
function jumpToOutline(id) {
  const article = document.querySelector(`#messages [data-message="${CSS.escape(id)}"]`);
  if (!article) return;
  // 点了哪一问就标哪一问，平滑滚动的途中不让滚动事件把它改掉
  const rail = $("#outline");
  rail?.querySelectorAll(".outline-item.active").forEach(item => item.classList.remove("active"));
  rail?.querySelector(`.outline-item[data-target="${CSS.escape(id)}"]`)?.classList.add("active");
  outlineLockUntil = Date.now() + 900;
  scrollChatTo(article, "start");
  article.classList.remove("flash");
  void article.offsetWidth;
  article.classList.add("flash");
}

// 压缩过的前文展开与折起；右侧的问题导航；右下角的上下文计数
function bindOutlineEvents() {
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-toggle-compacted]");
    if (!button) return;
    const c = currentConversation();
    if (!c) return;
    c.showCompacted = !c.showCompacted;
    foldCompacted(c);
    renderOutline();
    if (!c.showCompacted) scrollChatTo(button.closest(".context-divider"), "center");
  });
  $("#outline").addEventListener("click", event => {
    const item = event.target.closest(".outline-item");
    if (item) jumpToOutline(item.dataset.target);
  });
  $("#contextGauge").addEventListener("click", event => {
    event.stopPropagation();
    openContextMenu(event.currentTarget);
  });
  $("#chatInput").addEventListener("input", () => scheduleContextGauge());
}
