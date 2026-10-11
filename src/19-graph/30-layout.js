// 言 · 纲 · 排版：纲卡上那张图怎么摆。前提在左、根在右，按列排开（见 设计稿 乙二 · 批注）。
// 不靠事后挪开重合，靠摆法本身不让它重合：
//   字只在列里——每列宽量出这一列最长的字，下一列从它之后起，同列上下隔一行；
//   线只在列间——从字尾出，平着走到列边，在列间的空里拐弯，到下一项的记号前止；隔几列才到的前提，中间每列给它让一个窄位平穿；
//   汇点也在列间——三条以上的线、或择一的几条，先在记号前汇成一个结（择一的结里写「或」），再一根进来。
// 摆之前先删繁：能经别的前提走到的直连线不画（传递约简：「发版」以「测试」为前提、「测试」以「行号」为前提，「发版—行号」那条就不必再画）；
// 一串都已立住的前提并作最靠外的那一项、注「+n」，图只把还有事的部分摊开。这两样只是少画，纲本身、验与闸都照完整的前提算。
// 本段只算坐标与路径，不碰 DOM；字宽由调用方给（页面用画布量，测试按字数估）
/**
 * @typedef {{ id: string, label: string, when?: string, needs: string[], any?: boolean, state: string, tag?: string, num?: string, root?: boolean }} DrawNode
 * @typedef {{ id: string, x: number, y: number, w: number, node: DrawNode, more: number }} PlacedNode
 * @typedef {{ from: string, to: string, d: string, state: string }} PlacedEdge
 * @typedef {{ x: number, y: number, any: boolean, to: string }} PlacedKnot
 * @typedef {{ width: number, height: number, nodes: PlacedNode[], edges: PlacedEdge[], knots: PlacedKnot[], boxes: number[][] }} Drawing
 */
const GRAPH_DRAW = { rowH: 30, lane: 12, gap: 46, knot: 15, mark: 17, pad: 8 };
/** 字宽：页面用画布按言的字体量，量不了（测试里）按字数估 */
const graphMeasure = (() => {
  let ctx = null;
  try {
    ctx = document.createElement("canvas").getContext?.("2d") || null;
  } catch {
    ctx = null;
  }
  return (text, px = 12, weight = 400, serif = false) => {
    const value = String(text || "");
    if (ctx) {
      ctx.font = `${weight} ${px}px ${serif ? '"Noto Serif SC", "Songti SC", serif' : '"Noto Sans SC", "Microsoft YaHei UI", system-ui, sans-serif'}`;
      return ctx.measureText(value).width;
    }
    return [...value].reduce((w, ch) => w + (/[\x00-\x7f]/.test(ch) ? 0.55 : 1) * px, 0);
  };
})();
/** 一项在图上占多宽：记号、情形的小格、字、行末的小注与编号 @param {DrawNode} node @param {number} more */
function drawNodeWidth(node, more, measure = graphMeasure) {
  const strong = node.state === "doing" || node.state === "fails";
  let w = GRAPH_DRAW.mark;
  if (node.when) w += measure(node.when, 10.5) + 10 + (node.label ? 5 : 0);
  if (node.label) w += node.root ? measure(node.label, 13.5, 600, true) : measure(node.label, 12, strong ? 600 : 400);
  if (more) w += measure(`+${more}`, 10) + 5;
  if (node.num) w += measure(node.num, 10, 600) + 3;
  if (node.tag) w += measure(node.tag, 10) + 6;
  return Math.ceil(w);
}
// 删繁：能经别的前提走到的直连线不画
/** @param {Record<string, DrawNode>} nodes @returns {Record<string, string[]>} 每一项要画出来的前提 */
function reducedNeeds(nodes) {
  const reach = new Map();
  /** @param {string} id @returns {Set<string>} 经前提能走到的全部 */
  const below = id => {
    if (reach.has(id)) return reach.get(id);
    const out = new Set();
    reach.set(id, out);
    for (const k of nodes[id]?.needs || []) {
      if (!nodes[k]) continue;
      out.add(k);
      for (const j of below(k)) out.add(j);
    }
    return out;
  };
  return Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => {
      const needs = node.needs.filter(k => nodes[k]);
      return [id, needs.filter(k => !needs.some(other => other !== k && below(other).has(k)))];
    })
  );
}
// 并：已立住、且等它的都已立住的那几项不单画，记在最靠外的那一项上（「+n」）。根总要画
/** @param {Record<string, DrawNode>} nodes @param {Record<string, string[]>} needs @returns {{ hidden: Set<string>, more: Record<string, number> }} */
function settledFold(nodes, needs) {
  const deps = {};
  for (const [id, list] of Object.entries(needs)) for (const k of list) (deps[k] ||= []).push(id);
  const settled = id => nodes[id].state === "holds";
  const hidden = new Set(
    Object.keys(nodes).filter(id => settled(id) && (deps[id] || []).length && deps[id].every(settled) && !nodes[id].root)
  );
  /** @type {Record<string, number>} */
  const more = {};
  for (const id of Object.keys(nodes)) {
    if (hidden.has(id)) continue;
    const seen = new Set(),
      walk = k => {
        for (const j of needs[k] || [])
          if (hidden.has(j) && !seen.has(j)) {
            seen.add(j);
            walk(j);
          }
      };
    walk(id);
    if (seen.size) more[id] = seen.size;
  }
  return { hidden, more };
}
/**
 * 摆一张图
 * @param {DrawNode[]} list
 * @param {{ measure?: typeof graphMeasure, fold?: boolean }} [options]
 * @returns {Drawing}
 */
