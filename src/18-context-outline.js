// 言 · 上下文：右下角的实时计数、压缩前文为摘要；右侧的问题导航条
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统

// ---------- 上下文计数：下一问会送出多少（估算），随输入、流式生成实时变 ----------
// 与真正发送时的拼法同源（系统提示 + 工具定义 + 上次压缩以来的历史 + 行迹摘要 + 草稿 + 案上待发的附件与引文），附件按入库时记下的字数估
/** @param {Conversation} c */
function contextEstimate(c, draft = "", pending = null) {
  if (!c) return 0;
  const profile = activeProfile(),
    budget = inlineTextBudget(profile);
  let n = 0;
  if (profile) {
    const tools = profile.tools !== false ? toolDefinitions(c) : null;
    n += estimateText(assistantHint(profile, tools, c));
    if (tools) n += estimateText(JSON.stringify(tools));
  }
  const contextIndex = c.messages.map(m => m.role).lastIndexOf("context"),
    marker = contextIndex >= 0 ? c.messages[contextIndex] : null;
  if (marker?.summary) n += 12 + estimateText(marker.summary);
  const source = c.messages.slice(contextIndex + 1).filter(m => m.status !== "error" && ["user", "assistant"].includes(m.role)),
    // 案上有待发的东西时，下一问就是它；历史里最后一问不再是「最新一问」，它的附件只按摘要算
    lastUser = pending ? null : source.filter(m => m.role === "user").at(-1);
  const filesOf = (files, latest) => {
    let sum = 0;
    for (const file of files || [])
      sum +=
        file.kind === "image"
          ? latest
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
    if (m.role === "assistant") n += estimateText(stepsDigest(m));
    n += filesOf(m.attachments, m === lastUser);
  }
  if (pending)
    n +=
      4 +
      estimateText(pending.text || "") +
      (pending.quote?.text ? estimateText(pending.quote.text) : 0) +
      filesOf(pending.attachments, true);
  else if (draft) n += 4 + estimateText(draft);
  return Math.round(n);
}
let gaugeTimer = null;
function updateContextGauge() {
  const gauge = $("#contextGauge");
  if (!gauge) return;
  const c = currentConversation();
  if (!c || view !== "chat") return gauge.classList.add("hidden");
  const draft = $("#chatInput").value,
    n = contextEstimate(
      c,
      draft,
      draft || pendingAttachments.length || pendingQuote ? { text: draft, attachments: pendingAttachments, quote: pendingQuote } : null
    ),
    limit = Number(store.settings.compactAt) || 0,
    window = Number(activeProfile()?.contextWindow) || 0,
    heavy = window ? n >= window * 0.75 : n >= CONTEXT_HEAVY;
  gauge.classList.remove("hidden");
  gauge.classList.toggle("heavy", heavy);
  gauge.classList.toggle("has-window", !!window);
  gauge.style.setProperty("--ratio", window ? `${Math.min(100, Math.round((n / window) * 100))}%` : "0%");
  rollText(gauge.querySelector(".context-gauge-value"), formatTokens(n));
  gauge.querySelector(".context-gauge-window").textContent = window ? `/ ${formatTokens(window)}` : "";
  gauge.title = `下一问约送出 ${formatTokens(n)} token${window ? `，占此模型窗口 ${formatTokens(window)} 的 ${Math.round((n / window) * 100)}%` : ""}（估算，含系统提示、工具定义与上次压缩以来的历史）${limit ? `；超过 ${formatTokens(limit)} 自动压成摘要` : ""}${heavy ? "\n上下文已重，可压缩前文" : "\n压缩前文"}`;
}
function scheduleContextGauge(delay = 160) {
  clearTimeout(gaugeTimer);
  gaugeTimer = setTimeout(updateContextGauge, delay);
}
// ---------- 压缩：把上次压缩以来的往来压成一份摘要，记在新的分隔上；此后的请求只带摘要与之后的消息 ----------
// 分隔（role: "context"）带 summary 的是压缩；不带的是旧版「另起一纸」留下的硬切，仍照旧生效
// 正在压缩的对话：只在内存里记，页面上画一行「正在压缩」
const compactingIds = new Set();
/** @param {Conversation} c */
function compactable(c) {
  if (!c || conversationRunning(c.id) || c.ended) return [];
  const contextIndex = c.messages.map(m => m.role).lastIndexOf("context");
  return c.messages
    .slice(contextIndex + 1)
    .filter(m => m.status !== "error" && m.status !== "streaming" && ["user", "assistant"].includes(m.role));
}
/** @param {Conversation} c */
async function compactContext(c, { auto = false } = {}) {
  const source = compactable(c),
    profile = activeProfile();
  if (source.filter(m => m.role === "user").length < 2) {
    if (!auto) toast("对话还短，不必压缩");
    return false;
  }
  if (!profile || quotaExhausted(profile)) {
    if (!auto) toast("没有可用的模型");
    return false;
  }
  if (compactingIds.has(c.id)) {
    if (!auto) toast("正在压缩");
    return false;
  }
  const transcript = source
    .map(
      m =>
        `${m.role === "user" ? "用户" : "助手"}：${String(m.content || "").slice(0, 6000)}${m.role === "assistant" ? `\n${stepsDigest(m)}`.trimEnd() : ""}`
    )
    .join("\n\n");
  // 摘要先在外面生成，成了再一次性插进分隔（生成期间只有页面上一行「正在压缩」，不进消息、不落盘）：
  // 中途关页面不会留下半成品分隔把历史截掉；期间用户接着发的消息也不受影响——分隔插在被压缩的最后一条之后，之后的消息照旧在分隔之后
  const lastCompacted = source.at(-1);
  compactingIds.add(c.id);
  renderConversation();
  try {
    // 转写可能很长、模型可能先思考再写：超时给足五分钟；输出上限不另给，随平时的走。这段对话开了思考档位的，压缩时降到最低一档：摘要用不着深想
    const response = await requestChat(
      profile,
      [{ role: "user", content: prompt("assistant.compact", { transcript }) }],
      AbortSignal.timeout(300000),
      {
        temperature: 0.2,
        systemPrompt: "",
        reasoning: c.reasoning ? "low" : ""
      }
    );
    if (!response.ok) throw Error(await describeResponseError(response));
    /** @type {Message} */
    const temp = { id: `compact-${uid()}`, role: "assistant", content: "", timestamp: now() };
    if ((response.headers.get("content-type") || "").includes("text/event-stream")) await readSse(response, temp);
    else {
      const data = await response.json();
      temp.content = extractContent(data);
      temp.reasoning = normalizeContent(data?.choices?.[0]?.message?.reasoning_content ?? data?.choices?.[0]?.message?.reasoning);
    }
    const summary = String(temp.content || "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();
    if (!summary) throw Error(temp.reasoning ? "模型只写了思考、没写出摘要（输出被上限截断）" : "模型没有写出摘要");
    const at = c.messages.indexOf(lastCompacted);
    if (at < 0) throw Error("对话在压缩期间已改动");
    // 期间又压过一次（分隔已在这条之后）就作废，以后来的为准
    if (c.messages.slice(at + 1).some(m => m.role === "context")) throw Error("对话在压缩期间已改动");
    /** @type {Message} */
    const marker = { id: uid(), role: "context", content: "", timestamp: now(), summary, compacted: source.length };
    c.messages.splice(at + 1, 0, marker);
    c.updatedAt = now();
    saveStore();
    compactingIds.delete(c.id);
    renderConversation();
    toast(auto ? "上下文已重，前文已自动压成摘要" : "前文已压成摘要");
    return true;
  } catch (error) {
    compactingIds.delete(c.id);
    renderConversation();
    console.warn("压缩失败", error);
    const reason = error?.name === "TimeoutError" ? "模型五分钟内未写出摘要" : friendlyError(String(error?.message || error));
    toast(`压缩失败：${reason.slice(0, 80)}`);
    return false;
  } finally {
    compactingIds.delete(c.id);
  }
}
async function describeResponseError(response) {
  const data = await response.json().catch(() => ({}));
  const error = data.error;
  return (typeof error === "string" ? error : error?.message) || `请求失败（${response.status}）`;
}
// 分隔上的摘要进历史：一问一答的样子，各家接口都认
/** @returns {Array<Record<string, any>>} */
function summaryMessages(marker) {
  if (!marker?.summary) return [];
  return [
    { role: "user", content: `［前文摘要］此前的对话已压缩为以下摘要，请以此为准接着谈：\n\n${marker.summary}` },
    { role: "assistant", content: "已了解前文，请继续。" }
  ];
}
// 一答收尾后：估算超过设置的阈值就自动压缩（0 为关）
/** @param {Conversation} c */
function maybeAutoCompact(c) {
  const limit = Number(store.settings.compactAt) || 0;
  if (!limit || !c || c.ended) return;
  if (contextEstimate(c) < limit) return;
  void compactContext(c, { auto: true });
}
// 点右下角的计数：问一句就压，压缩期间计数处显示「压缩中」
async function openContextMenu(anchor) {
  const c = currentConversation();
  if (!c || anchor.dataset.busy) return;
  const source = compactable(c),
    turns = source.filter(m => m.role === "user").length;
  if (turns < 2) return toast(conversationRunning(c.id) ? "生成中，稍后再压" : "对话还短，不必压缩");
  const ok = await askConfirm({
    title: "把前文压成摘要？",
    body: `此前的 ${turns} 问 ${source.length - turns} 答会由模型压成一份摘要（目标、事实、决定、改过的文件、待办），此后每一问只带摘要与之后的消息。页面上的记录都还在，只是折起来。`,
    ok: "压缩"
  });
  if (!ok) return;
  anchor.dataset.busy = "1";
  anchor.querySelector(".context-gauge-label").textContent = "压缩中";
  try {
    await compactContext(c);
  } finally {
    delete anchor.dataset.busy;
    anchor.querySelector(".context-gauge-label").textContent = "上下文";
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
  return text || (message.attachments?.length ? `附件 ${message.attachments[0].name}` : message.quote?.text ? "就引文追问" : "…");
}
function renderOutline() {
  const rail = $("#outline");
  if (!rail) return;
  // 压缩过的前文在页上折着，导航条上也不列它们的问；「展开前文」后再列出来
  const c = currentConversation(),
    foldAt = c && !c.showCompacted ? c.messages.map(m => (m.role === "context" && m.summary ? 1 : 0)).lastIndexOf(1) : -1,
    users = c && view === "chat" ? c.messages.slice(foldAt + 1).filter(m => m.role === "user") : [];
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
        `<button type="button" class="outline-item" data-target="${escapeHtml(m.id)}" title="第 ${i + 1} 问 · ${escapeHtml(outlineLabel(m).slice(0, 80))}"><span class="outline-label">${escapeHtml(outlineLabel(m).slice(0, 16))}</span><span class="outline-tick" aria-hidden="true"></span></button>`
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
    // 「当前所在」取阅读线以上最近的一问：阅读线在视口上部，短问短答挤在一屏时也不会把下一问算成当前
    const line = host.getBoundingClientRect().top + Math.min(120, host.clientHeight * 0.25);
    let current = null;
    for (const item of rail.querySelectorAll(".outline-item")) {
      const article = host.querySelector(`#messages [data-message="${CSS.escape(item.dataset.target)}"]`);
      if (article && article.getBoundingClientRect().top <= line) current = item;
    }
    if (!current) current = rail.querySelector(".outline-item");
    rail.querySelectorAll(".outline-item.active").forEach(item => item !== current && item.classList.remove("active"));
    current?.classList.add("active");
  });
}
function jumpToOutline(id) {
  const article = document.querySelector(`#messages [data-message="${CSS.escape(id)}"]`);
  if (!article) return;
  followBottom = false;
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

// ---------- 对话存成 Markdown：桥接在线时落到卷宗，否则下载 ----------
/** @param {Conversation} c */
function conversationMarkdown(c) {
  const lines = [`# ${c.title}`, "", `${formatDay(c.createdAt)}${isWork(c) ? ` · 工作目录 ${c.workdir}` : ""}`, ""];
  for (const m of c.messages) {
    if (m.role === "context") {
      lines.push(
        "---",
        "",
        m.summary ? `> **前文摘要**\n>\n> ${String(m.summary).replace(/\n/g, "\n> ")}` : "*（上下文由此重新开始）*",
        ""
      );
      continue;
    }
    if (m.role === "user") {
      lines.push("## 问", "");
      if (m.quote?.text)
        lines.push(
          ...String(m.quote.text)
            .split(/\r?\n/)
            .map(line => `> ${line}`),
          ""
        );
      if (m.attachments?.length) lines.push(`*附件：${m.attachments.map(f => f.name).join("、")}*`, "");
      lines.push(String(m.content || ""), "");
    } else if (m.role === "assistant" && m.status !== "error") {
      lines.push(`## 答${m.modelName ? ` · ${m.modelName}` : ""}`, "");
      const trail = stepsDigest(m);
      if (trail) lines.push(`*${trail}*`, "");
      lines.push(String(m.content || ""), "");
      if (m.deliverables?.length) lines.push(`*成品：${m.deliverables.map(f => f.name).join("、")}*`, "");
    }
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
/** @param {Conversation} c */
async function exportConversationMarkdown(c) {
  if (!c) return;
  const name = `${String(c.title || "对话")
      .replace(/[\\/:*?"<>|]/g, " ")
      .trim()
      .slice(0, 60)}.md`,
    text = conversationMarkdown(c);
  if (archiveOnline()) {
    try {
      const saved = await putArchiveFile(name, dataUrlFromText(text, "text/markdown"));
      void refreshArchive();
      toast(`已存入卷宗：${saved.name}`);
    } catch (error) {
      toast(`存入失败：${String(error.message || error).slice(0, 80)}`);
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" })),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
