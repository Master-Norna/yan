// 言 · 补言：不是工具，是作答途中用户寄来的话，也记作行迹里的一步（见 14-chat-engine.js 的 sendSupplement）；在这张表里只登记画法与摘要，从不交给模型
defineTool({
  name: "user_note",
  label: "补言",
  offer: false,
  html: noteStepHtml,
  digest: step => `用户补言「${String(step.note || "").slice(0, 200)}」`
});
// 补言：作答途中用户寄来的话，落在行迹里它到达的那一刻；待寄时转着圈，递给模型后打勾。话不止一行、或带着附件时摊开在下面
/** @param {Step} step */
function noteStepHtml(step) {
  const status = step.status || "done",
    text = String(step.note || "").trim(),
    first = text.split("\n").find(Boolean)?.slice(0, 80) || "",
    files = (step.attachments || []).map(file => file.name);
  const meta = status === "running" ? "待寄" : status === "error" ? escapeHtml(step.result || "未送达") : escapeHtml(step.result || "已递");
  const body =
    text.length > first.length || files.length
      ? `<div class="tool-note">${escapeHtml(text)}${files.length ? `<div class="tool-note-files">${files.map(name => escapeHtml(name)).join("、")}</div>` : ""}</div>`
      : "";
  return `<div class="tool-step tool-step-note" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label"><span class="seal note-seal" aria-hidden="true">补</span>补言</span><span class="tool-title" title="${escapeHtml(text)}">${escapeHtml(first)}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
