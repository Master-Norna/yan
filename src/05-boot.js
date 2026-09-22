// 言 · 桥接连接、启动与全局事件绑定、侧栏
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 页面是不是桥接自己开的（http://127.0.0.1:端口）：是的话桥接一定在，探测失败多半只是首次加载时被大文件挤慢了，该多等、多试
function servedByBridge() {
  return /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/i.test(location.hostname);
}
async function connectBridge(candidates, timeout = 1400) {
  for (const candidate of candidates) {
    // 同源探测：首次打开时浏览器还在拉 vendor 里的几个大文件，引导请求排在后面，1.4 秒不够，给足时间
    const wait = candidate === "" && servedByBridge() ? Math.max(timeout, 8000) : timeout;
    try {
      const response = await fetch(`${candidate}/api/bootstrap`, { signal: AbortSignal.timeout(wait) });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) continue;
      const next = await response.json();
      bootstrap = next;
      apiBase = candidate;
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
    void refreshArchive();
    void syncChatsWithDisk();
    if (!$("#settingsModal").classList.contains("hidden")) renderSettings();
    toast("本机桥接已接通，联网可用");
  }
  return connected;
}
function recoverInterruptedMessages() {
  let changed = false;
  for (const conversation of store.conversations)
    for (const message of conversation.messages || [])
      if (message.status === "streaming") {
        message.status = "interrupted";
        message.error = "页面刷新或连接中断，已生成的内容已保留";
        message.interruptedAt = now();
        settleSteps(message, "连接中断");
        markDirty(conversation.id);
        changed = true;
      }
  for (const conversation of store.conversations)
    for (const thread of conversation.threads || [])
      for (const message of thread.messages || [])
        if (message.status === "streaming") {
          message.status = message.content ? "stopped" : "error";
          message.error = "页面刷新或连接中断";
          markDirty(conversation.id);
          changed = true;
        }
  if (changed) saveStore();
}
async function boot() {
  // 对话主体在 IndexedDB；先把旧 localStorage 数据迁入/把最新快照读回，再接桥接与绘制页面
  await hydrateStore();
  setupMarkdown();
  setupMermaid();
  setupVizObserver();
  const candidates = ["", LOCAL_BRIDGE].filter((value, index, array) => array.indexOf(value) === index);
  await connectBridge(candidates);
  // 桥接在线：对话正本在本机的对话目录里，先与它合一次再画页面
  if (apiBase !== null) await syncChatsWithDisk();
  if (apiBase === null) {
    bootstrap.notice = servedByBridge()
      ? "正在连接本机桥接…若始终连不上，请重新运行 start.cmd。"
      : "未检测到本机桥接，当前为浏览器直连。若接口未开放 CORS，请运行 start.cmd 或 VS Code 任务「言：启动模型桥接」。";
    if (servedByBridge()) retryBridgeLater();
  }
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
  recoverInterruptedMessages();
  applyAppearance();
  bindEvents();
  (window.requestIdleCallback || (fn => setTimeout(fn, 800)))(() => void themeSheets());
  void cleanupAttachmentStore();
  void refreshArchive();
  // 侧栏的开合记在本机（不随备份走）：宽屏按上次的来，窄屏一律收起；theme-boot 已按同一记录先把宽度放好，这里接过来
  toggleSidebar(isMobile() || localStorage.getItem("yan-sidebar") === "collapsed");
  delete document.documentElement.dataset.sidebar;
  restorePlace();
  render();
  // 低频的全量巡检：哪段改了没标到也兜得住；页面藏起来时也巡一趟（手机切走常常就不回来了）
  setInterval(sweepConversations, 45000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sweepConversations();
  });
}

