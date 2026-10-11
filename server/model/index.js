"use strict";
// 言 · 模型转发：测试连接、列模型、对话。页面只说 OpenAI chat.completions 的话，各家接口的差异都收在下面的 PROVIDERS 表里，
// 加一家只需加一份登记。一份登记有这几样：
//   url(config)               对话发往哪
//   headers(config, body)     带什么头（可以是异步的：ChatGPT 订阅的令牌要换新；对话时 body 是已换好的请求体）
//   request(payload, config)  OpenAI 格式的请求体换成这家的
//   stream(model)             这家的事件流换回 chat.completions 分块的 TransformStream；不给即原样透传
//   modelsUrl(config) / models(config)  列模型：给地址的照通行的 { data: [...] } 读，自有说法的自己列
//   levels(config)            这家认的思考档位有定表的：页面探档位时照表回，不必真发一趟
//   needsBaseUrl              是否要填 Base URL（ChatGPT 订阅不用）
const { Readable } = require("node:stream");
const { finished } = require("node:stream/promises");
const { sendJson, readJson } = require("../http.js");
const openai = require("./openai.js");
const anthropic = require("./anthropic.js");
const { hinted } = require("./chatgpt.js");

// 工具定义一次最多带多少件：超过不再静默截掉后面的，明确报错，接入更多工具时一眼能看出来
const TOOLS_LIMIT = 128;
const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

// 上游没接下请求时回的那句话。OpenAI 系 { error: { message } }、有的中转站 { error: "…" }、旧版 vLLM { message }、
// FastAPI 写的自建服务 { detail }（参数校验错是一串对象，整串交出去，思考档位的报错才读得出它认哪几档）；
// ChatGPT 订阅额度那边的几种拒绝换成看得懂的话。页面只读桥接回的 { error }，各家的样子到此为止
async function upstreamError(response) {
  const raw = await response.text().catch(() => "");
  try {
    const json = JSON.parse(raw),
      detail = json.detail;
    return (
      (typeof json.error === "string" ? json.error : json.error?.message && hinted(json.error.code, json.error.message)) ||
      (typeof json.message === "string" ? json.message : "") ||
      (typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "") ||
      `上游接口返回 ${response.status}`
    );
  } catch {
    return raw.trim().slice(0, 300) || `上游接口返回 ${response.status}`;
  }
}

