// 言 · 文件 · 分页：同一段随 support.js 进预览浮层，也随 nonce 脚本进游目摊开的文档页。
// 只认容器里的工作表页签和演示页，不借浮层、看图框或游目的状态。
/** @param {Document|Element} root @param {() => boolean} [keysActive] */
function bindDocPreviewPaging(root, keysActive = () => true) {
  /** @param {Element} deck @param {number} index */
  const showSlide = (deck, index) => {
    const pages = [...deck.querySelectorAll("[data-viewer-slide-panel]")],
      marks = [...deck.querySelectorAll("[data-viewer-slide]")],
      current = deck.querySelector('[data-viewer-slide][aria-current="page"]'),
      page = pages[index],
      mark = marks[index];
    if (!page || !mark || mark === current) return;
    const focused = deck.ownerDocument.activeElement,
      focusedPanel = focused?.closest("[data-viewer-slide-panel]");
    for (const panel of pages) panel.toggleAttribute("hidden", panel !== page);
    current?.removeAttribute("aria-current");
    current?.setAttribute("tabindex", "-1");
    mark.setAttribute("aria-current", "page");
    mark.removeAttribute("tabindex");
    deck.querySelector('[data-viewer-slide-step="-1"]').setAttribute("aria-disabled", String(index === 0));
    deck.querySelector('[data-viewer-slide-step="1"]').setAttribute("aria-disabled", String(index === pages.length - 1));
    deck.querySelector("[data-viewer-slide-count]").textContent = `${index + 1} / ${pages.length}`;
    // 只滚底下这一条，别把纸或页内滚动的位置也拉走。每页的滚动归各自的节点。
    const strip = mark.parentElement,
      bounds = strip.getBoundingClientRect(),
      item = mark.getBoundingClientRect();
    if (item.left < bounds.left) strip.scrollLeft += item.left - bounds.left;
    else if (item.right > bounds.right) strip.scrollLeft += item.right - bounds.right;
    if (focused === current || (focusedPanel && focusedPanel !== page)) {
      /** @type {HTMLElement} */ (focusedPanel ? page : mark).focus({ preventScroll: true });
    }
  };
  /** @param {Element} deck @param {number} step */
  const stepSlide = (deck, step) => {
    const current = deck.querySelector('[data-viewer-slide][aria-current="page"]');
    if (current) showSlide(deck, Number(current.getAttribute("data-viewer-slide")) + step);
  };
  root.addEventListener("click", ev => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const tab = target.closest("[data-viewer-tab]"),
      sheet = tab?.closest(".file-viewer-wide");
    if (sheet) {
      for (const one of sheet.querySelectorAll("[data-viewer-tab]")) one.classList.toggle("active", one === tab);
      for (const panel of sheet.querySelectorAll("[data-viewer-panel]"))
        panel.classList.toggle("hidden", panel.getAttribute("data-viewer-panel") !== tab.getAttribute("data-viewer-tab"));
      return;
    }
    const control = target.closest("[data-viewer-slide], [data-viewer-slide-step]"),
      deck = control?.closest(".file-viewer-slides");
    if (!deck) return;
    if (control.hasAttribute("data-viewer-slide")) showSlide(deck, Number(control.getAttribute("data-viewer-slide")));
    else stepSlide(deck, Number(control.getAttribute("data-viewer-slide-step")));
  });
  const doc = root instanceof Document ? root : root.ownerDocument;
  doc.addEventListener("keydown", ev => {
    if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.isComposing) return;
    const step = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : 0;
    if (!step || !keysActive()) return;
    if (ev.target instanceof Element) {
      if (ev.target !== doc.body && !root.contains(ev.target)) return;
      if (ev.target.closest('input, textarea, select, audio, video, [contenteditable]:not([contenteditable="false"])')) return;
    }
    const deck = root.querySelector(".file-viewer-slides");
    if (!deck) return;
    ev.preventDefault();
    stepSlide(deck, step);
  });
}
