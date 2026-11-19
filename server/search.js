// 言 · 桥接的检索：免 Key，几家检索源登记成一张表，按序试，前一家不成再下一家——
// 必应（直接请求，轻，可大量开）→ 必应（无头浏览器，见 server/headless.js）→ DuckDuckGo（连搜几回就回 202，只作垫底）。
// 必应对直接请求时好时坏：一阵齐发、或 IP 一时被它看低，便只认第一个词、其余丢掉，照样回满十条（搜「王羲之 兰亭集序」出来 Steam）。
// 这种答非所问不报错，只能从结果上认：后面的词在哪条里都对不上，就当这家被拦了，换下一家
"use strict";
const { jsonRoute } = require("./http.js");
const { decodeEntities, stripTags, fetchText, assertPublicUrl } = require("./web.js");
const browser = require("./headless.js");

// 同一家同时至多几个、前后错开一点：一齐打出去正是被认作脚本的样子
function lane(limit, gap) {
  let active = 0,
    last = 0;
  const waiting = [];
  const next = () => {
    if (active >= limit || !waiting.length) return;
    const wait = last + gap - Date.now();
    if (wait > 0) return void setTimeout(next, wait);
    active++;
    last = Date.now();
    waiting.shift()();
  };
  return async run => {
    await new Promise(resolve => {
      waiting.push(resolve);
      next();
    });
    try {
      return await run();
    } finally {
      active--;
      next();
    }
  };
}

// 必应结果链接是 /ck/a?…&u=a1<base64url> 形式的跳转，还原成真实地址
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
function parseBing(html, count) {
  const results = [];
  for (const match of html.matchAll(
    /<li class="b_algo\b[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>([\s\S]*?)<\/li>/g
  )) {
    const snippet = (match[3].match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "";
    const url = resolveBingUrl(match[1]);
    if (/^https?:\/\//.test(url)) results.push({ title: stripTags(match[2]), url, snippet: stripTags(snippet) });
    if (results.length >= count) break;
  }
  return results;
}
const bingUrl = query => `https://www.bing.com/search?q=${encodeURIComponent(query)}&ensearch=1&form=QBLH`;
// 像浏览器一样留着必应给的 Cookie：头一回先进首页讨一份，此后每次回话里新给的随手记上，自然续期
const bingJar = new Map(),
  bingLane = lane(3, 250);
function keepCookies(headers) {
  for (const line of headers.getSetCookie?.() || []) {
    const pair = line.split(";")[0],
      at = pair.indexOf("=");
    if (at > 0) bingJar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
  }
}
async function searchBing(query, count) {
  return bingLane(async () => {
    if (!bingJar.size) keepCookies((await fetchText("https://www.bing.com/")).headers);
    const { text, headers } = await fetchText(bingUrl(query), {
      headers: { Cookie: [...bingJar].map(([name, value]) => `${name}=${value}`).join("; "), Referer: "https://www.bing.com/" }
    });
    keepCookies(headers);
    return parseBing(text, count);
  });
}
async function searchBingBrowser(query, count) {
  const page = await browser.render(bingUrl(query), { gate: assertPublicUrl, waitFor: "#b_results .b_algo", timeout: 12000 });
  return parseBing(page.html, count);
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

/** @type {{ label: string, run: (query: string, count: number) => Promise<{title: string, url: string, snippet: string}[]>, usable?: () => boolean }[]} */
const SOURCES = [
  { label: "必应", run: searchBing },
  { label: "必应（浏览器）", run: searchBingBrowser, usable: browser.available },
  { label: "DuckDuckGo", run: searchDuckDuckGo }
];

// 答非所问：查询有两个词以上，而没有哪一条（题与摘要）对得上至少半数（且至少两个）。
// 只认被拦时那种「只剩第一个词」的样子，宁松勿紧：汉字词对上其中任意一对连续字也算；不另做同义或繁简转换
function offTopic(query, results) {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .replace(/["“”「」()（）]/g, " ")
        .split(/\s+/)
        .filter(term => term && !/^-|^(site|filetype|intitle|inurl):/.test(term))
    )
  ];
  if (terms.length < 2 || !results.length) return false;
  const needed = Math.min(terms.length, Math.max(2, Math.ceil(terms.length / 2)));
  const hit = (text, term) => {
    if (text.includes(term)) return true;
    return (term.match(/\p{Script=Han}{2,}/gu) || []).some(run => [...run.slice(1)].some((_, i) => text.includes(run.slice(i, i + 2))));
  };
  return !results.some(({ title, snippet }) => {
    const text = `${title} ${snippet}`.toLowerCase();
    return terms.filter(term => hit(text, term)).length >= needed;
  });
}

const handleSearch = jsonRoute(async body => {
  const query = String(body.query || "")
      .trim()
      .slice(0, 300),
    count = Math.max(1, Math.min(10, Number(body.count) || 6));
  if (!query) throw Error("搜索关键词不能为空");
  const errors = [];
  let stray = null;
  for (const source of SOURCES) {
    if (source.usable && !source.usable()) continue;
    try {
      const results = await source.run(query, count);
      if (!results.length) continue;
      if (!offTopic(query, results)) return { query, results, source: source.label };
      stray ||= { query, results, source: source.label, offTopic: true };
    } catch (error) {
      errors.push(`${source.label}：${error.message}`);
    }
  }
  // 没有切题的结果时，若有答非所问的结果，保留最先拿到的一份并标记，由模型掂量
  if (stray) return stray;
  // 一家零条（被拦时回的是验证页，也是零条）、另一家连不上：说不准是真没有，按报错交回，模型才不当「查无此事」
  if (errors.length) throw Error(`搜索引擎暂时不可用：${errors.join("；")}`);
  return { query, results: [] };
});

module.exports = { openRoutes: { "POST /api/search": handleSearch }, parseBing, offTopic };
