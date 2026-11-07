// 言 · 意：一件工程要成立的结论图——项目实现的骨架。存在目录的 .yan/意.json（桥接是唯一的写者，见 server/work/index.js），
// 不属于哪一段对话：换一段对话、压缩了前文、被回报叫醒另起一答，看到的都是同一份。
// 程序只给形式约束与可见性，成立与否由模型自己判：
//   结构——前提要在、不成环，不合的整批不收；立根时记下用户那一问的原话，日后拿它比；根的说法只照用户的话改，改时记下那一问、留一笔痕；
//   传播——前提没立住，上面的就不算立住；
//   回归——一项标成立时记下凭据（自己与各前提的说法版本、所依托凭据的指纹：文件、目录、探针，见 05-anchors.js），
//     此后说法改了、凭据变了，它就转待复核。只是标记、不驱动什么：由数据算出，算一回就停，不会自己转起来；复核后再标成立，即换一份凭据。
// 方案改了、写错了的整项撤去（state 给 removed），指向它的前提一并抹掉，只留一笔痕；弃（dropped）不同——是主线上走过、不通的路，
// 留在文件里作记号：不算数、不上图，卡片图下列着，模型读的意里也点到名，免得再走一遍。
// 降级有合法的写法：借外部结论、不自己做的标「假定」（note 写出处），算立住，但往上记着借了几条——降在哪、降多少看得见。
// 假定也可挂凭据：所借的变了（接口改版、依赖升级），它同样转待复核。
// 卡在人手里、要等人拍板的标「待定」（note 写等谁、定什么）：不算立住，换了对话、过了几天也看得见卡在谁那儿。
// 节点不分类型：事件、功能、文件都是一句要成立的结论，粒度由模型拆到有凭据可挂为止，混着也无妨。
// 守：按任务设、一直要守的条件（收尾前测试要过、对外接口不改）标 keep——不是要交付的结论：不上图、不计进度、不挂前提也不作前提，只在全局；
// 立时也记下用户那一问的原话。守就是言的钩子：写得出触发条件的写 on（一条正则），对得上的那一步动手前先跑它挂的测试，不过即不做；
// 没挂测试的即禁令，对上就不做；标了 ask 的是关口（「批准前不发布」），对上即请用户批，不论权限档位（见 10-store.js 的 keepHook）。
// 写不出触发条件的挂测试、探针，动过手的那一答收尾前重查（intentRecheck），再不然只凭模型自觉。
// 嵌套：一项做的事拆开还有许多步，就是模块——细项写 in 指向它，至多两层（全局 › 模块 › 子模块）。
// 模块以里面收口的几项（同层没人以它为前提的）为前提，所以里面立住它才算立住，传播、回归照旧，不另写判定。
// 前提可跨模块：依的是哪一项就连哪一项（评测依的是训练里那一步，不是整个训练模块）；模块只是分组，图仍是一张 DAG，查环时连模块到收口项那几条一并算。
// 一项不成图：新立意时只有一项要立的，退回——一答之内做得完的活用不着意。
// 标成立要前提先立住（同一批一起标也算，模块即里面收口的几项）：自己做完而前提未立的仍是进行中。凭据变了转待复核是事后的，不在此拦。
// 根可补标：当初没标、后来看清它就是整件事要立的，补标时记下那一问的原话；已是别项前提的不能标根。
// 了结：一个目录可以先后做几件事，一棵根一件；上面这张图是专项的，要一直成立的归下面的守。根立住，那一件就了结（见 intentClosed）：
// 不再附着、不比凭据、不计进度与上限，只给人看（题下与卡片），模型要时读文件。
// 不存、也不用另设「任务」：图的连通本就分得出几件事，立没立住本就算得出。接着做时根改回 doing，或写进新一项的前提，它自然又开了
// 本文件只放纯函数：理顺模型交来的改动、判状态、写成给模型读的字。读写与附着见 10-store.js，工具登记见 15-tools/32-intent.js
/**
 * @typedef {"open"|"doing"|"waiting"|"done"|"assumed"|"dropped"} IntentMark 模型标的；waiting：待定，卡在人手里、等人拍板
 * @typedef {IntentMark|"stale"} IntentState 算出来的：成立的凭据不再作数即待复核
 * @typedef {Object} IntentNode
 * @property {string} claim 要成立的那句话
 * @property {string} check 怎么算成立
 * @property {string[]} needs 前提
 * @property {boolean} [any] 前提里一项立住即可（几条路线择一）
 * @property {string} [when] 只在这一情形下须成立
 * @property {string[]} anchors 凭据，「种类:值」（见 05-anchors.js）：变了即待复核
 * @property {IntentMark} state
 * @property {string} [note] 假定的出处、备注
 * @property {number} rev 说法的版本：claim、check、when 改一回加一
 * @property {IntentSeal} [seal] 标成立（或假定）那一刻记下的：说法版本、前提版本、各凭据的指纹
 * @property {{ ask: string, at: string, later?: string }} [root] 根：立时用户那一问的原话；later：末一回改根时那一问
 * @property {string} [in] 所属模块的 id；不写即在全局
 * @property {boolean} [keep] 守：一直要守的条件，不是要交付的结论
 * @property {string} [on] 守的钩子：正则，对得上的那一步（指令原文、路径、网址或工具名）动手前先跑它挂的测试；没挂测试即不做
 * @property {boolean} [ask] 写了 on 的守是关口：测试过了（或没挂）还要请用户批
 * @typedef {{ rev: number, premises: Record<string, number>, prints: Record<string, string|null>, anchors?: string[] }} IntentSeal
 * @typedef {{ at: string, conversation: string, text: string }} IntentLog 改意、弃、假定的留痕
 * @typedef {{ nodes: Record<string, IntentNode>, log: IntentLog[], updated?: string }} Intent updated：最近一回写入的时刻——单拿出来看时，看得出旧不旧
 * @typedef {{ id: string, claim?: string, check?: string, when?: string, needs?: string[], any?: boolean, anchors?: string[], state?: IntentMark, note?: string, root?: boolean, keep?: boolean, on?: string, ask?: boolean, in?: string, remove?: boolean, rename?: string }} IntentOp in：空串即挪回全局；remove：整项撤去；rename：已有一项改叫这个名字
 * @typedef {Record<string, string|null>} IntentPrints 各凭据此刻的指纹，按「种类:值」；不在其中的即不知道，不据它判
 */
