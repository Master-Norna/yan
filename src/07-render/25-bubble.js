// 言 · 问句气泡：长了只露四行，末行淡出，右下一枚细折角「展开 / 收起」（设计稿/151 乙）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 正文与旁注里人发的话、差遣面板里主模型交的命，同是这只气泡、同一套收法。字在 .ub-text 里，收着时它限四行高；
// 截没截由 ResizeObserver 量：画出来、从藏着到露出、宽窄变了都会报一回，不必各处自己记着去量。摊开着的不量（本就不截，量了会把记号撤掉）。
// 落选（设计稿/151）：甲第四行末一个省略号（常落在句中，看不出下面还有几段）、丙只淡出不写字（摊开后不知道点得回去）、
// 丁折角挪到气泡下那一排（浮在问与答之间，贴着答的头一行）
const bubbleSizes =
  typeof ResizeObserver === "function"
    ? new ResizeObserver(entries => entries.forEach(entry => measureBubble(entry.target.parentElement)))
    : null;
/** @param {string} text @param {string} [cls] 另加的类 */
function bubbleHtml(text, cls = "") {
  return `<div class="user-bubble${cls ? ` ${cls}` : ""}"><span class="ub-text">${escapeHtml(text)}</span></div>`;
}
/** 新画上的气泡交给 ResizeObserver 量 @param {ParentNode} root */
function watchBubbles(root) {
  if (!bubbleSizes) return;
  if (root instanceof Element && root.classList.contains("ub-text")) bubbleSizes.observe(root);
  else root.querySelectorAll(".ub-text").forEach(text => bubbleSizes.observe(text));
}
/** @param {Element|null} bubble */
function measureBubble(bubble) {
  if (!bubble?.classList.contains("user-bubble") || bubble.classList.contains("open")) return;
  const text = bubble.firstElementChild;
  if (!text?.clientHeight) return; // 藏着的量不出，露出来时会再报
  const more = text.scrollHeight > text.clientHeight + 1;
  if (more === bubble.classList.contains("more")) return;
  bubble.classList.toggle("more", more);
  if (more) bubble.insertAdjacentHTML("beforeend", `<button type="button" class="ub-fold" aria-expanded="false">${t("展开")}</button>`);
  else bubble.querySelector(":scope > .ub-fold")?.remove();
}
// 字换了（帮手的命就地更新）：退回收着，重量
/** @param {Element} bubble @param {string} value */
function setBubbleText(bubble, value) {
  bubble.classList.remove("open", "more");
  bubble.querySelector(":scope > .ub-fold")?.remove();
  bubble.firstElementChild.textContent = value;
  measureBubble(bubble);
}
// 开合同高级配置那套：高度滑开、淡出那层随之退去（收时反过来）。收起后气泡顶若已在视野之上，滚回来对着它
/** @param {Element} bubble @param {boolean} [open] */
function toggleBubble(bubble, open = !bubble.classList.contains("open")) {
  const text = bubble.firstElementChild,
    button = bubble.querySelector(":scope > .ub-fold");
  if (!button || open === bubble.classList.contains("open")) return;
  // 摊开是要往下读：正文贴着底跟随时，长出来的那截会把问句顶到上面去，读的地方从眼前溜走
  if (open && bubble.closest("#chatScroll")) {
    followBottom = false;
    autoScrolling = false;
  }
  const from = text.getBoundingClientRect().height;
  text._bubbleFold?.cancel();
  bubble.classList.toggle("open", open);
  button.textContent = open ? t("收起") : t("展开");
  button.setAttribute("aria-expanded", String(open));
  const to = text.getBoundingClientRect().height,
    settle = () => {
      text._bubbleFold = null;
      text.style.removeProperty("max-height");
      text.style.removeProperty("overflow");
      if (!open) bubble.scrollIntoView({ block: "nearest", behavior: inkMotionOff() ? "auto" : "smooth" });
    };
  if (inkMotionOff() || typeof text.animate !== "function" || Math.abs(from - to) < 1) return settle();
  // 收时限高先放开，不然高度一落就被它截住，看不到收的过程
  text.style.maxHeight = "none";
  text.style.overflow = "hidden";
  const animation = text.animate([{ height: `${from}px` }, { height: `${to}px` }], {
    duration: open ? 420 : 380,
    easing: "cubic-bezier(.22,.72,.2,1)"
  });
  text._bubbleFold = animation;
  animation.onfinish = () => text._bubbleFold === animation && settle();
}
// 点折角开合；收着时点气泡本身也展开（在里面选字不算，点的是旁注的落点也不算）
function bindBubbleEvents() {
  document.addEventListener("click", event => {
    const target = event.target,
      button = target.closest?.(".user-bubble > .ub-fold");
    if (button) return toggleBubble(button.parentElement);
    const bubble = target.closest?.(".user-bubble.more:not(.open)");
    if (bubble && !target.closest("mark, sup, a") && !getSelection()?.toString()) toggleBubble(bubble, true);
  });
}
