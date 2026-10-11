// 言 · 纲 · 验：一项自称成立了，另请一位验的人来判——同一个模型、干净的上下文、只读。
// 它看用户的原话、这一项的说法与验收、各前提的说法（不看前提是怎么做的）、做的人交的证据，自己去读文件、跑检验，
// 最后用 verdict 交判词。做的人的那份上下文跑了几百轮早已疲惫，拿它给自己打分，就是让累的人给自己判卷。
// 验的人与帮手同一个样子：一趟自己的对话，步骤画在派它的那一答的签里，点开即差遣面板里它的那条时间线
// 正在验的几趟：verdict 那件工具凭它所在的一趟（step.scope）找到自己该把判词交给谁
/** @type {Map<string, { verdict: { holds: boolean, gap: string, files: string[] }|null }>} */
const auditing = new Map();
/**
 * 验这几项：每项在这一答的行迹里起一枚「验」签，几项同时验，判词记在签上（graphOf 据此折）
 * @param {string[]} ids
 * @param {ToolContext} ctx
 * @param {Profile|null} profile
 * @returns {Promise<Array<{ id: string, verdict: GraphVerdict|null, problem?: string }>>}
 */
async function checkNodes(ids, ctx, profile) {
  const { conversation, assistant } = ctx;
  if (!profile) return ids.map(id => ({ id, verdict: null, problem: "没有可用的模型" }));
  const steps = ids.map(id => {
    /** @type {Step} */
    const step = {
      id: `chk_${uid().slice(0, 8)}`,
      name: "graph_check",
      arguments: "{}",
      status: "running",
      title: id,
      at: String(assistant.content || "").length,
      rat: String(assistant.reasoning || "").length
    };
    (assistant.steps ||= []).push(step);
    return step;
  });
  refreshSteps(assistant);
  return Promise.all(
    steps.map(async (step, i) => {
      const id = ids[i];
      try {
        const verdict = await runCheck(step, id, ctx, profile);
        step.status = verdict ? "done" : "error";
        step.result = verdict ? (verdict.holds ? "成立" : "不成立") : step.result || "未判";
        return { id, verdict, ...(verdict ? {} : { problem: step.result }) };
      } catch (error) {
        step.status = "error";
        step.result = error.name === "AbortError" ? "已停止" : friendlyError(String(error.message || error));
        if (error.name === "AbortError") throw error;
        return { id, verdict: null, problem: step.result };
      } finally {
        refreshSteps(assistant);
        markDirty(conversation.id);
        saveStore();
      }
    })
  );
}
// 用户的原话：这一项起于哪一答，那一答之前用户的那一问——锚住目标，免得一路转述下来走了样
/** @param {Conversation} conversation @param {string} messageId */
function askBefore(conversation, messageId) {
  const at = conversation.messages.findIndex(m => m.id === messageId),
    before = (at < 0 ? conversation.messages : conversation.messages.slice(0, at)).findLast(m => m.role === "user");
  return before ? quotedText(before).slice(0, 4000) : "";
}
/** 验的人领到的那份说明 @param {Conversation} conversation @param {Graph} graph @param {GraphNode} node */
function checkBrief(conversation, graph, node) {
  const premises = node.needs
      .map(id => graph.nodes.get(id))
      .filter(p => p && p.mark !== "dropped")
      .map(p => `- ${p.id}：${p.claim}${p.when ? `（情形：${p.when}）` : ""}`),
    ask = askBefore(conversation, node.origin);
  return [
    ask && prompt("graph.briefAsk", { ask }),
    prompt("graph.briefNode", { id: node.id, claim: node.claim, when: node.when ? `（情形：${node.when}）` : "", check: node.check }),
    premises.length && prompt(node.any ? "graph.briefPremisesAny" : "graph.briefPremises", { list: premises.join("\n") }),
    node.evidence && prompt("graph.briefEvidence", { evidence: node.evidence }),
    node.files.length && prompt("graph.briefFiles", { files: node.files.join("、") })
  ]
    .filter(Boolean)
    .join("\n\n");
}
/**
 * 一趟验：与帮手同一个轮次循环，工具只给只读的几件与 verdict
 * @param {Step} step 那枚「验」签
 * @param {string} id
 * @param {ToolContext} ctx
 * @param {Profile} profile
 * @returns {Promise<GraphVerdict|null>}
 */