const INTENT_LIMIT = 60,
  INTENT_DEPTH = 2,
  INTENT_LEVEL_LIMIT = 15,
  INTENT_LOG_LIMIT = 200,
  INTENT_ID = /^[\p{L}\p{N}_.·-]+$/u,
  // 名字的宽：汉字一类全角记 2、字母数字记 1——至多 24 个汉字或 48 个字母
  INTENT_ID_WIDTH = 48,
  INTENT_MARKS = new Set(["open", "doing", "waiting", "done", "assumed", "dropped"]),
  INTENT_MARK_ALIASES = {
    pending: "open",
    todo: "open",
    not_started: "open",
    in_progress: "doing",
    blocked: "waiting",
    on_hold: "waiting",
    paused: "waiting",
    complete: "done",
    completed: "done",
    holds: "done",
    claimed: "done",
    assume: "assumed",
    skipped: "dropped",
    drop: "dropped"
  },
  // 撤：不是一种态，给了即整项删去
  INTENT_REMOVE = new Set(["removed", "remove", "delete", "deleted", "revoked"]),
  // 记凭据的两种：成立的、假定的
  SEALED = new Set(["done", "assumed"]);
// 节点表按 id 取项：内置对象名不能误当成已存在的节点。
const validIntentId = id =>
  INTENT_ID.test(id) &&
  [...id].reduce((w, ch) => w + /** @type {number} */ (ch.codePointAt(0) > 0x2e7f ? 2 : 1), 0) <= INTENT_ID_WIDTH &&
  !Object.hasOwn(Object.prototype, id);
/** 这一项改完叫什么（改了名的即新名） @param {IntentOp} op */
const intentOpId = op => op.rename || op.id;
// 模型给的名字理成合式：首尾的空格、冒号、@ 之类去掉，中间连着的一串换成一个 _；它自己写的 _ 不动。
// 同一批里 id、前提、所属、改名都经这里，改写得一致
/** @param {any} raw */
const tidyIntentId = raw =>
  String(raw ?? "")
    .replace(/^[^\p{L}\p{N}_.·-]+|[^\p{L}\p{N}_.·-]+$/gu, "")
    .replace(/[^\p{L}\p{N}_.·-]+/gu, "_");
