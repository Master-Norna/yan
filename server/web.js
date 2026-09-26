// 言 · 桥接的联网：地址门禁（公网才放行，http_request / download_file 另放本机回环）、按量读正文、翻网页、免 Key 检索、调接口
// 地址门禁与读正文是纯函数，server/work/ 的 download_file 与 CLIXML 还原直接 require；routes 由 server.js 装进接口表
"use strict";
const dns = require("node:dns").promises;
const net = require("node:net");
const { jsonRoute } = require("./http.js");

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
// 桥接自己发出的请求都带这个头；桥接收到带它的 /api/ 请求一律拒绝。http_request / download_file 能打本机，
// 不设这一道，模型就能借它们调桥接自己的执事接口，绕过请示与沙箱在沙箱外跑指令（无 Origin、Host 也对得上）
const OUTBOUND_MARK = "x-yan-outbound";
// 带方法与请求体的公网请求（http_request / download_file 用）：同样的地址门禁，跳转逐跳再查；返回的是 Response，正文由调用者按需读
async function fetchPublicResponse(url, { method = "GET", headers = {}, body = null, timeout = 30000, allowLoopback = false } = {}) {
  let current = new URL(url);
  const signal = AbortSignal.timeout(timeout);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicUrl(current, { allowLoopback });
    const response = await fetch(current, {
      method,
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7", ...headers, [OUTBOUND_MARK]: "1" },
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
const handleHttp = jsonRoute(async body => {
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
    if (/^[\w-]+$/.test(name) && !/^(host|content-length|connection|cookie|x-yan-outbound)$/i.test(name))
      headers[name] = String(value).slice(0, 4000);
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
  return {
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
  };
});
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
const handleSearch = jsonRoute(async body => {
  const query = String(body.query || "")
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
  return { query, results };
});
const handleFetch = jsonRoute(async body => {
  let url;
  try {
    url = new URL(String(body.url || "").trim());
  } catch {
    throw Error("网址无效");
  }
  const page = await fetchPublicText(url.href, 20000);
  const title = stripTags((page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const text = (/html|xml/i.test(page.type) ? htmlToText(page.text) : page.text).slice(0, 24000);
  return { title, url: page.url, text };
});

module.exports = {
  // 引导、检索、翻网页：本机桥接认得的来源都可调
  openRoutes: { "POST /api/search": handleSearch, "POST /api/fetch": handleFetch },
  // http_request 能打本机的服务，只给受信的页面
  routes: { "POST /api/http": handleHttp },
  OUTBOUND_MARK,
  decodeEntities,
  fetchPublicResponse,
  readLimitedBytes
};
