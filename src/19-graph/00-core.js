// 言 · 纲：长活的结论图。计划卡的升级——一项不再是「要做的事」，而是「要成立的结论」：写明怎么算成立、以哪几条为前提。
// 约束的核心在分权：模型只能把一项标成未做、在做、自称成立、弃；成立与否由验的人判（见 10-check.js）；
// 失效由这里判——前提的说法变了、验时看过的文件后来又被改了，已成立的就退回待复验，修一处坏一处由此查得出来，不靠模型自己想到。
// 图不另存：行迹是唯一真相。改图的那一步（update_graph）记着它改了什么，验的那一步（graph_check）记着判词，
// 这一段对话的图就是把这些步骤按先后折一遍（graphOf）。重写、删掉一答，图跟着退回去，不必另写回滚。
// 本文件只放纯函数：怎么折、怎么判、怎么写成给模型读的字。验的人、收尾的闸在后两段，登记与画法在 15-tools/30-plan.js
/**
 * @typedef {Object} GraphNode
 * @property {string} id 模型起的短名，此后不变
 * @property {string} claim 要成立的那句话
 * @property {string} check 怎么算成立：验的人照它判
 * @property {string} when 只在这一情形下需要成立（分情况）；空即总要成立
 * @property {string[]} needs 前提
 * @property {boolean} any 前提里有一条成立即可（几条路线择一）；否则都要成立
 * @property {"open"|"doing"|"claimed"|"dropped"} mark 模型标的
 * @property {string} evidence 做的人交的证据
 * @property {string[]} files 与它相关的文件：做的人列的、它在做时改过的、验的人认的
 * @property {GraphVerdict|null} verdict 这一版说法最近的判词；说法一改或模型重标即清
 * @property {string} origin 起于哪一答（消息 id）
 * @property {string} touched 最近动它的那一答
 *
 * @typedef {Object} GraphVerdict 验的人的判词，记在 graph_check 那一步上
 * @property {string} node
 * @property {boolean} holds
 * @property {string} gap 不成立时差在哪；成立时可空
 * @property {string} version 验的是哪一版说法（见 nodeVersion）
 * @property {Record<string, string>} premises 验时各前提的说法
 * @property {Record<string, number>} seen 验时各相关文件已被改过几回：此后再改，判词即作废
 * @property {string[]} [files] 验的人认的相关文件
 *
 * @typedef {{ id: string, claim?: string, check?: string, when?: string, needs?: string[], any?: boolean, mark?: GraphNode["mark"], evidence?: string, files?: string[] }} GraphOp
 * @typedef {{ nodes: Map<string, GraphNode>, changes: Map<string, number> }} Graph changes：这段对话里每个文件被改过几回
 * @typedef {"open"|"doing"|"claimed"|"holds"|"fails"|"stale"|"dropped"} NodeState
 */
const GRAPH_LIMIT = 40,
  GRAPH_ID = /^[\p{L}\p{N}_.-]{1,40}$/u,
  GRAPH_MARKS = new Set(["open", "doing", "claimed", "dropped"]);
