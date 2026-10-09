"use strict";
// 言 · ChatGPT 订阅：走 OpenAI 给开源与本机应用开的「Sign in with ChatGPT」——在浏览器里授权，额度记在用户的 ChatGPT 订阅上，
// 请求直发公开的 Responses API（api.openai.com/v1/responses），带言自己的提示与工具，不经 Codex 那一层。
// 与 Anthropic 适配一个路数：页面照旧送 OpenAI 格式，这里把请求换成 Responses 的，事件流再换回 chat.completions 的分块（登记的样子见 index.js 开头）。
// 凭证只在桥接里：存储根下的「ChatGPT 登录.json」，不进页面、不进备份
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { jsonRoute, writeAtomic } = require("../http.js");

// 两处地址可由环境变量换掉，只为测试：起一个假的授权与接口服务
const AUTH = (process.env.YAN_CHATGPT_AUTH || "https://auth.openai.com").replace(/\/+$/, "");
const API = (process.env.YAN_CHATGPT_API || "https://api.openai.com/v1").replace(/\/+$/, "");
// 令牌的受众：授权、换令牌、换新都带它，固定是公开接口的这个地址
const RESOURCE = "https://api.openai.com/v1";
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
// 头一回登录用这个入口登记，回调里发下这台机器自己的 client_id（oaiapp_…），此后都用它
const FIRST_CLIENT = "dynamic_agent_client";
// 换新令牌时回这些，说明这份登录不能再用了：清掉，请用户重新登录；别的（网络、5xx）只是这一回没换成，凭证留着
const DEAD_GRANTS = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused"
]);
// 订阅额度那边的几种拒绝，换成用户看得懂的话
const HINTS = {
  subscription_sharing_usage_limit_exceeded: "ChatGPT 订阅给言的额度用完了，可在 ChatGPT 设置 → 用量里查看或调整",
  subscription_sharing_user_not_eligible: "这个 ChatGPT 账号的套餐不能把额度用在别的应用里",
  subscription_sharing_invalid_user: "ChatGPT 的授权已被收回，请到「设置 → 模型」里重新登录",
  subscription_sharing_unsupported_capability: "ChatGPT 订阅不支持这一问里的某样东西（模型、工具或附件）"
};

