// 言 · 附件卡片、引用与划选提示
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 回复与问句下的几枚小画：笔意（src/03-brush.js），不再是等宽线稿
function formatFileSize(value) {
  const bytes = Number(value || 0);
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}
// 一件附件是一条「件条」：与卷宗同一张件图（图片换成它自己的缩略），名字，大小。见 设计稿/27 三·甲
// drop：改问编辑框里的一件，× 是从这一问里去掉它（不删原件，旧版本还用着）
function attachmentCard(file, index, sent = false, drop = false) {
  const title = `${file.name} · ${formatFileSize(file.size)}`;
  // 点名用的技能：画锦囊、写技能名（附件本身仍是那份说明的 .md，模型看到的名字不变）
  const figure = file.skill
    ? skillMark("fi skill-fi")
    : file.kind === "image" && file.id
      ? `<span class="fi fi-thumb" aria-hidden="true"><img class="attachment-thumb" data-thumb="${escapeHtml(file.id)}" alt=""></span>`
      : fileFigure(file.name);
  const body = `${figure}<span class="attachment-name">${escapeHtml(file.skill || file.name)}</span><span class="attachment-size">${formatFileSize(file.size)}</span>`;
  const save = file.id
    ? `<button class="attachment-tool attachment-save" data-save-attachment="${escapeHtml(file.id)}" title="${t(`收入卷宗`)}" aria-label="${t(`收入卷宗`)}">${t(`藏`)}</button>`
    : "";
  // 附件点开是看：图进图片查看器，文、表、PDF、网页、音视频进预览器——自己刚拖进来、刚发出去的东西再下载一遍没有道理；
  // 只有预览不了的（压缩包之类）：发出去的落到下载，案上的就不必点了
  const view =
    file.id && file.kind === "image"
      ? t`data-open-image="${escapeHtml(file.id)}" title="查看 ${escapeHtml(title)}"`
      : file.id && fileKind(file.name).view
        ? t`data-open-attachment="${escapeHtml(file.id)}" data-name="${escapeHtml(file.name)}" title="预览 ${escapeHtml(title)}"`
        : "";
  if (sent && file.id) {
    const action = view || t`data-download-attachment="${escapeHtml(file.id)}" title="下载 ${escapeHtml(title)}"`;
    return `<div class="attachment-card sent" role="button" tabindex="0" data-kind="${file.kind}" ${action}>${body}${save}</div>`;
  }
  const remove = drop
    ? `data-action="drop-attachment" data-file="${escapeHtml(file.id)}"`
    : index !== null
      ? `data-remove-attachment="${index}"`
      : "";
  return `<div class="attachment-card pending" data-kind="${file.kind}" ${view ? `role="button" tabindex="0" ${view}` : `title="${escapeHtml(title)}"`}>${body}${save}${remove ? `<button class="attachment-tool attachment-remove" ${remove} title="${t`移除 ${escapeHtml(file.name)}`}" aria-label="${t`移除 ${escapeHtml(file.name)}`}">×</button>` : ""}</div>`;
}
// 随引文的那幅画面画在引文里，不进附件栏（序号仍按 pendingAttachments 算，移除时对得上）
function renderAttachments() {
  const listed = pendingAttachments.map((file, index) => ({ file, index })).filter(({ file }) => !quoteImageOf(file, pendingQuote));
  const html = listed.map(({ file, index }) => attachmentCard(file, index)).join("");
  [$("#attachments"), $("#welcomeAttachments")].forEach(el => {
    el.classList.toggle("hidden", !listed.length);
    el.innerHTML = html;
    void loadThumbnails(el);
  });
  renderSendButtons();
  scheduleContextGauge(); // 案上的附件也是下一问要送出的，计数随之变
}
// 引用追问：在回复或自己的话里划选一段，浮出「引用」；点了就作为引文带进输入框，随下一问送出
// 游目里圈点的也走这一路（见 src/26-stage/），欢迎页上同样有一个引文框
function renderQuote() {
  // 引文撤了、换了：随先前那条引文的画面跟着撤（附件栏里不列它，留下就成了看不见的附件）
  const stale = pendingAttachments.filter(file => file.quoted && !quoteImageOf(file, pendingQuote));
  if (stale.length) {
    pendingAttachments = pendingAttachments.filter(file => !stale.includes(file));
    void deleteAttachments(stale.map(file => file.id));
    renderAttachments();
  }
  for (const box of [$("#composerQuote"), $("#welcomeQuote")]) {
    if (!box) continue;
    box.classList.toggle("hidden", !pendingQuote);
    box.querySelector(".composer-quote-text").textContent = pendingQuote?.text || "";
    const shot = box.querySelector(".composer-quote-shot");
    shot.innerHTML = pendingQuote?.image ? quoteShotHtml(pendingQuote.image, pendingQuote.text) : "";
    void loadThumbnails(shot);
  }
  stageQuoteChanged();
  renderSendButtons();
  scheduleContextGauge();
}
/** @param {Attachment} file @param {Quote|null|undefined} quote */
function quoteImageOf(file, quote) {
  return !!quote?.image && file.id === quote.image;
}
// 引文里的那幅画面：与行迹里工具交回的画面同一张折角小纸，点开进图片查看器
function quoteShotHtml(id, text) {
  return `<span class="fi fi-thumb quote-shot" role="button" tabindex="0" data-open-image="${escapeHtml(id)}" title="${t`查看画面 · ${escapeHtml(text || "")}`}"><img data-thumb="${escapeHtml(id)}" alt=""></span>`;
}
// 划选的这段在正文里是第几次出现：同一条回复里同样的词可能出现不止一次，重画后单靠 indexOf 会落到第一处。
// 数的是划选起点之前出现过几回，空白全去掉再数——与 markAnchor 里的找法一致
function occurrenceBefore(body, range, text) {
  try {
    const pre = document.createRange();
    pre.selectNodeContents(body);
    pre.setEnd(range.startContainer, range.startOffset);
    const picked = pre.cloneContents();
    picked.querySelectorAll?.(".viz, .html-app, .math-pending, sup.note-ref").forEach(node => node.remove());
    return countOccurrences(foldSpace(picked.textContent), foldSpace(text));
  } catch {
    return 0;
  }
}
const foldSpace = value => String(value || "").replace(/\s+/g, "");
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) count += 1;
  return count;
}
// 可引用的文字：正文、过程话、思绪与工具内容。生成中的字还会挪位，只给引用（补言可带）；收尾后稳定的文字块才可建旁注，旁注记下第几块。
const QUOTE_BODIES = ".markdown, .user-bubble, .trail-note, .reasoning-body, .tool-output, .tool-results, .tool-note, .sub-report";
/** @returns {{ text: string, messageId: string, rect: DOMRect, occurrence?: number, part?: number, quoteOnly?: boolean } | null} */
function selectionAnchor() {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || view !== "chat" || !currentId) return null;
  const range = selection.getRangeAt(0);
  let text = selection.toString().trim();
  // 划选跨过了已有旁注的小标（脚注号）：那个数字不是正文，去掉，否则落点在正文里找不到
  const picked = range.cloneContents();
  if (picked.querySelector?.("sup.note-ref")) {
    picked.querySelectorAll("sup.note-ref").forEach(node => node.remove());
    text = picked.textContent.trim();
  }
  const host = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement,
    article = host?.closest("#messages .message[data-message]"),
    quoted = host?.closest(QUOTE_BODIES);
  if (!quoted || !article || text.length < 2 || quoted.closest(".message-editor")) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  const anchor = { text: text.slice(0, 1200), messageId: article.dataset.message, rect };
  if (article.dataset.status === "streaming") return { ...anchor, quoteOnly: true };
  const parts = noteBodies(article),
    part = parts.findIndex(body => body.contains(host));
  return part >= 0 ? { ...anchor, occurrence: occurrenceBefore(parts[part], range, text), part } : { ...anchor, quoteOnly: true };
}
function setupQuoteTip() {
  const tip = $("#quoteTip");
  let current = null,
    timer = null;
  const hide = () => {
    current = null;
    if (!tip.classList.contains("hidden")) tip.classList.add("hidden");
  };
  const place = rect => {
    // 先现出来再量：藏着时没有宽高
    tip.classList.remove("hidden");
    placeFloating(tip, rect, { side: "above", align: "center", gap: 8, edge: 8 });
  };
  const check = () => {
    const picked = selectionAnchor();
    if (!picked) return hide();
    const { rect, ...anchor } = picked;
    current = anchor;
    tip.querySelectorAll('[data-tip="note"], .quote-tip-sep').forEach(el => el.classList.toggle("hidden", !!anchor.quoteOnly));
    place(rect);
  };
  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(check, 120);
  });
  // 滚动不算放弃这处划选：选区没变就不会再有 selectionchange，这里收了便再也回不来（生成中跟随到底时浮条一闪即逝）。只跟着挪，翻出视口才藏，翻回来还在
  const scroller = $("#chatScroll");
  scroller.addEventListener(
    "scroll",
    () => {
      const selection = getSelection();
      if (!current || !selection?.rangeCount) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect(),
        box = scroller.getBoundingClientRect();
      if (rect.bottom <= box.top || rect.top >= box.bottom) tip.classList.add("hidden");
      else place(rect);
    },
    { passive: true }
  );
  tip.addEventListener("pointerdown", event => event.preventDefault()); // 别让点击把划选清掉
  tip.addEventListener("click", event => {
    const button = event.target.closest("[data-tip]");
    if (!button || !current) return hide();
    const { quoteOnly, ...picked } = current;
    getSelection()?.removeAllRanges();
    hide();
    if (button.dataset.tip === "note") return quoteOnly || createThread(picked);
    pendingQuote = picked;
    renderQuote();
    persistDraft();
    const input = $("#chatInput");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

const FILE_TARGETS = "[data-open-image], [data-open-archive], [data-open-remote], [data-open-attachment], [data-download-attachment]";
// 附件：案上的移除、收入卷宗，各处附件的预览、打开、下载（键盘同样可用）
function bindAttachmentEvents() {
  document.addEventListener("click", e => {
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
    const target = e.target.closest(FILE_TARGETS);
    if (target) openFileTarget(/** @type {HTMLElement} */ (target));
  });
  document.addEventListener("keydown", e => {
    if ((e.key !== "Enter" && e.key !== " ") || !e.target.matches?.(FILE_TARGETS)) return;
    e.preventDefault();
    openFileTarget(/** @type {HTMLElement} */ (e.target));
  });
}
// 点得开的件：附件里的图或正文引的目录里的图（见 renderReplyShots）进看图框，看得了的附件进预览器，看不了的下载。点与键盘同一条路
/** @param {HTMLElement} el */
function openFileTarget(el) {
  if (el.matches("[data-open-image], [data-open-archive], [data-open-remote]")) openImageFrom(el);
  else if (el.dataset.openAttachment) void openFileViewer({ attachmentId: el.dataset.openAttachment }, el.dataset.name || "", el);
  else void downloadAttachment(el.dataset.downloadAttachment);
}
// 点开一幅：正文里收成一叠的，叠里几幅同在一组（看图框底下一条小样、左右翻）；别处只看这一幅
/** @param {Element} el */
function openImageFrom(el) {
  const members = /** @type {HTMLElement[]} */ ([...(el.closest(".reply-shots")?.children || [el])]);
  openImageSet(
    members.map(node =>
      node.dataset.openImage
        ? { id: node.dataset.openImage }
        : node.dataset.openRemote
          ? { src: remoteShots.get(node.dataset.openRemote)?.data || "", name: node.dataset.name || "", url: node.dataset.openRemote }
          : { path: node.dataset.openArchive, root: node.dataset.root || archiveDir() }
    ),
    Math.max(0, members.indexOf(/** @type {HTMLElement} */ (el))),
    el
  );
}
// 图片缩略图：原件在 IndexedDB，渲染后异步补上 src；缓存最近 40 张
async function loadThumbnails(root) {
  for (const img of root.querySelectorAll("img[data-thumb]:not([src])")) {
    const id = img.dataset.thumb;
    try {
      let url = thumbCache.get(id);
      if (!url) {
        const file = await getAttachment(id);
        if (!file || file.kind !== "image") continue;
        url = file.data;
        thumbCache.set(id, url);
        if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value);
      }
      img.src = url;
      img.closest(".attachment-card")?.classList.add("has-thumb");
    } catch {}
  }
}
const thumbCache = new Map();
// 输入框空着时，Esc 去掉挂着的引文
defineLayer({
  name: "quote",
  rank: 30,
  open: () => !!pendingQuote && document.activeElement === $("#chatInput") && !$("#chatInput").value,
  close: () => {
    pendingQuote = null;
    renderQuote();
    persistDraft();
  }
});