/** 一项说法的指纹：结论、验收、情形三样任一变了就是另一版 @param {{ claim: string, check: string, when: string }} node */
function nodeVersion(node) {
  return hashText(`${node.claim}\u0001${node.check}\u0001${node.when}`);
}
/** 一段对话（或任意几条消息）的图：把改图与验的步骤按先后折一遍 @param {Message[]} messages */
function graphOf(messages) {
  /** @type {Graph} */
  const graph = { nodes: new Map(), changes: new Map() };
  /** @param {string} path */
  const changed = path => {
    graph.changes.set(path, (graph.changes.get(path) || 0) + 1);
    // 正在做的那几项名下记上：做它时改过的文件，日后又被改了它就得复验
    for (const node of graph.nodes.values()) if (node.mark === "doing" && !node.files.includes(path)) node.files.push(path);
  };
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const step of message.steps || []) {
      // 改动理顺、查过才记进 step.graph：记上了就作数，那一步随后的验停了、断了也不影响它改的图
      if (step.name === "update_graph" && step.graph) applyGraphOps(graph, step.graph, message.id);
      else if (step.name === "graph_check" && step.verdict) applyVerdict(graph, step.verdict, message.id);
      // 帮手在后台改的，按派它的那一步的位置算：先后差一点无妨，次数是对的
      for (const s of [step, ...(step.sub?.steps || [])]) if (s.change && s.status === "done") changed(s.change.path);
    }
  }
  return graph;
}
/** @param {Graph} graph @param {GraphOp[]} ops @param {string} messageId */
function applyGraphOps(graph, ops, messageId) {
  for (const op of ops) {
    let node = graph.nodes.get(op.id);
    if (!node) {
      if (!op.claim) continue;
      node = {
        id: op.id,
        claim: "",
        check: "",
        when: "",
        needs: [],
        any: false,
        mark: "open",
        evidence: "",
        files: [],
        verdict: null,
        origin: messageId,
        touched: messageId
      };
      graph.nodes.set(op.id, node);
    }
    const before = nodeVersion(node);
    for (const key of /** @type {const} */ (["claim", "check", "when", "evidence"])) if (typeof op[key] === "string") node[key] = op[key];
    if (Array.isArray(op.needs)) node.needs = op.needs.filter(id => id !== node.id);
    if (typeof op.any === "boolean") node.any = op.any;
    for (const path of op.files || []) if (!node.files.includes(path)) node.files.push(path);
    // 说法改了：先前的判词说的是旧的那一版，作废，回到未做（除非这回同时给了标记）
    if (nodeVersion(node) !== before) {
      node.verdict = null;
      node.mark = "open";
    }
    if (op.mark) {
      node.mark = op.mark;
      node.verdict = null;
    }
    node.touched = messageId;
  }
}
/** @param {Graph} graph @param {GraphVerdict} verdict @param {string} messageId */
function applyVerdict(graph, verdict, messageId) {
  const node = graph.nodes.get(verdict.node);
  if (!node || node.mark === "dropped" || verdict.version !== nodeVersion(node)) return;
  node.verdict = verdict;
  for (const path of verdict.files || []) if (!node.files.includes(path)) node.files.push(path);
  node.touched = messageId;
}
/** 判词还作不作数：前提的说法没变、验时看过的文件没再被改 @param {Graph} graph @param {GraphNode} node @returns {string} 作废的缘由；作数即空 */
function staleReason(graph, node) {
  const verdict = node.verdict;
  if (!verdict) return "";
  const live = node.needs.filter(id => graph.nodes.get(id)?.mark !== "dropped");
  for (const id of live) {
    const premise = graph.nodes.get(id);
    if (!premise) continue;
    if (!(id in verdict.premises)) return `前提 ${id} 是后来加的`;
    if (verdict.premises[id] !== nodeVersion(premise)) return `前提 ${id} 的说法改了`;
  }
  const touched = Object.entries(verdict.seen || {})
    .filter(([path, count]) => (graph.changes.get(path) || 0) !== count)
    .map(([path]) => path);
  return touched.length ? `验后又改了 ${touched.slice(0, 4).join("、")}${touched.length > 4 ? ` 等 ${touched.length} 个文件` : ""}` : "";
}
/** @param {Graph} graph @param {GraphNode} node @returns {NodeState} */
function nodeState(graph, node) {
  if (node.mark === "dropped") return "dropped";
  if (node.verdict) return !node.verdict.holds ? "fails" : staleReason(graph, node) ? "stale" : "holds";
  return node.mark;
}
// 「立住了」：自己成立，前提也都立住了（any 的有一条立住即可）。弃了的前提不算在内——弃了就是不要了
/** @param {Graph} graph @param {GraphNode} node */
function nodeEstablished(graph, node, seen = new Set()) {
  if (seen.has(node.id)) return false;
  seen.add(node.id);
  if (nodeState(graph, node) !== "holds") return false;
  const premises = node.needs.map(id => graph.nodes.get(id)).filter(p => p && p.mark !== "dropped");
  if (!premises.length) return true;
  return node.any
    ? premises.some(p => nodeEstablished(graph, p, new Set(seen)))
    : premises.every(p => nodeEstablished(graph, p, new Set(seen)));
}
/** 谁以它为前提 @param {Graph} graph @param {string} id */
function dependentsOf(graph, id) {
  return [...graph.nodes.values()].filter(node => node.mark !== "dropped" && node.needs.includes(id));
}
/** 根：没弃、也没有谁以它为前提的那几项——一件活最终要立住的结论 @param {Graph} graph */
function graphRoots(graph) {
  return [...graph.nodes.values()].filter(node => node.mark !== "dropped" && !dependentsOf(graph, node.id).length);
}
/** 从这几项往上走到根：一答动过哪几项，它就该对哪几个根负责 @param {Graph} graph @param {Iterable<string>} ids */
function rootsAbove(graph, ids) {
  const roots = new Set(),
    seen = new Set(),
    queue = [...ids];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = graph.nodes.get(id);
    if (!node || node.mark === "dropped") continue;
    const up = dependentsOf(graph, id);
    if (!up.length) roots.add(node);
    queue.push(...up.map(n => n.id));
  }
  return [...roots];
}
/** 前提在前的次序（图里若有环，环上的按原序排在末尾，不至于丢） @param {Graph} graph */
function graphOrder(graph) {
  const out = [],
    done = new Set(),
    visiting = new Set();
  const visit = node => {
    if (done.has(node.id) || visiting.has(node.id)) return;
    visiting.add(node.id);
    for (const id of node.needs) {
      const premise = graph.nodes.get(id);
      if (premise) visit(premise);
    }
    visiting.delete(node.id);
    done.add(node.id);
    out.push(node);
  };
  for (const node of graph.nodes.values()) visit(node);
  return out;
}
// ---------- 模型交来的改动：理顺、查错，查出错的整批不收 ----------
// 规矩在这里查，不在折的时候查：存进步骤的都是理顺过的，graphOf 只管照做
const GRAPH_MARK_ALIASES = {
  pending: "open",
  todo: "open",
  in_progress: "doing",
  done: "claimed",
  holds: "claimed",
  complete: "claimed",
  skipped: "dropped",
  drop: "dropped"
};
/**
 * @param {Graph} graph 此刻的图
 * @param {any} raw 模型给的 nodes
 * @returns {{ ops: GraphOp[], problems: string[] }}
 */
