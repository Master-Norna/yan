(() => {
  "use strict";
  // ---- 00-state.js ----
// 言 · 常量、内置提示词取值、运行期状态
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 数据模型（JSDoc，供 tsc --checkJs 与编辑器；见 src/types.d.ts 的说明）----------
// 存下来的东西只有这几种：Store 里挂着设置、模型、对话、卷宗（浏览器内的旧件）、记忆与草稿；对话里是消息，消息上挂步骤，步骤上可挂帮手
/**
 * @typedef {Object} Attachment 附件的元数据；原件（data）另存 IndexedDB，只在读出时才带
 * @property {string} id
 * @property {"image"|"text"|"file"} kind
 * @property {string} name
 * @property {string} mime
 * @property {number} size
 * @property {number} [modifiedAt]
 * @property {boolean} [extracted] 文档已在本机抽出正文
 * @property {number} [tokens] 入库时估的字数（文本或抽出的正文）
 * @property {string} [data] 原件：文本本身，或 data: URL
 * @property {string} [extractedText]
 * @property {string} [extractionError]
 * @property {string} [savedAt] 收入浏览器内卷宗的时间
 * @property {string} [archive] 磁盘卷宗里的相对路径（availableDocuments 用）
 */
/** @typedef {{ text: string, messageId?: string }} Quote 引用追问：划选的一段与它所在的消息（旁注锚文本作引文时没有 messageId） */
/** @typedef {{ id: string, name: string, arguments: string }} ToolCall 流式拼出的一次工具调用 */
/** @typedef {{ prompt_tokens: number, completion_tokens: number, total_tokens: number }} Usage */
/** @typedef {"ask"|"review"|"auto"} CommandPolicy 问而后行 / 审而后行 / 径行 */
/** @typedef {"running"|"pending"|"done"|"error"|"skipped"} StepStatus */
/** @typedef {{ question: string, header: string, multi: boolean, options: { label: string, description: string }[] }} AskQuestion */
/**
 * @typedef {Object} SubAgent 差遣出去的帮手：自己的一段对话，步骤画在主消息的差遣卡片里
 * @property {string} id
 * @property {string} task
 * @property {string} content
 * @property {string} reasoning
 * @property {Step[]} steps
 * @property {"streaming"|"complete"|"stopped"|"error"} status
 * @property {Usage|null} usage
 * @property {number} rounds
 * @property {{ thinking: string, signature: string }[]|null} [thinkingBlocks]
 * @property {string} [report] 最后一轮说的话，即交回主模型的回报
 * @property {number} [durationMs]
 * @property {ToolCall[]|null} [toolCalls]
 */
/**
 * @typedef {Object} Step 行迹里的一步：一次工具调用及其结果、呈现与开合状态
 * @property {string} id
 * @property {string} name 工具名；user_note 是作答途中用户寄来的补言，不是工具
 * @property {string} arguments 模型给的参数原文（JSON）
 * @property {StepStatus} status
 * @property {string} [title] 标题行：指令、路径、关键词……
 * @property {string} [result] 标题行右侧的一句结果
 * @property {string} [note]
 * @property {string} [url]
 * @property {any[]} [results] 检索 / 翻记忆 / 查旧谈的命中
 * @property {string} [output] 指令输出、搜索结果、目录清单、计算结果、接口响应
 * @property {string} [code] run_js 跑的代码
 * @property {Array<{ text: string, status: string }>} [plan] update_plan 的清单
 * @property {number} [exitCode]
 * @property {boolean} [readOnly] 只读指令，免确认
 * @property {"conversation"|"answer"} [approvalScope] 指令确认的放行范围：行可对整段对话径行，言只可放行本答
 * @property {{ old: string, new: string }} [diff]
 * @property {{ path: string, added: number, removed: number, created?: boolean }} [change]
 * @property {number} [at] 调用发起时正文的长度（时间线分组、思绪按轮切分都靠它）
 * @property {number} [rat] 调用发起时思绪的长度
 * @property {string} [scope] 帮手的步骤记它所属的帮手 id
 * @property {Attachment[]} [attachments] 补言（user_note）随带的附件
 * @property {boolean} [cached] 结果是复用的
 * @property {boolean} [skipped]
 * @property {boolean} [expanded] 输出摊开 / 折起；未记则按状态定（报错折起）
 * @property {boolean} [full] 输出看全 / 只看前 10 行
 * @property {boolean} [folded] 差遣卡片整张折起
 * @property {SubAgent} [sub]
 * @property {{ questions: AskQuestion[] }} [form]
 * @property {string[]} [answers]
 * @property {string} [conversationId] 翻旧谈
 * @property {string} [date]
 */
/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {"user"|"assistant"|"context"} role context 是上下文分隔：带 summary 的是压缩，不带的是旧版硬切
 * @property {string} content
 * @property {string} timestamp
 * @property {"streaming"|"complete"|"stopped"|"error"|"interrupted"} [status]
 * @property {string} [modelName]
 * @property {Attachment[]} [attachments]
 * @property {Quote} [quote]
 * @property {string} [reasoning]
 * @property {Step[]} [steps]
 * @property {ToolCall[]|null} [toolCalls] 只在流式期间用
 * @property {{ thinking: string, signature: string }[]|null} [thinkingBlocks] 这一轮的思考块（Anthropic 带工具调用时要回传），只在流式期间用
 * @property {Usage|null} [usage]
 * @property {number} [tokenCount] 这一答耗的墨
 * @property {boolean} [tokenEstimated]
 * @property {string} [error]
 * @property {string} [interruptedAt]
 * @property {number} [durationMs]
 * @property {{ path: string, name: string, size: number }[]} [deliverables] 言里这一答做出的成品
 * @property {boolean} [work] 这一答是执事的（时间线画法）
 * @property {boolean} [toolsOpen]
 * @property {boolean} [toolsTouched]
 * @property {boolean} [reasoningOpen]
 * @property {boolean} [reasoningTouched]
 * @property {string} [summary] 压缩分隔上的摘要
 * @property {number} [compacted] 压进摘要的条数
 * @property {boolean} [compacting]
 */
/** @typedef {{ id: string, parentId: string|null, messages: Message[], createdAt: string }} Fork 被换下来的一段尾巴 */
/** @typedef {{ id: string, anchor: { messageId: string, text: string, occurrence?: number }, createdAt: string, updatedAt: string, messages: Message[] }} Thread 旁注；occurrence 是所注的那段在正文里第几次出现（从 0 起） */
/**
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {string} title
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} profileId
 * @property {Message[]} messages 当前走的这条路
 * @property {Fork[]} forks
 * @property {Thread[]} threads
 * @property {string} [workdir] 绑了目录即为行
 * @property {CommandPolicy} [commandPolicy] 指令权限模式
 * @property {string} [reasoning] 思考档位
 * @property {boolean} [pinned]
 * @property {boolean} [unread]
 * @property {boolean} [ended] 旧版：额度尽了整段锁死；现已不再写入，读到照旧尊重
 * @property {boolean} [titleAuto]
 * @property {boolean} [titled]
 * @property {number} [titleTries]
 * @property {boolean} [showCompacted]
 */
/**
 * @typedef {Object} Profile 一份模型配置；source 为 server 的是桥接预设的，字段大多锁定
 * @property {string} id
 * @property {"server"|"custom"} source
 * @property {string} name
 * @property {string} model
 * @property {string} [baseUrl]
 * @property {string} [apiKey]
 * @property {"openai"|"anthropic"} [api] 接口类型；没写按地址认（anthropic.com）
 * @property {number} temperature
 * @property {number} maxTokens
 * @property {string} quota 用量上限，如 "100k"
 * @property {number} usedTokens
 * @property {string} systemPrompt
 * @property {boolean} [tools] 本机工具，默认开
 * @property {boolean} [enableSearch]
 * @property {number} [contextWindow]
 * @property {string} [reasoningLevels] 此模型认的思考档位，逗号分隔；none 是不认；探到的与手填的都记在这里
 * @property {string} [reasoningProbed] 探过档位时模型的身份（接口|地址|模型 ID，见 reasoningProbeKey），亲手填的前面带 manual|；换了任一样再探
 * @property {string[]} [modelList]
 */
/** @typedef {{ id: string, text: string, createdAt: string, updatedAt: string, source: { conversationId: string, title: string }|null }} MemoryItem */
/** @typedef {{ text: string, attachments: Attachment[], quote?: Quote|null, updatedAt?: string }} Draft */
/**
 * @typedef {Object} Settings
 * @property {string} name
 * @property {"light"|"dark"|"system"} theme
 * @property {"on"|"off"|"system"} inkMotion
 * @property {"sans"|"serif"|"mixed"|"kai"|"fangsong"} font
 * @property {number} width
 * @property {string} accent
 * @property {string} activeProfileId
 * @property {boolean} autoTitle
 * @property {string} [pendingWorkdir] 欢迎页目录签里待绑的目录
 * @property {string[]} collapsedRepos
 * @property {string} reasoning 新对话默认的思考档位
 * @property {CommandPolicy} commandPolicyDefault 新对话默认的指令权限模式
 * @property {boolean} [sandbox] 沙箱总开关（默认开）：桥接那头筛指令、锁目录、去机密环境变量
 * @property {number} compactAt
 * @property {"anywhere"|"inside"} toolReach
 * @property {boolean} archiveRead
 * @property {number} toolRounds
 * @property {number} subRounds
 * @property {string} [archiveDir]
 * @property {Partial<Profile>} serverProfile 桥接预设模型上用户可改的几项
 * @property {"chat"|"library"} [lastView] 上次停在哪一页，刷新后回到原处
 * @property {string} [lastConversationId]
 */
/**
 * @typedef {Object} Store 整个本地存储（主体在 IndexedDB；localStorage 只留启动镜像）
 * @property {number} version
 * @property {Settings} settings
 * @property {Profile[]} profiles
 * @property {Conversation[]} conversations
 * @property {Attachment[]} library 浏览器内的卷宗（没桥接时）
 * @property {{ enabled: boolean, items: MemoryItem[] }} memory
 * @property {Record<string, Draft>} drafts
 */
const STORAGE_KEY = "yan-chat-v1";
const STORAGE_META_KEY = "__yanStorage";
const STATE_DB_NAME = "yan-chat-state-v1";
const STATE_STORE_NAME = "state";
const STATE_RECORD_KEY = "main";
// 内置提示词都在 prompts/ 目录里，这里只做取值与填空；{{名字}} 由 vars 填入，缺文件时报错并给空串，不让请求整个失败
const PROMPTS = window.YAN_PROMPTS || {};
function prompt(path, vars = {}) {
  const text = path.split(".").reduce((node, key) => node?.[key], PROMPTS);
  if (text == null) {
    console.error(`缺少内置提示词：${path}（prompts/ 目录未加载？）`);
    return "";
  }
  return (Array.isArray(text) ? text.join("\n") : String(text)).replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? "")).trim();
}
const APP_VERSION = "0.3.0"; // 与 package.json 同步；桥接在线时以桥接返回的为准
const LOCAL_BRIDGE = "http://127.0.0.1:8787";
const FILE_DB_NAME = "yan-chat-files-v1";
const FILE_STORE_NAME = "attachments";
// 附件的几道上限：单件、单次合计、卷宗与附件原件合计、收入卷宗的单件；界面上的提示都从这里取数（见 limitLabel），改一处即可
const MB = 1024 * 1024;
const MAX_FILE_BYTES = 32 * MB;
const MAX_PENDING_BYTES = 64 * MB;
const MAX_ATTACHMENTS_BYTES = 2048 * MB;
const MAX_ARCHIVE_FILE_BYTES = 256 * MB;
const limitLabel = bytes => (bytes >= 1024 * MB ? `${bytes / (1024 * MB)} GB` : `${Math.round(bytes / MB)} MB`);
const MAX_EXTRACTED_CHARS = 300000;
const HISTORY_TEXT_CHARS = 3000;
const FOLLOW_THRESHOLD = 80;
const DEFAULT_MAX_TOKENS = 8192;
const MIN_TOOL_STATUS_MS = 240;
// 一次回答里最多几轮工具调用（帮手另计），超过后收回工具、请模型直接收尾；默认值在这里，实际值在「设置 → 通用」里可改
const DEFAULT_TOOL_ROUNDS = 80,
  DEFAULT_SUB_ROUNDS = 40;
function roundLimit(key, fallback) {
  const value = Math.floor(Number(store?.settings?.[key]));
  return value >= 1 ? Math.min(value, 500) : fallback;
}
const toolRoundLimit = () => roundLimit("toolRounds", DEFAULT_TOOL_ROUNDS),
  subRoundLimit = () => roundLimit("subRounds", DEFAULT_SUB_ROUNDS);
const REVEAL_RATE = 0.16,
  FRESH_MS = 640; // 每帧写出积压字数的比例；新字渐显持续时间
const $ = selector => document.querySelector(selector);
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => new Date().toISOString();
const STORE_VERSION = 5;
const NEW_DRAFT_ID = "__new__";
/** @type {Store} */
const defaultStore = {
  version: STORE_VERSION,
  settings: {
    name: "访客",
    theme: "system",
    inkMotion: "on",
    font: "mixed",
    width: 760,
    accent: "#9b5540",
    activeProfileId: "",
    autoTitle: true,
    pendingWorkdir: "",
    collapsedRepos: [],
    reasoning: "",
    commandPolicyDefault: "ask",
    sandbox: true,
    compactAt: 0,
    toolReach: "anywhere",
    archiveRead: true,
    toolRounds: DEFAULT_TOOL_ROUNDS,
    subRounds: DEFAULT_SUB_ROUNDS,
    serverProfile: { temperature: 0.7, maxTokens: DEFAULT_MAX_TOKENS, systemPrompt: "", quota: "", usedTokens: 0 }
  },
  profiles: [],
  conversations: [],
  library: [],
  memory: { enabled: true, items: [] },
  drafts: {}
};
/** @type {Store} */
let store = loadStore();
let bootstrap = { serverProfile: null, configError: "" };
let apiBase = null;
/** @type {string|null} 正在看的对话 */
let currentId = null;
let view = "chat";
let editingMessageId = null;
let renamingId = null;
let historyQuery = "";
/** @type {Attachment[]} 案上待发的附件 */
let pendingAttachments = [];
/** @type {Quote|null} */
let pendingQuote = null;
let chatSuggestionsHtml = "",
  bindSuggestions = () => {},
  suggestionsMode = "chat";
function renderSuggestions(work) {
  const mode = work ? "work" : "chat";
  if (mode === suggestionsMode || !chatSuggestionsHtml) return;
  suggestionsMode = mode;
  $("#welcome .suggestions").innerHTML = work
    ? WORK_SUGGESTIONS.map(
        ([label, prompt]) => `<button class="suggestion" data-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`
      ).join("")
    : chatSuggestionsHtml;
  bindSuggestions();
}
const requestJobs = new Map();
let settingsTab = "general";
let toastTimer = null;
let fileDbPromise = null;
let stateDbPromise = null;
let stateRevision = 0,
  stateDbOnly = false,
  stateWriteActive = false,
  stateWritePending = null,
  stateSaveWarned = false;
let libraryQuery = "",
  libraryKind = "all";
const advancedOpen = new Set();
const vizCharts = new Set();
let suppressViz = false;
const mermaidSvgCache = new Map();
let saveTimer = null,
  historySearchTimer = null;
let bridgeRetryAt = 0;
let followBottom = true,
  autoScrolling = false;
const scrollPositions = new Map();
let lastRenderedConvId = null,
  convergeTimer = null,
  themeFadeTimer = null;
const nodeSig = new WeakMap(),
  knownStepIds = new Map();
let lastVizThemeKey = "";
const thumbCache = new Map();
let imageViewerAttachmentId = null,
  imageViewerReturnFocus = null;

  // ---- 01-store.js ----
// 言 · 本地存储：迁移、读写、附件库（IndexedDB）
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统

// 结构迁移按版本递增：老数据按字段补默认值，不清空；将来调整结构时在 migrateStoreVx 里写迁移
function migrateStoreV1(data) {
  data.version = 2; /* v1 → v2 无结构变化，为后续迁移留位 */
}
function migrateStoreV2(data) {
  data.drafts = {};
  data.version = 3;
}
function migrateStoreV3(data) {
  for (const c of data.conversations || []) c.forks ||= [];
  data.version = 4;
}
function migrateStoreV4(data) {
  const fallback = data.settings?.workAutoDefault ? "auto" : "ask";
  data.settings ||= {};
  data.settings.commandPolicyDefault = normalizeCommandPolicy(data.settings.commandPolicyDefault, fallback);
  delete data.settings.workAutoDefault;
  for (const c of data.conversations || []) {
    c.commandPolicy = normalizeCommandPolicy(c.commandPolicy, c.workAuto ? "auto" : "ask");
    delete c.workAuto;
  }
  data.version = 5;
}
function normalizeCommandPolicy(value, fallback = "ask") {
  return ["ask", "review", "auto"].includes(value) ? value : fallback;
}
function normalizeStoreData(value) {
  try {
    if (!value || typeof value !== "object") return structuredClone(defaultStore);
    // 启动镜像自己的元数据不进入业务状态，也不随备份导出
    const { [STORAGE_META_KEY]: _storageMeta, ...plain } = value;
    let data = plain;
    if (!Number.isInteger(data.version)) data.version = 1;
    if (data.version === 1) migrateStoreV1(data);
    if (data.version === 2) migrateStoreV2(data);
    if (data.version === 3) migrateStoreV3(data);
    if (data.version === 4) migrateStoreV4(data);
    if (data.version > STORE_VERSION) data.version = STORE_VERSION;
    return {
      ...structuredClone(defaultStore),
      ...data,
      settings: {
        ...defaultStore.settings,
        ...(data.settings || {}),
        // 旧版思考菜单上有「关」，现在没有了：按「默认」看
        reasoning: normalizeReasoning(data.settings?.reasoning),
        serverProfile: { ...defaultStore.settings.serverProfile, ...(data.settings?.serverProfile || {}) }
      },
      profiles: Array.isArray(data.profiles) ? data.profiles : [],
      conversations: (Array.isArray(data.conversations) ? data.conversations : []).map(({ ended, workAuto, ...c }) => ({
        ...c,
        commandPolicy: normalizeCommandPolicy(c.commandPolicy, workAuto ? "auto" : "ask"),
        reasoning: normalizeReasoning(c.reasoning),
        // 旧版在压缩开始时就先落一个 compacting 分隔：页面若在摘要生成前关掉，它会留下来把历史长期截断；启动时清掉
        messages: (Array.isArray(c.messages) ? c.messages : []).filter(m => !(m?.role === "context" && m.compacting)),
        forks: Array.isArray(c.forks) ? c.forks : [],
        threads: Array.isArray(c.threads) ? c.threads : []
      })),
      library: Array.isArray(data.library) ? data.library : [],
      drafts: normalizeDrafts(data.drafts),
      memory: normalizeMemory(data.memory)
    };
  } catch {
    return structuredClone(defaultStore);
  }
}
function readLocalStoreRecord() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!data || typeof data !== "object") return null;
    const meta = data[STORAGE_META_KEY];
    return {
      data,
      revision: Number(meta?.revision) || 0,
      dbOnly: meta?.dbOnly === true,
      managed: !!meta
    };
  } catch {
    return null;
  }
}
function loadStore() {
  return normalizeStoreData(readLocalStoreRecord()?.data);
}
// 旧版草稿只存一段字符串；统一成 { text, attachments, quote }，此后各处只认对象
/** @returns {Draft} */
function normalizeDraft(value) {
  if (typeof value === "string") return { text: value, attachments: [], quote: null };
  if (!value || typeof value !== "object") return { text: "", attachments: [], quote: null };
  return {
    text: String(value.text || ""),
    attachments: Array.isArray(value.attachments) ? value.attachments : [],
    quote:
      value.quote && typeof value.quote === "object" && value.quote.text
        ? { text: String(value.quote.text), messageId: String(value.quote.messageId || "") }
        : null,
    ...(value.updatedAt ? { updatedAt: value.updatedAt } : {})
  };
}
/** @returns {Record<string, Draft>} */
function normalizeDrafts(drafts) {
  /** @type {Record<string, Draft>} */
  const out = {};
  if (drafts && typeof drafts === "object" && !Array.isArray(drafts))
    for (const [key, value] of Object.entries(drafts)) out[key] = normalizeDraft(value);
  return out;
}
function normalizeMemory(memory) {
  return {
    enabled: memory?.enabled !== false,
    items: (Array.isArray(memory?.items) ? memory.items : [])
      .filter(item => item?.id && typeof item.text === "string" && item.text.trim())
      .map(item => ({
        id: String(item.id),
        text: item.text,
        createdAt: item.createdAt || now(),
        updatedAt: item.updatedAt || item.createdAt || now(),
        source:
          item.source && typeof item.source === "object"
            ? { conversationId: item.source.conversationId || "", title: String(item.source.title || "") }
            : null
      }))
  };
}
function openStateDb() {
  if (stateDbPromise) return stateDbPromise;
  stateDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(STATE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STATE_STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("对话存储不可用"));
  });
  return stateDbPromise;
}
async function stateStoreRequest(mode, action) {
  const db = await openStateDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STATE_STORE_NAME, mode),
      request = action(transaction.objectStore(STATE_STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("对话存储失败"));
    transaction.onabort = () => reject(transaction.error || Error("对话存储已中止"));
  });
}
function nextStateRevision() {
  stateRevision = Math.max(Date.now(), stateRevision + 1);
  return stateRevision;
}
function serializedStore(revision, dbOnly = false) {
  return JSON.stringify({ ...store, [STORAGE_META_KEY]: { revision, dbOnly } });
}
// localStorage 只在数据尚小时保留完整镜像，供首屏主题与旧版/测试直接读取；一旦装不下就缩成很小的启动镜像。
// 完整对话始终写进 IndexedDB，因此 localStorage 的 5–10 MB 上限不再决定能留多少聊天。
function localStoreShell(revision) {
  return JSON.stringify({
    version: store.version,
    settings: store.settings,
    profiles: store.profiles,
    conversations: [],
    library: [],
    memory: { enabled: store.memory?.enabled !== false, items: [] },
    drafts: {},
    [STORAGE_META_KEY]: { revision, dbOnly: true }
  });
}
function writeLocalShell(revision) {
  try {
    localStorage.setItem(STORAGE_KEY, localStoreShell(revision));
    return true;
  } catch {
    return false;
  }
}
async function flushStateWrites() {
  if (stateWriteActive) return;
  stateWriteActive = true;
  while (stateWritePending) {
    const pending = stateWritePending;
    stateWritePending = null;
    try {
      await stateStoreRequest("readwrite", db =>
        db.put({ id: STATE_RECORD_KEY, revision: pending.revision, json: pending.json })
      );
      if (stateDbOnly) writeLocalShell(pending.revision);
      stateSaveWarned = false;
    } catch {
      // 完整 localStorage 镜像写成了就仍有退路；两边都没写成才打扰用户
      if (!pending.localSaved && !stateSaveWarned) {
        stateSaveWarned = true;
        toast("本机对话存储失败，请先导出备份");
      }
    }
  }
  stateWriteActive = false;
}
function queueStateWrite(revision, json, localSaved) {
  // 正在写时只留最新快照；长对话不必把中间每一帧都排进磁盘队列
  stateWritePending = { revision, json, localSaved };
  void flushStateWrites();
}
// 启动时以 IndexedDB 为主；旧版 localStorage、测试显式塞进来的无标记数据，以及尚未落盘的较新完整镜像优先一次并迁入。
async function hydrateStore() {
  const local = readLocalStoreRecord();
  let record = null;
  try {
    record = await stateStoreRequest("readonly", db => db.get(STATE_RECORD_KEY));
  } catch {
    return;
  }
  stateRevision = Math.max(Number(record?.revision) || 0, local?.revision || 0, Date.now());
  stateDbOnly = local?.dbOnly === true;
  const localOverrides =
    !!local &&
    (!local.managed || !record || (!local.dbOnly && Number(local.revision || 0) > Number(record.revision || 0)));
  if (!localOverrides && record?.json) {
    try {
      store = normalizeStoreData(JSON.parse(record.json));
    } catch {
      // IndexedDB 里的单条记录若意外损坏，仍沿用 localStorage 的镜像
    }
  }
  if (localOverrides || !record) {
    const revision = nextStateRevision(),
      json = serializedStore(revision);
    try {
      await stateStoreRequest("readwrite", db => db.put({ id: STATE_RECORD_KEY, revision, json }));
      try {
        localStorage.setItem(STORAGE_KEY, json);
        stateDbOnly = false;
      } catch {
        stateDbOnly = true;
        writeLocalShell(revision);
      }
    } catch {
      // IndexedDB 不可用时保留原有 localStorage 行为；之后保存若两边都失败会给出提示
    }
  } else if (stateDbOnly) writeLocalShell(Number(record.revision) || stateRevision);
  // 尽量让浏览器把这份本机数据视作持久存储；不支持或不准时静默退回普通 IndexedDB
  try {
    const persistence = navigator.storage?.persist?.();
    persistence?.catch?.(() => {});
  } catch {}
}
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const revision = nextStateRevision(),
    json = serializedStore(revision);
  let localSaved = false;
  if (!stateDbOnly)
    try {
      localStorage.setItem(STORAGE_KEY, json);
      localSaved = true;
    } catch {
      stateDbOnly = true;
    }
  queueStateWrite(revision, json, localSaved);
}
function saveStoreSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStore, 300);
}
function openFileDb() {
  if (fileDbPromise) return fileDbPromise;
  fileDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(FILE_STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("附件存储不可用"));
  });
  return fileDbPromise;
}
async function fileStoreRequest(mode, action) {
  const db = await openFileDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FILE_STORE_NAME, mode),
      request = action(transaction.objectStore(FILE_STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("附件存储失败"));
    transaction.onabort = () => reject(transaction.error || Error("附件存储已中止"));
  });
}
function putAttachment(record) {
  return fileStoreRequest("readwrite", store => store.put(record));
}
function getAttachment(id) {
  return id ? fileStoreRequest("readonly", store => store.get(id)) : Promise.resolve(null);
}
function deleteAttachment(id) {
  thumbCache.delete(id);
  return id ? fileStoreRequest("readwrite", store => store.delete(id)).catch(() => {}) : Promise.resolve();
}
function attachmentIds(messages = []) {
  return messages
    .flatMap(message => message.attachments || [])
    .map(file => file.id)
    .filter(Boolean);
}
function inLibrary(id) {
  return store.library.some(file => file.id === id);
}
// 卷宗与对话附件原件合计占用（按 id 去重，同一原件记住两处只算一次）
function usedAttachmentBytes() {
  const seen = new Map();
  const count = files => {
    for (const file of files || []) if (file?.id && !seen.has(file.id)) seen.set(file.id, Number(file.size || 0));
  };
  count(store.library);
  for (const value of Object.values(store.drafts || {})) count(value?.attachments);
  for (const c of store.conversations) for (const m of allMessages(c)) count(m.attachments);
  return [...seen.values()].reduce((a, b) => a + b, 0);
}
function isReferenced(id) {
  return (
    pendingAttachments.some(file => file.id === id) ||
    draftAttachmentIds().includes(id) ||
    store.conversations.some(c => allMessages(c).some(m => (m.attachments || []).some(file => file.id === id)))
  );
}
// 已收入卷宗的原件由卷宗管理，删除对话或移除待发附件时不会删掉它
async function deleteAttachments(ids) {
  // 调用方通常会在本轮同步代码里紧接着移除消息或草稿；等引用更新完再判断，既不误删共用原件，也不留下孤立数据。
  await Promise.resolve();
  await Promise.all([...new Set(ids)].filter(id => !inLibrary(id) && !isReferenced(id)).map(deleteAttachment));
}
async function cleanupAttachmentStore() {
  try {
    const keep = new Set([
        ...attachmentIds(store.conversations.flatMap(allMessages)),
        ...store.library.map(file => file.id),
        ...draftAttachmentIds()
      ]),
      keys = await fileStoreRequest("readonly", db => db.getAllKeys());
    await deleteAttachments(keys.filter(key => !keep.has(key)));
  } catch {}
}
// 分叉：c.messages 始终是当前走的那条路；编辑或重答时被换下来的尾巴整段收进 c.forks（记下它接在哪条消息之后），随时可以切回来。
// 同一位置的几个版本 = 当前这条 + 接在同一位置的 forks，按首条消息的时间排序

  // ---- 02-conversation.js ----
// 言 · 对话数据：分叉、模型、草稿
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
/** @param {Conversation} c */
function allMessages(c) {
  return [...(c.messages || []), ...(c.forks || []).flatMap(fork => fork.messages || [])];
}
/** @param {Conversation} c */
function forkTail(c, index) {
  const tail = c.messages.slice(index);
  if (!tail.length) return null;
  c.messages = c.messages.slice(0, index);
  // 只剩一条报错或空白的消息就不值得留作版本
  if (tail.length === 1 && !tail[0].content && !tail[0].steps?.length) {
    void deleteAttachments(attachmentIds(tail));
    return null;
  }
  const fork = { id: uid(), parentId: c.messages[index - 1]?.id ?? null, messages: tail, createdAt: now() };
  (c.forks ||= []).push(fork);
  return fork;
}
/** @param {Conversation} c */
function branchesAt(c, index) {
  const parentId = c.messages[index - 1]?.id ?? null,
    current = c.messages[index];
  if (!current) return [];
  const list = [
    { forkId: null, first: current },
    ...(c.forks || [])
      .filter(fork => fork.parentId === parentId && fork.messages?.length)
      .map(fork => ({ forkId: fork.id, first: fork.messages[0] }))
  ];
  return list.sort((a, b) => String(a.first.timestamp).localeCompare(String(b.first.timestamp)));
}
/** @param {Conversation} c */
function branchAt(c, index) {
  const list = branchesAt(c, index);
  if (list.length < 2) return null;
  return { at: list.findIndex(item => item.forkId === null) + 1, total: list.length, list };
}
/**
 * @param {Conversation} c
 * @param {number} step 往前 / 往后一个版本（-1 / 1）
 */
function switchBranch(c, index, step) {
  const branch = branchAt(c, index);
  if (!branch) return;
  const target = branch.list[branch.at - 1 + step];
  if (!target || target.forkId === null) return;
  const fork = c.forks.find(item => item.id === target.forkId),
    tail = c.messages.slice(index),
    parentId = c.messages[index - 1]?.id ?? null;
  const anchor = document.querySelector(`#messages [data-message="${CSS.escape(c.messages[index].id)}"]`),
    host = $("#chatScroll"),
    keepTop = anchor ? anchor.getBoundingClientRect().top - host.getBoundingClientRect().top : null;
  c.forks = c.forks.filter(item => item !== fork);
  if (tail.length) c.forks.push({ id: uid(), parentId, messages: tail, createdAt: now() });
  c.messages = [...c.messages.slice(0, index), ...fork.messages];
  c.updatedAt = now();
  editingMessageId = null;
  saveStore();
  renderConversation(false);
  // 面板里开着的旁注若注在被换下去的那几条上，退回目录（那里只列眼前这条路上的）
  if (sidePanelOpen()) renderSidePanel();
  // 切换后让这一条留在原来的位置，视线不用重新找
  const next = document.querySelector(`#messages [data-message="${CSS.escape(c.messages[index].id)}"]`);
  if (next && keepTop !== null) {
    followBottom = false;
    host.scrollTop += next.getBoundingClientRect().top - host.getBoundingClientRect().top - keepTop;
  }
}
function branchNavHtml(branch) {
  return branch
    ? `<span class="branch-nav"><button class="message-action" data-action="branch-prev" title="上一个版本" aria-label="上一个版本" ${branch.at <= 1 ? "disabled" : ""}>‹</button><span>${branch.at}/${branch.total}</span><button class="message-action" data-action="branch-next" title="下一个版本" aria-label="下一个版本" ${branch.at >= branch.total ? "disabled" : ""}>›</button></span>`
    : "";
}
function profiles() {
  return [...(bootstrap.serverProfile ? [bootstrap.serverProfile] : []), ...store.profiles];
}
function activeProfile() {
  return profiles().find(p => p.id === store.settings.activeProfileId) || profiles()[0] || null;
}
function currentConversation() {
  return store.conversations.find(c => c.id === currentId) || null;
}
function draftKey(id = currentId) {
  return id || NEW_DRAFT_ID;
}
/** @returns {Draft} */
function draftRecord(id = currentId) {
  return normalizeDraft(store.drafts?.[draftKey(id)]);
}
function persistDraft() {
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput"),
    key = draftKey(),
    text = input?.value || "",
    attachments = pendingAttachments.map(file => ({ ...file }));
  store.drafts ||= {};
  if (text || attachments.length || pendingQuote) store.drafts[key] = { text, attachments, quote: pendingQuote, updatedAt: now() };
  else delete store.drafts[key];
  saveStoreSoon();
}
function restoreDraft() {
  if (view === "library") return;
  const draft = draftRecord();
  pendingAttachments = draft.attachments.map(file => ({ ...file }));
  pendingQuote = currentConversation() ? draft.quote : null;
  renderQuote();
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
  if (!input) return;
  input.value = draft.text;
  grow(input);
}
function clearDraft(id = currentId) {
  store.drafts ||= {};
  delete store.drafts[draftKey(id)];
}
function draftAttachmentIds() {
  return Object.values(store.drafts || {})
    .flatMap(value => (Array.isArray(value?.attachments) ? value.attachments : []))
    .map(file => file?.id)
    .filter(Boolean);
}
/** @param {Profile} p */
function persistServerProfile(p) {
  if (p.source === "server")
    store.settings.serverProfile = {
      temperature: p.temperature,
      maxTokens: p.maxTokens,
      systemPrompt: p.systemPrompt,
      reasoningLevels: p.reasoningLevels,
      reasoningProbed: p.reasoningProbed,
      quota: p.quota,
      usedTokens: p.usedTokens
    };
}

  // ---- 03-ui-utils.js ----
// 言 · 小工具：转义、时间、提示、确认框、按需加载、动效开合
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function formatTime(value) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
// 汉字数字：一、十二、二十三；2 单独出现时用「两」（如「两问」）
const DIGITS = "〇一二三四五六七八九";
function chineseNumber(n, twoAsLiang = false) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n === 2 && twoAsLiang) return "两";
  if (n < 10) return DIGITS[n];
  if (n < 100) {
    const tens = Math.floor(n / 10),
      ones = n % 10;
    return `${tens > 1 ? DIGITS[tens] : ""}十${ones ? DIGITS[ones] : ""}`;
  }
  return String(n);
}
function formatDay(value) {
  const date = new Date(value),
    year = date.getFullYear();
  return `${year !== new Date().getFullYear() ? `${[...String(year)].map(d => DIGITS[Number(d)]).join("")}年` : ""}${chineseNumber(date.getMonth() + 1)}月${chineseNumber(date.getDate())}日`;
}
function dayBucket(value) {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(value).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? "今天" : days < 7 ? "过去七天" : "更早";
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  showNow(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideWithFade(el), 2200);
}
function setConnection(state, text) {
  $("#connection").dataset.state = state;
  $("#connectionText").textContent = text;
}
// 把正文里的某条消息滚到视口：只滚 #chatScroll 自己，不用 scrollIntoView——它会连带滚动外层容器（页面整体跟着偏一截，尤其在 VS Code 预览与移动端）
function scrollChatTo(article, block = "start", margin = 12) {
  const host = $("#chatScroll");
  if (!host || !article) return;
  const offset = article.getBoundingClientRect().top - host.getBoundingClientRect().top,
    target =
      block === "center"
        ? host.scrollTop + offset - Math.max(0, (host.clientHeight - article.offsetHeight) / 2)
        : host.scrollTop + offset - margin;
  host.scrollTo({ top: Math.max(0, target), behavior: reducedMotion.matches ? "instant" : "smooth" });
}
function requestJob(id = currentId) {
  return id ? requestJobs.get(id) || null : null;
}
function conversationRunning(id = currentId) {
  return !!requestJob(id);
}
/** @param {Conversation} conversation */
function setJobLabel(conversation, job, label) {
  job.label = label;
  if (requestJobs.get(conversation.id) === job && currentId === conversation.id && view === "chat") setConnection("busy", label);
}
function refreshConnection() {
  const job = requestJob();
  if (job) return setConnection("busy", job.label || "生成中");
  if (navigator.onLine === false) return setConnection("error", "连接中断");
  const conversation = currentConversation(),
    last = [...(conversation?.messages || [])].reverse().find(message => message.role === "assistant");
  if (last?.status === "error") return setConnection("error", "请求失败");
  if (last?.status === "interrupted") return setConnection("error", "连接中断");
  if (last?.status === "stopped") return setConnection("idle", "已停止");
  setConnection("idle", conversation?.ended ? "额度已尽" : "就绪");
}
function grow(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(190, Math.max(44, el.scrollHeight))}px`;
}
// 编辑消息的文本框：随内容长高（浏览器不认 field-sizing 时的兜底），到七成屏高才内滚
function growEditor(el) {
  if (!el) return;
  const fit = () => {
    el.style.height = "auto";
    el.style.height = `${Math.min(innerHeight * 0.7, el.scrollHeight + 2)}px`;
  };
  fit();
  if (!el.dataset.grow) {
    el.dataset.grow = "1";
    el.addEventListener("input", fit);
  }
}
function isMobile() {
  return innerWidth <= 760;
}
// 同风格的确认弹层，替代浏览器自带的 confirm()
let confirmResolve = null;
function askConfirm({ title, body = "", ok = "确定", danger = true }) {
  return new Promise(resolve => {
    settleConfirm(false);
    confirmResolve = resolve;
    $("#confirmTitle").textContent = title;
    $("#confirmBody").textContent = body;
    const button = $("#confirmOk");
    button.textContent = ok;
    button.className = danger ? "danger-btn solid" : "outline-btn";
    showNow($("#confirmModal"));
    setTimeout(() => button.focus(), 0);
  });
}
function settleConfirm(value) {
  if (!confirmResolve) return;
  hideWithFade($("#confirmModal"));
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve(value);
}

// ---------- 大体积库按需加载：mermaid / echarts / KaTeX / pdf.js 只在真正用到时才拉，首屏只带 marked + purify + hljs ----------
const VENDOR = {
  pdf: { src: "./vendor/pdf.min.js", ready: () => window.pdfjsLib },
  katex: { src: "./vendor/katex/katex.min.js", ready: () => window.katex },
  mermaid: { src: "./vendor/mermaid.min.js", ready: () => window.mermaid },
  echarts: { src: "./vendor/echarts.min.js", ready: () => window.echarts }
};
const vendorLoads = new Map();
function ensureLib(name) {
  const lib = VENDOR[name];
  if (!lib) return Promise.resolve(false);
  if (lib.ready()) return Promise.resolve(true);
  if (!vendorLoads.has(name))
    vendorLoads.set(
      name,
      new Promise(resolve => {
        const script = document.createElement("script");
        script.src = lib.src;
        script.onload = () => {
          if (name === "mermaid") setupMermaid();
          resolve(!!lib.ready());
        };
        script.onerror = () => {
          vendorLoads.delete(name);
          script.remove();
          resolve(false);
        };
        document.head.append(script);
      })
    );
  return vendorLoads.get(name);
}
// 弹层与提示的收场：先淡出再 hidden，别硬切
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)"),
  touchInput = matchMedia("(hover: none) and (pointer: coarse)");
const inkMotionOff = () => document.documentElement.dataset.inkMotion === "off";
function showNow(el) {
  clearTimeout(el._leaveTimer);
  el.classList.remove("hidden", "leaving");
}
function hideWithFade(el, duration = 170) {
  if (!el || el.classList.contains("hidden")) return;
  clearTimeout(el._leaveTimer);
  if (reducedMotion.matches) {
    el.classList.add("hidden");
    return;
  }
  el.classList.add("leaving");
  el._leaveTimer = setTimeout(() => {
    el.classList.remove("leaving");
    el.classList.add("hidden");
  }, duration);
}
// 自动开合的规矩：程序只在两处动手——开始时打开、做完时收起，中间不来回翻。收起前先停一拍，让勾打上、让人看清结果；
// 且只在读者没停在这一块上看时才收：正在往上翻着读的人，内容不能从眼皮底下抽走，留给他自己收。用户亲手开合过的一律不动
const SETTLE_DELAY = 700;
function detailsInView(details) {
  const host = $("#chatScroll") || document.documentElement,
    rect = details.getBoundingClientRect(),
    frame = host.getBoundingClientRect();
  return rect.bottom > frame.top && rect.top < frame.bottom;
}
// force：做完就收，不看读者是否正停在这块、用户是否亲手开过——运行中摊开、运行完收起，是行迹与帮手时间线的定例
function settleDetails(details, open, onClose = null, force = false) {
  if (!details) return;
  if (open) {
    clearTimeout(details._settleTimer);
    details._settleTimer = null;
    return setProcessDetails(details, true);
  }
  if (details._settleTimer || !details.open) return;
  details._settleTimer = setTimeout(() => {
    details._settleTimer = null;
    if (!details.isConnected) return;
    if (!force && (details.dataset.touched || (!followBottom && detailsInView(details)))) return;
    delete details.dataset.touched;
    setProcessDetails(details, false);
    onClose?.();
  }, SETTLE_DELAY);
}
function setProcessDetails(details, open, animate = true) {
  if (!details) return;
  if (details._motionAnimation && details._motionTarget === open) return;
  details._motionAnimation?.cancel();
  details._motionAnimation = null;
  details._motionTarget = open;
  // 只认自己直接的那层正文：帮手卡片的「帮手 · n 步」里还套着各轮的思绪，不能抓到里头那个去动
  const body = details.querySelector(":scope > .reasoning-body, :scope > .tool-stack-body, :scope > .sub-timeline, :scope > .source-grid");
  details.classList.remove("is-closing");
  if (body) {
    body.style.removeProperty("overflow");
    body.style.removeProperty("will-change");
  }
  if (!body || !animate || inkMotionOff() || typeof body.animate !== "function") {
    details.open = open;
    details._motionTarget = undefined;
    return;
  }
  if (open && details.open) {
    details._motionTarget = undefined;
    return;
  }
  if (!open && !details.open) {
    details._motionTarget = undefined;
    return;
  }
  if (open) details.open = true;
  else details.classList.add("is-closing");
  const height = Math.max(1, body.getBoundingClientRect().height);
  body.style.overflow = "hidden";
  body.style.willChange = "height, opacity, transform";
  const frames = open
    ? [
        { height: "0px", opacity: 0, transform: "translateY(-5px)" },
        { height: `${height}px`, opacity: 1, transform: "translateY(0)" }
      ]
    : [
        { height: `${height}px`, opacity: 1, transform: "translateY(0)" },
        { height: "0px", opacity: 0, transform: "translateY(-5px)" }
      ];
  const animation = body.animate(frames, { duration: open ? 420 : 380, easing: "cubic-bezier(.22,.72,.2,1)", fill: "both" });
  details._motionAnimation = animation;
  animation.onfinish = () => {
    if (details._motionAnimation !== animation) return;
    if (!open) details.open = false;
    details.classList.remove("is-closing");
    body.style.removeProperty("overflow");
    body.style.removeProperty("will-change");
    animation.cancel();
    details._motionAnimation = null;
    details._motionTarget = undefined;
  };
}
// 就地改内容时高度平滑过渡（先量旧高，改完量新高，再从旧高动到新高）：步骤输出的折起摊开、「展开全部」都走这里，
// 别让一块内容凭空出现又凭空消失。动效关掉时直接改
function morphHeight(el, mutate, duration = 360) {
  if (!el || inkMotionOff() || typeof el.animate !== "function") return mutate();
  const from = el.getBoundingClientRect().height;
  mutate();
  const to = el.getBoundingClientRect().height;
  if (Math.abs(to - from) < 2) return;
  el._morph?.cancel();
  el.style.overflow = "hidden";
  const animation = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: "cubic-bezier(.22,.72,.2,1)" });
  el._morph = animation;
  animation.onfinish = animation.oncancel = () => {
    if (el._morph !== animation) return;
    el._morph = null;
    el.style.removeProperty("overflow");
  };
}

  // ---- 04-markdown.js ----
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
  if (window.DOMPurify) {
    // 模型写「下载《x.docx》」时常把链接指向 sandbox:/、file:/// 或一个裸文件名——页面上没有这样的路。
    // 把文件名记在 data-file 上、去掉 href，点击时到卷宗里找同名的那件来下载（见 boot 里的处理）；找不到才说没有
    DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
      if (node.tagName !== "A" || data.attrName !== "href") return;
      const name = localFileName(data.attrValue);
      if (!name) return;
      node.setAttribute("data-file", name);
      data.keepAttr = false;
    });
    DOMPurify.addHook("afterSanitizeAttributes", node => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (node.tagName === "INPUT") node.setAttribute("disabled", "");
    });
  }
}
// 不是网址、末段像个文件名的链接：取出文件名。网址、邮件、页内锚点都不算
function localFileName(href) {
  const raw = String(href || "").trim();
  if (!raw || /^(?:https?|mailto|tel|data|blob):/i.test(raw) || raw.startsWith("#")) return "";
  let name = raw
    .replace(/[?#].*$/, "")
    .split(/[\\/]/)
    .pop();
  try {
    name = decodeURIComponent(name);
  } catch {}
  return /^[^<>:"|?*\u0000-\u001f]+\.[a-z0-9]{1,8}$/i.test(name) ? name : "";
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
// 占位框里的动效在逐帧重画的尾段里会随节点重建从头再来，看着像定住了：把相位记在节点上（负的 animation-delay），重建也接着原来的拍子走
const vizPhase = () => `-${Math.round(performance.now())}ms`;
// 占位框里是一页草图：将要画的东西的底稿——图表是轴、柱与一条折线，流程图是三个框两支箭，网页是一页版式——
// 用淡墨一笔一笔勾出来，勾完停一停、淡去、再勾（pathLength 归一，stroke-dashoffset 从 1 走到 0 就是「画出来」，各笔按 --i 错开）。
// 每来一行，草图上有一笔蘸朱（见 pulseInkStroke，由 paintTail 点）：流着时朱笔此起彼伏，流停了草图只剩自己勾着，看得出还在写还是卡住了
const VIZ_SKETCHES = {
  echarts: [
    "M16 6v56h136",
    "M32 62V42",
    "M52 62V30",
    "M72 62V48",
    "M92 62V20",
    "M112 62V36",
    "M132 62V28",
    "M24 46C40 22 56 50 72 36S104 14 136 24"
  ],
  mermaid: [
    "M10 24h32a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V28a4 4 0 0 1 4-4z",
    "M46 36h14M56 32l4 4-4 4",
    "M64 24h32a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H64a4 4 0 0 1-4-4V28a4 4 0 0 1 4-4z",
    "M100 36h14M110 32l4 4-4 4",
    "M118 24h32a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4h-32a4 4 0 0 1-4-4V28a4 4 0 0 1 4-4z"
  ],
  html: [
    "M8 6h144a3 3 0 0 1 3 3v54a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z",
    "M5 18h150",
    "M12 25h30a2 2 0 0 1 2 2v30a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V27a2 2 0 0 1 2-2z",
    "M52 28h92",
    "M52 36h72",
    "M52 44h84",
    "M52 52h26a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H52a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z"
  ]
};
function pendingSketchHtml(language) {
  const strokes = VIZ_SKETCHES[language] || VIZ_SKETCHES.html;
  return `<svg class="viz-sketch" viewBox="0 0 160 72" aria-hidden="true">${strokes.map((d, i) => `<path d="${d}" pathLength="1" style="--i:${i}"/>`).join("")}</svg>`;
}
// 新来一行：草图上轮到的那一笔蘸一口朱墨，随即褪回淡墨
function pulseInkStroke(pending) {
  const strokes = pending.querySelectorAll(".viz-sketch path");
  if (!strokes.length || inkMotionOff()) return;
  const stroke = strokes[(Number(pending.dataset.lines) || 0) % strokes.length];
  if (typeof stroke.animate !== "function") return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#9b5540";
  stroke.animate([{ stroke: accent, opacity: 0.95, offset: 0.12 }, { stroke: accent, opacity: 0.8, offset: 0.4 }, { offset: 1 }], {
    duration: 900,
    easing: "ease-out"
  });
}
// 尾段每帧整段重画，占位框若跟着重建，虚痕的呼吸每帧都从头来一遍：这里把已在页上的那个占位框留在原处不动，
// 只换它周围的内容；行数变了就让虚痕吸一口墨
function paintTail(tail, html) {
  const live = [...tail.querySelectorAll(".viz-pending")].at(-1);
  if (!live || live.parentNode !== tail) {
    tail.innerHTML = html;
    return;
  }
  const fresh = document.createElement("div");
  fresh.innerHTML = html;
  const next = [...fresh.querySelectorAll(".viz-pending")].at(-1);
  if (!next || next.parentNode !== fresh || next.dataset.vizPending !== live.dataset.vizPending) {
    tail.innerHTML = html;
    return;
  }
  const grew = live.dataset.lines !== next.dataset.lines;
  live.dataset.lines = next.dataset.lines;
  if (grew) pulseInkStroke(live);
  live.setAttribute("aria-label", next.getAttribute("aria-label"));
  for (const node of [...tail.childNodes]) if (node !== live) node.remove();
  const before = [],
    after = [];
  let seen = false;
  for (const node of [...fresh.childNodes]) {
    if (node === next) seen = true;
    else (seen ? after : before).push(node);
  }
  live.before(...before);
  live.after(...after);
}
function codeBlockHtml(text, lang) {
  const language = String(lang || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase(),
    known = !!(window.hljs && language && hljs.getLanguage(language));
  const htmlApp = ["html", "interactive", "app"].includes(language);
  // mermaid / echarts 代码块在页内直接出图；流式尾段尚未闭合时先立一个占位框，框里是将要画的东西的草图（见 pendingSketchHtml）
  if (suppressViz && (htmlApp || language === "mermaid" || language === "echarts")) {
    const lines = String(text || "").split("\n").length;
    return `<div class="viz viz-pending" data-viz-pending="${language}" data-lines="${lines}" style="--phase:${vizPhase()}" role="status" aria-label="${htmlApp ? "交互内容" : "图形"}仍在生成，已写 ${lines} 行"><div class="code-head"><span class="code-lang">${language}</span><span class="viz-pending-signal" aria-hidden="true"></span></div><div class="viz-pending-body" aria-hidden="true">${pendingSketchHtml(htmlApp ? "html" : language)}</div></div>\n`;
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
// 模型写 ECharts option 常见的几处失手，画之前先扶正——否则 ECharts 只抛一句 "reading 'coordinateSystem'"，图就白写了：
// 系列指到不存在的坐标轴 / 坐标轴指到不存在的格子（多图并排时最常见）→ 收到最后一个；系列漏了 type → 按数据形状补
function repairEchartsOption(option) {
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
  return option;
}
function themedEchartsOption(raw, canvas) {
  const option = repairEchartsOption({ ...raw });
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
  // 窄处给单个格子套一份默认边距；多图并排（grid 是数组）的布局是模型算好的，不动——把数组摊进对象会只剩一个格子，系列全找不着坐标系
  if (narrow && !Array.isArray(option.grid))
    option.grid = { top: titleShown ? 94 : 58, left: 12, right: 12, bottom: 28, containLabel: true, ...(option.grid || {}) };
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

  // ---- 05-boot.js ----
// 言 · 桥接连接、启动与全局事件绑定、侧栏
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 页面是不是桥接自己开的（http://127.0.0.1:端口）：是的话桥接一定在，探测失败多半只是首次加载时被大文件挤慢了，该多等、多试
function servedByBridge() {
  return /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/i.test(location.hostname);
}
async function connectBridge(candidates, timeout = 1400) {
  for (const candidate of candidates) {
    // 同源探测：首次打开时浏览器还在拉 vendor 里的几个大文件，引导请求排在后面，1.4 秒不够，给足时间
    const wait = candidate === "" && servedByBridge() ? Math.max(timeout, 8000) : timeout;
    try {
      const response = await fetch(`${candidate}/api/bootstrap`, { signal: AbortSignal.timeout(wait) });
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
// 桥接开的页面却没探到桥接：不急着下「未检测到」的结论，隔几秒再试几次，接上后各处自会刷新
function retryBridgeLater(attempt = 0) {
  if (apiBase !== null || attempt >= 6) return;
  setTimeout(
    async () => {
      if (apiBase !== null) return;
      bridgeRetryAt = 0;
      if (!(await ensureLocalBridge())) retryBridgeLater(attempt + 1);
    },
    Math.min(2000 * 2 ** attempt, 20000)
  );
}
async function ensureLocalBridge() {
  if (apiBase !== null) return true;
  if (Date.now() < bridgeRetryAt) return false;
  bridgeRetryAt = Date.now() + 5000;
  // 桥接开的页面先试同源（端口可能不是默认的 8787），再试默认地址
  const connected = await connectBridge(servedByBridge() ? ["", LOCAL_BRIDGE] : [LOCAL_BRIDGE], 1200);
  if (connected) {
    if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
    renderHeader();
    void refreshArchive();
    if (!$("#settingsModal").classList.contains("hidden")) renderSettings();
    toast("本机桥接已接通，联网可用");
  }
  return connected;
}
function recoverInterruptedMessages() {
  let changed = false;
  for (const conversation of store.conversations)
    for (const message of conversation.messages || [])
      if (message.status === "streaming") {
        message.status = "interrupted";
        message.error = "页面刷新或连接中断，已生成的内容已保留";
        message.interruptedAt = now();
        settleSteps(message, "连接中断");
        changed = true;
      }
  for (const conversation of store.conversations)
    for (const thread of conversation.threads || [])
      for (const message of thread.messages || [])
        if (message.status === "streaming") {
          message.status = message.content ? "stopped" : "error";
          message.error = "页面刷新或连接中断";
          changed = true;
        }
  if (changed) saveStore();
}
async function boot() {
  // 对话主体在 IndexedDB；先把旧 localStorage 数据迁入/把最新快照读回，再接桥接与绘制页面
  await hydrateStore();
  setupMarkdown();
  setupMermaid();
  setupVizObserver();
  const candidates = ["", LOCAL_BRIDGE].filter((value, index, array) => array.indexOf(value) === index);
  await connectBridge(candidates);
  if (apiBase === null) {
    bootstrap.configError = servedByBridge()
      ? "正在连接本机桥接…若始终连不上，请重新运行 start.cmd。"
      : "未检测到本机桥接，当前为浏览器直连。若接口未开放 CORS，请运行 start.cmd 或 VS Code 任务「言：启动模型桥接」。";
    if (servedByBridge()) retryBridgeLater();
  }
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
  recoverInterruptedMessages();
  applyAppearance();
  bindEvents();
  (window.requestIdleCallback || (fn => setTimeout(fn, 800)))(() => void themeSheets());
  void cleanupAttachmentStore();
  void refreshArchive();
  // 侧栏的开合记在本机（不随备份走）：宽屏按上次的来，窄屏一律收起；theme-boot 已按同一记录先把宽度放好，这里接过来
  toggleSidebar(isMobile() || localStorage.getItem("yan-sidebar") === "collapsed");
  delete document.documentElement.dataset.sidebar;
  restorePlace();
  render();
}

function bindEvents() {
  $("#collapseSidebar").onclick = () => toggleSidebar();
  $("#mobileMenu").onclick = () => toggleSidebar(false);
  $("#newChat").onclick = newChat;
  $("#openLibrary").onclick = () => (view === "library" ? closeLibrary() : openLibrary());
  $("#openSettings").onclick = () => openSettings("general");
  $("#closeSettings").onclick = closeSettings;
  $("#settingsModal").addEventListener("click", e => {
    if (e.target === $("#settingsModal")) closeSettings();
  });
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "modelMenu");
    button.setAttribute("aria-expanded", "false");
    button.onclick = e => {
      e.stopPropagation();
      const menu = $("#modelMenu"),
        opening = menu.classList.contains("hidden") || menu.classList.contains("leaving");
      if (menu.parentElement !== button.parentElement) {
        menu.classList.add("hidden");
        menu.classList.remove("leaving", "drop-up");
        button.parentElement.append(menu);
      }
      if (!opening) {
        closeModelMenu();
        return;
      }
      renderModelMenu();
      showNow(menu);
      button.setAttribute("aria-expanded", "true");
      positionModelMenu(button);
    };
  });
  document.addEventListener("click", closeModelMenu);
  $("#themeToggle").onclick = e => switchTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", e.currentTarget);
  window.addEventListener("resize", () => {
    disposeOrphanCharts();
    const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
    if (trigger) positionModelMenu(trigger);
  });
  $("#quotaStatus").onclick = () => openSettings("models");
  document.querySelectorAll(".send-trigger").forEach(button => (button.onclick = sendOrStop));
  document.querySelectorAll(".attach-trigger").forEach(
    button =>
      (button.onclick = event => {
        event.stopPropagation();
        openAttachMenu(button);
      })
  );
  $("#confirmOk").onclick = () => settleConfirm(true);
  $("#confirmCancel").onclick = () => settleConfirm(false);
  $("#confirmModal").addEventListener("click", e => {
    if (e.target === $("#confirmModal")) settleConfirm(false);
  });
  $("#confirmModal").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      settleConfirm(true);
    }
  });
  $("#fileViewerClose").onclick = closeFileViewer;
  $("#fileViewerDownload").onclick = downloadViewerFile;
  $("#fileViewer").addEventListener("click", e => {
    if (e.target.closest("[data-viewer-download]")) return downloadViewerFile();
    if (e.target === $("#fileViewer") || e.target === $("#fileViewerStage")) closeFileViewer();
  });
  $("#imageViewerClose").onclick = closeImageViewer;
  $("#imageViewerDownload").onclick = () => {
    if (imageViewerAttachmentId) void downloadAttachment(imageViewerAttachmentId);
    else if (imageViewerArchivePath) downloadArchiveFile(imageViewerArchivePath);
  };
  $("#imageViewerZoom").onclick = toggleImageViewerZoom;
  $("#imageViewerStage").addEventListener("click", e => {
    if (e.target === $("#imageViewerImage")) toggleImageViewerZoom();
    else if (e.target === $("#imageViewerStage")) closeImageViewer();
  });
  const welcomeInput = $("#welcomeInput"),
    restPlaceholder = welcomeInput.placeholder;
  chatSuggestionsHtml = $("#welcome .suggestions").innerHTML;
  bindSuggestions = () =>
    document.querySelectorAll(".suggestion").forEach(button => {
      const prompt = button.dataset.prompt || button.textContent;
      button.onclick = () => {
        welcomeInput.value = prompt;
        welcomeInput.placeholder = restPlaceholder;
        welcomeInput.classList.remove("previewing");
        grow(welcomeInput);
        persistDraft();
        welcomeInput.focus();
        const start = prompt.indexOf("（"),
          end = start < 0 ? prompt.length : prompt.indexOf("）", start) + 1;
        welcomeInput.setSelectionRange(start < 0 ? prompt.length : start, end);
      };
      // 预览只占一行：取提示词首句并加省略号，不撑高输入框、不推挤按钮
      const preview = `${prompt.split(/\r?\n/)[0].slice(0, 60)}…`;
      button.addEventListener("pointerenter", () => {
        if (welcomeInput.value) return;
        welcomeInput.placeholder = preview;
        welcomeInput.classList.add("previewing");
      });
      button.addEventListener("pointerleave", () => {
        if (welcomeInput.placeholder === preview) {
          welcomeInput.placeholder = restPlaceholder;
          welcomeInput.classList.remove("previewing");
        }
      });
    });
  bindSuggestions();
  [$("#welcomeInput"), $("#chatInput")].forEach(input => {
    input.addEventListener("input", () => {
      grow(input);
      persistDraft();
      renderSendButtons();
    });
    input.addEventListener("keydown", e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey && !touchInput.matches) {
        e.preventDefault();
        const waiting = input.id === "chatInput" && !input.value.trim() ? pendingApprovalHere() : null;
        if (waiting) {
          if (waiting.step.name !== "ask_user") return settleApproval(waiting.step.id, true);
          const bar = $("#approvalBar"),
            page = Number(bar.dataset.page || 0),
            total = bar.querySelectorAll(".ask-q").length;
          if (page < total - 1) return formPage(bar, page + 1);
          const answers = collectForm(bar);
          if (answers?.some(Boolean)) return settleApproval(waiting.step.id, answers);
          return toast("请先在上方作答");
        }
        sendOrStop();
      }
    });
    input.addEventListener("paste", e => {
      const images = Array.from(e.clipboardData?.files || []).filter(file => file.type.startsWith("image/"));
      if (!images.length) return;
      e.preventDefault();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(4);
      void addFiles(
        images.map(
          (file, index) =>
            new File(
              [file],
              `粘贴图片-${stamp}${images.length > 1 ? `-${index + 1}` : ""}.${file.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`,
              { type: file.type }
            )
        )
      );
    });
  });
  $("#fileInput").onchange = handleFiles;
  $("#libraryAdd").onclick = () => $("#libraryFileInput").click();
  $("#libraryFileInput").onchange = async e => {
    await addLibraryFiles(e.target.files);
    e.target.value = "";
  };
  $("#librarySearch").addEventListener("input", e => {
    libraryQuery = e.target.value;
    renderLibrary();
  });
  document.querySelectorAll("[data-library-kind]").forEach(
    button =>
      (button.onclick = () => {
        libraryKind = button.dataset.libraryKind;
        renderLibrary();
      })
  );
  $("#libraryGrid").addEventListener("click", e => {
    const disk = e.target.closest("[data-open-disk-image]");
    if (disk) return openArchiveImage(disk.dataset.openDiskImage, disk);
    const button = e.target.closest("[data-library-action]");
    if (!button) return;
    const path = button.closest("[data-library-disk]")?.dataset.libraryDisk,
      id = button.closest("[data-library-item]")?.dataset.libraryItem,
      action = button.dataset.libraryAction;
    if (path) {
      if (action === "view") void openFileViewer(path, "", button);
      else if (action === "place") void placeFromArchive(path);
      else if (action === "download") downloadArchiveFile(path);
      else if (action === "remove") void removeArchiveFile(path);
      return;
    }
    if (action === "place") placeFromLibrary(id);
    else if (action === "view")
      void openFileViewer({ attachmentId: id }, button.closest(".library-card")?.querySelector("strong")?.textContent || "", button);
    else if (action === "download") void downloadAttachment(id);
    else if (action === "remove") void removeFromLibrary(id);
  });
  $("#libraryGrid").addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target.matches?.("[data-open-disk-image]")) return;
    e.preventDefault();
    openArchiveImage(e.target.dataset.openDiskImage, e.target);
  });
  let dragHideTimer = null,
    dragFromPage = false;
  // 拖的是页面里自己的东西（卷宗里的图、案上的附件、答里的图片）时浏览器也会把它当文件拖入：
  // 松手就又收一份进卷宗。页内起手的拖动一概不接——卷宗可能绑着用户自己的目录，里面本就允许有重样的文件，不能靠查重来挡
  window.addEventListener("dragstart", () => (dragFromPage = true));
  window.addEventListener("dragend", () => (dragFromPage = false));
  const hasDraggedFiles = event => !dragFromPage && Array.from(event.dataTransfer?.types || []).includes("Files");
  const showDropVeil = () => {
    clearTimeout(dragHideTimer);
    const toLibrary = view === "library";
    $("#dropTitle").textContent = toLibrary ? "松手，收入卷宗" : "松手，置于案上";
    $("#dropHint").textContent = toLibrary
      ? archiveOnline()
        ? "任何文件 · 落到本机的卷宗目录"
        : `图片、文档与代码文件 · 单件不超过 ${limitLabel(MAX_FILE_BYTES)}`
      : `图片、文档与代码文件 · 单次共 ${limitLabel(MAX_PENDING_BYTES)}`;
    $("#dropVeil").classList.remove("hidden");
  };
  const hideDropVeil = () => {
    clearTimeout(dragHideTimer);
    $("#dropVeil").classList.add("hidden");
  };
  window.addEventListener("dragenter", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    showDropVeil();
  });
  window.addEventListener("dragover", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    showDropVeil();
  });
  window.addEventListener("dragleave", event => {
    if (!hasDraggedFiles(event)) return;
    dragHideTimer = setTimeout(hideDropVeil, 80);
  });
  window.addEventListener("drop", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    hideDropVeil();
    void (view === "library" ? addLibraryFiles : addFiles)(event.dataTransfer.files);
  });
  $("#historySearch").addEventListener("input", e => {
    historyQuery = e.target.value;
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(renderHistory, 120);
  });
  $("#historySearch").addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.stopPropagation();
      toggleHistorySearch(false);
    }
  });
  $("#historySearchToggle").onclick = () => toggleHistorySearch();
  $("#historySearchClose").onclick = () => toggleHistorySearch(false);
  $("#history").addEventListener("dblclick", e => {
    const item = e.target.closest("[data-conversation]");
    if (item && !e.target.closest(".history-rename, [data-history-action]")) startRename(item.dataset.conversation);
  });
  $("#history").addEventListener("click", e => {
    const toggle = e.target.closest("[data-repo-toggle]");
    if (toggle) {
      const dir = toggle.dataset.repoToggle,
        set = new Set(store.settings.collapsedRepos || []);
      set.has(dir) ? set.delete(dir) : set.add(dir);
      store.settings.collapsedRepos = [...set];
      saveStoreSoon();
      renderHistory();
      return;
    }
    const repo = e.target.closest("[data-history-workdir]");
    if (repo) {
      store.settings.pendingWorkdir = repo.dataset.historyWorkdir;
      saveStore();
      newChat();
      return;
    }
    const item = e.target.closest("[data-conversation]");
    if (!item) return;
    const id = item.dataset.conversation,
      action = e.target.closest("[data-history-action]")?.dataset.historyAction;
    if (action === "menu") {
      e.stopPropagation();
      openHistoryMenu(id, e.target.closest("[data-history-action]"));
    } else if (!e.target.closest(".history-rename")) openConversation(id);
  });
  $("#history").addEventListener("keydown", e => {
    const input = e.target.closest(".history-rename");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(input.value);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      renamingId = null;
      renderHistory();
    }
  });
  $("#history").addEventListener("focusout", e => {
    const input = e.target.closest(".history-rename");
    if (input && renamingId) commitRename(input.value);
  });
  const title = $("#chatTitle");
  let titleBefore = "";
  title.addEventListener("focus", () => {
    titleBefore = title.textContent;
  });
  title.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      title.textContent = titleBefore;
      title.blur();
    }
  });
  title.addEventListener("blur", () => {
    const c = currentConversation();
    if (!c) return;
    const value = title.textContent.replace(/\s+/g, " ").trim();
    if (value && value !== c.title) renameConversation(c.id, value);
    else title.textContent = c.title;
  });
  $("#modelMenu").addEventListener("click", e => {
    const level = e.target.closest("[data-reasoning]");
    if (level) {
      e.stopPropagation();
      const c = currentConversation();
      if (c) c.reasoning = level.dataset.reasoning;
      else store.settings.reasoning = level.dataset.reasoning;
      saveStore();
      renderModelMenu();
      renderModelTriggers();
      const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
      if (trigger) positionModelMenu(trigger);
      return;
    }
    const item = e.target.closest("[data-profile]");
    if (!item) return;
    selectProfile(item.dataset.profile);
    // 这个模型还没探过认哪几档：探一下，发送键旁的标签与菜单跟着换（探不成就按通用四档，撞了错再学）
    const picked = activeProfile();
    if (picked && !reasoningProbed(picked))
      void probeReasoningLevels(picked).then(levels => {
        if (levels === null || activeProfile() !== picked) return;
        renderModelTriggers();
        if ($("#modelMenu")?.classList.contains("hidden") === false) renderModelMenu();
      });
  });
  $("#messages").addEventListener("click", handleMessageAction);
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !e.target.classList?.contains("message-edit-input")) return;
    e.preventDefault();
    e.target.closest(".message-editor")?.querySelector('[data-action="save-edit"]')?.click();
  });
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-approve]");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      return approveFrom(button);
    }
    // 差遣的签不在此列：点它是去右侧开面板，不是折叠（见下面的 openHelperPanel）
    const head = event.target.closest(".tool-step.foldable > .tool-step-head");
    if (!head || event.target.closest("a, button")) return;
    const el = head.parentElement,
      c = currentConversation(),
      step =
        c &&
        allMessages(c)
          .flatMap(m => allSteps(m))
          .find(s => s.id === el.dataset.stepId);
    // 指令输出默认折起，开合记在步骤上，重画不丢
    const wasFolded = el.classList.contains("folded");
    if (step) step.expanded = wasFolded;
    morphHeight(el, () => el.classList.toggle("folded", !wasFolded));
    head.title = wasFolded ? "收起输出" : "展开输出";
    saveStoreSoon();
  });
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-step-more]");
    if (!button) return;
    const el = button.closest(".tool-step"),
      c = currentConversation(),
      step =
        c &&
        allMessages(c)
          .flatMap(m => allSteps(m))
          .find(s => s.id === el?.dataset.stepId);
    if (!step) return;
    step.full = !step.full;
    step.expanded = true;
    saveStoreSoon();
    // 节点留在原处只换内容，高度才好从旧高动到新高
    const fresh = document.createElement("div");
    fresh.innerHTML = stepHtml(step);
    const next = fresh.firstElementChild;
    morphHeight(el, () => {
      el.className = next.className;
      el.innerHTML = next.innerHTML;
    });
  });
  // 出处也是一块可开合的，与思绪、行迹同一种开合
  $("#messages").addEventListener("click", event => {
    const summary = event.target.closest(".source-stack > summary");
    if (!summary) return;
    event.preventDefault();
    const details = summary.parentElement;
    setProcessDetails(details, details._motionAnimation ? !details._motionTarget : !details.open);
  });
  $("#approvalBar").addEventListener("click", event => {
    const bar = $("#approvalBar"),
      button = event.target.closest("[data-approve]");
    if (button) {
      event.preventDefault();
      return approveFrom(button);
    }
    const opt = event.target.closest(".ask-opt");
    if (opt) {
      const block = opt.closest(".ask-q"),
        on = opt.getAttribute("aria-checked") === "true",
        single = block.dataset.multi !== "true";
      if (single) {
        // 单选：选项与「自行填写」二选一——点了选项就清掉填的字，反之亦然（见下面的 input 监听）
        block.querySelectorAll(".ask-opt").forEach(b => b.setAttribute("aria-checked", "false"));
        const other = block.querySelector(".ask-other");
        if (other && !on) other.value = "";
      }
      opt.setAttribute("aria-checked", on ? "false" : "true");
      return;
    }
    const form = event.target.closest("[data-form]");
    if (!form || !bar.dataset.stepId) return;
    event.preventDefault();
    if (form.dataset.form === "prev" || form.dataset.form === "next")
      return formPage(bar, Number(bar.dataset.page || 0) + (form.dataset.form === "next" ? 1 : -1));
    const answers = form.dataset.form === "submit" ? collectForm(bar) : false;
    settleApproval(bar.dataset.stepId, answers && answers.some(Boolean) ? answers : false);
  });
  $("#messages").addEventListener(
    "scroll",
    event => {
      const body = event.target;
      if (body?.classList?.contains("reasoning-body")) body._follow = body.scrollTop + body.clientHeight >= body.scrollHeight - 24;
    },
    true
  );
  $("#approvalBar").addEventListener("input", event => {
    if (!event.target.classList.contains("ask-other")) return;
    const block = event.target.closest(".ask-q");
    if (block?.dataset.multi !== "true" && event.target.value.trim())
      block.querySelectorAll(".ask-opt").forEach(b => b.setAttribute("aria-checked", "false"));
  });
  $("#approvalBar").addEventListener("keydown", event => {
    if (event.key !== "Enter" || !event.target.classList.contains("ask-other")) return;
    event.preventDefault();
    const bar = $("#approvalBar"),
      page = Number(bar.dataset.page || 0),
      total = bar.querySelectorAll(".ask-q").length;
    if (page < total - 1) return formPage(bar, page + 1);
    const answers = collectForm(bar);
    if (answers && answers.some(Boolean)) settleApproval(bar.dataset.stepId, answers);
  });
  $("#messages").addEventListener("click", event => {
    const summary = event.target.closest(".change-summary");
    if (!summary) return;
    const files = summary.parentElement.querySelector(".change-files"),
      open = files.classList.toggle("hidden");
    summary.setAttribute("aria-expanded", String(!open));
  });
  // 帮手条点一下开差遣面板：帮手的活在右边看，行迹里只留一枚签
  $("#helperBar").addEventListener("click", event => {
    const id = event.target.closest(".helper-row")?.dataset.helper || $("#helperBar").dataset.stepId || "";
    if (id) openHelperPanel(id);
  });
  // 行迹里的那枚签：点它（或敲回车 / 空格）同样开面板
  $("#messages").addEventListener("click", event => {
    const head = event.target.closest(".tool-step-delegate > .tool-step-head");
    if (head) openHelperPanel(head.parentElement.dataset.stepId || "");
  });
  $("#messages").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const head = event.target.closest?.(".tool-step-delegate > .tool-step-head");
    if (!head) return;
    event.preventDefault();
    openHelperPanel(head.parentElement.dataset.stepId || "");
  });
  // 合起即回到行迹里那一步——原先「合」与「行迹」两个按钮做的本是同一件事
  $("#helperClose").onclick = () => {
    const id = helperStepId;
    closeHelperPanel();
    const card = document.querySelector(`#messages .tool-step-delegate[data-step-id="${CSS.escape(id || "")}"]`);
    if (!card) return;
    const stack = card.closest(".tool-stack");
    if (stack && !stack.open) setProcessDetails(stack, true);
    scrollChatTo(card, "center");
  };
  // 点遮罩、按 Esc 都关得掉，与设置、文件查看器一个脾气。纸张之外的空白由 .helper-stage 铺满，点在它上面也算点了遮罩；
  // 按下与松开都得落在空白处——在纸上选字、拖到纸外松手，click 会落到两者的共同祖先上，那不是要关窗
  const helperBackdrop = target => target === $("#helperModal") || target === $("#helperScroll");
  let helperPressedBackdrop = false;
  $("#helperModal").addEventListener("pointerdown", event => {
    helperPressedBackdrop = helperBackdrop(event.target);
  });
  $("#helperModal").addEventListener("click", event => {
    if (helperPressedBackdrop && helperBackdrop(event.target)) closeHelperPanel();
    helperPressedBackdrop = false;
  });
  // ‹ › 翻帮手；中间的计数点开是一张列表——帮手多了一个个翻就难受
  $("#helperNav").addEventListener("click", event => {
    const move = event.target.closest("[data-helper-step]")?.dataset.helperStep;
    if (move) return stepHelperPanel(Number(move));
    if (event.target.closest("[data-helper-list]")) {
      const list = $("#helperList");
      list.classList.toggle("hidden");
      if (!list.classList.contains("hidden")) renderHelperList();
    }
  });
  $("#helperList").addEventListener("click", event => {
    const id = event.target.closest("[data-helper-pick]")?.dataset.helperPick;
    if (id) openHelperPanel(id);
  });
  // 输入框上方多了请示条、帮手条与改动摘要，正文底部留白随之增减，末句不被盖住
  if ("ResizeObserver" in window)
    new ResizeObserver(() => {
      const area = $("#composerArea");
      if (area && !area.classList.contains("hidden")) {
        $("#chatScroll").style.paddingBottom = `${area.offsetHeight + 16}px`;
        document.documentElement.style.setProperty("--composer-h", `${area.offsetHeight}px`);
        syncChatScrollGrabber();
      }
    }).observe($("#composerArea"));
  $("#workAuto").onclick = () => {
    const c = currentConversation();
    if (!c) return;
    c.commandPolicy = nextCommandPolicy(commandPolicyOf(c));
    saveStore();
    renderWorkAuto();
    if (c.commandPolicy !== "ask")
      for (const [stepId, entry] of pendingApprovals) if (entry.conversationId === c.id) settleApproval(stepId, true);
  };
  setupChips();
  setupQuoteTip();
  setupSidePanel();
  $("#composerQuoteClose").onclick = () => {
    pendingQuote = null;
    renderQuote();
    persistDraft();
    $("#chatInput").focus();
  };
  $("#messages").addEventListener("click", event => {
    const block = event.target.closest(".user-quote");
    if (!block) return;
    const source =
      block.dataset.quoteSource && document.querySelector(`#messages [data-message="${CSS.escape(block.dataset.quoteSource)}"]`);
    if (!source) return toast("出处已不在当前页面");
    followBottom = false;
    scrollChatTo(source, "center");
    source.classList.remove("flash");
    void source.offsetWidth;
    source.classList.add("flash");
  });
  // 思绪与行迹的开合：正文、旁注面板与差遣面板同一套——用户亲手开合的记在消息上，流式期间的自动开合就不再替他动
  const onProcessToggle = event => {
    const summary = event.target.closest(".reasoning > summary, .tool-stack > summary");
    if (!summary) return;
    event.preventDefault();
    const details = summary.parentElement;
    const nextOpen = details._motionAnimation ? !details._motionTarget : !details.open;
    // 用户亲手动了，程序排着的那次自动收起作废
    clearTimeout(details._settleTimer);
    details._settleTimer = null;
    // 时间线里各轮的思绪与帮手各轮的步骤不记在消息上；用户开合过的记一笔，就地更新时不再替它开合
    if (details.classList.contains("trail-reasoning") || details.classList.contains("sub-steps")) {
      details.dataset.touched = "1";
      return setProcessDetails(details, nextOpen);
    }
    const id = details.closest("[data-message]")?.dataset.message,
      side = !!details.closest("#sideMessages");
    const message = (side ? currentThread()?.messages : currentConversation()?.messages)?.find(item => item.id === id);
    if (!message) return setProcessDetails(details, nextOpen);
    const reasoning = details.classList.contains("reasoning");
    message[reasoning ? "reasoningTouched" : "toolsTouched"] = true;
    message[reasoning ? "reasoningOpen" : "toolsOpen"] = nextOpen;
    saveStoreSoon();
    setProcessDetails(details, nextOpen);
  };
  $("#messages").addEventListener("click", onProcessToggle);
  $("#sideMessages").addEventListener("click", onProcessToggle);
  $("#helperPanelBody").addEventListener("click", onProcessToggle);
  document.addEventListener("click", e => {
    const copy = e.target.closest("[data-copy-code]");
    if (copy) {
      void copyText(copy.closest(".code-block, .viz, .html-app")?.querySelector("code")?.textContent || "");
      copy.textContent = "已复制";
      setTimeout(() => (copy.textContent = "复制"), 1200);
      return;
    }
    const vizToggle = e.target.closest("[data-viz-toggle]");
    if (vizToggle) {
      const viz = vizToggle.closest(".viz"),
        source = viz.querySelector(".viz-source"),
        showSource = source.classList.contains("hidden");
      source.classList.toggle("hidden", !showSource);
      viz.querySelector(".viz-canvas").classList.toggle("hidden", showSource);
      vizToggle.textContent = showSource ? "图形" : "源码";
      return;
    }
    const vizDownload = e.target.closest("[data-viz-download]");
    if (vizDownload) {
      downloadVisualization(vizDownload.closest(".viz"));
      return;
    }
    const appToggle = e.target.closest("[data-app-toggle]");
    if (appToggle) {
      const app = appToggle.closest(".html-app"),
        source = app.querySelector(".html-app-source"),
        showSource = source.classList.contains("hidden");
      source.classList.toggle("hidden", !showSource);
      app.querySelector(".html-app-stage").classList.toggle("hidden", showSource);
      appToggle.textContent = showSource ? "预览" : "源码";
      return;
    }
    const appRestart = e.target.closest("[data-app-restart]");
    if (appRestart) {
      mountHtmlApp(appRestart.closest(".html-app"));
      return;
    }
    const appDownload = e.target.closest("[data-app-download]");
    if (appDownload) {
      downloadText(htmlAppSource(appDownload.closest(".html-app")), "text/html;charset=utf-8", "言-交互作品.html");
      return;
    }
    const expand = e.target.closest("[data-work-expand]");
    if (expand) {
      toggleWorkExpanded(expand.closest(".viz, .html-app"), expand);
      return;
    }
    const remove = e.target.closest("[data-remove-attachment]");
    if (remove) {
      const [file] = pendingAttachments.splice(Number(remove.dataset.removeAttachment), 1);
      persistDraft();
      void deleteAttachments([file?.id]);
      renderAttachments();
      return;
    }
    const save = e.target.closest("[data-save-attachment]");
    if (save) {
      void saveToLibrary(save.dataset.saveAttachment);
      return;
    }
    const preview = e.target.closest("[data-open-image]");
    if (preview) {
      void openImageViewer(preview.dataset.openImage, preview);
      return;
    }
    const open = e.target.closest("[data-open-attachment]");
    if (open) {
      void openFileViewer({ attachmentId: open.dataset.openAttachment }, open.dataset.name || "", open);
      return;
    }
    const download = e.target.closest("[data-download-attachment]");
    if (download) void downloadAttachment(download.dataset.downloadAttachment);
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches?.("[data-open-image]")) {
      e.preventDefault();
      void openImageViewer(e.target.dataset.openImage, e.target);
    } else if (e.target.matches?.("[data-open-attachment]")) {
      e.preventDefault();
      void openFileViewer({ attachmentId: e.target.dataset.openAttachment }, e.target.dataset.name || "", e.target);
    } else if (e.target.matches?.("[data-download-attachment]")) {
      e.preventDefault();
      void downloadAttachment(e.target.dataset.downloadAttachment);
    }
  });
  document.querySelectorAll(".tab-btn").forEach(
    button =>
      (button.onclick = () => {
        settingsTab = button.dataset.tab;
        renderSettings();
      })
  );
  window.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    // 图片查看器盖在卷宗预览之上，先收它；CSV、Markdown、PDF 这些预览单独开着时，Esc 也得关得掉
    if (!$("#imageViewer").classList.contains("hidden")) {
      closeImageViewer();
      closeFileViewer();
      return;
    }
    if ($("#fileViewer") && !$("#fileViewer").classList.contains("hidden")) {
      closeFileViewer();
      return;
    }
    const expanded = document.querySelector(".work-expanded");
    if (expanded) {
      closeExpandedWork();
      return;
    }
    // 差遣那扇窗盖在正文上，Esc 先收它
    if (helperPanelOpen()) {
      if (!$("#helperList").classList.contains("hidden")) return $("#helperList").classList.add("hidden");
      closeHelperPanel();
      return;
    }
    closeModelMenu();
    if (confirmResolve) settleConfirm(false);
    else if (!$("#settingsModal").classList.contains("hidden")) closeSettings();
    else if (editingMessageId) {
      editingMessageId = null;
      renderConversation(false);
      if (sidePanelOpen()) renderSidePanel();
    } else if (sidePanelOpen()) closeSidePanel();
    else if (pendingQuote && document.activeElement === $("#chatInput") && !$("#chatInput").value) {
      pendingQuote = null;
      renderQuote();
      persistDraft();
    }
  });
  // 跟随的规矩：往下滚到离底不远就算到底、开始跟随（生成中内容一直在长，硬要滚到最后一像素常常追不上）；
  // 往上滚离底超过阈值才算离开。内容自己长高、缩短引起的滚动不算用户的意思
  let lastScrollTop = 0;
  $("#chatScroll").addEventListener("scroll", () => {
    const el = $("#chatScroll"),
      gap = el.scrollHeight - el.scrollTop - el.clientHeight,
      down = el.scrollTop > lastScrollTop;
    lastScrollTop = el.scrollTop;
    if (gap < 8 || (down && gap < FOLLOW_THRESHOLD)) {
      followBottom = true;
      autoScrolling = false;
    } else if (!down && !autoScrolling && gap > FOLLOW_THRESHOLD) followBottom = false;
    syncJumpBottom(gap);
    syncOutline();
  });
  // 跟着的时候，内容不论因何长高（工具输出、图表成图、图片载入、块的开合）都贴着底：不只靠流式的每一帧
  if (typeof ResizeObserver === "function")
    new ResizeObserver(() => {
      if (followBottom && view === "chat" && currentId) scrollBottom();
      syncChatScrollGrabber();
    }).observe($("#messages"));
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-toggle-compacted]");
    if (!button) return;
    const c = currentConversation();
    if (!c) return;
    c.showCompacted = !c.showCompacted;
    foldCompacted(c);
    renderOutline();
    if (!c.showCompacted) scrollChatTo(button.closest(".context-divider"), "center");
  });
  // 正文里指向本地文件的链接（模型写的「下载《x.docx》」）：页面上没有那样的路，到卷宗里找同名的那件来下载
  document.addEventListener("click", async event => {
    const link = event.target.closest(".markdown a[data-file]");
    if (!link) return;
    event.preventDefault();
    const name = link.dataset.file;
    if (!archiveOnline()) return toast(`链接无处可去：「${name}」不在卷宗里`);
    if (archiveEntries === null) await refreshArchive();
    const entry = (archiveEntries || []).find(file => file.name === name || file.path === name);
    if (!entry) return toast(`卷宗里没有「${name}」`);
    downloadArchiveFile(entry.path);
  });
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-deliver-action]");
    if (!button) return;
    const path = button.closest("[data-deliver]")?.dataset.deliver;
    if (!path) return;
    if (deliverableMissing(path)) return toast("这件已从卷宗移除");
    if (button.dataset.deliverAction === "download") downloadArchiveFile(path);
    else void openFileViewer(path, "", button);
  });
  $("#outline").addEventListener("click", event => {
    const item = event.target.closest(".outline-item");
    if (item) jumpToOutline(item.dataset.target);
  });
  $("#contextGauge").addEventListener("click", event => {
    event.stopPropagation();
    openContextMenu(event.currentTarget);
  });
  $("#chatInput").addEventListener("input", () => scheduleContextGauge());
  $("#chatScroll").addEventListener(
    "wheel",
    e => {
      if (e.deltaY < 0) followBottom = false;
    },
    { passive: true }
  );
  $("#chatScroll").addEventListener(
    "pointerdown",
    () => {
      autoScrolling = false;
    },
    { passive: true }
  );
  // 右侧透明命中层把细滚动条的可抓宽度放大，也越过输入框覆盖区一直延伸到底部。
  // 按下轨道会把滑块移到指针处；按住近似滑块则保留抓取点，拖动手感与原生滚动条一致。
  const scrollGrabber = $("#chatScrollGrabber"),
    chatScroll = $("#chatScroll");
  let scrollDrag = null;
  const scrollGeometry = () => {
    const max = Math.max(0, chatScroll.scrollHeight - chatScroll.clientHeight),
      track = chatScroll.clientHeight,
      thumb = Math.min(track, Math.max(28, (track * track) / Math.max(chatScroll.scrollHeight, 1)));
    return { rect: chatScroll.getBoundingClientRect(), max, track, thumb, travel: Math.max(1, track - thumb) };
  };
  const moveScrollGrabber = event => {
    if (!scrollDrag || event.pointerId !== scrollDrag.pointerId) return;
    const geometry = scrollGeometry(),
      pointer = Math.max(0, Math.min(geometry.track, event.clientY - geometry.rect.top));
    chatScroll.scrollTop = Math.max(
      0,
      Math.min(geometry.max, ((pointer - scrollDrag.offset) / geometry.travel) * geometry.max)
    );
  };
  const stopScrollGrabber = event => {
    if (!scrollDrag || event.pointerId !== scrollDrag.pointerId) return;
    try {
      scrollGrabber.releasePointerCapture(event.pointerId);
    } catch {}
    scrollDrag = null;
  };
  scrollGrabber.addEventListener("pointerdown", event => {
    const geometry = scrollGeometry();
    if (event.button !== 0 || !geometry.max || getComputedStyle(chatScroll).overflowY === "hidden") return;
    event.preventDefault();
    autoScrolling = false;
    followBottom = false;
    const pointer = Math.max(0, Math.min(geometry.track, event.clientY - geometry.rect.top)),
      thumbTop = (chatScroll.scrollTop / geometry.max) * geometry.travel,
      withinThumb = pointer >= thumbTop && pointer <= thumbTop + geometry.thumb;
    scrollDrag = {
      pointerId: event.pointerId,
      offset: withinThumb ? pointer - thumbTop : geometry.thumb / 2
    };
    try {
      scrollGrabber.setPointerCapture(event.pointerId);
    } catch {}
    moveScrollGrabber(event);
  });
  scrollGrabber.addEventListener("pointermove", moveScrollGrabber);
  scrollGrabber.addEventListener("pointerup", stopScrollGrabber);
  scrollGrabber.addEventListener("pointercancel", stopScrollGrabber);
  scrollGrabber.addEventListener(
    "wheel",
    event => {
      if (!scrollGrabber.classList.contains("active")) return;
      const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? chatScroll.clientHeight : 1;
      if (event.deltaY < 0) followBottom = false;
      chatScroll.scrollTop += event.deltaY * scale;
      event.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener("pagehide", () => {
    persistDraft();
    saveStore();
  });
  window.addEventListener("offline", () => setConnection("error", "连接中断"));
  window.addEventListener("online", refreshConnection);
  window.addEventListener("message", event => {
    const data = event.data;
    if (!data || !["yan-preview-ready", "yan-preview-state"].includes(data.type)) return;
    const app = [...document.querySelectorAll(".html-app[data-app-id]")].find(
      el => el.dataset.appId === data.id && el.querySelector("iframe")?.contentWindow === event.source
    );
    if (!app) return;
    if (data.type === "yan-preview-ready") return sendHtmlApp(app);
    app.dataset.appState = data.state;
    app.classList.toggle("html-app-error", data.state === "error");
    const label = app.querySelector(".code-lang");
    if (label) {
      label.textContent = data.state === "error" ? "html · 运行有误" : "html · 可交互";
      label.title = data.detail || "";
    }
    if (data.state === "ready" && followBottom) requestAnimationFrame(scrollBottom);
  });
  let wasMobile = isMobile();
  window.addEventListener("resize", () => {
    const mobile = isMobile();
    if (mobile && !wasMobile) toggleSidebar(true);
    wasMobile = mobile;
    syncScrim();
    syncChatScrollGrabber();
  });
  $("#sidebarScrim").onclick = () => toggleSidebar(true);
  // 生成时向上翻阅后，给一枚「回到最新」；贴近底部自动隐去
  $("#jumpBottom").onclick = () => {
    const el = $("#chatScroll");
    followBottom = true;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion.matches ? "instant" : "smooth" });
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (store.settings.theme === "system") {
      applyAppearance();
      if (view === "chat") renderConversation(false);
    }
  });
  reducedMotion.addEventListener?.("change", () => {
    if (store.settings.inkMotion === "system") applyAppearance();
  });
}

function syncScrim() {
  $("#sidebarScrim").classList.toggle("hidden", !isMobile() || $("#sidebar").classList.contains("collapsed"));
}
function toggleSidebar(force) {
  const sidebar = $("#sidebar"),
    collapsed = force ?? !sidebar.classList.contains("collapsed");
  sidebar.classList.toggle("collapsed", collapsed);
  if (!isMobile())
    try {
      localStorage.setItem("yan-sidebar", collapsed ? "collapsed" : "open");
    } catch {}
  syncScrim();
  const button = $("#collapseSidebar");
  button.textContent = collapsed ? "›" : "‹";
  button.title = collapsed ? "展开侧栏" : "收起侧栏";
}
function toggleHistorySearch(force) {
  const wrap = $("#historySearchWrap"),
    show = force ?? wrap.classList.contains("hidden");
  wrap.classList.toggle("hidden", !show);
  $("#historySearchToggle").classList.toggle("active", show);
  if (show) setTimeout(() => $("#historySearch").focus(), 0);
  else {
    clearTimeout(historySearchTimer);
    if (historyQuery) {
      historyQuery = "";
      $("#historySearch").value = "";
      renderHistory();
    }
  }
}
// 执事 / 对谈：模式跟着正在看的对话走；「翻页」按当前模式新起一段

  // ---- 06-mode-welcome.js ----
// 言 · 言 / 行两态、欢迎页与目录签、开合对话
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 言与行不是两个入口，而是一段对话有没有绑工作目录：绑了就是行（执事，改动落在那个目录，提示词也是执事的做法）；
// 没绑就是言（对谈，文件工具落在卷宗，电脑检查另有固定只读探针）。目录可以在对话中途绑上或解开，上下文不断
/** @param {Conversation} c */
function isWork(c) {
  return !!c?.workdir;
}
// 沙箱：言与行都套着——桥接那头筛指令、锁目录、去机密环境变量。只有设置 → 工具里一个总开关，默认开
function sandboxed() {
  return store.settings.sandbox !== false;
}
function workMode() {
  const c = currentConversation();
  return c ? isWork(c) : !!(store.settings.pendingWorkdir || "").trim();
}
// 卷宗目录：设置里改过就用改过的，否则桥接给的默认位置；没绑目录的对话，工具都落在这里
function archiveDir() {
  if (apiBase === null) return "";
  return (store.settings.archiveDir || "").trim() || bootstrap.work?.archive || "";
}
// 言里的草稿：卷宗下的隐藏目录 .草稿/<对话id>/，脚本与中间文件放那里，成品放根目录；卷宗页不列它
/** @param {Conversation} c */
function scratchRel(c) {
  return `${bootstrap.work?.scratch || ".草稿"}/${String(c.id)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 12)}`;
}
// 这段对话的工具落脚在哪：绑了目录是它，没绑是卷宗；直连没桥接时为空（也就没有文件工具）
/** @param {Conversation} c */
function workRoot(c) {
  return c?.workdir || (apiBase !== null ? archiveDir() : "");
}
// 侧栏的一枚印：只显示当前的态（言 / 行），改态的入口是目录签
function renderModeSwitch() {
  const work = workMode(),
    seal = $("#modeSeal");
  if (!seal) return;
  seal.dataset.mode = work ? "work" : "chat";
  seal.querySelector(".rail-icon").textContent = work ? "行" : "言";
  seal.querySelector(".wide").textContent = work ? "执事" : "对谈";
  seal.title = work ? "行 · 执事：指令与改动落在工作目录" : "言 · 对谈：产出收入卷宗";
}
const COMMAND_POLICY_META = {
  ask: ["问而后行", "明确只读的指令径直运行，其余先经确认"],
  review: ["审而后行", "桥接代为审过：常规改动与整机查看放行，明确的高风险动作当场回绝，不来打扰"],
  auto: ["径行", "不再审查；沙箱开着时仍守着它那道界"]
};
function commandPolicyOf(c) {
  return normalizeCommandPolicy(c?.commandPolicy, normalizeCommandPolicy(store.settings.commandPolicyDefault));
}
function nextCommandPolicy(value) {
  return { ask: "review", review: "auto", auto: "ask" }[normalizeCommandPolicy(value)];
}
// 三档权限：言与行都可逐段对话设置；按钮循环切换，设置页决定新对话默认值
function renderWorkAuto() {
  const c = currentConversation(),
    button = $("#workAuto");
  if (!button) return;
  const show = !!c && !!workRoot(c) && activeProfile()?.tools !== false;
  button.classList.toggle("hidden", !show);
  if (!show) return;
  const policy = commandPolicyOf(c),
    meta = COMMAND_POLICY_META[policy];
  button.textContent = meta[0];
  button.title = `${meta[0]}：${meta[1]}`;
  button.classList.toggle("on", policy !== "ask");
}
function renderWelcome() {
  const work = workMode(),
    bridged = apiBase !== null;
  $("#welcome .seal").textContent = work ? "行" : "言";
  $("#welcomeSub").textContent = work ? "以目录为案，言起而事行" : "长问慢答，尽付纸墨";
  renderChips(work, bridged);
  renderSuggestions(work);
  renderWelcomeNotice();
}
// 首次使用：还没有任何模型配置时，在输入框下给一行引导，而不是等到发送时才弹提示
function renderWelcomeNotice() {
  const el = $("#welcomeNotice");
  if (!el) return;
  const none = !profiles().length;
  el.classList.toggle("hidden", !none);
  if (!none) return;
  el.innerHTML = `<span class="seal" aria-hidden="true">始</span><span>尚未接入模型。任何 OpenAI 兼容接口均可使用，配置只存于此浏览器。</span><button type="button" data-open-models>前往设置 →</button>`;
  el.querySelector("[data-open-models]").onclick = () => openSettings("models");
}
// 欢迎页输入框上方的一行小签：目录签（空着是言、落在卷宗；填了是行）、新对话的三档指令权限
function pathTail(dir) {
  const parts = String(dir || "")
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts.at(-1) || dir;
}
function renderChips(work, bridged) {
  const dirChip = $("#workdirChip"),
    pending = (store.settings.pendingWorkdir || "").trim();
  dirChip.classList.remove("hidden");
  dirChip.querySelector(".chip-text").textContent = pending ? pathTail(pending) : bridged ? "卷宗" : "未绑定";
  dirChip.title = pending
    ? `${pending}\n行：指令与改动落在此目录`
    : bridged
      ? `言：产出收入卷宗（${archiveDir()}）`
      : "言：绑定目录与生成文件需本机桥接（start.cmd）";
  dirChip.classList.toggle("on", !!pending);
  const approve = $("#approveChip");
  const policy = normalizeCommandPolicy(store.settings.commandPolicyDefault),
    meta = COMMAND_POLICY_META[policy];
  approve.classList.toggle("hidden", !bridged);
  approve.querySelector(".chip-text").textContent = meta[0];
  approve.classList.toggle("on", policy !== "ask");
  approve.title = `${meta[0]}：${meta[1]}（新对话默认）`;
}
function closeChipPop() {
  document.querySelectorAll(".chip-pop").forEach(pop => pop.remove());
}
function openChipPop(anchor, host, html) {
  closeChipPop();
  const pop = document.createElement("div");
  pop.className = "chip-pop";
  pop.innerHTML = html;
  pop.style.left = `${anchor.offsetLeft}px`;
  host.append(pop);
  return pop;
}
// 浮层菜单：挂在 body 上、按锚点定位（fixed），不受侧栏与输入区的滚动、overflow 裁剪；贴近锚点，上下空间不够就翻向另一侧。
// 与目录签的弹层同一套 .chip-pop 外观与关闭逻辑：点别处、Esc、锚点所在容器滚动都收
function openFloatingPop(anchor, html, { align = "left", menu = true } = {}) {
  closeChipPop();
  const pop = document.createElement("div");
  pop.className = `chip-pop floating${menu ? " chip-menu" : ""}`;
  pop.innerHTML = html;
  pop.addEventListener("click", event => event.stopPropagation());
  document.body.append(pop);
  const rect = anchor.getBoundingClientRect(),
    gap = 6,
    edge = 10;
  const width = pop.offsetWidth,
    height = pop.offsetHeight;
  const below = innerHeight - rect.bottom - gap,
    up = below < height + edge && rect.top - gap > below;
  pop.classList.toggle("drop-up", up);
  const top = up ? rect.top - gap - height : rect.bottom + gap;
  let left = align === "right" ? rect.right - width : rect.left;
  left = Math.max(edge, Math.min(left, innerWidth - width - edge));
  pop.style.top = `${Math.max(edge, top)}px`;
  pop.style.left = `${left}px`;
  const scroller = anchor.closest("#history, #chatScroll, .composer-area");
  scroller?.addEventListener("scroll", closeChipPop, { once: true, passive: true });
  return pop;
}
// 附件签「＋」：展开后二选一——外件（本机文件）或卷宗（已收入的文件，点选即置于案上）
function openAttachMenu(anchor) {
  if (document.querySelector(".chip-pop[data-kind=attach]")) return closeChipPop();
  const total = libraryTotal();
  const pop = openFloatingPop(
    anchor,
    `<button type="button" data-attach="file"><span>外件</span><small>本机文件</small></button><button type="button" data-attach="archive"><span>卷宗</span><small>${total ? `${total} 件` : "尚空"}</small></button>`
  );
  pop.dataset.kind = "attach";
  pop.querySelector('[data-attach="file"]').onclick = () => {
    closeChipPop();
    $("#fileInput").click();
  };
  pop.querySelector('[data-attach="archive"]').onclick = () => {
    if (!total) return toast("卷宗尚空");
    renderArchivePicker(pop, anchor);
  };
}
// 卷宗选件：一栏可查找的清单，磁盘上的与浏览器内的都列，点一件即置于案上
function renderArchivePicker(pop, anchor) {
  const disk = archiveOnline() ? archiveEntries || [] : [],
    items = [
      ...disk.map(file => ({ key: `disk:${file.path}`, name: file.name, size: file.size })),
      ...store.library.map(file => ({ key: `item:${file.id}`, name: file.name, size: file.size }))
    ];
  pop.classList.add("attach-picker");
  pop.innerHTML = `<input class="field" placeholder="按文件名查找" aria-label="查找卷宗"><div class="chip-pop-list"></div>`;
  const input = pop.querySelector("input"),
    list = pop.querySelector(".chip-pop-list");
  const paint = () => {
    const query = input.value.trim().toLowerCase(),
      shown = items.filter(item => !query || item.name.toLowerCase().includes(query));
    list.innerHTML = shown.length
      ? shown
          .map(
            item =>
              `<button type="button" data-pick="${escapeHtml(item.key)}" title="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span><small>${formatFileSize(item.size)}</small></button>`
          )
          .join("")
      : `<div class="chip-pop-label">没有匹配的卷宗</div>`;
  };
  paint();
  input.addEventListener("input", paint);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector("[data-pick]")?.click();
    }
  });
  list.addEventListener("click", event => {
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    const [kind, ...rest] = button.dataset.pick.split(":"),
      key = rest.join(":");
    closeChipPop();
    void (kind === "disk" ? placeFromArchive(key) : placeFromLibrary(key));
  });
  // 清单比菜单高，重新贴一次锚点
  const rect = anchor.getBoundingClientRect(),
    height = pop.offsetHeight;
  if (pop.classList.contains("drop-up") || innerHeight - rect.bottom - 6 < height + 10) {
    pop.classList.add("drop-up");
    pop.style.top = `${Math.max(10, rect.top - 6 - height)}px`;
  }
  setTimeout(() => input.focus(), 0);
}
// 历史条目的「⋯」：置顶、改名、绑定（更换目录）、删除
function openHistoryMenu(id, anchor) {
  const c = store.conversations.find(item => item.id === id);
  if (!c) return;
  if (document.querySelector(`.chip-pop[data-kind=history][data-for="${CSS.escape(id)}"]`)) return closeChipPop();
  const pop = openFloatingPop(
    anchor,
    `<button type="button" data-menu="pin">${c.pinned ? "取消置顶" : "置顶"}</button><button type="button" data-menu="rename">改名</button><button type="button" data-menu="bind">${isWork(c) ? "更换目录" : "绑定目录"}</button><button type="button" data-menu="export"><span>导出</span><small>${archiveOnline() ? "存入卷宗" : "Markdown"}</small></button><button type="button" class="danger" data-menu="delete">删除</button>`,
    { align: "right" }
  );
  pop.dataset.kind = "history";
  pop.dataset.for = id;
  pop.addEventListener("click", event => {
    const button = event.target.closest("[data-menu]");
    if (!button) return;
    closeChipPop();
    const action = button.dataset.menu;
    if (action === "pin") togglePin(id);
    else if (action === "rename") startRename(id);
    else if (action === "delete") deleteConversation(id);
    else if (action === "export") void exportConversationMarkdown(c);
    else if (action === "bind") {
      if (c.ended) return toast("此对话已收尾，请翻页后再绑定目录");
      openWorkdirPop({
        anchor: anchor.closest(".history-item") || anchor,
        host: null,
        value: c.workdir || "",
        live: false,
        bound: isWork(c),
        floating: true,
        onCommit: dir => void bindWorkdir(c, dir)
      });
    }
  });
}
// 目录签的弹层，欢迎页与对话页共用：输入 / 选择；不列「最近」——删掉的目录会留在那儿、点了又能把它绑回来，每次自己选。
// live 时每敲一字都落值（欢迎页记到待绑目录），否则回车、点选才落值（对话页要经桥接绑定）
// floating：不挂在 host 里而是浮在锚点旁（侧栏历史条目的「绑定目录」用），其余一样
function openWorkdirPop({ anchor, host, value, live, bound, onCommit, floating = false }) {
  if (apiBase === null) {
    void ensureLocalBridge();
    return toast("绑定目录需要本机桥接，请先运行 start.cmd");
  }
  if ((floating ? document : host).querySelector(".chip-pop[data-kind=workdir]")) return closeChipPop();
  const html = `<div class="chip-pop-row"><input id="workdirInput" class="field" spellcheck="false" autocomplete="off" placeholder="${live ? "留空则为言" : "输入或选择目录"}" value="${escapeHtml(value || "")}"><button id="workdirPick" class="outline-btn" type="button">选择…</button>${live ? "" : `<button id="workdirCommit" class="outline-btn" type="button">${bound ? "更换" : "绑定"}</button>`}</div>${bound ? `<button type="button" class="chip-pop-unbind" data-unbind>解开目录，回到言</button>` : live ? `<button type="button" class="chip-pop-unbind${value ? "" : " hidden"}" data-unbind>不绑目录，回到言</button>` : ""}<small>指令由 ${escapeHtml(bootstrap.work?.shell || "本机 shell")} 执行；${live ? `不绑目录时落在卷宗 ${escapeHtml(archiveDir())}` : "上下文不变，此后的改动落在该目录"}</small>`;
  const pop = floating ? openFloatingPop(anchor, html, { align: "right", menu: false }) : openChipPop(anchor, host, html);
  pop.dataset.kind = "workdir";
  const input = pop.querySelector("#workdirInput"),
    commit = (dir, close = false) => {
      onCommit(dir.trim());
      if (close) closeChipPop();
      else if (live) pop.querySelector("[data-unbind]")?.classList.toggle("hidden", !dir.trim());
    };
  if (live) input.addEventListener("input", () => commit(input.value));
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (live) {
      closeChipPop();
      $("#welcomeInput").focus();
    } else commit(input.value, true);
  });
  pop.querySelector("#workdirCommit")?.addEventListener("click", () => commit(input.value, true));
  pop.querySelector("[data-unbind]")?.addEventListener("click", () => commit("", true));
  // 「选择…」：由桥接弹出本机的文件夹对话框，选好回填
  pop.querySelector("#workdirPick").onclick = async () => {
    const button = pop.querySelector("#workdirPick");
    button.disabled = true;
    button.textContent = "选择中…";
    try {
      const data = await bridge("/api/work/pick", { current: input.value.trim() }, AbortSignal.timeout(300000));
      if (data.path) {
        input.value = data.path;
        commit(data.path, !live);
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      button.disabled = false;
      button.textContent = "选择…";
    }
  };
  setTimeout(() => input.focus(), 0);
}
// 对话中途绑上 / 解开目录：只是给对话记一个目录，下一问起工具与提示词随之而变，历史一字不丢
/** @param {Conversation} c */
async function bindWorkdir(c, dir) {
  dir = String(dir || "").trim();
  if (!dir) {
    if (!isWork(c)) return;
    c.workdir = "";
    saveStore();
    render();
    toast("已解开目录，回到言");
    return;
  }
  if (activeProfile()?.tools === false) return toast("当前模型已关闭本机工具，请在模型高级配置中开启");
  if (apiBase === null && !(await ensureLocalBridge())) return toast("绑定目录需要本机桥接，请先运行 start.cmd");
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: dir }, AbortSignal.timeout(8000));
    if (prepared.workdir === c.workdir) return;
    c.workdir = prepared.workdir;
    c.commandPolicy = commandPolicyOf(c);
    saveStore();
    render();
    toast(`已绑定 ${pathTail(prepared.workdir)}${prepared.created ? "（新建）" : ""}，此后为行`);
  } catch (error) {
    toast(`工作目录不可用：${String(error.message || error)}`);
  }
}
function setupChips() {
  const chips = $("#welcomeChips");
  chips.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", closeChipPop);
  $("#workdirChip").onclick = () =>
    openWorkdirPop({
      anchor: $("#workdirChip"),
      host: chips,
      value: store.settings.pendingWorkdir || "",
      live: true,
      bound: false,
      onCommit: dir => {
        if (dir) store.settings.pendingWorkdir = dir;
        else delete store.settings.pendingWorkdir;
        saveStoreSoon();
        renderHeader();
        renderHistory();
      }
    });
  $("#approveChip").onclick = () => {
    store.settings.commandPolicyDefault = nextCommandPolicy(store.settings.commandPolicyDefault);
    saveStore();
    renderChips(workMode(), apiBase !== null);
  };
  // 对话页标题下的目录签：绑上、更换或解开
  const meta = $("#chatMeta");
  meta.addEventListener("click", event => {
    if (event.target.closest(".chip-pop")) return event.stopPropagation();
    if (event.target.closest("[data-export-md]")) return void exportConversationMarkdown(currentConversation());
    const button = event.target.closest("[data-workdir-bind]");
    if (!button) return;
    event.stopPropagation();
    const c = currentConversation();
    if (!c) return;
    if (c.ended) return toast("此对话已收尾，请翻页后再绑定目录");
    openWorkdirPop({
      anchor: button,
      host: meta,
      value: c.workdir || "",
      live: false,
      bound: isWork(c),
      onCommit: dir => void bindWorkdir(c, dir)
    });
  });
}
function newChat() {
  closeSidePanel();
  persistDraft();
  rememberScrollPosition();
  pendingAttachments = [];
  currentId = null;
  editingMessageId = null;
  view = "chat";
  render();
  setTimeout(() => $("#welcomeInput").focus(), 0);
  if (isMobile()) toggleSidebar(true);
}
function openConversation(id) {
  if (id !== currentId) {
    closeSidePanel();
    persistDraft();
    rememberScrollPosition();
    pendingAttachments = [];
  }
  currentId = id;
  editingMessageId = null;
  view = "chat";
  const c = currentConversation();
  if (c) {
    c.unread = false;
    c.profileId && selectProfile(c.profileId, false);
  }
  render();
  if (isMobile()) toggleSidebar(true);
}
async function deleteConversation(id) {
  const removed = store.conversations.find(c => c.id === id);
  if (!removed) return;
  if (!(await askConfirm({ title: "删除这段对话？", body: `「${removed.title}」将连同其附件一起移除，无法撤销。`, ok: "删除" }))) return;
  if (conversationRunning(id)) stopGeneration(id);
  for (const [key, job] of requestJobs)
    if (job.conversationId === id) {
      job.controller.abort();
      requestJobs.delete(key);
    }
  if (currentId === id) closeSidePanel();
  const draftFiles = draftRecord(id).attachments.map(file => file.id);
  clearDraft(id);
  void cleanScratch(removed);
  void deleteAttachments([...attachmentIds(allMessages(removed)), ...draftFiles]);
  store.conversations = store.conversations.filter(c => c.id !== id);
  if (currentId === id) {
    currentId = null;
    pendingAttachments = [];
  }
  saveStore();
  render();
  toast("对话已删除");
}
function togglePin(id) {
  const c = store.conversations.find(item => item.id === id);
  if (!c) return;
  c.pinned = !c.pinned;
  saveStore();
  renderHistory();
}
function startRename(id) {
  renamingId = id;
  renderHistory();
}
function commitRename(value) {
  const id = renamingId;
  renamingId = null;
  if (id) renameConversation(id, value);
  else renderHistory();
}
function renameConversation(id, value) {
  const c = store.conversations.find(item => item.id === id),
    title = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  if (c && title && title !== c.title) {
    c.title = title;
    c.titleAuto = false;
    saveStore();
  }
  renderHistory();
  if (c && currentId === id) {
    $("#chatTitle").textContent = c.title;
    syncDocumentTitle();
  }
}
function selectProfile(id, shouldRender = true) {
  if (!profiles().some(p => p.id === id)) return;
  const c = currentConversation(),
    wasDry = conversationDry(c);
  store.settings.activeProfileId = id;
  if (c) c.profileId = id;
  saveStore();
  closeModelMenu();
  if (shouldRender) {
    renderHeader();
    if (c && view === "chat" && wasDry !== conversationDry(c)) renderConversation();
    renderSendButtons();
  }
}

function syncJumpBottom(gap) {
  const el = $("#chatScroll");
  if (gap === undefined) gap = el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0;
  $("#jumpBottom").classList.toggle("hidden", view !== "chat" || !currentId || gap < 260);
}
function syncChatScrollGrabber() {
  const host = $("#chatScroll"),
    grabber = $("#chatScrollGrabber");
  if (!host || !grabber) return;
  grabber.classList.toggle("active", view === "chat" && !!currentId && host.scrollHeight > host.clientHeight + 1);
}
function syncDocumentTitle() {
  const c = currentConversation();
  document.title = view === "library" ? "卷宗 · 言" : c ? `${c.title} · 言` : "言";
}

  // ---- 07-render.js ----
// 言 · 整体渲染：顶栏、模型菜单、历史、对话与消息
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function render(shouldScroll = false) {
  rememberPlace();
  renderHeader();
  renderHistory();
  syncDocumentTitle();
  requestAnimationFrame(() => syncJumpBottom());
  const c = currentConversation(),
    library = view === "library";
  $("#library").classList.toggle("hidden", !library);
  $("#welcome").classList.toggle("hidden", library || !!c);
  $("#chat").classList.toggle("hidden", library || !c);
  $("#chatScrollGrabber").classList.toggle("hidden", library || !c);
  $("#composerArea").classList.toggle("hidden", library || !c);
  $("#openLibrary").classList.toggle("active", library);
  if (library) renderLibrary();
  else if (c) renderConversation(shouldScroll);
  else renderOutline();
  restoreDraft();
  renderAttachments();
  renderSendButtons();
  renderApprovalBar();
  renderHelperBar();
  requestAnimationFrame(syncChatScrollGrabber);
}
function renderHeader() {
  renderModelTriggers();
  $("#welcomeMode").textContent = workMode() ? "执事" : "对谈";
  $("#displayNameSidebar").textContent = store.settings.name;
  $("#avatar").textContent = store.settings.name.trim().slice(0, 1) || "客";
  const dark = document.documentElement.dataset.theme === "dark",
    toggle = $("#themeToggle");
  toggle.dataset.theme = dark ? "dark" : "light";
  toggle.title = dark ? "天光 · 亮色" : "落墨 · 暗色";
  $("#greeting").textContent = greeting();
  renderModeSwitch();
  renderWelcome();
  renderQuota();
  renderModelMenu();
  renderLibraryCount();
  refreshConnection();
}
function renderQuota() {
  const p = activeProfile(),
    parsed = p ? parseTokenLimit(p.quota) : null,
    cap = parsed === null ? 0 : parsed,
    used = Math.max(0, Number(p?.usedTokens || 0));
  const remaining = cap ? Math.max(0, cap - used) : 0,
    ratio = p && parsed !== null ? (cap ? remaining / cap : 1) : 0,
    status = $("#quotaStatus");
  const percent = Math.min(100, Math.round(ratio * 100));
  $("#quotaFill").style.width = `${percent}%`;
  status.style.setProperty("--ink-level", `${percent}%`);
  $("#quotaText").textContent = !p ? "—" : parsed === null ? "未设" : formatTokens(remaining);
  status.classList.toggle("dry", cap > 0 && remaining === 0);
  status.classList.toggle("empty", !p || parsed === null);
  status.title = !p ? "尚未接入模型" : parsed === null ? "尚未设定用量上限" : `余墨 ${formatTokens(remaining)} · 上限 ${formatTokens(cap)}`;
  status.setAttribute("aria-label", status.title);
}
function renderModelTriggers() {
  const p = activeProfile(),
    c = currentConversation(),
    level = (c ? c.reasoning : store.settings.reasoning) || "";
  // 标签写实际会送出的那一档：模型不认所选的就落到最接近的；模型不认思考档位（探过是 none）就不写
  const used = level ? nearestReasoning(p, level) : "";
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.querySelector(".model-name").textContent = p?.name || "尚未接入模型";
    button.querySelector(".model-extra").textContent = used ? `· 思考 ${reasoningLabel(used)}` : "";
  });
}
function closeModelMenu() {
  const menu = $("#modelMenu");
  hideWithFade(menu);
  document.querySelectorAll(".model-trigger").forEach(button => button.setAttribute("aria-expanded", "false"));
}
function positionModelMenu(button) {
  const menu = $("#modelMenu");
  if (!button || menu.classList.contains("hidden")) return;
  menu.classList.remove("drop-up");
  menu.style.removeProperty("max-height");
  const rect = button.getBoundingClientRect(),
    gap = 9,
    edge = 12;
  const below = Math.max(0, innerHeight - rect.bottom - gap - edge),
    above = Math.max(0, rect.top - gap - edge);
  const dropUp = below < Math.min(menu.scrollHeight, 220) && above > below;
  menu.classList.toggle("drop-up", dropUp);
  menu.style.maxHeight = `${Math.max(96, Math.min(dropUp ? above : below, 420))}px`;
}
function renderModelMenu() {
  const all = profiles();
  $("#modelMenu").innerHTML = all.length
    ? all
        .map(p => {
          const active = p.id === store.settings.activeProfileId;
          // 只列显示名：模型原名与接口地址长短不一，行高参差；要看去模型设置
          return `<button class="model-option${active ? " active" : ""}" data-profile="${escapeHtml(p.id)}"${active ? ' aria-current="true"' : ""} title="${escapeHtml(p.model)}"><strong><span class="model-dot"></span><span class="model-option-name">${escapeHtml(p.name)}</span></strong></button>`;
        })
        .join("")
    : `<button class="model-option" id="configureFirst"><strong>接入模型</strong><small>任何 OpenAI 兼容接口</small></button>`;
  const c = currentConversation(),
    level = (c ? c.reasoning : store.settings.reasoning) || "",
    profile = activeProfile(),
    choices = reasoningChoices(profile),
    // 选过的档位这个模型不认（换了模型、或刚学到它的档位）：菜单上点亮它实际会落到的那一档
    shown = choices.includes(level) ? level : nearestReasoning(profile, level) || "";
  if (all.length)
    $("#modelMenu").insertAdjacentHTML(
      "beforeend",
      `<div class="menu-section"><div class="menu-section-title"><span>思考深度</span><span title="留空由接口决定；各模型所认的档位不同，可在模型高级配置中填写，接口拒绝时亦会自动记下">${c ? "本段对话" : "新对话默认"}</span></div>${choices.length > 1 ? `<div class="segmented">${choices.map(value => `<button type="button" data-reasoning="${value}" class="${value === shown ? "active" : ""}">${reasoningLabel(value)}</button>`).join("")}</div>` : `<div class="menu-section-note">此模型不认思考档位</div>`}</div><button class="model-option model-manage" data-manage>模型设置</button>`
    );
  $("#configureFirst")?.addEventListener("click", () => openSettings("models"));
  $("#modelMenu [data-manage]")?.addEventListener("click", e => {
    e.stopPropagation();
    closeModelMenu();
    openSettings("models");
  });
}
function renderHistory() {
  const query = historyQuery.trim().toLowerCase();
  const matches = c =>
    !query ||
    String(c.title).toLowerCase().includes(query) ||
    (c.messages || []).some(m => typeof m.content === "string" && m.content.toLowerCase().includes(query));
  const sorted = [...store.conversations].filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // 一条时间线：绑了目录的对话归在各自的「工」组里，组按组内最近动过的那条排（一条有动静，整组靠前），组内按时间；
  // 没绑目录的对话按自己的时间散在其间；置顶另列。组可收起，收起时只露出当前打开的那条；查找时不收
  const collapsed = new Set(store.settings.collapsedRepos || []),
    pinned = sorted.filter(c => c.pinned),
    repos = new Map(),
    nodes = [];
  for (const c of sorted) {
    if (c.pinned) continue;
    if (!isWork(c)) {
      nodes.push({ kind: "chat", at: c.updatedAt, c });
      continue;
    }
    let node = repos.get(c.workdir);
    if (!node) {
      node = { kind: "repo", dir: c.workdir, at: c.updatedAt, items: [] };
      repos.set(c.workdir, node);
      nodes.push(node);
    }
    node.items.push(c);
  }
  nodes.sort((a, b) => b.at.localeCompare(a.at));
  const buckets = new Map([["置顶", pinned.map(c => ({ kind: "chat", c }))]]);
  for (const label of ["今天", "过去七天", "更早"]) buckets.set(label, []);
  for (const node of nodes) buckets.get(dayBucket(node.at)).push(node);
  const item = c => {
    if (renamingId === c.id)
      return `<div class="history-item active" data-conversation="${escapeHtml(c.id)}"><input class="history-rename" value="${escapeHtml(c.title)}" maxlength="60" aria-label="重命名对话"></div>`;
    const job = requestJob(c.id),
      running = !!job,
      waiting = job?.label === "等待确认";
    const state = waiting
      ? `<span class="history-state waiting" title="有指令等待确认" aria-label="有指令等待确认">问</span>`
      : running
        ? `<span class="history-state running" title="后台生成中" aria-label="后台生成中"></span>`
        : c.unread
          ? `<span class="history-state unread" title="有新回复" aria-label="有新回复"></span>`
          : "";
    return `<div class="history-item ${c.id === currentId ? "active" : ""} ${running ? "is-running" : ""} ${c.unread ? "has-unread" : ""} ${isWork(c) ? "is-work" : ""}" data-conversation="${escapeHtml(c.id)}"><button class="history-open" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>${state}<span class="history-tools"><button class="history-tool history-more" data-history-action="menu" title="更多" aria-label="更多" aria-haspopup="menu">⋯</button></span></div>`;
  };
  const repoHtml = node => {
    const name = node.dir.split(/[\\/]/).filter(Boolean).pop() || node.dir || "未定目录",
      fold = collapsed.has(node.dir) && !query,
      shown = fold ? node.items.filter(c => c.id === currentId) : node.items,
      running = node.items.filter(c => c.id !== currentId && requestJob(c.id)).length;
    return `<div class="history-repo-group${fold ? " collapsed" : ""}" data-repo="${escapeHtml(node.dir)}"><div class="history-repo-head"><button type="button" class="history-repo" data-repo-toggle="${escapeHtml(node.dir)}" title="${escapeHtml(node.dir)}\n${fold ? "展开" : "收起"}" aria-expanded="${fold ? "false" : "true"}"><span class="repo-seal" aria-hidden="true">工</span><span class="history-repo-name">${escapeHtml(name)}</span><small>${node.items.length}${fold && running ? ` · ${running} 生成中` : ""}</small><span class="repo-caret" aria-hidden="true">›</span></button><button type="button" class="history-tool repo-new" data-history-workdir="${escapeHtml(node.dir)}" title="在此目录翻页">＋</button></div>${shown.length ? `<div class="history-repo-items">${shown.map(item).join("")}</div>` : ""}</div>`;
  };
  $("#history").innerHTML =
    [...buckets]
      .filter(([, items]) => items.length)
      .map(
        ([label, items]) =>
          `<div class="history-group"><div class="history-label">${label}</div>${items.map(node => (node.kind === "repo" ? repoHtml(node) : item(node.c))).join("")}</div>`
      )
      .join("") || `<div class="history-empty">${query ? "没有匹配的对话" : "尚无旧墨"}</div>`;
  const input = $("#history .history-rename");
  if (input) {
    input.focus();
    input.select();
  }
}
function scrollSnapshot() {
  const host = $("#chatScroll");
  if (!host || !currentId || view !== "chat") return null;
  const hostTop = host.getBoundingClientRect().top,
    anchor = [...host.querySelectorAll("#messages [data-message]")].find(node => node.getBoundingClientRect().bottom > hostTop + 1);
  return {
    top: host.scrollTop,
    gap: Math.max(0, host.scrollHeight - host.scrollTop - host.clientHeight),
    follow: followBottom,
    anchorId: anchor?.dataset.message || "",
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - hostTop : 0
  };
}
function rememberScrollPosition() {
  const snapshot = scrollSnapshot();
  if (snapshot && currentId) scrollPositions.set(currentId, snapshot);
}
function restoreScrollPosition(snapshot) {
  const host = $("#chatScroll");
  if (!host || !snapshot) return;
  followBottom = !!snapshot.follow;
  const anchor = snapshot.anchorId ? host.querySelector(`[data-message="${CSS.escape(snapshot.anchorId)}"]`) : null;
  if (anchor) host.scrollTop += anchor.getBoundingClientRect().top - host.getBoundingClientRect().top - snapshot.anchorOffset;
  else host.scrollTop = Math.min(snapshot.top, Math.max(0, host.scrollHeight - host.clientHeight));
}
// 标题下的元信息行：日期、几问、旁注、目录签、存入卷宗；一答收尾后也刷一次（存入卷宗要等有完整的答才出现）
/** @param {Conversation} c */
function renderChatMeta(c) {
  $("#chatMeta").innerHTML =
    `${escapeHtml(formatDay(c.createdAt))} · ${escapeHtml(chineseNumber(c.messages.filter(m => m.role === "user").length, true))}问${visibleThreads(c).length ? ` · <button class="chat-meta-notes" type="button" data-open-notes title="打开旁注">旁注 ${visibleThreads(c).length}</button>` : ""}${isWork(c) ? ` · <button type="button" class="chat-meta-path" data-workdir-bind title="工作目录">${escapeHtml(c.workdir || "")}</button>` : c.ended ? "" : ` · <button type="button" class="chat-meta-bind" data-workdir-bind title="绑定工作目录，此后指令与改动落于其中">绑定目录</button>`}${c.messages.some(m => m.role === "assistant" && m.status === "complete") ? ` · <button type="button" class="chat-meta-bind" data-export-md title="${archiveOnline() ? "以 Markdown 存入卷宗" : "以 Markdown 下载"}">${archiveOnline() ? "存入卷宗" : "存为 Markdown"}</button>` : ""}`;
}
function renderConversation(shouldScroll = false) {
  const c = currentConversation();
  if (!c) return;
  const snapshot = c.id === lastRenderedConvId ? scrollSnapshot() : scrollPositions.get(c.id);
  $("#chatTitle").textContent = c.title;
  renderChatMeta(c);
  renderWorkAuto();
  renderModelTriggers();
  const scrollHost = $("#chatScroll");
  scrollHost.classList.toggle(
    "generating",
    c.messages.some(message => message.status === "streaming")
  );
  // 切换对话时整列淡入（带轻微交错）；流式结束、主题切换等原地重绘则保持安静
  const converged = c.id !== lastRenderedConvId;
  lastRenderedConvId = c.id;
  scrollHost.classList.remove("converge");
  refreshNoteCounts(c);
  const { added } = syncMessages(c, converged);
  if (converged) {
    const articles = scrollHost.querySelectorAll("#messages .message");
    scrollHost.classList.add("converge");
    articles.forEach((el, i) => el.style.setProperty("--converge-delay", `${Math.min(i * 35, 240)}ms`));
    clearTimeout(convergeTimer);
    convergeTimer = setTimeout(() => scrollHost.classList.remove("converge"), 1000);
  }
  const dry = conversationDry(c);
  $("#chatInput").disabled = dry;
  $("#chatInput").placeholder = dry ? "余墨已尽，换个模型再续" : "续言于此";
  renderSendButtons();
  if (shouldScroll || !snapshot) {
    followBottom = true;
    requestAnimationFrame(scrollBottom);
  } else {
    restoreScrollPosition(snapshot);
    requestAnimationFrame(() => restoreScrollPosition(snapshot));
  }
  // 主题、朱色或字体变了：留在原地的图表就地换色，不必重画整段
  const themeKey = vizThemeKey();
  if (themeKey !== lastVizThemeKey) {
    lastVizThemeKey = themeKey;
    rethemeViz($("#messages"));
  }
  for (const node of added) {
    void loadThumbnails(node);
    renderEnhancements(node);
    decorateNoteAnchors(node);
  }
  syncActiveAnchor();
  foldCompacted(c);
  renderOutline();
  updateContextGauge();
}
// 停在哪一页记在设置里：刷新后回到原处——正看着的那段对话、或卷宗；开机时由 boot 读回
function rememberPlace() {
  const s = store.settings,
    /** @type {{ view: "chat"|"library", id: string }} */
    next = { view: view === "library" ? "library" : "chat", id: view === "library" ? "" : currentId || "" };
  if (s.lastView === next.view && (s.lastConversationId || "") === next.id) return;
  s.lastView = next.view;
  s.lastConversationId = next.id;
  saveStoreSoon();
}
function restorePlace() {
  const { lastView, lastConversationId } = store.settings;
  if (lastView === "library") view = "library";
  else if (lastConversationId && store.conversations.some(c => c.id === lastConversationId)) {
    currentId = lastConversationId;
    const c = currentConversation();
    c.unread = false;
    if (c.profileId) selectProfile(c.profileId, false);
  }
}
// 压缩过的前文在页面上折起（记录都在，只是不占地方）；最近一次压缩的分隔上有「展开前文 / 收起前文」
/** @param {Conversation} c */
function foldCompacted(c) {
  const host = $("#messages"),
    index = c.messages.map(m => (m.role === "context" && m.summary ? 1 : 0)).lastIndexOf(1);
  const before = new Set(index > 0 ? c.messages.slice(0, index).map(m => m.id) : []);
  for (const node of host.children) {
    const id = node.dataset.message;
    if (!id) continue;
    node.classList.toggle("compacted", before.has(id) && !c.showCompacted);
  }
  for (const button of host.querySelectorAll("[data-toggle-compacted]")) {
    const own = button.closest("[data-message]")?.dataset.message === c.messages[index]?.id;
    button.classList.toggle("hidden", !own || !before.size);
    button.textContent = c.showCompacted ? "收起前文" : "展开前文";
  }
}
// 消息列表按 id 增量同步：没变的节点原样留下（图表、沙箱、展开状态都不动），只插入、替换或移除有变化的那几条。
// 正在流式生成的那条由 readSse 就地更新，这里一律不碰。
// 只有会改变呈现的字段才算变化；展开/收起这类界面状态用户已经在页面上操作过了，不必因此重画
const UI_STATE_FIELDS = new Set(["toolsOpen", "toolsTouched", "reasoningOpen", "reasoningTouched", "showCompacted"]);
/** @param {Message} message */
function messageSig(message, branch) {
  return `${branch ? `${branch.at}/${branch.total}|` : ""}${editingMessageId === message.id ? "e|" : ""}${noteCounts.get(message.id) || 0}|${JSON.stringify(message, (key, value) => (UI_STATE_FIELDS.has(key) ? undefined : value))}`;
}
/** @param {Conversation} c */
function syncMessages(c, converged) {
  /** @type {Array<{ key: string, message?: Message, branch?: any, html?: string, side?: boolean }>} */
  const items = c.messages.map((message, index) => ({ key: message.id, message, branch: branchAt(c, index) }));
  if (compactingIds.has(c.id))
    items.push({
      key: "__compacting",
      html: `<div class="context-divider compacting" data-message="__compacting"><span>正在把前文压成摘要…</span></div>`
    });
  if (conversationDry(c))
    items.push({
      key: "__dry",
      html: `<div class="server-notice ended-notice" data-message="__dry"><span>此模型余墨已尽。更换模型或调高上限，即可在此续写。</span><button type="button" class="outline-btn" data-pick-model>更换模型</button></div>`
    });
  const result = syncNodes($("#messages"), items, converged);
  if (document.documentElement.classList.contains("work-mode") && !$("#messages").querySelector(".work-expanded")) closeExpandedWork();
  return result;
}
function syncNodes(host, items, converged) {
  const existing = new Map(),
    added = [],
    template = document.createElement("template");
  for (const node of host.children) if (node.dataset.message) existing.set(node.dataset.message, node);
  let cursor = host.firstElementChild;
  for (const item of items) {
    const node = existing.get(item.key);
    existing.delete(item.key);
    let next = node;
    const streaming = node && item.message?.status === "streaming" && node.dataset.status === "streaming";
    if (!streaming) {
      const sig = item.html ?? messageSig(item.message, item.branch);
      if (!node || nodeSig.get(node) !== sig) {
        template.innerHTML = item.html ?? renderMessage(item.message, item.branch, item.side);
        next = template.content.firstElementChild;
        nodeSig.set(next, sig);
        added.push(next);
        if (!node && !converged) next.classList.add("is-new");
      } else node.classList.remove("is-new");
    }
    if (node && next !== node) {
      if (node === cursor) cursor = cursor.nextElementSibling;
      disposeChartsIn(node);
      node.remove();
    }
    if (next === cursor) cursor = cursor.nextElementSibling;
    else host.insertBefore(next, cursor);
  }
  // 游标之后全是没被点到名的旧节点（删掉的消息、重生成时截掉的尾巴、旧的收尾提示）
  while (cursor) {
    const stale = cursor;
    cursor = cursor.nextElementSibling;
    disposeChartsIn(stale);
    stale.remove();
  }
  return { added };
}
function vizThemeKey() {
  return `${document.documentElement.dataset.theme}|${cssVar("--accent")}|${cssVar("--body")}`;
}
function rethemeViz(root) {
  for (const chart of vizCharts) {
    const canvas = chart.getDom(),
      el = canvas?.closest('.viz[data-viz="echarts"]');
    if (!el || !root.contains(canvas)) continue;
    try {
      chart.setOption(themedEchartsOption(parseVizJson(el.querySelector(".viz-source")?.textContent || ""), canvas), true);
    } catch {}
  }
  const stale = [...root.querySelectorAll('.viz[data-viz="mermaid"][data-rendered].viz-ok')];
  if (stale.length) {
    for (const el of stale) delete el.dataset.rendered;
    void renderViz(stale);
  }
}
/** @param {Message} message */
function noteMarkHtml(message) {
  const count = noteCounts.get(message.id) || 0;
  return count
    ? `<button class="note-mark" type="button" data-note-mark title="查看这条消息的旁注">注${count > 1 ? ` ${count}` : ""}</button>`
    : "";
}
/** @param {Message} message */
function renderMessage(message, branch = null, side = false) {
  if (message.role === "context")
    return message.summary
      ? `<div class="context-divider has-summary" data-message="${escapeHtml(message.id)}"><details class="context-summary"><summary>前文已压成摘要 · ${escapeHtml(chineseNumber(message.compacted || 0, true))}条</summary><div class="context-summary-body">${renderMarkdown(message.summary)}</div></details><button type="button" class="context-toggle" data-toggle-compacted>展开前文</button></div>`
      : `<div class="context-divider" data-message="${escapeHtml(message.id)}"><span>上下文由此重新开始</span></div>`;
  if (message.role === "user") {
    if (editingMessageId === message.id)
      return `<article class="message user" data-message="${escapeHtml(message.id)}"><div class="message-editor"><textarea class="message-edit-input">${escapeHtml(message.content)}</textarea><div class="edit-actions"><button class="message-action" data-action="cancel-edit">取消</button><button class="message-action edit-save" data-action="save-edit">保存并重答</button></div></div></article>`;
    const files = message.attachments?.length
      ? `<div class="sent-attachments">${message.attachments.map(file => attachmentCard(file, null, true)).join("")}</div>`
      : "";
    const quote = message.quote?.text
      ? `<div class="user-quote" data-quote-source="${escapeHtml(message.quote.messageId || "")}" title="回到出处">${escapeHtml(message.quote.text)}</div>`
      : "";
    return `<article class="message user" data-message="${escapeHtml(message.id)}">${side ? "" : noteMarkHtml(message)}${files}${quote}${message.content ? `<div class="user-bubble">${escapeHtml(message.content)}</div>` : ""}<div class="message-actions${branch ? " has-branch" : ""}">${branchNavHtml(branch)}${actionIcon("copy", "复制消息", icons.copy)}${actionIcon("edit", "编辑消息", icons.edit)}</div></article>`;
  }
  // 旁注里的答：复制、重新生成（不分叉，直接换掉）；出错或停止了也能重来
  const actions = side
    ? message.status === "streaming"
      ? ""
      : `${message.content ? actionIcon("copy", "复制回复", icons.copy) : ""}${actionIcon("regenerate", message.status === "complete" ? "重新生成" : "重试", icons.regenerate)}`
    : assistantActionsHtml(message) + branchNavHtml(branch);
  message = inlineThinkView(message);
  return `<article class="message assistant" data-message="${escapeHtml(message.id)}" data-status="${escapeHtml(message.status || "complete")}"><div class="message-meta"><span class="meta-seal" aria-hidden="true">言</span><span>${escapeHtml(message.modelName || "模型")} · ${formatTime(message.timestamp)}</span>${side ? "" : noteMarkHtml(message)}</div><div class="assistant-block">${trailWork(message) ? stepsHtml(message) + reasoningHtml(message) : reasoningHtml(message) + stepsHtml(message)}${assistantMainHtml(message)}${deliverablesHtml(message)}${changeSummaryHtml(message)}${sourceCardsHtml(message)}</div>${actions ? `<div class="message-actions${branch ? " has-branch" : ""}">${actions}</div>` : ""}</article>`;
}
// 正文开头带 <think>…</think> 的旧消息（导入或此前的版本）：渲染时按思考 + 正文拆开看，不改动存下的原文
const INLINE_THINK = /^\s*<think>([\s\S]*?)<\/think>\s*/;
function inlineThinkView(message) {
  const match =
    message.status !== "streaming" && !message.reasoning && typeof message.content === "string"
      ? message.content.match(INLINE_THINK)
      : null;
  return match ? { ...message, reasoning: match[1].trim(), content: message.content.slice(match[0].length) } : message;
}
/** @param {Message} message */
function splitInlineThink(message) {
  const view = inlineThinkView(message);
  if (view !== message) {
    message.reasoning = view.reasoning;
    message.content = view.content;
  }
}
/** @param {Message} message */
function assistantNoteHtml(message) {
  return message.status === "error"
    ? `<div class="message-error">${escapeHtml(message.error || "请求失败")}</div>`
    : message.status === "interrupted"
      ? `<div class="resume-note">连接中断，已生成的内容均已保留，可由此续写。</div>`
      : "";
}
/** @param {Message} message */
function assistantMainHtml(message) {
  const base = trailBase(message),
    text = base
      ? String(message.content || "")
          .slice(base)
          .trim()
      : message.content;
  if (!message.content && message.status === "streaming") return `<div class="thinking">正在凝神</div>`;
  if (!message.content && message.status === "stopped") return `<div class="thinking">搁笔于此</div>`;
  let rendered = "";
  if (text) {
    const previous = suppressViz;
    suppressViz = message.status === "streaming";
    try {
      rendered = renderMarkdown(text);
    } finally {
      suppressViz = previous;
    }
  }
  return `${text ? `<div class="markdown" data-cut="${base}" data-base="${base}">${rendered}</div>` : ""}${assistantNoteHtml(message)}`;
}
/** @param {Message} message */
function assistantActionsHtml(message) {
  return message.status === "streaming"
    ? ""
    : message.status === "error"
      ? actionIcon("retry", "重试", icons.retry)
      : message.status === "interrupted"
        ? `${message.content ? actionIcon("copy", "复制已生成内容", icons.copy) : ""}${actionIcon("resume", "继续生成", icons.resume)}${actionIcon("retry", "从头重试", icons.retry)}`
        : `${actionIcon("copy", "复制回复", icons.copy)}${actionIcon("regenerate", "重新生成", icons.regenerate)}${actionIcon("note", "旁注", icons.note)}${messageCostHtml(message)}`;
}
// 这一答耗了多少墨：各轮请求的用量之和（含帮手），接口报了用量就用实数，没报则按字数估；当前上下文有多大另看右下角
/** @param {Message} message */
function messageCostHtml(message) {
  const n = Number(message.tokenCount) || 0;
  if (!n) return "";
  const heavy = n >= CONTEXT_HEAVY;
  return `<span class="message-cost${heavy ? " heavy" : ""}" title="这一答共耗约 ${formatTokens(n)} token${message.tokenEstimated ? "（估算）" : ""}${heavy ? "；上下文已重，可压缩前文" : ""}">耗墨 ${message.tokenEstimated ? "≈ " : ""}${formatTokens(n)}</span>`;
}
// 流式结束只就地收尾这一条消息：不重建整段对话，图表、沙箱、展开状态和滚动位置都原样保留，收笔时不再闪一下
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
function finalizeAssistant(conversation, assistant, leadTrim = 0) {
  const article = document.querySelector(`#messages [data-message="${CSS.escape(assistant.id)}"]`),
    block = article?.querySelector(".assistant-block");
  if (!block || conversation.ended) return renderConversation(followBottom);
  // 步骤可能收尾时全撤了（只排着补言、没递出去就停了）：行迹整块撤掉
  if (assistant.steps?.length) refreshSteps(assistant);
  else block.querySelector(":scope > .tool-stack")?.remove();
  if (assistant.deliverables?.length && !block.querySelector(":scope > .deliver-bar"))
    (block.querySelector(":scope > .change-bar") || block.querySelector(":scope > .markdown") || block).insertAdjacentHTML(
      "afterend",
      deliverablesHtml(assistant)
    );
  block.querySelector(".thinking")?.remove();
  const reasoning = block.querySelector(":scope > .reasoning"),
    thought = String(assistant.reasoning || "").slice(trailReasoningBase(assistant));
  if (reasoning && thought.trim()) {
    reasoning.querySelector(".reasoning-body").textContent = thought;
    reasoning.dataset.state = "done";
  } else if (reasoning) reasoning.remove();
  else if (thought.trim()) {
    const stack = block.querySelector(":scope > .tool-stack");
    if (stack) stack.insertAdjacentHTML("afterend", reasoningHtml(assistant, thought));
    else block.insertAdjacentHTML("afterbegin", reasoningHtml(assistant, thought));
  }
  block.querySelectorAll(".message-error, .resume-note, .source-stack").forEach(node => node.remove());
  block.querySelector(".tool-stack.is-work .trail-group.trail-live")?.remove();
  block.querySelectorAll(".trail-drafting").forEach(node => node.remove());
  const markdown = block.querySelector(":scope > .markdown");
  if (!assistant.content) {
    markdown?.remove();
    block.insertAdjacentHTML("beforeend", assistantMainHtml(assistant));
  } else if (markdown?.querySelector(".md-tail")) {
    // 已渲染的稳定段保持不动，只把尾段按最终文本重绘一次——此时 mermaid / echarts / html 才真正成图
    const cut = Math.max(trailBase(assistant), Math.min(Number(markdown.dataset.cut || 0) - leadTrim, assistant.content.length)),
      tail = markdown.querySelector(".md-tail");
    markdown.dataset.cut = String(cut);
    tail.innerHTML = renderMarkdown(assistant.content.slice(cut));
    renderEnhancements(tail);
    block.insertAdjacentHTML("beforeend", assistantNoteHtml(assistant));
  } else {
    markdown?.remove();
    block.insertAdjacentHTML("beforeend", assistantMainHtml(assistant));
    renderEnhancements(block);
  }
  // 改动条生成中就已实时累加，这里只挪到收尾正文之后（原节点搬家，展开状态不丢）再对一次数；来源卡片压在最底
  const bar = block.querySelector(":scope > .change-bar");
  if (bar) {
    bar.classList.remove("is-new");
    block.append(bar);
  }
  syncChangeBar(block, assistant);
  block.insertAdjacentHTML("beforeend", sourceCardsHtml(assistant));
  block.querySelectorAll(".message-error, .resume-note, .source-stack").forEach(node => node.classList.add("is-new"));
  const branch = branchAt(conversation, conversation.messages.indexOf(assistant));
  article.querySelector(".message-actions")?.remove();
  const actions = assistantActionsHtml(assistant) + branchNavHtml(branch);
  if (actions) article.insertAdjacentHTML("beforeend", `<div class="message-actions${branch ? " has-branch" : ""}">${actions}</div>`);
  article.dataset.status = assistant.status;
  if (assistant.status === "complete") article.querySelector(".meta-seal")?.classList.add("stamped");
  nodeSig.set(article, messageSig(assistant, branch));
  decorateNoteAnchors(article);
  $("#chatScroll").classList.remove("generating");
  renderHelperBar();
  if (followBottom) requestAnimationFrame(scrollBottom);
}

  // ---- 08-trail.js ----
// 言 · 行迹与时间线：步骤卡、思绪、出处
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
const TOOL_LABELS = {
  search_web: "检索",
  fetch_page: "翻阅网页",
  read_document: "翻阅文档",
  run_command: "运行",
  inspect_computer: "检查电脑",
  write_file: "写入",
  edit_file: "修改",
  read_file: "读取",
  list_files: "列目录",
  search_files: "搜索",
  ask_user: "请示",
  delegate: "差遣",
  remember: "记入",
  forget: "忘却",
  recall: "翻记忆",
  search_conversations: "查旧谈",
  read_conversation: "翻旧谈",
  run_js: "计算",
  http_request: "调接口",
  download_file: "下载",
  update_plan: "计划",
  user_note: "补言"
};
function toolStackLabel() {
  return "行迹";
}
function toolStackMeta(steps = []) {
  if (steps.some(step => step.status === "pending")) return "等待确认";
  const running = steps.some(step => step.status === "running"),
    failed = steps.filter(step => step.status === "error").length,
    skipped = steps.filter(step => step.status === "skipped").length,
    reused = steps.filter(step => step.cached).length;
  return running
    ? `进行中${reused ? ` · ${reused} 复用` : ""}`
    : `${steps.length} 步${reused ? ` · ${reused} 复用` : ""}${skipped ? ` · ${skipped} 跳过` : ""}${failed ? ` · ${failed} 失败` : ""}`;
}
// 等待确认是阻塞式的提问，无论用户之前有没有收起，都把折叠区展开，别让生成静静停在看不见的地方
// 执事对话里的行迹是一条时间线：模型边做边说的话与各步穿插排列，做的时候摊开看过程，做完自动收起，只留最后的总结在外；对谈里仍是折起的注脚
// 看的是消息自己记的执事标记；更早的数据没记这一位，退回按当前对话的模式判断
/** @param {Message} message */
function trailWork(message) {
  return !!message.steps?.length && (message.work ?? isWork(currentConversation()));
}
/** @param {Message} message */
function trailBase(message) {
  return trailWork(message) ? Math.max(0, ...message.steps.map(step => Number(step.at) || 0)) : 0;
}
/** @param {Message|SubAgent} message 主消息或帮手：两者都有 content / reasoning / steps */
function trailGroups(message) {
  const groups = [];
  let prev = 0,
    rprev = 0;
  for (const step of message.steps || []) {
    const at = Number(step.at) || 0,
      rat = Number(step.rat) || 0,
      last = groups.at(-1);
    // 同一轮后来的步骤把这组思绪的边界往后推，下一组的起点也得跟着走，不然推过去的那段会在下一组再显示一次
    if (last && last.at === at) {
      last.steps.push(step);
      last.rat = Math.max(last.rat, rat);
    } else {
      groups.push({ at, from: prev, rat, rfrom: rprev, steps: [step] });
      prev = at;
    }
    rprev = Math.max(rprev, rat);
  }
  return groups;
}
/** @param {Message} message */
function trailReasoningBase(message) {
  return trailWork(message) ? Math.max(0, ...message.steps.map(step => Number(step.rat) || 0)) : 0;
}
/** @param {Message|SubAgent} message */
function trailReasoningHtml(message, group) {
  const text = String(message.reasoning || "")
    .slice(group.rfrom, group.rat)
    .trim();
  return text
    ? `<details class="reasoning trail-reasoning" data-state="done"><summary>思绪</summary><div class="reasoning-body">${escapeHtml(text)}</div></details>`
    : "";
}
/** @param {Message|SubAgent} message */
function trailNoteHtml(message, group) {
  const text = String(message.content || "")
    .slice(group.from, group.at)
    .trim();
  return text ? `<div class="trail-note">${renderMarkdown(text)}</div>` : "";
}
/** @param {Message} assistant */
function paintDrafting(host, assistant) {
  const drafting = (assistant.toolCalls || []).filter(call => call.name);
  let line = host.querySelector(":scope > .trail-drafting");
  if (!drafting.length) {
    line?.remove();
    return;
  }
  const label = drafting
    .map(call => {
      const path = call.arguments.match(/"(?:path|command|query|url|title)"\s*:\s*"((?:[^"\\]|\\.){1,80})/)?.[1];
      return `${TOOL_LABELS[call.name] || call.name}${path ? ` ${path}` : ""}`;
    })
    .join("、");
  const chars = drafting.reduce((sum, call) => sum + call.arguments.length, 0);
  if (!line) {
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="trail-drafting"><span class="tool-state spinning" aria-hidden="true"></span><span class="trail-drafting-text"></span></div>`
    );
    line = host.querySelector(":scope > .trail-drafting");
  }
  rollText(line.querySelector(".trail-drafting-text"), `正在拟 ${label}${chars > 200 ? ` · ${chars} 字` : ""}`);
}
function rollText(el, text) {
  const prev = el.dataset.rollText ?? el.textContent;
  if (prev === text) return;
  el.dataset.rollText = text;
  if (inkMotionOff() || prev.length !== text.length || ![...text].some((ch, i) => ch !== prev[i] && /\d/.test(ch) && /\d/.test(prev[i]))) {
    el.textContent = text;
    return;
  }
  el.innerHTML = [...text]
    .map((ch, i) => {
      const old = prev[i];
      if (ch === old || !/\d/.test(ch) || !/\d/.test(old)) return escapeHtml(ch);
      const up = Number(ch) > Number(old);
      return `<span class="roll-digit"><span class="roll-stack ${up ? "up" : "down"}"><span>${up ? old : ch}</span><span>${up ? ch : old}</span></span></span>`;
    })
    .join("");
  setTimeout(() => {
    if (el.dataset.rollText === text) el.textContent = text;
  }, 380);
}
/** @param {Message} message */
function trailLiveHost(block, message) {
  if (!trailWork(message) || message.status !== "streaming") return null;
  const body = block.querySelector(".tool-stack.is-work .tool-stack-body");
  if (!body) return null;
  let live = body.querySelector(":scope > .trail-group.trail-live");
  if (!live) {
    body.insertAdjacentHTML("beforeend", `<div class="trail-group trail-live"><div class="trail-note"></div></div>`);
    live = body.lastElementChild;
  }
  return live.querySelector(".trail-note");
}
/**
 * @param {Message|SubAgent} message
 * @param {boolean} [fold] 帮手时间线：这一轮的各步折进一个「n 步」里，只留思绪与说的话在外
 */
function trailGroupHtml(message, group, fold = false) {
  const steps = fold
    ? subStepsHtml(/** @type {SubAgent} */ (message), group)
    : `<div class="tool-steps">${group.steps.map(stepHtml).join("")}</div>`;
  return `<div class="trail-group" data-at="${group.at}">${trailReasoningHtml(message, group)}${trailNoteHtml(message, group)}${steps}</div>`;
}
// 帮手时间线里一轮的各步折成一行：一轮里几十次检索摊开要占几屏，帮手说的话与回报就被顶得看不见了。
// 与主行迹同一套开合：这一轮还在跑时摊开，跑完收起，用户亲手开合过的不动。标题行是各工具的计数，点开才看各步
/** @param {SubAgent} sub 帮手停了（中止、出错）的话，没跑完的步骤也不算还在跑 */
function subStepsRunning(sub, steps) {
  return sub.status === "streaming" && steps.some(step => step.status === "running" || step.status === "pending");
}
function subStepsLabel(steps) {
  const counts = new Map();
  for (const step of steps) {
    const label = TOOL_LABELS[step.name] || step.name;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ${n}` : label)).join(" · ");
}
function subStepsMeta(sub, steps) {
  if (subStepsRunning(sub, steps)) return "进行中";
  const failed = steps.filter(step => step.status === "error").length,
    skipped = steps.filter(step => step.status === "skipped").length;
  return `${steps.length} 步${skipped ? ` · ${skipped} 跳过` : ""}${failed ? ` · ${failed} 失败` : ""}`;
}
/** @param {SubAgent} sub */
function subStepsHtml(sub, group) {
  const running = subStepsRunning(sub, group.steps);
  return `<details class="tool-stack sub-steps"${running ? " open" : ""} data-state="${running ? "streaming" : "complete"}"><summary><span class="tool-stack-label">${escapeHtml(subStepsLabel(group.steps))}</span><span class="tool-stack-meta">${escapeHtml(subStepsMeta(sub, group.steps))}</span></summary><div class="tool-stack-body"><div class="tool-steps">${group.steps.map(stepHtml).join("")}</div></div></details>`;
}
// 一轮的折叠行就地更新：标题与计数跟着步骤走；这一轮跑完就收起（用户亲手开合过的不动）
/** @param {SubAgent} sub */
function syncSubSteps(details, sub, steps) {
  if (!details) return;
  const running = subStepsRunning(sub, steps);
  details.dataset.state = running ? "streaming" : "complete";
  const label = details.querySelector(":scope > summary > .tool-stack-label");
  if (label.textContent !== subStepsLabel(steps)) label.textContent = subStepsLabel(steps);
  rollText(details.querySelector(":scope > summary > .tool-stack-meta"), subStepsMeta(sub, steps));
  if (details.dataset.touched) return;
  if (running) settleDetails(details, true);
  else settleDetails(details, false, null, true);
}
/** @param {Message} message */
function trailLabel(message) {
  if (!trailWork(message)) return toolStackLabel();
  if (message.status === "streaming") return "工作中";
  const ms = Number(message.durationMs) || 0,
    seconds = Math.round(ms / 1000);
  const spent = !seconds
    ? ""
    : seconds < 60
      ? `${seconds} 秒`
      : `${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ""}`;
  return message.status === "complete" ? (spent ? `工作了 ${spent}` : "工作记录") : message.status === "stopped" ? "已搁笔" : "已中断";
}
/** @param {Message} message */
function trailMeta(message) {
  const base = toolStackMeta(message.steps);
  if (!trailWork(message)) return base;
  const helpers = message.status === "streaming" ? runningDelegates(message) : [];
  if (helpers.length > 1)
    return `${helpers.length} 名帮手 · ${helpers.reduce((sum, h) => sum + (h.sub?.steps.length || 0), 0)} 步 · 进行中`;
  if (helpers.length) return `帮手「${String(helpers[0].title || "").slice(0, 20)}」· ${helpers[0].sub?.steps.length || 0} 步 · 进行中`;
  const changed = new Set(
    allSteps(message)
      .filter(step => step.change && step.status === "done")
      .map(step => step.change.path)
  ).size;
  return changed ? `${base} · 改 ${changed} 个文件` : base;
}
/** @param {Message} message */
function stepsHtml(message) {
  if (!message.steps?.length) return "";
  const work = trailWork(message),
    pending = message.steps.some(step => step.status === "pending"),
    running = message.status === "streaming" && message.steps.some(step => step.status === "running" || pending);
  const open =
    pending ||
    (message.toolsTouched ? !!message.toolsOpen : message.status === "streaming" && (work || running || message.steps.length > 0));
  const body = work
    ? trailGroups(message)
        .map(group => trailGroupHtml(message, group))
        .join("")
    : `<div class="tool-steps">${message.steps.map(stepHtml).join("")}</div>`;
  return `<details class="tool-stack${work ? " is-work" : ""}"${open ? " open" : ""} data-state="${escapeHtml(message.status || "complete")}"><summary><span class="tool-stack-label">${escapeHtml(trailLabel(message))}</span><span class="tool-stack-meta">${escapeHtml(trailMeta(message))}</span></summary><div class="tool-stack-body">${body}</div></details>`;
}
/** @param {Step} step */
function stepHtml(step) {
  let title = step.title;
  if (!title) {
    try {
      const args = JSON.parse(step.arguments || "{}");
      title = args.query || args.url || args.name || "";
    } catch {
      title = "";
    }
  }
  const resultLink = result => {
    const url = safeWebUrl(result.url),
      label = escapeHtml(result.title || result.url);
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`;
  };
  const stepUrl = safeWebUrl(step.url);
  if (WORK_TOOLS.has(step.name)) return workStepHtml(step, title);
  if (step.name === "ask_user") return askStepHtml(step);
  if (step.name === "delegate") return delegateStepHtml(step);
  if (step.name === "user_note") return noteStepHtml(step);
  if (step.name === "update_plan") return planStepHtml(step);
  // 计算与调接口：代码（或请求）在上、输出在下，与指令输出同一套折叠与「展开全部」
  let more = "";
  const clamp = text => {
    const out = clampLines(text, step.full);
    if (out.clipped) more = `展开全部 · ${out.total} 行`;
    else if (step.full && out.total > STEP_SHOW_LINES) more = `只看前 ${STEP_SHOW_LINES} 行`;
    return escapeHtml(out.text);
  };
  const outputBody =
    step.code || step.output
      ? `${step.code ? `<pre class="tool-output tool-code">${clamp(step.code)}</pre>` : ""}${step.output ? `<pre class="tool-output">${clamp(step.output)}</pre>` : ""}${more ? `<button type="button" class="tool-more" data-step-more>${more}</button>` : ""}`
      : "";
  const body = outputBody
    ? outputBody
    : step.results?.length
      ? `<ul class="tool-results">${step.results
          .slice(0, 8)
          .map(r => `<li>${resultLink(r)}${r.snippet ? `<span>${escapeHtml(r.snippet)}</span>` : ""}</li>`)
          .join("")}</ul>`
      : step.url
        ? `<div class="tool-note">${stepUrl ? `<a href="${escapeHtml(stepUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(stepUrl)}</a>` : escapeHtml(step.url)}</div>`
        : step.note
          ? `<div class="tool-note">${escapeHtml(step.note)}</div>`
          : "";
  const status = step.status || "done",
    state =
      status === "running"
        ? `<span class="tool-state spinning" aria-label="进行中"></span>`
        : status === "error"
          ? `<span class="tool-state failed" aria-label="失败">×</span>`
          : `<span class="tool-state done" aria-label="完成">✓</span>`;
  // 检索、翻阅这类查阅步骤默认折起：一答里几十次检索，命中全摊开要占一整屏；标题行有关键词与结果数，点开才看命中
  const foldable = !!body,
    folded = foldable && (step.expanded === undefined ? true : !step.expanded);
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}${step.readOnly ? " is-read-only" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? "展开" : "收起"}"` : ""}><span class="tool-label">${escapeHtml(TOOL_LABELS[step.name] || step.name)}</span><span class="tool-title">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "工具执行失败") : ""}">${status === "running" ? "查阅中" : status === "error" ? escapeHtml(step.result || "失败") : escapeHtml(step.result || "")}</span>${state}</div>${body}</div>`;
}
// 帮手自己的一条小时间线——每轮的思绪、说的话、各步，与主行迹同一套画法；进行中时最新的思绪与话跟着流。
// 它画在右侧的差遣面板里（不在行迹里：差遣是并行的活，线性的时间线盛不下）；首次画整段，此后由 syncDelegateTrail 就地更新
/** @param {Step} step */
function delegateSubState(step) {
  const sub = step.sub,
    status = step.status || "done",
    steps = sub?.steps || [],
    live = status === "running";
  const base = Math.max(0, ...steps.map(s => Number(s.at) || 0)),
    rbase = Math.max(0, ...steps.map(s => Number(s.rat) || 0));
  return {
    sub,
    status,
    steps,
    live,
    thought: String(sub?.reasoning || "")
      .slice(rbase)
      .trim(),
    said: (live ? String(sub?.content || "").slice(base) : "").trim(),
    report: live ? "" : String(sub?.report || "").trim(),
    meta: live ? (steps.length ? `${steps.length} 步 · 进行中` : "领命中") : String(step.result || "")
  };
}
function delegateTailThoughtHtml(thought, state) {
  return thought
    ? `<details class="reasoning trail-reasoning" data-state="${state}"${state === "live" ? " open" : ""}><summary>思绪</summary><div class="reasoning-body">${escapeHtml(thought)}</div></details>`
    : "";
}
/** @param {Step} step */
function delegateTrailHtml(step) {
  const { sub, steps, live, thought, said, report } = delegateSubState(step);
  if (!sub) return "";
  const groups = trailGroups(sub)
    .map(group => trailGroupHtml(sub, group, true))
    .join("");
  // 最后一轮：进行中时思绪跟着流（有话了就收起）、话按最新文本画；做完后这轮思绪收进折叠区，话即回报，留在外面
  const tail = `<div class="sub-tail">${delegateTailThoughtHtml(thought, live && !said ? "live" : "done")}${
    live && said
      ? `<div class="trail-note sub-said" data-text="${escapeHtml(said)}">${renderMarkdown(said)}</div>`
      : live && !thought && !steps.length
        ? `<div class="sub-idle">帮手正在凝神</div>`
        : ""
  }</div>`;
  // 面板里整条时间线不再折起来：这一栏就是为了看过程而开的，开了还要再点一下才见内容没有道理；折的是各轮的步骤
  return `<div class="sub-trail"${live ? ' data-live="true"' : ""}><div class="sub-timeline">${groups}${tail}</div>${report ? `<div class="sub-report">${renderMarkdown(report)}</div>` : ""}</div>`;
}
// 行迹里只留一枚签：差遣是并行的活，塞进线性的时间线会把后面的东西一直往下顶。
// 这里只记「此刻遣了谁、做到哪一步」——那确实是这一刻发生的事；回报与帮手自己的那条小时间线都在面板里，
// 签上不铺回报：主模型接着会把它消化进正文，几名帮手的回报叠在行迹里，正文就被顶到几屏之下了。
/** @param {Step} step */
function delegateStepHtml(step) {
  const { sub, status, meta } = delegateSubState(step);
  return `<div class="tool-step tool-step-delegate" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head" role="button" tabindex="0" title="展开帮手的行迹"><span class="tool-label"><span class="seal sub-seal" aria-hidden="true">遣</span>差遣</span><span class="tool-title" title="${escapeHtml(sub?.task || step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "未完成") : ""}">${escapeHtml(meta)}</span>${stepStateHtml(status)}</div></div>`;
}
// 行迹里那枚签的就地更新：只动头上的状态与标题。帮手自己的时间线与回报不在这儿，在面板里
/** @param {Step} step */
function syncDelegateCard(el, step, prev, seen) {
  const { sub, status, meta } = delegateSubState(step);
  el.dataset.status = status;
  const head = el.querySelector(":scope > .tool-step-head");
  rollText(head.querySelector(".tool-meta"), meta);
  if (!prev || prev.status !== status) head.querySelector(".tool-state").outerHTML = stepStateHtml(status);
  // 标题在领命时才定下来，签却在那之前就画出来了
  const title = head.querySelector(".tool-title");
  if (title.textContent !== String(step.title || "")) {
    title.textContent = step.title || "";
    title.title = sub?.task || step.title || "";
  }
}
// 帮手时间线就地更新（面板里那一条）。帮手每 350ms 刷一次，若整段换新：已画出的步骤输出会重新起入场动画
// （列目录的结果闪一下又空一片）、用户收起的思绪又被摊开。这里只动变了的部分：新出的分组与步骤、最后一轮的思绪与话、回报
/** @param {Step} step */
function syncDelegateTrail(trail, step, seen) {
  const { sub, steps, live, thought, said, report } = delegateSubState(step);
  if (!trail || !sub) return;
  if (live) trail.dataset.live = "true";
  else delete trail.dataset.live;
  let timeline = trail.querySelector(":scope > .sub-timeline");
  if (!timeline) {
    trail.insertAdjacentHTML("afterbegin", `<div class="sub-timeline"><div class="sub-tail"></div></div>`);
    timeline = trail.firstElementChild;
  }
  let tail = timeline.querySelector(":scope > .sub-tail");
  if (!tail) {
    timeline.insertAdjacentHTML("beforeend", `<div class="sub-tail"></div>`);
    tail = timeline.lastElementChild;
  }
  for (const group of trailGroups(sub)) {
    let host = timeline.querySelector(`:scope > .trail-group[data-at="${group.at}"]`);
    if (!host) {
      tail.insertAdjacentHTML("beforebegin", trailGroupHtml(sub, group, true));
      host = tail.previousElementSibling;
      const note = host.querySelector(".trail-note");
      if (note) renderEnhancements(note);
    } else {
      // 同一轮后来的步骤会把分组的思绪边界再往后推一点
      const body = host.querySelector(":scope > .reasoning .reasoning-body"),
        text = String(sub.reasoning || "")
          .slice(group.rfrom, group.rat)
          .trim();
      if (body && body.textContent !== text) body.textContent = text;
      else if (!body && text) host.insertAdjacentHTML("afterbegin", trailReasoningHtml(sub, group));
    }
    const fold = host.querySelector(":scope > .sub-steps");
    for (const s of group.steps) syncStep(fold.querySelector(".tool-steps"), s, seen);
    syncSubSteps(fold, sub, group.steps);
  }
  const state = live && !said ? "live" : "done";
  let thoughtEl = tail.querySelector(":scope > .reasoning");
  if (!thought) thoughtEl?.remove();
  else if (!thoughtEl) tail.insertAdjacentHTML("afterbegin", delegateTailThoughtHtml(thought, state));
  else {
    const body = thoughtEl.querySelector(".reasoning-body");
    if (body.textContent !== thought) {
      body.textContent = thought;
      if (thoughtEl.dataset.state === "live") body.scrollTop = body.scrollHeight;
    }
    if (thoughtEl.dataset.state !== state) {
      thoughtEl.dataset.state = state;
      if (state === "done" && thoughtEl.open && !thoughtEl.dataset.touched) settleDetails(thoughtEl, false);
    }
  }
  let saidEl = tail.querySelector(":scope > .sub-said");
  if (!(live && said)) saidEl?.remove();
  else {
    if (!saidEl) {
      tail.insertAdjacentHTML("beforeend", `<div class="trail-note sub-said"></div>`);
      saidEl = tail.lastElementChild;
    }
    if (saidEl.dataset.text !== said) {
      saidEl.dataset.text = said;
      saidEl.innerHTML = renderMarkdown(said);
      renderEnhancements(saidEl);
    }
  }
  const idle = live && !thought && !said && !steps.length,
    idleEl = tail.querySelector(":scope > .sub-idle");
  if (!idle) idleEl?.remove();
  else if (!idleEl) tail.insertAdjacentHTML("beforeend", `<div class="sub-idle">帮手正在凝神</div>`);
  const reportEl = trail.querySelector(":scope > .sub-report");
  if (!report) reportEl?.remove();
  else if (!reportEl) {
    trail.insertAdjacentHTML("beforeend", `<div class="sub-report">${renderMarkdown(report)}</div>`);
    renderEnhancements(trail.lastElementChild);
  }
}
// 步骤按 id 就地更新：没变的节点一律不动（转圈不重启、已展开的结果不跳）；新步骤淡入上移，结果首次出现或状态翻转时只让那一条轻浮。
// 主行迹与帮手的时间线都走这里；差遣卡片本身不整张换，交给 syncDelegateCard
/** @param {Step} step */
function syncStep(list, step, seen) {
  if (!list) return;
  const html = stepHtml(step),
    hasBody = /class="tool-(results|note|output|approve)"/.test(html),
    prev = seen.get(step.id);
  let el = list.querySelector(`:scope > [data-step-id="${CSS.escape(step.id)}"]`);
  if (!el) {
    list.insertAdjacentHTML("beforeend", html);
    el = list.lastElementChild;
  } else if (step.name === "delegate") syncDelegateCard(el, step, prev, seen);
  else if (prev && prev.html !== html) {
    el.insertAdjacentHTML("afterend", html);
    const next = el.nextElementSibling;
    el.remove();
    el = next;
  }
  if (!prev) el.classList.add("is-new");
  else {
    if (hasBody && !prev.hasBody) el.classList.add("body-new");
    if (prev.status !== step.status) el.classList.add("status-new");
  }
  seen.set(step.id, { html, hasBody, status: step.status });
}
// 正在工作的帮手（当前对话里进行中的差遣步骤，可能同时有几名）
/** @param {Message} message */
function runningDelegates(message) {
  return (message?.steps || []).filter(step => step.name === "delegate" && step.status === "running");
}
/** @param {Message} message */
function runningDelegate(message) {
  return runningDelegates(message)[0] || null;
}
// 帮手正在做的一句话：最新一步，或最新说的话的第一行
/** @param {Step} step */
function delegateDoing(step) {
  const sub = step.sub,
    steps = sub?.steps || [],
    current = [...steps].reverse().find(s => s.status === "running" || s.status === "pending") || steps.at(-1);
  if (current && (current.status === "running" || current.status === "pending"))
    return `${current.status === "pending" ? "等待确认" : "正在"} ${TOOL_LABELS[current.name] || current.name} ${String(current.title || "").slice(0, 60)}`.trim();
  const base = Math.max(0, ...steps.map(s => Number(s.at) || 0)),
    said = String(sub?.content || "")
      .slice(base)
      .trim()
      .split("\n")
      .find(Boolean);
  return said ? said.slice(0, 80) : sub?.reasoning ? "正在凝神" : "领命中";
}
// 帮手条：帮手工作期间常驻输入框上方，不必翻回行迹里找那张卡片；点一下滚到卡片
function renderHelperBar() {
  const bar = $("#helperBar");
  if (!bar) return;
  const c = currentConversation(),
    message = c && view === "chat" ? [...c.messages].reverse().find(m => m.role === "assistant" && m.status === "streaming") : null,
    helpers = message ? runningDelegates(message) : [];
  if (!helpers.length) {
    bar.dataset.stepId = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  // 几名帮手同时在做时一人一行；条上记着第一名的步骤 id，点一下滚到它
  const key = helpers.map(h => h.id).join(",");
  if (bar.dataset.key !== key) {
    bar.dataset.key = key;
    bar.dataset.stepId = helpers[0].id;
    bar.innerHTML = helpers
      .map(
        h =>
          `<span class="helper-row" data-helper="${escapeHtml(h.id)}"><span class="seal helper-seal" aria-hidden="true">帮</span><span class="helper-title">差遣「${escapeHtml(h.title || "")}」</span><span class="helper-doing"></span><span class="helper-count"></span></span>`
      )
      .join("");
  }
  for (const h of helpers) {
    const row = bar.querySelector(`.helper-row[data-helper="${CSS.escape(h.id)}"]`);
    if (!row) continue;
    row.querySelector(".helper-doing").textContent = delegateDoing(h);
    rollText(row.querySelector(".helper-count"), `${h.sub?.steps.length || 0} 步`);
  }
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}

// ---------- 差遣面板：帮手的活开在一扇全屏的窗里 ----------
// 行迹里只留一枚签（带回报，做事时呼吸），要看帮手具体做了什么才点开——细看是另一种动作，值得整个屏幕：
// 那条时间线里有 diff、有命令输出、有嵌套步骤，挤在窄栏里必然难看。
// 瞥一眼不必开窗：签自己在呼吸，输入框上方还有帮手条。几名帮手用 ‹ n/m › 翻，翻不动了就点中间的计数出列表
let helperStepId = null; // 窗里正看着的那次差遣
const helperSeen = new Map(); // 窗里步骤的就地更新台账（与行迹各记各的，互不干扰）
/** 当前对话里所有的差遣，按发生先后 */
function allDelegateSteps() {
  const out = [];
  for (const message of currentConversation()?.messages || [])
    for (const step of message.steps || []) if (step.name === "delegate") out.push(step);
  return out;
}
function helperStepById(id) {
  return allDelegateSteps().find(step => step.id === id) || null;
}
function helperPanelOpen() {
  const panel = $("#helperModal");
  return !!panel && !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
function openHelperPanel(stepId) {
  const step = helperStepById(stepId);
  if (!step) return;
  if (helperStepId !== step.id) helperSeen.clear();
  helperStepId = step.id;
  $("#helperList").classList.add("hidden");
  showNow($("#helperModal"));
  renderHelperPanel(true);
  // 换一名帮手是换一张纸，从头看起；不然上一张滚到多深，这张就从多深打开
  const stage = $("#helperScroll");
  if (stage) stage.scrollTop = 0;
}
function closeHelperPanel() {
  helperStepId = null;
  helperSeen.clear();
  const panel = $("#helperModal");
  if (panel && !panel.classList.contains("hidden")) hideWithFade(panel);
}
// ‹ › 翻到前一次 / 后一次差遣
function stepHelperPanel(delta) {
  const all = allDelegateSteps(),
    at = all.findIndex(step => step.id === helperStepId),
    next = all[at + delta];
  if (next) openHelperPanel(next.id);
}
// 计数点开的那张列表：帮手多了，一个个翻就难受
function renderHelperList() {
  const host = $("#helperList"),
    all = allDelegateSteps();
  if (!host) return;
  host.innerHTML = all
    .map((step, i) => {
      const { status, meta } = delegateSubState(step);
      return `<button type="button" class="helper-list-item${step.id === helperStepId ? " here" : ""}" data-helper-pick="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><span class="helper-list-no">${i + 1}</span><span class="helper-list-title">${escapeHtml(step.title || "领命中")}</span><span class="helper-list-meta">${escapeHtml(meta)}</span></button>`;
    })
    .join("");
}
/** @param {boolean} fresh 首次打开或换了一次差遣：整段重画；否则就地更新 */
function renderHelperPanel(fresh = false) {
  if (!helperPanelOpen()) return;
  const step = helperStepById(helperStepId);
  // 那次差遣不在眼前了（换了对话、切了分支）：窗合上，不留一扇空的
  if (!step) return closeHelperPanel();
  const { sub, status, meta } = delegateSubState(step),
    all = allDelegateSteps(),
    at = all.findIndex(s => s.id === helperStepId);
  $("#helperModal").dataset.status = status;
  const title = $("#helperTitle");
  if (title && title.textContent !== (step.title || "领命中")) title.textContent = step.title || "领命中";
  rollText($("#helperPanelSub"), meta);
  // ‹ n/m ›：只有一次差遣时不画
  const nav = $("#helperNav"),
    navKey = `${at + 1}/${all.length}`;
  if (nav && nav.dataset.key !== navKey) {
    nav.dataset.key = navKey;
    nav.innerHTML =
      all.length > 1
        ? `<button class="message-action" data-helper-step="-1" title="上一次差遣" aria-label="上一次差遣"${at <= 0 ? " disabled" : ""}>‹</button><button type="button" class="helper-nav-count" data-helper-list title="所有差遣">${navKey}</button><button class="message-action" data-helper-step="1" title="下一次差遣" aria-label="下一次差遣"${at >= all.length - 1 ? " disabled" : ""}>›</button>`
        : "";
  }
  if (!$("#helperList").classList.contains("hidden")) renderHelperList();
  // 所领之命：主模型交给帮手的原话，默认收着，点开看全
  const task = String(sub?.task || "");
  const brief = $("#helperTaskBrief");
  if (brief && brief.dataset.task !== task) {
    brief.dataset.task = task;
    brief.textContent = task.replace(/\s+/g, " ").slice(0, 60);
    $("#helperTaskText").textContent = task;
    $("#helperTask").classList.toggle("hidden", !task);
  }
  const host = $("#helperPanelBody");
  if (!host) return;
  let trail = host.querySelector(":scope > .sub-trail");
  if (fresh || !trail) {
    helperSeen.clear();
    host.innerHTML = delegateTrailHtml(step) || `<div class="sub-trail"><div class="sub-timeline"></div></div>`;
    trail = host.querySelector(":scope > .sub-trail");
    trail?.querySelectorAll(".trail-note, .sub-report").forEach(node => renderEnhancements(node));
    // 首次画完把台账补齐，免得下一轮把已画出的步骤当新的又闪一次
    if (sub)
      for (const group of trailGroups(sub))
        for (const s of group.steps) helperSeen.set(s.id, { html: stepHtml(s), hasBody: false, status: s.status });
    return;
  }
  syncDelegateTrail(trail, step, helperSeen);
}

// 补言：作答途中用户寄来的话，落在行迹里它到达的那一刻；待寄时转着圈，递给模型后打勾。话不止一行、或带着附件时摊开在下面
/** @param {Step} step */
function noteStepHtml(step) {
  const status = step.status || "done",
    text = String(step.note || "").trim(),
    first = text.split("\n").find(Boolean)?.slice(0, 80) || "",
    files = (step.attachments || []).map(file => file.name);
  const meta = status === "running" ? "待寄" : status === "error" ? escapeHtml(step.result || "未送达") : escapeHtml(step.result || "已递");
  const body =
    text.length > first.length || files.length
      ? `<div class="tool-note">${escapeHtml(text)}${files.length ? `<div class="tool-note-files">${files.map(name => escapeHtml(name)).join("、")}</div>` : ""}</div>`
      : "";
  return `<div class="tool-step tool-step-note" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label"><span class="seal note-seal" aria-hidden="true">补</span>补言</span><span class="tool-title" title="${escapeHtml(text)}">${escapeHtml(first)}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
// 计划卡：一行一项，○ 待做、▶ 正在做（朱色呼吸点）、✓ 做完、– 不做了；标题行是正在做的那一项或「n/m」
/** @param {Step} step */
function planStepHtml(step) {
  const status = step.status || "done",
    items = step.plan || [],
    done = items.filter(item => item.status === "done").length;
  const rows = items
    .map(
      item =>
        `<li class="plan-item" data-plan="${escapeHtml(item.status)}"><span class="plan-mark" aria-hidden="true">${{ done: "✓", doing: "", skipped: "–" }[item.status] ?? "○"}</span><span class="plan-text">${escapeHtml(item.text)}</span></li>`
    )
    .join("");
  const meta = status === "error" ? escapeHtml(step.result || "失败") : `${done}/${items.length}`;
  return `<div class="tool-step tool-step-plan" data-tool="update_plan" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">计划</span><span class="tool-title" title="${escapeHtml(step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${items.length ? `<ol class="plan-list">${rows}</ol>` : ""}</div>`;
}
function stepStateHtml(status) {
  return status === "running"
    ? `<span class="tool-state spinning" aria-label="进行中"></span>`
    : status === "pending"
      ? `<span class="tool-state pending" aria-label="等待确认">?</span>`
      : status === "skipped"
        ? `<span class="tool-state skipped" aria-label="已跳过">–</span>`
        : status === "error"
          ? `<span class="tool-state failed" aria-label="失败">×</span>`
          : `<span class="tool-state done" aria-label="完成">✓</span>`;
}
// 步骤输出的露出规矩：默认摊开的只有两种——目录清单（露前 10 行）与红绿对比（两侧各 10 行），底下一行「展开全部」；
// 指令输出、读取、搜索这些有明确的行数、往往又长，默认折起，标题行上有结果与行数，点标题行才看；报错的也折起。
// 步骤上记两位：expanded（折起 / 摊开，未记则按上面的定）与 full（全部 / 前 10 行），重画不丢
const STEP_SHOW_LINES = 10;
function clampLines(text, full) {
  const lines = String(text || "").split("\n"),
    clipped = !full && lines.length > STEP_SHOW_LINES;
  return { text: clipped ? lines.slice(0, STEP_SHOW_LINES).join("\n") : lines.join("\n"), total: lines.length, clipped };
}
/** @param {Step} step */
function workStepHtml(step, title) {
  const status = step.status || "done",
    command = step.name === "run_command";
  const meta = status === "running" ? "执行中" : status === "pending" ? "等待确认" : escapeHtml(step.result || step.note || "");
  let body = "",
    more = "";
  // 等待确认时把整条指令完整摊开，不能只靠单行省略号让用户猜着点头
  if (status === "pending")
    body = `<pre class="tool-output tool-cmd-preview">${escapeHtml(title)}</pre><div class="tool-approve"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="${step.approvalScope === "answer" ? "本答径行：本次回答里的后续指令不再询问，下一问恢复" : "径行：此对话中后续指令不再询问"}">${step.approvalScope === "answer" ? "本答径行" : "径行"}</button></div>`;
  else if (step.diff) {
    const del = clampLines(step.diff.old, step.full),
      ins = clampLines(step.diff.new, step.full);
    body = `<div class="tool-diff"><pre class="tool-output diff-del">${escapeHtml(del.text)}</pre><pre class="tool-output diff-ins">${escapeHtml(ins.text)}</pre></div>`;
    if (del.clipped || ins.clipped) more = `展开全部 · −${del.total} +${ins.total} 行`;
    else if (step.full && Math.max(del.total, ins.total) > STEP_SHOW_LINES) more = `只看前 ${STEP_SHOW_LINES} 行`;
  } else if (step.output) {
    const out = clampLines(step.output, step.full);
    body = `<pre class="tool-output">${escapeHtml(out.text)}</pre>`;
    if (out.clipped) more = `展开全部 · ${out.total} 行`;
    else if (step.full && out.total > STEP_SHOW_LINES) more = `只看前 ${STEP_SHOW_LINES} 行`;
  } else if (step.note && !command) body = `<div class="tool-note">${escapeHtml(step.note)}</div>`;
  if (more) body += `<button type="button" class="tool-more" data-step-more>${more}</button>`;
  const foldable = !!body && status !== "pending",
    openByDefault = status !== "error" && (!!step.diff || step.name === "list_files"),
    folded = foldable && (step.expanded === undefined ? !openByDefault : !step.expanded);
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}${step.readOnly ? " is-read-only" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? "展开输出" : "收起输出"}"` : ""}><span class="tool-label">${escapeHtml(TOOL_LABELS[step.name] || step.name)}</span><span class="tool-title${command ? " tool-cmd" : ""}" title="${escapeHtml(title)}">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "执行失败") : ""}">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
/** @param {Message} assistant */
function refreshSteps(assistant) {
  const block = document.querySelector(`[data-message="${assistant.id}"] .assistant-block`);
  if (!block) return;
  block.querySelectorAll(".trail-drafting").forEach(node => node.remove());
  let stack = block.querySelector(".tool-stack");
  if (!stack) {
    const anchor = block.querySelector(".reasoning");
    if (anchor) anchor.insertAdjacentHTML("afterend", stepsHtml(assistant));
    else block.insertAdjacentHTML("afterbegin", stepsHtml(assistant));
    stack = block.querySelector(".tool-stack");
    stack?.classList.add("is-new");
  }
  if (stack) {
    stack.querySelector(".tool-stack-label").textContent = trailLabel(assistant);
    rollText(stack.querySelector(".tool-stack-meta"), trailMeta(assistant));
    stack.dataset.state = assistant.status || "complete";
    const work = trailWork(assistant),
      bodyHost = stack.querySelector(".tool-stack-body"),
      groups = work ? trailGroups(assistant) : [];
    if (work)
      for (const group of groups) {
        if (bodyHost.querySelector(`.trail-group[data-at="${group.at}"]`)) continue;
        // 正在承接这一轮话的「进行中」分组就地转正：话按最终文本重画一遍（流式可能还差几个字），再挂上步骤容器
        const live = bodyHost.querySelector(":scope > .trail-group.trail-live");
        if (live) {
          live.classList.remove("trail-live");
          live.dataset.at = String(group.at);
          live.innerHTML = `${trailReasoningHtml(assistant, group)}${trailNoteHtml(assistant, group)}<div class="tool-steps"></div>`;
        } else
          bodyHost.insertAdjacentHTML(
            "beforeend",
            `<div class="trail-group" data-at="${group.at}">${trailReasoningHtml(assistant, group)}${trailNoteHtml(assistant, group)}<div class="tool-steps"></div></div>`
          );
        const note = (live || bodyHost.lastElementChild).querySelector(".trail-note");
        if (note) renderEnhancements(note);
      }
    // 分组是按 at 定位的，而 at 会变：一答收尾时裁掉正文开头的空行，所有步骤的 at 都往前挪一截（见 streamReply 的 leadTrim）。
    // 键一变就当成新分组重画一份，旧的那份连同里面画好的步骤还留在页上——同一次差遣便出现两遍。落单的分组撤掉
    if (work) {
      const alive = new Set(groups.map(group => String(group.at)));
      for (const el of bodyHost.querySelectorAll(":scope > .trail-group"))
        if (!el.classList.contains("trail-live") && !alive.has(el.dataset.at)) el.remove();
    }
    if (work && assistant.status !== "streaming") bodyHost.querySelector(":scope > .trail-group.trail-live")?.remove();
    // 时间线消息里，行迹之前的顶层思绪是第一轮留下的旧块（那段思绪已收进第一个分组），撤掉；最后一轮的思绪收尾时画在行迹之后
    if (work) {
      const stale = block.querySelector(":scope > .reasoning");
      if (stale && stale.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING) stale.remove();
    }
    // 这一轮说的话已收进分组，正文区从下一轮起笔：还画着旧起点的正文块撤掉，下一帧从新的起点重画
    if (work) {
      const main = block.querySelector(":scope > .markdown");
      if (main && Number(main.dataset.base ?? main.dataset.cut ?? 0) < trailBase(assistant)) {
        main.remove();
        block.querySelector(":scope > .thinking")?.remove();
      }
    }
    let seen = knownStepIds.get(assistant.id);
    if (!seen) {
      seen = new Map();
      knownStepIds.set(assistant.id, seen);
      if (knownStepIds.size > 32) {
        for (const key of knownStepIds.keys())
          if (key !== assistant.id) {
            knownStepIds.delete(key);
            break;
          }
      }
    }
    for (const step of assistant.steps || [])
      syncStep(
        work ? bodyHost.querySelector(`.trail-group[data-at="${Number(step.at) || 0}"] > .tool-steps`) : stack.querySelector(".tool-steps"),
        step,
        seen
      );
    // 没递出去就撤下的补言（收尾时另作新一问、或停了放回案上）：页上那一步也撤
    const ids = new Set((assistant.steps || []).map(step => step.id));
    for (const el of stack.querySelectorAll(".tool-step-note[data-step-id]")) if (!ids.has(el.dataset.stepId)) el.remove();
    renderHelperBar();
    renderHelperPanel();
    // 一答只开一次、收一次：第一步起就摊开，整答写完才收（言里模型说话的间隙也不收）；请示时必开
    const pending = assistant.steps.some(step => step.status === "pending");
    if (assistant.status === "streaming") {
      if (pending || !assistant.toolsTouched) settleDetails(stack, true);
    } else
      settleDetails(
        stack,
        false,
        () => {
          assistant.toolsOpen = false;
          assistant.toolsTouched = false;
        },
        true
      );
  }
  syncChangeBar(block, assistant);
  if (!assistant.content && assistant.status === "streaming" && !block.querySelector(".thinking"))
    insertAboveChangeBar(block, `<div class="thinking">正在凝神</div>`);
}
// 回复末尾挂着改动条时，新起笔的正文 / 凝神占位都插到它上面，改动条始终压底
function insertAboveChangeBar(block, html) {
  const bar = block.querySelector(":scope > .change-bar");
  if (bar) bar.insertAdjacentHTML("beforebegin", html);
  else block.insertAdjacentHTML("beforeend", html);
}
// 思绪块带状态：进行中一点呼吸的朱色，写完打一个勾；时间线消息只画最后一轮的思绪，前几轮的各在自己的分组里
// 思绪是否还在写：按「轮」看而不是按整答看——最后一次工具调用之后又来了新思绪、而这一轮的正文尚未起笔，就是在写。
// 言里整答的思绪合在一块里，请示之后模型接着想，块上的勾不能因为第一轮已经有正文就先打上
/** @param {Message} message */
function reasoningLive(message) {
  if (message.status !== "streaming") return false;
  // 补言不是一轮：它落下时模型可能正想到一半，块上的勾不能因它先打上
  const last = (message.steps || []).filter(step => step.name !== "user_note").at(-1),
    at = Number(last?.at) || 0,
    rat = Number(last?.rat) || 0;
  return (
    !!String(message.reasoning || "")
      .slice(rat)
      .trim() &&
    !String(message.content || "")
      .slice(at)
      .trim()
  );
}
/** @param {Message} message */
function reasoningHtml(message, text = null) {
  text = text ?? (trailWork(message) ? String(message.reasoning || "").slice(trailReasoningBase(message)) : message.reasoning);
  if (!text?.trim()) return "";
  const live = reasoningLive(message),
    open = message.reasoningTouched ? !!message.reasoningOpen : live;
  return `<details class="reasoning"${open ? " open" : ""} data-state="${live ? "live" : "done"}"><summary>思绪</summary><div class="reasoning-body">${escapeHtml(text)}</div></details>`;
}
/** @param {Message} message */
function sourceCardsHtml(message) {
  if (message.status === "streaming" || !(message.steps || []).some(step => step.status !== "running")) return "";
  const sources = new Map(),
    add = (url, title, read = false) => {
      const href = safeWebUrl(url);
      if (!href) return;
      const key = href.replace(/#.*$/, "");
      const old = sources.get(key);
      if (!old || read) sources.set(key, { url: key, title: title || old?.title || safeHost(key), read: read || !!old?.read });
    };
  for (const step of message.steps || []) if (step.name === "fetch_page" && step.status === "done") add(step.url, step.title, true);
  for (const step of message.steps || [])
    if (step.name === "search_web" && step.status === "done") for (const result of step.results || []) add(result.url, result.title, false);
  // 记忆与旧谈：翻过的条目、查到并读过的对话，与网页并列列出，点开各归其处
  const talks = new Map(),
    memories = new Map();
  for (const step of message.steps || []) {
    if (step.status !== "done") continue;
    if (step.name === "search_conversations")
      for (const hit of step.results || [])
        if (hit.conversationId && !talks.has(hit.conversationId))
          talks.set(hit.conversationId, { id: hit.conversationId, title: hit.title, date: hit.date, read: false });
    if (step.name === "read_conversation" && step.conversationId)
      talks.set(step.conversationId, { id: step.conversationId, title: step.title, date: step.date, read: true });
    if (step.name === "recall") for (const hit of step.results || []) if (hit.memoryId) memories.set(hit.memoryId, hit.title);
  }
  const list = [...sources.values()],
    local = [...talks.values(), ...[...memories].map(([id, text]) => ({ memoryId: id, text }))];
  if (!list.length && !local.length) return "";
  const card = (source, index) =>
    source.memoryId
      ? `<button type="button" class="source-card source-local" data-open-memory="${escapeHtml(source.memoryId)}" title="查看这条记忆"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.text)}</strong><small>记忆</small></span></button>`
      : source.id
        ? `<button type="button" class="source-card source-local" data-open-talk="${escapeHtml(source.id)}" title="打开这段对话"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.title)}</strong><small>旧谈${source.date ? ` · ${escapeHtml(formatDay(source.date))}` : ""}</small></span>${source.read ? `<span class="source-read">已读</span>` : ""}</button>`
        : `<a class="source-card" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(safeHost(source.url))}</small></span>${source.read ? `<span class="source-read">已读</span>` : ""}</a>`;
  const all = [...list, ...local];
  return `<details class="source-stack"><summary><span>出处</span><small>${all.length} 条</small></summary><div class="source-grid">${all.map(card).join("")}</div></details>`;
}

  // ---- 09-attachments-ui.js ----
// 言 · 附件卡片、引用与划选提示
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
const icons = {
  copy: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="5.2" y="5.2" width="7.4" height="7.4" rx="1.5"/><path d="M10.5 3.4H4.9a1.5 1.5 0 0 0-1.5 1.5v5.6"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M3.3 12.7l.6-3 6.8-6.8 2.4 2.4-6.8 6.8-3 .6z"/><path d="M9.8 3.8l2.4 2.4"/></svg>`,
  regenerate: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 3.2v2.6h-2.6"/></svg>`,
  resume: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.2v9.6L12 8 4 3.2z"/></svg>`,
  retry: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M8 3v5l3 1.8"/><circle cx="8" cy="8" r="5.2"/></svg>`,
  note: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M3.5 4h6M3.5 8h6M3.5 12h6"/><path d="M12.6 6.4v3.2"/><path d="M11 8h3.2"/></svg>`
};
function actionIcon(action, title, icon) {
  return `<button class="message-action" data-action="${action}" title="${title}" aria-label="${title}">${icon}</button>`;
}
function fileTypeLabel(file) {
  const match = String(file.name || "").match(/\.([^.]+)$/),
    extension = match?.[1]?.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (extension) return extension.slice(0, 7);
  const subtype = String(file.mime || "")
    .split("/")[1]
    ?.split(/[;+]/)[0]
    ?.toUpperCase();
  return (subtype || "FILE").slice(0, 7);
}
function formatFileSize(value) {
  const bytes = Number(value || 0);
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}
function kindGlyph(kind) {
  return kind === "image" ? "画" : kind === "text" ? "文" : "卷";
}
function attachmentCard(file, index, sent = false) {
  const type = fileTypeLabel(file),
    title = `${file.name} · ${formatFileSize(file.size)}`;
  const thumb = file.kind === "image" && file.id ? `<img class="attachment-thumb" data-thumb="${escapeHtml(file.id)}" alt="">` : "";
  const body = `${thumb}<span class="attachment-name">${escapeHtml(file.name)}</span><span class="attachment-mark" aria-hidden="true">${kindGlyph(file.kind)}</span><span class="attachment-type">${escapeHtml(type)}</span>`;
  const save = file.id
    ? `<button class="attachment-tool attachment-save" data-save-attachment="${escapeHtml(file.id)}" title="收入卷宗" aria-label="收入卷宗">藏</button>`
    : "";
  // 发出去的附件点开是看：图进图片查看器，文、表、PDF、网页进预览器——自己刚发的东西再下载一遍没有道理；
  // 只有预览不了的（压缩包之类）才落到下载
  if (sent && file.id) {
    const action =
      file.kind === "image"
        ? `data-open-image="${escapeHtml(file.id)}" title="查看 ${escapeHtml(title)}"`
        : previewKind(file.name) !== "none"
          ? `data-open-attachment="${escapeHtml(file.id)}" data-name="${escapeHtml(file.name)}" title="预览 ${escapeHtml(title)}"`
          : `data-download-attachment="${escapeHtml(file.id)}" title="下载 ${escapeHtml(title)}"`;
    return `<div class="attachment-card sent" role="button" tabindex="0" data-kind="${file.kind}" ${action}>${body}${save}</div>`;
  }
  return `<div class="attachment-card pending" data-kind="${file.kind}" title="${escapeHtml(title)}">${body}${save}${index !== null ? `<button class="attachment-tool attachment-remove" data-remove-attachment="${index}" title="移除 ${escapeHtml(file.name)}" aria-label="移除 ${escapeHtml(file.name)}">×</button>` : ""}</div>`;
}
function renderAttachments() {
  const html = pendingAttachments.map((file, index) => attachmentCard(file, index)).join("");
  [$("#attachments"), $("#welcomeAttachments")].forEach(el => {
    el.classList.toggle("hidden", !pendingAttachments.length);
    el.innerHTML = html;
    void loadThumbnails(el);
  });
  renderSendButtons();
  scheduleContextGauge(); // 案上的附件也是下一问要送出的，计数随之变
}
// 引用追问：在回复或自己的话里划选一段，浮出「引用」；点了就作为引文带进输入框，随下一问送出
function renderQuote() {
  const box = $("#composerQuote");
  if (!box) return;
  box.classList.toggle("hidden", !pendingQuote);
  box.querySelector(".composer-quote-text").textContent = pendingQuote?.text || "";
  renderSendButtons();
  scheduleContextGauge();
}
// 划选的这段在正文里是第几次出现：同一条回复里同样的词可能出现不止一次，重画后单靠 indexOf 会落到第一处。
// 数的是划选起点之前出现过几回，空白全去掉再数——与 markAnchor 里的找法一致
function occurrenceBefore(body, range, text) {
  try {
    const pre = document.createRange();
    pre.selectNodeContents(body);
    pre.setEnd(range.startContainer, range.startOffset);
    const picked = pre.cloneContents();
    picked.querySelectorAll?.(".viz, .html-app, .math-pending, sup.note-ref").forEach(node => node.remove());
    return countOccurrences(foldSpace(picked.textContent), foldSpace(text));
  } catch {
    return 0;
  }
}
const foldSpace = value => String(value || "").replace(/\s+/g, "");
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) count += 1;
  return count;
}
// 正文里此刻划选的一段：所在消息、文字、第几次出现，以及它在页面上的位置。没划、划在正文之外、太短，都是 null
function selectionAnchor() {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || view !== "chat" || !currentId) return null;
  const range = selection.getRangeAt(0);
  let text = selection.toString().trim();
  // 划选跨过了已有旁注的小标（脚注号）：那个数字不是正文，去掉，否则落点在正文里找不到
  const picked = range.cloneContents();
  if (picked.querySelector?.("sup.note-ref")) {
    picked.querySelectorAll("sup.note-ref").forEach(node => node.remove());
    text = picked.textContent.trim();
  }
  const host = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const body = host?.closest("#messages .message .markdown, #messages .message .user-bubble"),
    article = body?.closest("[data-message]");
  if (!body || !article || text.length < 2 || body.closest(".message-editor")) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { text: text.slice(0, 1200), messageId: article.dataset.message, occurrence: occurrenceBefore(body, range, text), rect };
}
function setupQuoteTip() {
  const tip = $("#quoteTip");
  let current = null,
    timer = null;
  const hide = () => {
    current = null;
    if (!tip.classList.contains("hidden")) tip.classList.add("hidden");
  };
  const check = () => {
    const picked = selectionAnchor();
    if (!picked) return hide();
    const { rect, ...anchor } = picked;
    current = anchor;
    tip.style.left = `${Math.min(innerWidth - 40, Math.max(40, rect.left + rect.width / 2))}px`;
    tip.style.top = `${Math.max(8, rect.top - 34)}px`;
    tip.classList.remove("hidden");
  };
  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(check, 120);
  });
  $("#chatScroll").addEventListener("scroll", hide, { passive: true });
  tip.addEventListener("pointerdown", event => event.preventDefault()); // 别让点击把划选清掉
  tip.addEventListener("click", event => {
    const button = event.target.closest("[data-tip]");
    if (!button || !current) return hide();
    const picked = current;
    getSelection()?.removeAllRanges();
    hide();
    if (button.dataset.tip === "note") return createThread(picked);
    pendingQuote = picked;
    renderQuote();
    persistDraft();
    const input = $("#chatInput");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

  // ---- 10-side-notes.js ----
// 言 · 旁注：锚点、面板、侧线请求
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 旁注：附在正文某条消息某一处的旁支小对话。它读得到正文（到所注消息为止），正文永远读不到它 ----------
let sideThreadId = null; // 面板里正打开的旁注（内存态，刷新后收起，旁注本身仍在）
let sideIndexFor = null; // 目录页是从哪条消息打开的：目录里「另起一条」落在它上面
const noteCounts = new Map(); // messageId → 旁注数；参与消息签名，数量变了那条才重画
/** @param {Conversation} c */
function threadsOf(c) {
  return c?.threads || [];
}
// 旁注跟着它所注的那一问一答走：换到另一条分支，注在被换下去的那几条上的旁注便不在眼前（仍在册，换回来就回来）
/** @param {Conversation} c */
function visibleThreads(c) {
  const live = new Set((c?.messages || []).map(m => m.id));
  return threadsOf(c).filter(t => live.has(t.anchor?.messageId));
}
function currentThread() {
  return visibleThreads(currentConversation()).find(t => t.id === sideThreadId) || null;
}
/** @param {Conversation} c */
function refreshNoteCounts(c) {
  noteCounts.clear();
  for (const t of threadsOf(c)) if (t.anchor?.messageId) noteCounts.set(t.anchor.messageId, (noteCounts.get(t.anchor.messageId) || 0) + 1);
}
// 锚点只认消息 id：编辑与重答不会删掉旧消息，只会把它移进另一版本，所以旁注永远找得到它所注的那条
/**
 * @param {Conversation} c
 * @param {Thread} thread
 */
function anchorState(c, thread) {
  const id = thread.anchor?.messageId;
  return { live: c.messages.some(m => m.id === id), any: allMessages(c).some(m => m.id === id) };
}
/** @param {Thread} thread */
function sideJob(thread) {
  return thread ? requestJobs.get(`side:${thread.id}`) || null : null;
}
// 起一条旁注：划了一段就注在那一段上；没划（text 为空）就是就整条回复而谈——同一条回复上可以有几条
function createThread(anchor) {
  const c = currentConversation();
  if (!c || !anchor?.messageId) return;
  const whole = !String(anchor.text || "").trim();
  const thread = {
    id: uid(),
    anchor: {
      messageId: anchor.messageId,
      text: whole ? "" : String(anchor.text).slice(0, 1200),
      occurrence: whole ? 0 : Number(anchor.occurrence) || 0
    },
    createdAt: now(),
    updatedAt: now(),
    messages: []
  };
  (c.threads ||= []).push(thread);
  saveStore();
  renderConversation(false);
  openSidePanel(thread.id);
}
function openSidePanel(threadId) {
  sideThreadId = threadId;
  sideFollow = true;
  bindSideScroll();
  showNow($("#sidePanel"));
  renderSidePanel();
  syncActiveAnchor();
  setTimeout(() => $("#sideInput")?.focus(), 0);
}
// 目录页：这段对话里的旁注都列在这里，点哪条开哪条；从一条回复的「旁注」进来的，还能就那条回复另起一条
function openSideIndex(messageId = null) {
  sideThreadId = null;
  sideIndexFor = messageId;
  showNow($("#sidePanel"));
  renderSidePanel();
  syncActiveAnchor();
}
function sidePanelOpen() {
  const panel = $("#sidePanel");
  return !!panel && !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
function closeSidePanel() {
  sideThreadId = null;
  sideIndexFor = null;
  syncActiveAnchor();
  const panel = $("#sidePanel");
  if (panel && !panel.classList.contains("hidden")) hideWithFade(panel);
}
function syncActiveAnchor() {
  for (const mark of document.querySelectorAll("#messages mark.note-anchor, #messages sup.note-ref"))
    mark.classList.toggle("active", mark.dataset.thread === sideThreadId);
}
// 所注段落在正文里的落点：把锚文本在这条消息渲染后的文字里找出来包成 <mark>，点它即打开那条旁注。按文字节点逐段包，跨行内元素也能落上
// 每次都从干净的正文重新落：先拆掉上一回包的 mark 与小标，再逐条旁注去找——重画过的段落（时间线里重画的话、就地换过的图表）不会留下漏标，
// 两条旁注划的段落有重叠也各自落得上（里面那条嵌在外面那条的 mark 里）
function decorateNoteAnchors(article) {
  const c = currentConversation();
  if (!c || !article?.dataset?.message || article.dataset.status === "streaming") return;
  const bodies = [...article.querySelectorAll(".markdown, .user-bubble")].filter(
    body => !body.closest(".message-editor") && !body.parentElement?.closest(".markdown")
  );
  for (const body of bodies) clearNoteAnchors(body);
  const threads = threadsOf(c).filter(t => t.anchor.messageId === article.dataset.message && t.anchor.text);
  if (!threads.length || !bodies.length) return; // 整条回复的旁注没有落点，靠元信息行的「注」标进入
  // 正文可能不止一段（执事时间线里边做边说的话各在自己的分组里，末尾才是总结）：哪段里找得到就落在哪段
  threads.forEach((thread, index) => bodies.some(body => markAnchor(body, thread, index + 1)));
}
function clearNoteAnchors(body) {
  if (!body.querySelector("mark.note-anchor, sup.note-ref")) return;
  body.querySelectorAll("sup.note-ref").forEach(node => node.remove());
  body.querySelectorAll("mark.note-anchor").forEach(mark => mark.replaceWith(...mark.childNodes));
  body.normalize();
}
function textNodesIn(root) {
  const nodes = [],
    walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node =>
        node.parentElement?.closest(".viz, .html-app, .math-pending, sup.note-ref") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}
// 第 n 次出现的位置（n 从 0 起）；不够 n 次就退到第一次，一次也没有才是 -1
function nthIndexOf(haystack, needle, n) {
  if (!needle) return -1;
  let at = haystack.indexOf(needle);
  for (let i = 0; i < n && at >= 0; i++) {
    const next = haystack.indexOf(needle, at + 1);
    if (next < 0) break;
    at = next;
  }
  return at;
}
/** @param {Thread} thread */
function markAnchor(body, thread, ordinal) {
  const nodes = textNodesIn(body);
  if (!nodes.length) return false;
  const starts = [];
  let joined = "";
  for (const node of nodes) {
    starts.push(joined.length);
    joined += node.data;
  }
  // 同样的词在这条回复里出现不止一次时，按记下的「第几次」落；这一版里没那么多次了（改过、另一版本）就退到第一处
  const needle = thread.anchor.text,
    occurrence = Number(thread.anchor.occurrence) || 0;
  let from = nthIndexOf(joined, needle, occurrence),
    to = from + needle.length;
  if (from < 0) {
    // 划选得到的文字与渲染文字在空白上多半不一致（换行、缩进；跨段划选时段与段之间有换行、而文字节点连起来没有）：
    // 两边把空白全去掉再找，再把位置映射回原文
    const map = [];
    let folded = "";
    for (let i = 0; i < joined.length; i++) {
      if (/\s/.test(joined[i])) continue;
      folded += joined[i];
      map.push(i);
    }
    const target = needle.replace(/\s+/g, ""),
      at = nthIndexOf(folded, target, occurrence);
    if (at < 0 || !target) return false;
    from = map[at];
    to = map[at + target.length - 1] + 1;
  }
  // 从后往前包：splitText 只影响后面的节点，前面的偏移保持有效；句末（最后一段）缀一枚小标，像脚注号
  let tagged = false;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i],
      nodeStart = starts[i],
      nodeEnd = nodeStart + node.data.length;
    const s = Math.max(from, nodeStart),
      e = Math.min(to, nodeEnd);
    if (s >= e) continue;
    let target = node;
    if (s > nodeStart) target = node.splitText(s - nodeStart);
    if (e < nodeEnd) target.splitText(e - s);
    const mark = document.createElement("mark");
    mark.className = "note-anchor";
    mark.dataset.thread = thread.id;
    mark.title = "打开这条旁注";
    target.replaceWith(mark);
    mark.append(target);
    if (!tagged) {
      const ref = document.createElement("sup");
      ref.className = "note-ref";
      ref.dataset.thread = thread.id;
      ref.textContent = String(ordinal);
      ref.title = "打开这条旁注";
      mark.after(ref);
      tagged = true;
    }
  }
  return tagged;
}
function renderSidePanel() {
  const c = currentConversation(),
    thread = currentThread();
  if (!c) return closeSidePanel();
  if (!thread) return renderSideIndex(c);
  $("#sidePanel").dataset.mode = "thread";
  const list = visibleThreads(c),
    at = list.indexOf(thread) + 1;
  $("#sideNav").innerHTML =
    list.length > 1
      ? `<button class="message-action" type="button" data-side-nav="-1" title="上一条旁注" ${at <= 1 ? "disabled" : ""}>‹</button><span>${at}/${list.length}</span><button class="message-action" type="button" data-side-nav="1" title="下一条旁注" ${at >= list.length ? "disabled" : ""}>›</button>`
      : "";
  // 所注的一段列在顶上，点它回到出处；就整条回复起的旁注没有范围可言，不列
  const { live, any } = anchorState(c, thread),
    anchorEl = $("#sideAnchor");
  anchorEl.textContent = thread.anchor.text;
  anchorEl.classList.toggle("hidden", !thread.anchor.text);
  anchorEl.classList.toggle("lost", !live);
  anchorEl.disabled = !live;
  anchorEl.title = live ? "回到出处" : any ? "所注段落在另一版本中" : "所注段落已不在此对话中";
  const host = $("#sideMessages");
  if (!thread.messages.length) host.innerHTML = `<div class="side-empty" data-message="__empty">就此处追问<br>所答不入正文</div>`;
  else {
    const { added } = syncNodes(
      host,
      thread.messages.map(m => ({ key: m.id, message: m, branch: null, side: true })),
      false
    );
    for (const node of added) renderEnhancements(node);
  }
  renderSideSend();
  // 生成中用户往上翻了就不再拉回底部；换了旁注、发出新一问时照旧到底
  const scroller = $("#sideScroll");
  if (sideFollow) scroller.scrollTop = scroller.scrollHeight;
}
// 目录：按所注消息在对话里的先后排，同一条消息上的按起注时间排；每条列所注的一段（整条回复的列第一问），
// 下面一行是落在第几答、几问几答、最近一次动笔
/** @param {Conversation} c */
function renderSideIndex(c) {
  $("#sidePanel").dataset.mode = "index";
  $("#sideNav").innerHTML = "";
  $("#sideAnchor").classList.add("hidden");
  const order = new Map(c.messages.map((m, i) => [m.id, i])),
    list = [...visibleThreads(c)].sort(
      (a, b) => order.get(a.anchor.messageId) - order.get(b.anchor.messageId) || String(a.createdAt).localeCompare(String(b.createdAt))
    );
  const where = thread => {
    const index = order.get(thread.anchor.messageId),
      message = c.messages[index],
      nth = c.messages.slice(0, index + 1).filter(m => m.role === message.role).length;
    return `第${chineseNumber(nth)}${message.role === "user" ? "问" : "答"}`;
  };
  const items = list
    .map((thread, i) => {
      const asked = thread.messages.filter(m => m.role === "user").length,
        lead = thread.anchor.text || thread.messages.find(m => m.role === "user")?.content || "尚未落笔",
        running = !!sideJob(thread);
      return `<button type="button" class="side-index-item${thread.anchor.messageId === sideIndexFor ? " here" : ""}" data-side-open="${escapeHtml(thread.id)}"><span class="side-index-num">${i + 1}</span><span class="side-index-copy"><strong>${escapeHtml(lead)}</strong><small>${escapeHtml(where(thread))} · ${asked ? `${escapeHtml(chineseNumber(asked, true))}问` : "未问"}${running ? " · 作答中" : ""} · ${escapeHtml(formatDay(thread.updatedAt || thread.createdAt))}</small></span></button>`;
    })
    .join("");
  // 「＋」另起一条：正文里划着一段就注在那一段上；没划就是就整条回复而谈（从哪条回复进来的就是哪条，否则是最末一答）
  $("#sideMessages").innerHTML =
    `<div class="side-index" data-message="__index"><button type="button" class="side-index-new" data-side-new title="划选正文中的一段即注在那一段上；未划选则就整条回复而谈"><span>＋</span>另起一条</button>${
      items || `<div class="side-empty">还没有旁注<br>划选正文中的一段，或按上面的「＋」</div>`
    }</div>`;
  renderSideSend();
}
// 目录页「＋」落在哪条消息上：划着正文就是那一段；否则是打开目录时的那条回复，再不然是最末一答
/** @param {Conversation} c */
function indexNewAnchor(c) {
  const picked = selectionAnchor();
  if (picked) return { messageId: picked.messageId, text: picked.text, occurrence: picked.occurrence };
  const id =
    (sideIndexFor && c.messages.some(m => m.id === sideIndexFor) ? sideIndexFor : null) ||
    [...c.messages].reverse().find(m => m.role === "assistant" && m.status !== "streaming")?.id ||
    [...c.messages].reverse().find(m => m.role !== "context")?.id;
  return id ? { messageId: id, text: "" } : null;
}
// 旁注面板的跟随：贴着底部时随生成往下走，往上翻就停，翻回底部再跟——与正文那侧一个规矩
let sideFollow = true;
function bindSideScroll() {
  const el = $("#sideScroll");
  if (!el || el.dataset.bound) return;
  el.dataset.bound = "1";
  el.addEventListener(
    "wheel",
    e => {
      if (e.deltaY < 0) sideFollow = false;
    },
    { passive: true }
  );
  el.addEventListener("scroll", () => {
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (gap < 8) sideFollow = true;
    else if (gap > FOLLOW_THRESHOLD) sideFollow = false;
  });
}
function renderSideSend() {
  const running = !!sideJob(currentThread()),
    button = $("#sideSend");
  if (!button) return;
  sealGlyph(button, running);
  button.title = running ? "停止" : "发送";
  button.classList.toggle("stop-btn", running);
  button.classList.toggle("empty", !running && !$("#sideInput")?.value.trim());
}
function setupSidePanel() {
  $("#sideClose").onclick = closeSidePanel;
  $("#sideExpand").onclick = () => {
    const panel = $("#sidePanel"),
      wide = !panel.classList.contains("wide");
    panel.classList.toggle("wide", wide);
    const b = $("#sideExpand");
    b.textContent = wide ? "窄" : "阔";
    b.title = wide ? "收回侧边" : "铺满整页";
    b.setAttribute("aria-pressed", String(wide));
  };
  $("#chatMeta").addEventListener("click", e => {
    if (!e.target.closest("[data-open-notes]")) return;
    if (visibleThreads(currentConversation()).length) openSideIndex();
  });
  $("#sideBack").onclick = () => openSideIndex(currentThread()?.anchor.messageId || null);
  // 按「＋」前不让这一下把正文里的划选清掉，落点才认得出来
  $("#sideMessages").addEventListener("pointerdown", e => {
    if (e.target.closest("[data-side-new]")) e.preventDefault();
  });
  $("#sideMessages").addEventListener("click", e => {
    const open = e.target.closest("[data-side-open]");
    if (open) return openSidePanel(open.dataset.sideOpen);
    if (!e.target.closest("[data-side-new]")) return;
    const c = currentConversation(),
      anchor = c && indexNewAnchor(c);
    if (!anchor) return toast("这段对话里还没有可注的回复");
    getSelection()?.removeAllRanges();
    createThread(anchor);
  });
  $("#sideSend").onclick = () => void sendSide();
  const input = $("#sideInput");
  input.addEventListener("input", () => {
    grow(input);
    renderSideSend();
  });
  input.addEventListener("keydown", e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendSide();
    }
  });
  $("#sideNav").addEventListener("click", e => {
    const button = e.target.closest("[data-side-nav]");
    if (!button) return;
    const list = visibleThreads(currentConversation()),
      index = list.findIndex(t => t.id === sideThreadId) + Number(button.dataset.sideNav);
    if (list[index]) openSidePanel(list[index].id);
  });
  $("#sideAnchor").onclick = () => {
    const thread = currentThread();
    if (!thread) return;
    const source = document.querySelector(`#messages [data-message="${CSS.escape(thread.anchor.messageId)}"]`);
    if (!source) return toast("所注段落不在当前版本中");
    followBottom = false;
    scrollChatTo(source, "center");
    source.classList.remove("flash");
    void source.offsetWidth;
    source.classList.add("flash");
  };
  $("#sideRemove").onclick = async () => {
    const c = currentConversation(),
      thread = currentThread();
    if (!c || !thread) return;
    if (
      thread.messages.length &&
      !(await askConfirm({ title: "移除这条旁注？", body: "旁注里的问答将一并移除，正文不受影响。", ok: "移除" }))
    )
      return;
    const job = sideJob(thread);
    if (job) {
      job.controller.abort();
      requestJobs.delete(`side:${thread.id}`);
    }
    c.threads = threadsOf(c).filter(t => t !== thread);
    saveStore();
    renderConversation(false);
    if (visibleThreads(c).length) openSideIndex(thread.anchor.messageId);
    else closeSidePanel();
  };
  $("#sideMessages").addEventListener("click", async e => {
    const button = e.target.closest("[data-action]");
    if (!button) return;
    const c = currentConversation(),
      thread = currentThread(),
      id = button.closest("[data-message]")?.dataset.message,
      index = thread ? thread.messages.findIndex(m => m.id === id) : -1,
      message = index >= 0 ? thread.messages[index] : null;
    if (!c || !thread || !message) return;
    const action = button.dataset.action;
    if (action === "copy") {
      await copyText(message.content);
      return toast("已复制");
    }
    if (sideJob(thread)) return toast("生成中，稍后再改");
    if (action === "cancel-edit") {
      editingMessageId = null;
      return renderSidePanel();
    }
    if (action === "edit") {
      editingMessageId = message.id;
      renderSidePanel();
      requestAnimationFrame(() => {
        const input = document.querySelector(`#sideMessages [data-message="${CSS.escape(message.id)}"] .message-edit-input`);
        growEditor(input);
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
      return;
    }
    if (action === "save-edit") {
      const text = button.closest("[data-message]").querySelector(".message-edit-input").value.trim();
      editingMessageId = null;
      if (!text) return renderSidePanel();
      message.content = text;
      message.timestamp = now();
      return askSideAgain(c, thread, index + 1);
    }
    // 重新生成：换掉这一答（及其后的往来），就上一问再答一次
    if (action === "regenerate") {
      const question = thread.messages.slice(0, index).findLastIndex(m => m.role === "user");
      if (question < 0) return;
      return askSideAgain(c, thread, question + 1);
    }
  });
  $("#messages").addEventListener("click", e => {
    const anchor = e.target.closest("mark.note-anchor, sup.note-ref");
    if (anchor) {
      if (getSelection()?.isCollapsed !== false) {
        e.preventDefault();
        openSidePanel(anchor.dataset.thread);
      }
      return;
    }
    const pick = e.target.closest("[data-pick-model]");
    if (pick) {
      e.preventDefault();
      e.stopPropagation();
      $("#chatInput")?.closest(".composer")?.querySelector(".model-trigger")?.click();
      return;
    }
    const local = e.target.closest("[data-open-memory], [data-open-talk]");
    if (local) {
      e.preventDefault();
      if (local.dataset.openTalk) {
        if (store.conversations.some(c => c.id === local.dataset.openTalk)) openConversation(local.dataset.openTalk);
        else toast("这段对话已不在");
      } else openSettings("memory");
      return;
    }
    const mark = e.target.closest("[data-note-mark]");
    if (!mark) return;
    e.preventDefault();
    e.stopPropagation();
    const id = mark.closest("[data-message]")?.dataset.message,
      list = threadsOf(currentConversation()).filter(t => t.anchor.messageId === id);
    if (!list.length) return;
    if (list.length === 1) openSidePanel(list[0].id);
    else openSideIndex(id); // 同一条消息上有几条旁注时，到目录里挑
  });
}
async function sendSide() {
  const c = currentConversation(),
    thread = currentThread();
  if (!c || !thread) return;
  const job = sideJob(thread);
  if (job) {
    requestJobs.delete(`side:${thread.id}`);
    job.controller.abort();
    return;
  }
  const input = $("#sideInput"),
    text = input.value.trim();
  if (!text) return;
  const profile = activeProfile();
  if (!profile) {
    toast("请先接入模型");
    return openSettings("models");
  }
  if (parseTokenLimit(profile.quota) === null) {
    toast("请先为该模型设置用量上限");
    return openSettings("models");
  }
  if (quotaBlocked(profile))
    return toast(quotaExhausted(profile) ? "余墨已尽，请调高上限或更换模型" : "余墨不足：进行中的对话已占去余量，请稍候");
  /** @type {Message} */
  const user = { id: uid(), role: "user", content: text, timestamp: now() };
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  thread.messages.push(user, assistant);
  thread.updatedAt = now();
  input.value = "";
  grow(input);
  saveStore();
  sideFollow = true;
  renderSidePanel();
  await streamSideReply(c, thread, assistant, profile);
}
// 就旁注里的某一问再答：截掉从 from 起的往来（那一问之后的），另起一答。编辑后重问与重新生成都走这里
/**
 * @param {Conversation} c
 * @param {Thread} thread
 */
async function askSideAgain(c, thread, from) {
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (parseTokenLimit(profile.quota) === null) return toast("请先为该模型设置用量上限");
  if (quotaBlocked(profile)) return toast(quotaExhausted(profile) ? "余墨已尽，请调高上限或更换模型" : "余墨不足，请稍候");
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  thread.messages = [...thread.messages.slice(0, from), assistant];
  thread.updatedAt = now();
  saveStore();
  sideFollow = true;
  renderSidePanel();
  await streamSideReply(c, thread, assistant, profile);
}
// 旁注的上下文：正文到所注消息为止（尊重此前的压缩）+ 一句说明 + 这条旁注自己的往来。只带查阅类工具；正文的请求从不读 threads
/**
 * @param {Conversation} conversation
 * @param {Thread} thread
 * @param {Message} assistant
 * @param {Profile} profile
 */
async function streamSideReply(conversation, thread, assistant, profile) {
  const key = `side:${thread.id}`,
    job = { controller: new AbortController(), assistantId: assistant.id, threadId: thread.id, conversationId: conversation.id };
  requestJobs.set(key, job);
  renderSideSend();
  // 旁注是折起注脚式的行迹，不是执事的时间线（正文那侧的画法记在消息上，见 streamReply）
  assistant.work = false;
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  /** @type {Array<Record<string, any>>} */
  let history = [];
  let opened = false,
    usageKnown = false;
  try {
    const anchorIndex = conversation.messages.findIndex(m => m.id === thread.anchor.messageId);
    const main = anchorIndex >= 0 ? conversation.messages.slice(0, anchorIndex + 1) : conversation.messages;
    const contextIndex = main.map(m => m.role).lastIndexOf("context");
    const source = main
      .slice(contextIndex + 1)
      .filter(m => m.status !== "error" && m.status !== "streaming" && ["user", "assistant"].includes(m.role));
    history = summaryMessages(contextIndex >= 0 ? main[contextIndex] : null);
    history.push(...(await historyForApi(source, null)));
    const own = thread.messages.filter(m => m.id !== assistant.id && m.status !== "error" && (m.role === "user" || m.content));
    own.forEach((m, index) =>
      history.push({
        role: m.role,
        content:
          m.role === "user" && index === 0 && thread.anchor.text ? quotedText({ ...m, quote: { text: thread.anchor.text } }) : m.content
      })
    );
    // 旁注带只查不改的工具（检索、翻网页、翻文档、翻记忆）：模型说「我去查一下」就真能查，不会说完就断在那里；
    // 没有工具可用时（模型关了本机工具、没桥接）在提示里说明，免得它许诺去查
    const tools = profile.tools !== false ? toolDefinitions(conversation, { lookup: true }) : null;
    const systemPrompt = `${assistantHint(profile, tools, conversation)}\n\n${prompt(thread.anchor.text ? "side.passage" : "side.whole")}${tools ? "" : `\n${prompt("side.noTools")}`}`;
    const overrides = { systemPrompt, tools, enableSearch: false, reasoning: conversation.reasoning || "" };
    const onFrame = () => {
      if (sideThreadId !== thread.id || !sideFollow) return;
      const el = $("#sideScroll");
      if (el) el.scrollTop = el.scrollHeight;
    };
    const toolCache = new Map();
    let rounds = 0;
    for (;;) {
      assistant.toolCalls = null;
      assistant.usage = null;
      const roundStart = assistant.content.length;
      await readReply(profile, history, job.controller.signal, overrides, assistant, false, () => (opened = true), onFrame);
      if (assistant.usage) {
        usageKnown = true;
        for (const key of Object.keys(usage)) usage[key] += Number(assistant.usage[key] || 0);
      }
      const calls = (assistant.toolCalls || []).filter(call => call.name);
      if (!calls.length || !overrides.tools) break;
      if (++rounds > toolRoundLimit()) {
        const said = assistant.content.slice(roundStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push({ role: "user", content: "工具调用轮次已达上限，请不要再调用工具，直接根据已有结果作答。" });
        overrides.tools = null;
        if (assistant.content) assistant.content += "\n\n";
        continue;
      }
      /** @type {Step[]} */
      const steps = calls.map(call => ({
        id: call.id || `call_${uid().slice(0, 8)}`,
        name: call.name,
        arguments: call.arguments || "{}",
        status: "running",
        at: assistant.content.length,
        rat: String(assistant.reasoning || "").length
      }));
      (assistant.steps ||= []).push(...steps);
      refreshSteps(assistant);
      history.push({
        role: "assistant",
        content: assistant.content.slice(roundStart) || null,
        tool_calls: steps.map(step => ({ id: step.id, type: "function", function: { name: step.name, arguments: step.arguments } })),
        ...(assistant.thinkingBlocks?.length ? { thinking_blocks: assistant.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, job.controller.signal, toolCache);
      for (const step of steps) history.push({ role: "tool", tool_call_id: step.id, content: outcomes.get(step.id) ?? "" });
      if (assistant.content) assistant.content += "\n\n";
    }
    const leadTrim = assistant.content.match(/^\n*/)[0].length;
    assistant.content = assistant.content.replace(/^\n+|\n+$/g, "");
    if (leadTrim) for (const step of assistant.steps || []) if (typeof step.at === "number") step.at = Math.max(0, step.at - leadTrim);
    if (!assistant.content) throw Error(assistant.steps?.length ? "模型查阅后未返回正文" : "模型未返回正文");
    assistant.status = "complete";
    thread.updatedAt = now();
  } catch (error) {
    settleSteps(assistant, error.name === "AbortError" ? "已停止" : "已中断");
    if (error.name === "AbortError") assistant.status = "stopped";
    else {
      assistant.status = "error";
      assistant.error = friendlyError(error.message);
    }
  } finally {
    // 停止或中断也结算：接口接下了请求就花了墨；查阅了几轮的，各轮用量相加
    assistant.usage = usageKnown ? usage : null;
    accountUsage(profile, assistant, history, conversation, { opened });
    if (requestJobs.get(key) === job) requestJobs.delete(key);
    saveStore();
    if (sideThreadId === thread.id && currentId === conversation.id) renderSidePanel();
    else renderSideSend();
  }
}

  // ---- 11-memory.js ----
// 言 · 录（记忆）：工具与设置页
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 一条条由模型在对谈中记下的话，跨对话可翻。内容不进系统提示，模型要看得自己 recall；旧对话也只在它去查时才给。
// 五件工具全在浏览器里完成、不经桥接，也不需确认——每一步都会在行迹里显示，条目在设置页可改可删。
const MEMORY_TOOLS = new Set(["remember", "forget", "recall", "search_conversations", "read_conversation"]);
// 会改动记忆的两件：帮手（差遣）拿不到，见 toolDefinitions 与 runTool
const MEMORY_WRITE_TOOLS = new Set(["remember", "forget"]);
// 差遣也并行：同一轮里派出的几名帮手同时开工，各自的卡片各自刷新；活是主模型分的，不重叠靠它分派时留意（工具说明里有交代）
const PARALLEL_TOOLS = new Set([
  "delegate",
  "run_js",
  "search_web",
  "fetch_page",
  "read_document",
  "read_file",
  "list_files",
  "search_files",
  "recall",
  "search_conversations",
  "read_conversation"
]);
const MAX_MEMORY_ITEMS = 200,
  MEMORY_TEXT_CHARS = 200,
  CONVERSATION_MESSAGE_CHARS = 1500;
function memoryEnabled() {
  return store.memory.enabled !== false;
}
function memoryId() {
  let id;
  do {
    id = "m" + Math.random().toString(36).slice(2, 7);
  } while (store.memory.items.some(item => item.id === id));
  return id;
}
function memoryLine(item) {
  return `[${item.id}] ${String(item.updatedAt || item.createdAt).slice(0, 10)}｜${item.text}`;
}
function keywordTerms(query) {
  return String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}
function hitsAll(text, terms) {
  const lower = String(text || "").toLowerCase();
  return terms.every(term => lower.includes(term));
}
function addMemory(text, source = null) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_TEXT_CHARS);
  if (!clean) return null;
  const item = { id: memoryId(), text: clean, createdAt: now(), updatedAt: now(), source };
  store.memory.items.push(item);
  saveStore();
  return item;
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 */
function runMemoryTool(step, args, conversation) {
  const items = store.memory.items;
  if (step.name === "remember") {
    const text = String(args.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MEMORY_TEXT_CHARS);
    step.title = text;
    if (!text) return { ok: false, content: "text 不能为空", display: "内容为空" };
    const source = { conversationId: conversation.id, title: conversation.title };
    const existing = (args.replaces && items.find(item => item.id === String(args.replaces))) || items.find(item => item.text === text);
    if (existing) {
      existing.text = text;
      existing.updatedAt = now();
      existing.source = source;
      saveStore();
      refreshMemorySettings();
      return { ok: true, content: `已更新 ${memoryLine(existing)}`, display: "已更新" };
    }
    if (items.length >= MAX_MEMORY_ITEMS)
      return {
        ok: false,
        content: `记忆已有 ${MAX_MEMORY_ITEMS} 条，已满。请先用 recall 查看，用 forget 删去过时的，或用 replaces 把相近的合并成一条`,
        display: "记忆已满"
      };
    const item = addMemory(text, source);
    refreshMemorySettings();
    return { ok: true, content: `已记入 ${memoryLine(item)}`, display: "已记入" };
  }
  if (step.name === "forget") {
    const index = items.findIndex(item => item.id === String(args.id || ""));
    step.title = index >= 0 ? items[index].text : String(args.id || "");
    if (index < 0) return { ok: false, content: "没有这条记忆，id 以 recall 的结果为准", display: "未找到" };
    items.splice(index, 1);
    saveStore();
    refreshMemorySettings();
    return { ok: true, content: "已删除", display: "已删除" };
  }
  if (step.name === "recall") {
    const terms = keywordTerms(args.query);
    step.title = terms.length ? String(args.query).trim() : "全部";
    const hits = terms.length ? items.filter(item => hitsAll(item.text, terms)) : items;
    step.results = hits.slice(0, 8).map(item => ({ title: item.text, memoryId: item.id }));
    return { ok: true, content: hits.length ? hits.map(memoryLine).join("\n") : "记忆里没有相关条目", display: `${hits.length} 条` };
  }
  if (step.name === "search_conversations") {
    const terms = keywordTerms(args.query);
    step.title = String(args.query || "").trim();
    if (!terms.length) return { ok: false, content: "query 不能为空", display: "缺少关键词" };
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 8)),
      hits = [];
    const sameRepo = c => isWork(conversation) && isWork(c) && c.workdir === conversation.workdir;
    for (const c of [...store.conversations].sort(
      (a, b) => Number(sameRepo(b)) - Number(sameRepo(a)) || String(b.updatedAt).localeCompare(String(a.updatedAt))
    )) {
      if (c.id === conversation.id) continue;
      const lines = (c.messages || []).filter(m => (m.role === "user" || m.role === "assistant") && m.content);
      if (!hitsAll(`${c.title}\n${lines.map(m => m.content).join("\n")}`, terms)) continue;
      const hit = lines.find(m => String(m.content).toLowerCase().includes(terms[0])),
        text = String(hit?.content || "").replace(/\s+/g, " ");
      const at = Math.max(0, text.toLowerCase().indexOf(terms[0]) - 40),
        snippet = text ? `${at ? "…" : ""}${text.slice(at, at + 120)}${at + 120 < text.length ? "…" : ""}` : "";
      hits.push({
        id: c.id,
        title: c.title,
        date: String(c.updatedAt || c.createdAt).slice(0, 10),
        count: lines.length,
        snippet,
        repo: isWork(c) ? (sameRepo(c) ? "同一目录" : `执事：${c.workdir}`) : ""
      });
      if (hits.length >= limit) break;
    }
    step.results = hits.map(hit => ({ title: hit.title, snippet: hit.snippet, conversationId: hit.id, date: hit.date }));
    return {
      ok: true,
      content: hits.length
        ? hits
            .map(
              hit =>
                `[${hit.id}] ${hit.date}「${hit.title}」共 ${hit.count} 条${hit.repo ? `（${hit.repo}）` : ""}${hit.snippet ? `\n  ${hit.snippet}` : ""}`
            )
            .join("\n")
        : "此前的对话里没有命中",
      display: `${hits.length} 段`
    };
  }
  if (step.name === "read_conversation") {
    const id = String(args.id || ""),
      c = store.conversations.find(item => item.id === id);
    step.title = c ? c.title : id;
    if (!c) return { ok: false, content: "没有这段对话，id 以 search_conversations 的结果为准", display: "未找到" };
    step.conversationId = c.id;
    step.date = c.updatedAt || c.createdAt;
    if (c.id === conversation.id) return { ok: false, content: "这是当前对话，无需读取", display: "当前对话" };
    const lines = (c.messages || []).filter(m => (m.role === "user" || m.role === "assistant") && (m.content || m.attachments?.length));
    const offset = Math.max(1, Number(args.offset) || 1),
      limit = Math.min(100, Math.max(1, Number(args.limit) || 40)),
      slice = lines.slice(offset - 1, offset - 1 + limit);
    const body = slice
      .map((m, i) => {
        const text = String(m.content || "（附件）").trim();
        return `${offset + i}. 【${m.role === "user" ? "用户" : "助手"}】${text.length > CONVERSATION_MESSAGE_CHARS ? `${text.slice(0, CONVERSATION_MESSAGE_CHARS)}…` : text}`;
      })
      .join("\n\n");
    const end = offset - 1 + slice.length;
    return {
      ok: true,
      content: `「${c.title}」${String(c.createdAt).slice(0, 10)}${isWork(c) ? ` · 执事：${c.workdir}` : ""}，共 ${lines.length} 条，此为第 ${offset}–${end} 条${end < lines.length ? `；后面还有 ${lines.length - end} 条` : ""}\n\n${body || "（这段对话没有正文）"}`,
      display: `${slice.length} 条`
    };
  }
  return { ok: false, content: `未知工具 ${step.name}`, display: "未知工具" };
}
// 设置页开着「记忆」时，模型记入或删去要立刻反映在列表里
function refreshMemorySettings() {
  if (settingsTab === "memory" && !$("#settingsModal").classList.contains("hidden")) renderSettings();
}
function memorySettingsHtml() {
  const items = [...store.memory.items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    enabled = memoryEnabled();
  const row = item => {
    const source =
      item.source?.conversationId && store.conversations.some(c => c.id === item.source.conversationId)
        ? `<button type="button" data-memory-open="${escapeHtml(item.source.conversationId)}" title="打开来源对话">${escapeHtml(item.source.title || "来源对话")}</button>`
        : item.source?.title
          ? `<span>${escapeHtml(item.source.title)}</span>`
          : `<span>手记</span>`;
    return `<div class="memory-item" data-memory="${escapeHtml(item.id)}"><textarea class="memory-text" rows="1" spellcheck="false" aria-label="记忆内容">${escapeHtml(item.text)}</textarea><div class="memory-meta"><span>${escapeHtml(formatDay(item.updatedAt || item.createdAt))}</span>${source}<span class="memory-spacer"></span><button type="button" data-memory-delete title="删去这条">删去</button></div></div>`;
  };
  return (
    `<div class="about-head memory-head"><span class="seal memory-seal" aria-hidden="true">录</span><h2>记忆</h2><span class="about-version">${items.length} / ${MAX_MEMORY_ITEMS} 条</span></div><p class="settings-lead">模型在对谈中记下长期有效的事，跨对话可翻阅。何时记、何时看由它判断；条目不随请求发送，也不经云端。</p>` +
    segmentRow(
      "启用记忆",
      "关闭后模型不再记入、也看不到已有条目；条目仍保留在此",
      "memoryEnabled",
      [
        ["true", "开"],
        ["false", "关"]
      ],
      String(enabled)
    ) +
    `<div class="memory-list">${items.length ? items.map(row).join("") : `<p class="memory-empty">尚无一条。模型记下的事会在此出现，亦可手记。</p>`}</div>` +
    `<div class="memory-foot"><button id="addMemory" class="outline-btn" type="button">手记一条</button>${items.length ? `<button id="clearMemory" class="outline-btn" type="button">清空记忆</button>` : ""}</div>`
  );
}
function bindMemoryEvents() {
  const host = $("#settingsContent");
  if (settingsTab !== "memory" || !host) return;
  const grow = area => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };
  host.querySelectorAll(".memory-item").forEach(row => {
    const item = store.memory.items.find(entry => entry.id === row.dataset.memory);
    if (!item) return;
    const area = row.querySelector("textarea");
    grow(area);
    area.addEventListener("input", () => {
      grow(area);
      const text = area.value.replace(/\s+/g, " ").trim().slice(0, MEMORY_TEXT_CHARS);
      if (text) {
        item.text = text;
        item.updatedAt = now();
        saveStoreSoon();
      }
    });
    area.addEventListener("blur", () => {
      if (!area.value.trim()) {
        store.memory.items = store.memory.items.filter(entry => entry !== item);
        saveStore();
        renderSettings();
      }
    });
    row.querySelector("[data-memory-delete]").addEventListener("click", () => {
      store.memory.items = store.memory.items.filter(entry => entry !== item);
      saveStore();
      renderSettings();
    });
    row.querySelector("[data-memory-open]")?.addEventListener("click", e => {
      closeSettings();
      openConversation(e.currentTarget.dataset.memoryOpen);
    });
  });
  $("#addMemory")?.addEventListener("click", () => {
    if (store.memory.items.length >= MAX_MEMORY_ITEMS) return toast(`记忆已有 ${MAX_MEMORY_ITEMS} 条，请先删去一些`);
    const item = { id: memoryId(), text: "", createdAt: now(), updatedAt: now(), source: null };
    store.memory.items.push(item);
    renderSettings();
    setTimeout(() => host.querySelector(`[data-memory="${item.id}"] textarea`)?.focus(), 0);
  });
  $("#clearMemory")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: "清空记忆？",
        body: `${store.memory.items.length} 条记忆将被移除，无法撤销；对话不受影响。`,
        ok: "清空"
      }))
    )
      return;
    store.memory.items = [];
    saveStore();
    renderSettings();
    toast("记忆已清空");
  });
}

  // ---- 12-composer.js ----
// 言 · 输入区、图片查看、问候语、主题与外观
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function composerHasContent() {
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
  return !!(input?.value.trim() || pendingAttachments.length || pendingQuote);
}
// 发送键是一方印：印文「寄」即发送，生成中换成「止」；只在变化时重写，免得每次刷新都打断动效
function sealGlyph(button, running) {
  const glyph = running ? "止" : "寄";
  if (button.dataset.glyph === glyph) return;
  button.dataset.glyph = glyph;
  button.innerHTML = `<span class="seal-glyph" aria-hidden="true">${glyph}</span>`;
}
// 作答途中：案上空着，印是「止」；写了话，印又成「寄」——寄出去的是补言，递给正在作答的模型，它读了就改道
function renderSendButtons() {
  const running = conversationRunning(),
    ended = conversationDry(currentConversation()),
    has = composerHasContent(),
    stop = running && !has;
  document.querySelectorAll(".send-trigger").forEach(b => {
    sealGlyph(b, stop);
    b.title = stop ? "停止生成" : running ? "插言引路：模型说到落点便读这句，可就此改道" : "发送";
    b.classList.toggle("stop-btn", stop);
    b.classList.toggle("empty", !running && !has);
    b.disabled = !running && ended;
  });
  const input = $("#chatInput");
  if (input && !input.disabled) input.placeholder = "续言于此"; // 生成中也不换提示语，能插言这件事由印上的「寄」示意
}
// 图片缩略图：原件在 IndexedDB，渲染后异步补上 src；缓存最近 40 张
async function loadThumbnails(root) {
  for (const img of root.querySelectorAll("img[data-thumb]:not([src])")) {
    const id = img.dataset.thumb;
    try {
      let url = thumbCache.get(id);
      if (!url) {
        const file = await getAttachment(id);
        if (!file || file.kind !== "image") continue;
        url = file.data;
        thumbCache.set(id, url);
        if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value);
      }
      img.src = url;
      img.closest(".attachment-card, .library-card")?.classList.add("has-thumb");
    } catch {}
  }
}

function toggleImageViewerZoom() {
  const stage = $("#imageViewerStage"),
    actual = !stage.classList.contains("actual");
  stage.classList.toggle("actual", actual);
  $("#imageViewerZoom").textContent = actual ? "适应" : "原图";
  $("#imageViewerZoom").setAttribute("aria-pressed", String(actual));
}
function closeImageViewer() {
  const viewer = $("#imageViewer");
  if (viewer.classList.contains("hidden")) return;
  viewer.classList.add("hidden");
  $("#imageViewerImage").removeAttribute("src");
  $("#imageViewerStage").classList.remove("actual");
  $("#imageViewerZoom").textContent = "原图";
  $("#imageViewerZoom").setAttribute("aria-pressed", "false");
  imageViewerAttachmentId = null;
  const target = imageViewerReturnFocus;
  imageViewerReturnFocus = null;
  if (target?.isConnected) target.focus();
}
async function openImageViewer(id, trigger = null) {
  try {
    const file = await getAttachment(id);
    if (!file) return toast("图片原件已不在此浏览器中");
    if (file.kind !== "image") return openFileViewer({ attachmentId: id }, file.name, trigger);
    imageViewerAttachmentId = id;
    imageViewerArchivePath = null;
    imageViewerReturnFocus = trigger || document.activeElement;
    $("#imageViewerName").textContent = `${file.name || "图片"} · ${formatFileSize(file.size)}`;
    const image = $("#imageViewerImage");
    image.src = file.data;
    image.alt = file.name || "图片预览";
    $("#imageViewerStage").classList.remove("actual");
    $("#imageViewerZoom").textContent = "原图";
    $("#imageViewerZoom").setAttribute("aria-pressed", "false");
    $("#imageViewer").classList.remove("hidden");
    $("#imageViewerClose").focus();
  } catch {
    toast("图片读取失败");
  }
}

const GREETINGS = {
  night: ["夜深墨浓", "夜深人静，正宜长谈", "夜色未央，笔墨相候", "长夜无声，一纸独明"],
  morning: ["晨光入砚", "新墨初研", "清晨落笔，心思澄明", "晨露未晞，素纸已展"],
  day: ["落笔，便有回声", "案上清宁，纸有余白", "一纸铺展，静候墨来", "日色平和，纸墨相候"],
  evening: ["灯下长谈，不觉夜深", "一灯如豆，纸墨相亲", "暮色入窗，墨色渐深", "日暮灯明，余墨尚多"]
};
const WORK_GREETINGS = ["言毕，即行", "墨未干，事已行", "纸上落言，案前成事", "言之所至，行必随之"];
const greetingPick = Math.random();
function greeting() {
  if (workMode()) return WORK_GREETINGS[Math.floor(greetingPick * WORK_GREETINGS.length)];
  const h = new Date().getHours(),
    pool = GREETINGS[h < 6 ? "night" : h < 11 ? "morning" : h < 18 ? "day" : "evening"];
  return pool[Math.floor(greetingPick * pool.length)];
}
const WORK_SUGGESTIONS = [
  [
    "读懂这个项目",
    "先通读工作目录中的项目：用 list_files 与 read_file 了解结构与入口，然后用几段话说明它的用途、运行方式与值得留意之处。不要改动任何文件。"
  ],
  [
    "修一个问题",
    "在工作目录中定位并修复下面的问题：先用 search_files 找到相关代码，read_file 读懂上下文，再用 edit_file 做最小改动，最后运行相关测试或复现步骤验证：\n\n（问题描述）"
  ],
  [
    "加一个功能",
    "在工作目录中实现下面的功能：先看清现有结构与约定，用两三行说明方案，然后落实到文件并运行验证，不要改动无关代码：\n\n（功能描述）"
  ],
  ["写一段脚本并运行", "编写一个脚本完成下述事项，置于工作目录中；写好后运行一遍并给出输出，若有报错则修正至可运行：\n\n（要做的事）"]
];
function safeWebUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "未填写地址";
  }
}
// 明暗切换只动 transform 与 opacity：墨（或光）是几张铺在页面上的位图，从落点放大到盖满整屏，屏幕被完全盖住的那一帧换主题，
// 再让墨色退去、字迹从中浮出。全程在合成层上——不套遮罩、不动滤镜、不用 View Transitions。
// 此前是把新画面套在逐帧变化的遮罩里：遮罩每帧都要按整屏合成一遍，240 Hz 的屏上一眼看得出掉帧；主题重排那一下现在也藏在墨底下
let suppressThemeFade = false;
function switchTheme(next, origin) {
  const apply = () => {
    store.settings.theme = next;
    applyAppearance();
    renderHeader();
    if (view === "chat") renderConversation(false);
  };
  const willDark = next === "dark" || (next === "system" && matchMedia("(prefers-color-scheme: dark)").matches),
    current = document.documentElement.dataset.theme;
  if (inkMotionOff() || (willDark ? "dark" : "light") === current) {
    apply();
    saveStoreSoon();
    return;
  }
  // 存盘等动效走完再做：整个 store 序列化一次可能要几十毫秒，别落在动效中间
  void themeSheets()
    .then(sheets => (willDark ? runInkDrops(apply, sheets) : runDawn(apply, origin, sheets)))
    .finally(saveStoreSoon);
}
// 墨团与光晕的形状是 00-base.css 里几张带湍流滤镜的 SVG（--ink-blob-1/2/3、--dawn-glow）。开机后闲时各画成一张上了色的位图：
// 墨团填墨色、光晕填纸色，切换时只是把这几张图放大——矢量与滤镜一次也不在动效里算
const THEME_SHEETS = [
    ["blob1", "--ink-blob-1", "#1c1a17"],
    ["blob2", "--ink-blob-2", "#1c1a17"],
    ["blob3", "--ink-blob-3", "#1c1a17"],
    ["glow", "--dawn-glow", "#fffdf7"]
  ],
  SHEET_PX = 1024;
/** @type {Promise<Record<string, string>|null>|null} */
let themeSheetCache = null;
function themeSheets() {
  if (themeSheetCache) return themeSheetCache;
  themeSheetCache = Promise.all(
    THEME_SHEETS.map(async ([, name, color]) => {
      const url = cssVar(name).match(/^url\((["']?)(.*)\1\)$/s)?.[2];
      if (!url) throw Error(name);
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = SHEET_PX;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, SHEET_PX, SHEET_PX);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, SHEET_PX, SHEET_PX);
      return `url("${canvas.toDataURL("image/png")}")`;
    })
  )
    .then(urls => Object.fromEntries(THEME_SHEETS.map(([key], i) => [key, urls[i]])))
    .catch(() => {
      themeSheetCache = null;
      return null;
    });
  return themeSheetCache;
}
// 一张铺开的图：定在 (x, y)，从 from 放大到 to；返回节点与放大完成的 promise
function spreadSheet(url, x, y, { from, to, duration, delay = 0, easing }) {
  const el = document.createElement("div");
  el.className = "theme-sheet";
  el.style.cssText = `left:${x}px;top:${y}px;background-image:${url}`;
  document.body.append(el);
  const finished = el
    .animate([{ transform: `translate(-50%, -50%) scale(${from})` }, { transform: `translate(-50%, -50%) scale(${to})` }], {
      duration,
      delay,
      easing,
      fill: "both"
    })
    .finished.catch(() => {});
  return { el, finished };
}
// 盖住整屏之后：换主题、等一帧让新画面在底下画好，再让盖着的图退去
async function revealUnder(apply, sheets, fade) {
  apply();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await Promise.all(
    sheets.map(el =>
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fade, easing: "ease-out", fill: "both" }).finished.catch(() => {})
    )
  );
  sheets.forEach(el => el.remove());
}
const farthestCorner = (x, y) => Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
// 亮到暗「落墨」：三滴墨先后从画面上方落到纸上，各自洇开——大的那滴居中先落、洇得最快，另两滴偏左右、晚一步、慢一些。
// 墨团铺满整屏那一刻换主题，墨色再退成暗色的纸、字迹浮出
const INK_DROPS = [
  { x: 0.5, y: 0.46, size: 1, delay: 0, fall: 0.5, duration: 640, easing: "cubic-bezier(0.12, 0.86, 0.28, 1)" },
  { x: 0.34, y: 0.58, size: 0.76, delay: 60, fall: 0.4, duration: 760, easing: "cubic-bezier(0.12, 0.86, 0.28, 1)" },
  { x: 0.66, y: 0.37, size: 0.62, delay: 120, fall: 0.33, duration: 860, easing: "cubic-bezier(0.18, 0.78, 0.32, 1)" }
];
// 墨团图里实心的部分到半径的 52%，墨团本身占图的 80%：最远的角要落进实心里，图就得放到这么大；
// 位移滤镜把边缘往里推了些，再放宽近一半才保险。放大走到 COVER_AT 时换主题——不等铺完，全黑只停一两帧
const INK_SOLID = 0.8 * 0.52,
  GLOW_SOLID = 0.96 * 0.4,
  COVER_MARGIN = 1.45,
  COVER_AT = 0.55;
async function runInkDrops(apply, sheets) {
  if (!sheets) return apply();
  const points = INK_DROPS.map(drop => ({ ...drop, px: innerWidth * drop.x, py: innerHeight * drop.y }));
  await Promise.all(points.map(point => inkDropFall(point)));
  // 触纸：滴身钻进纸面，脚下洇出一圈墨——这圈墨就是随后那团暗色的起点
  points.forEach(point => inkSoak(point));
  suppressThemeFade = true;
  const spreads = points.map((point, i) =>
    spreadSheet(sheets[`blob${i + 1}`], point.px, point.py, {
      from: 0.04,
      to: (farthestCorner(point.px, point.py) / ((SHEET_PX / 2) * INK_SOLID)) * COVER_MARGIN * [1, 0.9, 0.8][i],
      duration: point.duration,
      delay: [30, 70, 110][i],
      easing: point.easing
    })
  );
  // 盖满就换，不等三团都铺完：第一团放大到五成半时（缓动前急后缓，这时已到九成六）实心已过最远的角，全黑只停一两帧
  await new Promise(resolve => setTimeout(resolve, 30 + points[0].duration * COVER_AT));
  try {
    await revealUnder(
      apply,
      spreads.map(spread => spread.el),
      400
    );
  } finally {
    suppressThemeFade = false;
    document.querySelectorAll(".ink-drop, .ink-soak, .theme-sheet").forEach(node => node.remove());
  }
}
// 一滴墨：在落点上方凝出、垂下、坠落时被拉长，触纸的一瞬摊成一小摊。滴身带高光与拖尾，落得越久拉得越长
function inkDropFall(point) {
  const fall = innerHeight * point.fall,
    width = Math.round(26 * point.size),
    height = Math.round(32 * point.size),
    drop = document.createElement("div");
  drop.className = "ink-drop";
  drop.style.cssText = `left:${point.px}px;top:${point.py - fall}px;width:${width}px;height:${height}px`;
  document.body.append(drop);
  const trail = document.createElement("div");
  trail.className = "ink-trail";
  trail.style.cssText = `left:${point.px}px;top:${point.py - fall}px;width:${Math.max(2, Math.round(width * 0.22))}px;height:${fall}px`;
  document.body.append(trail);
  trail
    .animate(
      [
        { transform: "translate(-50%, 0) scaleY(0)", opacity: 0 },
        { transform: "translate(-50%, 0) scaleY(0.75)", opacity: 0.45, offset: 0.6 },
        { transform: "translate(-50%, 0) scaleY(1)", opacity: 0 }
      ],
      { duration: 290, delay: point.delay + 135, easing: "cubic-bezier(0.55, 0, 0.9, 0.42)", fill: "both" }
    )
    .finished.catch(() => {});
  // 凝出、垂下、坠落、触纸摊开。坠落那一段单独用接近自由落体的曲线（位移随时间平方增长），
  // 前面的凝聚与末尾的摊开各用各的节奏，才不像一个匀速下滑的圆点
  const gather = drop.animate(
    [
      { transform: "translate(-50%, -62%) scale(0.2)", opacity: 0 },
      { transform: "translate(-50%, -52%) scale(0.92, 1.02)", opacity: 1, offset: 0.55 },
      // 将坠未坠：被自己的重量拉尖
      { transform: "translate(-50%, -46%) scale(0.74, 1.34)", opacity: 1 }
    ],
    { duration: 140, delay: point.delay, easing: "cubic-bezier(0.3, 0.6, 0.4, 1)", fill: "both" }
  );
  point.drop = drop;
  return gather.finished
    .catch(() => {})
    .then(() =>
      drop
        .animate(
          [
            { transform: "translate(-50%, -46%) scale(0.74, 1.34)" },
            { transform: `translate(-50%, calc(-46% + ${fall * 0.55}px)) scale(0.6, 1.72)`, offset: 0.68 },
            { transform: `translate(-50%, calc(-50% + ${fall}px)) scale(1.55, 0.48)` }
          ],
          // 自由落体：起步几乎不动，越落越快，最后一帧才砸到纸上
          { duration: 260, easing: "cubic-bezier(0.55, 0, 0.9, 0.42)", fill: "both" }
        )
        .finished.catch(() => {})
    )
    .finally(() => trail.remove());
}
// 渗入：落点上一圈边缘毛糙的墨，从滴身底下洇出来，越摊越大、越摊越淡；滴身随之压扁、沉进纸里。
// 一滴只画一个元素、只动 transform 与 opacity——旧版落地时溅的十几粒墨点是暗底上的暗点，几乎看不见，白费一份功夫
function inkSoak(point) {
  const size = Math.round(46 * point.size),
    soak = document.createElement("div");
  soak.className = "ink-soak";
  soak.style.cssText = `left:${point.px}px;top:${point.py}px;width:${size}px;height:${size}px`;
  document.body.append(soak);
  soak
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(0.35, 0.22)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1, 0.72)", opacity: 0.92, offset: 0.3 },
        { transform: "translate(-50%, -50%) scale(2.4, 2)", opacity: 0.55 }
      ],
      { duration: 620, easing: "cubic-bezier(0.2, 0.7, 0.25, 1)", fill: "both" }
    )
    .finished.catch(() => {});
  point.drop
    ?.animate(
      [
        { transform: `translate(-50%, calc(-50% + ${innerHeight * point.fall}px)) scale(1.55, 0.48)`, opacity: 1 },
        { transform: `translate(-50%, calc(-50% + ${innerHeight * point.fall}px)) scale(1.9, 0.16)`, opacity: 0 }
      ],
      { duration: 180, easing: "ease-in", fill: "both" }
    )
    .finished.catch(() => {});
}
// 暗到亮「天光」：墨是从高处落下来的，光则是从按下的那一点亮起来的——以砚台为心向四下漫开，先急后缓；
// 光把整屏照白的那一刻换主题，再让光退去，眼睛适应了天光，字迹浮出
async function runDawn(apply, origin, sheets) {
  if (!sheets) return apply();
  const rect = origin?.getBoundingClientRect?.(),
    x = rect ? rect.left + rect.width / 2 : innerWidth - 60,
    y = rect ? rect.top + rect.height / 2 : 28;
  suppressThemeFade = true;
  const glow = spreadSheet(sheets.glow, x, y, {
    from: 0.02,
    to: (farthestCorner(x, y) / ((SHEET_PX / 2) * GLOW_SOLID)) * COVER_MARGIN,
    duration: 820,
    easing: "cubic-bezier(0.5, 0.06, 0.3, 1)"
  });
  // 光先急后缓，照白整纸大约在七成处；照白就换，再让光退去
  await new Promise(resolve => setTimeout(resolve, 820 * 0.7));
  try {
    await revealUnder(apply, [glow.el], 480);
  } finally {
    suppressThemeFade = false;
    document.querySelectorAll(".theme-sheet").forEach(node => node.remove());
  }
}
function applyAppearance() {
  const { theme, inkMotion, font, width, accent } = store.settings;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const html = document.documentElement,
    nextTheme = dark ? "dark" : "light";
  // 只在明暗实际变化时挂一次颜色过渡，避免初始加载闪一下
  html.classList.toggle("theme-fade", !suppressThemeFade && !!html.dataset.theme && html.dataset.theme !== nextTheme);
  clearTimeout(themeFadeTimer);
  if (html.classList.contains("theme-fade")) themeFadeTimer = setTimeout(() => html.classList.remove("theme-fade"), 480);
  html.dataset.theme = nextTheme;
  html.dataset.inkMotion = inkMotion === "off" || (inkMotion === "system" && reducedMotion.matches) ? "off" : "on";
  if (window.mermaid) setupMermaid();
  document.documentElement.style.setProperty("--read", `${Number(width) || 760}px`);
  document.documentElement.style.setProperty("--accent", accent || "#9b5540");
  const root = document.documentElement.style,
    stacks = FONT_STACKS[font] || FONT_STACKS.mixed;
  html.dataset.font = FONT_STACKS[font] ? font : "mixed";
  root.setProperty("--body", stacks.body);
  root.setProperty("--title", stacks.title);
}
// 字体档。--title 是读的字（回复正文、标题、印），--body 是界面的字（侧栏、输入、设置）：混排（默认）界面黑、读宋；黑与宋是通体一种；
// 楷与仿宋只换读的字，界面仍是黑——楷与仿宋清瘦，小字号的界面用它费眼。楷与仿宋取自系统（Windows 的 KaiTi / FangSong，
// macOS 的楷体-简 / 仿宋-简），没有的机器落到宋。theme-boot.js 里有同一份表，改这里也要改那里
const SANS = '"Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif',
  SERIF = '"Noto Serif SC","Songti SC","STSong",serif',
  KAI = '"Kaiti SC","KaiTi","STKaiti","楷体","AR PL UKai CN",serif',
  FANGSONG = '"Fangsong SC","FangSong","STFangsong","仿宋","AR PL UMing CN",serif';
const FONT_STACKS = {
  mixed: { body: SANS, title: SERIF },
  sans: { body: SANS, title: SANS },
  serif: { body: SERIF, title: SERIF },
  kai: { body: SANS, title: KAI },
  fangsong: { body: SANS, title: FANGSONG }
};

  // ---- 13-files.js ----
// 言 · 文件接入、卷宗（磁盘目录 / 浏览器内）、文档抽取、下载
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
async function handleFiles(event) {
  await addFiles(event.target.files);
  event.target.value = "";
}
function isTextFile(file) {
  const extension = String(file.name || "")
      .split(".")
      .pop()
      .toLowerCase(),
    mime = String(file.type || "").toLowerCase();
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/x-javascript",
      "application/typescript",
      "application/yaml",
      "application/x-yaml",
      "application/csv"
    ].includes(mime) ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml") ||
    [
      "txt",
      "md",
      "markdown",
      "json",
      "jsonl",
      "csv",
      "tsv",
      "xml",
      "yaml",
      "yml",
      "js",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "jsx",
      "html",
      "htm",
      "css",
      "scss",
      "less",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "h",
      "cpp",
      "hpp",
      "cs",
      "php",
      "sh",
      "ps1",
      "sql",
      "toml",
      "ini",
      "log"
    ].includes(extension)
  );
}
async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (view === "library") return addLibraryFiles(files);
  let total = pendingAttachments.reduce((sum, file) => sum + Number(file.size || 0), 0),
    attachmentUsage = usedAttachmentBytes(),
    added = 0;
  for (const file of files) {
    if (pendingAttachments.length >= 10) {
      toast("一次最多置入 10 件附件");
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} 超过 ${limitLabel(MAX_FILE_BYTES)}，未置入`);
      continue;
    }
    if (total + file.size > MAX_PENDING_BYTES) {
      toast(`本次附件合计不超过 ${limitLabel(MAX_PENDING_BYTES)}`);
      break;
    }
    if (attachmentUsage + file.size > MAX_ATTACHMENTS_BYTES) {
      toast(`卷宗与附件原件合计已达 ${limitLabel(MAX_ATTACHMENTS_BYTES)} 上限，请先清理`);
      break;
    }
    try {
      pendingAttachments.push(await ingestFile(file));
      total += file.size;
      attachmentUsage += file.size;
      added += 1;
    } catch {
      toast(`${file.name} 读取失败`);
    }
  }
  persistDraft();
  renderAttachments();
  if (added) toast(`已置入 ${added} 件附件`);
}
async function ingestFile(file) {
  /** @type {Attachment["kind"]} */
  const kind = file.type.startsWith("image/") ? "image" : isTextFile(file) ? "text" : "file",
    id = uid();
  const data = await readFile(file, kind === "text" ? "text" : "data");
  const metadata = {
    id,
    kind,
    name: file.name || "未命名文件",
    mime: file.type || "application/octet-stream",
    size: file.size,
    modifiedAt: file.lastModified || Date.now()
  };
  let extractedText = "",
    extractionError = "";
  if (kind === "file")
    try {
      extractedText = await extractDocumentText(metadata.name, data);
    } catch (error) {
      extractionError = String(error.message || error).slice(0, 200);
    }
  await putAttachment({ ...metadata, data, extractedText, extractionError });
  // 顺手记下文字量的估算：上下文计数与「是否整份塞进提示」都按它算，不再拿文件字节数粗估（压缩过的 docx 字节数与字数没什么关系）
  const text = kind === "text" ? String(data || "") : extractedText;
  return { ...metadata, extracted: !!extractedText, ...(text ? { tokens: estimateText(text) } : {}) };
}

// ---------- 卷宗：跨对话保存的文件库 ----------
// 桥接在线时卷宗是磁盘上的一个目录（bootstrap.work.archive）：拖进来的文件落盘，没绑目录的对话里模型写出的文件也在这里，页面即目录的视图；
// 直连没桥接时退回浏览器内的版本：原件存在 IndexedDB，元数据记录在 store.library。两边都有时，浏览器内的旧件另列一组，可一键落盘
let archiveEntries = null,
  archiveScratch = null,
  archiveLoading = null;
function archiveOnline() {
  return apiBase !== null && !!archiveDir();
}
function archiveFileUrl(path, download = false) {
  return `${apiBase}/api/archive/file?root=${encodeURIComponent(archiveDir())}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}
async function refreshArchive() {
  if (!archiveOnline()) return;
  if (archiveLoading) return archiveLoading;
  archiveLoading = bridge("/api/archive/list", { root: archiveDir() }, AbortSignal.timeout(8000))
    .then(data => {
      archiveEntries = data.entries || [];
      archiveScratch = data.scratch || null;
    })
    .catch(error => {
      if (archiveEntries === null) toast(`卷宗目录不可用：${String(error.message || error).slice(0, 80)}`);
    })
    .finally(() => {
      archiveLoading = null;
      renderLibraryCount();
      if (view === "library") renderLibrary();
      // 答末的成品条：卷宗里删掉的那几件标成「已移出卷宗」
      syncDeliverables();
    });
  return archiveLoading;
}
function archiveKind(name) {
  const extension = String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(extension)) return "image";
  return isTextFile({ name, type: "" }) ? "text" : "file";
}
function openLibrary() {
  closeSidePanel();
  persistDraft();
  rememberScrollPosition();
  view = "library";
  render();
  void refreshArchive();
  if (isMobile()) toggleSidebar(true);
  setTimeout(() => $("#librarySearch").focus(), 0);
}
function closeLibrary() {
  view = "chat";
  render();
}
function libraryTotal() {
  return (archiveOnline() ? (archiveEntries || []).length : 0) + store.library.length;
}
function renderLibraryCount() {
  const total = libraryTotal();
  $("#libraryCount").textContent = total ? String(total) : "";
}
function libraryEntry(file) {
  return {
    id: file.id,
    kind: file.kind,
    name: file.name,
    mime: file.mime,
    size: file.size,
    modifiedAt: file.modifiedAt,
    extracted: !!file.extracted,
    savedAt: now()
  };
}
function libraryCardHtml(file, disk) {
  const kind = disk ? archiveKind(file.name) : file.kind,
    key = disk ? `data-library-disk="${escapeHtml(file.path)}"` : `data-library-item="${escapeHtml(file.id)}"`,
    thumb =
      kind !== "image"
        ? ""
        : disk
          ? `<img class="library-thumb" src="${escapeHtml(archiveFileUrl(file.path))}" alt="">`
          : `<img class="library-thumb" data-thumb="${escapeHtml(file.id)}" alt="">`,
    note = disk
      ? `${formatFileSize(file.size)} · ${escapeHtml(formatDay(file.modifiedAt))}${file.path.includes("/") ? ` · ${escapeHtml(file.path.slice(0, file.path.lastIndexOf("/")))}` : ""}`
      : `${formatFileSize(file.size)} · 收于 ${escapeHtml(formatDay(file.savedAt))}${file.kind === "file" && !file.extracted ? " · 未能提取正文" : ""}`;
  return `<div class="library-card${disk && kind === "image" ? " has-thumb" : ""}" ${key}><div class="library-preview"${kind === "image" ? ` role="button" tabindex="0" ${disk ? `data-open-disk-image="${escapeHtml(file.path)}"` : `data-open-image="${escapeHtml(file.id)}"`} title="查看 ${escapeHtml(file.name)}"` : ""}>${thumb}<span class="library-glyph" aria-hidden="true">${kindGlyph(kind)}</span><span class="attachment-type">${escapeHtml(fileTypeLabel(file))}</span></div><div class="library-body"><strong title="${escapeHtml(disk ? file.path : file.name)}">${escapeHtml(file.name)}</strong><small>${note}</small></div><div class="library-actions">${disk || previewKind(file.name) !== "none" ? `<button data-library-action="view" title="在此预览，不必下载">预览</button>` : ""}<button data-library-action="download">下载</button><button data-library-action="remove">${disk ? "删除" : "移出"}</button></div></div>`;
}
function renderLibrary() {
  const query = libraryQuery.trim().toLowerCase(),
    disk = archiveOnline(),
    matches = (name, kind) => (libraryKind === "all" || kind === libraryKind) && (!query || String(name).toLowerCase().includes(query));
  const diskItems = disk ? (archiveEntries || []).filter(file => matches(file.name, archiveKind(file.name))) : [],
    items = store.library.filter(file => matches(file.name, file.kind));
  const total = libraryTotal(),
    bytes = [...(disk ? archiveEntries || [] : []), ...store.library].reduce((sum, file) => sum + Number(file.size || 0), 0);
  $("#libraryCountText").textContent = total ? `现存 ${total} 件 · ${formatFileSize(bytes)}` : "";
  const lead = $("#libraryLead");
  if (lead)
    lead.innerHTML = disk
      ? `常用的文件收于此处；置于案上，便随下一问送出。卷宗即本机的一个目录：<code title="${escapeHtml(archiveDir())}">${escapeHtml(archiveDir())}</code>（可在设置里更换）；未绑目录的对话里，模型写出的文件亦落于此。${
          archiveScratch?.count
            ? `<span class="library-scratch">草稿 ${archiveScratch.count} 处 · ${formatFileSize(archiveScratch.bytes)}<button type="button" id="libraryCleanScratch" title="清理模型留下的脚本与中间文件（${escapeHtml(bootstrap.work?.scratch || ".草稿")}）">清理</button></span>`
            : ""
        }`
      : "常用的文件收于此处；置于案上，便随下一问送出。原件只存于此浏览器；运行 start.cmd 后，卷宗便落于本机目录。";
  $("#libraryCleanScratch")?.addEventListener("click", () => void cleanScratch(null));
  document
    .querySelectorAll("[data-library-kind]")
    .forEach(button => button.classList.toggle("active", button.dataset.libraryKind === libraryKind));
  const legacy =
    disk && store.library.length
      ? `<div class="library-section"><span>浏览器内的旧件 · ${store.library.length}</span><button type="button" id="libraryMigrate" class="outline-btn">全部落盘</button></div>`
      : "";
  $("#libraryGrid").innerHTML =
    diskItems.length || items.length
      ? `${diskItems.map(file => libraryCardHtml(file, true)).join("")}${legacy}${items.map(file => libraryCardHtml(file, false)).join("")}`
      : `<div class="library-empty">${total ? "没有匹配的卷宗" : disk && archiveEntries === null ? "正在翻开卷宗…" : "卷宗尚空<br>拖入文件即收入"}</div>`;
  $("#libraryMigrate")?.addEventListener("click", () => void migrateLibraryToArchive());
  void loadThumbnails($("#libraryGrid"));
}
// 文本以 UTF-8 编成 data: URL；二进制附件本就是 data: URL
function dataUrlFromText(text, mime = "text/plain") {
  const bytes = new TextEncoder().encode(String(text || ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
async function putArchiveFile(name, data) {
  return bridge("/api/archive/put", { root: archiveDir(), name, data }, AbortSignal.timeout(120000));
}
// 清草稿：给对话则只清它那一处（删对话时顺手），不给则整个 .草稿 目录（卷宗页上的「清理」）
/** @param {Conversation} conversation */
async function cleanScratch(conversation) {
  if (!archiveOnline() || (conversation && isWork(conversation))) return;
  if (
    !conversation &&
    !(await askConfirm({ title: "清理全部草稿？", body: "模型在卷宗里留下的脚本与中间文件将被删除，成品不受影响。", ok: "清理" }))
  )
    return;
  try {
    await bridge(
      "/api/archive/clean",
      { root: archiveDir(), id: conversation ? scratchRel(conversation).split("/").pop() : "" },
      AbortSignal.timeout(30000)
    );
    if (!conversation) {
      toast("草稿已清理");
      await refreshArchive();
    }
  } catch (error) {
    if (!conversation) toast(`清理失败：${String(error.message || error).slice(0, 80)}`);
  }
}
async function addLibraryFiles(fileList) {
  const files = Array.from(fileList || []);
  let added = 0;
  if (archiveOnline()) {
    for (const file of files) {
      if (file.size > MAX_ARCHIVE_FILE_BYTES) {
        toast(`${file.name} 超过 ${limitLabel(MAX_ARCHIVE_FILE_BYTES)}，未收入`);
        continue;
      }
      try {
        await putArchiveFile(file.name, await readFile(file, "data"));
        added += 1;
      } catch (error) {
        toast(`${file.name} 收入失败：${String(error.message || error).slice(0, 60)}`);
      }
    }
    await refreshArchive();
    if (added) toast(`已收入 ${added} 件`);
    return;
  }
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} 超过 ${limitLabel(MAX_FILE_BYTES)}，未收入`);
      continue;
    }
    if (usedAttachmentBytes() + file.size > MAX_ATTACHMENTS_BYTES) {
      toast(`卷宗与附件原件合计已达 ${limitLabel(MAX_ATTACHMENTS_BYTES)} 上限，请先清理`);
      continue;
    }
    try {
      store.library.unshift(libraryEntry(await ingestFile(file)));
      added += 1;
    } catch {
      toast(`${file.name} 读取失败`);
    }
  }
  saveStore();
  if (view === "library") renderLibrary();
  renderLibraryCount();
  if (added) toast(`已收入 ${added} 件`);
}
// 附件上的「藏」：桥接在线时原件落盘到卷宗目录，否则记进浏览器内的卷宗
async function saveToLibrary(id) {
  const metadata =
    pendingAttachments.find(file => file.id === id) ||
    store.conversations
      .flatMap(allMessages)
      .flatMap(m => m.attachments || [])
      .find(file => file.id === id);
  const file = metadata && (await getAttachment(id));
  if (!file) return toast("附件原件已不在此浏览器中");
  if (archiveOnline()) {
    try {
      const saved = await putArchiveFile(metadata.name, file.kind === "text" ? dataUrlFromText(file.data, file.mime) : file.data);
      void refreshArchive();
      toast(`${saved.name} 已收入卷宗`);
    } catch (error) {
      toast(`收入失败：${String(error.message || error).slice(0, 80)}`);
    }
    return;
  }
  if (inLibrary(id)) return toast("已在卷宗中");
  store.library.unshift(libraryEntry(metadata));
  saveStore();
  renderLibraryCount();
  toast(`${metadata.name} 已收入卷宗`);
}
// 浏览器内的旧件逐件落盘；落盘成功的从浏览器内移出（原件若没被对话引用则一并删去）
async function migrateLibraryToArchive() {
  if (!archiveOnline()) return;
  let moved = 0;
  for (const item of [...store.library]) {
    const file = await getAttachment(item.id);
    if (!file) continue;
    try {
      await putArchiveFile(item.name, file.kind === "text" ? dataUrlFromText(file.data, file.mime) : file.data);
      store.library = store.library.filter(entry => entry.id !== item.id);
      if (!isReferenced(item.id)) void deleteAttachment(item.id);
      moved += 1;
    } catch (error) {
      toast(`${item.name} 落盘失败：${String(error.message || error).slice(0, 60)}`);
      break;
    }
  }
  saveStore();
  await refreshArchive();
  toast(moved ? `已落盘 ${moved} 件` : "没有可落盘的文件");
}
async function removeFromLibrary(id) {
  store.library = store.library.filter(file => file.id !== id);
  saveStore();
  if (!isReferenced(id)) void deleteAttachment(id);
  renderLibrary();
  renderLibraryCount();
}
async function removeArchiveFile(path) {
  if (!(await askConfirm({ title: "删除这件卷宗？", body: `将从本机目录删除「${path}」，无法撤销。`, ok: "删除" }))) return;
  try {
    await bridge("/api/archive/remove", { root: archiveDir(), path }, AbortSignal.timeout(8000));
    toast("已删除");
  } catch (error) {
    toast(`删除失败：${String(error.message || error).slice(0, 80)}`);
  }
  await refreshArchive();
}
function canPlaceAttachment(size) {
  if (currentConversation()?.ended) return toast("此对话已收尾，请翻页后再置入"), false;
  if (pendingAttachments.length >= 10) return toast("一次最多置入 10 件附件"), false;
  if (size > MAX_FILE_BYTES) return toast(`单个附件不超过 ${limitLabel(MAX_FILE_BYTES)}`), false;
  const total = pendingAttachments.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (total + Number(size || 0) > MAX_PENDING_BYTES) return toast(`本次附件合计不超过 ${limitLabel(MAX_PENDING_BYTES)}`), false;
  return true;
}
function placeFromLibrary(id) {
  const item = store.library.find(file => file.id === id);
  if (!item) return;
  if (pendingAttachments.some(file => file.id === id)) return toast("此件已在案上");
  if (!canPlaceAttachment(item.size)) return;
  const { savedAt, ...metadata } = item;
  pendingAttachments.push(metadata);
  persistDraft();
  closeLibrary();
  toast(`${item.name} 已置于案上`);
  setTimeout(() => (currentConversation() ? $("#chatInput") : $("#welcomeInput")).focus(), 0);
}
// 磁盘上的卷宗置于案上：取回原件，按普通附件收进浏览器（图片、可提取的文档照常处理）
async function placeFromArchive(path) {
  let entry = (archiveEntries || []).find(file => file.path === path);
  if (!entry) {
    await refreshArchive();
    entry = (archiveEntries || []).find(file => file.path === path);
  }
  if (!entry) return toast("卷宗里已没有这件");
  if (!canPlaceAttachment(entry.size)) return;
  try {
    const response = await fetch(archiveFileUrl(path), { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error("取回失败");
    const blob = await response.blob(),
      file = new File([blob], entry.name, { type: blob.type || "", lastModified: Date.parse(entry.modifiedAt) || Date.now() });
    pendingAttachments.push(await ingestFile(file));
    persistDraft();
    closeLibrary();
    toast(`${entry.name} 已置于案上`);
    setTimeout(() => (currentConversation() ? $("#chatInput") : $("#welcomeInput")).focus(), 0);
  } catch (error) {
    toast(`置入失败：${String(error.message || error).slice(0, 80)}`);
  }
}
// ---------- 卷宗文件的悬浮预览：图看画、文看字、表看格、网页进沙箱、PDF 交给浏览器；都不必先下载 ----------
const PREVIEW_IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]),
  PREVIEW_DOC = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp"]);
function fileExtension(name) {
  return String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
}
function previewKind(name) {
  const extension = fileExtension(name);
  if (PREVIEW_IMAGE.has(extension)) return "image";
  if (extension === "svg") return "svg";
  if (extension === "pdf") return "pdf";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "csv" || extension === "tsv") return "table";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (PREVIEW_DOC.has(extension)) return "doc";
  if (isTextFile({ name, type: "" })) return "text";
  return "none";
}
// 预览器看两种来源：磁盘卷宗（走桥接取回）与对话里的附件（就在这个浏览器里）。同一种文件，不论从哪儿来，看法一样——
// 自己上传的 CSV、PDF、Markdown 点开就该是看，而不是把刚发出去的东西再下载一遍。
// viewerSource 记着当前看的是哪一件：{ path } 是卷宗，{ attachmentId } 是附件；viewerPath 仍留给卷宗那一路的下载
let viewerPath = "",
  viewerSource = null,
  viewerReturnFocus = null,
  viewerObjectUrls = [];
function viewerBlobUrl(blob) {
  const url = URL.createObjectURL(blob);
  viewerObjectUrls.push(url);
  return url;
}
function revokeViewerUrls() {
  for (const url of viewerObjectUrls) URL.revokeObjectURL(url);
  viewerObjectUrls = [];
}
/** 取一件东西的三种读法：直链（图与 PDF 交给浏览器）、正文、字节。卷宗的直链是桥接地址；附件的是就地造的 blob 地址 */
async function viewerReader(source) {
  if (source.path) {
    const url = archiveFileUrl(source.path),
      fetched = async () => {
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error("取回失败");
        return response;
      };
    return { url: () => url, text: async () => (await fetched()).text(), blob: async () => (await fetched()).blob(), extracted: "" };
  }
  const file = await getAttachment(source.attachmentId);
  if (!file) throw Error("附件原件已不在此浏览器中");
  const blob = file.kind === "text" ? new Blob([file.data], { type: file.mime || "text/plain" }) : await (await fetch(file.data)).blob();
  return {
    url: () => viewerBlobUrl(blob),
    text: async () => (file.kind === "text" ? String(file.data) : blob.text()),
    blob: async () => blob,
    dataUrl: file.kind === "text" ? "" : String(file.data),
    extracted: String(file.extractedText || "")
  };
}
/** @param {string|{path?:string, attachmentId?:string}} target 卷宗路径，或 { attachmentId } */
async function openFileViewer(target, name = "", trigger = null) {
  const source = typeof target === "string" ? { path: target } : target;
  const viewer = $("#fileViewer");
  if (!viewer) return;
  if (source.path && !archiveOnline()) return toast("预览需要本机桥接");
  const title =
      name ||
      String(source.path || "")
        .split("/")
        .pop() ||
      "附件",
    kind = previewKind(title);
  viewerPath = source.path || "";
  viewerSource = source;
  viewerReturnFocus = trigger || document.activeElement;
  revokeViewerUrls();
  viewer.classList.remove("hidden");
  $("#fileViewerName").textContent = title;
  $("#fileViewerStage").innerHTML = `<div class="file-viewer-empty">正在取出…</div>`;
  $("#fileViewerClose").focus();
  try {
    const html = await fileViewerBody(await viewerReader(source), title, kind);
    if (viewerSource !== source) return;
    $("#fileViewerStage").innerHTML = html;
    renderEnhancements($("#fileViewerStage"));
  } catch (error) {
    if (viewerSource !== source) return;
    $("#fileViewerStage").innerHTML =
      `<div class="file-viewer-empty">未能预览：${escapeHtml(String(error.message || error).slice(0, 120))}<br><button type="button" class="outline-btn" data-viewer-download>下载查看</button></div>`;
  }
}
// 预览器头上的「下载」：看的是卷宗就走桥接，是附件就从浏览器里取
function downloadViewerFile() {
  if (viewerSource?.attachmentId) void downloadAttachment(viewerSource.attachmentId);
  else if (viewerPath) downloadArchiveFile(viewerPath);
}
async function fileViewerBody(reader, name, kind) {
  if (kind === "image" || kind === "svg")
    return `<img class="file-viewer-image" src="${escapeHtml(reader.url())}" alt="${escapeHtml(name)}">`;
  // PDF 交给浏览器自带的阅读器；卷宗的响应带 CSP: sandbox，脚本不会以本站身份运行
  if (kind === "pdf") return `<iframe class="file-viewer-frame" src="${escapeHtml(reader.url())}" title="${escapeHtml(name)}"></iframe>`;
  if (kind === "none")
    return `<div class="file-viewer-empty">此类文件无法在此预览，请下载后以本机程序打开<br><button type="button" class="outline-btn" data-viewer-download>下载</button></div>`;
  // 网页放进与页内 ```html 同一个隔离沙箱：不能读本站的存储，也不能联网
  if (kind === "html") {
    const source = await reader.text(),
      id = `app${uid().replace(/[^a-z0-9]/gi, "")}`;
    setTimeout(() => {
      const frame = $("#fileViewerStage iframe");
      if (!frame) return;
      frame.addEventListener("load", () => frame.contentWindow?.postMessage({ type: "yan-preview-render", id, html: source }, "*"), {
        once: true
      });
      frame.src = `./preview.html#${id}`;
    }, 0);
    return `<iframe class="file-viewer-frame" sandbox="allow-scripts" title="隔离的网页预览"></iframe>`;
  }
  if (kind === "table") {
    const text = await reader.text(),
      rows = text.split(/\r?\n/).filter(Boolean).slice(0, 400),
      split = fileExtension(name) === "tsv" ? "\t" : ",";
    if (!rows.length) return `<div class="file-viewer-empty">空文件</div>`;
    const cells = rows.map(row => splitDelimited(row, split));
    return `<div class="file-viewer-text file-viewer-fit"><table class="file-viewer-table"><thead><tr>${cells[0].map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${cells
      .slice(1)
      .map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join(
        ""
      )}</tbody></table>${text.split(/\r?\n/).filter(Boolean).length > 400 ? `<p class="file-viewer-note">仅显示前 400 行</p>` : ""}</div>`;
  }
  if (kind === "doc") {
    // 附件上传时若已在本机抽过正文，直接用；否则从字节里抽
    const text = trimExtractedText(
      reader.extracted || (await extractDocumentText(name, reader.dataUrl || (await readFile(await reader.blob(), "data"))))
    );
    return text
      ? `<div class="file-viewer-text file-viewer-extracted"><p class="file-viewer-note">本机提取的正文，不含排版</p>${text
          .split(/\n{2,}/)
          .map(block => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
          .join("")}</div>`
      : `<div class="file-viewer-empty">未能提取正文，请下载查看<br><button type="button" class="outline-btn" data-viewer-download>下载</button></div>`;
  }
  const text = await reader.text();
  if (kind === "markdown") return `<div class="file-viewer-text markdown">${renderMarkdown(text.slice(0, 200000))}</div>`;
  return `<div class="file-viewer-text"><pre class="file-viewer-code">${escapeHtml(text.slice(0, 200000))}</pre>${text.length > 200000 ? `<p class="file-viewer-note">仅显示前 20 万字</p>` : ""}</div>`;
}
// CSV 的一行：带引号的字段里可以有分隔符与转义的引号
function splitDelimited(row, split) {
  const out = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === split) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}
function closeFileViewer() {
  const target = viewerReturnFocus;
  viewerPath = "";
  viewerSource = null;
  viewerReturnFocus = null;
  revokeViewerUrls();
  $("#fileViewer")?.classList.add("hidden");
  $("#fileViewerStage").innerHTML = "";
  if (target?.isConnected) target.focus();
}
let imageViewerArchivePath = null;
function openArchiveImage(path, trigger = null) {
  const entry = (archiveEntries || []).find(file => file.path === path);
  imageViewerAttachmentId = null;
  imageViewerArchivePath = path;
  imageViewerReturnFocus = trigger || document.activeElement;
  $("#imageViewerName").textContent = `${entry?.name || path} · ${formatFileSize(entry?.size || 0)}`;
  const image = $("#imageViewerImage");
  image.src = archiveFileUrl(path);
  image.alt = entry?.name || "图片预览";
  $("#imageViewerStage").classList.remove("actual");
  $("#imageViewerZoom").textContent = "原图";
  $("#imageViewerZoom").setAttribute("aria-pressed", "false");
  $("#imageViewer").classList.remove("hidden");
  $("#imageViewerClose").focus();
}
function downloadArchiveFile(path) {
  const anchor = document.createElement("a");
  anchor.href = archiveFileUrl(path, true);
  anchor.download = path.split("/").pop() || "卷宗";
  anchor.click();
}

function readFile(file, mode) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    mode === "data" ? reader.readAsDataURL(file) : reader.readAsText(file);
  });
}
function bytesFromDataUrl(value) {
  const encoded = String(value).slice(String(value).indexOf(",") + 1),
    binary = atob(encoded),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function trimExtractedText(value) {
  const text = String(value || "")
    .replace(/\0/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  return text.length > MAX_EXTRACTED_CHARS
    ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[文档内容过长，已在本机截取前 ${MAX_EXTRACTED_CHARS} 个字符]`
    : text;
}
async function extractDocumentText(name, data) {
  const extension = String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (extension === "pdf") return trimExtractedText(await extractPdfText(data));
  if (["docx", "pptx", "xlsx", "odt", "ods", "odp"].includes(extension))
    return trimExtractedText(await extractZipDocumentText(extension, bytesFromDataUrl(data)));
  return "";
}
async function extractPdfText(data) {
  if (!(await ensureLib("pdf"))) return "";
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  const loading = window.pdfjsLib.getDocument({
      data: bytesFromDataUrl(data),
      cMapUrl: "./vendor/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "./vendor/standard_fonts/"
    }),
    document = await loading.promise,
    pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber),
        content = await page.getTextContent();
      let line = "",
        output = [];
      for (const item of content.items || []) {
        if (item.str) line += `${line ? " " : ""}${item.str}`;
        if (item.hasEOL && line) {
          output.push(line);
          line = "";
        }
      }
      if (line) output.push(line);
      pages.push(`第 ${pageNumber} 页\n${output.join("\n")}`);
      if (pages.join("\n\n").length >= MAX_EXTRACTED_CHARS) break;
    }
  } finally {
    await document.destroy();
  }
  return pages.join("\n\n");
}
async function unzipSelected(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder(),
    minimum = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset--)
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  if (eocd < 0) throw Error("文档压缩结构无效");
  const count = view.getUint16(eocd + 10, true),
    centralOffset = view.getUint32(eocd + 16, true),
    entries = new Map();
  let cursor = centralOffset,
    extractedBytes = 0;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true),
      compressedSize = view.getUint32(cursor + 20, true),
      uncompressedSize = view.getUint32(cursor + 24, true),
      nameLength = view.getUint16(cursor + 28, true),
      extraLength = view.getUint16(cursor + 30, true),
      commentLength = view.getUint16(cursor + 32, true),
      localOffset = view.getUint32(cursor + 42, true),
      name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (wanted(name) && uncompressedSize <= 8 * 1024 * 1024 && extractedBytes + uncompressedSize <= 16 * 1024 * 1024) {
      const localNameLength = view.getUint16(localOffset + 26, true),
        localExtraLength = view.getUint16(localOffset + 28, true),
        start = localOffset + 30 + localNameLength + localExtraLength,
        compressed = bytes.slice(start, start + compressedSize);
      let output;
      if (method === 0) output = compressed;
      else if (method === 8) {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        output = new Uint8Array(await new Response(stream).arrayBuffer());
      }
      if (output) {
        entries.set(name, decoder.decode(output));
        extractedBytes += output.length;
      }
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function parseXml(value) {
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.querySelector("parsererror")) throw Error("文档 XML 无效");
  return document;
}
function paragraphsFromXml(value) {
  const document = parseXml(value),
    paragraphs = [...document.getElementsByTagNameNS("*", "p")];
  if (!paragraphs.length) return document.documentElement.textContent || "";
  return paragraphs
    .map(node => [...node.getElementsByTagNameNS("*", "t")].map(text => text.textContent).join("") || node.textContent)
    .filter(Boolean)
    .join("\n");
}
async function extractZipDocumentText(extension, bytes) {
  if (extension === "docx") {
    const entries = await unzipSelected(bytes, name => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name));
    return [...entries.entries()]
      .sort()
      .map(([, xml]) => paragraphsFromXml(xml))
      .join("\n\n");
  }
  if (extension === "pptx") {
    const entries = await unzipSelected(bytes, name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    return [...entries.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([name, xml], index) => `第 ${index + 1} 页\n${paragraphsFromXml(xml)}`)
      .join("\n\n");
  }
  if (extension === "xlsx") {
    const entries = await unzipSelected(bytes, name => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)),
      sharedXml = entries.get("xl/sharedStrings.xml"),
      shared = sharedXml
        ? [...parseXml(sharedXml).getElementsByTagNameNS("*", "si")].map(node =>
            [...node.getElementsByTagNameNS("*", "t")].map(t => t.textContent).join("")
          )
        : [];
    return [...entries.entries()]
      .filter(([name]) => /\/worksheets\//.test(name))
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([name, xml], index) => {
        const document = parseXml(xml),
          rows = [...document.getElementsByTagNameNS("*", "row")].map(row =>
            [...row.getElementsByTagNameNS("*", "c")]
              .map(cell => {
                const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent || cell.textContent || "";
                return cell.getAttribute("t") === "s" ? (shared[Number(value)] ?? value) : value;
              })
              .join("\t")
          );
        return `工作表 ${index + 1}\n${rows.join("\n")}`;
      })
      .join("\n\n");
  }
  const entries = await unzipSelected(bytes, name => name === "content.xml");
  return entries.get("content.xml") ? paragraphsFromXml(entries.get("content.xml")) : "";
}

async function downloadAttachment(id) {
  try {
    const file = await getAttachment(id);
    if (!file) return toast("附件原件已不在此浏览器中");
    const anchor = document.createElement("a");
    let objectUrl = "";
    if (file.kind === "text") {
      objectUrl = URL.createObjectURL(new Blob([file.data], { type: file.mime || "text/plain" }));
      anchor.href = objectUrl;
    } else anchor.href = file.data;
    anchor.download = file.name || "附件";
    anchor.click();
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    toast("附件读取失败");
  }
}
// 只有本轮要回答的那条用户消息携带附件原件；更早的消息改为文本摘要，避免每轮重发图片与长文

  // ---- 14-chat-engine.js ----
// 言 · 对话引擎：历史装配、发送、流式回合、工具定义与系统提示
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function summarize(text, name, label) {
  const value = String(text || "");
  return value.length > HISTORY_TEXT_CHARS
    ? `\n\n--- 附件：${name}（${label}，摘要）---\n${value.slice(0, HISTORY_TEXT_CHARS)}\n[全文共 ${value.length} 字，此前已完整发送]`
    : `\n\n--- 附件：${name}（${label}）---\n${value}`;
}
/** @param {Message} message */
function quotedText(message) {
  const quote = message.quote?.text;
  if (!quote) return message.content;
  return `${quote
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join("\n")}\n\n${message.content || "请就所引用的内容作答。"}`;
}
// 上一答动过文件、请示过、差遣过、检索翻阅过的，压成一行带给下一问：模型才记得自己读过、改过哪些文件、查到过哪几条，不必从头再探
// label 是方括号里的标头：进历史时写「上一答的行迹」（见 historyForApi），存卷宗与压缩转写里写「行迹」
/** @param {Message} message */
function stepsDigest(message, label = "行迹") {
  const steps = (message.steps || []).filter(
    step =>
      WORK_TOOLS.has(step.name) ||
      ["ask_user", "delegate", "search_web", "fetch_page", "user_note", "download_file", "update_plan"].includes(step.name)
  );
  if (!steps.length) return "";
  const items = steps.slice(0, 16).map(step =>
    step.name === "user_note"
      ? `用户补言「${String(step.note || "").slice(0, 200)}」`
      : step.name === "ask_user"
        ? `请示 → ${step.answers ? String(step.note || "").slice(0, 200) : "用户未作答"}`
        : step.name === "delegate"
          ? `差遣「${String(step.title || "").slice(0, 40)}」→ ${step.result || step.status}${subChangedPaths(step).length ? `，改了 ${subChangedPaths(step).slice(0, 8).join("、")}` : ""}`
          : step.name === "search_web"
            ? `检索「${String(step.title || "").slice(0, 60)}」→ ${
                (step.results || [])
                  .slice(0, 3)
                  .map(r => `${String(r.title || "").slice(0, 40)}（${r.url}）`)
                  .join("；") ||
                step.result ||
                step.status
              }`
            : step.name === "fetch_page"
              ? `翻阅 ${String(step.title || step.url || "").slice(0, 60)}${step.url && step.title ? `（${step.url}）` : ""} → ${step.status === "done" ? "已读" : step.result || step.status}`
              : step.name === "update_plan"
                ? `计划 → ${(step.plan || []).map(item => `${{ done: "✓", doing: "▶", skipped: "–" }[item.status] || "○"}${item.text.slice(0, 40)}`).join("；")}`
                : `${step.name} ${String(step.title || "").slice(0, 80)} → ${step.status === "skipped" ? "用户跳过" : step.result || step.status}`
  );
  return `［${label}］${items.join("；")}${steps.length > 16 ? `；…共 ${steps.length} 步` : ""}`;
}
// 最新一问的文本附件能整份随消息送出的上限：按模型窗口的一成半算（没填窗口按 24k token）。超过的只给一行元数据，
// 模型要看就用 read_document 按页、按关键词取——有 read_document 在，没必要把一整本硬塞进提示把窗口撑爆
/** @param {Profile} profile */
function inlineTextBudget(profile = activeProfile()) {
  const window = Number(profile?.contextWindow) || 0;
  return window ? Math.max(4000, Math.floor(window * 0.15)) : 24000;
}
// 一件文本附件（或文档的提取文本）在这一问里占多少 token：最新一问按预算内联、超预算只剩一行；早先的只带 HISTORY_TEXT_CHARS 字的摘要
function attachmentTokens(file, latest, budget) {
  const tokens = Number(file.tokens) || Math.ceil(Number(file.size || 0) / 3);
  if (!latest) return Math.min(tokens, HISTORY_TEXT_CHARS);
  return tokens > budget ? 40 : tokens;
}
function tooLongToInline(text, budget) {
  return estimateText(text) > budget;
}
// 上次压缩以来的往来装成送给接口的历史。每一答的行迹摘要不接在助手自己的话后面——那样模型会把「［行迹］…」学成自己回复的
// 格式，答末照样写一行出来；而是冠在下一问的开头，当作系统附上的记录。末尾的一答后面没有下一问时（旁注锚在一答上）才退回接在它话后
async function historyForApi(source, lastUserId, budget = inlineTextBudget()) {
  const history = [];
  let trail = "";
  for (const m of source) {
    const entry = await messageForApi(m, m.id === lastUserId, budget);
    if (m.role === "assistant") trail = stepsDigest(m, "上一答的行迹");
    else if (trail && m.role === "user") {
      if (typeof entry.content === "string") entry.content = `${trail}\n\n${entry.content}`;
      else entry.content[0].text = `${trail}\n\n${entry.content[0].text}`;
      trail = "";
    }
    history.push(entry);
  }
  const last = history.at(-1);
  if (trail && last) last.content = `${last.content || ""}\n\n${trail}`.trim();
  return history;
}
/** @param {Message} message */
async function messageForApi(message, latest, budget = inlineTextBudget()) {
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  if (message.role !== "user" || !message.attachments?.length)
    return { role: message.role, content: message.role === "user" ? quotedText(message) : message.content };
  /** @type {Array<Record<string, any>>} 多段内容：首段文字，其后图片与文件原件 */
  const content = [{ type: "text", text: quotedText(message) || "请查看附件。" }];
  for (const metadata of message.attachments) {
    const file = metadata.data !== undefined ? metadata : await getAttachment(metadata.id);
    if (!file) {
      content[0].text += `\n\n[附件 ${metadata.name} 的原件在此浏览器中已不可用]`;
      continue;
    }
    if (file.kind === "text") {
      content[0].text += latest
        ? tooLongToInline(file.data, budget)
          ? `\n\n[附件 ${file.name}：文本 ${String(file.data).length} 字，过长未随消息附上；需要时用 read_document 按页或关键词读取]`
          : `\n\n--- 附件：${file.name} ---\n${file.data}`
        : summarize(file.data, file.name, "文本");
      continue;
    }
    if (file.kind !== "image" && file.extractedText) {
      content[0].text += latest
        ? tooLongToInline(file.extractedText, budget)
          ? `\n\n[附件 ${file.name}：本机提取文本 ${String(file.extractedText).length} 字，过长未随消息附上；需要时用 read_document 按页或关键词读取]`
          : `\n\n--- 附件：${file.name}（本机提取）---\n${file.extractedText}`
        : summarize(file.extractedText, file.name, "本机提取");
      continue;
    }
    if (!latest) {
      content[0].text += `\n\n[${file.kind === "image" ? "图片" : "文件"}：${file.name}，${formatFileSize(file.size)}，已在此前发送]`;
      continue;
    }
    if (file.kind === "image") content.push({ type: "image_url", image_url: { url: file.data, detail: "auto" } });
    else content.push({ type: "file", file: { filename: file.name, file_data: String(file.data).replace(/^data:[^,]*,/, "") } });
  }
  return { role: "user", content };
}
async function sendOrStop() {
  // 作答途中：输入框里有话就是补言，递给正在作答的模型；空着才是停止
  if (conversationRunning()) return composerHasContent() ? sendSupplement() : stopGeneration();
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
  const text = input.value.trim();
  if (!text && !pendingAttachments.length && !pendingQuote) return;
  let profile = activeProfile();
  if (!profile) {
    toast("请先接入模型");
    return openSettings("models");
  }
  if (profile.tools !== false && apiBase === null) {
    await ensureLocalBridge();
    profile = activeProfile() || profile;
  }
  if (parseTokenLimit(profile.quota) === null) {
    toast("请先为该模型设置用量上限");
    openSettings("models");
    setTimeout(() => document.querySelector(`[data-profile-card="${profile.id}"] [data-quota-amount]`)?.focus(), 0);
    return;
  }
  if (quotaBlocked(profile)) {
    if (currentConversation()) renderConversation();
    toast(quotaExhausted(profile) ? "余墨已尽，请调高上限或更换模型" : "余墨不足：进行中的对话已占去余量，请稍候或调高上限");
    return;
  }
  const sendingDraftKey = draftKey();
  let c = currentConversation();
  if (c && !(await ensureWorkReady(c))) return;
  if (!c) {
    const pending = (store.settings.pendingWorkdir || "").trim();
    if (pending) {
      // 行：先把工作目录立起来，立不起来就不发
      if (profile.tools === false) {
        toast("当前模型已关闭本机工具，请在模型高级配置中开启");
        return;
      }
      if (apiBase === null && !(await ensureLocalBridge())) {
        toast("执事需要本机桥接，请先运行 start.cmd");
        return;
      }
    }
    c = {
      id: uid(),
      title: titleFrom(text || pendingQuote?.text || "", pendingAttachments),
      forks: [],
      threads: [],
      createdAt: now(),
      updatedAt: now(),
      profileId: profile.id,
      messages: [],
      workdir: pending,
      commandPolicy: normalizeCommandPolicy(store.settings.commandPolicyDefault),
      reasoning: store.settings.reasoning || ""
    };
    if (!(await ensureWorkReady(c))) return;
    closeChipPop();
    store.conversations.unshift(c);
    currentId = c.id;
  }
  const user = takeComposer(input, sendingDraftKey);
  await startTurn(c, user, profile);
}
// 把案上的东西（话、附件、引文）收成一条用户消息，输入框与草稿随之清空
/** @returns {Message} */
function takeComposer(input, key = draftKey()) {
  /** @type {Message} */
  const user = {
    id: uid(),
    role: "user",
    content: input.value.trim(),
    timestamp: now(),
    attachments: pendingAttachments,
    ...(pendingQuote ? { quote: pendingQuote } : {})
  };
  input.value = "";
  input.style.height = "auto";
  delete store.drafts[key];
  pendingAttachments = [];
  pendingQuote = null;
  renderAttachments();
  renderQuote();
  return user;
}
// 起一问：用户消息与待写的一答一起入册，随即向模型要回复
/**
 * @param {Conversation} c
 * @param {Message} user
 * @param {Profile} profile
 */
async function startTurn(c, user, profile) {
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  c.messages.push(user, assistant);
  c.updatedAt = now();
  c.profileId = profile.id;
  saveStore();
  if (currentId === c.id) render(true);
  else renderHistory();
  // 头一问一发出就拟题，与作答并行：侧栏里立刻是个像样的名字，不用等一答写完；没拟成的，那一答收尾时再试
  if (c.messages.filter(m => m.role === "user").length === 1) void maybeAutoTitle(c, profile);
  await streamReply(c, assistant, profile);
}
// 补言：模型作答途中用户再寄来的话，是引导不是排队。先落在行迹里它到达的那一刻（一步「补言 · 待寄」）；模型正在写着，
// 就等它说到一个自然的落点（见 watchSteer：思考写完、句尾或段落尾、代码围栏闭合）把这一轮的流停下、已写的留着，随即连同补言
// 再请它开口——它读了这句接着写，可就此改道；正在拟工具调用或跑着工具时不停，等结果交回、模型再开口之前递上；
// 这一答若已在收尾、不再有下一回合，就在落笔后作为新的一问送出。引导是为了答得更好，从不硬掐
const SUPPLEMENT_PREFIX = "［用户在你作答途中补充的话］",
  STEER_PREFIX = "［用户在你作答途中插了一句，你写到此处暂停。读后接着作答，可据此改变方向；不必重复已写的内容］";
function sendSupplement() {
  const c = currentConversation(),
    job = c && requestJob(c.id),
    assistant = c?.messages.find(message => message.id === job?.assistantId);
  if (!c || !job || !assistant || assistant.status !== "streaming") return stopGeneration();
  const user = takeComposer($("#chatInput"));
  const text = user.quote ? quotedText(user) : user.content;
  /** @type {Step} */
  const step = {
    id: `note_${uid().slice(0, 8)}`,
    name: "user_note",
    arguments: "{}",
    status: "running",
    title: text.split("\n").find(Boolean)?.slice(0, 80) || "",
    note: text,
    attachments: user.attachments?.length ? user.attachments : undefined,
    at: assistant.content.length,
    rat: String(assistant.reasoning || "").length
  };
  (job.queue ||= []).push({ user, step });
  (assistant.steps ||= []).push(step);
  saveStoreSoon();
  refreshSteps(assistant);
  renderSendButtons();
  if (followBottom) scrollBottom();
  // 模型正写着：盯着它说到落点再停这一轮，streamReply 的循环接手——已写的留下，补言递上，随即再请它开口
  if (job.reading) watchSteer(job, assistant);
}
// 补言到了不是立刻停——像人插话也等对方一句说完，且不设时限：正在思考就等思考写完（正文起笔），想多久都等；
// 正在拟工具调用就不停，等结果交回时递；正在写正文就等到句尾或段落尾、且不在代码围栏里（围栏等它闭合）。
// 每 120ms 看一眼；流自己先到头了就不停（回合边界或收尾处理）
/** @param {Message} assistant */
function watchSteer(job, assistant) {
  if (job.steerTimer) return;
  job.steerTimer = setInterval(() => {
    const stop = () => {
      clearInterval(job.steerTimer);
      job.steerTimer = 0;
    };
    if (!job.reading || !job.round) return stop();
    if (assistant.toolCalls?.length) return; // 正在拟调用：等它拟完，结果交回时递
    const said = assistant.content.slice(job.roundStart || 0);
    if (!said.trim()) return; // 还在想（或还没开口）：等
    const fenced = (said.match(/^\s*```/gm) || []).length % 2 === 1;
    if (fenced || !/[\n。！？!?]\s*$/.test(said)) return;
    stop();
    job.round.abort();
  }, 120);
}
// 停的位置若略过了句尾，把多出的那几个字退回去，落点干净
function trimToBoundary(text) {
  const match = text.match(/^([\s\S]*[\n。！？!?])[^\n。！？!?]*$/);
  return match && text.length - match[1].length < 120 ? match[1] : text;
}
// 回合边界：把排着的补言递给模型（历史里接在工具结果之后，或接在被掐断的半截话之后），行迹里那一步打勾
async function deliverSupplements(job, history, budget, assistant, { steer = false } = {}) {
  const queue = job.queue || [];
  job.queue = [];
  for (const { user, step } of queue) {
    const entry = await messageForApi(user, true, budget),
      prefix = steer ? STEER_PREFIX : SUPPLEMENT_PREFIX;
    if (typeof entry.content === "string") entry.content = `${prefix}${entry.content}`;
    else entry.content[0].text = `${prefix}${entry.content[0].text}`;
    history.push(entry);
    step.status = "done";
    step.result = steer ? "已递 · 引路" : "已递";
  }
  // 递出去就立刻打勾。不补这一下，纯文字作答里没有下一个工具轮来顺带重画，
  // 那枚「待寄」会一直转到整答写完——模型早读到了，页面上还像没送出去
  if (queue.length) {
    saveStoreSoon();
    refreshSteps(assistant);
  }
}
// 收尾时还没递出去的补言：从行迹里撤下，整答顺利写完的作为新的一问接着送；停了、断了的放回案上，话不能丢
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 * @param {Profile} profile
 */
function settleSupplements(conversation, assistant, job, profile) {
  const queue = job.queue || [];
  job.queue = [];
  if (!queue.length) return;
  const ids = new Set(queue.map(item => item.step.id));
  assistant.steps = (assistant.steps || []).filter(step => !ids.has(step.id));
  if (!assistant.steps.length) delete assistant.steps;
  const users = queue.map(item => item.user),
    quote = users.find(u => u.quote)?.quote || null;
  if (assistant.status === "complete") {
    /** @type {Message} */
    const user = {
      id: uid(),
      role: "user",
      content: users
        .map(u => u.content)
        .filter(Boolean)
        .join("\n\n"),
      timestamp: now(),
      attachments: users.flatMap(u => u.attachments || []),
      ...(quote ? { quote } : {})
    };
    setTimeout(() => void startTurn(conversation, user, profile), 0);
    return;
  }
  const key = draftKey(conversation.id),
    draft = draftRecord(conversation.id);
  store.drafts ||= {};
  store.drafts[key] = {
    text: [draft.text, ...users.map(u => u.content)].filter(Boolean).join("\n\n"),
    attachments: [...draft.attachments, ...users.flatMap(u => u.attachments || [])],
    quote: draft.quote || quote,
    updatedAt: now()
  };
  if (currentId === conversation.id && view === "chat") restoreDraft();
  toast("这一答未写完，补言已放回案上");
}
function titleFrom(text, attachments) {
  const value = (text || `关于 ${attachments[0]?.name || "附件"}`).replace(/\s+/g, " ").trim();
  return value.slice(0, 28) + (value.length > 28 ? "…" : "");
}
function stopGeneration(id = currentId) {
  const job = requestJob(id);
  if (!job) return;
  requestJobs.delete(id);
  job.controller.abort();
  const conversation = store.conversations.find(item => item.id === id),
    assistant =
      conversation?.messages.find(message => message.id === job.assistantId) ||
      [...(conversation?.messages || [])].reverse().find(message => message.status === "streaming");
  if (assistant?.status === "streaming") {
    assistant.status = "stopped";
    settleSteps(assistant, "已停止");
  }
  saveStore();
  renderHistory();
  renderSendButtons();
  if (currentId === id) setConnection("idle", "已停止");
}
function stopAllGenerations() {
  for (const [id, job] of requestJobs) {
    job.controller.abort();
    const conversation = store.conversations.find(item => item.id === (job.conversationId || id));
    const assistant = job.threadId
      ? conversation?.threads?.find(t => t.id === job.threadId)?.messages.find(m => m.id === job.assistantId)
      : conversation?.messages.find(message => message.id === job.assistantId);
    if (assistant?.status === "streaming") {
      assistant.status = "stopped";
      settleSteps(assistant, "已停止");
    }
  }
  requestJobs.clear();
}

/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 * @param {Profile} profile
 */
async function streamReply(conversation, assistant, profile, { resume = false } = {}) {
  // 这一答是不是执事的，记在消息自己身上：生成期间用户可能翻去欢迎页或卷宗，页面上一时没有「当前对话」，时间线不能因此改画法
  assistant.work = isWork(conversation);
  /** @type {{ controller: AbortController, assistantId: string, label: string, profile: Profile, queue: Array<{ user: Message, step: Step }>, round: AbortController|null, reading: boolean, roundStart: number, steerTimer: number, commandAuto: boolean }} */
  const job = {
    controller: new AbortController(),
    assistantId: assistant.id,
    label: "生成中",
    profile,
    queue: [],
    round: null,
    reading: false,
    roundStart: 0,
    steerTimer: 0,
    // 言里的 shell 不是进程隔离：用户可在第一次请示时只放行本答，下一答重新询问
    commandAuto: false
  };
  requestJobs.set(conversation.id, job);
  renderSendButtons();
  renderHistory();
  setJobLabel(conversation, job, "生成中");
  const started = performance.now();
  let leadTrim = 0;
  const gaugeTicker = conversation.id === currentId ? setInterval(updateContextGauge, 600) : null;
  // 言里做文件：记下开工前卷宗的样子，收尾时新出的、改过的成品挂在答末
  const archiveBefore = !isWork(conversation) && archiveOnline() ? new Map((archiveEntries || []).map(e => [e.path, e.modifiedAt])) : null;
  // 用量在 finally 里结算：停止、断网、工具链中途出错，前面几轮已经花掉的墨也得记上，不能只在整答顺利收尾时记账
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    stepsBefore = (assistant.steps || []).length;
  /** @type {Array<Record<string, any>>} 送给接口的消息列表 */
  let history = [];
  let usageKnown = false,
    roundOpen = false,
    opened = false,
    steered = false,
    roundStart = 0,
    releaseQuota = () => {};
  try {
    const contextIndex = conversation.messages.map(m => m.role).lastIndexOf("context");
    const source = conversation.messages
      .slice(contextIndex + 1)
      .filter(m => m.id !== assistant.id && m.status !== "error" && ["user", "assistant"].includes(m.role));
    const lastUserId = source.filter(m => m.role === "user").at(-1)?.id,
      budget = inlineTextBudget(profile);
    history = summaryMessages(contextIndex >= 0 ? conversation.messages[contextIndex] : null);
    history.push(...(await historyForApi(source, lastUserId, budget)));
    // 先把这一答预计的用量记到预留里（提示 + 最大输出），别的对话同时开工时看得见；收尾时换成实际用量
    releaseQuota = reserveTokens(profile, estimateTokens(history) + Number(profile.maxTokens || DEFAULT_MAX_TOKENS));
    if (resume && assistant.content) {
      history.push({ role: "assistant", content: assistant.content });
      history.push({ role: "user", content: "上一条回复在此处因连接中断。请仅从中断处继续，不要重复已生成的内容。" });
    }
    const tools = profile.tools !== false ? toolDefinitions(conversation) : null;
    const overrides = {
      systemPrompt: assistantHint(profile, tools, conversation),
      tools,
      enableSearch: modelSearchEnabled(profile),
      reasoning: conversation.reasoning || ""
    };
    const toolCache = new Map();
    let rounds = 0;
    for (;;) {
      assistant.toolCalls = null;
      assistant.usage = null;
      roundStart = job.roundStart = assistant.content.length;
      roundOpen = false;
      // 每一轮自己一个中止器：补言只停这一轮的流，整答的 controller 留给「停止」
      const round = new AbortController(),
        stopRound = () => round.abort();
      job.round = round;
      job.controller.signal.addEventListener("abort", stopRound, { once: true });
      job.reading = true;
      try {
        await readReply(profile, history, round.signal, overrides, assistant, false, () => (roundOpen = opened = true));
      } catch (error) {
        if (error.name !== "AbortError" || job.controller.signal.aborted || !job.queue?.length) throw error;
        // 补言停下的：这一轮写到落点为止（花的墨按估算记上），已写的话与补言一起进历史，没执行的工具调用一律作废，随即再开一轮
        const said = trimToBoundary(assistant.content.slice(roundStart)).replace(/\n+$/, "");
        assistant.content = assistant.content.slice(0, roundStart) + said;
        for (const { step } of job.queue) if (typeof step.at === "number") step.at = Math.min(step.at, assistant.content.length);
        if (roundOpen) {
          const spent = estimateTokens(history) + estimateTokens([{ content: said }]);
          usage.prompt_tokens += spent;
          usage.total_tokens += spent;
          usageKnown = steered = true;
          roundOpen = false;
        }
        assistant.toolCalls = null;
        if (said.trim()) history.push({ role: "assistant", content: said });
        await deliverSupplements(job, history, budget, assistant, { steer: true });
        if (assistant.content) assistant.content += "\n\n";
        continue;
      } finally {
        job.reading = false;
        job.round = null;
        clearInterval(job.steerTimer);
        job.steerTimer = 0;
        job.controller.signal.removeEventListener("abort", stopRound);
      }
      if (assistant.usage) {
        usageKnown = true;
        roundOpen = false;
        for (const key of Object.keys(usage)) usage[key] += Number(assistant.usage[key] || 0);
      }
      const calls = (assistant.toolCalls || []).filter(call => call.name);
      if (!calls.length || !overrides.tools) break;
      // 轮次到顶：不再受理这一批调用，收回工具，让模型就已有结果收尾
      if (++rounds > toolRoundLimit()) {
        const said = assistant.content.slice(roundStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push({ role: "user", content: "工具调用轮次已达上限，请不要再调用工具，直接根据已有结果作答，并说明尚未完成的部分。" });
        overrides.tools = null;
        if (assistant.content) assistant.content += "\n\n";
        continue;
      }
      // 模型请求调用工具：记录步骤、执行、把结果作为 tool 消息回传，再让模型继续；历史里只带本轮新写的正文，前几轮的已经在各自的 assistant 消息里
      /** @type {Step[]} */
      const steps = calls.map(call => ({
        id: call.id || `call_${uid().slice(0, 8)}`,
        name: call.name,
        arguments: call.arguments || "{}",
        status: "running",
        at: assistant.content.length,
        rat: String(assistant.reasoning || "").length
      }));
      (assistant.steps ||= []).push(...steps);
      refreshSteps(assistant);
      setJobLabel(conversation, job, isWork(conversation) ? "执行中" : "查阅中");
      history.push({
        role: "assistant",
        content: assistant.content.slice(roundStart) || null,
        tool_calls: steps.map(step => ({ id: step.id, type: "function", function: { name: step.name, arguments: step.arguments } })),
        ...(assistant.thinkingBlocks?.length ? { thinking_blocks: assistant.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, job.controller.signal, toolCache);
      for (const step of steps) history.push({ role: "tool", tool_call_id: step.id, content: outcomes.get(step.id) ?? "" });
      await deliverSupplements(job, history, budget, assistant);
      if (assistant.content) assistant.content += "\n\n";
      setJobLabel(conversation, job, "生成中");
    }
    leadTrim = assistant.content.match(/^\n*/)[0].length;
    assistant.content = assistant.content.replace(/^\n+|\n+$/g, "");
    if (leadTrim) for (const step of assistant.steps || []) if (typeof step.at === "number") step.at = Math.max(0, step.at - leadTrim);
    if (!assistant.content)
      throw Error(
        assistant.steps?.length ? "模型执行工具后未返回正文，可点「继续生成」请它收尾" : "模型未返回正文，请适当提高最大输出长度后重试"
      );
    assistant.status = "complete";
    conversation.updatedAt = now();
    setTimeout(() => maybeAutoCompact(conversation), 0);
    // 言里动过文件的，卷宗目录多半有了新东西：重新翻一遍，新出的、改过的成品挂在答末，侧栏的件数跟着更新
    if (archiveBefore && allSteps(assistant).some(step => WORK_TOOLS.has(step.name))) {
      await refreshArchive();
      assistant.deliverables = (archiveEntries || [])
        .filter(entry => archiveBefore.get(entry.path) !== entry.modifiedAt)
        .map(entry => ({ path: entry.path, name: entry.name, size: entry.size }));
      if (!assistant.deliverables.length) delete assistant.deliverables;
    }
  } catch (error) {
    settleSteps(assistant, error.name === "AbortError" ? "已停止" : "已中断");
    if (error.name === "AbortError") assistant.status = "stopped";
    else if (assistant.content || assistant.reasoning || assistant.steps?.length) {
      assistant.status = "interrupted";
      assistant.error = friendlyError(error.message);
      assistant.interruptedAt = now();
    } else {
      assistant.status = "error";
      assistant.error = friendlyError(error.message);
    }
  } finally {
    if (gaugeTicker) clearInterval(gaugeTicker);
    assistant.durationMs = Math.round(performance.now() - started);
    // 帮手（差遣）自己跑的几轮也是这一答花的墨：这一次新起的步骤里的帮手用量一并计入（续写时此前的已经记过）
    for (const step of (assistant.steps || []).slice(stepsBefore))
      if (step.sub?.usage) {
        usageKnown = true;
        for (const key of Object.keys(usage)) usage[key] += Number(step.sub.usage[key] || 0);
      }
    assistant.usage = usageKnown ? usage : null;
    releaseQuota();
    accountUsage(profile, assistant, history, conversation, { opened, partialRound: roundOpen, roundStart, steered });
    if (requestJobs.get(conversation.id) === job) requestJobs.delete(conversation.id);
    settleSupplements(conversation, assistant, job, profile);
    if (currentId !== conversation.id || view !== "chat") conversation.unread = true;
    saveStore();
    renderHistory();
    if (currentId === conversation.id && view === "chat") {
      finalizeAssistant(conversation, assistant, leadTrim);
      renderChatMeta(conversation);
      renderOutline();
      updateContextGauge();
    }
    renderSendButtons();
    refreshConnection();
    if (assistant.status === "complete") void maybeAutoTitle(conversation, profile);
  }
}
// 向模型要一轮回复，写进 target（正文、思绪、工具调用、用量）：流式按 SSE 逐字进，否则整段一次到
// onOpen：接口接下请求、开始回话时叫一声——从这一刻起这一轮就在花墨了，中途停止也得记账；onFrame 逐帧交给 readSse（旁注面板用来跟随滚动）
/**
 * @param {Profile} profile
 * @param {Message|SubAgent} target 主消息或帮手（拟题 / 压缩的临时对象也按 Message 的样子造）
 */
async function readReply(profile, history, signal, overrides, target, retried = false, onOpen = null, onFrame = null) {
  target.thinkingBlocks = null;
  const response = await requestChat(profile, history, signal, overrides);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // 桥接回的 error 是一句话；直连 Anthropic 回的是 { error: { message } }
    const message = (typeof data.error === "string" ? data.error : data.error?.message) || `请求失败（${response.status}）`;
    // 接口不认这个思考档位：记下它认的几档，换成最接近的一档重发一次；再不行才算失败
    const sent = reasoningFields(profile, overrides.reasoning).reasoning_effort;
    if (!retried && sent && learnReasoningLevels(profile, message, sent)) {
      const level = nearestReasoning(profile, overrides.reasoning);
      toast(`此模型的思考档位为 ${profileReasoningLevels(profile).map(reasoningLabel).join(" / ")}，已改用「${reasoningLabel(level)}」`);
      renderModelTriggers();
      return readReply(profile, history, signal, overrides, target, true, onOpen, onFrame);
    }
    throw Error(message);
  }
  onOpen?.();
  const type = response.headers.get("content-type") || "";
  // 帮手与消息的流式字段一致（content / reasoning / toolCalls / usage），readSse 按消息处理
  const sink = /** @type {Message} */ (target);
  if (type.includes("text/event-stream")) return readSse(response, sink, { onFrame });
  const data = await response.json(),
    message = data?.choices?.[0]?.message;
  target.content += extractContent(data);
  // 与流式一致：有的接口把思考放在 reasoning 而不是 reasoning_content
  target.reasoning = normalizeContent(message?.reasoning_content ?? message?.reasoning) || target.reasoning;
  splitInlineThink(sink);
  target.usage = data.usage || null;
  if (Array.isArray(message?.tool_calls))
    target.toolCalls = message.tool_calls.map(call => ({
      id: call.id,
      name: call.function?.name || "",
      arguments: call.function?.arguments || ""
    }));
}
// 把一批工具调用跑完，返回各步回给模型的结果。相邻的只读调用一起跑（读、搜、翻网页、翻记忆彼此无关）；会改状态或要请示的按原顺序逐个来。
// 主模型与帮手共用这一段：assistant 是页面上那条消息（帮手的步骤也画在它的行迹里）
/**
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runSteps(steps, conversation, assistant, signal, toolCache) {
  const outcomes = new Map();
  const runOne = async step => {
    const stepStarted = performance.now();
    const cacheable = !WORK_TOOLS.has(step.name) && !MEMORY_TOOLS.has(step.name) && step.name !== "delegate",
      cacheKey = toolCacheKey(step),
      cached = cacheable ? toolCache.get(cacheKey) : null;
    let outcome;
    if (cached) {
      Object.assign(step, structuredClone(cached.presentation));
      step.cached = true;
      outcome = structuredClone(cached.outcome);
      outcome.display = `复用 · ${outcome.display}`;
    } else {
      outcome = await runTool(step, conversation, assistant, signal);
      // 只缓存成功的：临时的 502、超时若也缓存，模型想重试只会一直拿到同一个旧失败
      if (cacheable && outcome.ok) toolCache.set(cacheKey, { outcome: structuredClone(outcome), presentation: toolPresentation(step) });
    }
    const remaining = MIN_TOOL_STATUS_MS - (performance.now() - stepStarted);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    step.status = step.skipped ? "skipped" : outcome.ok ? "done" : "error";
    step.result = outcome.display;
    outcomes.set(step.id, String(outcome.content).slice(0, 60000));
    refreshSteps(assistant);
    saveStore();
  };
  for (let i = 0; i < steps.length; ) {
    if (!PARALLEL_TOOLS.has(steps[i].name)) {
      await runOne(steps[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < steps.length && PARALLEL_TOOLS.has(steps[j].name)) j += 1;
    await Promise.all(steps.slice(i, j).map(runOne));
    i = j;
  }
  return outcomes;
}
// opened：接口至少接下过一次请求（没接下的——400、连不上——不花墨）；partialRound：最后一轮开了头却没等到它的 usage（停止、断网），
// 那一轮按估算补上——提示全文加上这一轮写出的字；一次 usage 都没拿到的（直连不回 usage）整答按估算
/**
 * @param {Profile} profile
 * @param {Message} assistant
 * @param {Conversation} conversation
 */
function accountUsage(
  profile,
  assistant,
  requestMessages,
  conversation,
  { opened = true, partialRound = false, roundStart = 0, steered = false } = {}
) {
  const exact = Number(assistant.usage?.total_tokens || 0);
  const estimate = from => estimateTokens(requestMessages) + estimateTokens([{ content: String(assistant.content || "").slice(from) }]);
  const consumed = exact > 0 ? exact + (partialRound ? estimate(roundStart) : 0) : opened ? estimate(0) : 0;
  if (!(consumed > 0)) return;
  profile.usedTokens = Math.max(0, Number(profile.usedTokens || 0)) + consumed;
  assistant.tokenCount = consumed;
  assistant.tokenEstimated = !(exact > 0) || partialRound || steered;
  persistServerProfile(profile);
  if (quotaExhausted(profile)) toast("此答写毕，余墨已尽；换个模型可续");
  renderQuota();
}
// 首次问答完成后请模型拟一个短标题；用户手动改过题（titleAuto === false）就不再动。
// titled 只在标题真正写入后才置真：临时的网络错误不该让这段对话从此再也拟不上题，之后几答收尾时会再试（最多三次）
const titlingIds = new Set(),
  titleRetries = new Set();
/** @param {Conversation} conversation 用户亲手改过题（拟题期间也可能改，收尾前得再看一眼） */
const renamedByHand = conversation => conversation.titleAuto === false;
/**
 * @param {Conversation} conversation
 * @param {Profile} profile
 */
async function maybeAutoTitle(conversation, profile) {
  if (!store.settings.autoTitle || conversation.titleAuto === false || conversation.titled) return;
  // 首问发出时拟题与正文并行；若正文先写完，收尾处会再来一次。此时不能另发一份重复请求，
  // 但要把「原请求若失败，随后再试」记下来，否则原请求稍后超时便再也没人触发重试。
  if (titlingIds.has(conversation.id)) {
    if (conversation.messages.some(message => message.role === "assistant" && message.status === "complete"))
      titleRetries.add(conversation.id);
    return;
  }
  if (quotaExhausted(profile) || (conversation.titleTries || 0) >= 3) return;
  const first = conversation.messages.find(m => m.role === "user"),
    reply = conversation.messages.find(m => m.role === "assistant" && m.status === "complete");
  if (!first) return;
  titlingIds.add(conversation.id);
  conversation.titleTries = (conversation.titleTries || 0) + 1;
  try {
    const ask = prompt("assistant.title", {
      user: String(first.content || (first.attachments || []).map(a => a.name).join("、") || "（附件）").slice(0, 1200),
      assistant: reply ? `\n\n助手：${String(reply.content).slice(0, 1200)}` : ""
    });
    // 题目只有几个字，可它是与一答并行发出的：接口忙、模型慢起（会思考的先想再写）时三十秒常常不够，三次都超时就再也拟不上题。
    // 超时给到两分钟；输出上限不能只按题目本身算——会思考的模型把思考也计在 max_tokens 里；开了思考档位的降到最低一档，拟题用不着深想
    const response = await requestChat(profile, [{ role: "user", content: ask }], AbortSignal.timeout(120000), {
      maxTokens: 4000,
      temperature: 0.3,
      systemPrompt: "",
      reasoning: conversation.reasoning ? "low" : ""
    });
    if (!response.ok) return;
    /** @type {Message} */
    const temp = { id: `title-${uid()}`, role: "assistant", content: "", timestamp: now() };
    if ((response.headers.get("content-type") || "").includes("text/event-stream")) await readSse(response, temp);
    else {
      const data = await response.json();
      temp.content = extractContent(data);
      temp.usage = data.usage;
    }
    const spent = Number(temp.usage?.total_tokens || 0) || estimateTokens([{ content: ask }, { content: temp.content }]);
    profile.usedTokens = Math.max(0, Number(profile.usedTokens || 0)) + spent;
    persistServerProfile(profile);
    renderQuota();
    const title =
      temp.content
        .split("\n")
        .map(line => line.trim())
        .find(Boolean)
        ?.replace(/^[\s"'“”‘’《》「」【】#*]+|[\s"'“”‘’《》「」【】。！？!?.、,，]+$/g, "")
        .slice(0, 24) || "";
    if (!title || renamedByHand(conversation)) return;
    conversation.title = title;
    conversation.titleAuto = true;
    conversation.titled = true;
    delete conversation.titleTries;
    saveStore();
    renderHistory();
    if (currentId === conversation.id) {
      $("#chatTitle").textContent = title;
      syncDocumentTitle();
    }
  } catch {
  } finally {
    titlingIds.delete(conversation.id);
    const retry = titleRetries.delete(conversation.id);
    if (retry && !conversation.titled && !renamedByHand(conversation) && store.settings.autoTitle)
      setTimeout(() => void maybeAutoTitle(conversation, profile), 0);
  }
}
// 可读的文档：对话附件、浏览器内的旧卷宗，以及（设置允许时）磁盘卷宗里的文本与 Office / PDF——后者用到时才取回并抽正文
const ARCHIVE_DOC_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp"]);
/** @param {Conversation} conversation */
function availableDocuments(conversation) {
  const seen = new Map();
  for (const file of [...(conversation?.messages || []).flatMap(m => m.attachments || []), ...store.library])
    if (file.id && !seen.has(file.name) && (file.kind === "text" || (file.kind === "file" && file.extracted))) seen.set(file.name, file);
  if (store.settings.archiveRead !== false && archiveOnline())
    for (const entry of archiveEntries || []) {
      const extension = String(entry.name).split(".").pop().toLowerCase();
      if (seen.has(entry.name) || !(ARCHIVE_DOC_EXTENSIONS.has(extension) || isTextFile({ name: entry.name, type: "" }))) continue;
      seen.set(entry.name, { name: entry.name, archive: entry.path, size: entry.size, modifiedAt: entry.modifiedAt, kind: "archive" });
    }
  return [...seen.values()];
}
// 通义千问（DashScope）接口默认打开模型自带联网；其他接口不发送该参数，除非用户手动开启
/** @param {Profile} profile */
function modelSearchEnabled(profile) {
  if (typeof profile.enableSearch === "boolean") return profile.enableSearch;
  return /dashscope\.aliyuncs\.com/i.test(String(profile.baseUrl || ""));
}
// sub：给帮手的一套——同样的工具，但不再差遣、也不请示用户
/** @param {Conversation} conversation */
function toolDefinitions(conversation, { sub = false, lookup = false } = {}) {
  // 描述与参数说明在 prompts/tools.js；这里只决定哪些工具在此对话里可用
  // 言（对谈）的文件工具只为产出；电脑检查是一件多路复用工具。带 brief 的用短说明，且不带 edit_file / search_files
  // lookup：旁注用的只查不改的一套——检索、翻网页、翻文档、翻记忆与旧谈；不动文件、不请示、不差遣、不记不忘
  const work = isWork(conversation) && !lookup;
  const define = (name, vars = {}) => {
    const spec = PROMPTS.tools?.[name];
    if (!spec) {
      console.error(`缺少工具定义：${name}`);
      return null;
    }
    const text = !work && spec.brief ? prompt(`tools.${name}.brief`, vars) : prompt(`tools.${name}.description`, vars);
    return { type: "function", function: { name, description: text, parameters: spec.parameters } };
  };
  const tools = [];
  if (apiBase !== null) tools.push(define("search_web"), define("fetch_page"));
  // 调接口能发 POST，不算纯查阅，旁注不给；算一段 JS 在浏览器里的隔离沙箱跑，不经桥接，谁都有
  if (apiBase !== null && !lookup) tools.push(define("http_request"));
  tools.push(define("run_js"));
  // 固定只读探针不依赖工作目录；与通用 shell 是两条路，某条受限时仍能完成本机诊断
  if (apiBase !== null && !lookup) tools.push(define("inspect_computer"));
  // 文件工具：绑了目录是执事的六件，落在工作目录；没绑是言的四件，落在卷宗；都要桥接在线。下载也落在同一处
  if (workRoot(conversation) && !lookup)
    tools.push(...(work ? [...WORK_TOOLS] : CHAT_FILE_TOOLS).map(name => define(name)), define("download_file"));
  // 计划：行里给用户看的清单，只有主模型维护
  if (work && !sub) tools.push(define("update_plan"));
  if (!sub && !lookup) tools.push(define("ask_user"));
  // 帮手与旁注对记忆只读：翻记忆、查旧谈可以，记与忘留给主模型
  if (memoryEnabled())
    tools.push(...[...MEMORY_TOOLS].filter(name => (!sub && !lookup) || !MEMORY_WRITE_TOOLS.has(name)).map(name => define(name)));
  const docs = availableDocuments(conversation);
  if (docs.length) tools.push(define("read_document", { docs: docs.map(d => d.name).join("、") }));
  // 有桥接、且有别的活能交出去时才可差遣；帮手自己不再差遣
  if (!sub && !lookup && apiBase !== null && tools.some(tool => tool && tool.function.name !== "ask_user")) tools.push(define("delegate"));
  const usable = tools.filter(Boolean);
  return usable.length ? usable : null;
}
// 附加给模型的提示：日期、目录与做法（执事的，或言里卷宗的）、联网分寸、记忆分寸、页内可视化的写法。工具各自做什么、何时用，在工具说明里说，这里不重复
/** @param {Conversation} conversation */
function workHint(conversation) {
  const win = (bootstrap.work?.platform || "win32") === "win32",
    shell = bootstrap.work?.shell || (win ? "PowerShell" : "sh");
  return prompt(isWork(conversation) ? "work.hint" : "work.archive", {
    workdir: workRoot(conversation),
    scratch: scratchRel(conversation),
    reach: prompt(sandboxed() ? "work.reachSandbox" : roamAllowed() ? "work.reachAnywhere" : "work.reachInside"),
    platform: win ? "Windows" : bootstrap.work?.platform || "类 Unix",
    shell,
    shellNote: win ? prompt("work.windowsShell") : ""
  });
}
/**
 * @param {Profile} profile
 * @param {Conversation} conversation
 */
function assistantHint(profile, tools, conversation = null) {
  const lines = [
    prompt("assistant.today", { day: formatDay(now()), iso: new Date().toISOString().slice(0, 10) }),
    prompt("assistant.judgement")
  ];
  const names = new Set((tools || []).map(tool => tool?.function?.name));
  if (names.has("run_command") && conversation) lines.push(workHint(conversation));
  if (names.has("search_web")) lines.push(prompt("assistant.search"));
  if (names.has("ask_user")) lines.push(prompt("assistant.asking"));
  if (names.has("delegate")) lines.push(prompt("assistant.delegating"));
  if (names.has("remember")) lines.push(prompt("memory.hint", { count: store.memory.items.length }));
  lines.push(prompt("assistant.drawing"));
  if (!conversation || !isWork(conversation)) lines.push(prompt("assistant.manner"));
  const base = String(profile.systemPrompt || "").trim();
  return base ? `${base}\n\n${lines.join("\n")}` : lines.join("\n");
}

  // ---- 15-tools.js ----
// 言 · 工具执行：桥接调用、执事工具、请示与表单、改动统计
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
async function bridge(path, payload, signal) {
  if (apiBase === null) throw Error("本机工具需要本机桥接");
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || `请求失败（${response.status}）`);
  return data;
}
function stableToolJson(value) {
  if (Array.isArray(value)) return value.map(stableToolJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableToolJson(value[key])])
    );
  return typeof value === "string" ? value.trim() : value;
}
// 工具参数按 JSON 给，但模型写出来的常有小毛病：裹了 ```json 围栏、结尾多一个逗号、整段被 max_tokens 截断、
// 或是把 JSON 又编码成了字符串。这些都能救回来，救不回来才算失败——每失败一次就是白花一轮的墨。
// 去围栏、去多余逗号不丢内容；补齐截断的 JSON 会丢掉末尾残缺的键值对，结果带 truncated 标记：
// 只读工具照用（顶多少一个可选参数），有副作用的工具一律拒绝——写文件时 content 被截掉，救回来的 {"path"} 若照写就把文件清空了
function parseToolArguments(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, args: {} };
  const attempt = value => {
    try {
      const parsed = JSON.parse(value);
      // 有的接口把参数对象又 JSON.stringify 了一遍，解出来是字符串
      if (typeof parsed === "string") return attempt(parsed.trim());
      return parsed && typeof parsed === "object" ? { ok: true, args: Array.isArray(parsed) ? { questions: parsed } : parsed } : null;
    } catch (error) {
      return { error };
    }
  };
  let first = attempt(text);
  if (first?.ok) return first;
  // 去掉 ```json 围栏与前后的闲话，只取第一个 { 到最后一个 }
  const fenced = text.replace(/^[^{[]*```(?:json)?\s*/i, "").replace(/\s*```[^}\]]*$/i, "");
  const start = fenced.search(/[{[]/),
    end = Math.max(fenced.lastIndexOf("}"), fenced.lastIndexOf("]"));
  let body = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    const parsed = candidate && candidate !== text ? attempt(candidate) : null;
    if (parsed?.ok) return parsed;
  }
  for (const repaired of repairTruncatedJson(body)) {
    const parsed = attempt(repaired);
    if (parsed?.ok) return { ...parsed, truncated: true };
  }
  return { ok: false, error: String(first?.error?.message || "不是合法 JSON"), raw: text };
}
// 有副作用的工具：参数必须是完整的 JSON，且 schema 里的必填项一个不少，否则不执行
const SIDE_EFFECT_TOOLS = new Set([
  "run_command",
  "write_file",
  "edit_file",
  "remember",
  "forget",
  "delegate",
  "download_file",
  "http_request"
]);
// 按 prompts/tools.js 里的 schema 把参数理顺：模型写参数常有小出入，能理解的都照单收下，只有真讲不通的才算失败——
// 键名写成了常见的别名（file_path → path、cmd → command、old_string → old）、数字与布尔给成了字符串、该是数组的只给了一项、
// 该是数组的整段 JSON 又编码成了字符串、ask_user 把单个问题直接摊在顶层……都在这里归位；必填项理顺后仍缺的才报
const TOOL_ARG_ALIASES = {
  path: ["file_path", "filepath", "filename", "file", "target"],
  command: ["cmd", "script", "shell"],
  content: ["contents", "text", "data", "body", "file_content"],
  old: ["old_string", "old_text", "old_str", "from", "search", "find"],
  new: ["new_string", "new_text", "new_str", "to", "replacement", "replace"],
  query: ["q", "keyword", "keywords", "search", "term"],
  url: ["link", "href", "page"],
  task: ["prompt", "instruction", "instructions", "description"],
  name: ["document", "doc", "file"],
  id: ["conversation_id", "conversationId", "memory_id"]
};
function coerceToolValue(value, rule) {
  const type = rule?.type;
  if (value === undefined || value === null || !type) return value;
  if (type === "string") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value) && value.every(item => typeof item === "string")) return value.join("\n");
    return JSON.stringify(value, null, 2);
  }
  if (type === "number" || type === "integer") {
    if (typeof value === "number") return value;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : value;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    return ["true", "yes", "1", "是"].includes(text) ? true : ["false", "no", "0", "否", ""].includes(text) ? false : value;
  }
  if (type === "array" || type === "object") {
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }
    }
    if (type === "array") return Array.isArray(parsed) ? parsed : [parsed];
    return parsed;
  }
  return value;
}
function normalizeToolArguments(name, raw) {
  const spec = PROMPTS.tools?.[name]?.parameters,
    args = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  if (!spec?.properties) return { args, problems: [] };
  const known = new Set(Object.keys(spec.properties));
  // 别名归位：schema 里没有这个键、参数里也没给正名时，把别名的值挪过来
  for (const [key, aliases] of Object.entries(TOOL_ARG_ALIASES)) {
    if (!known.has(key) || args[key] !== undefined) continue;
    const alias = aliases.find(item => !known.has(item) && args[item] !== undefined);
    if (alias) args[key] = args[alias];
  }
  // 必填的数组只给了一项、还把那一项的字段摊在顶层（ask_user 常见：{"question":…,"options":…}）：包成一项
  for (const key of spec.required || []) {
    const rule = spec.properties[key];
    if (args[key] !== undefined || rule?.type !== "array" || !rule.items?.properties) continue;
    const itemKeys = Object.keys(rule.items.properties);
    if (itemKeys.some(item => args[item] !== undefined)) {
      const one = {};
      for (const item of itemKeys) if (args[item] !== undefined) one[item] = args[item];
      args[key] = [one];
    }
  }
  for (const [key, rule] of Object.entries(spec.properties)) args[key] = coerceToolValue(args[key], rule);
  const problems = [];
  for (const key of spec.required || []) if (args[key] === undefined || args[key] === null) problems.push(`缺少必填参数 ${key}`);
  return { args, problems };
}
// 被截断的 JSON：补齐未闭合的括号，能救多少是多少——先试直接补齐（截在一个值刚写完的地方），
// 不行再退到最后一个安全的逗号处（末尾那个残缺的键值对丢掉）。给出几个候选，由调用方逐个试
function repairTruncatedJson(text) {
  const stack = [];
  let inString = false,
    escaped = false,
    lastSafe = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && stack.length) lastSafe = i;
  }
  if (!stack.length && !inString) return [];
  const closers = stack.reverse().join(""),
    candidates = [];
  if (!inString) candidates.push(text.replace(/,\s*$/, "") + closers);
  // 截在半截的字符串或键值对里：退回最后一个安全的逗号处
  if (lastSafe > 0) candidates.push(text.slice(0, lastSafe) + closers);
  return candidates;
}
/** @param {Step} step */
function toolCacheKey(step) {
  const parsed = parseToolArguments(step.arguments);
  if (!parsed.ok) return `${step.name}:invalid:${String(step.arguments || "")}`;
  const args = parsed.args;
  if (step.name === "search_web")
    args.query = String(args.query || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  if (step.name === "fetch_page") {
    try {
      const url = new URL(String(args.url || ""));
      url.hash = "";
      args.url = url.href;
    } catch {
      args.url = String(args.url || "").trim();
    }
  }
  if (step.name === "read_document") {
    args.name = String(args.name || "")
      .trim()
      .toLowerCase();
    if (args.query) args.query = String(args.query).trim().toLowerCase();
    if (args.page) args.page = Number(args.page);
  }
  return `${step.name}:${JSON.stringify(stableToolJson(args))}`;
}
// 参数出错时回给模型的一行 schema 摘要，取自 prompts/tools.js 的定义
function toolSchemaHint(name) {
  const spec = PROMPTS.tools?.[name]?.parameters;
  if (!spec?.properties) return "见工具定义";
  const required = new Set(spec.required || []);
  return Object.entries(spec.properties)
    .map(([key, value]) => `${key}（${value.type || "any"}${required.has(key) ? "，必填" : "，可选"}）`)
    .join("、");
}
/** @param {Step} step */
function toolPresentation(step) {
  return {
    title: step.title || "",
    url: step.url || "",
    note: step.note || "",
    results: Array.isArray(step.results) ? structuredClone(step.results) : null
  };
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runTool(step, conversation, assistant, signal) {
  const parsed = parseToolArguments(step.arguments);
  if (!parsed.ok)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数不是合法 JSON（${parsed.error}）。arguments 必须是一个 JSON 对象，不要加代码围栏、注释或多余的逗号，也不要把它再编码成字符串；内容过长时先精简再发。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（前 300 字）：${String(parsed.raw || "").slice(0, 300)}`,
      display: "参数解析失败"
    };
  const sideEffect = SIDE_EFFECT_TOOLS.has(step.name);
  // 截断的参数救回来也不能拿去写：内容已经不全，写下去就是把文件写坏
  if (parsed.truncated && sideEffect)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数 JSON 不完整（多半是输出被最大长度截断），为安全起见没有执行。请把内容精简或分成几次写入（大文件先 write_file 写开头，再用 edit_file 追加），确保 arguments 是完整的 JSON。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（末尾 200 字）：…${String(step.arguments || "").slice(-200)}`,
      display: "参数不完整"
    };
  const { args, problems } = normalizeToolArguments(step.name, parsed.args);
  if (problems.length)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数不合要求：${problems.join("；")}。这件工具收的参数：${toolSchemaHint(step.name)}；实际收到的键：${Object.keys(parsed.args || {}).join("、") || "（无）"}${parsed.truncated ? "\n（参数 JSON 不完整，可能是输出被截断）" : ""}\n\n收到的原文（前 300 字）：${String(step.arguments || "").slice(0, 300)}`,
      display: "参数不合要求"
    };
  // 帮手对记忆只读：几名帮手同时改、删全局记忆没人把关，记与忘留给主模型
  if (step.scope && (step.name === "remember" || step.name === "forget"))
    return {
      ok: false,
      content: "帮手不能改动记忆（remember / forget 只有主模型可用）；需要记下的事写进回报里，由主模型决定。",
      display: "帮手无权"
    };
  try {
    if (step.name === "search_web") {
      step.title = String(args.query || "");
      const data = await bridge("/api/search", { query: step.title, count: 6 }, signal);
      step.results = (data.results || []).map(({ title, url, snippet }) => ({ title, url, snippet }));
      return {
        ok: true,
        content: step.results.length ? JSON.stringify(step.results) : "未找到结果",
        display: `${step.results.length} 条结果`
      };
    }
    if (step.name === "fetch_page") {
      step.url = String(args.url || "");
      const data = await bridge("/api/fetch", { url: step.url }, signal);
      step.title = data.title || step.url;
      return {
        ok: true,
        content: `标题：${data.title || ""}\n地址：${data.url || step.url}\n\n${data.text || ""}`,
        display: `${(data.text || "").length} 字`
      };
    }
    if (step.name === "read_document") return await readDocumentTool(step, args, conversation);
    if (step.name === "run_js") return await runJsTool(step, args, signal);
    if (step.name === "inspect_computer") return await inspectComputerTool(step, args, signal);
    if (step.name === "http_request") return await httpRequestTool(step, args, signal);
    if (step.name === "download_file") return await downloadFileTool(step, args, conversation, signal);
    if (step.name === "update_plan") return updatePlanTool(step, args);
    if (MEMORY_TOOLS.has(step.name)) return runMemoryTool(step, args, conversation);
    if (step.name === "ask_user") return await askUserTool(step, args, conversation, assistant, signal);
    if (step.name === "delegate") return await runDelegate(step, args, conversation, assistant, signal);
    if (WORK_TOOLS.has(step.name)) return await runWorkTool(step, args, conversation, assistant, signal);
    return { ok: false, content: `未知工具 ${step.name}`, display: "未知工具" };
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return {
      ok: false,
      content: `工具执行失败：${String(error.message || error)}`,
      display: friendlyError(String(error.message || error)).slice(0, 60)
    };
  }
}
async function inspectComputerTool(step, args, signal) {
  const sections = Array.isArray(args.sections) ? args.sections : args.sections ? [args.sections] : [],
    data = await bridge("/api/work/inspect", { sections, detail: args.detail === "full" ? "full" : "summary" }, signal),
    rows = (data.sections || []).map(section =>
      section.ok
        ? `## ${section.title}\n${section.output || "（无结果）"}`
        : `## ${section.title}\n检查失败：${section.error || "未知错误"}`
    ),
    ok = (data.sections || []).filter(section => section.ok).length;
  step.title = sections.length ? (data.sections || []).map(section => section.title).join("、") : "常规体检";
  step.output = rows.join("\n\n");
  step.note = `${ok}/${(data.sections || []).length} 项 · ${(Number(data.durationMs || 0) / 1000).toFixed(1)}s`;
  return {
    ok: ok > 0,
    content: step.output || "没有可用的检查结果",
    display: step.note
  };
}
// ---- run_js：在隔离沙箱里算一段 JS。沙箱是一个 sandbox iframe（origin null、CSP 不许联网）里的 Worker，由 preview-runtime.js 承担；
// 每次现起一个 iframe、算完就撤，超时由那头把 Worker 杀掉；直连没桥接也能用
function computeInSandbox(code, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const id = `compute-${uid()}`,
      iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.className = "compute-frame";
    iframe.setAttribute("aria-hidden", "true");
    iframe.src = `./preview.html#${id}`;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      iframe.remove();
      fn(value);
    };
    const onMessage = event => {
      if (event.source !== iframe.contentWindow || event.data?.id !== id) return;
      if (event.data.type === "yan-preview-ready")
        iframe.contentWindow.postMessage({ type: "yan-compute", id, code, timeout: timeoutMs }, "*");
      else if (event.data.type === "yan-compute-result") finish(resolve, event.data);
    };
    const onAbort = () => finish(reject, Object.assign(Error("已停止"), { name: "AbortError" }));
    // 那头没回话（页没起来、Worker 起不来）：多等 5 秒就算了
    const guard = setTimeout(() => finish(resolve, { ok: false, error: "沙箱没有回话" }), timeoutMs + 5000);
    window.addEventListener("message", onMessage);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    document.body.append(iframe);
  });
}
async function runJsTool(step, args, signal) {
  const code = String(args.code ?? "").trim();
  step.code = code;
  step.title =
    code
      .split("\n")
      .find(line => line.trim())
      ?.trim()
      .slice(0, 80) || "";
  if (!code) return { ok: false, content: "code 为空", display: "代码为空" };
  const timeout = clampNumber(Number(args.timeout) * 1000, 10000, 1000, 60000);
  const result = await computeInSandbox(code, timeout, signal);
  const parts = [];
  if (result.logs) parts.push(result.logs);
  if (result.value !== undefined) parts.push(`→ ${result.value}`);
  if (result.error) parts.push(`✗ ${result.error}`);
  step.output = trimOutput(parts.join("\n"));
  const ms = Number(result.ms) || 0;
  return {
    ok: !!result.ok,
    content: result.ok
      ? `${result.logs ? `输出：\n${result.logs}\n` : ""}返回值：${result.value === undefined ? "（无；用 return 交回结果）" : result.value}`.slice(
          0,
          60000
        )
      : `运行出错：${result.error || "未知错误"}${result.logs ? `\n出错前的输出：\n${result.logs}` : ""}`,
    display: result.ok ? `${ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}` : "出错"
  };
}
function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
}
// ---- http_request：经桥接向公网接口发请求；地址门禁在桥接那头（不许本机与内网）
async function httpRequestTool(step, args, signal) {
  const url = String(args.url || "").trim(),
    method = String(args.method || "GET")
      .trim()
      .toUpperCase();
  step.url = url;
  step.title = `${method} ${url}`.slice(0, 200);
  const data = await bridge("/api/http", { url, method, headers: args.headers, body: args.body }, signal);
  const headers = Object.entries(data.headers || {})
    .map(([name, value]) => `${name}: ${String(value).slice(0, 300)}`)
    .join("\n");
  const body = data.textual ? data.text || "(空)" : `（${data.type || "二进制"}，${formatFileSize(data.bytes)}，不作为文本返回）`;
  step.output = trimOutput(`${data.status} ${data.statusText || ""}\n${body}`);
  return {
    ok: data.status < 400,
    content: `HTTP ${data.status} ${data.statusText || ""}${data.url && data.url !== url ? `（跳转到 ${data.url}）` : ""}\n--- 响应头 ---\n${headers}\n--- 正文${data.truncated ? "（已截断）" : ""} ---\n${body}`,
    display: `${data.status} · ${data.textual ? `${(data.text || "").length} 字` : formatFileSize(data.bytes)}`
  };
}
// ---- download_file：桥接把网上的文件存进工作目录或卷宗；沙箱照常管路径
async function downloadFileTool(step, args, conversation, signal) {
  const workdir = workRoot(conversation);
  if (!workdir) return { ok: false, content: "此对话没有可用的目录（本机桥接不在线）", display: "无目录" };
  const url = String(args.url || "").trim();
  step.url = url;
  step.title = String(args.path || "").trim() || url.split("/").pop() || url;
  const data = await bridge(
    "/api/work/download",
    { workdir, roam: roamAllowed(), sandbox: sandboxed(), permission: commandPolicyOf(conversation), url, path: args.path },
    signal
  );
  step.title = data.path;
  step.note = url;
  step.change = { path: data.path, added: 0, removed: 0, created: true }; // 计入这一答的改动摘要
  return {
    ok: true,
    content: `已存为 ${data.path}（${formatFileSize(data.bytes)}${data.type ? `，${data.type}` : ""}）`,
    display: formatFileSize(data.bytes)
  };
}
// ---- update_plan：清单画在行迹里，每次都是完整的一份；回给模型一行计数就够
function updatePlanTool(step, args) {
  const STATUSES = new Set(["pending", "doing", "done", "skipped"]);
  const items = (Array.isArray(args.items) ? args.items : [])
    .map(item => (typeof item === "string" ? { text: item, status: "pending" } : item))
    .filter(item => item && typeof item === "object" && String(item.text || "").trim())
    .slice(0, 12)
    .map(item => ({
      text: String(item.text).trim().slice(0, 200),
      status: STATUSES.has(String(item.status || "").toLowerCase()) ? String(item.status).toLowerCase() : "pending"
    }));
  if (!items.length) return { ok: false, content: "items 为空：每项给 text 与 status", display: "清单为空" };
  step.plan = items;
  const done = items.filter(item => item.status === "done").length,
    doing = items.find(item => item.status === "doing");
  step.title = doing ? doing.text : done === items.length ? "全部完成" : `${done}/${items.length}`;
  return {
    ok: true,
    content: `计划已更新：${done}/${items.length} 完成${doing ? `，正在做「${doing.text}」` : ""}`,
    display: `${done}/${items.length}`
  };
}
// run_command 三档：问而后行（只读免问）、审而后行（不请示，桥接代判放行或回绝）、径行；言与行都可逐段设置。
const WORK_TOOLS = new Set(["run_command", "write_file", "edit_file", "read_file", "list_files", "search_files"]),
  // 言（对谈）里只给这四件：对谈的文件工具只为产出成品，逐字替换与代码检索是执事的活
  CHAT_FILE_TOOLS = ["run_command", "write_file", "read_file", "list_files"],
  pendingApprovals = new Map();
// 「问而后行」里的本机规则：明确只读才免确认。系统检查纳入白名单；只允许一组纯展示管道，脚本块、远程会话与重定向仍去请示。
const READ_ONLY_COMMAND =
    /^(?:git\s+(?:status|log|diff|show|rev-parse|ls-files|remote\s+-v)\b|git\s+branch(?:\s+(?:-a|-r|-v|-vv|--list))*\s*$|(?:ls|dir|tree|pwd|cat|type|head|tail|wc|grep|findstr|which|where|whoami|hostname|uname|uptime|free|df|du|ps|lscpu|lsmem|lsblk|lspci|lsusb|mount|id|groups|sw_vers|vm_stat)\b|Get-(?:ChildItem|Content|Location|Command|Item|ItemProperty|Date|ComputerInfo|CimInstance|WmiObject|Process|Service|NetAdapter|NetIPConfiguration|NetIPAddress|NetRoute|NetTCPConnection|NetUDPEndpoint|DnsClientServerAddress|Volume|Disk|Partition|PhysicalDisk|StorageReliabilityCounter|MpComputerStatus|HotFix|WinEvent|EventLog|ScheduledTask|LocalUser|LocalGroup|Acl|Package)\b|Select-String\b|(?:systeminfo|tasklist|driverquery|ipconfig|netstat)\b|sc(?:\.exe)?\s+query\b|wmic(?:\.exe)?\b[^\n]*\bget\b|wsl(?:\.exe)?\s+(?:--status|--version|-l\b|--list\b)|docker\s+(?:version|info|ps|images)\b|(?:node|npm|npx|python|python3|pip|dotnet|java|go|cargo|rustc|ruby|php|git)\s+(?:-v|-V|--version|version)\s*$)/i,
  READ_ONLY_PIPE =
    /^(?:Select-Object|Sort-Object|Format-Table|Format-List|ConvertTo-Json|Measure-Object|Group-Object|findstr|grep|head|tail|wc)\b/i;
function isReadOnlyCommand(command) {
  const text = String(command || "").trim();
  if (/[;&<>`\n{}]|\$\(|\|\|/.test(text) || /-(?:ComputerName|CimSession|Session|Credential)\b/i.test(text)) return false;
  const parts = text.split("|").map(part => part.trim());
  return !!parts[0] && READ_ONLY_COMMAND.test(parts[0]) && parts.slice(1).every(part => READ_ONLY_PIPE.test(part));
}
// 本段对话里读过或写过的文件才允许 edit_file：模型必须对着真实内容改，而不是凭记忆猜。
// 帮手另记一份（按步骤上的 scope 分开）：主模型没亲眼读过帮手改过的文件，要改就得再读一遍，帮手亦然
const workSeen = new Map();
// 键里带上目录：对话中途换了目录，之前读过的文件不算数
/**
 * @param {Conversation} conversation
 * @param {Step} step
 */
function seenKey(conversation, step) {
  const base = `${conversation.id}@${workRoot(conversation)}`;
  return step?.scope ? `${base}/${step.scope}` : base;
}
function normalizeWorkPath(file) {
  const parts = [];
  for (const part of String(file || "")
    .replace(/\\/g, "/")
    .split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
/**
 * @param {Conversation} conversation
 * @param {Step} step
 */
function markSeen(conversation, file, step = null) {
  const key = seenKey(conversation, step);
  let set = workSeen.get(key);
  if (!set) {
    set = new Set();
    workSeen.set(key, set);
  }
  set.add(normalizeWorkPath(file));
}
const STEP_OUTPUT_KEEP = 6000;
/**
 * @param {Step} step
 * @param {Conversation} conversation
 */
function awaitApproval(step, conversation, signal) {
  return new Promise((resolve, reject) => {
    const done = value => {
      pendingApprovals.delete(step.id);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      pendingApprovals.delete(step.id);
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingApprovals.set(step.id, { conversationId: conversation.id, resolve: done, step });
    renderApprovalBar();
  }).finally(renderApprovalBar);
}
// 请示条：指令等待确认时从输入框上方浮出，不必去行迹里找那一行；输入框留空时按 Enter 即运行
function pendingApprovalHere() {
  const c = currentConversation();
  if (!c) return null;
  for (const entry of pendingApprovals.values()) if (entry.conversationId === c.id && entry.step) return entry;
  return null;
}
function renderApprovalBar() {
  const bar = $("#approvalBar");
  if (!bar) return;
  const entry = view === "chat" ? pendingApprovalHere() : null;
  if (!entry) {
    bar.dataset.stepId = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  if (bar.dataset.stepId !== entry.step.id) {
    bar.dataset.stepId = entry.step.id;
    bar.dataset.page = "0";
    bar.innerHTML = approvalBarHtml(entry.step);
    formPage(bar);
  }
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function askUserTool(step, args, conversation, assistant, signal) {
  const questions = (Array.isArray(args.questions) ? args.questions : [])
    .slice(0, 8)
    .map(q => ({
      question: String(q?.question || "")
        .trim()
        .slice(0, 200),
      header: String(q?.header || "")
        .trim()
        .slice(0, 12),
      multi: q?.multi === true,
      options: (Array.isArray(q?.options) ? q.options : [])
        .slice(0, 4)
        // 选项按字符串给：「选项 — 一句说明」；旧的 { label, description } 对象也照收
        .map(o =>
          typeof o === "string"
            ? (([label, ...rest]) => ({ label: label.trim().slice(0, 60), description: rest.join("—").trim().slice(0, 120) }))(
                o.split(/\s+[—–-]{1,2}\s+|—/)
              )
            : {
                label: String(o?.label || "")
                  .trim()
                  .slice(0, 60),
                description: String(o?.description || "")
                  .trim()
                  .slice(0, 120)
              }
        )
        .filter(o => o.label)
    }))
    .filter(q => q.question);
  if (!questions.length)
    return {
      ok: false,
      content: `没能从参数里读出问题。questions 是一个数组，每项至少要有 question（完整的问句）与 options（2–4 个字符串选项），要多选就给 multi: true。例如：{"questions":[{"question":"用哪种风格？","header":"风格","options":["清简 — 留白多","繁复 — 信息密"],"multi":false}]}${
        Array.isArray(args.questions)
          ? `\n收到了 ${args.questions.length} 项，但没有一项带得出 question。`
          : `\n收到的 questions 是 ${typeof args.questions}，不是数组。`
      }`,
      display: "表单为空"
    };
  // 一个选项都没有的题只能靠自填，多半是模型漏了 options：补一句提醒，但表单照出，不白费这一轮
  const missing = questions.filter(q => q.options.length < 2).length;
  step.form = { questions };
  step.title = questions
    .map(q => q.header || q.question)
    .join(" · ")
    .slice(0, 80);
  const job = requestJob(conversation.id);
  step.status = "pending";
  if (job) setJobLabel(conversation, job, "等待确认");
  refreshSteps(assistant);
  saveStore();
  renderHistory();
  const answers = await awaitApproval(step, conversation, signal);
  step.status = "running";
  if (job) setJobLabel(conversation, job, "生成中");
  refreshSteps(assistant);
  renderHistory();
  if (!Array.isArray(answers)) {
    step.skipped = true;
    return { ok: false, content: "用户没有作答。请按你的最佳判断继续，并在正文里说明你做了什么假设。", display: "未作答" };
  }
  step.answers = answers;
  step.note = questions.map((q, i) => `${q.header || q.question}：${answers[i] || "（未答）"}`).join("；");
  return {
    ok: true,
    content: `${questions.map((q, i) => `${q.question}\n→ ${answers[i] || "（未答）"}`).join("\n\n")}${missing ? `\n\n（有 ${missing} 题没给够选项，只能由用户自填；下次每题给 2–4 个选项。）` : ""}`,
    display: "已作答"
  };
}
/** @param {Step} step */
function askStepHtml(step) {
  const status = step.status || "done",
    meta =
      status === "pending"
        ? "待作答"
        : status === "skipped"
          ? escapeHtml(step.result || "未作答")
          : status === "error"
            ? escapeHtml(step.result || "失败")
            : escapeHtml(step.result || "已作答");
  const body =
    status === "done" && step.answers
      ? `<div class="tool-note">${escapeHtml(step.note || "")}</div>`
      : status === "pending"
        ? `<div class="tool-note">请于输入框上方作答</div>`
        : "";
  return `<div class="tool-step" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">请示</span><span class="tool-title" title="${escapeHtml(step.title)}">${escapeHtml(step.title)}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
// 右上角只写一个快捷键：这一页按 Enter 是下一题还是提交（输入框留空时），随翻页改，见 formPage；题数与第几问在标题里
/** @param {Step} step */
function approvalBarHtml(step) {
  if (step.name !== "ask_user")
    return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title">${step.approvalScope === "answer" ? "本机请示" : "执事请示"} · 运行此指令</span><span class="approval-hint" title="输入框留空时，Enter 即运行">Enter 运行</span></div><pre class="approval-cmd">${escapeHtml(step.title)}</pre><div class="approval-actions"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="${step.approvalScope === "answer" ? "本答径行：本次回答里的后续指令不再询问，下一问恢复" : "径行：此对话中后续指令不再询问"}">${step.approvalScope === "answer" ? "本答径行" : "径行"}</button></div>`;
  const questions = step.form?.questions || [];
  const block = (q, i) =>
    `<div class="ask-q" data-q="${i}" data-multi="${q.multi ? "true" : "false"}"><div class="ask-question">${q.header ? `<span class="ask-header">${escapeHtml(q.header)}</span>` : ""}${escapeHtml(q.question)}${q.multi ? `<span class="ask-multi">可多选</span>` : ""}</div><div class="ask-options" role="${q.multi ? "group" : "radiogroup"}">${q.options.map((o, j) => `<button type="button" class="ask-opt" role="${q.multi ? "checkbox" : "radio"}" aria-checked="false" data-opt="${j}"><span class="ask-tick" aria-hidden="true"></span><span class="ask-opt-copy"><strong>${escapeHtml(o.label)}</strong>${o.description ? `<small>${escapeHtml(o.description)}</small>` : ""}</span></button>`).join("")}</div><input class="ask-other" type="text" maxlength="200" placeholder="${q.options.length ? (q.multi ? "还可自行补充" : "或自行填写") : "请填写"}" aria-label="自行填写"></div>`;
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title"></span><span class="approval-hint" title="输入框留空时，Enter 即作答"></span></div><div class="ask-form">${questions.map(block).join("")}</div><div class="approval-actions ask-nav"><span class="ask-spacer"></span><button type="button" class="ask-arrow" data-form="prev" title="上一题" aria-label="上一题">‹</button><button type="button" class="ask-arrow" data-form="next" title="下一题（未答即跳过）" aria-label="下一题">›</button><button type="button" class="ask-arrow ask-done" data-form="submit" title="提交" aria-label="提交">✓</button></div>`;
}
function formPage(bar, page = null) {
  const blocks = [...bar.querySelectorAll(".ask-q")];
  if (!blocks.length) return;
  const total = blocks.length,
    current = Math.max(0, Math.min(total - 1, page ?? Number(bar.dataset.page || 0)));
  bar.dataset.page = String(current);
  blocks.forEach((block, index) => block.classList.toggle("hidden", index !== current));
  bar.querySelector(".approval-title").textContent = total === 1 ? "有一问" : `第${chineseNumber(current + 1)}问 · 共 ${total} 问`;
  bar.querySelector(".approval-hint").textContent = current === total - 1 ? "Enter 提交" : "Enter 下一题";
  bar.querySelector('[data-form="prev"]').disabled = current === 0;
  bar.querySelector('[data-form="next"]').classList.toggle("hidden", current === total - 1);
  bar.querySelector('[data-form="submit"]').classList.toggle("hidden", current !== total - 1);
  if (page !== null) setTimeout(() => blocks[current].querySelector(".ask-opt, .ask-other")?.focus(), 0);
}
function collectForm(bar) {
  const step = pendingApprovalHere()?.step;
  if (!step?.form) return null;
  return step.form.questions.map((q, i) => {
    const block = bar.querySelector(`.ask-q[data-q="${i}"]`);
    if (!block) return "";
    const picked = [...block.querySelectorAll('.ask-opt[aria-checked="true"]')].map(b => b.querySelector("strong").textContent),
      other = block.querySelector(".ask-other")?.value.trim();
    return [...picked, ...(other ? [other] : [])].join("、");
  });
}
function approveFrom(button) {
  const stepId = button.closest("[data-step-id]")?.dataset.stepId,
    c = currentConversation();
  if (!stepId || !c) return;
  if (button.dataset.approve === "auto") {
    const step = pendingApprovals.get(stepId)?.step;
    if (step?.approvalScope === "answer") {
      const job = requestJob(c.id);
      if (job) job.commandAuto = true;
    } else {
      c.commandPolicy = "auto";
      saveStore();
      renderWorkAuto();
    }
  }
  settleApproval(stepId, button.dataset.approve !== "skip");
}
// 改动摘要：这一答里执事改过哪些文件、各增减多少行，挂在回复末尾，写入/修改一落地就实时累加，不等整条回复收尾
function diffCounts(oldText, newText) {
  const a = String(oldText || "").split(/\r?\n/),
    b = String(newText || "").split(/\r?\n/);
  if (!oldText) return { added: b.length, removed: 0 };
  if (!newText) return { added: 0, removed: a.length };
  if (a.length * b.length > 250000) return { added: b.length, removed: a.length };
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const common = dp[0][0];
  return { added: b.length - common, removed: a.length - common };
}
/** @param {{ steps?: Step[] }} message */
function changeStats(message) {
  const files = new Map();
  for (const step of allSteps(message)) {
    if (!step.change || step.status !== "done") continue;
    const entry = files.get(step.change.path) || { path: step.change.path, added: 0, removed: 0, created: false };
    entry.added += step.change.added;
    entry.removed += step.change.removed;
    entry.created ||= !!step.change.created;
    files.set(step.change.path, entry);
  }
  const list = [...files.values()];
  return { files: list, added: list.reduce((sum, f) => sum + f.added, 0), removed: list.reduce((sum, f) => sum + f.removed, 0) };
}
/** @param {Message} message */
function changeSummaryInner(message, open) {
  const stats = changeStats(message);
  if (!stats.files.length) return "";
  const count = `<span class="ins">+${stats.added}</span> <span class="del">−${stats.removed}</span>`;
  return `<button type="button" class="change-summary" aria-expanded="${open}"><span>${stats.files.length} 个文件已更改</span><span class="change-count">${count}</span></button><div class="change-files${open ? "" : " hidden"}">${stats.files.map(f => `<div><span class="path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}${f.created ? " <em>新建</em>" : ""}</span><span class="ins">+${f.added}</span><span class="del">−${f.removed}</span></div>`).join("")}</div>`;
}
// 成品：言里这一答在卷宗根目录新出或改过的文件。一件一行：类型、文件名、大小，右侧「看」（悬浮预览）与「下载」
// 卷宗里已经删掉的成品：条目留着（这一答确实出过这件），但标成「已移出卷宗」，不再给看与下载的按钮
function deliverableMissing(path) {
  return archiveOnline() && archiveEntries !== null && !archiveEntries.some(entry => entry.path === path);
}
function deliverableFileHtml(f) {
  const missing = deliverableMissing(f.path);
  return `<div class="deliver-file${missing ? " missing" : ""}" data-deliver="${escapeHtml(f.path)}"><span class="deliver-type">${escapeHtml(fileTypeLabel(f))}</span><span class="deliver-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span><small>${formatFileSize(f.size)}</small>${
    missing
      ? `<span class="deliver-gone">已移出卷宗</span>`
      : `<button type="button" class="deliver-btn" data-deliver-action="view" title="在此预览，不必下载">预览</button><button type="button" class="deliver-btn" data-deliver-action="download" title="另存到本机">下载</button>`
  }</div>`;
}
/** @param {Message} message */
function deliverablesHtml(message) {
  const files = message.deliverables || [];
  if (!files.length) return "";
  return `<div class="deliver-bar"><div class="deliver-head"><span class="seal deliver-seal" aria-hidden="true">成</span><span>成品 ${files.length} 件 · 已入卷宗</span></div>${files.map(deliverableFileHtml).join("")}</div>`;
}
// 卷宗目录刷新后，把页面上成品条里各件的在与不在同步一遍（消息本身没变，不必重画整条）
function syncDeliverables() {
  for (const bar of document.querySelectorAll(".deliver-bar")) {
    const article = bar.closest("[data-message]"),
      c = currentConversation(),
      message = c && allMessages(c).find(m => m.id === article?.dataset.message);
    if (!message?.deliverables?.length) continue;
    const html = message.deliverables.map(deliverableFileHtml).join("");
    const current = [...bar.querySelectorAll(".deliver-file")].map(node => node.outerHTML).join("");
    if (current !== html) bar.querySelectorAll(".deliver-file").forEach(node => node.remove()), bar.insertAdjacentHTML("beforeend", html);
  }
}
/** @param {Message} message */
function changeSummaryHtml(message, open = false) {
  const inner = changeSummaryInner(message, open);
  return inner ? `<div class="change-bar">${inner}</div>` : "";
}
// 步骤每次刷新都把改动条同步到回复末尾：数字就地更新（展开状态保留），首次出现时轻浮一下
/** @param {Message} assistant */
function syncChangeBar(block, assistant) {
  const bar = block.querySelector(":scope > .change-bar"),
    open = bar?.querySelector(".change-summary")?.getAttribute("aria-expanded") === "true",
    inner = changeSummaryInner(assistant, open);
  if (!inner) return bar?.remove();
  if (!bar) {
    block.insertAdjacentHTML("beforeend", `<div class="change-bar is-new">${inner}</div>`);
  } else if (bar.innerHTML !== inner) bar.innerHTML = inner;
}
function settleApproval(stepId, value) {
  const entry = pendingApprovals.get(stepId);
  if (entry) entry.resolve(value);
}
// 生成结束（停止、出错或中断）时，还在转圈或等待确认的步骤一并收束，不留下永远转圈的卡片
/** @param {Message} assistant */
function settleSteps(assistant, note) {
  for (const step of allSteps(assistant))
    if (step.status === "running" || step.status === "pending") {
      pendingApprovals.delete(step.id);
      step.status = step.status === "pending" ? "skipped" : "error";
      step.result = note;
    }
  for (const step of assistant.steps || []) if (step.sub?.status === "streaming") step.sub.status = "stopped";
}
// 一答里的全部步骤，含帮手在差遣卡片里跑的那些（只嵌一层：帮手不再差遣）
/** @param {{ steps?: Step[] }} message 消息或帮手 */
function allSteps(message) {
  return (message?.steps || []).flatMap(step => [step, ...(step.sub?.steps || [])]);
}
/** @param {Step} step */
function subChangedPaths(step) {
  return [...new Set((step.sub?.steps || []).filter(s => s.change && s.status === "done").map(s => s.change.path))];
}
// 差遣：主模型把一件自成一段的子任务交给帮手。帮手用同一个模型、同一套工具（不再差遣、不请示用户）另起一段对话跑自己的工具轮次（上限见设置），
// 步骤都画在主对话这条消息的差遣卡片里（指令照样问而后行），做完把最后一轮的回报连同改动摘要作为工具结果交回主模型
/**
 * @param {Step} step
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runDelegate(step, args, conversation, assistant, signal) {
  const task = String(args.task || "").trim();
  step.title =
    String(args.title || "")
      .trim()
      .slice(0, 40) || task.slice(0, 24);
  if (!task) return { ok: false, content: "task 不能为空：请把背景、目标、边界与要回报的内容写全", display: "任务为空" };
  const job = requestJob(conversation.id),
    profile = job?.profile || activeProfile();
  if (!profile) return { ok: false, content: "没有可用的模型", display: "无模型" };
  const tools = toolDefinitions(conversation, { sub: true });
  if (!tools) return { ok: false, content: "此对话里没有可交给帮手的工具", display: "无工具可用" };
  /** @type {SubAgent} */
  const sub = { id: `sub-${uid()}`, task, content: "", reasoning: "", steps: [], status: "streaming", usage: null, rounds: 0 };
  step.sub = sub;
  const history = [{ role: "user", content: task }];
  const overrides = {
    systemPrompt: `${assistantHint(profile, tools, conversation)}\n\n${prompt("delegate.system")}`,
    tools,
    enableSearch: modelSearchEnabled(profile),
    reasoning: conversation.reasoning || ""
  };
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    toolCache = new Map(),
    started = performance.now();
  // 帮手的话是逐字流进来的，卡片每隔一小会儿刷一次，不必每个字都重画
  let painted = "";
  const paint = () => {
    const sig = `${sub.content.length}|${sub.reasoning.length}|${sub.status}|${sub.steps.map(s => s.status).join("")}`;
    if (sig === painted) return;
    painted = sig;
    refreshSteps(assistant);
  };
  const ticker = setInterval(paint, 350);
  let reportStart = 0,
    failure = "";
  try {
    for (;;) {
      sub.toolCalls = null;
      sub.usage = null;
      reportStart = sub.content.length;
      await readReply(profile, history, signal, overrides, sub);
      if (sub.usage) for (const key of Object.keys(usage)) usage[key] += Number(sub.usage[key] || 0);
      const calls = (sub.toolCalls || []).filter(call => call.name);
      if (!calls.length || !overrides.tools) break;
      if (++sub.rounds > subRoundLimit()) {
        const said = sub.content.slice(reportStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push({ role: "user", content: prompt("delegate.limit") });
        overrides.tools = null;
        if (sub.content) sub.content += "\n\n";
        continue;
      }
      /** @type {Step[]} */
      const steps = calls.map(call => ({
        id: call.id || `call_${uid().slice(0, 8)}`,
        name: call.name,
        arguments: call.arguments || "{}",
        status: "running",
        at: sub.content.length,
        rat: String(sub.reasoning || "").length,
        scope: sub.id
      }));
      sub.steps.push(...steps);
      refreshSteps(assistant);
      history.push({
        role: "assistant",
        content: sub.content.slice(reportStart) || null,
        tool_calls: steps.map(s => ({ id: s.id, type: "function", function: { name: s.name, arguments: s.arguments } })),
        ...(sub.thinkingBlocks?.length ? { thinking_blocks: sub.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, signal, toolCache);
      for (const s of steps) history.push({ role: "tool", tool_call_id: s.id, content: outcomes.get(s.id) ?? "" });
      if (sub.content) sub.content += "\n\n";
      if (job) setJobLabel(conversation, job, "帮手工作中");
    }
    sub.status = "complete";
  } catch (error) {
    if (error.name === "AbortError") {
      sub.status = "stopped";
      throw error;
    }
    sub.status = "error";
    failure = friendlyError(String(error.message || error));
  } finally {
    clearInterval(ticker);
    sub.usage = usage.total_tokens ? usage : null;
    sub.durationMs = Math.round(performance.now() - started);
    sub.report = sub.content.slice(reportStart).trim();
    // 裁掉开头的空行就得把步骤记的偏移一起前移，否则帮手那条时间线上每一段话都错位、被切在字中间
    // （主循环里是补偿了的，见 streamReply 的 leadTrim）
    const leadTrim = sub.content.match(/^\n*/)[0].length;
    sub.content = sub.content.replace(/^\n+|\n+$/g, "");
    if (leadTrim) for (const s of sub.steps) if (typeof s.at === "number") s.at = Math.max(0, s.at - leadTrim);
    if (job) setJobLabel(conversation, job, "生成中");
    paint();
  }
  const changed = subChangedPaths(step),
    stats = changeStats({ steps: [step] }),
    changedNote = changed.length ? `，改了 ${changed.length} 个文件：${changed.join("、")}（+${stats.added} −${stats.removed}）` : "",
    seconds = Math.round(sub.durationMs / 1000),
    display = `${sub.steps.length} 步${changed.length ? ` · 改 ${changed.length} 个文件` : ""} · ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分`}`;
  if (sub.status !== "complete")
    return {
      ok: false,
      content: prompt("delegate.failed", {
        reason: failure || "未收到回报",
        steps: sub.steps.length,
        changed: changedNote,
        partial: sub.report ? `它最后说：${sub.report.slice(0, 4000)}` : ""
      }),
      display: `${display} · 未完成`
    };
  if (!sub.report)
    return {
      ok: false,
      content: prompt("delegate.failed", { reason: "帮手没有写回报", steps: sub.steps.length, changed: changedNote, partial: "" }),
      display: `${display} · 无回报`
    };
  return {
    ok: true,
    content: prompt("delegate.report", { steps: sub.steps.length, changed: changedNote, report: sub.report.slice(0, 16000) }),
    display
  };
}
// 每次发送前把工具的落脚目录备好。行：桥接必须在线、工作目录仍在（被删了就重建），否则不发；
// 言：桥接在线就顺手把卷宗目录备好，备不好也照常聊（工具用到时自会报错）
/** @param {Conversation} conversation */
async function ensureWorkReady(conversation) {
  if (!isWork(conversation)) {
    const archive = workRoot(conversation);
    // 备的是草稿目录，卷宗根随之建好
    if (archive && activeProfile()?.tools !== false)
      await bridge(
        "/api/work/prepare",
        { workdir: `${archive}${archive.includes("/") && !archive.includes("\\") ? "/" : "\\"}${scratchRel(conversation)}` },
        AbortSignal.timeout(8000)
      ).catch(error => toast(`卷宗目录不可用：${String(error.message || error)}`));
    return true;
  }
  if (activeProfile()?.tools === false) {
    toast("当前模型已关闭本机工具，请在模型高级配置中开启");
    return false;
  }
  if (apiBase === null && !(await ensureLocalBridge())) {
    toast("执事需要本机桥接，请先运行 start.cmd");
    return false;
  }
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: conversation.workdir }, AbortSignal.timeout(8000));
    if (prepared.created) toast("工作目录不存在，已新建");
    conversation.workdir = prepared.workdir;
  } catch (error) {
    toast(`工作目录不可用：${String(error.message || error)}`);
    return false;
  }
  return true;
}
function trimOutput(text) {
  const value = String(text || "");
  return value.length > STEP_OUTPUT_KEEP ? `…（前面 ${value.length - STEP_OUTPUT_KEEP} 字略去）\n${value.slice(-STEP_OUTPUT_KEEP)}` : value;
}
// 文件工具能不能出目录：设置里的「可及范围」，默认全盘（系统级配置、别处的资料本就该读得到）
function roamAllowed() {
  return store.settings.toolReach !== "inside";
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runWorkTool(step, args, conversation, assistant, signal) {
  const workdir = workRoot(conversation),
    roam = roamAllowed(),
    sandbox = sandboxed(),
    permission = commandPolicyOf(conversation);
  if (!workdir) return { ok: false, content: "此对话没有可用的目录（本机桥接不在线）", display: "无目录" };
  const job = requestJob(conversation.id);
  if (step.name === "run_command") {
    step.title = String(args.command || "").trim();
    if (!step.title) return { ok: false, content: "指令为空", display: "指令为空" };
    step.readOnly = isReadOnlyCommand(step.title);
    // shell 不是进程隔离：行可把整段对话切成径行；言第一次问，可只放行本答，不能悄悄把今后的对谈都放开
    let policy = job?.commandAuto ? "auto" : commandPolicyOf(conversation);
    if (policy === "ask" && !step.readOnly) {
      step.approvalScope = isWork(conversation) ? "conversation" : "answer";
      step.status = "pending";
      if (job) setJobLabel(conversation, job, "等待确认");
      refreshSteps(assistant);
      saveStore();
      renderHistory();
      const approved = await awaitApproval(step, conversation, signal);
      step.status = "running";
      if (job) setJobLabel(conversation, job, "执行中");
      refreshSteps(assistant);
      renderHistory();
      if (!approved) {
        step.skipped = true;
        return { ok: false, content: prompt("work.skipped"), display: "已跳过" };
      }
    } else if (job) setJobLabel(conversation, job, "执行中");
    // 用户可能在等待条上把这一段对话切成审而后行或径行；执行前再取一次，不沿用旧档位。
    policy = job?.commandAuto ? "auto" : commandPolicyOf(conversation);
    const data = await bridge(
      "/api/work/run",
      { workdir, sandbox, permission: policy, command: step.title, timeout: Number(args.timeout) || 120 },
      signal
    );
    step.exitCode = data.exitCode;
    step.output = trimOutput([data.stdout, data.stderr].filter(Boolean).join(data.stdout && data.stderr ? "\n--- stderr ---\n" : ""));
    const seconds = (data.durationMs / 1000).toFixed(data.durationMs < 10000 ? 1 : 0);
    const display = `${data.timedOut ? `超时终止 · ${seconds}s` : data.exitCode === 0 ? `完成 · ${seconds}s` : `退出码 ${data.exitCode} · ${seconds}s`}${step.readOnly && policy === "ask" ? " · 只读免确认" : ""}`;
    return {
      ok: !data.timedOut && data.exitCode === 0,
      content: `退出码：${data.exitCode}${data.timedOut ? "（超时被终止）" : ""}\n--- stdout ---\n${data.stdout || "(空)"}\n--- stderr ---\n${data.stderr || "(空)"}`,
      display
    };
  }
  if (step.name === "write_file") {
    step.title = String(args.path || "");
    const data = await bridge(
      "/api/work/write",
      { workdir, roam, sandbox, permission, path: step.title, content: String(args.content ?? "") },
      signal
    );
    step.title = data.path;
    markSeen(conversation, data.path, step);
    step.note = `${data.lines} 行 · ${formatFileSize(data.bytes)}${data.existed ? " · 覆盖" : ""}`;
    step.change = {
      path: data.path,
      added: data.lines,
      removed: data.existed ? Number(data.previousLines) || 0 : 0,
      created: !data.existed
    };
    return {
      ok: true,
      content: `已写入 ${data.path}（${data.bytes} 字节，${data.lines} 行${data.existed ? "，覆盖了原文件" : ""}）`,
      display: data.existed ? "已覆盖" : "已写入"
    };
  }
  if (step.name === "read_file") {
    step.title = String(args.path || "");
    const data = await bridge(
      "/api/work/read",
      { workdir, roam, sandbox, permission, path: step.title, offset: args.offset, limit: args.limit },
      signal
    );
    step.title = data.path;
    markSeen(conversation, data.path, step);
    return {
      ok: true,
      content: `${data.path}（共 ${data.totalLines} 行，此处第 ${data.offset}–${data.offset + data.shown - 1} 行）\n${data.text}`,
      display: `${data.shown}/${data.totalLines} 行`
    };
  }
  if (step.name === "edit_file") {
    step.title = String(args.path || "");
    const seen = workSeen.get(seenKey(conversation, step)),
      normalized = normalizeWorkPath(step.title);
    if (!seen?.has(normalized)) return { ok: false, content: prompt("work.unread", { path: step.title }), display: "需先读取" };
    const data = await bridge(
      "/api/work/edit",
      {
        workdir,
        roam,
        sandbox,
        permission,
        path: step.title,
        old: String(args.old ?? ""),
        new: String(args.new ?? ""),
        replaceAll: args.replace_all === true
      },
      signal
    );
    step.title = data.path;
    step.diff = { old: String(args.old ?? "").slice(0, 1500), new: String(args.new ?? "").slice(0, 1500) };
    const counts = diffCounts(String(args.old ?? ""), String(args.new ?? ""));
    step.change = { path: data.path, added: counts.added * data.replaced, removed: counts.removed * data.replaced };
    return {
      ok: true,
      content: `已修改 ${data.path}：第 ${data.line} 行起替换 ${data.replaced} 处，文件现为 ${data.lines} 行`,
      display: `第 ${data.line} 行 · ${data.replaced} 处`
    };
  }
  if (step.name === "search_files") {
    step.title = String(args.query || "");
    const data = await bridge(
      "/api/work/search",
      {
        workdir,
        roam,
        sandbox,
        permission,
        query: step.title,
        path: args.path,
        glob: args.glob,
        literal: args.literal === true,
        limit: args.limit
      },
      signal
    );
    const lines = data.matches.map(match => `${match.file}:${match.line}: ${match.text}`);
    step.output = trimOutput(lines.join("\n"));
    step.note = data.matches.length ? "" : "无匹配";
    return {
      ok: true,
      content: lines.length
        ? `${lines.join("\n")}${data.truncated ? "\n…（结果已截断，请缩小范围或加 glob）" : ""}`
        : `未找到匹配「${step.title}」的内容（扫描了 ${data.scanned} 个文件）`,
      display: `${data.matches.length} 处 · ${data.files} 文件`
    };
  }
  step.title = `${String(args.path || ".")}${args.pattern ? ` · ${args.pattern}` : ""}`;
  const data = await bridge(
    "/api/work/list",
    { workdir, roam, sandbox, permission, path: args.path, depth: args.depth, pattern: args.pattern },
    signal
  );
  step.title = `${data.path}${args.pattern ? ` · ${args.pattern}` : ""}`;
  step.output = trimOutput(data.entries.join("\n"));
  return {
    ok: true,
    content: data.entries.length
      ? `${data.entries.join("\n")}${data.truncated ? "\n…（条目过多已截断，请指定子目录）" : ""}`
      : "（空目录）",
    display: `${data.entries.length} 项`
  };
}
// 磁盘卷宗里的文档：取回原件，文本直接用，PDF / Office 在本机抽正文；按路径与修改时间缓存几份
const archiveDocCache = new Map();
async function archiveDocumentText(doc) {
  const key = `${doc.archive}|${doc.modifiedAt}`;
  if (archiveDocCache.has(key)) return archiveDocCache.get(key);
  const response = await fetch(archiveFileUrl(doc.archive), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("取回失败");
  const blob = await response.blob();
  const text = isTextFile({ name: doc.name, type: "" })
    ? await blob.text()
    : await extractDocumentText(doc.name, await readFile(blob, "data"));
  archiveDocCache.set(key, text);
  if (archiveDocCache.size > 12) archiveDocCache.delete(archiveDocCache.keys().next().value);
  return text;
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 */
async function readDocumentTool(step, args, conversation) {
  const docs = availableDocuments(conversation),
    wanted = String(args.name || "").toLowerCase();
  const doc =
    docs.find(d => d.name.toLowerCase() === wanted) ||
    docs.find(d => d.name.toLowerCase().includes(wanted)) ||
    (docs.length === 1 ? docs[0] : null);
  if (!doc)
    return { ok: false, content: `未找到文档「${args.name}」。可读文档：${docs.map(d => d.name).join("、") || "无"}`, display: "未找到" };
  step.title = doc.name;
  let text = "";
  if (doc.archive) {
    try {
      text = await archiveDocumentText(doc);
    } catch (error) {
      return { ok: false, content: `卷宗文档读取失败：${String(error.message || error).slice(0, 120)}`, display: "读取失败" };
    }
  } else {
    const record = await getAttachment(doc.id);
    text = record ? (record.kind === "text" ? String(record.data || "") : String(record.extractedText || "")) : "";
  }
  if (!text) return { ok: false, content: "该文档无可读取的文本", display: "无文本" };
  const pages = text.split(/^(?=第 \d+ 页$)/m),
    pageCount = pages.filter(p => /^第 \d+ 页$/m.test(p)).length;
  if (args.page) {
    const page = pages.find(p => p.startsWith(`第 ${Number(args.page)} 页`));
    if (!page) return { ok: false, content: `没有第 ${args.page} 页，共 ${pageCount || 1} 页`, display: "页码超出" };
    step.note = `第 ${args.page} 页`;
    return { ok: true, content: page.slice(0, 20000), display: `第 ${args.page} 页 · ${page.length} 字` };
  }
  if (args.query) {
    const needle = String(args.query).toLowerCase(),
      hits = [];
    let index = text.toLowerCase().indexOf(needle);
    while (index >= 0 && hits.length < 8) {
      hits.push(text.slice(Math.max(0, index - 300), index + needle.length + 300).trim());
      index = text.toLowerCase().indexOf(needle, index + needle.length + 300);
    }
    step.note = `关键词「${args.query}」`;
    return hits.length
      ? { ok: true, content: hits.map((hit, i) => `片段 ${i + 1}：…${hit}…`).join("\n\n"), display: `${hits.length} 处匹配` }
      : { ok: true, content: `全文未出现「${args.query}」`, display: "无匹配" };
  }
  const limit = 12000;
  step.note = `${text.length} 字${pageCount ? ` · ${pageCount} 页` : ""}`;
  return {
    ok: true,
    content:
      text.length > limit
        ? `${text.slice(0, limit)}\n\n[文档共 ${text.length} 字${pageCount ? `、${pageCount} 页` : ""}，此处只给出开头；可用 page 或 query 参数读取其余部分]`
        : text,
    display: `${Math.min(text.length, limit)} 字`
  };
}

  // ---- 16-api.js ----
// 言 · 接口：用量估算、请求、SSE 读取、错误说明
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function estimateText(text) {
  const chinese = (text.match(/[㐀-鿿]/g) || []).length;
  return chinese + Math.ceil((text.length - chinese) / 4);
}
// 上下文过重的门槛：每一答的用量标注超过它就转为印色提醒
const CONTEXT_HEAVY = 24000;
function estimateTokens(messages) {
  let score = 0;
  for (const message of messages) {
    score += 4;
    if (typeof message.content === "string") {
      score += estimateText(message.content);
      continue;
    }
    // 图片和文件原件不能按 base64 长度折算，按固定值粗估
    for (const part of Array.isArray(message.content) ? message.content : [])
      score +=
        part.type === "text" ? estimateText(String(part.text || "")) : part.type === "image_url" ? 1000 : part.type === "file" ? 2000 : 0;
  }
  return Math.max(1, Math.ceil(score));
}
function parseTokenLimit(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([kme])?$/);
  if (!match) return null;
  const amount = Number(match[1]),
    unit = match[2] || "k",
    multiplier = unit === "e" ? 100000000 : unit === "m" ? 1000000 : 1000;
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * multiplier) : null;
}
// 余墨只属于模型，不属于对话：对话在所选模型耗尽时暂停，换模型或调高上限即刻可续，不再把整段对话锁死
/** @param {Conversation} c */
function conversationDry(c) {
  return !!c && quotaExhausted(activeProfile());
}
// 进行中的请求先把预计用量记在预留里：几段对话同时开工时，后开的看得见先开的已经占了多少，不会都以为「还剩 20k」而合计超卖；
// 请求收尾时预留撤销、换成实际用量。只在内存里记，刷新页面即清
const reservedTokens = new Map();
/** @param {Profile} profile */
function reservedFor(profile) {
  return profile ? Number(reservedTokens.get(profile.id) || 0) : 0;
}
/** @param {Profile} profile */
function reserveTokens(profile, amount) {
  if (!profile || !(amount > 0)) return () => {};
  reservedTokens.set(profile.id, reservedFor(profile) + amount);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const rest = reservedFor(profile) - amount;
    if (rest > 0) reservedTokens.set(profile.id, rest);
    else reservedTokens.delete(profile.id);
  };
}
/** @param {Profile} profile */
function quotaExhausted(profile) {
  const cap = parseTokenLimit(profile?.quota);
  return cap !== null && cap > 0 && Number(profile?.usedTokens || 0) >= cap;
}
// 开工前的门槛：已用的加上别处进行中预留的，都算进去
/** @param {Profile} profile */
function quotaBlocked(profile) {
  const cap = parseTokenLimit(profile?.quota);
  return cap !== null && cap > 0 && Number(profile?.usedTokens || 0) + reservedFor(profile) >= cap;
}
function formatTokens(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const compact = (amount, unit) => `${Number(amount.toFixed(amount >= 10 ? 0 : 1))}${unit}`;
  return n >= 100000000
    ? compact(n / 100000000, "e")
    : n >= 1000000
      ? compact(n / 1000000, "m")
      : n >= 1000
        ? compact(n / 1000, "k")
        : String(n);
}
// 思考强度：OpenAI 系接口走 reasoning_effort；DashScope 兼容模式走 enable_thinking / thinking_budget。留空则不带字段，由接口自己定。
// 各家接受的档位不一样（有的只有 low / medium / xhigh，有的多一个 minimal 或 max）：模型配置里可填「思考档位」，
// 没填就按四档（低 / 中 / 高 / 最高）列；只认三档的接口拒绝某个档位时，从它的报错里读出它认的那几档记到模型上，
// 把这一问换成最接近的一档重发一次，此后菜单只列它认的。菜单上没有「关」：愿意接 Key 的人不至于连思考都不愿开，
// 要它少想就选「低」，旧数据里存的「关」按「默认」看
const REASONING_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
  REASONING_NAMES = { "": "默认", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" },
  REASONING_DEFAULT_LEVELS = ["low", "medium", "high", "max"];
function reasoningLabel(level) {
  return REASONING_NAMES[level || ""] || level;
}
// 旧版菜单上有「关」（off / none）：现在按「默认」看，不带字段
function normalizeReasoning(level) {
  return level === "off" || level === "none" ? "" : String(level || "");
}
// 模型认的档位（不含「关」）：配置里填的（或探到的）优先，否则通用四档；一律按由低到高排，不管填写或报错里是什么顺序。
// 填的是 none：这个模型不认思考档位（探测时接口说不认识 reasoning_effort），菜单上只剩「默认」
/** @param {Profile} profile */
function profileReasoningLevels(profile) {
  const raw = String(profile?.reasoningLevels || "").toLowerCase();
  if (raw.trim() === "none") return [];
  const listed = raw.split(/[\s,，、/|]+/).filter(item => REASONING_ORDER.includes(item) && item !== "none");
  return listed.length
    ? [...new Set(listed)].sort((a, b) => REASONING_ORDER.indexOf(a) - REASONING_ORDER.indexOf(b))
    : REASONING_DEFAULT_LEVELS;
}
// 菜单上的档位：默认 + 模型认的几档
/** @param {Profile} profile */
function reasoningChoices(profile) {
  return ["", ...profileReasoningLevels(profile)];
}
// 把用户选的档位落到模型认的档位上：认就原样用；不认则取最接近的一档，同样近时取高的那档（选「高」是想它多想，别给它降成「中」）
/** @param {Profile} profile */
function nearestReasoning(profile, level) {
  level = normalizeReasoning(level);
  if (!level) return level;
  const levels = profileReasoningLevels(profile);
  if (!levels.length) return "";
  if (levels.includes(level)) return level;
  const want = REASONING_ORDER.indexOf(level);
  return [...levels].sort((a, b) => {
    const da = Math.abs(REASONING_ORDER.indexOf(a) - want),
      db = Math.abs(REASONING_ORDER.indexOf(b) - want);
    return da - db || REASONING_ORDER.indexOf(b) - REASONING_ORDER.indexOf(a);
  })[0];
}
/** @param {Profile} profile */
function reasoningFields(profile, level) {
  level = normalizeReasoning(level);
  if (!level) return {};
  if (/dashscope|aliyuncs/i.test(profile.baseUrl || ""))
    return {
      enable_thinking: true,
      thinking_budget: { minimal: 1024, low: 2048, medium: 8192, high: 32768, xhigh: 65536, max: 81920 }[level] || 8192
    };
  const effort = nearestReasoning(profile, level);
  return effort ? { reasoning_effort: effort } : {};
}
// 从接口的报错里认出它支持的几档（如 Supported values are: 'low', 'medium', and 'xhigh'），由低到高排；认不出来给空。
// sent 是这次发出去、被拒的那一档：报错里通常会把它也复述一遍（Invalid value: 'high'），不能当成它认的
function parseReasoningLevels(message, sent) {
  const text = String(message || "");
  if (!/reasoning|effort|thinking/i.test(text) && !(sent && text.includes(sent))) return [];
  const found = [...new Set([...text.matchAll(/\b(none|minimal|low|medium|high|xhigh|max)\b/gi)].map(m => m[1].toLowerCase()))].filter(
    level => level !== "none" && level !== sent
  );
  return found.length < 2 ? [] : found.sort((a, b) => REASONING_ORDER.indexOf(a) - REASONING_ORDER.indexOf(b));
}
// 接口拒绝了思考档位：认出它支持的几档记到模型上；认不出来就不动
/**
 * @param {Profile} profile
 * @param {Message} message
 */
function learnReasoningLevels(profile, message, sent) {
  const found = parseReasoningLevels(message, sent);
  if (!found.length) return false;
  const current = profileReasoningLevels(profile);
  if (found.length === current.length && found.every(level => current.includes(level))) return false;
  profile.reasoningLevels = found.join(", ");
  // 从报错里学到的就是这个身份的定论，不必再探
  profile.reasoningProbed = reasoningProbeKey(profile);
  persistServerProfile(profile);
  saveStoreSoon();
  return true;
}
// 选定模型时探一下它认哪几档：故意送一个不存在的档位（probe），接口若按 OpenAI 的样子报错，就把报错里列的几档记下；
// 报错说它压根不认识 reasoning_effort，记成 none（菜单上只剩「默认」）；接口照单全收（中转站常常忽略这个字段）就按通用四档列。
// 鉴权、网络之类别的错不算探过，下次再探。探过的记在 reasoningProbed 上——记的是「接口 + 地址 + 模型」三样合成的键，
// 换了模型、换了地址或接口类型都得重探；探测发出去之后模型被换了（探着 A 的时候切到 B），回来的结果作废，不往 B 上写。
// Anthropic 与 DashScope 的档位是换算成预算送的，没有可探的枚举，直接算探过。回值是探到的几档，没探成给 null
/** @param {Profile} profile 探的是这个模型此刻的身份 */
function reasoningProbeKey(profile) {
  return `${anthropicLike(profile) ? "anthropic" : "openai"}|${String(profile?.baseUrl || "").trim()}|${String(profile?.model || "").trim()}`;
}
// 探过、或用户亲手填过档位（记成 manual|键——手填的是定论，测试连接也不重探；换了模型才作废）。
// 旧版只有 reasoningLevels、没有探过的标记（那时的档位是手填或从报错里学来的）：当手填的，绑在当前身份上，首次探测不能把它冲掉
/** @param {Profile} profile */
function reasoningProbed(profile) {
  if (!profile?.model) return false;
  const key = reasoningProbeKey(profile);
  if (profile.reasoningLevels && !profile.reasoningProbed) {
    profile.reasoningProbed = `manual|${key}`;
    persistServerProfile(profile);
    saveStoreSoon();
  }
  return profile.reasoningProbed === key || profile.reasoningProbed === `manual|${key}`;
}
// 这个身份上的档位是亲手填的（换了模型，先前手填的就不算数了）
/** @param {Profile} profile */
function reasoningManual(profile) {
  return !!profile?.model && profile.reasoningProbed === `manual|${reasoningProbeKey(profile)}`;
}
// 走到这里就是身份变了（或亲手要求重探）：此前记的档位是旧模型的，一律不沿用——接口照单全收就按通用四档，
// 不然旧模型的 none 会跟着新模型走，把一个认档位的模型永远标成不认
/** @param {Profile} profile */
async function probeReasoningLevels(profile) {
  if (!profile?.model || reasoningProbed(profile)) return null;
  const key = reasoningProbeKey(profile);
  if (anthropicLike(profile) || /dashscope|aliyuncs/i.test(profile.baseUrl || "")) {
    profile.reasoningLevels = "";
    profile.reasoningProbed = key;
    persistServerProfile(profile);
    saveStoreSoon();
    return profileReasoningLevels(profile);
  }
  if (apiBase === null && profile.source === "server") return null;
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await requestChat(profile, [{ role: "user", content: "。" }], controller.signal, {
      systemPrompt: "",
      maxTokens: 16,
      reasoning: "probe"
    });
    // 探着探着模型被换了：这份结果是旧模型的，作废；探着的时候用户亲手填了档位：手填的是定论，也作废
    if (reasoningProbeKey(profile) !== key || reasoningManual(profile)) return null;
    let learned;
    if (response.ok) learned = REASONING_DEFAULT_LEVELS;
    else {
      const data = await response.json().catch(() => ({})),
        message = (typeof data.error === "string" ? data.error : data.error?.message) || "";
      const found = parseReasoningLevels(message, "probe");
      if (found.length) learned = found;
      // 只有明说不认识这个字段的才记成不认；「Invalid reasoning_effort value」这种只是嫌 probe 不对、又没列它认的几档——
      // 按通用四档，撞了错再学。报错压根不提思考的（鉴权、限流）不算探过
      else if (!/reasoning_effort|reasoning|effort/i.test(message)) return null;
      else if (/unknown|unrecognized|unsupported|not support|不支持|不认识/i.test(message)) learned = [];
      else learned = REASONING_DEFAULT_LEVELS;
    }
    profile.reasoningLevels = learned.length ? learned.join(", ") : "none";
    profile.reasoningProbed = key;
    persistServerProfile(profile);
    saveStoreSoon();
    return learned;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
// 经桥接的请求头：用桥接预设的模型时带上会话令牌（见 server.js 的 SESSION_TOKEN）
/** @param {Profile} profile */
function bridgeHeaders(profile) {
  return {
    "Content-Type": "application/json",
    ...(profile?.source === "server" && bootstrap.token ? { "X-Yan-Session": bootstrap.token } : {})
  };
}
/** @param {Profile} profile */
async function requestChat(profile, messages, signal, overrides = {}) {
  const parameters = {
    messages,
    systemPrompt: overrides.systemPrompt ?? (profile.systemPrompt || ""),
    temperature: Number(overrides.temperature ?? profile.temperature ?? 0.7),
    maxTokens: Number(overrides.maxTokens ?? profile.maxTokens ?? DEFAULT_MAX_TOKENS)
  };
  const extras = {
    ...(overrides.tools ? { tools: overrides.tools } : {}),
    ...(overrides.enableSearch ? { enable_search: true } : {}),
    // probe 是探档位时故意送的、不存在的一档，原样送出去让接口报错（见 probeReasoningLevels）
    ...(overrides.reasoning === "probe" ? { reasoning_effort: "probe" } : reasoningFields(profile, overrides.reasoning))
  };
  if (apiBase !== null)
    return fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: bridgeHeaders(profile),
      body: JSON.stringify({ profile: profileForRequest(profile), ...parameters, ...extras }),
      signal
    });
  if (profile.source === "server") throw Error("本机桥接未启动");
  const payload = {
    model: profile.model,
    messages: parameters.systemPrompt ? [{ role: "system", content: parameters.systemPrompt }, ...messages] : messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: parameters.temperature,
    max_tokens: parameters.maxTokens,
    ...extras
  };
  // 直连 Anthropic：请求换成 Messages API 的，回来的事件流换回 OpenAI 风格，后面的读法不变
  if (anthropicLike(profile)) {
    const upstream = await fetch(anthropicEndpoint(profile.baseUrl), {
      method: "POST",
      headers: anthropicHeaders(profile.apiKey, true),
      body: JSON.stringify(anthropicRequest(payload)),
      signal
    });
    if (!upstream.ok || !upstream.body) return upstream;
    return new Response(upstream.body.pipeThrough(anthropicToOpenAiStream(profile.model)), {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" }
    });
  }
  payload.messages = payload.messages.map(m => (m.thinking_blocks ? { ...m, thinking_blocks: undefined } : m));
  return fetch(completionEndpoint(profile.baseUrl), {
    method: "POST",
    headers: directHeaders(profile),
    body: JSON.stringify(payload),
    signal
  });
}
// 直连时列模型的地址与请求头：Anthropic 与 OpenAI 兼容的各一套
/** @param {Profile} profile */
function directModelsRequest(profile) {
  return anthropicLike(profile)
    ? { url: anthropicEndpoint(profile.baseUrl, "/v1/models"), headers: anthropicHeaders(profile.apiKey, true) }
    : { url: modelsEndpoint(profile.baseUrl), headers: directHeaders(profile) };
}
function completionEndpoint(baseUrl) {
  const url = String(baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!/^https?:\/\//i.test(url)) throw Error("Base URL 只支持 http 或 https");
  return /\/chat\/completions$/i.test(url) ? url : `${url}/chat/completions`;
}
function modelsEndpoint(baseUrl) {
  const url = new URL(String(baseUrl || "").trim());
  url.pathname = `${url.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/$/, "")}/models`;
  return url.href;
}
/** @param {Profile} profile */
function directHeaders(profile) {
  return { "Content-Type": "application/json; charset=utf-8", ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}) };
}
/** @param {Profile} profile */
function profileForRequest(profile) {
  return profile.source === "server"
    ? { source: "server" }
    : { source: "custom", baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: profile.model, api: profile.api || "" };
}
/** @param {Message} assistant 主消息、帮手，或拟题 / 压缩用的临时消息 */
async function readSse(response, assistant, { onFrame = null } = {}) {
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    scheduled = false;
  // 落墨节奏：正文不按网络分块一坨坨出现，而是每帧按积压量的一定比例匀速写出（积压越多写得越快，最多滞后零点几秒）；新写出的字带短暂渐显，末尾跟一支笔尖光标
  const paced = !inkMotionOff();
  let shown = paced ? assistant.content.length : Infinity,
    freshGroups = [];
  let closed = false;
  const frame = () => {
    scheduled = false;
    if (closed) return;
    const target = assistant.content.length,
      at = performance.now();
    const block = document.querySelector(`[data-message="${assistant.id}"] .assistant-block`);
    if (!block) {
      shown = target;
      freshGroups = [];
      return;
    }
    if (paced) {
      const backlog = target - shown,
        step = backlog <= 0 ? 0 : document.hidden ? backlog : Math.min(backlog, Math.max(1, Math.ceil(backlog * REVEAL_RATE)));
      if (step > 0) {
        shown += step;
        freshGroups.unshift({ at, count: step });
      }
      freshGroups = freshGroups.filter(group => at - group.at < FRESH_MS);
    }
    const visible = paced ? assistant.content.slice(0, shown) : assistant.content;
    const base = trailBase(assistant),
      host = trailLiveHost(block, assistant) || block,
      rbase = trailReasoningBase(assistant),
      thought = String(assistant.reasoning || "").slice(rbase);
    if (thought.trim()) {
      let details = host.querySelector(":scope > .reasoning");
      if (!details) {
        host.insertAdjacentHTML("afterbegin", reasoningHtml(assistant, thought));
        details = host.querySelector(":scope > .reasoning");
        details.classList.add("is-new");
      }
      const body = details.querySelector(".reasoning-body");
      body.textContent = thought;
      // 按轮判断在写与否；新一轮的思绪来了就再摊开，正文起笔即收——与行迹一样：运行中打开，运行完关闭
      const live = reasoningLive({ ...assistant, content: visible });
      details.dataset.state = live ? "live" : "done";
      if (details.open && body._follow !== false) body.scrollTop = body.scrollHeight; // 软跟踪：没往上翻就跟着最新一行走
      if (!assistant.reasoningTouched) {
        if (!live && details.open) settleDetails(details, false);
        else if (live && !details.open) settleDetails(details, true);
      }
    }
    if (!visible) {
      if (!block.querySelector(".thinking")) insertAboveChangeBar(block, `<div class="thinking">正在凝神</div>`);
    } else if (visible.length <= base) {
      /* 新一轮尚未起笔 */
    } else {
      let markdown = host.querySelector(":scope > .markdown");
      if (!markdown?.querySelector(".md-tail")) {
        block.querySelector(".thinking")?.remove();
        markdown?.remove();
        insertAboveChangeBar(
          host,
          `<div class="markdown" data-cut="${base}" data-base="${base}"><div class="md-stable"></div><div class="md-tail"></div></div>`
        );
        markdown = host.querySelector(":scope > .markdown");
      }
      // 已经收尾的段落只渲染一次追加进 md-stable，每帧只重绘最后一段，长回复不会越来越卡；已渲染位置记在 data-cut 上，跨工具轮次也不会重复
      let renderedCut = Number(markdown.dataset.cut || 0);
      const cut = stableCut(visible);
      if (cut > renderedCut) {
        const stable = markdown.querySelector(".md-stable");
        stable.insertAdjacentHTML("beforeend", renderMarkdown(visible.slice(renderedCut, cut)));
        renderedCut = cut;
        markdown.dataset.cut = String(cut);
        renderEnhancements(stable);
      }
      const tail = markdown.querySelector(".md-tail");
      suppressViz = true;
      try {
        paintTail(tail, renderMarkdown(visible.slice(renderedCut)));
      } finally {
        suppressViz = false;
      }
      decorateTail(
        tail,
        freshGroups.map(group => ({ count: group.count, age: at - group.at }))
      );
    }
    paintDrafting(host, assistant);
    if (onFrame) onFrame();
    else if (followBottom) scrollBottom();
    else syncJumpBottom();
    if (paced && shown < target) schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(frame);
  };
  const refresh = () => {
    saveStoreSoon();
    schedule();
  };
  // 有些接口或中转站不走 reasoning_content，而是把思考直接写进正文开头的 <think>…</think>；这里把它剥出来，与 reasoning_content 一样归入折叠区。
  // 标签可能被分块切开：开头先攥着几个字符看清是不是标签，思考期间末尾留 7 个字符等结束标签
  const think = { mode: assistant.content ? "body" : "probe", held: "" };
  const ingest = text => {
    if (think.mode === "body") {
      assistant.content += text;
      return;
    }
    if (think.mode === "probe") {
      think.held += text;
      const lead = think.held.replace(/^\s+/, "");
      if (lead.startsWith("<think>")) {
        think.mode = "think";
        think.held = "";
        ingest(lead.slice(7));
        return;
      }
      if ("<think>".startsWith(lead)) return;
      think.mode = "body";
      assistant.content += think.held;
      think.held = "";
      return;
    }
    think.held += text;
    const end = think.held.indexOf("</think>");
    if (end >= 0) {
      assistant.reasoning = (assistant.reasoning || "") + think.held.slice(0, end);
      think.mode = "body";
      const rest = think.held.slice(end + 8).replace(/^\s+/, "");
      think.held = "";
      if (rest) assistant.content += rest;
      return;
    }
    const keep = Math.min(think.held.length, 7);
    assistant.reasoning = (assistant.reasoning || "") + think.held.slice(0, think.held.length - keep);
    think.held = think.held.slice(think.held.length - keep);
  };
  const flushThink = () => {
    if (!think.held) return;
    if (think.mode === "think") assistant.reasoning = (assistant.reasoning || "") + think.held;
    else assistant.content += think.held;
    think.held = "";
    think.mode = "body";
  };
  // 流被掐断（停止、补言改道）时这一段的帧循环到此为止：接下来的一轮另起一个，两个循环不能同时画一条消息
  try {
    await pump();
  } catch (error) {
    closed = true;
    throw error;
  }
  async function pump() {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      // 流到头了：最后一段没跟换行的 data: 也得处理，否则末尾几个字或最终的 usage 就丢了
      if (done && buffer) {
        lines.push(buffer);
        buffer = "";
      }
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          const text = normalizeContent(delta?.content),
            reasoning = normalizeContent(delta?.reasoning_content ?? delta?.reasoning);
          if (reasoning) {
            assistant.reasoning = (assistant.reasoning || "") + reasoning;
            refresh();
          }
          if (text) {
            ingest(text);
            refresh();
          }
          // Anthropic 的思考块（带签名）：这一轮带工具调用时要原样回传，记在消息上
          if (delta?.thinking_block?.signature) (assistant.thinkingBlocks ||= []).push(delta.thinking_block);
          if (Array.isArray(delta?.tool_calls)) {
            for (const call of delta.tool_calls) {
              const slot = ((assistant.toolCalls ||= [])[call.index ?? 0] ||= { id: "", name: "", arguments: "" });
              if (call.id) slot.id = call.id;
              if (call.function?.name) slot.name += call.function.name;
              if (call.function?.arguments) slot.arguments += call.function.arguments;
            }
            refresh();
          }
          if (json.usage) assistant.usage = json.usage;
        } catch {}
      }
      if (done) break;
    }
  }
  flushThink();
  // 流结束后把积压的字写完再返回，收尾和下一轮工具调用都等在这后面；标签页不可见时直接补齐
  while (paced && shown < assistant.content.length) {
    schedule();
    await new Promise(resolve => setTimeout(resolve, 16));
    if (document.hidden) shown = assistant.content.length;
  }
  closed = true; // 之后迟到的帧一律作废：后台标签页里 rAF 会攒到切回来才跑，那时收尾已把图表画好，再用 suppressViz 重绘会把它们打回占位
}
// 把尾段末尾最近写出的字按帧分组包进 .ink-fresh（用负 animation-delay 对齐各自的年龄，重绘也不会重放），并在最后一个字后放一支光标
function decorateTail(tail, groups) {
  if (tail.querySelector(".viz-pending")) return;
  const nodes = [];
  const walker = document.createTreeWalker(tail, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
  let node = nodes.pop();
  if (!node) return;
  const cursor = document.createElement("span");
  cursor.className = "ink-cursor";
  node.after(cursor);
  for (const group of groups) {
    let need = group.count;
    while (need > 0 && node) {
      const text = node.data,
        take = Math.min(need, text.length),
        span = document.createElement("span");
      span.className = "ink-fresh";
      span.style.animationDelay = `-${Math.round(group.age)}ms`;
      span.textContent = text.slice(text.length - take);
      node.data = text.slice(0, text.length - take);
      node.after(span);
      need -= take;
      if (!node.data) {
        node.remove();
        node = nodes.pop();
      }
    }
    if (!node) break;
  }
}
function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => part?.text || part?.content || "").join("");
  return "";
}
function extractContent(data) {
  return normalizeContent(data?.choices?.[0]?.message?.content);
}
function friendlyError(message) {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message))
    return apiBase === null
      ? "浏览器无法直连该接口，通常是接口未开放 CORS。请运行 start.cmd 或 VS Code 任务「言：启动模型桥接」后重试。"
      : "本机桥接已停止或无法访问。请重新运行 start.cmd 或 VS Code 任务「言：启动模型桥接」，并保持终端窗口开启。";
  return String(message).slice(0, 500);
}
function scrollBottom() {
  const el = $("#chatScroll");
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 1) {
    autoScrolling = false;
    return;
  }
  autoScrolling = true;
  el.scrollTop = el.scrollHeight;
  requestAnimationFrame(() => {
    autoScrolling = false;
  });
}

  // ---- 17-actions-settings.js ----
// 言 · 消息动作、设置页、导入导出
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 生成中只拦会改动对话的动作（编辑、重答、续写、重试、切版本）；复制与就整条回复开旁注不碍事，下面还在写时上面照样可以注
const ACTIONS_WHILE_RUNNING = new Set(["copy", "note"]);
async function handleMessageAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || (conversationRunning() && !ACTIONS_WHILE_RUNNING.has(button.dataset.action))) return;
  const c = currentConversation();
  if (!c) return;
  const id = button.closest("[data-message]")?.dataset.message,
    index = c.messages.findIndex(m => m.id === id);
  if (index < 0) return;
  const message = c.messages[index];
  if (button.dataset.action === "copy") {
    await copyText(message.content);
    return toast("已复制");
  }
  if (button.dataset.action === "note") return openSideIndex(message.id);
  if (button.dataset.action === "branch-prev" || button.dataset.action === "branch-next")
    return switchBranch(c, index, button.dataset.action === "branch-prev" ? -1 : 1);
  if (button.dataset.action === "cancel-edit") {
    editingMessageId = null;
    renderConversation(false);
    return;
  }
  if (button.dataset.action === "edit") {
    if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
    editingMessageId = message.id;
    renderConversation(false);
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-message="${message.id}"] .message-edit-input`);
      growEditor(input);
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
    return;
  }
  if (button.dataset.action === "save-edit")
    return saveEditedMessage(c, index, button.closest("[data-message]").querySelector(".message-edit-input").value);
  if (button.dataset.action === "resume") {
    if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
    let profile = activeProfile();
    if (!profile) return openSettings("models");
    if (profile.tools !== false && apiBase === null) {
      await ensureLocalBridge();
      profile = activeProfile() || profile;
    }
    if (parseTokenLimit(profile.quota) === null) return toast("请先为该模型设置用量上限");
    if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
    if (!(await ensureWorkReady(c))) return;
    message.status = "streaming";
    message.error = "";
    delete message.interruptedAt;
    saveStore();
    renderConversation(false);
    await streamReply(c, message, profile, { resume: true });
    return;
  }
  if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
  const userIndex = [...c.messages.slice(0, index)].map(m => m.role).lastIndexOf("user");
  if (userIndex < 0) return;
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (parseTokenLimit(profile.quota) === null) return toast("请先为该模型设置用量上限");
  if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
  if (!(await ensureWorkReady(c))) return;
  forkTail(c, userIndex + 1);
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  c.messages.push(assistant);
  saveStore();
  renderConversation(true);
  await streamReply(c, assistant, profile);
}
/** @param {Conversation} conversation */
async function saveEditedMessage(conversation, index, value) {
  const text = value.trim();
  if (!text) return toast("尚未落笔");
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (parseTokenLimit(profile.quota) === null) return toast("请先为该模型设置用量上限");
  if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
  const old = conversation.messages[index];
  if (text === old.content) {
    editingMessageId = null;
    renderConversation(false);
    return;
  }
  if (!(await ensureWorkReady(conversation))) return;
  // 旧问题连同它后面的回答整段留作一个版本；新问题沿用原来的附件与引文
  forkTail(conversation, index);
  const message = { ...old, id: uid(), content: text, timestamp: now() };
  conversation.messages.push(message);
  conversation.updatedAt = now();
  if (index === 0 && conversation.titleAuto !== false) {
    conversation.title = titleFrom(text, message.attachments || []);
    conversation.titled = false;
  }
  editingMessageId = null;
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  conversation.messages.push(assistant);
  saveStore();
  render(true);
  await streamReply(conversation, assistant, profile);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

function openSettings(tab = settingsTab) {
  persistDraft();
  rememberScrollPosition();
  settingsTab = tab;
  showNow($("#settingsModal"));
  renderSettings();
}
function closeSettings() {
  hideWithFade($("#settingsModal"));
  render();
}
function renderSettings() {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === settingsTab));
  const host = $("#settingsContent");
  const tabChanged = host.dataset.tab !== settingsTab;
  host.dataset.tab = settingsTab;
  if (settingsTab === "general") host.innerHTML = generalSettingsHtml();
  if (settingsTab === "appearance") host.innerHTML = appearanceSettingsHtml();
  if (settingsTab === "models") host.innerHTML = modelsSettingsHtml();
  if (settingsTab === "tools") host.innerHTML = toolsSettingsHtml();
  if (settingsTab === "memory") host.innerHTML = memorySettingsHtml();
  if (settingsTab === "about") host.innerHTML = aboutSettingsHtml();
  bindSettingsEvents();
  bindMemoryEvents();
  if (tabChanged) {
    host.classList.remove("tab-fade");
    void host.offsetWidth;
    host.classList.add("tab-fade");
  }
}
function generalSettingsHtml() {
  return `<h2>通用</h2><p class="settings-lead">所有数据仅存于此设备的浏览器。</p><div class="setting-row"><div class="setting-copy"><strong>显示名称</strong><small>侧栏中显示的称呼</small></div><input id="settingName" class="field" value="${escapeHtml(store.settings.name)}"></div><div class="setting-row"><div class="setting-copy"><strong>自动拟题</strong><small>首次问答后由模型拟题，略耗额度；手动修改过的标题不再覆盖</small></div><div class="segmented"><button data-setting="autoTitle" data-value="true" class="${store.settings.autoTitle ? "active" : ""}">开</button><button data-setting="autoTitle" data-value="false" class="${store.settings.autoTitle ? "" : "active"}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>自动压缩上下文</strong><small>一答收尾后，若下一问估算送出的 token 超过此数，便请模型把前文压成摘要；留空为不自动。右下角的计数亦可随时手动压缩</small></div><div class="setting-actions"><label class="setting-inline">超过<input id="settingCompactAt" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不自动" value="${Number(store.settings.compactAt) || ""}"></label></div></div>${
    apiBase !== null
      ? `<div class="setting-row"><div class="setting-copy"><strong>卷宗目录</strong><small>卷宗在本机的位置；未绑目录的对话里，模型写出的文件与草稿皆落于此。留空则用默认 ${escapeHtml(bootstrap.work?.archive || "")}</small></div><div class="setting-actions setting-archive"><input id="settingArchive" class="field" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(bootstrap.work?.archive || "")}" value="${escapeHtml(store.settings.archiveDir || "")}"><button id="settingArchivePick" class="outline-btn" type="button">选择…</button></div></div>`
      : ""
  }<div class="setting-row"><div class="setting-copy"><strong>本机数据</strong><small>${store.conversations.length} 段对话 · ${store.library.length} 件卷宗 · 配置 ${storageSize()} · 附件原件 ${formatFileSize(usedAttachmentBytes())}</small></div><div class="setting-actions"><label class="check"><input id="exportFiles" type="checkbox">含附件原件</label><button id="exportData" class="outline-btn">导出备份</button><button id="importData" class="outline-btn">导入备份</button></div></div><div class="setting-row"><div class="setting-copy"><strong>清空所有对话</strong><small>模型配置、个性化与卷宗将保留</small></div><button id="clearAll" class="danger-btn">清空对话</button></div>`;
}
// 工具：沙箱、三档指令权限、可及范围、卷宗可读、轮次上限——模型能动手的边界都在这一栏
function toolsSettingsHtml() {
  const policy = normalizeCommandPolicy(store.settings.commandPolicyDefault);
  return `<h2>工具</h2><p class="settings-lead">模型能做什么、做到哪一步问一声，都在这里定。</p><div class="setting-row"><div class="setting-copy"><strong>沙箱</strong><small>言与行的指令与文件工具都套着一层：改动不出工作目录、机密文件不碰、动系统与直接外联的指令拒绝、指令看不到机密环境变量；查看则可及整台机器，电脑检查才走得通。在桥接那头守，模型绕不过。这是静态筛查，不是进程隔离。非要让模型改目录之外的东西时再关</small></div><div class="segmented"><button data-setting="sandbox" data-value="true" class="${store.settings.sandbox !== false ? "active" : ""}">开</button><button data-setting="sandbox" data-value="false" class="${store.settings.sandbox === false ? "active" : ""}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>指令权限</strong><small>新对话默认档位：问而后行逐条请示，明确只读的径直跑；审而后行由桥接代审，常规改动与整机查看放行、明确高风险当场回绝，不来打扰；径行不再审查。三档都不另调模型，沙箱开着时那道界仍在</small></div><div class="segmented"><button data-setting="commandPolicyDefault" data-value="ask" class="${policy === "ask" ? "active" : ""}">问而后行</button><button data-setting="commandPolicyDefault" data-value="review" class="${policy === "review" ? "active" : ""}">审而后行</button><button data-setting="commandPolicyDefault" data-value="auto" class="${policy === "auto" ? "active" : ""}">径行</button></div></div><div class="setting-row"><div class="setting-copy"><strong>文件工具可及范围</strong><small>没套沙箱时，模型读写文件、列目录与搜索能否越出工作目录或卷宗：「全盘」可指向任何绝对路径，「目录内」一律拒绝越出；指令不受此限。沙箱开着时一律目录内</small></div><div class="segmented"><button data-setting="toolReach" data-value="anywhere" class="${store.settings.toolReach !== "inside" ? "active" : ""}">全盘</button><button data-setting="toolReach" data-value="inside" class="${store.settings.toolReach === "inside" ? "active" : ""}">目录内</button></div></div><div class="setting-row"><div class="setting-copy"><strong>卷宗对模型可读</strong><small>开启后，模型可在任何对话中翻阅卷宗里的文档（PDF、Office、文本），用到时才取回并在本机提取正文</small></div><div class="segmented"><button data-setting="archiveRead" data-value="true" class="${store.settings.archiveRead !== false ? "active" : ""}">开</button><button data-setting="archiveRead" data-value="false" class="${store.settings.archiveRead === false ? "active" : ""}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>工具轮次上限</strong><small>一次回答里模型最多调几轮工具，到顶后收回工具请它收尾；帮手另计，大任务可放宽</small></div><div class="setting-actions"><label class="setting-inline">一答<input id="settingToolRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" value="${toolRoundLimit()}"></label><label class="setting-inline">帮手<input id="settingSubRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" value="${subRoundLimit()}"></label></div></div>`;
}
function appearanceSettingsHtml() {
  const s = store.settings;
  return `<h2>个性化</h2><p class="settings-lead">清简为骨，纸墨为意。</p>${segmentRow(
    "主题",
    "随系统或固定明暗",
    "theme",
    [
      ["light", "亮"],
      ["dark", "暗"],
      ["system", "系统"]
    ],
    s.theme
  )}${segmentRow(
    "界面动效",
    "落墨与天光、印章呼吸与开合过渡",
    "inkMotion",
    [
      ["on", "开"],
      ["system", "随系统"],
      ["off", "关"]
    ],
    s.inkMotion || "on"
  )}${fontRow(s.font)}${segmentRow(
    "阅读宽度",
    "长文的行宽",
    "width",
    [
      [680, "窄"],
      [760, "适中"],
      [860, "宽"]
    ],
    s.width
  )}<div class="setting-row"><div class="setting-copy"><strong>印色</strong><small>界面中的点睛之色</small></div><div class="segmented">${["#9b5540", "#536d62", "#5c6386", "#75644f"].map(v => `<button data-setting="accent" data-value="${v}" class="${s.accent === v ? "active" : ""}" style="color:${v}">●</button>`).join("")}</div></div>`;
}
// 关于：身份、边界、键与手势、开源致谢。随项目本地分发的库与许可见 vendor/
const CREDITS = [
  ["marked", "18.0.13", "MIT"],
  ["DOMPurify", "3.4.15", "Apache-2.0"],
  ["highlight.js", "11.12.0", "BSD-3-Clause"],
  ["KaTeX", "0.18.7", "MIT"],
  ["Mermaid", "11.17.2", "MIT"],
  ["Apache ECharts", "5.6.1", "Apache-2.0"],
  ["PDF.js", "3.11.174", "Apache-2.0"]
];
const kbd = keys =>
  keys
    .split("+")
    .map(key => `<span class="kbd">${escapeHtml(key)}</span>`)
    .join(" + ");
function aboutSettingsHtml() {
  const version = bootstrap.version || APP_VERSION,
    bridged = apiBase !== null;
  const rows = list => `<dl class="about-list">${list.map(([term, detail]) => `<dt>${term}</dt><dd>${detail}</dd>`).join("")}</dl>`;
  return (
    `<div class="about-head"><h2>言</h2><span class="about-version">v${escapeHtml(version)} · ${bridged ? "本机桥接" : "浏览器直连"}</span></div><p class="about-ethos">清简为骨，纸墨为意。<br>长问慢答，尽付纸墨；言毕，即行。</p>` +
    `<div class="about-section"><h3>数据与边界</h3>${rows([
      ["存放", "对话、模型配置与草稿存于此浏览器的 IndexedDB，localStorage 只留小型启动镜像；附件原件另存 IndexedDB，不经任何云端"],
      ["桥接", "本机进程仅监听 127.0.0.1，负责转发模型请求、联网检索与读取网页；拒绝访问本机与内网地址"],
      ["执事", "指令在你的机器上、以你的权限执行，只读指令直接执行，其余默认逐条确认；文件读写限定在工作目录之内"],
      [
        "沙箱",
        "指令与文件工具默认套着：路径不出目录、机密文件不碰、动系统与直接外联的指令拒绝、机密环境变量不给指令，在桥接那头守。是静态筛查，不是进程隔离——脚本里的代码仍以你的权限运行；设置 → 工具可关"
      ],
      ["记忆", "模型在对谈中记下的一句句话，只存于本机；何时记、何时看由它判断，不随每次请求发送，可在「记忆」页查改或关闭"],
      ["备份", "导出的备份不含 API Key；可选择是否带上附件原件"]
    ])}</div>` +
    `<div class="about-section"><h3>键与操作</h3>${rows([
      [kbd("Enter"), "发送；" + kbd("Shift+Enter") + " 换行"],
      [kbd("Esc"), "关闭弹层、取消编辑、去掉引文、退出全屏"],
      ["划选正文", "浮出「引用 · 旁注」：引用随下一问送出；旁注于右侧另开一线，读得到正文，却不入正文"],
      ["拖入 · 粘贴", "文件拖入页面或粘贴图片，即置于案上；在卷宗页拖入则收入卷宗"],
      ["双击侧栏标题", "重命名对话；亦可直接修改页面上方的标题"],
      ["消息旁 ‹ ›", "在同一位置的不同版本之间切换"]
    ])}</div>` +
    `<div class="about-section"><h3>开源致谢</h3><ul class="about-credits">${CREDITS.map(([name, ver, license]) => `<li><span>${escapeHtml(name)}</span><small>${escapeHtml(ver)} · ${escapeHtml(license)}</small></li>`).join("")}</ul><p class="about-note">以上库全部随项目本地分发，不加载任何在线资源；许可全文见 vendor 目录。运行环境仅需 Node.js 18 或更高版本，无需安装依赖。</p></div>`
  );
}
// 字体一行：每个钮用自己那种字写自己的名字，一眼看出气质
function fontRow(active = "mixed") {
  const items = [
    ["mixed", "混排"],
    ["sans", "黑体"],
    ["serif", "宋体"],
    ["kai", "楷体"],
    ["fangsong", "仿宋"]
  ];
  return `<div class="setting-row"><div class="setting-copy"><strong>字体</strong><small>回复与标题用的字；楷体与仿宋取自系统，没有的机器落回宋体</small></div><div class="segmented font-segmented">${items.map(([v, label]) => `<button data-setting="font" data-value="${v}" class="${(active || "mixed") === v ? "active" : ""}" style="font-family:${escapeHtml(FONT_STACKS[v].title)}">${label}</button>`).join("")}</div></div>`;
}
function segmentRow(title, desc, key, items, active) {
  return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><small>${desc}</small></div><div class="segmented">${items.map(([v, label]) => `<button data-setting="${key}" data-value="${v}" class="${String(active) === String(v) ? "active" : ""}">${label}</button>`).join("")}</div></div>`;
}
function modelsSettingsHtml() {
  const transport =
    apiBase !== null
      ? `本机桥接已接通${apiBase ? "（VS Code 预览）" : ""}，联网与转发均可用。`
      : "当前由浏览器直连模型，联网检索不可用；本机桥接启动后将自动接通。";
  return `<h2>模型</h2><p class="settings-lead">任何 OpenAI 兼容接口均可接入，API Key 仅存于当前浏览器。${transport}</p>${bootstrap.configError ? `<div class="server-notice">${escapeHtml(bootstrap.configError)}</div>` : ""}<div id="profileList">${profiles().map(profileCardHtml).join("")}</div><button id="addProfile" class="outline-btn profile-add">＋ 接入模型</button>`;
}
function quotaParts(value) {
  const match = String(value ?? "")
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*([kme])?$/);
  return match ? { amount: match[1], unit: match[2] || "k" } : { amount: "", unit: "k" };
}
/** @param {Profile} p */
function profileCardHtml(p) {
  const locked = p.source === "server",
    invalidQuota = parseTokenLimit(p.quota) === null,
    quota = quotaParts(p.quota),
    models = Array.isArray(p.modelList) ? p.modelList : [],
    listed = models.includes(p.model);
  const modelField = locked
    ? `<input class="field wide" value="${escapeHtml(p.model)}" disabled>`
    : `<div class="field-row">${models.length ? `<select class="field wide select" data-model-select>${models.map(m => `<option value="${escapeHtml(m)}"${m === p.model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}<option value="__custom__"${listed ? "" : " selected"}>手动输入…</option></select>` : ""}<input class="field wide${models.length && listed ? " hidden" : ""}" data-field="model" value="${escapeHtml(p.model)}" placeholder="如 gpt-4o-mini"><button class="outline-btn" data-profile-action="models" title="从接口的 /models 获取可用模型">${models.length ? "刷新" : "获取列表"}</button></div>`;
  const quotaField = `<div class="field-row"><input type="number" min="0" step="any" class="field wide" data-quota-amount value="${escapeHtml(quota.amount)}" placeholder="如 100" ${invalidQuota ? `aria-invalid="true"` : ""}><select class="field select" data-quota-unit>${[
    ["k", "千 (k)"],
    ["m", "百万 (m)"],
    ["e", "亿 (e)"]
  ]
    .map(([v, label]) => `<option value="${v}"${quota.unit === v ? " selected" : ""}>${label}</option>`)
    .join("")}</select></div>`;
  return `<div class="profile-card" data-profile-card="${escapeHtml(p.id)}"><div class="profile-head"><strong>${escapeHtml(p.name)}</strong>${locked ? `<span class="profile-badge">服务端</span>` : ""}${p.id === store.settings.activeProfileId ? `<span class="profile-badge">默认</span>` : ""}</div><div class="profile-grid"><label>显示名称<input class="field wide" data-field="name" value="${escapeHtml(p.name)}" ${locked ? "disabled" : ""}></label><label>用量限制${quotaField}<small>必填；改动后重新计量</small></label><label>接口<div class="segmented"><button data-choice-field="api" data-value="openai" class="${anthropicLike(p) ? "" : "active"}" ${locked ? "disabled" : ""}>OpenAI 兼容</button><button data-choice-field="api" data-value="anthropic" class="${anthropicLike(p) ? "active" : ""}" ${locked ? "disabled" : ""}>Anthropic</button></div><small>${anthropicLike(p) ? "Messages API；思考档位换算成思考预算" : "chat/completions；大多数服务与中转站"}</small></label><label class="profile-full">Base URL<input class="field wide" data-field="baseUrl" value="${escapeHtml(p.baseUrl || "")}" placeholder="${anthropicLike(p) ? "https://api.anthropic.com" : "https://example.com/v1"}" ${locked ? "disabled" : ""}></label>${locked ? "" : `<label class="profile-full">API Key<input type="password" class="field wide" data-field="apiKey" value="${escapeHtml(p.apiKey || "")}" placeholder="sk-…" autocomplete="off"></label>`}<label class="profile-full">模型${modelField}${locked ? "" : `<small>填写 Base URL 与 API Key 后可获取列表，亦可手动输入</small>`}</label></div><details class="profile-advanced"${advancedOpen.has(p.id) ? " open" : ""}><summary><span class="advanced-title">高级配置</span><small>${[p.tools === false ? "本机工具关" : "", modelSearchEnabled(p) ? "接口原生联网开" : "", p.systemPrompt ? "已设 system prompt" : ""].filter(Boolean).join(" · ")}</small></summary><div class="profile-grid"><label>本机联网与文档工具<div class="segmented"><button data-toggle-field="tools" data-value="true" class="${p.tools !== false ? "active" : ""}">开</button><button data-toggle-field="tools" data-value="false" class="${p.tools === false ? "active" : ""}">关</button></div><small>由本机桥接执行检索、网页读取与文档翻阅；需接口支持 function calling</small></label><label>接口原生联网（实验）<div class="segmented"><button data-toggle-field="enableSearch" data-value="true" class="${modelSearchEnabled(p) ? "active" : ""}">开</button><button data-toggle-field="enableSearch" data-value="false" class="${modelSearchEnabled(p) ? "" : "active"}">关</button></div><small>仅当接口文档明确支持时开启，仅附加 <code>enable_search: true</code>；普通 OpenAI 兼容服务通常会忽略该字段，不能替代本机联网</small></label><label><code>temperature</code><input type="number" min="0" max="2" step="0.1" class="field wide" data-field="temperature" value="${Number(p.temperature ?? 0.7)}"><small>0–2，默认 0.7；数值越高越发散</small></label><label><code>max_tokens</code><input type="number" min="16" max="65536" class="field wide" data-field="maxTokens" value="${Number(p.maxTokens || DEFAULT_MAX_TOKENS)}"><small>单次回复的输出上限，默认 ${DEFAULT_MAX_TOKENS}</small></label><label>上下文窗口<input type="number" min="1000" step="1000" class="field wide" data-field="contextWindow" value="${Number(p.contextWindow) || ""}" placeholder="如 128000"><small>此模型一次可读的 token 数；填写后右下角按比例计量，逾七成半即提醒</small></label><label>思考档位<input class="field wide" data-field="reasoningLevels" value="${escapeHtml(p.reasoningLevels || "")}" placeholder="low, medium, high"><small>此模型所认的 <code>reasoning_effort</code> 档位，逗号分隔（minimal、low、medium、high、xhigh、max）；选定模型时会自动探测并填在这里（none 是不认）；留空按 low / medium / high / max 四档列，接口拒绝某档时也会记下</small></label><label class="profile-full"><code>system prompt</code><textarea class="field wide field-area" data-field="systemPrompt" placeholder="可选。设定模型的身份与应答方式">${escapeHtml(p.systemPrompt || "")}</textarea></label></div></details><div class="profile-actions"><button class="outline-btn" data-profile-action="test">测试连接</button>${p.id !== store.settings.activeProfileId ? `<button class="outline-btn" data-profile-action="default">设为默认</button>` : ""}${locked ? "" : `<button class="danger-btn" data-profile-action="delete">删除</button>`}<span class="profile-status">${invalidQuota ? "请先设定用量上限" : ""}</span></div></div>`;
}
function storageSize() {
  const bytes = new Blob([JSON.stringify(store)]).size;
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
function bindSettingsEvents() {
  $("#settingName")?.addEventListener("input", e => {
    store.settings.name = e.target.value || "访客";
    saveStoreSoon();
  });
  for (const [id, key, fallback] of [
    ["#settingToolRounds", "toolRounds", DEFAULT_TOOL_ROUNDS],
    ["#settingSubRounds", "subRounds", DEFAULT_SUB_ROUNDS]
  ])
    $(id)?.addEventListener("input", e => {
      const value = Math.floor(Number(e.target.value));
      store.settings[key] = value >= 1 ? Math.min(value, 500) : fallback;
      saveStoreSoon();
    });
  // 卷宗目录：改完立刻按新目录重新翻卷宗；路径不合法（相对路径、整个磁盘）桥接会拒绝，提示后仍保留输入以便改正
  const archiveInput = $("#settingArchive");
  let archiveTimer = null;
  const commitArchive = value => {
    clearTimeout(archiveTimer);
    archiveTimer = setTimeout(async () => {
      const next = String(value || "").trim();
      if (next === (store.settings.archiveDir || "")) return;
      if (next)
        try {
          const prepared = await bridge("/api/work/prepare", { workdir: next }, AbortSignal.timeout(8000));
          store.settings.archiveDir = prepared.workdir;
          if (archiveInput && document.activeElement !== archiveInput) archiveInput.value = prepared.workdir;
        } catch (error) {
          return toast(`卷宗目录不可用：${String(error.message || error).slice(0, 80)}`);
        }
      else delete store.settings.archiveDir;
      saveStore();
      archiveEntries = null;
      await refreshArchive();
      toast(next ? `卷宗已改到 ${pathTail(store.settings.archiveDir)}` : "卷宗已恢复默认位置");
    }, 500);
  };
  archiveInput?.addEventListener("input", e => commitArchive(e.target.value));
  $("#settingArchivePick")?.addEventListener("click", async () => {
    const button = $("#settingArchivePick");
    button.disabled = true;
    try {
      const data = await bridge("/api/work/pick", { current: archiveInput.value.trim() || archiveDir() }, AbortSignal.timeout(300000));
      if (data.path) {
        archiveInput.value = data.path;
        commitArchive(data.path);
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      button.disabled = false;
    }
  });
  $("#settingCompactAt")?.addEventListener("input", e => {
    const value = Math.floor(Number(String(e.target.value).replace(/[^\d]/g, "")));
    store.settings.compactAt = value >= 1000 ? value : 0;
    saveStoreSoon();
    updateContextGauge();
  });
  $("#exportData")?.addEventListener("click", () => exportData($("#exportFiles")?.checked));
  $("#importData")?.addEventListener("click", () => $("#importInput").click());
  $("#importInput").onchange = async e => {
    const [file] = e.target.files;
    e.target.value = "";
    if (file) await importData(file);
  };
  $("#clearAll")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: "清空全部对话？",
        body: `${store.conversations.length} 段对话将被移除，无法撤销；模型配置、个性化与卷宗将保留。`,
        ok: "清空"
      }))
    )
      return;
    stopAllGenerations();
    const conversationIds = new Set(store.conversations.map(c => c.id)),
      draftFiles = Object.entries(store.drafts || {})
        .filter(([key]) => conversationIds.has(key))
        .flatMap(([, draft]) => (Array.isArray(draft?.attachments) ? draft.attachments.map(file => file.id) : []));
    const currentDraftFiles = currentId ? pendingAttachments.map(file => file.id) : [];
    void deleteAttachments([...attachmentIds(store.conversations.flatMap(allMessages)), ...draftFiles, ...currentDraftFiles]);
    store.conversations = [];
    store.drafts = store.drafts?.[NEW_DRAFT_ID] ? { [NEW_DRAFT_ID]: store.drafts[NEW_DRAFT_ID] } : {};
    scrollPositions.clear();
    currentId = null;
    pendingAttachments = [];
    saveStore();
    render();
    renderSettings();
    toast("所有对话已清空");
  });
  document.querySelectorAll("[data-setting]").forEach(
    button =>
      (button.onclick = () => {
        const key = button.dataset.setting,
          value = button.dataset.value;
        if (key === "theme") {
          switchTheme(value, button);
          renderSettings();
          return;
        }
        if (key === "memoryEnabled") {
          store.memory.enabled = value === "true";
          saveStore();
          renderSettings();
          return;
        }
        store.settings[key] =
          key === "width" ? Number(value) : ["autoTitle", "archiveRead", "sandbox"].includes(key) ? value === "true" : value;
        saveStore();
        applyAppearance();
        renderSettings();
      })
  );
  $("#addProfile")?.addEventListener("click", () => {
    /** @type {Profile} */
    const p = {
      id: uid(),
      source: "custom",
      name: "新模型",
      model: "",
      baseUrl: "",
      apiKey: "",
      temperature: 0.7,
      maxTokens: DEFAULT_MAX_TOKENS,
      quota: "",
      usedTokens: 0,
      systemPrompt: ""
    };
    store.profiles.push(p);
    store.settings.activeProfileId ||= p.id;
    saveStore();
    renderSettings();
    setTimeout(() => document.querySelector(`[data-profile-card="${p.id}"] [data-field="name"]`)?.focus(), 0);
  });
  document.querySelectorAll("[data-profile-card]").forEach(card => {
    const p = profiles().find(item => item.id === card.dataset.profileCard);
    if (!p) return;
    card
      .querySelector('[data-profile-action="test"]')
      ?.insertAdjacentHTML("afterend", '<button class="outline-btn" data-profile-action="search">测试联网</button>');
    card.querySelectorAll("[data-field]").forEach(input =>
      input.addEventListener("input", e => {
        const field = e.target.dataset.field;
        if (p.source === "server" && !["temperature", "maxTokens", "systemPrompt", "reasoningLevels", "contextWindow"].includes(field))
          return;
        p[field] = ["temperature", "maxTokens", "usedTokens", "contextWindow"].includes(field) ? Number(e.target.value) : e.target.value;
        if (field === "contextWindow") updateContextGauge();
        // 亲手填的档位就是定论，不再探；清空了下次选模型再探
        if (field === "reasoningLevels") p.reasoningProbed = e.target.value.trim() ? `manual|${reasoningProbeKey(p)}` : "";
        persistServerProfile(p);
        saveStoreSoon();
      })
    );
    // 手动输入的模型 ID：改定了（失焦或回车）探一下它认哪几档
    card.querySelector('[data-field="model"]')?.addEventListener("change", () => void reportReasoningProbe(p, card));
    const amount = card.querySelector("[data-quota-amount]"),
      unit = card.querySelector("[data-quota-unit]");
    const applyQuota = () => {
      const value = amount.value.trim() ? `${amount.value.trim()}${unit.value}` : "",
        valid = parseTokenLimit(value) !== null;
      if (valid) amount.removeAttribute("aria-invalid");
      else amount.setAttribute("aria-invalid", "true");
      card.querySelector(".profile-status").textContent = valid ? "" : "请填写大于 0 的数值";
      if (!valid) return;
      if (p.quota !== value) {
        p.quota = value;
        p.usedTokens = 0;
        persistServerProfile(p);
        saveStoreSoon();
        if (p.id === store.settings.activeProfileId) renderQuota();
      }
    };
    amount.addEventListener("input", applyQuota);
    unit.addEventListener("change", applyQuota);
    card.querySelector("[data-model-select]")?.addEventListener("change", e => {
      const input = card.querySelector('[data-field="model"]');
      if (e.target.value === "__custom__") {
        input.classList.remove("hidden");
        input.focus();
        return;
      }
      input.classList.add("hidden");
      input.value = e.target.value;
      p.model = e.target.value;
      saveStoreSoon();
      renderHeader();
      void reportReasoningProbe(p, card);
    });
    card.querySelectorAll("[data-toggle-field]").forEach(
      button =>
        (button.onclick = () => {
          p[button.dataset.toggleField] = button.dataset.value === "true";
          saveStore();
          renderSettings();
        })
    );
    card.querySelectorAll("[data-choice-field]").forEach(
      button =>
        (button.onclick = () => {
          if (button.disabled) return;
          p[button.dataset.choiceField] = button.dataset.value;
          saveStore();
          renderSettings();
        })
    );
    card.querySelector(".profile-advanced")?.addEventListener("toggle", e => {
      if (e.target.open) advancedOpen.add(p.id);
      else advancedOpen.delete(p.id);
    });
    card
      .querySelectorAll("[data-profile-action]")
      .forEach(button => (button.onclick = () => handleProfileAction(p, button.dataset.profileAction, card)));
  });
}
// 选定模型后探它认哪几档，结果写在卡片的状态行上，高级配置里的「思考档位」也跟着填；探不成不吭声（撞了错再学）。
// 亲手填过档位的不探（测试连接也不），状态行照实写它填的。同一张卡片连着探了两次（模型改了两回），只有最后一次能动状态行——
// 先前那次迟到回来是作废的，不能把后一次已经写上的结果抹掉
const probeSerial = new Map();
/** @param {Profile} profile */
async function reportReasoningProbe(profile, card, force = false) {
  if (force && !reasoningManual(profile)) profile.reasoningProbed = "";
  if (!profile.model) return;
  const status = () => document.querySelector(`[data-profile-card="${profile.id}"] .profile-status`);
  // 状态行上此前的话留着（「可用 · 4 ms」），但上一回探到的档位不留——刷新列表探了一次、再从下拉里选一个又探一次，不能越接越长
  const before = (status()?.textContent || "")
    .split(" · ")
    .filter(part => !/^(探测)?思考档位/.test(part))
    .join(" · ");
  if (reasoningProbed(profile)) {
    if (force && status()) {
      const levels = profileReasoningLevels(profile);
      status().textContent = `${before ? `${before} · ` : ""}思考档位 ${levels.length ? levels.map(reasoningLabel).join(" / ") : "此模型不认"}${reasoningManual(profile) ? "（手填）" : ""}`;
    }
    return;
  }
  const serial = (probeSerial.get(profile.id) || 0) + 1;
  probeSerial.set(profile.id, serial);
  if (status()) status().textContent = `${before ? `${before} · ` : ""}探测思考档位…`;
  const levels = await probeReasoningLevels(profile);
  const el = status();
  if (!el || probeSerial.get(profile.id) !== serial) return;
  if (levels === null) el.textContent = before;
  else {
    el.textContent = `${before ? `${before} · ` : ""}思考档位 ${levels.length ? levels.map(reasoningLabel).join(" / ") : "此模型不认"}`;
    const field = document.querySelector(`[data-profile-card="${profile.id}"] [data-field="reasoningLevels"]`);
    if (field) field.value = profile.reasoningLevels || "";
    renderModelTriggers();
  }
}
/** @param {Profile} profile */
async function handleProfileAction(profile, action, card) {
  if (action === "default") {
    selectProfile(profile.id, false);
    renderSettings();
    renderHeader();
    return;
  }
  if (action === "delete") {
    store.profiles = store.profiles.filter(p => p.id !== profile.id);
    if (store.settings.activeProfileId === profile.id) store.settings.activeProfileId = profiles().find(p => p.id !== profile.id)?.id || "";
    saveStore();
    renderSettings();
    renderHeader();
    return;
  }
  if (action === "models") {
    const status = card.querySelector(".profile-status");
    status.textContent = "获取中…";
    try {
      const models = await fetchModelList(profile);
      if (!models.length) throw Error("接口未返回模型列表，请手动输入模型 ID");
      profile.modelList = models;
      if (!models.includes(profile.model)) profile.model = models[0];
      saveStore();
      renderSettings();
      renderHeader();
      card = document.querySelector(`[data-profile-card="${profile.id}"]`);
      if (card) card.querySelector(".profile-status").textContent = `已获取 ${models.length} 个模型`;
      void reportReasoningProbe(profile, card);
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
    return;
  }
  if (action === "search") {
    let status = card.querySelector(".profile-status");
    status.textContent = "检索中…";
    try {
      if (apiBase === null && !(await ensureLocalBridge()))
        throw Error("未连接本机桥接；请先运行 start.cmd 或 VS Code 任务「言：启动模型桥接」");
      card = document.querySelector(`[data-profile-card="${profile.id}"]`) || card;
      status = card.querySelector(".profile-status");
      status.textContent = "检索中…";
      const data = await bridge("/api/search", { query: "OpenAI", count: 1 }, AbortSignal.timeout(20000));
      status.textContent = data.results?.length ? `本机联网可用 · ${data.results.length} 条结果` : "搜索服务已连接，但本次未返回结果";
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
    return;
  }
  if (action === "test") {
    let status = card.querySelector(".profile-status");
    status.textContent = "连接中…";
    try {
      if (apiBase === null) await ensureLocalBridge();
      card = document.querySelector(`[data-profile-card="${profile.id}"]`) || card;
      status = card.querySelector(".profile-status");
      status.textContent = "连接中…";
      const started = performance.now();
      const response =
        apiBase !== null
          ? await fetch(`${apiBase}/api/test`, {
              method: "POST",
              headers: bridgeHeaders(profile),
              body: JSON.stringify({ profile: profileForRequest(profile) })
            })
          : await fetch(directModelsRequest(profile).url, { headers: directModelsRequest(profile).headers });
      const type = response.headers.get("content-type") || "";
      const data = type.includes("application/json") ? await response.json() : {};
      if (!response.ok) throw Error(data.error || data.message || `连接失败（${response.status}）`);
      status.textContent = `可用 · ${Math.round(performance.now() - started)} ms`;
      // 测试连接是亲手要的一次核对：档位也重探一遍
      void reportReasoningProbe(profile, card, true);
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
  }
}
/** @param {Profile} profile */
async function fetchModelList(profile) {
  if (!String(profile.baseUrl || "").trim()) throw Error("请先填写 Base URL");
  if (apiBase === null) await ensureLocalBridge();
  let response, data;
  if (apiBase !== null) {
    response = await fetch(`${apiBase}/api/models`, {
      method: "POST",
      headers: bridgeHeaders(profile),
      body: JSON.stringify({ profile: profileForRequest(profile) })
    });
    data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || `请求失败（${response.status}）`);
    return [...new Set(data.models || [])].sort();
  }
  response = await fetch(directModelsRequest(profile).url, { headers: directModelsRequest(profile).headers });
  data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error?.message || data.message || `请求失败（${response.status}）`);
  return [
    ...new Set((Array.isArray(data.data) ? data.data : []).map(item => (typeof item === "string" ? item : item?.id)).filter(Boolean))
  ].sort();
}
async function exportData(includeFiles) {
  /** @type {Store & { exportedAt: string, attachments?: Attachment[] }} 备份：去掉 API Key，可选带上附件原件 */
  const safeStore = { ...store, profiles: store.profiles.map(profile => ({ ...profile, apiKey: "" })), exportedAt: now() };
  if (includeFiles) {
    try {
      safeStore.attachments = await fileStoreRequest("readonly", db => db.getAll());
    } catch {
      toast("附件原件读取失败，本次备份不含附件原件");
    }
  }
  const blob = new Blob([JSON.stringify(safeStore, null, includeFiles ? 0 : 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `言-备份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`备份已导出${safeStore.attachments ? `（含 ${safeStore.attachments.length} 件附件原件）` : ""}；不含 API Key`);
}
// 导入采用合并策略：按 id 跳过已存在的对话 / 模型 / 卷宗，附件原件只在本机缺失时写入
async function importData(file) {
  try {
    const data = JSON.parse(await readFile(file, "text"));
    if (!data || !Number.isInteger(data.version) || data.version < 1 || data.version > STORE_VERSION || !Array.isArray(data.conversations))
      throw Error("不是言的备份文件，或版本不兼容");
    const known = new Set(store.conversations.map(c => c.id));
    let conversations = 0,
      added = 0,
      library = 0,
      drafts = 0,
      files = 0;
    for (const c of data.conversations)
      if (c?.id && !known.has(c.id) && Array.isArray(c.messages)) {
        store.conversations.push({
          ...c,
          forks: Array.isArray(c.forks) ? c.forks : [],
          threads: Array.isArray(c.threads) ? c.threads : []
        });
        conversations += 1;
      }
    const profileIds = new Set(profiles().map(p => p.id));
    for (const p of Array.isArray(data.profiles) ? data.profiles : [])
      if (p?.id && p.source !== "server" && !profileIds.has(p.id)) {
        store.profiles.push({ ...p, apiKey: p.apiKey || "" });
        added += 1;
      }
    const libraryIds = new Set(store.library.map(f => f.id));
    for (const f of Array.isArray(data.library) ? data.library : [])
      if (f?.id && !libraryIds.has(f.id)) {
        store.library.push(f);
        library += 1;
      }
    for (const [key, draft] of Object.entries(data.drafts && typeof data.drafts === "object" ? data.drafts : {}))
      if (!store.drafts[key] && (typeof draft === "string" || (draft && typeof draft === "object"))) {
        store.drafts[key] = normalizeDraft(draft);
        drafts += 1;
      }
    for (const record of Array.isArray(data.attachments) ? data.attachments : [])
      if (record?.id && record.data !== undefined && !(await getAttachment(record.id))) {
        await putAttachment(record);
        files += 1;
      }
    const memoryIds = new Set(store.memory.items.map(item => item.id)),
      memoryTexts = new Set(store.memory.items.map(item => item.text));
    let memories = 0;
    for (const item of normalizeMemory(data.memory).items)
      if (!memoryIds.has(item.id) && !memoryTexts.has(item.text) && store.memory.items.length < MAX_MEMORY_ITEMS) {
        store.memory.items.push(item);
        memoryIds.add(item.id);
        memoryTexts.add(item.text);
        memories += 1;
      }
    if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
    saveStore();
    render();
    renderSettings();
    toast(
      `已导入 ${conversations} 段对话、${added} 个模型、${library} 件卷宗${drafts ? `、${drafts} 份草稿` : ""}${memories ? `、${memories} 条记忆` : ""}${files ? `，恢复 ${files} 件附件原件` : ""}${data.attachments ? "" : "；备份不含附件原件，旧附件将显示为不可用"}`
    );
  } catch (error) {
    toast(`导入失败：${String(error.message || error).slice(0, 80)}`);
  }
}

  // ---- 18-context-outline.js ----
// 言 · 上下文：右下角的实时计数、压缩前文为摘要；右侧的问题导航条
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统

// ---------- 上下文计数：下一问会送出多少（估算），随输入、流式生成实时变 ----------
// 与真正发送时的拼法同源（系统提示 + 工具定义 + 上次压缩以来的历史 + 行迹摘要 + 草稿 + 案上待发的附件与引文），附件按入库时记下的字数估
/** @param {Conversation} c */
function contextEstimate(c, draft = "", pending = null) {
  if (!c) return 0;
  const profile = activeProfile(),
    budget = inlineTextBudget(profile);
  let n = 0;
  if (profile) {
    const tools = profile.tools !== false ? toolDefinitions(c) : null;
    n += estimateText(assistantHint(profile, tools, c));
    if (tools) n += estimateText(JSON.stringify(tools));
  }
  const contextIndex = c.messages.map(m => m.role).lastIndexOf("context"),
    marker = contextIndex >= 0 ? c.messages[contextIndex] : null;
  if (marker?.summary) n += 12 + estimateText(marker.summary);
  const source = c.messages.slice(contextIndex + 1).filter(m => m.status !== "error" && ["user", "assistant"].includes(m.role)),
    // 案上有待发的东西时，下一问就是它；历史里最后一问不再是「最新一问」，它的附件只按摘要算
    lastUser = pending ? null : source.filter(m => m.role === "user").at(-1);
  const filesOf = (files, latest) => {
    let sum = 0;
    for (const file of files || [])
      sum +=
        file.kind === "image"
          ? latest
            ? 1000
            : 20
          : file.kind === "text" || file.extracted
            ? attachmentTokens(file, latest, budget)
            : latest
              ? 2000
              : 20;
    return sum;
  };
  for (const m of source) {
    n += 4 + estimateText(String(m.content || "")) + (m.quote?.text ? estimateText(m.quote.text) : 0);
    if (m.role === "assistant") n += estimateText(stepsDigest(m));
    n += filesOf(m.attachments, m === lastUser);
  }
  if (pending)
    n +=
      4 +
      estimateText(pending.text || "") +
      (pending.quote?.text ? estimateText(pending.quote.text) : 0) +
      filesOf(pending.attachments, true);
  else if (draft) n += 4 + estimateText(draft);
  return Math.round(n);
}
let gaugeTimer = null;
function updateContextGauge() {
  const gauge = $("#contextGauge");
  if (!gauge) return;
  const c = currentConversation();
  if (!c || view !== "chat") return gauge.classList.add("hidden");
  const draft = $("#chatInput").value,
    n = contextEstimate(
      c,
      draft,
      draft || pendingAttachments.length || pendingQuote ? { text: draft, attachments: pendingAttachments, quote: pendingQuote } : null
    ),
    limit = Number(store.settings.compactAt) || 0,
    window = Number(activeProfile()?.contextWindow) || 0,
    heavy = window ? n >= window * 0.75 : n >= CONTEXT_HEAVY;
  gauge.classList.remove("hidden");
  gauge.classList.toggle("heavy", heavy);
  gauge.classList.toggle("has-window", !!window);
  gauge.style.setProperty("--ratio", window ? `${Math.min(100, Math.round((n / window) * 100))}%` : "0%");
  rollText(gauge.querySelector(".context-gauge-value"), formatTokens(n));
  gauge.querySelector(".context-gauge-window").textContent = window ? `/ ${formatTokens(window)}` : "";
  gauge.title = `下一问约送出 ${formatTokens(n)} token${window ? `，占此模型窗口 ${formatTokens(window)} 的 ${Math.round((n / window) * 100)}%` : ""}（估算，含系统提示、工具定义与上次压缩以来的历史）${limit ? `；超过 ${formatTokens(limit)} 自动压成摘要` : ""}${heavy ? "\n上下文已重，可压缩前文" : "\n压缩前文"}`;
}
function scheduleContextGauge(delay = 160) {
  clearTimeout(gaugeTimer);
  gaugeTimer = setTimeout(updateContextGauge, delay);
}
// ---------- 压缩：把上次压缩以来的往来压成一份摘要，记在新的分隔上；此后的请求只带摘要与之后的消息 ----------
// 分隔（role: "context"）带 summary 的是压缩；不带的是旧版「另起一纸」留下的硬切，仍照旧生效
// 正在压缩的对话：只在内存里记，页面上画一行「正在压缩」
const compactingIds = new Set();
/** @param {Conversation} c */
function compactable(c) {
  if (!c || conversationRunning(c.id) || c.ended) return [];
  const contextIndex = c.messages.map(m => m.role).lastIndexOf("context");
  return c.messages
    .slice(contextIndex + 1)
    .filter(m => m.status !== "error" && m.status !== "streaming" && ["user", "assistant"].includes(m.role));
}
/** @param {Conversation} c */
async function compactContext(c, { auto = false } = {}) {
  const source = compactable(c),
    profile = activeProfile();
  if (source.filter(m => m.role === "user").length < 2) {
    if (!auto) toast("对话还短，不必压缩");
    return false;
  }
  if (!profile || quotaExhausted(profile)) {
    if (!auto) toast("没有可用的模型");
    return false;
  }
  if (compactingIds.has(c.id)) {
    if (!auto) toast("正在压缩");
    return false;
  }
  const transcript = source
    .map(
      m =>
        `${m.role === "user" ? "用户" : "助手"}：${String(m.content || "").slice(0, 6000)}${m.role === "assistant" ? `\n${stepsDigest(m)}`.trimEnd() : ""}`
    )
    .join("\n\n");
  // 摘要先在外面生成，成了再一次性插进分隔（生成期间只有页面上一行「正在压缩」，不进消息、不落盘）：
  // 中途关页面不会留下半成品分隔把历史截掉；期间用户接着发的消息也不受影响——分隔插在被压缩的最后一条之后，之后的消息照旧在分隔之后
  const lastCompacted = source.at(-1);
  compactingIds.add(c.id);
  renderConversation();
  try {
    // 转写可能很长、模型可能先思考再写：超时给足五分钟；输出上限不能只按摘要本身的六百字算——会思考的模型把思考也计在 max_tokens 里，
    // 给少了就只见思考不见摘要。这段对话开了思考档位的，压缩时降到最低一档：摘要用不着深想
    const response = await requestChat(
      profile,
      [{ role: "user", content: prompt("assistant.compact", { transcript }) }],
      AbortSignal.timeout(300000),
      {
        maxTokens: Math.max(6000, Number(profile.maxTokens) || 0),
        temperature: 0.2,
        systemPrompt: "",
        reasoning: c.reasoning ? "low" : ""
      }
    );
    if (!response.ok) throw Error(await describeResponseError(response));
    /** @type {Message} */
    const temp = { id: `compact-${uid()}`, role: "assistant", content: "", timestamp: now() };
    if ((response.headers.get("content-type") || "").includes("text/event-stream")) await readSse(response, temp);
    else {
      const data = await response.json();
      temp.content = extractContent(data);
      temp.reasoning = normalizeContent(data?.choices?.[0]?.message?.reasoning_content ?? data?.choices?.[0]?.message?.reasoning);
    }
    const summary = String(temp.content || "")
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();
    if (!summary) throw Error(temp.reasoning ? "模型只写了思考、没写出摘要（输出被上限截断）" : "模型没有写出摘要");
    const at = c.messages.indexOf(lastCompacted);
    if (at < 0) throw Error("对话在压缩期间已改动");
    // 期间又压过一次（分隔已在这条之后）就作废，以后来的为准
    if (c.messages.slice(at + 1).some(m => m.role === "context")) throw Error("对话在压缩期间已改动");
    /** @type {Message} */
    const marker = { id: uid(), role: "context", content: "", timestamp: now(), summary, compacted: source.length };
    c.messages.splice(at + 1, 0, marker);
    c.updatedAt = now();
    saveStore();
    compactingIds.delete(c.id);
    renderConversation();
    toast(auto ? "上下文已重，前文已自动压成摘要" : "前文已压成摘要");
    return true;
  } catch (error) {
    compactingIds.delete(c.id);
    renderConversation();
    console.warn("压缩失败", error);
    const reason = error?.name === "TimeoutError" ? "模型五分钟内未写出摘要" : friendlyError(String(error?.message || error));
    toast(`压缩失败：${reason.slice(0, 80)}`);
    return false;
  } finally {
    compactingIds.delete(c.id);
  }
}
async function describeResponseError(response) {
  const data = await response.json().catch(() => ({}));
  const error = data.error;
  return (typeof error === "string" ? error : error?.message) || `请求失败（${response.status}）`;
}
// 分隔上的摘要进历史：一问一答的样子，各家接口都认
/** @returns {Array<Record<string, any>>} */
function summaryMessages(marker) {
  if (!marker?.summary) return [];
  return [
    { role: "user", content: `［前文摘要］此前的对话已压缩为以下摘要，请以此为准接着谈：\n\n${marker.summary}` },
    { role: "assistant", content: "已了解前文，请继续。" }
  ];
}
// 一答收尾后：估算超过设置的阈值就自动压缩（0 为关）
/** @param {Conversation} c */
function maybeAutoCompact(c) {
  const limit = Number(store.settings.compactAt) || 0;
  if (!limit || !c || c.ended) return;
  if (contextEstimate(c) < limit) return;
  void compactContext(c, { auto: true });
}
// 点右下角的计数：问一句就压，压缩期间计数处显示「压缩中」
async function openContextMenu(anchor) {
  const c = currentConversation();
  if (!c || anchor.dataset.busy) return;
  const source = compactable(c),
    turns = source.filter(m => m.role === "user").length;
  if (turns < 2) return toast(conversationRunning(c.id) ? "生成中，稍后再压" : "对话还短，不必压缩");
  const ok = await askConfirm({
    title: "把前文压成摘要？",
    body: `此前的 ${turns} 问 ${source.length - turns} 答会由模型压成一份摘要（目标、事实、决定、改过的文件、待办），此后每一问只带摘要与之后的消息。页面上的记录都还在，只是折起来。`,
    ok: "压缩"
  });
  if (!ok) return;
  anchor.dataset.busy = "1";
  anchor.querySelector(".context-gauge-label").textContent = "压缩中";
  try {
    await compactContext(c);
  } finally {
    delete anchor.dataset.busy;
    anchor.querySelector(".context-gauge-label").textContent = "上下文";
    updateContextGauge();
  }
}

// ---------- 右侧的问题导航条：一问一格，点一下回到那一问；随滚动标出当前所在 ----------
let outlineRaf = 0,
  outlineLockUntil = 0;
/** @param {Message} message */
function outlineLabel(message) {
  const text = String(message.content || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || (message.attachments?.length ? `附件 ${message.attachments[0].name}` : message.quote?.text ? "就引文追问" : "…");
}
function renderOutline() {
  const rail = $("#outline");
  if (!rail) return;
  // 压缩过的前文在页上折着，导航条上也不列它们的问；「展开前文」后再列出来
  const c = currentConversation(),
    foldAt = c && !c.showCompacted ? c.messages.map(m => (m.role === "context" && m.summary ? 1 : 0)).lastIndexOf(1) : -1,
    users = c && view === "chat" ? c.messages.slice(foldAt + 1).filter(m => m.role === "user") : [];
  if (users.length < 2) {
    rail.classList.add("hidden");
    rail.innerHTML = "";
    return;
  }
  rail.classList.remove("hidden");
  rail.classList.toggle("dense", users.length > 18);
  rail.innerHTML = users
    .map(
      (m, i) =>
        `<button type="button" class="outline-item" data-target="${escapeHtml(m.id)}" title="第 ${i + 1} 问 · ${escapeHtml(outlineLabel(m).slice(0, 80))}"><span class="outline-label">${escapeHtml(outlineLabel(m).slice(0, 16))}</span><span class="outline-tick" aria-hidden="true"></span></button>`
    )
    .join("");
  syncOutline();
}
function syncOutline() {
  cancelAnimationFrame(outlineRaf);
  outlineRaf = requestAnimationFrame(() => {
    const rail = $("#outline"),
      host = $("#chatScroll");
    if (!rail || rail.classList.contains("hidden") || Date.now() < outlineLockUntil) return;
    // 「当前所在」取阅读线以上最近的一问：阅读线在视口上部，短问短答挤在一屏时也不会把下一问算成当前
    const line = host.getBoundingClientRect().top + Math.min(120, host.clientHeight * 0.25);
    let current = null;
    for (const item of rail.querySelectorAll(".outline-item")) {
      const article = host.querySelector(`#messages [data-message="${CSS.escape(item.dataset.target)}"]`);
      if (article && article.getBoundingClientRect().top <= line) current = item;
    }
    if (!current) current = rail.querySelector(".outline-item");
    rail.querySelectorAll(".outline-item.active").forEach(item => item !== current && item.classList.remove("active"));
    current?.classList.add("active");
  });
}
function jumpToOutline(id) {
  const article = document.querySelector(`#messages [data-message="${CSS.escape(id)}"]`);
  if (!article) return;
  followBottom = false;
  // 点了哪一问就标哪一问，平滑滚动的途中不让滚动事件把它改掉
  const rail = $("#outline");
  rail?.querySelectorAll(".outline-item.active").forEach(item => item.classList.remove("active"));
  rail?.querySelector(`.outline-item[data-target="${CSS.escape(id)}"]`)?.classList.add("active");
  outlineLockUntil = Date.now() + 900;
  scrollChatTo(article, "start");
  article.classList.remove("flash");
  void article.offsetWidth;
  article.classList.add("flash");
}

// ---------- 对话存成 Markdown：桥接在线时落到卷宗，否则下载 ----------
/** @param {Conversation} c */
function conversationMarkdown(c) {
  const lines = [`# ${c.title}`, "", `${formatDay(c.createdAt)}${isWork(c) ? ` · 工作目录 ${c.workdir}` : ""}`, ""];
  for (const m of c.messages) {
    if (m.role === "context") {
      lines.push(
        "---",
        "",
        m.summary ? `> **前文摘要**\n>\n> ${String(m.summary).replace(/\n/g, "\n> ")}` : "*（上下文由此重新开始）*",
        ""
      );
      continue;
    }
    if (m.role === "user") {
      lines.push("## 问", "");
      if (m.quote?.text)
        lines.push(
          ...String(m.quote.text)
            .split(/\r?\n/)
            .map(line => `> ${line}`),
          ""
        );
      if (m.attachments?.length) lines.push(`*附件：${m.attachments.map(f => f.name).join("、")}*`, "");
      lines.push(String(m.content || ""), "");
    } else if (m.role === "assistant" && m.status !== "error") {
      lines.push(`## 答${m.modelName ? ` · ${m.modelName}` : ""}`, "");
      const trail = stepsDigest(m);
      if (trail) lines.push(`*${trail}*`, "");
      lines.push(String(m.content || ""), "");
      if (m.deliverables?.length) lines.push(`*成品：${m.deliverables.map(f => f.name).join("、")}*`, "");
    }
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
/** @param {Conversation} c */
async function exportConversationMarkdown(c) {
  if (!c) return;
  const name = `${String(c.title || "对话")
      .replace(/[\\/:*?"<>|]/g, " ")
      .trim()
      .slice(0, 60)}.md`,
    text = conversationMarkdown(c);
  if (archiveOnline()) {
    try {
      const saved = await putArchiveFile(name, dataUrlFromText(text, "text/markdown"));
      void refreshArchive();
      toast(`已存入卷宗：${saved.name}`);
    } catch (error) {
      toast(`存入失败：${String(error.message || error).slice(0, 80)}`);
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" })),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

  // ---- 19-anthropic.js ----
// 言 · Anthropic 适配：页面与桥接内部一律用 OpenAI 的格式（消息、工具、流式分块）；接 Anthropic 时在这里换一层——
// 把 OpenAI 格式的请求换成 Messages API 的，再把它的事件流换回 OpenAI 风格的 SSE 分块，其余代码一字不动。
// 这一段两处跑：浏览器里随 support.js 拼进闭包（直连时用），桥接里由 server.js require（经桥接时用）；不能碰 DOM
const ANTHROPIC_VERSION = "2023-06-01";
// 思考档位换成思考预算（token）；预算得小于 max_tokens，不够就把 max_tokens 抬上去
const ANTHROPIC_BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 16384, xhigh: 32768, max: 65536 };
// 是不是 Anthropic 的接口：模型上明说的优先，没说就看地址
function anthropicLike(profile) {
  const api = String(profile?.api || "").toLowerCase();
  if (api) return api === "anthropic";
  return /anthropic\.com/i.test(String(profile?.baseUrl || ""));
}
// Base URL 可以填到根、到 /v1 或到 /v1/messages，都归到根再拼
function anthropicEndpoint(baseUrl, suffix = "/v1/messages") {
  const url = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1(\/messages)?$/i, "");
  if (!/^https?:\/\//i.test(url)) throw Error("Base URL 只支持 http 或 https");
  return `${url}${suffix}`;
}
function anthropicHeaders(apiKey, browser = false) {
  return {
    "Content-Type": "application/json",
    "x-api-key": String(apiKey || ""),
    "anthropic-version": ANTHROPIC_VERSION,
    ...(browser ? { "anthropic-dangerous-direct-browser-access": "true" } : {})
  };
}
// 用户消息里的一段内容换成内容块：文字、图片（data: 或 http 地址）、PDF（按文件名认）；别的文件只能以一行说明代替
function anthropicUserBlocks(content) {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text") {
      if (part.text) blocks.push({ type: "text", text: String(part.text) });
    } else if (part.type === "image_url") {
      const url = String(part.image_url?.url || ""),
        data = url.match(/^data:([^;,]+);base64,(.*)$/s);
      if (data) blocks.push({ type: "image", source: { type: "base64", media_type: data[1], data: data[2] } });
      else if (/^https?:\/\//i.test(url)) blocks.push({ type: "image", source: { type: "url", url } });
    } else if (part.type === "file") {
      const name = String(part.file?.filename || "");
      if (/\.pdf$/i.test(name) && part.file?.file_data)
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: String(part.file.file_data) } });
      else blocks.push({ type: "text", text: `[附件 ${name || "文件"}：此接口不接受该格式的原件]` });
    }
  }
  return blocks;
}
// OpenAI 格式的请求体 → Messages API 的请求体。system 单列；user / assistant 交替，相邻同角色并成一条（工具结果与紧接的补言都进同一条 user）；
// 助手一轮里的思考块原样带回（带工具调用的那一轮，Anthropic 要求回传）；空的 assistant 略去
function anthropicRequest(payload) {
  const system = [],
    messages = [];
  const push = (role, blocks) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const message of payload.messages || []) {
    const role = message?.role;
    if (role === "system") {
      const text =
        typeof message.content === "string"
          ? message.content
          : anthropicUserBlocks(message.content)
              .map(b => b.text || "")
              .join("\n");
      if (text) system.push(text);
    } else if (role === "user") push("user", anthropicUserBlocks(message.content));
    else if (role === "assistant") {
      const blocks = [];
      for (const block of Array.isArray(message.thinking_blocks) ? message.thinking_blocks : [])
        if (block?.thinking && block.signature) blocks.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
      const text = typeof message.content === "string" ? message.content : "";
      if (text.trim()) blocks.push({ type: "text", text });
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        let input = {};
        try {
          input = JSON.parse(call.function?.arguments || "{}");
        } catch {}
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function?.name || "",
          input: input && typeof input === "object" ? input : {}
        });
      }
      push("assistant", blocks);
    } else if (role === "tool")
      push("user", [{ type: "tool_result", tool_use_id: message.tool_call_id, content: String(message.content ?? "") }]);
  }
  if (!messages.length || messages[0].role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "（接上文）" }] });
  const level = String(payload.reasoning_effort || "").toLowerCase(),
    budget = level && level !== "none" && level !== "off" ? ANTHROPIC_BUDGETS[level] || 8192 : 0;
  const maxTokens = Math.max(16, Number(payload.max_tokens) || 8192);
  const body = {
    model: payload.model,
    max_tokens: budget ? Math.max(maxTokens, budget + 4096) : maxTokens,
    messages,
    stream: true
  };
  if (system.length) body.system = system.join("\n\n");
  // 开了思考 temperature 只能是 1：不传
  if (budget) body.thinking = { type: "enabled", budget_tokens: budget };
  else if (payload.temperature !== undefined) body.temperature = Math.max(0, Math.min(1, Number(payload.temperature)));
  if (Array.isArray(payload.tools) && payload.tools.length)
    body.tools = payload.tools.map(tool => ({
      name: tool.function?.name || "",
      description: tool.function?.description || "",
      input_schema: tool.function?.parameters || { type: "object", properties: {} }
    }));
  return body;
}
// Messages API 的事件流 → OpenAI 风格的 SSE 分块（data: {...}\n\n，末尾 [DONE]）。
// text_delta → content，thinking_delta → reasoning_content，tool_use 块 → tool_calls（按出现顺序编号），思考块收尾时整块带上签名
// 作 thinking_block 交给页面（带工具调用的那一轮要回传）；message_delta 里的用量换成 usage
function anthropicToOpenAiStream(model = "") {
  const decoder = new TextDecoder(),
    encoder = new TextEncoder(),
    id = `chatcmpl-${Date.now().toString(36)}`;
  let buffer = "",
    event = "",
    tools = 0,
    stopped = false;
  const blocks = new Map(),
    usage = { prompt_tokens: 0, completion_tokens: 0 };
  const chunk = (delta, extra = {}, finish = null) =>
    encoder.encode(
      `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`
    );
  const handle = (controller, name, data) => {
    if (name === "message_start") {
      const u = data.message?.usage || {};
      usage.prompt_tokens =
        Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
      if (data.message?.model) model = data.message.model;
    } else if (name === "content_block_start") {
      const block = { ...(data.content_block || {}), text: "", json: "", signature: "" };
      blocks.set(data.index, block);
      if (block.type === "tool_use") {
        block.slot = tools++;
        controller.enqueue(
          chunk({ tool_calls: [{ index: block.slot, id: block.id, type: "function", function: { name: block.name, arguments: "" } }] })
        );
      }
    } else if (name === "content_block_delta") {
      const block = blocks.get(data.index),
        delta = data.delta || {};
      if (delta.type === "text_delta" && delta.text) controller.enqueue(chunk({ content: delta.text }));
      else if (delta.type === "thinking_delta" && delta.thinking) {
        if (block) block.text += delta.thinking;
        controller.enqueue(chunk({ reasoning_content: delta.thinking }));
      } else if (delta.type === "input_json_delta" && block) {
        block.json += delta.partial_json || "";
        if (delta.partial_json)
          controller.enqueue(chunk({ tool_calls: [{ index: block.slot, function: { arguments: delta.partial_json } }] }));
      } else if (delta.type === "signature_delta" && block) block.signature += delta.signature || "";
    } else if (name === "content_block_stop") {
      const block = blocks.get(data.index);
      if (block?.type === "thinking" && block.signature)
        controller.enqueue(chunk({ thinking_block: { thinking: block.text, signature: block.signature } }));
    } else if (name === "message_delta") {
      if (data.usage?.output_tokens !== undefined) usage.completion_tokens = Number(data.usage.output_tokens) || 0;
      const reason = data.delta?.stop_reason,
        finish = reason === "tool_use" ? "tool_calls" : reason === "max_tokens" ? "length" : reason ? "stop" : null;
      controller.enqueue(chunk({}, { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } }, finish));
    } else if (name === "message_stop") {
      stopped = true;
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    } else if (name === "error")
      controller.enqueue(chunk({ content: `\n[接口错误：${data.error?.message || data.error?.type || "未知"}]` }));
  };
  const feed = (controller, text) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) {
        try {
          const data = JSON.parse(line.slice(5).trim());
          handle(controller, event || data.type, data);
        } catch {}
      } else if (!line) event = "";
    }
  };
  return new TransformStream({
    transform(bytes, controller) {
      feed(controller, decoder.decode(bytes, { stream: true }));
    },
    flush(controller) {
      feed(controller, decoder.decode());
      if (buffer) feed(controller, "\n");
      if (!stopped) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    }
  });
}
// 桥接 require 这一段后从 globalThis.YAN_ANTHROPIC 取；不写 module.exports——那会让类型检查把这一段当成独立模块，页面里就找不到这些名字
globalThis.YAN_ANTHROPIC = { anthropicLike, anthropicEndpoint, anthropicHeaders, anthropicRequest, anthropicToOpenAiStream };

  // ---- 99-start.js ----
// 言 · 启动
boot();
})();