const base64url = buffer => Buffer.from(buffer).toString("base64url");
function jwtClaims(jwt) {
  try {
    return JSON.parse(Buffer.from(String(jwt).split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
}
/** @param {string} code @param {string} message */
function hinted(code, message) {
  return HINTS[code] ? `${HINTS[code]}（${code}）` : message;
}
// 一个页面：授权完回到这里，告诉用户可以关掉
function landing(title, line) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title} · 言</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fbfaf6;color:#292724;font-family:"Noto Serif SC","Songti SC","STSong",serif}@media(prefers-color-scheme:dark){body{background:#1e1c19;color:#e6e1d6}}main{text-align:center;letter-spacing:.06em}.seal{display:inline-grid;place-items:center;width:34px;height:34px;border:1px solid #9b5540;color:#9b5540;font-size:18px;transform:rotate(-3deg)}h1{margin:18px 0 8px;font-weight:500;font-size:24px}p{margin:0;opacity:.6;font-size:13px}</style></head><body><main><span class="seal">言</span><h1>${title}</h1><p>${line}</p></main></body></html>`;
}

/** @param {{ home: () => string }} options 存储根 */
module.exports = function createChatgpt({ home }) {
  const file = () => path.join(home(), "ChatGPT 登录.json");
  /** @returns {{ hostId?: string, clientId?: string, email?: string, tokens?: { access_token: string, refresh_token: string, id_token?: string, expires_at: number } }} */
  function load() {
    try {
      return JSON.parse(fs.readFileSync(file(), "utf8")) || {};
    } catch {
      return {};
    }
  }
  const save = data => writeAtomic(file(), JSON.stringify(data, null, 1));
  /** @param {Record<string, any>} fresh 令牌端点的回应 @param {Record<string, any>} [kept] 先前的那份 */
  const tokensOf = (fresh, kept = {}) => ({
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token || kept.refresh_token,
    ...(fresh.id_token || kept.id_token ? { id_token: fresh.id_token || kept.id_token } : {}),
    expires_at: Date.now() + (Number(fresh.expires_in) || 3600) * 1000
  });
  async function tokenRequest(form) {
    const response = await fetch(`${AUTH}/api/accounts/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...form, resource: RESOURCE }),
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Object.assign(Error(data.error_description || data.error || `换令牌失败（${response.status}）`), { code: data.error });
    return data;
  }

  // 换新一次只走一回：几段对话同时开工时不能各拿旧刷新令牌去换（刷新令牌换一次就作废旧的，第二个会被当成重放）
  let refreshing = null;
  async function accessToken() {
    const auth = load();
    if (!auth.tokens?.access_token) throw Error("还没登录 ChatGPT：到「设置 → 模型」里点「登录」");
    if (auth.tokens.expires_at - Date.now() > 5 * 60 * 1000) return auth.tokens.access_token;
    refreshing ||= (async () => {
      try {
        const fresh = await tokenRequest({
          grant_type: "refresh_token",
          client_id: auth.clientId,
          refresh_token: auth.tokens.refresh_token
        });
        save({ ...auth, tokens: tokensOf(fresh, auth.tokens) });
        return fresh.access_token;
      } catch (error) {
        if (!DEAD_GRANTS.has(error.code)) throw Error(`ChatGPT 的登录凭证没能换新：${error.message}`);
        const { tokens, ...rest } = auth;
        save(rest);
        throw Error("ChatGPT 的登录已失效，请到「设置 → 模型」里重新登录");
      }
    })().finally(() => (refreshing = null));
    return refreshing;
  }
  // 缓存键另放进请求头的 session_id：后端照它把请求送到存着前文缓存的那一处，光有请求体里的 prompt_cache_key 一回也不中
  // （2026-10-09 实测：同一前缀隔半分钟再发，带它读到 99%，不带一直是 0）
  async function headers(_config, body) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await accessToken()}`,
      ...(body?.prompt_cache_key ? { session_id: body.prompt_cache_key } : {})
    };
  }

  // 登录：桥接在 127.0.0.1 上临时开一个回调口，用系统浏览器打开授权页；用户点了同意，浏览器带着 code 回到回调口，
  // 桥接拿 code 换令牌、存下，回调口随即关掉。十分钟没回来也关
  let pending = null;
  function stopPending() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.server.close();
    pending = null;
  }
  async function startLogin() {
    stopPending();
    const auth = load();
    // 本机标识：每台机器一个，头一回登录前定下，此后一直用它
    // 须写成 urn:uuid:…，裸的 UUID 授权端不认（invalid ext_agent_host_id）；先前存下的裸 UUID 补上前缀，仍是同一台机器
    if (!auth.hostId?.startsWith("urn:uuid:")) {
      auth.hostId = `urn:uuid:${auth.hostId || randomUUID()}`;
      save(auth);
    }
    const verifier = base64url(randomBytes(32)),
      state = base64url(randomBytes(16)),
      server = http.createServer();
    await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
    const redirect = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/callback`;
    const login = (pending = { server, error: "", timer: setTimeout(stopPending, 10 * 60 * 1000) });
    server.on("request", async (req, res) => {
      const url = new URL(req.url || "/", redirect);
      if (url.pathname !== "/callback") return res.writeHead(404).end();
      const page = (status, title, line) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(landing(title, line));
        if (pending === login) stopPending();
      };
      if (url.searchParams.get("state") !== state) return res.writeHead(400).end();
      const code = url.searchParams.get("code");
      if (!code) {
        login.error = url.searchParams.get("error_description") || url.searchParams.get("error") || "授权未完成";
        return page(400, "没有登录", login.error);
      }
      try {
        const current = load(),
          clientId = url.searchParams.get("client_id") || current.clientId || "";
        const fresh = await tokenRequest({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          code_verifier: verifier,
          redirect_uri: redirect
        });
        save({ ...current, clientId, email: jwtClaims(fresh.id_token).email || "", tokens: tokensOf(fresh) });
        page(200, "已登录", "回到言即可，此页可以关掉");
      } catch (error) {
        login.error = error.message;
        page(400, "没有登录", error.message);
      }
    });
    const query = new URLSearchParams({
      client_id: auth.clientId || FIRST_CLIENT,
      response_type: "code",
      redirect_uri: redirect,
      scope: SCOPE,
      resource: RESOURCE,
      state,
      nonce: base64url(randomBytes(16)),
      code_challenge_method: "S256",
      code_challenge: base64url(createHash("sha256").update(verifier).digest()),
      ext_agent_host_id: auth.hostId,
      ...(auth.clientId ? {} : { agent_name_hint: "言" })
    });
    const url = `${AUTH}/api/accounts/authorize?${query}`;
    // 交给 url.dll 用默认浏览器打开：不经 cmd（网址里的 & 会被当成命令分隔）；explorer.exe 认不全这种长网址，会打开「文档」
    if (process.platform === "win32" && !process.env.YAN_CHATGPT_AUTH)
      spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore" }).unref();
    return { url };
  }
  function status() {
    const auth = load();
    return { signedIn: !!auth.tokens?.refresh_token, email: auth.email || "", pending: !!pending, error: pending?.error || "" };
  }
  // 退出：向授权端吊销刷新令牌（吊销不成也照样在本机清掉），登记的 client_id 与本机标识留着，下回登录同一个账号还用它们
  async function logout() {
    stopPending();
    const auth = load();
    if (!auth.tokens) return status();
    try {
      const config = await (await fetch(`${AUTH}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) })).json();
      if (config.revocation_endpoint)
        await fetch(config.revocation_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: auth.tokens.refresh_token, token_type_hint: "refresh_token", client_id: auth.clientId || "" }),
          signal: AbortSignal.timeout(10000)
        });
    } catch {}
    const { tokens, ...rest } = auth;
    save(rest);
    return status();
  }

  // 模型表：用户这个账号可用的那几个（visibility 为 list 的），记下各自认的思考档位，探档位时照表回、不必真发一趟
  const levelsByModel = new Map();
  async function models() {
    // 模型表按 client_version 筛：各模型标着 Codex 客户端的最低版本（它自己的 apply_patch 之类工具要新版才有），不带就按旧版给，最新的几个看不到。
    // 言不靠 Codex 客户端的那些功能，这些模型直接调用也放行，所以带一个足够大的版本号，即「不按客户端版本筛」
    const response = await fetch(`${API}/models?client_version=999.0.0`, { headers: await headers(), signal: AbortSignal.timeout(20000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(hinted(data.error?.code, data.error?.message || `列模型失败（${response.status}）`));
    const list = (Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []).filter(
      m => m && (m.visibility === undefined || m.visibility === "list")
    );
    for (const m of list) {
      const levels = (m.supported_reasoning_levels || []).map(level => level?.effort || level).filter(Boolean);
      if (levels.length) levelsByModel.set(m.slug || m.id, levels);
    }
    return list.map(m => m.slug || m.id).filter(Boolean);
  }
  const levels = model => levelsByModel.get(model) || [];

  const routes = {
    "POST /api/chatgpt/login": jsonRoute(startLogin),
    "POST /api/chatgpt/status": jsonRoute(status),
    "POST /api/chatgpt/logout": jsonRoute(logout)
  };
  const provider = {
    needsBaseUrl: false,
    url: () => `${API}/responses`,
    headers: (config, body) => headers(config, body),
    request: payload => responsesRequest(payload),
    stream: model => responsesToOpenAiStream(model),
    models: () => models(),
    levels: config => levels(config.model)
  };
  return { provider, routes };
};

function inputParts(content) {
  if (typeof content === "string") return content ? [{ type: "input_text", text: content }] : [];
  const parts = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === "text" && part.text) parts.push({ type: "input_text", text: String(part.text) });
    else if (part?.type === "image_url" && part.image_url?.url) parts.push({ type: "input_image", image_url: part.image_url.url });
    else if (part?.type === "file") {
      const name = String(part.file?.filename || "");
      if (/\.pdf$/i.test(name) && part.file?.file_data)
        parts.push({ type: "input_file", filename: name, file_data: `data:application/pdf;base64,${part.file.file_data}` });
      else parts.push({ type: "input_text", text: `[附件 ${name || "文件"}：此接口不接受该格式的原件]` });
    }
  }
  return parts;
}
// OpenAI chat 请求体 → Responses 请求体：system 并进 instructions，工具调用与结果成对换成 function_call / function_call_output。
// 订阅这条路要 store: false、stream: true；temperature、max_output_tokens 不传
function responsesRequest(payload) {
  const system = [],
    input = [];
  for (const message of payload.messages || []) {
    if (message.role === "system")
      system.push(
        typeof message.content === "string"
          ? message.content
          : inputParts(message.content)
              .map(p => p.text || "")
              .join("\n")
      );
    else if (message.role === "user") {
      const content = inputParts(message.content);
      if (content.length) input.push({ type: "message", role: "user", content });
    } else if (message.role === "assistant") {
      // 带工具调用的那一轮的思考（加密原件，页面经 thinking_blocks 带回）：放在调用之前送回，模型接着想时记得为什么调这件工具。
      // store 为 false，不能带 id——后端不存这一条，带了反倒说找不到
      for (const block of message.thinking_blocks || [])
        if (block?.signature)
          input.push({
            type: "reasoning",
            summary: block.thinking ? [{ type: "summary_text", text: block.thinking }] : [],
            encrypted_content: block.signature
          });
      const text = typeof message.content === "string" ? message.content : "";
      if (text.trim()) input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      for (const call of message.tool_calls || [])
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function?.name || "",
          arguments: call.function?.arguments || "{}"
        });
    } else if (message.role === "tool")
      input.push({ type: "function_call_output", call_id: message.tool_call_id, output: String(message.content ?? "") });
  }
  const effort = String(payload.reasoning_effort || "").toLowerCase();
  const body = {
    model: payload.model,
    instructions: system.join("\n\n") || "You are a helpful assistant.",
    input,
    reasoning: { summary: "auto", ...(effort && effort !== "none" ? { effort } : {}) },
    include: ["reasoning.encrypted_content"],
    store: false,
    stream: true
  };
  // 缓存键：同一段对话里固定不变（取开头那条用户消息），前文走缓存
  const opening = input.find(item => item.role === "user");
  if (opening)
    body.prompt_cache_key = createHash("sha256")
      .update(`${payload.model}\n${JSON.stringify(opening.content)}`)
      .digest("hex")
      .slice(0, 32);
  if (Array.isArray(payload.tools) && payload.tools.length) {
    body.tools = payload.tools.map(tool => ({
      type: "function",
      name: tool.function?.name || "",
      description: tool.function?.description || "",
      parameters: tool.function?.parameters || { type: "object", properties: {} },
      strict: false
    }));
    body.tool_choice = payload.tool_choice === "none" ? "none" : "auto";
    body.parallel_tool_calls = true;
  }
  return body;
}
// Responses 事件流 → OpenAI 风格的 SSE 分块：正文、思考摘要、函数调用（按出现顺序编号）、收尾的用量与结束原因
function responsesToOpenAiStream(model = "") {
  const decoder = new TextDecoder(),
    encoder = new TextEncoder(),
    id = `chatcmpl-${Date.now().toString(36)}`;
  let buffer = "",
    stopped = false,
    summaries = 0;
  const calls = new Map();
  const chunk = (delta, extra = {}, finish = null) =>
    encoder.encode(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`
    );
  const fail = (controller, error) => {
    stopped = true;
    const message = hinted(error?.code, error?.message);
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ error: { message: `接口在作答途中出错：${message || "未知错误"}` } })}\n\n`)
    );
  };
  const handle = (controller, data) => {
    const type = data.type,
      item = data.item;
    if (type === "response.output_text.delta" && data.delta) controller.enqueue(chunk({ content: data.delta }));
    else if (type === "response.reasoning_summary_part.added" && summaries++) controller.enqueue(chunk({ reasoning_content: "\n\n" }));
    else if (type === "response.reasoning_summary_text.delta" && data.delta) controller.enqueue(chunk({ reasoning_content: data.delta }));
    else if (type === "response.output_item.added" && item?.type === "function_call") {
      const call = { slot: calls.size, streamed: false };
      calls.set(item.id, call);
      controller.enqueue(
        chunk({ tool_calls: [{ index: call.slot, id: item.call_id, type: "function", function: { name: item.name, arguments: "" } }] })
      );
    } else if (type === "response.function_call_arguments.delta" && calls.has(data.item_id) && data.delta) {
      calls.get(data.item_id).streamed = true;
      controller.enqueue(chunk({ tool_calls: [{ index: calls.get(data.item_id).slot, function: { arguments: data.delta } }] }));
    } else if (type === "response.output_item.done" && item?.type === "function_call" && calls.has(item.id) && !calls.get(item.id).streamed)
      controller.enqueue(chunk({ tool_calls: [{ index: calls.get(item.id).slot, function: { arguments: item.arguments || "{}" } }] }));
    // 思考整段收尾：加密原件作 thinking_block 交给页面（signature 一栏装它），这一轮带工具调用时页面原样带回
    else if (type === "response.output_item.done" && item?.type === "reasoning" && item.encrypted_content)
      controller.enqueue(
        chunk({
          thinking_block: { thinking: (item.summary || []).map(part => part.text || "").join("\n\n"), signature: item.encrypted_content }
        })
      );
    else if (type === "response.completed" || type === "response.incomplete") {
      const u = data.response?.usage || {},
        length = data.response?.incomplete_details?.reason === "max_output_tokens";
      const usage = {
        prompt_tokens: Number(u.input_tokens) || 0,
        completion_tokens: Number(u.output_tokens) || 0,
        total_tokens: Number(u.total_tokens) || 0,
        prompt_tokens_details: { cached_tokens: Number(u.input_tokens_details?.cached_tokens) || 0 }
      };
      controller.enqueue(chunk({}, { usage }, length ? "length" : calls.size ? "tool_calls" : "stop"));
      stopped = true;
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    } else if (type === "response.failed") fail(controller, data.response?.error);
    else if (type === "error") fail(controller, data.error || data);
  };
  const feed = (controller, text) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        handle(controller, JSON.parse(line.slice(5).trim()));
      } catch {}
    }
  };
  return new TransformStream({
    transform(bytes, controller) {
      if (!stopped) feed(controller, decoder.decode(bytes, { stream: true }));
    },
    // 没等到 response.completed 就断了：不补 [DONE]，页面按「连接中断」处理、可续写
    flush(controller) {
      if (!stopped) feed(controller, `${decoder.decode()}\n`);
    }
  });
}
Object.assign(module.exports, { hinted, responsesRequest, responsesToOpenAiStream });