async function runCheck(step, id, ctx, profile) {
  const { conversation, assistant, signal } = ctx,
    graph = graphOf(conversation.messages),
    node = graph.nodes.get(id);
  if (!node) {
    step.result = "没有这一项";
    return null;
  }
  const tools = toolDefinitions(conversation, { sub: true, audit: true, profile });
  if (!tools) {
    step.result = "无工具可用";
    return null;
  }
  await loadLedger(conversation, signal);
  signal?.throwIfAborted();
  const brief = checkBrief(conversation, graph, node),
    subId = `chk-${uid()}`;
  /** @type {SubAgent} */
  const sub = { id: subId, task: brief, content: "", reasoning: "", steps: [], status: "streaming", usage: null };
  step.sub = sub;
  step.title = `${node.id}：${node.claim}`.slice(0, 60);
  const history = [{ role: "user", content: `${ledgerNote(conversation, "sub", profile)}${brief}` }],
    overrides = {
      systemPrompt: systemPrompt(conversation, tools, { role: "audit" }),
      tools,
      reasoning: conversation.reasoning || "",
      head: history.length,
      onFold: () => refreshSteps(assistant)
    },
    box = { verdict: null },
    tally = newTally(),
    started = performance.now();
  auditing.set(subId, box);
  sub.startedAt = Date.now();
  const ticker = setInterval(() => refreshSteps(assistant), 500);
  try {
    await runRounds(sub, history, {
      profile,
      conversation,
      host: assistant,
      signal,
      overrides,
      tally,
      roundLimit: subRoundLimit(),
      scope: subId
    });
    sub.status = "complete";
  } catch (error) {
    sub.status = error.name === "AbortError" ? "stopped" : "error";
    settleStepList(sub.steps, sub.status === "stopped" ? "已停止" : "已中断");
    if (error.name === "AbortError") throw error;
    step.result = friendlyError(String(error.message || error));
  } finally {
    clearInterval(ticker);
    auditing.delete(subId);
    sub.usage = tally.usageKnown ? tally.usage : null;
    sub.durationMs = Math.round(performance.now() - started);
    delete sub.startedAt;
    const lead = trimReply(sub);
    sub.report = sub.content.slice(Math.max(0, tally.replyStart - lead)).trim();
  }
  if (sub.status !== "complete") return null;
  // 没交判词就收了工：它最后说的话当缺口，按不成立记——说不清成立，就是没验住
  const said = box.verdict || { holds: false, gap: sub.report.slice(0, 1200) || "验的人没有交判词", files: [] };
  // 验时各相关文件已被改过几回：此后再改，这份判词即作废（见 staleReason）。前提只记还在的
  const now = graphOf(conversation.messages),
    files = [...new Set([...node.files, ...said.files])],
    seen = Object.fromEntries(files.map(path => [path, now.changes.get(path) || 0]));
  /** @type {GraphVerdict} */
  const verdict = {
    node: node.id,
    holds: said.holds,
    gap: said.gap,
    version: nodeVersion(node),
    premises: Object.fromEntries(
      node.needs
        .map(need => graph.nodes.get(need))
        .filter(p => p && p.mark !== "dropped")
        .map(p => [p.id, nodeVersion(p)])
    ),
    seen,
    files: said.files
  };
  step.verdict = verdict;
  return verdict;
}
/** 判词写成给做的人读的一行 @param {{ id: string, verdict: GraphVerdict|null, problem?: string }} result */
function verdictLine(result) {
  if (!result.verdict) return prompt("graph.unchecked", { id: result.id, reason: result.problem || "未判" });
  return result.verdict.holds
    ? prompt("graph.held", { id: result.id })
    : prompt("graph.failed", { id: result.id, gap: result.verdict.gap || "（未写缘由）" });
}
