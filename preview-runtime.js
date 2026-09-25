(() => {
  "use strict";
  // 言 · 页内交互预览的运行时：跑在 sandbox iframe（origin 为 null、CSP 不许联网）里。
  // 正文里的 ```html 就地渲染成可交互的一块：与正文同一张纸——色板与字体取自言，底色透明，高度随内容；
  // 数据图表用 yan:echarts、流程与结构图用 <pre class="mermaid">，库随项目本地分发，按需才载
  let scriptUrls = [];
  const previewId = location.hash.slice(1);
  const notify = (state, detail = "") =>
    parent.postMessage({ type: "yan-preview-state", id: previewId, state, detail: String(detail).slice(0, 240) }, "*");
  function clearScriptUrls() {
    for (const url of scriptUrls) URL.revokeObjectURL(url);
    scriptUrls = [];
  }

  // ---- 主题：父页送来言的色板、字体与明暗，写进 :root 的变量；换主题时再送一次，图表与流程图跟着换色
  /** @type {{ dark: boolean, scheme: string, vars: Record<string, string> }} */
  let theme = { dark: false, scheme: "light", vars: {} };
  const tokenSheet = document.createElement("style"),
    kitSheet = document.createElement("style");
  // 常用元素的底子与几个小件（.card .row .grid .tag .muted）：模型不必从零写样式，写了的照样盖过它
  kitSheet.textContent = `html,body{margin:0;background:transparent}
body{color:var(--ink);font:14px/1.7 var(--body);padding:2px;overflow-wrap:anywhere}
h1,h2,h3,h4{font-family:var(--title);font-weight:600;line-height:1.4;margin:.3em 0 .5em}
h1{font-size:20px}h2{font-size:17px}h3,h4{font-size:15px}
p{margin:.45em 0}a{color:var(--accent)}small,.muted{color:var(--ink-2)}
hr{border:0;border-top:1px solid var(--line);margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left}
th{color:var(--ink-2);font-weight:500}
button{font:inherit;font-size:13px;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:5px 12px;cursor:pointer}
button:hover{border-color:var(--accent);color:var(--accent)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--paper)}
input,select,textarea{font:inherit;font-size:13px;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:5px 8px}
input[type=range],input[type=checkbox],input[type=radio]{accent-color:var(--accent);padding:0}
code{font:12.5px ui-monospace,Consolas,monospace;background:color-mix(in srgb,var(--ink) 6%,transparent);padding:1px 4px;border-radius:4px}
.card{background:var(--paper-2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent)}
svg{max-width:100%}
pre.mermaid{margin:0;background:none;text-align:center;font:inherit;white-space:pre}`;
  document.head.prepend(tokenSheet, kitSheet);
  const cssVar = name => theme.vars[name] || getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  function applyTheme(next) {
    if (next?.vars) theme = next;
    const defs = Object.entries(theme.vars)
      .map(([name, value]) => `--${name}:${value}`)
      .join(";");
    // 明暗与父页一致：color-scheme 不同的 iframe 会被浏览器垫一层不透明的底
    tokenSheet.textContent = `:root{${defs};color-scheme:${theme.scheme || (theme.dark ? "dark" : "light")}}`;
    if (window.echarts?.__yan) rethemeCharts();
    if (window.mermaid && mermaidNodes().length) void drawMermaid(true);
  }

  // ---- 高度随内容：内容一变就报给父页，父页据此定这一块的高
  let lastHeight = 0;
  function reportSize() {
    const body = document.body;
    if (!body) return;
    // 溢出了就按整页的滚动高度报（一截也不能藏在滚动条后面）；没溢出时按 body 的高报，内容变矮才缩得回去
    // 只在明显变矮（差 8px 以上）时才缩：body 与整页常差几像素，否则会一缩一溢来回抖
    const page = document.documentElement.scrollHeight,
      fit = Math.max(body.scrollHeight, body.getBoundingClientRect().height),
      height = Math.ceil(page > innerHeight ? page : fit < innerHeight - 8 ? fit : innerHeight);
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    parent.postMessage({ type: "yan-preview-size", id: previewId, height }, "*");
  }
  const sizeObserver = new ResizeObserver(reportSize);
  addEventListener("resize", reportSize);

  // ---- 本地的库：<script src="yan:echarts"> / yan:mermaid 换成随项目分发的那份，只载一次
  const LIBS = { echarts: "./vendor/echarts.min.js", mermaid: "./vendor/mermaid.min.js" },
    loading = {};
  function loadLib(name) {
    if (!LIBS[name]) return Promise.reject(Error(`没有名为 yan:${name} 的库，可用的是 yan:echarts、yan:mermaid`));
    return (loading[name] ||= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = LIBS[name];
      script.onload = () => {
        if (name === "echarts") setupEcharts();
        resolve(null);
      };
      script.onerror = () => reject(Error(`库 yan:${name} 未能载入`));
      document.head.append(script);
    }));
  }

  // ---- ECharts：注册一套取自言的主题并设为默认；容器没给高的给个默认高，宽度变了自己重排；
  // 模型写 option 常见的几处失手（系列指到不存在的坐标轴、坐标轴指到不存在的格子、漏了 type）画之前先扶正
  const charts = new Set(),
    chartObserver = new ResizeObserver(entries => {
      for (const entry of entries) for (const chart of charts) if (chart.getDom() === entry.target) chart.resize();
    });
  function echartsTheme() {
    const ink = cssVar("ink"),
      muted = cssVar("ink-2"),
      line = cssVar("line"),
      axis = {
        axisLine: { lineStyle: { color: line } },
        axisTick: { lineStyle: { color: line } },
        axisLabel: { color: muted },
        splitLine: { lineStyle: { color: line } }
      };
    return {
      color: [
        cssVar("accent"),
        cssVar("code-green"),
        cssVar("code-blue"),
        cssVar("gold") || "#a4823a",
        cssVar("keep") || "#4f6470",
        cssVar("reach") || "#4e6b5c"
      ],
      backgroundColor: "transparent",
      textStyle: { color: muted, fontFamily: cssVar("body") },
      title: { textStyle: { color: ink, fontFamily: cssVar("title") }, subtextStyle: { color: muted } },
      legend: { textStyle: { color: muted } },
      tooltip: { backgroundColor: cssVar("paper-2"), borderColor: line, textStyle: { color: ink } },
      categoryAxis: axis,
      valueAxis: axis,
      timeAxis: axis,
      logAxis: axis
    };
  }
  function repairEchartsOption(option, fresh = true) {
    const list = value => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);
    const clamp = (item, key, count) => {
      if (typeof item?.[key] !== "number" || item[key] < count) return;
      if (count > 0) item[key] = count - 1;
      else delete item[key];
    };
    const grids = list(option.grid).length,
      xs = list(option.xAxis),
      ys = list(option.yAxis);
    for (const axis of [...xs, ...ys]) if (axis && typeof axis === "object") clamp(axis, "gridIndex", grids);
    const polar = list(option.polar).length,
      radius = list(option.radiusAxis).length,
      angle = list(option.angleAxis).length;
    if (option.series !== undefined)
      option.series = list(option.series)
        .filter(item => item && typeof item === "object")
        .map(item => {
          const series = { ...item };
          clamp(series, "xAxisIndex", xs.length);
          clamp(series, "yAxisIndex", ys.length);
          clamp(series, "polarIndex", polar);
          clamp(series, "radiusAxisIndex", radius);
          clamp(series, "angleAxisIndex", angle);
          if (!series.type) {
            const sample = Array.isArray(series.data) ? series.data[0] : null;
            series.type =
              !xs.length && !ys.length && sample && typeof sample === "object" && "value" in sample
                ? "pie"
                : xs.length || ys.length
                  ? "bar"
                  : "line";
          }
          return series;
        });
    // 直角坐标系的格子：刻度标签算进格子里（ECharts 默认按宽度的一成留边，窄处纵轴标签就出界，只剩「,000」）；
    // 头一回画、又没写格子的，四边按有无标题、图例、轴名收紧，底下不再空出一大块；旁边挂着别的件（视觉映射、滑条……）的只加前一条
    if (xs.length || ys.length) {
      if (grids)
        option.grid = list(option.grid).map(grid =>
          grid && typeof grid === "object" && grid.containLabel === undefined ? { ...grid, containLabel: true } : grid
        );
      else if (fresh) {
        const legends = list(option.legend).filter(item => item && typeof item === "object" && item.show !== false),
          busy =
            ["visualMap", "timeline", "graphic", "toolbox"].some(key => list(option[key]).length) ||
            list(option.dataZoom).some(zoom => zoom?.type !== "inside") ||
            legends.some(item => item.orient === "vertical");
        if (busy) option.grid = { containLabel: true };
        else {
          const titled = list(option.title).find(item => item?.text),
            legendBelow = legends.some(item => item.bottom !== undefined && item.top === undefined),
            legendAbove = legends.some(item => !(item.bottom !== undefined && item.top === undefined)),
            where = axis => (axis && typeof axis === "object" && axis.name ? axis.nameLocation || "end" : ""),
            xName = xs.map(where).find(Boolean),
            yName = ys.map(where).find(Boolean);
          let top = titled?.subtext ? 60 : titled || legendAbove ? 40 : 16;
          if (yName === "end") top += top > 16 ? 20 : 16;
          option.grid = {
            containLabel: true,
            top,
            bottom: (legendBelow ? 40 : 12) + (xName === "middle" || xName === "center" ? 24 : 0),
            left: yName === "middle" || yName === "center" ? 36 : 12,
            right: xName === "end" ? 48 : 16
          };
        }
      }
    }
    return option;
  }
  function setupEcharts() {
    const ec = window.echarts;
    if (!ec || ec.__yan) return;
    ec.__yan = true;
    ec.registerTheme("yan", echartsTheme());
    const init = ec.init.bind(ec);
    ec.init = (dom, name, opts) => {
      if (dom instanceof HTMLElement && dom.clientHeight < 40 && !dom.style.height) dom.style.height = "320px";
      const chart = init(dom, name ?? "yan", opts);
      const set = chart.setOption.bind(chart);
      // 头一回画或整份替换（notMerge）时才补格子的四边；之后的增量更新不去盖模型自己定过的边距
      let drawn = false;
      chart.setOption = (option, ...rest) => {
        const fresh = !drawn || rest[0] === true || rest[0]?.notMerge === true;
        drawn = true;
        return set(option && typeof option === "object" ? repairEchartsOption({ ...option }, fresh) : option, ...rest);
      };
      charts.add(chart);
      chartObserver.observe(dom);
      return chart;
    };
  }
  // 换了主题：已画的图就地换字色与线色（系列的颜色是图的内容，不动），之后新起的图用新主题
  function rethemeCharts() {
    const ec = window.echarts,
      next = echartsTheme();
    ec.registerTheme("yan", next);
    const axisPatch = axes => (axes || []).map(() => next.valueAxis);
    for (const chart of charts) {
      if (chart.isDisposed()) {
        charts.delete(chart);
        continue;
      }
      const option = chart.getOption() || {};
      try {
        chart.setOption({
          textStyle: next.textStyle,
          title: (option.title || []).map(() => next.title),
          legend: (option.legend || []).map(() => next.legend),
          tooltip: (option.tooltip || []).map(() => next.tooltip),
          xAxis: axisPatch(option.xAxis),
          yAxis: axisPatch(option.yAxis)
        });
      } catch {}
    }
  }

  // ---- Mermaid：页里有 <pre class="mermaid"> 就载库、按言的色板成图；换主题时用记下的原文重画
  const mermaidNodes = () => [...document.querySelectorAll("pre.mermaid, div.mermaid")];
  async function drawMermaid(again = false) {
    const nodes = mermaidNodes();
    if (!nodes.length) return;
    await loadLib("mermaid");
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: cssVar("title") || cssVar("body"),
      themeVariables: {
        background: "transparent",
        primaryColor: cssVar("paper-2"),
        primaryTextColor: cssVar("ink"),
        primaryBorderColor: cssVar("ink-3"),
        lineColor: cssVar("ink-2"),
        secondaryColor: cssVar("paper-3"),
        tertiaryColor: cssVar("paper"),
        noteBkgColor: cssVar("accent-soft"),
        noteTextColor: cssVar("ink"),
        fontSize: "14px",
        darkMode: theme.dark
      }
    });
    for (const node of nodes) {
      if (!("source" in node.dataset)) node.dataset.source = node.textContent;
      if (again || node.dataset.processed) {
        node.removeAttribute("data-processed");
        node.textContent = node.dataset.source;
      }
    }
    await window.mermaid.run({ nodes });
    reportSize();
  }

  function showError(error) {
    let box = document.querySelector("#yan-preview-error");
    if (!box) {
      box = document.createElement("div");
      box.id = "yan-preview-error";
      Object.assign(box.style, {
        position: "fixed",
        left: "10px",
        right: "10px",
        bottom: "10px",
        zIndex: "2147483647",
        padding: "9px 11px",
        border: "1px solid #b75b4a",
        borderRadius: "8px",
        background: "#fff7f3",
        color: "#8d3f33",
        font: "12px/1.5 system-ui,sans-serif",
        whiteSpace: "pre-wrap"
      });
      document.body.append(box);
    }
    box.textContent = `运行错误：${String(error?.message || error).slice(0, 220)}`;
    notify("error", error?.message || error);
  }
  window.addEventListener("error", event => showError(event.error || event.message));
  window.addEventListener("unhandledrejection", event => showError(event.reason || "Promise rejected"));
  async function run(source) {
    clearScriptUrls();
    const parsed = new DOMParser().parseFromString(String(source || ""), "text/html");
    // yan:echarts / yan:mermaid 是随项目分发的库，照写的顺序先载；别的外部脚本一律不认（沙箱本就不许联网）
    const scripts = [...parsed.querySelectorAll("script")]
      .map(node => {
        const src = node.getAttribute("src") || "";
        return {
          code: node.textContent || "",
          type: (node.type || "text/javascript").toLowerCase(),
          src,
          lib: src.match(/^yan:([\w-]+)$/)?.[1] || ""
        };
      })
      .filter(item => ["text/javascript", "application/javascript", "module"].includes(item.type));
    if (scripts.some(item => item.src && !item.lib))
      throw Error("交互内容含外部脚本；请把 JavaScript 直接写在 HTML 内，库只可用 yan:echarts、yan:mermaid");
    parsed.querySelectorAll("script,base,meta[http-equiv],iframe,object,embed").forEach(node => node.remove());
    document.head.querySelectorAll("[data-preview-style]").forEach(node => node.remove());
    for (const style of parsed.head.querySelectorAll("style")) {
      const node = document.createElement("style");
      node.dataset.previewStyle = "";
      node.textContent = style.textContent;
      document.head.append(node);
    }
    document.title = parsed.title || "言 · 交互预览";
    for (const name of ["class", "style", "dir"]) document.documentElement.removeAttribute(name);
    for (const name of ["class", "style", "dir"])
      if (parsed.documentElement.hasAttribute(name)) document.documentElement.setAttribute(name, parsed.documentElement.getAttribute(name));
    document.documentElement.lang = parsed.documentElement.lang || "zh-CN";
    for (const { name } of [...document.body.attributes]) document.body.removeAttribute(name);
    for (const { name, value } of [...parsed.body.attributes]) if (!/^on/i.test(name)) document.body.setAttribute(name, value);
    document.body.innerHTML = parsed.body.innerHTML || source;
    for (const item of scripts) {
      if (item.lib) {
        await loadLib(item.lib);
        continue;
      }
      if (!item.code.trim()) continue;
      const url = URL.createObjectURL(new Blob([item.code], { type: "text/javascript" }));
      scriptUrls.push(url);
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        if (item.type === "module") script.type = "module";
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(Error("脚本无法执行"));
        document.body.append(script);
      });
    }
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    window.dispatchEvent(new Event("load"));
    await drawMermaid();
    sizeObserver.observe(document.body);
    reportSize();
    notify("ready");
  }
  // run_js：在一个 Worker 里跑模型给的代码，收集 console 输出与返回值；超时就把 Worker 整个杀掉。
  // CSP 不许 eval / new Function，所以代码不是运行时求值，而是直接拼进 Worker 的脚本（blob 脚本是许可的）：
  // 先按「单个表达式」拼——脚本解析不过（还没发出 loaded 就出错）就按「语句块」再拼一次，用 return 交回结果
  const COMPUTE_PRELUDE = String.raw`"use strict";
const logs = [];
const fmt = value => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return String(value.stack || value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  try {
    const text = JSON.stringify(value, (k, v) => (typeof v === "bigint" ? String(v) + "n" : v instanceof Map ? Object.fromEntries(v) : v instanceof Set ? [...v] : v), 2);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
};
const push = level => (...args) => {
  if (logs.reduce((n, line) => n + line.length, 0) > 20000) return;
  logs.push((level ? level + " " : "") + args.map(fmt).join(" "));
};
self.console = { log: push(""), info: push(""), debug: push(""), table: push(""), warn: push("[warn]"), error: push("[error]") };
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches", "BroadcastChannel", "Worker", "SharedWorker", "navigator"])
  try { Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false }); } catch {}
self.postMessage({ type: "loaded" });
`;
  const COMPUTE_EPILOGUE = String.raw`
(async () => {
  const started = Date.now();
  let value, error = null;
  try { value = await __main(); } catch (err) { error = String((err && err.stack) || err).slice(0, 2000); }
  self.postMessage({ type: "result", ok: !error, logs: logs.join("\n"), value: value === undefined ? undefined : fmt(value), error, ms: Date.now() - started });
})();`;
  const computeSource = (code, asExpression) =>
    COMPUTE_PRELUDE +
    (asExpression ? `const __main = async () => (\n${code}\n);` : `const __main = async () => {\n${code}\n};`) +
    COMPUTE_EPILOGUE;
  function compute(job) {
    const reply = data => parent.postMessage({ ...data, type: "yan-compute-result", id: job.id }, "*");
    const attempt = asExpression => {
      let worker;
      try {
        worker = new Worker(URL.createObjectURL(new Blob([computeSource(job.code, asExpression)], { type: "text/javascript" })));
      } catch (error) {
        return reply({ ok: false, error: `沙箱无法启动：${error.message || error}` });
      }
      let loaded = false;
      const timer = setTimeout(() => {
        worker.terminate();
        reply({ ok: false, error: `超时（${Math.round(job.timeout / 1000)} 秒）：已终止` });
      }, job.timeout);
      worker.onmessage = event => {
        if (event.data?.type === "loaded") return void (loaded = true);
        clearTimeout(timer);
        worker.terminate();
        reply(event.data);
      };
      worker.onerror = event => {
        event.preventDefault(); // 不让它再冒到本页的 window.error 去报「运行错误」
        clearTimeout(timer);
        worker.terminate();
        // 还没 loaded 就出错：脚本没解析过。表达式写法不成就按语句块再来；语句块也不成才是真的语法错
        if (!loaded && asExpression) return attempt(false);
        reply({ ok: false, error: String(event.message || "运行出错") });
      };
    };
    attempt(true);
  }
  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.id !== previewId) return;
    if (event.data.type === "yan-preview-render") {
      applyTheme(event.data.theme);
      run(event.data.html).catch(showError);
    } else if (event.data.type === "yan-preview-theme") applyTheme(event.data.theme);
    else if (event.data.type === "yan-compute") compute(event.data);
  });
  // 焦点在这块里时，Esc 到不了父页：转告一声，父页若正全屏着这一块就收起（没全屏时父页不理，块里自己的 Esc 照常）
  addEventListener("keydown", event => {
    if (event.key === "Escape") parent.postMessage({ type: "yan-preview-escape", id: previewId }, "*");
  });
  parent.postMessage({ type: "yan-preview-ready", id: previewId }, "*");
})();
