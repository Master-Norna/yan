// 言 · 游目 · 递点按：看台上的坐标换回网页里的，键鼠转发；看台各处的事件
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 递点按：看台上的坐标按缩放倍数换回网页里的 ----------
/** @param {MouseEvent} e */
function stagePoint(e) {
  const r = $("#stageFrame").getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * stage.meta.width, y: ((e.clientY - r.top) / r.height) * stage.meta.height };
}
/** @param {KeyboardEvent | MouseEvent} e */
const stageMods = e => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
const STAGE_BUTTONS = ["left", "middle", "right"];
/** @param {string} type @param {MouseEvent} e @param {Record<string, any>} [extra] */
function stageMouse(type, e, extra = {}) {
  if (!stage.session) return;
  void stageSend(
    "Input.dispatchMouseEvent",
    { type, ...stagePoint(e), modifiers: stageMods(e), buttons: e.buttons, ...extra },
    stage.session
  ).catch(() => {});
}
/** @param {string} type @param {KeyboardEvent} e @param {string} [text] */
function stageKey(type, e, text = "") {
  if (!stage.session) return;
  void stageSend(
    "Input.dispatchKeyEvent",
    {
      type,
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      nativeVirtualKeyCode: e.keyCode,
      modifiers: stageMods(e),
      autoRepeat: e.repeat,
      location: e.location,
      ...(text ? { text, unmodifiedText: text } : {})
    },
    stage.session
  ).catch(() => {});
}
// 「执事」浮出的近几步：几秒前、此刻
function stageRenderSteps() {
  const now = Date.now();
  $("#stageSteps").innerHTML =
    `<span class="stage-steps-head">${t(`执事近几步`)}</span>` +
    [...stage.trail]
      .reverse()
      .map((step, i) => {
        const ago = Math.round((now - step.at) / 1000),
          when = i === 0 && stage.busy ? t("此刻") : ago < 60 ? t`${Math.max(1, ago)} 秒` : t`${Math.round(ago / 60)} 分`;
        return `<span class="stage-step${i === 0 ? " cur" : ""}"><small>${when}</small>${escapeHtml(step.text)}</span>`;
      })
      .join("");
}
// 浏览器自己接的几个键（递进网页没人管）：Ctrl+L / Alt+D / F6 到地址栏，Ctrl+O 开本机文件，F5 / Ctrl+R 重载（加 Shift 不用缓存），Alt+← / → 前后。
// Ctrl+T、Ctrl+W 外头的浏览器拦不住，不接
/** @param {KeyboardEvent} e */
function stageShortcut(e) {
  const key = e.key.toLowerCase(),
    ctrl = e.ctrlKey || e.metaKey;
  if (key === "escape" && stage.pen) stageSetPen(false);
  else if ((ctrl && key === "l") || (e.altKey && key === "d") || key === "f6") stageEditUrl();
  else if (ctrl && key === "f") stageFindOpen();
  else if (ctrl && key === "o") void stageOpenLocal();
  else if (ctrl && (key === "=" || key === "+" || key === "-" || key === "0")) stageZoomStep(key === "0" ? 0 : key === "-" ? -1 : 1);
  else if (key === "f5" || (ctrl && key === "r")) {
    if (stage.session) void stageSend("Page.reload", { ignoreCache: e.shiftKey }, stage.session).catch(() => {});
  } else if (e.altKey && (key === "arrowleft" || key === "arrowright")) void stageTravel(key === "arrowleft" ? -1 : 1);
  else return false;
  return true;
}
// 打字经一个看不见的输入框：输入法的候选框浮在它那里，所以它要跟着网页里的光标走——先挪到点下的地方，
// 网页把光标放好后再量一回光标挪过去（stageCaretSoon）。组字中的字随打随递（Input.imeSetComposition），网页里带着下划线现出来，与原生一样
/** @param {MouseEvent} e */
function stageFocusKeys(e) {
  const keys = $("#stageKeys"),
    box = $("#stageView").getBoundingClientRect();
  keys.style.left = `${e.clientX - box.left}px`;
  keys.style.top = `${e.clientY - box.top}px`;
  keys.focus({ preventScroll: true });
}
// 网页里光标此刻在哪（视口坐标）：焦点落在同源 iframe 里就钻进去（在线文档的编辑区多套在 iframe 里，字画在 canvas 上，
// 但都有一个跟着光标走的隐藏输入框）；可编辑区取选区末端，输入框取框本身；量不出就不挪
const STAGE_CARET = `(() => {
  let doc = document, el = doc.activeElement, ox = 0, oy = 0;
  while (el && el.tagName === "IFRAME") {
    try {
      const r = el.getBoundingClientRect();
      ox += r.left + el.clientLeft;
      oy += r.top + el.clientTop;
      doc = el.contentDocument;
      el = doc && doc.activeElement;
    } catch { return null; }
  }
  if (!el || !doc) return null;
  let r = null;
  if (el.isContentEditable || doc.designMode === "on") {
    const s = doc.getSelection();
    if (s && s.rangeCount) {
      const range = s.getRangeAt(0).cloneRange();
      range.collapse(false);
      const rects = range.getClientRects();
      r = rects[rects.length - 1] || null;
    }
  }
  if (!r || !r.height) r = el === doc.body ? null : el.getBoundingClientRect();
  return r && r.height ? { x: ox + r.left, y: oy + r.top, h: Math.min(r.height, 60) } : null;
})()`;
// 点下、打字之后网页才动光标：稍候再量；组字当中不挪，候选框不跟着跳
function stageCaretSoon() {
  clearTimeout(stage.caretTimer);
  stage.caretTimer = window.setTimeout(() => {
    const session = stage.session;
    if (!session || stage.composing || document.activeElement !== $("#stageKeys")) return;
    stageSend("Runtime.evaluate", { expression: STAGE_CARET, returnByValue: true }, session)
      .then(({ result }) => {
        const caret = result?.value;
        if (!caret || stage.composing || session !== stage.session) return;
        const keys = $("#stageKeys"),
          r = $("#stageFrame").getBoundingClientRect(),
          box = $("#stageView").getBoundingClientRect(),
          k = r.width / (stage.meta.width || r.width);
        keys.style.left = `${r.left - box.left + caret.x * k}px`;
        keys.style.top = `${r.top - box.top + caret.y * k}px`;
        keys.style.height = `${Math.max(12, caret.h * k)}px`;
      })
      .catch(() => {});
  }, 80);
}
/** @param {string} raw */
function stageGo(raw) {
  const url = stageUrlOf(raw);
  if (!url || !stage.ws) return;
  stage.goAt = Date.now();
  // 一页都没开着：新开一页去
  const go = stage.session ? stageSend("Page.navigate", { url }, stage.session) : stageSend("Target.createTarget", { url });
  void go.catch(error => toast(t`打开失败：${String(error.message || error).slice(0, 80)}`));
}
// 开本机文件（纸签、Ctrl+O）：经桥接弹系统的选文件窗，拿真路径开 file://——不拷进临时目录，网页旁的样式、脚本、图才引得到。
// 浏览器显示不了的（Office 文档等）会当下载，由 downloadWillBegin 那头转交本机程序
async function stageOpenLocal() {
  if (!stage.ws) return void stageLaunch();
  try {
    const { paths } = await bridge("/api/work/pick", { files: true });
    if (paths[0]) stageGo(paths[0]);
  } catch (error) {
    toast(t`打开失败：${String(error.message || error).slice(0, 80)}`);
  }
}
// 地址栏里输的话换成网址：本机路径（盘符起头的、/ 起头的）、本机服务、带协议的照走；像网址的（有点、没空格）补 https；余下当成要搜的话，交给纸签里选的那家。
// 路径里的 % # ? 是文件名的一部分，转义了才不被当成网址的记号
/** @param {string} raw */
function stageUrlOf(raw) {
  const text = raw.trim();
  if (!text) return "";
  return /^([a-z]:[\\/]|\/(?!\/))/i.test(text)
    ? `file://${text.startsWith("/") ? "" : "/"}${text.replace(/\\/g, "/").replace(/[%#?]/g, encodeURIComponent)}`
    : /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?(\/|$)/i.test(text)
      ? `http://${text}`
      : /^([a-z][\w+.-]*:\/\/|(about|data|file|javascript|mailto|view-source|edge|chrome):)/i.test(text)
        ? text
        : !/\s/.test(text) && /^[^/?#]+\.[^/?#.]+([/?#:]|$)/.test(text)
          ? `https://${text}`
          : `${STAGE_SEARCH[stageSearchEngine()][1]}${encodeURIComponent(text)}`;
}

// ---------- 页内查找 ----------
// 浏览器自带的查找条在屏幕外看不见，言自己画：地址行换成查找栏。网页里用 CSS 的高亮（::highlight，不动网页的 DOM），
// 各处淡黄、当前一处着朱并滚到眼前；只找同一段文字里的（跨标签的一句找不到，够用）
const STAGE_FIND = `(q, step) => {
  const st = (window[Symbol.for("yan-find")] ||= { q: "", ranges: [], at: -1 });
  if (!st.sheet) {
    st.sheet = new CSSStyleSheet();
    st.sheet.replaceSync("::highlight(yan-find){background:rgba(232,186,72,.45)}::highlight(yan-find-at){background:rgba(196,98,64,.7);color:#fff}");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, st.sheet];
  }
  if (!q) {
    CSS.highlights.delete("yan-find");
    CSS.highlights.delete("yan-find-at");
    st.q = "";
    st.ranges = [];
    return { n: 0, at: 0 };
  }
  if (q !== st.q || !step) {
    st.q = q;
    st.ranges = [];
    st.at = -1;
    const needle = q.toLowerCase(),
      walk = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement?.tagName || "") || !n.parentElement?.checkVisibility?.() ? 2 : 1)
      });
    for (let node; (node = walk.nextNode()) && st.ranges.length < 2000; ) {
      const text = node.data.toLowerCase();
      for (let i = text.indexOf(needle); i >= 0 && st.ranges.length < 2000; i = text.indexOf(needle, i + needle.length)) {
        const range = new Range();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        st.ranges.push(range);
      }
    }
  }
  const n = st.ranges.length;
  if (!n) {
    CSS.highlights.delete("yan-find");
    CSS.highlights.delete("yan-find-at");
    return { n: 0, at: 0 };
  }
  st.at = st.at < 0 ? 0 : (st.at + (step || 0) + n) % n;
  CSS.highlights.set("yan-find", new Highlight(...st.ranges));
  CSS.highlights.set("yan-find-at", new Highlight(st.ranges[st.at]));
  st.ranges[st.at].startContainer.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
  return { n, at: st.at + 1 };
}`;
function stageFindOpen() {
  const input = /** @type {HTMLInputElement} */ ($("#stageFindInput"));
  $("#stageFind").classList.remove("hidden");
  $("#stageNav").classList.add("finding");
  input.focus();
  input.select();
  if (input.value) void stageFindRun(0);
}
function stageFindClose() {
  $("#stageFind").classList.add("hidden");
  $("#stageNav").classList.remove("finding");
  $("#stageFindCount").textContent = "";
  if (stage.session) void stageSend("Runtime.evaluate", { expression: `(${STAGE_FIND})("", 0)` }, stage.session).catch(() => {});
  $("#stageKeys").focus({ preventScroll: true });
}
/** @param {number} step 0 重找，1 下一处，-1 上一处 */
async function stageFindRun(step) {
  const q = /** @type {HTMLInputElement} */ ($("#stageFindInput")).value;
  if (!stage.session) return;
  const result = await stageSend(
    "Runtime.evaluate",
    { expression: `(${STAGE_FIND})(${JSON.stringify(q)}, ${step})`, returnByValue: true },
    stage.session
  ).catch(() => null);
  const { n = 0, at = 0 } = result?.result?.value || {};
  $("#stageFindCount").textContent = !q ? "" : n ? `${at} / ${n}` : t("无");
}
function bindStageFind() {
  const input = /** @type {HTMLInputElement} */ ($("#stageFindInput"));
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void stageFindRun(0), 120);
  });
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") void stageFindRun(e.shiftKey ? -1 : 1);
    else if (e.key === "Escape") stageFindClose();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      input.select();
    }
  });
  $("#stageFind").addEventListener("click", e => {
    const step = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-stage-find]"))?.dataset.stageFind;
    if (step === "close") stageFindClose();
    else if (step) void stageFindRun(Number(step));
  });
}

