// 言 · 启动、全局事件绑定、侧栏
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 停在「生成中」却没人在写的消息（页面刷新了、写的那一处关了）：按中断收束，已写的留着。改了返回 true
/** @param {Conversation} conversation */
function recoverConversation(conversation) {
  let changed = false;
  for (const message of conversation.messages || [])
    if (message.status === "streaming") {
      message.status = "interrupted";
      message.error = "页面刷新或连接中断，已生成的内容已保留";
      message.interruptedAt = now();
      // 用时停在最后一次存盘时（作答时每秒记一回），起始时刻不再有用
      delete message.startedAt;
      settleSteps(message, "连接中断");
      changed = true;
    } else if ((message.steps || []).some(step => step.sub && step.status === "running") && !crewRunning(conversation.id)) {
      // 这一答早写完了，后台的帮手却还记着「在做」：做它的那一处已经不在了
      settleSteps(message, "页面刷新，帮手已中断");
      changed = true;
    }
  for (const thread of conversation.threads || [])
    for (const message of thread.messages || [])
      if (message.status === "streaming") {
        message.status = message.content ? "stopped" : "error";
        message.error = "页面刷新或连接中断";
        changed = true;
      }
  return changed;
}
// 开页时收束一遍；别处正作答的不算（见 syncLeases）。还在等的后台指令重新等上
function recoverInterruptedMessages() {
  let changed = false;
  for (const conversation of store.conversations)
    if (!remoteBusy.has(conversation.id) && recoverConversation(conversation)) {
      markDirty(conversation.id);
      changed = true;
    }
  if (changed) saveStore();
}
async function boot() {
  await awaitBridge();
  // 浏览器里暂存的（桥接中途断过时没落成盘的对话、上次离页兜住的最新状态）先读回，再与存储根（默认 ~/.yan）里的正本合一次
  await hydrateStore();
  setupMarkdown();
  await syncConfigWithDisk();
  await syncChatsWithDisk();
  // MCP 服务起得慢（起进程、握手）：先起着，头一问发出前会等它；环境备没备好也问一声，系统提示里要说
  void mcpReady();
  void refreshEnv();
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
  // 先问一声别处在作答什么，那几段不当成中断
  await syncLeases();
  recoverInterruptedMessages();
  rewatchBackground();
  applyAppearance();
  bindEvents();
  // 模型所用的浏览器若已开着（页面刷新过、桥接重启过），看台直接接上
  void stageLocate();
  (window.requestIdleCallback || (fn => setTimeout(fn, 800)))(() => void themeSheets());
  void refreshArchive();
  // 侧栏的开合记在本机（不随备份走）：宽屏按上次的来，窄屏一律收起；theme-boot 已按同一记录先把宽度放好，这里接过来
  toggleSidebar(isMobile() || localStorage.getItem("yan-sidebar") === "collapsed");
  delete document.documentElement.dataset.sidebar;
  restorePlace();
  render();
  // 低频的全量巡检：哪段改了没标到也兜得住；页面藏起来时也巡一趟（手机切走常常就不回来了）
  setInterval(() => {
    sweepConversations();
    // 开页时对话目录没读成（桥接闪断、目录大到超时）：巡检时再试，不然整个会话都只存进浏览器
    if (chatsBroken) resyncWithDisk();
  }, 45000);
  // 报到：这边在作答什么、别处在作答什么（作答的一处三秒存一次盘，跟着看的一处也三秒读一次）
  setInterval(() => void syncLeases(), 3000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sweepConversations();
    else {
      void refreshConfigFromDisk();
      // 藏着时报到被浏览器节流，别处在这段里答完了也未必察觉：回到前台先跟上看着的这段，再往里说话
      if (currentId) void catchUpFromDisk([currentId]);
    }
  });
}

