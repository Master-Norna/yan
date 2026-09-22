"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");
const { spawn } = require("node:child_process");
const os = require("node:os");
const { Readable } = require("node:stream");
const bundler = require("./build.js");
// Anthropic 适配与页面共用同一份源码（src/19-anthropic.js）：请求换成 Messages API 的，事件流换回 OpenAI 风格
require("./src/19-anthropic.js");
const ANTHROPIC = globalThis.YAN_ANTHROPIC;
const { pipeline } = require("node:stream/promises");

const ROOT = __dirname;
const HOST = "127.0.0.1";
const PORT = Number(process.env.YAN_PORT || 8787);
// 工具定义一次最多带多少件：超过不再静默截掉后面的，明确报错，接入更多工具时一眼能看出来
const TOOLS_LIMIT = 128;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".pfb": "application/octet-stream",
  ".bcmap": "application/octet-stream"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": MIME[".json"], "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(body);
}
function securityHeaders(req, res) {
  const isPreview = new URL(req.url, `http://${HOST}`).pathname === "/preview.html";
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  // preview.html 只允许被本站（主页面）嵌入，且只有它需要执行 blob: 脚本；否则任意网站都能把它 iframe 进去并注入脚本读取 localStorage
  res.setHeader(
    "Content-Security-Policy",
    isPreview
      ? "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
}
function corsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowed =
    origin === "null" ||
    /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin || "") ||
    /^vscode-webview:\/\//i.test(origin || "") ||
    /^https:\/\/[a-z0-9-]+\.(vscode-cdn|vscode-webview)\.net$/i.test(origin || "");
  if (!allowed) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.headers["access-control-request-private-network"] === "true") res.setHeader("Access-Control-Allow-Private-Network", "true");
}
// 执事接口能执行本机指令，不能只依赖 CORS：不可信页面即使读不到响应，也可能用简单请求触发副作用。
// 无 Origin 的本机脚本仍可调用；浏览器只接受本站页面与 VS Code Webview。file:// 预览可对谈，但不开放执事。
function trustedWorkRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (/^vscode-webview:\/\//i.test(origin) || /^https:\/\/[a-z0-9-]+\.(vscode-cdn|vscode-webview)\.net$/i.test(origin)) return true;
  try {
    const url = new URL(origin),
      port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname.toLowerCase()) && port === PORT;
  } catch {
    return false;
  }
}
function readJson(req, limit = 128 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        reject(Error("请求内容过大"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Error("请求 JSON 无效"));
      }
    });
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
  const config = {
    baseUrl: String(input?.baseUrl || "").trim(),
    model: String(input?.model || "").trim(),
    apiKey: String(input?.apiKey || "").trim(),
    api: String(input?.api || "")
      .trim()
      .toLowerCase()
  };
  if (!config.baseUrl || (requireModel && !config.model)) throw Error(requireModel ? "请填写 Base URL 和模型 ID" : "请填写 Base URL");
  return config;
}
function modelsUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "")}/models`;
  return url;
}
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|ensp|emsp|thinsp|hellip|mdash|ndash|middot|laquo|raquo|ldquo|rdquo|lsquo|rsquo|copy);/g,
      (_, e) =>
        ({
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
          ensp: " ",
          emsp: " ",
          thinsp: " ",
          hellip: "…",
          mdash: "—",
          ndash: "–",
          middot: "·",
          laquo: "«",
          raquo: "»",
          ldquo: "“",
          rdquo: "”",
          lsquo: "‘",
          rsquo: "’",
          copy: "©"
        })[e]
    );
}
function stripTags(value) {
  return decodeEntities(String(value).replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}
function htmlToText(html) {
  let text = String(html)
    .replace(/<(script|style|noscript|svg|nav|header|footer|iframe|template|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const main = text.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 500) text = main[2];
  text = text
    .replace(/<\/(p|div|li|h\d|tr|section|blockquote|pre|dd|dt)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
// URL.hostname 里的 IPv6 字面量带方括号（[::1]），net.isIP 不认，先剥掉
function hostLiteral(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}
// 把 IPv6 字面量展开成 8 组（处理 :: 与末尾的点分 IPv4）
function ipv6Groups(host) {
  let text = host;
  const dotted = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parts = text.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [],
    tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (parts.length === 1 ? head.length !== 8 : fill < 1) return null;
  return [...head, ...Array(parts.length === 2 ? fill : 0).fill("0"), ...tail].map(group => parseInt(group, 16));
}
// IPv4 映射地址（::ffff:127.0.0.1）：WHATWG URL 会把它规整成十六进制（::ffff:7f00:1），两种写法都还原成点分 IPv4，按 IPv4 的规矩判——
// 支持公网 IPv6 的同时，不能给 ::ffff:127.0.0.1 之类留出绕过的口子
function unmapIpv4(host) {
  const groups = ipv6Groups(host);
  if (!groups || groups.some(Number.isNaN) || groups.slice(0, 5).some(Boolean) || groups[5] !== 0xffff) return null;
  return `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
}
function isPrivateAddress(value) {
  const host = hostLiteral(value);
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(host)) return true;
  if (net.isIPv4(host)) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(host)) {
    const mapped = unmapIpv4(host);
    if (mapped) return isPrivateAddress(mapped);
    // 未指定、回环、ULA（fc00::/7）、链路本地（fe80::/10）、NAT64（64:ff9b::/96，能映射到内网 IPv4）
    return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^64:ff9b:/.test(host);
  }
  return false;
}
// Clash / Mihomo 的 TUN fake-ip 会让正常域名解析到 198.18.0.0/15：DNS 结果允许这段交给代理接管；
// 用户直接写 http://198.18.x.x 则仍按保留内网段拒绝，免得把「代理兼容」变成字面地址绕过。
function isFakeIpAddress(value) {
  const host = hostLiteral(value),
    mapped = net.isIPv6(host) ? unmapIpv4(host) : null;
  if (mapped) return isFakeIpAddress(mapped);
  if (!net.isIPv4(host)) return false;
  const [a, b] = host.split(".").map(Number);
  return a === 198 && (b === 18 || b === 19);
}
// 本机回环：127.0.0.0/8、::1、localhost。http_request / download_file 对它放行（模型开的本机服务本就该能测，run_command 里 curl 本机也放行），
// 局域网等别的内网地址照旧拒；fetch_page / search_web 仍一律不碰本机
function isLoopback(value) {
  const host = hostLiteral(value),
    mapped = net.isIPv6(host) ? unmapIpv4(host) : null;
  if (mapped) return isLoopback(mapped);
  return host === "localhost" || host === "::1" || (net.isIPv4(host) && host.startsWith("127."));
}
async function assertPublicUrl(url, { allowLoopback = false } = {}) {
  if (!/^https?:$/.test(url.protocol)) throw Error("只支持 http 或 https 地址");
  const host = hostLiteral(url.hostname);
  const blocked = address => isPrivateAddress(address) && !(allowLoopback && isLoopback(address));
  if (blocked(host)) throw Error(allowLoopback ? "不允许访问内网地址（本机 127.0.0.1 / localhost 除外）" : "不允许访问本机或内网地址");
  if (net.isIP(host) || (allowLoopback && host === "localhost")) return;
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  const hit = addresses.find(item => blocked(item.address) && !isFakeIpAddress(item.address));
  if (!addresses.length || hit) throw Error(`网址解析到了本机或内网地址${hit ? `（${hit.address}）` : ""}`);
}
// 带方法与请求体的公网请求（http_request / download_file 用）：同样的地址门禁，跳转逐跳再查；返回的是 Response，正文由调用者按需读
async function fetchPublicResponse(url, { method = "GET", headers = {}, body = null, timeout = 30000, allowLoopback = false } = {}) {
  let current = new URL(url);
  const signal = AbortSignal.timeout(timeout);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicUrl(current, { allowLoopback });
    const response = await fetch(current, {
      method,
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7", ...headers },
      body: body && !["GET", "HEAD"].includes(method) ? body : undefined,
      redirect: "manual",
      signal
    });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel().catch(() => {});
      current = new URL(response.headers.get("location"), current);
      // 303 与 POST 后的 301/302 按浏览器惯例改成 GET
      if (response.status === 303 || (method !== "GET" && method !== "HEAD" && [301, 302].includes(response.status))) {
        method = "GET";
        body = null;
      }
      continue;
    }
    return { response, url: current.href };
  }
  throw Error("跳转次数过多");
}
// 按字节收响应正文，最多 limit 字节，到量即停
async function readLimitedBytes(response, limit) {
  const chunks = [];
  let size = 0,
    truncated = false;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.length > limit) {
        chunks.push(value.subarray(0, limit - size));
        size = limit;
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  }
  return { buffer: Buffer.concat(chunks.map(chunk => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))), truncated };
}
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
  HTTP_BODY_LIMIT = 1024 * 1024,
  HTTP_TEXT_CHARS = 60000;
