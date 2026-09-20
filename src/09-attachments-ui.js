// 言 · 附件卡片、引用与划选提示
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
const icons = {
  copy: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="5.2" y="5.2" width="7.4" height="7.4" rx="1.5"/><path d="M10.5 3.4H4.9a1.5 1.5 0 0 0-1.5 1.5v5.6"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M3.3 12.7l.6-3 6.8-6.8 2.4 2.4-6.8 6.8-3 .6z"/><path d="M9.8 3.8l2.4 2.4"/></svg>`,
  regenerate: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 3.2v2.6h-2.6"/></svg>`,
  resume: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.2v9.6L12 8 4 3.2z"/></svg>`,
  retry: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M8 3v5l3 1.8"/><circle cx="8" cy="8" r="5.2"/></svg>`,
  note: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M3.5 4h6M3.5 8h6M3.5 12h6"/><path d="M12.6 6.4v3.2"/><path d="M11 8h3.2"/></svg>`
};
function actionIcon(action, title, icon) {
  return `<button class="message-action" data-action="${action}" title="${title}" aria-label="${title}">${icon}</button>`;
}
function fileTypeLabel(file) {
  const match = String(file.name || "").match(/\.([^.]+)$/),
    extension = match?.[1]?.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (extension) return extension.slice(0, 7);
  const subtype = String(file.mime || "")
    .split("/")[1]
    ?.split(/[;+]/)[0]
    ?.toUpperCase();
  return (subtype || "FILE").slice(0, 7);
}
function formatFileSize(value) {
  const bytes = Number(value || 0);
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}
function kindGlyph(kind) {
  return kind === "image" ? "画" : kind === "text" ? "文" : "卷";
}
function attachmentCard(file, index, sent = false) {
  const type = fileTypeLabel(file),
    title = `${file.name} · ${formatFileSize(file.size)}`;
  const thumb = file.kind === "image" && file.id ? `<img class="attachment-thumb" data-thumb="${escapeHtml(file.id)}" alt="">` : "";
  const body = `${thumb}<span class="attachment-name">${escapeHtml(file.name)}</span><span class="attachment-mark" aria-hidden="true">${kindGlyph(file.kind)}</span><span class="attachment-type">${escapeHtml(type)}</span>`;
  const save = file.id
    ? `<button class="attachment-tool attachment-save" data-save-attachment="${escapeHtml(file.id)}" title="收入卷宗" aria-label="收入卷宗">藏</button>`
    : "";
  // 发出去的附件点开是看：图进图片查看器，文、表、PDF、网页进预览器——自己刚发的东西再下载一遍没有道理；
  // 只有预览不了的（压缩包之类）才落到下载
  if (sent && file.id) {
    const action =
      file.kind === "image"
        ? `data-open-image="${escapeHtml(file.id)}" title="查看 ${escapeHtml(title)}"`
        : previewKind(file.name) !== "none"
          ? `data-open-attachment="${escapeHtml(file.id)}" data-name="${escapeHtml(file.name)}" title="预览 ${escapeHtml(title)}"`
          : `data-download-attachment="${escapeHtml(file.id)}" title="下载 ${escapeHtml(title)}"`;
    return `<div class="attachment-card sent" role="button" tabindex="0" data-kind="${file.kind}" ${action}>${body}${save}</div>`;
  }
  return `<div class="attachment-card pending" data-kind="${file.kind}" title="${escapeHtml(title)}">${body}${save}${index !== null ? `<button class="attachment-tool attachment-remove" data-remove-attachment="${index}" title="移除 ${escapeHtml(file.name)}" aria-label="移除 ${escapeHtml(file.name)}">×</button>` : ""}</div>`;
}
function renderAttachments() {
  const html = pendingAttachments.map((file, index) => attachmentCard(file, index)).join("");
  [$("#attachments"), $("#welcomeAttachments")].forEach(el => {
    el.classList.toggle("hidden", !pendingAttachments.length);
    el.innerHTML = html;
    void loadThumbnails(el);
  });
  renderSendButtons();
  scheduleContextGauge(); // 案上的附件也是下一问要送出的，计数随之变
}
// 引用追问：在回复或自己的话里划选一段，浮出「引用」；点了就作为引文带进输入框，随下一问送出
function renderQuote() {
  const box = $("#composerQuote");
  if (!box) return;
  box.classList.toggle("hidden", !pendingQuote);
  box.querySelector(".composer-quote-text").textContent = pendingQuote?.text || "";
  renderSendButtons();
  scheduleContextGauge();
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
// 正文里此刻划选的一段：所在消息、文字、第几次出现，以及它在页面上的位置。没划、划在正文之外、太短，都是 null
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
  const host = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const body = host?.closest("#messages .message .markdown, #messages .message .user-bubble"),
    article = body?.closest("[data-message]");
  if (!body || !article || text.length < 2 || body.closest(".message-editor")) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { text: text.slice(0, 1200), messageId: article.dataset.message, occurrence: occurrenceBefore(body, range, text), rect };
}
function setupQuoteTip() {
  const tip = $("#quoteTip");
  let current = null,
    timer = null;
  const hide = () => {
    current = null;
    if (!tip.classList.contains("hidden")) tip.classList.add("hidden");
  };
  const check = () => {
    const picked = selectionAnchor();
    if (!picked) return hide();
    const { rect, ...anchor } = picked;
    current = anchor;
    tip.style.left = `${Math.min(innerWidth - 40, Math.max(40, rect.left + rect.width / 2))}px`;
    tip.style.top = `${Math.max(8, rect.top - 34)}px`;
    tip.classList.remove("hidden");
  };
  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(check, 120);
  });
  $("#chatScroll").addEventListener("scroll", hide, { passive: true });
  tip.addEventListener("pointerdown", event => event.preventDefault()); // 别让点击把划选清掉
  tip.addEventListener("click", event => {
    const button = event.target.closest("[data-tip]");
    if (!button || !current) return hide();
    const picked = current;
    getSelection()?.removeAllRanges();
    hide();
    if (button.dataset.tip === "note") return createThread(picked);
    pendingQuote = picked;
    renderQuote();
    persistDraft();
    const input = $("#chatInput");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}
