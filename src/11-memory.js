// 言 · 录（记忆）：条目的增删与设置页；模型用的五件工具在 15-tools/40-memory.js
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 一条条由模型在对谈中记下的话，跨对话可翻。内容不进系统提示，模型要看得自己 recall；旧对话也只在它去查时才给。
const MAX_MEMORY_ITEMS = 200,
  MEMORY_TEXT_CHARS = 200;
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
    `<div class="about-head memory-head">${brushIcon("memory", "settings-mark")}<h2>记忆</h2><span class="about-version">${items.length} / ${MAX_MEMORY_ITEMS} 条</span></div><p class="settings-lead">模型在对谈中记下长期有效的事，跨对话可翻阅。何时记、何时看由它判断；条目不随请求发送，也不经云端。</p>` +
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