// http_request：调公网接口，回状态码、响应头与正文；正文是文本或 JSON 的给原文（截到 6 万字），二进制的只给类型与大小
async function handleHttp(req, res) {
  try {
    const body = await readJson(req);
    let url;
    try {
      url = new URL(String(body.url || "").trim());
    } catch {
      throw Error("网址无效");
    }
    const method = String(body.method || "GET")
      .trim()
      .toUpperCase();
    if (!HTTP_METHODS.has(method)) throw Error(`不支持的方法 ${method}`);
    const headers = {};
    for (const [name, value] of Object.entries(body.headers && typeof body.headers === "object" ? body.headers : {}))
      if (/^[\w-]+$/.test(name) && !/^(host|content-length|connection|cookie)$/i.test(name)) headers[name] = String(value).slice(0, 4000);
    const payload =
      body.body === undefined || body.body === null ? null : typeof body.body === "string" ? body.body : JSON.stringify(body.body);
    if (payload && Buffer.byteLength(payload) > HTTP_BODY_LIMIT) throw Error("请求体超过 1 MB");
    if (payload && typeof body.body !== "string" && !Object.keys(headers).some(name => /^content-type$/i.test(name)))
      headers["Content-Type"] = "application/json; charset=utf-8";
    const started = Date.now(),
      { response, url: finalUrl } = await fetchPublicResponse(url.href, {
        method,
        headers,
        body: payload,
        timeout: 30000,
        allowLoopback: true
      });
    const type = response.headers.get("content-type") || "",
      textual =
        /text\/|application\/(json|xml|xhtml|javascript|x-www-form-urlencoded|ld\+json|problem\+json)|\+(json|xml)\b/i.test(type) || !type,
      { buffer, truncated } = await readLimitedBytes(response, textual ? 4 * 1024 * 1024 : 64 * 1024);
    const responseHeaders = {};
    for (const [name, value] of response.headers) if (!/^set-cookie$/i.test(name)) responseHeaders[name] = value;
    let text = "";
    if (textual) {
      const charset = (type.match(/charset=["']?([\w-]+)/i) || [])[1] || "utf-8";
      try {
        text = new TextDecoder(charset).decode(buffer);
      } catch {
        text = buffer.toString("utf8");
      }
    }
    sendJson(res, 200, {
      status: response.status,
      statusText: response.statusText,
      url: finalUrl,
      headers: responseHeaders,
      type: type.split(";")[0].trim(),
      textual,
      bytes: buffer.length,
      truncated: truncated || text.length > HTTP_TEXT_CHARS,
      text: text.slice(0, HTTP_TEXT_CHARS),
      durationMs: Date.now() - started
    });
  } catch (error) {
    sendJson(res, 400, { error: String(error.message || error).slice(0, 500) });
  }
}
const FETCH_TEXT_LIMIT = 3 * 1024 * 1024;
// 正文最多只收 3 MB：边读边计，到量即取消读取器——不先把整个响应吃进内存再截，对方回 500 MB 也只占 3 MB
async function readLimitedText(response, limit = FETCH_TEXT_LIMIT) {
  const type = response.headers.get("content-type") || "";
  if (!/text\/|application\/(xhtml|json|xml)/i.test(type)) {
    await response.body?.cancel().catch(() => {});
    throw Error(`不支持的内容类型 ${type.split(";")[0] || "未知"}`);
  }
  const chunks = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.length >= limit) {
        chunks.push(value.subarray(0, limit - size));
        size = limit;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  }
  const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
  const charset =
    (type.match(/charset=["']?([\w-]+)/i) ||
      buffer
        .subarray(0, 4096)
        .toString("latin1")
        .match(/charset=["']?([\w-]+)/i) ||
      [])[1] || "utf-8";
  let text;
  try {
    text = new TextDecoder(charset).decode(buffer);
  } catch {
    text = buffer.toString("utf8");
  }
  return { text, type, truncated: size >= limit };
}
async function fetchText(url, timeout = 15000) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw Error(`网页返回 ${response.status}`);
  }
  const { text, type } = await readLimitedText(response);
  return { text, url: response.url, type };
}
async function fetchPublicText(url, timeout = 20000) {
  let current = new URL(url);
  const signal = AbortSignal.timeout(timeout);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
      },
      redirect: "manual",
      signal
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw Error("网页跳转缺少目标地址");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw Error(`网页返回 ${response.status}`);
    }
    const { text, type } = await readLimitedText(response);
    return { text, url: current.href, type };
  }
  throw Error("网页跳转次数过多");
}
// 免 Key 的检索：先 Bing（国内可达；ensearch=1 走国际索引，国内索引对脚本请求会返回无关结果），失败或无结果再试 DuckDuckGo
// Bing 结果链接是 /ck/a?…&u=a1<base64url> 形式的跳转，还原成真实地址
function resolveBingUrl(href) {
  const raw = decodeEntities(href);
  try {
    const url = new URL(raw, "https://www.bing.com");
    if (/bing\.com$/i.test(url.hostname) && url.pathname === "/ck/a") {
      const u = url.searchParams.get("u") || "";
      if (u.startsWith("a1")) return Buffer.from(u.slice(2), "base64url").toString("utf8");
    }
    return url.href;
  } catch {
    return raw;
  }
}
async function searchBing(query, count) {
  const { text } = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&ensearch=1&count=${count}`);
  const results = [];
  for (const match of text.matchAll(
    /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>([\s\S]*?)<\/li>/g
  )) {
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
  for (const match of text.matchAll(
    /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  )) {
    let url = match[1];
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    results.push({ title: stripTags(match[2]), url, snippet: stripTags(match[3]) });
    if (results.length >= count) break;
  }
  return results;
}
async function handleSearch(req, res) {
  try {
    const body = await readJson(req),
      query = String(body.query || "")
        .trim()
        .slice(0, 300),
      count = Math.max(1, Math.min(10, Number(body.count) || 6));
    if (!query) throw Error("搜索关键词不能为空");
    const errors = [];
    let results = [];
    for (const engine of [searchBing, searchDuckDuckGo]) {
      try {
        results = await engine(query, count);
        if (results.length) break;
      } catch (error) {
        errors.push(error.message);
      }
    }
    if (!results.length && errors.length === 2) throw Error(`搜索引擎暂时不可用：${errors[0]}`);
    sendJson(res, 200, { query, results });
  } catch (error) {
    sendJson(res, 400, { error: String(error.message || error).slice(0, 500) });
  }
}
async function handleFetch(req, res) {
  try {
    const body = await readJson(req);
    let url;
    try {
      url = new URL(String(body.url || "").trim());
    } catch {
      throw Error("网址无效");
    }
    const page = await fetchPublicText(url.href, 20000);
    const title = stripTags((page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const text = (/html|xml/i.test(page.type) ? htmlToText(page.text) : page.text).slice(0, 24000);
    sendJson(res, 200, { title, url: page.url, text });
  } catch (error) {
    sendJson(res, 400, { error: String(error.message || error).slice(0, 500) });
  }
}
function upstreamHeaders(config) {
  if (ANTHROPIC.anthropicLike(config)) return ANTHROPIC.anthropicHeaders(config.apiKey);
  return { "Content-Type": "application/json; charset=utf-8", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) };
}
// 列模型的地址：Anthropic 是 /v1/models，OpenAI 兼容的是 Base URL 下的 /models
function upstreamModelsUrl(config) {
  return ANTHROPIC.anthropicLike(config) ? ANTHROPIC.anthropicEndpoint(config.baseUrl, "/v1/models") : modelsUrl(config.baseUrl);
}
async function upstreamError(response) {
  const raw = await response.text().catch(() => "");
  try {
    const json = JSON.parse(raw);
    return json.error?.message || json.message || `上游接口返回 ${response.status}`;
  } catch {
    return raw.slice(0, 300) || `上游接口返回 ${response.status}`;
  }
}

let APP_VERSION = "";
try {
  APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || "";
} catch {}
function handleBootstrap(req, res) {
  sendJson(res, 200, {
    version: APP_VERSION,
    work: {
      home: WORK.WORK_HOME,
      archive: WORK.ARCHIVE_HOME,
      chats: CHATS.CHATS_HOME,
      customChats: true,
      scratch: WORK.SCRATCH_DIR,
      platform: process.platform,
      shell: WORK.WORK_SHELL
    }
  });
}
async function handleTest(req, res) {
  const started = Date.now();
  try {
    const body = await readJson(req),
      config = resolveProfile(body.profile, true);
    const response = await fetch(upstreamModelsUrl(config), { headers: upstreamHeaders(config), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(await upstreamError(response));
    const data = await response.json();
    sendJson(res, 200, {
      ok: true,
      latencyMs: Date.now() - started,
      modelFound: !Array.isArray(data.data) || data.data.some(item => item.id === config.model)
    });
  } catch (error) {
    sendJson(res, 400, { error: String(error.message || error).slice(0, 500) });
  }
}
async function handleModels(req, res) {
  try {
    const body = await readJson(req),
      config = resolveProfile(body.profile, false);
    const response = await fetch(upstreamModelsUrl(config), { headers: upstreamHeaders(config), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(await upstreamError(response));
    const data = await response.json();
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    sendJson(res, 200, { models: list.map(item => (typeof item === "string" ? item : item?.id || item?.name)).filter(Boolean) });
  } catch (error) {
    sendJson(res, 400, { error: String(error.message || error).slice(0, 500) });
  }
}
async function handleChat(req, res) {
  try {
    const body = await readJson(req),
      config = resolveProfile(body.profile, true);
    if (!Array.isArray(body.messages) || !body.messages.length) throw Error("消息不能为空");
    const messages = body.systemPrompt
      ? [{ role: "system", content: String(body.systemPrompt).slice(0, 20000) }, ...body.messages]
      : body.messages;
    const payload = {
      model: config.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: Math.max(0, Math.min(2, Number(body.temperature ?? 0.7)))
    };
    // 页面给了才带 max_tokens（Anthropic 与拟题、压缩这几处）；没给就不传，让接口用自己的默认
    if (Number(body.maxTokens) > 0) payload.max_tokens = Math.max(16, Math.round(Number(body.maxTokens)));
    if (Array.isArray(body.tools) && body.tools.length) {
      if (body.tools.length > TOOLS_LIMIT) throw Error(`工具定义过多：${body.tools.length} 件，一次最多 ${TOOLS_LIMIT} 件`);
      payload.tools = body.tools;
    }
    // 思考强度：只透传这几个字段
    for (const key of ["reasoning_effort", "enable_thinking", "thinking_budget"]) if (body[key] !== undefined) payload[key] = body[key];
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    console.log(
      `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} → ${config.model}：${messages.length} 条消息${payload.tools ? `，工具 ${payload.tools.length} 个` : ""}`
    );
    // Anthropic：请求换成 Messages API 的，回来的事件流换回 OpenAI 风格再给页面；OpenAI 兼容的原样透传（thinking_blocks 是 Anthropic 才要的，去掉）
    const anthropic = ANTHROPIC.anthropicLike(config);
    if (!anthropic) payload.messages = messages.map(m => (m.thinking_blocks ? { ...m, thinking_blocks: undefined } : m));
    const response = await fetch(anthropic ? ANTHROPIC.anthropicEndpoint(config.baseUrl) : endpoint(config.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: upstreamHeaders(config),
      body: JSON.stringify(anthropic ? ANTHROPIC.anthropicRequest(payload) : payload),
      signal: abort.signal
    });
    if (!response.ok) throw Error(await upstreamError(response));
    res.writeHead(200, {
      "Content-Type": anthropic
        ? "text/event-stream; charset=utf-8"
        : response.headers.get("content-type") || "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    await pipeline(
      Readable.fromWeb(anthropic ? response.body.pipeThrough(ANTHROPIC.anthropicToOpenAiStream(config.model)) : response.body),
      res
    );
  } catch (error) {
    if (!res.headersSent) sendJson(res, 400, { error: String(error.message || error).slice(0, 500) });
    else if (!res.writableEnded && !res.destroyed) {
      // 流开了头才断的（上游掐线、读超时）：不能就这么静静结束——页面会把半截话当成写完了。
      // 补一条带 error 的事件再收，页面据此按「连接中断」处理，留着续写的余地；页面自己先走了的不必补
      if (!res.destroyed && error?.name !== "AbortError")
        try {
          res.write(`data: ${JSON.stringify({ error: { message: `上游连接中断：${String(error.message || error).slice(0, 200)}` } })}\n\n`);
        } catch {}
      res.end();
    }
  }
}
const WORK = require("./server/work.js")({ sendJson, readJson, decodeEntities, fetchPublicResponse, readLimitedBytes });
const CHATS = require("./server/chats.js")({ sendJson, readJson });

const NOT_FOUND_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>此页不存在 · 言</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fbfaf6;color:#292724;font-family:"Noto Serif SC","Songti SC","STSong",serif}@media(prefers-color-scheme:dark){body{background:#1e1c19;color:#e6e1d6}}main{text-align:center;letter-spacing:.06em}.seal{display:inline-grid;place-items:center;width:34px;height:34px;border:1px solid #9b5540;color:#9b5540;font-size:18px;transform:rotate(-3deg)}h1{margin:18px 0 8px;font-weight:500;font-size:24px}p{margin:0 0 22px;opacity:.6;font-size:13px}a{color:#9b5540;text-decoration:none;font-size:13px;border-bottom:1px solid currentColor}</style></head><body><main><span class="seal">空</span><h1>此页不存在</h1><p>所寻之处并无一字</p><a href="/">回到案前</a></main></body></html>`;
// 页面脚本与样式由多段源文件拼成：桥接在线时按请求即时拼接（ETag 取各段的大小与修改时间），src/ 改一段、刷新即生效；
// 仓库里的 support.js / app.css 是 build.js 的产物，供 file:// 直接打开时使用，桥接启动时也会顺手刷新它们
const BUNDLES = {
  "/support.js": { build: bundler.bundleScript, type: "application/javascript; charset=utf-8" },
  "/app.css": { build: bundler.bundleStyles, type: "text/css; charset=utf-8" }
};
// 静态服务只开放页面运行真正需要的文件。仓库根目录里还有桥接源码、测试、.git 与用户可能临时放入的配置，
// 不能因为它们恰好位于 ROOT 下就一并交给浏览器；vendor/ 是随页面分发的纯前端资源，提示词则逐个列出。
const PUBLIC_STATIC_FILES = new Set([
  "index.html",
  "theme-boot.js",
  "preview.html",
  "preview-runtime.js",
  "prompts/assistant.js",
  "prompts/work.js",
  "prompts/side.js",
  "prompts/memory.js",
  "prompts/delegate.js",
  "prompts/tools.js"
]);
const REAL_ROOT = fs.realpathSync(ROOT);
function publicStaticTarget(requested) {
  // URL 路径里的反斜杠在 Windows 上也是目录分隔符；先统一再规范化，vendor/../server.js 不能借前缀混进来。
  const webPath = requested.replace(/\\/g, "/"),
    normalized = path.posix.normalize(webPath);
  if (normalized !== webPath || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return null;
  if (!PUBLIC_STATIC_FILES.has(normalized) && !normalized.startsWith("vendor/")) return null;
  const candidate = path.resolve(ROOT, ...normalized.split("/"));
  if (!fs.existsSync(candidate)) return null;
  // 白名单目录中若出现指向仓库外的符号链接，也不能跟出去。
  const file = fs.realpathSync(candidate),
    relative = path.relative(REAL_ROOT, file);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const stat = fs.statSync(file);
  return stat.isFile() ? { file, stat } : null;
}
function serveBundle(req, res, urlPath) {
  const entry = BUNDLES[urlPath];
  if (!entry) return false;
  const bundle = entry.build();
  if (!bundle.files.length) return false;
  const etag = `W/"${Buffer.from(bundle.stamp).toString("base64url").slice(0, 40)}-${bundle.text.length.toString(16)}"`;
  const headers = { "Content-Type": entry.type, "Cache-Control": "no-cache", ETag: etag };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const body = Buffer.from(bundle.text, "utf8");
  res.writeHead(200, { ...headers, "Content-Length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  if (serveBundle(req, res, urlPath)) return;
  const requested = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const target = publicStaticTarget(requested);
  if (!target) {
    if (urlPath.startsWith("/api/")) return sendJson(res, 404, { error: "未找到接口" });
    res.writeHead(404, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
    return res.end(NOT_FOUND_PAGE);
  }
  const { file, stat } = target;
  // 带上 ETag / Last-Modified：no-cache 只要求重新验证，有了校验值浏览器才会真正拿到改动后的文件，而不是沿用旧缓存
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString()
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

// YAN_DEBUG=1：把每个请求与异常断开都打到控制台，排查「页面说桥接没起」这类问题时用
const DEBUG = /^(1|true|yes)$/i.test(String(process.env.YAN_DEBUG || ""));
const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
const server = http.createServer(async (req, res) => {
  if (DEBUG) {
    console.log(`${stamp()} ${req.method} ${req.url} origin=${req.headers.origin || "-"}`);
    res.on("close", () => {
      if (!res.writableFinished) console.log(`${stamp()}   ↳ ${req.method} ${req.url} 连接在响应写完前断开`);
    });
  }
  try {
    securityHeaders(req, res);
    const urlPath = new URL(req.url, `http://${HOST}`).pathname;
    // 能打到本机服务的接口（执事、卷宗、对话目录、http_request）只受理本站页面与 VS Code Webview
    if (
      (urlPath.startsWith("/api/work/") || urlPath.startsWith("/api/archive/") || urlPath.startsWith("/api/chats/") || urlPath === "/api/http") &&
      !trustedWorkRequest(req)
    )
      return sendJson(res, 403, { error: "此页面无权调用本机执事接口，请从桥接地址或 VS Code 打开「言」" });
    corsHeaders(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (req.method === "GET" && req.url === "/api/bootstrap") return handleBootstrap(req, res);
    if (req.method === "POST" && req.url === "/api/test") return await handleTest(req, res);
    if (req.method === "POST" && req.url === "/api/models") return await handleModels(req, res);
    if (req.method === "POST" && req.url === "/api/search") return await handleSearch(req, res);
    if (req.method === "POST" && req.url === "/api/fetch") return await handleFetch(req, res);
    if (req.method === "POST" && req.url === "/api/http") return await handleHttp(req, res);
    if (req.method === "POST" && req.url === "/api/chat") return await handleChat(req, res);
    if (req.method === "POST" && req.url === "/api/work/prepare") return await WORK.handleWorkPrepare(req, res);
    if (req.method === "POST" && req.url === "/api/work/pick") return await WORK.handleWorkPick(req, res);
    if (req.method === "POST" && req.url === "/api/work/run") return await WORK.handleWorkRun(req, res);
    if (req.method === "POST" && req.url === "/api/work/write") return await WORK.handleWorkWrite(req, res);
    if (req.method === "POST" && req.url === "/api/work/read") return await WORK.handleWorkRead(req, res);
    if (req.method === "POST" && req.url === "/api/work/list") return await WORK.handleWorkList(req, res);
    if (req.method === "POST" && req.url === "/api/work/edit") return await WORK.handleWorkEdit(req, res);
    if (req.method === "POST" && req.url === "/api/work/search") return await WORK.handleWorkSearch(req, res);
    if (req.method === "POST" && req.url === "/api/work/download") return await WORK.handleWorkDownload(req, res);
    if (req.method === "POST" && req.url === "/api/archive/list") return await WORK.handleArchiveList(req, res);
    if (req.method === "POST" && req.url === "/api/archive/put") return await WORK.handleArchivePut(req, res);
    if (req.method === "POST" && req.url === "/api/archive/remove") return await WORK.handleArchiveRemove(req, res);
    if (req.method === "POST" && req.url === "/api/archive/clean") return await WORK.handleArchiveClean(req, res);
    if (req.method === "POST" && req.url === "/api/chats/load") return await CHATS.handleLoad(req, res);
    if (req.method === "POST" && req.url === "/api/chats/save") return await CHATS.handleSave(req, res);
    if (req.method === "POST" && req.url === "/api/chats/delete") return await CHATS.handleDelete(req, res);
    if (req.method === "POST" && req.url === "/api/chats/meta") return await CHATS.handleMeta(req, res);
    if ((req.method === "GET" || req.method === "HEAD") && urlPath === "/api/archive/file")
      return await WORK.handleArchiveFile(req, res, new URL(req.url, `http://${HOST}`).searchParams);
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    sendJson(res, 405, { error: "不支持此请求" });
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: String(error.message || error).slice(0, 500) });
    else res.end();
  }
});
server.on("error", error => {
  if (error.code === "EADDRINUSE") console.error(`端口 ${PORT} 已被占用，可设置 YAN_PORT 后重试。`);
  else console.error(error);
  process.exitCode = 1;
});
server.on("clientError", (error, socket) => {
  if (DEBUG) console.log(`${stamp()} 客户端连接错误：${error.code || error.message}`);
  if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});
// 浏览器复用空闲连接的瞬间桥接恰好把它关掉，POST 会以「Failed to fetch」失败（GET 浏览器会自动重发，POST 不会）：
// 把空闲连接保得比浏览器久一些，这个竞态就不会发生
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
// 桥接是本机常驻进程：某个请求里没兜住的异常打出来即可，不能让整个桥接倒下、页面从此「Failed to fetch」
process.on("uncaughtException", error => console.error(`${stamp()} 桥接内部错误（已忽略）：`, error));
process.on("unhandledRejection", error => console.error(`${stamp()} 桥接内部错误（已忽略）：`, error));
server.listen(PORT, HOST, () => {
  const address = `http://${HOST}:${PORT}`;
  try {
    bundler.build({ quiet: true });
  } catch (error) {
    console.log(`  （产出 support.js / app.css 失败：${error.message}）`);
  }
  console.log(
    `\n  言 · 本机桥接${APP_VERSION ? `  v${APP_VERSION}` : ""}\n  页面    ${address}\n  执事    ${WORK.WORK_HOME}\n  卷宗    ${WORK.ARCHIVE_HOME}\n  对话    ${CHATS.CHATS_HOME}\n`
  );
  console.log("  请保持此窗口开启；关闭后页面刷新、模型转发、联网与执事都会停止。按 Ctrl+C 退出。");
  console.log("  此窗口不会显示 API Key。\n");
  if (process.argv.includes("--open") && process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", address], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  }
});
