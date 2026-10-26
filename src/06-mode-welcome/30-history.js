// 言 · 开合对话：新建、点开、删除、置顶、改名、换模型，侧栏历史的菜单与事件，正文的滚动标志与页题
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 历史条目的「⋯」：置顶、改名、绑定（更换目录）、分组、导出、删除
function openHistoryMenu(id, anchor) {
  const c = store.conversations.find(item => item.id === id);
  if (!c) return;
  // 菜单开着时侧栏可能重画过（别段作答、拟题），旧行已脱页、量出 (0, 0)：子浮层点下去那一刻再找这一行
  const row = () =>
    document.querySelector(`#history .history-item[data-conversation="${CSS.escape(id)}"]`) || anchor.closest(".history-item") || anchor;
  openMenu(
    anchor,
    [
      ...(PANE || isMobile()
        ? []
        : [
            splitHolds(id)
              ? {
                  id: "split",
                  label: split.panes.length > 1 ? t`收起第 ${splitSlotOf(id) + 1} 栏` : t("收起右栏"),
                  run: () => void closeSplit(splitSlotOf(id), id)
                }
              : split.panes.length >= MAX_SPLIT_PANES || splitRoom() <= 0
                ? { id: "split", label: t("在右栏打开"), note: splitFullByOthers() ? t("别处占着") : t("已满四栏"), disabled: true, run: () => {} }
                : { id: "split", label: t("在右栏打开"), note: t("并排看"), run: () => void openSplit(id) }
          ]),
      { id: "pin", label: c.pinned ? t("取消置顶") : t("置顶"), run: () => togglePin(id) },
      { id: "rename", label: t("改名"), run: () => startRename(id) },
      {
        id: "bind",
        label: isWork(c) ? t("更换目录") : t("绑定目录"),
        run: () =>
          openWorkdirPop({
            anchor: row(),
            host: null,
            value: c.workdir || "",
            live: false,
            bound: isWork(c),
            floating: true,
            onCommit: dir => void bindWorkdir(c, dir)
          })
      },
      { id: "group", label: groupOf(c) ? t("移至他组") : t("移入分组"), run: () => openMoveMenu(c, row()) },
      { id: "export", label: t("导出"), note: t("存入卷宗"), run: () => void exportConversationMarkdown(c) },
      { id: "delete", label: t("删除"), danger: true, run: () => deleteConversation(id) }
    ],
    { kind: "history", key: id }
  );
}
function newChat() {
  closeSidePanel();
  persistDraft();
  rememberScrollPosition();
  pendingAttachments = [];
  pendingProfileId = "";
  currentId = null;
  editingMessageId = null;
  view = "chat";
  render();
  setTimeout(() => $("#welcomeInput").focus(), 0);
  if (isMobile()) toggleSidebar(true);
}
function openConversation(id) {
  // 右栏里要换对话的交回主页面开；开在某一栏的那段，左边不再开一份，光标送过去
  if (PANE && id !== currentId && splitHandOff(id)) return;
  const held = splitSlotOf(id);
  if (held >= 0) return focusSplit(held);
  if (id !== currentId) {
    closeSidePanel();
    persistDraft();
    rememberScrollPosition();
    pendingAttachments = [];
    // 改到一半的问只在真换了对话时作罢：在侧栏点一下正开着的这段，不冲掉它
    editingMessageId = null;
  }
  currentId = id;
  view = "chat";
  const c = currentConversation();
  if (c) {
    c.unread = false;
    // 新对话照最近看的这段用的预设（预设带了模型的，新对话也就用那个模型）
    store.settings.presetId = presetOf(c)?.id || "";
    // 别处可能在这段里写过而这边没察觉（报到有间隔）：读一下目录里那份，新就跟上
    void catchUpFromDisk([c.id]);
  }
  render();
  if (isMobile()) toggleSidebar(true);
}
async function deleteConversation(id) {
  const removed = store.conversations.find(c => c.id === id);
  if (!removed) return;
  // 那一处还在写，删了它也会写回来
  if (runningElsewhere(id)) return toast(t("此对话正在另一页面作答，暂不能删除"));
  if (!(await askConfirm({ title: t("删除这段对话？"), body: t`「${removed.title}」将连同其附件一起移除，无法撤销。`, ok: t("删除") })))
    return;
  // 主答、旁注、后台的帮手一并停下，后台指令连进程收掉
  haltConversation(id, { removing: true });
  if (currentId === id) closeSidePanel();
  const draftFiles = draftRecord(id).attachments.map(file => file.id);
  clearDraft(id);
  void cleanScratch(removed);
  void deleteAttachments([...attachmentIds(everyMessage(removed)), ...draftFiles]);
  store.conversations = store.conversations.filter(c => c.id !== id);
  void deleteConversationStorage(id);
  if (currentId === id) {
    currentId = null;
    pendingAttachments = [];
  }
  saveStore();
  render();
  toast(t("对话已删除"));
}
function togglePin(id) {
  const c = store.conversations.find(item => item.id === id);
  if (!c) return;
  c.pinned = !c.pinned;
  markDirty(id);
  saveStore();
  renderHistory();
}
function startRename(id) {
  renamingId = id;
  renamingDirty = false;
  renderHistory();
}
function commitRename(value) {
  const id = renamingId;
  renamingId = null;
  const changed = renamingDirty;
  renamingDirty = false;
  if (id && changed) renameConversation(id, value);
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
    markDirty(id);
    saveStore();
  }
  renderHistory();
  if (c && currentId === id) {
    $("#chatTitle").textContent = c.title;
    syncDocumentTitle();
  }
}
function selectProfile(id, shouldRender = true) {
  const profile = profiles().find(p => p.id === id);
  if (!profile) return;
  const c = currentConversation(),
    wasDry = conversationDry(c);
  // 换模型只换眼前这段（还没发出的新对话记在 pendingProfileId），默认模型不动；档位取新模型记住的那档
  const reasoning = normalizeReasoning(profile.reasoning);
  if (c) {
    if (c.profileId !== id || c.reasoning !== reasoning) {
      c.profileId = id;
      c.reasoning = reasoning;
      markDirty(c.id);
      saveStore();
    }
  } else pendingProfileId = id;
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
function syncChatScrollGrabber() {
  const host = $("#chatScroll"),
    grabber = $("#chatScrollGrabber");
  if (!host || !grabber) return;
  grabber.classList.toggle("active", view === "chat" && !!currentId && host.scrollHeight > host.clientHeight + 1);
}
function syncDocumentTitle() {
  const c = currentConversation();
  document.title = view === "library" ? t("卷宗 · 言") : view === "groups" ? t("分组 · 言") : c ? t`${c.title} · 言` : t("言");
  renderRunningHead(); // 标题改了（手改、拟题），书眉跟着换
}

let historySearchTimer = null;
// 侧栏的对话历史（检索、点开、改名）与正文顶上的题名
function bindHistoryEvents() {
  $("#historySearch").addEventListener("input", e => {
    historyQuery = e.target.value;
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(renderHistory, 120);
  });
  $("#historySearch").addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.stopPropagation();
      toggleHistorySearch(false);
    }
  });
  $("#historySearchToggle").onclick = () => toggleHistorySearch();
  $("#historySearchClose").onclick = () => toggleHistorySearch(false);
  $("#history").addEventListener("dblclick", e => {
    const item = e.target.closest("[data-conversation]");
    if (item && !e.target.closest(".history-rename, [data-history-action]")) startRename(item.dataset.conversation);
  });
  $("#history").addEventListener("click", e => {
    const toggle = e.target.closest("[data-repo-toggle]");
    if (toggle) {
      const dir = toggle.dataset.repoToggle,
        set = new Set(store.settings.collapsedRepos || []);
      set.has(dir) ? set.delete(dir) : set.add(dir);
      store.settings.collapsedRepos = [...set];
      saveStoreSoon();
      const at = `.history-repo-group[data-repo="${CSS.escape(dir)}"]`;
      morphHeight(toggle.closest(".history-repo-group"), renderHistory, 300, () => $("#history").querySelector(at));
      return;
    }
    const repo = e.target.closest("[data-history-workdir]");
    if (repo) {
      store.settings.pendingWorkdir = repo.dataset.historyWorkdir;
      saveStore();
      newChat();
      return;
    }
    const item = e.target.closest("[data-conversation]");
    if (!item) return;
    const id = item.dataset.conversation,
      action = e.target.closest("[data-history-action]")?.dataset.historyAction;
    if (action === "menu") {
      e.stopPropagation();
      openHistoryMenu(id, e.target.closest("[data-history-action]"));
    } else if (!e.target.closest(".history-rename")) openConversation(id);
  });
  $("#history").addEventListener("keydown", e => {
    const input = e.target.closest(".history-rename");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter 本身就是明确提交；也照顾脚本/输入法最后一拍尚未来得及冒 input 事件的情形。
      renamingDirty = true;
      commitRename(input.value);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      renamingId = null;
      renamingDirty = false;
      renderHistory();
    }
  });
  $("#history").addEventListener("input", e => {
    if (e.target.closest(".history-rename") && renamingId) renamingDirty = true;
  });
  $("#history").addEventListener("focusout", e => {
    const input = e.target.closest(".history-rename");
    if (input && renamingId && !renderingHistory) commitRename(input.value);
  });
  const title = $("#chatTitle");
  let titleDirty = false,
    titleCanceled = false;
  title.addEventListener("focus", () => {
    titleDirty = false;
    titleCanceled = false;
  });
  title.addEventListener("input", () => (titleDirty = true));
  title.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      titleCanceled = true;
      title.textContent = currentConversation()?.title || "";
      title.blur();
    }
  });
  title.addEventListener("blur", () => {
    const c = currentConversation();
    if (!c) return;
    const value = title.textContent.replace(/\s+/g, " ").trim();
    if (!titleCanceled && titleDirty && value && value !== c.title) renameConversation(c.id, value);
    else title.textContent = c.title;
    titleDirty = false;
    titleCanceled = false;
  });
}
