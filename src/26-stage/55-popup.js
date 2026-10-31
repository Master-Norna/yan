// 言 · 游目 · 浏览器另开小窗画的两样：下拉框与右键菜单。它们不在网页的画面里，screencast 收不到——人点下去什么也看不见。
// 巧处：与朱笔同一个耳目世界（50-ink.js 一并装进去），耳目拦下浏览器那扇小窗，把要画的报来，游目自己浮一张纸签。
// 下拉框：人按下、或按 F4 / Alt+↓ / 空格要开它时报选项；选好了再经耳目写回去、补发 input 与 change（网页的脚本照常收到）。
// 右键：报在什么上（链接、图、选中的字、输入框），纸签上只放几样简单的——游目本是给执事用的，浏览器那一大张不照搬。
// 网页自己拦下的（defaultPrevented：自带的菜单、自绘的下拉）、跨源框里的（量不出它在哪）不接，照浏览器原样。
// 执事点的，小窗同样不开，游目也不浮（不是人刚按的）。耳目随游目连上才装、断开即撤，不碰没在看的页

// 耳目里的一段：报选项、等游目递回选了第几项（token 认是不是同一回开的）；报右键在什么上
const STAGE_POPUP_EAR = `(() => {
  if (window.__yanStagePick) return;
  const popup = el => el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled;
  // 这一框在顶层视口里的偏移；跨源的框里 frameElement 是 null，量不出
  const offset = () => {
    let x = 0, y = 0, w = window;
    while (w !== w.top) {
      const f = w.frameElement;
      if (!f) return null;
      const r = f.getBoundingClientRect();
      x += r.left + f.clientLeft;
      y += r.top + f.clientTop;
      w = w.parent;
    }
    return { x, y };
  };
  let held = null, pressed = null;
  const tell = el => {
    const at = offset(), r = el.getBoundingClientRect(), token = Math.random().toString(36).slice(2);
    held = { el, token };
    const items = [...el.options].map((o, i) => {
      const g = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement : null;
      return { i, t: (o.label || o.text).replace(/\\s+/g, " ").trim(), g: g ? g.label : "", d: o.disabled || !!g?.disabled, h: o.hidden };
    }).filter(o => !o.h);
    try { ${STAGE_BINDING}(JSON.stringify({ kind: "pick", token, x: at.x + r.left, y: at.y + r.top, w: r.width, h: r.height, at: el.selectedIndex, items })); } catch {}
  };
  // 冒泡到顶才拦：网页自己拦了的不管
  addEventListener("mousedown", e => {
    pressed = null;
    if (!e.isTrusted || e.button !== 0 || e.defaultPrevented || !popup(e.target) || !offset()) return;
    e.preventDefault();
    e.target.focus();
    pressed = e.target;
  });
  addEventListener("click", e => {
    if (pressed && e.target === pressed) tell(pressed);
    pressed = null;
  });
  addEventListener("keydown", e => {
    if (!e.isTrusted || e.defaultPrevented || !popup(e.target) || !offset()) return;
    if (!(e.key === "F4" || (e.altKey && /^Arrow(Up|Down)$/.test(e.key)) || (e.key === " " && !e.ctrlKey && !e.altKey))) return;
    e.preventDefault();
    tell(e.target);
  });
  // 右键：报来在什么上。输入框里选中的字从框里取（getSelection 取不到），密码框的不取
  addEventListener("contextmenu", e => {
    const at = offset();
    if (!e.isTrusted || e.defaultPrevented || !at) return;
    e.preventDefault();
    const el = e.target instanceof Element ? e.target : null,
      link = el && el.closest("a[href]"),
      img = el && el.closest("img"),
      field = el && el.closest("input:not([type=button],[type=submit],[type=reset],[type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=image],[type=hidden]), textarea, [contenteditable]:not([contenteditable=false])");
    let text = "";
    try {
      text = field && field.type === "password" ? "" : field && typeof field.value === "string" ? field.value.slice(field.selectionStart, field.selectionEnd) : String(getSelection());
    } catch {}
    try { ${STAGE_BINDING}(JSON.stringify({ kind: "menu", x: at.x + e.clientX, y: at.y + e.clientY, link: link ? link.href : "", img: img ? img.currentSrc || img.src : "", text: text.trim().slice(0, 4000), edit: !!field && !field.readOnly && !field.disabled })); } catch {}
  });
  window.__yanStagePick = (token, i) => {
    if (!held || held.token !== token) return false;
    const { el } = held;
    held = null;
    if (!el.isConnected) return false;
    el.focus();
    if (i >= 0 && el.selectedIndex !== i) {
      el.selectedIndex = i;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  };
})()`;

