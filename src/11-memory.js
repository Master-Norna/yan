// 言 · 录（记忆）：条目的增删、带进对话、离开一段后的整理与设置页；模型用的工具在 15-tools/40-memory.js
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 一条条关于用户的话，跨对话都带着。每条归在一个分类下（言的开发、偏好……），分类不另存，就是各条上的名字：
// 同名即同类，没有条目的分类自然消失。
// 照各家的朴素做法（ChatGPT 的存下的记忆、Claude 的 userMemories、Claude Code 的 MEMORY.md）：记忆整份放进系统提示，
// 每段对话头一问时定格；不再要模型自己去翻——原先只报分类、内容要 recall 才看得到，模型不知道里头有什么，多半就不翻。
// 能整份带上是因为短：总长有个预算（MEMORY_BUDGET），由专司「记忆」在离开一段对话后整理——从这段的问答里补记、合并、删去推翻的，
// 压回预算之内。主模型仍可当场 remember，只是不靠它：答题中途停下来记是分心，记不记全看它那一刻想没想起来
const MEMORY_BUDGET = 3000,
  MEMORY_UNSORTED = "未分类",
  // 整理一回交多少字的问答；用户的话、助手的答复各截到多长（助手的只作上下文）
  TIDY_CHUNK = 16000,
  TIDY_USER_CHARS = 4000,
  TIDY_REPLY_CHARS = 1500;
/** 设置页「记忆」里选着的那一类；null 或已没了即最近动过的那一类 */
let memoryCategoryOpen = null;
/** 设置页里摊开着的那一条、正改着的那一条（id） */
let memoryItemOpen = "",
  memoryItemEditing = "";
