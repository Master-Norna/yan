// 言 · 纲：计划卡的升级——一项不再是「要做的事」，而是「要成立的结论」，以前提相连成图；成立与否由验的人判（见 src/19-graph/）。
// 这里只登记：改图的 update_graph（主模型用）、验的人交判词的 verdict（只给验的人）、验的那一枚签 graph_check、收尾的闸递话的那一步 graph_gate，
// 连同旧对话里 update_plan 那张清单卡的画法（不再交给模型）
const PLAN_STATUSES = new Set(["pending", "doing", "done", "skipped"]),
  PLAN_MARKS = { done: "✓", doing: "▶", skipped: "–" };
// 旧的计划卡：只留画法与摘要，旧对话里照样画得出来、下一问的行迹摘要里照样带着
defineTool({
  name: "update_plan",
  label: "计划",
  offer: false,
  html: planStepHtml,
  digest: step => `计划 → ${(step.plan || []).map(item => `${PLAN_MARKS[item.status] || "○"}${item.text.slice(0, 40)}`).join("；")}`
});
defineTool({
  name: "update_graph",
  group: "work",
  label: "纲",
  offer: ctx => ctx.work,
  mainOnly: true,
  html: graphStepHtml,
  digest: step => `纲 → ${step.result || step.status}`,
  run: updateGraph
});
// 验的人交判词：只给验的人。它所在的那一趟由 step.scope 认出（见 10-check.js 的 auditing）
defineTool({
  name: "verdict",
  label: "判词",
  offer: ctx => !!ctx.audit,
  run(step, args) {
    const box = auditing.get(step.scope || "");
    if (!box) return { ok: false, content: prompt("graph.notHere"), display: "此处不收" };
    const holds = args.holds === true || args.holds === "true",
      gap = String(args.gap || "")
        .trim()
        .slice(0, 1200),
      files = (Array.isArray(args.files) ? args.files : args.files ? [args.files] : [])
        .map(f => String(f).trim())
        .filter(Boolean)
        .slice(0, 20);
    box.verdict = { holds, gap, files };
    step.title = holds ? "成立" : gap.split("\n").find(Boolean)?.slice(0, 80) || "不成立";
    return { ok: true, content: prompt("graph.taken"), display: holds ? "成立" : "不成立" };
  }
});
// 验的一枚签：与差遣同一种签，点开是验的人那条时间线（差遣面板）
defineTool({
  name: "graph_check",
  label: "验",
  offer: false,
  html: step => delegateStepHtml(step, "验"),
  sync: syncDelegateCard,
  digest: step => `验「${String(step.title || "").slice(0, 40)}」→ ${step.result || step.status}`
});
// 收尾的闸递话的那一步：落在它递上的那一刻，往后重装这一答照原处插回（replay）
defineTool({
  name: "graph_gate",
  label: "纲",
  offer: false,
  html: step => noteStepHtml(step, { seal: "纲", label: "收尾前" }),
  replay: replayReport
});
// 改图：理顺、查错（查出错的整批不收），记进这一步；标了 claimed 的当场请验的人判，判词与此刻的纲一并回给模型
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 */
async function updateGraph(step, args, ctx) {
  const { conversation } = ctx,
    before = graphOf(conversation.messages),
    { ops, problems } = normalizeGraphOps(before, args.nodes);
  if (problems.length)
    return { ok: false, content: prompt("graph.problems", { problems: problems.map(p => `- ${p}`).join("\n") }), display: "未改" };
  step.graph = quietGraphOps(before, ops);
  const claimed = step.graph.filter(op => op.mark === "claimed").map(op => op.id);
  paintGraphStep(step, graphOf(conversation.messages));
  const results = claimed.length ? await checkNodes(claimed, ctx, requestJob(conversation.id)?.profile || activeProfile()) : [],
    graph = graphOf(conversation.messages);
  paintGraphStep(step, graph);
  const text = graphText(graph, {
    roots: rootsAbove(
      graph,
      step.graph.map(op => op.id)
    )
  });
  return { ok: true, content: [...results.map(verdictLine), text].filter(Boolean).join("\n\n"), display: step.result };
}
// 卡上画的是这一步做完那一刻的纲：一项一行，前提在前
/** @param {Step} step @param {Graph} graph */
function paintGraphStep(step, graph) {
  const nodes = graphOrder(graph).filter(node => node.mark !== "dropped"),
    standing = nodes.filter(node => nodeEstablished(graph, node)).length;
  step.view = nodes.map(node => ({
    id: node.id,
    text: node.claim,
    state: nodeState(graph, node) === "holds" && !nodeEstablished(graph, node) ? "premised" : nodeState(graph, node)
  }));
  const doing = nodes.find(node => node.mark === "doing" && nodeState(graph, node) === "doing");
  step.title = doing ? doing.claim : nodes.length && standing === nodes.length ? "全部立住" : `立住 ${standing} / ${nodes.length}`;
  step.result = `${standing}/${nodes.length}`;
}
// 纲卡：暂借计划卡的样子（一行一项，同一支笔的记号），图形化的画法日后另议。立住的一笔勾、在做的一粒朱点、其余淡墨点，
// 不成立、待复验、待验、成立而待前提的在行末注一个字
const GRAPH_VIEW_MARK = { holds: "done", doing: "doing", dropped: "skipped" },
  GRAPH_VIEW_TAG = { fails: "未过", stale: "复验", claimed: "待验", premised: "待前提" };
