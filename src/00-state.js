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
const STATE_STORE_NAME = "state"; // 旧版整份记录的表（main 一条），迁走后就空着
const STATE_RECORD_KEY = "main";
const CHATS_STORE_NAME = "conversations"; // 没桥接时对话存这里，一段一条
const CHAT_DISK_INTERVAL = 1200, // 静止时同一段对话连续落盘的最短间隔（毫秒）
  CHAT_STREAM_DISK_INTERVAL = 3000; // 流式生成时少改几遍整份 JSON；收尾会恢复上面的短间隔
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
// 给端到端测试看内存里的记录（对话不再整份镜像在 localStorage 里，测试没别的地方读）
window.__yanState = () => store;
window.__yanSave = () => saveStore();
let bootstrap = { serverProfile: null, configError: "" };
let apiBase = null;
/** @type {string|null} 正在看的对话 */
let currentId = null;
let view = "chat";
let editingMessageId = null;
let renamingId = null,
  renamingDirty = false,
  renderingHistory = false;
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
let stateDbPromise = null,
  stateDb = null;
let metaRevision = 0,
  metaSaveWarned = false,
  metaMirrorTimer = null;
// 对话的存取状态：目录是否可用、正在合、指纹与时间戳、待写与在写、没删成的（见 01-store.js 开头的说明）
let chatsBroken = false,
  chatsSyncing = false,
  freshBrowser = false,
  chatSaveWarned = false,
  unloading = false;
const dirtyChatIds = new Set(),
  chatHashes = new Map(),
  chatStamps = new Map(),
  pendingChatWrites = new Map(),
  activeChatWrites = new Map(),
  chatWritePromises = new Map(),
  deletedChatIds = new Set(),
  chatDiskWrites = new Map(),
  pendingChatDeletes = new Set();
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
