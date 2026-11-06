"use strict";
// 言 · 生图（设置 → 专司）：只接 OpenAI 兼容的 /images/generations。硅基流动的参数名不同（image_size、batch_size），交回 images[].url；
// OpenAI 系交回 data[].url 或 data[].b64_json。不论网址（硅基流动的一小时就失效）还是 base64，一律在这里取成 data: 地址交给页面，页面收进卷宗
const { sendJson, readJson, requestSignal, stamp } = require("../http.js");
const { readLimitedBytes } = require("../web.js");

const SILICONFLOW = config => config.api === "siliconflow" || /siliconflow/i.test(config.baseUrl);
const IMAGE_LIMIT = 40 * 1024 * 1024;

function imagesUrl(baseUrl) {
  const url = new URL(String(baseUrl || "").trim());
  if (!/^https?:$/.test(url.protocol)) throw Error("Base URL 只支持 http 或 https");
  if (!/\/images\/generations\/?$/i.test(url.pathname))
    url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "")}/images/generations`;
  return url.href;
}
// 头几个字节认格式：接口报的类型常是 application/octet-stream，b64_json 干脆不报
function sniff(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (bytes.subarray(0, 3).toString() === "GIF") return "image/gif";
  return "";
}
async function fetchImage(raw, signal) {
  if (raw.startsWith("data:")) return raw;
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw Error("接口交回的图片地址无效");
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) });
  if (!response.ok) throw Error(`取图失败：${response.status}`);
  // 边读边计：超过上限就停下，不先把整份收进内存再判
  const { buffer: bytes, truncated } = await readLimitedBytes(response, IMAGE_LIMIT);
  if (truncated) throw Error("图片过大");
  const type = String(response.headers.get("content-type") || "").split(";")[0];
  return `data:${sniff(bytes) || (type.startsWith("image/") ? type : "image/png")};base64,${bytes.toString("base64")}`;
}

/** @param {{ resolveProfile: Function, upstreamError: (response: Response) => Promise<string> }} options */
module.exports = function createImage({ resolveProfile, upstreamError }) {
  async function handleImage(req, res) {
    const gone = requestSignal(res);
    try {
      const body = await readJson(req),
        { config } = resolveProfile(body.profile, true),
        prompt = String(body.prompt || "").trim(),
        size = /^\d{2,5}x\d{2,5}$/.test(String(body.size || "")) ? String(body.size) : "";
      if (!prompt) throw Error("缺少画面描述");
      const request = SILICONFLOW(config)
        ? { model: config.model, prompt, batch_size: 1, ...(size ? { image_size: size } : {}) }
        : { model: config.model, prompt, n: 1, ...(size ? { size } : {}) };
      console.log(`${stamp()} → ${config.model}：生图${size ? ` ${size}` : ""}`);
      const response = await fetch(imagesUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
        },
        body: JSON.stringify(request),
        signal: AbortSignal.any([gone, AbortSignal.timeout(300000)])
      }).catch(error => {
        throw Object.assign(Error(`连不上生图接口：${error.cause?.code || error.cause?.message || error.message}`), { status: 502 });
      });
      if (!response.ok) throw Object.assign(Error(await upstreamError(response)), { status: response.status });
      const data = /** @type {any} */ (await response.json()),
        items = Array.isArray(data.images) ? data.images : Array.isArray(data.data) ? data.data : [];
      const images = await Promise.all(
        items.map(async item => ({
          data: item?.b64_json
            ? (bytes => `data:${sniff(bytes) || "image/png"};base64,${item.b64_json}`)(
                Buffer.from(String(item.b64_json).slice(0, 64), "base64")
              )
            : await fetchImage(String(item?.url || ""), gone),
          ...(item?.revised_prompt ? { revised: String(item.revised_prompt) } : {})
        }))
      );
      if (!images.length) throw Error("生图接口没交回图片");
      console.log(`${stamp()} ← ${config.model}：生图 ${images.length} 幅`);
      sendJson(res, 200, { images });
    } catch (error) {
      if (!res.headersSent)
        sendJson(res, error.status >= 400 ? error.status : 400, { error: String(error.message || error).slice(0, 500) });
    }
  }
  return { "POST /api/image": handleImage };
};