// 改名：节点换个键（次序不动），前提、所属、各项所记的前提版本跟着换；说法没变，记下的凭据照旧作数
/** @param {Intent} intent @param {string} from @param {string} to */
function renameIntentNode(intent, from, to) {
  intent.nodes = Object.fromEntries(Object.entries(intent.nodes).map(([id, node]) => [id === from ? to : id, node]));
  for (const node of Object.values(intent.nodes)) {
    node.needs = node.needs.map(k => (k === from ? to : k));
    if (node.in === from) node.in = to;
    const premises = node.seal?.premises;
    if (premises && Object.hasOwn(premises, from))
      node.seal.premises = Object.fromEntries(Object.entries(premises).map(([k, v]) => [k === from ? to : k, v]));
  }
}
/** 读到的 JSON 理成一份意：缺的补上，认不得的项丢掉 @returns {Intent} */
function asIntent(raw) {
  const nodes = raw?.nodes && typeof raw.nodes === "object" && !Array.isArray(raw.nodes) ? raw.nodes : {},
    /** @type {Intent} */
    intent = {
      nodes: {},
      log: Array.isArray(raw?.log)
        ? raw.log
            .filter(entry => entry && typeof entry === "object")
            .slice(-INTENT_LOG_LIMIT)
            .map(entry => ({ at: String(entry.at || ""), conversation: String(entry.conversation || ""), text: String(entry.text || "") }))
        : [],
      ...(typeof raw?.updated === "string" ? { updated: raw.updated } : {})
    };
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== "object" || !validIntentId(id)) continue;
    intent.nodes[id] = {
      ...node,
      claim: String(node.claim || ""),
      check: String(node.check || ""),
      ...(node.when !== undefined ? { when: String(node.when) } : {}),
      needs: Array.isArray(node.needs) ? node.needs.map(String).filter(validIntentId) : [],
      // 凭据不带登记过的前缀（手编的、写漏的）即文件
      anchors: Array.isArray(node.anchors)
        ? node.anchors.map(String).map(key => (ANCHOR_KINDS.has(anchorParts(key)[0]) ? key : `file:${key}`))
        : [],
      state: INTENT_MARKS.has(node.state) ? node.state : "open",
      rev: Number(node.rev) || 1
    };
    if (typeof node.in === "string" && node.in !== id && validIntentId(node.in)) intent.nodes[id].in = node.in;
    else delete intent.nodes[id].in;
    if (node.keep === true) intent.nodes[id].keep = true;
    else delete intent.nodes[id].keep;
    if (!intent.nodes[id].keep || typeof node.on !== "string" || !node.on) delete intent.nodes[id].on;
    if (!intent.nodes[id].on || node.ask !== true) delete intent.nodes[id].ask;
    // 守没有进度：旧版里标过假定、未做的，一律当守着
    if (intent.nodes[id].keep) intent.nodes[id].state = "done";
    if (node.seal !== undefined) {
      const record = value => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
      intent.nodes[id].seal = {
        rev: Number(node.seal?.rev) || 0,
        premises: record(node.seal?.premises),
        prints: record(node.seal?.prints),
        ...(Array.isArray(node.seal?.anchors) ? { anchors: node.seal.anchors.map(String) } : {})
      };
    }
  }
  return intent;
}
// 文件写成与行迹里的改动记录同一个样子（目录内相对、正斜杠，见 server/work/paths.js 的 relPath）：
// 模型写的 ./src/a.js、src\a.js、目录下的绝对路径都认作 src/a.js。只做 Windows，比目录时不计大小写
/** @param {string} path @param {string|null} [workdir] */
function intentPath(path, workdir = "") {
  const p = String(path ?? "")
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/"),
    root = String(workdir || "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
  return (root && p.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? p.slice(root.length + 1) : p).replace(/^(\.\/)+/, "");
}
// ---------- 嵌套 ----------
/** 所属的模块，由近及远（全局即空；手编出了环也不至于转不出来） @param {Intent} intent @param {string} id @returns {string[]} */
function intentAncestors(intent, id) {
  const out = [];
  for (let at = intent.nodes[id]?.in; at && intent.nodes[at] && at !== id && !out.includes(at); at = intent.nodes[at].in) out.push(at);
  return out;
}
/** 不算数了：自己弃了，或所属的模块弃了 @param {Intent} intent @param {string} id */
const intentGone = (intent, id) => !intent.nodes[id] || [id, ...intentAncestors(intent, id)].some(k => intent.nodes[k].state === "dropped");
/** 模块直属的几项 @param {Intent} intent @param {string} id */
const intentChildren = (intent, id) =>
  Object.keys(intent.nodes).filter(k => intent.nodes[k].in === id && !intent.nodes[k].keep && !intentGone(intent, k));
/** 模块收口的几项：直属里同层没人以它为前提的——模块以它们为前提 @param {Intent} intent @param {string} id */
function intentTops(intent, id) {
  const kids = intentChildren(intent, id);
  return kids.filter(k => !kids.some(other => intent.nodes[other].needs.includes(k)));
}
/** 写明的前提里还算数的 @param {Intent} intent @param {string} id */
const writtenNeeds = (intent, id) => intent.nodes[id].needs.filter(k => !intentGone(intent, k));
/** 实际的前提：写明的，加上（模块的）收口的几项 @param {Intent} intent @param {string} id */
const liveNeeds = (intent, id) => [...writtenNeeds(intent, id), ...intentTops(intent, id)];
/** 谁以它为前提：同层写明的，与（收口的）所属模块 @param {Intent} intent @param {string} id */
function intentDependents(intent, id) {
  const parent = intent.nodes[id]?.in;
  return [
    ...Object.keys(intent.nodes).filter(other => !intentGone(intent, other) && intent.nodes[other].needs.includes(id)),
    ...(parent && intent.nodes[parent] && intentTops(intent, parent).includes(id) ? [parent] : [])
  ];
}
/** 根：没弃、也没有谁以它为前提的——一件活最终要立住的结论（模块里的总有模块等着，根只在全局）；守不算 @param {Intent} intent */
function intentRoots(intent) {
  return Object.keys(intent.nodes).filter(id => !intent.nodes[id].keep && !intentGone(intent, id) && !intentDependents(intent, id).length);
}
/**
 * 了结的各项：立住了的根走得到、没立住的根走不到的。属模块的守随模块了结，全局的守不了结。
 * 只看模型标的与说法、前提的版本，不看指纹：了结的不再取指纹，后来的活改了同一个文件、清了旧目录，它不会翻回来；往后要一直成立的归守。
 * 开着的根走得到它（接着做，写进了新一项的前提），它就又开了，这时才再比凭据
 * @param {Intent} intent @param {Set<string>} [before] 这一答开工时已了结的：作答途中才立住的先不收，收尾对照还要拿原问比
 * @returns {Set<string>}
 */
function intentClosed(intent, before) {
  const walk = (start, into) => {
    if (into.has(start) || !Object.hasOwn(intent.nodes, start)) return into;
    into.add(start);
    for (const need of liveNeeds(intent, start)) walk(need, into);
    return into;
  };
  const opened = new Set(),
    settled = new Set();
  for (const id of intentRoots(intent)) walk(id, intentEstablished(intent, id) ? settled : opened);
  const closed = new Set([...settled].filter(id => !opened.has(id)));
  for (const id of Object.keys(intent.nodes)) if (intent.nodes[id].keep && closed.has(intent.nodes[id].in)) closed.add(id);
  return before ? new Set([...closed].filter(id => before.has(id))) : closed;
}
/** 了结的几件（根），新的在前：题下与卡片上给人看 @param {Intent} intent @param {Set<string>} [closed] */
const intentPast = (intent, closed = intentClosed(intent)) =>
  intentRoots(intent)
    .filter(id => closed.has(id))
    .reverse()
    .sort((a, b) => String(intent.nodes[b].root?.at || "").localeCompare(String(intent.nodes[a].root?.at || "")));
/** 守：没弃、也没随所属模块了结的几条 @param {Intent} intent @param {Set<string>} [closed] */
const intentKeeps = (intent, closed = intentClosed(intent)) =>
  Object.keys(intent.nodes).filter(id => intent.nodes[id].keep && !intentGone(intent, id) && !closed.has(id));
/** 守的触发条件；没写、写坏了即无 @param {{ keep?: boolean, on?: string }} node @returns {RegExp|null} */
function keepTrigger(node) {
  try {
    return node.keep && node.on ? new RegExp(node.on, "i") : null;
  } catch {
    return null;
  }
}
/** 钩子对上了怎么办：给模型读的那半句 @param {IntentNode} node */
const keepHookText = node =>
  node.ask ? t("动手前请用户批") : node.anchors.some(key => anchorParts(key)[0] === "test") ? t("动手前查") : t("对上即不做");
/** 钩子挂的测试：只在对得上的那一步之前跑（将要做的交给它），平时不取指纹、不据它判待复核 @param {IntentNode} node @param {string} key */
const keepHookAnchor = (node, key) => !!keepTrigger(node) && anchorParts(key)[0] === "test";
/**
 * 孤悬的：没声明为根、也没有谁以它为前提，而图里另有根——多半是手上的一步忘了连到它所撑的那一项，悄悄成了又一个根。
 * 只有它一个根、或声明过的根不算；了结的那几件不算「另有」
 * @param {Intent} intent @param {Set<string>} [closed]
 */
function intentStrays(intent, closed = intentClosed(intent)) {
  const roots = intentRoots(intent).filter(id => !closed.has(id));
  if (roots.length < 2) return [];
  return roots.filter(id => !intent.nodes[id].root);
}
/**
 * 嵌套的规矩：所属的模块要在、不成环、不过两层；根在全局；一层不宜过多
 * @param {Intent} intent @returns {string[]}
 */
function intentNestProblems(intent) {
  const problems = [],
    counts = new Map(),
    closed = intentClosed(intent);
  for (const [id, node] of Object.entries(intent.nodes)) {
    if (node.in !== undefined && !intent.nodes[node.in]) problems.push(t`${id} 的 in「${node.in}」不存在（模块与细项同一批写上即可）`);
    const up = intentAncestors(intent, id),
      top = up.at(-1);
    if (top && intent.nodes[top].in !== undefined && intent.nodes[intent.nodes[top].in])
      problems.push(t`${id} 的所属成了环：${[id, ...up, intent.nodes[top].in].join(" → ")}`);
    else if (up.length > INTENT_DEPTH) problems.push(t`${id} 嵌得太深：至多两层（全局 › 模块 › 子模块）`);
    // 守也记原问（同一个字段），它不算根
    if (node.root && node.in && !node.keep) problems.push(t`${id} 是根，根在全局，不归模块`);
    if (node.keep && node.needs.length) problems.push(t`${id} 是守，不挂前提`);
    for (const need of node.needs) if (intent.nodes[need]?.keep) problems.push(t`${id} 的前提 ${need} 是守：守不作前提`);
    if (!intentGone(intent, id) && !closed.has(id)) counts.set(node.in || "", (counts.get(node.in || "") || 0) + 1);
  }
  for (const [level, n] of counts)
    if (n > INTENT_LEVEL_LIMIT)
      problems.push(t`「${level || t("全局")}」一层多于 ${INTENT_LEVEL_LIMIT} 项：把相关的几项并成一个模块（细项写 in 指向它）`);
  return problems;
}
/** 前提在前的次序（万一有环，环上的按原序排在末尾，不至于丢） @param {Intent} intent */
function intentOrder(intent) {
  const out = [],
    done = new Set(),
    visiting = new Set();
  const visit = id => {
    if (done.has(id) || visiting.has(id) || !intent.nodes[id]) return;
    visiting.add(id);
    for (const need of [...intent.nodes[id].needs, ...intentTops(intent, id)]) visit(need);
    visiting.delete(id);
    done.add(id);
    out.push(id);
  };
  for (const id of Object.keys(intent.nodes)) visit(id);
  return out;
}
/** 成环的一圈：写明的前提，连同模块到它收口的几项（所以以自己所属的模块为前提也是环） @param {Intent} intent @returns {string[]|null} */
function intentCycle(intent) {
  const state = new Map(),
    path = [];
  const visit = id => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const need of [...(intent.nodes[id]?.needs || []), ...intentTops(intent, id)]) {
      if (!intent.nodes[need]) continue;
      const found = visit(need);
      if (found) return found;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of Object.keys(intent.nodes)) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}
