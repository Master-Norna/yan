(() => {
  "use strict";
  const STORAGE_KEY = "yan-chat-v1";
  const LOCAL_BRIDGE = "http://127.0.0.1:8787";
  const FILE_DB_NAME = "yan-chat-files-v1";
  const FILE_STORE_NAME = "attachments";
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_PENDING_BYTES = 8 * 1024 * 1024;
  const MAX_EXTRACTED_CHARS = 300000;
  const HISTORY_TEXT_CHARS = 3000;
  const FOLLOW_THRESHOLD = 80;
  const DEFAULT_MAX_TOKENS = 8192;
  const MIN_TOOL_STATUS_MS = 240;
  const $ = selector => document.querySelector(selector);
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = () => new Date().toISOString();
  const defaultStore = { version: 1, settings: { name: "访客", theme: "system", font: "mixed", width: 760, accent: "#9b5540", activeProfileId: "", autoTitle: true, serverProfile: { temperature: .7, maxTokens: DEFAULT_MAX_TOKENS, systemPrompt: "", quota: "", usedTokens: 0 } }, profiles: [], conversations: [], library: [] };
  let store = loadStore();
  let bootstrap = { serverProfile: null, configError: "" };
  let apiBase = null;
  let currentId = null;
  let view = "chat";
  let editingMessageId = null;
  let renamingId = null;
  let historyQuery = "";
  let pendingAttachments = [];
  let controller = null;
  let settingsTab = "general";
  let toastTimer = null;
  let fileDbPromise = null;
  let libraryQuery = "", libraryKind = "all";
  const advancedOpen = new Set();
  const vizCharts = new Set();
  let suppressViz = false;
  let saveTimer = null;
  let bridgeRetryAt = 0;
  let followBottom = true, autoScrolling = false;
  const thumbCache = new Map();

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1) return structuredClone(defaultStore);
      return { ...structuredClone(defaultStore), ...parsed, settings: { ...defaultStore.settings, ...(parsed.settings || {}) }, profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [], conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [], library: Array.isArray(parsed.library) ? parsed.library : [] };
    } catch { return structuredClone(defaultStore); }
  }
  function saveStore() {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch { toast("本机存储空间不足，请导出备份后删除部分旧对话"); }
  }
  function saveStoreSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveStore, 300); }
  function openFileDb() {
    if (fileDbPromise) return fileDbPromise;
    fileDbPromise = new Promise((resolve,reject) => {
      const request = indexedDB.open(FILE_DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(FILE_STORE_NAME, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("附件存储不可用"));
    });
    return fileDbPromise;
  }
  async function fileStoreRequest(mode, action) {
    const db = await openFileDb();
    return new Promise((resolve,reject) => {
      const transaction = db.transaction(FILE_STORE_NAME, mode), request = action(transaction.objectStore(FILE_STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("附件存储失败"));
      transaction.onabort = () => reject(transaction.error || Error("附件存储已中止"));
    });
  }
  function putAttachment(record) { return fileStoreRequest("readwrite", store => store.put(record)); }
  function getAttachment(id) { return id ? fileStoreRequest("readonly", store => store.get(id)) : Promise.resolve(null); }
  function deleteAttachment(id) { thumbCache.delete(id); return id ? fileStoreRequest("readwrite", store => store.delete(id)).catch(() => {}) : Promise.resolve(); }
  function attachmentIds(messages = []) { return messages.flatMap(message => message.attachments || []).map(file => file.id).filter(Boolean); }
  function inLibrary(id) { return store.library.some(file => file.id === id); }
  function isReferenced(id) { return pendingAttachments.some(file => file.id === id) || store.conversations.some(c => (c.messages || []).some(m => (m.attachments || []).some(file => file.id === id))); }
  // 已收入卷宗的原件由卷宗管理，删除对话或移除待发附件时不会删掉它
  async function deleteAttachments(ids) { await Promise.all([...new Set(ids)].filter(id => !inLibrary(id)).map(deleteAttachment)); }
  async function cleanupAttachmentStore() {
    try {
      const keep = new Set([...attachmentIds(store.conversations.flatMap(c => c.messages || [])), ...store.library.map(file => file.id)]), keys = await fileStoreRequest("readonly", db => db.getAllKeys());
      await deleteAttachments(keys.filter(key => !keep.has(key)));
    } catch {}
  }
  function profiles() { return [...(bootstrap.serverProfile ? [bootstrap.serverProfile] : []), ...store.profiles]; }
  function activeProfile() { return profiles().find(p => p.id === store.settings.activeProfileId) || profiles()[0] || null; }
  function currentConversation() { return store.conversations.find(c => c.id === currentId) || null; }
  function persistServerProfile(p) { if (p.source === "server") store.settings.serverProfile = { temperature: p.temperature, maxTokens: p.maxTokens, systemPrompt: p.systemPrompt, quota: p.quota, usedTokens: p.usedTokens }; }
  function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function formatTime(value) { return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); }
  // 汉字数字：一、十二、二十三；2 单独出现时用「两」（如「两问」）
  const DIGITS = "〇一二三四五六七八九";
  function chineseNumber(n, twoAsLiang = false) { n = Math.max(0, Math.floor(Number(n) || 0)); if (n === 2 && twoAsLiang) return "两"; if (n < 10) return DIGITS[n]; if (n < 100) { const tens = Math.floor(n / 10), ones = n % 10; return `${tens > 1 ? DIGITS[tens] : ""}十${ones ? DIGITS[ones] : ""}`; } return String(n); }
  function formatDay(value) { const date = new Date(value), year = date.getFullYear(); return `${year !== new Date().getFullYear() ? `${[...String(year)].map(d => DIGITS[Number(d)]).join("")}年` : ""}${chineseNumber(date.getMonth() + 1)}月${chineseNumber(date.getDate())}日`; }
  function dayBucket(value) { const days = Math.floor((new Date().setHours(0,0,0,0) - new Date(value).setHours(0,0,0,0)) / 86400000); return days <= 0 ? "今天" : days < 7 ? "过去七天" : "更早"; }
  function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.remove("hidden"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add("hidden"), 2200); }
  function setConnection(state, text) { $("#connection").dataset.state = state; $("#connectionText").textContent = text; }
  function grow(el) { el.style.height = "auto"; el.style.height = `${Math.min(190, Math.max(44, el.scrollHeight))}px`; }
  function isMobile() { return innerWidth <= 760; }
  // 同风格的确认弹层，替代浏览器自带的 confirm()
  let confirmResolve = null;
  function askConfirm({ title, body = "", ok = "确定", danger = true }) {
    return new Promise(resolve => {
      settleConfirm(false); confirmResolve = resolve;
      $("#confirmTitle").textContent = title; $("#confirmBody").textContent = body;
      const button = $("#confirmOk"); button.textContent = ok; button.className = danger ? "danger-btn solid" : "outline-btn";
      $("#confirmModal").classList.remove("hidden"); setTimeout(() => button.focus(), 0);
    });
  }
  function settleConfirm(value) { if (!confirmResolve) return; $("#confirmModal").classList.add("hidden"); const resolve = confirmResolve; confirmResolve = null; resolve(value); }

  // ---------- Markdown：marked 解析、DOMPurify 净化、highlight.js 代码高亮、KaTeX 公式 ----------
  const PURIFY_OPTIONS = { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "iframe", "object", "embed"] };
  function setupMarkdown() {
    if (!window.marked) return;
    const inlineMath = { name: "mathInline", level: "inline", start(src) { const m = src.match(/\$(?!\s)|\\\(/); return m ? m.index : -1; }, tokenizer(src) { const m = src.match(/^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/) || src.match(/^\\\(([\s\S]+?)\\\)/); return m ? { type: "mathInline", raw: m[0], text: m[1] } : undefined; }, renderer(token) { return renderMath(token.text, false); } };
    const blockMath = { name: "mathBlock", level: "block", start(src) { const m = src.match(/\$\$|\\\[/); return m ? m.index : -1; }, tokenizer(src) { const m = src.match(/^\$\$([\s\S]+?)\$\$(?:\n+|$)/) || src.match(/^\\\[([\s\S]+?)\\\](?:\n+|$)/); return m ? { type: "mathBlock", raw: m[0], text: m[1].trim() } : undefined; }, renderer(token) { return `<div class="math-block">${renderMath(token.text, true)}</div>\n`; } };
    marked.use({ gfm: true, breaks: true, renderer: { code({ text, lang }) { return codeBlockHtml(text, lang); } }, extensions: [blockMath, inlineMath] });
    if (window.DOMPurify) DOMPurify.addHook("afterSanitizeAttributes", node => {
      if (node.tagName === "A" && node.hasAttribute("href")) { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
      if (node.tagName === "INPUT") node.setAttribute("disabled", "");
    });
  }
  function renderMath(tex, display) {
    try { return window.katex ? katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" }) : `<code>${escapeHtml(tex)}</code>`; }
    catch { return `<code>${escapeHtml(tex)}</code>`; }
  }
  function codeBlockHtml(text, lang) {
    const language = String(lang || "").trim().split(/\s+/)[0].toLowerCase(), known = !!(window.hljs && language && hljs.getLanguage(language));
    // mermaid / echarts 代码块在页内直接出图；流式尾段尚未闭合时显示轻量成图状态
    if (suppressViz && ((language === "mermaid" && window.mermaid) || (language === "echarts" && window.echarts))) return `<div class="viz viz-pending" data-viz-pending="${language}"><div class="code-head"><span class="code-lang">${language}</span><span class="viz-pending-label">正在成图</span></div><div class="viz-pending-body"><span class="viz-pending-mark" aria-hidden="true"></span><span>墨迹尚未收笔</span></div></div>\n`;
    if (!suppressViz && ((language === "mermaid" && window.mermaid) || (language === "echarts" && window.echarts))) return `<div class="viz" data-viz="${language}"><div class="code-head"><span class="code-lang">${language}</span><span><button type="button" class="code-copy" data-viz-toggle>源码</button><button type="button" class="code-copy" data-copy-code>复制</button></span></div><div class="viz-canvas"></div><pre class="viz-source hidden"><code>${escapeHtml(text)}</code></pre></div>\n`;
    let html; try { html = known ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text); } catch { html = escapeHtml(text); }
    return `<div class="code-block"><div class="code-head"><span class="code-lang">${escapeHtml(language || "text")}</span><button type="button" class="code-copy" data-copy-code>复制</button></div><pre><code class="hljs${known ? ` language-${escapeHtml(language)}` : ""}">${html}</code></pre></div>\n`;
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function setupMermaid() {
    if (!window.mermaid) return;
    const dark = document.documentElement.dataset.theme === "dark";
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: cssVar("--body"), flowchart: { htmlLabels: false, curve: "basis" }, themeVariables: { background: "transparent", primaryColor: cssVar("--paper-2"), primaryTextColor: cssVar("--ink"), primaryBorderColor: cssVar("--ink-3"), lineColor: cssVar("--ink-2"), secondaryColor: cssVar("--paper-3"), tertiaryColor: cssVar("--paper"), noteBkgColor: cssVar("--accent-soft"), noteTextColor: cssVar("--ink"), fontSize: "14px", darkMode: dark } });
  }
  function mapOptionPart(value, transform) {
    if (Array.isArray(value)) return value.map(item => transform(item || {}));
    return transform(value && typeof value === "object" ? value : {});
  }
  function themedEchartsOption(raw, canvas) {
    const option = { ...raw }; delete option.height;
    const ink = cssVar("--ink"), muted = cssVar("--ink-2"), line = cssVar("--line"), paper = cssVar("--paper-2");
    const narrow = canvas.clientWidth < 520, titleShown = Array.isArray(option.title) ? option.title.some(item => item?.text) : !!option.title?.text;
    const textPart = (value, defaults) => mapOptionPart(value, item => ({ ...defaults, ...item, textStyle: { ...defaults.textStyle, ...(item.textStyle || {}) } }));
    const axisPart = value => mapOptionPart(value, item => ({
      ...item,
      axisLabel: { color: muted, ...(item.axisLabel || {}) },
      axisLine: { ...(item.axisLine || {}), lineStyle: { color: line, ...(item.axisLine?.lineStyle || {}) } },
      axisTick: { ...(item.axisTick || {}), lineStyle: { color: line, ...(item.axisTick?.lineStyle || {}) } },
      splitLine: { ...(item.splitLine || {}), lineStyle: { color: line, ...(item.splitLine?.lineStyle || {}) } }
    }));
    if (option.title !== undefined) option.title = textPart(option.title, { ...(narrow ? { left: 8, top: 7 } : {}), textStyle: { color: ink, fontFamily: cssVar("--title"), fontSize: narrow ? 16 : 18 } });
    if (option.legend !== undefined) option.legend = textPart(option.legend, { ...(narrow ? { left: 8, top: titleShown ? 48 : 10, itemWidth: 16, itemHeight: 9, itemGap: 12 } : {}), textStyle: { color: muted, fontFamily: cssVar("--body"), fontSize: narrow ? 11 : 12 } });
    if (option.tooltip !== undefined) option.tooltip = textPart(option.tooltip, { backgroundColor: paper, borderColor: line, textStyle: { color: ink, fontFamily: cssVar("--body") } });
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
  async function renderViz(root) {
    for (const el of root.querySelectorAll(".viz[data-viz]:not([data-rendered])")) {
      el.dataset.rendered = "1";
      const source = el.querySelector(".viz-source")?.textContent || "", canvas = el.querySelector(".viz-canvas");
      try {
        if (el.dataset.viz === "mermaid") { const { svg } = await mermaid.render(`mmd${uid().replace(/[^a-z0-9]/gi, "")}`, source); canvas.innerHTML = window.DOMPurify ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject"], ADD_ATTR: ["dominant-baseline"] }) : ""; }
        else if (el.dataset.viz === "echarts") {
          const option = JSON.parse(source);
          canvas.style.height = `${Math.min(560, Math.max(220, Number(option.height) || 320))}px`;
          const chart = echarts.init(canvas, null, { renderer: "canvas" });
          chart.setOption(themedEchartsOption(option, canvas));
          vizCharts.add(chart);
        }
        el.classList.add("viz-ok");
      } catch (error) { el.classList.add("viz-error"); canvas.innerHTML = `<div class="viz-fail">无法渲染：${escapeHtml(String(error.message || error).split("\n")[0].slice(0, 200))}</div>`; el.querySelector(".viz-source")?.classList.remove("hidden"); }
    }
  }
  function resizeCharts() { for (const chart of vizCharts) { const dom = chart.getDom(); if (!dom?.isConnected) { chart.dispose(); vizCharts.delete(chart); } else chart.resize(); } }
  function disposeChartsIn(root) { for (const chart of [...vizCharts]) { const dom = chart.getDom(); if (!dom?.isConnected || root?.contains(dom)) { chart.dispose(); vizCharts.delete(chart); } } }
  function renderMarkdown(source = "") {
    const text = String(source).replace(/^\n+|\n+$/g, ""); if (!text) return "";
    const plain = () => `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
    if (!window.marked || !window.DOMPurify) return plain();
    try { return DOMPurify.sanitize(marked.parse(text, { async: false }), PURIFY_OPTIONS); } catch { return plain(); }
  }
  // 流式渲染的分段点：最后一个空行，且它前面没有未闭合的代码围栏、后面不是列表 / 缩进 / 表格的延续
  function stableCut(content) {
    const listy = line => /^\s*(?:[-*+]|\d+[.)])\s/.test(line) || /^\s+\S/.test(line);
    let cut = content.lastIndexOf("\n\n");
    while (cut > 0) {
      const before = content.slice(0, cut), prevLine = before.slice(before.lastIndexOf("\n") + 1), nextLine = content.slice(cut + 2).split("\n")[0];
      const inFence = (before.match(/^ {0,3}(?:`{3,}|~{3,})/gm) || []).length % 2 === 1;
      const continues = /^\s+\S/.test(nextLine) || (listy(nextLine) && listy(prevLine)) || (/^\s*\|/.test(nextLine) && prevLine.includes("|"));
      if (!inFence && !continues) break;
      cut = content.lastIndexOf("\n\n", cut - 1);
    }
    return Math.max(0, cut);
  }

  async function connectBridge(candidates, timeout = 1400) {
    for (const candidate of candidates) {
      try {
        const response = await fetch(`${candidate}/api/bootstrap`, { signal: AbortSignal.timeout(timeout) });
        if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) continue;
        const next = await response.json();
        if (next.serverProfile) Object.assign(next.serverProfile, store.settings.serverProfile);
        bootstrap = next;
        apiBase = candidate;
        return true;
      } catch {}
    }
    return false;
  }
  async function ensureLocalBridge() {
    if (apiBase !== null) return true;
    if (Date.now() < bridgeRetryAt) return false;
    bridgeRetryAt = Date.now() + 5000;
    const connected = await connectBridge([LOCAL_BRIDGE], 1200);
    if (connected) {
      if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
      renderHeader();
      if (!$("#settingsModal").classList.contains("hidden")) renderSettings();
      toast("已连接本机桥接，言下联网可用");
    }
    return connected;
  }
  async function boot() {
    setupMarkdown(); setupMermaid();
    const candidates = ["", LOCAL_BRIDGE].filter((value,index,array) => array.indexOf(value) === index);
    await connectBridge(candidates);
    if (apiBase === null) bootstrap.configError = "未检测到本机模型桥接，当前使用浏览器直连。接口若未开放 CORS，请在 VS Code 运行“言下：启动模型桥接”任务。";
    if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
    applyAppearance();
    bindEvents();
    void cleanupAttachmentStore();
    if (isMobile()) toggleSidebar(true);
    render();
  }

  function bindEvents() {
    $("#collapseSidebar").onclick = () => toggleSidebar();
    $("#mobileMenu").onclick = () => toggleSidebar(false);
    $("#newChat").onclick = newChat;
    $("#openLibrary").onclick = () => view === "library" ? closeLibrary() : openLibrary();
    $("#openSettings").onclick = () => openSettings("general");
    $("#closeSettings").onclick = closeSettings;
    $("#settingsModal").addEventListener("click", e => { if (e.target === $("#settingsModal")) closeSettings(); });
    $("#modelTrigger").onclick = e => { e.stopPropagation(); $("#modelMenu").classList.toggle("hidden"); renderModelMenu(); };
    document.addEventListener("click", () => $("#modelMenu").classList.add("hidden"));
    $("#themeToggle").onclick = () => { store.settings.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; saveStore(); applyAppearance(); renderHeader(); if (view === "chat" && !controller) renderConversation(false); };
    window.addEventListener("resize", resizeCharts);
    $("#quotaStatus").onclick = () => openSettings("models");
    document.querySelectorAll(".send-trigger").forEach(button => button.onclick = sendOrStop);
    document.querySelectorAll(".attach-trigger").forEach(button => button.onclick = () => $("#fileInput").click());
    $("#confirmOk").onclick = () => settleConfirm(true);
    $("#confirmCancel").onclick = () => settleConfirm(false);
    $("#confirmModal").addEventListener("click", e => { if (e.target === $("#confirmModal")) settleConfirm(false); });
    $("#confirmModal").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); settleConfirm(true); } });
    document.querySelectorAll(".suggestion").forEach(button => button.onclick = () => { $("#welcomeInput").value = button.textContent; grow($("#welcomeInput")); $("#welcomeInput").focus(); });
    [$("#welcomeInput"), $("#chatInput")].forEach(input => {
      input.addEventListener("input", () => grow(input));
      input.addEventListener("keydown", e => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendOrStop(); } });
      input.addEventListener("paste", e => {
        const images = Array.from(e.clipboardData?.files || []).filter(file => file.type.startsWith("image/")); if (!images.length) return;
        e.preventDefault();
        const stamp = new Date().toISOString().slice(0,19).replace(/[-:T]/g, "").slice(4);
        void addFiles(images.map((file,index) => new File([file], `粘贴图片-${stamp}${images.length > 1 ? `-${index + 1}` : ""}.${file.type.split("/")[1]?.replace("jpeg","jpg") || "png"}`, { type: file.type })));
      });
    });
    $("#fileInput").onchange = handleFiles;
    $("#libraryAdd").onclick = () => $("#libraryFileInput").click();
    $("#libraryFileInput").onchange = async e => { await addLibraryFiles(e.target.files); e.target.value = ""; };
    $("#librarySearch").addEventListener("input", e => { libraryQuery = e.target.value; renderLibrary(); });
    document.querySelectorAll("[data-library-kind]").forEach(button => button.onclick = () => { libraryKind = button.dataset.libraryKind; renderLibrary(); });
    $("#libraryGrid").addEventListener("click", e => {
      const button = e.target.closest("[data-library-action]"); if (!button) return;
      const id = button.closest("[data-library-item]")?.dataset.libraryItem, action = button.dataset.libraryAction;
      if (action === "place") placeFromLibrary(id); else if (action === "download") void downloadAttachment(id); else if (action === "remove") removeFromLibrary(id);
    });
    let dragHideTimer = null;
    const hasDraggedFiles = event => Array.from(event.dataTransfer?.types || []).includes("Files");
    const showDropVeil = () => { clearTimeout(dragHideTimer); const toLibrary = view === "library"; $("#dropTitle").textContent = toLibrary ? "松手，收入卷宗" : "松手，置于案上"; $("#dropHint").textContent = toLibrary ? "图片、文档与代码文件 · 单件不超过 8 MB" : "图片、文档与代码文件 · 单次共 8 MB"; $("#dropVeil").classList.remove("hidden"); };
    const hideDropVeil = () => { clearTimeout(dragHideTimer); $("#dropVeil").classList.add("hidden"); };
    window.addEventListener("dragenter", event => { if (!hasDraggedFiles(event)) return; event.preventDefault(); showDropVeil(); });
    window.addEventListener("dragover", event => { if (!hasDraggedFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; showDropVeil(); });
    window.addEventListener("dragleave", event => { if (!hasDraggedFiles(event)) return; dragHideTimer = setTimeout(hideDropVeil, 80); });
    window.addEventListener("drop", event => { if (!hasDraggedFiles(event)) return; event.preventDefault(); hideDropVeil(); void (view === "library" ? addLibraryFiles : addFiles)(event.dataTransfer.files); });
    $("#clearContext").onclick = () => { const c = currentConversation(); if (!c || controller || !c.messages.length || c.messages.at(-1)?.role === "context") return; c.messages.push({ id: uid(), role: "context", timestamp: now() }); c.updatedAt = now(); saveStore(); renderConversation(); toast("后续对话将不再携带此前消息"); };
    $("#historySearch").addEventListener("input", e => { historyQuery = e.target.value; renderHistory(); });
    $("#historySearch").addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); toggleHistorySearch(false); } });
    $("#historySearchToggle").onclick = () => toggleHistorySearch();
    $("#historySearchClose").onclick = () => toggleHistorySearch(false);
    $("#history").addEventListener("dblclick", e => { const item = e.target.closest("[data-conversation]"); if (item && !e.target.closest(".history-rename, [data-history-action]")) startRename(item.dataset.conversation); });
    $("#history").addEventListener("click", e => {
      const item = e.target.closest("[data-conversation]"); if (!item) return;
      const id = item.dataset.conversation, action = e.target.closest("[data-history-action]")?.dataset.historyAction;
      if (action === "delete") deleteConversation(id); else if (action === "pin") togglePin(id); else if (action === "rename") startRename(id); else if (!e.target.closest(".history-rename")) openConversation(id);
    });
    $("#history").addEventListener("keydown", e => { const input = e.target.closest(".history-rename"); if (!input) return; if (e.key === "Enter") { e.preventDefault(); commitRename(input.value); } else if (e.key === "Escape") { e.stopPropagation(); renamingId = null; renderHistory(); } });
    $("#history").addEventListener("focusout", e => { const input = e.target.closest(".history-rename"); if (input && renamingId) commitRename(input.value); });
    const title = $("#chatTitle"); let titleBefore = "";
    title.addEventListener("focus", () => { titleBefore = title.textContent; });
    title.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } else if (e.key === "Escape") { e.stopPropagation(); title.textContent = titleBefore; title.blur(); } });
    title.addEventListener("blur", () => { const c = currentConversation(); if (!c) return; const value = title.textContent.replace(/\s+/g, " ").trim(); if (value && value !== c.title) renameConversation(c.id, value); else title.textContent = c.title; });
    $("#modelMenu").addEventListener("click", e => { const item = e.target.closest("[data-profile]"); if (!item) return; selectProfile(item.dataset.profile); });
    $("#messages").addEventListener("click", handleMessageAction);
    $("#messages").addEventListener("click", event => {
      const summary = event.target.closest(".reasoning > summary, .tool-stack > summary"); if (!summary) return;
      const details = summary.parentElement, id = details.closest("[data-message]")?.dataset.message;
      const message = currentConversation()?.messages.find(item => item.id === id); if (!message) return;
      const reasoning = details.classList.contains("reasoning");
      message[reasoning ? "reasoningTouched" : "toolsTouched"] = true;
      setTimeout(() => { message[reasoning ? "reasoningOpen" : "toolsOpen"] = details.open; saveStoreSoon(); }, 0);
    });
    document.addEventListener("click", e => {
      const copy = e.target.closest("[data-copy-code]");
      if (copy) { void copyText(copy.closest(".code-block, .viz")?.querySelector("code")?.textContent || ""); copy.textContent = "已复制"; setTimeout(() => copy.textContent = "复制", 1200); return; }
      const vizToggle = e.target.closest("[data-viz-toggle]");
      if (vizToggle) { const viz = vizToggle.closest(".viz"), source = viz.querySelector(".viz-source"), showSource = source.classList.contains("hidden"); source.classList.toggle("hidden", !showSource); viz.querySelector(".viz-canvas").classList.toggle("hidden", showSource); vizToggle.textContent = showSource ? "图形" : "源码"; return; }
      const remove = e.target.closest("[data-remove-attachment]");
      if (remove) { const [file] = pendingAttachments.splice(Number(remove.dataset.removeAttachment), 1); void deleteAttachments([file?.id]); renderAttachments(); return; }
      const save = e.target.closest("[data-save-attachment]"); if (save) { void saveToLibrary(save.dataset.saveAttachment); return; }
      const download = e.target.closest("[data-download-attachment]"); if (download) void downloadAttachment(download.dataset.downloadAttachment);
    });
    document.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-download-attachment]")) { e.preventDefault(); void downloadAttachment(e.target.dataset.downloadAttachment); } });
    document.querySelectorAll(".tab-btn").forEach(button => button.onclick = () => { settingsTab = button.dataset.tab; renderSettings(); });
    window.addEventListener("keydown", e => { if (e.key !== "Escape") return; $("#modelMenu").classList.add("hidden"); if (confirmResolve) settleConfirm(false); else if (!$("#settingsModal").classList.contains("hidden")) closeSettings(); else if (editingMessageId) { editingMessageId = null; renderConversation(false); } });
    $("#chatScroll").addEventListener("scroll", () => { const el = $("#chatScroll"), gap = el.scrollHeight - el.scrollTop - el.clientHeight; if (gap < 8) { followBottom = true; autoScrolling = false; } else if (!autoScrolling && gap > FOLLOW_THRESHOLD) followBottom = false; });
    $("#chatScroll").addEventListener("wheel", e => { if (e.deltaY < 0) followBottom = false; }, { passive: true });
    window.addEventListener("pagehide", () => { if (saveTimer) saveStore(); });
    let wasMobile = isMobile();
    window.addEventListener("resize", () => { const mobile = isMobile(); if (mobile && !wasMobile) toggleSidebar(true); wasMobile = mobile; });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (store.settings.theme === "system") { applyAppearance(); if (view === "chat" && !controller) renderConversation(false); } });
  }

  function toggleSidebar(force) { const sidebar = $("#sidebar"), collapsed = force ?? !sidebar.classList.contains("collapsed"); sidebar.classList.toggle("collapsed", collapsed); const button = $("#collapseSidebar"); button.textContent = collapsed ? "›" : "‹"; button.title = collapsed ? "展开侧栏" : "收起侧栏"; }
  function toggleHistorySearch(force) { const wrap = $("#historySearchWrap"), show = force ?? wrap.classList.contains("hidden"); wrap.classList.toggle("hidden", !show); $("#historySearchToggle").classList.toggle("active", show); if (show) setTimeout(() => $("#historySearch").focus(), 0); else if (historyQuery) { historyQuery = ""; $("#historySearch").value = ""; renderHistory(); } }
  function discardPendingAttachments() { const ids = pendingAttachments.map(file => file.id).filter(Boolean); pendingAttachments = []; void deleteAttachments(ids); }
  function newChat() { if (controller) stopGeneration(); discardPendingAttachments(); currentId = null; editingMessageId = null; view = "chat"; render(); setTimeout(() => $("#welcomeInput").focus(), 0); if (isMobile()) toggleSidebar(true); }
  function openConversation(id) { if (id !== currentId) { if (controller) stopGeneration(); discardPendingAttachments(); } currentId = id; editingMessageId = null; view = "chat"; const c = currentConversation(); if (c) { c.unread = false; c.profileId && selectProfile(c.profileId, false); } render(); if (isMobile()) toggleSidebar(true); }
  async function deleteConversation(id) { const removed = store.conversations.find(c => c.id === id); if (!removed) return; if (!(await askConfirm({ title: "删除这段对话？", body: `「${removed.title}」将连同其附件一起移除，无法撤销。`, ok: "删除" }))) return; if (controller && id === currentId) stopGeneration(); void deleteAttachments(attachmentIds(removed.messages)); store.conversations = store.conversations.filter(c => c.id !== id); if (currentId === id) currentId = null; saveStore(); render(); toast("对话已删除"); }
  function togglePin(id) { const c = store.conversations.find(item => item.id === id); if (!c) return; c.pinned = !c.pinned; saveStore(); renderHistory(); }
  function startRename(id) { renamingId = id; renderHistory(); }
  function commitRename(value) { const id = renamingId; renamingId = null; if (id) renameConversation(id, value); else renderHistory(); }
  function renameConversation(id, value) {
    const c = store.conversations.find(item => item.id === id), title = String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (c && title && title !== c.title) { c.title = title; c.titleAuto = false; saveStore(); }
    renderHistory(); if (c && currentId === id) $("#chatTitle").textContent = c.title;
  }
  function selectProfile(id, shouldRender = true) { if (!profiles().some(p => p.id === id)) return; store.settings.activeProfileId = id; const c = currentConversation(); if (c) c.profileId = id; saveStore(); $("#modelMenu").classList.add("hidden"); if (shouldRender) renderHeader(); }

  function render() {
    renderHeader(); renderHistory();
    const c = currentConversation(), library = view === "library";
    $("#library").classList.toggle("hidden", !library);
    $("#welcome").classList.toggle("hidden", library || !!c);
    $("#chat").classList.toggle("hidden", library || !c);
    $("#composerArea").classList.toggle("hidden", library || !c);
    $("#openLibrary").classList.toggle("active", library);
    if (library) renderLibrary(); else if (c) renderConversation();
    renderAttachments(); renderSendButtons();
  }
  function renderHeader() {
    const p = activeProfile(); $("#activeModelName").textContent = p?.name || "尚未配置模型"; $("#welcomeModel").textContent = p?.name || "尚未配置模型";
    $("#displayNameSidebar").textContent = store.settings.name; $("#avatar").textContent = store.settings.name.trim().slice(0,1) || "客"; $("#themeToggle").textContent = document.documentElement.dataset.theme === "dark" ? "☾" : "☀";
    $("#greeting").textContent = greeting(); renderQuota(); renderModelMenu(); renderLibraryCount();
  }
  function renderQuota() {
    const p = activeProfile(), parsed = p ? parseTokenLimit(p.quota) : null, cap = parsed === null ? 0 : parsed, used = Math.max(0, Number(p?.usedTokens || 0));
    const remaining = cap ? Math.max(0, cap - used) : 0, ratio = p && parsed !== null ? (cap ? remaining / cap : 1) : 0, status = $("#quotaStatus");
    const percent = Math.min(100, Math.round(ratio * 100));
    $("#quotaFill").style.width = `${percent}%`; status.style.setProperty("--ink-level", `${percent}%`);
    $("#quotaText").textContent = !p ? "—" : parsed === null ? "未设" : formatTokens(remaining);
    status.classList.toggle("dry", cap > 0 && remaining === 0);
    status.classList.toggle("empty", !p || parsed === null);
    status.title = !p ? "尚未配置模型；点击设置" : parsed === null ? "必须设置用量限制；点击填写" : `余墨 ${formatTokens(remaining)}，上限 ${formatTokens(cap)}；点击设置`;
    status.setAttribute("aria-label", status.title);
  }
  function renderModelMenu() {
    const all = profiles(); $("#modelMenu").innerHTML = all.length ? all.map(p => `<button class="model-option" data-profile="${escapeHtml(p.id)}"><strong><span class="model-dot" style="opacity:${p.id === store.settings.activeProfileId ? 1 : 0}"></span>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.model)} · ${p.source === "server" ? "服务端配置" : safeHost(p.baseUrl)}</small></button>`).join("") : `<button class="model-option" id="configureFirst"><strong>添加模型配置</strong><small>填写兼容 OpenAI 的接口</small></button>`;
    $("#configureFirst")?.addEventListener("click", () => openSettings("models"));
  }
  function renderHistory() {
    const query = historyQuery.trim().toLowerCase();
    const matches = c => !query || String(c.title).toLowerCase().includes(query) || (c.messages || []).some(m => typeof m.content === "string" && m.content.toLowerCase().includes(query));
    const groups = new Map([["置顶", []], ["今天", []], ["过去七天", []], ["更早", []]]);
    [...store.conversations].filter(matches).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).forEach(c => groups.get(c.pinned ? "置顶" : dayBucket(c.updatedAt)).push(c));
    const item = c => renamingId === c.id
      ? `<div class="history-item active" data-conversation="${escapeHtml(c.id)}"><input class="history-rename" value="${escapeHtml(c.title)}" maxlength="60" aria-label="重命名对话"></div>`
      : `<div class="history-item ${c.id === currentId ? "active" : ""}" data-conversation="${escapeHtml(c.id)}"><button class="history-open" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button><span class="history-tools"><button class="history-tool" data-history-action="pin" title="${c.pinned ? "取消置顶" : "置顶"}">${c.pinned ? "松" : "钉"}</button><button class="history-tool" data-history-action="rename" title="重命名">改</button><button class="history-tool history-delete" data-history-action="delete" title="删除">×</button></span></div>`;
    $("#history").innerHTML = [...groups].filter(([,items]) => items.length).map(([label,items]) => `<div class="history-group"><div class="history-label">${label}</div>${items.map(item).join("")}</div>`).join("") || `<div style="padding:10px;color:var(--ink-3);font:12px/1.7 var(--title)">${query ? "没有匹配的对话。" : "此处尚无旧墨。"}</div>`;
    const input = $("#history .history-rename"); if (input) { input.focus(); input.select(); }
  }
  function renderConversation(shouldScroll = true) {
    const c = currentConversation(); if (!c) return;
    $("#chatTitle").textContent = c.title; $("#chatMeta").textContent = `${formatDay(c.createdAt)} · ${chineseNumber(c.messages.filter(m => m.role === "user").length, true)}问`;
    $("#chatScroll").classList.toggle("generating", c.messages.some(message => message.status === "streaming"));
    disposeChartsIn($("#messages"));
    $("#messages").innerHTML = c.messages.map(renderMessage).join("") + (c.ended ? `<div class="server-notice" style="margin:4px 0 30px">额度已用尽，本次对话已经结束。请新建对话、切换模型或调整额度。</div>` : "");
    $("#chatInput").disabled = !!c.ended; $("#chatInput").placeholder = c.ended ? "本次对话已结束" : "继续输入"; $("#clearContext").disabled = !!c.ended;
    renderSendButtons(); void loadThumbnails($("#messages")); void renderViz($("#messages")); if (shouldScroll) { followBottom = true; requestAnimationFrame(scrollBottom); }
  }
  function renderMessage(message) {
    if (message.role === "context") return `<div style="display:flex;align-items:center;gap:10px;margin:8px 0 34px;color:var(--ink-3);font:10px var(--title);letter-spacing:.12em"><span style="height:1px;flex:1;background:var(--line)"></span><span>上下文由此重新开始</span><span style="height:1px;flex:1;background:var(--line)"></span></div>`;
    if (message.role === "user") {
      if (editingMessageId === message.id) return `<article class="message user" data-message="${escapeHtml(message.id)}"><div class="message-editor"><textarea class="message-edit-input">${escapeHtml(message.content)}</textarea><div class="edit-actions"><button class="message-action" data-action="cancel-edit">取消</button><button class="message-action edit-save" data-action="save-edit">保存并重答</button></div></div></article>`;
      const files = message.attachments?.length ? `<div class="sent-attachments">${message.attachments.map(file => attachmentCard(file, null, true)).join("")}</div>` : "";
      return `<article class="message user" data-message="${escapeHtml(message.id)}">${files}${message.content ? `<div class="user-bubble">${escapeHtml(message.content)}</div>` : ""}<div class="message-actions">${actionIcon("copy","复制消息",icons.copy)}${actionIcon("edit","编辑消息",icons.edit)}</div></article>`;
    }
    const main = message.status === "error" ? `<div class="message-error">${escapeHtml(message.error || "请求失败")}</div>` : message.status === "streaming" && !message.content ? `<div class="thinking">正在凝神</div>` : message.status === "stopped" && !message.content ? `<div class="thinking">已停止生成</div>` : `<div class="markdown">${renderMarkdown(message.content)}</div>`;
    const actions = message.status === "streaming" ? "" : message.status === "error" ? actionIcon("retry","重试",icons.retry) : `${actionIcon("copy","复制回复",icons.copy)}${actionIcon("regenerate","重新生成",icons.regenerate)}`;
    return `<article class="message assistant" data-message="${escapeHtml(message.id)}"><div class="message-meta"><span class="model-dot"></span><span>${escapeHtml(message.modelName || "模型")} · ${formatTime(message.timestamp)}</span></div><div class="assistant-block">${reasoningHtml(message)}${stepsHtml(message)}${main}</div>${actions ? `<div class="message-actions">${actions}</div>` : ""}</article>`;
  }
  const TOOL_LABELS = { search_web: "检索", fetch_page: "翻阅网页", read_document: "翻阅文档" };
  function toolStackLabel() { return "working"; }
  function toolStackMeta(steps = []) { const running = steps.some(step => step.status === "running"), failed = steps.filter(step => step.status === "error").length; return running ? "正在查阅" : failed ? `${steps.length} 步 · ${failed} 失败` : `${steps.length} 步`; }
  function stepsHtml(message) { if (!message.steps?.length) return ""; const running = message.status === "streaming" && message.steps.some(step => step.status === "running"), open = message.toolsTouched ? !!message.toolsOpen : running; return `<details class="tool-stack"${open ? " open" : ""}><summary><span class="tool-stack-label">${toolStackLabel(message.steps)}</span><span class="tool-stack-meta">${toolStackMeta(message.steps)}</span></summary><div class="tool-stack-body"><div class="tool-steps">${message.steps.map(stepHtml).join("")}</div></div></details>`; }
  function stepHtml(step) {
    let title = step.title; if (!title) { try { const args = JSON.parse(step.arguments || "{}"); title = args.query || args.url || args.name || ""; } catch { title = ""; } }
    const resultLink = result => { const url = safeWebUrl(result.url), label = escapeHtml(result.title || result.url); return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`; };
    const stepUrl = safeWebUrl(step.url);
    const body = step.results?.length ? `<ul class="tool-results">${step.results.slice(0, 8).map(r => `<li>${resultLink(r)}${r.snippet ? `<span>${escapeHtml(r.snippet)}</span>` : ""}</li>`).join("")}</ul>` : step.url ? `<div class="tool-note">${stepUrl ? `<a href="${escapeHtml(stepUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(stepUrl)}</a>` : escapeHtml(step.url)}</div>` : step.note ? `<div class="tool-note">${escapeHtml(step.note)}</div>` : "";
    const status = step.status || "done", state = status === "running" ? `<span class="tool-state spinning" aria-label="进行中"></span>` : status === "error" ? `<span class="tool-state failed" aria-label="失败">×</span>` : `<span class="tool-state done" aria-label="完成">✓</span>`;
    return `<div class="tool-step" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">${escapeHtml(TOOL_LABELS[step.name] || step.name)}</span><span class="tool-title">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "工具执行失败") : ""}">${status === "running" ? "查阅中" : status === "error" ? escapeHtml(step.result || "失败") : escapeHtml(step.result || "")}</span>${state}</div>${body}</div>`;
  }
  function refreshSteps(assistant) {
    const block = document.querySelector(`[data-message="${assistant.id}"] .assistant-block`); if (!block) return;
    let stack = block.querySelector(".tool-stack");
    if (!stack) { const anchor = block.querySelector(".reasoning"); if (anchor) anchor.insertAdjacentHTML("afterend", stepsHtml(assistant)); else block.insertAdjacentHTML("afterbegin", stepsHtml(assistant)); stack = block.querySelector(".tool-stack"); }
    if (stack) {
      stack.querySelector(".tool-stack-label").textContent = toolStackLabel(assistant.steps);
      stack.querySelector(".tool-stack-meta").textContent = toolStackMeta(assistant.steps);
      stack.querySelector(".tool-steps").innerHTML = (assistant.steps || []).map(stepHtml).join("");
      const running = assistant.status === "streaming" && assistant.steps.some(step => step.status === "running");
      if (running) { if (!assistant.toolsTouched) stack.open = true; }
      else if (!assistant.toolsTouched) { stack.open = false; assistant.toolsOpen = false; }
    }
    if (!assistant.content && !block.querySelector(".thinking")) block.insertAdjacentHTML("beforeend", `<div class="thinking">正在凝神</div>`);
  }
  function reasoningHtml(message) { if (!message.reasoning) return ""; const open = message.reasoningTouched ? !!message.reasoningOpen : message.status === "streaming" && !message.content; return `<details class="reasoning"${open ? " open" : ""}><summary>thinking</summary><div class="reasoning-body">${escapeHtml(message.reasoning)}</div></details>`; }
  const icons = {
    copy: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="5.2" y="5.2" width="7.4" height="7.4" rx="1.5"/><path d="M10.5 3.4H4.9a1.5 1.5 0 0 0-1.5 1.5v5.6"/></svg>`,
    edit: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M3.3 12.7l.6-3 6.8-6.8 2.4 2.4-6.8 6.8-3 .6z"/><path d="M9.8 3.8l2.4 2.4"/></svg>`,
    regenerate: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 3.2v2.6h-2.6"/></svg>`,
    retry: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M8 3v5l3 1.8"/><circle cx="8" cy="8" r="5.2"/></svg>`
  };
  function actionIcon(action, title, icon) { return `<button class="message-action" data-action="${action}" title="${title}" aria-label="${title}">${icon}</button>`; }
  function fileTypeLabel(file) { const match = String(file.name || "").match(/\.([^.]+)$/), extension = match?.[1]?.replace(/[^a-z0-9]/gi, "").toUpperCase(); if (extension) return extension.slice(0,7); const subtype = String(file.mime || "").split("/")[1]?.split(/[;+]/)[0]?.toUpperCase(); return (subtype || "FILE").slice(0,7); }
  function formatFileSize(value) { const bytes = Number(value || 0); return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(bytes < 10240 ? 1 : 0)} KB` : `${(bytes/1048576).toFixed(1)} MB`; }
  function kindGlyph(kind) { return kind === "image" ? "画" : kind === "text" ? "文" : "卷"; }
  function attachmentCard(file, index, sent = false) {
    const type = fileTypeLabel(file), title = `${file.name} · ${formatFileSize(file.size)}`;
    const thumb = file.kind === "image" && file.id ? `<img class="attachment-thumb" data-thumb="${escapeHtml(file.id)}" alt="">` : "";
    const body = `${thumb}<span class="attachment-name">${escapeHtml(file.name)}</span><span class="attachment-mark" aria-hidden="true">${kindGlyph(file.kind)}</span><span class="attachment-type">${escapeHtml(type)}</span>`;
    const save = file.id ? `<button class="attachment-tool attachment-save" data-save-attachment="${escapeHtml(file.id)}" title="收入卷宗" aria-label="收入卷宗">藏</button>` : "";
    if (sent && file.id) return `<div class="attachment-card sent" role="button" tabindex="0" data-kind="${file.kind}" data-download-attachment="${escapeHtml(file.id)}" title="下载 ${escapeHtml(title)}">${body}${save}</div>`;
    return `<div class="attachment-card pending" data-kind="${file.kind}" title="${escapeHtml(title)}">${body}${save}${index !== null ? `<button class="attachment-tool attachment-remove" data-remove-attachment="${index}" title="移除 ${escapeHtml(file.name)}" aria-label="移除 ${escapeHtml(file.name)}">×</button>` : ""}</div>`;
  }
  function renderAttachments() { const html = pendingAttachments.map((file,index) => attachmentCard(file,index)).join(""); [$("#attachments"), $("#welcomeAttachments")].forEach(el => { el.classList.toggle("hidden", !pendingAttachments.length); el.innerHTML = html; void loadThumbnails(el); }); }
  function renderSendButtons() { document.querySelectorAll(".send-trigger").forEach(b => { b.textContent = controller ? "■" : "↑"; b.title = controller ? "停止生成" : "发送"; b.classList.toggle("stop-btn", !!controller); b.disabled = !controller && !!currentConversation()?.ended; }); }
  // 图片缩略图：原件在 IndexedDB，渲染后异步补上 src；缓存最近 40 张
  async function loadThumbnails(root) {
    for (const img of root.querySelectorAll("img[data-thumb]:not([src])")) {
      const id = img.dataset.thumb;
      try {
        let url = thumbCache.get(id);
        if (!url) { const file = await getAttachment(id); if (!file || file.kind !== "image") continue; url = file.data; thumbCache.set(id, url); if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value); }
        img.src = url; img.closest(".attachment-card, .library-card")?.classList.add("has-thumb");
      } catch {}
    }
  }

  function greeting() { const h = new Date().getHours(); return h < 6 ? "夜深宜静问。" : h < 11 ? "晨光入砚，写点什么。" : h < 18 ? "落笔，便有回声。" : "灯下有问，慢慢说来。"; }
  function safeWebUrl(value) { try { const url = new URL(String(value || "")); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } }
  function safeHost(url) { try { return new URL(url).host; } catch { return "未填写地址"; } }
  function applyAppearance() {
    const { theme, font, width, accent } = store.settings;
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    if (window.mermaid) setupMermaid();
    document.documentElement.style.setProperty("--read", `${Number(width) || 760}px`);
    document.documentElement.style.setProperty("--accent", accent || "#9b5540");
    const root = document.documentElement.style;
    root.setProperty("--body", font === "serif" ? '"Noto Serif SC","Songti SC","STSong",serif' : '"Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif');
    root.setProperty("--title", font === "sans" ? '"Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif' : '"Noto Serif SC","Songti SC","STSong",serif');
  }

  async function handleFiles(event) { await addFiles(event.target.files); event.target.value = ""; }
  function isTextFile(file) { const extension = String(file.name || "").split(".").pop().toLowerCase(), mime = String(file.type || "").toLowerCase(); return mime.startsWith("text/") || ["application/json","application/xml","application/javascript","application/x-javascript","application/typescript","application/yaml","application/x-yaml","application/csv"].includes(mime) || mime.endsWith("+json") || mime.endsWith("+xml") || ["txt","md","markdown","json","jsonl","csv","tsv","xml","yaml","yml","js","mjs","cjs","ts","tsx","jsx","html","htm","css","scss","less","py","rb","go","rs","java","c","h","cpp","hpp","cs","php","sh","ps1","sql","toml","ini","log"].includes(extension); }
  async function addFiles(fileList) {
    const files = Array.from(fileList || []); if (!files.length) return;
    if (view === "library") return addLibraryFiles(files);
    let total = pendingAttachments.reduce((sum,file) => sum + Number(file.size || 0), 0), added = 0;
    for (const file of files) {
      if (pendingAttachments.length >= 10) { toast("一次最多添加 10 个附件"); break; }
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name} 超过 8 MB，未添加`); continue; }
      if (total + file.size > MAX_PENDING_BYTES) { toast("本次附件总大小不能超过 8 MB"); break; }
      try { pendingAttachments.push(await ingestFile(file)); total += file.size; added += 1; }
      catch { toast(`${file.name} 读取失败`); }
    }
    renderAttachments(); if (added) toast(`已置入 ${added} 件附件`);
  }
  async function ingestFile(file) {
    const kind = file.type.startsWith("image/") ? "image" : isTextFile(file) ? "text" : "file", id = uid();
    const data = await readFile(file, kind === "text" ? "text" : "data");
    const metadata = { id, kind, name: file.name || "未命名文件", mime: file.type || "application/octet-stream", size: file.size, modifiedAt: file.lastModified || Date.now() };
    let extractedText = "", extractionError = "";
    if (kind === "file") try { extractedText = await extractDocumentText(metadata.name, data); } catch (error) { extractionError = String(error.message || error).slice(0,200); }
    await putAttachment({ ...metadata, data, extractedText, extractionError });
    return { ...metadata, extracted: !!extractedText };
  }

  // ---------- 卷宗：跨对话保存的文件库，原件同样存在 IndexedDB，元数据记录在 store.library ----------
  function openLibrary() { view = "library"; render(); if (isMobile()) toggleSidebar(true); setTimeout(() => $("#librarySearch").focus(), 0); }
  function closeLibrary() { view = "chat"; render(); }
  function renderLibraryCount() { $("#libraryCount").textContent = store.library.length ? String(store.library.length) : ""; }
  function libraryEntry(file) { return { id: file.id, kind: file.kind, name: file.name, mime: file.mime, size: file.size, modifiedAt: file.modifiedAt, extracted: !!file.extracted, savedAt: now() }; }
  function renderLibrary() {
    const query = libraryQuery.trim().toLowerCase();
    const items = store.library.filter(file => (libraryKind === "all" || file.kind === libraryKind) && (!query || String(file.name).toLowerCase().includes(query)));
    $("#libraryCountText").textContent = store.library.length ? `现存 ${store.library.length} 件 · ${formatFileSize(store.library.reduce((sum,file) => sum + Number(file.size || 0), 0))}` : "";
    document.querySelectorAll("[data-library-kind]").forEach(button => button.classList.toggle("active", button.dataset.libraryKind === libraryKind));
    $("#libraryGrid").innerHTML = items.length
      ? items.map(file => `<div class="library-card" data-library-item="${escapeHtml(file.id)}"><div class="library-preview">${file.kind === "image" ? `<img class="library-thumb" data-thumb="${escapeHtml(file.id)}" alt="">` : ""}<span class="library-glyph" aria-hidden="true">${kindGlyph(file.kind)}</span><span class="attachment-type">${escapeHtml(fileTypeLabel(file))}</span></div><div class="library-body"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${formatFileSize(file.size)} · 收于 ${formatDay(file.savedAt)}${file.kind === "file" && !file.extracted ? " · 未能提取正文" : ""}</small></div><div class="library-actions"><button data-library-action="place" title="加入当前对话的待发附件">置于案上</button><button data-library-action="download">下载</button><button data-library-action="remove">移出</button></div></div>`).join("")
      : `<div class="library-empty">${store.library.length ? "没有符合条件的卷宗。" : "卷宗尚空。<br>可在附件卡片上按「藏」收入，也可直接收入新文件或拖入此页。"}</div>`;
    void loadThumbnails($("#libraryGrid"));
  }
  async function addLibraryFiles(fileList) {
    const files = Array.from(fileList || []); let added = 0;
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name} 超过 8 MB，未收入`); continue; }
      try { store.library.unshift(libraryEntry(await ingestFile(file))); added += 1; }
      catch { toast(`${file.name} 读取失败`); }
    }
    saveStore(); if (view === "library") renderLibrary(); renderLibraryCount(); if (added) toast(`已收入 ${added} 件`);
  }
  async function saveToLibrary(id) {
    if (inLibrary(id)) return toast("已在卷宗中");
    const metadata = pendingAttachments.find(file => file.id === id) || store.conversations.flatMap(c => c.messages || []).flatMap(m => m.attachments || []).find(file => file.id === id);
    if (!metadata || !(await getAttachment(id))) return toast("附件原件已不在此浏览器中");
    store.library.unshift(libraryEntry(metadata)); saveStore(); renderLibraryCount(); toast(`已将 ${metadata.name} 收入卷宗`);
  }
  function removeFromLibrary(id) {
    store.library = store.library.filter(file => file.id !== id); saveStore();
    if (!isReferenced(id)) void deleteAttachment(id);
    renderLibrary(); renderLibraryCount();
  }
  function placeFromLibrary(id) {
    const item = store.library.find(file => file.id === id); if (!item) return;
    if (currentConversation()?.ended) return toast("本次对话已结束，请新建对话后再置入");
    if (pendingAttachments.some(file => file.id === id)) return toast("此件已在案上");
    if (pendingAttachments.length >= 10) return toast("一次最多添加 10 个附件");
    const total = pendingAttachments.reduce((sum,file) => sum + Number(file.size || 0), 0);
    if (total + Number(item.size || 0) > MAX_PENDING_BYTES) return toast("本次附件总大小不能超过 8 MB");
    const { savedAt, ...metadata } = item; pendingAttachments.push(metadata);
    closeLibrary(); toast(`已将 ${item.name} 置于案上`);
    setTimeout(() => (currentConversation() ? $("#chatInput") : $("#welcomeInput")).focus(), 0);
  }

  function readFile(file, mode) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; mode === "data" ? reader.readAsDataURL(file) : reader.readAsText(file); }); }
  function bytesFromDataUrl(value) { const encoded = String(value).slice(String(value).indexOf(",") + 1), binary = atob(encoded), bytes = new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i); return bytes; }
  function trimExtractedText(value) { const text = String(value || "").replace(/\0/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim(); return text.length > MAX_EXTRACTED_CHARS ? `${text.slice(0,MAX_EXTRACTED_CHARS)}\n\n[文档内容过长，已在本机截取前 ${MAX_EXTRACTED_CHARS} 个字符]` : text; }
  async function extractDocumentText(name, data) {
    const extension = String(name || "").split(".").pop().toLowerCase();
    if (extension === "pdf") return trimExtractedText(await extractPdfText(data));
    if (["docx","pptx","xlsx","odt","ods","odp"].includes(extension)) return trimExtractedText(await extractZipDocumentText(extension, bytesFromDataUrl(data)));
    return "";
  }
  async function extractPdfText(data) {
    if (!window.pdfjsLib) return "";
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
    const loading = window.pdfjsLib.getDocument({ data: bytesFromDataUrl(data), cMapUrl: "./vendor/cmaps/", cMapPacked: true, standardFontDataUrl: "./vendor/standard_fonts/" }), document = await loading.promise, pages = [];
    try {
      for (let pageNumber=1;pageNumber<=document.numPages;pageNumber++) {
        const page = await document.getPage(pageNumber), content = await page.getTextContent();
        let line = "", output = [];
        for (const item of content.items || []) { if (item.str) line += `${line ? " " : ""}${item.str}`; if (item.hasEOL && line) { output.push(line); line = ""; } }
        if (line) output.push(line); pages.push(`第 ${pageNumber} 页\n${output.join("\n")}`);
        if (pages.join("\n\n").length >= MAX_EXTRACTED_CHARS) break;
      }
    } finally { await document.destroy(); }
    return pages.join("\n\n");
  }
  async function unzipSelected(bytes, wanted) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder(), minimum = Math.max(0, bytes.length - 65557); let eocd = -1;
    for (let offset=bytes.length-22;offset>=minimum;offset--) if (view.getUint32(offset,true) === 0x06054b50) { eocd = offset; break; }
    if (eocd < 0) throw Error("文档压缩结构无效");
    const count = view.getUint16(eocd + 10,true), centralOffset = view.getUint32(eocd + 16,true), entries = new Map(); let cursor = centralOffset, extractedBytes = 0;
    for (let index=0;index<count;index++) {
      if (view.getUint32(cursor,true) !== 0x02014b50) break;
      const method = view.getUint16(cursor+10,true), compressedSize = view.getUint32(cursor+20,true), uncompressedSize = view.getUint32(cursor+24,true), nameLength = view.getUint16(cursor+28,true), extraLength = view.getUint16(cursor+30,true), commentLength = view.getUint16(cursor+32,true), localOffset = view.getUint32(cursor+42,true), name = decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
      if (wanted(name) && uncompressedSize <= 8 * 1024 * 1024 && extractedBytes + uncompressedSize <= 16 * 1024 * 1024) {
        const localNameLength = view.getUint16(localOffset+26,true), localExtraLength = view.getUint16(localOffset+28,true), start = localOffset+30+localNameLength+localExtraLength, compressed = bytes.slice(start,start+compressedSize); let output;
        if (method === 0) output = compressed;
        else if (method === 8) { const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw")); output = new Uint8Array(await new Response(stream).arrayBuffer()); }
        if (output) { entries.set(name,decoder.decode(output)); extractedBytes += output.length; }
      }
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }
  function parseXml(value) { const document = new DOMParser().parseFromString(value,"application/xml"); if (document.querySelector("parsererror")) throw Error("文档 XML 无效"); return document; }
  function paragraphsFromXml(value) { const document = parseXml(value), paragraphs = [...document.getElementsByTagNameNS("*","p")]; if (!paragraphs.length) return document.documentElement.textContent || ""; return paragraphs.map(node => [...node.getElementsByTagNameNS("*","t")].map(text => text.textContent).join("") || node.textContent).filter(Boolean).join("\n"); }
  async function extractZipDocumentText(extension, bytes) {
    if (extension === "docx") { const entries = await unzipSelected(bytes,name => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name)); return [...entries.entries()].sort().map(([,xml]) => paragraphsFromXml(xml)).join("\n\n"); }
    if (extension === "pptx") { const entries = await unzipSelected(bytes,name => /^ppt\/slides\/slide\d+\.xml$/.test(name)); return [...entries.entries()].sort((a,b) => a[0].localeCompare(b[0],undefined,{numeric:true})).map(([name,xml],index) => `第 ${index+1} 页\n${paragraphsFromXml(xml)}`).join("\n\n"); }
    if (extension === "xlsx") {
      const entries = await unzipSelected(bytes,name => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)), sharedXml = entries.get("xl/sharedStrings.xml"), shared = sharedXml ? [...parseXml(sharedXml).getElementsByTagNameNS("*","si")].map(node => [...node.getElementsByTagNameNS("*","t")].map(t => t.textContent).join("")) : [];
      return [...entries.entries()].filter(([name]) => /\/worksheets\//.test(name)).sort((a,b) => a[0].localeCompare(b[0],undefined,{numeric:true})).map(([name,xml],index) => { const document = parseXml(xml), rows = [...document.getElementsByTagNameNS("*","row")].map(row => [...row.getElementsByTagNameNS("*","c")].map(cell => { const value = cell.getElementsByTagNameNS("*","v")[0]?.textContent || cell.textContent || ""; return cell.getAttribute("t") === "s" ? (shared[Number(value)] ?? value) : value; }).join("\t")); return `工作表 ${index+1}\n${rows.join("\n")}`; }).join("\n\n");
    }
    const entries = await unzipSelected(bytes,name => name === "content.xml"); return entries.get("content.xml") ? paragraphsFromXml(entries.get("content.xml")) : "";
  }

  async function downloadAttachment(id) {
    try {
      const file = await getAttachment(id); if (!file) return toast("附件原件已不在此浏览器中");
      const anchor = document.createElement("a"); let objectUrl = "";
      if (file.kind === "text") { objectUrl = URL.createObjectURL(new Blob([file.data], { type: file.mime || "text/plain" })); anchor.href = objectUrl; }
      else anchor.href = file.data;
      anchor.download = file.name || "附件"; anchor.click(); if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch { toast("附件读取失败"); }
  }
  // 只有本轮要回答的那条用户消息携带附件原件；更早的消息改为文本摘要，避免每轮重发图片与长文
  function summarize(text, name, label) { const value = String(text || ""); return value.length > HISTORY_TEXT_CHARS ? `\n\n--- 附件：${name}（${label}，摘要）---\n${value.slice(0, HISTORY_TEXT_CHARS)}\n[全文共 ${value.length} 字，此前已完整发送]` : `\n\n--- 附件：${name}（${label}）---\n${value}`; }
  async function messageForApi(message, latest) {
    if (message.role !== "user" || !message.attachments?.length) return { role: message.role, content: message.content };
    const content = [{ type: "text", text: message.content || "请查看附件。" }];
    for (const metadata of message.attachments) {
      const file = metadata.data !== undefined ? metadata : await getAttachment(metadata.id);
      if (!file) { content[0].text += `\n\n[附件 ${metadata.name} 的原件在此浏览器中已不可用]`; continue; }
      if (file.kind === "text") { content[0].text += latest ? `\n\n--- 附件：${file.name} ---\n${file.data}` : summarize(file.data, file.name, "文本"); continue; }
      if (file.kind !== "image" && file.extractedText) { content[0].text += latest ? `\n\n--- 附件：${file.name}（本机提取）---\n${file.extractedText}` : summarize(file.extractedText, file.name, "本机提取"); continue; }
      if (!latest) { content[0].text += `\n\n[${file.kind === "image" ? "图片" : "文件"}：${file.name}，${formatFileSize(file.size)}，已在此前发送]`; continue; }
      if (file.kind === "image") content.push({ type: "image_url", image_url: { url: file.data, detail: "auto" } });
      else content.push({ type: "file", file: { filename: file.name, file_data: String(file.data).replace(/^data:[^,]*,/, "") } });
    }
    return { role: "user", content };
  }
  async function sendOrStop() {
    if (controller) return stopGeneration();
    const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
    const text = input.value.trim(); if (!text && !pendingAttachments.length) return;
    let profile = activeProfile(); if (!profile) { toast("请先添加模型配置"); return openSettings("models"); }
    if (profile.tools !== false && apiBase === null) { await ensureLocalBridge(); profile = activeProfile() || profile; }
    if (parseTokenLimit(profile.quota) === null) { toast("请先为当前模型设置用量限制"); openSettings("models"); setTimeout(() => document.querySelector(`[data-profile-card="${profile.id}"] [data-quota-amount]`)?.focus(),0); return; }
    if (quotaExhausted(profile)) { const existing = currentConversation(); if (existing) { existing.ended = true; saveStore(); renderConversation(); } toast("模型额度已用尽，请调整额度或切换模型"); return; }
    let c = currentConversation();
    if (!c) {
      c = { id: uid(), title: titleFrom(text, pendingAttachments), createdAt: now(), updatedAt: now(), profileId: profile.id, messages: [] };
      store.conversations.unshift(c); currentId = c.id;
    }
    const user = { id: uid(), role: "user", content: text, timestamp: now(), attachments: pendingAttachments };
    const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
    c.messages.push(user, assistant); c.updatedAt = now(); c.profileId = profile.id;
    input.value = ""; input.style.height = "auto"; pendingAttachments = []; saveStore(); render();
    await streamReply(c, assistant, profile);
  }
  function titleFrom(text, attachments) { const value = text || `关于 ${attachments[0]?.name || "附件"}`; return value.replace(/\s+/g," ").slice(0,28) + (value.length > 28 ? "…" : ""); }
  function stopGeneration() { controller?.abort(); controller = null; const c = currentConversation(); const last = c?.messages.at(-1); if (last?.status === "streaming") last.status = "stopped"; saveStore(); renderSendButtons(); setConnection("idle", "已停止"); renderConversation(); }

  async function streamReply(conversation, assistant, profile) {
    controller = new AbortController(); renderSendButtons(); setConnection("busy", "生成中");
    const started = performance.now();
    try {
      const contextIndex = conversation.messages.map(m => m.role).lastIndexOf("context");
      const source = conversation.messages.slice(contextIndex + 1).filter(m => m.id !== assistant.id && m.status !== "error" && ["user","assistant"].includes(m.role));
      const lastUserId = source.filter(m => m.role === "user").at(-1)?.id, history = [];
      for (const m of source) history.push(await messageForApi(m, m.id === lastUserId));
      const tools = profile.tools !== false ? toolDefinitions(conversation) : null;
      const overrides = { systemPrompt: assistantHint(profile, tools), tools, enableSearch: modelSearchEnabled(profile) };
      const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }; let usageKnown = false;
      for (;;) {
        assistant.toolCalls = null; assistant.usage = null;
        const response = await requestChat(profile, history, controller.signal, overrides);
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || `请求失败（${response.status}）`); }
        const type = response.headers.get("content-type") || "";
        if (type.includes("text/event-stream")) await readSse(response, assistant);
        else { const data = await response.json(), message = data?.choices?.[0]?.message; assistant.content += extractContent(data); assistant.reasoning = normalizeContent(message?.reasoning_content) || assistant.reasoning; assistant.usage = data.usage || null; if (Array.isArray(message?.tool_calls)) assistant.toolCalls = message.tool_calls.map(call => ({ id: call.id, name: call.function?.name || "", arguments: call.function?.arguments || "" })); }
        if (assistant.usage) { usageKnown = true; for (const key of Object.keys(usage)) usage[key] += Number(assistant.usage[key] || 0); }
        const calls = (assistant.toolCalls || []).filter(call => call.name);
        if (!calls.length || !overrides.tools) break;
        // 模型请求调用工具：记录步骤、执行、把结果作为 tool 消息回传，再让模型继续
        const steps = calls.map(call => ({ id: call.id || `call_${uid().slice(0, 8)}`, name: call.name, arguments: call.arguments || "{}", status: "running" }));
        (assistant.steps ||= []).push(...steps); refreshSteps(assistant); setConnection("busy", "查阅中");
        history.push({ role: "assistant", content: assistant.content || null, tool_calls: steps.map(step => ({ id: step.id, type: "function", function: { name: step.name, arguments: step.arguments } })) });
        for (const step of steps) {
          const stepStarted = performance.now();
          const outcome = await runTool(step, conversation, controller.signal);
          const remaining = MIN_TOOL_STATUS_MS - (performance.now() - stepStarted); if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
          step.status = outcome.ok ? "done" : "error"; step.result = outcome.display;
          history.push({ role: "tool", tool_call_id: step.id, content: String(outcome.content).slice(0, 60000) });
          refreshSteps(assistant); saveStore();
        }
        if (assistant.content) assistant.content += "\n\n";
        setConnection("busy", "生成中");
      }
      assistant.content = assistant.content.replace(/^\n+|\n+$/g, ""); assistant.usage = usageKnown ? usage : null;
      if (!assistant.content) throw Error("模型未返回正文，请适当提高最大输出长度后重试");
      assistant.status = "complete"; conversation.updatedAt = now(); accountUsage(profile, assistant, history, conversation); setConnection("idle", conversation.ended ? "额度已尽" : "就绪");
    } catch (error) {
      if (error.name === "AbortError") assistant.status = "stopped";
      else { assistant.status = "error"; assistant.error = friendlyError(error.message); setConnection("error", "请求失败"); }
    } finally {
      assistant.durationMs = Math.round(performance.now() - started);
      controller = null; saveStore(); renderHistory(); if (currentId === conversation.id && view === "chat") renderConversation(); renderSendButtons();
      if (assistant.status === "complete") void maybeAutoTitle(conversation, profile);
    }
  }
  function accountUsage(profile, assistant, requestMessages, conversation) {
    const exact = Number(assistant.usage?.total_tokens || 0);
    const consumed = exact > 0 ? exact : estimateTokens(requestMessages) + estimateTokens([{ content: assistant.content }]);
    profile.usedTokens = Math.max(0, Number(profile.usedTokens || 0)) + consumed;
    assistant.tokenCount = consumed; assistant.tokenEstimated = !(exact > 0);
    persistServerProfile(profile);
    if (quotaExhausted(profile)) { conversation.ended = true; toast("本次回复已完成；额度现已用尽，对话随之结束"); }
    renderQuota();
  }
  // 首次问答完成后请模型拟一个短标题；用户手动改过题（titleAuto === false）就不再动
  async function maybeAutoTitle(conversation, profile) {
    if (!store.settings.autoTitle || conversation.titleAuto === false || conversation.titled || conversation.ended || quotaExhausted(profile)) return;
    const first = conversation.messages.find(m => m.role === "user"), replies = conversation.messages.filter(m => m.role === "assistant" && m.status === "complete");
    if (!first || replies.length !== 1) return;
    conversation.titled = true;
    try {
      const prompt = `请为下面这段对话拟一个不超过 12 个字的标题，直接输出标题本身，不要引号、标点或解释。\n\n用户：${String(first.content || "（附件）").slice(0, 1200)}\n\n助手：${String(replies[0].content).slice(0, 1200)}`;
      const response = await requestChat(profile, [{ role: "user", content: prompt }], AbortSignal.timeout(30000), { maxTokens: 600, temperature: .3, systemPrompt: "" });
      if (!response.ok) return;
      const temp = { id: `title-${uid()}`, content: "" };
      if ((response.headers.get("content-type") || "").includes("text/event-stream")) await readSse(response, temp); else { const data = await response.json(); temp.content = extractContent(data); temp.usage = data.usage; }
      const spent = Number(temp.usage?.total_tokens || 0) || estimateTokens([{ content: prompt }, { content: temp.content }]);
      profile.usedTokens = Math.max(0, Number(profile.usedTokens || 0)) + spent; persistServerProfile(profile); renderQuota();
      if (quotaExhausted(profile)) conversation.ended = true;
      const title = temp.content.split("\n").map(line => line.trim()).find(Boolean)?.replace(/^[\s"'“”‘’《》「」【】#*]+|[\s"'“”‘’《》「」【】。！？!?.、,，]+$/g, "").slice(0, 24) || "";
      if (!title || conversation.titleAuto === false) return;
      conversation.title = title; conversation.titleAuto = true; saveStore(); renderHistory(); if (currentId === conversation.id) $("#chatTitle").textContent = title;
    } catch {}
  }
  function availableDocuments(conversation) {
    const seen = new Map();
    for (const file of [...(conversation?.messages || []).flatMap(m => m.attachments || []), ...store.library]) if (file.id && !seen.has(file.name) && (file.kind === "text" || (file.kind === "file" && file.extracted))) seen.set(file.name, file);
    return [...seen.values()];
  }
  // 通义千问（DashScope）接口默认打开模型自带联网；其他接口不发送该参数，除非用户手动开启
  function modelSearchEnabled(profile) { if (typeof profile.enableSearch === "boolean") return profile.enableSearch; return /dashscope\.aliyuncs\.com/i.test(String(profile.baseUrl || "")); }
  function toolDefinitions(conversation) {
    const tools = [];
    if (apiBase !== null) tools.push(
      { type: "function", function: { name: "search_web", description: "联网搜索，返回若干条标题、链接与摘要。需要最新信息、事实核查或用户明确要求联网时使用。", parameters: { type: "object", properties: { query: { type: "string", description: "搜索关键词，简洁具体" } }, required: ["query"] } } },
      { type: "function", function: { name: "fetch_page", description: "读取指定网页的正文文字（已去除 HTML）。通常在搜索后用于查看某条结果的详细内容。", parameters: { type: "object", properties: { url: { type: "string", description: "完整的 http/https 地址" } }, required: ["url"] } } });
    const docs = availableDocuments(conversation);
    if (docs.length) tools.push({ type: "function", function: { name: "read_document", description: `读取用户提供的文档全文或片段。当前可读文档：${docs.map(d => d.name).join("、")}。文档很长时可按页码或关键词只取片段。`, parameters: { type: "object", properties: { name: { type: "string", description: "文件名，可部分匹配" }, page: { type: "integer", description: "只读取该页（PDF / PPTX）" }, query: { type: "string", description: "只返回包含该关键词的段落" } }, required: ["name"] } } });
    return tools.length ? tools : null;
  }
  // 附加给模型的提示：日期、工具用法、页内可视化的写法
  function assistantHint(profile, tools) {
    const lines = [`今天是 ${formatDay(now())}（${new Date().toISOString().slice(0, 10)}）。`];
    const names = new Set((tools || []).map(tool => tool?.function?.name));
    if (names.has("search_web")) lines.push("你可以通过 search_web 联网。凡涉及「当前、最新、最近、今年、现在」等时效性内容，或超出你知识截止时间的问题，必须先调用 search_web 再回答，不要以知识截止为由拒答或凭记忆猜测；必要时用 fetch_page 查看详情，引用网页请附上链接。避免重复近义搜索；同一网页失败后改用其他来源，资料足够时完成回答。");
    if (names.has("read_document")) lines.push("用户提供了文档，你可以用 read_document 按需查阅正文。");
    if (window.mermaid || window.echarts) lines.push("需要画图时：流程图、时序图、结构图用 ```mermaid 代码块；数据图表用 ```echarts 代码块，内容是 ECharts option 的纯 JSON（不要含函数）。");
    const base = String(profile.systemPrompt || "").trim();
    return base ? `${base}\n\n${lines.join("\n")}` : lines.join("\n");
  }
  async function bridge(path, payload, signal) {
    if (apiBase === null) throw Error("联网工具需要本机模型桥接");
    const response = await fetch(`${apiBase}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || `请求失败（${response.status}）`);
    return data;
  }
  async function runTool(step, conversation, signal) {
    let args = {}; try { args = JSON.parse(step.arguments || "{}"); } catch { return { ok: false, content: "参数不是合法 JSON", display: "参数解析失败" }; }
    try {
      if (step.name === "search_web") {
        step.title = String(args.query || ""); const data = await bridge("/api/search", { query: step.title, count: 6 }, signal);
        step.results = (data.results || []).map(({ title, url, snippet }) => ({ title, url, snippet }));
        return { ok: true, content: step.results.length ? JSON.stringify(step.results) : "没有找到结果", display: `${step.results.length} 条结果` };
      }
      if (step.name === "fetch_page") {
        step.url = String(args.url || ""); const data = await bridge("/api/fetch", { url: step.url }, signal);
        step.title = data.title || step.url;
        return { ok: true, content: `标题：${data.title || ""}\n地址：${data.url || step.url}\n\n${data.text || ""}`, display: `${(data.text || "").length} 字` };
      }
      if (step.name === "read_document") return await readDocumentTool(step, args, conversation);
      return { ok: false, content: `未知工具 ${step.name}`, display: "未知工具" };
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return { ok: false, content: `工具执行失败：${String(error.message || error)}`, display: friendlyError(String(error.message || error)).slice(0, 60) };
    }
  }
  async function readDocumentTool(step, args, conversation) {
    const docs = availableDocuments(conversation), wanted = String(args.name || "").toLowerCase();
    const doc = docs.find(d => d.name.toLowerCase() === wanted) || docs.find(d => d.name.toLowerCase().includes(wanted)) || (docs.length === 1 ? docs[0] : null);
    if (!doc) return { ok: false, content: `找不到文档「${args.name}」。可读文档：${docs.map(d => d.name).join("、") || "无"}`, display: "未找到" };
    step.title = doc.name;
    const record = await getAttachment(doc.id), text = record ? (record.kind === "text" ? String(record.data || "") : String(record.extractedText || "")) : "";
    if (!text) return { ok: false, content: "该文档没有可读取的文本", display: "无文本" };
    const pages = text.split(/^(?=第 \d+ 页$)/m), pageCount = pages.filter(p => /^第 \d+ 页$/m.test(p)).length;
    if (args.page) { const page = pages.find(p => p.startsWith(`第 ${Number(args.page)} 页`)); if (!page) return { ok: false, content: `没有第 ${args.page} 页，共 ${pageCount || 1} 页`, display: "页码超出" }; step.note = `第 ${args.page} 页`; return { ok: true, content: page.slice(0, 20000), display: `第 ${args.page} 页 · ${page.length} 字` }; }
    if (args.query) {
      const needle = String(args.query).toLowerCase(), hits = []; let index = text.toLowerCase().indexOf(needle);
      while (index >= 0 && hits.length < 8) { hits.push(text.slice(Math.max(0, index - 300), index + needle.length + 300).trim()); index = text.toLowerCase().indexOf(needle, index + needle.length + 300); }
      step.note = `关键词「${args.query}」`; return hits.length ? { ok: true, content: hits.map((hit, i) => `片段 ${i + 1}：…${hit}…`).join("\n\n"), display: `${hits.length} 处匹配` } : { ok: true, content: `全文没有出现「${args.query}」`, display: "无匹配" };
    }
    const limit = 12000; step.note = `${text.length} 字${pageCount ? ` · ${pageCount} 页` : ""}`;
    return { ok: true, content: text.length > limit ? `${text.slice(0, limit)}\n\n[文档共 ${text.length} 字${pageCount ? `、${pageCount} 页` : ""}，此处只给出开头；可用 page 或 query 参数读取其余部分]` : text, display: `${Math.min(text.length, limit)} 字` };
  }
  function estimateText(text) { const chinese = (text.match(/[㐀-鿿]/g) || []).length; return chinese + Math.ceil((text.length - chinese) / 4); }
  function estimateTokens(messages) {
    let score = 0;
    for (const message of messages) {
      score += 4;
      if (typeof message.content === "string") { score += estimateText(message.content); continue; }
      // 图片和文件原件不能按 base64 长度折算，按固定值粗估
      for (const part of Array.isArray(message.content) ? message.content : []) score += part.type === "text" ? estimateText(String(part.text || "")) : part.type === "image_url" ? 1000 : part.type === "file" ? 2000 : 0;
    }
    return Math.max(1, Math.ceil(score));
  }
  function parseTokenLimit(value) { const text = String(value ?? "").trim().toLowerCase(); const match = text.match(/^(\d+(?:\.\d+)?)\s*([kme])?$/); if (!match) return null; const amount = Number(match[1]), unit = match[2] || "k", multiplier = unit === "e" ? 100000000 : unit === "m" ? 1000000 : 1000; return Number.isFinite(amount) && amount > 0 ? Math.round(amount * multiplier) : null; }
  function quotaExhausted(profile) { const cap = parseTokenLimit(profile?.quota); return cap !== null && cap > 0 && Number(profile?.usedTokens || 0) >= cap; }
  function formatTokens(value) { const n = Math.max(0, Math.round(Number(value) || 0)); const compact = (amount, unit) => `${Number(amount.toFixed(amount >= 10 ? 0 : 1))}${unit}`; return n >= 100000000 ? compact(n/100000000,"e") : n >= 1000000 ? compact(n/1000000,"m") : n >= 1000 ? compact(n/1000,"k") : String(n); }
  async function requestChat(profile, messages, signal, overrides = {}) {
    const parameters = { messages, systemPrompt: overrides.systemPrompt ?? (profile.systemPrompt || ""), temperature: Number(overrides.temperature ?? profile.temperature ?? .7), maxTokens: Number(overrides.maxTokens ?? profile.maxTokens ?? DEFAULT_MAX_TOKENS) };
    const extras = { ...(overrides.tools ? { tools: overrides.tools } : {}), ...(overrides.enableSearch ? { enable_search: true } : {}) };
    if (apiBase !== null) return fetch(`${apiBase}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: profileForRequest(profile), ...parameters, ...extras }), signal });
    if (profile.source === "server") throw Error("本机模型桥接未启动");
    return fetch(completionEndpoint(profile.baseUrl), { method: "POST", headers: directHeaders(profile), body: JSON.stringify({ model: profile.model, messages: parameters.systemPrompt ? [{ role: "system", content: parameters.systemPrompt }, ...messages] : messages, stream: true, stream_options: { include_usage: true }, temperature: parameters.temperature, max_tokens: parameters.maxTokens, ...extras }), signal });
  }
  function completionEndpoint(baseUrl) { const url = String(baseUrl || "").trim().replace(/\/$/, ""); if (!/^https?:\/\//i.test(url)) throw Error("Base URL 只支持 http 或 https"); return /\/chat\/completions$/i.test(url) ? url : `${url}/chat/completions`; }
  function modelsEndpoint(baseUrl) { const url = new URL(String(baseUrl || "").trim()); url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "")}/models`; return url.href; }
  function directHeaders(profile) { return { "Content-Type": "application/json; charset=utf-8", ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}) }; }
  function profileForRequest(profile) { return profile.source === "server" ? { source: "server" } : { source: "custom", baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: profile.model }; }
  async function readSse(response, assistant) {
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = "", scheduled = false;
    const refresh = () => {
      if (scheduled) return; scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const block = document.querySelector(`[data-message="${assistant.id}"] .assistant-block`); if (!block) return;
        if (assistant.reasoning) {
          let details = block.querySelector(".reasoning");
          if (!details) { block.insertAdjacentHTML("afterbegin", reasoningHtml(assistant)); details = block.querySelector(".reasoning"); }
          details.querySelector(".reasoning-body").textContent = assistant.reasoning;
          if (assistant.content && !assistant.reasoningTouched && details.open) details.open = false;
        }
        if (!assistant.content) { if (!block.querySelector(".thinking")) block.insertAdjacentHTML("beforeend", `<div class="thinking">正在凝神</div>`); }
        else {
          let markdown = block.querySelector(".markdown");
          if (!markdown?.querySelector(".md-tail")) { block.querySelector(".thinking")?.remove(); markdown?.remove(); block.insertAdjacentHTML("beforeend", `<div class="markdown" data-cut="0"><div class="md-stable"></div><div class="md-tail"></div></div>`); markdown = block.querySelector(".markdown"); }
          // 已经收尾的段落只渲染一次追加进 md-stable，每帧只重绘最后一段，长回复不会越来越卡；已渲染位置记在 data-cut 上，跨工具轮次也不会重复
          let renderedCut = Number(markdown.dataset.cut || 0); const cut = stableCut(assistant.content);
          if (cut > renderedCut) { const stable = markdown.querySelector(".md-stable"); stable.insertAdjacentHTML("beforeend", renderMarkdown(assistant.content.slice(renderedCut, cut))); renderedCut = cut; markdown.dataset.cut = String(cut); void renderViz(stable); }
          suppressViz = true; try { markdown.querySelector(".md-tail").innerHTML = renderMarkdown(assistant.content.slice(renderedCut)); } finally { suppressViz = false; }
        }
        if (followBottom) scrollBottom();
      });
    };
    while (true) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue; const data = line.slice(5).trim(); if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data); const delta = json.choices?.[0]?.delta; const text = normalizeContent(delta?.content), reasoning = normalizeContent(delta?.reasoning_content ?? delta?.reasoning);
          if (reasoning) { assistant.reasoning = (assistant.reasoning || "") + reasoning; refresh(); }
          if (text) { assistant.content += text; refresh(); }
          if (Array.isArray(delta?.tool_calls)) for (const call of delta.tool_calls) { const slot = (assistant.toolCalls ||= [])[call.index ?? 0] ||= { id: "", name: "", arguments: "" }; if (call.id) slot.id = call.id; if (call.function?.name) slot.name += call.function.name; if (call.function?.arguments) slot.arguments += call.function.arguments; }
          if (json.usage) assistant.usage = json.usage;
        } catch {}
      }
      if (done) break;
    }
  }
  function normalizeContent(content) { if (typeof content === "string") return content; if (Array.isArray(content)) return content.map(part => part?.text || part?.content || "").join(""); return ""; }
  function extractContent(data) { return normalizeContent(data?.choices?.[0]?.message?.content); }
  function friendlyError(message) { if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return apiBase === null ? "浏览器无法直连该接口，通常是接口未开放 CORS。请在 VS Code 运行“言下：启动模型桥接”任务后重试。" : "本机桥接已经停止或无法访问。请重新运行 start.cmd 或 VS Code 的“言下：启动模型桥接”任务，并保持终端窗口开启。"; return String(message).slice(0,500); }
  function scrollBottom() { const el = $("#chatScroll"); if (!el || el.scrollHeight - el.scrollTop - el.clientHeight < 1) return; autoScrolling = true; el.scrollTo({ top: el.scrollHeight, behavior: "instant" }); }

  async function handleMessageAction(event) {
    const button = event.target.closest("[data-action]"); if (!button || controller) return;
    const c = currentConversation(); if (!c) return; const id = button.closest("[data-message]")?.dataset.message, index = c.messages.findIndex(m => m.id === id); if (index < 0) return;
    const message = c.messages[index];
    if (button.dataset.action === "copy") { await copyText(message.content); return toast("已复制"); }
    if (button.dataset.action === "cancel-edit") { editingMessageId = null; renderConversation(false); return; }
    if (button.dataset.action === "edit") {
      if (c.ended) return toast("本次对话已结束，不能再编辑");
      editingMessageId = message.id; renderConversation(false);
      requestAnimationFrame(() => { const input = document.querySelector(`[data-message="${message.id}"] .message-edit-input`); input?.focus(); input?.setSelectionRange(input.value.length,input.value.length); });
      return;
    }
    if (button.dataset.action === "save-edit") return saveEditedMessage(c, index, button.closest("[data-message]").querySelector(".message-edit-input").value);
    if (c.ended) return toast("本次对话已结束，请新建对话后继续");
    const userIndex = [...c.messages.slice(0,index)].map(m => m.role).lastIndexOf("user"); if (userIndex < 0) return;
    const profile = activeProfile(); if (!profile) return openSettings("models");
    if (parseTokenLimit(profile.quota) === null) return toast("请先为当前模型设置用量限制");
    if (quotaExhausted(profile)) return toast("模型额度已用尽，请调整额度或切换模型");
    const discarded = c.messages.slice(userIndex + 1); void deleteAttachments(attachmentIds(discarded));
    c.messages = c.messages.slice(0, userIndex + 1); const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name }; c.messages.push(assistant); saveStore(); renderConversation(); await streamReply(c, assistant, profile);
  }
  async function saveEditedMessage(conversation, index, value) {
    const text = value.trim(); if (!text) return toast("消息不能为空");
    const profile = activeProfile(); if (!profile) return openSettings("models");
    if (parseTokenLimit(profile.quota) === null) return toast("请先为当前模型设置用量限制");
    if (quotaExhausted(profile)) return toast("模型用量限制已达到，请调整限制或切换模型");
    const message = conversation.messages[index], discarded = conversation.messages.slice(index + 1); void deleteAttachments(attachmentIds(discarded)); message.content = text; conversation.messages = conversation.messages.slice(0,index + 1); conversation.updatedAt = now(); conversation.ended = false; if (index === 0 && conversation.titleAuto !== false) { conversation.title = titleFrom(text,message.attachments || []); conversation.titled = false; }
    editingMessageId = null; const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name }; conversation.messages.push(assistant); saveStore(); render(); await streamReply(conversation, assistant, profile);
  }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); } }

  function openSettings(tab = settingsTab) { settingsTab = tab; $("#settingsModal").classList.remove("hidden"); renderSettings(); }
  function closeSettings() { $("#settingsModal").classList.add("hidden"); render(); }
  function renderSettings() {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === settingsTab));
    const host = $("#settingsContent");
    if (settingsTab === "general") host.innerHTML = generalSettingsHtml();
    if (settingsTab === "appearance") host.innerHTML = appearanceSettingsHtml();
    if (settingsTab === "models") host.innerHTML = modelsSettingsHtml();
    bindSettingsEvents();
  }
  function generalSettingsHtml() { return `<h2>通用</h2><p class="settings-lead">所有对话与自定义配置都保存在此浏览器。</p><div class="setting-row"><div class="setting-copy"><strong>显示名称</strong><small>用于侧栏中的称呼</small></div><input id="settingName" class="field" value="${escapeHtml(store.settings.name)}"></div><div class="setting-row"><div class="setting-copy"><strong>自动拟题</strong><small>首次问答后请模型为对话拟一个短标题，会消耗少量额度；手动改过的标题不会被覆盖</small></div><div class="segmented"><button data-setting="autoTitle" data-value="true" class="${store.settings.autoTitle ? "active" : ""}">开</button><button data-setting="autoTitle" data-value="false" class="${store.settings.autoTitle ? "" : "active"}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>本机数据</strong><small>${store.conversations.length} 段对话 · ${store.library.length} 件卷宗 · ${storageSize()}</small></div><div class="setting-actions"><label class="check"><input id="exportFiles" type="checkbox">含附件原件</label><button id="exportData" class="outline-btn">导出备份</button><button id="importData" class="outline-btn">导入备份</button></div></div><div class="setting-row"><div class="setting-copy"><strong>清空所有对话</strong><small>模型配置、外观设置和卷宗会保留</small></div><button id="clearAll" class="danger-btn">清空对话</button></div>`; }
  function appearanceSettingsHtml() { const s = store.settings; return `<h2>外观</h2><p class="settings-lead">清简为骨，纸墨为意。</p>${segmentRow("主题","随系统或固定明暗","theme",[["light","亮"],["dark","暗"],["system","系统"]],s.theme)}${segmentRow("字体","正文与标题的气质","font",[["sans","无衬线"],["serif","衬线"],["mixed","混排"]],s.font)}${segmentRow("阅读宽度","长文的行宽","width",[[680,"窄"],[760,"适中"],[860,"宽"]],s.width)}<div class="setting-row"><div class="setting-copy"><strong>印色</strong><small>界面中的点睛之色</small></div><div class="segmented">${["#9b5540","#536d62","#5c6386","#75644f"].map(v => `<button data-setting="accent" data-value="${v}" class="${s.accent === v ? "active" : ""}" style="color:${v}">●</button>`).join("")}</div></div>`; }
  function segmentRow(title,desc,key,items,active) { return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><small>${desc}</small></div><div class="segmented">${items.map(([v,label]) => `<button data-setting="${key}" data-value="${v}" class="${String(active) === String(v) ? "active" : ""}">${label}</button>`).join("")}</div></div>`; }
  function modelsSettingsHtml() { const transport = apiBase !== null ? `本机桥接已连接${apiBase ? "（VS Code 预览模式）" : ""}，言下联网与模型请求转发均可用。` : "当前由浏览器直连模型；言下联网不可用。直接预览 HTML 时，可先启动“言下：启动模型桥接”，页面会在下次发送时自动重连。"; return `<h2>模型</h2><p class="settings-lead">可添加任意 OpenAI 兼容接口。API Key 只存于当前浏览器。${transport}</p>${bootstrap.configError ? `<div class="server-notice">${escapeHtml(bootstrap.configError)}</div>` : ""}<div id="profileList">${profiles().map(profileCardHtml).join("")}</div><button id="addProfile" class="outline-btn" style="width:100%;margin-top:4px">＋ 添加模型配置</button>`; }
  function quotaParts(value) { const match = String(value ?? "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([kme])?$/); return match ? { amount: match[1], unit: match[2] || "k" } : { amount: "", unit: "k" }; }
  function profileCardHtml(p) {
    const locked = p.source === "server", invalidQuota = parseTokenLimit(p.quota) === null, quota = quotaParts(p.quota), models = Array.isArray(p.modelList) ? p.modelList : [], listed = models.includes(p.model);
    const modelField = locked ? `<input class="field wide" value="${escapeHtml(p.model)}" disabled>` : `<div class="field-row">${models.length ? `<select class="field wide select" data-model-select>${models.map(m => `<option value="${escapeHtml(m)}"${m === p.model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}<option value="__custom__"${listed ? "" : " selected"}>手动输入…</option></select>` : ""}<input class="field wide${models.length && listed ? " hidden" : ""}" data-field="model" value="${escapeHtml(p.model)}" placeholder="如 gpt-4o-mini"><button class="outline-btn" data-profile-action="models" title="从接口的 /models 获取可用模型">${models.length ? "刷新" : "获取列表"}</button></div>`;
    const quotaField = `<div class="field-row"><input type="number" min="0" step="any" class="field wide" data-quota-amount value="${escapeHtml(quota.amount)}" placeholder="必填，如 100" ${invalidQuota ? `aria-invalid="true" style="border-color:var(--danger)"` : ""}><select class="field select" data-quota-unit>${[["k","千 (k)"],["m","百万 (m)"],["e","亿 (e)"]].map(([v,label]) => `<option value="${v}"${quota.unit === v ? " selected" : ""}>${label}</option>`).join("")}</select></div>`;
    return `<div class="profile-card" data-profile-card="${escapeHtml(p.id)}"><div class="profile-head"><strong>${escapeHtml(p.name)}</strong>${locked ? `<span class="profile-badge">服务端</span>` : ""}${p.id === store.settings.activeProfileId ? `<span class="profile-badge">默认</span>` : ""}</div><div class="profile-grid"><label>显示名称<input class="field wide" data-field="name" value="${escapeHtml(p.name)}" ${locked ? "disabled" : ""}></label><label>用量限制${quotaField}<small>必填。修改后从新额度开始计算。</small></label><label class="profile-full">Base URL<input class="field wide" data-field="baseUrl" value="${escapeHtml(p.baseUrl || "")}" placeholder="https://example.com/v1" ${locked ? "disabled" : ""}></label>${locked ? "" : `<label class="profile-full">API Key<input type="password" class="field wide" data-field="apiKey" value="${escapeHtml(p.apiKey || "")}" placeholder="sk-…" autocomplete="off"></label>`}<label class="profile-full">模型${modelField}${locked ? "" : `<small>填好 Base URL 与 API Key 后点「获取列表」即可下拉选择；接口不支持列表时可手动输入。</small>`}</label></div><details class="profile-advanced"${advancedOpen.has(p.id) ? " open" : ""}><summary>高级配置<small>temperature ${Number(p.temperature ?? .7)} · max_tokens ${Number(p.maxTokens || DEFAULT_MAX_TOKENS)}${p.tools === false ? " · 言下工具关" : apiBase !== null ? " · 言下联网就绪" : " · 言下联网待桥接"}${modelSearchEnabled(p) ? " · 接口原生联网开" : ""}${p.systemPrompt ? " · 已设 system prompt" : ""}</small></summary><div class="profile-grid"><label>言下联网与文档工具<div class="segmented" style="margin-top:4px"><button data-toggle-field="tools" data-value="true" class="${p.tools !== false ? "active" : ""}">开</button><button data-toggle-field="tools" data-value="false" class="${p.tools === false ? "active" : ""}">关</button></div><small>推荐开启。由言下执行 search_web / fetch_page 和 read_document；网页搜索需要本机桥接，接口需支持 function calling</small></label><label>接口原生联网（实验）<div class="segmented" style="margin-top:4px"><button data-toggle-field="enableSearch" data-value="true" class="${modelSearchEnabled(p) ? "active" : ""}">开</button><button data-toggle-field="enableSearch" data-value="false" class="${modelSearchEnabled(p) ? "" : "active"}">关</button></div><small>仅当接口文档明确支持时开启，只会附加 <code>enable_search: true</code>；普通 OpenAI 兼容服务通常会忽略它，不能替代上面的言下联网</small></label><label><code>temperature</code><input type="number" min="0" max="2" step="0.1" class="field wide" data-field="temperature" value="${Number(p.temperature ?? .7)}"><small>0–2，默认 0.7；越高越发散</small></label><label><code>max_tokens</code><input type="number" min="16" max="65536" class="field wide" data-field="maxTokens" value="${Number(p.maxTokens || DEFAULT_MAX_TOKENS)}"><small>单次回复的输出上限，默认 ${DEFAULT_MAX_TOKENS}</small></label><label class="profile-full"><code>system prompt</code><textarea class="field wide field-area" data-field="systemPrompt" placeholder="可选：规定模型的身份与回答方式">${escapeHtml(p.systemPrompt || "")}</textarea></label></div></details><div class="profile-actions"><button class="outline-btn" data-profile-action="test">测试连接</button>${p.id !== store.settings.activeProfileId ? `<button class="outline-btn" data-profile-action="default">设为默认</button>` : ""}${locked ? "" : `<button class="danger-btn" data-profile-action="delete">删除</button>`}<span class="profile-status">${invalidQuota ? "请先设置用量限制" : ""}</span></div></div>`;
  }
  function storageSize() { const bytes = new Blob([JSON.stringify(store)]).size; return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`; }
  function bindSettingsEvents() {
    $("#settingName")?.addEventListener("input", e => { store.settings.name = e.target.value || "访客"; saveStoreSoon(); });
    $("#exportData")?.addEventListener("click", () => exportData($("#exportFiles")?.checked));
    $("#importData")?.addEventListener("click", () => $("#importInput").click());
    $("#importInput").onchange = async e => { const [file] = e.target.files; e.target.value = ""; if (file) await importData(file); };
    $("#clearAll")?.addEventListener("click", async () => { if (!(await askConfirm({ title: "清空全部对话？", body: `${store.conversations.length} 段对话将被移除，无法撤销；模型配置、外观与卷宗会保留。`, ok: "清空" }))) return; void deleteAttachments(attachmentIds(store.conversations.flatMap(c => c.messages || []))); store.conversations = []; currentId = null; saveStore(); renderSettings(); toast("所有对话已清空"); });
    document.querySelectorAll("[data-setting]").forEach(button => button.onclick = () => { const key = button.dataset.setting, value = button.dataset.value; store.settings[key] = key === "width" ? Number(value) : key === "autoTitle" ? value === "true" : value; saveStore(); applyAppearance(); renderSettings(); });
    $("#addProfile")?.addEventListener("click", () => { const p = { id: uid(), source: "custom", name: "新模型", model: "", baseUrl: "", apiKey: "", temperature: .7, maxTokens: DEFAULT_MAX_TOKENS, quota: "", usedTokens: 0, systemPrompt: "" }; store.profiles.push(p); store.settings.activeProfileId ||= p.id; saveStore(); renderSettings(); setTimeout(() => document.querySelector(`[data-profile-card="${p.id}"] [data-field="name"]`)?.focus(),0); });
    document.querySelectorAll("[data-profile-card]").forEach(card => {
      const p = profiles().find(item => item.id === card.dataset.profileCard); if (!p) return;
      card.querySelector('[data-profile-action="test"]')?.insertAdjacentHTML("afterend", '<button class="outline-btn" data-profile-action="search">测试联网</button>');
      card.querySelectorAll("[data-field]").forEach(input => input.addEventListener("input", e => {
        const field = e.target.dataset.field;
        if (p.source === "server" && !["temperature","maxTokens","systemPrompt"].includes(field)) return;
        p[field] = ["temperature","maxTokens","usedTokens"].includes(field) ? Number(e.target.value) : e.target.value;
        persistServerProfile(p); saveStoreSoon();
      }));
      const amount = card.querySelector("[data-quota-amount]"), unit = card.querySelector("[data-quota-unit]");
      const applyQuota = () => {
        const value = amount.value.trim() ? `${amount.value.trim()}${unit.value}` : "", valid = parseTokenLimit(value) !== null;
        amount.toggleAttribute("aria-invalid", !valid); amount.style.borderColor = valid ? "" : "var(--danger)"; card.querySelector(".profile-status").textContent = valid ? "" : "请填写大于 0 的数值";
        if (!valid) return;
        if (p.quota !== value) { p.quota = value; p.usedTokens = 0; persistServerProfile(p); saveStoreSoon(); if (p.id === store.settings.activeProfileId) renderQuota(); }
      };
      amount.addEventListener("input", applyQuota); unit.addEventListener("change", applyQuota);
      card.querySelector("[data-model-select]")?.addEventListener("change", e => {
        const input = card.querySelector('[data-field="model"]');
        if (e.target.value === "__custom__") { input.classList.remove("hidden"); input.focus(); return; }
        input.classList.add("hidden"); input.value = e.target.value; p.model = e.target.value; saveStoreSoon(); renderHeader();
      });
      card.querySelectorAll("[data-toggle-field]").forEach(button => button.onclick = () => { p[button.dataset.toggleField] = button.dataset.value === "true"; saveStore(); renderSettings(); });
      card.querySelector(".profile-advanced")?.addEventListener("toggle", e => { if (e.target.open) advancedOpen.add(p.id); else advancedOpen.delete(p.id); });
      card.querySelectorAll("[data-profile-action]").forEach(button => button.onclick = () => handleProfileAction(p, button.dataset.profileAction, card));
    });
  }
  async function handleProfileAction(profile, action, card) {
    if (action === "default") { selectProfile(profile.id, false); renderSettings(); renderHeader(); return; }
    if (action === "delete") { store.profiles = store.profiles.filter(p => p.id !== profile.id); if (store.settings.activeProfileId === profile.id) store.settings.activeProfileId = profiles().find(p => p.id !== profile.id)?.id || ""; saveStore(); renderSettings(); renderHeader(); return; }
    if (action === "models") {
      const status = card.querySelector(".profile-status"); status.textContent = "获取中…";
      try {
        const models = await fetchModelList(profile);
        if (!models.length) throw Error("接口没有返回模型列表，请手动输入模型 ID");
        profile.modelList = models; if (!models.includes(profile.model)) profile.model = models[0];
        saveStore(); renderSettings(); renderHeader(); card = document.querySelector(`[data-profile-card="${profile.id}"]`); if (card) card.querySelector(".profile-status").textContent = `已获取 ${models.length} 个模型`;
      } catch (error) { status.textContent = friendlyError(error.message); }
      return;
    }
    if (action === "search") {
      let status = card.querySelector(".profile-status"); status.textContent = "检索中…";
      try {
        if (apiBase === null && !(await ensureLocalBridge())) throw Error("未连接本机桥接；请先运行“言下：启动模型桥接”任务");
        card = document.querySelector(`[data-profile-card="${profile.id}"]`) || card;
        status = card.querySelector(".profile-status"); status.textContent = "检索中…";
        const data = await bridge("/api/search", { query: "OpenAI", count: 1 }, AbortSignal.timeout(20000));
        status.textContent = data.results?.length ? `言下联网可用 · ${data.results.length} 条结果` : "搜索服务已连接，但本次没有结果";
      } catch (error) { status.textContent = friendlyError(error.message); }
      return;
    }
    if (action === "test") {
      let status = card.querySelector(".profile-status"); status.textContent = "连接中…";
      try {
        if (apiBase === null) await ensureLocalBridge();
        card = document.querySelector(`[data-profile-card="${profile.id}"]`) || card; status = card.querySelector(".profile-status"); status.textContent = "连接中…";
        const started = performance.now();
        const response = apiBase !== null
          ? await fetch(`${apiBase}/api/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: profileForRequest(profile) }) })
          : await fetch(modelsEndpoint(profile.baseUrl), { headers: directHeaders(profile) });
        const type = response.headers.get("content-type") || "";
        const data = type.includes("application/json") ? await response.json() : {};
        if (!response.ok) throw Error(data.error || data.message || `连接失败（${response.status}）`);
        status.textContent = `可用 · ${Math.round(performance.now() - started)} ms`;
      }
      catch (error) { status.textContent = friendlyError(error.message); }
    }
  }
  async function fetchModelList(profile) {
    if (!String(profile.baseUrl || "").trim()) throw Error("请先填写 Base URL");
    if (apiBase === null) await ensureLocalBridge();
    let response, data;
    if (apiBase !== null) { response = await fetch(`${apiBase}/api/models`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: profileForRequest(profile) }) }); data = await response.json().catch(() => ({})); if (!response.ok) throw Error(data.error || `请求失败（${response.status}）`); return [...new Set(data.models || [])].sort(); }
    response = await fetch(modelsEndpoint(profile.baseUrl), { headers: directHeaders(profile) }); data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error?.message || data.message || `请求失败（${response.status}）`);
    return [...new Set((Array.isArray(data.data) ? data.data : []).map(item => typeof item === "string" ? item : item?.id).filter(Boolean))].sort();
  }
  async function exportData(includeFiles) {
    const safeStore = { ...store, profiles: store.profiles.map(profile => ({ ...profile, apiKey: "" })), exportedAt: now() };
    if (includeFiles) { try { safeStore.attachments = await fileStoreRequest("readonly", db => db.getAll()); } catch { toast("附件原件读取失败，本次备份不含附件"); } }
    const blob = new Blob([JSON.stringify(safeStore, null, includeFiles ? 0 : 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `言下备份-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`备份已导出${safeStore.attachments ? `（含 ${safeStore.attachments.length} 件附件原件）` : ""}，API Key 未包含在内`);
  }
  // 导入采用合并策略：按 id 跳过已存在的对话 / 模型 / 卷宗，附件原件只在本机缺失时写入
  async function importData(file) {
    try {
      const data = JSON.parse(await readFile(file, "text"));
      if (!data || data.version !== 1 || !Array.isArray(data.conversations)) throw Error("不是言下的备份文件");
      const known = new Set(store.conversations.map(c => c.id)); let conversations = 0, added = 0, library = 0, files = 0;
      for (const c of data.conversations) if (c?.id && !known.has(c.id) && Array.isArray(c.messages)) { store.conversations.push(c); conversations += 1; }
      const profileIds = new Set(profiles().map(p => p.id));
      for (const p of Array.isArray(data.profiles) ? data.profiles : []) if (p?.id && p.source !== "server" && !profileIds.has(p.id)) { store.profiles.push({ ...p, apiKey: p.apiKey || "" }); added += 1; }
      const libraryIds = new Set(store.library.map(f => f.id));
      for (const f of Array.isArray(data.library) ? data.library : []) if (f?.id && !libraryIds.has(f.id)) { store.library.push(f); library += 1; }
      for (const record of Array.isArray(data.attachments) ? data.attachments : []) if (record?.id && record.data !== undefined && !(await getAttachment(record.id))) { await putAttachment(record); files += 1; }
      if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
      saveStore(); render(); renderSettings();
      toast(`已导入 ${conversations} 段对话、${added} 个模型、${library} 件卷宗${files ? `，恢复 ${files} 件附件原件` : ""}${data.attachments ? "" : "；备份不含附件原件，旧附件将显示为不可用"}`);
    } catch (error) { toast(`导入失败：${String(error.message || error).slice(0,80)}`); }
  }

  boot();
})();
