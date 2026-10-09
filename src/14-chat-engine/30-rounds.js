// 言 · 对话引擎 · 轮次：请模型开口、执行工具、交回结果的循环；思考回传、工具交回的图、重试与记账
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 一答的轮次循环：主答、旁注、帮手共用 ----------
// 请模型开口 → 有工具调用就记成步骤、执行、把结果交回 → 再开口，直到它不再调工具。写到一半断了稍候接着写（同一轮最多两回）；
// 一轮既没说话也没调工具不算收尾；轮次到顶收回工具，请它就已有结果收尾。
// 带收件口（inbox，即这一答的 job）的还收补言与后台帮手的回报：补言等落点停下这一轮递上；只剩等帮手时就收尾，回报到了另起一答。
// 用量记在 tally 上——停了、断了也照样有——由调用方收尾时结算
function newTally() {
  return {
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 },
    usageKnown: false,
    opened: false,
    roundOpen: false,
    roundStart: 0,
    // 最后一段话从哪起：断线接着写的那几轮不算新起，帮手的回报从这里截
    replyStart: 0,
    steered: false
  };
}
/**
 * @param {Message|SubAgent} target 写进哪里：主答、旁注的消息，或帮手
 * @param {Array<Record<string, any>>} history 送给接口的消息，就地追加
 * @param {{ profile: Profile, conversation: Conversation, host: Message, signal: AbortSignal, overrides: Record<string, any>,
 *   tally: ReturnType<typeof newTally>, roundLimit: number, scope?: string, inbox?: any, budget?: number,
 *   onFrame?: (() => void)|null, onStatus?: (label?: string) => void }} run
 *   host：步骤画在哪条消息上（帮手的步骤画在主答的差遣卡里）；scope：步骤记上属于哪名帮手；onStatus：网络重试这类状态
 */
