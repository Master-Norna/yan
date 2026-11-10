// 言 · 接口：用量估算、请求、SSE 读取、错误说明
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function estimateText(text) {
  const chinese = (text.match(/[㐀-鿿]/g) || []).length;
  return chinese + Math.ceil((text.length - chinese) / 4);
}
// 上下文过重的门槛：每一答的用量标注超过它就转为印色提醒
const CONTEXT_HEAVY = 24000;
const SSE_IDLE_MS = 300000;
// Anthropic 的 max_tokens 没填时的值：今日的 Claude 都认得下这个数；OpenAI 兼容接口根本不传这个字段
const DEFAULT_MAX_TOKENS = 32000;
const REVEAL_RATE = 0.16,
  FRESH_MS = 640; // 每帧写出积压字数的比例；新字渐显持续时间
function estimateTokens(messages) {
  let score = 0;
  for (const message of messages) {
    score += 4;
    // 工具调用的参数也随请求送出（写文件时整份内容都在这里），不算就会把长活的上下文估得太轻
    for (const call of message.tool_calls || []) score += 8 + estimateText(String(call.function?.arguments || ""));
    // 随工具调用送回的思考（见 thoughtEcho）也占窗口
    score += estimateText(String(message.reasoning_content || ""));
    for (const block of message.thinking_blocks || []) score += estimateText(String(block.thinking || ""));
    if (typeof message.content === "string") {
      score += estimateText(message.content);
      continue;
    }
    // 图片和文件原件不能按 base64 长度折算，按固定值粗估
    for (const part of Array.isArray(message.content) ? message.content : [])
      score +=
        part.type === "text" ? estimateText(String(part.text || "")) : part.type === "image_url" ? 1000 : part.type === "file" ? 2000 : 0;
  }
  return Math.max(1, Math.ceil(score));
}
function parseTokenLimit(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([kme])?$/);
  if (!match) return null;
  const amount = Number(match[1]),
    unit = match[2] || "k",
    multiplier = unit === "e" ? 100000000 : unit === "m" ? 1000000 : 1000;
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * multiplier) : null;
}
// 余墨只属于模型，不属于对话：对话在所选模型耗尽时暂停，换模型或调高上限即刻可续，不再把整段对话锁死
/** @param {Conversation} c */
function conversationDry(c) {
  return !!c && quotaExhausted(activeProfile(c));
}
// 进行中的请求先把预计用量记在预留里：几段对话同时开工时，后开的看得见先开的已经占了多少，不会都以为「还剩 20k」而合计超卖；
// 请求收尾时预留撤销、换成实际用量。只在内存里记，刷新页面即清
const reservedTokens = new Map();
/** @param {Profile} profile */
function reservedFor(profile) {
  return profile ? Number(reservedTokens.get(profile.id) || 0) : 0;
}
/** @param {Profile} profile */
function reserveTokens(profile, amount) {
  if (!profile || !(amount > 0)) return () => {};
  reservedTokens.set(profile.id, reservedFor(profile) + amount);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const rest = reservedFor(profile) - amount;
    if (rest > 0) reservedTokens.set(profile.id, rest);
    else reservedTokens.delete(profile.id);
  };
}
// 记下花掉的墨。记在此刻表里的那一份上：请求开工时拿住的模型对象，作答途中可能已被配置同步整份换掉，记在旧的上就丢了。
// kind 是用量簿里记在哪一类（见 noteUsage）
/** @param {Profile} profile @param {UsageKind} [kind] @returns {Profile} 记上账的那一份 */
function spendTokens(profile, amount, kind = "main") {
  const live = profiles().find(p => p.id === profile.id) || profile;
  live.usedTokens = Math.max(0, Number(live.usedTokens || 0)) + amount;
  noteSpend(live.id, amount);
  noteUsage(kind, amount);
  return live;
}
// 用量簿（设置 → 模型 顶上的用量卡）：每花一笔按本地日期、按类记下——主答（拟题、整理前文随它）、帮手、旁注、审查、记忆优化记墨，生图记张数。
// 攒几秒一并报给桥接，由它往 用量.json 上加（见 server/usage.js）；报不上的留着下回再报，离页时随 keepalive 送出
/** @typedef {"main"|"helper"|"side"|"review"|"memory"|"image"} UsageKind */
let usagePending = new Map(),
  usageTimer = 0;
