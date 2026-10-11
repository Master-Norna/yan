// 言 · 纲 · 收尾的闸：模型说完了、不再调工具，这一答本该就此收尾。它动过纲的话，先查一遍它负责的那几个根立住了没有——
// 干久了力不从心、提前收工，或修一处坏一处，都在这里截住：
//   1. 这几个根底下自称成立却没判的、判词作废了的（前提改了、看过的文件又被改了），先请验的人复验——回归由此查出；
//   2. 都立住了，放行；
//   3. 没立住，把缺口（哪项不成立、差在哪，哪项待复验、为何，哪项还没做）作为一句话递给它接着做。这句话记作行迹里的一步，
//      带 replay：续写、下一问重装这一答时照原处插回（见 answerParts）。递上之后若上下文已过半，先撮要再接着做——回血，
//      纲本身就是最要紧的那份状态，撮掉的往来不碍事；
//   4. 不空转：两回之间一项也没新立住，放行（上一回已请它卡住了就说明缺什么）；拦满 GRAPH_GATES 回仍没立住，最后递一句
//      请它如实交代哪些没立住、不再调工具，就此收尾。
// 只拦主答：帮手、旁注不动纲；中途问一句无关的话，它没动纲，也就不拦——只对这一答动过的那几项所在的根负责
const GRAPH_GATES = 3;
/**
 * @param {{ conversation: Conversation, assistant: Message, signal: AbortSignal, profile: Profile, onStatus?: (label?: string) => void }} run
 * @returns {Promise<{ entry: Record<string, any>, final: boolean }|null>} 要递的话；null 即放行
 */
async function graphGate({ conversation, assistant, signal, profile, onStatus = () => {} }) {
  const gates = (assistant.steps || []).filter(step => step.name === "graph_gate");
  if (gates.at(-1)?.gate?.final) return null;
  let graph = graphOf(conversation.messages);
  const touched = [...graph.nodes.values()].filter(node => node.touched === assistant.id).map(node => node.id);
  if (!touched.length) return null;
  const recheck = [...graphBelow(graph, rootsAbove(graph, touched))]
    .map(id => graph.nodes.get(id))
    .filter(node => ["claimed", "stale"].includes(nodeState(graph, node)));
  if (recheck.length) {
    onStatus("收尾前复验");
    try {
      await checkNodes(
        recheck.map(node => node.id),
        { conversation, assistant, signal },
        profile
      );
    } finally {
      onStatus();
    }
    graph = graphOf(conversation.messages);
  }
  const roots = rootsAbove(graph, touched),
    open = roots.filter(root => !nodeEstablished(graph, root));
  if (!open.length) return null;
  const standing = [...graphBelow(graph, roots)].filter(id => nodeEstablished(graph, graph.nodes.get(id))).length,
    last = gates.at(-1);
  if (last && standing <= Number(last.gate?.standing || 0)) return null;
  const final = gates.length >= GRAPH_GATES,
    text = graphText(graph, { roots: open }),
    report = prompt(final ? "graph.gateFinal" : "graph.gate", { graph: text }),
    left = [...graphBelow(graph, open)].filter(id => !nodeEstablished(graph, graph.nodes.get(id))).length;
  /** @type {Step} */
  const step = {
    id: `gate_${uid().slice(0, 8)}`,
    name: "graph_gate",
    arguments: "{}",
    status: "done",
    title: final ? "收尾" : "接着做",
    note: final ? `还有 ${left} 项没立住，请它如实交代后收尾` : `还有 ${left} 项没立住，接着做`,
    result: `立住 ${standing}`,
    at: String(assistant.content || "").length,
    rat: String(assistant.reasoning || "").length,
    report,
    gate: { standing, final }
  };
  (assistant.steps ||= []).push(step);
  refreshSteps(assistant);
  saveStore();
  return { entry: { role: "user", content: report }, final };
}
// 每一问附着的纲：近几答里动过、还没立住的那几个根。与账本同一个位置（这一问的末段，缓存点之后），每问现算。
// 早就撂下、几答没碰的活不再附：用户转去问别的了，不该每问都背着它
const GRAPH_NOTE_RECENT = 3;
/** @param {Message[]} messages 这一问之前的往来（不必是压缩之后的：图跨压缩，一直从整段对话折） */
function graphNote(messages) {
  const graph = graphOf(messages);
  if (!graph.nodes.size) return "";
  const recent = new Set(
      messages
        .filter(m => m.role === "assistant")
        .slice(-GRAPH_NOTE_RECENT)
        .map(m => m.id)
    ),
    touched = [...graph.nodes.values()].filter(node => recent.has(node.touched)).map(node => node.id),
    open = rootsAbove(graph, touched).filter(root => !nodeEstablished(graph, root));
  if (!open.length) return "";
  return `${graphText(graph, { roots: open })}\n\n`;
}
