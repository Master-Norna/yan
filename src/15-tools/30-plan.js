// 言 · 计划：行里给用户看的任务清单，每次给完整的一份，画在行迹里；只有主模型维护，回给它一行计数就够
const PLAN_STATUSES = new Set(["pending", "doing", "done", "skipped"]),
  PLAN_MARKS = { done: "✓", doing: "▶", skipped: "–" };
defineTool({
  name: "update_plan",
  group: "work",
  label: "计划",
  offer: ctx => ctx.work,
  mainOnly: true,
  html: planStepHtml,
  digest: step => `计划 → ${(step.plan || []).map(item => `${PLAN_MARKS[item.status] || "○"}${item.text.slice(0, 40)}`).join("；")}`,
  run(step, args) {
    const items = args.items
      .map(item => (typeof item === "string" ? { text: item, status: "pending" } : item))
      .filter(item => item && typeof item === "object" && String(item.text || "").trim())
      .slice(0, 12)
      .map(item => {
        const status = String(item.status || "").toLowerCase();
        return { text: String(item.text).trim().slice(0, 200), status: PLAN_STATUSES.has(status) ? status : "pending" };
      });
    if (!items.length) return { ok: false, content: "items 为空：每项给 text 与 status", display: "清单为空" };
    step.plan = items;
    const done = items.filter(item => item.status === "done").length,
      doing = items.find(item => item.status === "doing");
    step.title = doing ? doing.text : done === items.length ? "全部完成" : `${done}/${items.length}`;
    return {
      ok: true,
      content: `计划已更新：${done}/${items.length} 完成${doing ? `，正在做「${doing.text}」` : ""}`,
      display: `${done}/${items.length}`
    };
  }
});
// 计划卡：一行一项，○ 待做、▶ 正在做（朱色呼吸点）、✓ 做完、– 不做了；标题行是正在做的那一项或「n/m」
/** @param {Step} step */
function planStepHtml(step) {
  const status = step.status || "done",
    items = step.plan || [],
    done = items.filter(item => item.status === "done").length;
  const rows = items
    .map(
      item =>
        `<li class="plan-item" data-plan="${escapeHtml(item.status)}"><span class="plan-mark" aria-hidden="true">${{ done: "✓", doing: "", skipped: "–" }[item.status] ?? "○"}</span><span class="plan-text">${escapeHtml(item.text)}</span></li>`
    )
    .join("");
  const meta = status === "error" ? escapeHtml(step.result || "失败") : `${done}/${items.length}`;
  return `<div class="tool-step tool-step-plan" data-tool="update_plan" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">计划</span><span class="tool-title" title="${escapeHtml(step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${items.length ? `<ol class="plan-list">${rows}</ol>` : ""}</div>`;
}