// 人刚在游目里按过（点、键）才浮：执事点的不算
const stagePopupByUser = () => Date.now() - Math.max(stage.userAt, stage.keyAt) < 1500 && stageVisible();
// 纸签贴着网页里的那一处：一枚看不见的锚放到画面上对应的位置（网页的 CSS 像素按画面的缩放换算）
/** @param {number} x @param {number} y @param {number} [w] @param {number} [h] */
function stagePopupAt(x, y, w = 0, h = 0) {
  const frame = $("#stageFrame").getBoundingClientRect(),
    view = $("#stageView").getBoundingClientRect(),
    k = frame.width / (stage.meta.width || frame.width),
    anchor = $("#stagePickAt");
  Object.assign(anchor.style, {
    left: `${frame.left - view.left + x * k}px`,
    top: `${frame.top - view.top + y * k}px`,
    width: `${w * k}px`,
    height: `${h * k}px`
  });
  return { anchor, k };
}

// 正看的那一页里各个耳目世界（主框架与同源的子框架各一个）：递回选项时不知是哪一框报的，各问一声，token 对得上的那个接
/** @type {Set<number>} */
const stagePickWorlds = new Set();
/** @param {string} method @param {any} params */
function stagePickWorld(method, params) {
  if (method === "Runtime.executionContextCreated") {
    if (params.context.name === STAGE_WORLD) stagePickWorlds.add(params.context.id);
  } else if (method === "Runtime.executionContextDestroyed") stagePickWorlds.delete(params.executionContextId);
  else if (method === "Runtime.executionContextsCleared") stagePickWorlds.clear();
}

/**
 * 浮那张纸签：贴着网页里那一框，宽不窄于它；当前选着的着朱。项多（十二项以上）的顶上一栏筛选
 * @param {{ token: string, x: number, y: number, w: number, h: number, at: number, items: { i: number, t: string, g: string, d: boolean }[] }} box
 */
function stagePickOpen(box) {
  if (!stagePopupByUser() || !box.items?.length) return;
  const { anchor, k } = stagePopupAt(box.x, box.y, box.w, box.h),
    rows = [];
  let group = "";
  for (const item of box.items) {
    if (item.g !== group && (group = item.g)) rows.push(`<div class="stage-pop-head">${escapeHtml(group)}</div>`);
    rows.push(
      `<button type="button" role="option" data-pick="${item.i}" aria-selected="${item.i === box.at}" class="${item.i === box.at ? "active" : ""}${item.g ? " in" : ""}"${item.d ? " disabled" : ""}><span>${escapeHtml(item.t) || "&nbsp;"}</span></button>`
    );
  }
  const filter = box.items.length > 12 ? `<input class="stage-pick-filter" spellcheck="false" placeholder="${t(`筛选`)}">` : "";
  const pop = openFloatingPop(
    anchor,
    `${filter}<div class="stage-pick-list" role="listbox" style="min-width:${Math.min(300, Math.round(box.w * k))}px">${rows.join("")}</div>`,
    { align: "left" }
  );
  pop.classList.add("stage-pop", "stage-pick");
  const list = /** @type {HTMLElement} */ (pop.querySelector(".stage-pick-list")),
    shown = () => /** @type {HTMLButtonElement[]} */ ([...list.querySelectorAll("button:not([disabled]):not(.hidden)")]),
    current = /** @type {HTMLElement | null} */ (list.querySelector("button.active"));
  current?.scrollIntoView({ block: "center" });
  /** @type {HTMLElement | null} */ (pop.querySelector(".stage-pick-filter") || current || shown()[0])?.focus({ preventScroll: true });
  // 点选只认指针的：开它的那一下若是空格，松开时落在刚聚焦的项上会被当成一次点按；键盘的在 keydown 里办
  pop.addEventListener("click", e => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-pick]"));
    if (button && e.detail) stagePickChoose(box.token, Number(button.dataset.pick));
  });
  pop.addEventListener("keydown", e => {
    const items = shown(),
      at = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement)),
      move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (e.key === "Escape") stagePickChoose(box.token, -1);
    else if (move) items[at < 0 ? (move > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, at + move))]?.focus();
    else if (e.key === "Enter" || (e.key === " " && at >= 0)) {
      const pick = at >= 0 ? items[at] : items[0];
      if (pick) stagePickChoose(box.token, Number(pick.dataset.pick));
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  pop.querySelector(".stage-pick-filter")?.addEventListener("input", e => {
    const q = /** @type {HTMLInputElement} */ (e.target).value.trim().toLowerCase();
    let head = /** @type {HTMLElement | null} */ (null),
      any = false;
    for (const row of /** @type {HTMLElement[]} */ ([...list.children])) {
      if (row.matches(".stage-pop-head")) {
        head?.classList.toggle("hidden", !any);
        [head, any] = [row, false];
        continue;
      }
      const hit = !q || row.textContent.toLowerCase().includes(q);
      row.classList.toggle("hidden", !hit);
      any ||= hit;
    }
    head?.classList.toggle("hidden", !any);
  });
}
// 选了第几项（-1 是作罢）：经耳目写回网页；键盘交还网页
/** @param {string} token @param {number} index */
function stagePickChoose(token, index) {
  stagePickClose();
  $("#stageKeys").focus({ preventScroll: true });
  const session = stage.session;
  for (const id of stagePickWorlds)
    void stageSend(
      "Runtime.evaluate",
      { expression: `window.__yanStagePick?.(${JSON.stringify(token)}, ${index})`, contextId: id },
      session
    ).catch(() => {});
}
// 换页、断开、滚动网页：纸签收起（浏览器自己的那扇小窗也是这样）
function stagePickClose() {
  document.querySelector(".chip-pop:is(.stage-pick, .stage-ctx)")?.remove();
}

