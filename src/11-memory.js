// 言 · 录（记忆）：工具与设置页
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 一条条由模型在对谈中记下的话，跨对话可翻。内容不进系统提示，模型要看得自己 recall；旧对话也只在它去查时才给。
// 五件工具全在浏览器里完成、不经桥接，也不需确认——每一步都会在行迹里显示，条目在设置页可改可删。
const MEMORY_TOOLS = new Set(["remember", "forget", "recall", "search_conversations", "read_conversation"]);
// 会改动记忆的两件：帮手（差遣）拿不到，见 toolDefinitions 与 runTool
const MEMORY_WRITE_TOOLS = new Set(["remember", "forget"]);
// 差遣也并行：同一轮里派出的几名帮手同时开工，各自的卡片各自刷新；活是主模型分的，不重叠靠它分派时留意（工具说明里有交代）
const PARALLEL_TOOLS = new Set([
  "delegate",
  "search_web",
  "fetch_page",
  "read_document",
  "read_file",
  "list_files",
  "search_files",
  "recall",
  "search_conversations",
  "read_conversation"
]);
const MAX_MEMORY_ITEMS = 200,
  MEMORY_TEXT_CHARS = 200,
  CONVERSATION_MESSAGE_CHARS = 1500;
function memoryEnabled() {
  return store.memory.enabled !== false;
}
function memoryId() {
  let id;
  do {
    id = "m" + Math.random().toString(36).slice(2, 7);
  } while (store.memory.items.some(item => item.id === id));
  return id;
}
function memoryLine(item) {
  return `[${item.id}] ${String(item.updatedAt || item.createdAt).slice(0, 10)}｜${item.text}`;
}
function keywordTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}
function hitsAll(text, terms) {
  const lower = String(text || "").toLowerCase();
  return terms.every(term => lower.includes(term));
}
function addMemory(text, source = null) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_TEXT_CHARS);
  if (!clean) return null;
  const item = { id: memoryId(), text: clean, createdAt: now(), updatedAt: now(), source };
  store.memory.items.push(item);
  saveStore();
  return item;
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 */
function runMemoryTool(step, args, conversation) {
  const items = store.memory.items;
  if (step.name === "remember") {
    const text = String(args.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MEMORY_TEXT_CHARS);
    step.title = text;
    if (!text) return { ok: false, content: "text 不能为空", display: "内容为空" };
    const source = { conversationId: conversation.id, title: conversation.title };
    const existing = (args.replaces && items.find(item => item.id === String(args.replaces))) || items.find(item => item.text === text);
    if (existing) {
      existing.text = text;
      existing.updatedAt = now();
      existing.source = source;
      saveStore();
      refreshMemorySettings();
      return { ok: true, content: `已更新 ${memoryLine(existing)}`, display: "已更新" };
    }
    if (items.length >= MAX_MEMORY_ITEMS)
      return {
        ok: false,
        content: `记忆已有 ${MAX_MEMORY_ITEMS} 条，已满。请先用 recall 查看，用 forget 删去过时的，或用 replaces 把相近的合并成一条`,
        display: "记忆已满"
      };
    const item = addMemory(text, source);
    refreshMemorySettings();
    return { ok: true, content: `已记入 ${memoryLine(item)}`, display: "已记入" };
  }
  if (step.name === "forget") {
    const index = items.findIndex(item => item.id === String(args.id || ""));
    step.title = index >= 0 ? items[index].text : String(args.id || "");
    if (index < 0) return { ok: false, content: "没有这条记忆，id 以 recall 的结果为准", display: "未找到" };
    items.splice(index, 1);
    saveStore();
    refreshMemorySettings();
    return { ok: true, content: "已删除", display: "已删除" };
  }
  if (step.name === "recall") {
    const terms = keywordTerms(args.query);
    step.title = terms.length ? String(args.query).trim() : "全部";
    const hits = terms.length ? items.filter(item => hitsAll(item.text, terms)) : items;
    step.results = hits.slice(0, 8).map(item => ({ title: item.text, memoryId: item.id }));
    return { ok: true, content: hits.length ? hits.map(memoryLine).join("\n") : "记忆里没有相关条目", display: `${hits.length} 条` };
  }
  if (step.name === "search_conversations") {
    const terms = keywordTerms(args.query);
    step.title = String(args.query || "").trim();
    if (!terms.length) return { ok: false, content: "query 不能为空", display: "缺少关键词" };
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 8)),
      hits = [];
    const sameRepo = c => isWork(conversation) && isWork(c) && c.workdir === conversation.workdir;
    for (const c of [...store.conversations].sort(
      (a, b) => Number(sameRepo(b)) - Number(sameRepo(a)) || String(b.updatedAt).localeCompare(String(a.updatedAt))
    )) {
      if (c.id === conversation.id) continue;
      const lines = (c.messages || []).filter(m => (m.role === "user" || m.role === "assistant") && m.content);
      if (!hitsAll(`${c.title}\n${lines.map(m => m.content).join("\n")}`, terms)) continue;
      const hit = lines.find(m => String(m.content).toLowerCase().includes(terms[0])),
        text = String(hit?.content || "").replace(/\s+/g, " ");
      const at = Math.max(0, text.toLowerCase().indexOf(terms[0]) - 40),
        snippet = text ? `${at ? "…" : ""}${text.slice(at, at + 120)}${at + 120 < text.length ? "…" : ""}` : "";
      hits.push({
        id: c.id,
        title: c.title,
        date: String(c.updatedAt || c.createdAt).slice(0, 10),
        count: lines.length,
        snippet,
        repo: isWork(c) ? (sameRepo(c) ? "同一目录" : `执事：${c.workdir}`) : ""
      });
      if (hits.length >= limit) break;
    }
    step.results = hits.map(hit => ({ title: hit.title, snippet: hit.snippet, conversationId: hit.id, date: hit.date }));
    return {
      ok: true,
      content: hits.length
        ? hits
            .map(
              hit =>
                `[${hit.id}] ${hit.date}「${hit.title}」共 ${hit.count} 条${hit.repo ? `（${hit.repo}）` : ""}${hit.snippet ? `\n  ${hit.snippet}` : ""}`
            )
            .join("\n")
        : "此前的对话里没有命中",
      display: `${hits.length} 段`
    };
  }
  if (step.name === "read_conversation") {
    const id = String(args.id || ""),
      c = store.conversations.find(item => item.id === id);
    step.title = c ? c.title : id;
    if (!c) return { ok: false, content: "没有这段对话，id 以 search_conversations 的结果为准", display: "未找到" };
    step.conversationId = c.id;
    step.date = c.updatedAt || c.createdAt;
    if (c.id === conversation.id) return { ok: false, content: "这是当前对话，无需读取", display: "当前对话" };
    const lines = (c.messages || []).filter(m => (m.role === "user" || m.role === "assistant") && (m.content || m.attachments?.length));
    const offset = Math.max(1, Number(args.offset) || 1),
      limit = Math.min(100, Math.max(1, Number(args.limit) || 40)),
      slice = lines.slice(offset - 1, offset - 1 + limit);
    const body = slice
      .map((m, i) => {
        const text = String(m.content || "（附件）").trim();
        return `${offset + i}. 【${m.role === "user" ? "用户" : "助手"}】${text.length > CONVERSATION_MESSAGE_CHARS ? `${text.slice(0, CONVERSATION_MESSAGE_CHARS)}…` : text}`;
      })
      .join("\n\n");
    const end = offset - 1 + slice.length;
    return {
      ok: true,
      content: `「${c.title}」${String(c.createdAt).slice(0, 10)}${isWork(c) ? ` · 执事：${c.workdir}` : ""}，共 ${lines.length} 条，此为第 ${offset}–${end} 条${end < lines.length ? `；后面还有 ${lines.length - end} 条` : ""}\n\n${body || "（这段对话没有正文）"}`,
      display: `${slice.length} 条`
    };
  }
  return { ok: false, content: `未知工具 ${step.name}`, display: "未知工具" };
}
// 设置页开着「记忆」时，模型记入或删去要立刻反映在列表里
function refreshMemorySettings() {
  if (settingsTab === "memory" && !$("#settingsModal").classList.contains("hidden")) renderSettings();
}
function memorySettingsHtml() {
  const items = [...store.memory.items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    enabled = memoryEnabled();
  const row = item => {
    const source =
      item.source?.conversationId && store.conversations.some(c => c.id === item.source.conversationId)
        ? `<button type="button" data-memory-open="${escapeHtml(item.source.conversationId)}" title="打开来源对话">${escapeHtml(item.source.title || "来源对话")}</button>`
        : item.source?.title
          ? `<span>${escapeHtml(item.source.title)}</span>`
          : `<span>手记</span>`;
    return `<div class="memory-item" data-memory="${escapeHtml(item.id)}"><textarea class="memory-text" rows="1" spellcheck="false" aria-label="记忆内容">${escapeHtml(item.text)}</textarea><div class="memory-meta"><span>${escapeHtml(formatDay(item.updatedAt || item.createdAt))}</span>${source}<span class="memory-spacer"></span><button type="button" data-memory-delete title="删去这条">删去</button></div></div>`;
  };
  return (
    `<div class="about-head memory-head"><span class="seal memory-seal" aria-hidden="true">录</span><h2>记忆</h2><span class="about-version">${items.length} / ${MAX_MEMORY_ITEMS} 条</span></div><p class="settings-lead">模型在对谈中记下长期有效的事，跨对话可翻阅。何时记、何时看由它判断；条目不随请求发送，也不经云端。</p>` +
    segmentRow(
      "启用记忆",
      "关闭后模型不再记入、也看不到已有条目；条目仍保留在此",
      "memoryEnabled",
      [
        ["true", "开"],
        ["false", "关"]
      ],
      String(enabled)
    ) +
    `<div class="memory-list">${items.length ? items.map(row).join("") : `<p class="memory-empty">尚无一条。模型记下的事会在此出现，亦可手记。</p>`}</div>` +
    `<div class="memory-foot"><button id="addMemory" class="outline-btn" type="button">手记一条</button>${items.length ? `<button id="clearMemory" class="outline-btn" type="button">清空记忆</button>` : ""}</div>`
  );
}
function bindMemoryEvents() {
  const host = $("#settingsContent");
  if (settingsTab !== "memory" || !host) return;
  const grow = area => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };
  host.querySelectorAll(".memory-item").forEach(row => {
    const item = store.memory.items.find(entry => entry.id === row.dataset.memory);
    if (!item) return;
    const area = row.querySelector("textarea");
    grow(area);
    area.addEventListener("input", () => {
      grow(area);
      const text = area.value.replace(/\s+/g, " ").trim().slice(0, MEMORY_TEXT_CHARS);
      if (text) {
        item.text = text;
        item.updatedAt = now();
        saveStoreSoon();
      }
    });
    area.addEventListener("blur", () => {
      if (!area.value.trim()) {
        store.memory.items = store.memory.items.filter(entry => entry !== item);
        saveStore();
        renderSettings();
      }
    });
    row.querySelector("[data-memory-delete]").addEventListener("click", () => {
      store.memory.items = store.memory.items.filter(entry => entry !== item);
      saveStore();
      renderSettings();
    });
    row.querySelector("[data-memory-open]")?.addEventListener("click", e => {
      closeSettings();
      openConversation(e.currentTarget.dataset.memoryOpen);
    });
  });
  $("#addMemory")?.addEventListener("click", () => {
    if (store.memory.items.length >= MAX_MEMORY_ITEMS) return toast(`记忆已有 ${MAX_MEMORY_ITEMS} 条，请先删去一些`);
    const item = { id: memoryId(), text: "", createdAt: now(), updatedAt: now(), source: null };
    store.memory.items.push(item);
    renderSettings();
    setTimeout(() => host.querySelector(`[data-memory="${item.id}"] textarea`)?.focus(), 0);
  });
  $("#clearMemory")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: "清空记忆？",
        body: `${store.memory.items.length} 条记忆将被移除，无法撤销；对话不受影响。`,
        ok: "清空"
      }))
    )
      return;
    store.memory.items = [];
    saveStore();
    renderSettings();
    toast("记忆已清空");
  });
}
