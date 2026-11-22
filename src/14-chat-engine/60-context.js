// 言 · 对话引擎 · 上下文：两答之间压缩前文为摘要，一答之内压工具往来为工作笔记，接口说放不下时从报错里学窗口
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 压缩：把上次压缩以来的往来压成一份摘要，记在新的分隔上；此后的请求只带摘要与之后的消息 ----------
// 分隔（role: "context"）带 summary 的是压缩；不带的是旧版「另起一纸」留下的硬切，仍照旧生效
// 正在压缩的对话：只在内存里记，页面上画一行「正在压缩」
const compactingIds = new Set();
// before：作答途中压前文（见 keepInWindow）——只取这一问之前的，这一问与正在写的答原样留在分隔之后
/** @param {Conversation} c */
function compactable(c, before = null) {
  if (!c || (!before && (conversationRunning(c.id) || runningElsewhere(c.id)))) return [];
  const contextIndex = lastContextIndex(c.messages),
    until = before ? c.messages.indexOf(before) : c.messages.length;
  return c.messages
    .slice(contextIndex + 1, Math.max(contextIndex + 1, until))
    .filter(m => m.status !== "error" && m.status !== "streaming" && ["user", "assistant"].includes(m.role));
}
/** @param {Conversation} c */
async function compactContext(c, { auto = false, before = null, profile = activeProfile(), signal = null } = {}) {
  const source = compactable(c, before);
  if (source.filter(m => m.role === "user").length < (before ? 1 : 2)) {
    if (!auto) toast(t("对话还短，不必压缩"));
    return false;
  }
  if (!profile || quotaExhausted(profile)) {
    if (!auto) toast(t("没有可用的模型"));
    return false;
  }
  if (compactingIds.has(c.id)) {
    if (!auto) toast(t("正在撮要"));
    return false;
  }
  // 摘要先在外面生成，成了再一次性插进分隔（生成期间只有页面上一行「正在压缩」，不进消息、不落盘）：
  // 中途关页面不会留下半成品分隔把历史截掉；期间用户接着发的消息也不受影响——分隔插在被压缩的最后一条之后，之后的消息照旧在分隔之后
  const lastCompacted = source.at(-1),
    // 上一份摘要是更早前文的唯一留存：一并喂进去，新摘要才是累积的，不然再压一回早期前文就整个没了
    from = c.messages.indexOf(source[0]),
    earlier = c.messages.findLast((m, i) => i < from && m.role === "context")?.summary;
  compactingIds.add(c.id);
  renderConversation();
  try {
    // 途中递进来的补言、回报按到达的位置排进这一答（见 answerParts），摘要才分得清先后；问里的引文照送给模型的样子，附件记个名
    const clip = text => String(text || "").slice(0, 6000),
      attached = m => (m.attachments?.length ? t`（附件：${m.attachments.map(file => file.name).join("、")}）` : ""),
      transcript = (
        await Promise.all(
          source.map(async m =>
            m.role === "user"
              ? [t`用户：${clip(quotedText(m))}${attached(m)}`]
              : [
                  ...(await answerForApi(m)).map(entry =>
                    entry.role === "user" ? t`途中递来：${clip(entryText(entry))}` : t`助手：${clip(entry.content)}`
                  ),
                  stepsDigest(m)
                ].filter(Boolean)
          )
        )
      ).flat();
    if (earlier) transcript.unshift(t`更早的前文（上一份摘要）：${earlier}`);
    // 转写可能很长、模型可能先思考再写：超时给足五分钟。这段对话开了思考档位的，压缩时降到最低一档：摘要用不着深想
    const timeout = AbortSignal.timeout(300000),
      summary = await summarize(
        profile,
        prompt("assistant.compact", { transcript: transcript.join("\n\n") }),
        signal ? AbortSignal.any([signal, timeout]) : timeout,
        c.reasoning
      );
    const at = c.messages.indexOf(lastCompacted);
    if (at < 0) throw Error("对话在压缩期间已改动");
    // 期间又压过一次（分隔已在这条之后）就作废，以后来的为准
    if (c.messages.slice(at + 1).some(m => m.role === "context")) throw Error("对话在压缩期间已改动");
    /** @type {Message} */
    const marker = { id: uid(), role: "context", content: "", timestamp: now(), summary, compacted: source.length };
    c.messages.splice(at + 1, 0, marker);
    c.updatedAt = now();
    saveStore();
    compactingIds.delete(c.id);
    renderConversation();
    toast(auto ? t("上下文已重，前文已自动撮要") : t("前文已撮要"));
    return true;
  } catch (error) {
    compactingIds.delete(c.id);
    renderConversation();
    // 作答途中压的，用户点了停止：不必再说压缩失败
    if (signal?.aborted) return false;
    console.warn("压缩失败", error);
    const reason = error?.name === "TimeoutError" ? t("模型五分钟内未写出撮要") : friendlyError(String(error?.message || error));
    toast(t`撮要未成：${reason.slice(0, 80)}`);
    return false;
  } finally {
    compactingIds.delete(c.id);
  }
}
// 请模型把一段文字压成摘要：前文压缩与轮内压缩共用。不带系统提示；输出上限不另给，随平时的走；花的墨记在模型上
/** @param {Profile} profile */
async function summarize(profile, ask, signal, reasoning = "") {
  const response = await requestPatiently(profile, [{ role: "user", content: ask }], signal, {
    systemPrompt: "",
    reasoning: reasoning ? "low" : ""
  });
  if (!response.ok) throw Error(await describeResponseError(response));
  const temp = await readAside(response, profile, ask);
  const text = String(temp.content || ""),
    summary = (parseInlineThink(text)?.content ?? text).trim();
  if (!summary) throw Error(temp.reasoning ? t("模型只写了思考、没写出撮要（输出被上限截断）") : t("模型没有写出撮要"));
  return summary;
}
// 分隔上的摘要进历史：一问一答的样子，各家接口都认（说法见 prompts/assistant.js 的 summary）
/** @returns {Array<Record<string, any>>} */
function summaryMessages(marker) {
  if (!marker?.summary) return [];
  return [
    { role: "user", content: prompt("assistant.summary", { summary: marker.summary }) },
    { role: "assistant", content: prompt("assistant.summaryAck") }
  ];
}
// 一答收尾后：下一问估算已过这个模型窗口的七成半，就趁用户读、写的工夫把前文压成摘要。
// 没填窗口的不猜：等接口回说放不下，作答途中再压（见 keepInWindow）
/**
 * @param {Conversation} c
 * @param {Profile} profile
 */