// ---------- 判状态：都由数据算出，不存 ----------
/** 成立的凭据还作不作数 @param {Intent} intent @param {string} id @param {IntentPrints} now @returns {string} 不作数的缘由；作数即空 */
function intentStaleWhy(intent, id, now = {}) {
  const node = intent.nodes[id],
    seal = node?.seal;
  if (!node || !SEALED.has(node.state) || !seal) return "";
  if (seal.rev !== node.rev) return t("说法已改");
  if (seal.anchors && (seal.anchors.length !== node.anchors.length || seal.anchors.some(key => !node.anchors.includes(key))))
    return t("凭据已改");
  // 假定不靠前提，只看它自己的说法与凭据
  if (node.state === "done")
    for (const need of liveNeeds(intent, id)) {
      if (!(need in seal.premises)) return t`前提「${need}」为后添`;
      if (seal.premises[need] !== intent.nodes[need].rev) return t`前提「${need}」说法已改`;
    }
  const touched = Object.keys(seal.prints).filter(key => key in now && now[key] !== seal.prints[key]),
    // 测试只比过没过：没过就直说没过——记下时就不过的也算，重记一回凭据抹不平
    failing = Object.keys(seal.prints).filter(key => anchorParts(key)[0] === "test" && now[key] === "不过"),
    changed = touched.filter(key => !failing.includes(key));
  return [
    failing.length ? t`${failing.map(anchorLabel).join("、")}不过` : "",
    changed.length
      ? t`凭据已变：${changed.slice(0, 4).map(anchorLabel).join("、")}${changed.length > 4 ? t` 等 ${changed.length} 条` : ""}`
      : ""
  ]
    .filter(Boolean)
    .join("；");
}
/** @param {Intent} intent @param {string} id @param {IntentPrints} [now] @returns {IntentState} */
function intentState(intent, id, now = {}) {
  const node = intent.nodes[id];
  return SEALED.has(node.state) && intentStaleWhy(intent, id, now) ? "stale" : node.state;
}
// 「立住」：自己成立（或是假定）、凭据作数，前提也都立住了（any 的有一项立住即可）。弃了的前提不算在内
/** @param {Intent} intent @param {string} id @param {IntentPrints} [now] */
function intentEstablished(intent, id, now = {}, seen = new Set()) {
  const node = intent.nodes[id];
  if (!node || seen.has(id)) return false;
  const state = intentState(intent, id, now);
  if (state === "assumed") return true;
  if (state !== "done") return false;
  // any 只管写明的前提；模块收口的几项都得立住
  const written = writtenNeeds(intent, id),
    tops = intentTops(intent, id),
    next = new Set(seen).add(id),
    holds = need => intentEstablished(intent, need, now, next);
  return (node.any && written.length ? written.some(holds) : written.every(holds)) && tops.every(holds);
}
/** 这一项底下借了哪几条假定 @param {Intent} intent @param {string} id */
function intentBorrowed(intent, id) {
  const out = new Set(),
    seen = new Set(),
    queue = [id];
  while (queue.length) {
    const at = queue.shift();
    if (seen.has(at) || !intent.nodes[at]) continue;
    seen.add(at);
    if (intent.nodes[at].state === "assumed") out.add(at);
    else queue.push(...liveNeeds(intent, at));
  }
  return [...out];
}
/** 已成立、已假定各项记过指纹的凭据：读意时据此取一回此刻的；了结的不取 @param {Intent} intent @param {Set<string>} [closed] */
function intentSealedAnchors(intent, closed = intentClosed(intent)) {
  return [
    ...new Set(
      Object.entries(intent.nodes)
        .filter(([id, node]) => SEALED.has(node.state) && node.seal && !closed.has(id))
        .flatMap(([, node]) => Object.keys(node.seal.prints).filter(key => !keepHookAnchor(node, key)))
    )
  ];
}
// ---------- 模型交来的改动：理顺、查错，查出错的整批不收 ----------
/** 进度照写法宽认：In Progress、not-started 与 in_progress、not_started 同 @param {any} raw */
const intentStateWord = raw =>
  String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
/**
 * 上一批整批没收，这一批是改正：按 id 叠上去——提到的字段盖过，没提的项照旧带着；只在上一批里的项给了 removed 即从中拿掉。
 * 模型改正时多半只重给出错的几项，以为别的已经收下；叠上去就成了它本想交的那一整批
 * @param {Intent} intent @param {any[]} prior 上一批没收的原样 @param {any[]} items 这一批 @returns {any[]}
 */
