// 言 · 对话引擎 · 轮次：请模型开口、执行工具、交回结果的循环；思考回传、工具交回的图、重试与记账
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 一答的轮次循环：主答、旁注、帮手共用 ----------
// 请模型开口 → 有工具调用就记成步骤、执行、把结果交回 → 再开口，直到它不再调工具。写到一半断了稍候接着写（同一轮最多两回）；
// 一轮既没说话也没调工具不算收尾；轮次到顶收回工具，请它就已有结果收尾。
// 带收件口（inbox，即这一答的 job）的还收补言与后台帮手的回报：补言等落点停下这一轮递上；只剩等帮手时就收尾，回报到了另起一答。
// 用量记在 tally 上——停了、断了也照样有——由调用方收尾时结算这一答的耗墨；余墨则每轮当场扣（spent），长活跑着右下角也在动
function newTally() {
  return {
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 },
    usageKnown: false,
    // 已当场扣进余墨的：收尾结算时只补其余（估算的那一截）
    spent: 0,
    opened: false,
    roundOpen: false,
    roundStart: 0,
    // 最后一段话从哪起：断线接着写的那几轮不算新起，帮手的回报从这里截
    replyStart: 0,
    steered: false
  };
}
// 用量两份相加；都没有记作 null
function usageSum(a, b) {
  if (!a || !b) return a || b || null;
  const sum = { ...a };
  for (const [key, value] of Object.entries(b)) sum[key] = Number(sum[key] || 0) + Number(value || 0);
  return sum;
}
/**
 * @param {Message|SubAgent} target 写进哪里：主答、旁注的消息，或帮手
 * @param {Array<Record<string, any>>} history 送给接口的消息，就地追加
 * @param {{ profile: Profile, conversation: Conversation, host: Message, signal: AbortSignal, overrides: Record<string, any>,
 *   tally: ReturnType<typeof newTally>, roundLimit: number, scope?: string, kind?: UsageKind, inbox?: any, budget?: number,
 *   onFrame?: (() => void)|null, onStatus?: (label?: string) => void, afterRound?: () => Promise<string>,
 *   beforeEnd?: () => Promise<Record<string, any>|null> }} run
 *   host：步骤画在哪条消息上（帮手的步骤画在主答的差遣卡里）；scope：步骤记上属于哪名帮手；kind：墨记进用量簿的哪一类（帮手按 scope 认）；
 *   onStatus：网络重试这类状态；
 *   afterRound：一轮工具做完、要接在工具结果后让它知道的话（主答的意，见 19-intent/10-store.js 的 intentRound）；
 *   beforeEnd：模型说完要收尾时，递回一条消息即接着做，给 null 即收尾（主答的意，见 intentGate）
 */
