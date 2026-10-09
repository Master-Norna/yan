// 言 · 撮要：不是工具，是一答之内往来渐繁时，言替模型删繁就简——较早的往来并作一则工作笔记，或把这一问之前的前文压成摘要
// （见 14-chat-engine/60-context.js 的 keepInWindow）。也记作行迹里的一步，在这张表里只登记画法，从不交给模型，不进行迹摘要
defineTool({
  name: "fold",
  label: "撮要",
  offer: false,
  html: step => foldStepHtml(step)
});
// 字数只要个大概：「九万六千」「三千」「八百」
function roughChars(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (n >= 9500) {
    const tenth = Math.round(n / 1000),
      wan = Math.floor(tenth / 10),
      qian = tenth % 10;
    return wan >= 100 ? `${wan} 万` : `${chineseNumber(wan)}万${qian ? `${chineseNumber(qian)}千` : ""}`;
  }
  if (n >= 950) return `${chineseNumber(Math.round(n / 1000))}千`;
  if (n >= 95) return `${chineseNumber(Math.round(n / 100))}百`;
  return chineseNumber(n);
}
/** @param {Step} step */
function foldTitle(step) {
  const fold = step.fold || {},
    count = Number(fold.steps) || 0,
    status = step.status || "done";
  if (fold.head) return status === "done" ? "前文已撮其要，录于本问之上" : status === "error" ? "前文渐繁，撮要未成" : "前文渐繁，正撮其要";
  if (status === "done") return `已删繁就简，${count < 100 ? `前${chineseNumber(count)}步` : `前 ${count} 步`}并作一则笔记`;
  return status === "error" ? "往来渐繁，撮要未成" : "往来渐繁，正删繁就简";
}
// 一张淡染的小笺、右上一个折角，标签用墨（不设专色：撮要哪儿也没去，见 styles/80-trail.css）；点开，笔记就写在笺上
/** @param {Step} step */
function foldStepHtml(step) {
  const status = step.status || "done",
    fold = step.fold || {};
  const meta =
    status === "running"
      ? "撮要中"
      : status === "error"
        ? escapeHtml(step.result || "未撮成")
        : fold.from && fold.to
          ? `${roughChars(fold.from)} → ${roughChars(fold.to)}字`
          : "";
  const body =
      status === "done" && step.note ? `<div class="tool-note"><div class="markdown">${renderMarkdown(step.note)}</div></div>` : "",
    folded = !!body && !step.expanded;
  return `<div class="tool-step tool-step-fold${body ? " foldable" : ""}${folded ? " folded" : ""}" data-tool="fold" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${body ? ` title="${folded ? "看笔记" : "收起笔记"}"` : ""}><span class="tool-label">撮要</span><span class="tool-title">${escapeHtml(foldTitle(step))}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
