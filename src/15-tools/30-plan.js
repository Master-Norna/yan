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
// 卡上画的是这一步做完那一刻的纲：每一项连同前提、情形、缺口记下来，画图用。弃了的只留还挂在某项下的（走过的岔路，留着免得重走）
/** @param {Step} step @param {Graph} graph */
function paintGraphStep(step, graph) {
  const live = graphOrder(graph).filter(node => node.mark !== "dropped"),
    standing = live.filter(node => nodeEstablished(graph, node)).length,
    hung = new Set(live.flatMap(node => node.needs));
  step.view = graphOrder(graph)
    .filter(node => node.mark !== "dropped" || hung.has(node.id))
    .map(node => {
      const state = nodeState(graph, node),
        held = state === "holds" && !nodeEstablished(graph, node) ? "premised" : state;
      return {
        id: node.id,
        text: node.claim,
        state: held,
        needs: node.needs.filter(id => graph.nodes.has(id)),
        ...(node.any ? { any: true } : {}),
        ...(node.when ? { when: node.when } : {}),
        ...(state === "fails" && node.verdict?.gap ? { gap: node.verdict.gap.slice(0, 300) } : {}),
        ...(state === "stale" ? { stale: staleReason(graph, node) } : {}),
        check: node.check.slice(0, 200)
      };
    });
  const doing = live.find(node => node.mark === "doing" && nodeState(graph, node) === "doing");
  step.title = doing ? doing.claim : live.length && standing === live.length ? "全部立住" : `立住 ${standing} / ${live.length}`;
  step.result = `${standing}/${live.length}`;
}
// 纲卡（见 设计稿 乙二 · 批注）：题头一行；有缺口时题头下一行写「差」；一张图，前提在左、根在右（摆法见 19-graph/30-layout.js）；
// 图下逐条批注——图里出事的那一项只标一个朱色小号，缘由写在这里。旧的几张只留题头，右侧换成一枚缩图（见 markStalePlans）
const GRAPH_TAGS = { premised: "待前提", claimed: "待验", fails: "未过", stale: "复验" },
  GRAPH_NUMS = "①②③④⑤⑥⑦⑧⑨⑩";
// 记号：勾、点、横照计划卡；新添三枚——待验是没走完的一圈，不成立是朱色一撇，待复验是淡勾角上一粒朱；成立而待前提是一笔淡勾
const GRAPH_PENS = {
  holds: () => brushStroke([1.4, 6, 2.9, 7.6, 4.3, 9.3, 6.8, 5, 10.8, 1.4], 1.6, { tail: 0, head: 0.85, tone: "ink2" }),
  premised: () => brushStroke([1.4, 6, 2.9, 7.6, 4.3, 9.3, 6.8, 5, 10.8, 1.4], 1.6, { tail: 0, head: 0.85, tone: "ghost" }),
  claimed: () => brushArc(6, 5.6, 3.3, -70, 230, 1.05, { tone: "ink2", tail: 0.3 }),
  fails: () => brushStroke([3, 2.4, 5.6, 5.2, 9, 9], 1.7, { tone: "zhu", tail: 0.1 }),
  stale: () =>
    brushStroke([1.4, 6, 2.9, 7.6, 4.3, 9.3, 6.8, 5, 10.8, 1.4], 1.6, { tail: 0, head: 0.85, tone: "ghost" }) +
    brushDot(9.6, 8.4, 1.25, "zhu"),
  doing: () => brushDot(6, 5.6, 2.2, "zhu"),
  open: () => brushDot(6, 5.6, 1.4, "ink2"),
  dropped: () => brushStroke([3.2, 5.8, 6, 5.4, 8.8, 5.7], 1.3, { tone: "ink2", tail: 0.5 })
};
const graphMark = (state, x, y) =>
  `<svg class="brush plan-svg" data-plan="${escapeHtml(state)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="12" height="11" viewBox="0 0 12 11" aria-hidden="true">${(GRAPH_PENS[state] || GRAPH_PENS.open)()}</svg>`;
