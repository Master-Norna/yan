// 言 · 联网：检索、翻网页、调接口，都经桥接。地址门禁在桥接那头：本机 127.0.0.1 可，别的内网地址不可
defineTool({
  name: "search_web",
  group: "web",
  label: t("检索"),
  lookup: true,
  parallel: true,
  cache: args => ({ ...args, query: args.query.trim().replace(/\s+/g, " ").toLowerCase() }),
  digest: step =>
    t`检索「${String(step.title || "").slice(0, 60)}」→ ${
      (step.results || [])
        .slice(0, 3)
        .map(r => `${String(r.title || "").slice(0, 40)}（${r.url}）`)
        .join("；") ||
      step.result ||
      step.status
    }`,
  sources: step => (step.results || []).map(r => ({ url: r.url, title: r.title })),
  async run(step, args, { signal }) {
    step.title = args.query;
    const data = await bridge("/api/search", { query: args.query, count: 6 }, signal);
    step.results = data.results.map(({ title, url, snippet }) => ({ title, url, snippet }));
    // 各家都答非所问（搜索引擎多半在拦）：结果照给，先说一声
    const doubt = data.offTopic ? t("（这批结果与关键词对不上，搜索引擎多半在拦，未必可信）\n") : "";
    return {
      ok: true,
      content: step.results.length ? doubt + JSON.stringify(step.results) : t("未找到结果"),
      display: `${step.results.length} 条结果`
    };
  }
});

// 一段多少字：与桥接那头（server/web.js 的 PAGE_CHARS）一样长；PDF 在这头分段，用这个
const FETCH_PAGE_CHARS = 24000;
defineTool({
  name: "fetch_page",
  group: "web",
  label: t("翻阅网页"),
  lookup: true,
  parallel: true,
  // 同一页的不同锚点是同一页
  cache: args => ({ ...args, url: URL.canParse(args.url) ? Object.assign(new URL(args.url), { hash: "" }).href : args.url.trim() }),
  digest: step =>
    t`翻阅 ${String(step.title || step.url || "").slice(0, 60)}${step.url && step.title ? `（${step.url}）` : ""} → ${step.status === "done" ? t("已读") : step.result || step.status}`,
  sources: step => [{ url: step.url, title: step.title, read: true }],
  async run(step, args, { signal }) {
    step.url = args.url;
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0)),
      data = await bridge("/api/fetch", { url: args.url, offset }, signal);
    step.title = data.title || args.url;
    let { text, total } = data;
    // PDF 由桥接原样交回，在这头抽字（与附件同一套 pdf.js），一段与网页一样长
    if (data.pdf) {
      const full = await extractPdfText(data.pdf).catch(error => {
        throw Error(/文字层/.test(error.message) ? t("这份 PDF 没有文字层（多半是扫描件），读不出字") : error.message);
      });
      total = full.length;
      text = full.slice(offset, offset + FETCH_PAGE_CHARS);
    }
    const end = offset + text.length;
    const notes = [
      total && offset >= total && t`正文共 ${total} 字，offset 已过了末尾`,
      end < total && t`正文共 ${total} 字，此处为第 ${offset + 1}–${end} 字；续读传 offset=${end}`,
      data.scripted && t("抽出的正文寥寥：这页多半要跑脚本才出内容，所见并非全貌")
    ].filter(Boolean);
    return {
      ok: true,
      content: t`标题：${data.title}\n地址：${data.url}\n\n${text}${notes.length ? `\n\n（${notes.join("；")}）` : ""}`,
      display: `${offset ? `自 ${offset + 1} 字 · ` : ""}${text.length} 字${end < total ? " · 截" : ""}`
    };
  }
});

// 调接口能发 POST，不算纯查阅，旁注不给。GET 也不复用：多是打本机的开发服务，改了代码再 GET 就该是新的
defineTool({
  name: "http_request",
  group: "web",
  label: t("问接口"),
  // 旁注也给，只许 GET、HEAD
  lookup: true,
  sideEffect: true,
  digest: step => t`调接口 ${String(step.title || "").slice(0, 120)} → ${step.result || step.status}`,
  async run(step, args, { signal, lookup }) {
    const url = args.url.trim(),
      method = (args.method || "GET").trim().toUpperCase();
    step.url = url;
    step.title = `${method} ${url}`.slice(0, 200);
    if (lookup && !["GET", "HEAD"].includes(method))
      return { ok: false, content: t`旁注只查不改：${method} 不调，只许 GET、HEAD`, display: "非只读" };
    const data = await bridge("/api/http", { url, method, headers: args.headers, body: args.body }, signal);
    const headers = Object.entries(data.headers)
      .map(([name, value]) => `${name}: ${String(value).slice(0, 300)}`)
      .join("\n");
    const body = data.textual ? data.text || t("(空)") : t`（${data.type || t("二进制")}，${formatFileSize(data.bytes)}，不作为文本返回）`;
    step.output = trimOutput(`${data.status} ${data.statusText}\n${body}`);
    return {
      ok: data.status < 400,
      content: t`HTTP ${data.status} ${data.statusText}${data.url !== url ? t`（跳转到 ${data.url}）` : ""}\n--- 响应头 ---\n${headers}\n--- 正文${data.truncated ? t("（已截断）") : ""} ---\n${body}`,
      display: `${data.status} · ${data.textual ? `${data.text.length} 字` : formatFileSize(data.bytes)}`
    };
  }
});