function normalizeGraphOps(graph, raw) {
  const problems = [],
    /** @type {GraphOp[]} */
    ops = [];
  if (!Array.isArray(raw) || !raw.length) return { ops, problems: ["nodes 须是非空数组"] };
  const clip = (value, n) =>
    String(value ?? "")
      .trim()
      .slice(0, n);
  const fresh = new Set();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      problems.push("nodes 里每一项须是对象");
      continue;
    }
    const id = clip(item.id, 60);
    if (!GRAPH_ID.test(id)) {
      problems.push(`id「${id}」不合要求：1–40 个字母、数字、汉字或 _ . -，不含空格`);
      continue;
    }
    const known = graph.nodes.get(id) || ops.find(op => op.id === id && op.claim);
    /** @type {GraphOp} */
    const op = { id };
    if (item.claim !== undefined) op.claim = clip(item.claim, 300);
    if (item.check !== undefined) op.check = clip(item.check, 600);
    if (item.when !== undefined) op.when = clip(item.when, 200);
    if (item.evidence !== undefined) op.evidence = clip(item.evidence, 2000);
    if (item.any !== undefined) op.any = item.any === true;
    if (item.needs !== undefined)
      op.needs = [...new Set((Array.isArray(item.needs) ? item.needs : [item.needs]).map(n => clip(n, 60)).filter(Boolean))];
    if (item.files !== undefined)
      op.files = [...new Set((Array.isArray(item.files) ? item.files : [item.files]).map(f => clip(f, 300)).filter(Boolean))].slice(0, 20);
    if (item.status !== undefined) {
      const status = String(item.status).trim().toLowerCase(),
        mark = GRAPH_MARKS.has(status) ? status : GRAPH_MARK_ALIASES[status];
      if (!mark) problems.push(`${id} 的 status「${item.status}」不认得：只有 open / doing / claimed / dropped`);
      else op.mark = mark;
    }
    if (!known) {
      if (!op.claim || !op.check) {
        problems.push(`${id} 是新的一项，claim 与 check 都要写`);
        continue;
      }
      fresh.add(id);
    }
    if (op.claim === "" || op.check === "") problems.push(`${id} 的 claim、check 不能改成空的`);
    ops.push(op);
  }
  // 折上去试一遍：前提都在、没有环、不超上限
  const trial = {
    nodes: new Map([...graph.nodes].map(([id, node]) => [id, { ...node, needs: [...node.needs], files: [...node.files] }])),
    changes: graph.changes
  };
  applyGraphOps(trial, ops, "");
  for (const op of ops)
    for (const need of op.needs || [])
      if (!trial.nodes.has(need)) problems.push(`${op.id} 的前提 ${need} 不存在（新的前提与它同一批写上即可）`);
  const cycle = graphCycle(trial);
  if (cycle) problems.push(`前提成了环：${cycle.join(" → ")}`);
  const live = [...trial.nodes.values()].filter(node => node.mark !== "dropped").length;
  if (fresh.size && live > GRAPH_LIMIT)
    problems.push(`图里的项不宜多于 ${GRAPH_LIMIT} 项（此刻 ${live}）：一项是值得单独验的结论，不是每一步动作；细的步骤并进上一级`);
  return { ops, problems };
}
/** @param {Graph} graph @returns {string[]|null} */
function graphCycle(graph) {
  const state = new Map(),
    path = [];
  const visit = id => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const need of graph.nodes.get(id)?.needs || []) {
      if (!graph.nodes.has(need)) continue;
      const found = visit(need);
      if (found) return found;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of graph.nodes.keys()) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}
