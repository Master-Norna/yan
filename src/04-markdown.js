// 言 · Markdown、代码高亮、公式、图表与网页沙箱
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- Markdown：marked 解析、DOMPurify 净化、highlight.js 代码高亮、KaTeX 公式 ----------
const PURIFY_OPTIONS = { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "iframe", "object", "embed"] };
function setupMarkdown() {
  if (!window.marked) return;
  const inlineMath = {
    name: "mathInline",
    level: "inline",
    start(src) {
      const m = src.match(/\$(?!\s)|\\\(/);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const m = src.match(/^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/) || src.match(/^\\\(([\s\S]+?)\\\)/);
      return m ? { type: "mathInline", raw: m[0], text: m[1] } : undefined;
    },
    renderer(token) {
      return renderMath(token.text, false);
    }
  };
  const blockMath = {
    name: "mathBlock",
    level: "block",
    start(src) {
      const m = src.match(/\$\$|\\\[/);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$(?:\n+|$)/) || src.match(/^\\\[([\s\S]+?)\\\](?:\n+|$)/);
      return m ? { type: "mathBlock", raw: m[0], text: m[1].trim() } : undefined;
    },
    renderer(token) {
      return `<div class="math-block">${renderMath(token.text, true)}</div>\n`;
    }
  };
  marked.use({
    gfm: true,
    breaks: true,
    renderer: {
      code({ text, lang }) {
        return codeBlockHtml(text, lang);
      }
    },
    extensions: [blockMath, inlineMath]
  });
  if (window.DOMPurify)
    DOMPurify.addHook("afterSanitizeAttributes", node => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (node.tagName === "INPUT") node.setAttribute("disabled", "");
    });
}
function renderMath(tex, display) {
  // KaTeX 未加载时先放一个占位，库到位后由 renderPendingMath 就地替换；流式尾段每帧重绘，加载完成后自然变成正式渲染
  if (!window.katex) {
    void ensureLib("katex");
    return `<span class="math-pending" data-tex="${escapeHtml(tex)}" data-display="${display ? "1" : "0"}"><code>${escapeHtml(tex)}</code></span>`;
  }
  try {
    return window.katex
      ? katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" })
      : `<code>${escapeHtml(tex)}</code>`;
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}
function codeBlockHtml(text, lang) {
  const language = String(lang || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase(),
    known = !!(window.hljs && language && hljs.getLanguage(language));
  const htmlApp = ["html", "interactive", "app"].includes(language);
  // mermaid / echarts 代码块在页内直接出图；流式尾段尚未闭合时显示轻量成图状态。
  // 占位框里报着写到第几行：数字随流式跳动，动效关掉了也看得出还在写，不会以为卡住了
  if (suppressViz && (htmlApp || language === "mermaid" || language === "echarts")) {
    const lines = String(text || "").split("\n").length;
    return `<div class="viz viz-pending" data-viz-pending="${language}" role="status" aria-label="${htmlApp ? "交互内容仍在生成" : "图形仍在生成"}"><div class="code-head"><span class="code-lang">${language}</span><span class="viz-pending-signal" aria-hidden="true"></span></div><div class="viz-pending-body" aria-hidden="true"><span class="viz-pending-mark"></span><span class="viz-pending-label">${htmlApp ? "页面" : "图形"}写到第 ${lines} 行</span></div></div>\n`;
  }
  if (!suppressViz && (language === "mermaid" || language === "echarts"))
    return `<div class="viz" data-viz="${language}"><div class="code-head"><span class="code-lang">${language}</span><span><button type="button" class="code-copy" data-viz-toggle>源码</button><button type="button" class="code-copy" data-viz-download>下载</button><button type="button" class="code-copy" data-work-expand>全屏</button><button type="button" class="code-copy" data-copy-code>复制</button></span></div><div class="viz-canvas"></div><pre class="viz-source hidden"><code>${escapeHtml(text)}</code></pre></div>\n`;
  if (!suppressViz && htmlApp)
    return `<div class="html-app" data-html-app><div class="code-head"><span class="code-lang">html · 正在载入</span><span><button type="button" class="code-copy" data-app-toggle>源码</button><button type="button" class="code-copy" data-app-restart>重启</button><button type="button" class="code-copy" data-app-download>下载</button><button type="button" class="code-copy" data-work-expand>全屏</button><button type="button" class="code-copy" data-copy-code>复制</button></span></div><div class="html-app-stage"><span>正在载入交互内容</span></div><pre class="html-app-source hidden"><code>${escapeHtml(text)}</code></pre></div>\n`;
  let html;
  try {
    html = known ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
  } catch {
    html = escapeHtml(text);
  }
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${escapeHtml(language || "text")}</span><button type="button" class="code-copy" data-copy-code>复制</button></div><pre><code class="hljs${known ? ` language-${escapeHtml(language)}` : ""}">${html}</code></pre></div>\n`;
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function setupMermaid() {
  if (!window.mermaid) return;
  const dark = document.documentElement.dataset.theme === "dark";
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: cssVar("--body"),
    flowchart: { htmlLabels: false, curve: "basis" },
    themeVariables: {
      background: "transparent",
      primaryColor: cssVar("--paper-2"),
      primaryTextColor: cssVar("--ink"),
      primaryBorderColor: cssVar("--ink-3"),
      lineColor: cssVar("--ink-2"),
      secondaryColor: cssVar("--paper-3"),
      tertiaryColor: cssVar("--paper"),
      noteBkgColor: cssVar("--accent-soft"),
      noteTextColor: cssVar("--ink"),
      fontSize: "14px",
      darkMode: dark
    }
  });
}
function mapOptionPart(value, transform) {
  if (Array.isArray(value)) return value.map(item => transform(item || {}));
  return transform(value && typeof value === "object" ? value : {});
}
function themedEchartsOption(raw, canvas) {
  const option = { ...raw };
  delete option.height;
  const ink = cssVar("--ink"),
    muted = cssVar("--ink-2"),
    line = cssVar("--line"),
    paper = cssVar("--paper-2");
  const narrow = canvas.clientWidth < 520,
    titleShown = Array.isArray(option.title) ? option.title.some(item => item?.text) : !!option.title?.text;
  const textPart = (value, defaults) =>
    mapOptionPart(value, item => ({ ...defaults, ...item, textStyle: { ...defaults.textStyle, ...(item.textStyle || {}) } }));
  const axisPart = value =>
    mapOptionPart(value, item => ({
      ...item,
      axisLabel: { color: muted, ...(item.axisLabel || {}) },
      axisLine: { ...(item.axisLine || {}), lineStyle: { color: line, ...(item.axisLine?.lineStyle || {}) } },
      axisTick: { ...(item.axisTick || {}), lineStyle: { color: line, ...(item.axisTick?.lineStyle || {}) } },
      splitLine: { ...(item.splitLine || {}), lineStyle: { color: line, ...(item.splitLine?.lineStyle || {}) } }
    }));
  if (option.title !== undefined)
    option.title = textPart(option.title, {
      ...(narrow ? { left: 8, top: 7 } : {}),
      textStyle: { color: ink, fontFamily: cssVar("--title"), fontSize: narrow ? 16 : 18 }
    });
  if (option.legend !== undefined)
    option.legend = textPart(option.legend, {
      ...(narrow ? { left: 8, top: titleShown ? 48 : 10, itemWidth: 16, itemHeight: 9, itemGap: 12 } : {}),
      textStyle: { color: muted, fontFamily: cssVar("--body"), fontSize: narrow ? 11 : 12 }
    });
  if (option.tooltip !== undefined)
    option.tooltip = textPart(option.tooltip, {
      backgroundColor: paper,
      borderColor: line,
      textStyle: { color: ink, fontFamily: cssVar("--body") }
    });
  if (option.xAxis !== undefined) option.xAxis = axisPart(option.xAxis);
  if (option.yAxis !== undefined) option.yAxis = axisPart(option.yAxis);
  if (narrow) option.grid = { top: titleShown ? 94 : 58, left: 12, right: 12, bottom: 28, containLabel: true, ...(option.grid || {}) };
  return {
    ...option,
    backgroundColor: option.backgroundColor ?? "transparent",
    textStyle: { color: muted, fontFamily: cssVar("--body"), ...(option.textStyle || {}) },
    color: option.color || [cssVar("--accent"), cssVar("--code-green"), cssVar("--code-blue"), "#c9a227", "#8a6f8e", "#5f8ba0"]
  };
}
// 模型给的 JSON 常有小滑头（尾逗号、注释、单引号、裸键名）；逐层尝试修补，实在补不上再抛原始错误
const skipTrivia = (text, i) => {
  while (i < text.length) {
    const ch = text[i],
      next = text[i + 1];
    if (/\s/.test(ch)) i += 1;
    else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      i += 1;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
    } else break;
  }
  return i;
};
function parseVizJson(source) {
  let error;
  try {
    return JSON.parse(source);
  } catch (err) {
    error = err;
  }
  // 单遍状态机：剥注释与尾逗号，字符串内部原样保留
  const strip = text => {
    let out = "",
      str = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i],
        next = text[i + 1];
      if (str) {
        if (ch === "\\") {
          out += ch + (next ?? "");
          i += 1;
        } else if (ch === str) str = "";
        out += ch;
        continue;
      }
      if (ch === '"' || ch === "'") {
        str = ch;
        out += ch;
        continue;
      }
      if (ch === "/" && next === "/") {
        while (i < text.length && text[i] !== "\n") i += 1;
        out += "\n";
        continue;
      }
      if (ch === "/" && next === "*") {
        i += 1;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
        i += 1;
        continue;
      }
      if (ch === ",") {
        const j = skipTrivia(text, i + 1);
        if (text[j] === "}" || text[j] === "]") continue; // 尾逗号（后面即使隔着注释也算）
      }
      out += ch;
    }
    return out;
  };
  let attempt = strip(source);
  try {
    return JSON.parse(attempt);
  } catch {}
  const single = (source.match(/'/g) || []).length,
    double = (source.match(/"/g) || []).length;
  if (single > double) {
    attempt = attempt.replace(/'([^'\n]*)'/g, (_, body) => '"' + body.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');
    try {
      return JSON.parse(attempt);
    } catch {}
  }
  attempt = attempt.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  try {
    return JSON.parse(attempt);
  } catch {}
  throw error;
}
// 渲染过的 mermaid SVG 按 消息+序号+内容哈希 缓存；整列重绘时同步回填，不再等二次渲染闪空白
const vizKeyHash = text => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
};
function rememberMermaidSvg(key, svg) {
  mermaidSvgCache.set(key, svg);
  if (mermaidSvgCache.size > 48) mermaidSvgCache.delete(mermaidSvgCache.keys().next().value);
}
function stabilizeMermaidSvg(canvas) {
  const svg = canvas.querySelector("svg");
  if (!svg) return "";
  const font = cssVar("--body") || '"Microsoft YaHei UI",system-ui,sans-serif';
  svg.style.fontFamily = font;
  svg.style.fontSize = "14px";
  svg.style.lineHeight = "1.5";
  // DOMPurify 会保留 foreignObject 的安全纯文字，但会剥掉 Mermaid 用来固定行高的 HTML 包装。
  // 将 Mermaid 计算节点时使用的 14px / 1.5 直接写回 SVG，避免正文的 1.85 行高把末行裁掉；内联样式也随下载保留。
  for (const label of svg.querySelectorAll("foreignObject")) {
    label.style.fontFamily = font;
    label.style.fontSize = "14px";
    label.style.lineHeight = "1.5";
  }
  return svg.outerHTML;
}
async function renderViz(root) {
  const list = Array.isArray(root) ? root : [...root.querySelectorAll(".viz[data-viz]:not([data-rendered])")];
  for (const el of list) {
    if (el.dataset.rendered || !el.isConnected) continue; // 两次渲染请求在 await 间隔里可能点到同一张图，只画一次
    el.dataset.rendered = "1";
    const source = el.querySelector(".viz-source")?.textContent || "",
      canvas = el.querySelector(".viz-canvas");
    const viewport = followBottom ? null : scrollSnapshot();
    try {
      if (!(await ensureLib(el.dataset.viz))) throw Error("图形库未能加载，请刷新页面重试");
      if (el.dataset.viz === "mermaid") {
        const message = el.closest(".message"),
          siblings = message ? [...message.querySelectorAll(".viz[data-viz]")] : [el];
        const key = `${vizThemeKey()}:${message?.dataset.message || "anon"}:${siblings.indexOf(el)}:${vizKeyHash(source)}`;
        const cached = mermaidSvgCache.get(key);
        if (cached) canvas.innerHTML = cached;
        else {
          const { svg } = await mermaid.render(`mmd${uid().replace(/[^a-z0-9]/gi, "")}`, source);
          const clean = window.DOMPurify
            ? DOMPurify.sanitize(svg, {
                USE_PROFILES: { svg: true, svgFilters: true },
                ADD_TAGS: ["foreignObject"],
                ADD_ATTR: ["dominant-baseline"]
              })
            : "";
          canvas.innerHTML = clean;
          const stable = stabilizeMermaidSvg(canvas);
          if (!stable) throw Error("图形清洗后为空");
          canvas.innerHTML = stable;
          rememberMermaidSvg(key, stable);
        }
      } else if (el.dataset.viz === "echarts") {
        const option = parseVizJson(source);
        canvas.style.height = `${Math.min(560, Math.max(220, Number(option.height) || 320))}px`;
        const chart = echarts.init(canvas, null, { renderer: "canvas" });
        canvas.style.width = ""; // 别把宽度钉死在创建时刻，让容器宽度跟随外层布局
        canvas.dataset.vizWidth = String(canvas.clientWidth);
        chart.setOption(themedEchartsOption(option, canvas));
        vizCharts.add(chart);
        vizObserver?.observe(canvas);
      }
      el.classList.add("viz-ok");
      if (followBottom) requestAnimationFrame(scrollBottom);
      else restoreScrollPosition(viewport);
    } catch (error) {
      el.classList.add("viz-error");
      canvas.innerHTML = `<div class="viz-fail">无法渲染：${escapeHtml(
        String(error.message || error)
          .split("\n")[0]
          .slice(0, 200)
      )}</div>`;
      el.querySelector(".viz-source")?.classList.remove("hidden");
      if (viewport) restoreScrollPosition(viewport);
    }
  }
}
function htmlAppSource(el) {
  return el.querySelector(".html-app-source code")?.textContent || "";
}
function sendHtmlApp(el) {
  const iframe = el.querySelector("iframe"),
    id = el.dataset.appId;
  if (iframe?.contentWindow && id) iframe.contentWindow.postMessage({ type: "yan-preview-render", id, html: htmlAppSource(el) }, "*");
}
function mountHtmlApp(el) {
  const id = `app${uid().replace(/[^a-z0-9]/gi, "")}`;
  el.dataset.appId = id;
  el.dataset.rendered = "1";
  el.dataset.appState = "loading";
  el.classList.remove("html-app-error");
  const label = el.querySelector(".code-lang");
  if (label) label.textContent = "html · 正在载入";
  const stage = el.querySelector(".html-app-stage");
  stage.innerHTML = `<iframe sandbox="allow-scripts" title="隔离的 HTML 交互预览" src="./preview.html#${id}"></iframe>`;
  setTimeout(() => {
    if (!el.isConnected || el.dataset.appId !== id || el.dataset.appState !== "loading") return;
    el.dataset.appState = "error";
    el.classList.add("html-app-error");
    if (label) label.textContent = "html · 未能载入";
  }, 6000);
}
function renderHtmlApps(root) {
  for (const el of root.querySelectorAll(".html-app[data-html-app]:not([data-rendered])")) mountHtmlApp(el);
}
async function renderPendingMath(root) {
  if (!root.querySelector(".math-pending") || !(await ensureLib("katex"))) return;
  for (const el of root.querySelectorAll(".math-pending")) {
    el.insertAdjacentHTML(
      "afterend",
      window.DOMPurify ? DOMPurify.sanitize(renderMath(el.dataset.tex || "", el.dataset.display === "1"), PURIFY_OPTIONS) : ""
    );
    el.remove();
  }
}
function renderEnhancements(root) {
  void renderViz(root);
  renderHtmlApps(root);
  void renderPendingMath(root);
}
function downloadHref(href, name, revoke = false) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function downloadText(text, type, name) {
  downloadHref(URL.createObjectURL(new Blob([text], { type })), name, true);
}
function chartFor(canvas) {
  for (const chart of vizCharts) if (chart.getDom() === canvas) return chart;
  return null;
}
function downloadVisualization(el) {
  if (el.dataset.viz === "mermaid") {
    const svg = el.querySelector(".viz-canvas svg");
    if (!svg) return toast("图形尚未完成");
    return downloadText(new XMLSerializer().serializeToString(svg), "image/svg+xml;charset=utf-8", "言-图形.svg");
  }
  const chart = chartFor(el.querySelector(".viz-canvas"));
  if (!chart) return toast("图表尚未完成");
  downloadHref(chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: cssVar("--paper") }), "言-图表.png");
}
function closeExpandedWork(except = null) {
  for (const item of document.querySelectorAll(".work-expanded"))
    if (item !== except) {
      item.classList.remove("work-expanded");
      const trigger = item.querySelector("[data-work-expand]");
      if (trigger) trigger.textContent = "全屏";
      chartFor(item.querySelector(".viz-canvas"))?.resize();
    }
  if (!except) document.documentElement.classList.remove("work-mode");
}
function toggleWorkExpanded(el, button) {
  const open = !el.classList.contains("work-expanded");
  closeExpandedWork(open ? el : null);
  el.classList.toggle("work-expanded", open);
  button.textContent = open ? "收起" : "全屏";
  document.documentElement.classList.toggle("work-mode", open);
  setTimeout(() => {
    if (el.matches(".viz")) chartFor(el.querySelector(".viz-canvas"))?.resize();
  }, 40);
}
// ECharts 容器宽度跟随布局（收起侧栏、改阅读宽度等），不再只依赖 window resize
let vizObserver = null;
function setupVizObserver() {
  if (!("ResizeObserver" in window)) return;
  vizObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const canvas = entry.target,
        width = Math.round(entry.contentRect.width);
      if (Math.abs(width - Number(canvas.dataset.vizWidth || -1)) < 2) continue;
      canvas.dataset.vizWidth = String(width);
      if (!canvas.isConnected) continue;
      for (const chart of vizCharts) if (chart.getDom() === canvas) chart.resize();
    }
  });
}
function disposeOrphanCharts() {
  for (const chart of [...vizCharts]) {
    const dom = chart.getDom();
    if (!dom?.isConnected) {
      vizObserver?.unobserve(dom);
      chart.dispose();
      vizCharts.delete(chart);
    }
  }
}
function disposeChartsIn(root) {
  for (const chart of [...vizCharts]) {
    const dom = chart.getDom();
    if (!dom?.isConnected || root?.contains(dom)) {
      vizObserver?.unobserve(dom);
      chart.dispose();
      vizCharts.delete(chart);
    }
  }
}
function renderMarkdown(source = "") {
  const text = String(source).replace(/^\n+|\n+$/g, "");
  if (!text) return "";
  const plain = () => `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  if (!window.marked || !window.DOMPurify) return plain();
  try {
    return DOMPurify.sanitize(marked.parse(text, { async: false }), PURIFY_OPTIONS);
  } catch {
    return plain();
  }
}
// 流式渲染的分段点：最后一个空行，且它前面没有未闭合的代码围栏、后面不是列表 / 缩进 / 表格的延续
function stableCut(content) {
  const listy = line => /^\s*(?:[-*+]|\d+[.)])\s/.test(line) || /^\s+\S/.test(line);
  let cut = content.lastIndexOf("\n\n");
  while (cut > 0) {
    const before = content.slice(0, cut),
      prevLine = before.slice(before.lastIndexOf("\n") + 1),
      nextLine = content.slice(cut + 2).split("\n")[0];
    const inFence = (before.match(/^ {0,3}(?:`{3,}|~{3,})/gm) || []).length % 2 === 1;
    const continues =
      /^\s+\S/.test(nextLine) || (listy(nextLine) && listy(prevLine)) || (/^\s*\|/.test(nextLine) && prevLine.includes("|"));
    if (!inFence && !continues) break;
    cut = content.lastIndexOf("\n\n", cut - 1);
  }
  return Math.max(0, cut);
}