function intentRetryBatch(intent, prior, items) {
  const key = item => (item && typeof item === "object" ? tidyIntentId(String(item.id ?? "").trim()) : null),
    merged = [...prior];
  // 一项都不沾上一批的：不是改正，是丢下那批另改别处——照它自己的判，原样交回，旧错不跟着带进来
  if (!items.some(item => key(item) && prior.some(old => key(old) === key(item)))) return items;
  for (const item of items) {
    const at = key(item) ? merged.findIndex(old => key(old) === key(item)) : -1;
    if (at < 0) merged.push(item);
    else if (item.state !== undefined && INTENT_REMOVE.has(intentStateWord(item.state)) && !intent.nodes[key(item)]) merged.splice(at, 1);
    else merged[at] = { ...merged[at], ...item };
  }
  return merged;
}
/**
 * @param {Intent} intent 此刻的意
 * @param {any} raw 模型给的 nodes
 * @param {string|null} [workdir] 凭据里的路径据此写成相对的
 * @returns {{ ops: IntentOp[], problems: string[], tidied: [string, string][] }} tidied：照规矩改写过的名字（原样 → 改后），回给模型时说一声
 */
function normalizeIntentOps(intent, raw, workdir = "") {
  const problems = [],
    /** @type {IntentOp[]} */
    ops = [],
    /** @type {Map<string, string>} */
    tidied = new Map();
  if (!Array.isArray(raw) || !raw.length) return { ops, problems: [t("nodes 须是非空数组")], tidied: [] };
  const clip = (value, n) =>
    String(value ?? "")
      .trim()
      .slice(0, n);
  const list = value => (Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value]);
  const idOf = value => {
    const said = clip(value, 80),
      id = tidyIntentId(said);
    if (id && id !== said) tidied.set(said, id);
    return id;
  };
  const badId = said => t`id「${clip(said, 80)}」不合要求：须有字母、数字或汉字，至多 24 个汉字（字母数字 48 个）`;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      problems.push(t("nodes 里每一项须是对象"));
      continue;
    }
    const id = idOf(item.id);
    if (!validIntentId(id)) {
      problems.push(badId(item.id));
      continue;
    }
    const known = intent.nodes[id] || ops.find(op => (op.id === id && op.claim) || op.rename === id);
    /** @type {IntentOp} */
    const op = { id };
    for (const [key, n] of /** @type {const} */ ([
      ["claim", 300],
      ["check", 600],
      ["when", 300],
      ["note", 1000]
    ]))
      if (item[key] !== undefined) op[key] = clip(item[key], n);
    if (item.in !== undefined && item.in !== null) op.in = clip(item.in, 80) && idOf(item.in);
    if (item.any !== undefined) op.any = item.any === true || item.any === "true";
    if (item.keep !== undefined) op.keep = item.keep === true || item.keep === "true";
    if (item.on !== undefined && item.on !== null) {
      // 本就不分大小写：照别家写法带的 (?i) 之类内联标记 JS 不认，去掉
      op.on = clip(item.on, 300).replace(/^\(\?[imsux]+\)/, "");
      if (op.on && !keepTrigger({ keep: true, on: op.on })) problems.push(t`${id} 的 on 不是合法的正则`);
    }
    if (item.ask !== undefined) op.ask = item.ask === true || item.ask === "true";
    if (item.needs !== undefined) op.needs = [...new Set(list(item.needs).map(idOf))].filter(n => n && n !== id);
    if (item.rename !== undefined && item.rename !== null && clip(item.rename, 80)) {
      const to = idOf(item.rename);
      if (!validIntentId(to)) problems.push(badId(item.rename));
      else if (!intent.nodes[id]) problems.push(t`${id} 不存在，无可改名（新的一项直接用新名字立）`);
      else if (to !== id && (intent.nodes[to] || ops.some(other => other.id === to || other.rename === to)))
        problems.push(t`${id} 改名为 ${to}：这个名字已有`);
      else if (to !== id) op.rename = to;
    }
    // 凭据：带前缀的是那一种，裸的是文件。模型照旧写 files、写成单数 anchor 的也认
    const anchors = item.anchors ?? item.anchor ?? item.files;
    if (anchors !== undefined) {
      const parsed = list(anchors).map(raw => parseAnchor(clip(raw, 400), workdir));
      for (const one of parsed) if ("problem" in one) problems.push(t`${id} 的${one.problem}`);
      op.anchors = [...new Set(parsed.flatMap(one => ("key" in one ? [one.key] : [])))].slice(0, 20);
    }
    const state = item.state === undefined ? undefined : intentStateWord(item.state);
    if (state !== undefined && INTENT_REMOVE.has(state)) {
      if (intent.nodes[id]) ops.push({ id, remove: true });
      else problems.push(t`${id} 不存在，无可撤`);
      continue;
    }
    if (state !== undefined) {
      const mark = INTENT_MARKS.has(state) ? state : Object.hasOwn(INTENT_MARK_ALIASES, state) ? INTENT_MARK_ALIASES[state] : undefined;
      if (!mark) problems.push(t`${id} 的 state「${item.state}」不认得：只有 open / doing / waiting / done / assumed / dropped / removed`);
      else op.state = /** @type {IntentMark} */ (mark);
    }
    // 守没有进度可标：立起、改过都即作数、重记凭据（测试不过照旧算不过，见 intentStaleWhy）。
    // 顺手带的 open、doing 之类不退回、照作数：退回过一回，模型就把守改成了寻常一项塞进模块；只有弃要说清——不守了是撤
    if (op.keep ?? !!(intent.nodes[id]?.keep || known?.keep)) {
      if (op.state === "dropped") problems.push(t`${id} 是守，不守了 state 给 removed`);
      else op.state = "done";
    }
    if (!known) {
      if (!op.claim || !op.check) {
        problems.push(t`${id} 是新的一项，claim 与 check 都要写`);
        continue;
      }
    } else if (op.claim === "" || op.check === "") problems.push(t`${id} 的 claim、check 不能改成空的`);
    if (item.root === true || item.root === "true") op.root = true;
    ops.push(op);
  }
  // 同一批里别处仍写旧名的（前提、所属、再改那一项）：照新名认
  const renames = new Map(ops.filter(op => op.rename).map(op => [op.id, /** @type {string} */ (op.rename)])),
    renamed = id => renames.get(id) || id;
  if (renames.size)
    for (const op of ops) {
      if (!op.rename && renames.has(op.id)) op.id = renamed(op.id);
      if (op.needs) op.needs = [...new Set(op.needs.map(renamed))];
      if (op.in) op.in = renamed(op.in);
    }
  // 了结的不再附着，模型看不见就可能撞名：照新立的写法（claim、check 都给）写到了结的一项上，多半不知道它在，改了就把旧事盖了。
  // 只给 id 与要改的字段的是明知而改，不拦
  const past = intentClosed(intent);
  for (const op of ops)
    if (op.claim && op.check && past.has(op.id) && op.claim !== intent.nodes[op.id].claim)
      problems.push(
        t`${op.id} 已有，是了结的一件（${intent.nodes[op.id].claim.slice(0, 60)}）：接着它做的给 state: doing；另一件事换个名字`
      );
  // 折上去试一遍：前提都在、没有环、假定写了出处、不超上限。比「这一批新添的毛病」时，原来那份也先照新名改过，改名本身不算新毛病
  const trial = applyIntentOps(intent, ops),
    base = renames.size
      ? applyIntentOps(
          intent,
          ops.filter(op => op.rename).map(op => ({ id: op.id, rename: op.rename }))
        )
      : intent;
  for (const op of ops)
    for (const need of op.needs || [])
      if (!Object.hasOwn(trial.nodes, need)) problems.push(t`${op.id} 的前提 ${need} 不存在（新的前提与它同一批写上即可）`);
  for (const op of ops) {
    if (!op.remove || trial.nodes[op.id]) continue;
    const inside = Object.keys(trial.nodes).filter(k => trial.nodes[k].in === op.id);
    if (inside.length) problems.push(t`撤 ${op.id} 前，里面的 ${inside.join("、")} 先撤或挪出（同一批写上即可）`);
  }
  const cycle = intentCycle(trial);
  if (cycle)
    problems.push(
      t`前提成了环：${cycle.join(" → ")}${cycle.some((id, i) => i && trial.nodes[id]?.in === cycle[i - 1]) ? t("（模块以里面收口的项为前提）") : ""}`
    );
  // 嵌套的毛病只报这一批新添的：手编出的旧毛病不拦别的改动
  const nested = new Set(intentNestProblems(base));
  problems.push(...intentNestProblems(trial).filter(problem => !nested.has(problem)));
  // 孤悬只报这一批写到的：别的根原先就没标，不拿它拦这一批
  const strays = new Set(intentStrays(base)),
    written = new Set(ops.map(intentOpId));
  for (const id of intentStrays(trial))
    if (!strays.has(id) && written.has(id))
      problems.push(
        t`${id} 孤悬：没有谁以它为前提，也没标根。它撑的是哪一项，就写进那一项的 needs（可跨模块），或归进它所服务的模块（in）；一直要守住的条件标 keep；本就是整件事要立的另一条结论，标 root`
      );
  // 数的是开着的：旧事都了结时再立一项，与新立意是一回事（否则「发吧」这样一句话也成一棵根）。接着做了结的不算新立：写进 needs 的连着它一起开，根改回 doing 的不是新项
  /** @param {Intent} at */
  const alive = at => {
      const closed = intentClosed(at);
      return Object.keys(at.nodes).filter(id => !intentGone(at, id) && !closed.has(id));
    },
    goals = /** @param {Intent} at */ at => alive(at).filter(id => !at.nodes[id].keep),
    lone = goals(trial);
  if (!goals(intent).length && lone.length === 1 && !intent.nodes[lone[0]] && !ops.some(op => op.rename === lone[0]))
    problems.push(
      t`意是几项结论连成的图，只有一项不必立：一答之内做得完的活用不着意。真是跨多答的长活，把它要先立住的几项一并写上（needs 或 in）`
    );
  for (const op of ops) {
    const id = intentOpId(op),
      node = trial.nodes[id];
    if (!node || op.remove) continue;
    if (op.root && intentDependents(trial, id).length)
      problems.push(t`${id} 是 ${intentDependents(trial, id).join("、")} 的前提，不是根：根是没有谁以它为前提的`);
    if (op.state !== "done" || node.keep) continue;
    // 前提照这一批改完的算；此刻取不到指纹，凭据变没变不在此判
    const holds = k => intentEstablished(trial, k),
      written = writtenNeeds(trial, id),
      stuck = [
        ...(node.any && written.length && written.some(holds) ? [] : written.filter(k => !holds(k))),
        ...intentTops(trial, id).filter(k => !holds(k))
      ];
    if (stuck.length)
      problems.push(
        t`${id} 还不能标成立：${stuck.join("、")} 没立住。前提先立住（同一批一起标即可）；这一项自己做完而前提未立的，先标 doing`
      );
  }
  for (const op of ops) {
    const id = intentOpId(op),
      node = trial.nodes[id];
    if (node?.on && !node.keep) problems.push(t`${id} 不是守：on 只给守`);
    if (op.ask && node && !node.on) problems.push(t`${id} 没写 on：ask 是钩子对上时请用户批，先写 on`);
    if (trial.nodes[id]?.state === "assumed" && !trial.nodes[id].note) problems.push(t`${id} 标了假定，note 里写明借的是什么、出处在哪`);
    if (trial.nodes[id]?.state === "waiting" && !trial.nodes[id].note) problems.push(t`${id} 标了待定，note 里写明等谁、定什么`);
  }
  const live = alive(trial).length;
  if (live > INTENT_LIMIT && live > alive(intent).length)
    problems.push(t`意里的项不宜多于 ${INTENT_LIMIT} 项（此刻 ${live}）：一项是值得单独判的结论，不是每一步动作；细的并进上一级`);
  return { ops, problems, tidied: [...tidied] };
}
/**
 * 这一批里要重记凭据的：标成立、标假定的；守改了钩子的也算——钩子挂的测试不记指纹，撤了钩子它就转收尾重查，得先记下一笔「过」才比得出
 * @param {IntentOp} op @param {IntentNode|undefined} node 折上这一批之后的那一项
 */
