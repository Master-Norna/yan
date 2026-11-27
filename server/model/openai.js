"use strict";
// 言 · OpenAI 兼容接口：沿用 chat.completions 格式，按接口与型号整理思考块、缓存标记、附件、输出上限和思考档位。
// 硅基流动在设置里单列一档，仍走这一份适配（登记见 index.js）。
const { claudeModel, markOpenAiCache, stripCacheMarks } = require("./anthropic.js");

// DashScope（通义）兼容模式不认 reasoning_effort，认 enable_thinking + thinking_budget；档位没有可探的枚举，按通用四档列
const DASHSCOPE = /dashscope|aliyuncs/i;
const DASHSCOPE_BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 32768, xhigh: 65536, max: 81920 };
const OPENAI_REASONING = /(^|\/)(o\d|gpt-5)/i;
// 硅基流动：只有 DeepSeek-V4 一族与 GLM-5.2 认 reasoning_effort，且只分 high、max 两档；别的（Qwen3 之类）同 DashScope，
// 认 enable_thinking + thinking_budget，预算 128–32768。/models 不加筛选连画图、向量、语音模型一并列出，只要对话的
const SILICONFLOW = config => config.api === "siliconflow" || /siliconflow/i.test(config.baseUrl);
const SILICONFLOW_EFFORT = /deepseek-v4|glm-5\.2/i;
const SILICONFLOW_BUDGETS = { minimal: 1024, low: 4096, medium: 8192, high: 16384, xhigh: 32768, max: 32768 };

function endpoint(baseUrl) {
  const url = new URL(String(baseUrl || "").trim());
  if (!/^https?:$/.test(url.protocol)) throw Error("Base URL 只支持 http 或 https");
  if (!/\/chat\/completions\/?$/i.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url.href;
}
function modelsUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "")}/models`;
  return url;
}

// file 内容段有 PDF 数据才补 data: 前缀发原件；其余 file 段换成说明文字。图片等其他类型不走这里。
function filePart(part) {
  if (part?.type !== "file") return part;
  const name = String(part.file?.filename || "");
  if (/\.pdf$/i.test(name) && part.file?.file_data)
    return { type: "file", file: { filename: name, file_data: `data:application/pdf;base64,${part.file.file_data}` } };
  return { type: "text", text: `[附件 ${name || "文件"}：此接口不接受该格式的原件]` };
}
module.exports = {
  SILICONFLOW,
  url: config => endpoint(config.baseUrl),
  modelsUrl(config, kind) {
    const url = modelsUrl(config.baseUrl);
    if (SILICONFLOW(config)) url.searchParams.set("sub_type", kind === "image" ? "text-to-image" : "chat");
    return url;
  },
  headers: config => ({
    "Content-Type": "application/json; charset=utf-8",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
  }),
  levels(config) {
    if (SILICONFLOW(config)) return SILICONFLOW_EFFORT.test(config.model) ? ["high", "max"] : ["low", "medium", "high", "max"];
    return DASHSCOPE.test(config.baseUrl) ? ["low", "medium", "high", "max"] : null;
  },
  request(payload, config) {
    const body = {
      ...payload,
      messages: payload.messages.map(m => {
        const next = m.thinking_blocks ? { ...m, thinking_blocks: undefined } : m;
        return Array.isArray(next.content) && next.content.some(part => part?.type === "file")
          ? { ...next, content: next.content.map(filePart) }
          : next;
      })
    };
    body.messages = claudeModel(config.model) ? markOpenAiCache(body.messages) : stripCacheMarks(body.messages);
    // OpenAI 的推理模型（o 系、gpt-5 一族，经 OpenRouter 的 openai/… 也是）不收 max_tokens，只认 max_completion_tokens：
    // 拟题、压缩、探档位带着上限，不换就是 400
    if (body.max_tokens !== undefined && OPENAI_REASONING.test(String(config.model || ""))) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    if (body.reasoning_effort && SILICONFLOW(config) && !SILICONFLOW_EFFORT.test(config.model)) {
      body.enable_thinking = true;
      body.thinking_budget = SILICONFLOW_BUDGETS[body.reasoning_effort] || 8192;
      delete body.reasoning_effort;
    } else if (body.reasoning_effort && DASHSCOPE.test(config.baseUrl)) {
      body.enable_thinking = true;
      body.thinking_budget = DASHSCOPE_BUDGETS[body.reasoning_effort] || 8192;
      delete body.reasoning_effort;
    }
    return body;
  }
};