// ---------- 右键 ----------
// 链接：后台新开、复制；图：后台新开看图；选中的字：复制、引给执事；输入框：剪切、复制、粘贴；都不是：后退、前进、重载。
// 复制、剪切、粘贴递 Ctrl+C / X / V 进网页（剪贴板本是同一台机器的），与在网页里按键一样
/** @param {{ x: number, y: number, link: string, img: string, text: string, edit: boolean }} box */
function stageMenuOpen(box) {
  if (!stagePopupByUser()) return;
  const { anchor } = stagePopupAt(box.x, box.y),
    /** @type {MenuItem[][]} */ groups = [];
  if (box.link)
    groups.push([
      { id: "link-open", label: t("新标签打开链接"), run: () => stageOpenBehind(box.link) },
      {
        id: "link-copy",
        label: t("复制链接"),
        run: () => void copyText(stageReadable(box.link)).then(() => toast(t("链接已复制")))
      }
    ]);
  if (box.img) groups.push([{ id: "img-open", label: t("新标签看图"), run: () => stageOpenBehind(box.img) }]);
  const copy = { id: "copy", label: t("复制"), note: "Ctrl+C", run: () => stageCombo("c") };
  if (box.edit)
    groups.push([
      ...(box.text ? [{ id: "cut", label: t("剪切"), note: "Ctrl+X", run: () => stageCombo("x") }, copy] : []),
      { id: "paste", label: t("粘贴"), note: "Ctrl+V", run: () => stageCombo("v") }
    ]);
  else if (box.text) groups.push([copy]);
  if (box.text) groups.push([{ id: "quote", label: t("引给执事"), run: () => stageQuoteText(box.text) }]);
  if (!groups.length)
    groups.push([
      { id: "back", label: t("后退"), disabled: !stage.back, run: () => void stageTravel(-1) },
      { id: "forward", label: t("前进"), disabled: !stage.forward, run: () => void stageTravel(1) },
      { id: "reload", label: t("重新加载"), run: () => void stageSend("Page.reload", {}, stage.session).catch(() => {}) }
    ]);
  openMenu(
    anchor,
    groups.flatMap((group, i) => [i ? `<i class="stage-pop-rule"></i>` : "", ...group]),
    { align: "left", kind: "stage-ctx", className: "stage-pop stage-ctx" }
  );
}
// 在后台新开一页（与浏览器的「在新标签页中打开」一样，不跳过去）
/** @param {string} url */
function stageOpenBehind(url) {
  stage.behindAt = Date.now();
  void stageSend("Target.createTarget", { url, background: true }).catch(error =>
    toast(t`打开失败：${String(error.message || error).slice(0, 80)}`)
  );
}
// Ctrl+某键递进网页，键盘交还网页
/** @param {string} letter */
function stageCombo(letter) {
  const session = stage.session;
  $("#stageKeys").focus({ preventScroll: true });
  if (!session) return;
  const key = { key: letter, code: `Key${letter.toUpperCase()}`, windowsVirtualKeyCode: letter.toUpperCase().charCodeAt(0), modifiers: 2 };
  void stageSend("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key }, session)
    .then(() => stageSend("Input.dispatchKeyEvent", { type: "keyUp", ...key }, session))
    .catch(() => {});
}
