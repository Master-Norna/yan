// 言 · 录（记忆）：条目的增删与设置页；模型用的五件工具在 15-tools/40-memory.js
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 一条条由模型在对谈中记下的话，跨对话可翻。每条归在一个分类下（言的开发、偏好……），分类不另存，就是各条上的名字：
// 同名即同类，没有条目的分类自然消失。内容不进系统提示（只报有哪几类），模型要看得自己 recall：先看分类一览，再打开某一类。
// 单条不截断——早先限 200 字、超出悄悄截掉，记下来的话常常没说完；现在过长就退回让模型拆开或精简
const MAX_MEMORY_ITEMS = 324,
  MEMORY_TEXT_CHARS = 2000,
  MEMORY_UNSORTED = "未分类";
/** 设置页「记忆」里选着的那一类；null 或已没了即最近动过的那一类 */
let memoryCategoryOpen = null;
/** 设置页里摊开着的那一条、正改着的那一条（id） */
let memoryItemOpen = "",
  memoryItemEditing = "";
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
function memoryCategoryOf(item) {
  return item.category || MEMORY_UNSORTED;
}
function cleanMemoryCategory(value) {
  return (
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24) || MEMORY_UNSORTED
  );
}
// 行内空白收拢，换行留着（长一点的条目可以分几行写）
function cleanMemoryText(value) {
  return String(value || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** 各类一览：名字、条目（新的在前）、最近一条的日子；最近动过的类排前 */
function memoryCategories() {
  const map = new Map();
  for (const item of store.memory.items) {
    const name = memoryCategoryOf(item),
      at = String(item.updatedAt || item.createdAt),
      entry = map.get(name) || { name, items: [], updatedAt: "" };
    entry.items.push(item);
    if (at > entry.updatedAt) entry.updatedAt = at;
    map.set(name, entry);
  }
  for (const entry of map.values()) entry.items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return [...map.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function memoryLine(item, withCategory = false) {
  return `[${item.id}] ${String(item.updatedAt || item.createdAt).slice(0, 10)}｜${withCategory ? `${memoryCategoryOf(item)}｜` : ""}${item.text}`;
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
function addMemory(text, source = null, category = "") {
  const clean = cleanMemoryText(text);
  if (!clean) return null;
  const item = { id: memoryId(), text: clean, category: cleanMemoryCategory(category), createdAt: now(), updatedAt: now(), source };
  store.memory.items.push(item);
  saveStore();
  return item;
}
// 设置页开着「记忆」时，模型记入或删去要立刻反映在列表里；正在改的那条不打断（重画会把输入框连同光标冲掉）
function refreshMemorySettings() {
  if (document.activeElement?.matches?.("#settingsContent .memory-text")) return;
  if (settingsTab === "memory" && !$("#settingsModal").classList.contains("hidden")) renderSettings();
}
function memoryGist(text) {
  const line = String(text || "").replace(/\s+/g, " ");
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
// 设置页里的一行摘要：** 去掉、空白收拢，多长由样式截
function memoryLineGist(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
// 摊开的全文：只认 **加粗**，别的照原样（换行由样式留着）
function memoryRichText(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}
// 一条：平时一行摘要 + 日子，点开就地摊开全文；摊开的底下注日子、来源，右边三枚小画——改、归入别类、删去。
// 落选（设计稿/49）：条目常开输入框、长的半截淡出，条下重写类名——读着全是碎字，像没画完
function memoryItemHtml(item) {
  const id = escapeHtml(item.id),
    day = `<span class="memory-day">${escapeHtml(formatDay(item.updatedAt || item.createdAt))}</span>`;
  if (item.id !== memoryItemOpen && item.id !== memoryItemEditing)
    return `<div class="memory-item" data-memory="${id}"><button type="button" class="memory-row" data-memory-toggle><span class="memory-gist">${escapeHtml(memoryLineGist(item.text))}</span>${day}</button></div>`;
  const editing = item.id === memoryItemEditing,
    source =
      item.source?.conversationId && store.conversations.some(c => c.id === item.source.conversationId)
        ? `<button type="button" class="memory-source" data-memory-open="${escapeHtml(item.source.conversationId)}" title="打开来源对话">${escapeHtml(item.source.title || "来源对话")}</button>`
        : `<span>${escapeHtml(item.source?.title || "手记")}</span>`,
    body = editing
      ? `<textarea class="memory-text" rows="1" spellcheck="false" aria-label="记忆内容">${escapeHtml(item.text)}</textarea>`
      : `<div class="memory-body" data-memory-toggle title="收起">${memoryRichText(item.text)}</div>`;
  return `<div class="memory-item open" data-memory="${id}">${body}<div class="memory-meta">${day}${source}<span class="memory-spacer"></span><span class="memory-ops"><button type="button" data-memory-edit title="${editing ? "完成" : "修改"}">${brushIcon("edit")}</button><button type="button" data-memory-move title="归入别类" aria-haspopup="menu">${brushIcon("groups")}</button><button type="button" class="memory-del" data-memory-delete title="删除">${brushIcon("strike")}</button></span></div></div>`;
}
// 分栏：左一列类目（选着的左缘一道朱、名字加重），末尾「另起一类」；右边这一类的条目，右栏顶上类名就地可改，
// 「手记一条」「删去此类」两枚小画都对着这一类
function memorySplitHtml(categories, open) {
  return (
    `<div class="memory-split"><div class="memory-cats">${categories
      .map(
        cat =>
          `<button type="button" class="memory-cat${cat === open ? " active" : ""}" data-memory-cat="${escapeHtml(cat.name)}"><span>${escapeHtml(cat.name)}</span><em>${cat.items.length}</em></button>`
      )
      .join("")}<button type="button" id="newMemoryCat" class="memory-cat memory-cat-new">另起一类</button></div>` +
    `<div class="memory-pane"><div class="memory-pane-head"><input id="memoryCatName" class="memory-cat-name" value="${escapeHtml(open.name)}" maxlength="24" spellcheck="false" aria-label="分类名" title="分类名；与已有分类同名即并为一类"><span class="memory-cat-count">${open.items.length} 条</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" id="addMemory" title="手记一条">${brushIcon("add")}</button><button type="button" id="dropMemoryCat" class="memory-del" title="删去此类">${brushIcon("strike")}</button></span></div>` +
    `<div class="memory-list">${open.items.map(memoryItemHtml).join("")}</div></div></div>`
  );
}
function memorySettingsHtml() {
  const categories = memoryCategories(),
    enabled = memoryEnabled(),
    open = categories.find(cat => cat.name === memoryCategoryOpen) || categories[0];
  memoryCategoryOpen = open?.name ?? null;
  return (
    `<div class="settings-head">${brushIcon("memory", "settings-mark")}<h2>记忆</h2><span class="settings-meta">${store.memory.items.length} / ${MAX_MEMORY_ITEMS} 条${categories.length ? ` · ${categories.length} 类` : ""}</span></div>` +
    // 「清空记忆」管的是全部，与总开关同一行，不挤在哪一类底下
    `<div class="setting-row"><div class="setting-copy"><strong>启用记忆</strong><small>关闭后条目仍保留</small></div><div class="setting-actions">${
      store.memory.items.length ? `<button id="clearMemory" class="outline-btn" type="button">清空记忆</button>` : ""
    }<div class="segmented">${[
      ["true", "开"],
      ["false", "关"]
    ]
      .map(
        ([value, label]) =>
          `<button data-setting="memoryEnabled" data-value="${value}" class="${String(enabled) === value ? "active" : ""}">${label}</button>`
      )
      .join("")}</div></div></div>` +
    (open
      ? memorySplitHtml(categories, open)
      : `<p class="memory-empty">尚无一条</p><div class="memory-foot"><button id="addMemory" class="outline-btn" type="button">手记一条</button></div>`)
  );
}
function fileMemory(item, category) {
  const to = cleanMemoryCategory(category);
  if (to === memoryCategoryOf(item)) return renderSettings();
  item.category = to;
  item.updatedAt = now();
  memoryItemEditing = "";
  saveStore();
  toast(`已归入「${to}」`);
  renderSettings();
}
/** @param {string | null} name @param {string} [item] 换过去后摊开着的那一条 */
function openMemoryCategory(name, item = "") {
  const moved = name !== memoryCategoryOpen;
  memoryCategoryOpen = name;
  memoryItemOpen = item;
  memoryItemEditing = "";
  renderSettings();
  if (moved) $("#settingsContent").scrollTop = 0;
}
function bindMemoryEvents() {
  const host = $("#settingsContent");
  // 改着的输入框随字长高
  const grow = area => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };
  host
    .querySelectorAll("[data-memory-cat]")
    .forEach(button => button.addEventListener("click", () => openMemoryCategory(button.dataset.memoryCat || null)));
  // 改分类名：改成已有的名字即并入那一类
  $("#memoryCatName")?.addEventListener("change", e => {
    const from = memoryCategoryOpen,
      to = cleanMemoryCategory(e.target.value);
    if (from === null || to === from) return;
    for (const item of store.memory.items) if (memoryCategoryOf(item) === from) item.category = to;
    saveStore();
    openMemoryCategory(to);
  });
  $("#memoryCatName")?.addEventListener("keydown", e => e.key === "Enter" && e.target.blur());
  host.querySelectorAll(".memory-item").forEach(row => {
    const item = store.memory.items.find(entry => entry.id === row.dataset.memory);
    if (!item) return;
    // 一行摘要点开即摊开全文，摊开的再点一下收起（划选字时不收）
    row.querySelector("[data-memory-toggle]")?.addEventListener("click", () => {
      if (String(window.getSelection()).trim()) return;
      memoryItemOpen = memoryItemOpen === item.id ? "" : item.id;
      renderSettings();
    });
    const area = row.querySelector("textarea");
    if (area) {
      grow(area);
      area.addEventListener("input", () => {
        grow(area);
        const text = cleanMemoryText(area.value);
        const tooLong = text.length > MEMORY_TEXT_CHARS;
        area.setCustomValidity(tooLong ? `记忆最多 ${MEMORY_TEXT_CHARS} 字，当前内容尚未保存，请缩短后再完成` : "");
        area.setAttribute("aria-invalid", String(tooLong));
        if (tooLong) {
          area.reportValidity();
          return;
        }
        if (text) {
          item.text = text;
          item.updatedAt = now();
          saveStoreSoon();
        }
      });
      // 焦点离开这一条即改完、回到只读；挪到这一条的小画上不算，免得重画吞了那一下点按。改空了即删去
      area.addEventListener("blur", e => {
        if (row.contains(e.relatedTarget)) return;
        if (!area.reportValidity()) {
          area.focus();
          return;
        }
        memoryItemEditing = "";
        if (!area.value.trim()) {
          store.memory.items = store.memory.items.filter(entry => entry !== item);
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
    row.querySelector("[data-memory-edit]")?.addEventListener("click", () => {
      if (memoryItemEditing === item.id && area && !area.reportValidity()) return;
      memoryItemEditing = memoryItemEditing === item.id ? "" : item.id;
      memoryItemOpen = item.id;
      renderSettings();
      const field = host.querySelector(`[data-memory="${item.id}"] textarea`);
      field?.focus();
      field?.setSelectionRange(field.value.length, field.value.length);
    });
    // 归入别类：弹出各类（与侧栏「移入分组」同一副菜单），另可起一类；归走了这条就从眼前这一类里移走。
    // 落选：原生 <datalist> 的候选框——样子由浏览器画，一点开是一块黑底，与纸面不搭
    const move = row.querySelector("[data-memory-move]");
    move?.addEventListener("click", event => {
      // 这一下点击若冒泡到页面，「点别处即收」会把刚弹出的菜单收掉
      event.stopPropagation();
      const others = memoryCategories()
        .map(cat => cat.name)
        .filter(name => name !== memoryCategoryOf(item));
      openMenu(move, [
        ...others.map(name => ({ id: name, label: name, run: () => fileMemory(item, name) })),
        {
          id: "new",
          label: "另起一类…",
          run: () => {
            // 另起一类：就地换成一个输入框，回车落定，Esc 作罢
            const field = document.createElement("input");
            field.className = "memory-move";
            field.placeholder = "新类名";
            field.maxLength = 24;
            move.replaceWith(field);
            field.focus();
            let settled = false;
            const settle = keep => {
              if (settled) return;
              settled = true;
              if (keep && field.value.trim()) fileMemory(item, field.value);
              else renderSettings();
            };
            field.addEventListener("keydown", e => {
              if (e.key === "Enter") settle(true);
              else if (e.key === "Escape") {
                e.stopPropagation();
                settle(false);
              }
            });
            field.addEventListener("blur", () => settle(true));
          }
        }
      ]);
    });
    row.querySelector("[data-memory-delete]")?.addEventListener("click", () => {
      store.memory.items = store.memory.items.filter(entry => entry !== item);
      saveStore();
      renderSettings();
    });
    row.querySelector("[data-memory-open]")?.addEventListener("click", e => {
      closeSettings();
      openConversation(e.currentTarget.dataset.memoryOpen);
    });
  });
  // 手记一条：记在选着的那一类里（还没有一类时归「未分类」），就地摊开着改
  const jot = category => {
    if (store.memory.items.length >= MAX_MEMORY_ITEMS) return toast(`记忆已满 ${MAX_MEMORY_ITEMS} 条，请先删去一些`);
    const item = { id: memoryId(), text: "", category, createdAt: now(), updatedAt: now(), source: null };
    store.memory.items.push(item);
    memoryCategoryOpen = category;
    memoryItemOpen = memoryItemEditing = item.id;
    renderSettings();
    host.querySelector(`[data-memory="${item.id}"] textarea`)?.focus();
  };
  $("#addMemory")?.addEventListener("click", () => jot(memoryCategoryOpen ?? MEMORY_UNSORTED));
  // 另起一类：就地换成输入框写名，回车即在这一类里手记第一条——类不另存，有了条目才算有这一类，
  // 第一条没写就离开，这一类也随之消失。写的是已有的名字即打开那一类
  $("#newMemoryCat")?.addEventListener("click", e => {
    const field = document.createElement("input");
    field.className = "memory-cat memory-cat-new";
    field.placeholder = "新类名";
    field.maxLength = 24;
    e.currentTarget.replaceWith(field);
    field.focus();
    let settled = false;
    const settle = keep => {
      if (settled) return;
      settled = true;
      const name = keep && field.value.trim() ? cleanMemoryCategory(field.value) : "";
      if (!name) return renderSettings();
      if (memoryCategories().some(cat => cat.name === name)) return openMemoryCategory(name);
      jot(name);
    };
    field.addEventListener("keydown", e => {
      if (e.key === "Enter") settle(true);
      else if (e.key === "Escape") {
        e.stopPropagation();
        settle(false);
      }
    });
    field.addEventListener("blur", () => settle(true));
  });
  $("#dropMemoryCat")?.addEventListener("click", async () => {
    const name = memoryCategoryOpen,
      count = store.memory.items.filter(item => memoryCategoryOf(item) === name).length;
    if (
      !(await askConfirm({ title: `删去「${name}」这一类？`, body: `其中 ${count} 条记忆将被移除，无法撤销；对话不受影响。`, ok: "删去" }))
    )
      return;
    store.memory.items = store.memory.items.filter(item => memoryCategoryOf(item) !== name);
    saveStore();
    openMemoryCategory(null);
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