const intentReseals = (op, node) =>
  !!node && !op.remove && (SEALED.has(op.state || "") || (op.on !== undefined && !!node.keep && SEALED.has(node.state)));
/** 这一批要重记凭据的各项挂的凭据：写之前取一回指纹记下 @param {Intent} intent @param {IntentOp[]} ops */
function intentSealing(intent, ops) {
  const trial = applyIntentOps(intent, ops);
  return [
    ...new Set(
      ops.flatMap(op => {
        const node = trial.nodes[intentOpId(op)];
        return intentReseals(op, node) ? node.anchors.filter(key => !keepHookAnchor(node, key)) : [];
      })
    )
  ];
}
/**
 * 把一批改动折上去，得一份新的（不动原来那份）。先改说法与结构，最后才给标成立的各项记凭据：同一批里前提改了说法，记的是改后的
 * @param {Intent} intent
 * @param {IntentOp[]} ops
 * @param {{ at?: string, conversation?: string, ask?: string, prints?: IntentPrints }} [context] ask：这一问用户的原话（立根、改根时记下）
 * @returns {Intent}
 */
function applyIntentOps(intent, ops, { at = "", conversation = "", ask = "", prints = {} } = {}) {
  /** @type {Intent} */
  const next = structuredClone(intent),
    log = text => next.log.push({ at, conversation, text });
  for (const op of ops) {
    if (op.remove) {
      if (!next.nodes[op.id]) continue;
      log(`撤 ${op.id}：${next.nodes[op.id].claim}`);
      delete next.nodes[op.id];
      for (const other of Object.values(next.nodes)) other.needs = other.needs.filter(k => k !== op.id);
      continue;
    }
    if (op.rename && next.nodes[op.id] && !next.nodes[op.rename]) {
      renameIntentNode(next, op.id, op.rename);
      log(`改名 ${op.id} → ${op.rename}`);
    }
    const id = op.rename && next.nodes[op.rename] ? op.rename : op.id;
    let node = next.nodes[id];
    if (!node) {
      if (!op.claim) continue;
      node = next.nodes[id] = { claim: "", check: "", needs: [], anchors: [], state: "open", rev: 0 };
      // 守也记下原问：「往后收尾前都跑测试」这句话本身就是它的依据
      if (op.root || op.keep) node.root = { ask: String(ask).slice(0, 2000), at };
    } else if (op.root && !node.root) {
      // 补标的根：记下的是补标这一问——当初那一问已不在手边，这一问正是看清它是根的时候
      node.root = { ask: String(ask).slice(0, 2000), at };
      log(`立根 ${id}：${node.claim}`);
    }
    const before = `${node.claim}\u0001${node.check}\u0001${node.when || ""}`;
    for (const key of /** @type {const} */ (["claim", "check", "when", "note"])) if (op[key] !== undefined) node[key] = op[key];
    if (op.any !== undefined) node.any = op.any;
    if (op.keep !== undefined) {
      if (op.keep) node.keep = true;
      else delete node.keep;
    }
    if (op.on !== undefined) {
      if (op.on) node.on = op.on;
      else delete node.on;
    }
    // 撤了钩子，关口随之撤
    if (op.ask && node.on) node.ask = true;
    else if (op.ask !== undefined || !node.on) delete node.ask;
    if (op.needs) node.needs = op.needs;
    if (op.in !== undefined && op.in !== (node.in || "")) {
      if (node.rev) log(`${id} 归入${op.in ? `「${op.in}」` : "全局"}`);
      if (op.in) node.in = op.in;
      else delete node.in;
    }
    if (op.anchors) {
      // 旧版凭据没有清单：改之前补上原清单，换了凭据也须重新复核。
      if (node.seal && !node.seal.anchors) node.seal.anchors = [...node.anchors];
      node.anchors = op.anchors;
    }
    if (`${node.claim}\u0001${node.check}\u0001${node.when || ""}` !== before) {
      // 根：立时标过、此刻也没有谁以它为前提的（降成别项前提的不再算根，原问留着，哪天又成了根再用）
      const rooted = !!node.root && !intentDependents(next, id).length;
      if (node.rev) log(`${rooted ? "改根" : "改意"} ${id}：${node.claim}`);
      // 根改了说法：记下这一问，与原问一起附着，收尾时照着比
      if (node.rev && rooted && ask) node.root.later = String(ask).slice(0, 2000);
      node.rev += 1;
    }
    if (op.state && op.state !== node.state) {
      if (op.state === "dropped" || op.state === "assumed" || op.state === "waiting")
        log(
          `${{ dropped: "弃", assumed: "假定", waiting: "待定" }[op.state]} ${id}${op.state !== "dropped" && node.note ? `：${node.note}` : ""}`
        );
      if (node.state === "dropped") log(`复立 ${id}`);
    }
    if (op.state) node.state = op.state;
    if (!SEALED.has(node.state)) delete node.seal;
  }
  for (const op of ops) {
    const id = op.rename && next.nodes[op.rename] ? op.rename : op.id,
      node = next.nodes[id];
    if (!intentReseals(op, node)) continue;
    // 取不到指纹的凭据（探针这回没跑）不记：日后也不据它判
    node.seal = {
      rev: node.rev,
      anchors: [...node.anchors],
      premises: node.state === "done" ? Object.fromEntries(liveNeeds(next, id).map(need => [need, next.nodes[need].rev])) : {},
      prints: Object.fromEntries(node.anchors.filter(key => key in prints).map(key => [key, prints[key]]))
    };
  }
  next.log = next.log.slice(-INTENT_LOG_LIMIT);
  if (at && ops.length) next.updated = at;
  return next;
}
// ---------- 写成给模型读的字：每一问附着的、改完回给它的，都经这里 ----------
const INTENT_STATE_TEXT = {
  open: t("未做"),
  doing: t("进行中"),
  waiting: t("待定"),
  done: t("成立"),
  assumed: t("假定"),
  dropped: t("已弃"),
  stale: t("待复核")
};
/** 进度只数开着的目标，守、了结的不算 @param {Intent} intent @param {IntentPrints} [now] @param {Set<string>} [closed] */
function intentTally(intent, now = {}, closed = intentClosed(intent)) {
  const live = Object.keys(intent.nodes).filter(id => !intent.nodes[id].keep && !intentGone(intent, id) && !closed.has(id));
  return { live: live.length, standing: live.filter(id => intentEstablished(intent, id, now)).length };
}
/**
 * 根在前、前提在后；立住了的只留一行，没立住的写验收与缘由，没立住的根附上用户的原话。
 * 模块的细项缩进写在它底下；里面都立住了的模块只留一行，没立住的才展开——长活里看到的是整副骨架加手头那一块
 * @param {Intent} intent @param {IntentPrints} [now]
 * @param {{ path?: string, asks?: boolean, closed?: Set<string> }} [options] asks：立住了的根也附原话（收尾前对照用）；closed：作答途中传这一答眼里了结的
 */