async function runRounds(target, history, run) {
  const { profile, conversation, host, signal, overrides, tally, inbox = null } = run,
    status = run.onStatus || (() => {}),
    toolCache = new Map();
  let rounds = 0,
    resumed = 0,
    retrying = false;
  overrides.onRetry = n => {
    retrying = true;
    status(`网络不稳 · 第 ${n} 次重试`);
  };
  // 这一轮开了头又没写完（断线、补言停下）：花的墨按估算记上
  const chargePartial = said => {
    if (!tally.roundOpen) return;
    const spent = estimateTokens(history) + estimateTokens([{ content: said }]);
    tally.usage.prompt_tokens += spent;
    tally.usage.total_tokens += spent;
    tally.usageKnown = tally.steered = true;
    tally.roundOpen = false;
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
        throw Object.assign(Error("模型本轮未返回正文或工具调用，回复尚未完成"), { midStream: true });
    } catch (error) {
      // 写到一半断了：已写的留着，稍候请它从断处接着写（半截的工具调用作废，这一轮重来），同一轮最多接两回，再断才算中断
      if (error.midStream && !signal.aborted && resumed < AUTO_RESUMES) {
        resumed += 1;
        noteBreak(target, error.message, true);
        const said = target.content.slice(roundStart);
        chargePartial(said);
        target.toolCalls = null;
        if (said.trim()) history.push({ role: "assistant", content: said }, { role: "user", content: prompt("assistant.resume") });
        status("网络不稳 · 稍候接着写");
        await restFor(2000 * resumed, signal);
        status();
        continue;
      }
      if (error.name !== "AbortError" || signal.aborted || !inbox?.queue.length) throw error;
      // 补言停下的：这一轮写到落点为止，已写的话与补言一起进历史，没执行的工具调用一律作废，随即再开一轮
      const said = trimToBoundary(target.content.slice(roundStart)).replace(/\n+$/, "");
      target.content = target.content.slice(0, roundStart) + said;
      // 退回去的是这一轮的话：落在这一轮里的补言（与递给帮手的话）跟着前移；回报的那一步在别处，不动
      for (const { user, step, note } of inbox.queue)
        for (const item of [user && step, note]) if (typeof item?.at === "number") item.at = Math.min(item.at, target.content.length);
      chargePartial(said);
      target.toolCalls = null;
      if (said.trim()) history.push({ role: "assistant", content: said });
      await deliverSupplements(inbox, history, run.budget, host, { steer: true });
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
    }
    const calls = (target.toolCalls || []).filter(call => call.name);
    // 轮次到顶后模型仍要调工具（有的中转不认 tool_choice）：不再受理，就此收尾
    if (!calls.length || !overrides.tools || overrides.toolChoice === "none") {
      // 说完了就收尾，帮手还在后台也不等：回报到了另起一答（见 mailReport），等着的时候没有谁醒着。
      // 只剩用户的补言也照旧收尾，补言由 settleSupplements 作下一问送出。这一轮说着时已到的回报（或递给帮手的话）才当场递上接着做
      if (!inbox?.queue.some(item => item.report !== undefined)) break;
      const said = target.content.slice(roundStart).trim();
      if (said) history.push({ role: "assistant", content: said });
      await deliverSupplements(inbox, history, run.budget, host);
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
      { outcomes, images } = await runSteps(steps, conversation, host, signal, toolCache, offered);
    for (const step of steps) history.push({ role: "tool", tool_call_id: step.id, content: outcomes.get(step.id) ?? "" });
    if (images.length) attachToolImages(history, images, profile);
    if (inbox) await deliverSupplements(inbox, history, run.budget, host);
    target.content = paragraphBreak(target.content);
  }
}
// 一答之内思考接得上：带工具调用的那一轮，模型为什么调这件工具的思考随调用一起送回。Anthropic、ChatGPT 订阅有带签名的思考块，
// 经 thinking_blocks 原样送回（桥接各换成该家的格式）；OpenAI 兼容接口（DeepSeek、Kimi、自部署的 Qwen 之类）没有签名，
// 这一轮的思绪原样作 reasoning_content 送回——模板照它生成时的样子排出思考，前缀不变，缓存也接得上。
// 只在一答之内：下一问起前文是摘要，思考随之不带。不收这个字段的接口，去掉重发一回，此后这一页不再给它带
const echolessProfiles = new Set();
/** @param {Message|SubAgent} target @param {number} from 这一轮的思绪从哪起 @param {Profile} profile */
function thoughtEcho(target, from, profile) {
  if (target.thinkingBlocks?.length) return { thinking_blocks: target.thinkingBlocks };
  const thought = String(target.reasoning || "").slice(from);
  return thought.trim() && !echolessProfiles.has(profile.id) ? { reasoning_content: ownCopy(thought) } : {};
}
/** 请求被拒、报错说起思考或多出的字段：去掉送回的思绪，有可去的才算数 @param {Profile} profile */
function dropThoughtEcho(history, profile, message) {
  if (!/reasoning|thinking|signature|extra|unrecognized|additional|unknown|not permitted/i.test(message)) return false;
  const carried = history.filter(item => item.reasoning_content !== undefined);
  for (const item of carried) delete item.reasoning_content;
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
/** 请求被拒、报错说起图时去掉附上的图：有图可去才算数。别的 4xx（思考签名、参数）不能算到「看不了图」头上，不然这一页再不给它附图 @param {Profile} profile */
function dropToolImages(history, profile, message) {
  if (!/image|vision|multi-?modal|图/i.test(message)) return false;
  const carried = history.filter(message => toolImageMessages.has(message));
  for (const message of carried) {
    toolImageMessages.delete(message);
    message.content = prompt("assistant.toolImagesBlind");
  }
  if (carried.length) blindProfiles.add(profile.id);
  return carried.length > 0;
}
// 收尾：裁掉正文首尾的空行；开头裁了几行，步骤记的偏移一起前移，不然时间线上每段话都错位、被切在字中间
/** @param {Message|SubAgent} target */
function trimReply(target) {
  const lead = target.content.match(/^\n*/)[0].length;
  target.content = target.content.replace(/^\n+|\n+$/g, "");
  if (lead) for (const step of target.steps || []) if (typeof step.at === "number") step.at = Math.max(0, step.at - lead);
  return lead;
}
// 向模型要一轮回复，写进 target（正文、思绪、工具调用、用量）：流式按 SSE 逐字进，否则整段一次到
// onOpen：接口接下请求、开始回话时叫一声——从这一刻起这一轮就在花墨了，中途停止也得记账；onFrame 逐帧交给 readSse（旁注面板用来跟随滚动）
/**
 * @param {Profile} profile
 * @param {Message|SubAgent} target 主消息或帮手（拟题 / 压缩的临时对象也按 Message 的样子造）
 */
async function readReply(profile, history, signal, overrides, target, retried = false, onOpen = null, onFrame = null) {
  target.thinkingBlocks = null;
  // 长活：这一答的工具往来快撑满窗口了，先压掉较早的几轮再发（见 14-chat-engine/60-context.js 的 keepInWindow）
  if (!retried) await keepInWindow(profile, history, signal, overrides, { target });
  const response = await requestPatiently(profile, history, signal, overrides);
  if (!response.ok) {
    const message = await describeResponseError(response);
    // 接口不认这个思考档位：记下它认的几档，换成最接近的一档重发一次；再不行才算失败
    const sent = reasoningFields(profile, overrides.reasoning).reasoning_effort;
    if (!retried && sent && learnReasoningLevels(profile, message, sent)) {
      const level = nearestReasoning(profile, overrides.reasoning);
      toast(`此模型的思考档位为 ${profileReasoningLevels(profile).map(reasoningLabel).join(" / ")}，已改用「${reasoningLabel(level)}」`);
      renderModelTriggers();
      return readReply(profile, history, signal, overrides, target, true, onOpen, onFrame);
    }
    // 接口回说放不下：压掉这一答较早的往来再发一回；已无可压的，原样报错。429 是限流（「tokens per min」也带 token 与 limit），不算
    const overflow = response.status !== 429 && contextOverflow(message);
    if (overflow) learnContextWindow(profile, message);
    if (overflow && (await keepInWindow(profile, history, signal, overrides, { overflow: true, target })))
      return readReply(profile, history, signal, overrides, target, true, onOpen, onFrame);
    // 送回的思绪不收（见 thoughtEcho）、附了工具交回的图被拒（多半是看不了图的模型）：去掉再发一回
    if (
      !retried &&
      !overflow &&
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429 &&
      (dropThoughtEcho(history, profile, message) || dropToolImages(history, profile, message))
    )
      return readReply(profile, history, signal, overrides, target, true, onOpen, onFrame);
    throw Error(message);
  }
  onOpen?.();
  const type = response.headers.get("content-type") || "";
  // 帮手与消息的流式字段一致（content / reasoning / toolCalls / usage），readSse 按消息处理
  const sink = /** @type {Message} */ (target);
  // 记下这次请求实际的提示用量，下一轮据此估算会不会撑破窗口
  const sentAt = history.length,
    note = () => {
      if (Number(target.usage?.prompt_tokens) > 0) overrides.seen = { at: sentAt, tokens: Number(target.usage.prompt_tokens) };
    };
  if (type.includes("text/event-stream"))
    return readSse(response, sink, { onFrame }).then(note, error => {
      // 开了口才断的（掉线、上游掐线、静默超时）：记一笔，streamReply 据此接着写而不是整答作废
      if (error.name !== "AbortError") error.midStream = true;
      throw error;
    });
  const data = await response.json(),
    message = data?.choices?.[0]?.message;
  target.content += extractContent(data);
  // 与流式一致：有的接口把思考放在 reasoning 而不是 reasoning_content
  target.reasoning = normalizeContent(message?.reasoning_content ?? message?.reasoning) || target.reasoning;
  splitInlineThink(sink);
  target.usage = data.usage ? withCached(data.usage) : null;
  if (Array.isArray(message?.tool_calls))
    target.toolCalls = message.tool_calls.map(call => ({
      id: call.id,
      name: call.function?.name || "",
      arguments: call.function?.arguments || ""
    }));
  note();
  if (data?.choices?.[0]?.finish_reason === "length") throw Object.assign(Error("模型达到输出长度上限，回复尚未完成"), { midStream: true });
}
// 途中断过一回记一笔：只留最近十回，续写不清
function noteBreak(target, why, auto = false) {
  target.breaks = [...(target.breaks || []), { at: now(), why: String(why || "").slice(0, 200), ...(auto ? { auto } : {}) }].slice(-10);
}
// 网络一晃就断太脆：接口没接下请求时（连不上、限流、5xx、过载）等一等再试，间隔渐长，接口给了 Retry-After 就照它等；
// 断网时等网回来再试。参数错、鉴权错这类 4xx 试也白试，原样交回。overrides.onRetry 用来在页面上说一声「第几次重试」
const RETRY_DELAYS = [1000, 2000, 4000, 8000];
const retryableStatus = status => status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
/** 等 ms 毫秒（断网就等到网回来）；中途停止即抛 AbortError */
function restFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    const done = () => {
      clearTimeout(timer);
      removeEventListener("online", wake);
      signal?.removeEventListener("abort", stop);
    };
    const wake = () => {
      done();
      resolve(null);
    };
    const stop = () => {
      done();
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    const timer = setTimeout(() => (navigator.onLine ? wake() : addEventListener("online", wake, { once: true })), ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}
/** @param {Profile} profile */
async function requestPatiently(profile, history, signal, overrides) {
  for (let attempt = 0; ; attempt++) {
    let wait = RETRY_DELAYS[attempt];
    try {
      const response = await requestChat(profile, history, signal, overrides);
      if (response.ok || !retryableStatus(response.status) || wait === undefined) return response;
      const after = Number(response.headers.get("retry-after"));
      if (after > 0) wait = Math.min(after * 1000, 60000);
      response.body?.cancel().catch(() => {});
    } catch (error) {
      if (error.name === "AbortError" || wait === undefined) throw error;
    }
    overrides.onRetry?.(attempt + 1);
    await restFor(wait, signal);
  }
}
// opened：接口至少接下过一次请求（没接下的——400、连不上——不花墨）；partialRound：最后一轮开了头却没等到它的 usage（停止、断网），
// 那一轮按估算补上——提示全文加上这一轮写出的字；一次 usage 都没拿到的（接口不回 usage）整答按估算
/**
 * @param {Profile} profile
 * @param {Message} assistant
 * @param {Conversation} conversation
 */
function accountUsage(
  profile,
  assistant,
  requestMessages,
  conversation,
  { opened = true, partialRound = false, roundStart = 0, steered = false } = {}
) {
  const exact = Number(assistant.usage?.total_tokens || 0);
  const estimate = from => estimateTokens(requestMessages) + estimateTokens([{ content: String(assistant.content || "").slice(from) }]);
  const consumed = exact > 0 ? exact + (partialRound ? estimate(roundStart) : 0) : opened ? estimate(0) : 0;
  if (!(consumed > 0)) return;
  const live = spendTokens(profile, consumed);
  assistant.tokenCount = consumed;
  assistant.tokenEstimated = !(exact > 0) || partialRound || steered;
  if (quotaExhausted(live)) toast("此答写毕，余墨已尽；换个模型可续");
  renderQuota();
}
