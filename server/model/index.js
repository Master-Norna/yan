"use strict";
// 言 · 模型转发：测试连接、列模型、对话。页面只说 OpenAI chat.completions 的话，各家接口的差异都收在下面的 PROVIDERS 表里，
// 加一家只需加一份登记。一份登记有这几样：
//   url(config)               对话发往哪
//   headers(config, body)     带什么头（可以是异步的：ChatGPT 订阅的令牌要换新；对话时 body 是已换好的请求体）
//   request(payload, config)  OpenAI 格式的请求体换成这家的
//   stream(model)             这家的事件流换回 chat.completions 分块的 TransformStream（用 sse.js 的骨架，只写一个事件换成什么）；不给即原样透传
//   modelsUrl(config) / models(config)  列模型：给地址的照通行的 { data: [...] } 读，自有说法的自己列
//   levels(config)            这家认的思考档位有定表的：页面探档位时照表回，不必真发一趟
//   needsBaseUrl              是否要填 Base URL（ChatGPT 订阅不用）
const { Readable } = require("node:stream");
const { finished } = require("node:stream/promises");
const { sendJson, readJson, requestSignal, stamp } = require("../http.js");
const openai = require("./openai.js");
const anthropic = require("./anthropic.js");
const { hinted } = require("./chatgpt.js");
const createImage = require("./image.js");

// 工具定义一次最多带多少件：超过不再静默截掉后面的，明确报错，接入更多工具时一眼能看出来
const TOOLS_LIMIT = 128;

// 上游没接下请求时回的那句话。OpenAI 系 { error: { message } }、有的中转站 { error: "…" }、旧版 vLLM { message }、
// FastAPI 写的自建服务 { detail }（参数校验错是一串对象，整串交出去，思考档位的报错才读得出它认哪几档）；
// ChatGPT 订阅额度那边的几种拒绝换成看得懂的话。页面只读桥接回的 { error }，各家的样子到此为止
async function upstreamError(response, raw) {
  raw = raw ?? (await response.text().catch(() => ""));
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

// 上游回的正文是事件流还是整份 JSON，只能按正文开头判，不能按 content-type：标成 text/plain 的事件流也要能译（#22）。
// 只多读判定要用的那几块（前面可能全是空白），读过的不丢，由 replayBody 先吐出来再接回原来的流——事件流仍是逐块往下交，
// 不整份攒进内存。0x7b 是 {，0x20 0x09 0x0a 0x0d 0x0b 0x0c 是空白
const BLANK = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);
/**
 * @param {ReadableStream<Uint8Array>} body
 * @returns {Promise<{ chunks: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>, first: number }>}
 */
async function peekLead(body) {
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (value && value.byteLength) {
      chunks.push(value);
      for (const byte of value) if (!BLANK.has(byte)) return { chunks, reader, first: byte };
    }
    if (done) return { chunks, reader, first: 0 };
  }
}
/**
 * @param {Uint8Array[]} chunks
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @returns {ReadableStream<Uint8Array>}
 */
