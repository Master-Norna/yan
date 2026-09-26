// 言 · 桥接连接、启动与全局事件绑定、侧栏
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 页面是不是桥接自己开的（http://127.0.0.1:端口）：是的话桥接一定在，探测失败多半只是首次加载时被大文件挤慢了，该多等、多试
function servedByBridge() {
  return /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/i.test(location.hostname);
}
async function connectBridge(candidates, timeout = 1400) {
  // 从文件直接打开的页面不接桥接：它的浏览器存储与桥接页面分开，常是很久以前的旧记录，接上就可能把它当正本写回 配置.json
  //（VS Code 内置浏览器里曾这样整份冲掉过配置）。桥接那头也不认来源为 null 的请求，这里再守一道，不依赖浏览器发什么头
  if (location.protocol === "file:") return false;
  for (const candidate of candidates) {
    // 同源探测：首次打开时浏览器还在拉 vendor 里的几个大文件，引导请求排在后面，1.4 秒不够，给足时间
    const wait = candidate === "" && servedByBridge() ? Math.max(timeout, 8000) : timeout;
    try {
      const response = await fetch(`${candidate}/api/bootstrap`, { signal: AbortSignal.timeout(wait) });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) continue;
      const next = await response.json();
      bootstrap = next;
      apiBase = candidate;
      if (next.stale) toast("本机桥接的代码已更新，请关掉桥接窗口、重新运行 start.cmd", 8000);
      return true;
    } catch {}
  }
  return false;
}
// 桥接开的页面却没探到桥接：不急着下「未检测到」的结论，隔几秒再试几次，接上后各处自会刷新
function retryBridgeLater(attempt = 0) {
  if (apiBase !== null || attempt >= 6) return;
  setTimeout(
    async () => {
      if (apiBase !== null) return;
      bridgeRetryAt = 0;
      if (!(await ensureLocalBridge())) retryBridgeLater(attempt + 1);
    },
    Math.min(2000 * 2 ** attempt, 20000)
  );
}
async function ensureLocalBridge() {
  if (apiBase !== null) return true;
  if (Date.now() < bridgeRetryAt) return false;
  bridgeRetryAt = Date.now() + 5000;
  // 桥接开的页面先试同源（端口可能不是默认的 8787），再试默认地址
  const connected = await connectBridge(servedByBridge() ? ["", LOCAL_BRIDGE] : [LOCAL_BRIDGE], 1200);
  if (connected) {
    if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
    renderHeader();
    void syncConfigWithDisk().then(() => {
      void refreshArchive();
      void syncChatsWithDisk();
      void mcpReady();
      void refreshEnv();
    });
    if (!$("#settingsModal").classList.contains("hidden")) renderSettings();
    toast("本机桥接已接通，联网可用");
  }
  return connected;
}
// 停在「生成中」却没人在写的消息（页面刷新了、写的那一处关了）：按中断收束，已写的留着。改了返回 true
/** @param {Conversation} conversation */
function recoverConversation(conversation) {
  let changed = false;
  for (const message of conversation.messages || [])
    if (message.status === "streaming") {
      message.status = "interrupted";
      message.error = "页面刷新或连接中断，已生成的内容已保留";
      message.interruptedAt = now();
      settleSteps(message, "连接中断");
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
// 开页时收束一遍；别处正作答的不算（见 syncLeases）
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
  // 对话主体在 IndexedDB；先把旧 localStorage 数据迁入/把最新快照读回，再接桥接与绘制页面
  await hydrateStore();
  setupMarkdown();
  const candidates = ["", LOCAL_BRIDGE].filter((value, index, array) => array.indexOf(value) === index);
  await connectBridge(candidates);
  // 桥接在线：配置与对话的正本在存储根里（默认 ~/.yan），先与它合一次再画页面
  if (apiBase !== null) {
    await syncConfigWithDisk();
    await syncChatsWithDisk();
    // MCP 服务起得慢（起进程、握手）：先起着，头一问发出前会等它；环境备没备好也问一声，系统提示里要说
    void mcpReady();
    void refreshEnv();
  }
  if (apiBase === null) {
    bootstrap.notice = servedByBridge()
      ? "正在连接本机桥接…若始终连不上，请重新运行 start.cmd。"
      : location.protocol === "file:"
        ? `从文件直接打开的页面接不上本机桥接（分不清它与别处网页嵌进来的沙箱页），当前为浏览器直连。要用联网、执事与存储目录，请运行 start.cmd 后打开 ${LOCAL_BRIDGE}。`
        : "未检测到本机桥接，当前为浏览器直连。若接口未开放 CORS，请运行 start.cmd 或 VS Code 任务「言：启动模型桥接」。";
    if (servedByBridge()) retryBridgeLater();
  }
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
  // 先问一声别处在作答什么，那几段不当成中断
  await syncLeases();
  recoverInterruptedMessages();
  applyAppearance();
  bindEvents();
  (window.requestIdleCallback || (fn => setTimeout(fn, 800)))(() => void themeSheets());
  void refreshArchive();
  // 侧栏的开合记在本机（不随备份走）：宽屏按上次的来，窄屏一律收起；theme-boot 已按同一记录先把宽度放好，这里接过来
  toggleSidebar(isMobile() || localStorage.getItem("yan-sidebar") === "collapsed");
  delete document.documentElement.dataset.sidebar;
  restorePlace();
  render();
  // 低频的全量巡检：哪段改了没标到也兜得住；页面藏起来时也巡一趟（手机切走常常就不回来了）
  setInterval(sweepConversations, 45000);
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
  $("#openSettings").onclick = () => openSettings("general");
  $("#closeSettings").onclick = closeSettings;
  $("#settingsModal").addEventListener("click", e => {
    if (e.target === $("#settingsModal")) closeSettings();
  });
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
  $("#settingsModal").addEventListener("keydown", e => {
    if (e.key === "Tab" && !confirmResolve) trapModalFocus(e, $("#settingsModal"));
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
  document.querySelectorAll(".tab-btn").forEach(
    button =>
      (button.onclick = () => {
        settingsTab = button.dataset.tab;
        renderSettings();
      })
  );
  window.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    // 图片查看器盖在卷宗预览之上，先收它；CSV、Markdown、PDF 这些预览单独开着时，Esc 也得关得掉
    if (!$("#imageViewer").classList.contains("hidden")) {
      closeImageViewer();
      closeFileViewer();
      return;
    }
    if ($("#fileViewer") && !$("#fileViewer").classList.contains("hidden")) {
      closeFileViewer();
      return;
    }
    const expanded = document.querySelector(".work-expanded");
    if (expanded) {
      closeExpandedWork();
      return;
    }
    // 差遣那扇窗盖在正文上，Esc 先收它
    if (helperPanelOpen()) {
      if (!$("#helperList").classList.contains("hidden")) return $("#helperList").classList.add("hidden");
      closeHelperPanel();
      return;
    }
    // 浮着的小菜单（附件签、历史条目的「⋯」、目录签的弹层、模型菜单）：Esc 只收它，别连带把底下的旁注面板也关了
    if (document.querySelector(".chip-pop")) return closeChipPop();
    const modelMenu = $("#modelMenu");
    if (!modelMenu.classList.contains("hidden") && !modelMenu.classList.contains("leaving")) return closeModelMenu();
    if (confirmResolve) settleConfirm(false);
    else if (!$("#settingsModal").classList.contains("hidden")) closeSettings();
    else if (editingMessageId) {
      editingMessageId = null;
      renderConversation(false);
      if (sidePanelOpen()) renderSidePanel();
    } else if (sidePanelOpen()) closeSidePanel();
    else if (pendingQuote && document.activeElement === $("#chatInput") && !$("#chatInput").value) {
      pendingQuote = null;
      renderQuote();
      persistDraft();
    }
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
  window.addEventListener("offline", () => setConnection("error", "连接中断"));
  window.addEventListener("online", refreshConnection);
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
