// 言 · 言 / 行两态、欢迎页与目录签、开合对话
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 言与行不是两个入口，而是一段对话有没有绑工作目录：绑了就是行（执事，改动落在那个目录，提示词也是执事的做法）；
// 没绑就是言（对谈，桥接在线时工具落在卷宗目录，只为产出文件）。目录可以在对话中途绑上或解开，上下文不断
/** @param {Conversation} c */
function isWork(c) {
  return !!c?.workdir;
}
// 沙箱：言与行都套着——桥接那头筛指令、锁目录、去机密环境变量。只有设置 → 工具里一个总开关，默认开
function sandboxed() {
  return store.settings.sandbox !== false;
}
function workMode() {
  const c = currentConversation();
  return c ? isWork(c) : !!(store.settings.pendingWorkdir || "").trim();
}
// 卷宗目录：设置里改过就用改过的，否则桥接给的默认位置；没绑目录的对话，工具都落在这里
function archiveDir() {
  if (apiBase === null) return "";
  return (store.settings.archiveDir || "").trim() || bootstrap.work?.archive || "";
}
// 言里的草稿：卷宗下的隐藏目录 .草稿/<对话id>/，脚本与中间文件放那里，成品放根目录；卷宗页不列它
/** @param {Conversation} c */
function scratchRel(c) {
  return `${bootstrap.work?.scratch || ".草稿"}/${String(c.id)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 12)}`;
}
// 这段对话的工具落脚在哪：绑了目录是它，没绑是卷宗；直连没桥接时为空（也就没有文件工具）
/** @param {Conversation} c */
function workRoot(c) {
  return c?.workdir || (apiBase !== null ? archiveDir() : "");
}
function rememberWorkdir(dir) {
  store.settings.recentWorkdirs = [dir, ...(store.settings.recentWorkdirs || []).filter(item => item !== dir)].slice(0, 8);
}
// 侧栏的一枚印：只显示当前的态（言 / 行），改态的入口是目录签
function renderModeSwitch() {
  const work = workMode(),
    seal = $("#modeSeal");
  if (!seal) return;
  seal.dataset.mode = work ? "work" : "chat";
  seal.querySelector(".rail-icon").textContent = work ? "行" : "言";
  seal.querySelector(".wide").textContent = work ? "执事" : "对谈";
  seal.title = work ? "行 · 执事：指令与改动落在工作目录" : "言 · 对谈：产出收入卷宗";
}
// 问而后行 / 径行：只有行才有这一档；言里落在卷宗的指令径直执行
function renderWorkAuto() {
  const c = currentConversation(),
    button = $("#workAuto");
  if (!button) return;
  const show = !!c && isWork(c) && activeProfile()?.tools !== false;
  button.classList.toggle("hidden", !show);
  if (!show) return;
  button.textContent = c.workAuto ? "径行" : "问而后行";
  button.title = c.workAuto ? "径行：指令径直执行" : "问而后行：每条指令先经确认";
  button.classList.toggle("on", !!c.workAuto);
}
function renderWelcome() {
  const work = workMode(),
    bridged = apiBase !== null;
  $("#welcome .seal").textContent = work ? "行" : "言";
  $("#welcomeSub").textContent = work ? "以目录为案，言起而事行" : "长问慢答，尽付纸墨";
  renderChips(work, bridged);
  renderSuggestions(work);
  renderWelcomeNotice();
}
// 首次使用：还没有任何模型配置时，在输入框下给一行引导，而不是等到发送时才弹提示
function renderWelcomeNotice() {
  const el = $("#welcomeNotice");
  if (!el) return;
  const none = !profiles().length;
  el.classList.toggle("hidden", !none);
  if (!none) return;
  el.innerHTML = `<span class="seal" aria-hidden="true">始</span><span>尚未接入模型。任何 OpenAI 兼容接口均可使用，配置只存于此浏览器。</span><button type="button" data-open-models>前往设置 →</button>`;
  el.querySelector("[data-open-models]").onclick = () => openSettings("models");
}
// 欢迎页输入框上方的一行小签：目录签（空着是言、落在卷宗；填了是行）、问而后行 / 径行
function pathTail(dir) {
  const parts = String(dir || "")
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts.at(-1) || dir;
}
function renderChips(work, bridged) {
  const dirChip = $("#workdirChip"),
    pending = (store.settings.pendingWorkdir || "").trim();
  dirChip.classList.remove("hidden");
  dirChip.querySelector(".chip-text").textContent = pending ? pathTail(pending) : bridged ? "卷宗" : "未绑定";
  dirChip.title = pending
    ? `${pending}\n行：指令与改动落在此目录`
    : bridged
      ? `言：产出收入卷宗（${archiveDir()}）`
      : "言：绑定目录与生成文件需本机桥接（start.cmd）";
  dirChip.classList.toggle("on", !!pending);
  const approve = $("#approveChip");
  approve.classList.toggle("hidden", !work);
  approve.querySelector(".chip-text").textContent = store.settings.workAutoDefault ? "径行" : "问而后行";
  approve.classList.toggle("on", !!store.settings.workAutoDefault);
  approve.title = store.settings.workAutoDefault ? "径行：新对话中的指令径直执行" : "问而后行：新对话中每条指令先经确认";
}
function closeChipPop() {
  document.querySelectorAll(".chip-pop").forEach(pop => pop.remove());
}
function openChipPop(anchor, host, html) {
  closeChipPop();
  const pop = document.createElement("div");
  pop.className = "chip-pop";
  pop.innerHTML = html;
  pop.style.left = `${anchor.offsetLeft}px`;
  host.append(pop);
  return pop;
}
// 浮层菜单：挂在 body 上、按锚点定位（fixed），不受侧栏与输入区的滚动、overflow 裁剪；贴近锚点，上下空间不够就翻向另一侧。
// 与目录签的弹层同一套 .chip-pop 外观与关闭逻辑：点别处、Esc、锚点所在容器滚动都收
function openFloatingPop(anchor, html, { align = "left", menu = true } = {}) {
  closeChipPop();
  const pop = document.createElement("div");
  pop.className = `chip-pop floating${menu ? " chip-menu" : ""}`;
  pop.innerHTML = html;
  pop.addEventListener("click", event => event.stopPropagation());
  document.body.append(pop);
  const rect = anchor.getBoundingClientRect(),
    gap = 6,
    edge = 10;
  const width = pop.offsetWidth,
    height = pop.offsetHeight;
  const below = innerHeight - rect.bottom - gap,
    up = below < height + edge && rect.top - gap > below;
  pop.classList.toggle("drop-up", up);
  const top = up ? rect.top - gap - height : rect.bottom + gap;
  let left = align === "right" ? rect.right - width : rect.left;
  left = Math.max(edge, Math.min(left, innerWidth - width - edge));
  pop.style.top = `${Math.max(edge, top)}px`;
  pop.style.left = `${left}px`;
  const scroller = anchor.closest("#history, #chatScroll, .composer-area");
  scroller?.addEventListener("scroll", closeChipPop, { once: true, passive: true });
  return pop;
}
// 附件签「＋」：展开后二选一——外件（本机文件）或卷宗（已收入的文件，点选即置于案上）
function openAttachMenu(anchor) {
  if (document.querySelector(".chip-pop[data-kind=attach]")) return closeChipPop();
  const total = libraryTotal();
  const pop = openFloatingPop(
    anchor,
    `<button type="button" data-attach="file"><span>外件</span><small>本机文件</small></button><button type="button" data-attach="archive"><span>卷宗</span><small>${total ? `${total} 件` : "尚空"}</small></button>`
  );
  pop.dataset.kind = "attach";
  pop.querySelector('[data-attach="file"]').onclick = () => {
    closeChipPop();
    $("#fileInput").click();
  };
  pop.querySelector('[data-attach="archive"]').onclick = () => {
    if (!total) return toast("卷宗尚空");
    renderArchivePicker(pop, anchor);
  };
}
// 卷宗选件：一栏可查找的清单，磁盘上的与浏览器内的都列，点一件即置于案上
function renderArchivePicker(pop, anchor) {
  const disk = archiveOnline() ? archiveEntries || [] : [],
    items = [
      ...disk.map(file => ({ key: `disk:${file.path}`, name: file.name, size: file.size })),
      ...store.library.map(file => ({ key: `item:${file.id}`, name: file.name, size: file.size }))
    ];
  pop.classList.add("attach-picker");
  pop.innerHTML = `<input class="field" placeholder="按文件名查找" aria-label="查找卷宗"><div class="chip-pop-list"></div>`;
  const input = pop.querySelector("input"),
    list = pop.querySelector(".chip-pop-list");
  const paint = () => {
    const query = input.value.trim().toLowerCase(),
      shown = items.filter(item => !query || item.name.toLowerCase().includes(query));
    list.innerHTML = shown.length
      ? shown
          .map(
            item =>
              `<button type="button" data-pick="${escapeHtml(item.key)}" title="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span><small>${formatFileSize(item.size)}</small></button>`
          )
          .join("")
      : `<div class="chip-pop-label">没有匹配的卷宗</div>`;
  };
  paint();
  input.addEventListener("input", paint);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector("[data-pick]")?.click();
    }
  });
  list.addEventListener("click", event => {
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    const [kind, ...rest] = button.dataset.pick.split(":"),
      key = rest.join(":");
    closeChipPop();
    void (kind === "disk" ? placeFromArchive(key) : placeFromLibrary(key));
  });
  // 清单比菜单高，重新贴一次锚点
  const rect = anchor.getBoundingClientRect(),
    height = pop.offsetHeight;
  if (pop.classList.contains("drop-up") || innerHeight - rect.bottom - 6 < height + 10) {
    pop.classList.add("drop-up");
    pop.style.top = `${Math.max(10, rect.top - 6 - height)}px`;
  }
  setTimeout(() => input.focus(), 0);
}
// 历史条目的「⋯」：置顶、改名、绑定（更换目录）、删除
function openHistoryMenu(id, anchor) {
  const c = store.conversations.find(item => item.id === id);
  if (!c) return;
  if (document.querySelector(`.chip-pop[data-kind=history][data-for="${CSS.escape(id)}"]`)) return closeChipPop();
  const pop = openFloatingPop(
    anchor,
    `<button type="button" data-menu="pin">${c.pinned ? "取消置顶" : "置顶"}</button><button type="button" data-menu="rename">改名</button><button type="button" data-menu="bind">${isWork(c) ? "更换目录" : "绑定目录"}</button><button type="button" data-menu="export"><span>导出</span><small>${archiveOnline() ? "存入卷宗" : "Markdown"}</small></button><button type="button" class="danger" data-menu="delete">删除</button>`,
    { align: "right" }
  );
  pop.dataset.kind = "history";
  pop.dataset.for = id;
  pop.addEventListener("click", event => {
    const button = event.target.closest("[data-menu]");
    if (!button) return;
    closeChipPop();
    const action = button.dataset.menu;
    if (action === "pin") togglePin(id);
    else if (action === "rename") startRename(id);
    else if (action === "delete") deleteConversation(id);
    else if (action === "export") void exportConversationMarkdown(c);
    else if (action === "bind") {
      if (c.ended) return toast("此对话已收尾，请翻页后再绑定目录");
      openWorkdirPop({
        anchor: anchor.closest(".history-item") || anchor,
        host: null,
        value: c.workdir || "",
        live: false,
        bound: isWork(c),
        floating: true,
        onCommit: dir => void bindWorkdir(c, dir)
      });
    }
  });
}
// 目录签的弹层，欢迎页与对话页共用：输入 / 选择 / 最近；live 时每敲一字都落值（欢迎页记到待绑目录），否则回车、点选才落值（对话页要经桥接绑定）
// floating：不挂在 host 里而是浮在锚点旁（侧栏历史条目的「绑定目录」用），其余一样
function openWorkdirPop({ anchor, host, value, live, bound, onCommit, floating = false }) {
  if (apiBase === null) {
    void ensureLocalBridge();
    return toast("绑定目录需要本机桥接，请先运行 start.cmd");
  }
  if ((floating ? document : host).querySelector(".chip-pop[data-kind=workdir]")) return closeChipPop();
  const recent = store.settings.recentWorkdirs || [];
  const html = `<div class="chip-pop-row"><input id="workdirInput" class="field" spellcheck="false" autocomplete="off" placeholder="${live ? "留空则为言" : "输入或选择目录"}" value="${escapeHtml(value || "")}"><button id="workdirPick" class="outline-btn" type="button">选择…</button>${live ? "" : `<button id="workdirCommit" class="outline-btn" type="button">${bound ? "更换" : "绑定"}</button>`}</div>${recent.length ? `<div class="chip-pop-list"><div class="chip-pop-label">最近</div>${recent.map(dir => `<button type="button" data-dir="${escapeHtml(dir)}" title="${escapeHtml(dir)}">${escapeHtml(dir)}</button>`).join("")}</div>` : ""}${bound ? `<button type="button" class="chip-pop-unbind" data-unbind>解开目录，回到言</button>` : live ? `<button type="button" class="chip-pop-unbind${value ? "" : " hidden"}" data-unbind>不绑目录，回到言</button>` : ""}<small>指令由 ${escapeHtml(bootstrap.work?.shell || "本机 shell")} 执行；${live ? `不绑目录时落在卷宗 ${escapeHtml(archiveDir())}` : "上下文不变，此后的改动落在该目录"}</small>`;
  const pop = floating ? openFloatingPop(anchor, html, { align: "right", menu: false }) : openChipPop(anchor, host, html);
  pop.dataset.kind = "workdir";
  const input = pop.querySelector("#workdirInput"),
    commit = (dir, close = false) => {
      onCommit(dir.trim());
      if (close) closeChipPop();
      else if (live) pop.querySelector("[data-unbind]")?.classList.toggle("hidden", !dir.trim());
    };
  if (live) input.addEventListener("input", () => commit(input.value));
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (live) {
      closeChipPop();
      $("#welcomeInput").focus();
    } else commit(input.value, true);
  });
  pop.querySelector("#workdirCommit")?.addEventListener("click", () => commit(input.value, true));
  pop.querySelector("[data-unbind]")?.addEventListener("click", () => commit("", true));
  pop.querySelectorAll("[data-dir]").forEach(
    button =>
      (button.onclick = () => {
        input.value = button.dataset.dir;
        commit(input.value, true);
      })
  );
  // 「选择…」：由桥接弹出本机的文件夹对话框，选好回填
  pop.querySelector("#workdirPick").onclick = async () => {
    const button = pop.querySelector("#workdirPick");
    button.disabled = true;
    button.textContent = "选择中…";
    try {
      const data = await bridge("/api/work/pick", { current: input.value.trim() }, AbortSignal.timeout(300000));
      if (data.path) {
        input.value = data.path;
        commit(data.path, !live);
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      button.disabled = false;
      button.textContent = "选择…";
    }
  };
  setTimeout(() => input.focus(), 0);
}
// 对话中途绑上 / 解开目录：只是给对话记一个目录，下一问起工具与提示词随之而变，历史一字不丢
/** @param {Conversation} c */
async function bindWorkdir(c, dir) {
  dir = String(dir || "").trim();
  if (!dir) {
    if (!isWork(c)) return;
    c.workdir = "";
    saveStore();
    render();
    toast("已解开目录，回到言");
    return;
  }
  if (activeProfile()?.tools === false) return toast("当前模型已关闭本机工具，请在模型高级配置中开启");
  if (apiBase === null && !(await ensureLocalBridge())) return toast("绑定目录需要本机桥接，请先运行 start.cmd");
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: dir }, AbortSignal.timeout(8000));
    if (prepared.workdir === c.workdir) return;
    c.workdir = prepared.workdir;
    if (c.workAuto === undefined) c.workAuto = !!store.settings.workAutoDefault;
    rememberWorkdir(prepared.workdir);
    saveStore();
    render();
    toast(`已绑定 ${pathTail(prepared.workdir)}${prepared.created ? "（新建）" : ""}，此后为行`);
  } catch (error) {
    toast(`工作目录不可用：${String(error.message || error)}`);
  }
}
function setupChips() {
  const chips = $("#welcomeChips");
  chips.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", closeChipPop);
  $("#workdirChip").onclick = () =>
    openWorkdirPop({
      anchor: $("#workdirChip"),
      host: chips,
      value: store.settings.pendingWorkdir || "",
      live: true,
      bound: false,
      onCommit: dir => {
        if (dir) store.settings.pendingWorkdir = dir;
        else delete store.settings.pendingWorkdir;
        saveStoreSoon();
        renderHeader();
        renderHistory();
      }
    });
  $("#approveChip").onclick = () => {
    store.settings.workAutoDefault = !store.settings.workAutoDefault;
    saveStore();
    renderChips(workMode(), apiBase !== null);
  };
  // 对话页标题下的目录签：绑上、更换或解开
  const meta = $("#chatMeta");
  meta.addEventListener("click", event => {
    if (event.target.closest(".chip-pop")) return event.stopPropagation();
    if (event.target.closest("[data-export-md]")) return void exportConversationMarkdown(currentConversation());
    const button = event.target.closest("[data-workdir-bind]");
    if (!button) return;
    event.stopPropagation();
    const c = currentConversation();
    if (!c) return;
    if (c.ended) return toast("此对话已收尾，请翻页后再绑定目录");
    openWorkdirPop({
      anchor: button,
      host: meta,
      value: c.workdir || "",
      live: false,
      bound: isWork(c),
      onCommit: dir => void bindWorkdir(c, dir)
    });
  });
}
function newChat() {
  closeSidePanel();
  persistDraft();
  rememberScrollPosition();
  pendingAttachments = [];
  currentId = null;
  editingMessageId = null;
  view = "chat";
  render();
  setTimeout(() => $("#welcomeInput").focus(), 0);
  if (isMobile()) toggleSidebar(true);
}
function openConversation(id) {
  if (id !== currentId) {
    closeSidePanel();
    persistDraft();
    rememberScrollPosition();
    pendingAttachments = [];
  }
  currentId = id;
  editingMessageId = null;
  view = "chat";
  const c = currentConversation();
  if (c) {
    c.unread = false;
    c.profileId && selectProfile(c.profileId, false);
  }
  render();
  if (isMobile()) toggleSidebar(true);
}
async function deleteConversation(id) {
  const removed = store.conversations.find(c => c.id === id);
  if (!removed) return;
  if (!(await askConfirm({ title: "删除这段对话？", body: `「${removed.title}」将连同其附件一起移除，无法撤销。`, ok: "删除" }))) return;
  if (conversationRunning(id)) stopGeneration(id);
  for (const [key, job] of requestJobs)
    if (job.conversationId === id) {
      job.controller.abort();
      requestJobs.delete(key);
    }
  if (currentId === id) closeSidePanel();
  const draftFiles = draftRecord(id).attachments.map(file => file.id);
  clearDraft(id);
  void cleanScratch(removed);
  void deleteAttachments([...attachmentIds(allMessages(removed)), ...draftFiles]);
  store.conversations = store.conversations.filter(c => c.id !== id);
  if (currentId === id) {
    currentId = null;
    pendingAttachments = [];
  }
  saveStore();
  render();
  toast("对话已删除");
}
function togglePin(id) {
  const c = store.conversations.find(item => item.id === id);
  if (!c) return;
  c.pinned = !c.pinned;
  saveStore();
  renderHistory();
}
function startRename(id) {
  renamingId = id;
  renderHistory();
}
function commitRename(value) {
  const id = renamingId;
  renamingId = null;
  if (id) renameConversation(id, value);
  else renderHistory();
}
function renameConversation(id, value) {
  const c = store.conversations.find(item => item.id === id),
    title = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  if (c && title && title !== c.title) {
    c.title = title;
    c.titleAuto = false;
    saveStore();
  }
  renderHistory();
  if (c && currentId === id) {
    $("#chatTitle").textContent = c.title;
    syncDocumentTitle();
  }
}
function selectProfile(id, shouldRender = true) {
  if (!profiles().some(p => p.id === id)) return;
  const c = currentConversation(),
    wasDry = conversationDry(c);
  store.settings.activeProfileId = id;
  if (c) c.profileId = id;
  saveStore();
  closeModelMenu();
  if (shouldRender) {
    renderHeader();
    if (c && view === "chat" && wasDry !== conversationDry(c)) renderConversation();
    renderSendButtons();
  }
}

function syncJumpBottom(gap) {
  const el = $("#chatScroll");
  if (gap === undefined) gap = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
  $("#jumpBottom").classList.toggle("hidden", view !== "chat" || !currentId || gap < 260);
}
function syncDocumentTitle() {
  const c = currentConversation();
  document.title = view === "library" ? "卷宗 · 言" : c ? `${c.title} · 言` : "言";
}
