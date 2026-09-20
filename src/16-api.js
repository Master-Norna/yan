// 言 · 接口：用量估算、请求、SSE 读取、错误说明
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function estimateText(text) {
  const chinese = (text.match(/[㐀-鿿]/g) || []).length;
  return chinese + Math.ceil((text.length - chinese) / 4);
}
// 上下文过重的门槛：每一答的用量标注超过它就转为印色提醒
const CONTEXT_HEAVY = 24000;
function estimateTokens(messages) {
  let score = 0;
  for (const message of messages) {
    score += 4;
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
  return !!c && quotaExhausted(activeProfile());
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
// 思考强度：OpenAI 系接口走 reasoning_effort；DashScope 兼容模式走 enable_thinking / thinking_budget。留空则不带字段，由接口自己定。
// 各家接受的档位不一样（有的只有 low / medium / xhigh，有的多一个 minimal 或 max）：模型配置里可填「思考档位」，
// 没填就按四档（低 / 中 / 高 / 最高）列；只认三档的接口拒绝某个档位时，从它的报错里读出它认的那几档记到模型上，
// 把这一问换成最接近的一档重发一次，此后菜单只列它认的。菜单上没有「关」：愿意接 Key 的人不至于连思考都不愿开，
// 要它少想就选「低」，旧数据里存的「关」按「默认」看
const REASONING_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
  REASONING_NAMES = { "": "默认", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" },
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
  level = normalizeReasoning(level);
  if (!level) return {};
  if (/dashscope|aliyuncs/i.test(profile.baseUrl || ""))
    return {
      enable_thinking: true,
      thinking_budget: { minimal: 1024, low: 2048, medium: 8192, high: 32768, xhigh: 65536, max: 81920 }[level] || 8192
    };
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
  profile.reasoningLevels = found.join(", ");
  // 从报错里学到的就是这个身份的定论，不必再探
  profile.reasoningProbed = reasoningProbeKey(profile);
  persistServerProfile(profile);
  saveStoreSoon();
  return true;
}
// 选定模型时探一下它认哪几档：故意送一个不存在的档位（probe），接口若按 OpenAI 的样子报错，就把报错里列的几档记下；
// 报错说它压根不认识 reasoning_effort，记成 none（菜单上只剩「默认」）；接口照单全收（中转站常常忽略这个字段）就按通用四档列。
// 鉴权、网络之类别的错不算探过，下次再探。探过的记在 reasoningProbed 上——记的是「接口 + 地址 + 模型」三样合成的键，
// 换了模型、换了地址或接口类型都得重探；探测发出去之后模型被换了（探着 A 的时候切到 B），回来的结果作废，不往 B 上写。
// Anthropic 与 DashScope 的档位是换算成预算送的，没有可探的枚举，直接算探过。回值是探到的几档，没探成给 null
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
    persistServerProfile(profile);
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
/** @param {Profile} profile */
async function probeReasoningLevels(profile) {
  if (!profile?.model || reasoningProbed(profile)) return null;
  const key = reasoningProbeKey(profile);
  if (anthropicLike(profile) || /dashscope|aliyuncs/i.test(profile.baseUrl || "")) {
    profile.reasoningLevels = "";
    profile.reasoningProbed = key;
    persistServerProfile(profile);
    saveStoreSoon();
    return profileReasoningLevels(profile);
  }
  if (apiBase === null && profile.source === "server") return null;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await requestChat(profile, [{ role: "user", content: "。" }], controller.signal, {
      systemPrompt: "",
      maxTokens: 16,
      reasoning: "probe"
    });
    // 探着探着模型被换了：这份结果是旧模型的，作废；探着的时候用户亲手填了档位：手填的是定论，也作废
    if (reasoningProbeKey(profile) !== key || reasoningManual(profile)) return null;
    let learned;
    if (response.ok) learned = REASONING_DEFAULT_LEVELS;
    else {
      const data = await response.json().catch(() => ({})),
        message = (typeof data.error === "string" ? data.error : data.error?.message) || "";
      const found = parseReasoningLevels(message, "probe");
      if (found.length) learned = found;
      // 只有明说不认识这个字段的才记成不认；「Invalid reasoning_effort value」这种只是嫌 probe 不对、又没列它认的几档——
      // 按通用四档，撞了错再学。报错压根不提思考的（鉴权、限流）不算探过
      else if (!/reasoning_effort|reasoning|effort/i.test(message)) return null;
      else if (/unknown|unrecognized|unsupported|not support|不支持|不认识/i.test(message)) learned = [];
      else learned = REASONING_DEFAULT_LEVELS;
    }
    profile.reasoningLevels = learned.length ? learned.join(", ") : "none";
    profile.reasoningProbed = key;
    persistServerProfile(profile);
    saveStoreSoon();
    return learned;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
// 经桥接的请求头：用桥接预设的模型时带上会话令牌（见 server.js 的 SESSION_TOKEN）
/** @param {Profile} profile */
function bridgeHeaders(profile) {
  return {
    "Content-Type": "application/json",
    ...(profile?.source === "server" && bootstrap.token ? { "X-Yan-Session": bootstrap.token } : {})
  };
}
/** @param {Profile} profile */
async function requestChat(profile, messages, signal, overrides = {}) {
  const parameters = {
    messages,
    systemPrompt: overrides.systemPrompt ?? (profile.systemPrompt || ""),
    temperature: Number(overrides.temperature ?? profile.temperature ?? 0.7),
    maxTokens: Number(overrides.maxTokens ?? profile.maxTokens ?? DEFAULT_MAX_TOKENS)
  };
  const extras = {
    ...(overrides.tools ? { tools: overrides.tools } : {}),
    ...(overrides.enableSearch ? { enable_search: true } : {}),
    // probe 是探档位时故意送的、不存在的一档，原样送出去让接口报错（见 probeReasoningLevels）
    ...(overrides.reasoning === "probe" ? { reasoning_effort: "probe" } : reasoningFields(profile, overrides.reasoning))
  };
  if (apiBase !== null)
    return fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: bridgeHeaders(profile),
      body: JSON.stringify({ profile: profileForRequest(profile), ...parameters, ...extras }),
      signal
    });
  if (profile.source === "server") throw Error("本机桥接未启动");
  const payload = {
    model: profile.model,
    messages: parameters.systemPrompt ? [{ role: "system", content: parameters.systemPrompt }, ...messages] : messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: parameters.temperature,
    max_tokens: parameters.maxTokens,
    ...extras
  };
  // 直连 Anthropic：请求换成 Messages API 的，回来的事件流换回 OpenAI 风格，后面的读法不变
  if (anthropicLike(profile)) {
    const upstream = await fetch(anthropicEndpoint(profile.baseUrl), {
      method: "POST",
      headers: anthropicHeaders(profile.apiKey, true),
      body: JSON.stringify(anthropicRequest(payload)),
      signal
    });
    if (!upstream.ok || !upstream.body) return upstream;
    return new Response(upstream.body.pipeThrough(anthropicToOpenAiStream(profile.model)), {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" }
    });
  }
  payload.messages = payload.messages.map(m => (m.thinking_blocks ? { ...m, thinking_blocks: undefined } : m));
  return fetch(completionEndpoint(profile.baseUrl), {
    method: "POST",
    headers: directHeaders(profile),
    body: JSON.stringify(payload),
    signal
  });
}
// 直连时列模型的地址与请求头：Anthropic 与 OpenAI 兼容的各一套
/** @param {Profile} profile */
function directModelsRequest(profile) {
  return anthropicLike(profile)
    ? { url: anthropicEndpoint(profile.baseUrl, "/v1/models"), headers: anthropicHeaders(profile.apiKey, true) }
    : { url: modelsEndpoint(profile.baseUrl), headers: directHeaders(profile) };
}
function completionEndpoint(baseUrl) {
  const url = String(baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!/^https?:\/\//i.test(url)) throw Error("Base URL 只支持 http 或 https");
  return /\/chat\/completions$/i.test(url) ? url : `${url}/chat/completions`;
}
function modelsEndpoint(baseUrl) {
  const url = new URL(String(baseUrl || "").trim());
  url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "")}/models`;
  return url.href;
}
/** @param {Profile} profile */
function directHeaders(profile) {
  return { "Content-Type": "application/json; charset=utf-8", ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}) };
}
/** @param {Profile} profile */
function profileForRequest(profile) {
  return profile.source === "server"
    ? { source: "server" }
    : { source: "custom", baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: profile.model, api: profile.api || "" };
}
/** @param {Message} assistant 主消息、帮手，或拟题 / 压缩用的临时消息 */
async function readSse(response, assistant, { onFrame = null } = {}) {
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    scheduled = false;
  // 落墨节奏：正文不按网络分块一坨坨出现，而是每帧按积压量的一定比例匀速写出（积压越多写得越快，最多滞后零点几秒）；新写出的字带短暂渐显，末尾跟一支笔尖光标
  const paced = !inkMotionOff();
  let shown = paced ? assistant.content.length : Infinity,
    freshGroups = [];
  let closed = false;
  const frame = () => {
    scheduled = false;
    if (closed) return;
    const target = assistant.content.length,
      at = performance.now();
    const block = document.querySelector(`[data-message="${assistant.id}"] .assistant-block`);
    if (!block) {
      shown = target;
      freshGroups = [];
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
    }
    const visible = paced ? assistant.content.slice(0, shown) : assistant.content;
    const base = trailBase(assistant),
      host = trailLiveHost(block, assistant) || block,
      rbase = trailReasoningBase(assistant),
      thought = String(assistant.reasoning || "").slice(rbase);
    if (thought.trim()) {
      let details = host.querySelector(":scope > .reasoning");
      if (!details) {
        host.insertAdjacentHTML("afterbegin", reasoningHtml(assistant, thought));
        details = host.querySelector(":scope > .reasoning");
        details.classList.add("is-new");
      }
      const body = details.querySelector(".reasoning-body");
      body.textContent = thought;
      // 按轮判断在写与否；新一轮的思绪来了就再摊开，正文起笔即收——与行迹一样：运行中打开，运行完关闭
      const live = reasoningLive({ ...assistant, content: visible });
      details.dataset.state = live ? "live" : "done";
      if (details.open && body._follow !== false) body.scrollTop = body.scrollHeight; // 软跟踪：没往上翻就跟着最新一行走
      if (!assistant.reasoningTouched) {
        if (!live && details.open) settleDetails(details, false);
        else if (live && !details.open) settleDetails(details, true);
      }
    }
    if (!visible) {
      if (!block.querySelector(".thinking")) insertAboveChangeBar(block, `<div class="thinking">正在凝神</div>`);
    } else if (visible.length <= base) {
      /* 新一轮尚未起笔 */
    } else {
      let markdown = host.querySelector(":scope > .markdown");
      if (!markdown?.querySelector(".md-tail")) {
        block.querySelector(".thinking")?.remove();
        markdown?.remove();
        insertAboveChangeBar(
          host,
          `<div class="markdown" data-cut="${base}" data-base="${base}"><div class="md-stable"></div><div class="md-tail"></div></div>`
        );
        markdown = host.querySelector(":scope > .markdown");
      }
      // 已经收尾的段落只渲染一次追加进 md-stable，每帧只重绘最后一段，长回复不会越来越卡；已渲染位置记在 data-cut 上，跨工具轮次也不会重复
      let renderedCut = Number(markdown.dataset.cut || 0);
      const cut = stableCut(visible);
      if (cut > renderedCut) {
        const stable = markdown.querySelector(".md-stable");
        stable.insertAdjacentHTML("beforeend", renderMarkdown(visible.slice(renderedCut, cut)));
        renderedCut = cut;
        markdown.dataset.cut = String(cut);
        renderEnhancements(stable);
      }
      const tail = markdown.querySelector(".md-tail");
      suppressViz = true;
      try {
        paintTail(tail, renderMarkdown(visible.slice(renderedCut)));
      } finally {
        suppressViz = false;
      }
      decorateTail(
        tail,
        freshGroups.map(group => ({ count: group.count, age: at - group.at }))
      );
    }
    paintDrafting(host, assistant);
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
    saveStoreSoon();
    schedule();
  };
  // 有些接口或中转站不走 reasoning_content，而是把思考直接写进正文开头的 <think>…</think>；这里把它剥出来，与 reasoning_content 一样归入折叠区。
  // 标签可能被分块切开：开头先攥着几个字符看清是不是标签，思考期间末尾留 7 个字符等结束标签
  const think = { mode: assistant.content ? "body" : "probe", held: "" };
  const ingest = text => {
    if (think.mode === "body") {
      assistant.content += text;
      return;
    }
    if (think.mode === "probe") {
      think.held += text;
      const lead = think.held.replace(/^\s+/, "");
      if (lead.startsWith("<think>")) {
        think.mode = "think";
        think.held = "";
        ingest(lead.slice(7));
        return;
      }
      if ("<think>".startsWith(lead)) return;
      think.mode = "body";
      assistant.content += think.held;
      think.held = "";
      return;
    }
    think.held += text;
    const end = think.held.indexOf("</think>");
    if (end >= 0) {
      assistant.reasoning = (assistant.reasoning || "") + think.held.slice(0, end);
      think.mode = "body";
      const rest = think.held.slice(end + 8).replace(/^\s+/, "");
      think.held = "";
      if (rest) assistant.content += rest;
      return;
    }
    const keep = Math.min(think.held.length, 7);
    assistant.reasoning = (assistant.reasoning || "") + think.held.slice(0, think.held.length - keep);
    think.held = think.held.slice(think.held.length - keep);
  };
  const flushThink = () => {
    if (!think.held) return;
    if (think.mode === "think") assistant.reasoning = (assistant.reasoning || "") + think.held;
    else assistant.content += think.held;
    think.held = "";
    think.mode = "body";
  };
  // 流被掐断（停止、补言改道）时这一段的帧循环到此为止：接下来的一轮另起一个，两个循环不能同时画一条消息
  try {
    await pump();
  } catch (error) {
    closed = true;
    throw error;
  }
  async function pump() {
    while (true) {
      const { value, done } = await reader.read();
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
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
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
          // Anthropic 的思考块（带签名）：这一轮带工具调用时要原样回传，记在消息上
          if (delta?.thinking_block?.signature) (assistant.thinkingBlocks ||= []).push(delta.thinking_block);
          if (Array.isArray(delta?.tool_calls)) {
            for (const call of delta.tool_calls) {
              const slot = ((assistant.toolCalls ||= [])[call.index ?? 0] ||= { id: "", name: "", arguments: "" });
              if (call.id) slot.id = call.id;
              if (call.function?.name) slot.name += call.function.name;
              if (call.function?.arguments) slot.arguments += call.function.arguments;
            }
            refresh();
          }
          if (json.usage) assistant.usage = json.usage;
        } catch {}
      }
      if (done) break;
    }
  }
  flushThink();
  // 流结束后把积压的字写完再返回，收尾和下一轮工具调用都等在这后面；标签页不可见时直接补齐
  while (paced && shown < assistant.content.length) {
    schedule();
    await new Promise(resolve => setTimeout(resolve, 16));
    if (document.hidden) shown = assistant.content.length;
  }
  closed = true; // 之后迟到的帧一律作废：后台标签页里 rAF 会攒到切回来才跑，那时收尾已把图表画好，再用 suppressViz 重绘会把它们打回占位
}
// 把尾段末尾最近写出的字按帧分组包进 .ink-fresh（用负 animation-delay 对齐各自的年龄，重绘也不会重放），并在最后一个字后放一支光标
function decorateTail(tail, groups) {
  if (tail.querySelector(".viz-pending")) return;
  const nodes = [];
  const walker = document.createTreeWalker(tail, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
  let node = nodes.pop();
  if (!node) return;
  const cursor = document.createElement("span");
  cursor.className = "ink-cursor";
  node.after(cursor);
  for (const group of groups) {
    let need = group.count;
    while (need > 0 && node) {
      const text = node.data,
        take = Math.min(need, text.length),
        span = document.createElement("span");
      span.className = "ink-fresh";
      span.style.animationDelay = `-${Math.round(group.age)}ms`;
      span.textContent = text.slice(text.length - take);
      node.data = text.slice(0, text.length - take);
      node.after(span);
      need -= take;
      if (!node.data) {
        node.remove();
        node = nodes.pop();
      }
    }
    if (!node) break;
  }
}
function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => part?.text || part?.content || "").join("");
  return "";
}
function extractContent(data) {
  return normalizeContent(data?.choices?.[0]?.message?.content);
}
function friendlyError(message) {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message))
    return apiBase === null
      ? "浏览器无法直连该接口，通常是接口未开放 CORS。请运行 start.cmd 或 VS Code 任务「言：启动模型桥接」后重试。"
      : "本机桥接已停止或无法访问。请重新运行 start.cmd 或 VS Code 任务「言：启动模型桥接」，并保持终端窗口开启。";
  return String(message).slice(0, 500);
}
function scrollBottom() {
  const el = $("#chatScroll");
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 1) {
    autoScrolling = false;
    return;
  }
  autoScrolling = true;
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => {
    autoScrolling = false;
  });
}
