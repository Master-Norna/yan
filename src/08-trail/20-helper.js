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
    // 中辍的帮手：行迹折起后签就藏住了，在这儿挂着，直到续上（设计稿/98 甲）
    held = c && view === "chat" ? heldHelpers(c) : [],
    stats = message ? changeStats(message) : { files: [], added: 0, removed: 0 },
    // 等待确认有请示条，不在这里重说
    label = c && requestJob(c.id)?.label,
    notice = label && label !== AWAITING ? label : "";
  if (!helpers.length && !held.length && !stats.files.length && !notice) {
    workFilesOpen = false;
    bar.dataset.sig = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  const changes = stats.files.length
      ? `<button type="button" class="work-changes" aria-expanded="${workFilesOpen}" title="${t(`这一答改过的文件`)}"><span class="seal change-seal" aria-hidden="true">${t(`改`)}</span><span>${t`改 ${stats.files.length} 件`}</span><span class="change-count">${changeCountHtml(stats)}</span></button>`
      : "",
    // 题目逐次取：条子常在步骤刚入册、runDelegate 还没把题目填上时就搭好了
    who =
      helpers.length > 1
        ? t`${helpers.length} 名帮手 · 进行中`
        : helpers.length
          ? t`帮手「${String(helpers[0].title || "").slice(0, 24)}」· ${delegateDoing(helpers[0])}`
          : "",
    helper = helpers.length
      ? `<button type="button" class="work-helpers" data-helper="${escapeHtml(helpers[0].id)}" title="${t(`打开差遣面板`)}"><span class="seal helper-seal" aria-hidden="true">${t(`帮`)}</span><span class="work-helpers-text">${escapeHtml(who)}</span><span class="work-helpers-go" aria-hidden="true">›</span></button>`
      : "",
    // 点字开面板看它停在哪，末尾那一笔续上（几名一并续）；缘由在悬停里
    heldName = String(held[0]?.title || "").slice(0, 24),
    heldSteps = held.length === 1 ? (held[0].sub?.steps || []).filter(s => !isFold(s)).length : 0,
    heldWhat =
      held.length > 1
        ? t`${held.length} 名帮手中辍`
        : heldSteps
          ? t`帮手「${heldName}」中辍于第 ${heldSteps} 步`
          : held.length
            ? t`帮手「${heldName}」中辍`
            : "",
    heldHtml = held.length
      ? `<span class="work-held"><button type="button" class="work-helpers held" data-helper="${escapeHtml(held[0].id)}" title="${escapeHtml(held.map(step => `「${step.title || ""}」${stepText(step.result) || ""}`).join("\n"))}"><span class="seal helper-seal" aria-hidden="true">${t(`帮`)}</span><span class="work-helpers-text">${escapeHtml(heldWhat)}</span></button><button type="button" class="tool-state goon" data-helper-resume="${held.length > 1 ? "" : escapeHtml(held[0].id)}" title="${t(`续上`)}" aria-label="${t(`续上`)}">${brushIcon("forward")}</button></span>`
      : "",
    html = `${changes}${notice ? `<span class="work-notice" role="status">${escapeHtml(notice)}</span>` : ""}${helper}${heldHtml}${stats.files.length ? changeFilesHtml(stats, workFilesOpen, " work-files") : ""}`;
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
// 一名帮手一页：差遣与几回续派按先后摞下去，每趟一来一回——主模型交的命落在右侧淡底里（与正文里人说的话同形），
// 帮手的行迹与回报作一答（设计稿/99 乙）。续派原先另开一页，上一趟要翻回去看，接着谁的话做的就看不清了。
// 瞥一眼不必开窗：签自己在呼吸，输入框上方还有帮手条。几名帮手用 ‹ n/m › 翻，翻不动了就点中间的计数出列表
let helperKeyOpen = ""; // 窗里正看着的那名帮手（helperKey）
let helperRunFocus = ""; // 点开它的那一趟：合起时回到这一趟的签
/** @type {Element|null} */
let helperReturnFocus = null; // 开窗前焦点所在，合上时交还
const helperSeen = new Map(); // 各趟步骤的就地更新台账，趟 id → 台账（与行迹各记各的，互不干扰）
/** 当前对话里帮手的每一趟，按发生先后 */
function allDelegateSteps() {
  return helperRuns(currentConversation());
}
function helperStepById(id) {
  return allDelegateSteps().find(step => step.id === id) || null;
}
/** 窗里这名帮手的各趟 */
function openHelperRuns() {
  return allDelegateSteps().filter(step => helperKey(step) === helperKeyOpen);
}
/** 这段对话里的各名帮手，按头一趟的先后；每名取它最近的一趟 */
function helperLatestRuns() {
  const latest = new Map();
  for (const step of allDelegateSteps()) latest.set(helperKey(step), step);
  return [...latest.values()];
}
// 几趟合起来的一句：做着、断着、没做成的照最近一趟说（第几趟），都收了工的合计步数与用时——
// 原先「2 趟 · 1 步 · 21 秒」的步数用时只是末一趟的，紧跟着的耗墨却是几趟的合计
/** @param {Step[]} runs 同一名帮手的各趟 */
function helperRunsMeta(runs) {
  const { status, meta } = delegateSubState(runs.at(-1));
  if (runs.length < 2) return meta;
  if (status !== "done") return t`第 ${runs.length} 趟 · ${meta}`;
  const steps = runs.reduce((sum, step) => sum + (step.sub?.steps || []).filter(s => !isFold(s)).length, 0),
    ms = runs.reduce((sum, step) => sum + Number(step.sub?.durationMs || 0), 0);
  return [t`${runs.length} 趟`, t`${steps} 步`, ms ? spanText(ms) : ""].filter(Boolean).join(" · ");
}
function helperPanelOpen() {
  const panel = $("#helperModal");
  return !!panel && !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
// 点哪一趟的签就开这名帮手、滚到那一趟；行迹开合照正文（见 helperRunFolded）。noteId：传话的签点开时，直接翻到递去的那句话
function openHelperPanel(stepId, noteId = "") {
  const step = helperStepById(stepId);
  if (!step) return;
  const fresh = helperKey(step) !== helperKeyOpen || !helperPanelOpen();
  helperKeyOpen = helperKey(step);
  helperRunFocus = step.id;
  // 传话要翻到那句话，那一趟总得摊开；是程序替人开的，不记在步骤上（同正文 revealStep）
  helperPeek = noteId ? step.id : "";
  toggleHelperList(false);
  const modal = $("#helperModal");
  showNow(modal);
  // 焦点进窗：敲回车开的，Tab 不再落到窗底下的正文里；合上时交还
  if (!modal.contains(document.activeElement)) {
    helperReturnFocus = document.activeElement;
    modal.focus({ preventScroll: true });
  }
  renderHelperPanel(fresh);
  const stage = $("#helperScroll"),
    body = $("#helperPanelBody"),
    run = body.querySelector(`.helper-run[data-run="${CSS.escape(step.id)}"]`);
  syncSubFold(run?.querySelector(":scope > .sub-trail"), step);
  const note = noteId && body.querySelector(`[data-step-id="${CSS.escape(noteId)}"]`);
  if (note) {
    const stack = note.closest("details.sub-steps");
    if (stack) {
      stack.dataset.touched = "1";
      setProcessDetails(stack, true);
    }
    requestAnimationFrame(() => note.scrollIntoView({ block: "center" }));
    return;
  }
  // 头一趟从纸顶看起；续派的那一趟停在它的命上，前几趟在上头
  if (!run || run === body.firstElementChild) stage.scrollTop = 0;
  else stage.scrollTop += run.getBoundingClientRect().top - stage.getBoundingClientRect().top - 12;
}
function closeHelperPanel() {
  helperKeyOpen = "";
  helperRunFocus = "";
  helperPeek = "";
  helperSeen.clear();
  const panel = $("#helperModal");
  if (panel && !panel.classList.contains("hidden")) hideWithFade(panel);
  if (helperReturnFocus?.isConnected) helperReturnFocus.focus({ preventScroll: true });
  helperReturnFocus = null;
}
// ‹ › 翻到前一名 / 后一名帮手，开在它最近的那一趟
function stepHelperPanel(delta) {
  const all = helperLatestRuns(),
    at = all.findIndex(step => helperKey(step) === helperKeyOpen),
    next = all[at + delta];
  if (next) openHelperPanel(next.id);
}
// 计数点开的那张列表：帮手多了，一个个翻就难受。浮在计数下的一张纸签，开合同模型签（向下舒展、淡去）；
// 原先是顶栏下一整条横带，一开就把纸往下推（设计稿/154 一）
/** @param {boolean} [open] */
function toggleHelperList(open) {
  const list = $("#helperList"),
    shown = isShown("#helperList");
  open ??= !shown;
  $("#helperNav .helper-nav-count")?.setAttribute("aria-expanded", String(open));
  if (open === shown) return;
  if (!open) return hideWithFade(list);
  renderHelperList();
  showNow(list);
}
function renderHelperList() {
  const host = $("#helperList");
  if (!host) return;
  const all = allDelegateSteps();
  host.innerHTML = helperLatestRuns()
    .map((step, i) => {
      const { status } = delegateSubState(step),
        meta = helperRunsMeta(all.filter(run => helperKey(run) === helperKey(step)));
      return `<button type="button" class="helper-list-item${helperKey(step) === helperKeyOpen ? " here" : ""}" data-helper-pick="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><span class="helper-list-no">${i + 1}</span><span class="helper-list-title">${escapeHtml(step.title || t("领命中"))}</span><span class="helper-list-meta">${escapeHtml(meta)}</span></button>`;
    })
    .join("");
}
// 帮手行迹的收起：每趟一行题头（折角 · 行迹 · 几轮 · 几步，与主行迹题头同一枚折角，点它开合）。
// 同主行迹：做着摊开、交了差就收，只露回报；最近一趟断了、没做成的摊着，好看清停在哪。点签开窗不另摊开——原先点哪趟就摊哪趟，
// 交了差的每回点进去都是一整条行迹，与正文对不上。人亲手开合过的记在步骤上（folded，同正文的 toolsOpen），翻走、刷新都还是那样。
// 题头滚出面板顶上时，面板顶栏右侧浮出同一枚「收起行迹」，收的是此刻顶在上面的那一趟，与主对话的书眉一个意思
let helperPeek = ""; // 传话的签点开时替人摊开的那一趟，合窗即忘
/** @param {Step} step */
function helperRunFolded(step) {
  // 传话替人摊开的那一趟压过人亲手收起的：不然那句话藏在收着的时间线里，翻不到
  if (step.id === helperPeek) return false;
  return step.folded ?? !(step === openHelperRuns().at(-1) && step.status !== "done");
}
/** @param {Step} step */
function syncSubFold(trail, step) {
  const { sub, steps, live } = delegateSubState(step);
  const head = trail?.querySelector(":scope > .sub-fold");
  if (!sub) return;
  // 眼看着它交差的那一刻：停一拍再收，先前亲手摊开过的也收（同主行迹，见 paintStack）
  const was = trail._status;
  trail._status = step.status;
  // 没有题头（只说了话就交差）：时间线里那段话就是回报，收着不重出
  if (!head) return foldSubTrail(trail, true, -1);
  if (was === "running" && step.status === "done") delete step.folded;
  const folded = helperRunFolded(step),
    rounds = trailGroups(sub).length,
    meta = live ? (steps.length ? t`${steps.length} 步 · 进行中` : t("进行中")) : t`${rounds} 轮 · ${steps.length} 步`;
  head.setAttribute("aria-expanded", String(!folded));
  rollText(head.querySelector(".sub-fold-meta"), meta);
  head.title = folded ? t("展开帮手的行迹") : t("收起帮手的行迹，只看回报");
  foldSubTrail(trail, folded, was === undefined ? -1 : was === "running" && step.status !== "running" ? SETTLE_DELAY : 0);
}
// 行迹的开合：时间线从零高滑开、淡入，收时反过来，同主行迹（setProcessDetails）；delay 为负即刚画出来，不动
/** @param {HTMLElement} trail @param {boolean} folded @param {number} delay */
function foldSubTrail(trail, folded, delay) {
  if (trail._foldTo === folded || (trail._foldTo === undefined && trail.classList.contains("folded") === folded)) return;
  trail._foldTo = folded;
  clearTimeout(trail._foldTimer);
  const body = /** @type {HTMLElement|null} */ (trail.querySelector(":scope > .sub-timeline")),
    settle = () => {
      trail._foldAnim = null;
      trail._foldTo = undefined;
      body?.style.removeProperty("overflow");
      trail.classList.toggle("folded", folded);
      syncHelperFoldHead();
    },
    run = () => {
      trail._foldTimer = 0;
      trail._foldAnim?.cancel();
      if (!body || delay < 0 || !trail.isConnected || inkMotionOff() || typeof body.animate !== "function") return settle();
      trail.classList.remove("folded");
      const height = Math.max(1, body.getBoundingClientRect().height),
        frames = [
          { height: "0px", opacity: 0, transform: "translateY(-5px)" },
          { height: `${height}px`, opacity: 1, transform: "translateY(0)" }
        ];
      body.style.overflow = "hidden";
      const animation = body.animate(folded ? frames.reverse() : frames, {
        duration: folded ? 380 : 420,
        easing: "cubic-bezier(.22,.72,.2,1)"
      });
      trail._foldAnim = animation;
      animation.onfinish = () => trail._foldAnim === animation && settle();
    };
  if (delay > 0) trail._foldTimer = setTimeout(run, delay);
  else run();
}
/** @param {string} id 哪一趟 @param {boolean} [fold] */
function toggleSubFold(id, fold) {
  const step = helperStepById(id),
    trail = $("#helperPanelBody").querySelector(`.helper-run[data-run="${CSS.escape(id)}"] > .sub-trail`);
  if (!step || !trail) return;
  const folded = fold ?? !helperRunFolded(step);
  // 人亲手开合了，替人摊开的那一回即作罢
  if (helperPeek === id) helperPeek = "";
  step.folded = folded;
  saveStoreSoon();
  syncSubFold(trail, step);
  // 从顶栏收起时，停回题头处
  const head = trail.querySelector(":scope > .sub-fold"),
    scroll = $("#helperScroll");
  if (head && head.getBoundingClientRect().top < scroll.getBoundingClientRect().top)
    scroll.scrollTo({
      top: scroll.scrollTop + head.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12,
      behavior: "smooth"
    });
}
function syncHelperFoldHead() {
  const button = $("#helperFoldHead");
  if (!button) return;
  const top = $("#helperScroll").getBoundingClientRect().top,
    trail = [...$("#helperPanelBody").querySelectorAll('.helper-run > .sub-trail:has(> .sub-fold[aria-expanded="true"])')].find(
      el =>
        el.querySelector(":scope > .sub-fold")?.getBoundingClientRect().bottom < top &&
        el.querySelector(":scope > .sub-timeline")?.getBoundingClientRect().bottom > top + 60
    );
  button.dataset.run = trail?.parentElement.dataset.run || "";
  button.classList.toggle("shown", !!trail);
}
// 一趟一来一回，同正文：命是右侧淡底里一段（同人说的话，不另题），长了同问句只露四行、点开看全（见 25-bubble.js）；
// 帮手那一答顶上一行「遣 帮手 · 时刻」（同主答的「言 模型 · 时刻」），做着时那枚印呼吸
/** @param {Element} ask @param {Element} meta @param {Step} step */
function paintHelperAsk(ask, meta, step) {
  const task = String(step.sub?.task || ""),
    text = ask.querySelector(".helper-ask-text"),
    when = meta.querySelector(".helper-meta-text");
  // 早先存下的没记领命的时刻，取派它的那一答的
  if (!when.textContent) {
    const at = step.sub?.at || currentConversation()?.messages.find(message => (message.steps || []).includes(step))?.timestamp;
    when.textContent = at ? t`帮手 · ${formatTime(at)}` : t("帮手");
  }
  if (text.dataset.task === task) return;
  text.dataset.task = task;
  ask.classList.toggle("hidden", !task);
  setBubbleText(text, task);
  watchBubbles(text);
}
/** @param {boolean} fresh 首次打开或换了一名帮手：从空白画起；否则就地更新 */
function renderHelperPanel(fresh = false) {
  if (!helperPanelOpen()) return;
  const runs = openHelperRuns(),
    last = runs.at(-1);
  // 那名帮手不在眼前了（换了对话、切了分支）：窗合上，不留一扇空的
  if (!last) return closeHelperPanel();
  const { status } = delegateSubState(last),
    all = helperLatestRuns(),
    at = all.findIndex(step => helperKey(step) === helperKeyOpen),
    stage = $("#helperScroll"),
    // 帮手做着、人停在纸底：新写的跟着往下走，同正文贴底；往上翻着看就不拽
    follow = !fresh && status === "running" && stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 48;
  $("#helperModal").dataset.status = status;
  const title = $("#helperTitle");
  if (title && title.textContent !== (last.title || t("领命中"))) title.textContent = last.title || t("领命中");
  // 耗墨不在题下合计：每趟交了差，那一答末尾自己写（同主答）
  rollText($("#helperPanelSub"), helperRunsMeta(runs));
  // ‹ n/m ›：只有一名帮手时不画
  const nav = $("#helperNav"),
    navKey = `${at + 1}/${all.length}`;
  if (nav && nav.dataset.key !== navKey) {
    nav.dataset.key = navKey;
    nav.innerHTML =
      all.length > 1
        ? `<button class="message-action" data-helper-step="-1" title="${t(`上一名帮手`)}" aria-label="${t(`上一名帮手`)}"${at <= 0 ? " disabled" : ""}>‹</button><button type="button" class="helper-nav-count" data-helper-list title="${t(`所有帮手`)}" aria-haspopup="true" aria-expanded="${isShown("#helperList")}">${navKey}</button><button class="message-action" data-helper-step="1" title="${t(`下一名帮手`)}" aria-label="${t(`下一名帮手`)}"${at >= all.length - 1 ? " disabled" : ""}>›</button>`
        : "";
  }
  if (isShown("#helperList")) renderHelperList();
  const host = $("#helperPanelBody");
  if (!host) return;
  // 各趟按先后：已画的就地更新，续派新起的一趟接在末尾；对不上了（切了分支）就从空白画起。
  // 帮手就是一条回复：与主答的行迹同一支笔（见 paintTimeline）。帮手每 350ms 刷一次，只动变了的部分——
  // 已画出的步骤输出不重起入场动画、用户收起的思绪不被摊开
  if (fresh || [...host.children].some((el, i) => /** @type {HTMLElement} */ (el).dataset.run !== runs[i]?.id)) {
    helperSeen.clear();
    host.innerHTML = "";
  }
  runs.forEach((step, i) => {
    let run = host.children[i];
    const blank = !run;
    if (blank) {
      host.insertAdjacentHTML(
        "beforeend",
        `<section class="helper-run" data-run="${escapeHtml(step.id)}"><div class="helper-ask" title="${t(`主模型交的命`)}">${bubbleHtml("", "helper-ask-text")}</div><div class="message-meta helper-meta"><span class="meta-seal" aria-hidden="true">${t(`遣`)}</span><span class="helper-meta-text"></span></div><div class="sub-trail"></div></section>`
      );
      run = host.lastElementChild;
    }
    run.dataset.status = step.status || "done";
    paintHelperAsk(run.firstElementChild, run.children[1], step);
    if (!helperSeen.has(step.id)) helperSeen.set(step.id, new Map());
    paintHelperTrail(run.lastElementChild, step, !blank, helperSeen.get(step.id));
  });
  if (follow) stage.scrollTop = stage.scrollHeight;
}
// 正文里那一步的签；所在的行迹收着、身子还没画（见 paintStack）就先画上
/** @param {string} stepId */
function paintedStep(stepId) {
  const message = currentConversation()?.messages.find(m => (m.steps || []).some(step => step.id === stepId));
  if (!message) return null;
  const stack = document.querySelector(`#messages [data-message="${CSS.escape(message.id)}"] details.tool-stack`);
  /** @type {any} */ (stack)?._paintBody?.();
  return stack?.querySelector(`.tool-step[data-step-id="${CSS.escape(stepId)}"]`) || null;
}
// 回到当前对话行迹里的那一步（摊开并取消尚未到期的自动收起）；帮手手上的一步不在正文行迹里，就回到派它的那枚签
function revealStep(id) {
  const cardOf = stepId => paintedStep(stepId) || document.querySelector(`#messages .tool-step[data-step-id="${CSS.escape(stepId)}"]`),
    owner = currentConversation()
      ?.messages.flatMap(message => message.steps || [])
      .find(step => step.sub?.steps?.some(sub => sub.id === id)),
    card = cardOf(id) || (owner ? cardOf(owner.id) : null),
    stack = card?.closest(".tool-stack");
  if (stack) settleDetails(stack, true);
  if (card) scrollChatTo(card, "center");
}
// 差遣面板：帮手条与行迹里的签打开它，遮罩与合起关上它，‹ › 与列表翻帮手
function bindHelperEvents() {
  // 帮手行迹的收起：各趟时间线上方的题头，与翻过题头后顶栏右侧浮出的那一枚
  $("#helperPanelBody").addEventListener("click", event => {
    const fold = event.target.closest(".sub-fold");
    if (fold) return toggleSubFold(fold.closest(".helper-run")?.dataset.run || "");
    // 那一趟末尾的「复制」：复制回报
    const copy = event.target.closest("[data-helper-copy]");
    if (copy) {
      const report = String(helperStepById(copy.closest(".helper-run")?.dataset.run || "")?.sub?.report || "");
      return void copyText(report).then(() => toast(t("已复制")));
    }
  });
  $("#helperFoldHead").addEventListener("click", event => toggleSubFold(event.currentTarget.dataset.run || "", true));
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
    const goon = event.target.closest("[data-helper-resume]");
    if (goon) {
      const c = currentConversation();
      return goon.dataset.helperResume ? resumeHelperStep(goon.dataset.helperResume) : c && void resumeHelpers(c);
    }
    const id = event.target.closest(".work-helpers")?.dataset.helper;
    if (id) openHelperPanel(id);
  });
  // 行迹里的那枚签：点它（或敲回车 / 空格）同样开面板。传话、叫停的签开的是它说到的那名帮手；回报那道细线上点名字也开
  const openFromCard = card => openHelperPanel(card.dataset.ref || card.dataset.stepId || "", card.dataset.note || "");
  $("#messages").addEventListener("click", event => {
    const relay = event.target.closest("[data-relay-step]");
    if (relay) return openHelperPanel(relay.dataset.relayStep || "");
    // 后台指令结束的那一项：回到行迹里挂它的那一步
    const reveal = event.target.closest("[data-relay-reveal]");
    if (reveal) return revealStep(reveal.dataset.relayReveal || "");
    // 签上的「续」是续上，不是开面板（见 bindTrailEvents）
    if (event.target.closest("[data-helper-resume]")) return;
    const head = event.target.closest(".tool-step-delegate > .tool-step-head");
    if (head) openFromCard(head.parentElement);
  });
  $("#messages").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest?.("button")) return;
    const head = event.target.closest?.(".tool-step-delegate > .tool-step-head");
    if (!head) return;
    event.preventDefault();
    openFromCard(head.parentElement);
  });
  // 合起即回到行迹里点开它的那一趟——原先「合」与「行迹」两个按钮做的本是同一件事
  $("#helperClose").onclick = () => {
    const id = helperRunFocus;
    closeHelperPanel();
    const card = paintedStep(id || "");
    if (!card) return;
    const stack = card.closest(".tool-stack");
    if (stack) settleDetails(stack, true);
    scrollChatTo(card, "center");
  };
  // 点遮罩、按 Esc 都关得掉，与设置、文件查看器一个脾气。纸张之外的空白由 .helper-stage 铺满，点在它上面也算点了遮罩；
  // 按下与松开都得落在空白处——在纸上选字、拖到纸外松手，click 会落到两者的共同祖先上，那不是要关窗
  const helperBackdrop = target => target === $("#helperModal") || target === $("#helperScroll");
  let helperPressedBackdrop = false;
  $("#helperModal").addEventListener("pointerdown", event => {
    helperPressedBackdrop = helperBackdrop(event.target);
    // 帮手清单开着，按在它与计数之外即收（同模型签）
    if (isShown("#helperList") && !event.target.closest("#helperList, [data-helper-list]")) toggleHelperList(false);
  });
  $("#helperModal").addEventListener("click", event => {
    if (helperPressedBackdrop && helperBackdrop(event.target)) closeHelperPanel();
    helperPressedBackdrop = false;
  });
  $("#helperModal").addEventListener("keydown", event => {
    if (event.key === "Tab") trapModalFocus(event, $("#helperModal"));
  });
  // ‹ › 翻帮手；中间的计数点开是一张列表——帮手多了一个个翻就难受
  $("#helperNav").addEventListener("click", event => {
    const move = event.target.closest("[data-helper-step]")?.dataset.helperStep;
    if (move) return stepHelperPanel(Number(move));
    if (event.target.closest("[data-helper-list]")) toggleHelperList();
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
  close: () => toggleHelperList(false)
});
defineLayer({ name: "helper", rank: 100, open: helperPanelOpen, close: closeHelperPanel });
