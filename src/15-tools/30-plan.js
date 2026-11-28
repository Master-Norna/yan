// 言 · 计划：行里给用户看的任务清单，每次给完整的一份，画在行迹里；只有主模型维护，回给它一行计数就够
const PLAN_STATUSES = new Set(["pending", "doing", "done", "skipped"]),
  PLAN_MARKS = { done: "✓", doing: "▶", skipped: "–" };
defineTool({
  name: "update_plan",
  group: "work",
  label: t("计划"),
  offer: ctx => ctx.work,
  mainOnly: true,
  html: planStepHtml,
  digest: step => t`计划 → ${(step.plan || []).map(item => `${PLAN_MARKS[item.status] || "○"}${item.text.slice(0, 40)}`).join("；")}`,
  run(step, args) {
    const items = args.items
      .map(item => (typeof item === "string" ? { text: item, status: "pending" } : item))
      .filter(item => item && typeof item === "object" && String(item.text || "").trim())
      .slice(0, 12)
      .map(item => {
        const status = String(item.status || "").toLowerCase();
        return { text: String(item.text).trim().slice(0, 200), status: PLAN_STATUSES.has(status) ? status : "pending" };
      });
    if (!items.length) return { ok: false, content: t("items 为空：每项给 text 与 status"), display: "清单为空" };
    step.plan = items;
    const done = items.filter(item => item.status === "done").length,
      doing = items.find(item => item.status === "doing");
    step.title = doing ? doing.text : done === items.length ? t("全部完成") : `${done}/${items.length}`;
    return {
      ok: true,
      content: t`计划已更新：${done}/${items.length} 完成${doing ? t`，正在做「${doing.text}」` : ""}`,
      display: `${done}/${items.length}`
    };
  }
});
// 计划卡：一行一项，记号是笔意（与 03-brush.js 的图标同一支笔，不用 ✓ ● ○ 字形）——做完一笔勾、正在做一粒朱点（呼吸）、
// 未做一粒淡墨点、不做了一短横。题头是正在做的那一项或「全部完成」，右侧一排同样的小记号代替「n/m」：
// 旧的几张只留这一行（见 markStalePlans），行迹里只有计划长这样，一扫就认得
/** @param {string} status */
function planMarkHtml(status) {
  const kind = PLAN_STATUSES.has(status) ? status : "pending",
    ink =
      kind === "done"
        ? brushStroke([1.4, 6, 2.9, 7.6, 4.3, 9.3, 6.8, 5, 10.8, 1.4], 1.6, { tail: 0, head: 0.85, tone: "ink2" })
        : kind === "doing"
          ? brushDot(6, 5.6, 2.2, "zhu")
          : kind === "skipped"
            ? brushStroke([3.2, 5.8, 6, 5.4, 8.8, 5.7], 1.3, { tone: "ink2", tail: 0.5 })
            : brushDot(6, 5.6, 1.4, "ink2");
  return `<svg class="brush plan-svg" data-plan="${kind}" viewBox="0 0 12 11" aria-hidden="true">${ink}</svg>`;
}
/** @param {Step} step */
function planStepHtml(step) {
  const status = step.status || "done",
    items = step.plan || [],
    done = items.filter(item => item.status === "done").length;
  const rows = items
    .map(
      item =>
        `<li class="plan-item" data-plan="${escapeHtml(item.status)}"><span class="plan-mark">${planMarkHtml(item.status)}</span><span class="plan-text">${escapeHtml(item.text)}</span></li>`
    )
    .join("");
  const meta =
    status === "error"
      ? escapeHtml(stepText(step.result) || t("失败"))
      : `<span class="plan-row" role="img" aria-label="${done}/${items.length}">${items.map(item => planMarkHtml(item.status)).join("")}</span>`;
  // 做完不再挂 ✓：那一排记号已说了进度
  return `<div class="tool-step tool-step-plan" data-tool="update_plan" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head">${trailLabelHtml("update_plan", t(`计划`), true)}<span class="tool-title" title="${escapeHtml(step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta">${meta}</span>${status === "done" ? "" : stepStateHtml(status)}</div>${items.length ? `<ol class="plan-list">${rows}</ol>` : ""}</div>`;
}
// 一条行迹里只有最新那张计划摊开整单，更早的只留题头一行（一答里改四回计划，就是四张一模一样的清单）。
// 计划散在各组里，不是兄弟节点，CSS 认不出哪张最新；每回画行迹时点一遍，步骤重画了也随之补上
/** @param {Element} root */
function markStalePlans(root) {
  const plans = root.querySelectorAll(".tool-step-plan");
  plans.forEach((plan, i) => plan.classList.toggle("plan-old", i < plans.length - 1));
}