/** @param {Step} step */
function graphStepHtml(step) {
  const status = step.status || "done",
    items = step.view || [];
  const rows = items
    .map(item => {
      const mark = GRAPH_VIEW_MARK[item.state] || "pending",
        tag = GRAPH_VIEW_TAG[item.state];
      return `<li class="plan-item" data-plan="${mark}" data-state="${escapeHtml(item.state)}"><span class="plan-mark">${planMarkHtml(mark)}</span><span class="plan-text">${escapeHtml(item.text)}</span>${tag ? `<span class="plan-tag">${tag}</span>` : ""}</li>`;
    })
    .join("");
  const meta =
    status === "error"
      ? escapeHtml(step.result || "未改")
      : `<span class="plan-row" role="img" aria-label="${escapeHtml(step.result || "")}">${items.map(item => planMarkHtml(GRAPH_VIEW_MARK[item.state] || "pending")).join("")}</span>`;
  return `<div class="tool-step tool-step-plan" data-tool="update_graph" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">纲</span><span class="tool-title" title="${escapeHtml(step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta">${meta}</span>${status === "done" ? "" : stepStateHtml(status)}</div>${items.length ? `<ol class="plan-list">${rows}</ol>` : ""}</div>`;
}
// 计划卡：一行一项，记号是笔意（与 03-brush.js 的图标同一支笔，不用 ✓ ● ○ 字形）——做完一笔勾、正在做一粒朱点（呼吸）、
// 未做一粒淡墨点、不做了一短横。题头是正在做的那一项或「全部完成」，右侧一排同样的小记号代替「n/m」：
// 旧的几张只留这一行（见 markStalePlans），行迹里只有计划长这样，一扫就认得（见 设计稿/40–42）
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
      ? escapeHtml(step.result || "失败")
      : `<span class="plan-row" role="img" aria-label="${done}/${items.length}">${items.map(item => planMarkHtml(item.status)).join("")}</span>`;
  // 做完不再挂 ✓：那一排记号已说了进度
  return `<div class="tool-step tool-step-plan" data-tool="update_plan" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">计划</span><span class="tool-title" title="${escapeHtml(step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta">${meta}</span>${status === "done" ? "" : stepStateHtml(status)}</div>${items.length ? `<ol class="plan-list">${rows}</ol>` : ""}</div>`;
}
// 一条行迹里只有最新那张计划摊开整单，更早的只留题头一行（一答里改四回计划，就是四张一模一样的清单）。
// 计划散在各组里，不是兄弟节点，CSS 认不出哪张最新；每回画行迹时点一遍，步骤重画了也随之补上
/** @param {Element} root */
function markStalePlans(root) {
  const plans = root.querySelectorAll(".tool-step-plan");
  plans.forEach((plan, i) => plan.classList.toggle("plan-old", i < plans.length - 1));
}
