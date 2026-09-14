"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");
const { spawn } = require("node:child_process");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const ROOT = __dirname;
const HOST = "127.0.0.1";
const PORT = Number(process.env.YAN_PORT || 8787);
const CONFIG_CANDIDATES = [process.env.YAN_API_CONFIG].filter(Boolean);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".pfb": "application/octet-stream", ".bcmap": "application/octet-stream" };

function loadServerConfig() {
  const file = CONFIG_CANDIDATES.find(candidate => fs.existsSync(candidate));
  if (!file) return { unconfigured: true };
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const read = label => {
    const index = lines.findIndex(line => new RegExp(`^${label}\\s*:`, "i").test(line));
    if (index < 0) return "";
    const inline = lines[index].replace(new RegExp(`^${label}\\s*:\\s*`, "i"), "");
    return inline || lines[index + 1] || "";
  };
  const config = { baseUrl: read("Base URL"), model: read("Model"), apiKey: read("API Key"), sourceFile: file };
  if (!config.baseUrl || !config.model || !config.apiKey) return { error: "API 配置缺少 Base URL、Model 或 API Key" };
  return config;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": MIME[".json"], "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}
function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function corsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowed = origin === "null" || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin || "") || /^vscode-webview:\/\//i.test(origin || "") || /^https:\/\/[a-z0-9-]+\.(vscode-cdn|vscode-webview)\.net$/i.test(origin || "");
  if (!allowed) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.headers["access-control-request-private-network"] === "true") res.setHeader("Access-Control-Allow-Private-Network", "true");
}
function readJson(req, limit = 24 * 1024 * 1024) {
  return new Promise((resolve,reject) => {
    const chunks = []; let size = 0; let rejected = false;
    req.on("data", chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) { rejected = true; reject(Error("请求内容过大")); req.destroy(); }
      else chunks.push(chunk);
    });
    req.on("end", () => { if (rejected) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(Error("请求 JSON 无效")); } });
    req.on("error", reject);
  });
}
function endpoint(baseUrl, suffix) {
  const base = String(baseUrl || "").trim();
  const url = new URL(base);
  if (!/^https?:$/.test(url.protocol)) throw Error("Base URL 只支持 http 或 https");
  return /\/chat\/completions\/?$/.test(url.pathname) ? url.href : `${url.href.replace(/\/$/, "")}${suffix}`;
}
function resolveProfile(input, requireModel = true) {
  if (input?.source === "server") { const config = loadServerConfig(); if (config.error) throw Error(config.error); if (config.unconfigured) throw Error("服务端没有预设模型，请在页面中手动添加"); return config; }
  const config = { baseUrl: String(input?.baseUrl || "").trim(), model: String(input?.model || "").trim(), apiKey: String(input?.apiKey || "").trim() };
  if (!config.baseUrl || (requireModel && !config.model)) throw Error(requireModel ? "请填写 Base URL 和模型 ID" : "请填写 Base URL");
  return config;
}
function modelsUrl(baseUrl) { const url = new URL(baseUrl); url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "")}/models`; return url; }
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
function decodeEntities(value) { return String(value).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&(amp|lt|gt|quot|apos|nbsp|ensp|emsp|thinsp|hellip|mdash|ndash|middot|laquo|raquo|ldquo|rdquo|lsquo|rsquo|copy);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", hellip: "…", mdash: "—", ndash: "–", middot: "·", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", copy: "©" }[e])); }
function stripTags(value) { return decodeEntities(String(value).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim(); }
function htmlToText(html) {
  let text = String(html).replace(/<(script|style|noscript|svg|nav|header|footer|iframe|template|form)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const main = text.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i); if (main && main[2].length > 500) text = main[2];
  text = text.replace(/<\/(p|div|li|h\d|tr|section|blockquote|pre|dd|dt)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function isPrivateAddress(value) {
  const host = String(value || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(host)) return true;
  if (net.isIPv4(host)) {
    const [a,b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(host)) return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^::ffff:(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host);
  return false;
}
async function assertPublicUrl(url) {
  if (!/^https?:$/.test(url.protocol)) throw Error("只支持 http 或 https 地址");
  if (isPrivateAddress(url.hostname)) throw Error("不允许访问本机或内网地址");
  if (net.isIP(url.hostname)) return;
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw Error("网址解析到了本机或内网地址");
}
async function fetchText(url, timeout = 15000) {
  const response = await fetch(url, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7", Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw Error(`网页返回 ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!/text\/|application\/(xhtml|json|xml)/i.test(type)) throw Error(`不支持的内容类型 ${type.split(";")[0] || "未知"}`);
  const buffer = Buffer.from(await response.arrayBuffer()).subarray(0, 3 * 1024 * 1024);
  const charset = (type.match(/charset=["']?([\w-]+)/i) || buffer.subarray(0, 4096).toString("latin1").match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
  let text; try { text = new TextDecoder(charset).decode(buffer); } catch { text = buffer.toString("utf8"); }
  return { text, url: response.url, type };
}
async function fetchPublicText(url, timeout = 20000) {
  let current = new URL(url); const signal = AbortSignal.timeout(timeout);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicUrl(current);
    const response = await fetch(current, { headers: { "User-Agent": BROWSER_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7", Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" }, redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location"); if (!location) throw Error("网页跳转缺少目标地址");
      current = new URL(location, current); continue;
    }
    if (!response.ok) throw Error(`网页返回 ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (!/text\/|application\/(xhtml|json|xml)/i.test(type)) throw Error(`不支持的内容类型 ${type.split(";")[0] || "未知"}`);
    const buffer = Buffer.from(await response.arrayBuffer()).subarray(0, 3 * 1024 * 1024);
    const charset = (type.match(/charset=["']?([\w-]+)/i) || buffer.subarray(0, 4096).toString("latin1").match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
    let text; try { text = new TextDecoder(charset).decode(buffer); } catch { text = buffer.toString("utf8"); }
    return { text, url: current.href, type };
  }
  throw Error("网页跳转次数过多");
}
// 免 Key 的检索：先 Bing（国内可达；ensearch=1 走国际索引，国内索引对脚本请求会返回无关结果），失败或无结果再试 DuckDuckGo
// Bing 结果链接是 /ck/a?…&u=a1<base64url> 形式的跳转，还原成真实地址
function resolveBingUrl(href) {
  const raw = decodeEntities(href);
  try { const url = new URL(raw, "https://www.bing.com"); if (/bing\.com$/i.test(url.hostname) && url.pathname === "/ck/a") { const u = url.searchParams.get("u") || ""; if (u.startsWith("a1")) return Buffer.from(u.slice(2), "base64url").toString("utf8"); } return url.href; } catch { return raw; }
}
async function searchBing(query, count) {
  const { text } = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&ensearch=1&count=${count}`);
  const results = [];
  for (const match of text.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>([\s\S]*?)<\/li>/g)) {
    const snippet = (match[3].match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "";
    const url = resolveBingUrl(match[1]);
    if (/^https?:\/\//.test(url)) results.push({ title: stripTags(match[2]), url, snippet: stripTags(snippet) });
    if (results.length >= count) break;
  }
  return results;
}
async function searchDuckDuckGo(query, count) {
  const { text } = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=cn-zh`);
  const results = [];
  for (const match of text.matchAll(/<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
    let url = match[1]; const uddg = url.match(/[?&]uddg=([^&]+)/); if (uddg) url = decodeURIComponent(uddg[1]); if (url.startsWith("//")) url = `https:${url}`;
    results.push({ title: stripTags(match[2]), url, snippet: stripTags(match[3]) });
    if (results.length >= count) break;
  }
  return results;
}
async function handleSearch(req, res) {
  try {
    const body = await readJson(req), query = String(body.query || "").trim().slice(0, 300), count = Math.max(1, Math.min(10, Number(body.count) || 6));
    if (!query) throw Error("搜索关键词不能为空");
    const errors = []; let results = [];
    for (const engine of [searchBing, searchDuckDuckGo]) { try { results = await engine(query, count); if (results.length) break; } catch (error) { errors.push(error.message); } }
    if (!results.length && errors.length === 2) throw Error(`搜索引擎暂时不可用：${errors[0]}`);
    sendJson(res, 200, { query, results });
  } catch (error) { sendJson(res, 400, { error: String(error.message || error).slice(0,500) }); }
}
async function handleFetch(req, res) {
  try {
    const body = await readJson(req); let url;
    try { url = new URL(String(body.url || "").trim()); } catch { throw Error("网址无效"); }
    const page = await fetchPublicText(url.href, 20000);
    const title = stripTags((page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const text = (/html|xml/i.test(page.type) ? htmlToText(page.text) : page.text).slice(0, 24000);
    sendJson(res, 200, { title, url: page.url, text });
  } catch (error) { sendJson(res, 400, { error: String(error.message || error).slice(0,500) }); }
}
function upstreamHeaders(config) { return { "Content-Type": "application/json; charset=utf-8", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }; }
async function upstreamError(response) {
  const raw = await response.text().catch(() => "");
  try { const json = JSON.parse(raw); return json.error?.message || json.message || `上游接口返回 ${response.status}`; }
  catch { return raw.slice(0,300) || `上游接口返回 ${response.status}`; }
}

function handleBootstrap(res) {
  const config = loadServerConfig();
  if (config.unconfigured) return sendJson(res, 200, { serverProfile: null, configError: "" });
  if (config.error) return sendJson(res, 200, { serverProfile: null, configError: config.error });
  const lower = config.model.toLowerCase();
  const name = lower.includes("qwen") ? "Qwen" : lower.includes("claude") ? "Claude" : lower.includes("gpt") ? "GPT" : "预设模型";
  sendJson(res, 200, { serverProfile: { id: "server-preset", source: "server", name, model: config.model, baseUrl: config.baseUrl, temperature: .7, maxTokens: 8192, systemPrompt: "" }, configError: "" });
}
async function handleTest(req, res) {
  const started = Date.now();
  try {
    const body = await readJson(req), config = resolveProfile(body.profile);
    const response = await fetch(modelsUrl(config.baseUrl), { headers: upstreamHeaders(config), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(await upstreamError(response));
    const data = await response.json();
    sendJson(res, 200, { ok: true, latencyMs: Date.now() - started, modelFound: !Array.isArray(data.data) || data.data.some(item => item.id === config.model) });
  } catch (error) { sendJson(res, 400, { error: String(error.message || error).slice(0,500) }); }
}
async function handleModels(req, res) {
  try {
    const body = await readJson(req), config = resolveProfile(body.profile, false);
    const response = await fetch(modelsUrl(config.baseUrl), { headers: upstreamHeaders(config), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(await upstreamError(response));
    const data = await response.json();
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    sendJson(res, 200, { models: list.map(item => typeof item === "string" ? item : item?.id || item?.name).filter(Boolean) });
  } catch (error) { sendJson(res, 400, { error: String(error.message || error).slice(0,500) }); }
}
async function handleChat(req, res) {
  try {
    const body = await readJson(req), config = resolveProfile(body.profile);
    if (!Array.isArray(body.messages) || !body.messages.length) throw Error("消息不能为空");
    const messages = body.systemPrompt ? [{ role: "system", content: String(body.systemPrompt).slice(0,20000) }, ...body.messages] : body.messages;
    const payload = { model: config.model, messages, stream: true, stream_options: { include_usage: true }, temperature: Math.max(0, Math.min(2, Number(body.temperature ?? .7))), max_tokens: Math.max(16, Math.min(65536, Number(body.maxTokens || 8192))) };
    if (Array.isArray(body.tools) && body.tools.length) payload.tools = body.tools.slice(0, 16);
    if (body.enable_search === true) payload.enable_search = true;
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} → ${config.model}：${messages.length} 条消息${payload.tools ? `，工具 ${payload.tools.length} 个` : ""}${payload.enable_search ? "，enable_search" : ""}`);
    const response = await fetch(endpoint(config.baseUrl, "/chat/completions"), { method: "POST", headers: upstreamHeaders(config), body: JSON.stringify(payload), signal: abort.signal });
    if (!response.ok) throw Error(await upstreamError(response));
    res.writeHead(200, { "Content-Type": response.headers.get("content-type") || "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    if (!res.headersSent) sendJson(res, 400, { error: String(error.message || error).slice(0,500) });
    else if (!res.writableEnded && !res.destroyed) res.end();
  }
}
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  const requested = urlPath === "/" ? "Lumen Chat.dc.html" : urlPath.slice(1);
  const file = path.resolve(ROOT, requested);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendJson(res, 404, { error: "未找到页面" });
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req,res) => {
  try {
    securityHeaders(res);
    corsHeaders(req, res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.method === "GET" && req.url === "/api/bootstrap") return handleBootstrap(res);
    if (req.method === "POST" && req.url === "/api/test") return await handleTest(req,res);
    if (req.method === "POST" && req.url === "/api/models") return await handleModels(req,res);
    if (req.method === "POST" && req.url === "/api/search") return await handleSearch(req,res);
    if (req.method === "POST" && req.url === "/api/fetch") return await handleFetch(req,res);
    if (req.method === "POST" && req.url === "/api/chat") return await handleChat(req,res);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req,res);
    sendJson(res, 405, { error: "不支持此请求" });
  } catch (error) { if (!res.headersSent) sendJson(res, 500, { error: String(error.message || error).slice(0,500) }); else res.end(); }
});
server.on("error", error => { if (error.code === "EADDRINUSE") console.error(`端口 ${PORT} 已被占用，可设置 YAN_PORT 后重试。`); else console.error(error); process.exitCode = 1; });
server.listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  console.log(`言下已启动：${address}`);
  console.log("请保持此窗口开启；关闭后页面刷新、模型转发和联网都会停止。按 Ctrl+C 可退出。");
  console.log("此窗口不会显示 API Key。");
  if (process.argv.includes("--open") && process.platform === "win32") { const child = spawn("cmd.exe", ["/c", "start", "", address], { detached: true, stdio: "ignore", windowsHide: true }); child.unref(); }
});