/**
 * 专司「记忆」配好了：每段对话开头带上记忆、给记与忘，离开一段后整理。预设没挑「记忆与旧谈」这一组的对话不带也不整理
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
// ── 带进对话 ──
/** @type {Map<string, string>} 各段对话头一问时定格的那份记忆：此后别处整理、记入都不改它，系统提示不变，前面的缓存接得上；本段自己记的本就在上下文里 */
const memorySnapshots = new Map();
/** 整份记忆，按类分段（最近动过的类在前），条目带 id 与日子：记与忘认 id，日子让模型看得出新旧 */
function memoryText() {
  return memoryCategories()
    .map(cat => `「${cat.name}」\n${cat.items.map(item => memoryLine(item)).join("\n")}`)
    .join("\n\n");
}
/** @param {Conversation} conversation */
function memorySnapshot(conversation) {
  if (!memorySnapshots.has(conversation.id)) memorySnapshots.set(conversation.id, memoryText());
  return memorySnapshots.get(conversation.id) || "";
}
// ── 整理 ──
// 一答落定（不再接着答），就把这段还没整理过的问答交给专司「记忆」——不等人离开：长活常挂在一页里不走。
// 它看现有记忆与这段新近的问答，答一份增删改，没提到的条目一字不动——整份重写会一回回悄悄走样，人改过的字也会被转述掉。
// 眼前这段的系统提示里记忆已定格（见 memorySnapshot），整理改的是往后各段带的那份，不扰这段的缓存。
// 页面关了、没成的，下回这段答完或开页时补上。一回只整理一段，依次排队：后一段看到的是前一段改过的记忆。
// 交给它的只有用户的话与助手的答复，不给工具输出：网页里埋的「请记住……」进不来（与审查只看用户原话同理）。
// 整理要写这段对话（记到了哪一刻），先向桥接认领：别处正在这段里作答就让开，那边答完自会整理
let tidyQueue = Promise.resolve();
/** @type {Set<string>} 排着或正整理的对话 */
const tidyingIds = new Set();
/** 正整理的那一段：报到时算它在写（见 syncLeases），别处不同时写它 */
let tidyingNow = "";
/** 这段对话里还没整理的问答：晚于上回整理到的那一刻、也晚于记忆开起之时；帮手的回报不是用户的话，不算 @param {Conversation} c */
function untidied(c) {
  const after = [c.memoryAt || "", store.memory.since || ""].sort().at(-1) || "";
  return c.messages.filter(
    m =>
      (m.role === "user" || m.role === "assistant") &&
      !m.relay &&
      m.status !== "error" &&
      String(m.content || "").trim() &&
      String(m.timestamp || "") > after
  );
}
/** 有用户新说的话才值得整理（只有答复续写了几句的不算） @param {Conversation} c */
const hasUntidied = c => untidied(c).some(m => m.role === "user");
/** @param {Conversation} conversation */
function tidyMemory(conversation) {
  const id = conversation.id;
  if (tidyingIds.has(id) || !memoryOn(conversation) || !hasUntidied(conversation)) return tidyQueue;
  tidyingIds.add(id);
  // 没成（接口不通、答得认不出清单）：这段的进度不动，这段下回答完或开页时再来。不提示：没成不丢东西，配错了接口去设置里试连
  tidyQueue = tidyQueue
    .then(() => tidyOne(id))
    .catch(error => console.warn("记忆整理没成，下回再来", error))
    .finally(() => tidyingIds.delete(id));
  return tidyQueue;
}
// 开页时补上：页面关着时没来得及、或没成的那几段
function tidyLeftovers() {
  if (!memoryOn()) return;
  for (const c of store.conversations) void tidyMemory(c);
}
/** @param {string} id */
async function tidyOne(id) {
  let c = store.conversations.find(item => item.id === id);
  if (!c || !memoryOn(c) || conversationRunning(id) || remoteBusy.has(id)) return;
  // 记忆开着却没记下开起之时（配置是别处写的、旧版升上来的）：从此刻算起，此前的旧对话不拿去整理
  if (!store.memory.since) {
    store.memory.since = now();
    return saveStore();
  }
  if (!hasUntidied(c) || !(await claimConversation(id))) return;
  tidyingNow = id;
  const counts = { add: 0, update: 0, delete: 0 };
  try {
    // 每回现取：整理的这一阵里人又问了一答，答完的接着整理；又在作答了就停，等那一答落定时再来（别把没答的问先送去）
    for (let turns = untidied(c); turns.length && !conversationRunning(id); turns = untidied(c)) {
      // 一回装多少：问答依次装，装满一回的量为止（至少一条）。答复的结论多在末尾，截时留头留尾
      const lines = [];
      let room = TIDY_CHUNK;
      for (const m of turns) {
        const line =
          m.role === "user"
            ? `【用户】${clipForModel(m.content.trim(), TIDY_USER_CHARS)}`
            : `【助手】${clipForModel(m.content.trim(), TIDY_REPLY_CHARS, { tail: true })}`;
        if (lines.length && line.length > room) break;
        lines.push(line);
        room -= line.length;
      }
      const chunk = turns.slice(0, lines.length),
        day = [chunk[0], chunk.at(-1)].map(m => localDay(new Date(m.timestamp)));
      applyMemoryOps(await askTidier(c, lines.join("\n\n"), day[0] === day[1] ? day[0] : `${day[0]} 至 ${day[1]}`), c, counts);
      // 整理的这一阵里这段可能从磁盘换过一回（别处写过）：记在眼下那一份上
      c = store.conversations.find(item => item.id === id) || c;
      c.memoryAt = chunk.at(-1).timestamp;
      markDirty(id);
      saveStore();
    }
  } finally {
    tidyingNow = "";
    refreshMemorySettings();
  }
  const said = [
    counts.add ? t`记下 ${counts.add} 条` : "",
    counts.update ? t`改 ${counts.update} 条` : "",
    counts.delete ? t`删 ${counts.delete} 条` : ""
  ].filter(Boolean);
  if (said.length) toast(t`记忆：${said.join(t("、"))}`);
}
/** 问一回专司「记忆」：现有记忆整份、这段新近的问答；答回一份增删改 @param {Conversation} c @param {string} turns @param {string} day */
async function askTidier(c, turns, day) {
  const items = store.memory.items,
    reply = await askDuty(
      "memory",
      prompt("memory.case", {
        used: memoryChars(),
        items: items.length ? items.map(item => memoryLine(item, true)).join("\n") : prompt("memory.empty"),
        title: c.title || t("未命名"),
        day,
        turns
      }),
      { systemPrompt: prompt("memory.system", { budget: MEMORY_BUDGET }), maxTokens: 8000, signal: AbortSignal.timeout(180000) }
    );
  return parseMemoryOps(reply);
}
/** 答复里的那个 JSON 数组：裹了围栏、前后多说了几句都认；找不到就当这回没整理成 @param {string} text */
function parseMemoryOps(text) {
  const body = String(text || ""),
    from = body.indexOf("["),
    to = body.lastIndexOf("]");
  if (from < 0 || to < from) throw Error("记忆整理没给出改动清单");
  const ops = JSON.parse(body.slice(from, to + 1));
  if (!Array.isArray(ops)) throw Error("记忆整理给的不是清单");
  return ops;
}
/** 照清单改记忆：认不得的 id（那条刚在设置里删了）跳过；记的与已有一字不差的不重记 @param {any[]} ops @param {Conversation} c @param {{ add: number, update: number, delete: number }} counts */
function applyMemoryOps(ops, c, counts) {
  const source = { conversationId: c.id, title: c.title };
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const item = op.id ? store.memory.items.find(entry => entry.id === String(op.id)) : null,
      text = cleanMemoryText(op.text);
    if (op.op === "delete" && item) {
      store.memory.items = store.memory.items.filter(entry => entry !== item);
      counts.delete += 1;
    } else if (op.op === "update" && item && (text || op.category)) {
      if (text) item.text = text;
      if (op.category) item.category = cleanMemoryCategory(op.category);
      Object.assign(item, { updatedAt: now(), source });
      counts.update += 1;
    } else if (op.op === "add" && text && !store.memory.items.some(entry => entry.text === text)) {
      addMemory(text, source, op.category);
      counts.add += 1;
    }
  }
}
// 设置页开着「记忆」时，模型记入或删去要立刻反映在列表里；正在改的那条不打断（重画会把输入框连同光标冲掉）
function refreshMemorySettings() {
  if (document.activeElement?.matches?.("#settingsContent .memory-text")) return;
  if (settingsTab === "memory" && !$("#settingsModal").classList.contains("hidden")) renderSettings();
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
        ? `<button type="button" class="memory-source" data-memory-open="${escapeHtml(item.source.conversationId)}" title="${t(`打开来源对话`)}">${escapeHtml(item.source.title || t("来源对话"))}</button>`
        : `<span>${escapeHtml(item.source?.title || t("手记"))}</span>`,
    body = editing
      ? `<textarea class="memory-text" rows="1" spellcheck="false" aria-label="${t(`记忆内容`)}">${escapeHtml(item.text)}</textarea>`
      : `<div class="memory-body" data-memory-toggle title="${t(`收起`)}">${memoryRichText(item.text)}</div>`;
  return `<div class="memory-item open" data-memory="${id}">${body}<div class="memory-meta">${day}${source}<span class="memory-spacer"></span><span class="memory-ops"><button type="button" data-memory-edit title="${editing ? t("完成") : t("修改")}">${brushIcon("edit")}</button><button type="button" data-memory-move title="${t(`归入别类`)}" aria-haspopup="menu">${brushIcon("groups")}</button><button type="button" class="memory-del" data-memory-delete title="${t(`删除`)}">${brushIcon("strike")}</button></span></div></div>`;
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
      .join("")}<button type="button" id="newMemoryCat" class="memory-cat memory-cat-new">${t(`另起一类`)}</button></div>` +
    `<div class="memory-pane"><div class="memory-pane-head"><input id="memoryCatName" class="memory-cat-name" value="${escapeHtml(open.name)}" maxlength="24" spellcheck="false" aria-label="${t(`分类名`)}" title="${t(`分类名；与已有分类同名即并为一类`)}"><span class="memory-cat-count">${t`${open.items.length} 条`}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" id="addMemory" title="${t(`手记一条`)}">${brushIcon("add")}</button><button type="button" id="dropMemoryCat" class="memory-del" title="${t(`删去此类`)}">${brushIcon("strike")}</button></span></div>` +
    `<div class="memory-list">${open.items.map(memoryItemHtml).join("")}</div></div></div>`
  );
}
function memorySettingsHtml() {
  const categories = memoryCategories(),
    on = memoryOn(),
    open = categories.find(cat => cat.name === memoryCategoryOpen) || categories[0];
  memoryCategoryOpen = open?.name ?? null;
  return (
    `<div class="settings-head">${brushIcon("memory", "settings-mark")}<h2>${t(`记忆`)}</h2><span class="settings-meta">${t`${store.memory.items.length} 条 · ${memoryChars()} / ${MEMORY_BUDGET} 字`}${categories.length ? t` · ${categories.length} 类` : ""}</span></div>` +
    // 开关在专司里（带不带、谁来整理是一回事）；这一行只说眼下如何，「清空记忆」管的是全部，也放这一行，不挤在哪一类底下
    `<div class="setting-row"><div class="setting-copy"><strong>${on ? t("带进对话") : t("未带进对话")}</strong><small>${
      on ? t("每段对话开头带上，离开一段后由专司「记忆」在后台整理") : t("在专司里配好「记忆」后，才带上、才整理")
    }</small></div><div class="setting-actions">${
      store.memory.items.length ? `<button id="clearMemory" class="outline-btn" type="button">${t(`清空记忆`)}</button>` : ""
    }<button id="memoryDuty" class="outline-btn" type="button">${t(`专司`)}</button></div></div>` +
    (open
      ? memorySplitHtml(categories, open)
      : `<p class="memory-empty">${t(`尚无一条`)}</p><div class="memory-foot"><button id="addMemory" class="outline-btn" type="button">${t(`手记一条`)}</button></div>`)
  );
}
function fileMemory(item, category) {
  const to = cleanMemoryCategory(category);
  if (to === memoryCategoryOf(item)) return renderSettings();
  item.category = to;
  item.updatedAt = now();
  memoryItemEditing = "";
  saveStore();
  toast(t`已归入「${to}」`);
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
  const host = $("#settingsContent");
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
      fitTextarea(area);
      area.addEventListener("input", () => {
        const text = cleanMemoryText(area.value);
        if (text) {
          item.text = text;
          item.updatedAt = now();
          saveStoreSoon();
        }
      });
      // 焦点离开这一条即改完、回到只读；挪到这一条的小画上不算，免得重画吞了那一下点按。改空了即删去
      area.addEventListener("blur", e => {
        if (row.contains(e.relatedTarget)) return;
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
          label: t("另起一类…"),
          run: () => {
            // 另起一类：就地换成一个输入框，回车落定，Esc 作罢
            memoryNameField(move, "memory-move", name => (name.trim() ? fileMemory(item, name) : renderSettings()));
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
    const item = { id: memoryId(), text: "", category, createdAt: now(), updatedAt: now(), source: null };
    store.memory.items.push(item);
    memoryCategoryOpen = category;
    memoryItemOpen = memoryItemEditing = item.id;
    renderSettings();
    host.querySelector(`[data-memory="${item.id}"] textarea`)?.focus();
  };
  $("#memoryDuty")?.addEventListener("click", () => {
    dutyOpen.add("memory");
    openSettings("duty");
  });
  $("#addMemory")?.addEventListener("click", () => jot(memoryCategoryOpen ?? MEMORY_UNSORTED));
  // 另起一类：就地换成输入框写名，回车即在这一类里手记第一条——类不另存，有了条目才算有这一类，
  // 第一条没写就离开，这一类也随之消失。写的是已有的名字即打开那一类
  $("#newMemoryCat")?.addEventListener("click", e => {
    memoryNameField(e.currentTarget, "memory-cat memory-cat-new", typed => {
      const name = typed.trim() ? cleanMemoryCategory(typed) : "";
      if (!name) return renderSettings();
      if (memoryCategories().some(cat => cat.name === name)) return openMemoryCategory(name);
      jot(name);
    });
  });
  $("#dropMemoryCat")?.addEventListener("click", async () => {
    const name = memoryCategoryOpen,
      count = store.memory.items.filter(item => memoryCategoryOf(item) === name).length;
    if (
      !(await askConfirm({
        title: t`删去「${name}」这一类？`,
        body: t`其中 ${count} 条记忆将被移除，无法撤销；对话不受影响。`,
        ok: t("删去")
      }))
    )
      return;
    store.memory.items = store.memory.items.filter(item => memoryCategoryOf(item) !== name);
    saveStore();
    openMemoryCategory(null);
  });
  $("#clearMemory")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: t("清空记忆？"),
        body: t`${store.memory.items.length} 条记忆将被移除，无法撤销；对话不受影响。`,
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