function drawGraphLayout(list, { measure = graphMeasure, fold = true } = {}) {
  const { rowH, lane, gap, knot, pad } = GRAPH_DRAW;
  /** @type {Record<string, DrawNode>} */
  const all = Object.fromEntries(list.map(node => [node.id, node]));
  const reduced = reducedNeeds(all),
    { hidden, more } = fold ? settledFold(all, reduced) : { hidden: new Set(), more: {} };
  const ids = list.map(node => node.id).filter(id => !hidden.has(id));
  if (!ids.length) return { width: 0, height: 0, nodes: [], edges: [], knots: [], boxes: [] };
  const needs = Object.fromEntries(ids.map(id => [id, reduced[id].filter(k => !hidden.has(k))]));
  const deps = Object.fromEntries(ids.map(id => [id, []]));
  for (const id of ids) for (const k of needs[id]) deps[k].push(id);
  // 分列：离根的距离取「所有等它的项」里最远的再加一——前提总在它所撑的结论之前，又尽量靠根，链短的不被拉长
  const rank = {};
  const rankOf = id => (rank[id] ??= deps[id].length ? 1 + Math.max(...deps[id].map(rankOf)) : 0);
  ids.forEach(rankOf);
  const top = Math.max(...ids.map(id => rank[id])),
    L = top + 1,
    layers = Array.from({ length: L }, () => []),
    lay = {};
  const put = (v, l) => {
    layers[l].push(v);
    lay[v] = l;
  };
  // 头一回的次序：从根沿前提深搜，同一枝挨在一起
  const seen = new Set();
  const visit = id => {
    if (seen.has(id)) return;
    seen.add(id);
    put(id, top - rank[id]);
    needs[id].forEach(visit);
  };
  ids.filter(id => !deps[id].length).forEach(visit);
  ids.forEach(visit);
  // 隔列的线拆成一串，中间每列一个窄位
  const nbr = {},
    chains = [];
  const link = (a, b) => {
    (nbr[a] ||= []).push(b);
    (nbr[b] ||= []).push(a);
  };
  for (const id of ids)
    for (const k of needs[id]) {
      const chain = [k];
      for (let l = lay[k] + 1; l < lay[id]; l++) {
        const d = `~${k}>${id}@${l}`;
        put(d, l);
        chain.push(d);
      }
      chain.push(id);
      for (let i = 0; i + 1 < chain.length; i++) link(chain[i], chain[i + 1]);
      chains.push({ from: k, to: id, chain });
    }
  // 排序减交叉：按一侧邻居的平均位置排，平手看另一侧；来回几遍，留交叉最少（同样少取后来）的一回
  const pos = {};
  const index = () => layers.forEach(vs => vs.forEach((v, i) => (pos[v] = i)));
  const crossings = () => {
    let n = 0;
    for (let l = 0; l + 1 < L; l++) {
      const pairs = [];
      for (const v of layers[l]) for (const u of nbr[v] || []) if (lay[u] === l + 1) pairs.push([pos[v], pos[u]]);
      for (let i = 0; i < pairs.length; i++)
        for (let j = i + 1; j < pairs.length; j++) if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) n++;
    }
    return n;
  };
  const bary = (v, at) => {
    const ns = (nbr[v] || []).filter(u => lay[u] === at);
    return ns.length ? ns.reduce((s, u) => s + pos[u], 0) / ns.length : null;
  };
  const sortLayer = (l, side) => {
    const other = side < l ? l + 1 : l - 1;
    layers[l] = layers[l]
      .map(v => [bary(v, side) ?? pos[v], other >= 0 && other < L ? (bary(v, other) ?? pos[v]) : pos[v], pos[v], v])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
      .map(k => k[3]);
    layers[l].forEach((v, i) => (pos[v] = i));
  };
  index();
  let best = crossings(),
    bestLayers = layers.map(vs => [...vs]);
  for (let it = 0; it < 8; it++) {
    if (it % 2 === 0) for (let l = 1; l < L; l++) sortLayer(l, l - 1);
    else for (let l = L - 2; l >= 0; l--) sortLayer(l, l + 1);
    const c = crossings();
    if (c <= best) {
      best = c;
      bestLayers = layers.map(vs => [...vs]);
    }
  }
  bestLayers.forEach((vs, l) => (layers[l] = vs));
  index();
  // 就近摆放：保持次序、留足间距，尽量对齐连着的几项——保序回归，挪动的平方和最少；窄位的分量轻些
  const size = v => (all[v] ? rowH : lane);
  const offsets = l => {
    const out = [];
    layers[l].forEach((v, i) => (out[i] = i ? out[i - 1] + size(layers[l][i - 1]) / 2 + size(v) / 2 : 0));
    return out;
  };
  const y = {};
  layers.forEach((vs, l) => {
    const off = offsets(l),
      mid = (off.at(-1) || 0) / 2;
    vs.forEach((v, i) => (y[v] = off[i] - mid));
  });
  for (let it = 0; it < 10; it++)
    for (const l of it % 2 === 0 ? [...Array(L).keys()] : [...Array(L).keys()].reverse()) {
      const vs = layers[l],
        off = offsets(l),
        blocks = [];
      vs.forEach((v, i) => {
        const ns = nbr[v] || [],
          want = ns.length ? ns.reduce((s, u) => s + y[u], 0) / ns.length : y[v],
          w = all[v] ? 1 : 0.6;
        blocks.push({ sum: (want - off[i]) * w, n: w, from: i, to: i });
        while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).n > blocks.at(-1).sum / blocks.at(-1).n) {
          const b = blocks.pop(),
            a = blocks.pop();
          blocks.push({ sum: a.sum + b.sum, n: a.n + b.n, from: a.from, to: b.to });
        }
      });
      for (const b of blocks) for (let i = b.from; i <= b.to; i++) y[vs[i]] = b.sum / b.n + off[i];
    }
  // 列宽量出来；汇点要在列前留出一个结的位置
  const width = {};
  for (const id of ids) width[id] = drawNodeWidth(all[id], more[id] || 0, measure);
  const knotted = id => needs[id].length >= 3 || (all[id].any && needs[id].length >= 2);
  const colW = layers.map(vs => Math.max(0, ...vs.filter(v => all[v]).map(v => width[v])));
  const colX = [];
  layers.forEach((vs, l) => {
    const room = vs.some(v => all[v] && knotted(v)) ? knot : 0;
    colX[l] = (l ? colX[l - 1] + colW[l - 1] + gap : pad + 2) + room;
  });
  const lo = Math.min(...Object.keys(y).map(v => y[v] - size(v) / 2)),
    hi = Math.max(...Object.keys(y).map(v => y[v] + size(v) / 2)),
    shift = pad - lo;
  for (const v of Object.keys(y)) y[v] += shift;
  const f = n => n.toFixed(1);
  const curve = pts => {
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1],
        [x2, y2] = pts[i];
      if (Math.abs(y2 - y1) < 0.5) d += ` L${f(x2)} ${f(y2)}`;
      else {
        const m = (x1 + x2) / 2;
        d += ` C${f(m)} ${f(y1)} ${f(m)} ${f(y2)} ${f(x2)} ${f(y2)}`;
      }
    }
    return d;
  };
  const colEnd = l => colX[l] + colW[l] + 4;
  /** @type {PlacedEdge[]} */
  const edges = [];
  /** @type {PlacedKnot[]} */
  const knots = [];
  for (const { from, to, chain } of chains) {
    const pts = [
      [colX[lay[from]] + width[from] + 5, y[from]],
      [colEnd(lay[from]), y[from]]
    ];
    for (const d of chain.slice(1, -1)) pts.push([colX[lay[d]] - 4, y[d]], [colEnd(lay[d]), y[d]]);
    // 汇点：结在记号前一个结宽处；择一的结是一个写着「或」的圈，线到圈边止，否则汇到结心
    pts.push(knotted(to) ? [colX[lay[to]] - knot + 1 - (all[to].any ? 6 : 0), y[to]] : [colX[lay[to]] - 5, y[to]]);
    edges.push({ from, to, d: curve(pts.filter((p, i) => !i || p[0] > pts[i - 1][0] - 0.1)), state: all[from].state });
  }
  for (const id of ids)
    if (knotted(id)) {
      const x = colX[lay[id]] - knot + 1;
      knots.push({ x, y: y[id], any: !!all[id].any, to: id });
      edges.push({
        from: id,
        to: id,
        d: `M${f(x + (all[id].any ? 6 : 0))} ${f(y[id])} L${f(colX[lay[id]] - 5)} ${f(y[id])}`,
        state: "knot"
      });
    }
  /** @type {PlacedNode[]} */
  const nodes = ids.map(id => ({ id, x: colX[lay[id]], y: y[id], w: width[id], node: all[id], more: more[id] || 0 }));
  return {
    width: Math.ceil(colX[L - 1] + colW[L - 1] + pad + 4),
    height: Math.ceil(hi - lo + pad * 2),
    nodes,
    edges,
    knots,
    // 每项的字框：测试用来查重合
    boxes: nodes.map(n => [n.x - 2, n.y - 9, n.x + n.w + 2, n.y + 9])
  };
}