function maybeAutoCompact(c, profile) {
  const window = Number(profile?.contextWindow) || 0;
  if (!window || !c || contextEstimate(c) < window * 0.75) return;
  void compactContext(c, { auto: true, profile });
}
// ---------- 轮内压缩：一答之内工具轮次叠得太长时，把较早的往来压成一份工作笔记，只留最近几轮原样 ----------
// 上面的压缩只在两答之间动手；长活（执事连跑几百轮、帮手审一整个仓库）在一答之内就能把窗口撑破，接口回一句放不下，整段活就白做了。
// 主答、旁注、帮手三条工具循环都经 readReply 发请求，所以在那里一并接上：overrides.head 记这一答自己的往来从 history 哪一格起，
// 之前的（对话历史、任务说明）原样保留。两个时机：送出前估算已过窗口的七成半（填了上下文窗口才有）；接口回说放不下（没填窗口也接得住）。
// 这两处是兜底：执事与帮手可在做完一段时自己撮（见下面的 foldByModel），笔记落在它选的节点上，往往等不到七成半
// 这一答还没有可压的往来（刚开口，放不下的是前面的对话本身）：主答给了 compactHead 的，把这一问之前的对话压成摘要，与右下角「压缩前文」同一份，一答只压一回
const FOLD_KEEP_ROUNDS = 2;
// 各家接口「放不下」的说法：OpenAI 系 maximum context length、Anthropic prompt is too long / exceed context limit、
// Gemini exceeds the maximum number of tokens、Qwen Range of input length、Kimi token limit、GLM exceeds max length……
// 输出上限（max_tokens）太大、上游超时（context deadline exceeded）不算。vLLM 的说法两样都列（you requested 0 output tokens and
// your prompt contains at least 32769 input tokens）：要的输出本身放得进窗口，就是输入太长、压了有用；输出一项就超窗口才是 max_tokens 给大了。
// 自建服务前头的网关另有写法（Input 86713 tokens + requested output 16384 + safety margin 256 exceeds context 98304），同样两样都列，同样判
function contextOverflow(message) {
  const text = String(message || "");
  if (
    !/context.{0,24}(length|window|limit|size)|prompt is too long|too many tokens|token.{0,20}limit|exceed.{0,40}(limit|length|tokens|context)|input.{0,20}(too long|length)|上下文.{0,8}(长度|窗口|上限|超)|超出.{0,12}(上下文|长度|限制)|超长/i.test(
      text
    ) ||
    /deadline|max_completion/i.test(text)
  )
    return false;
  if (!/output tokens?|requested output/i.test(text)) return true;
  const limit = reportedWindow(text),
    output = Number(text.match(/(\d+) output tokens?/i)?.[1] || text.match(/requested output (\d+)/i)?.[1]);
  return /input (\d+ )?tokens?/i.test(text) && limit > 0 && output < limit;
}
// 报错里说的窗口多大：context length is 32768（vLLM 原话）、exceeds context 98304（网关的写法）、210000 tokens > 200000 maximum（Anthropic）
const reportedWindow = text => {
  const m = String(text || "").match(
    /context length is (\d+)|exceeds? (?:the )?context (?:window |length )?(?:of )?(\d+)|tokens? > (\d+) maximum/i
  );
  return Number(m?.[1] || m?.[2] || m?.[3]) || 0;
};
// 报错里说了窗口多大而模型上没填：记下来，此后送出前就按它提前压，不必每回先撞一次放不下
/** @param {Profile} profile */
function learnContextWindow(profile, message) {
  const limit = reportedWindow(message);
  if (Number(profile.contextWindow) > 0 || !(limit >= 1000)) return;
  profile.contextWindow = limit;
  saveStoreSoon();
}
// 下一次请求约有多大：上一轮接口报了实际的提示用量就以它为底，只估此后新添的；没报就整份估（连同系统提示与工具定义）
function requestSize(history, overrides) {
  const seen = overrides.seen;
  if (seen && seen.at <= history.length) return seen.tokens + estimateTokens(history.slice(seen.at));
  return (
    estimateTokens(history) +
    estimateText(String(overrides.systemPrompt || "")) +
    (overrides.tools ? estimateText(JSON.stringify(overrides.tools)) : 0)
  );
}
const plainContent = content =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map(part => part?.text || "").join("\n") : "";
// 往来的转写：工具结果与调用参数按预算逐级截短，仍放不下就从最早的删起（上一份笔记留着）
function foldTranscript(region, budget) {
  const clip = (text, n) => (text.length > n ? t`${text.slice(0, n)}…（余 ${text.length - n} 字略）` : text);
  let lines = [];
  for (const limit of [2000, 800, 300]) {
    lines = region.map(m => {
      if (m.role === "tool") return t`结果：${clip(plainContent(m.content), limit)}`;
      if (m.role === "user") return t`用户：${clip(plainContent(m.content), 4000)}`;
      const said = plainContent(m.content).trim();
      return [
        said && t`你：${clip(said, 4000)}`,
        ...(m.tool_calls || []).map(c => t`调用 ${c.function?.name}：${clip(String(c.function?.arguments || ""), limit / 4)}`)
      ]
        .filter(Boolean)
        .join("\n");
    });
    if (estimateText(lines.join("\n\n")) <= budget) return lines.join("\n\n");
  }
  let total = estimateText(lines.join("\n\n"));
  for (let i = 0; i < lines.length && total > budget; i++) {
    if (lines[i].startsWith("你：［工作笔记］")) continue;
    total -= estimateText(lines[i]);
    lines[i] = "";
  }
  return lines.filter(Boolean).join("\n\n");
}
// 撮要在行迹里记作一步（不是工具，画法登记在 15-tools/51-fold.js）：落在它发生的那一刻，正撮着转圈、撮完一勾，点开是笔记——
// 模型此后只凭笔记做事，看行迹的人得知道。拟题、压缩这些临时对象不走这里（它们没有 head）
/** @param {Message|SubAgent|null} target @param {NonNullable<Step["fold"]>} fold */
function foldMark(target, fold) {
  if (!target) return null;
  /** @type {Step} */
  const step = {
    id: `fold_${uid().slice(0, 8)}`,
    name: "fold",
    arguments: "{}",
    status: "running",
    at: String(target.content || "").length,
    rat: String(target.reasoning || "").length,
    fold
  };
  (target.steps ||= []).push(step);
  return step;
}
// 撮要没成事（前文太短不必压、压前文失败另有提示）：那一步撤下，不留痕
function dropFoldMark(target, step) {
  if (!target?.steps || !step) return;
  target.steps = target.steps.filter(s => s !== step);
  if (!target.steps.length) delete target.steps;
}
// 被撮的往来有多少字：说的话、工具结果与调用参数
const regionChars = region =>
  region.reduce(
    (n, m) => n + plainContent(m.content).length + (m.tool_calls || []).reduce((k, c) => k + String(c.function?.arguments || "").length, 0),
    0
  );
