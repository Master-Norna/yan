// 言 · 渲染 · 滚动：跟随到底、回到最新、滚动条命中层
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 正文的滚动：跟随到底、回到最新、右侧加宽的滚动条命中层
function bindScrollEvents() {
  // 跟随的规矩：往下滚到离底不远就算到底、开始跟随（生成中内容一直在长，硬要滚到最后一像素常常追不上）；
  // 往上滚离底超过阈值才算离开。内容自己长高、缩短引起的滚动不算用户的意思。
  // 往上走的那一下不论离底多近都不重新跟随：平滑滚动与触控板的头一步只挪几像素，若当它「到底」，下一帧就被拽回底部
  // 「往上了」还要看这一下是不是人弄的：图片落定、内联作品撑开、浏览器把越界的位置夹回来，都会派发 scroll 事件，
  // 位置变小而人没碰过；切走再切回、一版内容重排时若照 scrollTop 变小就判人往上翻，跟随会被悄悄关掉，看着像「回来就不跟随了」。
  // 分两处看：内容高度变了的（重排、落定），人没动手就不算离开；高度没变的上移（点书眉、程序滚到顶、翻页键）照旧算离开
  let lastScrollTop = 0,
    lastScrollHeight = 0,
    lastUserScrollAt = Number.NEGATIVE_INFINITY;
  const markUserScroll = () => (lastUserScrollAt = performance.now());
  document.addEventListener("keydown", event => {
    if (!["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    // 在输入框、旁注、编辑器里按方向键是挪光标，不是翻正文
    const field =
      event.target instanceof Element
        ? event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
        : null;
    if (!field) markUserScroll();
  });
  $("#chatScroll").addEventListener("scroll", () => {
    const el = $("#chatScroll"),
      gap = el.scrollHeight - el.scrollTop - el.clientHeight,
      down = el.scrollTop > lastScrollTop,
      up = el.scrollTop < lastScrollTop,
      // 高度变了、八百毫秒内也没人动过手：这一下是内容重排挪的，不是人往上翻
      relayout = el.scrollHeight !== lastScrollHeight && performance.now() - lastUserScrollAt > 800;
    lastScrollTop = el.scrollTop;
    lastScrollHeight = el.scrollHeight;
    if ((!up && gap < 8) || (down && gap < FOLLOW_THRESHOLD)) {
      followBottom = true;
      autoScrolling = false;
    } else if (up && !autoScrolling && gap > FOLLOW_THRESHOLD && !relayout) followBottom = false;
    syncJumpBottom(gap);
    syncOutline();
    syncRunningHead();
  });
  // 书眉里那一枚图另有去处（点开卡片，见 19-intent/40-card.js）
  $("#runningHead").addEventListener("click", event => {
    if (event.target.closest("[data-intent-open]")) return;
    followBottom = false;
    autoScrolling = false;
    $("#chatScroll").scrollTo({ top: 0, behavior: reducedMotion.matches ? "instant" : "smooth" });
  });
  $("#trailFold").addEventListener("click", () => {
    const trail = $("#trailFold")._trail;
    if (!trail?.isConnected) return;
    // 与亲手点行迹题头同一条路：记在消息上，流式期间不再被自动摊开
    trail.querySelector(":scope > summary").click();
    scrollChatTo(trail);
  });
  // 跟着的时候，内容不论因何长高（工具输出、图表成图、图片载入、块的开合）都贴着底：不只靠流式的每一帧。
  // 「回到最新」也跟着尺寸重算：下方的行迹、思绪一收短，人没动、没有滚动事件，已到底了按钮却还挂着；
  // 输入框长高变矮改的是视口，一并看着
  if (typeof ResizeObserver === "function") {
    const sizes = new ResizeObserver(() => {
      if (followBottom && view === "chat" && currentId) scrollBottom();
      syncJumpBottom();
      syncChatScrollGrabber();
    });
    sizes.observe($("#messages"));
    sizes.observe($("#chatScroll"));
  }
  $("#chatScroll").addEventListener(
    "wheel",
    e => {
      if (wheelScrollsInner(e)) return;
      markUserScroll();
      if (e.deltaY < 0) followBottom = false;
    },
    { passive: true }
  );
  $("#chatScroll").addEventListener(
    "pointerdown",
    () => {
      autoScrolling = false;
      markUserScroll();
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
  // 生成时向上翻阅后，给一枚「回到最新」；贴近底部自动隐去
  $("#jumpBottom").onclick = () => {
    const el = $("#chatScroll");
    followBottom = true;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion.matches ? "instant" : "smooth" });
  };
}
function scrollBottom() {
  const el = $("#chatScroll");
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 1) {
    autoScrolling = false;
    return;
  }
  autoScrolling = true;
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => {
    autoScrolling = false;
  });
}
