// 言 · 行迹 · 帮手：输入框上方的工作条与差遣面板
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 工作条：附在输入框上方——左边正在写的这一答的改动合计（帮手改的也算进来，点开浮出清单），右边这段对话后台在做的帮手（点开差遣面板）。
// 帮手不随一答收尾，答写完了它还在做，条子就还挂着它。两样都没有就不挂；写完了改动落到回复之下（见 设计稿/12-改动条与行迹 二·乙）
let workFilesOpen = false;
function renderHelperBar() {
  const bar = $("#helperBar");
  if (!bar) return;
  const c = currentConversation(),
    message = c && view === "chat" ? [...c.messages].reverse().find(m => m.role === "assistant" && m.status === "streaming") : null,
    helpers = c && view === "chat" ? (crews.get(c.id) || []).map(box => box.step) : [],
    stats = message ? changeStats(message) : { files: [], added: 0, removed: 0 },
    // 等待确认有请示条，不在这里重说
    label = c && requestJob(c.id)?.label,
    notice = label && label !== "等待确认" ? label : "";
  if (!helpers.length && !stats.files.length && !notice) {
    workFilesOpen = false;
    bar.dataset.sig = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  const changes = stats.files.length
      ? `<button type="button" class="work-changes" aria-expanded="${workFilesOpen}" title="这一答改过的文件"><span class="seal change-seal" aria-hidden="true">改</span><span>改 ${stats.files.length} 件</span><span class="change-count">${changeCountHtml(stats)}</span></button>`
      : "",
    // 题目逐次取：条子常在步骤刚入册、runDelegate 还没把题目填上时就搭好了
    who =
      helpers.length > 1
        ? `${helpers.length} 名帮手 · 进行中`
        : helpers.length
          ? `帮手「${String(helpers[0].title || "").slice(0, 24)}」· ${delegateDoing(helpers[0])}`
          : "",
    helper = helpers.length
      ? `<button type="button" class="work-helpers" data-helper="${escapeHtml(helpers[0].id)}" title="打开差遣面板"><span class="seal helper-seal" aria-hidden="true">帮</span><span class="work-helpers-text">${escapeHtml(who)}</span><span class="work-helpers-go" aria-hidden="true">›</span></button>`
      : "",
    html = `${changes}${notice ? `<span class="work-notice" role="status">${escapeHtml(notice)}</span>` : ""}${helper}${stats.files.length ? changeFilesHtml(stats, workFilesOpen, " work-files") : ""}`;
  // 帮手每 350ms 刷一次，没变就不动，免得清单里的滚动位置被重画冲掉
  if (bar.dataset.sig !== html) {
    bar.dataset.sig = html;
    bar.innerHTML = html;
  }
  bar.classList.toggle("only-helpers", !changes);
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}

// ---------- 差遣面板：帮手的活开在一扇全屏的窗里 ----------
// 行迹里只留一枚签（带回报，做事时呼吸），要看帮手具体做了什么才点开——细看是另一种动作，值得整个屏幕：
// 那条时间线里有 diff、有命令输出、有嵌套步骤，挤在窄栏里必然难看。
// 瞥一眼不必开窗：签自己在呼吸，输入框上方还有帮手条。几名帮手用 ‹ n/m › 翻，翻不动了就点中间的计数出列表
let helperStepId = null; // 窗里正看着的那一趟差遣（或续派）
const helperSeen = new Map(); // 窗里步骤的就地更新台账（与行迹各记各的，互不干扰）
/** 当前对话里帮手的每一趟，按发生先后 */
function allDelegateSteps() {
  return helperRuns(currentConversation());
}
function helperStepById(id) {
  return allDelegateSteps().find(step => step.id === id) || null;
}
function helperPanelOpen() {
  const panel = $("#helperModal");
  return !!panel && !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
// noteId：传话的签点开时，直接翻到递去的那句话（它所在那一轮的步骤摊开）
function openHelperPanel(stepId, noteId = "") {
  const step = helperStepById(stepId);
  if (!step) return;
  if (helperStepId !== step.id) helperSeen.clear();
  helperStepId = step.id;
  $("#helperList").classList.add("hidden");
  showNow($("#helperModal"));
  renderHelperPanel(true);
  // 换一名帮手是换一张纸，从头看起；不然上一张滚到多深，这张就从多深打开
  const stage = $("#helperScroll");
  if (stage) stage.scrollTop = 0;
  const note = noteId && $("#helperPanelBody").querySelector(`[data-step-id="${CSS.escape(noteId)}"]`);
  if (!note) return;
  const stack = note.closest("details.sub-steps");
  if (stack) {
    stack.dataset.touched = "1";
    setProcessDetails(stack, true);
  }
  helperFolded.delete(step.id);
  syncSubFold($("#helperPanelBody > .sub-trail"), step);
  requestAnimationFrame(() => note.scrollIntoView({ block: "center" }));
}
function closeHelperPanel() {
  helperStepId = null;
  helperSeen.clear();
  const panel = $("#helperModal");
  if (panel && !panel.classList.contains("hidden")) hideWithFade(panel);
}
// ‹ › 翻到前一次 / 后一次差遣
function stepHelperPanel(delta) {
  const all = allDelegateSteps(),
    at = all.findIndex(step => step.id === helperStepId),
    next = all[at + delta];
  if (next) openHelperPanel(next.id);
}
// 计数点开的那张列表：帮手多了，一个个翻就难受
function renderHelperList() {
  const host = $("#helperList"),
    all = allDelegateSteps();
  if (!host) return;
  host.innerHTML = all
    .map((step, i) => {
      const { status, meta } = delegateSubState(step);
      return `<button type="button" class="helper-list-item${step.id === helperStepId ? " here" : ""}" data-helper-pick="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><span class="helper-list-no">${i + 1}</span><span class="helper-list-title">${escapeHtml(step.title || "领命中")}</span><span class="helper-list-meta">${escapeHtml(meta)}</span></button>`;
    })
    .join("");
}
// 帮手行迹的收起：时间线上方一行题头（折角 · 行迹 · 几轮 · 几步，与主行迹题头同一枚折角，点它开合），收起的记在这里，翻到别的帮手再翻回来仍是收着的。
// 题头滚出面板顶上时，面板顶栏右侧浮出同一枚「收起行迹」，与主对话的书眉一个意思
const helperFolded = new Set();
/** @param {Step} step */
function syncSubFold(trail, step) {
  const { sub, steps, live } = delegateSubState(step);
  const head = trail?.querySelector(":scope > .sub-fold");
  if (!head || !sub) return;
  const folded = helperFolded.has(step.id),
    rounds = trailGroups(sub).length,
    meta = live ? `${steps.length} 步 · 进行中` : `${rounds} 轮 · ${steps.length} 步`;
  trail.classList.toggle("folded", folded);
  head.setAttribute("aria-expanded", String(!folded));
  rollText(head.querySelector(".sub-fold-meta"), meta);
  head.title = folded ? "展开帮手的行迹" : "收起帮手的行迹，只看回报";
  syncHelperFoldHead();
}
function toggleSubFold(fold) {
  if (!helperStepId) return;
  if (fold ?? !helperFolded.has(helperStepId)) helperFolded.add(helperStepId);
  else helperFolded.delete(helperStepId);
  const trail = $("#helperPanelBody > .sub-trail"),
    step = helperStepById(helperStepId);
  syncSubFold(trail, step);
  // 从顶栏收起时，停回题头处
  const head = trail?.querySelector(":scope > .sub-fold"),
    scroll = $("#helperScroll");
  if (head && head.getBoundingClientRect().top < scroll.getBoundingClientRect().top)
    scroll.scrollTo({
      top: scroll.scrollTop + head.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12,
      behavior: "smooth"
    });
}
function syncHelperFoldHead() {
  const button = $("#helperFoldHead"),
    trail = $("#helperPanelBody > .sub-trail"),
    head = trail?.querySelector(":scope > .sub-fold"),
    timeline = trail?.querySelector(":scope > .sub-timeline");
  if (!button) return;
  const top = $("#helperScroll").getBoundingClientRect().top,
    show =
      !!head &&
      !trail.classList.contains("folded") &&
      head.getBoundingClientRect().bottom < top &&
      timeline.getBoundingClientRect().bottom > top + 60;
  button.classList.toggle("shown", show);
}
/** @param {boolean} fresh 首次打开或换了一次差遣：从空白画起；否则就地更新 */
function renderHelperPanel(fresh = false) {
  if (!helperPanelOpen()) return;
  const step = helperStepById(helperStepId);
  // 那次差遣不在眼前了（换了对话、切了分支）：窗合上，不留一扇空的
  if (!step) return closeHelperPanel();
  const { sub, status, meta } = delegateSubState(step),
    all = allDelegateSteps(),
    at = all.findIndex(s => s.id === helperStepId);
  $("#helperModal").dataset.status = status;
  const title = $("#helperTitle");
  if (title && title.textContent !== (step.title || "领命中")) title.textContent = step.title || "领命中";
  rollText($("#helperPanelSub"), meta);
  // ‹ n/m ›：只有一次差遣时不画
  const nav = $("#helperNav"),
    navKey = `${at + 1}/${all.length}`;
  if (nav && nav.dataset.key !== navKey) {
    nav.dataset.key = navKey;
    nav.innerHTML =
      all.length > 1
        ? `<button class="message-action" data-helper-step="-1" title="上一次差遣" aria-label="上一次差遣"${at <= 0 ? " disabled" : ""}>‹</button><button type="button" class="helper-nav-count" data-helper-list title="所有差遣">${navKey}</button><button class="message-action" data-helper-step="1" title="下一次差遣" aria-label="下一次差遣"${at >= all.length - 1 ? " disabled" : ""}>›</button>`
        : "";
  }
  if (!$("#helperList").classList.contains("hidden")) renderHelperList();
  // 所领之命：主模型交给帮手的原话，默认收着，点开看全
  const task = String(sub?.task || "");
  const brief = $("#helperTaskBrief");
  if (brief && brief.dataset.task !== task) {
    brief.dataset.task = task;
    brief.textContent = task.replace(/\s+/g, " ").slice(0, 60);
    $("#helperTaskText").textContent = task;
    $("#helperTask").classList.toggle("hidden", !task);
  }
  const host = $("#helperPanelBody");
  if (!host) return;
  // 帮手就是一条回复：与主答的行迹同一支笔（见 paintTimeline）。帮手每 350ms 刷一次，只动变了的部分——
  // 已画出的步骤输出不重起入场动画、用户收起的思绪不被摊开
  let trail = host.querySelector(":scope > .sub-trail");
  const blank = fresh || !trail;
  if (blank) {
    helperSeen.clear();
    host.innerHTML = `<div class="sub-trail"></div>`;
    trail = host.firstElementChild;
  }
  paintHelperTrail(trail, step, !blank);
}
// 差遣面板：帮手条与行迹里的签打开它，遮罩与合起关上它，‹ › 与列表翻帮手
function bindHelperEvents() {
  // 帮手行迹的收起：时间线上方的题头，与翻过题头后顶栏右侧浮出的那一枚
  $("#helperPanelBody").addEventListener("click", event => {
    if (event.target.closest(".sub-fold")) toggleSubFold();
  });
  $("#helperFoldHead").addEventListener("click", () => toggleSubFold(true));
  $("#helperScroll").addEventListener("scroll", syncHelperFoldHead, { passive: true });
  // 工作条：左边的改动点开浮出清单，右边的帮手点开差遣面板
  $("#helperBar").addEventListener("click", event => {
    if (event.target.closest(".work-changes")) {
      workFilesOpen = !workFilesOpen;
      renderHelperBar();
      if (workFilesOpen) $("#helperBar .work-files")?.classList.add("opening");
      return;
    }
    const file = event.target.closest("[data-change-path]"),
      message =
        file && [...(currentConversation()?.messages || [])].reverse().find(m => m.role === "assistant" && m.status === "streaming");
    if (message) return openChangeDiff(message, file.dataset.changePath, file);
    const id = event.target.closest(".work-helpers")?.dataset.helper;
    if (id) openHelperPanel(id);
  });
  // 行迹里的那枚签：点它（或敲回车 / 空格）同样开面板。传话、叫停的签开的是它说到的那名帮手；回报那道细线上点名字也开
  const openFromCard = card => openHelperPanel(card.dataset.ref || card.dataset.stepId || "", card.dataset.note || "");
  $("#messages").addEventListener("click", event => {
    const relay = event.target.closest("[data-relay-step]");
    if (relay) return openHelperPanel(relay.dataset.relayStep || "");
    // 后台指令结束的那一项：回到行迹里挂它的那一步（行迹折着就摊开）
    const reveal = event.target.closest("[data-relay-reveal]");
    if (reveal) {
      const card = document.querySelector(`#messages .tool-step[data-step-id="${CSS.escape(reveal.dataset.relayReveal || "")}"]`),
        stack = card?.closest(".tool-stack");
      if (stack && !stack.open) setProcessDetails(stack, true);
      if (card) scrollChatTo(card, "center");
      return;
    }
    const head = event.target.closest(".tool-step-delegate > .tool-step-head");
    if (head) openFromCard(head.parentElement);
  });
  $("#messages").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const head = event.target.closest?.(".tool-step-delegate > .tool-step-head");
    if (!head) return;
    event.preventDefault();
    openFromCard(head.parentElement);
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
}
// 差遣那扇窗盖在正文上，Esc 先收它；窗里摊开的帮手清单又在窗上
defineLayer({
  name: "helper-list",
  rank: 105,
  open: () => helperPanelOpen() && isShown("#helperList"),
  close: () => $("#helperList").classList.add("hidden")
});
defineLayer({ name: "helper", rank: 100, open: helperPanelOpen, close: closeHelperPanel });
