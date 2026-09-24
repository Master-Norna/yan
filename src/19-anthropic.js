// 言 · Anthropic 适配：页面与桥接内部一律用 OpenAI 的格式（消息、工具、流式分块）；接 Anthropic 时在这里换一层——
// 把 OpenAI 格式的请求换成 Messages API 的，再把它的事件流换回 OpenAI 风格的 SSE 分块，其余代码一字不动。
// 这一段两处跑：浏览器里随 support.js 拼进闭包（直连时用），桥接里由 server.js require（经桥接时用）；不能碰 DOM
const ANTHROPIC_VERSION = "2023-06-01";
// 老模型（4.5 及以前、Haiku、认不出型号的）：思考档位换成思考预算（token）；预算得小于 max_tokens，不够就把 max_tokens 抬上去
const ANTHROPIC_BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 16384, xhigh: 32768, max: 65536 };
// 模型代际：4.6 起思考改为 adaptive、深浅由 effort 定（预算在 4.7 起一律 400）；4.7 起不收 temperature（也是 400），
// 思绪默认不回、要明说 summarized；5 起不带 thinking 也照样在想。认不出型号的按老模型走
function anthropicGeneration(model) {
  const m = String(model || "")
    .toLowerCase()
    .match(/claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d)(?!\d))?/);
  const version = m ? Number(m[2]) + Number(m[3] || 0) / 10 : 0;
  return { adaptive: !!m && m[1] !== "haiku" && version >= 4.6, noSampling: version >= 4.7, thinksByDefault: version >= 5, version };
}
// 是不是 Anthropic 的接口：模型上明说的优先，没说就看地址
function anthropicLike(profile) {
  const api = String(profile?.api || "").toLowerCase();
  if (api) return api === "anthropic";
  return /anthropic\.com/i.test(String(profile?.baseUrl || ""));
}
// Base URL 可以填到根、到 /v1 或到 /v1/messages，都归到根再拼
function anthropicEndpoint(baseUrl, suffix = "/v1/messages") {
  const url = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1(\/messages)?$/i, "");
  if (!/^https?:\/\//i.test(url)) throw Error("Base URL 只支持 http 或 https");
  return `${url}${suffix}`;
}
function anthropicHeaders(apiKey, browser = false) {
  return {
    "Content-Type": "application/json",
    "x-api-key": String(apiKey || ""),
    "anthropic-version": ANTHROPIC_VERSION,
    ...(browser ? { "anthropic-dangerous-direct-browser-access": "true" } : {})
  };
}
// 用户消息里的一段内容换成内容块：文字、图片（data: 或 http 地址）、PDF（按文件名认）；别的文件只能以一行说明代替
function anthropicUserBlocks(content) {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text") {
      if (part.text) blocks.push({ type: "text", text: String(part.text) });
    } else if (part.type === "image_url") {
      const url = String(part.image_url?.url || ""),
        data = url.match(/^data:([^;,]+);base64,(.*)$/s);
      if (data) blocks.push({ type: "image", source: { type: "base64", media_type: data[1], data: data[2] } });
      else if (/^https?:\/\//i.test(url)) blocks.push({ type: "image", source: { type: "url", url } });
    } else if (part.type === "file") {
      const name = String(part.file?.filename || "");
      if (/\.pdf$/i.test(name) && part.file?.file_data)
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: String(part.file.file_data) } });
      else blocks.push({ type: "text", text: `[附件 ${name || "文件"}：此接口不接受该格式的原件]` });
    }
  }
  return blocks;
}
// OpenAI 格式的请求体 → Messages API 的请求体。system 单列；user / assistant 交替，相邻同角色并成一条（工具结果与紧接的补言都进同一条 user）；
// 助手一轮里的思考块原样带回（带工具调用的那一轮，Anthropic 要求回传）；空的 assistant 略去
function anthropicRequest(payload) {
  const system = [],
    messages = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const message of payload.messages || []) {
    const role = message?.role;
    if (role === "system") {
      const text =
        typeof message.content === "string"
          ? message.content
          : anthropicUserBlocks(message.content)
              .map(b => b.text || "")
              .join("\n");
      if (text) system.push(text);
    } else if (role === "user") push("user", anthropicUserBlocks(message.content));
    else if (role === "assistant") {
      const blocks = [];
      for (const block of Array.isArray(message.thinking_blocks) ? message.thinking_blocks : [])
        if (block?.thinking && block.signature) blocks.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
      const text = typeof message.content === "string" ? message.content : "";
      if (text.trim()) blocks.push({ type: "text", text });
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        let input = {};
        try {
          input = JSON.parse(call.function?.arguments || "{}");
        } catch {}
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function?.name || "",
          input: input && typeof input === "object" ? input : {}
        });
      }
      push("assistant", blocks);
    } else if (role === "tool")
      push("user", [{ type: "tool_result", tool_use_id: message.tool_call_id, content: String(message.content ?? "") }]);
  }
  if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "（接上文）" }] });
  const raw = String(payload.reasoning_effort || "").toLowerCase(),
    level = raw && raw !== "none" && raw !== "off" ? raw : "",
    generation = anthropicGeneration(payload.model),
    maxTokens = Math.max(16, Number(payload.max_tokens) || 32000);
  const body = { model: payload.model, max_tokens: maxTokens, messages, stream: true };
  // 提示缓存：系统提示末尾一处（工具定义连同系统提示，最稳的一段），整段对话最后一块一处（下一轮开口时此前的往来都从缓存读）。
  // 太短的前缀不缓存也不报错；思考块上不能放标记，往前找
  if (system.length) body.system = [{ type: "text", text: system.join("\n\n"), cache_control: { type: "ephemeral" } }];
  const tail = [...messages.at(-1).content].reverse().find(block => block.type !== "thinking" && block.type !== "redacted_thinking");
  if (tail) tail.cache_control = { type: "ephemeral" };
  if (generation.adaptive) {
    if (level || generation.thinksByDefault)
      body.thinking = { type: "adaptive", ...(generation.noSampling ? { display: "summarized" } : {}) };
    // effort 只认 low…max；4.6 还没有 xhigh
    if (level) body.output_config = { effort: level === "minimal" ? "low" : level === "xhigh" && !generation.noSampling ? "high" : level };
    if (!generation.noSampling && !body.thinking && payload.temperature !== undefined)
      body.temperature = Math.max(0, Math.min(1, Number(payload.temperature)));
  } else {
    const budget = level ? ANTHROPIC_BUDGETS[level] || 8192 : 0;
    // 开了思考 temperature 只能是 1：不传
    if (budget) {
      body.thinking = { type: "enabled", budget_tokens: budget };
      body.max_tokens = Math.max(maxTokens, budget + 4096);
    } else if (payload.temperature !== undefined) body.temperature = Math.max(0, Math.min(1, Number(payload.temperature)));
  }
  if (Array.isArray(payload.tools) && payload.tools.length)
    body.tools = payload.tools.map(tool => ({
      name: tool.function?.name || "",
      description: tool.function?.description || "",
      input_schema: tool.function?.parameters || { type: "object", properties: {} }
    }));
  return body;
}
// Messages API 的事件流 → OpenAI 风格的 SSE 分块（data: {...}\n\n，末尾 [DONE]）。
// text_delta → content，thinking_delta → reasoning_content，tool_use 块 → tool_calls（按出现顺序编号），思考块收尾时整块带上签名
// 作 thinking_block 交给页面（带工具调用的那一轮要回传）；message_delta 里的用量换成 usage
function anthropicToOpenAiStream(model = "") {
  const decoder = new TextDecoder(),
    encoder = new TextEncoder(),
    id = `chatcmpl-${Date.now().toString(36)}`;
  let buffer = "",
    event = "",
    tools = 0,
    stopped = false;
  const blocks = new Map(),
    usage = { prompt_tokens: 0, completion_tokens: 0 };
  const chunk = (delta, extra = {}, finish = null) =>
    encoder.encode(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`
    );
  const handle = (controller, name, data) => {
    if (name === "message_start") {
      const u = data.message?.usage || {};
      usage.prompt_tokens =
        Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
      if (data.message?.model) model = data.message.model;
    } else if (name === "content_block_start") {
      const block = { ...(data.content_block || {}), text: "", json: "", signature: "" };
      blocks.set(data.index, block);
      if (block.type === "tool_use") {
        block.slot = tools++;
        controller.enqueue(
          chunk({ tool_calls: [{ index: block.slot, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] })
        );
      }
    } else if (name === "content_block_delta") {
      const block = blocks.get(data.index),
        delta = data.delta || {};
      if (delta.type === "text_delta" && delta.text) controller.enqueue(chunk({ content: delta.text }));
      else if (delta.type === "thinking_delta" && delta.thinking) {
        if (block) block.text += delta.thinking;
        controller.enqueue(chunk({ reasoning_content: delta.thinking }));
      } else if (delta.type === "input_json_delta" && block) {
        block.json += delta.partial_json || "";
        if (delta.partial_json)
          controller.enqueue(chunk({ tool_calls: [{ index: block.slot, function: { arguments: delta.partial_json } }] }));
      } else if (delta.type === "signature_delta" && block) block.signature += delta.signature || "";
    } else if (name === "content_block_stop") {
      const block = blocks.get(data.index);
      if (block?.type === "thinking" && block.signature)
        controller.enqueue(chunk({ thinking_block: { thinking: block.text, signature: block.signature } }));
    } else if (name === "message_delta") {
      if (data.usage?.output_tokens !== undefined) usage.completion_tokens = Number(data.usage.output_tokens) || 0;
      const reason = data.delta?.stop_reason,
        finish = reason === "tool_use" ? "tool_calls" : reason === "max_tokens" ? "length" : reason ? "stop" : null;
      controller.enqueue(chunk({}, { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } }, finish));
    } else if (name === "message_stop") {
      stopped = true;
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    } else if (name === "error") {
      // 流到半途的报错（overloaded_error 最常见）：按 OpenAI 流里的报错格式交出去，页面据此按「连接中断」处理、稍候接着写，
      // 而不是把一句报错写进正文、当这一答写完了
      stopped = true;
      const message = [data.error?.type, data.error?.message].filter(Boolean).join("：") || "未知错误";
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: `接口在作答途中出错：${message}` } })}\n\n`));
    }
  };
  const feed = (controller, text) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        try {
          const data = JSON.parse(line.slice(5).trim());
          handle(controller, event || data.type, data);
        } catch {}
      } else if (!line) event = "";
    }
  };
  return new TransformStream({
    transform(bytes, controller) {
      feed(controller, decoder.decode(bytes, { stream: true }));
    },
    flush(controller) {
      feed(controller, decoder.decode());
      if (buffer) feed(controller, "\n");
      if (!stopped) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    }
  });
}
// 桥接 require 这一段后从 globalThis.YAN_ANTHROPIC 取；不写 module.exports——那会让类型检查把这一段当成独立模块，页面里就找不到这些名字
globalThis.YAN_ANTHROPIC = { anthropicLike, anthropicEndpoint, anthropicHeaders, anthropicRequest, anthropicToOpenAiStream };