/** @param {{ home: () => string }} options 存储根（ChatGPT 订阅的登录凭证放在那里） */
module.exports = function createModel({ home }) {
  const chatgpt = require("./chatgpt.js")({ home });
  const PROVIDERS = { openai, anthropic: anthropic.provider, chatgpt: chatgpt.provider };
  // 接口类型由页面定好了送来（设置里选的，旧配置没写的页面按地址认）；没写的当 OpenAI 兼容
  const providerOf = config => PROVIDERS[config.api] || PROVIDERS.openai;

  function resolveProfile(input, requireModel = true) {
    const config = {
      baseUrl: String(input?.baseUrl || "").trim(),
      model: String(input?.model || "").trim(),
      apiKey: String(input?.apiKey || "").trim(),
      api: String(input?.api || "")
        .trim()
        .toLowerCase()
    };
    const provider = providerOf(config);
    if ((provider.needsBaseUrl !== false && !config.baseUrl) || (requireModel && !config.model))
      throw Error(requireModel ? "请填写 Base URL 和模型 ID" : "请填写 Base URL");
    return { config, provider };
  }
  // 列模型；接口没给出列表（不是 { data } 或 { models } 的样子）回 null
  async function listModels(provider, config) {
    if (provider.models) return provider.models(config);
    const response = await fetch(provider.modelsUrl(config), {
      headers: await provider.headers(config),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error(await upstreamError(response));
    const data = await response.json();
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : null;
    return list && list.map(item => (typeof item === "string" ? item : item?.id || item?.name)).filter(Boolean);
  }

  async function handleTest(req, res) {
    const started = Date.now();
    try {
      const { config, provider } = resolveProfile((await readJson(req)).profile, true);
      const list = await listModels(provider, config);
      sendJson(res, 200, { ok: true, latencyMs: Date.now() - started, modelFound: !list || list.includes(config.model) });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 500) });
    }
  }
  async function handleModels(req, res) {
    try {
      const { config, provider } = resolveProfile((await readJson(req)).profile, false);
      sendJson(res, 200, { models: (await listModels(provider, config)) || [] });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 500) });
    }
  }
  async function handleChat(req, res) {
    const meter = { model: "", opened: 0, last: 0, bytes: 0, finish: "" };
    try {
      const body = await readJson(req),
        { config, provider } = resolveProfile(body.profile, true);
      meter.model = config.model;
      if (!Array.isArray(body.messages) || !body.messages.length) throw Error("消息不能为空");
      const messages = body.systemPrompt ? [{ role: "system", content: String(body.systemPrompt) }, ...body.messages] : body.messages;
      const payload = {
        model: config.model,
        messages,
        stream: true,
        stream_options: { include_usage: true }
      };
      // 温度：页面给了才带（模型设置里留空即不传，由接口定）
      if (body.temperature !== undefined && body.temperature !== null && Number.isFinite(Number(body.temperature)))
        payload.temperature = Math.max(0, Math.min(2, Number(body.temperature)));
      // 页面给了才带 max_tokens（Anthropic 与拟题、压缩这几处）；没给就不传，让接口用自己的默认
      if (Number(body.maxTokens) > 0) payload.max_tokens = Math.max(16, Math.round(Number(body.maxTokens)));
      if (Array.isArray(body.tools) && body.tools.length) {
        if (body.tools.length > TOOLS_LIMIT) throw Error(`工具定义过多：${body.tools.length} 件，一次最多 ${TOOLS_LIMIT} 件`);
        payload.tools = body.tools;
        // 轮次到顶：工具照带、只禁再调（各家的写法由登记里的 request 换）
        if (body.toolChoice === "none") payload.tool_choice = "none";
      }
      // 思考档位：页面只送 reasoning_effort，各家怎么换算（预算、enable_thinking……）由登记里的 request 定
      if (body.reasoning_effort) payload.reasoning_effort = String(body.reasoning_effort);
      // 探档位（故意送一个不存在的档位）：这家的档位有定表的，照表按 OpenAI 的报错样子回，不必真发一趟
      if (payload.reasoning_effort === "probe") {
        const levels = provider.levels?.(config) || [];
        if (levels.length)
          throw Object.assign(Error(`Invalid value: 'probe'. Supported values are: ${levels.map(level => `'${level}'`).join(", ")}.`), {
            status: 400
          });
      }
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      console.log(`${stamp()} → ${config.model}：${messages.length} 条消息${payload.tools ? `，工具 ${payload.tools.length} 个` : ""}`);
      // 上游的状态码原样带回页面（连不上记作 502）：429、5xx、过载这些页面会等一等再试，参数错之类的 4xx 不试
      const upstream = provider.request(payload, config);
      const response = await fetch(provider.url(config), {
        method: "POST",
        headers: await provider.headers(config, upstream),
        body: JSON.stringify(upstream),
        signal: abort.signal
      }).catch(error => {
        throw Object.assign(Error(`连不上上游接口：${error.cause?.code || error.cause?.message || error.message}`), {
          status: 502,
          name: error.name
        });
      });
      if (!response.ok)
        throw Object.assign(Error(await upstreamError(response)), {
          status: response.status,
          retryAfter: response.headers.get("retry-after") || ""
        });
      // 记着流了多少、最后一次来字是何时：途中断了，桥接窗口里一行看得出是对面掐线还是静默太久（见下 catch）
      meter.opened = Date.now();
      meter.last = meter.opened;
      const metered = response.body.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            meter.bytes += chunk.byteLength;
            meter.last = Date.now();
            controller.enqueue(chunk);
          }
        })
      );
      res.writeHead(200, {
        "Content-Type": (!provider.stream && response.headers.get("content-type")) || "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      // 各家的流换成 chat.completions 分块之后，顺路认出结束原因：收尾时记一行，半截话停下时看得出对面发的是 stop 还是 abort
      const decoder = new TextDecoder();
      let tail = "";
      const watched = (provider.stream ? metered.pipeThrough(provider.stream(config.model)) : metered).pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            tail = (tail + decoder.decode(chunk, { stream: true })).slice(-4096);
            for (const match of tail.matchAll(/"finish_reason"\s*:\s*"([^"]+)"/g)) meter.finish = match[1];
            tail = tail.slice(tail.lastIndexOf("\n") + 1);
            controller.enqueue(chunk);
          }
        })
      );
      // 不用 pipeline：上游一断它连页面这头也一并销毁，下面 catch 里那条「连接中断」的报错事件就补不上了，页面只见一句 network error
      const source = Readable.fromWeb(watched);
      source.pipe(res, { end: false });
      await finished(source);
      res.end();
      const finish = meter.finish,
        // 与页面的 NORMAL_FINISH 同一张单子（中转站原样转来的 end_turn 之类也算正常）
        normal = ["stop", "tool_calls", "function_call", "end_turn", "stop_sequence", "eos", "eos_token"].includes(finish);
      console.log(
        `${stamp()} ${normal ? "←" : "⚠"} ${meter.model}：${finish ? `收尾 ${finish}` : "流到头了却没有结束原因"} · ${Math.round((Date.now() - meter.opened) / 1000)} 秒、${meter.bytes} 字节`
      );
    } catch (error) {
      // 底层的原因码（UND_ERR_SOCKET 对面掐线、UND_ERR_BODY_TIMEOUT 静默五分钟……）比一句「terminated」有用，一并带上
      const code = error?.cause?.code || error?.code || "",
        reason = `${String(error.message || error).slice(0, 200)}${code && !String(error.message).includes(code) ? `（${code}）` : ""}`;
      if (meter.opened && error?.name !== "AbortError")
        console.log(
          `${stamp()} ✕ ${meter.model}：途中断了 · ${reason} · 开流 ${Math.round((Date.now() - meter.opened) / 1000)} 秒、收 ${meter.bytes} 字节、最后来字在 ${Math.round((Date.now() - meter.last) / 1000)} 秒前`
        );
      if (!res.headersSent) {
        if (error.retryAfter) res.setHeader("Retry-After", error.retryAfter);
        sendJson(res, error.status >= 400 ? error.status : 400, { error: String(error.message || error).slice(0, 500) });
      } else if (!res.writableEnded && !res.destroyed) {
        // 流开了头才断的（上游掐线、读超时）：不能就这么静静结束——页面会把半截话当成写完了。
        // 补一条带 error 的事件再收，页面据此按「连接中断」处理，留着续写的余地；页面自己先走了的不必补
        if (!res.destroyed && error?.name !== "AbortError")
          try {
            res.write(`data: ${JSON.stringify({ error: { message: `上游连接中断：${reason}` } })}\n\n`);
          } catch {}
        res.end();
      }
    }
  }
  return {
    // 引导、转发、列模型凡是本机桥接认得的来源都可调；ChatGPT 的登录与退出碰本机凭证，归受信的一半
    openRoutes: { "POST /api/test": handleTest, "POST /api/models": handleModels, "POST /api/chat": handleChat },
    routes: chatgpt.routes
  };
};
module.exports.upstreamError = upstreamError;
