// 言 · 录（记忆）：主模型维护、一类一份、每问带上最新版，与设置页；模型用的工具在 15-tools/40-memory.js
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 关于用户的话，按类各成一份全文（偏好、言的开发……），跨对话都带着。一类一份而非一条一事：一条条记时，模型多半另起一条、
// 不去改旧的，越记越碎、越重复；一类一份，要记就得把那一类整份写过，旧的自然并进去。存的仍是 items（一类一项：id、类名、全文），
// 同名的两项读入时并成一项（见 normalizeMemory）。
// 整份放进系统提示：每一问现取，同一答内固定；只有内容变了才影响提示缓存。记多少不设上限，不按时间遗忘、不记出处。
const MEMORY_UNSORTED = "未分类";
/** 设置页「记忆」里选着的那一类；null 或已没了即最近动过的那一类 */
let memoryCategoryOpen = null;
/** 设置页右栏正改着这一类的全文 */
let memoryEditing = false;
/**
 * 记忆开关控制带入与记入；预设没挑「记忆与旧谈」这一组的对话不带
 * @param {Conversation} [conversation]
 */
function memoryOn(conversation) {
  const preset = conversation ? presetOf(conversation) : null;
  return store.settings.memoryEnabled !== false && (!preset?.tools || preset.tools.includes("memory"));
}
function memoryChars() {
  return store.memory.items.reduce((sum, item) => sum + item.text.length, 0);
}
function memoryId() {
  let id;
  do {
    id = "m" + Math.random().toString(36).slice(2, 7);
  } while (store.memory.items.some(item => item.id === id));
  return id;
}
function cleanMemoryCategory(value) {
  return (
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24) || MEMORY_UNSORTED
  );
}
// 行内空白收拢，换行留着（一类的全文本就分行写）
function cleanMemoryText(value) {
  return String(value || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** 各类，最近动过的在前 */
function memoryCategories() {
  return [...store.memory.items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
/** @param {string} name */
function memoryOf(name) {
  return store.memory.items.find(item => item.category === name) || null;
}
/**
 * 写一类的全文：空的即删去这一类，没有这一类即新起；存不存由调用的定
 * @param {string} category @param {string} text
 * @returns {""|"add"|"update"|"delete"}
 */
function writeMemory(category, text) {
  const name = cleanMemoryCategory(category),
    clean = cleanMemoryText(text),
    item = memoryOf(name);
  if (!clean) {
    if (!item) return "";
    store.memory.items = store.memory.items.filter(entry => entry !== item);
    return "delete";
  }
  if (item) {
    if (item.text === clean) return "";
    Object.assign(item, { text: clean, updatedAt: now() });
    return "update";
  }
  store.memory.items.push({ id: memoryId(), category: name, text: clean, updatedAt: now() });
  return "add";
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
// ── 带进对话 ──
/** 模型读到的一类的版本：删后重建即使正文相同，也不当作旧的一类。 */
function memoryStamp(item) {
  return item ? JSON.stringify([item.id, item.text, item.updatedAt]) : "";
}
/** 整份记忆，一类一段；主答同时记下各类版本，写入时核对，旁注与计数不改主答的这份记录。
 * @param {Map<string, string>|null} [seen]
 */
function memoryText(seen = null) {
  seen?.clear();
  return memoryCategories()
    .map(item => {
      seen?.set(item.category, memoryStamp(item));
      return `「${item.category}」\n${item.text}`;
    })
    .join("\n\n");
}
// 设置页开着「记忆」时，记入或理过要立刻反映出来；正在打字的不打断（重画会把输入框连同已打的字一起冲掉）
function refreshMemorySettings() {
  // 正文框、类名框、另起一类的名字框：焦点在这些可编辑处时不重画，不然正打的字连同输入框一起没。
  // 看的是焦点元素自己的标签——closest("#settingsContent") 回来的是设置面板那个容器（DIV），不是输入框
  const active = document.activeElement;
  if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && active.closest?.("#settingsContent")) return;
  if (settingsTab === "memory" && !$("#settingsModal").classList.contains("hidden")) renderSettings();
}
// 全文只认 **加粗**，别的照原样（换行由样式留着）
function memoryRichText(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
// 分栏：左一列类目（选着的左缘一道朱、名字加重），末尾「另起一类」；右边这一类的全文，顶上「改」「删去此类」两枚小画。
// 类名与全文平时只读，点「改」才换输入框
function memorySplitHtml(categories, open) {
  const pane = open
    ? `<div class="memory-pane-head">${
        memoryEditing
          ? `<input id="memoryCatName" class="memory-cat-name" value="${escapeHtml(open.category)}" maxlength="24" spellcheck="false" aria-label="${t(`分类名`)}" title="${t(`分类名；与已有分类同名即并为一类`)}">`
          : `<span class="memory-cat-name">${escapeHtml(open.category)}</span>`
      }<span class="memory-day">${escapeHtml(formatDay(open.updatedAt))}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" id="editMemory" title="${memoryEditing ? t("完成") : t("修改")}">${brushIcon("edit")}</button><button type="button" id="dropMemoryCat" class="memory-del" title="${t(`删去此类`)}">${brushIcon("strike")}</button></span></div>` +
      `<div class="memory-sheet">${
        memoryEditing
          ? `<textarea class="memory-text" spellcheck="false" aria-label="${t(`记忆内容`)}">${escapeHtml(open.text)}</textarea>`
          : `<div class="memory-body" data-memory-body>${memoryRichText(open.text)}</div>`
      }</div>`
    : `<p class="memory-empty">${t(`尚无记忆`)}</p>`;
  return (
    `<div class="memory-split"><div class="memory-cats">${categories
      .map(
        item =>
          `<button type="button" class="memory-cat${item === open ? " active" : ""}" data-memory-cat="${escapeHtml(item.category)}"><span>${escapeHtml(item.category)}</span></button>`
      )
      .join("")}<button type="button" id="newMemoryCat" class="memory-cat memory-cat-new">${t(`另起一类`)}</button></div>` +
    `<div class="memory-pane">${pane}</div></div>`
  );
}
function memorySettingsHtml() {
  const categories = memoryCategories(),
    on = memoryOn(),
    open = categories.find(item => item.category === memoryCategoryOpen) || categories[0];
  memoryCategoryOpen = open?.category ?? null;
  if (!open) memoryEditing = false;
  return (
    `<div class="settings-head">${brushIcon("memory", "settings-mark")}<h2>${t(`记忆`)}</h2><span class="settings-meta">${t`${categories.length} 类 · ${memoryChars()} 字`}</span></div>` +
    `<div class="setting-row"><div class="setting-copy"><strong>${on ? t("带进对话") : t("未带进对话")}</strong><small>${t("每一问带上最新记忆，由主模型决定记入、更新与忘记")}</small></div><div class="setting-actions">${
      categories.length ? `<button id="clearMemory" class="outline-btn" type="button">${t(`清空记忆`)}</button>` : ""
    }<div class="segmented"><button data-memory-enabled="true" class="${on ? "active" : ""}">${t("开")}</button><button data-memory-enabled="false" class="${on ? "" : "active"}">${t("关")}</button></div></div></div>` +
    memorySplitHtml(categories, open)
  );
}
/** @param {string | null} name @param {boolean} [editing] */
function openMemoryCategory(name, editing = false) {
  const moved = name !== memoryCategoryOpen;
  memoryCategoryOpen = name;
  memoryEditing = editing;
  renderSettings();
  if (moved) $("#settingsContent").scrollTop = 0;
  if (editing) {
    const field = /** @type {HTMLTextAreaElement|null} */ ($("#settingsContent .memory-text"));
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }
}
// 把一个按钮就地换成一格写类名的输入框：回车、失焦即定，Esc 作罢（交回空字）；只定一回
/** @param {Element} target @param {(typed: string) => void} settle */
function memoryNameField(target, className, settle) {
  const field = document.createElement("input");
  field.className = className;
  field.placeholder = t("新类名");
  field.maxLength = 24;
  target.replaceWith(field);
  field.focus();
  let settled = false;
  const done = keep => {
    if (settled) return;
    settled = true;
    settle(keep ? field.value : "");
  };
  field.addEventListener("keydown", e => {
    if (e.key === "Enter") done(true);
    else if (e.key === "Escape") {
      e.stopPropagation();
      done(false);
    }
  });
  field.addEventListener("blur", () => done(true));
}
function bindMemoryEvents() {
  const host = $("#settingsContent"),
    item = memoryCategoryOpen === null ? null : memoryOf(memoryCategoryOpen),
    area = /** @type {HTMLTextAreaElement|null} */ (host.querySelector(".memory-text"));
  // 点「完成」与移开焦点走同一次提交：空正文在编辑期间暂留，落定时才删类。
  const finish = () => {
    memoryEditing = false;
    if (area && item && !area.value.trim()) {
      store.memory.items = store.memory.items.filter(entry => entry !== item);
      saveStore();
    }
    renderSettings();
  };
  host
    .querySelectorAll("[data-memory-cat]")
    .forEach(button => button.addEventListener("click", () => openMemoryCategory(button.dataset.memoryCat || null)));
  // 改分类名：改成已有的名字即并入那一类（全文接在那一类后面）
  $("#memoryCatName")?.addEventListener("change", e => {
    const to = cleanMemoryCategory(e.target.value),
      into = memoryOf(to);
    if (!item || to === item.category) return;
    if (into) {
      into.text = cleanMemoryText(`${into.text}\n${item.text}`);
      into.updatedAt = now();
      store.memory.items = store.memory.items.filter(entry => entry !== item);
    } else Object.assign(item, { category: to, updatedAt: now() });
    saveStore();
    openMemoryCategory(to);
  });
  $("#memoryCatName")?.addEventListener("keydown", e => e.key === "Enter" && e.target.blur());
  $("#editMemory")?.addEventListener("click", () => (memoryEditing ? finish() : openMemoryCategory(memoryCategoryOpen, true)));
  if (area && item) {
    fitTextarea(area);
    area.addEventListener("input", () => {
      const text = cleanMemoryText(area.value);
      if (text) {
        item.text = text;
        item.updatedAt = now();
        saveStoreSoon();
      }
    });
    // 焦点离开即改完、回到只读；挪到头上的小画不算，免得重画吞了那一下点按。改空了即删去这一类
    area.addEventListener("blur", e => {
      if (host.querySelector(".memory-pane-head")?.contains(e.relatedTarget)) return;
      finish();
    });
    area.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      area.blur();
    });
  }
  host.querySelectorAll("[data-memory-enabled]").forEach(button =>
    button.addEventListener("click", () => {
      store.settings.memoryEnabled = button.dataset.memoryEnabled === "true";
      saveStore();
      renderSettings();
    })
  );
  // 另起一类：就地换成输入框写名，回车即起一类、就地写全文；没写就离开，这一类随之消失。写的是已有的名字即打开那一类
  $("#newMemoryCat")?.addEventListener("click", e => {
    memoryNameField(e.currentTarget, "memory-cat memory-cat-new", typed => {
      const name = typed.trim() ? cleanMemoryCategory(typed) : "";
      if (!name) return renderSettings();
      if (!memoryOf(name)) store.memory.items.push({ id: memoryId(), category: name, text: "", updatedAt: now() });
      openMemoryCategory(name, !memoryOf(name)?.text);
    });
  });
  $("#dropMemoryCat")?.addEventListener("click", async () => {
    if (!item) return;
    if (
      !(await askConfirm({
        title: t`删去「${item.category}」这一类？`,
        body: t("这一类的记忆将被移除，无法撤销；对话不受影响。"),
        ok: t("删去")
      }))
    )
      return;
    store.memory.items = store.memory.items.filter(entry => entry !== item);
    saveStore();
    openMemoryCategory(null);
  });
  $("#clearMemory")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: t("清空记忆？"),
        body: t`${store.memory.items.length} 类记忆将被移除，无法撤销；对话不受影响。`,
        ok: t("清空")
      }))
    )
      return;
    store.memory.items = [];
    saveStore();
    renderSettings();
    toast(t("记忆已清空"));
  });
}