/**
 * 需要时把 history 里这一答较早的往来压成笔记（就地改 history），压了返回 true
 * @param {Profile} profile
 * @param {Array<Record<string, any>>} history
 * @param {Record<string, any>} overrides 读 head、systemPrompt、tools、reasoning、onFold、compactHead；seen 由 readReply 记下
 * 末一个参数里 target 是撮要那一步记在谁的行迹上（主答、帮手）
 */
async function keepInWindow(profile, history, signal, overrides, { overflow = false, target = null } = {}) {
  const head = overrides.head,
    window = Number(profile.contextWindow) || 0;
  if (typeof head !== "number") return false;
  if (!overflow && (!window || requestSize(history, overrides) < window * 0.75)) return false;
  // 一轮从带工具调用的 assistant 起，连同它的工具结果不拆开。留最近两轮原样，但留下的不过窗口的四分之一；接口已回说放不下的一轮不留
  const starts = [];
  for (let i = head; i < history.length; i++) if (history[i].role === "assistant" && history[i].tool_calls?.length) starts.push(i);
  let cut = history.length;
  for (let keep = overflow ? 0 : FOLD_KEEP_ROUNDS; keep > 0; keep--) {
    const at = starts[starts.length - keep];
    if (at > head && estimateTokens(history.slice(at)) <= window * 0.25) {
      cut = at;
      break;
    }
  }
  const region = history.slice(head, cut);
  // 没有新的工具往来可压（只剩上一份笔记，或放不下的是前面的对话本身）：压前文
  if (!region.some(m => m.role === "tool")) {
    if (!overrides.compactHead || overrides.headCompacted) return false;
    overrides.headCompacted = true;
    // 已在做事的答才记进行迹；还没开工的不为它起一条行迹，问句之上那道摘要分隔就是它的痕迹
    const mark = target?.steps?.length ? foldMark(target, { head: true }) : null;
    overrides.onFold?.(true);
    try {
      if (!(await overrides.compactHead(signal))) {
        dropFoldMark(target, mark);
        return false;
      }
      if (mark) mark.status = "done";
      overrides.seen = null;
      overrides.folds = (overrides.folds || 0) + 1;
      overrides.onSize?.(requestSize(history, overrides));
      return true;
    } catch (error) {
      if (!signal.aborted) dropFoldMark(target, mark);
      throw error;
    } finally {
      overrides.onFold?.(false);
    }
  }
  const task = plainContent(history.slice(0, head).findLast(m => m.role === "user")?.content).slice(0, 4000);
  const mark = foldMark(target, { steps: region.filter(m => m.role === "tool").length, from: regionChars(region) });
  overrides.onFold?.(true);
  try {
    const note = await summarize(
      profile,
      prompt("assistant.fold", { task, transcript: foldTranscript(region, window ? window * 0.5 : CONTEXT_HEAVY) }),
      AbortSignal.any([signal, AbortSignal.timeout(300000)]),
      overrides.reasoning
    );
    history.splice(head, cut - head, ...noteMessages(note));
    if (mark) Object.assign(mark, { status: "done", note, fold: { ...mark.fold, to: note.length } });
    overrides.seen = null;
    overrides.folds = (overrides.folds || 0) + 1;
    overrides.onSize?.(requestSize(history, overrides));
    return true;
  } catch (error) {
    // 停止了：那一步由收尾的 settleSteps 记成已停止
    if (signal.aborted) throw error;
    // 没压成：送出前的那次照原样发，也许还放得下；接口已回说放不下的，由 readReply 把原来的错交回去
    console.warn("轮内压缩失败", error);
    if (mark) Object.assign(mark, { status: "error", result: t("未撮成") });
    return false;
  } finally {
    overrides.onFold?.(false);
  }
}
// 笔记代替被撮的往来：一条 assistant 是笔记，folded 紧随其后请它接着做。言替它撮、它自己撮，落下的都是这个样子
const noteMessages = note => [
  { role: "assistant", content: t`［工作笔记］\n${note}` },
  { role: "user", content: prompt("assistant.folded") }
];
// 模型自己撮要（fold 工具，见 15-tools/51-fold.js）：它在一个节点上收笔，这一答从 head 起到这一轮为止的往来换成它写的笔记——
// 笔记出自手握全部上下文的它，不必另起一回请求重读转写。工具结果刚交回、还没接别的话时调（见 runRounds）。
// 同一批里另有工具的，那几步连同结果接在笔记之后照旧留着：它们的结果它写笔记时还没看到
/** @param {Array<Record<string, any>>} history @param {Record<string, any>} overrides @param {Step[]} steps 这一轮的步骤 */
function foldByModel(history, overrides, steps) {
  const step = steps.findLast(s => s.name === "fold" && s.status === "done" && s.note),
    head = overrides.head;
  if (!step || typeof head !== "number") return;
  const at = history.findLastIndex(m => m.tool_calls?.some(c => c.id === step.id));
  if (at < head) return;
  const call = history[at],
    others = call.tool_calls.filter(c => c.function?.name !== "fold"),
    kept = others.length
      ? [{ ...call, content: null, tool_calls: others }, ...history.slice(at + 1).filter(m => others.some(c => c.id === m.tool_call_id))]
      : [],
    region = history.slice(head, at);
  step.fold = { steps: region.filter(m => m.role === "tool").length, from: regionChars(region), to: step.note.length };
  history.splice(head, history.length - head, ...noteMessages(step.note), ...kept);
  overrides.seen = null;
  overrides.folds = (overrides.folds || 0) + 1;
  overrides.onSize?.(requestSize(history, overrides));
}