/** @param {Step} step */
function graphStepHtml(step) {
  const status = step.status || "done",
    items = step.view || [];
  // 旧的纲卡（先前那一版记下的）没有前提：照样画，只是没有线
  const noted = items.filter(item => item.gap || item.stale),
    nums = Object.fromEntries(noted.map((item, i) => [item.id, GRAPH_NUMS[i] || `${i + 1}`])),
    dependents = new Set(items.flatMap(item => item.needs || []));
  const drawing = drawGraphLayout(
    items.map(item => ({
      id: item.id,
      label: item.when && item.id === item.when ? "" : item.id,
      when: item.when,
      needs: item.needs || [],
      any: item.any,
      state: item.state,
      tag: GRAPH_TAGS[item.state],
      num: nums[item.id],
      root: !dependents.has(item.id) && item.state !== "dropped"
    }))
  );
  const meta =
    status === "error"
      ? escapeHtml(step.result || "未改")
      : `<span class="graph-count">${escapeHtml(step.result || "")}</span>${graphMicroHtml(drawing)}`;
  const gaps = noted.map(item => (item.gap ? `${item.id}——${item.gap}` : `${item.id}待复验`)).join("；");
  const notes = noted
    .map(
      item =>
        `<li><span class="graph-num">${nums[item.id]}</span><span><span class="graph-note-what">${escapeHtml(item.id)}：${escapeHtml(item.text)}</span> <span class="graph-note-why${item.gap ? "" : " quiet"}">${escapeHtml(item.gap ? `缺口：${item.gap}` : item.stale || "待复验")}</span></span></li>`
    )
    .join("");
  return `<div class="tool-step tool-step-plan tool-step-graph" data-tool="update_graph" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">纲</span><span class="tool-title" title="${escapeHtml(step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta">${meta}</span>${status === "done" ? "" : stepStateHtml(status)}</div>${gaps ? `<div class="graph-gaps"><span class="graph-gaps-k">差</span>${escapeHtml(gaps)}</div>` : ""}${drawing.nodes.length ? `<div class="graph-wrap">${graphSvgHtml(drawing, items)}</div>` : ""}${notes ? `<ol class="graph-notes">${notes}</ol>` : ""}</div>`;
}
/** 图：线在下、结在中、项在上 @param {Drawing} drawing @param {any[]} items */
function graphSvgHtml(drawing, items) {
  const byId = Object.fromEntries(items.map(item => [item.id, item])),
    kind = state =>
      state === "holds" ? " solid" : state === "fails" ? " broken" : state === "dropped" ? " gone" : state === "knot" ? " solid" : "";
  const edges = drawing.edges.map(e => `<path class="graph-edge${kind(e.state)}" d="${e.d}"/>`).join(""),
    knots = drawing.knots
      .map(k =>
        k.any
          ? `<circle class="graph-knot" cx="${k.x.toFixed(1)}" cy="${k.y.toFixed(1)}" r="6"/><text class="graph-or" x="${k.x.toFixed(1)}" y="${(k.y + 3.3).toFixed(1)}" text-anchor="middle">或</text>`
          : `<circle class="graph-knot-dot" cx="${k.x.toFixed(1)}" cy="${k.y.toFixed(1)}" r="1.8"/>`
      )
      .join("");
  const nodes = drawing.nodes
    .map(({ id, x, y, node, more }) => {
      const item = byId[id] || {};
      let cx = x + GRAPH_DRAW.mark,
        inner = "";
      if (node.when) {
        const w = graphMeasure(node.when, 10.5) + 10;
        inner += `<rect class="graph-chip" x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="3"/><text class="graph-chip-t" x="${(cx + 5).toFixed(1)}" y="${(y + 3.6).toFixed(1)}">${escapeHtml(node.when)}</text>`;
        cx += w + (node.label ? 5 : 0);
      }
      if (node.label) {
        inner += `<text class="graph-label" x="${cx.toFixed(1)}" y="${(y + 4).toFixed(1)}">${escapeHtml(node.label)}</text>`;
        cx += node.root
          ? graphMeasure(node.label, 13.5, 600, true)
          : graphMeasure(node.label, 12, node.state === "doing" || node.state === "fails" ? 600 : 400);
      }
      if (more) {
        inner += `<text class="graph-more" x="${(cx + 5).toFixed(1)}" y="${(y + 4).toFixed(1)}">+${more}</text>`;
        cx += graphMeasure(`+${more}`, 10) + 5;
      }
      if (node.num) {
        inner += `<text class="graph-num-mark" x="${(cx + 2).toFixed(1)}" y="${(y - 1).toFixed(1)}">${node.num}</text>`;
        cx += graphMeasure(node.num, 10, 600) + 3;
      }
      if (node.tag)
        inner += `<text class="graph-tag${node.state === "fails" ? " zhu" : ""}" x="${(cx + 6).toFixed(1)}" y="${(y + 4).toFixed(1)}">${node.tag}</text>`;
      const tip = [
        `${item.when ? `情形 ${item.when}：` : ""}${item.text || id}`,
        item.check && `验收：${item.check}`,
        more && `另含已立住的 ${more} 项`
      ]
        .filter(Boolean)
        .join("\n");
      return `<g class="graph-node${node.root ? " root" : ""}" data-state="${escapeHtml(node.state)}"><title>${escapeHtml(tip)}</title>${graphMark(node.state, x, y - 5.5)}${inner}</g>`;
    })
    .join("");
  return `<svg class="graph-svg" width="${drawing.width}" height="${drawing.height}" viewBox="0 0 ${drawing.width} ${drawing.height}" role="img" aria-label="纲的结构图">${edges}${knots}${nodes}</svg>`;
}
// 折起时的一行：图上的记号按列排开（前提在左、根在右），列与列之间空一点——缩成一行也看得出先后，朱色落在出事的那几项。
// 试过把整张图缩成一枚：五行叠进一行高，点挤成一团，认不出
/** @param {Drawing} drawing */
function graphMicroHtml(drawing) {
  if (!drawing.nodes.length) return "";
  const cols = new Map();
  for (const n of [...drawing.nodes].sort((a, b) => a.x - b.x || a.y - b.y)) cols.set(n.x, [...(cols.get(n.x) || []), n]);
  return `<span class="graph-micro" aria-hidden="true">${[...cols.values()]
    .map(col => `<span class="graph-micro-col">${col.map(n => graphMark(n.node.state, 0, 0)).join("")}</span>`)
    .join("")}</span>`;
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