function bindEvents() {
  $("#collapseSidebar").onclick = () => toggleSidebar();
  $("#mobileMenu").onclick = () => toggleSidebar(false);
  $("#newChat").onclick = newChat;
  $("#openLibrary").onclick = () => (view === "library" ? closeLibrary() : openLibrary());
  $("#openSettings").onclick = () => openSettings("general");
  $("#closeSettings").onclick = closeSettings;
  $("#settingsModal").addEventListener("click", e => {
    if (e.target === $("#settingsModal")) closeSettings();
  });
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "modelMenu");
    button.setAttribute("aria-expanded", "false");
    button.onclick = e => {
      e.stopPropagation();
      const menu = $("#modelMenu"),
        opening = menu.classList.contains("hidden") || menu.classList.contains("leaving");
      if (menu.parentElement !== button.parentElement) {
        menu.classList.add("hidden");
        menu.classList.remove("leaving", "drop-up");
        button.parentElement.append(menu);
      }
      if (!opening) {
        closeModelMenu();
        return;
      }
      renderModelMenu();
      showNow(menu);
      button.setAttribute("aria-expanded", "true");
      positionModelMenu(button);
    };
  });
  document.addEventListener("click", closeModelMenu);
  $("#themeToggle").onclick = e => switchTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", e.currentTarget);
  window.addEventListener("resize", () => {
    disposeOrphanCharts();
    const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
    if (trigger) positionModelMenu(trigger);
  });
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
    if (e.key === "Enter") {
      e.preventDefault();
      settleConfirm(true);
    }
  });
  $("#fileViewerClose").onclick = closeFileViewer;
  $("#fileViewerDownload").onclick = downloadViewerFile;
  $("#fileViewer").addEventListener("click", e => {
    if (e.target.closest("[data-viewer-download]")) return downloadViewerFile();
    if (e.target === $("#fileViewer") || e.target === $("#fileViewerStage")) closeFileViewer();
  });
  $("#imageViewerClose").onclick = closeImageViewer;
  $("#imageViewerDownload").onclick = () => {
    if (imageViewerAttachmentId) void downloadAttachment(imageViewerAttachmentId);
    else if (imageViewerArchivePath) downloadArchiveFile(imageViewerArchivePath);
  };
  $("#imageViewerZoom").onclick = toggleImageViewerZoom;
  $("#imageViewerStage").addEventListener("click", e => {
    if (e.target === $("#imageViewerImage")) toggleImageViewerZoom();
    else if (e.target === $("#imageViewerStage")) closeImageViewer();
  });
  const welcomeInput = $("#welcomeInput"),
    restPlaceholder = welcomeInput.placeholder;
  chatSuggestionsHtml = $("#welcome .suggestions").innerHTML;
  bindSuggestions = () =>
    document.querySelectorAll(".suggestion").forEach(button => {
      const prompt = button.dataset.prompt || button.textContent;
      button.onclick = () => {
        welcomeInput.value = prompt;
        welcomeInput.placeholder = restPlaceholder;
        welcomeInput.classList.remove("previewing");
        grow(welcomeInput);
        persistDraft();
        welcomeInput.focus();
        const start = prompt.indexOf("（"),
          end = start < 0 ? prompt.length : prompt.indexOf("）", start) + 1;
        welcomeInput.setSelectionRange(start < 0 ? prompt.length : start, end);
      };
      // 预览只占一行：取提示词首句并加省略号，不撑高输入框、不推挤按钮
      const preview = `${prompt.split(/\r?\n/)[0].slice(0, 60)}…`;
      button.addEventListener("pointerenter", () => {
        if (welcomeInput.value) return;
        welcomeInput.placeholder = preview;
        welcomeInput.classList.add("previewing");
      });
      button.addEventListener("pointerleave", () => {
        if (welcomeInput.placeholder === preview) {
          welcomeInput.placeholder = restPlaceholder;
          welcomeInput.classList.remove("previewing");
        }
      });
    });
  bindSuggestions();
  [$("#welcomeInput"), $("#chatInput")].forEach(input => {
    input.addEventListener("input", () => {
      grow(input);
      persistDraft();
      renderSendButtons();
    });
    input.addEventListener("keydown", e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const waiting = input.id === "chatInput" && !input.value.trim() ? pendingApprovalHere() : null;
        if (waiting) {
          if (waiting.step.name !== "ask_user") return settleApproval(waiting.step.id, true);
          const bar = $("#approvalBar"),
            page = Number(bar.dataset.page || 0),
            total = bar.querySelectorAll(".ask-q").length;
          if (page < total - 1) return formPage(bar, page + 1);
          const answers = collectForm(bar);
          if (answers?.some(Boolean)) return settleApproval(waiting.step.id, answers);
          return toast("请先在上方作答");
        }
        sendOrStop();
      }
    });
    input.addEventListener("paste", e => {
      const images = Array.from(e.clipboardData?.files || []).filter(file => file.type.startsWith("image/"));
      if (!images.length) return;
      e.preventDefault();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(4);
      void addFiles(
        images.map(
          (file, index) =>
            new File(
              [file],
              `粘贴图片-${stamp}${images.length > 1 ? `-${index + 1}` : ""}.${file.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`,
              { type: file.type }
            )
        )
      );
    });
  });
  $("#fileInput").onchange = handleFiles;
  $("#libraryAdd").onclick = () => $("#libraryFileInput").click();
  $("#libraryFileInput").onchange = async e => {
    await addLibraryFiles(e.target.files);
    e.target.value = "";
  };
  $("#librarySearch").addEventListener("input", e => {
    libraryQuery = e.target.value;
    renderLibrary();
  });
  document.querySelectorAll("[data-library-kind]").forEach(
    button =>
      (button.onclick = () => {
        libraryKind = button.dataset.libraryKind;
        renderLibrary();
      })
  );
  $("#libraryGrid").addEventListener("click", e => {
    const disk = e.target.closest("[data-open-disk-image]");
    if (disk) return openArchiveImage(disk.dataset.openDiskImage, disk);
    const button = e.target.closest("[data-library-action]");
    if (!button) return;
    const path = button.closest("[data-library-disk]")?.dataset.libraryDisk,
      id = button.closest("[data-library-item]")?.dataset.libraryItem,
      action = button.dataset.libraryAction;
    if (path) {
      if (action === "view") void openFileViewer(path, "", button);
      else if (action === "place") void placeFromArchive(path);
      else if (action === "download") downloadArchiveFile(path);
      else if (action === "remove") void removeArchiveFile(path);
      return;
    }
    if (action === "place") placeFromLibrary(id);
    else if (action === "view")
      void openFileViewer({ attachmentId: id }, button.closest(".library-card")?.querySelector("strong")?.textContent || "", button);
    else if (action === "download") void downloadAttachment(id);
    else if (action === "remove") void removeFromLibrary(id);
  });
  $("#libraryGrid").addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target.matches?.("[data-open-disk-image]")) return;
    e.preventDefault();
    openArchiveImage(e.target.dataset.openDiskImage, e.target);
  });
  let dragHideTimer = null,
    dragFromPage = false;
  // 拖的是页面里自己的东西（卷宗里的图、案上的附件、答里的图片）时浏览器也会把它当文件拖入：
  // 松手就又收一份进卷宗。页内起手的拖动一概不接——卷宗可能绑着用户自己的目录，里面本就允许有重样的文件，不能靠查重来挡
  window.addEventListener("dragstart", () => (dragFromPage = true));
  window.addEventListener("dragend", () => (dragFromPage = false));
  const hasDraggedFiles = event => !dragFromPage && Array.from(event.dataTransfer?.types || []).includes("Files");
  const showDropVeil = () => {
    clearTimeout(dragHideTimer);
    const toLibrary = view === "library";
    $("#dropTitle").textContent = toLibrary ? "松手，收入卷宗" : "松手，置于案上";
    $("#dropHint").textContent = toLibrary
      ? archiveOnline()
        ? "任何文件 · 落到本机的卷宗目录"
        : `图片、文档与代码文件 · 单件不超过 ${limitLabel(MAX_FILE_BYTES)}`
      : `图片、文档与代码文件 · 单次共 ${limitLabel(MAX_PENDING_BYTES)}`;
    $("#dropVeil").classList.remove("hidden");
  };
  const hideDropVeil = () => {
    clearTimeout(dragHideTimer);
    $("#dropVeil").classList.add("hidden");
  };
  window.addEventListener("dragenter", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    showDropVeil();
  });
  window.addEventListener("dragover", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    showDropVeil();
  });
  window.addEventListener("dragleave", event => {
    if (!hasDraggedFiles(event)) return;
    dragHideTimer = setTimeout(hideDropVeil, 80);
  });
  window.addEventListener("drop", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    hideDropVeil();
    void (view === "library" ? addLibraryFiles : addFiles)(event.dataTransfer.files);
  });
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
      renderHistory();
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
  $("#modelMenu").addEventListener("click", e => {
    const level = e.target.closest("[data-reasoning]");
    if (level) {
      e.stopPropagation();
      const c = currentConversation();
      if (c) c.reasoning = level.dataset.reasoning;
      else store.settings.reasoning = level.dataset.reasoning;
      saveStore();
      renderModelMenu();
      renderModelTriggers();
      const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
      if (trigger) positionModelMenu(trigger);
      return;
    }
    const item = e.target.closest("[data-profile]");
    if (!item) return;
    selectProfile(item.dataset.profile);
    // 这个模型还没探过认哪几档：探一下，发送键旁的标签与菜单跟着换（探不成就按通用四档，撞了错再学）
    const picked = activeProfile();
    if (picked && !reasoningProbed(picked))
      void probeReasoningLevels(picked).then(levels => {
        if (levels === null || activeProfile() !== picked) return;
        renderModelTriggers();
        if ($("#modelMenu")?.classList.contains("hidden") === false) renderModelMenu();
      });
  });
  $("#messages").addEventListener("click", handleMessageAction);
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !e.target.classList?.contains("message-edit-input")) return;
    e.preventDefault();
    e.target.closest(".message-editor")?.querySelector('[data-action="save-edit"]')?.click();
  });
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-approve]");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      return approveFrom(button);
    }
    // 差遣的签不在此列：点它是去右侧开面板，不是折叠（见下面的 openHelperPanel）
    const head = event.target.closest(".tool-step.foldable > .tool-step-head");
    if (!head || event.target.closest("a, button")) return;
    const el = head.parentElement,
      c = currentConversation(),
      step =
        c &&
        allMessages(c)
          .flatMap(m => allSteps(m))
          .find(s => s.id === el.dataset.stepId);
    // 指令输出默认折起，开合记在步骤上，重画不丢
    const wasFolded = el.classList.contains("folded");
    if (step) step.expanded = wasFolded;
    morphHeight(el, () => el.classList.toggle("folded", !wasFolded));
    head.title = wasFolded ? "收起输出" : "展开输出";
    saveStoreSoon();
  });
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-step-more]");
    if (!button) return;
    const el = button.closest(".tool-step"),
      c = currentConversation(),
      step =
        c &&
        allMessages(c)
          .flatMap(m => allSteps(m))
          .find(s => s.id === el?.dataset.stepId);
    if (!step) return;
    step.full = !step.full;
    step.expanded = true;
    saveStoreSoon();
    // 节点留在原处只换内容，高度才好从旧高动到新高
    const fresh = document.createElement("div");
    fresh.innerHTML = stepHtml(step);
    const next = fresh.firstElementChild;
    morphHeight(el, () => {
      el.className = next.className;
      el.innerHTML = next.innerHTML;
    });
  });
  // 出处也是一块可开合的，与思绪、行迹同一种开合
  $("#messages").addEventListener("click", event => {
    const summary = event.target.closest(".source-stack > summary");
    if (!summary) return;
    event.preventDefault();
    const details = summary.parentElement;
    setProcessDetails(details, details._motionAnimation ? !details._motionTarget : !details.open);
  });
  $("#approvalBar").addEventListener("click", event => {
    const bar = $("#approvalBar"),
      button = event.target.closest("[data-approve]");
    if (button) {
      event.preventDefault();
      return approveFrom(button);
    }
    const opt = event.target.closest(".ask-opt");
    if (opt) {
      const block = opt.closest(".ask-q"),
        on = opt.getAttribute("aria-checked") === "true",
        single = block.dataset.multi !== "true";
      if (single) {
        // 单选：选项与「自行填写」二选一——点了选项就清掉填的字，反之亦然（见下面的 input 监听）
        block.querySelectorAll(".ask-opt").forEach(b => b.setAttribute("aria-checked", "false"));
        const other = block.querySelector(".ask-other");
        if (other && !on) other.value = "";
      }
      opt.setAttribute("aria-checked", on ? "false" : "true");
      return;
    }
    const form = event.target.closest("[data-form]");
    if (!form || !bar.dataset.stepId) return;
    event.preventDefault();
    if (form.dataset.form === "prev" || form.dataset.form === "next")
      return formPage(bar, Number(bar.dataset.page || 0) + (form.dataset.form === "next" ? 1 : -1));
    const answers = form.dataset.form === "submit" ? collectForm(bar) : false;
    settleApproval(bar.dataset.stepId, answers && answers.some(Boolean) ? answers : false);
  });
  $("#messages").addEventListener(
    "scroll",
    event => {
      const body = event.target;
      if (body?.classList?.contains("reasoning-body")) body._follow = body.scrollTop + body.clientHeight >= body.scrollHeight - 24;
    },
    true
  );
  $("#approvalBar").addEventListener("input", event => {
    if (!event.target.classList.contains("ask-other")) return;
    const block = event.target.closest(".ask-q");
    if (block?.dataset.multi !== "true" && event.target.value.trim())
      block.querySelectorAll(".ask-opt").forEach(b => b.setAttribute("aria-checked", "false"));
  });
  $("#approvalBar").addEventListener("keydown", event => {
    if (event.key !== "Enter" || !event.target.classList.contains("ask-other")) return;
    event.preventDefault();
    const bar = $("#approvalBar"),
      page = Number(bar.dataset.page || 0),
      total = bar.querySelectorAll(".ask-q").length;
    if (page < total - 1) return formPage(bar, page + 1);
    const answers = collectForm(bar);
    if (answers && answers.some(Boolean)) settleApproval(bar.dataset.stepId, answers);
  });
  $("#messages").addEventListener("click", event => {
    const summary = event.target.closest(".change-summary");
    if (!summary) return;
    const files = summary.parentElement.querySelector(".change-files"),
      open = files.classList.toggle("hidden");
    summary.setAttribute("aria-expanded", String(!open));
  });
  // 帮手条点一下开差遣面板：帮手的活在右边看，行迹里只留一枚签
  $("#helperBar").addEventListener("click", event => {
    const id = event.target.closest(".helper-row")?.dataset.helper || $("#helperBar").dataset.stepId || "";
    if (id) openHelperPanel(id);
  });
  // 行迹里的那枚签：点它（或敲回车 / 空格）同样开面板
  $("#messages").addEventListener("click", event => {
    const head = event.target.closest(".tool-step-delegate > .tool-step-head");
    if (head) openHelperPanel(head.parentElement.dataset.stepId || "");
  });
  $("#messages").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const head = event.target.closest?.(".tool-step-delegate > .tool-step-head");
    if (!head) return;
    event.preventDefault();
    openHelperPanel(head.parentElement.dataset.stepId || "");
  });
  // 合起即回到行迹里那一步——原先「合」与「行迹」两个按钮做的本是同一件事
  $("#helperClose").onclick = () => {
    const id = helperStepId;
    closeHelperPanel();
    const card = document.querySelector(`#messages .tool-step-delegate[data-step-id="${CSS.escape(id || "")}"]`);
    if (!card) return;
    const stack = card.closest(".tool-stack");
    if (stack && !stack.open) setProcessDetails(stack, true);
    scrollChatTo(card, "center");
  };
  // 点遮罩、按 Esc 都关得掉，与设置、文件查看器一个脾气。纸张之外的空白由 .helper-stage 铺满，点在它上面也算点了遮罩；
  // 按下与松开都得落在空白处——在纸上选字、拖到纸外松手，click 会落到两者的共同祖先上，那不是要关窗
  const helperBackdrop = target => target === $("#helperModal") || target === $("#helperScroll");
  let helperPressedBackdrop = false;
  $("#helperModal").addEventListener("pointerdown", event => {
    helperPressedBackdrop = helperBackdrop(event.target);
  });
  $("#helperModal").addEventListener("click", event => {
    if (helperPressedBackdrop && helperBackdrop(event.target)) closeHelperPanel();
    helperPressedBackdrop = false;
  });
  // ‹ › 翻帮手；中间的计数点开是一张列表——帮手多了一个个翻就难受
  $("#helperNav").addEventListener("click", event => {
    const move = event.target.closest("[data-helper-step]")?.dataset.helperStep;
    if (move) return stepHelperPanel(Number(move));
    if (event.target.closest("[data-helper-list]")) {
      const list = $("#helperList");
      list.classList.toggle("hidden");
      if (!list.classList.contains("hidden")) renderHelperList();
    }
  });
  $("#helperList").addEventListener("click", event => {
    const id = event.target.closest("[data-helper-pick]")?.dataset.helperPick;
    if (id) openHelperPanel(id);
  });
  // 输入框上方多了请示条、帮手条与改动摘要，正文底部留白随之增减，末句不被盖住
  if ("ResizeObserver" in window)
    new ResizeObserver(() => {
      const area = $("#composerArea");
      if (area && !area.classList.contains("hidden")) {
        $("#chatScroll").style.paddingBottom = `${area.offsetHeight + 16}px`;
        document.documentElement.style.setProperty("--composer-h", `${area.offsetHeight}px`);
        syncChatScrollGrabber();
      }
    }).observe($("#composerArea"));
  $("#workAuto").onclick = () => {
    const c = currentConversation();
    if (!c) return;
    c.commandPolicy = nextCommandPolicy(commandPolicyOf(c));
    saveStore();
    renderWorkAuto();
    if (c.commandPolicy !== "ask")
      for (const [stepId, entry] of pendingApprovals) if (entry.conversationId === c.id) settleApproval(stepId, true);
  };
  setupChips();
  setupQuoteTip();
  setupSidePanel();
  $("#composerQuoteClose").onclick = () => {
    pendingQuote = null;
    renderQuote();
    persistDraft();
    $("#chatInput").focus();
  };
  $("#messages").addEventListener("click", event => {
    const block = event.target.closest(".user-quote");
    if (!block) return;
    const source =
      block.dataset.quoteSource && document.querySelector(`#messages [data-message="${CSS.escape(block.dataset.quoteSource)}"]`);
    if (!source) return toast("出处已不在当前页面");
    followBottom = false;
    scrollChatTo(source, "center");
    source.classList.remove("flash");
    void source.offsetWidth;
    source.classList.add("flash");
  });
  // 思绪与行迹的开合：正文、旁注面板与差遣面板同一套——用户亲手开合的记在消息上，流式期间的自动开合就不再替他动
  const onProcessToggle = event => {
    const summary = event.target.closest(".reasoning > summary, .tool-stack > summary");
    if (!summary) return;
    event.preventDefault();
    const details = summary.parentElement;
    const nextOpen = details._motionAnimation ? !details._motionTarget : !details.open;
    // 用户亲手动了，程序排着的那次自动收起作废
    clearTimeout(details._settleTimer);
    details._settleTimer = null;
    // 时间线里各轮的思绪与帮手各轮的步骤不记在消息上；用户开合过的记一笔，就地更新时不再替它开合
    if (details.classList.contains("trail-reasoning") || details.classList.contains("sub-steps")) {
      details.dataset.touched = "1";
      return setProcessDetails(details, nextOpen);
    }
    const id = details.closest("[data-message]")?.dataset.message,
      side = !!details.closest("#sideMessages");
    const message = (side ? currentThread()?.messages : currentConversation()?.messages)?.find(item => item.id === id);
    if (!message) return setProcessDetails(details, nextOpen);
    const reasoning = details.classList.contains("reasoning");
    message[reasoning ? "reasoningTouched" : "toolsTouched"] = true;
    message[reasoning ? "reasoningOpen" : "toolsOpen"] = nextOpen;
    saveStoreSoon();
    setProcessDetails(details, nextOpen);
  };
  $("#messages").addEventListener("click", onProcessToggle);
  $("#sideMessages").addEventListener("click", onProcessToggle);
  $("#helperPanelBody").addEventListener("click", onProcessToggle);
  document.addEventListener("click", e => {
    const copy = e.target.closest("[data-copy-code]");
    if (copy) {
      void copyText(copy.closest(".code-block, .viz, .html-app")?.querySelector("code")?.textContent || "");
      copy.textContent = "已复制";
      setTimeout(() => (copy.textContent = "复制"), 1200);
      return;
    }
    const vizToggle = e.target.closest("[data-viz-toggle]");
    if (vizToggle) {
      const viz = vizToggle.closest(".viz"),
        source = viz.querySelector(".viz-source"),
        showSource = source.classList.contains("hidden");
      source.classList.toggle("hidden", !showSource);
      viz.querySelector(".viz-canvas").classList.toggle("hidden", showSource);
      vizToggle.textContent = showSource ? "图形" : "源码";
      return;
    }
    const vizDownload = e.target.closest("[data-viz-download]");
    if (vizDownload) {
      downloadVisualization(vizDownload.closest(".viz"));
      return;
    }
    const appToggle = e.target.closest("[data-app-toggle]");
    if (appToggle) {
      const app = appToggle.closest(".html-app"),
        source = app.querySelector(".html-app-source"),
        showSource = source.classList.contains("hidden");
      source.classList.toggle("hidden", !showSource);
      app.querySelector(".html-app-stage").classList.toggle("hidden", showSource);
      appToggle.textContent = showSource ? "预览" : "源码";
      return;
    }
    const appRestart = e.target.closest("[data-app-restart]");
    if (appRestart) {
      mountHtmlApp(appRestart.closest(".html-app"));
      return;
    }
    const appDownload = e.target.closest("[data-app-download]");
    if (appDownload) {
      downloadText(htmlAppSource(appDownload.closest(".html-app")), "text/html;charset=utf-8", "言-交互作品.html");
      return;
    }
    const expand = e.target.closest("[data-work-expand]");
    if (expand) {
      toggleWorkExpanded(expand.closest(".viz, .html-app"), expand);
      return;
    }
    const remove = e.target.closest("[data-remove-attachment]");
    if (remove) {
      const [file] = pendingAttachments.splice(Number(remove.dataset.removeAttachment), 1);
      persistDraft();
      void deleteAttachments([file?.id]);
      renderAttachments();
      return;
    }
    const save = e.target.closest("[data-save-attachment]");
    if (save) {
      void saveToLibrary(save.dataset.saveAttachment);
      return;
    }
    const preview = e.target.closest("[data-open-image]");
    if (preview) {
      void openImageViewer(preview.dataset.openImage, preview);
      return;
    }
    const open = e.target.closest("[data-open-attachment]");
    if (open) {
      void openFileViewer({ attachmentId: open.dataset.openAttachment }, open.dataset.name || "", open);
      return;
    }
    const download = e.target.closest("[data-download-attachment]");
    if (download) void downloadAttachment(download.dataset.downloadAttachment);
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches?.("[data-open-image]")) {
      e.preventDefault();
      void openImageViewer(e.target.dataset.openImage, e.target);
    } else if (e.target.matches?.("[data-open-attachment]")) {
      e.preventDefault();
      void openFileViewer({ attachmentId: e.target.dataset.openAttachment }, e.target.dataset.name || "", e.target);
    } else if (e.target.matches?.("[data-download-attachment]")) {
      e.preventDefault();
      void downloadAttachment(e.target.dataset.downloadAttachment);
    }
  });
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
  // 跟随的规矩：往下滚到离底不远就算到底、开始跟随（生成中内容一直在长，硬要滚到最后一像素常常追不上）；
  // 往上滚离底超过阈值才算离开。内容自己长高、缩短引起的滚动不算用户的意思
  let lastScrollTop = 0;
  $("#chatScroll").addEventListener("scroll", () => {
    const el = $("#chatScroll"),
      gap = el.scrollHeight - el.scrollTop - el.clientHeight,
      down = el.scrollTop > lastScrollTop;
    lastScrollTop = el.scrollTop;
    if (gap < 8 || (down && gap < FOLLOW_THRESHOLD)) {
      followBottom = true;
      autoScrolling = false;
    } else if (!down && !autoScrolling && gap > FOLLOW_THRESHOLD) followBottom = false;
    syncJumpBottom(gap);
    syncOutline();
  });
  // 跟着的时候，内容不论因何长高（工具输出、图表成图、图片载入、块的开合）都贴着底：不只靠流式的每一帧
  if (typeof ResizeObserver === "function")
    new ResizeObserver(() => {
      if (followBottom && view === "chat" && currentId) scrollBottom();
      syncChatScrollGrabber();
    }).observe($("#messages"));
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-toggle-compacted]");
    if (!button) return;
    const c = currentConversation();
    if (!c) return;
    c.showCompacted = !c.showCompacted;
    foldCompacted(c);
    renderOutline();
    if (!c.showCompacted) scrollChatTo(button.closest(".context-divider"), "center");
  });
  // 正文里指向本地文件的链接（模型写的「下载《x.docx》」）：页面上没有那样的路，到卷宗里找同名的那件来下载
  document.addEventListener("click", async event => {
    const link = event.target.closest(".markdown a[data-file]");
    if (!link) return;
    event.preventDefault();
    const name = link.dataset.file;
    if (!archiveOnline()) return toast(`链接无处可去：「${name}」不在卷宗里`);
    if (archiveEntries === null) await refreshArchive();
    const entry = (archiveEntries || []).find(file => file.name === name || file.path === name);
    if (!entry) return toast(`卷宗里没有「${name}」`);
    downloadArchiveFile(entry.path);
  });
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-deliver-action]");
    if (!button) return;
    const path = button.closest("[data-deliver]")?.dataset.deliver;
    if (!path) return;
    if (deliverableMissing(path)) return toast("这件已从卷宗移除");
    if (button.dataset.deliverAction === "download") downloadArchiveFile(path);
    else void openFileViewer(path, "", button);
  });
  $("#outline").addEventListener("click", event => {
    const item = event.target.closest(".outline-item");
    if (item) jumpToOutline(item.dataset.target);
  });
  $("#contextGauge").addEventListener("click", event => {
    event.stopPropagation();
    openContextMenu(event.currentTarget);
  });
  $("#chatInput").addEventListener("input", () => scheduleContextGauge());
  $("#chatScroll").addEventListener(
    "wheel",
    e => {
      if (e.deltaY < 0) followBottom = false;
    },
    { passive: true }
  );
  $("#chatScroll").addEventListener(
    "pointerdown",
    () => {
      autoScrolling = false;
    },
    { passive: true }
  );
  // 右侧透明命中层把细滚动条的可抓宽度放大，也越过输入框覆盖区一直延伸到底部。
  // 按下轨道会把滑块移到指针处；按住近似滑块则保留抓取点，拖动手感与原生滚动条一致。
  const scrollGrabber = $("#chatScrollGrabber"),
    chatScroll = $("#chatScroll");
  let scrollDrag = null;
  const scrollGeometry = () => {
    const max = Math.max(0, chatScroll.scrollHeight - chatScroll.clientHeight),
      track = chatScroll.clientHeight,
      thumb = Math.min(track, Math.max(28, (track * track) / Math.max(chatScroll.scrollHeight, 1)));
    return { rect: chatScroll.getBoundingClientRect(), max, track, thumb, travel: Math.max(1, track - thumb) };
  };
  const moveScrollGrabber = event => {
    if (!scrollDrag || event.pointerId !== scrollDrag.pointerId) return;
    const geometry = scrollGeometry(),
      pointer = Math.max(0, Math.min(geometry.track, event.clientY - geometry.rect.top));
    chatScroll.scrollTop = Math.max(0, Math.min(geometry.max, ((pointer - scrollDrag.offset) / geometry.travel) * geometry.max));
  };
  const stopScrollGrabber = event => {
    if (!scrollDrag || event.pointerId !== scrollDrag.pointerId) return;
    try {
      scrollGrabber.releasePointerCapture(event.pointerId);
    } catch {}
    scrollDrag = null;
  };
  scrollGrabber.addEventListener("pointerdown", event => {
    const geometry = scrollGeometry();
    if (event.button !== 0 || !geometry.max || getComputedStyle(chatScroll).overflowY === "hidden") return;
    event.preventDefault();
    autoScrolling = false;
    followBottom = false;
    const pointer = Math.max(0, Math.min(geometry.track, event.clientY - geometry.rect.top)),
      thumbTop = (chatScroll.scrollTop / geometry.max) * geometry.travel,
      withinThumb = pointer >= thumbTop && pointer <= thumbTop + geometry.thumb;
    scrollDrag = {
      pointerId: event.pointerId,
      offset: withinThumb ? pointer - thumbTop : geometry.thumb / 2
    };
    try {
      scrollGrabber.setPointerCapture(event.pointerId);
    } catch {}
    moveScrollGrabber(event);
  });
  scrollGrabber.addEventListener("pointermove", moveScrollGrabber);
  scrollGrabber.addEventListener("pointerup", stopScrollGrabber);
  scrollGrabber.addEventListener("pointercancel", stopScrollGrabber);
  scrollGrabber.addEventListener(
    "wheel",
    event => {
      if (!scrollGrabber.classList.contains("active")) return;
      const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? chatScroll.clientHeight : 1;
      if (event.deltaY < 0) followBottom = false;
      chatScroll.scrollTop += event.deltaY * scale;
      event.preventDefault();
    },
    { passive: false }
  );
  const flushPageState = () => {
    persistDraft();
    flushOnUnload();
  };
  // beforeunload 比 pagehide 早，给 IndexedDB 事务多一点提交时间；pagehide 仍兜住不派 beforeunload 的移动端 / 缓存路径。
  // flushOnUnload 自身幂等，不会因为两者都到而重复写。
  window.addEventListener("beforeunload", flushPageState);
  window.addEventListener("pagehide", flushPageState);
  // 从前进 / 后退缓存回来仍是同一份 JS 状态：允许它在下一次离页时再次落盘。
  window.addEventListener("pageshow", event => {
    if (event.persisted) unloading = false;
  });
  window.addEventListener("offline", () => setConnection("error", "连接中断"));
  window.addEventListener("online", refreshConnection);
  window.addEventListener("message", event => {
    const data = event.data;
    if (!data || !["yan-preview-ready", "yan-preview-state"].includes(data.type)) return;
    const app = [...document.querySelectorAll(".html-app[data-app-id]")].find(
      el => el.dataset.appId === data.id && el.querySelector("iframe")?.contentWindow === event.source
    );
    if (!app) return;
    if (data.type === "yan-preview-ready") return sendHtmlApp(app);
    app.dataset.appState = data.state;
    app.classList.toggle("html-app-error", data.state === "error");
    const label = app.querySelector(".code-lang");
    if (label) {
      label.textContent = data.state === "error" ? "html · 运行有误" : "html · 可交互";
      label.title = data.detail || "";
    }
    if (data.state === "ready" && followBottom) requestAnimationFrame(scrollBottom);
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
  // 生成时向上翻阅后，给一枚「回到最新」；贴近底部自动隐去
  $("#jumpBottom").onclick = () => {
    const el = $("#chatScroll");
    followBottom = true;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion.matches ? "instant" : "smooth" });
  };
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
