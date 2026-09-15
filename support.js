(() => {
  "use strict";
  const STORAGE_KEY = "yan-chat-v1";
  const LOCAL_BRIDGE = "http://127.0.0.1:8787";
  const FILE_DB_NAME = "yan-chat-files-v1";
  const FILE_STORE_NAME = "attachments";
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_PENDING_BYTES = 8 * 1024 * 1024;
  const MAX_ATTACHMENTS_BYTES = 512 * 1024 * 1024;
  const MAX_EXTRACTED_CHARS = 300000;
  const HISTORY_TEXT_CHARS = 3000;
  const FOLLOW_THRESHOLD = 80;
  const DEFAULT_MAX_TOKENS = 8192;
  const MIN_TOOL_STATUS_MS = 240;
  const REVEAL_RATE = .16, FRESH_MS = 640; // 每帧写出积压字数的比例；新字渐显持续时间
  const $ = selector => document.querySelector(selector);
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = () => new Date().toISOString();
  const STORE_VERSION = 3;
  const NEW_DRAFT_ID = "__new__";
  const defaultStore = { version: STORE_VERSION, settings: { name: "访客", theme: "system", inkMotion: "on", font: "mixed", width: 760, accent: "#9b5540", activeProfileId: "", autoTitle: true, serverProfile: { temperature: .7, maxTokens: DEFAULT_MAX_TOKENS, systemPrompt: "", quota: "", usedTokens: 0 } }, profiles: [], conversations: [], library: [], drafts: {} };
  let store = loadStore();
  let bootstrap = { serverProfile: null, configError: "" };
  let apiBase = null;
  let currentId = null;
  let view = "chat";
  let editingMessageId = null;
  let renamingId = null;
  let historyQuery = "";
  let pendingAttachments = [];
  const requestJobs = new Map();
  let settingsTab = "general";
  let toastTimer = null;
  let fileDbPromise = null;
  let libraryQuery = "", libraryKind = "all";
  const advancedOpen = new Set();
  const vizCharts = new Set();
  let suppressViz = false;
  const mermaidSvgCache = new Map();
  let saveTimer = null, historySearchTimer = null;
  let bridgeRetryAt = 0;
  let followBottom = true, autoScrolling = false;
  const scrollPositions = new Map();
  let lastRenderedConvId = null, convergeTimer = null, themeFadeTimer = null;
  const messageRenderedIds = new Map(), knownStepIds = new Map();
  const thumbCache = new Map();
  let imageViewerAttachmentId = null, imageViewerReturnFocus = null;

  // 结构迁移按版本递增：老数据按字段补默认值，不清空；将来调整结构时在 migrateStoreVx 里写迁移
  function migrateStoreV1(data) { data.version = 2; /* v1 → v2 无结构变化，为后续迁移留位 */ }
  function migrateStoreV2(data) { data.drafts = {}; data.version = 3; }
  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || typeof parsed !== "object") return structuredClone(defaultStore);
      let data = parsed;
      if (!Number.isInteger(data.version)) data.version = 1;
      if (data.version === 1) migrateStoreV1(data);
      if (data.version === 2) migrateStoreV2(data);
      if (data.version > STORE_VERSION) data.version = STORE_VERSION;
      return { ...structuredClone(defaultStore), ...data, settings: { ...defaultStore.settings, ...(data.settings || {}), serverProfile: { ...defaultStore.settings.serverProfile, ...(data.settings?.serverProfile || {}) } }, profiles: Array.isArray(data.profiles) ? data.profiles : [], conversations: Array.isArray(data.conversations) ? data.conversations : [], library: Array.isArray(data.library) ? data.library : [], drafts: data.drafts && typeof data.drafts === "object" && !Array.isArray(data.drafts) ? data.drafts : {} };
    } catch { return structuredClone(defaultStore); }
  }
  function saveStore() {
    clearTimeout(saveTimer); saveTimer = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
    catch { toast("浏览器存储已满，导出备份后清理些旧对话"); }
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
  // 卷宗与对话附件原件合计占用（按 id 去重，同一原件记住两处只算一次）
  function usedAttachmentBytes() {
    const seen = new Map();
    const count = files => { for (const file of files || []) if (file?.id && !seen.has(file.id)) seen.set(file.id, Number(file.size || 0)); };
    count(store.library); for (const value of Object.values(store.drafts || {})) count(value?.attachments);
    for (const c of store.conversations) for (const m of c.messages || []) count(m.attachments);
    return [...seen.values()].reduce((a,b) => a+b, 0);
  }
  function isReferenced(id) { return pendingAttachments.some(file => file.id === id) || draftAttachmentIds().includes(id) || store.conversations.some(c => (c.messages || []).some(m => (m.attachments || []).some(file => file.id === id))); }
  // 已收入卷宗的原件由卷宗管理，删除对话或移除待发附件时不会删掉它
  async function deleteAttachments(ids) {
    // 调用方通常会在本轮同步代码里紧接着移除消息或草稿；等引用更新完再判断，既不误删共用原件，也不留下孤立数据。
    await Promise.resolve();
    await Promise.all([...new Set(ids)].filter(id => !inLibrary(id) && !isReferenced(id)).map(deleteAttachment));
  }
  async function cleanupAttachmentStore() {
    try {
      const keep = new Set([...attachmentIds(store.conversations.flatMap(c => c.messages || [])), ...store.library.map(file => file.id), ...draftAttachmentIds()]), keys = await fileStoreRequest("readonly", db => db.getAllKeys());
      await deleteAttachments(keys.filter(key => !keep.has(key)));
    } catch {}
  }
  function profiles() { return [...(bootstrap.serverProfile ? [bootstrap.serverProfile] : []), ...store.profiles]; }
  function activeProfile() { return profiles().find(p => p.id === store.settings.activeProfileId) || profiles()[0] || null; }
  function currentConversation() { return store.conversations.find(c => c.id === currentId) || null; }
  function draftKey(id = currentId) { return id || NEW_DRAFT_ID; }
  function draftRecord(id = currentId) {
    const value = store.drafts?.[draftKey(id)];
    if (typeof value === "string") return { text: value, attachments: [] };
    return value && typeof value === "object" ? { text: String(value.text || ""), attachments: Array.isArray(value.attachments) ? value.attachments : [] } : { text: "", attachments: [] };
  }
  function persistDraft() {
    const input = currentConversation() ? $("#chatInput") : $("#welcomeInput"), key = draftKey(), text = input?.value || "", attachments = pendingAttachments.map(file => ({ ...file }));
    store.drafts ||= {};
    if (text || attachments.length) store.drafts[key] = { text, attachments, updatedAt: now() }; else delete store.drafts[key];
    saveStoreSoon();
  }
  function restoreDraft() {
    if (view === "library") return;
    const draft = draftRecord(); pendingAttachments = draft.attachments.map(file => ({ ...file }));
    const input = currentConversation() ? $("#chatInput") : $("#welcomeInput"); if (!input) return;
    input.value = draft.text; grow(input);
  }
  function clearDraft(id = currentId) { store.drafts ||= {}; delete store.drafts[draftKey(id)]; }
  function draftAttachmentIds() { return Object.values(store.drafts || {}).flatMap(value => Array.isArray(value?.attachments) ? value.attachments : []).map(file => file?.id).filter(Boolean); }
  function persistServerProfile(p) { if (p.source === "server") store.settings.serverProfile = { temperature: p.temperature, maxTokens: p.maxTokens, systemPrompt: p.systemPrompt, quota: p.quota, usedTokens: p.usedTokens }; }
  function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function formatTime(value) { return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); }
  // 汉字数字：一、十二、二十三；2 单独出现时用「两」（如「两问」）
  const DIGITS = "〇一二三四五六七八九";
  function chineseNumber(n, twoAsLiang = false) { n = Math.max(0, Math.floor(Number(n) || 0)); if (n === 2 && twoAsLiang) return "两"; if (n < 10) return DIGITS[n]; if (n < 100) { const tens = Math.floor(n / 10), ones = n % 10; return `${tens > 1 ? DIGITS[tens] : ""}十${ones ? DIGITS[ones] : ""}`; } return String(n); }
  function formatDay(value) { const date = new Date(value), year = date.getFullYear(); return `${year !== new Date().getFullYear() ? `${[...String(year)].map(d => DIGITS[Number(d)]).join("")}年` : ""}${chineseNumber(date.getMonth() + 1)}月${chineseNumber(date.getDate())}日`; }
  function dayBucket(value) { const days = Math.floor((new Date().setHours(0,0,0,0) - new Date(value).setHours(0,0,0,0)) / 86400000); return days <= 0 ? "今天" : days < 7 ? "过去七天" : "更早"; }
  function toast(message) { const el = $("#toast"); el.textContent = message; showNow(el); clearTimeout(toastTimer); toastTimer = setTimeout(() => hideWithFade(el), 2200); }
  function setConnection(state, text) { $("#connection").dataset.state = state; $("#connectionText").textContent = text; }
  function requestJob(id = currentId) { return id ? requestJobs.get(id) || null : null; }
  function conversationRunning(id = currentId) { return !!requestJob(id); }
  function setJobLabel(conversation, job, label) { job.label = label; if (requestJobs.get(conversation.id) === job && currentId === conversation.id && view === "chat") setConnection("busy", label); }
  function refreshConnection() {
    const job = requestJob(); if (job) return setConnection("busy", job.label || "生成中");
    if (navigator.onLine === false) return setConnection("error", "连接中断");
    const conversation = currentConversation(), last = [...(conversation?.messages || [])].reverse().find(message => message.role === "assistant");
    if (last?.status === "error") return setConnection("error", "请求失败");
    if (last?.status === "interrupted") return setConnection("error", "连接中断");
    if (last?.status === "stopped") return setConnection("idle", "已停止");
    setConnection("idle", conversation?.ended ? "额度已尽" : "就绪");
  }
  function grow(el) { el.style.height = "auto"; el.style.height = `${Math.min(190, Math.max(44, el.scrollHeight))}px`; }
  function isMobile() { return innerWidth <= 760; }
  // 同风格的确认弹层，替代浏览器自带的 confirm()
  let confirmResolve = null;
  function askConfirm({ title, body = "", ok = "确定", danger = true }) {
    return new Promise(resolve => {
      settleConfirm(false); confirmResolve = resolve;
      $("#confirmTitle").textContent = title; $("#confirmBody").textContent = body;
      const button = $("#confirmOk"); button.textContent = ok; button.className = danger ? "danger-btn solid" : "outline-btn";
      showNow($("#confirmModal")); setTimeout(() => button.focus(), 0);
    });
  }
  function settleConfirm(value) { if (!confirmResolve) return; hideWithFade($("#confirmModal")); const resolve = confirmResolve; confirmResolve = null; resolve(value); }

  // ---------- 大体积库按需加载：mermaid / echarts / KaTeX / pdf.js 只在真正用到时才拉，首屏只带 marked + purify + hljs ----------
  const VENDOR = { pdf: { src: "./vendor/pdf.min.js", ready: () => window.pdfjsLib }, katex: { src: "./vendor/katex/katex.min.js", ready: () => window.katex }, mermaid: { src: "./vendor/mermaid.min.js", ready: () => window.mermaid }, echarts: { src: "./vendor/echarts.min.js", ready: () => window.echarts } };
  const vendorLoads = new Map();
  function ensureLib(name) {
    const lib = VENDOR[name]; if (!lib) return Promise.resolve(false); if (lib.ready()) return Promise.resolve(true);
    if (!vendorLoads.has(name)) vendorLoads.set(name, new Promise(resolve => {
      const script = document.createElement("script"); script.src = lib.src;
      script.onload = () => { if (name === "mermaid") setupMermaid(); resolve(!!lib.ready()); };
      script.onerror = () => { vendorLoads.delete(name); script.remove(); resolve(false); };
      document.head.append(script);
    }));
    return vendorLoads.get(name);
  }
  // 弹层与提示的收场：先淡出再 hidden，别硬切
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)"), touchInput = matchMedia("(hover: none) and (pointer: coarse)");
  const inkMotionOff = () => document.documentElement.dataset.inkMotion === "off";
  function showNow(el) { clearTimeout(el._leaveTimer); el.classList.remove("hidden", "leaving"); }
  function hideWithFade(el, duration = 170) { if (!el || el.classList.contains("hidden")) return; clearTimeout(el._leaveTimer); if (reducedMotion.matches) { el.classList.add("hidden"); return; } el.classList.add("leaving"); el._leaveTimer = setTimeout(() => { el.classList.remove("leaving"); el.classList.add("hidden"); }, duration); }
  function setProcessDetails(details, open, animate = true) {
    if (!details) return;
    if (details._motionAnimation && details._motionTarget === open) return;
    details._motionAnimation?.cancel(); details._motionAnimation = null; details._motionTarget = open;
    const body = details.querySelector(".reasoning-body, .tool-stack-body");
    details.classList.remove("is-closing");
    if (body) { body.style.removeProperty("overflow"); body.style.removeProperty("will-change"); }
    if (!body || !animate || inkMotionOff() || typeof body.animate !== "function") { details.open = open; details._motionTarget = undefined; return; }
    if (open && details.open) { details._motionTarget = undefined; return; }
    if (!open && !details.open) { details._motionTarget = undefined; return; }
    if (open) details.open = true; else details.classList.add("is-closing");
    const height = Math.max(1, body.getBoundingClientRect().height);
    body.style.overflow = "hidden"; body.style.willChange = "height, opacity, transform";
    const frames = open
      ? [{ height: "0px", opacity: 0, transform: "translateY(-5px)" }, { height: `${height}px`, opacity: 1, transform: "translateY(0)" }]
      : [{ height: `${height}px`, opacity: 1, transform: "translateY(0)" }, { height: "0px", opacity: 0, transform: "translateY(-5px)" }];
    const animation = body.animate(frames, { duration: open ? 420 : 380, easing: "cubic-bezier(.22,.72,.2,1)", fill: "both" });
    details._motionAnimation = animation;
    animation.onfinish = () => {
      if (details._motionAnimation !== animation) return;
      if (!open) details.open = false;
      details.classList.remove("is-closing"); body.style.removeProperty("overflow"); body.style.removeProperty("will-change");
      animation.cancel(); details._motionAnimation = null; details._motionTarget = undefined;
    };
  }

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
    // KaTeX 未加载时先放一个占位，库到位后由 renderPendingMath 就地替换；流式尾段每帧重绘，加载完成后自然变成正式渲染
    if (!window.katex) { void ensureLib("katex"); return `<span class="math-pending" data-tex="${escapeHtml(tex)}" data-display="${display ? "1" : "0"}"><code>${escapeHtml(tex)}</code></span>`; }
    try { return window.katex ? katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" }) : `<code>${escapeHtml(tex)}</code>`; }
    catch { return `<code>${escapeHtml(tex)}</code>`; }
  }
  function codeBlockHtml(text, lang) {
    const language = String(lang || "").trim().split(/\s+/)[0].toLowerCase(), known = !!(window.hljs && language && hljs.getLanguage(language));
    const htmlApp = ["html","interactive","app"].includes(language);
    // mermaid / echarts 代码块在页内直接出图；流式尾段尚未闭合时显示轻量成图状态
    if (suppressViz && (htmlApp || language === "mermaid" || language === "echarts")) return `<div class="viz viz-pending" data-viz-pending="${language}" role="status" aria-label="${htmlApp ? "交互内容仍在生成" : "图形仍在生成"}"><div class="code-head"><span class="code-lang">${language}</span><span class="viz-pending-signal" aria-hidden="true"></span></div><div class="viz-pending-body" aria-hidden="true"><span class="viz-pending-mark"></span></div></div>\n`;
    if (!suppressViz && (language === "mermaid" || language === "echarts")) return `<div class="viz" data-viz="${language}"><div class="code-head"><span class="code-lang">${language}</span><span><button type="button" class="code-copy" data-viz-toggle>源码</button><button type="button" class="code-copy" data-viz-download>下载</button><button type="button" class="code-copy" data-work-expand>全屏</button><button type="button" class="code-copy" data-copy-code>复制</button></span></div><div class="viz-canvas"></div><pre class="viz-source hidden"><code>${escapeHtml(text)}</code></pre></div>\n`;
    if (!suppressViz && htmlApp) return `<div class="html-app" data-html-app><div class="code-head"><span class="code-lang">html · 正在载入</span><span><button type="button" class="code-copy" data-app-toggle>源码</button><button type="button" class="code-copy" data-app-restart>重启</button><button type="button" class="code-copy" data-app-download>下载</button><button type="button" class="code-copy" data-work-expand>全屏</button><button type="button" class="code-copy" data-copy-code>复制</button></span></div><div class="html-app-stage"><span>正在载入交互内容</span></div><pre class="html-app-source hidden"><code>${escapeHtml(text)}</code></pre></div>\n`;
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
  // 模型给的 JSON 常有小滑头（尾逗号、注释、单引号、裸键名）；逐层尝试修补，实在补不上再抛原始错误
  const skipTrivia = (text, i) => {
    while (i < text.length) {
      const ch = text[i], next = text[i + 1];
      if (/\s/.test(ch)) i += 1;
      else if (ch === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i += 1; }
      else if (ch === "/" && next === "*") { i += 1; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1; i += 1; }
      else break;
    }
    return i;
  };
  function parseVizJson(source) {
    let error;
    try { return JSON.parse(source); } catch (err) { error = err; }
    // 单遍状态机：剥注释与尾逗号，字符串内部原样保留
    const strip = text => {
      let out = "", str = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i], next = text[i + 1];
        if (str) {
          if (ch === "\\") { out += ch + (next ?? ""); i += 1; }
          else if (ch === str) str = "";
          out += ch;
          continue;
        }
        if (ch === '"' || ch === "'") { str = ch; out += ch; continue; }
        if (ch === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i += 1; out += "\n"; continue; }
        if (ch === "/" && next === "*") { i += 1; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1; i += 1; continue; }
        if (ch === ",") {
          const j = skipTrivia(text, i + 1);
          if (text[j] === "}" || text[j] === "]") continue; // 尾逗号（后面即使隔着注释也算）
        }
        out += ch;
      }
      return out;
    };
    let attempt = strip(source);
    try { return JSON.parse(attempt); } catch {}
    const single = (source.match(/'/g) || []).length, double = (source.match(/"/g) || []).length;
    if (single > double) {
      attempt = attempt.replace(/'([^'\n]*)'/g, (_, body) => '"' + body.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');
      try { return JSON.parse(attempt); } catch {}
    }
    attempt = attempt.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
    try { return JSON.parse(attempt); } catch {}
    throw error;
  }
  // 渲染过的 mermaid SVG 按 消息+序号+内容哈希 缓存；整列重绘时同步回填，不再等二次渲染闪空白
  const vizKeyHash = text => { let h = 5381; for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0; return h.toString(36); };
  function rememberMermaidSvg(key, svg) { mermaidSvgCache.set(key, svg); if (mermaidSvgCache.size > 48) mermaidSvgCache.delete(mermaidSvgCache.keys().next().value); }
  function stabilizeMermaidSvg(canvas) {
    const svg = canvas.querySelector("svg"); if (!svg) return "";
    const font = cssVar("--body") || '"Microsoft YaHei UI",system-ui,sans-serif';
    svg.style.fontFamily = font; svg.style.fontSize = "14px"; svg.style.lineHeight = "1.5";
    // DOMPurify 会保留 foreignObject 的安全纯文字，但会剥掉 Mermaid 用来固定行高的 HTML 包装。
    // 将 Mermaid 计算节点时使用的 14px / 1.5 直接写回 SVG，避免正文的 1.85 行高把末行裁掉；内联样式也随下载保留。
    for (const label of svg.querySelectorAll("foreignObject")) { label.style.fontFamily = font; label.style.fontSize = "14px"; label.style.lineHeight = "1.5"; }
    return svg.outerHTML;
  }
  async function renderViz(root) {
    for (const el of root.querySelectorAll(".viz[data-viz]:not([data-rendered])")) {
      el.dataset.rendered = "1";
      const source = el.querySelector(".viz-source")?.textContent || "", canvas = el.querySelector(".viz-canvas");
      const viewport = followBottom ? null : scrollSnapshot();
      try {
        if (!(await ensureLib(el.dataset.viz))) throw Error("图形库未能加载，请刷新页面重试");
        if (el.dataset.viz === "mermaid") {
          const message = el.closest(".message"), siblings = message ? [...message.querySelectorAll(".viz[data-viz]")] : [el];
          const key = `${message?.dataset.message || "anon"}:${siblings.indexOf(el)}:${vizKeyHash(source)}`;
          const cached = mermaidSvgCache.get(key);
          if (cached) canvas.innerHTML = cached;
          else {
            const { svg } = await mermaid.render(`mmd${uid().replace(/[^a-z0-9]/gi, "")}`, source);
            const clean = window.DOMPurify ? DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject"], ADD_ATTR: ["dominant-baseline"] }) : "";
            canvas.innerHTML = clean; const stable = stabilizeMermaidSvg(canvas); if (!stable) throw Error("图形清洗后为空"); canvas.innerHTML = stable; rememberMermaidSvg(key, stable);
          }
        }
        else if (el.dataset.viz === "echarts") {
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
        if (followBottom) requestAnimationFrame(scrollBottom); else restoreScrollPosition(viewport);
      } catch (error) { el.classList.add("viz-error"); canvas.innerHTML = `<div class="viz-fail">无法渲染：${escapeHtml(String(error.message || error).split("\n")[0].slice(0, 200))}</div>`; el.querySelector(".viz-source")?.classList.remove("hidden"); if (viewport) restoreScrollPosition(viewport); }
    }
  }
  function htmlAppSource(el) { return el.querySelector(".html-app-source code")?.textContent || ""; }
  function sendHtmlApp(el) { const iframe = el.querySelector("iframe"), id = el.dataset.appId; if (iframe?.contentWindow && id) iframe.contentWindow.postMessage({ type: "yan-preview-render", id, html: htmlAppSource(el) }, "*"); }
  function mountHtmlApp(el) {
    const id = `app${uid().replace(/[^a-z0-9]/gi, "")}`; el.dataset.appId = id; el.dataset.rendered = "1";
    el.dataset.appState = "loading"; el.classList.remove("html-app-error"); const label = el.querySelector(".code-lang"); if (label) label.textContent = "html · 正在载入";
    const stage = el.querySelector(".html-app-stage"); stage.innerHTML = `<iframe sandbox="allow-scripts" title="隔离的 HTML 交互预览" src="./preview.html#${id}"></iframe>`;
    setTimeout(() => { if (!el.isConnected || el.dataset.appId !== id || el.dataset.appState !== "loading") return; el.dataset.appState = "error"; el.classList.add("html-app-error"); if (label) label.textContent = "html · 未能载入"; }, 6000);
  }
  function renderHtmlApps(root) { for (const el of root.querySelectorAll(".html-app[data-html-app]:not([data-rendered])")) mountHtmlApp(el); }
  async function renderPendingMath(root) {
    if (!root.querySelector(".math-pending") || !(await ensureLib("katex"))) return;
    for (const el of root.querySelectorAll(".math-pending")) { el.insertAdjacentHTML("afterend", window.DOMPurify ? DOMPurify.sanitize(renderMath(el.dataset.tex || "", el.dataset.display === "1"), PURIFY_OPTIONS) : ""); el.remove(); }
  }
  function renderEnhancements(root) { void renderViz(root); renderHtmlApps(root); void renderPendingMath(root); }
  function downloadHref(href, name, revoke = false) { const link = document.createElement("a"); link.href = href; link.download = name; link.click(); if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1000); }
  function downloadText(text, type, name) { downloadHref(URL.createObjectURL(new Blob([text], { type })), name, true); }
  function chartFor(canvas) { for (const chart of vizCharts) if (chart.getDom() === canvas) return chart; return null; }
  function downloadVisualization(el) {
    if (el.dataset.viz === "mermaid") { const svg = el.querySelector(".viz-canvas svg"); if (!svg) return toast("图形尚未完成"); return downloadText(new XMLSerializer().serializeToString(svg), "image/svg+xml;charset=utf-8", "言下图形.svg"); }
    const chart = chartFor(el.querySelector(".viz-canvas")); if (!chart) return toast("图表尚未完成");
    downloadHref(chart.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: cssVar("--paper") }), "言下图表.png");
  }
  function closeExpandedWork(except = null) {
    for (const item of document.querySelectorAll(".work-expanded")) if (item !== except) { item.classList.remove("work-expanded"); const trigger = item.querySelector("[data-work-expand]"); if (trigger) trigger.textContent = "全屏"; chartFor(item.querySelector(".viz-canvas"))?.resize(); }
    if (!except) document.documentElement.classList.remove("work-mode");
  }
  function toggleWorkExpanded(el, button) {
    const open = !el.classList.contains("work-expanded"); closeExpandedWork(open ? el : null); el.classList.toggle("work-expanded", open); button.textContent = open ? "收起" : "全屏"; document.documentElement.classList.toggle("work-mode", open);
    setTimeout(() => { if (el.matches(".viz")) chartFor(el.querySelector(".viz-canvas"))?.resize(); }, 40);
  }
  // ECharts 容器宽度跟随布局（收起侧栏、改阅读宽度等），不再只依赖 window resize
  let vizObserver = null;
  function setupVizObserver() {
    if (!("ResizeObserver" in window)) return;
    vizObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const canvas = entry.target, width = Math.round(entry.contentRect.width);
        if (Math.abs(width - Number(canvas.dataset.vizWidth || -1)) < 2) continue;
        canvas.dataset.vizWidth = String(width);
        if (!canvas.isConnected) continue;
        for (const chart of vizCharts) if (chart.getDom() === canvas) chart.resize();
      }
    });
  }
  function disposeOrphanCharts() { for (const chart of [...vizCharts]) { const dom = chart.getDom(); if (!dom?.isConnected) { vizObserver?.unobserve(dom); chart.dispose(); vizCharts.delete(chart); } } }
  function disposeChartsIn(root) { for (const chart of [...vizCharts]) { const dom = chart.getDom(); if (!dom?.isConnected || root?.contains(dom)) { vizObserver?.unobserve(dom); chart.dispose(); vizCharts.delete(chart); } } }
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
      toast("本机桥接已接上，可以联网了");
    }
    return connected;
  }
  function recoverInterruptedMessages() {
    let changed = false;
    for (const conversation of store.conversations) for (const message of conversation.messages || []) if (message.status === "streaming") {
      message.status = "interrupted"; message.error = "页面刷新或连接中断，已保留当前内容"; message.interruptedAt = now();
      for (const step of message.steps || []) if (step.status === "running") { step.status = "error"; step.result = "连接中断"; }
      changed = true;
    }
    if (changed) saveStore();
  }
  async function boot() {
    setupMarkdown(); setupMermaid(); setupVizObserver();
    const candidates = ["", LOCAL_BRIDGE].filter((value,index,array) => array.indexOf(value) === index);
    await connectBridge(candidates);
    if (apiBase === null) bootstrap.configError = "未检测到本机模型桥接，当前使用浏览器直连。接口若未开放 CORS，请在 VS Code 运行“言下：启动模型桥接”任务。";
    if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
    recoverInterruptedMessages();
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
    $("#modelTrigger").onclick = e => { e.stopPropagation(); const menu = $("#modelMenu"); if (menu.classList.contains("hidden")) showNow(menu); else hideWithFade(menu); renderModelMenu(); };
    document.addEventListener("click", () => hideWithFade($("#modelMenu")));
    $("#themeToggle").onclick = e => switchTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", e.currentTarget);
    window.addEventListener("resize", disposeOrphanCharts);
    $("#quotaStatus").onclick = () => openSettings("models");
    document.querySelectorAll(".send-trigger").forEach(button => button.onclick = sendOrStop);
    document.querySelectorAll(".attach-trigger").forEach(button => button.onclick = () => $("#fileInput").click());
    $("#confirmOk").onclick = () => settleConfirm(true);
    $("#confirmCancel").onclick = () => settleConfirm(false);
    $("#confirmModal").addEventListener("click", e => { if (e.target === $("#confirmModal")) settleConfirm(false); });
    $("#confirmModal").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); settleConfirm(true); } });
    $("#imageViewerClose").onclick = closeImageViewer;
    $("#imageViewerDownload").onclick = () => { if (imageViewerAttachmentId) void downloadAttachment(imageViewerAttachmentId); };
    $("#imageViewerZoom").onclick = toggleImageViewerZoom;
    $("#imageViewerStage").addEventListener("click", e => { if (e.target === $("#imageViewerImage")) toggleImageViewerZoom(); else if (e.target === $("#imageViewerStage")) closeImageViewer(); });
    const welcomeInput = $("#welcomeInput"), restPlaceholder = welcomeInput.placeholder;
    document.querySelectorAll(".suggestion").forEach(button => {
      const prompt = button.dataset.prompt || button.textContent;
      button.onclick = () => { welcomeInput.value = prompt; welcomeInput.placeholder = restPlaceholder; welcomeInput.classList.remove("previewing"); grow(welcomeInput); persistDraft(); welcomeInput.focus(); const start = prompt.indexOf("（"), end = start < 0 ? prompt.length : prompt.indexOf("）", start) + 1; welcomeInput.setSelectionRange(start < 0 ? prompt.length : start, end); };
      // 预览只占一行：取提示词首句并加省略号，不撑高输入框、不推挤按钮
      const preview = `${prompt.split(/\r?\n/)[0].slice(0, 60)}…`;
      button.addEventListener("pointerenter", () => { if (welcomeInput.value) return; welcomeInput.placeholder = preview; welcomeInput.classList.add("previewing"); });
      button.addEventListener("pointerleave", () => { if (welcomeInput.placeholder === preview) { welcomeInput.placeholder = restPlaceholder; welcomeInput.classList.remove("previewing"); } });
    });
    [$("#welcomeInput"), $("#chatInput")].forEach(input => {
      input.addEventListener("input", () => { grow(input); persistDraft(); renderSendButtons(); });
      input.addEventListener("keydown", e => { if (e.isComposing || e.keyCode === 229) return; if (e.key === "Enter" && !e.shiftKey && !touchInput.matches) { e.preventDefault(); sendOrStop(); } });
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
    $("#clearContext").onclick = () => { const c = currentConversation(); if (!c || conversationRunning() || !c.messages.length || c.messages.at(-1)?.role === "context") return; c.messages.push({ id: uid(), role: "context", timestamp: now() }); c.updatedAt = now(); saveStore(); renderConversation(true); toast("另起一纸，之前的话不再随问题送出"); };
    $("#historySearch").addEventListener("input", e => { historyQuery = e.target.value; clearTimeout(historySearchTimer); historySearchTimer = setTimeout(renderHistory, 120); });
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
      event.preventDefault();
      const details = summary.parentElement, id = details.closest("[data-message]")?.dataset.message;
      const message = currentConversation()?.messages.find(item => item.id === id); if (!message) return;
      const reasoning = details.classList.contains("reasoning");
      const nextOpen = details._motionAnimation ? !details._motionTarget : !details.open;
      message[reasoning ? "reasoningTouched" : "toolsTouched"] = true;
      message[reasoning ? "reasoningOpen" : "toolsOpen"] = nextOpen; saveStoreSoon();
      setProcessDetails(details, nextOpen);
    });
    document.addEventListener("click", e => {
      const copy = e.target.closest("[data-copy-code]");
      if (copy) { void copyText(copy.closest(".code-block, .viz, .html-app")?.querySelector("code")?.textContent || ""); copy.textContent = "已复制"; setTimeout(() => copy.textContent = "复制", 1200); return; }
      const vizToggle = e.target.closest("[data-viz-toggle]");
      if (vizToggle) { const viz = vizToggle.closest(".viz"), source = viz.querySelector(".viz-source"), showSource = source.classList.contains("hidden"); source.classList.toggle("hidden", !showSource); viz.querySelector(".viz-canvas").classList.toggle("hidden", showSource); vizToggle.textContent = showSource ? "图形" : "源码"; return; }
      const vizDownload = e.target.closest("[data-viz-download]"); if (vizDownload) { downloadVisualization(vizDownload.closest(".viz")); return; }
      const appToggle = e.target.closest("[data-app-toggle]");
      if (appToggle) { const app = appToggle.closest(".html-app"), source = app.querySelector(".html-app-source"), showSource = source.classList.contains("hidden"); source.classList.toggle("hidden", !showSource); app.querySelector(".html-app-stage").classList.toggle("hidden", showSource); appToggle.textContent = showSource ? "预览" : "源码"; return; }
      const appRestart = e.target.closest("[data-app-restart]"); if (appRestart) { mountHtmlApp(appRestart.closest(".html-app")); return; }
      const appDownload = e.target.closest("[data-app-download]"); if (appDownload) { downloadText(htmlAppSource(appDownload.closest(".html-app")), "text/html;charset=utf-8", "言下交互作品.html"); return; }
      const expand = e.target.closest("[data-work-expand]"); if (expand) { toggleWorkExpanded(expand.closest(".viz, .html-app"), expand); return; }
      const remove = e.target.closest("[data-remove-attachment]");
      if (remove) { const [file] = pendingAttachments.splice(Number(remove.dataset.removeAttachment), 1); persistDraft(); void deleteAttachments([file?.id]); renderAttachments(); return; }
      const save = e.target.closest("[data-save-attachment]"); if (save) { void saveToLibrary(save.dataset.saveAttachment); return; }
      const preview = e.target.closest("[data-open-image]"); if (preview) { void openImageViewer(preview.dataset.openImage, preview); return; }
      const download = e.target.closest("[data-download-attachment]"); if (download) void downloadAttachment(download.dataset.downloadAttachment);
    });
    document.addEventListener("keydown", e => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.matches?.("[data-open-image]")) { e.preventDefault(); void openImageViewer(e.target.dataset.openImage, e.target); }
      else if (e.target.matches?.("[data-download-attachment]")) { e.preventDefault(); void downloadAttachment(e.target.dataset.downloadAttachment); }
    });
    document.querySelectorAll(".tab-btn").forEach(button => button.onclick = () => { settingsTab = button.dataset.tab; renderSettings(); });
    window.addEventListener("keydown", e => { if (e.key !== "Escape") return; if (!$("#imageViewer").classList.contains("hidden")) { closeImageViewer(); return; } const expanded = document.querySelector(".work-expanded"); if (expanded) { closeExpandedWork(); return; } hideWithFade($("#modelMenu")); if (confirmResolve) settleConfirm(false); else if (!$("#settingsModal").classList.contains("hidden")) closeSettings(); else if (editingMessageId) { editingMessageId = null; renderConversation(false); } });
    $("#chatScroll").addEventListener("scroll", () => { const el = $("#chatScroll"), gap = el.scrollHeight - el.scrollTop - el.clientHeight; if (gap < 8) { followBottom = true; autoScrolling = false; } else if (!autoScrolling && gap > FOLLOW_THRESHOLD) followBottom = false; syncJumpBottom(gap); });
    $("#chatScroll").addEventListener("wheel", e => { if (e.deltaY < 0) followBottom = false; }, { passive: true });
    $("#chatScroll").addEventListener("pointerdown", () => { autoScrolling = false; }, { passive: true });
    window.addEventListener("pagehide", () => { persistDraft(); saveStore(); });
    window.addEventListener("offline", () => setConnection("error", "连接中断"));
    window.addEventListener("online", refreshConnection);
    window.addEventListener("message", event => {
      const data = event.data; if (!data || !["yan-preview-ready","yan-preview-state"].includes(data.type)) return;
      const app = [...document.querySelectorAll(".html-app[data-app-id]")].find(el => el.dataset.appId === data.id && el.querySelector("iframe")?.contentWindow === event.source); if (!app) return;
      if (data.type === "yan-preview-ready") return sendHtmlApp(app);
      app.dataset.appState = data.state; app.classList.toggle("html-app-error", data.state === "error"); const label = app.querySelector(".code-lang"); if (label) { label.textContent = data.state === "error" ? "html · 运行有误" : "html · 可交互"; label.title = data.detail || ""; }
      if (data.state === "ready" && followBottom) requestAnimationFrame(scrollBottom);
    });
    let wasMobile = isMobile();
    window.addEventListener("resize", () => { const mobile = isMobile(); if (mobile && !wasMobile) toggleSidebar(true); wasMobile = mobile; syncScrim(); });
    $("#sidebarScrim").onclick = () => toggleSidebar(true);
    // 生成时向上翻阅后，给一枚「回到最新」；贴近底部自动隐去
    $("#jumpBottom").onclick = () => { const el = $("#chatScroll"); followBottom = true; el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion.matches ? "instant" : "smooth" }); };
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (store.settings.theme === "system") { applyAppearance(); if (view === "chat" && !conversationRunning()) renderConversation(false); } });
    reducedMotion.addEventListener?.("change", () => { if (store.settings.inkMotion === "system") applyAppearance(); });
  }

  function syncScrim() { $("#sidebarScrim").classList.toggle("hidden", !isMobile() || $("#sidebar").classList.contains("collapsed")); }
  function toggleSidebar(force) { const sidebar = $("#sidebar"), collapsed = force ?? !sidebar.classList.contains("collapsed"); sidebar.classList.toggle("collapsed", collapsed); syncScrim(); const button = $("#collapseSidebar"); button.textContent = collapsed ? "›" : "‹"; button.title = collapsed ? "展开侧栏" : "收起侧栏"; }
  function toggleHistorySearch(force) { const wrap = $("#historySearchWrap"), show = force ?? wrap.classList.contains("hidden"); wrap.classList.toggle("hidden", !show); $("#historySearchToggle").classList.toggle("active", show); if (show) setTimeout(() => $("#historySearch").focus(), 0); else { clearTimeout(historySearchTimer); if (historyQuery) { historyQuery = ""; $("#historySearch").value = ""; renderHistory(); } } }
  function newChat() { persistDraft(); rememberScrollPosition(); pendingAttachments = []; currentId = null; editingMessageId = null; view = "chat"; render(); setTimeout(() => $("#welcomeInput").focus(), 0); if (isMobile()) toggleSidebar(true); }
  function openConversation(id) { if (id !== currentId) { persistDraft(); rememberScrollPosition(); pendingAttachments = []; } currentId = id; editingMessageId = null; view = "chat"; const c = currentConversation(); if (c) { c.unread = false; c.profileId && selectProfile(c.profileId, false); } render(); if (isMobile()) toggleSidebar(true); }
  async function deleteConversation(id) { const removed = store.conversations.find(c => c.id === id); if (!removed) return; if (!(await askConfirm({ title: "删除这段对话？", body: `「${removed.title}」将连同其附件一起移除，无法撤销。`, ok: "删除" }))) return; if (conversationRunning(id)) stopGeneration(id); const draftFiles = draftRecord(id).attachments.map(file => file.id); clearDraft(id); void deleteAttachments([...attachmentIds(removed.messages), ...draftFiles]); store.conversations = store.conversations.filter(c => c.id !== id); if (currentId === id) { currentId = null; pendingAttachments = []; } saveStore(); render(); toast("对话已删除"); }
  function togglePin(id) { const c = store.conversations.find(item => item.id === id); if (!c) return; c.pinned = !c.pinned; saveStore(); renderHistory(); }
  function startRename(id) { renamingId = id; renderHistory(); }
  function commitRename(value) { const id = renamingId; renamingId = null; if (id) renameConversation(id, value); else renderHistory(); }
  function renameConversation(id, value) {
    const c = store.conversations.find(item => item.id === id), title = String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (c && title && title !== c.title) { c.title = title; c.titleAuto = false; saveStore(); }
    renderHistory(); if (c && currentId === id) { $("#chatTitle").textContent = c.title; syncDocumentTitle(); }
  }
  function selectProfile(id, shouldRender = true) { if (!profiles().some(p => p.id === id)) return; store.settings.activeProfileId = id; const c = currentConversation(); if (c) c.profileId = id; saveStore(); hideWithFade($("#modelMenu")); if (shouldRender) renderHeader(); }

  function syncJumpBottom(gap) { const el = $("#chatScroll"); if (gap === undefined) gap = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0; $("#jumpBottom").classList.toggle("hidden", view !== "chat" || !currentId || gap < 260); }
  function syncDocumentTitle() { const c = currentConversation(); document.title = view === "library" ? "卷宗 · 言下" : c ? `${c.title} · 言下` : "言下"; }
  function render(shouldScroll = false) {
    renderHeader(); renderHistory(); syncDocumentTitle(); requestAnimationFrame(() => syncJumpBottom());
    const c = currentConversation(), library = view === "library";
    $("#library").classList.toggle("hidden", !library);
    $("#welcome").classList.toggle("hidden", library || !!c);
    $("#chat").classList.toggle("hidden", library || !c);
    $("#composerArea").classList.toggle("hidden", library || !c);
    $("#openLibrary").classList.toggle("active", library);
    if (library) renderLibrary(); else if (c) renderConversation(shouldScroll);
    restoreDraft(); renderAttachments(); renderSendButtons();
  }
  function renderHeader() {
    const p = activeProfile(); $("#activeModelName").textContent = p?.name || "尚未配置模型"; $("#welcomeModel").textContent = p?.name || "尚未配置模型";
    $("#displayNameSidebar").textContent = store.settings.name; $("#avatar").textContent = store.settings.name.trim().slice(0,1) || "客"; $("#themeToggle").textContent = document.documentElement.dataset.theme === "dark" ? "☾" : "☀";
    $("#greeting").textContent = greeting(); renderQuota(); renderModelMenu(); renderLibraryCount(); refreshConnection();
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
    if (all.length) $("#modelMenu").insertAdjacentHTML("beforeend", `<button class="model-option model-manage" data-manage>管理模型…</button>`);
    $("#configureFirst")?.addEventListener("click", () => openSettings("models"));
    $("#modelMenu [data-manage]")?.addEventListener("click", e => { e.stopPropagation(); hideWithFade($("#modelMenu")); openSettings("models"); });
  }
  function renderHistory() {
    const query = historyQuery.trim().toLowerCase();
    const matches = c => !query || String(c.title).toLowerCase().includes(query) || (c.messages || []).some(m => typeof m.content === "string" && m.content.toLowerCase().includes(query));
    const groups = new Map([["置顶", []], ["今天", []], ["过去七天", []], ["更早", []]]);
    [...store.conversations].filter(matches).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).forEach(c => groups.get(c.pinned ? "置顶" : dayBucket(c.updatedAt)).push(c));
    const item = c => {
      if (renamingId === c.id) return `<div class="history-item active" data-conversation="${escapeHtml(c.id)}"><input class="history-rename" value="${escapeHtml(c.title)}" maxlength="60" aria-label="重命名对话"></div>`;
      const running = conversationRunning(c.id), state = running ? `<span class="history-state running" title="后台生成中" aria-label="后台生成中"></span>` : c.unread ? `<span class="history-state unread" title="有新回复" aria-label="有新回复"></span>` : "";
      return `<div class="history-item ${c.id === currentId ? "active" : ""} ${running ? "is-running" : ""} ${c.unread ? "has-unread" : ""}" data-conversation="${escapeHtml(c.id)}"><button class="history-open" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>${state}<span class="history-tools"><button class="history-tool" data-history-action="pin" title="${c.pinned ? "取消置顶" : "置顶"}">${c.pinned ? "松" : "钉"}</button><button class="history-tool" data-history-action="rename" title="重命名">改</button><button class="history-tool history-delete" data-history-action="delete" title="删除">×</button></span></div>`;
    };
    $("#history").innerHTML = [...groups].filter(([,items]) => items.length).map(([label,items]) => `<div class="history-group"><div class="history-label">${label}</div>${items.map(item).join("")}</div>`).join("") || `<div style="padding:10px;color:var(--ink-3);font:12px/1.7 var(--title)">${query ? "没有匹配的对话。" : "尚无旧墨"}</div>`;
    const input = $("#history .history-rename"); if (input) { input.focus(); input.select(); }
  }
  function scrollSnapshot() {
    const host = $("#chatScroll"); if (!host || !currentId || view !== "chat") return null;
    const hostTop = host.getBoundingClientRect().top, anchor = [...host.querySelectorAll("#messages [data-message]")].find(node => node.getBoundingClientRect().bottom > hostTop + 1);
    return { top: host.scrollTop, gap: Math.max(0, host.scrollHeight - host.scrollTop - host.clientHeight), follow: followBottom, anchorId: anchor?.dataset.message || "", anchorOffset: anchor ? anchor.getBoundingClientRect().top - hostTop : 0 };
  }
  function rememberScrollPosition() { const snapshot = scrollSnapshot(); if (snapshot && currentId) scrollPositions.set(currentId, snapshot); }
  function restoreScrollPosition(snapshot) {
    const host = $("#chatScroll"); if (!host || !snapshot) return;
    followBottom = !!snapshot.follow;
    const anchor = snapshot.anchorId ? host.querySelector(`[data-message="${CSS.escape(snapshot.anchorId)}"]`) : null;
    if (anchor) host.scrollTop += anchor.getBoundingClientRect().top - host.getBoundingClientRect().top - snapshot.anchorOffset;
    else host.scrollTop = Math.min(snapshot.top, Math.max(0, host.scrollHeight - host.clientHeight));
  }
  function renderConversation(shouldScroll = false) {
    const c = currentConversation(); if (!c) return;
    const snapshot = c.id === lastRenderedConvId ? scrollSnapshot() : scrollPositions.get(c.id);
    $("#chatTitle").textContent = c.title; $("#chatMeta").textContent = `${formatDay(c.createdAt)} · ${chineseNumber(c.messages.filter(m => m.role === "user").length, true)}问`;
    const scrollHost = $("#chatScroll");
    scrollHost.classList.toggle("generating", c.messages.some(message => message.status === "streaming"));
    // 切换对话时整列淡入（带轻微交错）；流式结束、主题切换等原地重绘则保持安静
    const converged = c.id !== lastRenderedConvId; lastRenderedConvId = c.id;
    scrollHost.classList.remove("converge");
    closeExpandedWork(); disposeChartsIn($("#messages"));
    $("#messages").innerHTML = c.messages.map(renderMessage).join("") + (c.ended ? `<div class="server-notice" style="margin:4px 0 30px">余墨已尽，这段对话到此为止。翻页新起、换个模型，或调高上限。</div>` : "");
    const dialogs = c.messages.filter(m => m.role !== "context"), articles = scrollHost.querySelectorAll("#messages .message");
    if (converged) { scrollHost.classList.add("converge"); articles.forEach((el, i) => el.style.setProperty("--converge-delay", `${Math.min(i * 35, 240)}ms`)); clearTimeout(convergeTimer); convergeTimer = setTimeout(() => scrollHost.classList.remove("converge"), 1000); }
    const seen = messageRenderedIds.get(c.id);
    if (seen && !converged) for (let i = 0; i < dialogs.length; i += 1) { const el = articles[i]; if (el && !seen.has(dialogs[i].id)) el.classList.add("is-new"); }
    messageRenderedIds.set(c.id, new Set(dialogs.map(m => m.id))); if (messageRenderedIds.size > 300) messageRenderedIds.clear();
    $("#chatInput").disabled = !!c.ended; $("#chatInput").placeholder = c.ended ? "这段对话已收尾" : "接着说"; $("#clearContext").disabled = !!c.ended;
    renderSendButtons();
    if (shouldScroll || !snapshot) { followBottom = true; requestAnimationFrame(scrollBottom); }
    else { restoreScrollPosition(snapshot); requestAnimationFrame(() => restoreScrollPosition(snapshot)); }
    void loadThumbnails($("#messages")); renderEnhancements($("#messages"));
  }
  function renderMessage(message) {
    if (message.role === "context") return `<div style="display:flex;align-items:center;gap:10px;margin:8px 0 34px;color:var(--ink-3);font:10px var(--title);letter-spacing:.12em"><span style="height:1px;flex:1;background:var(--line)"></span><span>上下文由此重新开始</span><span style="height:1px;flex:1;background:var(--line)"></span></div>`;
    if (message.role === "user") {
      if (editingMessageId === message.id) return `<article class="message user" data-message="${escapeHtml(message.id)}"><div class="message-editor"><textarea class="message-edit-input">${escapeHtml(message.content)}</textarea><div class="edit-actions"><button class="message-action" data-action="cancel-edit">取消</button><button class="message-action edit-save" data-action="save-edit">保存并重答</button></div></div></article>`;
      const files = message.attachments?.length ? `<div class="sent-attachments">${message.attachments.map(file => attachmentCard(file, null, true)).join("")}</div>` : "";
      return `<article class="message user" data-message="${escapeHtml(message.id)}">${files}${message.content ? `<div class="user-bubble">${escapeHtml(message.content)}</div>` : ""}<div class="message-actions">${actionIcon("copy","复制消息",icons.copy)}${actionIcon("edit","编辑消息",icons.edit)}</div></article>`;
    }
    const actions = assistantActionsHtml(message);
    return `<article class="message assistant" data-message="${escapeHtml(message.id)}" data-status="${escapeHtml(message.status || "complete")}"><div class="message-meta"><span class="meta-seal" aria-hidden="true">言</span><span>${escapeHtml(message.modelName || "模型")} · ${formatTime(message.timestamp)}</span></div><div class="assistant-block">${reasoningHtml(message)}${stepsHtml(message)}${assistantMainHtml(message)}${sourceCardsHtml(message)}</div>${actions ? `<div class="message-actions">${actions}</div>` : ""}</article>`;
  }
  function assistantNoteHtml(message) { return message.status === "error" ? `<div class="message-error">${escapeHtml(message.error || "请求失败")}</div>` : message.status === "interrupted" ? `<div class="resume-note">连接中断，写下的都还在，可从这里续上。</div>` : ""; }
  function assistantMainHtml(message) {
    if (!message.content && message.status === "streaming") return `<div class="thinking">正在凝神</div>`;
    if (!message.content && message.status === "stopped") return `<div class="thinking">搁笔于此</div>`;
    let rendered = "";
    if (message.content) { const previous = suppressViz; suppressViz = message.status === "streaming"; try { rendered = renderMarkdown(message.content); } finally { suppressViz = previous; } }
    return `${message.content ? `<div class="markdown">${rendered}</div>` : ""}${assistantNoteHtml(message)}`;
  }
  function assistantActionsHtml(message) { return message.status === "streaming" ? "" : message.status === "error" ? actionIcon("retry","重试",icons.retry) : message.status === "interrupted" ? `${message.content ? actionIcon("copy","复制已生成内容",icons.copy) : ""}${actionIcon("resume","继续生成",icons.resume)}${actionIcon("retry","从头重试",icons.retry)}` : `${actionIcon("copy","复制回复",icons.copy)}${actionIcon("regenerate","重新生成",icons.regenerate)}`; }
  // 流式结束只就地收尾这一条消息：不重建整段对话，图表、沙箱、展开状态和滚动位置都原样保留，收笔时不再闪一下
  function finalizeAssistant(conversation, assistant, leadTrim = 0) {
    const article = document.querySelector(`#messages [data-message="${CSS.escape(assistant.id)}"]`), block = article?.querySelector(".assistant-block");
    if (!block || conversation.ended) return renderConversation(followBottom);
    if (assistant.steps?.length) refreshSteps(assistant);
    block.querySelector(".thinking")?.remove();
    const reasoning = block.querySelector(".reasoning"); if (reasoning && assistant.reasoning) reasoning.querySelector(".reasoning-body").textContent = assistant.reasoning;
    block.querySelectorAll(".message-error, .resume-note, .source-stack").forEach(node => node.remove());
    const markdown = block.querySelector(".markdown");
    if (!assistant.content) { markdown?.remove(); block.insertAdjacentHTML("beforeend", assistantMainHtml(assistant)); }
    else if (markdown?.querySelector(".md-tail")) {
      // 已渲染的稳定段保持不动，只把尾段按最终文本重绘一次——此时 mermaid / echarts / html 才真正成图
      const cut = Math.max(0, Math.min(Number(markdown.dataset.cut || 0) - leadTrim, assistant.content.length)), tail = markdown.querySelector(".md-tail");
      markdown.dataset.cut = String(cut); tail.innerHTML = renderMarkdown(assistant.content.slice(cut)); renderEnhancements(tail);
      block.insertAdjacentHTML("beforeend", assistantNoteHtml(assistant));
    }
    else { markdown?.remove(); block.insertAdjacentHTML("beforeend", assistantMainHtml(assistant)); renderEnhancements(block); }
    block.insertAdjacentHTML("beforeend", sourceCardsHtml(assistant));
    block.querySelectorAll(".message-error, .resume-note, .source-stack").forEach(node => node.classList.add("is-new"));
    article.querySelector(".message-actions")?.remove(); const actions = assistantActionsHtml(assistant); if (actions) article.insertAdjacentHTML("beforeend", `<div class="message-actions">${actions}</div>`);
    article.dataset.status = assistant.status; if (assistant.status === "complete") article.querySelector(".meta-seal")?.classList.add("stamped");
    $("#chatScroll").classList.remove("generating");
    if (followBottom) requestAnimationFrame(scrollBottom);
  }
  const TOOL_LABELS = { search_web: "检索", fetch_page: "翻阅网页", read_document: "翻阅文档" };
  function toolStackLabel() { return "working"; }
  function toolStackMeta(steps = []) { const running = steps.some(step => step.status === "running"), failed = steps.filter(step => step.status === "error").length, reused = steps.filter(step => step.cached).length; return running ? `正在查阅${reused ? ` · ${reused} 复用` : ""}` : `${steps.length} 步${reused ? ` · ${reused} 复用` : ""}${failed ? ` · ${failed} 失败` : ""}`; }
  function stepsHtml(message) { if (!message.steps?.length) return ""; const running = message.status === "streaming" && message.steps.some(step => step.status === "running"), open = message.toolsTouched ? !!message.toolsOpen : running; return `<details class="tool-stack"${open ? " open" : ""}><summary><span class="tool-stack-label">${toolStackLabel(message.steps)}</span><span class="tool-stack-meta">${toolStackMeta(message.steps)}</span></summary><div class="tool-stack-body"><div class="tool-steps">${message.steps.map(stepHtml).join("")}</div></div></details>`; }
  function stepHtml(step) {
    let title = step.title; if (!title) { try { const args = JSON.parse(step.arguments || "{}"); title = args.query || args.url || args.name || ""; } catch { title = ""; } }
    const resultLink = result => { const url = safeWebUrl(result.url), label = escapeHtml(result.title || result.url); return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`; };
    const stepUrl = safeWebUrl(step.url);
    const body = step.results?.length ? `<ul class="tool-results">${step.results.slice(0, 8).map(r => `<li>${resultLink(r)}${r.snippet ? `<span>${escapeHtml(r.snippet)}</span>` : ""}</li>`).join("")}</ul>` : step.url ? `<div class="tool-note">${stepUrl ? `<a href="${escapeHtml(stepUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(stepUrl)}</a>` : escapeHtml(step.url)}</div>` : step.note ? `<div class="tool-note">${escapeHtml(step.note)}</div>` : "";
    const status = step.status || "done", state = status === "running" ? `<span class="tool-state spinning" aria-label="进行中"></span>` : status === "error" ? `<span class="tool-state failed" aria-label="失败">×</span>` : `<span class="tool-state done" aria-label="完成">✓</span>`;
    return `<div class="tool-step" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">${escapeHtml(TOOL_LABELS[step.name] || step.name)}</span><span class="tool-title">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "工具执行失败") : ""}">${status === "running" ? "查阅中" : status === "error" ? escapeHtml(step.result || "失败") : escapeHtml(step.result || "")}</span>${state}</div>${body}</div>`;
  }
  function refreshSteps(assistant) {
    const block = document.querySelector(`[data-message="${assistant.id}"] .assistant-block`); if (!block) return;
    let stack = block.querySelector(".tool-stack");
    if (!stack) { const anchor = block.querySelector(".reasoning"); if (anchor) anchor.insertAdjacentHTML("afterend", stepsHtml(assistant)); else block.insertAdjacentHTML("afterbegin", stepsHtml(assistant)); stack = block.querySelector(".tool-stack"); stack?.classList.add("is-new"); }
    if (stack) {
      stack.querySelector(".tool-stack-label").textContent = toolStackLabel(assistant.steps);
      stack.querySelector(".tool-stack-meta").textContent = toolStackMeta(assistant.steps);
      // 步骤按 id 就地更新：没变的节点一律不动（转圈不重启、已展开的结果不跳）；新步骤淡入上移，结果首次出现或状态翻转时只让那一条轻浮
      let seen = knownStepIds.get(assistant.id); if (!seen) { seen = new Map(); knownStepIds.set(assistant.id, seen); if (knownStepIds.size > 32) { for (const key of knownStepIds.keys()) if (key !== assistant.id) { knownStepIds.delete(key); break; } } }
      const list = stack.querySelector(".tool-steps");
      for (const step of assistant.steps || []) {
        const html = stepHtml(step), hasBody = /class="tool-(results|note)"/.test(html), prev = seen.get(step.id);
        let el = list.querySelector(`[data-step-id="${CSS.escape(step.id)}"]`);
        if (!el) { list.insertAdjacentHTML("beforeend", html); el = list.lastElementChild; }
        else if (prev && prev.html !== html) { el.insertAdjacentHTML("afterend", html); const next = el.nextElementSibling; el.remove(); el = next; }
        if (!prev) el.classList.add("is-new");
        else { if (hasBody && !prev.hasBody) el.classList.add("body-new"); if (prev.status !== step.status) el.classList.add("status-new"); }
        seen.set(step.id, { html, hasBody, status: step.status });
      }
      const running = assistant.status === "streaming" && assistant.steps.some(step => step.status === "running");
      if (running) { if (!assistant.toolsTouched) setProcessDetails(stack, true); }
      else if (!assistant.toolsTouched) { setProcessDetails(stack, false); assistant.toolsOpen = false; }
    }
    if (!assistant.content && assistant.status === "streaming" && !block.querySelector(".thinking")) block.insertAdjacentHTML("beforeend", `<div class="thinking">正在凝神</div>`);
  }
  function reasoningHtml(message) { if (!message.reasoning) return ""; const open = message.reasoningTouched ? !!message.reasoningOpen : message.status === "streaming" && !message.content; return `<details class="reasoning"${open ? " open" : ""}><summary>thinking</summary><div class="reasoning-body">${escapeHtml(message.reasoning)}</div></details>`; }
  function sourceCardsHtml(message) {
    if (message.status === "streaming" || !(message.steps || []).some(step => step.status !== "running")) return "";
    const sources = new Map(), add = (url, title, read = false) => { const href = safeWebUrl(url); if (!href) return; const key = href.replace(/#.*$/, ""); const old = sources.get(key); if (!old || read) sources.set(key, { url: key, title: title || old?.title || safeHost(key), read: read || !!old?.read }); };
    for (const step of message.steps || []) if (step.name === "fetch_page" && step.status === "done") add(step.url, step.title, true);
    for (const step of message.steps || []) if (step.name === "search_web" && step.status === "done") for (const result of step.results || []) add(result.url, result.title, false);
    const list = [...sources.values()]; if (!list.length) return "";
    return `<details class="source-stack"><summary><span>sources</span><small>${list.length} 条</small></summary><div class="source-grid">${list.map((source,index) => `<a class="source-card" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(safeHost(source.url))}</small></span>${source.read ? `<span class="source-read">已读</span>` : ""}</a>`).join("")}</div></details>`;
  }
  const icons = {
    copy: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="5.2" y="5.2" width="7.4" height="7.4" rx="1.5"/><path d="M10.5 3.4H4.9a1.5 1.5 0 0 0-1.5 1.5v5.6"/></svg>`,
    edit: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M3.3 12.7l.6-3 6.8-6.8 2.4 2.4-6.8 6.8-3 .6z"/><path d="M9.8 3.8l2.4 2.4"/></svg>`,
    regenerate: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 3.2v2.6h-2.6"/></svg>`,
    resume: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.2v9.6L12 8 4 3.2z"/></svg>`,
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
    if (sent && file.id) { const action = file.kind === "image" ? `data-open-image="${escapeHtml(file.id)}" title="查看 ${escapeHtml(title)}"` : `data-download-attachment="${escapeHtml(file.id)}" title="下载 ${escapeHtml(title)}"`; return `<div class="attachment-card sent" role="button" tabindex="0" data-kind="${file.kind}" ${action}>${body}${save}</div>`; }
    return `<div class="attachment-card pending" data-kind="${file.kind}" title="${escapeHtml(title)}">${body}${save}${index !== null ? `<button class="attachment-tool attachment-remove" data-remove-attachment="${index}" title="移除 ${escapeHtml(file.name)}" aria-label="移除 ${escapeHtml(file.name)}">×</button>` : ""}</div>`;
  }
  function renderAttachments() { const html = pendingAttachments.map((file,index) => attachmentCard(file,index)).join(""); [$("#attachments"), $("#welcomeAttachments")].forEach(el => { el.classList.toggle("hidden", !pendingAttachments.length); el.innerHTML = html; void loadThumbnails(el); }); renderSendButtons(); }
  function composerHasContent() { const input = currentConversation() ? $("#chatInput") : $("#welcomeInput"); return !!(input?.value.trim() || pendingAttachments.length); }
  function renderSendButtons() { const running = conversationRunning(), ended = !!currentConversation()?.ended, empty = !running && !composerHasContent(); document.querySelectorAll(".send-trigger").forEach(b => { b.textContent = running ? "■" : "↑"; b.title = running ? "停止生成" : "发送"; b.classList.toggle("stop-btn", running); b.classList.toggle("empty", empty); b.disabled = !running && ended; }); if ($("#clearContext")) $("#clearContext").disabled = running || ended; }
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

  function toggleImageViewerZoom() {
    const stage = $("#imageViewerStage"), actual = !stage.classList.contains("actual"); stage.classList.toggle("actual", actual); $("#imageViewerZoom").textContent = actual ? "适应" : "原图"; $("#imageViewerZoom").setAttribute("aria-pressed", String(actual));
  }
  function closeImageViewer() {
    const viewer = $("#imageViewer"); if (viewer.classList.contains("hidden")) return;
    viewer.classList.add("hidden"); $("#imageViewerImage").removeAttribute("src"); $("#imageViewerStage").classList.remove("actual"); $("#imageViewerZoom").textContent = "原图"; $("#imageViewerZoom").setAttribute("aria-pressed", "false"); imageViewerAttachmentId = null;
    const target = imageViewerReturnFocus; imageViewerReturnFocus = null; if (target?.isConnected) target.focus();
  }
  async function openImageViewer(id, trigger = null) {
    try {
      const file = await getAttachment(id); if (!file) return toast("图片原件已不在此浏览器中"); if (file.kind !== "image") return downloadAttachment(id);
      imageViewerAttachmentId = id; imageViewerReturnFocus = trigger || document.activeElement; $("#imageViewerName").textContent = `${file.name || "图片"} · ${formatFileSize(file.size)}`; const image = $("#imageViewerImage"); image.src = file.data; image.alt = file.name || "图片预览"; $("#imageViewerStage").classList.remove("actual"); $("#imageViewerZoom").textContent = "原图"; $("#imageViewerZoom").setAttribute("aria-pressed", "false"); $("#imageViewer").classList.remove("hidden"); $("#imageViewerClose").focus();
    } catch { toast("图片读取失败"); }
  }

  const GREETINGS = {
    night: ["夜深，宜静问", "更深人静，正好长谈", "夜色正浓，不急", "此刻无人打扰，可以细说"],
    morning: ["晨光入砚", "新墨初研，今日何问", "清晨落笔，心思最净", "一日之计，从一问开始"],
    day: ["落笔，便有回声", "案上无事，可以细问", "一纸在此，随时开笔", "想到什么，写下便是"],
    evening: ["灯下有问，慢慢说", "夜里的问题，值得慢答", "灯影未歇，纸还等着", "一天将尽，还有什么想问"]
  };
  const greetingPick = Math.random();
  function greeting() { const h = new Date().getHours(), pool = GREETINGS[h < 6 ? "night" : h < 11 ? "morning" : h < 18 ? "day" : "evening"]; return pool[Math.floor(greetingPick * pool.length)]; }
  function safeWebUrl(value) { try { const url = new URL(String(value || "")); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } }
  function safeHost(url) { try { return new URL(url).host; } catch { return "未填写地址"; } }
  // 明暗切换：新主题像墨一样从右上角侵蚀到左下角（View Transitions）；浏览器不支持或用户减少动态效果时退回颜色渐变
  let suppressThemeFade = false;
  function switchTheme(next, origin) {
    const apply = () => { store.settings.theme = next; saveStore(); applyAppearance(); renderHeader(); if (view === "chat" && !conversationRunning()) renderConversation(false); };
    const willDark = next === "dark" || (next === "system" && matchMedia("(prefers-color-scheme: dark)").matches), current = document.documentElement.dataset.theme;
    if (!document.startViewTransition || inkMotionOff() || (willDark ? "dark" : "light") === current) return apply();
    // 动画本身写在 CSS 的 ::view-transition-new(root) 上：新主题的快照套一张参差的对角墨缘遮罩，从右上角向左下角侵蚀
    suppressThemeFade = true;
    const transition = document.startViewTransition(apply);
    transition.finished.finally(() => { suppressThemeFade = false; });
  }
  function applyAppearance() {
    const { theme, inkMotion, font, width, accent } = store.settings;
    const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const html = document.documentElement, nextTheme = dark ? "dark" : "light";
    // 只在明暗实际变化时挂一次颜色过渡，避免初始加载闪一下
    html.classList.toggle("theme-fade", !suppressThemeFade && !!html.dataset.theme && html.dataset.theme !== nextTheme);
    clearTimeout(themeFadeTimer); if (html.classList.contains("theme-fade")) themeFadeTimer = setTimeout(() => html.classList.remove("theme-fade"), 480);
    html.dataset.theme = nextTheme;
    html.dataset.inkMotion = inkMotion === "off" || (inkMotion === "system" && reducedMotion.matches) ? "off" : "on";
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
    let total = pendingAttachments.reduce((sum,file) => sum + Number(file.size || 0), 0), attachmentUsage = usedAttachmentBytes(), added = 0;
    for (const file of files) {
      if (pendingAttachments.length >= 10) { toast("一次最多添加 10 个附件"); break; }
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name} 超过 8 MB，未添加`); continue; }
      if (total + file.size > MAX_PENDING_BYTES) { toast("本次附件总大小不能超过 8 MB"); break; }
      if (attachmentUsage + file.size > MAX_ATTACHMENTS_BYTES) { toast("卷宗与附件原件合计已达 512 MB 上限，请先清理"); break; }
      try { pendingAttachments.push(await ingestFile(file)); total += file.size; attachmentUsage += file.size; added += 1; }
      catch { toast(`${file.name} 读取失败`); }
    }
    persistDraft(); renderAttachments(); if (added) toast(`已置入 ${added} 件附件`);
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
  function openLibrary() { persistDraft(); rememberScrollPosition(); view = "library"; render(); if (isMobile()) toggleSidebar(true); setTimeout(() => $("#librarySearch").focus(), 0); }
  function closeLibrary() { view = "chat"; render(); }
  function renderLibraryCount() { $("#libraryCount").textContent = store.library.length ? String(store.library.length) : ""; }
  function libraryEntry(file) { return { id: file.id, kind: file.kind, name: file.name, mime: file.mime, size: file.size, modifiedAt: file.modifiedAt, extracted: !!file.extracted, savedAt: now() }; }
  function renderLibrary() {
    const query = libraryQuery.trim().toLowerCase();
    const items = store.library.filter(file => (libraryKind === "all" || file.kind === libraryKind) && (!query || String(file.name).toLowerCase().includes(query)));
    $("#libraryCountText").textContent = store.library.length ? `现存 ${store.library.length} 件 · ${formatFileSize(store.library.reduce((sum,file) => sum + Number(file.size || 0), 0))}` : "";
    document.querySelectorAll("[data-library-kind]").forEach(button => button.classList.toggle("active", button.dataset.libraryKind === libraryKind));
    $("#libraryGrid").innerHTML = items.length
      ? items.map(file => `<div class="library-card" data-library-item="${escapeHtml(file.id)}"><div class="library-preview"${file.kind === "image" ? ` role="button" tabindex="0" data-open-image="${escapeHtml(file.id)}" title="查看 ${escapeHtml(file.name)}"` : ""}>${file.kind === "image" ? `<img class="library-thumb" data-thumb="${escapeHtml(file.id)}" alt="">` : ""}<span class="library-glyph" aria-hidden="true">${kindGlyph(file.kind)}</span><span class="attachment-type">${escapeHtml(fileTypeLabel(file))}</span></div><div class="library-body"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><small>${formatFileSize(file.size)} · 收于 ${formatDay(file.savedAt)}${file.kind === "file" && !file.extracted ? " · 未能提取正文" : ""}</small></div><div class="library-actions"><button data-library-action="place" title="加入当前对话的待发附件">置于案上</button><button data-library-action="download">下载</button><button data-library-action="remove">移出</button></div></div>`).join("")
      : `<div class="library-empty">${store.library.length ? "没有这样的卷宗" : "卷宗尚空<br>拖入文件，或在附件上按「藏」收入"}</div>`;
    void loadThumbnails($("#libraryGrid"));
  }
  async function addLibraryFiles(fileList) {
    const files = Array.from(fileList || []); let added = 0;
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name} 超过 8 MB，未收入`); continue; }
      if (usedAttachmentBytes() + file.size > MAX_ATTACHMENTS_BYTES) { toast("卷宗与附件原件合计已达 512 MB 上限，请先清理"); continue; }
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
    if (currentConversation()?.ended) return toast("这段对话已收尾，翻页后再置入");
    if (pendingAttachments.some(file => file.id === id)) return toast("此件已在案上");
    if (pendingAttachments.length >= 10) return toast("一次最多添加 10 个附件");
    const total = pendingAttachments.reduce((sum,file) => sum + Number(file.size || 0), 0);
    if (total + Number(item.size || 0) > MAX_PENDING_BYTES) return toast("本次附件总大小不能超过 8 MB");
    const { savedAt, ...metadata } = item; pendingAttachments.push(metadata); persistDraft();
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
    if (!(await ensureLib("pdf"))) return "";
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
    if (conversationRunning()) return stopGeneration();
    const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
    const text = input.value.trim(); if (!text && !pendingAttachments.length) return;
    let profile = activeProfile(); if (!profile) { toast("先添一个模型"); return openSettings("models"); }
    if (profile.tools !== false && apiBase === null) { await ensureLocalBridge(); profile = activeProfile() || profile; }
    if (parseTokenLimit(profile.quota) === null) { toast("先给这个模型定一个用量上限"); openSettings("models"); setTimeout(() => document.querySelector(`[data-profile-card="${profile.id}"] [data-quota-amount]`)?.focus(),0); return; }
    if (quotaExhausted(profile)) { const existing = currentConversation(); if (existing) { existing.ended = true; saveStore(); renderConversation(); } toast("余墨已尽，调高上限或换个模型"); return; }
    const sendingDraftKey = draftKey(); let c = currentConversation();
    if (!c) {
      c = { id: uid(), title: titleFrom(text, pendingAttachments), createdAt: now(), updatedAt: now(), profileId: profile.id, messages: [] };
      store.conversations.unshift(c); currentId = c.id;
    }
    const user = { id: uid(), role: "user", content: text, timestamp: now(), attachments: pendingAttachments };
    const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
    c.messages.push(user, assistant); c.updatedAt = now(); c.profileId = profile.id;
    input.value = ""; input.style.height = "auto"; delete store.drafts[sendingDraftKey]; pendingAttachments = []; saveStore(); render(true);
    await streamReply(c, assistant, profile);
  }
  function titleFrom(text, attachments) { const value = text || `关于 ${attachments[0]?.name || "附件"}`; return value.replace(/\s+/g," ").slice(0,28) + (value.length > 28 ? "…" : ""); }
  function stopGeneration(id = currentId) {
    const job = requestJob(id); if (!job) return;
    requestJobs.delete(id); job.controller.abort();
    const conversation = store.conversations.find(item => item.id === id), assistant = conversation?.messages.find(message => message.id === job.assistantId) || [...(conversation?.messages || [])].reverse().find(message => message.status === "streaming");
    if (assistant?.status === "streaming") assistant.status = "stopped";
    saveStore(); renderHistory(); renderSendButtons(); if (currentId === id) setConnection("idle", "已停止");
  }
  function stopAllGenerations() {
    for (const [id, job] of requestJobs) {
      job.controller.abort(); const conversation = store.conversations.find(item => item.id === id), assistant = conversation?.messages.find(message => message.id === job.assistantId);
      if (assistant?.status === "streaming") assistant.status = "stopped";
    }
    requestJobs.clear();
  }

  async function streamReply(conversation, assistant, profile, { resume = false } = {}) {
    const job = { controller: new AbortController(), assistantId: assistant.id, label: "生成中" };
    requestJobs.set(conversation.id, job); renderSendButtons(); renderHistory(); setJobLabel(conversation, job, "生成中");
    const started = performance.now(); let leadTrim = 0;
    try {
      const contextIndex = conversation.messages.map(m => m.role).lastIndexOf("context");
      const source = conversation.messages.slice(contextIndex + 1).filter(m => m.id !== assistant.id && m.status !== "error" && ["user","assistant"].includes(m.role));
      const lastUserId = source.filter(m => m.role === "user").at(-1)?.id, history = [];
      for (const m of source) history.push(await messageForApi(m, m.id === lastUserId));
      if (resume && assistant.content) { history.push({ role: "assistant", content: assistant.content }); history.push({ role: "user", content: "上一条回复在这里因连接中断。请只从中断处继续，不要重复已经生成的内容。" }); }
      const tools = profile.tools !== false ? toolDefinitions(conversation) : null;
      const overrides = { systemPrompt: assistantHint(profile, tools), tools, enableSearch: modelSearchEnabled(profile) };
      const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, toolCache = new Map(); let usageKnown = false;
      for (;;) {
        assistant.toolCalls = null; assistant.usage = null;
        const response = await requestChat(profile, history, job.controller.signal, overrides);
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw Error(data.error || `请求失败（${response.status}）`); }
        const type = response.headers.get("content-type") || "";
        if (type.includes("text/event-stream")) await readSse(response, assistant);
        else { const data = await response.json(), message = data?.choices?.[0]?.message; assistant.content += extractContent(data); assistant.reasoning = normalizeContent(message?.reasoning_content) || assistant.reasoning; assistant.usage = data.usage || null; if (Array.isArray(message?.tool_calls)) assistant.toolCalls = message.tool_calls.map(call => ({ id: call.id, name: call.function?.name || "", arguments: call.function?.arguments || "" })); }
        if (assistant.usage) { usageKnown = true; for (const key of Object.keys(usage)) usage[key] += Number(assistant.usage[key] || 0); }
        const calls = (assistant.toolCalls || []).filter(call => call.name);
        if (!calls.length || !overrides.tools) break;
        // 模型请求调用工具：记录步骤、执行、把结果作为 tool 消息回传，再让模型继续
        const steps = calls.map(call => ({ id: call.id || `call_${uid().slice(0, 8)}`, name: call.name, arguments: call.arguments || "{}", status: "running" }));
        (assistant.steps ||= []).push(...steps); refreshSteps(assistant); setJobLabel(conversation, job, "查阅中");
        history.push({ role: "assistant", content: assistant.content || null, tool_calls: steps.map(step => ({ id: step.id, type: "function", function: { name: step.name, arguments: step.arguments } })) });
        for (const step of steps) {
          const stepStarted = performance.now();
          const cacheKey = toolCacheKey(step), cached = toolCache.get(cacheKey); let outcome;
          if (cached) { Object.assign(step, structuredClone(cached.presentation)); step.cached = true; outcome = structuredClone(cached.outcome); outcome.display = `复用 · ${outcome.display}`; }
          else { outcome = await runTool(step, conversation, job.controller.signal); toolCache.set(cacheKey, { outcome: structuredClone(outcome), presentation: toolPresentation(step) }); }
          const remaining = MIN_TOOL_STATUS_MS - (performance.now() - stepStarted); if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
          step.status = outcome.ok ? "done" : "error"; step.result = outcome.display;
          history.push({ role: "tool", tool_call_id: step.id, content: String(outcome.content).slice(0, 60000) });
          refreshSteps(assistant); saveStore();
        }
        if (assistant.content) assistant.content += "\n\n";
        setJobLabel(conversation, job, "生成中");
      }
      leadTrim = assistant.content.match(/^\n*/)[0].length; assistant.content = assistant.content.replace(/^\n+|\n+$/g, ""); assistant.usage = usageKnown ? usage : null;
      if (!assistant.content) throw Error("模型未返回正文，请适当提高最大输出长度后重试");
      assistant.status = "complete"; conversation.updatedAt = now(); accountUsage(profile, assistant, history, conversation);
    } catch (error) {
      if (error.name === "AbortError") assistant.status = "stopped";
      else if (assistant.content || assistant.reasoning || assistant.steps?.length) { assistant.status = "interrupted"; assistant.error = friendlyError(error.message); assistant.interruptedAt = now(); }
      else { assistant.status = "error"; assistant.error = friendlyError(error.message); }
    } finally {
      assistant.durationMs = Math.round(performance.now() - started);
      if (requestJobs.get(conversation.id) === job) requestJobs.delete(conversation.id);
      if (currentId !== conversation.id || view !== "chat") conversation.unread = true;
      saveStore(); renderHistory(); if (currentId === conversation.id && view === "chat") finalizeAssistant(conversation, assistant, leadTrim); renderSendButtons(); refreshConnection();
      if (assistant.status === "complete") void maybeAutoTitle(conversation, profile);
    }
  }
  function accountUsage(profile, assistant, requestMessages, conversation) {
    const exact = Number(assistant.usage?.total_tokens || 0);
    const consumed = exact > 0 ? exact : estimateTokens(requestMessages) + estimateTokens([{ content: assistant.content }]);
    profile.usedTokens = Math.max(0, Number(profile.usedTokens || 0)) + consumed;
    assistant.tokenCount = consumed; assistant.tokenEstimated = !(exact > 0);
    persistServerProfile(profile);
    if (quotaExhausted(profile)) { conversation.ended = true; toast("这一答写完，余墨也尽了"); }
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
      conversation.title = title; conversation.titleAuto = true; saveStore(); renderHistory(); if (currentId === conversation.id) { $("#chatTitle").textContent = title; syncDocumentTitle(); }
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
    lines.push("需要画图时：流程图、时序图、结构图用 ```mermaid 代码块；数据图表用 ```echarts 代码块，内容是 ECharts option 的纯 JSON（不要含函数）。需要可点击、拖动或实时计算的交互演示时，用一个完整的 ```html 代码块，CSS 与 JavaScript 都写在其中且不要依赖外部资源；它会在本地隔离沙箱中运行。");
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
  function stableToolJson(value) { if (Array.isArray(value)) return value.map(stableToolJson); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableToolJson(value[key])])); return typeof value === "string" ? value.trim() : value; }
  function toolCacheKey(step) {
    let args; try { args = JSON.parse(step.arguments || "{}"); } catch { return `${step.name}:invalid:${String(step.arguments || "")}`; }
    if (step.name === "search_web") args.query = String(args.query || "").trim().replace(/\s+/g, " ").toLowerCase();
    if (step.name === "fetch_page") { try { const url = new URL(String(args.url || "")); url.hash = ""; args.url = url.href; } catch { args.url = String(args.url || "").trim(); } }
    if (step.name === "read_document") { args.name = String(args.name || "").trim().toLowerCase(); if (args.query) args.query = String(args.query).trim().toLowerCase(); if (args.page) args.page = Number(args.page); }
    return `${step.name}:${JSON.stringify(stableToolJson(args))}`;
  }
  function toolPresentation(step) { return { title: step.title || "", url: step.url || "", note: step.note || "", results: Array.isArray(step.results) ? structuredClone(step.results) : null }; }
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
    // 落墨节奏：正文不按网络分块一坨坨出现，而是每帧按积压量的一定比例匀速写出（积压越多写得越快，最多滞后零点几秒）；新写出的字带短暂渐显，末尾跟一支笔尖光标
    const paced = !inkMotionOff(); let shown = paced ? assistant.content.length : Infinity, freshGroups = [];
    const frame = () => {
      scheduled = false;
      const target = assistant.content.length, at = performance.now();
      const block = document.querySelector(`[data-message="${assistant.id}"] .assistant-block`);
      if (!block) { shown = target; freshGroups = []; return; }
      if (paced) {
        const backlog = target - shown, step = backlog <= 0 ? 0 : document.hidden ? backlog : Math.min(backlog, Math.max(1, Math.ceil(backlog * REVEAL_RATE)));
        if (step > 0) { shown += step; freshGroups.unshift({ at, count: step }); }
        freshGroups = freshGroups.filter(group => at - group.at < FRESH_MS);
      }
      const visible = paced ? assistant.content.slice(0, shown) : assistant.content;
      if (assistant.reasoning) {
        let details = block.querySelector(".reasoning");
        if (!details) { block.insertAdjacentHTML("afterbegin", reasoningHtml(assistant)); details = block.querySelector(".reasoning"); details.classList.add("is-new"); }
        details.querySelector(".reasoning-body").textContent = assistant.reasoning;
        if (visible && !assistant.reasoningTouched && details.open) setProcessDetails(details, false);
      }
      if (!visible) { if (!block.querySelector(".thinking")) block.insertAdjacentHTML("beforeend", `<div class="thinking">正在凝神</div>`); }
      else {
        let markdown = block.querySelector(".markdown");
        if (!markdown?.querySelector(".md-tail")) { block.querySelector(".thinking")?.remove(); markdown?.remove(); block.insertAdjacentHTML("beforeend", `<div class="markdown" data-cut="0"><div class="md-stable"></div><div class="md-tail"></div></div>`); markdown = block.querySelector(".markdown"); }
        // 已经收尾的段落只渲染一次追加进 md-stable，每帧只重绘最后一段，长回复不会越来越卡；已渲染位置记在 data-cut 上，跨工具轮次也不会重复
        let renderedCut = Number(markdown.dataset.cut || 0); const cut = stableCut(visible);
        if (cut > renderedCut) { const stable = markdown.querySelector(".md-stable"); stable.insertAdjacentHTML("beforeend", renderMarkdown(visible.slice(renderedCut, cut))); renderedCut = cut; markdown.dataset.cut = String(cut); renderEnhancements(stable); }
        const tail = markdown.querySelector(".md-tail");
        suppressViz = true; try { tail.innerHTML = renderMarkdown(visible.slice(renderedCut)); } finally { suppressViz = false; }
        decorateTail(tail, freshGroups.map(group => ({ count: group.count, age: at - group.at })));
      }
      if (followBottom) scrollBottom(); else syncJumpBottom();
      if (paced && shown < target) schedule();
    };
    const schedule = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(frame); };
    const refresh = () => { saveStoreSoon(); schedule(); };
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
    // 流结束后把积压的字写完再返回，收尾和下一轮工具调用都等在这后面；标签页不可见时直接补齐
    while (paced && shown < assistant.content.length) { schedule(); await new Promise(resolve => setTimeout(resolve, 16)); if (document.hidden) shown = assistant.content.length; }
  }
  // 把尾段末尾最近写出的字按帧分组包进 .ink-fresh（用负 animation-delay 对齐各自的年龄，重绘也不会重放），并在最后一个字后放一支光标
  function decorateTail(tail, groups) {
    if (tail.querySelector(".viz-pending")) return;
    const nodes = []; const walker = document.createTreeWalker(tail, NodeFilter.SHOW_TEXT); while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
    let node = nodes.pop(); if (!node) return;
    const cursor = document.createElement("span"); cursor.className = "ink-cursor"; node.after(cursor);
    for (const group of groups) {
      let need = group.count;
      while (need > 0 && node) {
        const text = node.data, take = Math.min(need, text.length), span = document.createElement("span");
        span.className = "ink-fresh"; span.style.animationDelay = `-${Math.round(group.age)}ms`; span.textContent = text.slice(text.length - take);
        node.data = text.slice(0, text.length - take); node.after(span); need -= take;
        if (!node.data) { node.remove(); node = nodes.pop(); }
      }
      if (!node) break;
    }
  }
  function normalizeContent(content) { if (typeof content === "string") return content; if (Array.isArray(content)) return content.map(part => part?.text || part?.content || "").join(""); return ""; }
  function extractContent(data) { return normalizeContent(data?.choices?.[0]?.message?.content); }
  function friendlyError(message) { if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return apiBase === null ? "浏览器无法直连该接口，通常是接口未开放 CORS。请在 VS Code 运行“言下：启动模型桥接”任务后重试。" : "本机桥接已经停止或无法访问。请重新运行 start.cmd 或 VS Code 的“言下：启动模型桥接”任务，并保持终端窗口开启。"; return String(message).slice(0,500); }
  function scrollBottom() { const el = $("#chatScroll"); if (!el) return; if (el.scrollHeight - el.scrollTop - el.clientHeight < 1) { autoScrolling = false; return; } autoScrolling = true; el.scrollTop = el.scrollHeight; requestAnimationFrame(() => { autoScrolling = false; }); }

  async function handleMessageAction(event) {
    const button = event.target.closest("[data-action]"); if (!button || conversationRunning()) return;
    const c = currentConversation(); if (!c) return; const id = button.closest("[data-message]")?.dataset.message, index = c.messages.findIndex(m => m.id === id); if (index < 0) return;
    const message = c.messages[index];
    if (button.dataset.action === "copy") { await copyText(message.content); return toast("已复制"); }
    if (button.dataset.action === "cancel-edit") { editingMessageId = null; renderConversation(false); return; }
    if (button.dataset.action === "edit") {
      if (c.ended) return toast("这段对话已收尾，不再改动");
      editingMessageId = message.id; renderConversation(false);
      requestAnimationFrame(() => { const input = document.querySelector(`[data-message="${message.id}"] .message-edit-input`); input?.focus(); input?.setSelectionRange(input.value.length,input.value.length); });
      return;
    }
    if (button.dataset.action === "save-edit") return saveEditedMessage(c, index, button.closest("[data-message]").querySelector(".message-edit-input").value);
    if (button.dataset.action === "resume") {
      if (c.ended) return toast("这段对话已收尾，调高上限或换个模型");
      let profile = activeProfile(); if (!profile) return openSettings("models");
      if (profile.tools !== false && apiBase === null) { await ensureLocalBridge(); profile = activeProfile() || profile; }
      if (parseTokenLimit(profile.quota) === null) return toast("先给这个模型定一个用量上限");
      if (quotaExhausted(profile)) return toast("余墨已尽，调高上限或换个模型");
      message.status = "streaming"; message.error = ""; delete message.interruptedAt; saveStore(); renderConversation(false); await streamReply(c, message, profile, { resume: true }); return;
    }
    if (c.ended) return toast("这段对话已收尾，翻页再续");
    const userIndex = [...c.messages.slice(0,index)].map(m => m.role).lastIndexOf("user"); if (userIndex < 0) return;
    const profile = activeProfile(); if (!profile) return openSettings("models");
    if (parseTokenLimit(profile.quota) === null) return toast("先给这个模型定一个用量上限");
    if (quotaExhausted(profile)) return toast("余墨已尽，调高上限或换个模型");
    const discarded = c.messages.slice(userIndex + 1); void deleteAttachments(attachmentIds(discarded));
    c.messages = c.messages.slice(0, userIndex + 1); const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name }; c.messages.push(assistant); saveStore(); renderConversation(true); await streamReply(c, assistant, profile);
  }
  async function saveEditedMessage(conversation, index, value) {
    const text = value.trim(); if (!text) return toast("还没落笔");
    const profile = activeProfile(); if (!profile) return openSettings("models");
    if (parseTokenLimit(profile.quota) === null) return toast("先给这个模型定一个用量上限");
    if (quotaExhausted(profile)) return toast("余墨已尽，调高上限或换个模型");
    const message = conversation.messages[index], discarded = conversation.messages.slice(index + 1); void deleteAttachments(attachmentIds(discarded)); message.content = text; conversation.messages = conversation.messages.slice(0,index + 1); conversation.updatedAt = now(); conversation.ended = false; if (index === 0 && conversation.titleAuto !== false) { conversation.title = titleFrom(text,message.attachments || []); conversation.titled = false; }
    editingMessageId = null; const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name }; conversation.messages.push(assistant); saveStore(); render(true); await streamReply(conversation, assistant, profile);
  }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); } }

  function openSettings(tab = settingsTab) { persistDraft(); rememberScrollPosition(); settingsTab = tab; showNow($("#settingsModal")); $("#appVersion").textContent = bootstrap.version ? `v${bootstrap.version}` : ""; renderSettings(); }
  function closeSettings() { hideWithFade($("#settingsModal")); render(); }
  function renderSettings() {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === settingsTab));
    const host = $("#settingsContent");
    const tabChanged = host.dataset.tab !== settingsTab; host.dataset.tab = settingsTab;
    if (settingsTab === "general") host.innerHTML = generalSettingsHtml();
    if (settingsTab === "appearance") host.innerHTML = appearanceSettingsHtml();
    if (settingsTab === "models") host.innerHTML = modelsSettingsHtml();
    bindSettingsEvents();
    if (tabChanged) { host.classList.remove("tab-fade"); void host.offsetWidth; host.classList.add("tab-fade"); }
  }
  function generalSettingsHtml() { return `<h2>通用</h2><p class="settings-lead">一切只存在这台设备的浏览器里。</p><div class="setting-row"><div class="setting-copy"><strong>显示名称</strong><small>侧栏里的称呼</small></div><input id="settingName" class="field" value="${escapeHtml(store.settings.name)}"></div><div class="setting-row"><div class="setting-copy"><strong>自动拟题</strong><small>首次问答后由模型拟题，略耗额度；改过的标题不再覆盖</small></div><div class="segmented"><button data-setting="autoTitle" data-value="true" class="${store.settings.autoTitle ? "active" : ""}">开</button><button data-setting="autoTitle" data-value="false" class="${store.settings.autoTitle ? "" : "active"}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>本机数据</strong><small>${store.conversations.length} 段对话 · ${store.library.length} 件卷宗 · 配置 ${storageSize()} · 附件原件 ${formatFileSize(usedAttachmentBytes())}</small></div><div class="setting-actions"><label class="check"><input id="exportFiles" type="checkbox">含附件原件</label><button id="exportData" class="outline-btn">导出备份</button><button id="importData" class="outline-btn">导入备份</button></div></div><div class="setting-row"><div class="setting-copy"><strong>清空所有对话</strong><small>模型、个性化与卷宗都会留下</small></div><button id="clearAll" class="danger-btn">清空对话</button></div>`; }
  function appearanceSettingsHtml() { const s = store.settings; return `<h2>个性化</h2><p class="settings-lead">清简为骨，纸墨为意。</p>${segmentRow("主题","随系统或固定明暗","theme",[["light","亮"],["dark","暗"],["system","系统"]],s.theme)}${segmentRow("界面动效","主题侵蚀、印章呼吸与开合过渡","inkMotion",[["on","开"],["system","随系统"],["off","关"]],s.inkMotion || "on")}${segmentRow("字体","正文与标题的气质","font",[["sans","无衬线"],["serif","衬线"],["mixed","混排"]],s.font)}${segmentRow("阅读宽度","长文的行宽","width",[[680,"窄"],[760,"适中"],[860,"宽"]],s.width)}<div class="setting-row"><div class="setting-copy"><strong>印色</strong><small>界面中的点睛之色</small></div><div class="segmented">${["#9b5540","#536d62","#5c6386","#75644f"].map(v => `<button data-setting="accent" data-value="${v}" class="${s.accent === v ? "active" : ""}" style="color:${v}">●</button>`).join("")}</div></div>`; }
  function segmentRow(title,desc,key,items,active) { return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><small>${desc}</small></div><div class="segmented">${items.map(([v,label]) => `<button data-setting="${key}" data-value="${v}" class="${String(active) === String(v) ? "active" : ""}">${label}</button>`).join("")}</div></div>`; }
  function modelsSettingsHtml() { const transport = apiBase !== null ? `本机桥接已接上${apiBase ? "（VS Code 预览）" : ""}，联网与转发都可用。` : "眼下由浏览器直连模型，联网检索不可用；启动本机桥接后会自动接上。"; return `<h2>模型</h2><p class="settings-lead">任何 OpenAI 兼容接口都可以接入，API Key 只存于当前浏览器。${transport}</p>${bootstrap.configError ? `<div class="server-notice">${escapeHtml(bootstrap.configError)}</div>` : ""}<div id="profileList">${profiles().map(profileCardHtml).join("")}</div><button id="addProfile" class="outline-btn" style="width:100%;margin-top:4px">＋ 添加模型配置</button>`; }
  function quotaParts(value) { const match = String(value ?? "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([kme])?$/); return match ? { amount: match[1], unit: match[2] || "k" } : { amount: "", unit: "k" }; }
  function profileCardHtml(p) {
    const locked = p.source === "server", invalidQuota = parseTokenLimit(p.quota) === null, quota = quotaParts(p.quota), models = Array.isArray(p.modelList) ? p.modelList : [], listed = models.includes(p.model);
    const modelField = locked ? `<input class="field wide" value="${escapeHtml(p.model)}" disabled>` : `<div class="field-row">${models.length ? `<select class="field wide select" data-model-select>${models.map(m => `<option value="${escapeHtml(m)}"${m === p.model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}<option value="__custom__"${listed ? "" : " selected"}>手动输入…</option></select>` : ""}<input class="field wide${models.length && listed ? " hidden" : ""}" data-field="model" value="${escapeHtml(p.model)}" placeholder="如 gpt-4o-mini"><button class="outline-btn" data-profile-action="models" title="从接口的 /models 获取可用模型">${models.length ? "刷新" : "获取列表"}</button></div>`;
    const quotaField = `<div class="field-row"><input type="number" min="0" step="any" class="field wide" data-quota-amount value="${escapeHtml(quota.amount)}" placeholder="如 100" ${invalidQuota ? `aria-invalid="true" style="border-color:var(--danger)"` : ""}><select class="field select" data-quota-unit>${[["k","千 (k)"],["m","百万 (m)"],["e","亿 (e)"]].map(([v,label]) => `<option value="${v}"${quota.unit === v ? " selected" : ""}>${label}</option>`).join("")}</select></div>`;
    return `<div class="profile-card" data-profile-card="${escapeHtml(p.id)}"><div class="profile-head"><strong>${escapeHtml(p.name)}</strong>${locked ? `<span class="profile-badge">服务端</span>` : ""}${p.id === store.settings.activeProfileId ? `<span class="profile-badge">默认</span>` : ""}</div><div class="profile-grid"><label>显示名称<input class="field wide" data-field="name" value="${escapeHtml(p.name)}" ${locked ? "disabled" : ""}></label><label>用量限制${quotaField}<small>必填；改动后重新计量</small></label><label class="profile-full">Base URL<input class="field wide" data-field="baseUrl" value="${escapeHtml(p.baseUrl || "")}" placeholder="https://example.com/v1" ${locked ? "disabled" : ""}></label>${locked ? "" : `<label class="profile-full">API Key<input type="password" class="field wide" data-field="apiKey" value="${escapeHtml(p.apiKey || "")}" placeholder="sk-…" autocomplete="off"></label>`}<label class="profile-full">模型${modelField}${locked ? "" : `<small>填好 Base URL 与 API Key 后可获取列表，也可以手动输入</small>`}</label></div><details class="profile-advanced"${advancedOpen.has(p.id) ? " open" : ""}><summary>高级配置<small>temperature ${Number(p.temperature ?? .7)} · max_tokens ${Number(p.maxTokens || DEFAULT_MAX_TOKENS)}${p.tools === false ? " · 言下工具关" : apiBase !== null ? " · 言下联网就绪" : " · 言下联网待桥接"}${modelSearchEnabled(p) ? " · 接口原生联网开" : ""}${p.systemPrompt ? " · 已设 system prompt" : ""}</small></summary><div class="profile-grid"><label>言下联网与文档工具<div class="segmented" style="margin-top:4px"><button data-toggle-field="tools" data-value="true" class="${p.tools !== false ? "active" : ""}">开</button><button data-toggle-field="tools" data-value="false" class="${p.tools === false ? "active" : ""}">关</button></div><small>由言下执行检索、读网页与翻阅文档；需要接口支持 function calling，联网需本机桥接</small></label><label>接口原生联网（实验）<div class="segmented" style="margin-top:4px"><button data-toggle-field="enableSearch" data-value="true" class="${modelSearchEnabled(p) ? "active" : ""}">开</button><button data-toggle-field="enableSearch" data-value="false" class="${modelSearchEnabled(p) ? "" : "active"}">关</button></div><small>仅当接口文档明确支持时开启，只会附加 <code>enable_search: true</code>；普通 OpenAI 兼容服务通常会忽略它，不能替代上面的言下联网</small></label><label><code>temperature</code><input type="number" min="0" max="2" step="0.1" class="field wide" data-field="temperature" value="${Number(p.temperature ?? .7)}"><small>0–2，默认 0.7；越高越发散</small></label><label><code>max_tokens</code><input type="number" min="16" max="65536" class="field wide" data-field="maxTokens" value="${Number(p.maxTokens || DEFAULT_MAX_TOKENS)}"><small>单次回复的输出上限，默认 ${DEFAULT_MAX_TOKENS}</small></label><label class="profile-full"><code>system prompt</code><textarea class="field wide field-area" data-field="systemPrompt" placeholder="可选。模型的身份与答话方式">${escapeHtml(p.systemPrompt || "")}</textarea></label></div></details><div class="profile-actions"><button class="outline-btn" data-profile-action="test">测试连接</button>${p.id !== store.settings.activeProfileId ? `<button class="outline-btn" data-profile-action="default">设为默认</button>` : ""}${locked ? "" : `<button class="danger-btn" data-profile-action="delete">删除</button>`}<span class="profile-status">${invalidQuota ? "请先设置用量限制" : ""}</span></div></div>`;
  }
  function storageSize() { const bytes = new Blob([JSON.stringify(store)]).size; return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`; }
  function bindSettingsEvents() {
    $("#settingName")?.addEventListener("input", e => { store.settings.name = e.target.value || "访客"; saveStoreSoon(); });
    $("#exportData")?.addEventListener("click", () => exportData($("#exportFiles")?.checked));
    $("#importData")?.addEventListener("click", () => $("#importInput").click());
    $("#importInput").onchange = async e => { const [file] = e.target.files; e.target.value = ""; if (file) await importData(file); };
    $("#clearAll")?.addEventListener("click", async () => {
      if (!(await askConfirm({ title: "清空全部对话？", body: `${store.conversations.length} 段对话将被移除，无法撤销；模型配置、外观与卷宗会保留。`, ok: "清空" }))) return;
      stopAllGenerations();
      const conversationIds = new Set(store.conversations.map(c => c.id)), draftFiles = Object.entries(store.drafts || {}).filter(([key]) => conversationIds.has(key)).flatMap(([,draft]) => Array.isArray(draft?.attachments) ? draft.attachments.map(file => file.id) : []);
      const currentDraftFiles = currentId ? pendingAttachments.map(file => file.id) : [];
      void deleteAttachments([...attachmentIds(store.conversations.flatMap(c => c.messages || [])), ...draftFiles, ...currentDraftFiles]);
      store.conversations = []; store.drafts = store.drafts?.[NEW_DRAFT_ID] ? { [NEW_DRAFT_ID]: store.drafts[NEW_DRAFT_ID] } : {}; scrollPositions.clear(); currentId = null; pendingAttachments = [];
      saveStore(); render(); renderSettings(); toast("所有对话已清空");
    });
    document.querySelectorAll("[data-setting]").forEach(button => button.onclick = () => { const key = button.dataset.setting, value = button.dataset.value; if (key === "theme") { switchTheme(value, button); renderSettings(); return; } store.settings[key] = key === "width" ? Number(value) : key === "autoTitle" ? value === "true" : value; saveStore(); applyAppearance(); renderSettings(); });
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
      if (!data || !Number.isInteger(data.version) || data.version < 1 || data.version > STORE_VERSION || !Array.isArray(data.conversations)) throw Error("不是言下的备份文件，或版本不兼容");
      const known = new Set(store.conversations.map(c => c.id)); let conversations = 0, added = 0, library = 0, drafts = 0, files = 0;
      for (const c of data.conversations) if (c?.id && !known.has(c.id) && Array.isArray(c.messages)) { store.conversations.push(c); conversations += 1; }
      const profileIds = new Set(profiles().map(p => p.id));
      for (const p of Array.isArray(data.profiles) ? data.profiles : []) if (p?.id && p.source !== "server" && !profileIds.has(p.id)) { store.profiles.push({ ...p, apiKey: p.apiKey || "" }); added += 1; }
      const libraryIds = new Set(store.library.map(f => f.id));
      for (const f of Array.isArray(data.library) ? data.library : []) if (f?.id && !libraryIds.has(f.id)) { store.library.push(f); library += 1; }
      for (const [key,draft] of Object.entries(data.drafts && typeof data.drafts === "object" ? data.drafts : {})) if (!store.drafts[key] && (typeof draft === "string" || draft && typeof draft === "object")) { store.drafts[key] = draft; drafts += 1; }
      for (const record of Array.isArray(data.attachments) ? data.attachments : []) if (record?.id && record.data !== undefined && !(await getAttachment(record.id))) { await putAttachment(record); files += 1; }
      if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
      saveStore(); render(); renderSettings();
      toast(`已导入 ${conversations} 段对话、${added} 个模型、${library} 件卷宗${drafts ? `、${drafts} 份草稿` : ""}${files ? `，恢复 ${files} 件附件原件` : ""}${data.attachments ? "" : "；备份不含附件原件，旧附件将显示为不可用"}`);
    } catch (error) { toast(`导入失败：${String(error.message || error).slice(0,80)}`); }
  }

  boot();
})();
