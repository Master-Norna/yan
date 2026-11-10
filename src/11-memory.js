// 言 · 录（记忆）：一类一份、带进对话、改过后由专司「记忆优化」理一遍，与设置页；模型用的工具在 15-tools/40-memory.js
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 关于用户的话，按类各成一份全文（偏好、言的开发……），跨对话都带着。一类一份而非一条一事：一条条记时，模型多半另起一条、
// 不去改旧的，越记越碎、越重复；一类一份，要记就得把那一类整份写过，旧的自然并进去。存的仍是 items（一类一项：id、类名、全文），
// 同名的两项读入时并成一项（见 normalizeMemory）。
// 照各家的朴素做法（ChatGPT 的已存记忆、Claude Code 的 MEMORY.md）：整份放进系统提示，每段对话第一次拼进系统提示时定格（打开即定格，刷新后重新定格）；主模型用 remember 当场改。
// 专司「记忆优化」是总开关（同自动拟题，多花一点换体验）：记忆改过后，一答落定时只读各类全文理一遍——去重、改掉矛盾、删废话。
// 不读对话，额度只在记忆真改过时花。记多少不设上限；遗忘不按时长、不按字数。不记出处：没什么用，对话删了还会指空
const MEMORY_UNSORTED = "未分类";
/** 设置页「记忆」里选着的那一类；null 或已没了即最近动过的那一类 */
let memoryCategoryOpen = null;
/** 设置页右栏正改着这一类的全文 */
let memoryEditing = false;
/**
 * 专司「记忆优化」配好了：每段对话开头带上记忆、给 remember，改过后理一遍。预设没挑「记忆与旧谈」这一组的对话不带
 * @param {Conversation} [conversation]
 */