function intentText(intent, now = {}, { path = t(".yan/意.json"), asks = false, closed = intentClosed(intent) } = {}) {
  const order = intentOrder(intent)
      .reverse()
      .filter(id => !intent.nodes[id].keep && !intentGone(intent, id) && !closed.has(id)),
    keeps = intentKeeps(intent, closed),
    roots = new Set(intentRoots(intent)),
    strays = new Set(intentStrays(intent, closed));
  if (!order.length && !keeps.length) return "";
  const { live, standing } = intentTally(intent, now, closed),
    dropped = Object.keys(intent.nodes).filter(id => intent.nodes[id].state === "dropped" && !closed.has(intent.nodes[id].in)),
    // 开着的一项可以落在了结的模块里（新事依了它里面的一步）：模块不写了，它提到全局写，不能漏
    shelf = id => (order.includes(intent.nodes[id].in) ? intent.nodes[id].in : "");
  /** @param {string} id @param {string} pad @returns {string[]} */
  const item = (id, pad) => {
    const node = intent.nodes[id],
      state = intentState(intent, id, now),
      established = intentEstablished(intent, id, now),
      tag = state === "done" && !established ? t("成立·前提未立") : INTENT_STATE_TEXT[state],
      premises = writtenNeeds(intent, id),
      kids = intentChildren(intent, id),
      inside = kids.filter(k => intentEstablished(intent, k, now)).length,
      folded = kids.length && inside === kids.length,
      borrowed = roots.has(id) && established ? intentBorrowed(intent, id).filter(b => b !== id) : [],
      head = `${pad}- [${tag}] ${id}${strays.has(id) ? t("（孤悬）") : roots.has(id) ? t("（根）") : ""}${kids.length ? t`（模块，${folded ? t`内 ${kids.length} 项都已立` : t`内已立 ${inside} / ${kids.length}`}）` : ""}：${node.claim}${node.when ? t`（情形：${node.when}）` : ""}${premises.length ? t`（前提：${premises.join("、")}${node.any ? t("，任一即可") : ""}）` : ""}${borrowed.length ? t`（借假定：${borrowed.join("、")}）` : ""}`;
    // 原问只随此刻的根附：立时标了根、后来成了别项前提的，不再附
    const said = roots.has(id) ? node.root : undefined,
      ask = [
        ...(said?.ask ? [t`${pad}  原问：${said.ask.slice(0, asks ? 600 : 200)}`] : []),
        ...(said?.later ? [t`${pad}  改根时：${said.later.slice(0, asks ? 600 : 200)}`] : [])
      ];
    const inner = folded ? [] : level(id, `${pad}  `);
    if (state === "assumed") return [head, t`${pad}  出处：${node.note || ""}`, ...(asks ? ask : []), ...inner];
    if (established) return [head, ...(asks ? ask : []), ...inner];
    const more = [...(state === "waiting" ? [t`${pad}  待定：${node.note || ""}`] : []), t`${pad}  验收：${node.check}`];
    if (state === "stale") more.push(t`${pad}  缘由：${intentStaleWhy(intent, id, now)}`);
    return [head, ...more, ...ask, ...inner];
  };
  /** @param {string} parent @param {string} pad */
  const level = (parent, pad) => order.filter(id => shelf(id) === parent).flatMap(id => item(id, pad));
  // 守：常驻的约束，没有态——平常只一行，测试不过、凭据变了的写验收与缘由；原问只在收尾前对照时附
  const kept = keeps.flatMap(id => {
    const node = intent.nodes[id],
      state = intentState(intent, id, now),
      head = `- ${state === "stale" ? `[${INTENT_STATE_TEXT.stale}] ` : ""}${id}：${node.claim}${node.when ? t`（情形：${node.when}）` : ""}${node.on ? `（${keepHookText(node)}：/${node.on}/）` : ""}`,
      ask = asks && node.root?.ask ? [t`  原问：${node.root.ask.slice(0, 600)}`] : [];
    if (state !== "stale") return [head, ...ask];
    return [head, t`  验收：${node.check}`, ...(state === "stale" ? [t`  缘由：${intentStaleWhy(intent, id, now)}`] : []), ...ask];
  });
  return [
    `${live ? t`［意 ${path}］已立 ${standing} / ${live}` : `［意 ${path}］`}${dropped.length ? t`，已弃（走过不通的）：${dropped.join("、")}` : ""}`,
    ...level("", ""),
    ...(kept.length ? [t("守（常驻的约束）："), ...kept] : [])
  ].join("\n");
}
// ---------- 一答之内的回归：每轮工具做完重取指纹，新转待复核的当场告诉它；同一项来回被打回即相持，只提醒 ----------
// 相持：修甲坏乙、修乙坏甲，每一步单看都对，合起来原地打转——程序不拦（兼顾两头的修法可能就在下一步），只把次数与牵连摆出来
const INTENT_STALEMATE = 3;
/** 此刻待复核的各项；了结的不算 @param {Intent} intent @param {IntentPrints} now @param {Set<string>} [closed] */
function intentStaleIds(intent, now, closed = intentClosed(intent)) {
  return Object.keys(intent.nodes).filter(id => !closed.has(id) && intentState(intent, id, now) === "stale");
}
/**
 * 这一轮之后新转待复核的几项，写成接在工具结果后的一段；没有即空
 * @param {Intent} intent @param {IntentPrints} now @param {string[]} fresh 这一轮新转待复核的 @param {Map<string, number>} bounces 这一答里各项被打回几回（已含这一轮）
 */
function intentRoundText(intent, now, fresh, bounces) {
  if (!fresh.length) return "";
  const lines = [t`［意］此轮之后转待复核：${fresh.map(id => `${id}（${intentStaleWhy(intent, id, now)}）`).join("、")}`];
  for (const id of fresh) {
    const times = bounces.get(id) || 0;
    if (times < INTENT_STALEMATE) continue;
    const mine = intent.nodes[id].anchors,
      partners = Object.keys(intent.nodes)
        .filter(other => other !== id && bounces.get(other) && intent.nodes[other].anchors.some(key => mine.includes(key)))
        .map(other => {
          const shared = intent.nodes[other].anchors.filter(key => mine.includes(key));
          return t`同依托 ${shared.slice(0, 3).map(anchorLabel).join("、")} 的 ${other} 被打回 ${bounces.get(other)} 回`;
        });
    lines.push(t`相持：${id} 本答内第 ${times} 回转待复核${partners.length ? `；${partners.join("；")}` : ""}`);
  }
  return lines.join("\n");
}
