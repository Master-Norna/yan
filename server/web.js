// 言 · 桥接的联网：地址门禁（公网才放行，http_request / download_file 另放本机回环）、按量读正文、翻网页、调接口（检索在 server/search.js）
// 地址门禁与读正文是纯函数，server/work/ 的 download_file 与 CLIXML 还原直接 require；routes 由 server.js 装进接口表
"use strict";
const dns = require("node:dns").promises;
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const { Readable } = require("node:stream");
const zlib = require("node:zlib");
const { jsonRoute } = require("./http.js");
const browser = require("./headless.js");

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
// 超出 Unicode 范围的实体（&#99999999;）fromCodePoint 会抛错，整页就读不成：换成替换符
const codePoint = n => (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "�");
function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
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
// 网页转文字：脚本、样式、表单控件去掉（整页包在 <form> 里的站点，form 本身不能删）；有 <article> / <main> 就只取它，
// 连同它自己的标题与作者（页头页脚、导航是在它之外才删）；<pre> 里的缩进原样留着，代码才用得了
function htmlToText(html) {
  let text = String(html)
    .replace(/<(script|style|noscript|svg|iframe|template|select|textarea|button)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const main = text.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 500) text = main[2];
  else text = text.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ");
  const pres = [];
  text = text
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => {
      pres.push(decodeEntities(body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/^\n|\s+$/g, ""));
      return `\n\u0000${pres.length - 1}\u0000\n`;
    })
    .replace(/<\/(p|div|li|h\d|tr|section|blockquote|dd|dt)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => pres[Number(i)])
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
  if (net.isIP(host)) return [{ address: host, family: net.isIP(host) }];
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  const hit = addresses.find(item => blocked(item.address) && !isFakeIpAddress(item.address));
  if (!addresses.length || hit) throw Error(`网址解析到了本机或内网地址${hit ? `（${hit.address}）` : ""}`);
  return addresses;
}
// 连接只用刚验过的解析结果：Host / TLS SNI 仍取原域名，不在 fetch 时再解析一回。
const pinnedLookup = addresses => (_host, options, done) => {
  const list = options.family ? addresses.filter(item => item.family === options.family) : addresses;
  if (!list.length) return done(Error("网址没有可用的 IP 地址"));
  if (options.all) done(null, list);
  else done(null, list[0].address, list[0].family);
};
function pinnedFetch(url, options, addresses) {
  if (url.username || url.password) return Promise.reject(Error("请用请求头提供认证，不在网址里放凭据"));
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      { ...options, lookup: pinnedLookup(addresses), agent: false },
      incoming => {
        const headers = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
        const decode = { gzip: zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress }[
          headers.get("content-encoding")
        ];
        const empty = options.method === "HEAD" || [204, 205, 304].includes(incoming.statusCode);
        /** @type {import("node:stream").Readable} */
        let body = incoming;
        if (decode && !empty) {
          const inflate = decode();
          incoming.on("error", error => inflate.destroy(error));
          inflate.on("close", () => incoming.destroy());
          incoming.pipe(inflate);
          body = inflate;
          headers.delete("content-encoding");
          headers.delete("content-length");
        }
        if (empty) incoming.resume();
        resolve(new Response(empty ? null : Readable.toWeb(body), { status: incoming.statusCode, headers }));
      }
    );
    request.on("error", reject);
    request.end(options.body || undefined);
  });
}
// 桥接自己发出的请求都带这个头；桥接收到带它的 /api/ 请求一律拒绝。http_request / download_file 能打本机，
// 不设这一道，模型就能借它们调桥接自己的执事接口，绕过请示与沙箱在沙箱外跑指令（无 Origin、Host 也对得上）
const OUTBOUND_MARK = "x-yan-outbound";
// 带方法与请求体的公网请求（http_request / download_file 用）：同样的地址门禁，跳转逐跳再查；返回的是 Response，正文由调用者按需读
async function fetchPublicResponse(
  url,
  { method = "GET", headers = {}, body = null, timeout = 30000, allowLoopback = false, signal = null } = {}
) {
  let current = new URL(url);
  // 调用方的中止（页面走了、这一问停了）与超时一并算数；没传即照旧只有超时
  const deadline = AbortSignal.timeout(timeout),
    stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const addresses = await assertPublicUrl(current, { allowLoopback });
    const response = await pinnedFetch(
      current,
      {
        method,
        headers: { "User-Agent": BROWSER_UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7", ...headers, [OUTBOUND_MARK]: "1" },
        body: body && !["GET", "HEAD"].includes(method) ? body : undefined,
        signal: stop
      },
      addresses
    );
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      await response.body?.cancel().catch(() => {});
      const next = new URL(response.headers.get("location"), current);
      // 自定义头可能就是凭据（包括服务自定的 token 头）：跨来源时不替用户转交。
      if (
        next.origin !== current.origin &&
        Object.keys(headers).some(
          name => !/^(accept|accept-language|content-type|user-agent|range|if-none-match|if-modified-since)$/i.test(name)
        )
      )
        throw Error("带自定义认证请求头的请求不能跨来源跳转，请直接请求目标地址");
      current = next;
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
  const text = textual ? decodeText(buffer, charsetOf(type)) : "";
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
const IMAGE_LIMIT = 15 * 1024 * 1024;
// 正文里的外链图：页面不直连外站（见 server.js 的 CSP），人点了才由这里取（见 src/04-markdown 的 renderRemoteShots）。
// 地址门禁与逐跳再查同翻网页，只收图片、至多 15 MB，交回 data URL
const handleImage = jsonRoute(async body => {
  let url;
  try {
    url = new URL(String(body.url || "").trim());
  } catch {
    throw Error("网址无效");
  }
  if (!/^https?:$/.test(url.protocol)) throw Error("只取 http / https 的图");
  const { response } = await fetchPublicResponse(url.href, {
    headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*;q=0.8" },
    timeout: 20000
  });
  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !type.startsWith("image/")) {
    await response.body?.cancel().catch(() => {});
    throw Error(!response.ok ? `对方回 ${response.status}` : `不是图片（${type || "未知类型"}）`);
  }
  const { buffer, truncated } = await readLimitedBytes(response, IMAGE_LIMIT);
  if (truncated) throw Error("图片超过 15 MB");
  return { data: `data:${type};base64,${buffer.toString("base64")}`, size: buffer.length };
});
const FETCH_TEXT_LIMIT = 3 * 1024 * 1024;
const charsetOf = text => (String(text).match(/charset=["']?([\w-]+)/i) || [])[1];
// 认不得的字符集（写错、冷门）照 UTF-8 读，不让整页读不成
function decodeText(buffer, charset = "utf-8") {
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}
// 正文最多只收 3 MB（见 readLimitedBytes：边读边计，对方回 500 MB 也只占 3 MB）；字符集先看响应头，没写再看页头的 <meta>
async function readLimitedText(response, limit = FETCH_TEXT_LIMIT) {
  const type = response.headers.get("content-type") || "";
  if (!/text\/|application\/(xhtml|json|xml)/i.test(type)) {
    await response.body?.cancel().catch(() => {});
    throw Error(`不支持的内容类型 ${type.split(";")[0] || "未知"}`);
  }
  const { buffer, truncated } = await readLimitedBytes(response, limit);
  const charset = charsetOf(type) || charsetOf(buffer.subarray(0, 4096).toString("latin1"));
  return { text: decodeText(buffer, charset), type, truncated };
}
// 取网页的字（翻网页、检索）：地址门禁与逐跳再查都经 fetchPublicResponse，只此一路。没成的报错带 status（翻网页据此认被拒）；
// pdf：是 PDF 就原样交回字节，不当文字读
async function fetchText(url, { timeout = 15000, headers = {}, pdf = false } = {}) {
  const { response, url: finalUrl } = await fetchPublicResponse(url, {
    headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", ...headers },
    timeout
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw Object.assign(Error(`网页返回 ${response.status}`), { status: response.status });
  }
  const declared = response.headers.get("content-type") || "";
  if (pdf && (/application\/pdf/i.test(declared) || (/octet-stream/i.test(declared) && /\.pdf$/i.test(new URL(finalUrl).pathname)))) {
    const { buffer, truncated } = await readLimitedBytes(response, PDF_LIMIT);
    if (truncated) throw Error("PDF 超过 20 MB，用 download_file 存下来再读");
    return { pdf: buffer, url: finalUrl, type: declared };
  }
  const { text, type } = await readLimitedText(response);
  return { text, url: finalUrl, type, headers: response.headers };
}
const PAGE_CHARS = 24000,
  PDF_LIMIT = 20 * 1024 * 1024,
  // 直接请求被拒（多是认出了脚本）：交给无头浏览器开一页再取
  REFUSED = new Set([401, 403, 429, 503]);
// 翻网页：先直接请求（轻）；被拒、或抽出的字寥寥而页里满是脚本（要跑脚本才出内容），再交给无头浏览器（server/headless.js）。
// 长文按 offset 一段段读；PDF 原样交回页面，由页面那头的 pdf.js 抽字（与附件同一套）
const handleFetch = jsonRoute(async body => {
  let url;
  try {
    url = new URL(String(body.url || "").trim());
  } catch {
    throw Error("网址无效");
  }
  const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
  let page = null,
    refused = null;
  try {
    page = await fetchText(url.href, { timeout: 20000, pdf: true });
  } catch (error) {
    if (!REFUSED.has(error.status) || !browser.available()) throw error;
    refused = error;
  }
  if (page?.pdf) {
    let name = "";
    try {
      name = decodeURIComponent(new URL(page.url).pathname.split("/").pop());
    } catch {}
    return { title: name || page.url, url: page.url, pdf: `data:application/pdf;base64,${page.pdf.toString("base64")}` };
  }
  const html = !page || /html|xml/i.test(page.type);
  let title = page ? stripTags((page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "") : "",
    full = !page ? "" : html ? htmlToText(page.text) : page.text,
    finalUrl = page?.url || url.href,
    scripted = !!page && html && full.trim().length < 200 && (page.text.match(/<script/gi) || []).length >= 3;
  if (refused || (scripted && browser.available()))
    try {
      const shown = await browser.render(url.href, { gate: assertPublicUrl }),
        text = htmlToText(shown.html);
      if (text.trim().length > full.trim().length) {
        full = text;
        title = shown.title || title;
        finalUrl = shown.url;
        scripted = false;
      }
    } catch {}
  if (refused && !full.trim()) throw refused;
  // total：正文共多少字，页面据此说读到了哪、怎么续读；scripted：浏览器也没能补上，所见并非全貌
  return {
    title,
    url: finalUrl,
    text: full.slice(offset, offset + PAGE_CHARS),
    offset,
    total: full.length,
    ...(scripted ? { scripted: true } : {})
  };
});

module.exports = {
  // 引导、翻网页：本机桥接认得的来源都可调（检索在 server/search.js）
  openRoutes: { "POST /api/fetch": handleFetch },
  // http_request 能打本机的服务，只给受信的页面
  routes: { "POST /api/http": handleHttp, "POST /api/remote-image": handleImage },
  OUTBOUND_MARK,
  decodeEntities,
  stripTags,
  fetchText,
  assertPublicUrl,
  pinnedLookup,
  fetchPublicResponse,
  readLimitedBytes
};
