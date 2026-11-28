// 言 · 撮要：一答之内往来渐繁时删繁就简——较早的往来并作一则工作笔记，或把这一问之前的前文压成摘要。两种来路，记作行迹里同一种步骤：
// 执事与帮手做完一段时自己调，笔记由它自己写（见 14-chat-engine/60-context.js 的 foldByModel）；它没调、上下文将满时言替它撮（见 keepInWindow）。
// 不进行迹摘要：下一问起前文本就是摘要，撮过几回与它无关
defineTool({
  name: "fold",
  label: t("撮要"),
  offer: ctx => ctx.work,
  html: step => foldStepHtml(step),
  // 笔记记在步骤上；参数里那一份已随调用进了历史，步骤上不再存第二份。往来的替换等工具结果交回后由 runRounds 做
  run(step, args) {
    const note = String(args.note || "").trim();
    if (!note) return { ok: false, content: t("note 为空：写下接着做要用的笔记"), display: "笔记为空" };
    step.note = note;
    step.arguments = "{}";
    return { ok: true, content: "", display: "" };
  }
});
// 字数只要个大概：「九万六千」「三千」「八百」
function roughChars(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (LANG === "en") return n >= 950 ? `${Math.round(n / 1000)}k` : n >= 95 ? `${Math.round(n / 100) * 100}` : String(n);
  if (n >= 9500) {
    const tenth = Math.round(n / 1000),
      wan = Math.floor(tenth / 10),
      qian = tenth % 10;
    return wan >= 100 ? t`${wan} 万` : t`${chineseNumber(wan)}万${qian ? t`${chineseNumber(qian)}千` : ""}`;
  }
  if (n >= 950) return t`${chineseNumber(Math.round(n / 1000))}千`;
  if (n >= 95) return t`${chineseNumber(Math.round(n / 100))}百`;
  return chineseNumber(n);
}
/** @param {Step} step */
function foldTitle(step) {
  const fold = step.fold || {},
    count = Number(fold.steps) || 0,
    status = step.status || "done";
  if (fold.head)
    return status === "done" ? t("前文已撮其要，录于本问之上") : status === "error" ? t("前文渐繁，撮要未成") : t("前文渐繁，正撮其要");
  if (status === "done") return t`已删繁就简，${count < 100 ? t`前${chineseNumber(count)}步` : t`前 ${count} 步`}并作一则笔记`;
  return status === "error" ? t("往来渐繁，撮要未成") : t("往来渐繁，正删繁就简");
}
// 一张淡染的小笺、右上一个折角，标签用墨（不设专色：撮要哪儿也没去，见 styles/80-trail/10-delegate.css）；点开，笔记就写在笺上
/** @param {Step} step */
function foldStepHtml(step) {
  const status = step.status || "done",
    fold = step.fold || {};
  const meta =
    status === "running"
      ? t("撮要中")
      : status === "error"
        ? escapeHtml(stepText(step.result) || t("未撮成"))
        : fold.from && fold.to
          ? t`${roughChars(fold.from)} → ${roughChars(fold.to)}字`
          : "";
  const body =
      status === "done" && step.note ? `<div class="tool-note"><div class="markdown">${renderMarkdown(step.note)}</div></div>` : "",
    folded = !!body && !step.expanded;
  return `<div class="tool-step tool-step-fold${body ? " foldable" : ""}${folded ? " folded" : ""}" data-tool="fold" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}">${stepHeadHtml(`${trailLabelHtml("fold", t(`撮要`), true)}<span class="tool-title">${escapeHtml(foldTitle(step))}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}`, !!body, folded)}${body}</div>`;
}