function replayBody(chunks, reader) {
  let at = 0;
  return new ReadableStream({
    /** @param {ReadableStreamDefaultController<Uint8Array>} controller */
    pull(controller) {
      if (at < chunks.length) return void controller.enqueue(chunks[at++]);
      return reader.read().then(
        ({ value, done }) => void (done ? controller.close() : controller.enqueue(value)),
        error => controller.error(error)
      );
    },
    /** @param {any} reason */
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}
/**
 * @param {Uint8Array[]} chunks
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 */
async function collectText(chunks, reader) {
  const decoder = new TextDecoder();
  let text = "";
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  for (;;) {
    const { value, done } = await reader.read();
    if (value) text += decoder.decode(value, { stream: true });
    if (done) return text + decoder.decode();
  }
}

/** @param {{ home: () => string }} options 存储根（ChatGPT 订阅的登录凭证放在那里） */
module.exports = function createModel({ home }) {
  const chatgpt = require("./chatgpt.js")({ home });
  // 硅基流动是 OpenAI 兼容的，设置里单列一档只为标出名字、填好地址；它与别家不同的几处在 openai.js 里按 api 认
  const PROVIDERS = { openai, siliconflow: openai, anthropic: anthropic.provider, chatgpt: chatgpt.provider };
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
  // 列模型；接口没给出列表（不是 { data } 或 { models } 的样子）回 null。kind 为 image 时列画图的（专司里的生图）
  async function listModels(provider, config, kind = "") {
    if (provider.models) return provider.models(config);
    const response = await fetch(provider.modelsUrl(config, kind), {
      headers: await provider.headers(config),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error(await upstreamError(response));
    const data = /** @type {any} */ (await response.json());
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
      const body = await readJson(req),
        { config, provider } = resolveProfile(body.profile, false);
      sendJson(res, 200, { models: (await listModels(provider, config, String(body.kind || ""))) || [] });
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
      console.log(`${stamp()} → ${config.model}：${messages.length} 条消息${payload.tools ? `，工具 ${payload.tools.length} 个` : ""}`);
      // 上游的状态码原样带回页面（连不上记作 502）：429、5xx、过载这些页面会等一等再试，参数错之类的 4xx 不试
      const upstream = provider.request(payload, config);
      const response = await fetch(provider.url(config), {
        method: "POST",
        headers: await provider.headers(config, upstream),
        body: JSON.stringify(upstream),
        signal: requestSignal(res)
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
      // 上游回了 200，正文是事件流还是整份 JSON，看开头字节：跳过空白，第一个字节是 { 就是整份 JSON
      // （中转不支持流式，或者 200 {"type":"error"} 的报错），否则照旧交给 translateSse 逐块翻译。
      // 不看类型：标成 text/plain 或不标类型的事件流照样能译（见 #22），反过来按「类型带 json」判会把它们弄坏。
      // 只看会重译事件流的两路（provider.stream）；OpenAI 兼容那路整份 JSON 本就能收。
      // 判过的几块原样接回去往下流（sniffEventStream 也是这样），事件流不整份读进内存
      const type = String(response.headers.get("content-type") || "").toLowerCase();
      let upstreamBody = response.body;
      if (provider.stream) {
        const lead = await peekLead(response.body);
        if (lead.first === 0x7b) {
          const raw = await collectText(lead.chunks, lead.reader);
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {}
          // 两种 JSON 分开给状态码：报错 JSON（Anthropic 的 Overloaded 这类）按可重试的 5xx 交回，页面照现有节奏等；
          // 正常答复的整份 JSON 是 4xx、不重试——回 5xx 页面会把 RETRY_DELAYS 排满，干等约五分钟，比原先白跑两次还糟。
          // 4xx 的文案一律带上原文前 200 字：上游说了什么都看得到，不用再去猜 message、code 这些字段
          if (json && ((json.error && !json.choices) || json.type === "error"))
            throw Object.assign(Error(await upstreamError(response, raw)), { status: 503 });
          const snippet = raw.trim().slice(0, 200);
          throw Object.assign(
            Error(
              json
                ? `上游回了整份 JSON，不是事件流（${type}）：这条中转多半不支持流式，可换一条支持流式的接口。前 200 字：${snippet}`
                : `上游回的不是事件流，也读不出 JSON（${type}）。前 200 字：${snippet}`
            ),
            { status: 415 }
          );
        }
        upstreamBody = replayBody(lead.chunks, lead.reader);
      }
      // 记着流了多少、最后一次来字是何时：途中断了，桥接窗口里一行看得出是对面掐线还是静默太久（见下 catch）
      meter.opened = Date.now();
      meter.last = meter.opened;
      const metered = upstreamBody.pipeThrough(
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
    openRoutes: {
      "POST /api/test": handleTest,
      "POST /api/models": handleModels,
      "POST /api/chat": handleChat,
      ...createImage({ resolveProfile, upstreamError })
    },
    routes: chatgpt.routes
  };
};
module.exports.upstreamError = upstreamError;