// 模型常把整张图重报一遍（计划卡就是这么用的）：已成立、说法未动的那几项又标一次「自称成立」，不必再验一回；
// 在做的又标一次在做，也不该把什么清掉。这类无改动的标记在收进步骤之前就剔掉
/** @param {Graph} graph @param {GraphOp[]} ops */
function quietGraphOps(graph, ops) {
  return ops.map(op => {
    const node = graph.nodes.get(op.id);
    if (!node || !op.mark) return op;
    const state = nodeState(graph, node),
      same = ["claim", "check", "when"].every(key => op[key] === undefined || op[key] === node[key]);
    // 重标「自称成立」只在已成立时省掉：不成立、待复验的改完再标，正是要它再验；待验的没验成（中途停了），再标也得验
    if (same && (op.mark === "claimed" ? state === "holds" : op.mark === state)) {
      const { mark, ...rest } = op;
      return rest;
    }
    return op;
  });
}
// ---------- 写成给模型读的字：工具结果、收尾时的缺口、每一问附着的纲、验的人读的前提，都经这里 ----------
const NODE_STATE_TEXT = {
  open: "未做",
  doing: "在做",
  claimed: "待验",
  holds: "成立",
  fails: "不成立",
  stale: "待复验",
  dropped: "已弃"
};
/**
 * @param {Graph} graph
 * @param {{ roots?: GraphNode[]|null, label?: string }} [options] roots：只写这几个根底下的；不给即整张
 */
function graphText(graph, { roots = null, label = "纲" } = {}) {
  const scope = roots ? graphBelow(graph, roots) : null,
    nodes = graphOrder(graph).filter(node => !scope || scope.has(node.id)),
    live = nodes.filter(node => node.mark !== "dropped");
  if (!live.length) return "";
  const standing = live.filter(node => nodeEstablished(graph, node)).length;
  const lines = live.map(node => {
    const state = nodeState(graph, node),
      established = state === "holds" && nodeEstablished(graph, node),
      tag = state === "holds" && !established ? "成立·待前提" : NODE_STATE_TEXT[state],
      premises = node.needs.filter(id => graph.nodes.get(id)?.mark !== "dropped"),
      head = `- [${tag}] ${node.id}：${node.claim}${node.when ? `（情形：${node.when}）` : ""}${premises.length ? `（前提：${premises.join("、")}${node.any ? "，任一即可" : ""}）` : ""}`;
    if (established) return head;
    const more = [`  验收：${node.check}`];
    if (state === "fails" && node.verdict?.gap) more.push(`  缺口：${node.verdict.gap.slice(0, 600)}`);
    if (state === "stale") more.push(`  ${staleReason(graph, node)}`);
    return [head, ...more].join("\n");
  });
  const dropped = nodes.length - live.length;
  return `［${label}］立住 ${standing} / ${live.length}${dropped ? `，另有 ${dropped} 项已弃` : ""}\n${lines.join("\n")}`;
}
/** 这几个根底下（含自身）的各项 @param {Graph} graph @param {GraphNode[]} roots */
function graphBelow(graph, roots) {
  const seen = new Set(),
    queue = roots.map(node => node.id);
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !graph.nodes.has(id)) continue;
    seen.add(id);
    queue.push(...graph.nodes.get(id).needs);
  }
  return seen;
}