function bindStage() {
  // 入口那一笔朱竖：12 × 64 的画幅，自页顶垂下、收笔出锋
  $("#stagePin svg").innerHTML = brushStroke([6, 0, 5.4, 32, 6.3, 62], 4.2, { tone: "zhu", tail: 0, head: 1 });
  $("#stagePin").addEventListener("click", openStage);
  $("#stageClose").addEventListener("click", closeStage);
  $("#stageMenuBtn").addEventListener("click", e => {
    e.stopPropagation();
    stageOpenMenu(/** @type {HTMLElement} */ (e.currentTarget));
  });
  $("#stageWide").addEventListener("click", () => stageSetWide(!$("#stagePanel").classList.contains("wide")));
  $("#stageLetter").addEventListener("click", e => {
    if (/** @type {HTMLElement} */ (e.target).closest("[data-stage-release]")) void stageRelease(true);
  });
  // 记在本机的几样：缩放、下载记录（适应页面与搜索用哪家在配置里，见设置 → 游目）
  try {
    stage.zoom = Number(localStorage.getItem("yan-stage-zoom")) || 1;
    stage.downloads = JSON.parse(localStorage.getItem("yan-stage-downloads") || "[]");
    stage.downloadsSeen = Date.now();
  } catch {}
  bindStageFind();
  $("#stageNewTab").addEventListener("click", stageNewTab);
  $("#stageMarks").addEventListener("click", e => {
    e.stopPropagation();
    void stageOpenMarks(/** @type {HTMLElement} */ (e.currentTarget));
  });
  $("#stageEmpty").addEventListener("click", e => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.closest("[data-stage-launch]")) void stageLaunch();
    else if (target.closest("[data-stage-new]")) stageNewTab();
  });
  // 看台一变大小（拖宽窄、阔、窗口缩放），停手片刻后把浏览器的窗口跟上；被旁注挤开、又回来的，停收或接上画面
  new ResizeObserver(() => {
    stageSnap();
    if (stageVisible() !== stage.seen) stageWake();
    clearTimeout(stage.fitTimer);
    stage.fitTimer = window.setTimeout(() => void stageFit(), 250);
  }).observe($("#stageView"));
  document.addEventListener("visibilitychange", () => stageShown() && stageWake());
  // 开合、阔的动效落定后再对一回像素（动着时量的不作数）
  for (const type of ["animationend", "transitionend"]) $("#stagePanel").addEventListener(type, () => stageSnap());
  // 网页的提示框：Enter 即确定，Esc 即取消（不让 Esc 再去收别的）
  const dialog = $("#stageDialog");
  dialog.addEventListener("click", e => {
    const answer = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-stage-answer]"));
    if (answer) stageAnswer(answer.dataset.stageAnswer === "yes");
  });
  dialog.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape") stageAnswer(false);
    else if (e.key === "Enter" && /** @type {HTMLElement} */ (e.target).matches("input")) stageAnswer(true);
  });
  $("#stageTabs").addEventListener("click", e => {
    const target = /** @type {HTMLElement} */ (e.target),
      close = /** @type {HTMLElement | null} */ (target.closest("[data-stage-close]"));
    if (close) return void stageSend("Target.closeTarget", { targetId: close.dataset.stageClose }).catch(() => {});
    const tab = /** @type {HTMLElement | null} */ (target.closest("[data-stage-tab]"));
    if (!tab || tab.dataset.stageTab === stage.current) return;
    stageActivate(tab.dataset.stageTab || "");
  });
  for (const button of document.querySelectorAll("[data-stage-nav]"))
    button.addEventListener("click", () => {
      const action = /** @type {HTMLElement} */ (button).dataset.stageNav;
      if (!stage.session) return;
      // 前后按浏览器记的历史走，不经网页里的脚本（脚本卡住、出错页上也走得动）
      if (action === "reload") void stageSend("Page.reload", {}, stage.session).catch(() => {});
      else void stageTravel(action === "back" ? -1 : 1);
    });
  // 地址行平时是「域名 › 页题」一句，点它换成输入框
  const url = /** @type {HTMLInputElement} */ ($("#stageUrl"));
  $("#stageAddr").addEventListener("click", stageEditUrl);
  url.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      stageGo(url.value);
      url.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      url.blur();
    }
  });
  url.addEventListener("blur", () => {
    url.classList.add("hidden");
    $("#stageAddr").classList.remove("hidden");
    stageRender();
  });
  for (const type of ["pointerenter", "focus"]) $("#stageBusy").addEventListener(type, stageRenderSteps);

  const frame = $("#stageFrame"),
    keys = /** @type {HTMLTextAreaElement} */ ($("#stageKeys"));
  frame.addEventListener("pointerdown", e => {
    e.preventDefault();
    // 鼠标侧键：后退、前进（浏览器自己接的键，递进网页没人管）
    if (e.button === 3 || e.button === 4) return void stageTravel(e.button === 3 ? -1 : 1);
    frame.setPointerCapture(e.pointerId);
    // 圈点：开着「圈」或按住 Alt，这一下是下笔，不递进网页
    if (e.button === 0 && (stage.pen || e.altKey)) return void stageInkStart(e);
    stageFocusKeys(e);
    stage.userAt = Date.now();
    // 连点计数自己数：pointerdown 不带 detail
    const click = stage.click,
      again = e.timeStamp - click.at < 450 && Math.hypot(e.clientX - click.x, e.clientY - click.y) < 6;
    Object.assign(click, { at: e.timeStamp, x: e.clientX, y: e.clientY, count: again ? click.count + 1 : 1 });
    // 中键、Ctrl（不带 Shift）点链接：浏览器在后台开新页
    if ((e.button === 1 || e.ctrlKey || e.metaKey) && !e.shiftKey) stage.behindAt = Date.now();
    stageMouse("mousePressed", e, { button: STAGE_BUTTONS[e.button] || "left", clickCount: click.count });
  });
  frame.addEventListener("pointerup", e => {
    // 侧键在按下时已办了；松开时外头的浏览器会拿它把言这一页后退，拦下
    if (e.button === 3 || e.button === 4) return void e.preventDefault();
    if (stageInkEnd(e)) return;
    stageMouse("mouseReleased", e, { button: STAGE_BUTTONS[e.button] || "left", clickCount: stage.click.count });
    stageCaretSoon();
  });
  frame.addEventListener("mouseup", e => (e.button === 3 || e.button === 4) && e.preventDefault());
  // 移动一帧只递一次
  frame.addEventListener("pointermove", e => {
    if (stageInkMove(e)) return;
    if (!stage.moved)
      requestAnimationFrame(() => {
        const last = stage.moved;
        stage.moved = null;
        if (last) stageMouse("mouseMoved", last, { button: last.buttons & 1 ? "left" : last.buttons & 2 ? "right" : "none" });
      });
    stage.moved = e;
  });
  frame.addEventListener(
    "wheel",
    e => {
      e.preventDefault();
      stagePickClose();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      stageMouse("mouseWheel", e, { deltaX: e.deltaX * unit, deltaY: e.deltaY * unit });
    },
    { passive: false }
  );
  // 指针移出画面：网页那头也得知道它走了（悬停才展开的菜单收回去），递一下画面外的一点
  frame.addEventListener("pointerleave", e => {
    if (e.buttons || stageInking || !stage.session) return;
    stage.moved = null;
    void stageSend("Input.dispatchMouseEvent", { type: "mouseMoved", x: -1, y: -1, modifiers: stageMods(e) }, stage.session).catch(
      () => {}
    );
    $("#stageFrame").style.cursor = "";
  });
  frame.addEventListener("contextmenu", e => e.preventDefault());
  // 键盘：拦下来整个递进网页（包括 Esc、Ctrl+C / V——剪贴板本是同一台机器的），不让言自己的快捷键接走
  keys.addEventListener("keydown", e => {
    e.stopPropagation();
    e.preventDefault();
    // 人按的键：此时要开的下拉框认是人开的（F4、Alt+↓、空格）
    stage.keyAt = Date.now();
    if (stageShortcut(e)) return;
    const text = e.key === "Enter" ? "\r" : e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ? e.key : "";
    stageKey(text ? "keyDown" : "rawKeyDown", e, text);
    stageCaretSoon();
  });
  keys.addEventListener("keyup", e => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    stageKey("keyUp", e);
  });
  // 组字：随打随递，网页里现出带下划线的拼音；选定了一次提交，取消了（Esc、删光）把网页里那截撤掉
  keys.addEventListener("compositionstart", () => (stage.composing = true));
  keys.addEventListener("compositionupdate", e => {
    const text = e.data || "";
    if (stage.session)
      void stageSend("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length }, stage.session).catch(
        () => {}
      );
  });
  keys.addEventListener("compositionend", e => {
    stage.composing = false;
    if (stage.session)
      void stageSend(
        e.data ? "Input.insertText" : "Input.imeSetComposition",
        e.data ? { text: e.data } : { text: "", selectionStart: 0, selectionEnd: 0 },
        stage.session
      ).catch(() => {});
    keys.value = "";
    stageCaretSoon();
  });
  // 不经按键进来的字（表情面板、剪贴板历史）：照样递进去；输入法那一路在 compositionend 递，这里不重复
  keys.addEventListener("input", e => {
    const input = /** @type {InputEvent} */ (e);
    if (input.isComposing) return;
    if (input.inputType === "insertText" && input.data && stage.session)
      void stageSend("Input.insertText", { text: input.data }, stage.session).catch(() => {});
    keys.value = "";
  });
  keys.addEventListener("focus", () => $("#stageView").classList.add("typing"));
  keys.addEventListener("blur", () => $("#stageView").classList.remove("typing"));

  // 拖左缘调宽窄；记在本机（与侧栏开合一样不随备份走）
  const grip = $("#stageGrip");
  grip.addEventListener("pointerdown", e => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add("stage-dragging");
  });
  grip.addEventListener("pointermove", e => {
    if (grip.hasPointerCapture(e.pointerId)) stageSetWidth($(".app").getBoundingClientRect().right - e.clientX);
  });
  grip.addEventListener("lostpointercapture", () => {
    document.body.classList.remove("stage-dragging");
    try {
      localStorage.setItem("yan-stage-width", String(stage.width));
    } catch {}
  });
}
// 给端到端测试：读状态、立即去连（见 test/stage.mjs）
window.__yanStage = { state: stage, locate: stageLocate, go: stageGo, sendFiles: stageSendFiles, markPinned: stageMarkExecutorPinned };