function bindEvents() {
  $("#collapseSidebar").onclick = () => toggleSidebar();
  $("#mobileMenu").onclick = () => toggleSidebar(false);
  // 侧栏的翻页是散列的一段；要归进某组从组首「＋」起
  $("#newChat").onclick = () => {
    delete store.settings.pendingGroupId;
    newChat();
  };
  $("#openLibrary").onclick = () => (view === "library" ? closeLibrary() : openLibrary());
  $("#openGroups").onclick = () => (view === "groups" ? closeGroupsPage() : openGroupsPage());
  bindSettingsShell();
  bindModelMenuEvents();
  $("#themeToggle").onclick = e => switchTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", e.currentTarget);
  $("#quotaStatus").onclick = () => openSettings("models");
  document.querySelectorAll(".send-trigger").forEach(button => (button.onclick = sendOrStop));
  document.querySelectorAll(".attach-trigger").forEach(
    button =>
      (button.onclick = event => {
        event.stopPropagation();
        openAttachMenu(button);
      })
  );
  $("#confirmOk").onclick = () => settleConfirm(true);
  $("#confirmCancel").onclick = () => settleConfirm(false);
  $("#confirmModal").addEventListener("click", e => {
    if (e.target === $("#confirmModal")) settleConfirm(false);
  });
  $("#confirmModal").addEventListener("keydown", e => {
    if (e.key === "Tab") trapModalFocus(e, $("#confirmModal"));
  });
  bindViewerEvents();
  bindComposerEvents();
  bindLibraryEvents();
  bindHistoryEvents();
  bindMessageActionEvents();
  bindTrailEvents();
  bindApprovalEvents();
  bindHelperEvents();
  setupChips();
  setupQuoteTip();
  setupSidePanel();
  bindContentEvents();
  bindAttachmentEvents();
  bindStage();
  bindStageInk();
  // Esc 收最上面开着的那一层浮层（各层在自己那一段登记，见 03-ui-utils.js 的 LAYERS）
  window.addEventListener("keydown", e => {
    if (e.key === "Escape") closeTopLayer();
  });
  bindScrollEvents();
  bindOutlineEvents();
  const flushPageState = () => {
    persistDraft();
    flushOnUnload();
    releaseLeases();
  };
  // beforeunload 比 pagehide 早，给 IndexedDB 事务多一点提交时间；pagehide 仍兜住不派 beforeunload 的移动端 / 缓存路径。
  // flushOnUnload 自身幂等，不会因为两者都到而重复写。
  window.addEventListener("beforeunload", flushPageState);
  window.addEventListener("pagehide", flushPageState);
  // 从前进 / 后退缓存回来仍是同一份 JS 状态：允许它在下一次离页时再次落盘。
  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      unloading = false;
      void refreshConfigFromDisk();
      if (currentId) void catchUpFromDisk([currentId]);
      void refreshEnv();
    }
  });
  let wasMobile = isMobile();
  window.addEventListener("resize", () => {
    const mobile = isMobile();
    if (mobile && !wasMobile) toggleSidebar(true);
    wasMobile = mobile;
    syncScrim();
    syncChatScrollGrabber();
  });
  $("#sidebarScrim").onclick = () => toggleSidebar(true);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (store.settings.theme === "system") {
      applyAppearance();
      if (view === "chat") renderConversation(false);
    }
  });
  reducedMotion.addEventListener?.("change", () => {
    if (store.settings.inkMotion === "system") applyAppearance();
  });
}

function syncScrim() {
  $("#sidebarScrim").classList.toggle("hidden", !isMobile() || $("#sidebar").classList.contains("collapsed"));
}
function toggleSidebar(force) {
  const sidebar = $("#sidebar"),
    collapsed = force ?? !sidebar.classList.contains("collapsed");
  sidebar.classList.toggle("collapsed", collapsed);
  if (!isMobile())
    try {
      localStorage.setItem("yan-sidebar", collapsed ? "collapsed" : "open");
    } catch {}
  syncScrim();
  const button = $("#collapseSidebar");
  button.textContent = collapsed ? "›" : "‹";
  button.title = collapsed ? "展开侧栏" : "收起侧栏";
}
function toggleHistorySearch(force) {
  const wrap = $("#historySearchWrap"),
    show = force ?? wrap.classList.contains("hidden");
  wrap.classList.toggle("hidden", !show);
  $("#historySearchToggle").classList.toggle("active", show);
  if (show) setTimeout(() => $("#historySearch").focus(), 0);
  else {
    clearTimeout(historySearchTimer);
    if (historyQuery) {
      historyQuery = "";
      $("#historySearch").value = "";
      renderHistory();
    }
  }
}
// 执事 / 对谈：模式跟着正在看的对话走；「翻页」按当前模式新起一段