async function runRounds(target, history, run) {
  const { profile, conversation, host, signal, overrides, tally, inbox = null } = run,
    status = run.onStatus || (() => {}),
    toolCache = new Map();
  // 一轮的墨当场扣：右下角的余墨跟着动，帮手的签上也跟着跳
  const spend = amount => {
    if (!(amount > 0)) return;
    tally.spent += amount;
    spendTokens(profile, amount, run.scope ? "helper" : run.kind || "main");
    renderQuota();
  };
  // 轮次按这一趟算（帮手睡醒再进来是新的一趟）：上一趟到顶时收回的工具还给它，不然醒来就再也调不了工具
  delete overrides.toolChoice;
  let rounds = 0,
    resumed = 0,
    retrying = false;
  overrides.onRetry = n => {
    retrying = true;
    status(t`网络不稳 · 再试第 ${n} 回`);
  };
  // 这一轮开了头又没写完（断线、补言停下）：花的墨按估算记上
  const chargePartial = said => {
    if (!tally.roundOpen) return;
    const spent = estimateTokens(history) + estimateTokens([{ content: said }]);
    tally.usage.prompt_tokens += spent;
    tally.usage.total_tokens += spent;
    tally.usageKnown = tally.steered = true;
    tally.roundOpen = false;
    spend(spent);
  };
  for (;;) {
    // 开工前等着的那几步（装历史、起 MCP、断线稍候）里已按了停：中止在先，后面挂上的监听再也等不到，当场作罢
    signal.throwIfAborted();
    target.toolCalls = null;
    target.usage = null;
    const roundStart = (tally.roundStart = target.content.length),
      thoughtStart = String(target.reasoning || "").length;
    if (!resumed) tally.replyStart = roundStart;
    tally.roundOpen = false;
    // 每一轮自己一个中止器：补言只停这一轮的流，整答的 signal 留给「停止」
    const round = new AbortController(),
      stopRound = () => round.abort();
    signal.addEventListener("abort", stopRound, { once: true });
    if (inbox) {
      inbox.round = round;
      inbox.roundStart = roundStart;
      inbox.reading = true;
    }
    try {
      await readReply(
        profile,
        history,
        round.signal,
        overrides,
        target,
        false,
        () => {
          tally.roundOpen = tally.opened = true;
          if (retrying) status();
          retrying = false;
        },
        run.onFrame || null
      );
      // 每轮都要有新正文或工具调用；之前的进度说明不能让工具之后的空回复冒充收尾
      if (!target.content.slice(roundStart).trim() && !target.toolCalls?.some(call => call.name))
        throw Object.assign(Error("模型本轮未返回正文或工具调用，答复尚未写完"), { midStream: true });
    } catch (error) {
      // 写到一半断了：已写的留着，稍候请它从断处接着写（半截的工具调用作废，这一轮重来），同一轮最多接两回，再断才算中断
      if (error.midStream && !signal.aborted && resumed < AUTO_RESUMES) {
        resumed += 1;
        noteBreak(target, error.message, true);
        const said = target.content.slice(roundStart);
        chargePartial(said);
        target.toolCalls = null;
        if (said.trim()) history.push({ role: "assistant", content: said }, { role: "user", content: prompt("assistant.resume") });
        status(error.finish === "length" ? t("写到输出上限 · 接着写") : t("网络不稳 · 稍候接着写"));
        if (error.finish !== "length") await restFor(2000 * resumed, signal);
        status();
        continue;
      }
      if (error.name !== "AbortError" || signal.aborted || !inbox?.queue.length) throw error;
      // 补言停下的：这一轮写到落点为止，已写的话与补言一起进历史，没执行的工具调用一律作废，随即再开一轮
      const said = trimToBoundary(target.content.slice(roundStart)).replace(/\n+$/, "");
      target.content = target.content.slice(0, roundStart) + said;
      // 退回去的是这一轮的话：落在这一轮里的递给帮手的话跟着前移（补言递上时自会挪到落点）；回报的那一步在别处，不动
      for (const { note } of inbox.queue) if (typeof note?.at === "number") note.at = Math.min(note.at, target.content.length);
      chargePartial(said);
      target.toolCalls = null;
      if (said.trim()) history.push({ role: "assistant", content: said });
      await deliverSupplements(inbox, history, run.budget, host, { steer: true, target });
      target.content = paragraphBreak(target.content);
      continue;
    } finally {
      signal.removeEventListener("abort", stopRound);
      if (inbox) {
        inbox.reading = false;
        inbox.round = null;
        clearInterval(inbox.steerTimer);
        inbox.steerTimer = 0;
      }
    }
    resumed = 0; // 接续的次数按轮算：长活跑上几百轮，前面断过两回不该让后面再断就没得接
    if (target.usage) {
      tally.usageKnown = true;
      tally.roundOpen = false;
      for (const key of Object.keys(tally.usage)) tally.usage[key] += Number(target.usage[key] || 0);
      spend(Number(target.usage.total_tokens || 0));
    }
    const calls = (target.toolCalls || []).filter(call => call.name);
    // 轮次到顶后模型仍要调工具（有的中转不认 tool_choice）：不再受理，就此收尾
    if (!calls.length || !overrides.tools || overrides.toolChoice === "none") {
      // 说完了就收尾，帮手还在后台也不等：回报到了另起一答（见 mailReport），等着的时候没有谁醒着。
      // 只剩用户的补言也照旧收尾，补言由 settleSupplements 作下一问送出。这一轮说着时已到的回报（或递给帮手的话）才当场递上接着做
      if (!inbox?.queue.some(item => item.report !== undefined)) {
        // 收尾前要它再看一眼的（主答的意，见 19-intent/10-store.js 的 intentGate）：递回一句话即接着这一答写，不另起。轮次到顶的不拦
        const entry = run.beforeEnd && overrides.tools && overrides.toolChoice !== "none" ? await run.beforeEnd() : null;
        if (!entry) break;
        const said = target.content.slice(roundStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push(entry);
        target.content = paragraphBreak(target.content);
        continue;
      }
      const said = target.content.slice(roundStart).trim();
      if (said) history.push({ role: "assistant", content: said });
      await deliverSupplements(inbox, history, run.budget, host, { target });
      target.content = paragraphBreak(target.content);
      continue;
    }
    // 轮次到顶：不再受理这一批调用，让模型就已有结果收尾。工具定义照旧带着、只禁它再调（tool_choice: none）：
    // 历史里已有工具往来，整份撤掉工具 Anthropic 会拒，前缀一变缓存也接不上
    if (++rounds > run.roundLimit) {
      const said = target.content.slice(roundStart).trim();
      if (said) history.push({ role: "assistant", content: said });
      history.push({ role: "user", content: prompt("assistant.roundLimit") });
      overrides.toolChoice = "none";
      target.content = paragraphBreak(target.content);
      continue;
    }
    // 模型请求调用工具：记成步骤、执行、把结果作为 tool 消息回传，再让模型继续；历史里只带本轮新写的正文，前几轮的已在各自的 assistant 消息里
    /** @type {Step[]} */
    const steps = calls.map(call => ({
      id: call.id || `call_${uid().slice(0, 8)}`,
      name: call.name,
      arguments: call.arguments || "{}",
      status: "running",
      at: target.content.length,
      rat: String(target.reasoning || "").length,
      ...(run.scope ? { scope: run.scope } : {})
    }));
    (target.steps ||= []).push(...steps);
    // 拟好的调用已入册成步骤，「正在拟」那一行随之撤下
    target.toolCalls = null;
    refreshSteps(host);
    history.push({
      role: "assistant",
      content: ownCopy(target.content.slice(roundStart)) || null,
      tool_calls: steps.map(step => ({
        id: step.id,
        type: "function",
        function: { name: step.name, arguments: replayArguments(step.arguments) }
      })),
      ...thoughtEcho(target, thoughtStart, profile)
    });
    const offered = new Set(overrides.tools.map(tool => tool.function?.name)),
      { outcomes, images } = await runSteps(steps, conversation, host, signal, toolCache, offered, run.kind === "side");
    for (const step of steps) history.push({ role: "tool", tool_call_id: step.id, content: outcomes.get(step.id) ?? "" });
    // 它这一轮自己撮了要：此前的往来换成它写的笔记（见 60-context.js 的 foldByModel）
    foldByModel(history, overrides, steps);
    // 一轮做完之后要让它知道的（意里新转待复核的几项）：接在这一轮末一条工具结果后
    const after = run.afterRound ? await run.afterRound() : "";
    if (after) history.at(-1).content = `${history.at(-1).content}\n\n${after}`;
    if (images.length) attachToolImages(history, images, profile);
    if (inbox) await deliverSupplements(inbox, history, run.budget, host, { target });
    target.content = paragraphBreak(target.content);
  }
}
// 一答之内思考接得上：带工具调用的那一轮，模型为什么调这件工具的思考随调用一起送回。Anthropic、ChatGPT 订阅有带签名的思考块，
// 经 thinking_blocks 原样送回（桥接各换成该家的格式）；OpenAI 兼容接口（DeepSeek、Kimi、自部署的 Qwen 之类）没有签名，
// 这一轮的思绪原样送回——模板照它生成时的样子排出思考，前缀不变，缓存也接得上。字段名两家各认一个：DeepSeek、Kimi 认
// reasoning_content，新版 vLLM 只认 reasoning、旧名一声不响地丢掉（模型看不到自己这一答里先前想过什么，每轮从头想起，
// 一句补言能被它每轮重新「收到」一遍），所以两个都带，模板只取其一。
// 只在一答之内：下一问起前文是摘要，思考随之不带。不收这个字段的接口，去掉重发一回，此后这一页不再给它带
const echolessProfiles = new Set();
/** @param {Message|SubAgent} target @param {number} from 这一轮的思绪从哪起 @param {Profile} profile */
function thoughtEcho(target, from, profile) {
  if (target.thinkingBlocks?.length) return { thinking_blocks: target.thinkingBlocks };
  const thought = String(target.reasoning || "").slice(from);
  if (!thought.trim() || echolessProfiles.has(profile.id)) return {};
  const echo = ownCopy(thought);
  return { reasoning_content: echo, reasoning: echo };
}
// 一答之内改过较早的往来（旧截图换成一行字、撮要压掉前几轮、去图重发）：改处之后送回的思考块作废。Anthropic 新一代的签名记着
// 它之前的整段前文，前文一变，这些块再送回就是 400（preserved thinking；新开的账号一律查）。送出前与上回送出的对一遍——
// 逐条比对象与 content 引用，改过的就地换了新值、压掉的整段拼了新条——从第一处不同起去掉思考块，只去不改，此后照常往后接
const sentHistories = new WeakMap();
/** @param {Array<Record<string, any>>} history @param {Profile} profile */
function dropStaleThoughts(history, profile) {
  if (profile.api !== "anthropic") return;
  const sent = sentHistories.get(history) || [],
    from = sent.findIndex(([item, content], i) => history[i] !== item || item.content !== content);
  if (from >= 0) for (const item of history.slice(from)) delete item.thinking_blocks;
  sentHistories.set(
    history,
    history.map(item => [item, item.content])
  );
}
/** 请求被拒、报错说起思考或多出的字段：去掉送回的思绪，有可去的才算数 @param {Profile} profile */
function dropThoughtEcho(history, profile, message) {
  if (!/reasoning|thinking|signature|extra|unrecognized|additional|unknown|not permitted/i.test(message)) return false;
  const carried = history.filter(item => item.reasoning_content !== undefined);
  for (const item of carried) {
    delete item.reasoning_content;
    delete item.reasoning;
  }
  if (carried.length) echolessProfiles.add(profile.id);
  return carried.length > 0;
}
// 工具交回的图（游目截的画面之类）：tool 消息只收文字，图另起一条用户消息紧随工具结果（Anthropic 那头并进同一条）。
// 一答里只留最新的一批，先前的换成一行字——浏览时连截十张也只背一张；下一问起不再带，行迹摘要里有那一步即可。
// 看不了图的模型：带图被拒就去掉图重发一回（见 readReply），此后这一页不再给它附图
const toolImageMessages = new WeakSet(),
  blindProfiles = new Set();
/** @param {Profile} profile */
function attachToolImages(history, images, profile) {
  for (const message of history)
    if (toolImageMessages.has(message)) {
      toolImageMessages.delete(message);
      message.content = prompt("assistant.toolImagesStale");
    }
  if (blindProfiles.has(profile.id)) return;
  const message = {
    role: "user",
    content: [
      { type: "text", text: prompt("assistant.toolImages") },
      ...images.map(url => ({ type: "image_url", image_url: { url, detail: "auto" } }))
    ]
  };
  toolImageMessages.add(message);
  history.push(message);
}
// 报错说的是这一张图不行（太大、尺寸、格式解不开），而不是这个模型不收图
const IMAGE_REJECTED =
  /too large|exceed|maximum|\bsize|dimension|pixel|\d\s*MB|format|media.?type|mime|decode|could not process|invalid image|corrupt|heic|heif|过大|超过|尺寸|格式/i;
/** 请求被拒、报错说起图时去掉附上的图重发：有图可去才算数。说这个模型不收图的，这一页此后不再给它附图；
 * 说的是这一张（太大、格式不认）只去掉这一回——一张手机原图被拒，不该从此把它当成看不了图的。
 * 别的 4xx（思考签名、参数）不能算到图头上 @param {Profile} profile */
function dropToolImages(history, profile, message) {
  if (!/image|vision|multi-?modal|图/i.test(message)) return false;
  const blind = !IMAGE_REJECTED.test(message),
    dropped = stripImages(history, blind);
  if (dropped && blind) blindProfiles.add(profile.id);
  return dropped > 0;
}
// 历史里的图一概换成一句话：工具交回的整条换掉，用户发的（这一问、最近带图的那一问，见 keptImageQuestion）逐张换。
// 已认定看不了图的模型，每次发出前先过一遍（见 readReply），不必每问先被拒一回
function stripImages(history, blind = true) {
  let dropped = 0;
  for (const message of history) {
    if (toolImageMessages.has(message)) {
      toolImageMessages.delete(message);
      message.content = prompt(blind ? "assistant.toolImagesBlind" : "assistant.imageRejected");
      dropped += 1;
    } else if (Array.isArray(message.content) && message.content.some(part => part?.type === "image_url")) {
      message.content = message.content.map(part =>
        part?.type === "image_url" ? { type: "text", text: prompt(blind ? "assistant.imageBlind" : "assistant.imageRejected") } : part
      );
      dropped += 1;
    }
  }
  return dropped;
}
// 收尾：裁掉正文首尾的空行；开头裁了几行，步骤记的偏移一起前移，不然时间线上每段话都错位、被切在字中间
/** @param {Message|SubAgent} target */
function trimReply(target) {
  const lead = target.content.match(/^\n*/)[0].length;
  target.content = target.content.replace(/^\n+|\n+$/g, "");
  if (lead) for (const step of target.steps || []) if (typeof step.at === "number") step.at = Math.max(0, step.at - lead);
  return lead;
}
// 事件流的行首：网关、中转把 SSE 标成 text/plain 时，真正露出的记号就这几样（开头不一定是 data:，也可能是 event: 或注释行）
const EVENT_STREAM_HEAD = /^(?:data|event|id|retry)\s*:|^:/;
// 块可以切得很碎（第一块也许只有 da 两个字节）：还看不清时就再读一块，别急着判成整份 JSON
const EVENT_STREAM_MARKS = ["data", "event", "id", "retry", ":"];
/** 开头这一截还只是某个行首记号的前半截（`da`、`even`、`data ` 之类），定不下来 */
const eventMarkPending = head => {
  const mark = head.replace(/\s+$/, "");
  return EVENT_STREAM_MARKS.some(from => from.startsWith(mark) || `${from}:`.startsWith(mark));
};
/**
 * 一份没标成 text/event-stream 的答复，看开头几个字节定它是事件流还是整份 JSON：
 * 只认类型的话，标错的事件流会被 response.json() 拿 `data: {...}` 去解析、抛一句语法错，已经到的正文一个字不剩；
 * 反过来一律当事件流读，标成 text/plain 的整份 JSON 只会报「未发送结束标志」。两头都得认，所以看内容。
 * 判完把已读的块拼回去、重包成一个 Response：是事件流的照旧逐块流进来，不是的整份交给 response.json()
 * @param {Response} response @returns {Promise<{ response: Response, stream: boolean }>}
 */
async function sniffEventStream(response) {
  const reader = response.body.getReader(),
    decoder = new TextDecoder(),
    chunks = [];
  let text = "",
    stream = false,
    finished = false;
  // 读到第一个非空白的东西为止（BOM、空行都跳过）：事件流也可能先来个换行再 data:，整份 JSON 也常以空白起头
  while (true) {
    const { value, done } = await reader.read();
    finished = !!done;
    if (value) {
      chunks.push(value);
      // 被切在多字节字符中间的那一截由 decoder 自己留着，下一块到齐再吐
      text += decoder.decode(value, { stream: true });
    }
    const head = text.replace(/^\s+/, "");
    if (EVENT_STREAM_HEAD.test(head) || (head && !eventMarkPending(head)) || finished) {
      stream = EVENT_STREAM_HEAD.test(head);
      break;
    }
  }
  const body = new ReadableStream({
    start: controller => {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (finished) controller.close();
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    // 用户按停、这一路不再读：底下的 reader 一并取消，别把连接挂着
    cancel: reason => reader.cancel(reason)
  });
  return { response: new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }), stream };
}
/**
 * 这一份答复按哪一路读：类型标了事件流的照旧直接读（不嗅探，正常路径的逐字出现不受影响），没标的看开头几个字节
 * @param {Response} response @returns {Promise<{ response: Response, stream: boolean }>}
 */
function replyBody(response) {
  const stream = (response.headers.get("content-type") || "").includes("text/event-stream");
  return stream || !response.body ? Promise.resolve({ response, stream }) : sniffEventStream(response);
}