function memoryOn(conversation) {
  const preset = conversation ? presetOf(conversation) : null;
  return dutyReady(store.settings.dutyMemory) && (!preset?.tools || preset.tools.includes("memory"));
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
 * @param {string} category @param {string} text @param {string} [at] 记作哪一刻改的（优化记在它送出之时，见 tuneOnce）
 * @returns {""|"add"|"update"|"delete"}
 */
function writeMemory(category, text, at = now()) {
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
    Object.assign(item, { text: clean, updatedAt: at });
    return "update";
  }
  store.memory.items.push({ id: memoryId(), category: name, text: clean, updatedAt: at });
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
/** @type {Map<string, string>} 各段对话第一次拼进系统提示时定格的那份记忆（打开即定格，刷新后重新定格）：此后别处改、优化都不改它，系统提示不变，前面的缓存接得上；本段自己记的本就在上下文里 */
const memorySnapshots = new Map();
// 用户自己动手清空记忆、删去一类：本页各段对话定的那份一并作废，下一回画到时就按现在的记忆重新定格。
// 模型自己记的、专司理的不在此列——定格本就是为了让系统提示与缓存不变
function forgetMemorySnapshots() {
  memorySnapshots.clear();
}
/** 整份记忆，一类一段（最近动过的在前） */
function memoryText() {
  return memoryCategories()
    .map(item => `「${item.category}」\n${item.text}`)
    .join("\n\n");
}
/** @param {Conversation} conversation */
function memorySnapshot(conversation) {
  if (!memorySnapshots.has(conversation.id)) memorySnapshots.set(conversation.id, memoryText());
  return memorySnapshots.get(conversation.id) || "";
}
// ── 优化 ──
// 记忆改过（有一类晚于 tunedAt：主模型记的、人在设置里改的、别处同步来的），一答落定时交专司「记忆优化」理一遍。
// 它只读各类全文，答回要改的那几类的新全文，没提到的类一字不动。送出之后又被改过的类不认它的改法：人刚改的不被盖掉。
// 它写的记作送出那一刻、tunedAt 也记那一刻：这阵里别处改的仍算没理过，它自己写的不算，不会一回回理自己的手笔。
// 没成不提示：tunedAt 不动，下一答落定时再来。几页同开各自理也无妨：都按类写、写前比对过
let tuning = null;
function memoryStale() {
  const at = store.memory.tunedAt || "";
  return store.memory.items.some(item => String(item.updatedAt) > at);
}
function tuneMemory() {
  if (tuning || !memoryOn() || !memoryStale()) return tuning;
  tuning = tuneOnce()
    .catch(error => console.warn("记忆优化没成，下回再来", error))
    .finally(() => (tuning = null));
  return tuning;
}
async function tuneOnce() {
  const at = now(),
    sent = new Map(store.memory.items.map(item => [item.category, item.updatedAt])),
    reply = await askDuty("memory", prompt("memory.case", { items: memoryText() }), {
      systemPrompt: prompt("memory.system"),
      maxTokens: 8000,
      signal: AbortSignal.timeout(180000)
    });
  let changed = 0,
    invalid = 0;
  // 本批已处理过的类（写了、删了、原样未动都算）：同一类再来一条时按后来的落地，不当成「送出后被别人改过」
  const touched = new Set();
  for (const op of parseMemoryOps(reply)) {
    // 只认字符串：缺了 text（或给 null、数字、数组）是模型没按约定答，不能当成「空串即删去这一类」把一整类删掉
    if (!op || typeof op !== "object" || !op.category || typeof op.text !== "string") {
      invalid += 1;
      continue;
    }
    const name = cleanMemoryCategory(op.category),
      item = memoryOf(name);
    // 送出后动过的、删了的不认；送出时没有、这阵里别处新起的同名一类也不认
    if (!touched.has(name) && (item ? sent.get(name) !== item.updatedAt : sent.has(name))) continue;
    touched.add(name);
    if (writeMemory(name, op.text, at)) changed += 1;
  }
  // 有一条没按约定答就不算理成：tunedAt 不前进，下一答落定时再来。已落地的照留，也要当场存下、画出来——
  // 不然只在内存里，等别的动作碰巧存一次，其间多页同步可能把它盖掉
  if (invalid) {
    if (changed) {
      saveStore();
      refreshMemorySettings();
    }
    throw Error(`记忆优化给了 ${invalid} 条不合约定的项`);
  }
  store.memory.tunedAt = at;
  saveStore();
  refreshMemorySettings();
  if (changed) toast(t`记忆：理过 ${changed} 类`);
}
/** 答复里的那个 JSON 数组：裹了围栏、前后多说了几句都认；找不到就当这回没理成 @param {string} text */
function parseMemoryOps(text) {
  const body = String(text || ""),
    from = body.indexOf("["),
    to = body.lastIndexOf("]");
  if (from < 0 || to < from) throw Error("记忆优化没给出改动清单");
  const ops = JSON.parse(body.slice(from, to + 1));
  if (!Array.isArray(ops)) throw Error("记忆优化给的不是清单");
  return ops;
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
// 分栏：左一列类目（选着的左缘一道朱、名字加重），末尾「另起一类」；右边这一类的全文，顶上类名就地可改，「改」「删去此类」两枚小画。
// 全文平时只读，点「改」或点一下正文（没在划选字时）才换输入框
function memorySplitHtml(categories, open) {
  const pane = open
    ? `<div class="memory-pane-head"><input id="memoryCatName" class="memory-cat-name" value="${escapeHtml(open.category)}" maxlength="24" spellcheck="false" aria-label="${t(`分类名`)}" title="${t(`分类名；与已有分类同名即并为一类`)}"><span class="memory-day">${escapeHtml(formatDay(open.updatedAt))}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" id="editMemory" title="${memoryEditing ? t("完成") : t("修改")}">${brushIcon("edit")}</button><button type="button" id="dropMemoryCat" class="memory-del" title="${t(`删去此类`)}">${brushIcon("strike")}</button></span></div>` +
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
    // 开关在专司里（带不带、谁来理是一回事）；这一行只说眼下如何，「清空记忆」管的是全部，也放这一行
    `<div class="setting-row"><div class="setting-copy"><strong>${on ? t("带进对话") : t("未带进对话")}</strong><small>${
      on ? t("每段对话开头带上；记忆改过后，由专司「记忆优化」理一遍") : t("在专司里配好「记忆优化」后，才带上、才记")
    }</small></div><div class="setting-actions">${
      categories.length ? `<button id="clearMemory" class="outline-btn" type="button">${t(`清空记忆`)}</button>` : ""
    }<button id="memoryDuty" class="outline-btn" type="button">${t(`专司`)}</button></div></div>` +
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
    item = memoryCategoryOpen === null ? null : memoryOf(memoryCategoryOpen);
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
  $("#editMemory")?.addEventListener("click", () => openMemoryCategory(memoryCategoryOpen, !memoryEditing));
  // 点一下正文即改；划选字时不算
  host.querySelector("[data-memory-body]")?.addEventListener("click", () => {
    if (!String(window.getSelection()).trim()) openMemoryCategory(memoryCategoryOpen, true);
  });
  const area = /** @type {HTMLTextAreaElement|null} */ (host.querySelector(".memory-text"));
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
      memoryEditing = false;
      if (!area.value.trim()) {
        store.memory.items = store.memory.items.filter(entry => entry !== item);
        // 改空即删去这一类：同「删去此类」，本页各段对话定的那份一并作废
        forgetMemorySnapshots();
        saveStore();
      }
      renderSettings();
    });
    area.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      area.blur();
    });
  }
  $("#memoryDuty")?.addEventListener("click", () => {
    dutyOpen.add("memory");
    openSettings("duty");
  });
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
    forgetMemorySnapshots();
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
    forgetMemorySnapshots();
    saveStore();
    renderSettings();
    toast(t("记忆已清空"));
  });
}