function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** @param {UsageKind} kind */
function noteUsage(kind, amount) {
  if (!(amount > 0)) return;
  const key = `${localDay()}|${kind}`;
  usagePending.set(key, (usagePending.get(key) || 0) + amount);
  usageTimer ||= setTimeout(flushUsage, 3000);
}
async function flushUsage(leaving = false) {
  clearTimeout(usageTimer);
  usageTimer = 0;
  if (!usagePending.size) return;
  const sent = usagePending,
    items = [...sent].map(([key, amount]) => ({ day: key.split("|")[0], kind: key.split("|")[1], amount }));
  usagePending = new Map();
  if (leaving) {
    fetch(`${apiBase}/api/usage/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      keepalive: true
    }).catch(() => {});
    return;
  }
  try {
    await bridge("/api/usage/add", { items });
  } catch {
    for (const [key, amount] of sent) usagePending.set(key, (usagePending.get(key) || 0) + amount);
    usageTimer ||= setTimeout(flushUsage, 30000);
  }
}
/** @param {Profile} profile */
function quotaExhausted(profile) {
  const cap = parseTokenLimit(profile?.quota);
  return cap !== null && cap > 0 && Number(profile?.usedTokens || 0) >= cap;
}
// 开工前的门槛：已用的加上别处进行中预留的，都算进去
/** @param {Profile} profile */
function quotaBlocked(profile) {
  const cap = parseTokenLimit(profile?.quota);
  return cap !== null && cap > 0 && Number(profile?.usedTokens || 0) + reservedFor(profile) >= cap;
}
function formatTokens(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const compact = (amount, unit) => `${Number(amount.toFixed(amount >= 10 ? 0 : 1))}${unit}`;
  return n >= 100000000
    ? compact(n / 100000000, "e")
    : n >= 1000000
      ? compact(n / 1000000, "m")
      : n >= 1000
        ? compact(n / 1000, "k")
        : String(n);
}
// 思考强度：一律以 reasoning_effort 送到桥接，各家怎么换算（Anthropic 的 effort 与预算、DashScope 的 thinking_budget）由桥接定（见 server/model/）。留空则不带字段，由接口自己定。
// 各家接受的档位不一样（有的只有 low / medium / xhigh，有的多一个 minimal 或 max）：模型配置里可填「思考档位」，
// 没填就按四档（低 / 中 / 高 / 最高）列；只认三档的接口拒绝某个档位时，从它的报错里读出它认的那几档记到模型上，
// 把这一问换成最接近的一档重发一次，此后菜单只列它认的。菜单上没有「关」：愿意接 Key 的人不至于连思考都不愿开，
// 要它少想就选「低」，旧数据里存的「关」按「默认」看
const REASONING_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
  REASONING_NAMES = { "": t("默认"), minimal: t("极低"), low: t("低"), medium: t("中"), high: t("高"), xhigh: t("极高"), max: t("最高") },
  REASONING_DEFAULT_LEVELS = ["low", "medium", "high", "max"];
function reasoningLabel(level) {
  return REASONING_NAMES[level || ""] || level;
}
// 旧版菜单上有「关」（off / none）：现在按「默认」看，不带字段
function normalizeReasoning(level) {
  return level === "off" || level === "none" ? "" : String(level || "");
}
// 模型认的档位（不含「关」）：配置里填的（或探到的）优先，否则通用四档；一律按由低到高排，不管填写或报错里是什么顺序。
// 填的是 none：这个模型不认思考档位（探测时接口说不认识 reasoning_effort），菜单上只剩「默认」
/** @param {Profile} profile */
function profileReasoningLevels(profile) {
  const raw = String(profile?.reasoningLevels || "").toLowerCase();
  if (raw.trim() === "none") return [];
  const listed = raw.split(/[\s,，、/|]+/).filter(item => REASONING_ORDER.includes(item) && item !== "none");
  return listed.length
    ? [...new Set(listed)].sort((a, b) => REASONING_ORDER.indexOf(a) - REASONING_ORDER.indexOf(b))
    : REASONING_DEFAULT_LEVELS;
}
// 菜单上的档位：默认 + 模型认的几档
/** @param {Profile} profile */
function reasoningChoices(profile) {
  return ["", ...profileReasoningLevels(profile)];
}
// 把用户选的档位落到模型认的档位上：认就原样用；不认则取最接近的一档，同样近时取高的那档（选「高」是想它多想，别给它降成「中」）
/** @param {Profile} profile */
function nearestReasoning(profile, level) {
  level = normalizeReasoning(level);
  if (!level) return level;
  const levels = profileReasoningLevels(profile);
  if (!levels.length) return "";
  if (levels.includes(level)) return level;
  const want = REASONING_ORDER.indexOf(level);
  return [...levels].sort((a, b) => {
    const da = Math.abs(REASONING_ORDER.indexOf(a) - want),
      db = Math.abs(REASONING_ORDER.indexOf(b) - want);
    return da - db || REASONING_ORDER.indexOf(b) - REASONING_ORDER.indexOf(a);
  })[0];
}
/** @param {Profile} profile */
function reasoningFields(profile, level) {
  const effort = nearestReasoning(profile, level);
  return effort ? { reasoning_effort: effort } : {};
}
// 从接口的报错里认出它支持的几档（如 Supported values are: 'low', 'medium', and 'xhigh'），由低到高排；认不出来给空。
// sent 是这次发出去、被拒的那一档：报错里通常会把它也复述一遍（Invalid value: 'high'），不能当成它认的
function parseReasoningLevels(message, sent) {
  const text = String(message || "");
  if (!/reasoning|effort|thinking/i.test(text) && !(sent && text.includes(sent))) return [];
  const found = [...new Set([...text.matchAll(/\b(none|minimal|low|medium|high|xhigh|max)\b/gi)].map(m => m[1].toLowerCase()))].filter(
    level => level !== "none" && level !== sent
  );
  return found.length < 2 ? [] : found.sort((a, b) => REASONING_ORDER.indexOf(a) - REASONING_ORDER.indexOf(b));
}
// 档位记到模型上：手里这份（这一答的重发读的是它）与此刻表里那份（请求途中配置同步可能已把 store.profiles 整份换掉，
// 只写旧的就不落盘，与 spendTokens 同一个道理）。表里那份若已换了模型或被亲手填过，这份结果管不到它
/** @param {Profile} profile @param {string} key @param {string} levels */
function recordReasoningLevels(profile, key, levels) {
  const live = profiles().find(item => item.id === profile.id),
    targets = live && reasoningProbeKey(live) === key && !reasoningManual(live) ? [profile, live] : [profile];
  for (const item of targets) {
    item.reasoningLevels = levels;
    item.reasoningProbed = key;
  }
  saveStoreSoon();
}
// 接口拒绝了思考档位：认出它支持的几档记到模型上；认不出来就不动
/**
 * @param {Profile} profile
 * @param {Message} message
 */
function learnReasoningLevels(profile, message, sent) {
  const found = parseReasoningLevels(message, sent);
  if (!found.length) return false;
  const current = profileReasoningLevels(profile);
  if (found.length === current.length && found.every(level => current.includes(level))) return false;
  recordReasoningLevels(profile, reasoningProbeKey(profile), found.join(", "));
  return true;
}
// 选定模型时探一下它认哪几档：故意送一个不存在的档位（probe），接口若按 OpenAI 的样子报错，就把报错里列的几档记下；
// 报错说它压根不认识 reasoning_effort，记成 none（菜单上只剩「默认」）；接口照单全收（中转站常常忽略这个字段）就按通用四档列。
// 鉴权、网络之类别的错不算探过，下次再探。探过的记在 reasoningProbed 上——记的是「接口 + 地址 + 模型」三样合成的键，
// 换了模型、换了地址或接口类型都得重探；探测发出去之后模型被换了（探着 A 的时候切到 B），回来的结果作废，不往 B 上写。
// 档位有定表的接口（Anthropic、DashScope、ChatGPT 订阅）由桥接照表回同样的报错，不必另走一路。回值是探到的几档，没探成给 null
/** @param {Profile} profile 探的是这个模型此刻的身份 */
function reasoningProbeKey(profile) {
  return `${anthropicLike(profile) ? "anthropic" : "openai"}|${String(profile?.baseUrl || "").trim()}|${String(profile?.model || "").trim()}`;
}
// 探过、或用户亲手填过档位（记成 manual|键——手填的是定论，测试连接也不重探；换了模型才作废）。
// 旧版只有 reasoningLevels、没有探过的标记（那时的档位是手填或从报错里学来的）：当手填的，绑在当前身份上，首次探测不能把它冲掉
/** @param {Profile} profile */
function reasoningProbed(profile) {
  if (!profile?.model) return false;
  const key = reasoningProbeKey(profile);
  if (profile.reasoningLevels && !profile.reasoningProbed) {
    profile.reasoningProbed = `manual|${key}`;
    saveStoreSoon();
  }
  return profile.reasoningProbed === key || profile.reasoningProbed === `manual|${key}`;
}
// 这个身份上的档位是亲手填的（换了模型，先前手填的就不算数了）
/** @param {Profile} profile */
function reasoningManual(profile) {
  return !!profile?.model && profile.reasoningProbed === `manual|${reasoningProbeKey(profile)}`;
}
// 走到这里就是身份变了（或亲手要求重探）：此前记的档位是旧模型的，一律不沿用——接口照单全收就按通用四档，
// 不然旧模型的 none 会跟着新模型走，把一个认档位的模型永远标成不认
/**
 * @param {Profile} profile
 * @param {boolean} [force] 探过也再探（测试连接）；亲手填的由调用方拦下
 */
async function probeReasoningLevels(profile, force = false) {
  if (!profile?.model || (!force && reasoningProbed(profile))) return null;
  const key = reasoningProbeKey(profile);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await requestChat(profile, [{ role: "user", content: "。" }], controller.signal, {
      systemPrompt: "",
      maxTokens: 16,
      reasoning: "probe"
    });
    // 探着探着模型被换了：这份结果是旧模型的，作废；探着的时候用户亲手填了档位：手填的是定论，也作废。
    // 此刻表里那份也要看：配置同步可能刚把别处的改动带进来
    const live = profiles().find(item => item.id === profile.id);
    if ([profile, live].some(item => item && (reasoningProbeKey(item) !== key || reasoningManual(item)))) return null;
    let learned;
    if (response.ok) learned = REASONING_DEFAULT_LEVELS;
    else {
      const message = await describeResponseError(response);
      const found = parseReasoningLevels(message, "probe");
      if (found.length) learned = found;
      // 只有明说不认识这个字段的才记成不认；「Invalid reasoning_effort value」这种只是嫌 probe 不对、又没列它认的几档——
      // 按通用四档，撞了错再学。报错压根不提思考的（鉴权、限流）不算探过
      else if (!/reasoning_effort|reasoning|effort/i.test(message)) return null;
      else if (/unknown|unrecognized|unsupported|not support|不支持|不认识/i.test(message)) learned = [];
      else learned = REASONING_DEFAULT_LEVELS;
    }
    recordReasoningLevels(profile, key, learned.length ? learned.join(", ") : "none");
    return learned;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
/** @param {Profile} profile */
async function requestChat(profile, messages, signal, overrides = {}) {
  // 温度与输出上限同一条规矩：模型设置里留空就不传，由接口定——有的接口（OpenAI 的推理模型）只认默认值，传了反倒 400
  const parameters = {
    messages,
    systemPrompt: overrides.systemPrompt ?? "",
    temperature: Number.isFinite(profile.temperature) ? profile.temperature : undefined,
    // 输出上限：拟题、压缩、探档位这几处自己给；平时 OpenAI 兼容接口不传（服务端的默认就是模型的上限，
    // 手写一个反而常常把长回答截断），Anthropic 必填、按模型设置或默认值
    maxTokens:
      Number(overrides.maxTokens) > 0
        ? Number(overrides.maxTokens)
        : anthropicLike(profile)
          ? Number(profile.maxTokens) || DEFAULT_MAX_TOKENS
          : undefined
  };
  const extras = {
    ...(overrides.tools ? { tools: overrides.tools, ...(overrides.toolChoice ? { toolChoice: overrides.toolChoice } : {}) } : {}),
    // probe 是探档位时故意送的、不存在的一档，原样送出去让接口报错（见 probeReasoningLevels）
    ...(overrides.reasoning === "probe" ? { reasoning_effort: "probe" } : reasoningFields(profile, overrides.reasoning))
  };
  return bridgeFetch("/api/chat", JSON.stringify({ profile: profileForRequest(profile), ...parameters, ...extras }), signal);
}
/** @param {Endpoint} profile */
function profileForRequest(profile) {
  return { baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: profile.model, api: profileApi(profile) };
}
// 接口类型：设置里选的为准；旧配置没写的按地址认（anthropic.com）。桥接照它挑这一家的登记，不再自己认。
// 硅基流动说的是 OpenAI 兼容的话，单列一档只为在设置里标出名字、填好地址
/** @param {Endpoint} profile @returns {"openai"|"anthropic"|"chatgpt"|"siliconflow"} */
function profileApi(profile) {
  const api = String(profile?.api || "").toLowerCase();
  if (api === "anthropic" || api === "chatgpt" || api === "siliconflow") return api;
  return !api && /anthropic\.com/i.test(String(profile?.baseUrl || "")) ? "anthropic" : "openai";
}
const anthropicLike = profile => profileApi(profile) === "anthropic";
// 提示里有多少走了缓存，各家记法不一（OpenAI 系与桥接换过的 Anthropic、ChatGPT 订阅在 prompt_tokens_details，DeepSeek 叫 prompt_cache_hit_tokens），
// 归成一个 cached_tokens，一答累加，耗墨的浮签上标出几成走了缓存
function withCached(usage) {
  const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0) || 0;
  return { ...usage, cached_tokens: cached };
}
// 结束原因只认几个正常的：说完了（stop 及各家的别名）、要调工具。别的——vLLM 引擎里中止的 abort、出错的 error、
// 内容拦截——都是半途被掐，可它照样带着结束标志来，不查就把半截话当写完了。没给原因的（只有 [DONE]）照常收尾
const NORMAL_FINISH = new Set(["stop", "tool_calls", "function_call", "end_turn", "stop_sequence", "eos", "eos_token"]);
// 被拦下的（内容审查、拒答）重发也是一样，不自动接着写，原样报出
const REFUSED_FINISH = /content_filter|refusal|safety|sensitive|blocked|prohibited/i;
/** 这一轮的结束原因不对时给一个错（finish 上记着原因，读流的据此判接着写还是作罢）；正常给 null */
function finishFault(reason) {
  if (!reason || NORMAL_FINISH.has(reason)) return null;
  const why =
    reason === "length"
      ? "模型达到输出长度上限，答复尚未写完"
      : REFUSED_FINISH.test(reason)
        ? `接口拦下了这一轮（finish_reason: ${reason}）`
        : `接口异常收尾（finish_reason: ${reason}），答复尚未写完`;
  return Object.assign(Error(why), { finish: reason });
}
/** @param {Message} assistant 主消息、帮手，或拟题 / 压缩用的临时消息 */
// 思考写进正文开头 <think>…</think> 的接口：思考里提到这个标签本身（「`</think>` 标记」「"</think>"」）不是收尾。
// 真的结束标签后面跟换行或正文，不会被引号、反引号括着；紧挨着它们的跳过，不然后半截思考全落进正文
const THINK_QUOTES = "`'\"“”‘’「」";
/**
 * 第一个真的结束标签在哪，没有回 -1
 * @param {string} text @param {string} [before] text 之前的那一个字（流式里前面的已归入思绪）
 * @param {boolean} [final] text 之后不会再有字；不然标签恰在末尾时要等下一个字才认得清
 */
function thinkCloser(text, before = "", final = true) {
  for (let from = 0; ; ) {
    const end = text.indexOf("</think>", from),
      next = text[end + 8];
    if (end < 0 || (next === undefined && !final)) return -1;
    if (!THINK_QUOTES.includes((end ? text[end - 1] : before) || " ") && !THINK_QUOTES.includes(next || " ")) return end;
    from = end + 8;
  }
}
/** 整段的正文开头带 <think>…</think>：拆成思考与正文；不是这样的回 null @param {string} text */
function parseInlineThink(text) {
  const open = /^\s*<think>/.exec(text);
  if (!open) return null;
  const body = text.slice(open[0].length),
    end = thinkCloser(body);
  return end < 0 ? null : { reasoning: body.slice(0, end).trim(), content: body.slice(end + 8).replace(/^\s+/, "") };
}
async function readSse(response, assistant, { onFrame = null, live = true } = {}) {
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    scheduled = false,
    ended = false,
    finishReason = "";
  // 落墨节奏：正文不按网络分块一坨坨出现，而是每帧按积压量的一定比例匀速写出（积压越多写得越快，最多滞后零点几秒）；新写出的字带短暂渐显，末尾跟一支笔尖光标
  // live: false 的是不进页面的答复（拟题、撮要、审查）：一次落下，不按帧写、不为它存盘
  const paced = live && !inkMotionOff();
  let shown = paced ? assistant.content.length : Infinity,
    freshGroups = [];
  let closed = false;
  const frame = () => {
    scheduled = false;
    if (closed) return;
    const target = assistant.content.length,
      at = performance.now();
    if (!document.querySelector(`[data-message="${CSS.escape(assistant.id)}"]`)) {
      shown = target;
      freshGroups = [];
      inkReveal.delete(assistant.id);
      return;
    }
    if (paced) {
      const backlog = target - shown,
        step = backlog <= 0 ? 0 : document.hidden ? backlog : Math.min(backlog, Math.max(1, Math.ceil(backlog * REVEAL_RATE)));
      if (step > 0) {
        shown += step;
        freshGroups.unshift({ at, count: step });
      }
      freshGroups = freshGroups.filter(group => at - group.at < FRESH_MS);
      inkReveal.set(assistant.id, { shown, fresh: freshGroups.map(group => ({ count: group.count, age: at - group.at })) });
    }
    // 画法与整页重画是同一支笔（见 07-paint.js）：这里只报写到了哪，步骤没动
    paintMessage(assistant, { steps: false });
    if (onFrame) onFrame();
    else if (followBottom) scrollBottom();
    else syncJumpBottom();
    if (paced && shown < target) schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(frame);
  };
  const refresh = () => {
    if (!live) return;
    saveStoreSoon();
    schedule();
  };
  // 有些接口或中转站不走 reasoning_content，而是把思考直接写进正文开头的 <think>…</think>；这里把它剥出来，与 reasoning_content 一样归入折叠区。
  // 标签可能被分块切开：开头先攥着几个字符看清是不是标签，思考期间末尾留一截等结束标签（连同它前后各一个字，见 thinkCloser）。
  // 每次请求都从头看：工具循环的第二轮、续写时正文已有字，模型照样先写一段 <think>
  // 还有一种没有开头标签的：模板替模型写好了 <think>（DeepSeek 一类），或思考字段写完又在正文里接着想，正文里只见「思考…</think>答复」。
  // 与 vLLM 拆 DeepSeek 的规矩一样：这一轮正文里先出现一个裸的 </think>、前面没有 <think>，它之前的都是思考（bare）。
  // 挪走的思考不进历史，免得下一轮模型照着正文里的思考接着往正文里想
  const roundStart = assistant.content.length;
  const think = { mode: "probe", held: "", last: "", bare: true, scan: roundStart };
  const ingest = text => {
    // 刚收住思考：结束标签后的空行可能分几块到，正文从头一个字起
    if (think.mode === "gap") {
      text = text.replace(/^\s+/, "");
      if (!text) return;
      think.mode = "body";
    }
    if (think.mode === "body") {
      assistant.content += text;
      takeBareThink(false);
      return;
    }
    if (think.mode === "probe") {
      think.held += text;
      const lead = think.held.replace(/^\s+/, "");
      if (lead.startsWith("<think>")) {
        think.mode = "think";
        think.bare = false;
        think.held = "";
        ingest(lead.slice(7));
        return;
      }
      if ("<think>".startsWith(lead)) return;
      think.mode = "body";
      const held = think.held;
      think.held = "";
      ingest(held);
      return;
    }
    think.held += text;
    if (closeThink(false)) return;
    // 留下末尾一截：可能是被切开的结束标签，或一个整的、还要看下一个字才知道是不是被引号括着；再多留一个字给它前面那个
    const keep = Math.min(think.held.length, 9);
    moveThink(think.held.length - keep);
  };
  /** @param {number} upto 攥着的前这么多字归入思绪 */
  const moveThink = upto => {
    if (upto <= 0) return;
    assistant.reasoning = (assistant.reasoning || "") + think.held.slice(0, upto);
    think.last = think.held[upto - 1];
    think.held = think.held.slice(upto);
  };
  // 找真的那个结束标签，找到就收住思绪、余下的归正文。final：流到头了，标签后面不会再有字
  const closeThink = final => {
    const end = thinkCloser(think.held, think.last, final);
    if (end < 0) return false;
    moveThink(end);
    const rest = think.held.slice(8);
    think.held = "";
    think.mode = "gap";
    ingest(rest);
    return true;
  };
  // 这一轮正文里找裸的 </think>：找到就把这一轮它之前的正文挪进思绪（接在思考字段之后，空一行），余下的照常是正文。一轮只认一次
  const takeBareThink = final => {
    while (think.bare) {
      const from = think.scan,
        at = thinkCloser(assistant.content.slice(from), assistant.content[from - 1] || "", final);
      if (at < 0) {
        // 末尾留一截再看：可能是切开的标签，或整个标签还等下一个字
        think.scan = Math.max(think.scan, assistant.content.length - 8);
        return;
      }
      const end = from + at,
        said = assistant.content.slice(roundStart, end);
      // 写着的是一段带标签的代码（围栏还开着）：跳过这一个接着找
      if (inOpenFence(said)) {
        think.scan = end + 8;
        continue;
      }
      think.bare = false;
      if (said.includes("<think>")) return;
      const thought = said.trim(),
        before = String(assistant.reasoning || "");
      if (thought) assistant.reasoning = `${before}${before && !before.endsWith("\n\n") ? "\n\n" : ""}${thought}`;
      const rest = assistant.content.slice(end + 8);
      assistant.content = assistant.content.slice(0, roundStart);
      shown = Math.min(shown, assistant.content.length);
      think.mode = "gap";
      ingest(rest);
      return;
    }
  };
  const flushThink = () => {
    if (think.mode === "think" && closeThink(true)) return;
    if (think.held && think.mode === "think") assistant.reasoning = (assistant.reasoning || "") + think.held;
    else if (think.held) assistant.content += think.held;
    think.held = "";
    if (think.mode !== "think") takeBareThink(true);
    think.mode = "body";
  };
  // 流静默太久（桥接那头 Node 自带五分钟的读超时）：五分钟一个字节都没有就当断了，按中断处理、可续写
  const readChunk = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reader.cancel().catch(() => {});
        reject(Error("接口静默超过五分钟，连接已中断"));
      }, SSE_IDLE_MS);
      reader
        .read()
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  // 流被掐断（停止、补言改道）时这一段的帧循环到此为止：接下来的一轮另起一个，两个循环不能同时画一条消息
  try {
    // 已收到结束标志之后再断线：桥接那头没接住收了尾的流、上游在 stop 之后多送一个错误事件、静默超时，答复其实已经写完，
    // 不该当成断头再续写一遍。豁免只加在 pump 上——下面的 flushThink、结束标志与 finishFault 的判断照走，
    // 「长度截断即使带 DONE 也报错」「被拦下的不接」照旧；用户按停（AbortError）也照旧抛出。
    // 吞掉错误时把 reader 一并收掉：不取消就没人再读，桥接那头会替一个没人读的流一直转发、连接一直挂着，
    // 走总线时也靠取消才从 busJobs 里撤下并发出 /api/bus/cancel。连接已经断了再取消也无妨
    await pump().catch(error => {
      if (!ended || error.name === "AbortError") throw error;
      reader.cancel().catch(() => {});
    });
    // 收到 [DONE] 就退出了读取：把底层流收掉，桥接那头不替一个没人读的流继续转发
    if (ended) reader.cancel().catch(() => {});
    flushThink();
    if (!ended) throw Error("接口未发送结束标志，连接已中断");
    const fault = finishFault(finishReason);
    if (fault) throw fault;
  } catch (error) {
    flushThink();
    closed = true;
    inkReveal.delete(assistant.id);
    // 半途出错（流里的报错事件）：把还开着的连接收掉，别让桥接那头替一个没人读的流继续转发
    reader.cancel().catch(() => {});
    throw error;
  }
  async function pump() {
    while (true) {
      const { value, done } = await readChunk();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      // 流到头了：最后一段没跟换行的 data: 也得处理，否则末尾几个字或最终的 usage 就丢了
      if (done && buffer) {
        lines.push(buffer);
        buffer = "";
      }
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          ended = true;
          // 收到结束标志就不必再等读：上游不关连接（keep-alive、代理保持）时，原先会一直挂到静默超时，
          // 正文写完这边还显示生成中，拟题、压缩、补言都压着。finish_reason 处不能退——带 include_usage 时用量块在它之后才到
          break;
        }
        let failure = "";
        try {
          const json = JSON.parse(data);
          // 流里夹着的报错（限流、上游掐线、桥接补的「连接中断」）：不能当没看见让半截话冒充写完了——按中断处理，已写的留着、可续写
          if (json.error && !json.choices)
            failure = (typeof json.error === "string" ? json.error : json.error?.message) || "接口在作答途中返回了错误";
          const delta = json.choices?.[0]?.delta;
          if (json.choices?.[0]?.finish_reason) {
            finishReason = json.choices[0].finish_reason;
            ended = true;
          }
          const text = normalizeContent(delta?.content),
            reasoning = normalizeContent(delta?.reasoning_content ?? delta?.reasoning);
          if (reasoning) {
            assistant.reasoning = (assistant.reasoning || "") + reasoning;
            refresh();
          }
          if (text) {
            ingest(text);
            refresh();
          }
          // Anthropic、ChatGPT 订阅的思考块（带签名，或被遮蔽的只有密文）：这一轮带工具调用时要原样回传，记在消息上
          if (delta?.thinking_block?.signature || delta?.thinking_block?.redacted)
            (assistant.thinkingBlocks ||= []).push(delta.thinking_block);
          if (Array.isArray(delta?.tool_calls)) {
            for (const [at, call] of delta.tool_calls.entries()) {
              // 不带 index 的：id 说过是同一件的，就在已拟的几件里找它——多件并行、参数的续块交错送到时，末一件不一定是它；
              // 找不到、又是同一个数组里第二件起（或换了 id 的），另起一件（一件调用不会在同一个数组里续写自己）；
              // 余下没有 id 的续在末一件上——名字、参数都可能被切成几块到
              const slots = (assistant.toolCalls ||= []),
                last = slots.at(-1),
                // 数组可能有洞：index 乱序送到时（0、2、1），先建的那几件之间留着空位——回调拿到的 slot 可能是 undefined
                byId = call.id ? slots.findIndex(slot => slot?.id === call.id) : -1,
                index =
                  call.index ?? (byId >= 0 ? byId : at > 0 || (last && call.id && last.id) ? slots.length : Math.max(0, slots.length - 1)),
                slot = (slots[index] ||= { id: "", name: "", arguments: "" }),
                name = call.function?.name;
              if (call.id) slot.id = call.id;
              // 名字多是头一块给全，也有每块重发一遍的：重发的不再拼上
              if (name) slot.name = slot.name && name.startsWith(slot.name) ? name : slot.name + name;
              if (call.function?.arguments) slot.arguments += call.function.arguments;
            }
            refresh();
          }
          if (json.usage) assistant.usage = withCached(json.usage);
        } catch {}
        if (failure) throw Error(failure);
      }
      if (ended) break;
      if (done) break;
    }
  }
  // 流结束后把积压的字写完再返回，收尾和下一轮工具调用都等在这后面；标签页不可见时直接补齐
  while (paced && shown < assistant.content.length) {
    schedule();
    await new Promise(resolve => setTimeout(resolve, 16));
    if (document.hidden) shown = assistant.content.length;
  }
  inkReveal.delete(assistant.id);
  closed = true; // 之后迟到的帧一律作废：后台标签页里 rAF 会攒到切回来才跑，那时收尾已把图表画好，再用 suppressViz 重绘会把它们打回占位
}
function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => part?.text || part?.content || "").join("");
  return "";
}
// 报错的原话（中文）：存进消息、步骤的用它，显示时再 tr；直接显示的用 friendlyError
function bridgeErrorText(message) {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message))
    return "本机桥接已停止或无法访问。请重新运行 start.cmd 或 VS Code 任务「言：启动模型桥接」，并保持终端窗口开启。";
  return String(message).slice(0, 500);
}
function friendlyError(message) {
  return tr(bridgeErrorText(message));
}
