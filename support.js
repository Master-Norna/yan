(() => {
  "use strict";
  // ---- 00-state.js ----
// 言 · 常量、内置提示词取值、运行期状态
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 数据模型（JSDoc，供 tsc --checkJs 与编辑器；见 src/types.d.ts 的说明）----------
// 存下来的东西只有这几种：Store 里挂着设置、模型、对话、卷宗（浏览器内的旧件）、记忆与草稿；对话里是消息，消息上挂步骤，步骤上可挂帮手
/**
 * @typedef {Object} Attachment 附件的元数据；原件（data）另存存储根的 附件/（没桥接时暂存 IndexedDB），只在读出时才带
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
 * @property {string} [sandboxWhy] 问而后行里严的沙箱会拦下它的原因；请示时写明，批了就出沙箱跑
 * @property {boolean} [background] 后台指令
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
 * @property {string} [presetId] 用的哪个预设；空即言的本色
 * @property {string} [groupId] 归在哪个分组；空即散列
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
 * @property {number} [maxTokens] 只对 Anthropic 有意义（Messages API 必填）；OpenAI 兼容接口不传，由服务端定
 * @property {string} quota 用量上限，如 "100k"；空则不限
 * @property {number} usedTokens
 * @property {boolean} [tools] 本机工具，默认开
 * @property {number} [contextWindow]
 * @property {string} [reasoning] 此模型记住的思考档位；留空由接口决定
 * @property {string} [reasoningLevels] 此模型认的思考档位，逗号分隔；none 是不认；探到的与手填的都记在这里
 * @property {string} [reasoningProbed] 探过档位时模型的身份（接口|地址|模型 ID，见 reasoningProbeKey），亲手填的前面带 manual|；换了任一样再探
 * @property {string[]} [modelList]
 */
/**
 * @typedef {Object} Preset 预设：一套打包好的做法，选了它的对话都照这一套——提示词排在系统提示最前，工具与 MCP 只给挑中的，可带默认模型与指令权限
 * @property {string} id
 * @property {string} name
 * @property {string} prompt
 * @property {string[]|null} tools 给哪几组内置工具（见 TOOL_GROUPS）；null 即全给
 * @property {string[]|null} mcp 给哪几个 MCP 服务；null 即全给
 * @property {string} profileId 选它时换到这个模型；空则不换
 * @property {CommandPolicy|""} policy 选它时的指令权限；空则照设置里的默认
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
 * @property {Preset[]} presets
 * @property {string} presetId 新对话用的预设（上回选的）；空即本色
 * @property {{ id: string, name: string, createdAt: string, presetId: string, workdir: string }[]} groups 分组：自立的几组，对话各记 groupId；组里新起的对话用组的预设、绑组的默认目录
 * @property {string} [pendingGroupId] 从组首「＋」另起的新对话归进这一组（用过即清）
 * @property {boolean} autoTitle
 * @property {string} [pendingWorkdir] 欢迎页目录签里待绑的目录
 * @property {string[]} collapsedRepos
 * @property {CommandPolicy} commandPolicyDefault 新对话默认的指令权限模式
 * @property {boolean} [sandbox] 沙箱总开关（默认开）：桥接那头筛指令、锁目录、去机密环境变量
 * @property {number} compactAt
 * @property {"anywhere"|"inside"} toolReach
 * @property {boolean} archiveRead
 * @property {number} toolRounds
 * @property {number} subRounds
 * @property {string} [archiveDir] 旧版的卷宗目录；只在头一回迁入存储根时读一次，此后删去
 * @property {string} [chatsDir] 旧版的对话目录；同上
 * @property {"chat"|"library"|"groups"} [lastView] 上次停在哪一页，刷新后回到原处
 * @property {string} [lastConversationId]
 * @property {{ packs: string[], pip: string, npm: string, mirror: "china"|"official" }} env 沙箱环境：选了哪几组工具、另装的包、下载源
 * @property {Record<string, Record<string, any>>} mcpServers 接入的 MCP 服务，照通行的 mcpServers 写法：{ 名字: { command, args, cwd, env } 或 { url, headers, type } }
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
  return fillTemplate(text, vars);
}
// 提示词的写法：字符串或按行拼的数组，{{名字}} 在运行时填入
function fillTemplate(text, vars = {}) {
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
// Anthropic 的 max_tokens 没填时的值：今日的 Claude 都认得下这个数；OpenAI 兼容接口根本不传这个字段
const DEFAULT_MAX_TOKENS = 32000;
const MIN_TOOL_STATUS_MS = 240;
// 一次回答里最多几轮工具调用（帮手另计），超过后收回工具、请模型直接收尾；按轮计，同一轮并发的几次调用只算一轮。
// 默认值在这里，实际值在「设置 → 工具」里可改，留空（记作 0）即不限
const DEFAULT_TOOL_ROUNDS = 80,
  DEFAULT_SUB_ROUNDS = 40;
function roundLimit(key, fallback) {
  const raw = store?.settings?.[key];
  if (raw === 0) return Infinity;
  const value = Math.floor(Number(raw));
  return value >= 1 ? value : fallback;
}
const roundLimitText = limit => (Number.isFinite(limit) ? String(limit) : "");
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
    theme: "light",
    inkMotion: "on",
    font: "mixed",
    width: 760,
    accent: "#9b5540",
    activeProfileId: "",
    presets: [],
    presetId: "",
    groups: [],
    autoTitle: true,
    pendingWorkdir: "",
    collapsedRepos: [],
    commandPolicyDefault: "ask",
    sandbox: true,
    compactAt: 0,
    toolReach: "anywhere",
    archiveRead: true,
    toolRounds: DEFAULT_TOOL_ROUNDS,
    subRounds: DEFAULT_SUB_ROUNDS,
    mcpServers: {},
    env: { packs: ["data", "office", "web"], pip: "", npm: "", mirror: "china" }
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
// 桥接的引导信息（目录、平台、shell）；notice 是页面自己写的桥接状态提示，在设置 → 模型顶部显示
let bootstrap = { notice: "" };
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
// 进行中的请求（主答、旁注）。有活在跑就攥着一把 Web Lock：熄屏、窗口被挡住时页面算「藏起来」，
// 浏览器的睡眠标签页 / 节能模式会把藏久了的页面冻住——流不读、工具不跑，亮屏才接着动；持锁的页面不在冻结之列。
// 用共享锁：开着几个言的标签页也各自攥得住
class JobMap extends Map {
  set(key, value) {
    super.set(key, value);
    holdAwake();
    // 开工即报到，别处立刻知道这段在作答
    void syncLeases();
    return this;
  }
  delete(key) {
    const had = super.delete(key);
    holdAwake();
    return had;
  }
  clear() {
    super.clear();
    holdAwake();
  }
}
const requestJobs = new JobMap();
// 几个页面同开同一个存储时，谁在作答（见 01-store/40-leases.js 的 syncLeases）：PAGE_ID 是这个页面的名号；
// remoteBusy 是别处正在作答的对话；leaseHold 是这边作答过、最后一次存盘还没落地的对话——落了地才松手，别处读到的才是写完的
const PAGE_ID = uid();
const remoteBusy = new Set(),
  leaseHold = new Set();
/** @type {{ release: () => void }|null} */
let awakeHold = null;
function holdAwake() {
  if (requestJobs.size && !awakeHold && globalThis.navigator?.locks) {
    const hold = { release: () => {} },
      done = new Promise(resolve => (hold.release = () => resolve(null)));
    awakeHold = hold;
    navigator.locks.request("yan-at-work", { mode: "shared" }, () => done).catch(() => {});
  } else if (!requestJobs.size && awakeHold) {
    awakeHold.release();
    awakeHold = null;
  }
}
let settingsTab = "general";
let toastTimer = null;
let fileDbPromise = null;
let stateDbPromise = null,
  stateDb = null;
let metaRevision = 0,
  metaSaveWarned = false,
  configSaveTimer = null,
  configSyncedAt = 0;
// 对话的存取状态：目录是否可用、正在合、指纹与时间戳、待写与在写、没删成的（见 01-store/10-state-db.js 开头的说明）
let chatsBroken = false,
  chatsSyncing = false,
  // 这一回开页后对话已从目录读全过：之后才敢按「没人用」清附件原件
  chatsLoaded = false,
  freshBrowser = false,
  // 开页时浏览器里是一份没带版本标记的记录（更老的版本，或测试灌进来的）：与 配置.json 对齐时以它为准
  localSeeded = false,
  chatSaveWarned = false,
  unloading = false;
const dirtyChatIds = new Set(),
  chatHashes = new Map(),
  chatStamps = new Map(),
  // 每段对话上次与目录对齐时目录里那份的时间戳：写的时候带去，目录里那份若更新，桥接就不写（见 mergeConversation）
  chatDiskStamps = new Map(),
  pendingChatWrites = new Map(),
  activeChatWrites = new Map(),
  chatWritePromises = new Map(),
  deletedChatIds = new Set(),
  chatDiskWrites = new Map(),
  pendingChatDeletes = new Set();
let libraryQuery = "",
  libraryKind = "all";
const advancedOpen = new Set();
let suppressViz = false;
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

  // ---- 01-store/00-records.js ----
// 言 · 本地存储 · 记录：调桥接的口子、结构迁移、各类数据的规整
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 调本机桥接：存储、卷宗、工具都走这一个口子；桥接回的错误是一句话，原样抛出（状态码与回来的内容挂在 status / data 上）
async function bridge(path, payload, signal) {
  if (apiBase === null) throw Error("本机工具需要本机桥接");
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(data.error || `请求失败（${response.status}）`), { status: response.status, data });
  return data;
}

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
    const settings = { ...defaultStore.settings, ...(data.settings || {}) };
    const env = settings.env && typeof settings.env === "object" ? settings.env : {};
    settings.env = {
      ...defaultStore.settings.env,
      ...env,
      packs: Array.isArray(env.packs) ? [...new Set(env.packs.map(String))] : [...defaultStore.settings.env.packs],
      pip: String(env.pip || ""),
      npm: String(env.npm || ""),
      mirror: env.mirror === "official" ? "official" : "china"
    };
    const legacyReasoning = normalizeReasoning(settings.reasoning),
      rawProfiles = Array.isArray(data.profiles) ? data.profiles.filter(p => p && typeof p === "object") : [],
      legacyProfileId = data.settings?.activeProfileId || rawProfiles[0]?.id;
    delete settings.reasoning;
    // 旧版把新对话档位存在全局设置里；仅归给当时选中的模型，不能让它跟着切到别的模型。
    const profiles = rawProfiles.map(p => ({
      ...p,
      ...(p.reasoning !== undefined
        ? { reasoning: normalizeReasoning(p.reasoning) }
        : data.settings?.reasoning !== undefined && p.id === legacyProfileId
          ? { reasoning: legacyReasoning }
          : {})
    }));
    // 旧版的 system prompt 写在模型配置上：挪成一个同名预设、带着这个模型，模型配置里不再有它
    settings.presets = normalizePresets(settings.presets);
    for (const p of profiles) {
      const text = String(p.systemPrompt || "").trim();
      delete p.systemPrompt;
      if (text && !settings.presets.some(preset => preset.id === `from-${p.id}`))
        settings.presets.push(normalizePreset({ id: `from-${p.id}`, name: p.name || "预设", prompt: text, profileId: p.id }));
    }
    if (!settings.presets.some(preset => preset.id === settings.presetId)) settings.presetId = "";
    settings.groups = (Array.isArray(settings.groups) ? settings.groups : [])
      .filter(group => group && typeof group === "object" && group.id)
      .map(group => ({
        id: String(group.id),
        name: String(group.name || "").trim() || "未命名",
        createdAt: String(group.createdAt || new Date().toISOString()),
        presetId: String(group.presetId || ""),
        workdir: String(group.workdir || "")
      }));
    return {
      ...structuredClone(defaultStore),
      ...data,
      settings,
      profiles,
      conversations: (Array.isArray(data.conversations) ? data.conversations : []).map(normalizeConversation),
      library: Array.isArray(data.library) ? data.library : [],
      drafts: normalizeDrafts(data.drafts),
      memory: normalizeMemory(data.memory)
    };
  } catch {
    return structuredClone(defaultStore);
  }
}
/** @returns {Preset[]} */
function normalizePresets(list) {
  return (Array.isArray(list) ? list : []).filter(item => item && typeof item === "object" && item.id).map(normalizePreset);
}
/** @returns {Preset} */
function normalizePreset(value) {
  const names = list => (Array.isArray(list) ? [...new Set(list.map(String))] : null);
  return {
    id: String(value.id || uid()),
    name: String(value.name || "").trim() || "未命名",
    prompt: String(value.prompt || ""),
    tools: names(value.tools),
    mcp: names(value.mcp),
    profileId: String(value.profileId || ""),
    policy: ["ask", "review", "auto"].includes(value.policy) ? value.policy : ""
  };
}
/** @param {any} value @returns {Conversation} */
function normalizeConversation({ ended, workAuto, ...c }) {
  return /** @type {Conversation} */ ({
    ...c,
    commandPolicy: normalizeCommandPolicy(c.commandPolicy, workAuto ? "auto" : "ask"),
    reasoning: normalizeReasoning(c.reasoning),
    // 旧版在压缩开始时就先落一个 compacting 分隔：页面若在摘要生成前关掉，它会留下来把历史长期截断；启动时清掉
    messages: (Array.isArray(c.messages) ? c.messages : []).filter(m => !(m?.role === "context" && m.compacting)),
    forks: Array.isArray(c.forks) ? c.forks : [],
    threads: Array.isArray(c.threads) ? c.threads : []
  });
}
// localStorage 里那份：新版只有配置（split 标记），旧版是整份记录（带 revision / dbOnly 的是 IndexedDB 时期的镜像，什么都没带的是更老的版本或测试灌的）
function readLocalStoreRecord() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!data || typeof data !== "object") return null;
    const meta = data[STORAGE_META_KEY];
    return {
      data,
      revision: Number(meta?.revision) || 0,
      dbOnly: meta?.dbOnly === true,
      split: meta?.split === true,
      pendingDeletes: Array.isArray(meta?.pendingDeletes) ? meta.pendingDeletes.map(String) : [],
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

  // ---- 01-store/10-state-db.js ----
// 言 · 本地存储 · 暂存：记录怎么存、IndexedDB 的状态表、配置的本机缓存
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 记录怎么存 ----------
// 记录分两半。「配置」（设置、模型含 API Key、浏览器内卷宗、记忆、草稿）小而常改：正本在存储根的 配置.json（默认 ~/.yan，
// 几个浏览器共用这一份，见 syncConfigWithDisk），localStorage 里那份是缓存，也是没桥接时的暂存。
// 「对话」各自一份：桥接在线时落在存储根的 对话/（bootstrap.work.chats；一段一个 JSON 文件，复制即备份）；
// 没桥接时存在 IndexedDB 的 conversations 表，桥接接上后推到目录里去、表里的清掉——目录是正本，表只是没桥接时的暂存。
// 保存只写改过的那几段（当前这段、正在生成的、明确标过脏的，且内容的哈希与上次写的不同）；另有一趟低频的全量巡检兜底，
// 谁改了哪段没标到也逃不过。旧版把整份记录（含所有对话）塞在 localStorage / IndexedDB 的一条记录里，启动时拆开迁走。
function openStateDb() {
  if (stateDbPromise) return stateDbPromise;
  stateDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(STATE_DB_NAME, 2);
    // 另一处窗口还开着旧版页面时，升级表结构会被它挡住，open 永远不回来：等几秒就当没有 IndexedDB，页面照常开（对话从目录来）
    const timer = setTimeout(() => {
      stateDbPromise = null;
      reject(Error("对话存储被另一处窗口占着"));
    }, 5000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE_NAME)) db.createObjectStore(STATE_STORE_NAME, { keyPath: "id" });
      if (!db.objectStoreNames.contains(CHATS_STORE_NAME)) db.createObjectStore(CHATS_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      stateDb = request.result;
      // 别的窗口要升级或删库：把自己的连接让开，下次用到再重开，不然它那头会一直等
      stateDb.onversionchange = () => {
        stateDb.close();
        stateDb = null;
        stateDbPromise = null;
      };
      resolve(stateDb);
    };
    request.onerror = () => {
      clearTimeout(timer);
      stateDbPromise = null;
      reject(request.error || Error("对话存储不可用"));
    };
  });
  return stateDbPromise;
}
function dbRequest(db, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode),
      request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("对话存储失败"));
    transaction.onabort = () => reject(transaction.error || Error("对话存储已中止"));
  });
}
async function stateStoreRequest(storeName, mode, action) {
  return dbRequest(await openStateDb(), storeName, mode, action);
}
// 一个事务里做一批（迁移几百段对话时一段一个事务太慢）
function dbBatch(db, storeName, fill) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    fill(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || Error("对话存储失败"));
    transaction.onabort = () => reject(transaction.error || Error("对话存储已中止"));
  });
}
// 内容的指纹：长度加一遍 FNV-1a，够用来判断「和上次写的一不一样」
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `${text.length}:${hash.toString(16)}`;
}
function metaOf(data = store) {
  return {
    version: data.version,
    settings: data.settings,
    profiles: data.profiles,
    library: data.library,
    memory: data.memory,
    drafts: data.drafts
  };
}
function nextMetaRevision() {
  metaRevision = Math.max(Date.now(), metaRevision + 1);
  return metaRevision;
}
// 配置上次写下时的指纹：saveStore 每几百毫秒就来一次（存对话时顺带），配置本身没变就不必动版本号、更不必排一次写 配置.json——
// 从前每存一次对话就把整份配置写回磁盘，两个浏览器同开时，这边随手发一句话，就拿自己手上的旧配置把那边刚加的模型、记忆盖掉了
let metaHash = "",
  metaLocalKey = "";
/** @param {{ disk?: boolean }} [options] disk: 配置变了就排一次写 配置.json（从磁盘刚取回的就不必再写回去） */
function writeMeta({ disk = true } = {}) {
  const hash = hashText(JSON.stringify(metaOf())),
    changed = hash !== metaHash;
  if (changed) {
    metaHash = hash;
    nextMetaRevision();
  }
  const deletes = [...pendingChatDeletes],
    localKey = `${hash}|${deletes.join(",")}`;
  if (localKey !== metaLocalKey)
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...metaOf(),
          [STORAGE_META_KEY]: { revision: metaRevision || nextMetaRevision(), split: true, pendingDeletes: deletes }
        })
      );
      metaLocalKey = localKey;
      metaSaveWarned = false;
    } catch {
      if (!metaSaveWarned) {
        metaSaveWarned = true;
        toast("设置未能存下（浏览器存储已满），请先导出备份");
      }
    }
  if (disk && changed) scheduleConfigSave();
}

  // ---- 01-store/20-config.js ----
// 言 · 本地存储 · 配置：配置.json 的读写与三方合并（几个浏览器共用一份）
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 配置.json ----------
// 改动后一秒内写一次（含 API Key：这是自己机器上的文件，几个浏览器共用一套模型配置靠的就是它；导出的备份仍不含）。
// 几个浏览器共用一份，靠的是「基准」：记着上次与磁盘对齐时的那一份（configBase，连同它在磁盘上的时间戳 configSyncedAt）。
// 写的时候带上这个时间戳，磁盘上若已有别处写过的更新的一份，桥接不写、把那份交回来；这边就按基准做三方合并——
// 自己改过的取自己的，没改的取对方的——再写一次。基准记在 localStorage 里，关了页面再开也接得上
const CONFIG_BASE_KEY = "yan-config-base";
let configBase = "",
  configSaving = false,
  configSaveAgain = false,
  configSaveFailures = 0;
function rememberConfigBase(meta, savedAt) {
  configBase = meta;
  configSyncedAt = savedAt;
  try {
    localStorage.setItem(CONFIG_BASE_KEY, JSON.stringify({ root: bootstrap.store?.root || "", savedAt, meta }));
  } catch {}
}
// 取回记着的基准：必须是同一个存储根的
function restoreConfigBase() {
  if (configBase) return;
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_BASE_KEY) || "null");
    if (saved?.meta && saved.root === (bootstrap.store?.root || "")) {
      const meta = JSON.parse(saved.meta);
      if (!meta || !meta.settings || typeof meta.settings !== "object" || !Array.isArray(meta.profiles)) return;
      configBase = String(saved.meta);
      configSyncedAt = Math.max(configSyncedAt, Number(saved.savedAt) || 0);
    }
  } catch {}
}
function scheduleConfigSave() {
  if (apiBase === null) return;
  clearTimeout(configSaveTimer);
  configSaveTimer = setTimeout(saveConfigNow, 1000);
}
/** @param {{ force?: boolean }} [options] force：不比时间戳，这边就是定论（头一回立根、以浏览器为准的导入） */
function saveConfigNow({ force = false } = {}) {
  clearTimeout(configSaveTimer);
  configSaveTimer = null;
  if (apiBase === null) return;
  // 上一次还在路上：等它回来再写这一次，免得两次互相比时间戳
  if (configSaving && !unloading) {
    configSaveAgain = true;
    return;
  }
  const meta = JSON.stringify(metaOf()),
    savedAt = Math.max(Date.now(), configSyncedAt + 1),
    body = `{"config":${meta},"savedAt":${savedAt}${force ? "" : `,"base":${configSyncedAt}`}}`;
  configSaving = true;
  // 页面要关时用 keepalive 送出去（浏览器只给它 64 KB 的余地；配置一般远小于此，超了就随它去，下次开页再推）
  fetch(`${apiBase}/api/store/config/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: unloading && body.length < 60000,
    signal: unloading ? undefined : AbortSignal.timeout(20000)
  })
    .then(async response => {
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.config) return reconcileConfig(data.config, Number(data.savedAt) || 0);
      if (!response.ok) throw Error(data.error || `请求失败（${response.status}）`);
      configSaveFailures = 0;
      rememberConfigBase(meta, Number(data.savedAt) || savedAt);
    })
    .catch(error => {
      if (unloading) return;
      if (!configSaveFailures) toast(`配置尚未写入存储目录，稍后重试：${String(error.message || error).slice(0, 60)}`);
      configSaveFailures += 1;
      clearTimeout(configSaveTimer);
      configSaveTimer = setTimeout(saveConfigNow, Math.min(5000 * 2 ** Math.min(configSaveFailures - 1, 4), 60000));
    })
    .finally(() => {
      configSaving = false;
      if (configSaveAgain) {
        configSaveAgain = false;
        saveConfigNow();
      }
    });
}
// 磁盘上有一份配置：与这边对一对。磁盘上的不比基准新——这边改过就写下去；磁盘上的更新、这边没改过——换进来；
// 两边都改过——三方合并后换进来，再写回去
function reconcileConfig(config, savedAt) {
  // 基准丢了就无法判断本地缓存的默认值是不是用户刚改的。磁盘是正本；只补入本地独有的记录，
  // 再以磁盘为基准写回，免得把已装工具、模型等配置退回默认值。
  if (!configBase) return mergeUnbasedConfig(config, savedAt);
  const mine = JSON.stringify(metaOf()),
    changed = mine !== configBase;
  if (savedAt <= configSyncedAt) {
    if (changed) saveConfigNow();
    return;
  }
  if (!changed) return adoptConfig(config, savedAt);
  const theirs = metaOf(normalizeStoreData({ ...config, conversations: [] }));
  adoptConfig(mergeConfig3(configBase ? JSON.parse(configBase) : {}, JSON.parse(mine), theirs), savedAt, JSON.stringify(theirs));
  saveConfigNow();
}
// 三方合并：base 是上次对齐时的那份。同一样东西，自己没动过的取对方的，自己动过的取自己的；
// 模型、卷宗、记忆按 id 逐件比，设置与草稿按键逐项比；两边各自花掉的用量相加，不互相抹掉
function mergeConfig3(base, mine, theirs) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const keyed = (b, m, t, pick = (bv, mv, tv) => (same(mv, bv) ? tv : mv)) => {
    b ||= {};
    m ||= {};
    t ||= {};
    const out = {};
    for (const key of new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(b)])) {
      const inB = key in b,
        inM = key in m,
        inT = key in t;
      if (inM && inT) out[key] = pick(b[key], m[key], t[key]);
      else if (inM && (!inB || !same(b[key], m[key])))
        out[key] = m[key]; // 自己新加的，或对方删了而自己又改过的
      else if (inT && (!inB || !same(b[key], t[key]))) out[key] = t[key]; // 对方新加的，或自己删了而对方又改过的
    }
    return out;
  };
  const byId = (b, m, t, pick) => {
    const index = list => new Map((Array.isArray(list) ? list : []).filter(item => item?.id).map(item => [item.id, item]));
    const merged = keyed(Object.fromEntries(index(b)), Object.fromEntries(index(m)), Object.fromEntries(index(t)), pick);
    // 顺序：对方的在前（它的排序为准），自己新加的接在后面
    const order = [...index(t).keys(), ...index(m).keys()];
    return [...new Set(order)].filter(id => id in merged).map(id => merged[id]);
  };
  const mergeProfile = (b, m, t) => {
    if (same(m, b)) return t;
    const out = keyed(b, m, t);
    // 用量两边各自往上加：合并时把两边新花的都记上（额度改过的一边会把用量清零，那时按合并的结果算）
    if (b && same(m.quota, b.quota) && same(t.quota, b.quota))
      out.usedTokens = Math.max(0, Number(m.usedTokens || 0) + Number(t.usedTokens || 0) - Number(b.usedTokens || 0));
    return out;
  };
  const baseSettings = base.settings || {},
    mineSettings = mine.settings || {},
    theirSettings = theirs.settings || {},
    settings = keyed(baseSettings, mineSettings, theirSettings),
    has = key => key in baseSettings || key in mineSettings || key in theirSettings;
  if (has("presets"))
    settings.presets = byId(baseSettings.presets, mineSettings.presets, theirSettings.presets, (b, m, t) => keyed(b, m, t));
  if (has("groups")) settings.groups = byId(baseSettings.groups, mineSettings.groups, theirSettings.groups, (b, m, t) => keyed(b, m, t));
  if (has("mcpServers")) settings.mcpServers = keyed(baseSettings.mcpServers, mineSettings.mcpServers, theirSettings.mcpServers);
  if (has("env")) {
    const oldEnv = { ...defaultStore.settings.env, ...(baseSettings.env || {}) },
      myEnv = mineSettings.env || {},
      theirEnv = theirSettings.env || {};
    settings.env = keyed(oldEnv, myEnv, theirEnv);
    // 勾选清单按每一组的增删合并：两处各添一组，不会让后写者把先写者的整份清单替掉。
    const oldPacks = new Set(oldEnv.packs || []),
      myPacks = new Set(myEnv.packs || []),
      theirPacks = new Set(theirEnv.packs || []);
    settings.env.packs = [...new Set([...theirPacks, ...myPacks])].filter(id =>
      (myPacks.has(id) !== oldPacks.has(id) ? myPacks : theirPacks).has(id)
    );
  }
  return {
    version: theirs.version ?? mine.version,
    settings,
    profiles: byId(base.profiles, mine.profiles, theirs.profiles, mergeProfile),
    library: byId(base.library, mine.library, theirs.library),
    memory: {
      enabled: same(mine.memory?.enabled, base.memory?.enabled) ? theirs.memory?.enabled : mine.memory?.enabled,
      items: byId(base.memory?.items, mine.memory?.items, theirs.memory?.items)
    },
    drafts: keyed(base.drafts, mine.drafts, theirs.drafts)
  };
}
// 磁盘上的一份配置换进来：设置、模型、卷宗、记忆、草稿；这台浏览器自己的对话目录暂存与墓碑不动。
// base：记作基准的那一份（默认就是换进来的这份；合并时是对方那份，自己改的仍算「改过」，写下去之前丢不了）
function adoptConfig(config, savedAt, base = "") {
  const meta = normalizeStoreData({ ...config, conversations: [] });
  store.settings = meta.settings;
  store.profiles = meta.profiles;
  store.library = meta.library;
  store.memory = meta.memory;
  store.drafts = meta.drafts;
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
  metaRevision = Math.max(metaRevision, savedAt);
  const adopted = JSON.stringify(metaOf());
  rememberConfigBase(base || adopted, savedAt);
  metaHash = hashText(adopted);
  writeMeta({ disk: false });
  applyAppearance();
  renderHeader();
  renderHistory();
  renderQuota();
  if (!$("#settingsModal").classList.contains("hidden")) renderSettings();
}
// 这台浏览器头一回碰上这个存储根、两边又各有一套：并起来——同一 id 的以磁盘上的为准，这边独有的模型、记忆、卷宗、草稿补进去
function mergeConfig(config) {
  const disk = normalizeStoreData({ ...config, conversations: [] }),
    union = (theirs, mine) => [...theirs, ...mine.filter(item => !theirs.some(other => other.id === item.id))];
  store.settings = {
    ...store.settings,
    ...disk.settings,
    // 旧版磁盘配置根本没有「环境」项时，别让规范化补出的默认三组盖掉本地已有选择。
    env: config.settings?.env && typeof config.settings.env === "object" ? disk.settings.env : store.settings.env || disk.settings.env,
    presets: union(disk.settings.presets, store.settings.presets || []),
    groups: union(disk.settings.groups, store.settings.groups || []),
    mcpServers: { ...(store.settings.mcpServers || {}), ...(disk.settings.mcpServers || {}) }
  };
  store.profiles = union(disk.profiles, store.profiles);
  store.library = union(disk.library, store.library);
  store.memory = { enabled: disk.memory.enabled, items: union(disk.memory.items, store.memory.items) };
  store.drafts = { ...store.drafts, ...disk.drafts };
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
}
// 没有可用的共同基准（旧版缓存、浏览器只丢了基准、头一回碰到另一个存储根）时，
// 让磁盘上的设置优先，按 id 补入本地独有的记录；差集仍用时间戳保护后写。
function mergeUnbasedConfig(config, savedAt) {
  const disk = JSON.stringify(metaOf(normalizeStoreData({ ...config, conversations: [] })));
  mergeConfig(config);
  const merged = metaOf();
  adoptConfig(merged, savedAt, disk);
  if (JSON.stringify(metaOf()) !== disk) saveConfigNow();
}
const STORE_ROOT_KEY = "yan-store-root";
// 与 配置.json 对一次：开页接上桥接时、桥接断了又接上时、页面从后台切回来时。
// 存储根头一回立起来：先把旧的对话与卷宗拷进来（旧处留着）。然后看两边谁新：
// 全新的浏览器取磁盘那份；灌进来的（没带版本标记的旧记录）以浏览器为准；这台浏览器头一回碰上这个根就合并；其余按时间戳，新的为准
async function syncConfigWithDisk() {
  if (apiBase === null) return;
  const info = bootstrap.store || {};
  let met = "";
  try {
    met = localStorage.getItem(STORE_ROOT_KEY) || "";
  } catch {}
  // 桥接落在一个全新的根上，这台浏览器上回用的却是别处：多半是记位置的条子没了，说一声，免得以为数据丢了
  const strayed = info.fresh && met && met.toLowerCase() !== String(info.root || "").toLowerCase();
  try {
    // 根头一回立起来，或这台浏览器还记着旧版自己的对话 / 卷宗目录（另一个浏览器先立了根）：把旧的拷进来，只补缺的、不覆盖
    if (info.fresh || store.settings.chatsDir || store.settings.archiveDir) {
      const moved = await bridge(
        "/api/store/adopt",
        { chatsDir: store.settings.chatsDir || "", archiveDir: store.settings.archiveDir || "" },
        AbortSignal.timeout(600000)
      );
      info.fresh = false;
      if (moved.chats || moved.archive) toast(`旧的对话与卷宗已拷进 ${pathTail(info.root || "")}；旧处原样留着`);
    }
    const disk = await bridge("/api/store/config/load", {}, AbortSignal.timeout(20000));
    delete store.settings.chatsDir;
    delete store.settings.archiveDir;
    restoreConfigBase();
    if (!disk.config) {
      writeMeta({ disk: false });
      saveConfigNow({ force: true });
    } else if (freshBrowser) adoptConfig(disk.config, Number(disk.savedAt) || 0);
    else if (localSeeded || met !== (info.root || "")) mergeUnbasedConfig(disk.config, Number(disk.savedAt) || 0);
    else reconcileConfig(disk.config, Number(disk.savedAt) || 0);
    freshBrowser = localSeeded = false;
    try {
      localStorage.setItem(STORE_ROOT_KEY, info.root || "");
    } catch {}
    if (strayed) toast(`存储落在了 ${pathTail(info.root || "")}，上回用的是 ${met}；在设置 → 通用的「存储位置」填回去即可`, 8000);
  } catch (error) {
    toast(`配置未能与存储目录对齐：${String(error.message || error).slice(0, 60)}`);
  }
}
// 从后台切回来：另一个浏览器可能改过配置，与磁盘上的对一对（这边有没写下去的改动也不丢，见 reconcileConfig）
async function refreshConfigFromDisk() {
  if (apiBase === null || configSaving) return;
  try {
    const disk = await bridge("/api/store/config/load", {}, AbortSignal.timeout(8000));
    if (disk.config && !configSaving) reconcileConfig(disk.config, Number(disk.savedAt) || 0);
  } catch {}
}

  // ---- 01-store/30-chats.js ----
// 言 · 本地存储 · 对话：一段一个文件落进对话目录，脏标记、落盘、巡检与读回
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 对话目录可用：桥接在线、桥接报了目录、上次读它没出错
function chatsOnline() {
  return apiBase !== null && !!chatsDir() && !chatsBroken;
}
function chatsDir() {
  if (apiBase === null) return "";
  return bootstrap.work?.chats || "";
}
// 标记这段对话有改动（改名、置顶、后台一答收尾这些不在「当前对话」上的改动要亲手标；当前这段与正在生成的自动算在内）
function markDirty(id) {
  if (id) dirtyChatIds.add(id);
}
// 这边正在写它：作答、拟题、压缩中
function busyHere(id) {
  return conversationRunning(id) || titlingIds.has(id) || compactingIds.has(id);
}
function conversationsToSave() {
  const ids = new Set(dirtyChatIds);
  if (currentId) ids.add(currentId);
  for (const [key, job] of requestJobs) ids.add(job.conversationId || key);
  for (const id of titlingIds) ids.add(id);
  for (const id of compactingIds) ids.add(id);
  return ids;
}
function nextChatStamp(id) {
  const stamp = Math.max(Date.now(), (chatStamps.get(id) || 0) + 1);
  chatStamps.set(id, stamp);
  return stamp;
}
// 把这几段排进写队列。这里故意不 stringify：流式期间 saveStore 每 300ms 会来一次，真正到落盘间隔时才复制整段，
// 这样长对话不会为了最后几个字反复序列化；同一段正在写时也只留一个「再看一次最新状态」的记号。
function flushConversations(ids, { force = false } = {}) {
  for (const id of ids) {
    // 别处正作答的不写：磁盘上那份由它写，这边只跟着看
    if (deletedChatIds.has(id) || runningElsewhere(id) || !store.conversations.some(item => item.id === id)) continue;
    const queued = pendingChatWrites.get(id);
    pendingChatWrites.set(id, { force: force || !!queued?.force });
  }
  void drainChatWrites();
}
function drainChatWrites() {
  for (const id of pendingChatWrites.keys()) {
    if (deletedChatIds.has(id) || chatWritePromises.has(id)) continue;
    const task = writeConversation(id).finally(() => {
      if (chatWritePromises.get(id) === task) chatWritePromises.delete(id);
      if (pendingChatWrites.has(id) && !deletedChatIds.has(id)) drainChatWrites();
    });
    chatWritePromises.set(id, task);
  }
}
async function writeConversation(id) {
  while (pendingChatWrites.has(id) && !deletedChatIds.has(id)) {
    // 先等、后 stringify。生成中三秒一份，收尾与普通编辑最多等一秒多；离页另有同步入 IndexedDB 的兜底，不靠这里抢时间。
    const interval = busyHere(id) ? CHAT_STREAM_DISK_INTERVAL : CHAT_DISK_INTERVAL,
      wait = unloading ? 0 : interval - (performance.now() - (chatDiskWrites.get(id) || -interval));
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    if (deletedChatIds.has(id)) break;
    const queued = pendingChatWrites.get(id);
    pendingChatWrites.delete(id);
    const conversation = store.conversations.find(item => item.id === id);
    if (!conversation) continue;
    const json = JSON.stringify(conversation),
      hash = hashText(json);
    if (!queued?.force && chatHashes.get(id) === hash) {
      if (!pendingChatWrites.has(id)) dirtyChatIds.delete(id);
      continue;
    }
    const pending = { json, hash, savedAt: nextChatStamp(id), title: conversation.title };
    activeChatWrites.set(id, pending);
    chatDiskWrites.set(id, performance.now());
    // 目录在线：先落盘；写成了表里的暂存就没用了。落盘不成（桥接刚停了）就暂存进表里，接上后再推
    let spilled = !chatsOnline(),
      persisted = false;
    if (!spilled)
      try {
        await bridge(
          "/api/chats/save",
          { root: chatsDir(), savedAt: pending.savedAt, base: chatDiskStamps.get(id) || 0, conversation: JSON.parse(pending.json) },
          AbortSignal.timeout(60000)
        );
        chatDiskStamps.set(id, pending.savedAt);
        chatSaveWarned = false;
        if (!deletedChatIds.has(id)) {
          persisted = true;
          // pagehide 已把最新状态写进表时，旧的在途请求即使成功也不能把那份离页兜底删掉。
          if (!unloading && !pendingChatWrites.has(id))
            await stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.delete(id)).catch(() => {});
        }
      } catch (error) {
        // 目录里那份比这边上次见过的新（别处写过）：两份并起来，下一轮带着新的时间戳再写
        if (error.status === 409 && error.data?.item && !deletedChatIds.has(id)) {
          activeChatWrites.delete(id);
          catchUpConversation(error.data.item);
          continue;
        }
        // 迟到的旧保存撞上了别处的删除：不暂存、不复活，这边也跟着拿掉
        if (/已在别处删除/.test(String(error.message))) {
          activeChatWrites.delete(id);
          store.conversations = store.conversations.filter(item => item.id !== id);
          forgetConversation(id);
          if (currentId === id) {
            currentId = null;
            render();
          } else renderHistory();
          return;
        }
        spilled = true;
        if (!chatSaveWarned) {
          chatSaveWarned = true;
          toast(`对话未能落盘，先暂存在浏览器里：${String(error.message || error).slice(0, 60)}`);
        }
      }
    if (spilled && !deletedChatIds.has(id))
      try {
        await stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.put({ id, savedAt: pending.savedAt, json: pending.json }));
        persisted = true;
        if (!chatsOnline()) chatSaveWarned = false;
      } catch {
        if (!chatSaveWarned) {
          chatSaveWarned = true;
          toast("本机对话存储失败，请先导出备份");
        }
      }
    if (activeChatWrites.get(id) === pending) activeChatWrites.delete(id);
    if (persisted && !deletedChatIds.has(id)) {
      chatHashes.set(id, hash);
      if (!pendingChatWrites.has(id)) dirtyChatIds.delete(id);
    }
  }
}
// 删一段：先立墓碑并等已经发出的保存收尾，再删文件，保证「旧保存」绝不可能排在删除之后把它复活。
// 墓碑先写进配置；哪怕这时桥接已断，下次接上也会先补删，不会从目录把它捡回来。
async function deleteConversationStorage(id) {
  deletedChatIds.add(id);
  pendingChatDeletes.add(id);
  pendingChatWrites.delete(id);
  dirtyChatIds.delete(id);
  writeMeta();
  try {
    await chatWritePromises.get(id)?.catch(() => {});
    pendingChatWrites.delete(id);
    activeChatWrites.delete(id);
    await stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.delete(id)).catch(() => {});
    if (!chatsOnline()) return;
    try {
      await bridge("/api/chats/delete", { root: chatsDir(), id }, AbortSignal.timeout(20000));
      pendingChatDeletes.delete(id);
      writeMeta();
    } catch {}
  } finally {
    chatHashes.delete(id);
    chatStamps.delete(id);
    chatDiskStamps.delete(id);
    deletedChatIds.delete(id);
  }
}
// 别处删掉的一段：这边只从内存与暂存表里拿掉，目录那头已经删过了（附件原件那边也删过了）
function forgetConversation(id) {
  pendingChatWrites.delete(id);
  dirtyChatIds.delete(id);
  chatHashes.delete(id);
  chatStamps.delete(id);
  chatDiskStamps.delete(id);
  delete store.drafts?.[id];
  void stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.delete(id)).catch(() => {});
}
// 目录里有一份比这边新的（别处写过）。这边手上的已落过盘、之后没再动过，直接换上；
// 否则（这边改过、正写着、或只暂存在浏览器里）两份并起来再写回去，谁写的都不丢。返回换上的那份；quiet：调用方自己重画
function catchUpConversation(item, { quiet = false } = {}) {
  const index = store.conversations.findIndex(c => c.id === item.id);
  if (index < 0) return null;
  const c = store.conversations[index],
    theirs = normalizeConversation(item.conversation),
    theirJson = JSON.stringify(theirs),
    stamp = chatStamps.get(c.id) || 0,
    clean = chatHashes.get(c.id) === hashText(JSON.stringify(c)) && chatDiskStamps.get(c.id) === stamp && !busyHere(c.id),
    next = clean ? theirs : mergeConversation(c, theirs);
  store.conversations[index] = next;
  chatDiskStamps.set(c.id, item.savedAt);
  chatStamps.set(c.id, Math.max(stamp, item.savedAt));
  if (JSON.stringify(next) === theirJson) {
    chatStamps.set(c.id, item.savedAt);
    chatHashes.set(c.id, hashText(theirJson));
  } else {
    // 并出来的与目录里的不一样：要写回去（chatHashes 不动，下一趟写时指纹对不上，自然会写）
    // 别处正作答的等它松手再写（脏标记留着，见 flushConversations）
    markDirty(c.id);
    if (!runningElsewhere(c.id)) pendingChatWrites.set(c.id, { force: true });
    // 这边有、目录里没有的内容接了进去，才值得说一声（只差个未读标记之类的不算）
    const grew = ["messages", "forks", "threads"].some(key => next[key].length > theirs[key].length);
    if (grew && !mergeNoticed) toast("这段对话在另一处也写过，两边的内容已并在一起");
    mergeNoticed ||= grew;
  }
  if (!quiet) {
    if (c.id === currentId && view === "chat") renderConversation(false);
    renderHistory();
  }
  return next;
}
let mergeNoticed = false;
// 两份并一份：以目录里那份为底，这边有、那边没有的消息（分支、旁注同理）接在后面，宁可多留一条也不丢。
// 两边都有的同一条：这边正写着这段就取这边的（原地改，作答中的引用不断），否则取那边的——那边的更新
function mergeConversation(c, theirs) {
  const mine = busyHere(c.id),
    union = (a = [], b = []) => {
      const own = new Map(a.filter(x => x?.id).map(x => [x.id, x])),
        seen = new Set(b.map(x => x?.id));
      return [...b.map(x => (mine && own.get(x?.id)) || x), ...a.filter(x => !seen.has(x?.id))];
    },
    messages = union(c.messages, theirs.messages),
    forks = union(c.forks, theirs.forks),
    threads = union(c.threads, theirs.threads);
  if (mine) {
    c.messages.splice(0, c.messages.length, ...messages);
    c.forks = forks;
    c.threads = threads;
    return c;
  }
  // 未读只是这一处的提示：开着看的这段不因为并了一份又亮起来
  return {
    ...theirs,
    messages,
    forks,
    threads,
    ...(c.unread !== theirs.unread ? { unread: c.unread } : {}),
    ...(messages.length > theirs.messages.length && c.updatedAt > theirs.updatedAt ? { updatedAt: c.updatedAt } : {})
  };
}
// 跟上目录里的这几段：页面切回前台时看的那段。只读这几个文件，便宜
async function catchUpFromDisk(ids) {
  if (!chatsOnline() || !ids.length) return;
  try {
    const data = await bridge("/api/chats/load", { root: chatsDir(), ids }, AbortSignal.timeout(8000));
    for (const item of data.items || [])
      if (item.savedAt > (chatDiskStamps.get(item.id) || 0) && !runningElsewhere(item.id) && !deletedChatIds.has(item.id))
        catchUpConversation(item);
    drainChatWrites();
  } catch {}
}
// 全量巡检：每段都算一遍指纹，变了的写下去。低频跑（定时、页面要关时），哪处改了没标脏也兜得住
function sweepConversations() {
  flushConversations(store.conversations.map(c => c.id));
}
// 页面要关了：不再新发普通 fetch（卸载时它不可靠），而是在一个同步开启的 IndexedDB 事务里把所有未落稳的最新状态兜住；
// 包括已经从待写表拿走、正在 fetch 的那份。下次开页若它比目录新，会自动推回目录。
function flushOnUnload() {
  if (unloading) return;
  unloading = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeMeta({ disk: false });
  if (configSaveTimer) saveConfigNow();
  const db = stateDb;
  if (!db) return;
  const records = [];
  for (const conversation of store.conversations) {
    if (deletedChatIds.has(conversation.id)) continue;
    const json = JSON.stringify(conversation),
      hash = hashText(json);
    if (!pendingChatWrites.has(conversation.id) && !activeChatWrites.has(conversation.id) && chatHashes.get(conversation.id) === hash)
      continue;
    records.push({ id: conversation.id, savedAt: nextChatStamp(conversation.id), json });
  }
  if (!records.length) return;
  try {
    const table = db.transaction(CHATS_STORE_NAME, "readwrite").objectStore(CHATS_STORE_NAME);
    for (const record of records) table.put(record);
  } catch {}
}
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = null;
  writeMeta();
  flushConversations(conversationsToSave());
}
function saveStoreSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveStore, 300);
}
// 表里读回一段：记下它的时间戳与指纹
function adoptRecord(record) {
  try {
    const c = normalizeConversation(JSON.parse(record.json));
    chatStamps.set(c.id, Number(record.savedAt) || 0);
    chatHashes.set(c.id, hashText(JSON.stringify(c)));
    return c;
  } catch {
    return null;
  }
}
// 启动：配置从 localStorage 来，对话从 IndexedDB 的表里来；旧版整份记录（localStorage 或表里的 main 记录）先拆开迁走。
// 桥接接上后再与对话目录合一次（见 syncChatsWithDisk）
async function hydrateStore() {
  const local = readLocalStoreRecord();
  freshBrowser = !local;
  localSeeded = !!local && !local.managed;
  for (const id of local?.pendingDeletes || []) pendingChatDeletes.add(id);
  // 开页时的配置就是 localStorage 里那份：记下指纹，没改动时不去写 配置.json
  metaHash = hashText(JSON.stringify(metaOf()));
  let db = null;
  try {
    db = await openStateDb();
  } catch {
    // IndexedDB 不可用：只剩 localStorage 里的配置；对话要等桥接接上从目录里来
    return;
  }
  let legacy = null;
  try {
    legacy = await dbRequest(db, STATE_STORE_NAME, "readonly", s => s.get(STATE_RECORD_KEY));
  } catch {}
  metaRevision = Math.max(Number(legacy?.revision) || 0, local?.revision || 0, Date.now());
  if (!local?.split) {
    // 旧版：整份记录在 localStorage（没标记的是更老的版本或测试灌的数据）与 / 或表里的 main 记录，按原来的规矩取一份
    const localWins =
      !!local && (!local.managed || !legacy || (!local.dbOnly && Number(local.revision || 0) >= Number(legacy.revision || 0)));
    let full = localWins ? local?.data : null;
    if (!full && legacy?.json)
      try {
        full = JSON.parse(legacy.json);
      } catch {}
    if (full) {
      store = normalizeStoreData(full);
      // 旧记录是那时的全部：表里的对话以它为准，时间戳按它上次保存的算——别拿开页的时刻冒充，免得盖掉目录里更新的
      const stamp = (localWins ? local?.revision : Number(legacy?.revision)) || Date.now();
      try {
        await dbBatch(db, CHATS_STORE_NAME, s => {
          s.clear();
          for (const c of store.conversations) {
            const json = JSON.stringify(c);
            chatStamps.set(c.id, stamp);
            chatHashes.set(c.id, hashText(json));
            s.put({ id: c.id, savedAt: stamp, json });
          }
        });
        await dbRequest(db, STATE_STORE_NAME, "readwrite", s => s.delete(STATE_RECORD_KEY)).catch(() => {});
      } catch {}
      writeMeta();
    }
  }
  if (local?.split || !store.conversations.length) {
    let records = [];
    try {
      records = await dbRequest(db, CHATS_STORE_NAME, "readonly", s => s.getAll());
    } catch {}
    const known = new Set(store.conversations.map(c => c.id));
    for (const record of records) {
      const c = adoptRecord(record);
      if (c && !known.has(c.id)) store.conversations.push(c);
    }
  }
  // 尽量让浏览器把这份本机数据视作持久存储；不支持或不准时静默退回普通 IndexedDB
  try {
    const persistence = navigator.storage?.persist?.();
    persistence?.catch?.(() => {});
  } catch {}
}
// 与对话目录合一次：开页接上桥接时、桥接中途断了又接上时都来一遍。
// 目录里没有的推过去，目录里更新的换进来（正在生成的、改了还没存的不换），两边一样的把表里的暂存清掉；先前没删成的补删
async function syncChatsWithDisk() {
  if (apiBase === null || !chatsDir() || chatsSyncing) return;
  chatsSyncing = true;
  try {
    const data = await bridge("/api/chats/load", { root: chatsDir() }, AbortSignal.timeout(120000));
    chatsBroken = false;
    chatsLoaded = true;
    for (const id of [...pendingChatDeletes]) {
      // 当前页刚删、却还有旧保存正在收尾的，由 deleteConversationStorage 等完后亲自再删；这里抢先删会留下 save-after-delete 的窗口。
      if (deletedChatIds.has(id)) continue;
      try {
        await bridge("/api/chats/delete", { root: chatsDir(), id }, AbortSignal.timeout(20000));
        pendingChatDeletes.delete(id);
      } catch {}
    }
    const disk = new Map();
    for (const item of data.items || []) if (item?.id && !pendingChatDeletes.has(item.id)) disk.set(item.id, item);
    const push = new Set(),
      settled = new Set(),
      gone = data.deleted && typeof data.deleted === "object" ? data.deleted : {};
    let changed = false,
      currentReplaced = false,
      dropped = 0;
    store.conversations = store.conversations
      .map(c => {
        const item = disk.get(c.id),
          stamp = chatStamps.get(c.id) || 0,
          hash = hashText(JSON.stringify(c)),
          unsaved = chatHashes.get(c.id) !== hash,
          busy = busyHere(c.id);
        if (!item) {
          // 别处删了、这边又没再动过：跟着删，不推回去让它复活；这边删后又说过话的，照推（桥接那头按时间认）
          if (Number(gone[c.id]) > stamp && !unsaved && !busy) {
            forgetConversation(c.id);
            changed = true;
            dropped += 1;
            return null;
          }
          push.add(c.id);
          return c;
        }
        // 目录里的更新：这边没动过的换上，动过的并起来（见 catchUpConversation）
        if (item.savedAt > stamp) {
          const next = catchUpConversation(item, { quiet: true });
          (chatHashes.get(c.id) === hashText(JSON.stringify(next)) ? settled : push).add(c.id);
          changed = true;
          if (c.id === currentId) currentReplaced = true;
          return next;
        }
        // 这边的不比目录里的旧：以这边的为准写过去（带上目录里那份的时间戳，免得被当成旧份拒掉）
        chatDiskStamps.set(c.id, item.savedAt);
        if (item.savedAt < stamp || unsaved || hashText(JSON.stringify(normalizeConversation(item.conversation))) !== hash) push.add(c.id);
        else settled.add(c.id);
        return c;
      })
      .filter(Boolean);
    if (dropped) toast(dropped === 1 ? "有一段对话已在别处删除，此处随之移去" : `有 ${dropped} 段对话已在别处删除，此处随之移去`);
    const known = new Set(store.conversations.map(c => c.id));
    for (const item of disk.values())
      if (!known.has(item.id)) {
        const c = normalizeConversation(item.conversation);
        chatStamps.set(c.id, item.savedAt);
        chatDiskStamps.set(c.id, item.savedAt);
        chatHashes.set(c.id, hashText(JSON.stringify(c)));
        store.conversations.push(c);
        settled.add(c.id);
        changed = true;
      }
    for (const id of settled) void stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.delete(id)).catch(() => {});
    if (push.size) flushConversations(push, { force: true });
    writeMeta({ disk: false });
    if (changed) {
      renderHeader();
      renderHistory();
      if (currentReplaced && view === "chat") renderConversation(false);
      if (currentId && !known.has(currentId) && !store.conversations.some(c => c.id === currentId)) {
        currentId = null;
        render();
      }
    }
    // 对话读全了：浏览器里暂存的附件原件推进目录，没人用的清掉
    void settleAttachmentStore();
  } catch (error) {
    chatsBroken = true;
    toast(`对话目录不可用，先存在浏览器里：${String(error.message || error).slice(0, 60)}`);
  } finally {
    chatsSyncing = false;
  }
}

  // ---- 01-store/40-leases.js ----
// 言 · 本地存储 · 租约：几处页面同开时谁在作答
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 几处页面同开：谁在作答 ----------
// 两个浏览器、VS Code 与浏览器同开同一个存储时，各页只知道自己在跑什么：那边正作答的一段，这边刷新后读到的是磁盘上「生成中」的快照，
// 从前会当成页面刷新而中断、写回磁盘，两边轮流互盖，这边再点「继续生成」就成了两处同写一条回复。
// 现在每隔几秒向桥接报到一次：报的是这边正作答的（以及作答完、最后一次存盘还没落地的）对话，回来的是别处正作答的。
// 别处正作答的那几段，这边只看不动：不当成中断、不存盘、不让发问与改动，每次报到顺带从磁盘读回最新进度；
// 别处松了手（写完，或页面关了、崩了，十五秒没来报到），再读一回：还停在「生成中」的，才按中断处理
let leasing = null;
function syncLeases() {
  if (apiBase === null || !chatsOnline()) return Promise.resolve();
  if (leasing) return leasing;
  // 正作答的都算上（旁注的作业按它所在的对话记）；作答完了、最后一次存盘也落了地的松手
  const running = new Set([...requestJobs].map(([key, job]) => job.conversationId || key));
  for (const id of running) leaseHold.add(id);
  for (const id of [...leaseHold]) if (!running.has(id) && !chatWritePromises.has(id) && !pendingChatWrites.has(id)) leaseHold.delete(id);
  leasing = bridge("/api/chats/lease", { owner: PAGE_ID, ids: [...leaseHold] }, AbortSignal.timeout(5000))
    .then(async ({ busy = [] }) => {
      const released = [...remoteBusy].filter(id => !busy.includes(id));
      remoteBusy.clear();
      for (const id of busy) remoteBusy.add(id);
      const follow = [...remoteBusy, ...released].filter(id => store.conversations.some(c => c.id === id));
      if (follow.length) await followConversations(follow, released);
      if (currentId && (remoteBusy.has(currentId) || released.includes(currentId))) {
        renderSendButtons();
        refreshConnection();
      }
    })
    .catch(() => {})
    .finally(() => (leasing = null));
  return leasing;
}
// 页面要关或刷新：先松手。不然刷新后的自己会把刷新前的自己当成「别处在作答」，停在半途的那一答就不收束了
function releaseLeases() {
  if (apiBase === null || !leaseHold.size) return;
  leaseHold.clear();
  fetch(`${apiBase}/api/chats/lease`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: PAGE_ID, ids: [] }),
    keepalive: true
  }).catch(() => {});
}
/** 别处正作答（或刚松手）的几段：磁盘上的更新就换进来；刚松手的若仍停在「生成中」，那边是没写完就走了，按中断收束 */
async function followConversations(ids, released) {
  const data = await bridge("/api/chats/load", { root: chatsDir(), ids }, AbortSignal.timeout(20000));
  let current = false;
  for (const item of data.items || []) {
    if (!store.conversations.some(c => c.id === item.id) || item.savedAt <= (chatStamps.get(item.id) || 0) || conversationRunning(item.id))
      continue;
    catchUpConversation(item, { quiet: true });
    if (item.id === currentId) current = true;
  }
  for (const id of released) {
    const c = store.conversations.find(item => item.id === id);
    if (c && !conversationRunning(id) && recoverConversation(c)) {
      markDirty(id);
      saveStoreSoon();
      if (id === currentId) current = true;
    }
  }
  renderHistory();
  if (current && view === "chat") renderConversation(false);
}
/** 这边跟着看、别处正作答：只看不动 */
function runningElsewhere(id = currentId) {
  return !!id && remoteBusy.has(id) && !conversationRunning(id);
}

  // ---- 01-store/50-attachments.js ----
// 言 · 本地存储 · 附件原件：存储根的 附件/ 与本机 IndexedDB 暂存
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
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
// ---------- 附件原件 ----------
// 桥接在线时落在存储根的 附件/（与对话、卷宗、配置同在一处，几个浏览器共用，复制即备份；见 server/files.js）；
// 没桥接、或落盘不成时暂存进这台浏览器的 IndexedDB，接上后推到目录里去、表里的清掉（见 settleAttachmentStore）。
// 读的时候先问目录，目录里没有再翻表——迁过去之前的旧件也读得到
const attachmentCache = new Map();
let attachmentCacheSize = 0;
// 最近读过的几件留在内存里：每发一问都要把历史里的附件翻一遍，不必回回经桥接取整份原件
function cacheAttachment(record) {
  if (!record?.id) return;
  uncacheAttachment(record.id);
  const size = String(record.data || "").length + String(record.extractedText || "").length;
  if (size > 16 * MB) return;
  attachmentCache.set(record.id, record);
  attachmentCacheSize += size;
  for (const [id] of attachmentCache) {
    if (attachmentCacheSize <= 64 * MB) break;
    uncacheAttachment(id);
  }
}
function uncacheAttachment(id) {
  const record = attachmentCache.get(id);
  if (!record) return;
  attachmentCache.delete(id);
  attachmentCacheSize -= String(record.data || "").length + String(record.extractedText || "").length;
}
async function putAttachment(record) {
  uncacheAttachment(record?.id);
  if (apiBase !== null)
    try {
      await bridge("/api/files/put", { record }, AbortSignal.timeout(120000));
      return;
    } catch {}
  return fileStoreRequest("readwrite", db => db.put(record));
}
async function getAttachment(id) {
  if (!id) return null;
  if (attachmentCache.has(id)) return attachmentCache.get(id);
  let record = null;
  if (apiBase !== null)
    try {
      record = (await bridge("/api/files/get", { id }, AbortSignal.timeout(60000))).record || null;
    } catch {}
  if (!record) record = (await fileStoreRequest("readonly", db => db.get(id)).catch(() => null)) || null;
  cacheAttachment(record);
  return record;
}
function deleteAttachment(id) {
  thumbCache.delete(id);
  uncacheAttachment(id);
  if (!id) return Promise.resolve();
  return Promise.all([
    apiBase !== null ? bridge("/api/files/delete", { ids: [id] }, AbortSignal.timeout(20000)).catch(() => {}) : null,
    fileStoreRequest("readwrite", db => db.delete(id)).catch(() => {})
  ]);
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
// 仍在用的附件：各段对话（含换下的版本、旁注、行迹里补言带的）、草稿、案上待发的、浏览器内的卷宗
function attachmentKeepIds() {
  const ids = new Set();
  const add = files => {
    for (const file of files || []) if (file?.id) ids.add(file.id);
  };
  for (const c of store.conversations) {
    for (const m of allMessages(c)) {
      add(m.attachments);
      for (const step of allSteps(m)) add(step.attachments);
    }
    for (const thread of c.threads || []) for (const m of thread.messages || []) add(m.attachments);
  }
  for (const value of Object.values(store.drafts || {})) add(value?.attachments);
  add(pendingAttachments);
  add(store.library);
  return ids;
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
  return attachmentKeepIds().has(id);
}
// 已收入卷宗的原件由卷宗管理，删除对话或移除待发附件时不会删掉它
async function deleteAttachments(ids) {
  // 调用方通常会在本轮同步代码里紧接着移除消息或草稿；等引用更新完再判断，既不误删共用原件，也不留下孤立数据。
  await Promise.resolve();
  const keep = attachmentKeepIds();
  await Promise.all([...new Set(ids)].filter(id => id && !keep.has(id)).map(deleteAttachment));
}
// 对话从目录读全之后（见 syncChatsWithDisk）才来这一趟：先把浏览器里暂存的原件推进目录、表里的清掉，再请桥接清掉目录里没人用的。
// 对话没读全时绝不清——那时内存里只有没落盘的几段，照它判「没人用」会把别的对话的附件一并删掉
let attachmentsSettling = false;
async function settleAttachmentStore() {
  if (apiBase === null || !chatsLoaded || attachmentsSettling) return;
  attachmentsSettling = true;
  try {
    let keys = [];
    try {
      keys = await fileStoreRequest("readonly", db => db.getAllKeys());
    } catch {}
    if (keys.length) {
      const { has = [] } = await bridge("/api/files/has", { ids: keys.map(String) }, AbortSignal.timeout(20000));
      const onDisk = new Set(has);
      for (const id of keys) {
        if (apiBase === null) return;
        if (!onDisk.has(String(id))) {
          const record = await fileStoreRequest("readonly", db => db.get(id)).catch(() => null);
          if (!record) continue;
          // 推不上去就留在表里，下回再推；推上去了才删表里的
          const pushed = await bridge("/api/files/put", { record }, AbortSignal.timeout(120000)).then(
            () => true,
            () => false
          );
          if (!pushed) continue;
        }
        await fileStoreRequest("readwrite", db => db.delete(id)).catch(() => {});
      }
    }
    if (apiBase !== null && chatsLoaded)
      await bridge("/api/files/clean", { keep: [...attachmentKeepIds()] }, AbortSignal.timeout(60000)).catch(() => {});
  } catch {
  } finally {
    attachmentsSettling = false;
  }
}

  // ---- 02-conversation.js ----
// 言 · 对话数据：分叉、模型、草稿
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 分叉：c.messages 始终是当前走的那条路；编辑或重答时被换下来的尾巴整段收进 c.forks（记下它接在哪条消息之后），随时可以切回来。
// 同一位置的几个版本 = 当前这条 + 接在同一位置的 forks，按首条消息的时间排序
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
  return store.profiles;
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
  if (view !== "chat") return;
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

  // ---- 03-brush.js ----
// 言 · 笔意图标：卷宗、设置入口与设置各栏的小画。一件是几笔墨、一点朱，不是等宽的线稿——
// 一笔是一串二次曲线（起点、控制点、终点、控制点、终点……），照「起笔顿、行笔匀、收笔出锋」的笔形铺成一片面。
// 页面里写 <svg data-brush="名字"></svg>，开页时由 paintBrushIcons 画上；设置里用 brushIcon(名字) 直接拼进 HTML。
// 落选的：等宽圆头的线稿加实心色块（UI 图标的画法，怎么减细节都偏卡通）

/**
 * 一笔。points 是 x0 y0 cx cy x1 y1 [cx cy x2 y2 …]；width 最粗处；tail 收笔处的粗细比（0 出锋，0.6 以上是顿笔收住）
 * @param {number[]} points
 * @param {number} width
 * @param {{ tail?: number, head?: number, tone?: "ink"|"ink2"|"zhu" }} [options]
 */
function brushStroke(points, width, { tail = 0, head = 0.78, tone = "ink" } = {}) {
  const samples = [];
  for (let i = 0; i + 4 < points.length; i += 4) {
    const [x0, y0, cx, cy, x1, y1] = points.slice(i, i + 6);
    for (let k = i ? 1 : 0; k <= 12; k++) {
      const t = k / 12,
        u = 1 - t;
      samples.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
    }
  }
  const lengths = [0];
  for (let i = 1; i < samples.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  const total = lengths.at(-1) || 1,
    shape = t => (t < 0.16 ? head + ((1 - head) * t) / 0.16 : t < 0.62 ? 1 : 1 - ((1 - tail) * (t - 0.62)) / 0.38),
    left = [],
    right = [];
  samples.forEach(([x, y], i) => {
    const [ax, ay] = samples[Math.max(0, i - 1)],
      [bx, by] = samples[Math.min(samples.length - 1, i + 1)],
      len = Math.hypot(bx - ax, by - ay) || 1,
      half = (width * shape(lengths[i] / total)) / 2,
      nx = -(by - ay) / len,
      ny = (bx - ax) / len;
    left.push([x + nx * half, y + ny * half]);
    right.push([x - nx * half, y - ny * half]);
  });
  // 起笔是个圆头：从右边绕回左边时往笔尖反方向鼓出去一点
  const [sx, sy] = samples[0],
    [tx, ty] = samples[1],
    back = Math.hypot(tx - sx, ty - sy) || 1,
    bulge = [sx - ((tx - sx) / back) * width * 0.55, sy - ((ty - sy) / back) * width * 0.55];
  const f = n => n.toFixed(2),
    line = list => list.map(([x, y]) => `L${f(x)} ${f(y)}`).join("");
  return `<path class="${tone}" d="M${f(left[0][0])} ${f(left[0][1])}${line(left.slice(1))}${line(right.reverse())}Q${f(bulge[0])} ${f(bulge[1])} ${f(left[0][0])} ${f(left[0][1])}Z"/>`;
}
// 圆相：以 (cx, cy) 为心、r 为径，从 from 度起顺时针走到 to 度的一笔
function brushArc(cx, cy, r, from, to, width, options) {
  const points = [],
    steps = 6,
    span = (to - from) / steps,
    at = (deg, radius = r) => [cx + radius * Math.cos((deg * Math.PI) / 180), cy + radius * Math.sin((deg * Math.PI) / 180)];
  points.push(...at(from));
  for (let i = 0; i < steps; i++)
    points.push(...at(from + span * (i + 0.5), r / Math.cos((span * Math.PI) / 360)), ...at(from + span * (i + 1)));
  return brushStroke(points, width, options);
}
const brushSeal = (x, y, size) => `<rect class="zhu" x="${x}" y="${y}" width="${size}" height="${size}" rx=".25"/>`,
  brushDot = (x, y, r, tone = "ink") => `<circle class="${tone}" cx="${x}" cy="${y}" r="${r}"/>`;

/** @type {Record<string, () => string>} 20 × 20 的画幅 */
const BRUSH_ICONS = {
  // 卷宗：写意手卷——两根轴各一笔竖画，纸是一片淡墨，字是两笔短横，角上一方小朱印
  scroll: () =>
    `<rect class="wash" x="5" y="5" width="10.2" height="9.6" rx=".4"/>` +
    brushStroke([4, 3, 4.3, 10, 4.2, 17], 2.2) +
    brushStroke([16, 3.2, 15.8, 10, 15.9, 16.8], 2.2) +
    brushStroke([7.2, 8.3, 10, 8, 12.8, 8.1], 1.3, { tone: "ink2" }) +
    brushStroke([7.2, 11.2, 9.1, 11, 11, 11.1], 1.3, { tone: "ink2" }) +
    brushSeal(11.6, 12, 2.1),
  // 设置入口：调律——三道弦各一笔淡墨，弦上三枚墨码，中间一枚是朱
  tune: () =>
    [5.2, 10, 14.8].map(y => brushStroke([2.6, y + 0.2, 10, y - 0.3, 17.4, y + 0.1], 1.2, { tone: "ink2", tail: 0.2 })).join("") +
    brushDot(12.8, 5, 1.9) +
    brushDot(6.8, 9.8, 1.9, "zhu") +
    brushDot(10.8, 14.9, 1.9),
  // 翻页：一页纸正被翻起——左边一笔是纸边，一道弧是翻起的那一页，页角一点朱
  newpage: () =>
    `<path class="wash" d="M5 3.6h10.6v13H5z"/>` +
    brushStroke([4.6, 3.2, 4.8, 10, 4.6, 17], 1.6, { tail: 0.5 }) +
    brushStroke([5, 16.4, 13, 14.6, 16.4, 3.8], 1.4) +
    brushDot(15.8, 4.6, 1.1, "zhu"),
  // 分组：三册书叠放，最上一册垂下一条朱色书签
  groups: () =>
    brushStroke([3, 16.4, 10, 16, 17, 16.2], 2.6, { tail: 0.5 }) +
    brushStroke([4, 12.6, 10, 12.1, 16, 12.4], 2.6, { tail: 0.5 }) +
    brushStroke([5, 8.8, 10, 8.3, 15, 8.6], 2.6, { tail: 0.5 }) +
    brushStroke([12.4, 8.6, 12.7, 6, 12.5, 3.2], 1, { tone: "zhu", tail: 0.4 }),
  // 通用：一张几案，案上一方小印
  general: () =>
    brushStroke([2.6, 8, 10, 7.2, 17.4, 7.8], 2, { tail: 0.4 }) +
    brushStroke([5, 8.4, 4.9, 12, 4.4, 16.2], 1.6) +
    brushStroke([15, 8.4, 15.1, 12, 15.6, 16.2], 1.6) +
    brushSeal(10.6, 3.6, 2.4),
  // 个性化：一支笔，笔下一道朱
  appearance: () =>
    brushStroke([16.2, 2.8, 12, 7.4, 8.2, 11.6], 1.3, { tail: 0.7 }) +
    brushStroke([8.6, 11.2, 5.6, 13.6, 3.4, 16.8], 3.4) +
    brushStroke([8.4, 17, 12.6, 16.2, 17, 16.6], 1.4, { tone: "zhu" }),
  // 模型：一锭墨，墨下一汪
  models: () =>
    `<ellipse class="wash" cx="10" cy="16.2" rx="6.6" ry="1.9"/>` +
    brushStroke([10, 2.8, 10.3, 8, 10, 13.2], 4.4, { tail: 0.85, head: 0.9 }) +
    brushSeal(9.1, 5, 1.8),
  // 预设：一方印——印钮一笔墨，印身一笔粗横，印下一方朱痕
  presets: () =>
    brushStroke([10, 2.6, 10.2, 5, 10, 7.6], 3.4, { tail: 0.9, head: 0.9 }) +
    brushStroke([4.6, 9.4, 10, 9, 15.4, 9.4], 2.6, { tail: 0.8 }) +
    `<rect class="zhu" x="6" y="12" width="8" height="5.6" rx=".4" transform="rotate(-3 10 14.8)"/>`,
  // 工具：一把矩尺
  tools: () =>
    brushStroke([4.2, 3, 4.4, 9.6, 4.3, 16.2], 1.9, { tail: 0.6 }) +
    brushStroke([4.3, 16.2, 10.6, 16, 16.8, 16.3], 1.9) +
    brushStroke([4.6, 10.6, 7, 12.8, 9.6, 15.6], 1.1, { tone: "ink2" }) +
    brushSeal(12.6, 4.2, 2.2),
  // 环境：远山两叠，山头一轮朱日
  env: () =>
    brushStroke([2.4, 15.8, 6.4, 6.6, 10.4, 13.2], 1.8, { tail: 0.3 }) +
    brushStroke([8.4, 11, 12.6, 3.8, 17.6, 15.8], 1.9, { tail: 0.2 }) +
    brushStroke([2.2, 16.6, 10, 16.2, 17.8, 16.6], 1, { tone: "ink2" }) +
    brushDot(15.2, 4.6, 1.5, "zhu"),
  // MCP：一座拱桥，桥下一道水，桥头一点朱
  mcp: () =>
    brushStroke([2.4, 13.4, 10, 3.8, 17.6, 13.4], 2.1, { tail: 0.3 }) +
    brushStroke([4.6, 12.6, 4.8, 14.4, 4.6, 16.2], 1.3, { tail: 0.5 }) +
    brushStroke([15.4, 12.6, 15.2, 14.4, 15.4, 16.2], 1.3, { tail: 0.5 }) +
    brushStroke([2, 17.2, 10, 16.8, 18, 17.3], 0.9, { tone: "ink2" }) +
    brushDot(10, 7.2, 1.1, "zhu"),
  // 记忆：结绳记事——一根绳，三个结，末一结是朱
  memory: () =>
    brushStroke([10, 2.4, 11.6, 10, 9.6, 17.6], 1.1, { tone: "ink2", tail: 0.3 }) +
    brushDot(10.6, 6, 1.8) +
    brushDot(10.8, 10.4, 2) +
    brushDot(10.3, 14.6, 1.7, "zhu"),
  // 文档：半展的书卷——卷着的一轴一笔粗竖，纸面上下两笔长横，两行字，一方小印
  guide: () =>
    brushStroke([4.2, 3.2, 4.5, 10, 4.4, 16.8], 3) +
    brushStroke([6.2, 5.4, 11.6, 5.3, 17, 5.8], 1.4) +
    brushStroke([6.2, 14.4, 11.4, 14.6, 16.6, 14.2], 1.4) +
    brushStroke([8, 9, 11, 8.7, 14, 8.8], 1.1, { tone: "ink2" }) +
    brushStroke([8, 11.3, 10.2, 11.1, 12.4, 11.2], 1.1, { tone: "ink2" }) +
    brushSeal(15, 9.3, 1.9),
  // 关于：一笔圆相，旁落一方小印
  about: () => brushArc(9.6, 9.8, 6.4, 200, 505, 2.2, { tail: 0.15 }) + brushSeal(14.8, 14.8, 2.2)
};
/** @param {string} name @param {string} [className] */
function brushIcon(name, className = "") {
  return `<svg class="brush${className ? ` ${className}` : ""}" viewBox="0 0 20 20" aria-hidden="true">${BRUSH_ICONS[name]?.() || ""}</svg>`;
}
// 页面里写好位置的（侧栏的卷宗、设置入口，设置各栏的名字前）：开页时画上
function paintBrushIcons(root = document) {
  for (const svg of root.querySelectorAll("svg[data-brush]"))
    if (!svg.childElementCount) svg.innerHTML = BRUSH_ICONS[svg.dataset.brush]?.() || "";
}
paintBrushIcons();

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
function toast(message, ms = 2200) {
  const el = $("#toast");
  el.textContent = message;
  showNow(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideWithFade(el), ms);
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
  if (runningElsewhere()) return setConnection("busy", "另一处作答中");
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

// ---------- 大体积库按需加载：KaTeX / pdf.js 只在真正用到时才拉，首屏只带 marked + purify + hljs（图表与流程图的库在交互预览里按需载） ----------
const VENDOR = {
  pdf: { src: "./vendor/pdf.min.js", ready: () => window.pdfjsLib },
  katex: { src: "./vendor/katex/katex.min.js", ready: () => window.katex }
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
        script.onload = () => resolve(!!lib.ready());
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
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
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
// 滚轮落在里层自己能滚的框里（思绪、代码、指令输出）且那框还能往上滚：滚的是它，对话没动，不算离开底部。
// 不然边看边往上翻思绪，页面就当读者停下来读了：不再跟着底部，思绪也不收
function wheelScrollsInner(event) {
  for (let el = event.target; el && el !== event.currentTarget; el = el.parentElement)
    if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true;
  return false;
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
// 占位框里是一页草图：将要画的东西的底稿（一页版式）——
// 用淡墨一笔一笔勾出来，勾完停一停、淡去、再勾（pathLength 归一，stroke-dashoffset 从 1 走到 0 就是「画出来」，各笔按 --i 错开）。
// 每来一行，草图上有一笔蘸朱（见 pulseInkStroke，由 paintTail 点）：流着时朱笔此起彼伏，流停了草图只剩自己勾着，看得出还在写还是卡住了
const VIZ_SKETCH = [
  "M8 6h144a3 3 0 0 1 3 3v54a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z",
  "M5 18h150",
  "M12 25h30a2 2 0 0 1 2 2v30a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V27a2 2 0 0 1 2-2z",
  "M52 28h92",
  "M52 36h72",
  "M52 44h84",
  "M52 52h26a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H52a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z"
];
function pendingSketchHtml() {
  const strokes = VIZ_SKETCH;
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
  // 页内可视化只有一条路：自足的 HTML 在隔离沙箱里就地渲染（数据图表、流程图也在里面画，见 preview-runtime.js）。
  // 旧对话里的 ```mermaid / ```echarts 换成等价的一页 HTML 照样成图；模型把流程图写进 ```pre 或不标语言的围栏，内容一看就是 mermaid 的，也照画
  const legacy = language === "mermaid" || language === "echarts" || ((language === "pre" || !language) && looksLikeMermaid(text)),
    htmlApp = ["html", "interactive", "app"].includes(language) || legacy;
  // 流式尾段尚未闭合时先立一个占位框，框里是一页草图（见 pendingSketchHtml）
  if (suppressViz && htmlApp) {
    const lines = String(text || "").split("\n").length;
    return `<div class="viz viz-pending" data-viz-pending="html" data-lines="${lines}" style="--phase:${vizPhase()}" role="status" aria-label="交互内容仍在生成，已写 ${lines} 行"><div class="code-head"><span class="code-lang">${language}</span><span class="viz-pending-signal" aria-hidden="true"></span></div><div class="viz-pending-body" aria-hidden="true">${pendingSketchHtml()}</div></div>\n`;
  }
  if (!suppressViz && htmlApp) {
    const source = legacy ? legacyVizHtml(language, text) : text;
    if (source !== null)
      return `<div class="html-app" data-html-app><div class="code-head"><span class="code-lang">html · 正在载入</span><span><button type="button" class="code-copy" data-app-toggle>源码</button><button type="button" class="code-copy" data-app-restart>重启</button><button type="button" class="code-copy" data-app-download>下载</button><button type="button" class="code-copy" data-work-expand>全屏</button><button type="button" class="code-copy" data-copy-code>复制</button></span></div><div class="html-app-stage"><span>正在载入交互内容</span></div><pre class="html-app-source hidden"><code>${escapeHtml(source)}</code></pre></div>\n`;
  }
  let html;
  try {
    html = known ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
  } catch {
    html = escapeHtml(text);
  }
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${escapeHtml(language || "text")}</span><button type="button" class="code-copy" data-copy-code>复制</button></div><pre><code class="hljs${known ? ` language-${escapeHtml(language)}` : ""}">${html}</code></pre></div>\n`;
}
// 一段文字是不是 mermaid 图：头一行（跳过 %% 注释与 --- 前言）整行就是它的图种声明——graph = build() 这类代码不算
const MERMAID_HEAD =
  /^(?:(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie(?:\s+(?:showData|title\s.*))?|quadrantChart|requirementDiagram|gitGraph|C4(?:Context|Container|Component|Dynamic|Deployment)|mindmap|timeline|kanban|(?:sankey|xychart|block|packet|architecture)(?:-beta)?)\s*;?\s*$/;
function looksLikeMermaid(text) {
  const head = String(text || "")
    .replace(/^\s*---[\s\S]*?\n---\s*\n/, "")
    .split("\n")
    .map(line => line.trim())
    .find(line => line && !line.startsWith("%%"));
  return MERMAID_HEAD.test(head || "");
}
// 正文里裸写的 <pre class="mermaid">…</pre>（没包进 ```html）：换成 ```mermaid 围栏，走同一条路成图；代码围栏里的不动
function liftBareMermaid(text) {
  const OPEN = '<pre class="mermaid">';
  if (!text.includes(OPEN)) return text;
  let fenced = false,
    lifting = false;
  return text
    .split("\n")
    .map(line => {
      if (!lifting && /^ {0,3}(?:`{3,}|~{3,})/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      if (!lifting) {
        const at = line.indexOf(OPEN);
        if (at < 0) return line;
        lifting = true;
        line = `${line.slice(0, at)}\n\`\`\`mermaid\n${line.slice(at + OPEN.length)}`;
      }
      const end = line.indexOf("</pre>");
      if (end < 0) return line;
      lifting = false;
      return `${line.slice(0, end)}\n\`\`\`\n${line.slice(end + "</pre>".length)}`;
    })
    .join("\n");
}
/** 旧对话里的 mermaid / echarts 围栏 → 等价的一页 HTML；echarts 的 option 解不开时回 null（按代码块显示） */
function legacyVizHtml(language, text) {
  if (language !== "echarts") return `<pre class="mermaid">${escapeHtml(text)}</pre>`;
  try {
    const option = parseVizJson(text),
      height = Math.min(560, Math.max(220, Number(option.height) || 320));
    delete option.height;
    const json = JSON.stringify(option).replace(/</g, "\\u003c");
    return `<div id="chart" style="height:${height}px"></div>\n<script src="yan:echarts"></script>\n<script>echarts.init(document.getElementById("chart")).setOption(${json});</script>`;
  } catch {
    return null;
  }
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
// 旧对话里 echarts 围栏的 option：模型给的 JSON 常有小滑头（尾逗号、注释、单引号、裸键名）；逐层尝试修补，实在补不上再抛原始错误
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
function htmlAppSource(el) {
  return el.querySelector(".html-app-source code")?.textContent || "";
}
// 交互内容与正文同一张纸：把言的色板、字体与明暗一并送进去（见 preview-runtime.js 的 applyTheme）
const VIZ_TOKENS = [
  "paper",
  "paper-2",
  "paper-3",
  "ink",
  "ink-2",
  "ink-3",
  "line",
  "accent",
  "accent-soft",
  "code-green",
  "code-blue",
  "gold",
  "keep",
  "reach",
  "body",
  "title"
];
function vizTheme() {
  const style = getComputedStyle(document.documentElement),
    dark = document.documentElement.dataset.theme === "dark";
  return {
    dark,
    scheme: dark ? "dark" : "light",
    vars: Object.fromEntries(VIZ_TOKENS.map(name => [name, style.getPropertyValue(`--${name}`).trim()]))
  };
}
function sendHtmlApp(el) {
  const iframe = el.querySelector("iframe"),
    id = el.dataset.appId;
  if (iframe?.contentWindow && id)
    iframe.contentWindow.postMessage({ type: "yan-preview-render", id, html: htmlAppSource(el), theme: vizTheme() }, "*");
}
// 换了主题、朱色或字体：已在页上的交互内容就地换色，不重跑（里头的状态不丢）
function rethemeHtmlApps(root = document) {
  const theme = vizTheme();
  for (const el of root.querySelectorAll(".html-app[data-app-id]"))
    el.querySelector("iframe")?.contentWindow?.postMessage({ type: "yan-preview-theme", id: el.dataset.appId, theme }, "*");
}
// 内容报来的高度：这一块就长这么高（全屏时由样式接管）；太长的在块里滚，不把整页撑没
function sizeHtmlApp(el, height) {
  const stage = el.querySelector(".html-app-stage");
  if (!stage) return;
  stage.style.height = `${Math.round(Math.min(Math.max(height, 48), Math.max(520, innerHeight * 0.8)))}px`;
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
function closeExpandedWork(except = null) {
  for (const item of document.querySelectorAll(".work-expanded"))
    if (item !== except) {
      item.classList.remove("work-expanded");
      const trigger = item.querySelector("[data-work-expand]");
      if (trigger) trigger.textContent = "全屏";
    }
  if (!except) document.documentElement.classList.remove("work-mode");
}
function toggleWorkExpanded(el, button) {
  const open = !el.classList.contains("work-expanded");
  closeExpandedWork(open ? el : null);
  el.classList.toggle("work-expanded", open);
  button.textContent = open ? "收起" : "全屏";
  document.documentElement.classList.toggle("work-mode", open);
}
function renderMarkdown(source = "") {
  const text = String(source).replace(/^\n+|\n+$/g, "");
  if (!text) return "";
  const plain = () => `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  if (!window.marked || !window.DOMPurify) return plain();
  try {
    return DOMPurify.sanitize(marked.parse(liftBareMermaid(text), { async: false }), PURIFY_OPTIONS);
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
  // 从文件直接打开的页面不接桥接：它的浏览器存储与桥接页面分开，常是很久以前的旧记录，接上就可能把它当正本写回 配置.json
  //（VS Code 内置浏览器里曾这样整份冲掉过配置）。桥接那头也不认来源为 null 的请求，这里再守一道，不依赖浏览器发什么头
  if (location.protocol === "file:") return false;
  for (const candidate of candidates) {
    // 同源探测：首次打开时浏览器还在拉 vendor 里的几个大文件，引导请求排在后面，1.4 秒不够，给足时间
    const wait = candidate === "" && servedByBridge() ? Math.max(timeout, 8000) : timeout;
    try {
      const response = await fetch(`${candidate}/api/bootstrap`, { signal: AbortSignal.timeout(wait) });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) continue;
      const next = await response.json();
      bootstrap = next;
      apiBase = candidate;
      if (next.stale) toast("本机桥接的代码已更新，请关掉桥接窗口、重新运行 start.cmd", 8000);
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
    void syncConfigWithDisk().then(() => {
      void refreshArchive();
      void syncChatsWithDisk();
      void mcpReady();
      void refreshEnv();
    });
    if (!$("#settingsModal").classList.contains("hidden")) renderSettings();
    toast("本机桥接已接通，联网可用");
  }
  return connected;
}
// 停在「生成中」却没人在写的消息（页面刷新了、写的那一处关了）：按中断收束，已写的留着。改了返回 true
/** @param {Conversation} conversation */
function recoverConversation(conversation) {
  let changed = false;
  for (const message of conversation.messages || [])
    if (message.status === "streaming") {
      message.status = "interrupted";
      message.error = "页面刷新或连接中断，已生成的内容已保留";
      message.interruptedAt = now();
      settleSteps(message, "连接中断");
      changed = true;
    }
  for (const thread of conversation.threads || [])
    for (const message of thread.messages || [])
      if (message.status === "streaming") {
        message.status = message.content ? "stopped" : "error";
        message.error = "页面刷新或连接中断";
        changed = true;
      }
  return changed;
}
// 开页时收束一遍；别处正作答的不算（见 syncLeases）
function recoverInterruptedMessages() {
  let changed = false;
  for (const conversation of store.conversations)
    if (!remoteBusy.has(conversation.id) && recoverConversation(conversation)) {
      markDirty(conversation.id);
      changed = true;
    }
  if (changed) saveStore();
}
async function boot() {
  // 对话主体在 IndexedDB；先把旧 localStorage 数据迁入/把最新快照读回，再接桥接与绘制页面
  await hydrateStore();
  setupMarkdown();
  const candidates = ["", LOCAL_BRIDGE].filter((value, index, array) => array.indexOf(value) === index);
  await connectBridge(candidates);
  // 桥接在线：配置与对话的正本在存储根里（默认 ~/.yan），先与它合一次再画页面
  if (apiBase !== null) {
    await syncConfigWithDisk();
    await syncChatsWithDisk();
    // MCP 服务起得慢（起进程、握手）：先起着，头一问发出前会等它；环境备没备好也问一声，系统提示里要说
    void mcpReady();
    void refreshEnv();
  }
  if (apiBase === null) {
    bootstrap.notice = servedByBridge()
      ? "正在连接本机桥接…若始终连不上，请重新运行 start.cmd。"
      : location.protocol === "file:"
        ? `从文件直接打开的页面接不上本机桥接（分不清它与别处网页嵌进来的沙箱页），当前为浏览器直连。要用联网、执事与存储目录，请运行 start.cmd 后打开 ${LOCAL_BRIDGE}。`
        : "未检测到本机桥接，当前为浏览器直连。若接口未开放 CORS，请运行 start.cmd 或 VS Code 任务「言：启动模型桥接」。";
    if (servedByBridge()) retryBridgeLater();
  }
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
  // 先问一声别处在作答什么，那几段不当成中断
  await syncLeases();
  recoverInterruptedMessages();
  applyAppearance();
  bindEvents();
  (window.requestIdleCallback || (fn => setTimeout(fn, 800)))(() => void themeSheets());
  void refreshArchive();
  // 侧栏的开合记在本机（不随备份走）：宽屏按上次的来，窄屏一律收起；theme-boot 已按同一记录先把宽度放好，这里接过来
  toggleSidebar(isMobile() || localStorage.getItem("yan-sidebar") === "collapsed");
  delete document.documentElement.dataset.sidebar;
  restorePlace();
  render();
  // 低频的全量巡检：哪段改了没标到也兜得住；页面藏起来时也巡一趟（手机切走常常就不回来了）
  setInterval(sweepConversations, 45000);
  // 报到：这边在作答什么、别处在作答什么（作答的一处三秒存一次盘，跟着看的一处也三秒读一次）
  setInterval(() => void syncLeases(), 3000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sweepConversations();
    else {
      void refreshConfigFromDisk();
      // 藏着时报到被浏览器节流，别处在这段里答完了也未必察觉：回到前台先跟上看着的这段，再往里说话
      if (currentId) void catchUpFromDisk([currentId]);
    }
  });
}

function bindEvents() {
  $("#collapseSidebar").onclick = () => toggleSidebar();
  $("#mobileMenu").onclick = () => toggleSidebar(false);
  // 侧栏的翻页是散列的一段；要归进某组从组首「＋」起
  $("#newChat").onclick = () => {
    delete store.settings.pendingGroupId;
    newChat();
  };
  $("#openLibrary").onclick = () => (view === "library" ? closeLibrary() : openLibrary());
  $("#openGroups").onclick = () => (view === "groups" ? closeGroupsPage() : openGroupsPage());
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
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const waiting = input.id === "chatInput" && !input.value.trim() ? pendingApprovalHere() : null;
        if (waiting) return approveByEnter(waiting);
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
      // Enter 本身就是明确提交；也照顾脚本/输入法最后一拍尚未来得及冒 input 事件的情形。
      renamingDirty = true;
      commitRename(input.value);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      renamingId = null;
      renamingDirty = false;
      renderHistory();
    }
  });
  $("#history").addEventListener("input", e => {
    if (e.target.closest(".history-rename") && renamingId) renamingDirty = true;
  });
  $("#history").addEventListener("focusout", e => {
    const input = e.target.closest(".history-rename");
    if (input && renamingId && !renderingHistory) commitRename(input.value);
  });
  const title = $("#chatTitle");
  let titleDirty = false,
    titleCanceled = false;
  title.addEventListener("focus", () => {
    titleDirty = false;
    titleCanceled = false;
  });
  title.addEventListener("input", () => (titleDirty = true));
  title.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      title.blur();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      titleCanceled = true;
      title.textContent = currentConversation()?.title || "";
      title.blur();
    }
  });
  title.addEventListener("blur", () => {
    const c = currentConversation();
    if (!c) return;
    const value = title.textContent.replace(/\s+/g, " ").trim();
    if (!titleCanceled && titleDirty && value && value !== c.title) renameConversation(c.id, value);
    else title.textContent = c.title;
    titleDirty = false;
    titleCanceled = false;
  });
  $("#modelMenu").addEventListener("click", e => {
    const level = e.target.closest("[data-reasoning]");
    if (level) {
      e.stopPropagation();
      const c = currentConversation();
      const profile = activeProfile();
      if (!profile) return;
      profile.reasoning = normalizeReasoning(level.dataset.reasoning);
      if (c) c.reasoning = profile.reasoning;
      saveStore();
      renderModelMenu();
      renderModelTriggers();
      const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
      if (trigger) positionModelMenu(trigger);
      return;
    }
    const preset = e.target.closest("[data-preset]");
    if (preset) return selectPreset(preset.dataset.preset);
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
      void copyText(copy.closest(".code-block, .html-app")?.querySelector("code")?.textContent || "");
      copy.textContent = "已复制";
      setTimeout(() => (copy.textContent = "复制"), 1200);
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
      toggleWorkExpanded(expand.closest(".html-app"), expand);
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
    // 浮着的小菜单（附件签、历史条目的「⋯」、目录签的弹层、模型菜单）：Esc 只收它，别连带把底下的旁注面板也关了
    if (document.querySelector(".chip-pop")) return closeChipPop();
    const modelMenu = $("#modelMenu");
    if (!modelMenu.classList.contains("hidden") && !modelMenu.classList.contains("leaving")) return closeModelMenu();
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
    syncRunningHead();
  });
  $("#runningHead").addEventListener("click", () => $("#chatScroll").scrollTo({ top: 0, behavior: "smooth" }));
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
      if (e.deltaY < 0 && !wheelScrollsInner(e)) followBottom = false;
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
    chatScroll.scrollTop = Math.max(0, Math.min(geometry.max, ((pointer - scrollDrag.offset) / geometry.travel) * geometry.max));
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
  const flushPageState = () => {
    persistDraft();
    flushOnUnload();
    releaseLeases();
  };
  // beforeunload 比 pagehide 早，给 IndexedDB 事务多一点提交时间；pagehide 仍兜住不派 beforeunload 的移动端 / 缓存路径。
  // flushOnUnload 自身幂等，不会因为两者都到而重复写。
  window.addEventListener("beforeunload", flushPageState);
  window.addEventListener("pagehide", flushPageState);
  // 从前进 / 后退缓存回来仍是同一份 JS 状态：允许它在下一次离页时再次落盘。
  window.addEventListener("pageshow", event => {
    if (event.persisted) {
      unloading = false;
      void refreshConfigFromDisk();
      if (currentId) void catchUpFromDisk([currentId]);
      void refreshEnv();
    }
  });
  window.addEventListener("offline", () => setConnection("error", "连接中断"));
  window.addEventListener("online", refreshConnection);
  window.addEventListener("message", event => {
    const data = event.data;
    if (!data || !["yan-preview-ready", "yan-preview-state", "yan-preview-size", "yan-preview-escape"].includes(data.type)) return;
    const app = [...document.querySelectorAll(".html-app[data-app-id]")].find(
      el => el.dataset.appId === data.id && el.querySelector("iframe")?.contentWindow === event.source
    );
    if (!app) return;
    if (data.type === "yan-preview-ready") return sendHtmlApp(app);
    if (data.type === "yan-preview-size") return sizeHtmlApp(app, Number(data.height) || 0);
    if (data.type === "yan-preview-escape") return void (app.classList.contains("work-expanded") && closeExpandedWork());
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
// 没绑就是言（对谈，文件工具落在卷宗）。目录可以在对话中途绑上或解开，上下文不断
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
// 卷宗目录：存储根里的 卷宗/（桥接报来的位置）；没绑目录的对话，工具都落在这里
function archiveDir() {
  if (apiBase === null) return "";
  return bootstrap.work?.archive || "";
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
  if (location.protocol === "file:" && apiBase === null) {
    el.classList.remove("hidden");
    el.innerHTML = `<span class="seal" aria-hidden="true">地</span><span>这是直接打开的本地文件页，配置与桥接页面分开保存。要查看原来的模型、对话和环境，请运行 start.cmd 并打开 ${LOCAL_BRIDGE}。</span>`;
    return;
  }
  const none = !profiles().length;
  el.classList.toggle("hidden", !none);
  if (!none) return;
  el.innerHTML = `<span class="seal" aria-hidden="true">始</span><span>尚未接入模型。任何 OpenAI 兼容接口均可使用，配置只存于本机、不经云端。</span><button type="button" data-open-models>前往设置 →</button>`;
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
    pending = (store.settings.pendingWorkdir || "").trim() || pendingGroup()?.workdir || "";
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
  renderGroupTags();
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
    `<button type="button" data-menu="pin">${c.pinned ? "取消置顶" : "置顶"}</button><button type="button" data-menu="rename">改名</button><button type="button" data-menu="bind">${isWork(c) ? "更换目录" : "绑定目录"}</button><button type="button" data-menu="group">${groupOf(c) ? "移至他组" : "移入分组"}</button><button type="button" data-menu="export"><span>导出</span><small>${archiveOnline() ? "存入卷宗" : "Markdown"}</small></button><button type="button" class="danger" data-menu="delete">删除</button>`,
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
    else if (action === "group") openMoveMenu(c, anchor.closest(".history-item") || anchor);
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
  $("#welcomeGroup").onclick = () => {
    delete store.settings.pendingGroupId;
    saveStore();
    renderChips(workMode(), apiBase !== null);
    renderHeader();
  };
  $("#chatGroup").onclick = () => openGroupsPage(groupOf(currentConversation())?.id || null);
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
    // 新对话照最近看的这段用的预设，与模型一样
    store.settings.presetId = presetOf(c)?.id || "";
    c.profileId && selectProfile(c.profileId, false);
    // 别处可能在这段里写过而这边没察觉（报到有间隔）：读一下目录里那份，新就跟上
    void catchUpFromDisk([c.id]);
  }
  render();
  if (isMobile()) toggleSidebar(true);
}
async function deleteConversation(id) {
  const removed = store.conversations.find(c => c.id === id);
  if (!removed) return;
  // 那一处还在写，删了它也会写回来
  if (runningElsewhere(id)) return toast("这段对话正在另一个页面作答，那边停下后再删");
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
  void deleteConversationStorage(id);
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
  markDirty(id);
  saveStore();
  renderHistory();
}
function startRename(id) {
  renamingId = id;
  renamingDirty = false;
  renderHistory();
}
function commitRename(value) {
  const id = renamingId;
  renamingId = null;
  const changed = renamingDirty;
  renamingDirty = false;
  if (id && changed) renameConversation(id, value);
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
    markDirty(id);
    saveStore();
  }
  renderHistory();
  if (c && currentId === id) {
    $("#chatTitle").textContent = c.title;
    syncDocumentTitle();
  }
}
function selectProfile(id, shouldRender = true) {
  const profile = profiles().find(p => p.id === id);
  if (!profile) return;
  const c = currentConversation(),
    wasDry = conversationDry(c);
  // 旧对话里已有的档位首次打开时归给它自己的模型；切到另一模型时只取新模型记住的档位。
  const initialized = c?.profileId === id && profile.reasoning === undefined;
  if (initialized) profile.reasoning = normalizeReasoning(c.reasoning);
  const reasoning = normalizeReasoning(profile.reasoning);
  // 开旧对话时也走这里，多半什么都没变：没变就不整份存一遍
  const changed = initialized || store.settings.activeProfileId !== id || (!!c && (c.profileId !== id || c.reasoning !== reasoning));
  store.settings.activeProfileId = id;
  if (c) {
    c.profileId = id;
    c.reasoning = reasoning;
  }
  if (changed) saveStore();
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
  document.title = view === "library" ? "卷宗 · 言" : view === "groups" ? "分组 · 言" : c ? `${c.title} · 言` : "言";
  renderRunningHead(); // 标题改了（手改、拟题），书眉跟着换
}

  // ---- 07-render.js ----
// 言 · 整体渲染：顶栏、模型菜单、历史、对话与消息
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function render(shouldScroll = false) {
  rememberPlace();
  const c = currentConversation(),
    library = view === "library",
    groups = view === "groups",
    page = library || groups;
  // 人在卷宗页时这段对话的一答写完了，记了「有新回复」；回到它眼前就算看过了，不必再点一次侧栏
  if (c && !page && c.unread) {
    c.unread = false;
    saveStoreSoon();
  }
  renderHeader();
  renderHistory();
  syncDocumentTitle();
  requestAnimationFrame(() => syncJumpBottom());
  $("#library").classList.toggle("hidden", !library);
  $("#groups").classList.toggle("hidden", !groups);
  $("#welcome").classList.toggle("hidden", page || !!c);
  $("#chat").classList.toggle("hidden", page || !c);
  $("#chatScrollGrabber").classList.toggle("hidden", page || !c);
  $("#composerArea").classList.toggle("hidden", page || !c);
  $("#openLibrary").classList.toggle("active", library);
  $("#openGroups").classList.toggle("active", groups);
  renderGroupsCount();
  renderGroupTags();
  if (library) renderLibrary();
  else if (groups) renderGroupsPage();
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
// 余墨：设了上限时显示还剩多少、墨池随之见底；没设（不限）时墨池常满，改报已耗多少
function renderQuota() {
  const p = activeProfile(),
    cap = p ? parseTokenLimit(p.quota) : null,
    used = Math.max(0, Number(p?.usedTokens || 0));
  const remaining = cap ? Math.max(0, cap - used) : 0,
    ratio = !p ? 0 : cap ? remaining / cap : 1,
    status = $("#quotaStatus");
  const percent = Math.min(100, Math.round(ratio * 100));
  $("#quotaFill").style.width = `${percent}%`;
  status.style.setProperty("--ink-level", `${percent}%`);
  status.querySelector(".quota-label").textContent = p && cap === null ? "耗墨" : "余墨";
  status.title = !p
    ? "尚未接入模型"
    : cap === null
      ? `不限用量，已耗 ${formatTokens(used)}`
      : `余墨 ${formatTokens(remaining)} / ${formatTokens(cap)}`;
  $("#quotaText").textContent = !p ? "—" : cap === null ? formatTokens(used) : formatTokens(remaining);
  status.classList.toggle("dry", !!cap && remaining === 0);
  status.classList.toggle("empty", !p);
  status.setAttribute("aria-label", status.title);
}
function renderModelTriggers() {
  const p = activeProfile(),
    c = currentConversation(),
    level = (c ? c.reasoning : p?.reasoning) || "",
    preset = presetOf(c);
  // 标签写实际会送出的那一档：模型不认所选的就落到最接近的；模型不认思考档位（探过是 none）就不写
  const used = level ? nearestReasoning(p, level) : "";
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.querySelector(".model-name").textContent = p?.name || "尚未接入模型";
    button.querySelector(".model-extra").textContent = [preset?.name, used ? `思考 ${reasoningLabel(used)}` : ""]
      .filter(Boolean)
      .map(text => `· ${text}`)
      .join(" ");
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
    profile = activeProfile(),
    level = (c ? c.reasoning : profile?.reasoning) || "",
    choices = reasoningChoices(profile),
    // 选过的档位这个模型不认（换了模型、或刚学到它的档位）：菜单上点亮它实际会落到的那一档
    shown = choices.includes(level) ? level : nearestReasoning(profile, level) || "";
  if (all.length)
    $("#modelMenu").insertAdjacentHTML(
      "beforeend",
      `${presetMenuHtml()}<div class="menu-section"><div class="menu-section-title"><span>思考深度</span><span title="每个模型分别记住所选档位；默认不带字段，由接口决定。各模型所认的档位可在高级配置中填写">当前模型</span></div>${choices.length > 1 ? `<div class="segmented">${choices.map(value => `<button type="button" data-reasoning="${value}" class="${value === shown ? "active" : ""}">${reasoningLabel(value)}</button>`).join("")}</div>` : `<div class="menu-section-note">此模型不认思考档位</div>`}</div><button class="model-option model-manage" data-manage>模型设置</button>`
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
  // 自立的分组（「集」）同样按组内最近动过的那条排，空组按立组的时间，与「工」组同一排法；没绑目录的对话按自己的时间散在其间；置顶另列。
  // 落选的：分组在置顶之下自成一段（组一多，刚写的对话被压到下面，且与置顶之间没有界线，看着像置顶的一部分）。
  // 组可收起，收起时只露出当前打开的那条；查找时不收，也不列没有命中的组
  const collapsed = new Set(store.settings.collapsedRepos || []),
    pinned = sorted.filter(c => c.pinned && !groupOf(c)),
    repos = new Map(),
    sets = new Map(groupsList().map(group => [group.id, { kind: "set", group, at: group.createdAt, items: [] }])),
    nodes = [];
  for (const c of sorted) {
    const set = c.groupId && sets.get(c.groupId);
    if (set) {
      if (!set.items.length || c.updatedAt > set.at) set.at = c.updatedAt;
      set.items.push(c);
      continue;
    }
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
  for (const set of sets.values()) if (!query || set.items.length) nodes.push(set);
  nodes.sort((a, b) => b.at.localeCompare(a.at));
  /** @type {Map<string, any[]>} */
  const buckets = new Map();
  buckets.set(
    "置顶",
    pinned.map(c => ({ kind: "chat", c }))
  );
  for (const label of ["今天", "过去七天", "更早"]) buckets.set(label, []);
  for (const node of nodes) buckets.get(dayBucket(node.at)).push(node);
  // 正改着名时侧栏也可能重画（别的对话拟好了题、后台一答收尾）：改到一半的字与光标得留住，不能被原标题冲掉
  const editing = $("#history .history-rename"),
    typed =
      editing && renamingId && editing.closest("[data-conversation]")?.dataset.conversation === renamingId
        ? { value: editing.value, start: editing.selectionStart, end: editing.selectionEnd }
        : null;
  const item = c => {
    if (renamingId === c.id)
      return `<div class="history-item active" data-conversation="${escapeHtml(c.id)}"><input class="history-rename" value="${escapeHtml(typed && renamingDirty ? typed.value : c.title)}" maxlength="60" aria-label="重命名对话"></div>`;
    const job = requestJob(c.id),
      running = !!job,
      waiting = job?.label === "等待确认";
    const state = waiting
      ? `<span class="history-state waiting" title="有指令等待确认" aria-label="有指令等待确认">问</span>`
      : running
        ? `<span class="history-state running" title="后台生成中" aria-label="后台生成中"></span>`
        : c.unread
          ? `<span class="history-state unread" title="有新回复" aria-label="有新回复"></span>`
          : c.pinned && groupOf(c)
            ? `<span class="history-state pinned" title="组内置顶" aria-label="组内置顶"></span>`
            : "";
    return `<div class="history-item ${c.id === currentId ? "active" : ""} ${running ? "is-running" : ""} ${c.unread ? "has-unread" : ""} ${isWork(c) ? "is-work" : ""}" data-conversation="${escapeHtml(c.id)}" draggable="true"><button class="history-open" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>${state}<span class="history-tools"><button class="history-tool history-more" data-history-action="menu" title="更多" aria-label="更多" aria-haspopup="menu">⋯</button></span></div>`;
  };
  const repoHtml = node => {
    const name = node.dir.split(/[\\/]/).filter(Boolean).pop() || node.dir || "未定目录",
      fold = collapsed.has(node.dir) && !query,
      shown = fold ? node.items.filter(c => c.id === currentId) : node.items,
      running = node.items.filter(c => c.id !== currentId && requestJob(c.id)).length;
    return `<div class="history-repo-group${fold ? " collapsed" : ""}" data-repo="${escapeHtml(node.dir)}"><div class="history-repo-head"><button type="button" class="history-repo" data-repo-toggle="${escapeHtml(node.dir)}" title="${escapeHtml(node.dir)}\n${fold ? "展开" : "收起"}" aria-expanded="${fold ? "false" : "true"}"><span class="repo-seal" aria-hidden="true">工</span><span class="history-repo-name">${escapeHtml(name)}</span><small>${node.items.length}${fold && running ? ` · ${running} 生成中` : ""}</small><span class="repo-caret" aria-hidden="true">›</span></button><button type="button" class="history-tool repo-new" data-history-workdir="${escapeHtml(node.dir)}" title="在此目录新建">＋</button></div>${shown.length ? `<div class="history-repo-items">${shown.map(item).join("")}</div>` : ""}</div>`;
  };
  // 分组：画法同「工」组，印文是「集」；组首右侧「＋」在此组另起一段、「⋯」改名、打开组的设置或解散；改名时组名换成输入框。
  // 对话可拖到组上移入、拖到组外移出（见 24-groups.js）
  const setHtml = node => {
    const { group } = node,
      key = `group:${group.id}`,
      fold = collapsed.has(key) && !query,
      items = [...node.items].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)),
      shown = fold ? items.filter(c => c.id === currentId) : items,
      renaming = renamingGroupId === group.id;
    const name = renaming
      ? `<input class="history-rename group-rename" value="${escapeHtml(group.name)}" maxlength="40" aria-label="分组改名">`
      : `<span class="history-repo-name">${escapeHtml(group.name)}</span>`;
    return `<div class="history-repo-group is-set${fold ? " collapsed" : ""}" data-group="${escapeHtml(group.id)}"><div class="history-repo-head"><div role="button" tabindex="0" class="history-repo" data-group-toggle="${escapeHtml(group.id)}" aria-expanded="${fold ? "false" : "true"}"><span class="repo-seal" aria-hidden="true">集</span>${name}<small>${node.items.length}</small><span class="repo-caret" aria-hidden="true">›</span></div><button type="button" class="history-tool repo-new" data-group-new="${escapeHtml(group.id)}" title="在此组新建">＋</button><button type="button" class="history-tool repo-new repo-more" data-group-menu="${escapeHtml(group.id)}" title="更多" aria-label="更多" aria-haspopup="menu">⋯</button></div>${shown.length ? `<div class="history-repo-items">${shown.map(item).join("")}</div>` : ""}</div>`;
  };
  renderingHistory = true;
  try {
    $("#history").innerHTML =
      [...buckets]
        .filter(([, items]) => items.length)
        .map(
          ([label, items]) =>
            `<div class="history-group"><div class="history-label">${label}</div>${items.map(node => (node.kind === "repo" ? repoHtml(node) : node.kind === "set" ? setHtml(node) : item(node.c))).join("")}</div>`
        )
        .join("") || `<div class="history-empty">${query ? "没有匹配的对话" : "尚无旧墨"}</div>`;
    const input = $("#history .history-rename");
    if (input) {
      input.focus();
      if (typed) input.setSelectionRange(typed.start, typed.end);
      else input.select();
    }
  } finally {
    renderingHistory = false;
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
  renderRunningHead();
  requestAnimationFrame(syncRunningHead);
}
// 书眉：标题滚出视口后才显出题名与问数。字随 renderChatMeta 与改标题刷新（renderRunningHead），滚动时只切显隐（syncRunningHead）
function renderRunningHead() {
  const c = currentConversation(),
    head = $("#runningHead");
  if (c) {
    const notes = visibleThreads(c).length;
    head.querySelector(".running-head-title").textContent = c.title;
    head.querySelector(".running-head-meta").textContent =
      `${chineseNumber(c.messages.filter(m => m.role === "user").length, true)}问${notes ? ` · 旁注 ${notes}` : ""}`;
  }
  syncRunningHead();
}
function syncRunningHead() {
  $("#runningHead").classList.toggle(
    "shown",
    !!currentConversation() && $("#chatTitle").getBoundingClientRect().bottom < $("#chatScroll").getBoundingClientRect().top + 4
  );
}
function renderConversation(shouldScroll = false) {
  const c = currentConversation();
  if (!c) return;
  const snapshot = c.id === lastRenderedConvId ? scrollSnapshot() : scrollPositions.get(c.id);
  // 同一段对话原地重画（换主题、压缩收尾）时，正改着的标题不动
  if (c.id !== lastRenderedConvId || document.activeElement !== $("#chatTitle")) $("#chatTitle").textContent = c.title;
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
  // 主题、朱色或字体变了：留在原地的交互内容就地换色，不必重画整段
  const themeKey = vizThemeKey();
  if (themeKey !== lastVizThemeKey) {
    lastVizThemeKey = themeKey;
    rethemeHtmlApps($("#messages"));
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
    /** @type {{ view: "chat"|"library"|"groups", id: string }} */
    next = { view: view === "library" || view === "groups" ? view : "chat", id: view === "chat" ? currentId || "" : "" };
  if (s.lastView === next.view && (s.lastConversationId || "") === next.id) return;
  s.lastView = next.view;
  s.lastConversationId = next.id;
  saveStoreSoon();
}
function restorePlace() {
  const { lastView, lastConversationId } = store.settings;
  if (lastView === "library" || lastView === "groups") view = lastView;
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
    // 正在流式写的那条由逐帧的那一路刷，这里不动；别处在写、这边跟着看的，没有那一路，照常按新内容重画
    const streaming = node && item.message?.status === "streaming" && node.dataset.status === "streaming" && !runningElsewhere();
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
      node.remove();
    }
    if (next === cursor) cursor = cursor.nextElementSibling;
    else host.insertBefore(next, cursor);
  }
  // 游标之后全是没被点到名的旧节点（删掉的消息、重生成时截掉的尾巴、旧的收尾提示）
  while (cursor) {
    const stale = cursor;
    cursor = cursor.nextElementSibling;
    stale.remove();
  }
  return { added };
}
function vizThemeKey() {
  return `${document.documentElement.dataset.theme}|${cssVar("--accent")}|${cssVar("--body")}`;
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
    // 做完就收，与行迹同一个定例：流式期间读者往上翻着看时没收成的，这里补上；用户亲手开合过的不动
    if (!assistant.reasoningTouched) settleDetails(reasoning, false, null, true);
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
    // 已渲染的稳定段保持不动，只把尾段按最终文本重绘一次——此时交互内容才真正挂载
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
// 一组没有夹着正文、只是「想一阵 → 调工具 → 再想」时，后半段思绪仍属于同一组。
// 沿用组里原来的那枚签，重新切回 live；否则旧签一直打勾，下面又短暂冒出一枚新签，看起来像没有继续思考。
/** @param {Element} block @param {Message} message @param {string} visible */
function reusableTrailReasoning(block, message, visible) {
  if (!trailWork(message) || message.status !== "streaming") return null;
  const groups = trailGroups(message),
    active = block.querySelector('.tool-stack.is-work .trail-group > .reasoning[data-round-live="true"]');
  const group = active ? groups.find(item => active.parentElement?.dataset.at === String(item.at)) : groups.at(-1);
  if (!group) return null;
  const details =
    active ||
    [...block.querySelectorAll(".tool-stack.is-work .tool-stack-body > .trail-group")]
      .find(host => host.dataset.at === String(group.at))
      ?.querySelector(":scope > .reasoning");
  if (!details) return null;
  if (!active) {
    if (
      String(visible || "")
        .slice(group.at)
        .trim()
    )
      return null;
    if (
      !String(message.reasoning || "")
        .slice(group.rat)
        .trim()
    )
      return null;
    details.dataset.roundLive = "true";
    // 生成中切去别处再回来时，整页渲染会先把尾段思绪画在行迹之后；既然能归回上一组，就撤掉那份临时副本。
    block.querySelector(":scope > .reasoning")?.remove();
  }
  return {
    details,
    text: String(message.reasoning || "")
      .slice(group.rfrom)
      .trim()
  };
}
/** @param {Element} host @param {Message} message @param {ReturnType<typeof trailGroups>[number]} group */
function syncTrailGroupReasoning(host, message, group) {
  const text = String(message.reasoning || "")
      .slice(group.rfrom, group.rat)
      .trim(),
    details = host.querySelector(":scope > .reasoning");
  if (!text) return details?.remove();
  if (!details) return host.insertAdjacentHTML("afterbegin", trailReasoningHtml(message, group));
  const body = details.querySelector(".reasoning-body");
  if (body.textContent !== text) body.textContent = text;
  details.dataset.state = "done";
  delete details.dataset.roundLive;
  if (details.open && !details.dataset.touched) settleDetails(details, false);
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
      return `${toolLabel(call.name)}${path ? ` ${path}` : ""}`;
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
    const label = toolLabel(step.name);
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
// 一步的卡片：工具自己登记了画法（指令、文件、请示、差遣、计划、补言）就照它画，其余（检索、翻阅、计算、调接口、翻记忆）用下面通用的一种
/** @param {Step} step */
function stepHtml(step) {
  const title = step.title || stepArgsTitle(step),
    own = TOOLS.get(step.name)?.html;
  return own ? own(step, title) : plainStepHtml(step, title);
}
// 标题还没定下来（步骤刚入册、工具还没跑）时，先从参数里取一个
/** @param {Step} step */
function stepArgsTitle(step) {
  const parsed = parseToolArguments(step.arguments);
  return parsed.ok ? String(parsed.args.query || parsed.args.url || parsed.args.name || "") : "";
}
// 代码（或请求）在上、输出在下，与指令输出同一套折叠与「展开全部」；没有输出的列命中、网址或一句备注。
// 默认折起：一答里几十次检索，命中全摊开要占一整屏；标题行有关键词与结果数，点开才看
/** @param {Step} step */
function plainStepHtml(step, title) {
  let more = "";
  const clamp = text => {
    const out = clampLines(text, step.full);
    if (out.clipped) more = `展开全部 · ${out.total} 行`;
    else if (step.full && out.total > STEP_SHOW_LINES) more = `只看前 ${STEP_SHOW_LINES} 行`;
    return escapeHtml(out.text);
  };
  const link = (url, label) => {
    const href = safeWebUrl(url);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`;
  };
  const outputBody =
    step.code || step.output
      ? `${step.code ? `<pre class="tool-output tool-code">${clamp(step.code)}</pre>` : ""}${step.output ? `<pre class="tool-output">${clamp(step.output)}</pre>` : ""}${more ? `<button type="button" class="tool-more" data-step-more>${more}</button>` : ""}`
      : "";
  const body =
    outputBody ||
    (step.results?.length
      ? `<ul class="tool-results">${step.results
          .slice(0, 8)
          .map(r => `<li>${link(r.url, escapeHtml(r.title || r.url))}${r.snippet ? `<span>${escapeHtml(r.snippet)}</span>` : ""}</li>`)
          .join("")}</ul>`
      : step.url
        ? `<div class="tool-note">${link(step.url, escapeHtml(safeWebUrl(step.url) || step.url))}</div>`
        : step.note
          ? `<div class="tool-note">${escapeHtml(step.note)}</div>`
          : "");
  const status = step.status || "done",
    foldable = !!body,
    folded = foldable && (step.expanded === undefined ? true : !step.expanded);
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? "展开" : "收起"}"` : ""}><span class="tool-label">${escapeHtml(toolLabel(step.name))}</span><span class="tool-title">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "工具执行失败") : ""}">${status === "running" ? "查阅中" : status === "error" ? escapeHtml(step.result || "失败") : escapeHtml(step.result || "")}</span>${stepStateHtml(status)}</div>${body}</div>`;
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
  } else if (TOOLS.get(step.name)?.sync) TOOLS.get(step.name).sync(el, step, prev);
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
    return `${current.status === "pending" ? "等待确认" : "正在"} ${toolLabel(current.name)} ${String(current.title || "").slice(0, 60)}`.trim();
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
          `<span class="helper-row" data-helper="${escapeHtml(h.id)}"><span class="seal helper-seal" aria-hidden="true">帮</span><span class="helper-title"></span><span class="helper-doing"></span><span class="helper-count"></span></span>`
      )
      .join("");
  }
  for (const h of helpers) {
    const row = bar.querySelector(`.helper-row[data-helper="${CSS.escape(h.id)}"]`);
    if (!row) continue;
    // 题目逐次写：条子常在步骤刚入册、runDelegate 还没把题目填上时就搭好了，只在搭时写一次会一直是空的「」
    const title = `差遣「${String(h.title || "").slice(0, 40)}」`;
    if (row.querySelector(".helper-title").textContent !== title) row.querySelector(".helper-title").textContent = title;
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
    body = `<pre class="tool-output tool-cmd-preview">${escapeHtml(title)}</pre>${sandboxWhyHtml(step)}<div class="tool-approve"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="径行：此对话中后续指令不再询问">径行</button></div>`;
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
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}${step.readOnly ? " is-read-only" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? "展开输出" : "收起输出"}"` : ""}><span class="tool-label">${escapeHtml(toolLabel(step.name))}</span><span class="tool-title${command ? " tool-cmd" : ""}" title="${escapeHtml(title)}">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "执行失败") : ""}">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
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
        const existing = [...bodyHost.querySelectorAll(":scope > .trail-group")].find(
          host => !host.classList.contains("trail-live") && host.dataset.at === String(group.at)
        );
        if (existing) {
          syncTrailGroupReasoning(existing, assistant, group);
          continue;
        }
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
  // 出处由各工具登记的 sources 给出；网页里读过全文的排在只见于检索结果的前面
  const found = (message.steps || []).filter(step => step.status === "done").flatMap(step => TOOLS.get(step.name)?.sources?.(step) || []);
  for (const entry of found) if (entry.url && entry.read) add(entry.url, entry.title, true);
  for (const entry of found) if (entry.url && !entry.read) add(entry.url, entry.title, false);
  // 记忆与旧谈：翻过的条目、查到并读过的对话，与网页并列列出，点开各归其处
  const talks = new Map(),
    memories = new Map();
  for (const entry of found) {
    if (entry.talk && (entry.read || !talks.has(entry.talk)))
      talks.set(entry.talk, { id: entry.talk, title: entry.title, date: entry.date, read: !!entry.read });
    if (entry.memory) memories.set(entry.memory, entry.title);
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
        node.parentElement?.closest(".viz-pending, .html-app, .math-pending, sup.note-ref")
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
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
// 目录：按所注消息在对话里的先后排，同一条消息上的按起注时间排，落在同一问 / 答上的归作一组，组头列第几答与那一答的开头；
// 每条列所注的一段（整条回复的列第一问），下面一行是几问几答、最近一次动笔。铺满整页时顶上另有题名，正文让了位也知道注的是哪段对话
/** @param {Conversation} c */
function renderSideIndex(c) {
  $("#sidePanel").dataset.mode = "index";
  $("#sideNav").innerHTML = "";
  $("#sideAnchor").classList.add("hidden");
  const order = new Map(c.messages.map((m, i) => [m.id, i])),
    list = [...visibleThreads(c)].sort(
      (a, b) => order.get(a.anchor.messageId) - order.get(b.anchor.messageId) || String(a.createdAt).localeCompare(String(b.createdAt))
    );
  const where = messageId => {
    const index = order.get(messageId),
      message = c.messages[index],
      nth = c.messages.slice(0, index + 1).filter(m => m.role === message.role).length;
    return `第${chineseNumber(nth)}${message.role === "user" ? "问" : "答"}`;
  };
  const opening = messageId =>
    String(c.messages[order.get(messageId)]?.content || "")
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#>*_`~|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  let group = null;
  const items = list
    .map((thread, i) => {
      const asked = thread.messages.filter(m => m.role === "user").length,
        lead = thread.anchor.text || thread.messages.find(m => m.role === "user")?.content || "尚未落笔",
        running = !!sideJob(thread),
        head =
          thread.anchor.messageId === group
            ? ""
            : `<div class="side-index-group"><span>${escapeHtml(where(thread.anchor.messageId))}</span><em>${escapeHtml(opening(thread.anchor.messageId))}</em></div>`;
      group = thread.anchor.messageId;
      return `${head}<button type="button" class="side-index-item${thread.anchor.messageId === sideIndexFor ? " here" : ""}" data-side-open="${escapeHtml(thread.id)}"><span class="side-index-num">${i + 1}</span><span class="side-index-copy"><strong>${escapeHtml(lead)}</strong><small>${asked ? `${escapeHtml(chineseNumber(asked, true))}问` : "未问"}${running ? " · 作答中" : ""} · ${escapeHtml(formatDay(thread.updatedAt || thread.createdAt))}</small></span></button>`;
    })
    .join("");
  // 「＋」另起一条：正文里划着一段就注在那一段上；没划就是就整条回复而谈（从哪条回复进来的就是哪条，否则是最末一答）
  $("#sideMessages").innerHTML =
    `<div class="side-index" data-message="__index"><div class="side-index-head"><h2>${escapeHtml(c.title)}</h2><div class="side-index-bar"><small>${list.length ? `${escapeHtml(chineseNumber(list.length, true))}条旁注` : ""}</small><button type="button" class="side-index-new" data-side-new title="划选正文中的一段即注在那一段上；未划选则就整条回复而谈"><span>＋</span>另起一条</button></div></div>${
      items
        ? `${items}<p class="side-index-foot">划选正文中的一段，即可就那一段另起旁注</p>`
        : `<div class="side-empty">还没有旁注<br>划选正文中的一段，或按上面的「另起一条」</div>`
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
    if (profile.tools !== false) await mcpReady();
    const tools = profile.tools !== false ? toolDefinitions(conversation, { lookup: true }) : null;
    const overrides = {
      systemPrompt: systemPrompt(conversation, tools, { role: "side", anchor: !!thread.anchor.text }),
      tools,
      reasoning: conversation.reasoning || "",
      head: history.length
    };
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
        history.push({ role: "user", content: prompt("assistant.roundLimit") });
        overrides.tools = null;
        assistant.content = paragraphBreak(assistant.content);
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
        tool_calls: steps.map(step => ({
          id: step.id,
          type: "function",
          function: { name: step.name, arguments: replayArguments(step.arguments) }
        })),
        ...(assistant.thinkingBlocks?.length ? { thinking_blocks: assistant.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, job.controller.signal, toolCache);
      for (const step of steps) history.push({ role: "tool", tool_call_id: step.id, content: outcomes.get(step.id) ?? "" });
      assistant.content = paragraphBreak(assistant.content);
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
    markDirty(conversation.id);
    saveStore();
    if (sideThreadId === thread.id && currentId === conversation.id) renderSidePanel();
    else renderSideSend();
  }
}

  // ---- 11-memory.js ----
// 言 · 录（记忆）：条目的增删与设置页；模型用的五件工具在 15-tools/40-memory.js
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ── 录（记忆）──
// 一条条由模型在对谈中记下的话，跨对话可翻。内容不进系统提示，模型要看得自己 recall；旧对话也只在它去查时才给。
const MAX_MEMORY_ITEMS = 200,
  MEMORY_TEXT_CHARS = 200;
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
    `<div class="about-head memory-head">${brushIcon("memory", "settings-mark")}<h2>记忆</h2><span class="about-version">${items.length} / ${MAX_MEMORY_ITEMS} 条</span></div><p class="settings-lead">模型在对谈中记下长期有效的事，跨对话可翻阅。何时记、何时看由它判断；条目不随请求发送，也不经云端。</p>` +
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
  const elsewhere = runningElsewhere(),
    running = conversationRunning() || elsewhere,
    ended = conversationDry(currentConversation()),
    has = composerHasContent(),
    stop = running && !has;
  document.querySelectorAll(".send-trigger").forEach(b => {
    sealGlyph(b, stop);
    b.title = elsewhere
      ? "另一个页面正在这段对话里作答，这里跟着看"
      : stop
        ? "停止生成"
        : running
          ? "插言引路：模型说到落点便读这句，可就此改道"
          : "发送";
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
    if (!file) return toast("图片原件已找不到");
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
  document.documentElement.style.setProperty("--read", `${Number(width) || 760}px`);
  document.documentElement.style.setProperty("--accent", accent || "#9b5540");
  const root = document.documentElement.style,
    stacks = FONT_STACKS[font] || FONT_STACKS.mixed;
  html.dataset.font = FONT_STACKS[font] ? font : "mixed";
  root.setProperty("--body", stacks.body);
  root.setProperty("--title", stacks.title);
  rethemeHtmlApps();
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
    // 合计上限只管浏览器里的暂存；桥接在线时原件落在存储目录，不受它限
    if (apiBase === null && attachmentUsage + file.size > MAX_ATTACHMENTS_BYTES) {
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
      ? `常用的文件收于此处；置于案上，便随下一问送出。卷宗即本机的一个目录：<code title="${escapeHtml(archiveDir())}">${escapeHtml(archiveDir())}</code>（在存储位置里，可在设置里更换）；未绑目录的对话里，模型写出的文件亦落于此。${
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
  if (!file) return toast("附件原件已找不到");
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
  if (!file) throw Error("附件原件已找不到");
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
    if (!file) return toast("附件原件已找不到");
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
// 上一答动过文件、请示过、差遣过、检索翻阅过的，压成一行带给下一问：模型才记得自己读过、改过哪些文件、查到过哪几条，不必从头再探。
// 哪些步骤带、怎么写，由各工具登记的 digest 定。label 是方括号里的标头：进历史时写「上一答的行迹」（见 historyForApi），存卷宗与压缩转写里写「行迹」
/** @param {Message} message */
function stepsDigest(message, label = "行迹") {
  const steps = (message.steps || []).filter(step => TOOLS.get(step.name)?.digest);
  if (!steps.length) return "";
  const items = steps.slice(0, 16).map(step => {
    const digest = TOOLS.get(step.name).digest;
    return digest === true
      ? `${step.name} ${String(step.title || "").slice(0, 80)} → ${step.status === "skipped" ? "用户跳过" : step.result || step.status}`
      : digest(step);
  });
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
    // 早先消息里的图片只留一行占位，用不着原件：不必每问都把它从存储目录整份取回来
    if (!latest && metadata.kind === "image") {
      content[0].text += `\n\n[图片：${metadata.name}，${formatFileSize(metadata.size)}，已在此前发送]`;
      continue;
    }
    const file = metadata.data !== undefined ? metadata : await getAttachment(metadata.id);
    if (!file) {
      content[0].text += `\n\n[附件 ${metadata.name} 的原件已找不到]`;
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
  // 另一个页面正在这段对话里作答：这边只跟着看，写完再说（话留在输入框里）
  if (runningElsewhere()) return toast("这段对话正在另一个页面作答，写完后这里会跟上，再发不迟");
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
  if (quotaBlocked(profile)) {
    if (currentConversation()) renderConversation();
    toast(quotaExhausted(profile) ? "余墨已尽，请调高上限或更换模型" : "余墨不足：进行中的对话已占去余量，请稍候或调高上限");
    return;
  }
  const sendingDraftKey = draftKey();
  let c = currentConversation();
  if (c && !(await ensureWorkReady(c))) return;
  if (!c) {
    const pending = (store.settings.pendingWorkdir || "").trim() || pendingGroup()?.workdir || "";
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
      presetId: presetOf(null)?.id || "",
      groupId: pendingGroup()?.id || "",
      commandPolicy: normalizeCommandPolicy(presetOf(null)?.policy || store.settings.commandPolicyDefault),
      reasoning: normalizeReasoning(profile.reasoning)
    };
    if (!(await ensureWorkReady(c))) return;
    delete store.settings.pendingGroupId;
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
// 断线后请模型接着写的那句话：手点「继续生成」与自动续写共用
const AUTO_RESUMES = 2;
// 一轮说完、下一轮起笔前隔一个空段；这一轮什么也没说（只调了工具）就不隔，免得正文攒下一串空行
function paragraphBreak(text) {
  return /\S/.test(text) && !text.endsWith("\n\n") ? `${text}\n\n` : text;
}
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
      prefix = prompt(steer ? "assistant.steer" : "assistant.supplement");
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
  markDirty(id);
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
    markDirty(conversation?.id);
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
  /** @type {{ controller: AbortController, assistantId: string, label: string, profile: Profile, queue: Array<{ user: Message, step: Step }>, round: AbortController|null, reading: boolean, roundStart: number, steerTimer: number }} */
  const job = {
    controller: new AbortController(),
    assistantId: assistant.id,
    label: "生成中",
    profile,
    queue: [],
    round: null,
    reading: false,
    roundStart: 0,
    steerTimer: 0
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
    // 预留只是估个数：一答的输出按八千算，不必与接口实际的上限一致
    releaseQuota = reserveTokens(profile, estimateTokens(history) + (Number(profile.maxTokens) || 8192));
    if (resume && assistant.content) {
      history.push({ role: "assistant", content: assistant.content });
      history.push({ role: "user", content: prompt("assistant.resume") });
    }
    if (profile.tools !== false) await mcpReady();
    const tools = profile.tools !== false ? toolDefinitions(conversation) : null;
    let retrying = false;
    const overrides = {
      systemPrompt: systemPrompt(conversation, tools),
      tools,
      reasoning: conversation.reasoning || "",
      onRetry: n => {
        retrying = true;
        setJobLabel(conversation, job, `网络不稳 · 第 ${n} 次重试`);
      },
      head: history.length,
      onFold: busy => setJobLabel(conversation, job, busy ? "上下文将满 · 整理中" : "生成中")
    };
    const toolCache = new Map();
    let rounds = 0,
      resumed = 0;
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
        await readReply(profile, history, round.signal, overrides, assistant, false, () => {
          roundOpen = opened = true;
          if (retrying) setJobLabel(conversation, job, "生成中");
          retrying = false;
        });
      } catch (error) {
        // 写到一半断了：已写的留着，稍候请它从断处接着写（半截的工具调用作废，这一轮重来），同一轮最多接两回，再断才算中断
        if (error.midStream && !job.controller.signal.aborted && resumed < AUTO_RESUMES) {
          resumed += 1;
          const said = assistant.content.slice(roundStart);
          if (roundOpen) {
            const spent = estimateTokens(history) + estimateTokens([{ content: said }]);
            usage.prompt_tokens += spent;
            usage.total_tokens += spent;
            usageKnown = steered = true;
            roundOpen = false;
          }
          assistant.toolCalls = null;
          if (said.trim()) history.push({ role: "assistant", content: said }, { role: "user", content: prompt("assistant.resume") });
          setJobLabel(conversation, job, "网络不稳 · 稍候接着写");
          await restFor(2000 * resumed, job.controller.signal);
          setJobLabel(conversation, job, "生成中");
          continue;
        }
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
        assistant.content = paragraphBreak(assistant.content);
        continue;
      } finally {
        job.reading = false;
        job.round = null;
        clearInterval(job.steerTimer);
        job.steerTimer = 0;
        job.controller.signal.removeEventListener("abort", stopRound);
      }
      resumed = 0; // 接续的次数按轮算：长活跑上几百轮，前面断过两回不该让后面再断就没得接
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
        history.push({ role: "user", content: prompt("assistant.roundLimit") });
        overrides.tools = null;
        assistant.content = paragraphBreak(assistant.content);
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
        tool_calls: steps.map(step => ({
          id: step.id,
          type: "function",
          function: { name: step.name, arguments: replayArguments(step.arguments) }
        })),
        ...(assistant.thinkingBlocks?.length ? { thinking_blocks: assistant.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, job.controller.signal, toolCache);
      for (const step of steps) history.push({ role: "tool", tool_call_id: step.id, content: outcomes.get(step.id) ?? "" });
      await deliverSupplements(job, history, budget, assistant);
      assistant.content = paragraphBreak(assistant.content);
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
    if (archiveBefore && allSteps(assistant).some(step => TOOLS.get(step.name)?.writes)) {
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
    markDirty(conversation.id);
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
  // 长活：这一答的工具往来快撑满窗口了，先压掉较早的几轮再发（见 18-context-outline.js 的 keepInWindow）
  if (!retried) await keepInWindow(profile, history, signal, overrides);
  const response = await requestPatiently(profile, history, signal, overrides);
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
    // 接口回说放不下：压掉这一答较早的往来再发一回；已无可压的，原样报错
    if (contextOverflow(message) && (await keepInWindow(profile, history, signal, overrides, { overflow: true })))
      return readReply(profile, history, signal, overrides, target, true, onOpen, onFrame);
    throw Error(message);
  }
  onOpen?.();
  const type = response.headers.get("content-type") || "";
  // 帮手与消息的流式字段一致（content / reasoning / toolCalls / usage），readSse 按消息处理
  const sink = /** @type {Message} */ (target);
  // 记下这次请求实际的提示用量，下一轮据此估算会不会撑破窗口
  const sentAt = history.length,
    note = () => {
      if (Number(target.usage?.prompt_tokens) > 0) overrides.seen = { at: sentAt, tokens: Number(target.usage.prompt_tokens) };
    };
  if (type.includes("text/event-stream"))
    return readSse(response, sink, { onFrame }).then(note, error => {
      // 开了口才断的（掉线、上游掐线、静默超时）：记一笔，streamReply 据此接着写而不是整答作废
      if (error.name !== "AbortError") error.midStream = true;
      throw error;
    });
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
  note();
}
// 网络一晃就断太脆：接口没接下请求时（连不上、限流、5xx、过载）等一等再试，间隔渐长，接口给了 Retry-After 就照它等；
// 断网时等网回来再试。参数错、鉴权错这类 4xx 试也白试，原样交回。overrides.onRetry 用来在页面上说一声「第几次重试」
const RETRY_DELAYS = [1000, 2000, 4000, 8000];
const retryableStatus = status => status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
/** 等 ms 毫秒（断网就等到网回来）；中途停止即抛 AbortError */
function restFor(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    const done = () => {
      clearTimeout(timer);
      removeEventListener("online", wake);
      signal?.removeEventListener("abort", stop);
    };
    const wake = () => {
      done();
      resolve(null);
    };
    const stop = () => {
      done();
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    const timer = setTimeout(() => (navigator.onLine ? wake() : addEventListener("online", wake, { once: true })), ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}
/** @param {Profile} profile */
async function requestPatiently(profile, history, signal, overrides) {
  for (let attempt = 0; ; attempt++) {
    let wait = RETRY_DELAYS[attempt];
    try {
      const response = await requestChat(profile, history, signal, overrides);
      if (response.ok || !retryableStatus(response.status) || wait === undefined) return response;
      const after = Number(response.headers.get("retry-after"));
      if (after > 0) wait = Math.min(after * 1000, 60000);
      response.body?.cancel().catch(() => {});
    } catch (error) {
      if (error.name === "AbortError" || wait === undefined) throw error;
    }
    overrides.onRetry?.(attempt + 1);
    await restFor(wait, signal);
  }
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
    markDirty(conversation.id);
    saveStore();
    renderHistory();
    // 用户正在页面上方改着标题：不把拟好的题写进去盖掉他的字，他落笔（blur）时以他写的为准
    if (currentId === conversation.id) {
      if (document.activeElement !== $("#chatTitle")) $("#chatTitle").textContent = title;
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
// 系统提示：预设的提示词在最前，其后照 prompts/assistant.js 的 order 表逐段拼——每段何时带上（给了哪件工具、言还是行、主答 / 旁注 / 帮手）写在表里；
// 要填值、或视情形不带的，在这里给出：给 null 即这回不带。工具各自做什么、何时用，在工具说明里说，这里不重复
/** @type {Record<string, (ctx: { conversation: Conversation, tools: Set<string>, preset: Preset|null, anchor: boolean }) => Record<string, any>|null>} */
const PROMPT_VARS = {
  "assistant.today": () => ({ day: formatDay(now()), iso: new Date().toISOString().slice(0, 10) }),
  "work.hint": ctx => workVars(ctx.conversation),
  "work.archive": ctx => workVars(ctx.conversation),
  "work.env": () => envVars(),
  "memory.hint": () => ({ count: store.memory.items.length }),
  "mcp.hint": ctx => mcpHintVars(ctx.tools, ctx.preset),
  "side.passage": ctx => (ctx.anchor ? {} : null),
  "side.whole": ctx => (ctx.anchor ? null : {}),
  "side.noTools": ctx => (ctx.tools.size ? null : {})
};
/**
 * @param {Conversation} conversation
 * @param {any[]|null} tools 这回交给模型的工具定义
 * @param {{ role?: "main"|"side"|"sub", anchor?: boolean }} [options] anchor：旁注注的是划选的一段（否则是整条回复）
 */
function systemPrompt(conversation, tools, { role = "main", anchor = false } = {}) {
  const preset = presetOf(conversation),
    ctx = { conversation, tools: new Set((tools || []).map(tool => tool?.function?.name)), preset, anchor },
    mode = isWork(conversation) ? "work" : "chat",
    lines = [];
  for (const section of PROMPTS.order || []) {
    if (
      (section.tool && !ctx.tools.has(section.tool)) ||
      (section.mode && section.mode !== mode) ||
      (section.roles && !section.roles.includes(role))
    )
      continue;
    const vars = PROMPT_VARS[section.key] ? PROMPT_VARS[section.key](ctx) : {};
    if (vars) lines.push(prompt(section.key, vars));
  }
  const own = String(preset?.prompt || "").trim();
  return own ? `${own}\n\n${lines.join("\n")}` : lines.join("\n");
}
// 执事（work.hint）与卷宗（work.archive）两段的值：目录、平台、可及范围
/** @param {Conversation} conversation */
function workVars(conversation) {
  const win = (bootstrap.work?.platform || "win32") === "win32",
    shell = bootstrap.work?.shell || (win ? "PowerShell" : "sh");
  return {
    workdir: workRoot(conversation),
    scratch: scratchRel(conversation),
    // 沙箱两档：问而后行用严的（拦下的转请用户定夺），审而后行、径行用宽的（只守系统本身）
    reach: prompt(
      sandboxed()
        ? commandPolicyOf(conversation) === "ask"
          ? "work.reachSandbox"
          : "work.reachSandboxLoose"
        : roamAllowed()
          ? "work.reachAnywhere"
          : "work.reachInside"
    ),
    platform: win ? "Windows" : bootstrap.work?.platform || "类 Unix",
    shell,
    shellNote: win ? prompt("work.windowsShell") : ""
  };
}

  // ---- 15-tools/00-registry.js ----
// 言 · 工具注册表：一件工具一份登记，写明给谁用、什么性质、怎么执行、行迹怎么画、带给下一问怎么说
// 本目录各段与 src/ 下其余各段一样，由桥接（或 node build.js）按路径顺序拼进同一个闭包；无需模块系统。
// 说给模型听的话（description 与参数）不在登记里，在 prompts/tools.js，按工具名对上；日后外来的工具（接口卡、MCP）自带 schema。
// 交给模型的工具定义、执行、行迹卡片、摘要、出处都从这张表派生：加一件工具，只需在本目录加一份登记、在 prompts/tools.js 加一段说明
/**
 * @typedef {Object} ToolContext 执行时的处境
 * @property {Conversation} conversation
 * @property {Message} assistant 页面上的那一答（帮手的步骤也画在它的行迹里）
 * @property {AbortSignal} signal
 *
 * @typedef {Object} OfferContext 此处给不给某件工具，看这几样
 * @property {Conversation} conversation
 * @property {boolean} work 执事（绑了工作目录，且不是旁注）
 * @property {boolean} bridge 本机桥接在线
 * @property {boolean} files 有可落脚的目录（工作目录或卷宗）
 * @property {Array<Record<string, any>>} docs 可读的文档
 * @property {string[]} offered 登记在前、此处已经给出的工具
 * @property {Preset|null} preset 这段对话用的预设：只给它挑中的几组与几个 MCP 服务
 *
 * @typedef {{ ok: boolean, content: string, display: string }} ToolOutcome content 回给模型，display 写在标题行右侧
 * @typedef {{ url?: string, title?: string, read?: boolean, talk?: string, date?: string, memory?: string }} Source 答末「出处」的一条：网页、旧谈或记忆
 *
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} label 行迹上的名字
 * @property {keyof typeof TOOL_GROUPS} [group] 属哪一组：预设按组挑内置工具
 * @property {string} [server] MCP 工具属哪个服务：预设按服务挑
 * @property {false | ((ctx: OfferContext) => boolean)} [offer] 此处给不给；不写即处处都给，false 是只登记画法、从不交给模型的步骤（补言）
 * @property {boolean} [mainOnly] 只给主模型，帮手拿不到
 * @property {boolean} [lookup] 旁注（只查不改）也给
 * @property {(ctx: OfferContext) => Record<string, any>} [vars] 说明里 {{名字}} 的值
 * @property {{ description: string, brief?: string, parameters: Record<string, any> }} [schema] 自带的说明与参数；不写则取 prompts/tools.js
 * @property {boolean} [parallel] 可与相邻的同类一起跑
 * @property {boolean} [sideEffect] 有副作用：参数 JSON 残缺就不执行
 * @property {boolean} [writes] 会在目录里出新文件：言里据此收成品
 * @property {true | ((args: Record<string, any>) => Record<string, any> | null)} [cache] 同一答里同样的参数直接复用结果；函数给出规范化后的参数，给 null 即这次不复用
 * @property {(step: Step, args: Record<string, any>, ctx: ToolContext) => ToolOutcome | Promise<ToolOutcome>} [run]
 * @property {(step: Step, title: string) => string} [html] 行迹卡片；不写用通用的一种
 * @property {(el: Element, step: Step, prev: { status: string } | undefined) => void} [sync] 卡片就地更新（不写则变了就整张换）
 * @property {(step: Step) => string} [approval] 请示条的内容
 * @property {true | ((step: Step) => string)} [digest] 带给下一问的一行；true 用通用写法，不写即不带
 * @property {(step: Step) => Source[]} [sources] 答末「出处」里列的条目
 * @property {boolean} [mcp] 由 MCP 服务登记的（配置一变就整批换掉）
 */
// 内置工具的分组：预设按组挑（一件件挑太碎），设置里照这个次序列
const TOOL_GROUPS = {
  web: "联网",
  compute: "计算",
  work: "指令与文件",
  docs: "翻文档",
  ask: "请示",
  memory: "记忆与旧谈",
  delegate: "差遣"
};
/** @type {Map<string, Tool>} 按登记先后排，交给模型时也是这个次序 */
const TOOLS = new Map();
/** @param {Tool} tool */
function defineTool(tool) {
  TOOLS.set(tool.name, tool);
}
function toolLabel(name) {
  return TOOLS.get(name)?.label || name;
}
function toolSpec(name) {
  return TOOLS.get(name)?.schema || PROMPTS.tools[name];
}
// 此处交给模型的工具。sub：帮手的一套（只给主模型的除外）；lookup：旁注的一套，只查不改。
// 言（对谈）里带 brief 的用短说明：对谈的每一问都背着这份定义，越轻越好
/** @param {Conversation} conversation */
function toolDefinitions(conversation, { sub = false, lookup = false } = {}) {
  /** @type {OfferContext} */
  const ctx = {
    conversation,
    work: isWork(conversation) && !lookup,
    bridge: apiBase !== null,
    files: !!workRoot(conversation),
    docs: availableDocuments(conversation),
    offered: [],
    preset: presetOf(conversation)
  };
  const tools = [];
  for (const tool of TOOLS.values()) {
    if (
      !tool.run ||
      (sub && tool.mainOnly) ||
      (lookup && !tool.lookup) ||
      !presetAllows(ctx.preset, tool) ||
      (tool.offer && !tool.offer(ctx))
    )
      continue;
    const spec = toolSpec(tool.name),
      text = !ctx.work && spec.brief ? spec.brief : spec.description,
      // 外来工具自带的说明原样给，不当模板填（里头的 {{…}} 是人家的字）
      description = tool.schema ? text : fillTemplate(text, tool.vars?.(ctx));
    tools.push({ type: "function", function: { name: tool.name, description, parameters: spec.parameters } });
    ctx.offered.push(tool.name);
  }
  return tools.length ? tools : null;
}
// 预设挑了哪几组、哪几个 MCP 服务：内置的按组，逐件摊开的 MCP 工具按服务；按需给的两件（mcp_describe / mcp_call）看目录里还剩不剩服务，由它们自己的 offer 管
/** @param {Preset|null} preset @param {Tool} tool */
function presetAllows(preset, tool) {
  if (!preset) return true;
  if (tool.server) return !preset.mcp || preset.mcp.includes(tool.server);
  return !tool.group || !preset.tools || preset.tools.includes(tool.group);
}
/**
 * 跑一步：先把参数理顺（见 01-arguments.js），讲不通的原样告诉模型错在哪；理顺了交给那件工具
 * @param {Step} step
 * @param {ToolContext} ctx
 * @returns {Promise<ToolOutcome>}
 */
async function runTool(step, ctx) {
  const tool = TOOLS.get(step.name);
  if (!tool?.run) return { ok: false, content: `未知工具 ${step.name}`, display: "未知工具" };
  // 帮手没拿到的工具，它也可能照着名字调
  if (step.scope && tool.mainOnly)
    return { ok: false, content: `${step.name} 只有主模型可用；需要它做的事写进回报里，由主模型决定。`, display: "帮手无权" };
  const parsed = parseToolArguments(step.arguments);
  if (!parsed.ok)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数不是合法 JSON（${parsed.error}）。arguments 必须是一个 JSON 对象，不要加代码围栏、注释或多余的逗号，也不要把它再编码成字符串；内容过长时先精简再发。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（前 300 字）：${parsed.raw.slice(0, 300)}`,
      display: "参数解析失败"
    };
  // 截断的参数救回来也不能拿去写：内容已经不全，写下去就是把文件写坏
  if (parsed.truncated && tool.sideEffect)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数 JSON 不完整（多半是输出被最大长度截断），为安全起见没有执行。请把内容精简或分成几次写入（大文件先 write_file 写开头，再用 edit_file 追加），确保 arguments 是完整的 JSON。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（末尾 200 字）：…${step.arguments.slice(-200)}`,
      display: "参数不完整"
    };
  const { args, problems } = normalizeToolArguments(step.name, parsed.args);
  if (problems.length)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数不合要求：${problems.join("；")}。这件工具收的参数：${toolSchemaHint(step.name)}；实际收到的键：${Object.keys(parsed.args).join("、") || "（无）"}${parsed.truncated ? "\n（参数 JSON 不完整，可能是输出被截断）" : ""}\n\n收到的原文（前 300 字）：${step.arguments.slice(0, 300)}`,
      display: "参数不合要求"
    };
  try {
    return await tool.run(step, args, ctx);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    const message = String(error.message || error);
    return { ok: false, content: `工具执行失败：${message}`, display: friendlyError(message).slice(0, 60) };
  }
}
// 同一答里同样的参数不必再跑一遍：键是工具名加规范化后的参数，怎么规范由各工具的 cache 定
/** @param {Step} step */
function toolCacheKey(step) {
  const cache = TOOLS.get(step.name)?.cache,
    parsed = cache ? parseToolArguments(step.arguments) : null;
  if (!parsed?.ok) return null;
  const args = cache === true ? parsed.args : cache(parsed.args);
  return args ? `${step.name}:${JSON.stringify(stableToolJson(args))}` : null;
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
// 复用结果时连同呈现一起搬过来：标题、网址、备注、命中
/** @param {Step} step */
function toolPresentation(step) {
  return {
    title: step.title || "",
    url: step.url || "",
    note: step.note || "",
    results: step.results ? structuredClone(step.results) : null
  };
}
// 把一批工具调用跑完，返回各步回给模型的结果。相邻的可并发的一起跑（读、搜、翻网页、翻记忆彼此无关）；会改状态或要请示的按原顺序逐个来。
// 主模型、帮手与旁注共用这一段：assistant 是页面上那条消息（帮手的步骤也画在它的行迹里）
/**
 * @param {Step[]} steps
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runSteps(steps, conversation, assistant, signal, toolCache) {
  const outcomes = new Map(),
    ctx = { conversation, assistant, signal };
  const runOne = async step => {
    const started = performance.now(),
      key = toolCacheKey(step),
      cached = key ? toolCache.get(key) : null;
    let outcome;
    if (cached) {
      Object.assign(step, structuredClone(cached.presentation));
      step.cached = true;
      outcome = structuredClone(cached.outcome);
      outcome.display = `复用 · ${outcome.display}`;
    } else {
      outcome = await runTool(step, ctx);
      // 只缓存成功的：临时的 502、超时若也缓存，模型想重试只会一直拿到同一个旧失败
      if (key && outcome.ok) toolCache.set(key, { outcome: structuredClone(outcome), presentation: toolPresentation(step) });
    }
    const remaining = MIN_TOOL_STATUS_MS - (performance.now() - started);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    step.status = step.skipped ? "skipped" : outcome.ok ? "done" : "error";
    step.result = outcome.display;
    outcomes.set(step.id, String(outcome.content).slice(0, 60000));
    refreshSteps(assistant);
    saveStore();
  };
  const parallel = step => !!TOOLS.get(step.name)?.parallel;
  for (let i = 0; i < steps.length; ) {
    let j = i + 1;
    if (parallel(steps[i])) while (j < steps.length && parallel(steps[j])) j += 1;
    await Promise.all(steps.slice(i, j).map(runOne));
    i = j;
  }
  return outcomes;
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
// 步骤上留着的输出只留末尾一截：指令跑出几万行，整份存进对话既占地方也没人看
const STEP_OUTPUT_KEEP = 6000;
function trimOutput(text) {
  const value = String(text || "");
  return value.length > STEP_OUTPUT_KEEP ? `…（前面 ${value.length - STEP_OUTPUT_KEEP} 字略去）\n${value.slice(-STEP_OUTPUT_KEEP)}` : value;
}
function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
}

  // ---- 15-tools/01-arguments.js ----
// 言 · 工具参数：模型给的参数在这里过一道关，理顺了才交给工具。工具里拿到的 args 已按 schema 归位、定型，必填项一个不缺
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
// 回传给接口的工具调用参数必须是一个合法的 JSON 对象：模型写坏的（如 "params": , ）若原样回传，有的中转一解析就让整个请求报错，
// 这一答便断在半途。写坏这件事已在工具结果里告诉模型了，历史里给救回的参数，救不回的给 {}
function replayArguments(raw) {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return raw;
  } catch {}
  const parsed = parseToolArguments(raw);
  return parsed.ok ? JSON.stringify(parsed.args) : "{}";
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
// 按工具的 schema 把参数理顺：模型写参数常有小出入，能理解的都照单收下，只有真讲不通的才算失败——
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
  id: ["conversation_id", "conversationId", "memory_id"],
  params: ["arguments", "args", "input"]
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
  return normalizeArguments(toolSpec(name)?.parameters, raw);
}
// 对着一份 JSON Schema 理顺：内置工具用自己的 parameters，mcp_call 用目标工具的 inputSchema
function normalizeArguments(spec, raw) {
  const args = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
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
// 参数出错时回给模型的一行 schema 摘要
function toolSchemaHint(name) {
  return schemaHint(toolSpec(name)?.parameters);
}
function schemaHint(spec) {
  if (!spec?.properties) return "见工具定义";
  const required = new Set(spec.required || []);
  return Object.entries(spec.properties)
    .map(([key, value]) => `${key}（${value.type || "any"}${required.has(key) ? "，必填" : "，可选"}）`)
    .join("、");
}

  // ---- 15-tools/02-approval.js ----
// 言 · 请示：步骤挂起、等用户定夺——运行一条指令（run_command），或答一张小表单（ask_user）。
// 请示条从输入框上方浮出，不必去行迹里找那一行；条上画什么由那件工具的 approval 定。输入框留空时按 Enter 即运行或翻到下一题
const pendingApprovals = new Map();
/**
 * 挂起这一步，等用户在请示条上定夺，返回定夺的结果；定了之后任务条上写 label
 * @param {Step} step
 * @param {ToolContext} ctx
 */
async function askApproval(step, { conversation, assistant, signal }, label) {
  const job = requestJob(conversation.id);
  step.status = "pending";
  if (job) setJobLabel(conversation, job, "等待确认");
  refreshSteps(assistant);
  saveStore();
  renderHistory();
  const answer = await new Promise((resolve, reject) => {
    const done = value => {
      pendingApprovals.delete(step.id);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      pendingApprovals.delete(step.id);
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pendingApprovals.set(step.id, { conversationId: conversation.id, resolve: done, step });
    renderApprovalBar();
  }).finally(renderApprovalBar);
  step.status = "running";
  if (job) setJobLabel(conversation, job, label);
  refreshSteps(assistant);
  renderHistory();
  return answer;
}
function settleApproval(stepId, value) {
  pendingApprovals.get(stepId)?.resolve(value);
}
function pendingApprovalHere() {
  const c = currentConversation();
  if (!c) return null;
  for (const entry of pendingApprovals.values()) if (entry.conversationId === c.id) return entry;
  return null;
}
function renderApprovalBar() {
  const bar = $("#approvalBar");
  const entry = view === "chat" ? pendingApprovalHere() : null;
  if (!entry) {
    bar.dataset.stepId = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  if (bar.dataset.stepId !== entry.step.id) {
    bar.dataset.stepId = entry.step.id;
    bar.dataset.page = "0";
    bar.innerHTML = TOOLS.get(entry.step.name).approval(entry.step);
    formPage(bar);
  }
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}
// 请示条或行迹里的「运行 / 跳过 / 径行」
function approveFrom(button) {
  const stepId = button.closest("[data-step-id]")?.dataset.stepId,
    c = currentConversation();
  if (!stepId || !c) return;
  if (button.dataset.approve === "auto") {
    c.commandPolicy = "auto";
    saveStore();
    renderWorkAuto();
  }
  settleApproval(stepId, button.dataset.approve !== "skip");
}
// 输入框留空时按 Enter：指令即运行；表单翻到下一题，末题即提交
function approveByEnter(entry) {
  if (!entry.step.form) return settleApproval(entry.step.id, true);
  const bar = $("#approvalBar"),
    page = Number(bar.dataset.page || 0),
    total = bar.querySelectorAll(".ask-q").length;
  if (page < total - 1) return formPage(bar, page + 1);
  const answers = collectForm(bar);
  if (answers?.some(Boolean)) return settleApproval(entry.step.id, answers);
  toast("请先在上方作答");
}

  // ---- 15-tools/10-web.js ----
// 言 · 联网：检索、翻网页、调接口，都经桥接。地址门禁在桥接那头：本机 127.0.0.1 可，别的内网地址不可
defineTool({
  name: "search_web",
  group: "web",
  label: "检索",
  offer: ctx => ctx.bridge,
  lookup: true,
  parallel: true,
  cache: args => ({ ...args, query: args.query.trim().replace(/\s+/g, " ").toLowerCase() }),
  digest: step =>
    `检索「${String(step.title || "").slice(0, 60)}」→ ${
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
    return {
      ok: true,
      content: step.results.length ? JSON.stringify(step.results) : "未找到结果",
      display: `${step.results.length} 条结果`
    };
  }
});

defineTool({
  name: "fetch_page",
  group: "web",
  label: "翻阅网页",
  offer: ctx => ctx.bridge,
  lookup: true,
  parallel: true,
  // 同一页的不同锚点是同一页
  cache: args => ({ ...args, url: URL.canParse(args.url) ? Object.assign(new URL(args.url), { hash: "" }).href : args.url.trim() }),
  digest: step =>
    `翻阅 ${String(step.title || step.url || "").slice(0, 60)}${step.url && step.title ? `（${step.url}）` : ""} → ${step.status === "done" ? "已读" : step.result || step.status}`,
  sources: step => [{ url: step.url, title: step.title, read: true }],
  async run(step, args, { signal }) {
    step.url = args.url;
    const data = await bridge("/api/fetch", { url: args.url }, signal);
    step.title = data.title || args.url;
    return { ok: true, content: `标题：${data.title}\n地址：${data.url}\n\n${data.text}`, display: `${data.text.length} 字` };
  }
});

// 调接口能发 POST，不算纯查阅，旁注不给；只有 GET / HEAD 的结果可复用
defineTool({
  name: "http_request",
  group: "web",
  label: "调接口",
  offer: ctx => ctx.bridge,
  sideEffect: true,
  cache: args => (/^\s*(GET|HEAD)?\s*$/i.test(args.method || "") ? args : null),
  async run(step, args, { signal }) {
    const url = args.url.trim(),
      method = (args.method || "GET").trim().toUpperCase();
    step.url = url;
    step.title = `${method} ${url}`.slice(0, 200);
    const data = await bridge("/api/http", { url, method, headers: args.headers, body: args.body }, signal);
    const headers = Object.entries(data.headers)
      .map(([name, value]) => `${name}: ${String(value).slice(0, 300)}`)
      .join("\n");
    const body = data.textual ? data.text || "(空)" : `（${data.type || "二进制"}，${formatFileSize(data.bytes)}，不作为文本返回）`;
    step.output = trimOutput(`${data.status} ${data.statusText}\n${body}`);
    return {
      ok: data.status < 400,
      content: `HTTP ${data.status} ${data.statusText}${data.url !== url ? `（跳转到 ${data.url}）` : ""}\n--- 响应头 ---\n${headers}\n--- 正文${data.truncated ? "（已截断）" : ""} ---\n${body}`,
      display: `${data.status} · ${data.textual ? `${data.text.length} 字` : formatFileSize(data.bytes)}`
    };
  }
});

  // ---- 15-tools/11-compute.js ----
// 言 · 计算：run_js 在浏览器里的隔离沙箱跑一段 JS，不经桥接，直连也有。
// 沙箱是一个 sandbox iframe（origin null、CSP 不许联网）里的 Worker，由 preview-runtime.js 承担；每次现起一个 iframe、算完就撤，超时由那头把 Worker 杀掉
defineTool({
  name: "run_js",
  group: "compute",
  label: "计算",
  lookup: true,
  parallel: true,
  cache: true,
  async run(step, args, { signal }) {
    const code = args.code.trim();
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
      display: result.ok ? (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`) : "出错"
    };
  }
});
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
      signal.removeEventListener("abort", onAbort);
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
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    document.body.append(iframe);
  });
}

  // ---- 15-tools/20-command.js ----
// 言 · 指令：run_command 与后台指令的 check_command。言与行都有，言里落在卷宗目录、行里落在工作目录。
// 三档权限：问而后行（只读免问）、审而后行（不请示，桥接代判放行或回绝）、径行；逐段对话设置，请示条上按「径行」即切过去
defineTool({
  name: "run_command",
  group: "work",
  label: "运行",
  offer: ctx => ctx.files,
  sideEffect: true,
  writes: true,
  html: workStepHtml,
  approval: commandApprovalHtml,
  digest: true,
  async run(step, args, ctx) {
    const { conversation, signal } = ctx,
      { workdir, sandbox } = workScope(conversation);
    step.title = args.command.trim();
    if (!step.title) return { ok: false, content: "指令为空", display: "指令为空" };
    step.readOnly = isReadOnlyCommand(step.title);
    const background = args.background === true;
    if (background) step.background = true;
    let policy = commandPolicyOf(conversation);
    // 问而后行开着沙箱：先问一声严的沙箱会不会拦。会拦的也请示（只读的也不例外），请示条写明原因；批了这一条就出沙箱跑
    if (policy === "ask" && sandbox) {
      const screened = await bridge("/api/work/screen", { workdir, command: step.title }, signal).catch(() => null);
      step.sandboxWhy = screened?.why || undefined;
    }
    let escalated = false;
    if (policy === "ask" && (!step.readOnly || step.sandboxWhy)) {
      if (!(await askApproval(step, ctx, "执行中"))) {
        step.skipped = true;
        return { ok: false, content: prompt("work.skipped"), display: "已跳过" };
      }
      escalated = !!step.sandboxWhy;
    } else {
      const job = requestJob(conversation.id);
      if (job) setJobLabel(conversation, job, "执行中");
    }
    // 用户可能在请示条上把这一段对话切成了径行：执行前再取一次，不沿用旧档位
    policy = commandPolicyOf(conversation);
    const data = await bridge(
      "/api/work/run",
      {
        workdir,
        sandbox: sandbox && !escalated,
        permission: policy,
        command: step.title,
        timeout: Number(args.timeout) || 120,
        background
      },
      signal
    );
    const seconds = (data.durationMs / 1000).toFixed(data.durationMs < 10000 ? 1 : 0),
      marks = `${escalated ? " · 出沙箱" : ""}${step.readOnly && policy === "ask" && !step.sandboxWhy ? " · 只读免确认" : ""}`;
    step.output = commandOutput(data);
    if (background) {
      step.exitCode = data.exitCode ?? undefined;
      return {
        ok: data.running || data.exitCode === 0,
        content: `${data.running ? `后台指令 ${data.id} 仍在跑（已 ${seconds} 秒），用 check_command 取新输出或结束它` : `后台指令 ${data.id} 已结束，退出码：${data.exitCode}`}\n--- stdout ---\n${data.stdout || "(空)"}\n--- stderr ---\n${data.stderr || "(空)"}`,
        display: `${data.running ? `后台 ${data.id} · 在跑` : `后台 ${data.id} · 退出码 ${data.exitCode}`}${marks}`
      };
    }
    step.exitCode = data.exitCode;
    return {
      ok: !data.timedOut && data.exitCode === 0,
      content: `退出码：${data.exitCode}${data.timedOut ? "（超时被终止）" : ""}\n--- stdout ---\n${data.stdout || "(空)"}\n--- stderr ---\n${data.stderr || "(空)"}`,
      display: `${data.timedOut ? `超时终止 · ${seconds}s` : data.exitCode === 0 ? `完成 · ${seconds}s` : `退出码 ${data.exitCode} · ${seconds}s`}${marks}`
    };
  }
});

// 后台指令：取上次之后的新输出，可顺带等一会儿，或结束它；只给行，跟着 run_command 的 background 走
defineTool({
  name: "check_command",
  group: "work",
  label: "后台",
  offer: ctx => ctx.files && ctx.work,
  html: workStepHtml,
  async run(step, args, { signal }) {
    const id = args.id.trim(),
      stop = args.stop === true;
    step.title = `${id}${stop ? " · 结束" : ""}`;
    const data = await bridge("/api/work/check", { id, stop, wait: Number(args.wait) || 0 }, signal);
    step.output = commandOutput(data);
    if (!data.running) step.exitCode = data.exitCode;
    return {
      ok: true,
      content: `${data.running ? `${data.id} 仍在跑` : `${data.id} 已结束，退出码：${data.exitCode}`}\n--- 新的 stdout ---\n${data.stdout || "(空)"}\n--- 新的 stderr ---\n${data.stderr || "(空)"}`,
      display: data.running ? "在跑" : stop ? "已结束" : `退出码 ${data.exitCode}`
    };
  }
});

function commandOutput(data) {
  return trimOutput([data.stdout, data.stderr].filter(Boolean).join(data.stdout && data.stderr ? "\n--- stderr ---\n" : ""));
}
// 文件与指令工具发给桥接的共同几样：落在哪个目录、能不能出目录、沙箱开没开、这段对话的档位
/** @param {Conversation} conversation */
function workScope(conversation) {
  const workdir = workRoot(conversation);
  if (!workdir) throw Error("此对话没有可用的目录（本机桥接不在线）");
  return { workdir, roam: roamAllowed(), sandbox: sandboxed(), permission: commandPolicyOf(conversation) };
}
// 文件工具能不能出目录：设置里的「可及范围」，默认全盘（系统级配置、别处的资料本就该读得到）
function roamAllowed() {
  return store.settings.toolReach !== "inside";
}

// 「问而后行」里的本机规则：明确只读才免确认。系统检查纳入白名单；只允许一组纯展示管道，脚本块、远程会话与重定向仍去请示
const READ_ONLY_COMMAND =
    /^(?:git\s+(?:status|log|diff|show|rev-parse|ls-files|remote\s+-v)\b|git\s+branch(?:\s+(?:-a|-r|-v|-vv|--list))*\s*$|(?:ls|dir|tree|pwd|cat|type|head|tail|wc|grep|findstr|which|where|whoami|hostname|uname|uptime|free|df|du|ps|lscpu|lsmem|lsblk|lspci|lsusb|mount|id|groups|sw_vers|vm_stat)\b|Get-(?:ChildItem|Content|Location|Command|Item|ItemProperty|Date|ComputerInfo|CimInstance|WmiObject|Process|Service|NetAdapter|NetIPConfiguration|NetIPAddress|NetRoute|NetTCPConnection|NetUDPEndpoint|DnsClientServerAddress|Volume|Disk|Partition|PhysicalDisk|StorageReliabilityCounter|MpComputerStatus|HotFix|WinEvent|EventLog|ScheduledTask|LocalUser|LocalGroup|Acl|Package)\b|Select-String\b|(?:systeminfo|tasklist|driverquery|ipconfig|netstat)\b|sc(?:\.exe)?\s+query\b|wmic(?:\.exe)?\b[^\n]*\bget\b|wsl(?:\.exe)?\s+(?:--status|--version|-l\b|--list\b)|docker\s+(?:version|info|ps|images)\b|(?:node|npm|npx|python|python3|pip|dotnet|java|go|cargo|rustc|ruby|php|git)\s+(?:-v|-V|--version|version)\s*$)/i,
  READ_ONLY_PIPE =
    /^(?:Select-Object|Sort-Object|Format-Table|Format-List|ConvertTo-Json|Measure-Object|Group-Object|findstr|grep|head|tail|wc)\b/i;
function isReadOnlyCommand(command) {
  const text = String(command || "").trim();
  if (/[;&<>`\n{}]|\$\(|\|\|/.test(text) || /-(?:ComputerName|CimSession|Session|Credential)\b/i.test(text)) return false;
  // git log / diff 带 --output 会写文件，--ext-diff 会跑外部程序：都不算只读
  if (/--output\b|--ext-diff\b/i.test(text)) return false;
  const parts = text.split("|").map(part => part.trim());
  return !!parts[0] && READ_ONLY_COMMAND.test(parts[0]) && parts.slice(1).every(part => READ_ONLY_PIPE.test(part));
}
// 沙箱会拦下的指令：请示时写明原因（去掉「沙箱拒绝：」的前缀），批了这一条就出沙箱跑
/** @param {Step} step */
function sandboxWhyHtml(step) {
  return step.sandboxWhy
    ? `<div class="approval-sandbox">沙箱会拦下：${escapeHtml(step.sandboxWhy.replace(/^沙箱拒绝：/, ""))}。运行即在沙箱外执行这一条。</div>`
    : "";
}
/** @param {Step} step */
function commandApprovalHtml(step) {
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title">${isWork(currentConversation()) ? "执事请示" : "本机请示"} · 运行此指令${step.background ? "（后台）" : ""}</span><span class="approval-hint" title="输入框留空时，Enter 即运行">Enter 运行</span></div><pre class="approval-cmd">${escapeHtml(step.title)}</pre>${sandboxWhyHtml(step)}<div class="approval-actions"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="径行：此对话中后续指令不再询问">径行</button></div>`;
}

  // ---- 15-tools/21-files.js ----
// 言 · 文件：读、写、改、列、搜、下载。绑了目录落在工作目录（执事的六件），没绑落在卷宗（言只带产出所需的读、写、列与指令）。
// 路径与沙箱在桥接那头管（server/work.js）；这里只管呈现与「改之前先读过」这条规矩
defineTool({
  name: "write_file",
  group: "work",
  label: "写入",
  offer: ctx => ctx.files,
  sideEffect: true,
  writes: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    const data = await bridge("/api/work/write", { ...workScope(conversation), path: args.path, content: args.content }, signal);
    step.title = data.path;
    markSeen(conversation, data.path, step);
    step.note = `${data.lines} 行 · ${formatFileSize(data.bytes)}${data.existed ? " · 覆盖" : ""}`;
    step.change = { path: data.path, added: data.lines, removed: data.existed ? data.previousLines : 0, created: !data.existed };
    return {
      ok: true,
      content: `已写入 ${data.path}（${data.bytes} 字节，${data.lines} 行${data.existed ? "，覆盖了原文件" : ""}）`,
      display: data.existed ? "已覆盖" : "已写入"
    };
  }
});

defineTool({
  name: "edit_file",
  group: "work",
  label: "修改",
  offer: ctx => ctx.files && ctx.work,
  sideEffect: true,
  writes: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    step.title = args.path;
    if (!workSeen.get(seenKey(conversation, step))?.has(seenPath(conversation, args.path)))
      return { ok: false, content: prompt("work.unread", { path: args.path }), display: "需先读取" };
    const data = await bridge(
      "/api/work/edit",
      { ...workScope(conversation), path: args.path, old: args.old, new: args.new, replaceAll: args.replace_all === true },
      signal
    );
    step.title = data.path;
    step.diff = { old: args.old.slice(0, 1500), new: args.new.slice(0, 1500) };
    const counts = diffCounts(args.old, args.new);
    step.change = { path: data.path, added: counts.added * data.replaced, removed: counts.removed * data.replaced };
    return {
      ok: true,
      content: `已修改 ${data.path}：第 ${data.line} 行起替换 ${data.replaced} 处，文件现为 ${data.lines} 行`,
      display: `第 ${data.line} 行 · ${data.replaced} 处`
    };
  }
});

defineTool({
  name: "read_file",
  group: "work",
  label: "读取",
  offer: ctx => ctx.files,
  parallel: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    step.title = args.path;
    const data = await bridge(
      "/api/work/read",
      { ...workScope(conversation), path: args.path, offset: args.offset, limit: args.limit },
      signal
    );
    step.title = data.path;
    markSeen(conversation, data.path, step);
    const encoding =
      data.encoding === "utf-8"
        ? ""
        : `；文件是 ${data.encoding === "gbk" ? "GBK" : data.encoding.toUpperCase()} 编码${data.encoding === "gbk" ? "，edit_file 改不了它" : ""}`;
    return {
      ok: true,
      content: `${data.path}（共 ${data.totalLines} 行，此处第 ${data.offset}–${data.offset + data.shown - 1} 行${encoding}）\n${data.text}`,
      display: `${data.shown}/${data.totalLines} 行`
    };
  }
});

defineTool({
  name: "list_files",
  group: "work",
  label: "列目录",
  offer: ctx => ctx.files,
  parallel: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    const pattern = args.pattern ? ` · ${args.pattern}` : "";
    step.title = `${args.path || "."}${pattern}`;
    const data = await bridge(
      "/api/work/list",
      { ...workScope(conversation), path: args.path, depth: args.depth, pattern: args.pattern },
      signal
    );
    step.title = `${data.path}${pattern}`;
    step.output = trimOutput(data.entries.join("\n"));
    return {
      ok: true,
      content: data.entries.length
        ? `${data.entries.join("\n")}${data.truncated ? "\n…（条目过多已截断，请指定子目录）" : ""}`
        : "（空目录）",
      display: `${data.entries.length} 项`
    };
  }
});

defineTool({
  name: "search_files",
  group: "work",
  label: "搜索",
  offer: ctx => ctx.files && ctx.work,
  parallel: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    step.title = args.query;
    const data = await bridge(
      "/api/work/search",
      {
        ...workScope(conversation),
        query: args.query,
        path: args.path,
        glob: args.glob,
        literal: args.literal === true,
        limit: args.limit
      },
      signal
    );
    const lines = data.matches.map(match => `${match.file}:${match.line}: ${match.text}`);
    step.output = trimOutput(lines.join("\n"));
    step.note = lines.length ? "" : "无匹配";
    return {
      ok: true,
      content: lines.length
        ? `${lines.join("\n")}${data.truncated ? "\n…（结果已截断，请缩小范围或加 glob）" : ""}`
        : `未找到匹配「${args.query}」的内容（扫描了 ${data.scanned} 个文件）`,
      display: `${lines.length} 处 · ${data.files} 文件`
    };
  }
});

// 下载：桥接把网上的文件存进工作目录或卷宗，沙箱照常管路径
defineTool({
  name: "download_file",
  group: "web",
  label: "下载",
  offer: ctx => ctx.files,
  sideEffect: true,
  writes: true,
  digest: true,
  async run(step, args, { conversation, signal }) {
    const url = args.url.trim();
    step.url = url;
    step.title = args.path?.trim() || url.split("/").pop() || url;
    const data = await bridge("/api/work/download", { ...workScope(conversation), url, path: args.path }, signal);
    step.title = data.path;
    step.note = url;
    step.change = { path: data.path, added: 0, removed: 0, created: true }; // 计入这一答的改动摘要
    return {
      ok: true,
      content: `已存为 ${data.path}（${formatFileSize(data.bytes)}${data.type ? `，${data.type}` : ""}）`,
      display: formatFileSize(data.bytes)
    };
  }
});

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
/**
 * @param {Conversation} conversation
 * @param {Step} step
 */
function markSeen(conversation, file, step = null) {
  const key = seenKey(conversation, step);
  if (!workSeen.has(key)) workSeen.set(key, new Set());
  workSeen.get(key).add(seenPath(conversation, file));
}
// 「读过没有」按同一个文件认：读时写相对路径、改时写完整路径，或 Windows 上大小写不同，都是同一个文件
/** @param {Conversation} conversation */
function seenPath(conversation, file) {
  const win = (bootstrap.work?.platform || "win32") === "win32",
    fold = text => (win ? text.toLowerCase() : text),
    value = normalizeWorkPath(file),
    root = normalizeWorkPath(workRoot(conversation));
  return fold(root && fold(value).startsWith(`${fold(root)}/`) ? value.slice(root.length + 1) : value);
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

  // ---- 15-tools/22-changes.js ----
// 言 · 改动与成品：执事这一答改过哪些文件（挂在回复末尾的改动条），言这一答在卷宗里新出了哪几件（成品条）
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

  // ---- 15-tools/30-plan.js ----
// 言 · 计划：行里给用户看的任务清单，每次给完整的一份，画在行迹里；只有主模型维护，回给它一行计数就够
const PLAN_STATUSES = new Set(["pending", "doing", "done", "skipped"]),
  PLAN_MARKS = { done: "✓", doing: "▶", skipped: "–" };
defineTool({
  name: "update_plan",
  group: "work",
  label: "计划",
  offer: ctx => ctx.work,
  mainOnly: true,
  html: planStepHtml,
  digest: step => `计划 → ${(step.plan || []).map(item => `${PLAN_MARKS[item.status] || "○"}${item.text.slice(0, 40)}`).join("；")}`,
  run(step, args) {
    const items = args.items
      .map(item => (typeof item === "string" ? { text: item, status: "pending" } : item))
      .filter(item => item && typeof item === "object" && String(item.text || "").trim())
      .slice(0, 12)
      .map(item => {
        const status = String(item.status || "").toLowerCase();
        return { text: String(item.text).trim().slice(0, 200), status: PLAN_STATUSES.has(status) ? status : "pending" };
      });
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
});
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

  // ---- 15-tools/31-ask.js ----
// 言 · 请示用户：下一步取决于用户的选择时弹一张小表单，从输入框上方浮出，一页一题；对谈与执事都有，帮手没有
defineTool({
  name: "ask_user",
  group: "ask",
  label: "请示",
  mainOnly: true,
  // 同一答里同样的一问不再打扰用户第二回
  cache: true,
  html: askStepHtml,
  approval: askFormHtml,
  digest: step => `请示 → ${step.answers ? String(step.note || "").slice(0, 200) : "用户未作答"}`,
  async run(step, args, ctx) {
    const questions = args.questions
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
          .map(askOption)
          .filter(o => o.label)
      }))
      .filter(q => q.question);
    if (!questions.length)
      return {
        ok: false,
        content: `没能从参数里读出问题。questions 是一个数组，每项至少要有 question（完整的问句）与 options（2–4 个字符串选项），要多选就给 multi: true。例如：{"questions":[{"question":"用哪种风格？","header":"风格","options":["清简 — 留白多","繁复 — 信息密"],"multi":false}]}\n收到了 ${args.questions.length} 项，但没有一项带得出 question。`,
        display: "表单为空"
      };
    // 一个选项都没有的题只能靠自填，多半是模型漏了 options：补一句提醒，但表单照出，不白费这一轮
    const missing = questions.filter(q => q.options.length < 2).length;
    step.form = { questions };
    step.title = questions
      .map(q => q.header || q.question)
      .join(" · ")
      .slice(0, 80);
    const answers = await askApproval(step, ctx, "生成中");
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
});
// 选项按字符串给：「选项 — 一句说明」；旧的 { label, description } 对象也照收
function askOption(o) {
  if (typeof o === "string") {
    const [label, ...rest] = o.split(/\s+[—–-]{1,2}\s+|—/);
    return { label: label.trim().slice(0, 60), description: rest.join("—").trim().slice(0, 120) };
  }
  return {
    label: String(o?.label || "")
      .trim()
      .slice(0, 60),
    description: String(o?.description || "")
      .trim()
      .slice(0, 120)
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
// 请示条上的表单：右上角只写一个快捷键，这一页按 Enter 是下一题还是提交（输入框留空时），随翻页改，见 formPage；题数与第几问在标题里
/** @param {Step} step */
function askFormHtml(step) {
  const block = (q, i) =>
    `<div class="ask-q" data-q="${i}" data-multi="${q.multi ? "true" : "false"}"><div class="ask-question">${q.header ? `<span class="ask-header">${escapeHtml(q.header)}</span>` : ""}${escapeHtml(q.question)}${q.multi ? `<span class="ask-multi">可多选</span>` : ""}</div><div class="ask-options" role="${q.multi ? "group" : "radiogroup"}">${q.options.map((o, j) => `<button type="button" class="ask-opt" role="${q.multi ? "checkbox" : "radio"}" aria-checked="false" data-opt="${j}"><span class="ask-tick" aria-hidden="true"></span><span class="ask-opt-copy"><strong>${escapeHtml(o.label)}</strong>${o.description ? `<small>${escapeHtml(o.description)}</small>` : ""}</span></button>`).join("")}</div><input class="ask-other" type="text" maxlength="200" placeholder="${q.options.length ? (q.multi ? "还可自行补充" : "或自行填写") : "请填写"}" aria-label="自行填写"></div>`;
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title"></span><span class="approval-hint" title="输入框留空时，Enter 即作答"></span></div><div class="ask-form">${step.form.questions.map(block).join("")}</div><div class="approval-actions ask-nav"><span class="ask-spacer"></span><button type="button" class="ask-arrow" data-form="prev" title="上一题" aria-label="上一题">‹</button><button type="button" class="ask-arrow" data-form="next" title="下一题（未答即跳过）" aria-label="下一题">›</button><button type="button" class="ask-arrow ask-done" data-form="submit" title="提交" aria-label="提交">✓</button></div>`;
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
    const picked = [...block.querySelectorAll('.ask-opt[aria-checked="true"]')].map(b => b.querySelector("strong").textContent),
      other = block.querySelector(".ask-other").value.trim();
    return [...picked, ...(other ? [other] : [])].join("、");
  });
}

  // ---- 15-tools/40-memory.js ----
// 言 · 录（记忆）与旧谈：五件都在浏览器里完成，不经桥接，也不需确认——每一步都在行迹里显示，条目在设置页可改可删。
// 记忆启用时才有；记与忘只给主模型，帮手与旁注只能翻
const CONVERSATION_MESSAGE_CHARS = 1500; // read_conversation 每条消息最多给这么多字
defineTool({
  name: "remember",
  group: "memory",
  label: "记入",
  offer: () => memoryEnabled(),
  mainOnly: true,
  sideEffect: true,
  run(step, args, { conversation }) {
    const items = store.memory.items,
      text = args.text.replace(/\s+/g, " ").trim().slice(0, MEMORY_TEXT_CHARS);
    step.title = text;
    if (!text) return { ok: false, content: "text 不能为空", display: "内容为空" };
    const source = { conversationId: conversation.id, title: conversation.title };
    const existing = (args.replaces && items.find(item => item.id === args.replaces)) || items.find(item => item.text === text);
    if (existing) {
      Object.assign(existing, { text, updatedAt: now(), source });
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
});

defineTool({
  name: "forget",
  group: "memory",
  label: "忘却",
  offer: () => memoryEnabled(),
  mainOnly: true,
  sideEffect: true,
  run(step, args) {
    const items = store.memory.items,
      index = items.findIndex(item => item.id === args.id);
    step.title = index >= 0 ? items[index].text : args.id;
    if (index < 0) return { ok: false, content: "没有这条记忆，id 以 recall 的结果为准", display: "未找到" };
    items.splice(index, 1);
    saveStore();
    refreshMemorySettings();
    return { ok: true, content: "已删除", display: "已删除" };
  }
});

defineTool({
  name: "recall",
  group: "memory",
  label: "翻记忆",
  offer: () => memoryEnabled(),
  lookup: true,
  parallel: true,
  sources: step => (step.results || []).map(hit => ({ memory: hit.memoryId, title: hit.title })),
  run(step, args) {
    const items = store.memory.items,
      terms = keywordTerms(args.query);
    step.title = terms.length ? args.query.trim() : "全部";
    const hits = terms.length ? items.filter(item => hitsAll(item.text, terms)) : items;
    step.results = hits.slice(0, 8).map(item => ({ title: item.text, memoryId: item.id }));
    return { ok: true, content: hits.length ? hits.map(memoryLine).join("\n") : "记忆里没有相关条目", display: `${hits.length} 条` };
  }
});

// 查旧谈：同一工作目录的执事对话排在前面，其余按新近
defineTool({
  name: "search_conversations",
  group: "memory",
  label: "查旧谈",
  offer: () => memoryEnabled(),
  lookup: true,
  parallel: true,
  sources: step => (step.results || []).map(hit => ({ talk: hit.conversationId, title: hit.title, date: hit.date })),
  run(step, args, { conversation }) {
    const terms = keywordTerms(args.query);
    step.title = args.query.trim();
    if (!terms.length) return { ok: false, content: "query 不能为空", display: "缺少关键词" };
    const limit = clampNumber(Number(args.limit), 8, 1, 20),
      sameRepo = c => isWork(conversation) && isWork(c) && c.workdir === conversation.workdir,
      hits = [];
    for (const c of [...store.conversations].sort(
      (a, b) => Number(sameRepo(b)) - Number(sameRepo(a)) || String(b.updatedAt).localeCompare(String(a.updatedAt))
    )) {
      if (c.id === conversation.id) continue;
      const lines = c.messages.filter(m => (m.role === "user" || m.role === "assistant") && m.content);
      if (!hitsAll(`${c.title}\n${lines.map(m => m.content).join("\n")}`, terms)) continue;
      const hit = lines.find(m => m.content.toLowerCase().includes(terms[0])),
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
});

defineTool({
  name: "read_conversation",
  group: "memory",
  label: "翻旧谈",
  offer: () => memoryEnabled(),
  lookup: true,
  parallel: true,
  sources: step => (step.conversationId ? [{ talk: step.conversationId, title: step.title, date: step.date, read: true }] : []),
  run(step, args, { conversation }) {
    const c = store.conversations.find(item => item.id === args.id);
    step.title = c ? c.title : args.id;
    if (!c) return { ok: false, content: "没有这段对话，id 以 search_conversations 的结果为准", display: "未找到" };
    step.conversationId = c.id;
    step.date = c.updatedAt || c.createdAt;
    if (c.id === conversation.id) return { ok: false, content: "这是当前对话，无需读取", display: "当前对话" };
    const lines = c.messages.filter(m => (m.role === "user" || m.role === "assistant") && (m.content || m.attachments?.length));
    const offset = Math.max(1, Number(args.offset) || 1),
      limit = clampNumber(Number(args.limit), 40, 1, 100),
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
});

  // ---- 15-tools/41-document.js ----
// 言 · 翻阅文档：对话附件、浏览器内的旧卷宗，以及（设置允许时）磁盘卷宗里的文本与 Office / PDF——后者用到时才取回并抽正文。
// 长文档按页码或关键词只取片段；可读的文档名写进说明里（{{docs}}），对话里有可读文档时才给
defineTool({
  name: "read_document",
  group: "docs",
  label: "翻阅文档",
  offer: ctx => ctx.docs.length > 0,
  vars: ctx => ({ docs: ctx.docs.map(d => d.name).join("、") }),
  lookup: true,
  parallel: true,
  cache: args => ({ ...args, name: args.name.trim().toLowerCase(), query: args.query?.trim().toLowerCase() }),
  async run(step, args, { conversation }) {
    const docs = availableDocuments(conversation),
      wanted = args.name.toLowerCase();
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
      text = record ? (record.kind === "text" ? record.data : record.extractedText) || "" : "";
    }
    if (!text) return { ok: false, content: "该文档无可读取的文本", display: "无文本" };
    const pages = text.split(/^(?=第 \d+ 页$)/m),
      pageCount = pages.filter(p => /^第 \d+ 页$/m.test(p)).length;
    if (args.page) {
      const page = pages.find(p => p.startsWith(`第 ${args.page} 页`));
      if (!page) return { ok: false, content: `没有第 ${args.page} 页，共 ${pageCount || 1} 页`, display: "页码超出" };
      step.note = `第 ${args.page} 页`;
      return { ok: true, content: page.slice(0, 20000), display: `第 ${args.page} 页 · ${page.length} 字` };
    }
    if (args.query) {
      const needle = args.query.toLowerCase(),
        lower = text.toLowerCase(),
        hits = [];
      let index = lower.indexOf(needle);
      while (index >= 0 && hits.length < 8) {
        hits.push(text.slice(Math.max(0, index - 300), index + needle.length + 300).trim());
        index = lower.indexOf(needle, index + needle.length + 300);
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
});
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

  // ---- 15-tools/50-note.js ----
// 言 · 补言：不是工具，是作答途中用户寄来的话，也记作行迹里的一步（见 14-chat-engine.js 的 sendSupplement）；在这张表里只登记画法与摘要，从不交给模型
defineTool({
  name: "user_note",
  label: "补言",
  offer: false,
  html: noteStepHtml,
  digest: step => `用户补言「${String(step.note || "").slice(0, 200)}」`
});
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

  // ---- 15-tools/60-mcp.js ----
// 言 · MCP：把设置里接入的 MCP 服务的工具登记进注册表。连接、握手与协议细节都在桥接那头（server/mcp/），这里只管三件事：
// 拉来各服务的工具、按体量决定怎么交给模型、调用时照三档权限请示。
// 小服务逐件摊开，与内置工具无异；工具多、定义重的按需给——模型只见一张目录，外加 mcp_describe（查参数）与 mcp_call（调用）两件，
// 每一问只多背一张目录。接一个没见过的服务只需在设置里添一条配置，这里不用改
/**
 * @typedef {{ name: string, title?: string, description?: string, inputSchema: Record<string, any>, annotations?: Record<string, any> }} McpToolSpec
 * @typedef {{ ok: boolean, error?: string, tools?: McpToolSpec[], instructions?: string, server?: Record<string, any> }} McpServerState
 */
// 一个服务的工具定义超过这么多字就按需给（配置里写 load: "inline" 或 "lazy" 可以指定）
const MCP_INLINE_LIMIT = 12000;
/** @type {{ key: string, loading: Promise<void>|null, servers: Record<string, McpServerState>, lazy: string[] }} */
const mcp = { key: "", loading: null, servers: {}, lazy: [] };

/** 设置里的全部配置：{ 名字: { command, args, cwd, env } 或 { url, headers, type }，另可带 disabled / autoApprove / timeout / load } */
function mcpConfigs() {
  return store.settings.mcpServers;
}
function mcpActiveConfigs() {
  return Object.fromEntries(Object.entries(mcpConfigs()).filter(([, config]) => !config.disabled));
}
// 配置变了（或还没拉过）就去桥接那头拉一遍；发请求前先等它，头一问就带得上。restart 里的服务断开重连
function mcpReady(restart = []) {
  if (apiBase === null) return Promise.resolve();
  const servers = mcpActiveConfigs(),
    key = JSON.stringify(servers);
  if (key === mcp.key && !restart.length) return mcp.loading || Promise.resolve();
  mcp.key = key;
  const loading = bridge("/api/mcp/list", { servers, restart }, AbortSignal.timeout(90000))
    .then(
      data => (mcp.servers = data.servers),
      error => {
        // 桥接本身不认（旧桥接没有这个接口）或没回话：记下原因，下次再试
        mcp.key = "";
        mcp.servers = Object.fromEntries(Object.keys(servers).map(name => [name, { ok: false, error: String(error.message || error) }]));
      }
    )
    .then(() => {
      if (mcp.loading !== loading) return;
      registerMcpTools();
      renderMcpStatus();
    });
  mcp.loading = loading;
  return loading;
}
function registerMcpTools() {
  for (const [name, tool] of TOOLS) if (tool.mcp) TOOLS.delete(name);
  mcp.lazy = [];
  for (const [server, state] of Object.entries(mcp.servers)) {
    if (!state.ok) continue;
    const load = mcpConfigs()[server]?.load;
    if (load === "lazy" || (load !== "inline" && JSON.stringify(state.tools).length > MCP_INLINE_LIMIT)) mcp.lazy.push(server);
    else for (const spec of state.tools) defineTool(mcpInlineTool(server, spec));
  }
  if (mcp.lazy.length) MCP_LAZY_TOOLS.forEach(defineTool);
}
/** @param {McpToolSpec} spec */
function mcpReadOnly(spec) {
  return spec.annotations?.readOnlyHint === true;
}
// 逐件摊开的：名字写成 mcp__服务__工具（接口只认字母数字与 _-，最长 64），说明与参数用服务端自带的
/**
 * @param {McpToolSpec} spec
 * @returns {Tool}
 */
function mcpInlineTool(server, spec) {
  const readOnly = mcpReadOnly(spec);
  return {
    name: mcpFunctionName(server, spec.name),
    label: server,
    mcp: true,
    server,
    schema: { description: spec.description || spec.title || spec.name, parameters: spec.inputSchema },
    offer: ctx => ctx.bridge,
    lookup: readOnly,
    parallel: readOnly,
    sideEffect: !readOnly,
    approval: mcpApprovalHtml,
    digest: /** @type {true} */ (true),
    run: (step, args, ctx) => runMcpTool(step, server, spec.name, args, ctx)
  };
}
function mcpFunctionName(server, tool) {
  const clean = text => text.replace(/[^A-Za-z0-9_-]/g, "");
  const name = `mcp__${clean(server) || `s${hashText(server).slice(0, 6)}`}__${clean(tool) || hashText(tool).slice(0, 6)}`;
  return name.length <= 64 ? name : `${name.slice(0, 57)}_${hashText(name).slice(0, 6)}`;
}

/** @type {Tool[]} 按需给的两件：目录写在 mcp_describe 的说明里 */
const MCP_LAZY_TOOLS = [
  {
    name: "mcp_describe",
    label: "MCP",
    mcp: true,
    offer: ctx => ctx.bridge && mcpLazyServers(ctx.preset).length > 0,
    vars: ctx => ({ directory: mcpDirectory(ctx.preset) }),
    parallel: true,
    cache: true,
    run(step, args, ctx) {
      const state = mcpLazyServers(presetOf(ctx.conversation)).includes(args.server) ? mcp.servers[args.server] : null;
      step.title = `${args.server} · ${args.tools.join("、")}`;
      if (!state?.ok) return mcpUnknown(args.server, "");
      const found = args.tools.map(name => state.tools.find(tool => tool.name === name)).filter(Boolean);
      if (!found.length) return mcpUnknown(args.server, args.tools.join("、"));
      const text = found
        .map(
          tool =>
            `## ${tool.name}${mcpReadOnly(tool) ? "（只读）" : ""}\n${tool.description || tool.title || ""}\n参数：${JSON.stringify(tool.inputSchema)}`
        )
        .join("\n\n");
      step.output = trimOutput(text);
      return { ok: true, content: text, display: `${found.length} 件` };
    }
  },
  {
    name: "mcp_call",
    label: "MCP",
    mcp: true,
    offer: ctx => ctx.bridge && mcpLazyServers(ctx.preset).length > 0,
    sideEffect: true,
    approval: mcpApprovalHtml,
    digest: true,
    run(step, args, ctx) {
      const spec = mcp.servers[args.server]?.tools?.find(tool => tool.name === args.tool);
      step.title = `${args.server} · ${args.tool}`;
      if (!spec) return mcpUnknown(args.server, args.tool);
      // 外层只核了 server / tool；params 对着目标工具自己的参数表再理一遍
      const { args: inner, problems } = normalizeArguments(spec.inputSchema, args.params);
      if (problems.length)
        return {
          ok: false,
          content: prompt("mcp.badArgs", {
            server: args.server,
            tool: args.tool,
            problems: problems.join("；"),
            hint: schemaHint(spec.inputSchema)
          }),
          display: "参数不合要求"
        };
      return runMcpTool(step, args.server, args.tool, inner, ctx);
    }
  }
];
// 按需给的服务里，预设挑中的那几个
/** @param {Preset|null} preset */
function mcpLazyServers(preset) {
  return mcp.lazy.filter(server => !preset?.mcp || preset.mcp.includes(server));
}
// 目录：一服务一段，一件一行（名字与说明的头一句）；只读的标出来
/** @param {Preset|null} preset */
function mcpDirectory(preset) {
  return mcpLazyServers(preset)
    .map(server => {
      const state = mcp.servers[server],
        head = [state.server?.title || state.server?.name, state.server?.description].filter(Boolean).join("：");
      const lines = state.tools.map(tool => {
        const first = String(tool.description || tool.title || "")
          .split("\n")[0]
          .trim()
          .slice(0, 60);
        return `- ${tool.name}${mcpReadOnly(tool) ? "（只读）" : ""}${first ? `：${first}` : ""}`;
      });
      return `【${server}】${head}\n${lines.join("\n")}`;
    })
    .join("\n");
}
function mcpUnknown(server, tool) {
  const state = mcp.servers[server];
  const known = state?.ok
    ? `${server} 有：${state.tools.map(t => t.name).join("、")}`
    : `已接入的服务：${
        Object.keys(mcp.servers)
          .filter(name => mcp.servers[name].ok)
          .join("、") || "无"
      }`;
  return { ok: false, content: prompt("mcp.unknown", { server, tool, known }), display: "未找到" };
}
// 调一件：服务标了只读的径直跑；其余在「问而后行」里请示一声（配置 autoApprove 里列了的免问），另两档照跑
/**
 * @param {Step} step
 * @param {ToolContext} ctx
 */
async function runMcpTool(step, server, tool, args, ctx) {
  const config = mcpConfigs()[server],
    spec = mcp.servers[server]?.tools?.find(item => item.name === tool);
  // 预设没挑这个服务：照着名字调来的也不跑
  if (!config || !spec || !presetAllows(presetOf(ctx.conversation), /** @type {Tool} */ ({ server }))) return mcpUnknown(server, tool);
  step.title ||= spec.title || tool;
  step.code = JSON.stringify(args, null, 2);
  const ask = !mcpReadOnly(spec) && commandPolicyOf(ctx.conversation) === "ask" && !(config.autoApprove || []).includes(tool);
  if (ask && !(await askApproval(step, ctx, "执行中"))) {
    step.skipped = true;
    return { ok: false, content: prompt("mcp.skipped"), display: "已跳过" };
  }
  const data = await bridge("/api/mcp/call", { server, config, tool, arguments: args, timeout: config.timeout }, ctx.signal);
  // 服务说工具变了：下一问前重拉
  if (data.toolsChanged) mcp.key = "";
  const text = mcpResultText(data.result);
  step.output = trimOutput(text);
  return { ok: !data.result.isError, content: text, display: data.result.isError ? "出错" : `${text.length} 字` };
}
// 请示条：哪个服务的哪件工具、带什么参数；按钮与指令的请示同一套（径行即此对话此后不再问）
/** @param {Step} step */
function mcpApprovalHtml(step) {
  const where = step.name === "mcp_call" ? step.title : `${toolLabel(step.name)} · ${step.title}`;
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title">MCP 请示 · ${escapeHtml(where)}</span><span class="approval-hint" title="输入框留空时，Enter 即运行">Enter 运行</span></div><pre class="approval-cmd">${escapeHtml(step.code || "{}")}</pre><div class="approval-actions"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="径行：此对话中后续调用不再询问">径行</button></div>`;
}
// 结果的几种内容合成一段文字：文本照录；图片、音频、资源只写一行说明（不把 base64 塞给模型）；只有结构化结果的给 JSON
function mcpResultText(result) {
  const parts = (result.content || []).map(item =>
    item.type === "text"
      ? item.text
      : item.type === "image" || item.type === "audio"
        ? `[${item.type === "image" ? "图片" : "音频"} ${item.mimeType}，约 ${formatFileSize(Math.round(item.data.length * 0.75))}，未随结果转交]`
        : item.type === "resource_link"
          ? `[资源 ${item.name || ""} ${item.uri}]`
          : item.type === "resource"
            ? (item.resource.text ?? `[资源 ${item.resource.uri}（${item.resource.mimeType || "二进制"}）]`)
            : JSON.stringify(item)
  );
  if (!parts.length && result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
  return parts.join("\n\n") || "（无输出）";
}
// 系统提示里 mcp.hint 那一段的值：交给模型的工具里有哪几个服务的，就附上那几个服务自带的用法；一个都没有就不带这段
/** @param {Set<string>} names @param {Preset|null} preset */
function mcpHintVars(names, preset) {
  const lazy = names.has("mcp_call") ? mcpLazyServers(preset) : [];
  const servers = Object.entries(mcp.servers).filter(
    ([server, state]) =>
      state.ok &&
      state.instructions &&
      (mcp.lazy.includes(server) ? lazy.includes(server) : state.tools.some(tool => names.has(mcpFunctionName(server, tool.name))))
  );
  return servers.length
    ? { servers: servers.map(([server, state]) => `【${server}】${state.instructions.trim().slice(0, 1500)}`).join("\n") }
    : null;
}

  // ---- 15-tools/90-delegate.js ----
// 言 · 差遣：主模型把一件自成一段的子任务交给帮手，帮手另起一段对话做完后回报。桥接在线、且有别的活能交出去时才给；帮手自己不再差遣。
// 同一轮派出的几名帮手同时开工（parallel），活是主模型分的，不重叠靠它分派时留意（工具说明里有交代）。
// 行迹里只留一枚签，帮手自己的那条时间线开在差遣面板里（见 08-trail.js）
defineTool({
  name: "delegate",
  group: "delegate",
  label: "差遣",
  offer: ctx => ctx.bridge && ctx.offered.some(name => name !== "ask_user"),
  mainOnly: true,
  sideEffect: true,
  parallel: true,
  run: runDelegate,
  html: delegateStepHtml,
  sync: syncDelegateCard,
  digest: step =>
    `差遣「${String(step.title || "").slice(0, 40)}」→ ${step.result || step.status}${subChangedPaths(step).length ? `，改了 ${subChangedPaths(step).slice(0, 8).join("、")}` : ""}`
});
/** @param {Step} step */
function subChangedPaths(step) {
  return [...new Set((step.sub?.steps || []).filter(s => s.change && s.status === "done").map(s => s.change.path))];
}
// 差遣：主模型把一件自成一段的子任务交给帮手。帮手用同一个模型、同一套工具（不再差遣、不请示用户）另起一段对话跑自己的工具轮次（上限见设置），
// 步骤都画在主对话这条消息的差遣卡片里（指令照样问而后行），做完把最后一轮的回报连同改动摘要作为工具结果交回主模型
/**
 * @param {Step} step
 * @param {Record<string, any>} args
 * @param {ToolContext} ctx
 */
async function runDelegate(step, args, ctx) {
  const { conversation, assistant, signal } = ctx;
  const task = args.task.trim();
  step.title = args.title.trim().slice(0, 40) || task.slice(0, 24);
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
    systemPrompt: systemPrompt(conversation, tools, { role: "sub" }),
    tools,
    reasoning: conversation.reasoning || "",
    // 跑得久了上下文会满：任务说明之后的往来由 readReply 按需压成工作笔记（见 keepInWindow），帮手接着做
    head: history.length,
    onFold: busy => job && setJobLabel(conversation, job, busy ? "帮手整理上下文" : "帮手工作中")
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
    failure = "",
    resumed = 0;
  try {
    for (;;) {
      sub.toolCalls = null;
      sub.usage = null;
      const roundStart = sub.content.length;
      if (!resumed) reportStart = roundStart;
      try {
        await readReply(profile, history, signal, overrides, sub);
      } catch (error) {
        // 与主答一样：写到一半断了，稍候接着写，最多两回
        if (!error.midStream || signal.aborted || resumed >= AUTO_RESUMES) throw error;
        resumed += 1;
        const said = sub.content.slice(roundStart);
        sub.toolCalls = null;
        if (said.trim()) history.push({ role: "assistant", content: said }, { role: "user", content: prompt("assistant.resume") });
        await restFor(2000 * resumed, signal);
        continue;
      }
      resumed = 0;
      if (sub.usage) for (const key of Object.keys(usage)) usage[key] += Number(sub.usage[key] || 0);
      const calls = (sub.toolCalls || []).filter(call => call.name);
      if (!calls.length || !overrides.tools) break;
      if (++sub.rounds > subRoundLimit()) {
        const said = sub.content.slice(reportStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push({ role: "user", content: prompt("delegate.limit") });
        overrides.tools = null;
        sub.content = paragraphBreak(sub.content);
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
        tool_calls: steps.map(s => ({ id: s.id, type: "function", function: { name: s.name, arguments: replayArguments(s.arguments) } })),
        ...(sub.thinkingBlocks?.length ? { thinking_blocks: sub.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, signal, toolCache);
      for (const s of steps) history.push({ role: "tool", tool_call_id: s.id, content: outcomes.get(s.id) ?? "" });
      sub.content = paragraphBreak(sub.content);
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
    display = `${sub.steps.length} 步${changed.length ? ` · 改 ${changed.length} 个文件` : ""}${overrides.folds ? ` · 压缩 ${overrides.folds} 回` : ""} · ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分`}`;
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
function syncDelegateCard(el, step, prev) {
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

  // ---- 16-api.js ----
// 言 · 接口：用量估算、请求、SSE 读取、错误说明
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function estimateText(text) {
  const chinese = (text.match(/[㐀-鿿]/g) || []).length;
  return chinese + Math.ceil((text.length - chinese) / 4);
}
// 上下文过重的门槛：每一答的用量标注超过它就转为印色提醒
const CONTEXT_HEAVY = 24000;
const SSE_IDLE_MS = 300000;
function estimateTokens(messages) {
  let score = 0;
  for (const message of messages) {
    score += 4;
    // 工具调用的参数也随请求送出（写文件时整份内容都在这里），不算就会把长活的上下文估得太轻
    for (const call of message.tool_calls || []) score += 8 + estimateText(String(call.function?.arguments || ""));
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
    saveStoreSoon();
    return profileReasoningLevels(profile);
  }
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
    saveStoreSoon();
    return learned;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
/** @param {Profile} profile */
async function requestChat(profile, messages, signal, overrides = {}) {
  const parameters = {
    messages,
    systemPrompt: overrides.systemPrompt ?? "",
    temperature: Number(overrides.temperature ?? profile.temperature ?? 0.7),
    // 输出上限：拟题、压缩、探档位这几处自己给；平时 OpenAI 兼容接口不传（服务端的默认就是模型的上限，
    // 手写一个反而常常把长回答截断），Anthropic 必填、按模型设置或默认值
    maxTokens:
      Number(overrides.maxTokens) > 0
        ? Number(overrides.maxTokens)
        : anthropicLike(profile)
          ? Number(profile.maxTokens) || DEFAULT_MAX_TOKENS
          : undefined
  };
  const extras = {
    ...(overrides.tools ? { tools: overrides.tools } : {}),
    // probe 是探档位时故意送的、不存在的一档，原样送出去让接口报错（见 probeReasoningLevels）
    ...(overrides.reasoning === "probe" ? { reasoning_effort: "probe" } : reasoningFields(profile, overrides.reasoning))
  };
  if (apiBase !== null)
    return fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: profileForRequest(profile), ...parameters, ...extras }),
      signal
    });
  const payload = {
    model: profile.model,
    messages: parameters.systemPrompt ? [{ role: "system", content: parameters.systemPrompt }, ...messages] : messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: parameters.temperature,
    ...(parameters.maxTokens ? { max_tokens: parameters.maxTokens } : {}),
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
  return { source: "custom", baseUrl: profile.baseUrl, apiKey: profile.apiKey, model: profile.model, api: profile.api || "" };
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
      reusedReasoning = reusableTrailReasoning(block, assistant, visible),
      // 还只有思绪时直接沿用上一组，不先在下面造一枚重复的签；正文起笔才需要新的进行中容器。
      host = reusedReasoning && !visible.slice(base).trim() ? null : trailLiveHost(block, assistant) || block,
      rbase = trailReasoningBase(assistant),
      thought = reusedReasoning?.text ?? String(assistant.reasoning || "").slice(rbase);
    if (thought.trim()) {
      let details = reusedReasoning?.details || host?.querySelector(":scope > .reasoning");
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
      if (!(reusedReasoning ? details.dataset.touched : assistant.reasoningTouched)) {
        if (!live && details.open) settleDetails(details, false);
        else if (live && !details.open) settleDetails(details, true);
      }
    }
    if (!visible) {
      if (!block.querySelector(".thinking")) insertAboveChangeBar(block, `<div class="thinking">正在凝神</div>`);
    } else if (!visible.slice(base).trim()) {
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
    paintDrafting(host || block, assistant);
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
  // 直连时流静默太久没人管（桥接那头 Node 自带五分钟的读超时）：五分钟一个字节都没有就当断了，按中断处理、可续写
  const readChunk = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reader.cancel().catch(() => {});
        reject(Error("接口静默超过五分钟，连接已中断"));
      }, SSE_IDLE_MS);
      reader
        .read()
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  // 流被掐断（停止、补言改道）时这一段的帧循环到此为止：接下来的一轮另起一个，两个循环不能同时画一条消息
  try {
    await pump();
  } catch (error) {
    closed = true;
    // 半途出错（流里的报错事件）：把还开着的连接收掉，别让桥接那头替一个没人读的流继续转发
    reader.cancel().catch(() => {});
    throw error;
  }
  async function pump() {
    while (true) {
      const { value, done } = await readChunk();
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
        let failure = "";
        try {
          const json = JSON.parse(data);
          // 流里夹着的报错（限流、上游掐线、桥接补的「连接中断」）：不能当没看见让半截话冒充写完了——按中断处理，已写的留着、可续写
          if (json.error && !json.choices)
            failure = (typeof json.error === "string" ? json.error : json.error?.message) || "接口在作答途中返回了错误";
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
        if (failure) throw Error(failure);
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
  if (!button || ((conversationRunning() || runningElsewhere()) && !ACTIONS_WHILE_RUNNING.has(button.dataset.action))) return;
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
  // 「手记一条」后没写字就关了窗：那条空的不留（文本框随窗撤掉时未必触发 blur）
  const kept = store.memory.items.filter(item => String(item.text || "").trim());
  if (kept.length !== store.memory.items.length) {
    store.memory.items = kept;
    saveStore();
  }
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
  if (settingsTab === "presets") host.innerHTML = presetsSettingsHtml();
  if (settingsTab === "tools") host.innerHTML = toolsSettingsHtml();
  if (settingsTab === "env") host.innerHTML = envSettingsHtml();
  if (settingsTab === "mcp") host.innerHTML = mcpSettingsHtml();
  if (settingsTab === "memory") host.innerHTML = memorySettingsHtml();
  if (settingsTab === "guide") host.innerHTML = guideSettingsHtml();
  if (settingsTab === "about") host.innerHTML = aboutSettingsHtml();
  // 每栏标题左边一个这一栏的笔意图标（记忆页自带）；文档里翻开的一篇有自己的书口，关于页的题目是「言」本身，都不加
  const title = host.querySelector("h2");
  if (BRUSH_ICONS[settingsTab] && title && !title.previousElementSibling && !title.parentElement.classList.contains("about-head")) {
    const head = document.createElement("div");
    head.className = "about-head memory-head";
    head.innerHTML = brushIcon(settingsTab, "settings-mark");
    title.before(head);
    head.append(title);
  }
  bindSettingsEvents();
  bindMemoryEvents();
  bindMcpEvents();
  bindEnvEvents();
  bindPresetEvents();
  bindGuideEvents();
  if (tabChanged) {
    host.classList.remove("tab-fade");
    void host.offsetWidth;
    host.classList.add("tab-fade");
  }
}
// 存储位置：对话、卷宗、配置（含模型配置）都在这一个 .yan 目录里，几个浏览器共用；换位置时整份拷过去，旧处留着
function storageSettingsHtml() {
  if (apiBase === null) return "";
  const info = bootstrap.store || {},
    parent = info.parent || "";
  return `<div class="setting-row"><div class="setting-copy"><strong>存储位置</strong><small>对话、卷宗与配置（含模型配置）都在 <code title="${escapeHtml(info.root || "")}">${escapeHtml(info.root || "")}</code> 里，几个浏览器共用这一份。填一个目录，就在它下面立 .yan 并把整份拷过去，旧处原样留着；那里已有言的数据则直接用它</small></div><div class="setting-actions setting-directory"><input id="settingStore" class="field" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(parent)}" value="${escapeHtml(parent)}"><button id="settingStorePick" class="outline-btn" type="button">选择…</button></div></div>`;
}
function generalSettingsHtml() {
  return `<h2>通用</h2><p class="settings-lead">数据只存于本机；桥接在线时，对话、卷宗与配置都落在存储位置里。</p><div class="setting-row"><div class="setting-copy"><strong>显示名称</strong><small>侧栏中显示的称呼</small></div><input id="settingName" class="field" value="${escapeHtml(store.settings.name)}"></div><div class="setting-row"><div class="setting-copy"><strong>自动拟题</strong><small>首次问答后由模型拟题，略耗额度；手动修改过的标题不再覆盖</small></div><div class="segmented"><button data-setting="autoTitle" data-value="true" class="${store.settings.autoTitle ? "active" : ""}">开</button><button data-setting="autoTitle" data-value="false" class="${store.settings.autoTitle ? "" : "active"}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>自动压缩上下文</strong><small>一答收尾后，若下一问估算送出的 token 超过此数，便请模型把前文压成摘要；留空为不自动。右下角的计数亦可随时手动压缩</small></div><div class="setting-actions"><label class="setting-inline">超过<input id="settingCompactAt" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不自动" value="${Number(store.settings.compactAt) || ""}"></label></div></div>${storageSettingsHtml()}<div class="setting-row"><div class="setting-copy"><strong>本机数据</strong><small>${store.conversations.length} 段对话 · ${store.library.length} 件卷宗 · 配置 ${storageSize()} · 附件原件 ${formatFileSize(usedAttachmentBytes())}</small></div><div class="setting-actions"><label class="check"><input id="exportFiles" type="checkbox">含附件原件</label><button id="exportData" class="outline-btn">导出备份</button><button id="importData" class="outline-btn">导入备份</button></div></div><div class="setting-row"><div class="setting-copy"><strong>清空所有对话</strong><small>模型配置、个性化与卷宗将保留</small></div><button id="clearAll" class="danger-btn">清空对话</button></div>`;
}
// 工具：沙箱、三档指令权限、可及范围、卷宗可读、轮次上限——模型能动手的边界都在这一栏
function toolsSettingsHtml() {
  const policy = normalizeCommandPolicy(store.settings.commandPolicyDefault);
  return `<h2>工具</h2><p class="settings-lead">模型能做什么、做到哪一步问一声，都在这里定。</p><div class="setting-row"><div class="setting-copy"><strong>沙箱</strong><small>言与行的指令与文件工具都套着一层：改动不出工作目录、机密文件不碰、动系统与直接外联的指令拒绝、指令看不到机密环境变量；查看则可及整台机器，要它看看电脑也走得通。在桥接那头守，模型绕不过。这是静态筛查，不是进程隔离。非要让模型改目录之外的东西时再关</small></div><div class="segmented"><button data-setting="sandbox" data-value="true" class="${store.settings.sandbox !== false ? "active" : ""}">开</button><button data-setting="sandbox" data-value="false" class="${store.settings.sandbox === false ? "active" : ""}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>指令权限</strong><small>新对话默认档位：问而后行逐条请示，明确只读的径直跑；审而后行由桥接代审，常规改动、整机查看、写到目录之外都放行，只把伤及系统与难以恢复的当场回绝，不来打扰；径行不再审查。三档都不另调模型，沙箱开着时那道界仍在</small></div><div class="segmented"><button data-setting="commandPolicyDefault" data-value="ask" class="${policy === "ask" ? "active" : ""}">问而后行</button><button data-setting="commandPolicyDefault" data-value="review" class="${policy === "review" ? "active" : ""}">审而后行</button><button data-setting="commandPolicyDefault" data-value="auto" class="${policy === "auto" ? "active" : ""}">径行</button></div></div><div class="setting-row"><div class="setting-copy"><strong>文件工具可及范围</strong><small>没套沙箱时，模型读写文件、列目录与搜索能否越出工作目录或卷宗：「全盘」可指向任何绝对路径，「目录内」一律拒绝越出；指令不受此限。沙箱开着时一律目录内</small></div><div class="segmented"><button data-setting="toolReach" data-value="anywhere" class="${store.settings.toolReach !== "inside" ? "active" : ""}">全盘</button><button data-setting="toolReach" data-value="inside" class="${store.settings.toolReach === "inside" ? "active" : ""}">目录内</button></div></div><div class="setting-row"><div class="setting-copy"><strong>卷宗对模型可读</strong><small>开启后，模型可在任何对话中翻阅卷宗里的文档（PDF、Office、文本），用到时才取回并在本机提取正文</small></div><div class="segmented"><button data-setting="archiveRead" data-value="true" class="${store.settings.archiveRead !== false ? "active" : ""}">开</button><button data-setting="archiveRead" data-value="false" class="${store.settings.archiveRead === false ? "active" : ""}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>工具轮次上限</strong><small>一次回答里模型最多调几轮工具，同一轮并发的几次调用只算一轮；到顶后收回工具请它收尾。帮手另计，留空即不限</small></div><div class="setting-actions"><label class="setting-inline">一答<input id="settingToolRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不限" value="${roundLimitText(toolRoundLimit())}"></label><label class="setting-inline">帮手<input id="settingSubRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不限" value="${roundLimitText(subRoundLimit())}"></label></div></div>`;
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
      [
        "存放",
        "桥接在线时一切落在本机的存储位置（默认 ~/.yan，可在通用设置更换）：对话/ 一段一个文件，卷宗/ 是成品与收进来的文件，附件/ 是附件原件，配置.json 是设置、模型配置（含 API Key）、记忆与草稿；复制整个目录即备份。没桥接时暂存于此浏览器，接上后推过去。不经任何云端"
      ],
      ["桥接", "本机进程仅监听 127.0.0.1，负责转发模型请求、联网检索与读取网页；拒绝访问本机与内网地址"],
      [
        "执事",
        "指令在你的机器上、以你的权限执行，只读指令直接执行，其余默认逐条确认；文件工具能否越出工作目录由设置 → 工具的「可及范围」定（默认全盘，问而后行开着沙箱时只在目录内）"
      ],
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
  const keyNote =
    apiBase !== null
      ? "API Key 与其余配置一起存于本机存储位置的 配置.json，几个浏览器共用；导出的备份不含它。"
      : "API Key 暂存于此浏览器，桥接接上后存进本机的存储位置；导出的备份不含它。";
  return `<h2>模型</h2><p class="settings-lead">任何 OpenAI 兼容接口均可接入。${keyNote}${transport}</p>${bootstrap.notice ? `<div class="server-notice">${escapeHtml(bootstrap.notice)}</div>` : ""}<div id="profileList">${profiles().map(profileCardHtml).join("")}</div><button id="addProfile" class="outline-btn profile-add">＋ 接入模型</button>`;
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
  const invalidQuota = !!String(p.quota || "").trim() && parseTokenLimit(p.quota) === null,
    quota = quotaParts(p.quota),
    models = Array.isArray(p.modelList) ? p.modelList : [],
    listed = models.includes(p.model);
  const modelField = `<div class="field-row">${models.length ? `<select class="field wide select" data-model-select>${models.map(m => `<option value="${escapeHtml(m)}"${m === p.model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}<option value="__custom__"${listed ? "" : " selected"}>手动输入…</option></select>` : ""}<input class="field wide${models.length && listed ? " hidden" : ""}" data-field="model" value="${escapeHtml(p.model)}" placeholder="如 gpt-4o-mini"><button class="outline-btn" data-profile-action="models" title="从接口的 /models 获取可用模型">${models.length ? "刷新" : "获取列表"}</button></div>`;
  const quotaField = `<div class="field-row"><input type="number" min="0" step="any" class="field wide" data-quota-amount value="${escapeHtml(quota.amount)}" placeholder="不限" ${invalidQuota ? `aria-invalid="true"` : ""}><select class="field select" data-quota-unit>${[
    ["k", "千 (k)"],
    ["m", "百万 (m)"],
    ["e", "亿 (e)"]
  ]
    .map(([v, label]) => `<option value="${v}"${quota.unit === v ? " selected" : ""}>${label}</option>`)
    .join("")}</select></div>`;
  return `<div class="profile-card" data-profile-card="${escapeHtml(p.id)}"><div class="profile-head"><strong>${escapeHtml(p.name)}</strong>${p.id === store.settings.activeProfileId ? `<span class="profile-badge">默认</span>` : ""}</div><div class="profile-grid"><label>显示名称<input class="field wide" data-field="name" value="${escapeHtml(p.name)}"></label><label>用量上限${quotaField}<small>留空不限，只计已耗；改动后重新计量</small></label><label>接口<div class="segmented"><button data-choice-field="api" data-value="openai" class="${anthropicLike(p) ? "" : "active"}">OpenAI 兼容</button><button data-choice-field="api" data-value="anthropic" class="${anthropicLike(p) ? "active" : ""}">Anthropic</button></div><small>${anthropicLike(p) ? "Messages API；思考档位换算成思考预算" : "chat/completions；大多数服务与中转站"}</small></label><label class="profile-full">Base URL<input class="field wide" data-field="baseUrl" value="${escapeHtml(p.baseUrl || "")}" placeholder="${anthropicLike(p) ? "https://api.anthropic.com" : "https://example.com/v1"}"></label><label class="profile-full">API Key<input type="password" class="field wide" data-field="apiKey" value="${escapeHtml(p.apiKey || "")}" placeholder="sk-…" autocomplete="off"></label><label class="profile-full">模型${modelField}<small>填写 Base URL 与 API Key 后可获取列表，亦可手动输入</small></label></div><details class="profile-advanced"${advancedOpen.has(p.id) ? " open" : ""}><summary><span class="advanced-title">高级配置</span><small>${p.tools === false ? "本机工具关" : ""}</small></summary><div class="profile-grid"><label>本机联网与文档工具<div class="segmented"><button data-toggle-field="tools" data-value="true" class="${p.tools !== false ? "active" : ""}">开</button><button data-toggle-field="tools" data-value="false" class="${p.tools === false ? "active" : ""}">关</button></div><small>由本机桥接执行检索、网页读取与文档翻阅；需接口支持 function calling</small></label><label><code>temperature</code><input type="number" min="0" max="2" step="0.1" class="field wide" data-field="temperature" value="${Number(p.temperature ?? 0.7)}"><small>0–2，默认 0.7；数值越高越发散</small></label>${anthropicLike(p) ? `<label><code>max_tokens</code><input type="number" min="16" class="field wide" data-field="maxTokens" value="${Number(p.maxTokens) || ""}" placeholder="${DEFAULT_MAX_TOKENS}"><small>Messages API 必填的输出上限；留空按 ${DEFAULT_MAX_TOKENS}，模型嫌大会报错，照报错调小即可</small></label>` : ""}<label>上下文窗口<input type="number" min="1000" step="1000" class="field wide" data-field="contextWindow" value="${Number(p.contextWindow) || ""}" placeholder="如 128000"><small>此模型一次可读的 token 数；填写后右下角按比例计量，逾七成半即提醒</small></label><label>思考档位<input class="field wide" data-field="reasoningLevels" value="${escapeHtml(p.reasoningLevels || "")}" placeholder="low, medium, high"><small>此模型所认的 <code>reasoning_effort</code> 档位，逗号分隔（minimal、low、medium、high、xhigh、max）；选定模型时会自动探测并填在这里（none 是不认）；留空按 low / medium / high / max 四档列，接口拒绝某档时也会记下</small></label></div></details><div class="profile-actions"><button class="outline-btn" data-profile-action="test">测试连接</button>${p.id !== store.settings.activeProfileId ? `<button class="outline-btn" data-profile-action="default">设为默认</button>` : ""}<button class="danger-btn" data-profile-action="delete">删除</button><span class="profile-status">${invalidQuota ? "请填写大于 0 的数值，或留空不限" : ""}</span></div></div>`;
}
function storageSize() {
  const bytes = new Blob([JSON.stringify(store)]).size;
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
// 存储位置的更换排着队来（见 bindSettingsEvents 里的 commitStore）
let storeMoves = Promise.resolve();
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
      // 留空记作 0：不限
      const text = e.target.value.trim(),
        value = Math.floor(Number(text));
      store.settings[key] = !text ? 0 : value >= 1 ? value : fallback;
      saveStoreSoon();
    });
  // 存储位置：桥接把整份拷到新处（那里已有言的数据就直接用），页面换上新路径后把对话与配置对一遍、卷宗重翻；旧处不删
  const storeInput = $("#settingStore");
  let storeTimer = null;
  const commitStore = value => {
    clearTimeout(storeTimer);
    // 一次换完（对话对齐、卷宗重翻、设置页重画）再换下一次：连着换两回时，前一回迟到的收尾不能把页面又画回它那个位置
    storeTimer = setTimeout(() => (storeMoves = storeMoves.then(moveStore, moveStore)), 600);
    const moveStore = async () => {
      const next = String(value || "").trim();
      if (!next || next === (bootstrap.store?.parent || "")) return;
      let data;
      try {
        data = await bridge("/api/store/move", { parent: next }, AbortSignal.timeout(600000));
      } catch (error) {
        return toast(String(error.message || error).slice(0, 80));
      }
      if (!data.moved) return;
      bootstrap.store = { root: data.root, parent: data.parent, fresh: false };
      bootstrap.work = { ...bootstrap.work, chats: data.chats, archive: data.archive, files: data.files };
      envStatus = null;
      clearTimeout(envPoll);
      void refreshEnv();
      chatsBroken = false;
      chatHashes.clear();
      chatStamps.clear();
      chatDiskStamps.clear();
      chatDiskWrites.clear();
      // 搬到一个已有言数据的地方：那边的配置为准；拷过去的：这边的就是那边的
      if (data.adopted) {
        configBase = "";
        configSyncedAt = 0;
        const disk = await bridge("/api/store/config/load", {}, AbortSignal.timeout(20000)).catch(() => null);
        if (disk?.config) adoptConfig(disk.config, Number(disk.savedAt) || 0);
      } else saveConfigNow({ force: true });
      await syncChatsWithDisk();
      const ids = store.conversations.map(conversation => conversation.id);
      flushConversations(ids, { force: true });
      archiveEntries = null;
      await refreshArchive();
      try {
        localStorage.setItem(STORE_ROOT_KEY, data.root);
      } catch {}
      renderSettings();
      toast(`存储已换到 ${pathTail(data.root)}；${data.adopted ? "用的是那里原有的数据" : "旧处原样留着"}`);
    };
  };
  storeInput?.addEventListener("change", e => commitStore(e.target.value));
  $("#settingStorePick")?.addEventListener("click", async () => {
    const button = $("#settingStorePick");
    button.disabled = true;
    try {
      const data = await bridge(
        "/api/work/pick",
        { current: storeInput.value.trim() || bootstrap.store?.parent || "" },
        AbortSignal.timeout(300000)
      );
      if (data.path) {
        storeInput.value = data.path;
        commitStore(data.path);
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
    for (const c of store.conversations) void deleteConversationStorage(c.id);
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
      quota: "",
      usedTokens: 0
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
        p[field] = ["temperature", "maxTokens", "usedTokens", "contextWindow"].includes(field) ? Number(e.target.value) : e.target.value;
        if (field === "contextWindow") updateContextGauge();
        // 亲手填的档位就是定论，不再探；清空了下次选模型再探
        if (field === "reasoningLevels") p.reasoningProbed = e.target.value.trim() ? `manual|${reasoningProbeKey(p)}` : "";
        saveStoreSoon();
      })
    );
    // 手动输入的模型 ID：改定了（失焦或回车）探一下它认哪几档
    card.querySelector('[data-field="model"]')?.addEventListener("change", () => void reportReasoningProbe(p, card));
    const amount = card.querySelector("[data-quota-amount]"),
      unit = card.querySelector("[data-quota-unit]");
    const applyQuota = () => {
      const value = amount.value.trim() ? `${amount.value.trim()}${unit.value}` : "",
        valid = !value || parseTokenLimit(value) !== null;
      if (valid) amount.removeAttribute("aria-invalid");
      else amount.setAttribute("aria-invalid", "true");
      card.querySelector(".profile-status").textContent = valid ? "" : "请填写大于 0 的数值，或留空不限";
      if (!valid) return;
      if (p.quota !== value) {
        p.quota = value;
        p.usedTokens = 0;
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
    if (
      !(await askConfirm({
        title: "删除这个模型？",
        body: `「${profile.name || profile.model || "未命名"}」的配置连同 API Key 将一并移除，无法撤销。`,
        ok: "删除"
      }))
    )
      return;
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
              headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
  // 备份不带密钥：模型的 API Key，MCP 配置里的环境变量与请求头（令牌多在这两处）；可选带上附件原件
  const mcpServers = Object.fromEntries(Object.entries(store.settings.mcpServers).map(([name, { env, headers, ...rest }]) => [name, rest]));
  /** @type {Store & { exportedAt: string, attachments?: Attachment[] }} */
  const safeStore = {
    ...store,
    settings: { ...store.settings, mcpServers },
    profiles: store.profiles.map(profile => ({ ...profile, apiKey: "" })),
    exportedAt: now()
  };
  let blob,
    files = 0;
  if (includeFiles) {
    // 附件原件只带仍在用的那几件：存储目录与浏览器里的暂存都翻，谁有取谁。原件合起来可能上 GB，
    // 拼成一个大字符串会超出浏览器的字符串上限、点了没反应——一件一件接进 Blob，内存里只过一件
    toast("正在收拢附件原件…");
    blob = new Blob([`${JSON.stringify(safeStore).slice(0, -1)},"attachments":[`], { type: "application/json" });
    for (const id of attachmentKeepIds()) {
      const record = await getAttachment(id).catch(() => null);
      if (!record) continue;
      blob = new Blob([blob, files ? "," : "", JSON.stringify(record)], { type: "application/json" });
      uncacheAttachment(id);
      files += 1;
    }
    blob = new Blob([blob, "]}"], { type: "application/json" });
  } else blob = new Blob([JSON.stringify(safeStore, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `言-备份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`备份已导出${includeFiles ? `（含 ${files} 件附件原件）` : ""}；不含 API Key`);
}
// 读备份：小的整份解析；带着上百 MB 附件原件的，整份读成一个字符串会超出浏览器的上限——按字节找到末尾的附件数组，
// 前面的记录照常解析，原件一件一件解出来交给调用者，内存里只过一件
async function readBackup(file) {
  if (file.size < 128 * MB) {
    const data = JSON.parse(await readFile(file, "text"));
    return {
      data,
      attachments: (async function* () {
        yield* Array.isArray(data.attachments) ? data.attachments : [];
      })()
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer()),
    decoder = new TextDecoder(),
    marker = new TextEncoder().encode(',"attachments":[');
  // 附件数组是导出时最后接上的一项，原件里的引号都转义过，从末尾往前找到的第一处就是它
  let at = -1;
  for (let i = bytes.lastIndexOf(marker[0]); i >= 0; i = i > 0 ? bytes.lastIndexOf(marker[0], i - 1) : -1)
    if (marker.every((b, k) => bytes[i + k] === b)) {
      at = i;
      break;
    }
  if (at < 0) return { data: JSON.parse(decoder.decode(bytes)), attachments: (async function* () {})() };
  const data = JSON.parse(`${decoder.decode(bytes.subarray(0, at))}}`);
  async function* attachments() {
    let depth = 0,
      inString = false,
      escaped = false,
      start = -1;
    for (let i = at + marker.length; i < bytes.length; i++) {
      const b = bytes[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (b === 92) escaped = true;
        else if (b === 34) inString = false;
        continue;
      }
      if (b === 34) inString = true;
      else if (b === 123) {
        if (depth++ === 0) start = i;
      } else if (b === 125) {
        if (--depth === 0) yield JSON.parse(decoder.decode(bytes.subarray(start, i + 1)));
      } else if (b === 93 && depth === 0) break;
    }
  }
  data.attachments = true;
  return { data, attachments: attachments() };
}
// 导入采用合并策略：按 id 跳过已存在的对话 / 模型 / 卷宗，附件原件只在本机缺失时写入
async function importData(file) {
  try {
    const { data, attachments } = await readBackup(file);
    if (!data || !Number.isInteger(data.version) || data.version < 1 || data.version > STORE_VERSION || !Array.isArray(data.conversations))
      throw Error("不是言的备份文件，或版本不兼容");
    // 旧版备份先按启动时同一套迁移与规整过一遍（workAuto → commandPolicy、去掉半成品的压缩分隔……），别等下次刷新才对
    const incoming = normalizeStoreData(data);
    const known = new Set(store.conversations.map(c => c.id));
    let conversations = 0,
      added = 0,
      library = 0,
      drafts = 0,
      files = 0;
    for (const c of incoming.conversations)
      if (c?.id && !known.has(c.id) && Array.isArray(c.messages)) {
        store.conversations.push(c);
        markDirty(c.id);
        conversations += 1;
      }
    const profileIds = new Set(profiles().map(p => p.id));
    for (const p of incoming.profiles)
      if (p?.id && p.source !== "server" && !profileIds.has(p.id)) {
        store.profiles.push({ ...p, apiKey: p.apiKey || "" });
        added += 1;
      }
    const libraryIds = new Set(store.library.map(f => f.id));
    for (const f of incoming.library)
      if (f?.id && !libraryIds.has(f.id)) {
        store.library.push(f);
        library += 1;
      }
    for (const [key, draft] of Object.entries(incoming.drafts))
      if (!store.drafts[key] && (draft.text || draft.attachments.length || draft.quote)) {
        store.drafts[key] = draft;
        drafts += 1;
      }
    for await (const record of attachments)
      if (record?.id && record.data !== undefined && !(await getAttachment(record.id))) {
        await putAttachment(record);
        uncacheAttachment(record.id);
        files += 1;
      }
    const memoryIds = new Set(store.memory.items.map(item => item.id)),
      memoryTexts = new Set(store.memory.items.map(item => item.text));
    let memories = 0;
    for (const item of incoming.memory.items)
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
    n += estimateText(systemPrompt(c, tools));
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
  if (!c || conversationRunning(c.id) || runningElsewhere(c.id) || c.ended) return [];
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
    // 转写可能很长、模型可能先思考再写：超时给足五分钟。这段对话开了思考档位的，压缩时降到最低一档：摘要用不着深想
    const summary = await summarize(profile, prompt("assistant.compact", { transcript }), AbortSignal.timeout(300000), c.reasoning);
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
// 请模型把一段文字压成摘要：前文压缩与轮内压缩共用。不带系统提示；输出上限不另给，随平时的走；花的墨记在模型上
/** @param {Profile} profile */
async function summarize(profile, ask, signal, reasoning = "") {
  const response = await requestPatiently(profile, [{ role: "user", content: ask }], signal, {
    temperature: 0.2,
    systemPrompt: "",
    reasoning: reasoning ? "low" : ""
  });
  if (!response.ok) throw Error(await describeResponseError(response));
  /** @type {Message} */
  const temp = { id: `summary-${uid()}`, role: "assistant", content: "", timestamp: now() };
  if ((response.headers.get("content-type") || "").includes("text/event-stream")) await readSse(response, temp);
  else {
    const data = await response.json();
    temp.content = extractContent(data);
    temp.reasoning = normalizeContent(data?.choices?.[0]?.message?.reasoning_content ?? data?.choices?.[0]?.message?.reasoning);
    temp.usage = data.usage;
  }
  profile.usedTokens =
    Math.max(0, Number(profile.usedTokens || 0)) +
    (Number(temp.usage?.total_tokens || 0) || estimateTokens([{ content: ask }, { content: temp.content }]));
  renderQuota();
  const summary = String(temp.content || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
  if (!summary) throw Error(temp.reasoning ? "模型只写了思考、没写出摘要（输出被上限截断）" : "模型没有写出摘要");
  return summary;
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
// ---------- 轮内压缩：一答之内工具轮次叠得太长时，把较早的往来压成一份工作笔记，只留最近几轮原样 ----------
// 上面的压缩只在两答之间动手；长活（执事连跑几百轮、帮手审一整个仓库）在一答之内就能把窗口撑破，接口回一句放不下，整段活就白做了。
// 主答、旁注、帮手三条工具循环都经 readReply 发请求，所以在那里一并接上：overrides.head 记这一答自己的往来从 history 哪一格起，
// 之前的（对话历史、任务说明）原样保留。两个时机：送出前估算已过窗口的七成半（填了上下文窗口才有）；接口回说放不下（没填窗口也接得住）
const FOLD_KEEP_ROUNDS = 2;
// 各家接口「放不下」的说法：OpenAI 系 maximum context length、Anthropic prompt is too long / exceed context limit、
// Gemini exceeds the maximum number of tokens、Qwen Range of input length、Kimi token limit、GLM exceeds max length……
// 输出上限（max_tokens）太大、上游超时（context deadline exceeded）不算
function contextOverflow(message) {
  const text = String(message || "");
  return (
    /context.{0,24}(length|window|limit|size)|prompt is too long|too many tokens|token.{0,20}limit|exceed.{0,40}(limit|length|tokens)|input.{0,20}(too long|length)|上下文.{0,8}(长度|窗口|上限|超)|超出.{0,12}(上下文|长度|限制)|超长/i.test(
      text
    ) && !/deadline|output tokens?|max_completion/i.test(text)
  );
}
// 下一次请求约有多大：上一轮接口报了实际的提示用量就以它为底，只估此后新添的；没报就整份估（连同系统提示与工具定义）
function requestSize(history, overrides) {
  const seen = overrides.seen;
  if (seen && seen.at <= history.length) return seen.tokens + estimateTokens(history.slice(seen.at));
  return (
    estimateTokens(history) + estimateText(String(overrides.systemPrompt || "")) + (overrides.tools ? estimateText(JSON.stringify(overrides.tools)) : 0)
  );
}
const plainContent = content =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map(part => part?.text || "").join("\n") : "";
// 往来的转写：工具结果与调用参数按预算逐级截短，仍放不下就从最早的删起（上一份笔记留着）
function foldTranscript(region, budget) {
  const clip = (text, n) => (text.length > n ? `${text.slice(0, n)}…（余 ${text.length - n} 字略）` : text);
  let lines = [];
  for (const limit of [2000, 800, 300]) {
    lines = region.map(m => {
      if (m.role === "tool") return `结果：${clip(plainContent(m.content), limit)}`;
      if (m.role === "user") return `用户：${clip(plainContent(m.content), 4000)}`;
      const said = plainContent(m.content).trim();
      return [said && `你：${clip(said, 4000)}`, ...(m.tool_calls || []).map(c => `调用 ${c.function?.name}：${clip(String(c.function?.arguments || ""), limit / 4)}`)]
        .filter(Boolean)
        .join("\n");
    });
    if (estimateText(lines.join("\n\n")) <= budget) return lines.join("\n\n");
  }
  let total = estimateText(lines.join("\n\n"));
  for (let i = 0; i < lines.length && total > budget; i++) {
    if (lines[i].startsWith("你：［工作笔记］")) continue;
    total -= estimateText(lines[i]);
    lines[i] = "";
  }
  return lines.filter(Boolean).join("\n\n");
}
/**
 * 需要时把 history 里这一答较早的往来压成笔记（就地改 history），压了返回 true
 * @param {Profile} profile
 * @param {Array<Record<string, any>>} history
 * @param {Record<string, any>} overrides 读 head、systemPrompt、tools、reasoning、onFold；seen 由 readReply 记下
 */
async function keepInWindow(profile, history, signal, overrides, { overflow = false } = {}) {
  const head = overrides.head,
    window = Number(profile.contextWindow) || 0;
  if (typeof head !== "number") return false;
  if (!overflow && (!window || requestSize(history, overrides) < window * 0.75)) return false;
  // 一轮从带工具调用的 assistant 起，连同它的工具结果不拆开。留最近两轮原样，但留下的不过窗口的四分之一；接口已回说放不下的一轮不留
  const starts = [];
  for (let i = head; i < history.length; i++) if (history[i].role === "assistant" && history[i].tool_calls?.length) starts.push(i);
  let cut = history.length;
  for (let keep = overflow ? 0 : FOLD_KEEP_ROUNDS; keep > 0; keep--) {
    const at = starts[starts.length - keep];
    if (at > head && estimateTokens(history.slice(at)) <= window * 0.25) {
      cut = at;
      break;
    }
  }
  const region = history.slice(head, cut);
  // 没有新的工具往来可压（只剩上一份笔记，或放不下的是前面的对话本身）：压了也白压
  if (!region.some(m => m.role === "tool")) return false;
  const task = plainContent(history.slice(0, head).findLast(m => m.role === "user")?.content).slice(0, 4000);
  overrides.onFold?.(true);
  try {
    const note = await summarize(
      profile,
      prompt("assistant.fold", { task, transcript: foldTranscript(region, window ? window * 0.5 : CONTEXT_HEAVY) }),
      AbortSignal.any([signal, AbortSignal.timeout(300000)]),
      overrides.reasoning
    );
    history.splice(head, cut - head, { role: "assistant", content: `［工作笔记］\n${note}` }, { role: "user", content: prompt("assistant.folded") });
    overrides.seen = null;
    overrides.folds = (overrides.folds || 0) + 1;
    return true;
  } catch (error) {
    if (signal.aborted) throw error;
    // 没压成：送出前的那次照原样发，也许还放得下；接口已回说放不下的，由 readReply 把原来的错交回去
    console.warn("轮内压缩失败", error);
    return false;
  } finally {
    overrides.onFold?.(false);
  }
}
// 点右下角的计数：问一句就压，压缩期间计数处显示「压缩中」
async function openContextMenu(anchor) {
  const c = currentConversation();
  if (!c || anchor.dataset.busy) return;
  const source = compactable(c),
    turns = source.filter(m => m.role === "user").length;
  if (turns < 2) return toast(conversationRunning(c.id) || runningElsewhere(c.id) ? "生成中，稍后再压" : "对话还短，不必压缩");
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
    // 滚到了底便是最后一问：末一轮短问短答时，它的顶未必越得过阅读线
    if (host.scrollHeight - host.scrollTop - host.clientHeight < 8) current = [...rail.querySelectorAll(".outline-item")].at(-1);
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
// 老模型（4.5 及以前、Haiku、认不出型号的）：思考档位换成思考预算（token）；预算得小于 max_tokens，不够就把 max_tokens 抬上去
const ANTHROPIC_BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 16384, xhigh: 32768, max: 65536 };
// 模型代际：4.6 起思考改为 adaptive、深浅由 effort 定（预算在 4.7 起一律 400）；4.7 起不收 temperature（也是 400），
// 思绪默认不回、要明说 summarized；5 起不带 thinking 也照样在想。认不出型号的按老模型走
function anthropicGeneration(model) {
  const m = String(model || "")
    .toLowerCase()
    .match(/claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d)(?!\d))?/);
  const version = m ? Number(m[2]) + Number(m[3] || 0) / 10 : 0;
  return { adaptive: !!m && m[1] !== "haiku" && version >= 4.6, noSampling: version >= 4.7, thinksByDefault: version >= 5, version };
}
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
  const raw = String(payload.reasoning_effort || "").toLowerCase(),
    level = raw && raw !== "none" && raw !== "off" ? raw : "",
    generation = anthropicGeneration(payload.model),
    maxTokens = Math.max(16, Number(payload.max_tokens) || 32000);
  const body = { model: payload.model, max_tokens: maxTokens, messages, stream: true };
  // 提示缓存：系统提示末尾一处（工具定义连同系统提示，最稳的一段），整段对话最后一块一处（下一轮开口时此前的往来都从缓存读）。
  // 太短的前缀不缓存也不报错；思考块上不能放标记，往前找
  if (system.length) body.system = [{ type: "text", text: system.join("\n\n"), cache_control: { type: "ephemeral" } }];
  const tail = [...messages.at(-1).content].reverse().find(block => block.type !== "thinking" && block.type !== "redacted_thinking");
  if (tail) tail.cache_control = { type: "ephemeral" };
  if (generation.adaptive) {
    if (level || generation.thinksByDefault)
      body.thinking = { type: "adaptive", ...(generation.noSampling ? { display: "summarized" } : {}) };
    // effort 只认 low…max；4.6 还没有 xhigh
    if (level) body.output_config = { effort: level === "minimal" ? "low" : level === "xhigh" && !generation.noSampling ? "high" : level };
    if (!generation.noSampling && !body.thinking && payload.temperature !== undefined)
      body.temperature = Math.max(0, Math.min(1, Number(payload.temperature)));
  } else {
    const budget = level ? ANTHROPIC_BUDGETS[level] || 8192 : 0;
    // 开了思考 temperature 只能是 1：不传
    if (budget) {
      body.thinking = { type: "enabled", budget_tokens: budget };
      body.max_tokens = Math.max(maxTokens, budget + 4096);
    } else if (payload.temperature !== undefined) body.temperature = Math.max(0, Math.min(1, Number(payload.temperature)));
  }
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
    } else if (name === "error") {
      // 流到半途的报错（overloaded_error 最常见）：按 OpenAI 流里的报错格式交出去，页面据此按「连接中断」处理、稍候接着写，
      // 而不是把一句报错写进正文、当这一答写完了
      stopped = true;
      const message = [data.error?.type, data.error?.message].filter(Boolean).join("：") || "未知错误";
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message: `接口在作答途中出错：${message}` } })}\n\n`));
    }
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

  // ---- 20-mcp-settings.js ----
// 言 · 设置 → MCP：接入的服务一张卡一个，可新增、就地改、停用、重连、删去；整份配置也能以 JSON 改（通用的 mcpServers 写法，
// 服务说明里给的片段整段粘进来即可）。环境变量与请求头里像密钥的值默认遮住，存的时候还是遮着的就沿用原值；「显示密钥」才露出来。
// 怎么连、怎么交给模型在 15-tools/60-mcp.js 与 server/mcp/
const SECRET_KEY = /key|token|secret|pass|pwd|auth|cookie|credential|session|pat$/i,
  SECRET_MASK = "******（已隐藏）";
/** @type {string|null} 正在改的那张卡：服务名，新增时是 "" */
let mcpEditing = null,
  mcpRevealed = false,
  mcpJsonOpen = false;

function mcpSettingsHtml() {
  const bridged = apiBase !== null;
  return `<div id="mcpPage"><h2>MCP</h2><p class="settings-lead">接入外部的 MCP 服务，它们的工具便归模型所用。本机程序填命令与参数，远端服务填地址${bridged ? "" : "；MCP 服务由本机桥接起、连，桥接接通后才可用"}。</p><div id="mcpList" class="card-list">${mcpCardsHtml()}</div><div class="card-foot"><button id="mcpAdd" class="outline-btn" type="button">＋ 新增服务</button><button id="mcpJson" class="outline-btn" type="button">${mcpJsonOpen ? "收起 JSON" : "以 JSON 编辑"}</button></div><div id="mcpJsonBox" class="json-box${mcpJsonOpen ? "" : " hidden"}">${mcpJsonHtml()}</div><p class="settings-note">服务标为只读的工具径直调用，其余在「问而后行」下逐次请示。工具多的服务只给模型一张目录、按需取用。MCP 服务以你的权限运行在本机，不受沙箱约束；导出备份时不带环境变量与请求头。</p></div>`;
}
function mcpCardsHtml() {
  const names = Object.keys(mcpConfigs());
  const cards = names.map(name => (name === mcpEditing ? mcpFormHtml(name) : mcpCardHtml(name)));
  if (mcpEditing === "") cards.unshift(mcpFormHtml(""));
  return cards.join("") || `<p class="card-note">尚未接入任何服务。</p>`;
}
function mcpCardHtml(name) {
  const config = mcpConfigs()[name],
    state = mcp.servers[name];
  const [kind, text] = config.disabled
    ? ["", "已停用"]
    : !state
      ? ["", apiBase === null ? "等桥接接通" : "连接中…"]
      : state.ok
        ? [
            "ok",
            `${state.tools.length} 件工具 · ${mcp.lazy.includes(name) ? "按需给" : "逐件给"}${state.server?.version ? ` · v${state.server.version}` : ""}`
          ]
        : ["err", `连不上：${state.error}`];
  const where = config.command ? [config.command, ...(config.args || [])].join(" ") : config.url;
  const tools = state?.ok
    ? `<details class="card-more"><summary>工具</summary><div class="card-chips">${state.tools.map(tool => `<span>${escapeHtml(tool.name)}${mcpReadOnly(tool) ? "<small>只读</small>" : ""}</span>`).join("")}</div></details>`
    : "";
  return `<div class="card" data-mcp="${escapeHtml(name)}"><div class="card-head"><span class="card-name">${escapeHtml(name)}</span><span class="card-tag">${config.command ? "本机" : "远端"}</span><span class="card-state ${kind}" title="${escapeHtml(text)}">${escapeHtml(text)}</span><span class="card-actions"><button type="button" class="outline-btn" data-mcp-action="edit">编辑</button><button type="button" class="outline-btn" data-mcp-action="toggle">${config.disabled ? "启用" : "停用"}</button>${config.disabled ? "" : `<button type="button" class="outline-btn" data-mcp-action="restart">重连</button>`}</span></div><div class="card-sub" title="${escapeHtml(where)}">${escapeHtml(where)}</div>${tools}</div>`;
}
// 就地改的表单：本机与远端两种接法各有几栏；键值对一行一个；配置里表单不认得的字段原样留着
function mcpFormHtml(name) {
  const config = mcpMask(mcpConfigs()[name] || { command: "" }),
    local = mcpFormKind === "remote" ? false : mcpFormKind === "local" ? true : !config.url;
  const pairs = (object, sep) =>
    Object.entries(object || {})
      .map(([key, value]) => `${key}${sep}${value}`)
      .join("\n");
  const field = (label, key, value, hint = "", full = true) =>
    `<label${full ? ' class="profile-full"' : ""}>${label}<input class="field wide" data-f="${key}" value="${escapeHtml(value ?? "")}" placeholder="${escapeHtml(hint)}" spellcheck="false" autocomplete="off"></label>`;
  const area = (label, key, value, hint) =>
    `<label class="profile-full">${label}<textarea class="field wide field-area" data-f="${key}" placeholder="${escapeHtml(hint)}" spellcheck="false">${escapeHtml(value)}</textarea></label>`;
  const load = config.load || "auto";
  return `<div class="card editing" data-mcp-edit="${escapeHtml(name)}"><div class="profile-grid">${field("名称", "name", name, "如 github", false)}<label>接法<div class="segmented"><button type="button" data-mcp-kind="local" class="${local ? "active" : ""}">本机程序</button><button type="button" data-mcp-kind="remote" class="${local ? "" : "active"}">远端地址</button></div></label>${
    local
      ? `${field("命令", "command", config.command, "npx、uvx、python，或程序的完整路径")}${area("参数", "args", (config.args || []).join("\n"), "一行一个")}${field("工作目录", "cwd", config.cwd, "可不填")}${area("环境变量", "env", pairs(config.env, "="), "KEY=值，一行一个；令牌多放在这里")}`
      : `${field("地址", "url", config.url, "https://…/mcp")}${area("请求头", "headers", pairs(config.headers, ": "), "Authorization: Bearer …，一行一个")}<label class="check profile-full"><input type="checkbox" data-f="sse"${/sse/i.test(config.type || "") ? " checked" : ""}>旧式 HTTP+SSE（没勾时连不上也会自动退回再试）</label>`
  }${field("单次最多等（秒）", "timeout", config.timeout, "默认 600", false)}<label>交给模型<div class="segmented">${[
    ["auto", "按多少定"],
    ["inline", "逐件"],
    ["lazy", "按需"]
  ]
    .map(([value, label]) => `<button type="button" data-mcp-load="${value}" class="${load === value ? "active" : ""}">${label}</button>`)
    .join(
      ""
    )}</div></label>${field("免请示的工具", "autoApprove", (config.autoApprove || []).join(", "), "工具名，逗号分隔；只读的本就不问")}</div><div class="card-form-foot"><button type="button" class="outline-btn" data-mcp-form="save">保存</button><button type="button" class="outline-btn" data-mcp-form="cancel">取消</button><button type="button" class="outline-btn" data-mcp-form="reveal">${mcpRevealed ? "遮住密钥" : "显示密钥"}</button><span class="card-error"></span>${name ? `<button type="button" class="danger-btn" data-mcp-form="delete">删除</button>` : ""}</div></div>`;
}
/** @type {"local"|"remote"|null} 表单里切了接法、还没存时记在这里 */
let mcpFormKind = null;
function mcpJsonHtml() {
  const servers = Object.fromEntries(Object.entries(mcpConfigs()).map(([name, config]) => [name, mcpMask(config)]));
  return `<div class="json-head"><span>整份配置 · mcpServers 写法；遮住的密钥保持原样即沿用原值</span><button type="button" class="outline-btn" id="mcpJsonReveal">${mcpRevealed ? "遮住密钥" : "显示密钥"}</button></div><textarea id="mcpConfig" class="field field-area json-editor" spellcheck="false" autocomplete="off">${escapeHtml(JSON.stringify({ mcpServers: servers }, null, 2))}</textarea><div class="card-form-foot"><button id="mcpJsonSave" class="outline-btn" type="button">保存并连接</button><span id="mcpError" class="card-error"></span></div>`;
}
// 环境变量与请求头里像密钥的值遮住（显示密钥时不遮）
function mcpMask(config) {
  if (mcpRevealed) return config;
  const hide = object =>
    object && Object.fromEntries(Object.entries(object).map(([key, value]) => [key, SECRET_KEY.test(key) && value ? SECRET_MASK : value]));
  return { ...config, ...(config.env ? { env: hide(config.env) } : {}), ...(config.headers ? { headers: hide(config.headers) } : {}) };
}
// 存的时候：还是遮着的值换回原来的；原来没有这个值（改了名、新添的键却填了占位）就请用户重填
function mcpUnmask(name, config, previous) {
  for (const part of ["env", "headers"])
    for (const [key, value] of Object.entries(config[part] || {})) {
      if (value !== SECRET_MASK) continue;
      const original = previous?.[part]?.[key];
      if (original === undefined) throw Error(`「${name}」的 ${key} 还是隐藏的占位，找不到原值，请重填`);
      config[part][key] = original;
    }
  return config;
}
// 连接状态变了：卡片换新，正在改的那张不动
function renderMcpStatus() {
  if (settingsTab !== "mcp" || $("#settingsModal").classList.contains("hidden")) return;
  for (const card of $("#mcpList").querySelectorAll("[data-mcp]")) card.outerHTML = mcpCardHtml(card.dataset.mcp);
  if (!$("#mcpList").children.length) $("#mcpList").innerHTML = mcpCardsHtml();
}
function renderMcpSettings() {
  $("#mcpList").innerHTML = mcpCardsHtml();
  $("#mcpJsonBox").innerHTML = mcpJsonHtml();
  $("#mcpJsonBox").classList.toggle("hidden", !mcpJsonOpen);
  $("#mcpJson").textContent = mcpJsonOpen ? "收起 JSON" : "以 JSON 编辑";
}
// 粘进来的可能是整份 { mcpServers: {…} }，也可能只是里面那一层
function parseMcpConfig(text) {
  const parsed = JSON.parse(text || "{}");
  const servers = parsed.mcpServers ?? parsed;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw Error('应是 { "mcpServers": { 名字: 配置 } }');
  for (const [name, config] of Object.entries(servers)) {
    if (!config || typeof config !== "object" || !(typeof config.command === "string" || typeof config.url === "string"))
      throw Error(`「${name}」要有 command（本机程序）或 url（远端服务）`);
    mcpUnmask(name, config, mcpConfigs()[name]);
  }
  return servers;
}
// 从表单收一份配置：认得的几栏按表单来，其余字段照旧
function mcpFormConfig(form, previous) {
  const value = key => form.querySelector(`[data-f="${key}"]`)?.value.trim() ?? "";
  const lines = key =>
    value(key)
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
  const pairs = (key, sep) =>
    Object.fromEntries(
      lines(key)
        .map(line => [line.slice(0, line.indexOf(sep)).trim(), line.slice(line.indexOf(sep) + 1).trim()])
        .filter(([k]) => k)
    );
  const { command, args, cwd, env, url, headers, type, transport, timeout, load, autoApprove, ...rest } = previous || {};
  const local = !!form.querySelector('[data-mcp-kind="local"].active');
  /** @type {Record<string, any>} */
  const config = local
    ? {
        command: value("command"),
        ...(lines("args").length ? { args: lines("args") } : {}),
        ...(value("cwd") ? { cwd: value("cwd") } : {}),
        ...(lines("env").length ? { env: pairs("env", "=") } : {})
      }
    : {
        url: value("url"),
        ...(lines("headers").length ? { headers: pairs("headers", ":") } : {}),
        ...(form.querySelector('[data-f="sse"]').checked ? { type: "sse" } : {})
      };
  if (local ? !config.command : !config.url) throw Error(local ? "请填命令" : "请填地址");
  const seconds = Number(value("timeout")),
    chosen = form.querySelector("[data-mcp-load].active").dataset.mcpLoad,
    approve = value("autoApprove")
      .split(/[,，\s]+/)
      .filter(Boolean);
  return {
    ...rest,
    ...config,
    ...(seconds > 0 ? { timeout: seconds } : {}),
    ...(chosen !== "auto" ? { load: chosen } : {}),
    ...(approve.length ? { autoApprove: approve } : {})
  };
}
function bindMcpEvents() {
  if (settingsTab !== "mcp") return;
  const commit = (servers, restart = []) => {
    store.settings.mcpServers = servers;
    saveStore();
    for (const name of restart) delete mcp.servers[name];
    renderMcpSettings();
    void mcpReady(restart);
  };
  $("#mcpAdd").addEventListener("click", () => {
    mcpEditing = "";
    mcpFormKind = null;
    renderMcpSettings();
    $('#mcpList [data-f="name"]')?.focus();
  });
  $("#mcpJson").addEventListener("click", () => {
    mcpJsonOpen = !mcpJsonOpen;
    renderMcpSettings();
  });
  // 整页一个委托：设置页每画一回，这一页连同监听一起换新
  $("#mcpPage").addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.id === "mcpJsonReveal") {
      mcpRevealed = !mcpRevealed;
      return renderMcpSettings();
    }
    if (target.id === "mcpJsonSave") {
      try {
        const servers = parseMcpConfig($("#mcpConfig").value);
        mcpEditing = null;
        mcp.servers = {};
        commit(servers);
      } catch (error) {
        $("#mcpError").textContent = String(error.message || error);
      }
      return;
    }
    const card = target.closest("[data-mcp]");
    if (card && target.dataset.mcpAction) {
      const name = card.dataset.mcp,
        config = mcpConfigs()[name];
      if (target.dataset.mcpAction === "edit") {
        mcpEditing = name;
        mcpFormKind = null;
        return renderMcpSettings();
      }
      if (target.dataset.mcpAction === "toggle") {
        if (config.disabled) delete config.disabled;
        else config.disabled = true;
      }
      return commit(mcpConfigs(), [name]);
    }
    const form = target.closest("[data-mcp-edit]");
    if (!form) return;
    // 切接法：换一套栏，已填的名称留着
    if (target.dataset.mcpKind) {
      mcpFormKind = /** @type {"local"|"remote"} */ (target.dataset.mcpKind);
      const typed = form.querySelector('[data-f="name"]').value;
      form.outerHTML = mcpFormHtml(form.dataset.mcpEdit);
      $(`#mcpList [data-mcp-edit="${CSS.escape(form.dataset.mcpEdit)}"] [data-f="name"]`).value = typed;
      return;
    }
    if (target.dataset.mcpLoad) return form.querySelectorAll("[data-mcp-load]").forEach(b => b.classList.toggle("active", b === target));
    const action = target.dataset.mcpForm,
      before = form.dataset.mcpEdit;
    if (action === "cancel") {
      mcpEditing = null;
      return renderMcpSettings();
    }
    if (action === "reveal") {
      mcpRevealed = !mcpRevealed;
      return (form.outerHTML = mcpFormHtml(before));
    }
    if (action === "delete") {
      const { [before]: _gone, ...rest } = mcpConfigs();
      mcpEditing = null;
      delete mcp.servers[before];
      return commit(rest);
    }
    if (action !== "save") return;
    const error = form.querySelector(".card-error");
    try {
      const name = form.querySelector('[data-f="name"]').value.trim();
      if (!name) throw Error("请填名称");
      if (name !== before && mcpConfigs()[name]) throw Error(`已有名为「${name}」的服务`);
      const config = mcpUnmask(name, mcpFormConfig(form, mcpConfigs()[before]), mcpConfigs()[before]);
      // 改了名的留在原来的位置
      const servers = before
        ? Object.fromEntries(Object.entries(mcpConfigs()).map(([key, value]) => (key === before ? [name, config] : [key, value])))
        : { ...mcpConfigs(), [name]: config };
      mcpEditing = null;
      delete mcp.servers[before];
      commit(servers, [name]);
    } catch (problem) {
      error.textContent = String(problem.message || problem);
    }
  });
}

  // ---- 21-env-settings.js ----
// 言 · 设置 → 环境：给模型备一套自带的开发环境（桥接那头在 server/env/），装在存储位置的「环境」目录里，不依赖、也不改动系统。
// 一组工具一张卡，勾上的在「准备环境」时装好；模型的指令与 MCP 服务都接着这套环境，缺的库它自己 pip / npm 装进来
/** @type {{ home: string, state: Record<string, any>|null, packs: Array<Record<string, any>>, job: Record<string, any>|null }|null} */
let envStatus = null,
  envPoll = 0;
function envSettings() {
  return store.settings.env;
}
// 问桥接要一次环境的状态；正在准备就隔一会儿再问，直到装完
async function refreshEnv() {
  if (apiBase === null) return;
  const root = bootstrap.store?.root;
  const status = await bridge("/api/env/status", {}, AbortSignal.timeout(8000)).catch(() => null);
  // 换存储位置期间，旧根的慢响应不能再画到新根的环境页上。
  if (root !== bootstrap.store?.root) return;
  if (status) envStatus = status;
  renderEnvStatus();
  clearTimeout(envPoll);
  if (envStatus?.job?.running) envPoll = setTimeout(refreshEnv, 1200);
}
function envSettingsHtml() {
  const s = envSettings();
  return `<div id="envPage"><h2>环境</h2><p class="settings-lead">给模型备一套自带的开发环境：独立的 Python 与常用工具，装在存储位置的「环境」目录里，不依赖、也不改动系统。模型的指令与 MCP 服务都接着它；缺的库模型会自己装进这里。</p><div id="envStatus">${envStatusHtml()}</div><h3 class="settings-sub">工具包</h3><div id="envPacks" class="card-list">${envPacksHtml()}</div><div class="setting-row"><div class="setting-copy"><strong>另装</strong><small>清单之外常用的，包名以空格分开</small></div><div class="setting-actions env-extra"><label class="setting-inline">Python<input id="envPip" class="field" spellcheck="false" placeholder="如 sympy jieba" value="${escapeHtml(s.pip)}"></label><label class="setting-inline">Node<input id="envNpm" class="field" spellcheck="false" placeholder="如 pnpm" value="${escapeHtml(s.npm)}"></label></div></div><div class="setting-row"><div class="setting-copy"><strong>下载源</strong><small>国内镜像走清华、中科大与 npmmirror；官方走 PyPI、GitHub 与 npmjs。模型往后自己装包也走这一路</small></div><div class="segmented">${[
    ["china", "国内镜像"],
    ["official", "官方"]
  ]
    .map(
      ([value, label]) => `<button type="button" data-env-mirror="${value}" class="${s.mirror === value ? "active" : ""}">${label}</button>`
    )
    .join("")}</div></div></div>`;
}
function envStatusHtml() {
  if (apiBase === null)
    return `<div class="card"><div class="card-head"><span class="card-name">需要本机桥接</span><span class="card-state">环境由桥接装、由桥接起的进程用；桥接接通后再来</span></div></div>`;
  if (!envStatus) return `<div class="card"><div class="card-head"><span class="card-name">查看中…</span></div></div>`;
  const { state, job, home } = envStatus,
    running = !!job?.running;
  const summary = state
    ? `${state.python} · ${state.packs.length - 1} 组工具 · ${formatDay(state.at)}准备`
    : "勾选要用的工具，点「准备环境」；头一回要下载几十到几百 MB";
  const log =
    job && (running || job.error)
      ? `<div class="card-note">${escapeHtml(running ? `正在${job.step || "开始"}…` : `没装成：${job.error}`)}</div><pre class="env-log">${escapeHtml(job.log.join("\n"))}</pre>`
      : "";
  return `<div class="card"><div class="card-head"><span class="card-name">${running ? "准备中" : state ? "已备好" : "尚未准备"}</span><span class="card-state${state ? " ok" : ""}" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span><span class="card-actions"><button id="envPrepare" type="button" class="outline-btn"${running ? " disabled" : ""}>${running ? "准备中…" : state ? "更新环境" : "准备环境"}</button>${state && !running ? `<button id="envClear" type="button" class="danger-btn">清空</button>` : ""}</span></div><div class="card-sub" title="${escapeHtml(home)}">${escapeHtml(home)}</div>${log}</div>`;
}
// 一组一张卡：名称与说明在左，状态在右——没选是空框，选了待装是朱色实心，装好了是一笔勾；装了又取消的标「待卸」，下回准备时卸掉
function envPacksHtml() {
  const packs = envStatus?.packs || [],
    chosen = new Set(envSettings().packs),
    installed = new Set(envStatus?.state?.packs || []);
  if (!packs.length) return `<p class="card-note">桥接接通后列出可装的工具包。</p>`;
  return packs
    .map(pack => {
      const on = pack.base || chosen.has(pack.id),
        state = installed.has(pack.id) ? (on ? "done" : "drop") : on ? "pick" : "",
        word = { done: "已装", pick: "待装", drop: "待卸" }[state] || "",
        contents = [...pack.pip, ...pack.npm].join(" · ") || pack.hint;
      return `<button type="button" class="card pickable env-pack" role="checkbox" aria-checked="${on}"${pack.base ? ' aria-disabled="true"' : ""} data-env-pack="${escapeHtml(pack.id)}" data-state="${state}"><span class="card-body"><span class="card-head"><span class="card-name">${escapeHtml(pack.name)}</span><span class="card-tag">${escapeHtml(pack.tag)}</span></span><span class="card-note">${escapeHtml(pack.note)}</span>${contents ? `<span class="card-sub" title="${escapeHtml(contents)}">${escapeHtml(contents)}</span>` : ""}</span><span class="env-pack-word">${word}</span><span class="card-tick" aria-hidden="true">${state === "done" ? `<svg viewBox="0 0 22 22"><path d="M4.5 11.8c1.6 1.2 3 2.6 4.3 4.3C11 11.4 14 7.6 18 4.8"/></svg>` : ""}</span></button>`;
    })
    .join("");
}
function renderEnvStatus() {
  if (settingsTab !== "env" || $("#settingsModal").classList.contains("hidden")) return;
  $("#envStatus").innerHTML = envStatusHtml();
  $("#envPacks").innerHTML = envPacksHtml();
  const log = $("#envStatus .env-log");
  if (log) log.scrollTop = log.scrollHeight;
}
const splitNames = text =>
  String(text || "")
    .split(/[\s,，]+/)
    .filter(Boolean);
function bindEnvEvents() {
  if (settingsTab !== "env") return;
  if (!envStatus) void refreshEnv();
  for (const [id, key] of [
    ["#envPip", "pip"],
    ["#envNpm", "npm"]
  ])
    $(id).addEventListener("input", event => {
      envSettings()[key] = event.target.value;
      saveStoreSoon();
    });
  $("#envPage").addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    const pack = button.dataset.envPack;
    if (pack && button.getAttribute("aria-disabled") !== "true") {
      const s = envSettings();
      s.packs = s.packs.includes(pack) ? s.packs.filter(id => id !== pack) : [...s.packs, pack];
      saveStore();
      return renderEnvStatus();
    }
    if (button.dataset.envMirror) {
      envSettings().mirror = button.dataset.envMirror;
      saveStore();
      button.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === button));
      return;
    }
    if (button.id === "envPrepare") {
      const s = envSettings();
      const removed = (envStatus?.state?.packs || []).filter(
        id => !s.packs.includes(id) && !envStatus?.packs?.some(pack => pack.id === id && pack.base)
      );
      if (removed.length) {
        const names = removed.map(id => envStatus.packs.find(pack => pack.id === id)?.name || id);
        if (
          !(await askConfirm({
            title: `卸载 ${removed.length} 组工具？`,
            body: `当前已安装、但未勾选的 ${names.join("、")} 将在更新环境时卸载。`,
            ok: "卸载并更新"
          }))
        )
          return;
      }
      envStatus = await bridge("/api/env/prepare", {
        packs: s.packs,
        pip: splitNames(s.pip),
        npm: splitNames(s.npm),
        mirror: s.mirror
      }).catch(error => {
        toast(String(error.message || error));
        return envStatus;
      });
      return refreshEnv();
    }
    if (button.id === "envClear") {
      if (!(await askConfirm({ title: "清空环境？", body: "环境目录整个删去；装过的包都得重装。对话、卷宗与配置不受影响。", ok: "清空" })))
        return;
      envStatus = await bridge("/api/env/clear", {}).catch(error => {
        toast(String(error.message || error));
        return envStatus;
      });
      renderEnvStatus();
    }
  });
}
// 系统提示里 work.env 那一句的值：环境备好了，告诉模型有哪些、缺的往哪装；没备好不带
function envVars() {
  const state = envStatus?.state;
  if (!state) return null;
  const kits = (envStatus.packs || [])
    .filter(pack => !pack.base && state.packs.includes(pack.id))
    .map(pack => `${pack.name}（${pack.hint || [...pack.pip, ...pack.npm].slice(0, 6).join("、")}）`);
  const extra = [...state.pip, ...state.npm];
  return { kits: [state.python, ...kits, ...(extra.length ? [`另装 ${extra.join("、")}`] : [])].join("；") };
}

  // ---- 22-presets.js ----
// 言 · 预设：一套打包好的做法——提示词、给哪几组工具与哪几个 MCP 服务、用哪个模型、指令权限。
// 在模型菜单里选用：选了的对话都照这一套（提示词排在系统提示最前，工具只给挑中的，见 systemPrompt 与 toolDefinitions）；
// 新对话照上回选的。不选即言的本色。设置 → 预设里一张卡一个，就地改、改了即存
/** @type {string|null} 正在改的那张卡 */
let presetEditing = null;

/** @param {Conversation|null} conversation @returns {Preset|null} */
function presetOf(conversation) {
  // 还没发出的新对话：从组首「＋」来且组带了预设的，用组的
  const id = conversation ? conversation.presetId || "" : pendingGroup()?.presetId || store.settings.presetId;
  return (id && store.settings.presets.find(preset => preset.id === id)) || null;
}
// 选一个预设：记在这段对话上，新对话也照它；带了模型的换过去，带了权限的换上
function selectPreset(id) {
  const preset = store.settings.presets.find(item => item.id === id) || null,
    c = currentConversation();
  store.settings.presetId = preset?.id || "";
  if (c) {
    c.presetId = preset?.id || "";
    if (preset?.policy) c.commandPolicy = preset.policy;
    markDirty(c.id);
  }
  saveStore();
  if (preset?.profileId && profiles().some(p => p.id === preset.profileId)) selectProfile(preset.profileId);
  else closeModelMenu();
  renderHeader();
  renderSendButtons();
}
// 模型菜单里的一段：本色与各个预设；一个预设都没有时不占地方
function presetMenuHtml() {
  const presets = store.settings.presets;
  if (!presets.length) return "";
  const current = presetOf(currentConversation())?.id || "";
  const option = (id, name, note) =>
    `<button class="model-option preset-option${id === current ? " active" : ""}" data-preset="${escapeHtml(id)}"${id === current ? ' aria-current="true"' : ""} title="${escapeHtml(note)}"><strong><span class="model-dot"></span><span class="model-option-name">${escapeHtml(name)}</span></strong></button>`;
  return `<div class="menu-section"><div class="menu-section-title"><span>预设</span></div></div>${option("", "本色", "言之本色，不加预设")}${presets.map(preset => option(preset.id, preset.name, preset.prompt.split("\n")[0].slice(0, 80))).join("")}`;
}

function presetsSettingsHtml() {
  const presets = store.settings.presets;
  return `<div id="presetPage"><h2>预设</h2><p class="settings-lead">将提示词、工具、MCP 服务、模型与指令权限合为一套，即是预设。于输入框旁的模型菜单中选用，所选的对话皆依此行事；不选即为本色。</p><div class="card-list">${
    presets.map(preset => (preset.id === presetEditing ? presetFormHtml(preset) : presetCardHtml(preset))).join("") ||
    `<p class="card-note">尚无预设。</p>`
  }</div><div class="card-foot"><button id="presetAdd" class="outline-btn" type="button">＋ 新添预设</button></div></div>`;
}
/** @param {Preset} preset */
function presetCardHtml(preset) {
  const profile = profiles().find(p => p.id === preset.profileId),
    groups = preset.tools ? preset.tools.map(id => TOOL_GROUPS[id]).filter(Boolean) : null,
    parts = [
      groups ? (groups.length ? `工具：${groups.join("、")}` : "不带工具") : "工具全给",
      preset.mcp ? (preset.mcp.length ? `MCP：${preset.mcp.join("、")}` : "不接 MCP") : ""
    ].filter(Boolean);
  const first = preset.prompt.trim().split("\n")[0] || "（未写提示词）";
  return `<div class="card" data-preset-card="${escapeHtml(preset.id)}"><div class="card-head"><span class="card-name">${escapeHtml(preset.name)}</span>${profile ? `<span class="card-tag">${escapeHtml(profile.name)}</span>` : ""}${preset.policy ? `<span class="card-tag">${policyName(preset.policy)}</span>` : ""}<span class="card-state"></span><span class="card-actions"><button type="button" class="outline-btn" data-preset-action="edit">编辑</button><button type="button" class="outline-btn" data-preset-action="use">选用</button></span></div><div class="card-note" title="${escapeHtml(preset.prompt)}">${escapeHtml(first.slice(0, 120))}</div><div class="card-sub">${escapeHtml(parts.join(" · "))}</div></div>`;
}
/** @param {Preset} preset */
function presetFormHtml(preset) {
  const servers = Object.keys(mcpConfigs());
  const checks = (kind, entries, chosen) =>
    `<div class="preset-checks">${entries
      .map(
        ([id, label]) =>
          `<label class="check"><input type="checkbox" data-preset-${kind}="${escapeHtml(id)}"${!chosen || chosen.includes(id) ? " checked" : ""}>${escapeHtml(label)}</label>`
      )
      .join("")}</div>`;
  const policies = [
    ["", "照设置"],
    ["ask", "问而后行"],
    ["review", "审而后行"],
    ["auto", "径行"]
  ];
  return `<div class="card editing" data-preset-card="${escapeHtml(preset.id)}"><div class="profile-grid"><label class="profile-full">名称<input class="field wide" data-preset-field="name" value="${escapeHtml(preset.name)}" maxlength="24"></label><label class="profile-full">提示词<textarea class="field wide field-area preset-prompt" data-preset-field="prompt" placeholder="所任何职、所司何事、答以何种风格；列于系统提示之首" spellcheck="false">${escapeHtml(preset.prompt)}</textarea></label><label>模型<select class="field wide select" data-preset-field="profileId"><option value="">沿用当前模型</option>${profiles()
    .map(p => `<option value="${escapeHtml(p.id)}"${p.id === preset.profileId ? " selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join(
      ""
    )}</select></label><label>指令权限<div class="segmented">${policies.map(([value, label]) => `<button type="button" data-preset-policy="${value}" class="${preset.policy === value ? "active" : ""}">${label}</button>`).join("")}</div></label><div class="profile-full"><span class="preset-label">工具</span>${checks("tool", Object.entries(TOOL_GROUPS), preset.tools)}</div>${
    servers.length
      ? `<div class="profile-full"><span class="preset-label">MCP 服务</span>${checks(
          "mcp",
          servers.map(name => [name, name]),
          preset.mcp
        )}</div>`
      : ""
  }</div><div class="card-form-foot"><button type="button" class="outline-btn" data-preset-action="done">完成</button><button type="button" class="outline-btn" data-preset-action="use">选用</button><button type="button" class="danger-btn" data-preset-action="delete">删除</button></div></div>`;
}
function policyName(policy) {
  return { ask: "问而后行", review: "审而后行", auto: "径行" }[policy] || "";
}
function renderPresetSettings() {
  if (settingsTab !== "presets" || $("#settingsModal").classList.contains("hidden")) return;
  renderSettings();
}
function bindPresetEvents() {
  if (settingsTab !== "presets") return;
  const page = $("#presetPage"),
    presetIn = el => store.settings.presets.find(preset => preset.id === el.closest("[data-preset-card]")?.dataset.presetCard);
  $("#presetAdd").addEventListener("click", () => {
    const preset = normalizePreset({ id: uid(), name: "新预设", prompt: "" });
    store.settings.presets.push(preset);
    presetEditing = preset.id;
    saveStore();
    renderPresetSettings();
    /** @type {HTMLInputElement|null} */ (page.ownerDocument.querySelector('#presetPage [data-preset-field="name"]'))?.select();
  });
  // 文字与模型：边改边存，不重画（重画会丢光标）
  page.addEventListener("input", event => {
    const el = /** @type {HTMLInputElement} */ (event.target),
      preset = presetIn(el),
      key = el.dataset.presetField;
    if (!preset || !key) return;
    preset[key] = key === "name" ? el.value.trim() || "未命名" : el.value;
    saveStoreSoon();
    renderHeader();
  });
  // 勾选：全勾上存成 null（往后新添的组与服务也跟着给），否则存勾中的那几个
  page.addEventListener("change", event => {
    const el = /** @type {HTMLInputElement} */ (event.target),
      preset = presetIn(el);
    if (!preset || el.type !== "checkbox") return;
    const kind = el.dataset.presetTool !== undefined ? "tool" : "mcp",
      boxes = [...el.closest(".preset-checks").querySelectorAll("input")],
      chosen = boxes.filter(box => box.checked).map(box => box.dataset[kind === "tool" ? "presetTool" : "presetMcp"]);
    preset[kind === "tool" ? "tools" : "mcp"] = chosen.length === boxes.length ? null : chosen;
    saveStore();
  });
  page.addEventListener("click", async event => {
    const button = /** @type {HTMLElement} */ (event.target).closest("button"),
      preset = button && presetIn(button);
    if (!button || !preset) return;
    if (button.dataset.presetPolicy !== undefined) {
      preset.policy = /** @type {Preset["policy"]} */ (button.dataset.presetPolicy);
      saveStore();
      return button.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === button));
    }
    const action = button.dataset.presetAction;
    if (action === "edit") presetEditing = preset.id;
    if (action === "done") presetEditing = null;
    if (action === "use") {
      selectPreset(preset.id);
      toast(`已选用「${preset.name}」`);
    }
    if (action === "delete") {
      if (!(await askConfirm({ title: `删除预设「${preset.name}」？`, body: "选用它的对话将回到本色。", ok: "删除" }))) return;
      store.settings.presets = store.settings.presets.filter(item => item !== preset);
      if (store.settings.presetId === preset.id) store.settings.presetId = "";
      for (const c of store.conversations)
        if (c.presetId === preset.id) {
          c.presetId = "";
          markDirty(c.id);
        }
      presetEditing = null;
      saveStore();
      renderHeader();
    }
    renderPresetSettings();
  });
}

  // ---- 23-guide.js ----
// 言 · 设置 → 文档：言的用法，一事一篇。目录像古籍的目录页（卷次、题名、引线、提要），点开一篇是一页版心：
// 顶上卷次与书口的鱼尾，步骤是小朱印，提醒写成右侧的眉批，底下翻前后篇。
// 正文只认两样记号：`代码` 与 **加重**；要加一篇，往 GUIDE 里添一条
/**
 * @typedef {{ h: string, body: string, note?: string, noteLabel?: string }} GuideStep
 * @typedef {{ id: string, title: string, lead: string, summary: string, steps: GuideStep[] }} GuideTopic
 */
/** @type {GuideTopic[]} */
const GUIDE = [
  {
    id: "start",
    title: "起步",
    lead: "接入模型，落笔初问",
    summary: "接入一个模型，便可落笔。顶栏右侧三件，标示言此刻的情形。",
    steps: [
      {
        h: "接入模型",
        body: "设置 → 模型 → 新增：填显示名称、Base URL 与 API Key，点「获取列表」择定模型，亦可手填模型 ID。接口分 **OpenAI 兼容**（多数服务与中转站）与 **Anthropic** 两种。填毕以「测试连接」验一遍。",
        noteLabel: "留意",
        note: "API Key 只存于本机的 配置.json，导出的备份不含它。"
      },
      {
        h: "落笔",
        body: "输入框里写下所问，Enter 寄出，Shift + Enter 换行；图片可径直粘贴。作答途中亦可补上一句，待模型说到落点时递上，不打断其思路。"
      },
      {
        h: "识顶栏",
        body: "右上三件：一点印泥是连接——静时空心，作答时朱色呼吸，断开则转赤；中间一方砚台，点之明暗互换；右侧一笔墨是用量，未设上限记所耗，设了便是余墨，随用随减。",
        note: "印泥转赤，多是 start.cmd 的窗口已关。重新打开，下一回寄出时页面自会接上。"
      }
    ]
  },
  {
    id: "modes",
    title: "言与行",
    lead: "对谈与执事，以目录为界",
    summary: "同一段对话，不绑目录是「言」，照常对谈；绑定目录是「行」，在其中读写文件、执行指令。",
    steps: [
      {
        h: "言 · 对谈",
        body: "未绑目录即为对谈。需要表格、文档、PDF 一类成品时，模型将其落入卷宗，答末列出「成品 n 件」，可预览，可下载。"
      },
      {
        h: "行 · 执事",
        body: "欢迎页点「目录」签，择一工作目录，此段对话便是执事：检索、读懂、修改、运行、验证，每一步皆记于行迹。",
        note: "执事只在此目录内动手。若需触及目录之外，先于设置 → 工具看清沙箱与可及范围。"
      },
      {
        h: "依目录归组",
        body: "侧栏里绑定同一目录的对话归为一组，组首一方「工」印，左侧一道朱线标出范围；组首的「＋」在此目录另起一段。"
      }
    ]
  },
  {
    id: "safety",
    title: "权限沙箱",
    lead: "三档权限与沙箱之界",
    summary: "指令逐条可见。何时须经你首肯，由三档权限而定；沙箱在桥接一侧守护系统。",
    steps: [
      {
        h: "三档权限",
        body: "**问而后行**：凡会改动的指令逐条请示，只读者径行。**审而后行**：由桥接代审，寻常改动放行，只拦伤及系统、难以恢复者。**径行**：不再审查。输入框旁随时可换。"
      },
      {
        h: "沙箱",
        body: "问而后行下从严：改动不出工作目录，机密文件不碰，动系统或直接外联的指令拦下，转请你定夺。审而后行与径行只守系统本身。总开关在设置 → 工具。",
        noteLabel: "留意",
        note: "沙箱是静态筛查，并非进程隔离；MCP 服务以你的权限运行，不受其约束。"
      },
      {
        h: "止",
        body: "作答时寄出键化为「止」，按下即停；正在执行的指令连同其子进程一并收束。"
      }
    ]
  },
  {
    id: "files",
    title: "卷宗附件",
    lead: "附件的来路，成品的归处",
    summary: "附件随一问送出；卷宗是跨对话的书架，常用文件收存于此。",
    steps: [
      {
        h: "附件",
        body: "点「＋」、拖入或粘贴皆可：图片、文本、代码、PDF 与 Office 文档。文档先在本机抽出正文；单件不过 32 MB，一次至多 10 件。"
      },
      {
        h: "卷宗",
        body: "侧栏的「卷宗」即存储位置里的 `卷宗/` 目录。拖入，或在附件上按「藏」收存；需随消息送出时，从「＋」中选「卷宗」。",
        note: "卷宗里的文档对每段对话皆可读，模型用到时方才取回；设置 → 工具中可关闭。"
      },
      {
        h: "成品",
        body: "模型所作的文件列于答末的「成品」卡：就地预览，Word、Excel、PPT 亦可抽出正文查看；日后在卷宗中删去的，此处标为「已移出」。"
      }
    ]
  },
  {
    id: "notes",
    title: "旁注引用",
    lead: "就地追问，不入正文",
    summary: "读至一处有疑，不必打断主线：或引而问之，或于旁另起一段小对话。",
    steps: [
      {
        h: "引用",
        body: "在回复中划选一段，浮出「引用」，所选即作为引文置入输入框，随下一问送出。"
      },
      {
        h: "旁注",
        body: "划选后择「旁注」，右侧展开一段附于此处的小对话。它读得到正文，正文读不到它；只查不改，不动文件。",
        note: "同一条回复上可起数条旁注；「旁注 n」打开目录，‹ › 于各条间切换，「阔」铺满整页。"
      },
      {
        h: "随分支而行",
        body: "旁注随所注的一问一答而行：切换至另一版本，注于旧版的旁注暂隐，切回即现。"
      }
    ]
  },
  {
    id: "delegate",
    title: "差遣",
    lead: "遣帮手分担一事",
    summary: "量大而独立的事，模型会差遣帮手另起一段去做，事毕回报。",
    steps: [
      {
        h: "何时差遣",
        body: "通读一批资料并归纳、多路检索比对、在陌生模块中排查——此类事由模型自行分出，互不相干者可数件并行。"
      },
      {
        h: "观其所为",
        body: "行迹中的差遣卡片可以展开：帮手所领之命、所行每一步、最后的回报，皆在其中。输入框上方的帮手条亦可直达。",
        noteLabel: "留意",
        note: "帮手看不到这段对话，只凭任务说明行事；它不向你请示，也不改动记忆。"
      }
    ]
  },
  {
    id: "presets",
    title: "预设",
    lead: "为专事定一套做法",
    summary: "将提示词、工具、MCP 服务、模型与权限合为一套，选用即全部换上。",
    steps: [
      {
        h: "新添",
        body: "设置 → 预设 → 新添：命名，再写一段提示词——所任何职、所司何事、答以何种风格。提示词列于系统提示之首。"
      },
      {
        h: "择工具",
        body: "工具按组勾选：联网、计算、指令与文件、翻文档、请示、记忆与旧谈、差遣；已接入 MCP 的，再择定所用服务。全数勾选即为「全给」，日后新添者亦随之给出。",
        note: "工具愈少，每一问所负的定义愈轻；只作对谈的预设，工具可一概不选。"
      },
      {
        h: "选用",
        body: "输入框旁的模型菜单中多出「预设」一段，点选即换上，模型按钮上标其名。预设若带模型或权限，一并换上。不选即为本色。"
      }
    ]
  },
  {
    id: "groups",
    title: "分组",
    lead: "聚相关之谈为一组",
    summary: "相关的对话聚为一组，不至散落；组可带一个预设与一个默认目录。",
    steps: [
      {
        h: "立组",
        body: "侧栏「分组」进入分组页，点「＋ 新建分组」；或在对话「⋯」里择「移入分组」→「新建分组…」，就地立一组并移入。已有的组，把对话拖到组上即移入，拖出组外即移出。"
      },
      {
        h: "定其所依",
        body: "侧栏组首的「⋯」→「设置」，或分组页中点开一组：可改组名，择一个预设，定一个默认目录。组里新起的对话皆依此——预设的提示词、工具与模型一并换上，绑定目录即为行。",
        note: "这两样只管新起的对话；已在组中的对话照旧。"
      },
      {
        h: "在组中行文",
        body: "侧栏组首的「＋」或分组页的「在此组新建」另起一段，输入框「＋」旁标着所归之组。侧栏里的组与「工」组一样按时间排，组里一有新言，整组便靠前。组里的对话置顶，只在组内居前，右上角折一小角为记。解散只拆组，对话退回散列。"
      }
    ]
  },
  {
    id: "mcp",
    title: "MCP",
    lead: "接入外部服务",
    summary: "借 MCP，言可调用别处的能力，如 GitHub 的仓库与议题，或其他项目自带的工具。接入只需配置，无需改动代码。",
    steps: [
      {
        h: "觅其接法",
        body: "服务的说明中通常附一段 JSON：本机程序写明 `command` 与 `args`，远端服务写明 `url`。",
        note: "项目中已有的 `.mcp.json` 可整段粘入「以 JSON 编辑」，写法与 Claude、Cursor 通用。"
      },
      {
        h: "于设置中添入",
        body: "设置 → MCP → 新增服务，填入命令或地址；令牌置于环境变量或请求头中，页面上遮蔽显示。"
      },
      {
        h: "交予模型",
        body: "接通后卡上显出工具件数。对话中说明所求，模型自会择用相宜的工具，行迹里记下所调何件；工具繁多的服务只给模型一张目录，按需取用。",
        noteLabel: "留意",
        note: "标为只读的工具径直调用，其余在问而后行下逐次请示。"
      }
    ]
  },
  {
    id: "env",
    title: "环境",
    lead: "为模型备一套开发环境",
    summary: "独立的 Python 与常用工具链，装于存储位置的 `环境/`，不改动系统。",
    steps: [
      {
        h: "勾选",
        body: "设置 → 环境：一组工具一张卡，名称居左、状态居右——空框未选，朱色实心待装，一笔勾已装。可选数据处理、办公文档、图像、音视频，以及 C / C++、Go、Rust、Java 数套工具链。"
      },
      {
        h: "准备",
        body: "点「准备环境」，环境即与勾选对齐：勾上者装，取消者卸。国内镜像下载较快；工具链体量较大，卡上注明约数。",
        note: "模型的指令与 MCP 服务皆接此环境；所缺之库，模型自行装入即可。"
      }
    ]
  },
  {
    id: "memory",
    title: "记忆",
    lead: "何者当记，何时可忘",
    summary: "录是一份跨对话的记忆：你的偏好、身份与约定，此后不必重述。",
    steps: [
      {
        h: "记与翻",
        body: "模型认为值得留存的，以一句记入；新话题中用得着时再行翻检。行迹里「记入」「翻记忆」以一抹冷色标示。"
      },
      {
        h: "改与忘",
        body: "设置 → 记忆中每条皆可修改、删除，亦可手记一条；整份记忆可以关闭。",
        noteLabel: "留意",
        note: "记忆的内容不入系统提示，只告知模型现有几条；用到时方才翻阅。"
      }
    ]
  },
  {
    id: "storage",
    title: "存储备份",
    lead: "存储所在，迁移与备份",
    summary: "对话、卷宗、附件与配置同在一个存储目录，复制即是备份。",
    steps: [
      {
        h: "所在",
        body: "默认为 `~/.yan/`：`对话/` 一段一个文件，`卷宗/` 收成品与存入的文件，`附件/` 存附件原件，`配置.json` 记设置与模型。数个浏览器共用这一份。"
      },
      {
        h: "迁移",
        body: "设置 → 通用 → 存储位置，填一目录，整份拷至其下，旧处原样保留。",
        note: "环境不随之迁移，至新处重新准备一遍即可。"
      },
      {
        h: "备份",
        body: "设置 → 通用中导出备份（可含附件原件）；导入时按 id 合并，已有者略过。备份不含 API Key。"
      }
    ]
  }
];
/** @type {string|null} 正看的那一篇；空即目录 */
let guideTopic = null;
const guideText = text =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
function guideSettingsHtml() {
  const index = GUIDE.findIndex(topic => topic.id === guideTopic);
  if (index < 0)
    return `<div id="guidePage"><h2>文档</h2><p class="settings-lead">言的用法，一事一篇。</p><div class="guide-toc">${GUIDE.map(
      (topic, i) =>
        `<button type="button" class="guide-row" data-guide="${topic.id}"><span class="guide-juan">卷${chineseNumber(i + 1)}</span><span class="guide-title">${escapeHtml(topic.title)}</span><span class="guide-lead-line" aria-hidden="true"></span><span class="guide-gist">${escapeHtml(topic.lead)}</span></button>`
    ).join("")}</div></div>`;
  const topic = GUIDE[index],
    prev = GUIDE[index - 1],
    next = GUIDE[index + 1];
  return `<div id="guidePage" class="guide-doc"><div class="guide-top"><button type="button" class="guide-back" data-guide="">‹ 目录</button><span>·</span><span>卷${chineseNumber(index + 1)} · ${escapeHtml(topic.title)}</span><span class="guide-fish" aria-hidden="true">◆ 言 · 文档</span></div><h2>${escapeHtml(topic.lead)}</h2><p class="guide-summary">${guideText(topic.summary)}</p><div class="guide-steps">${topic.steps
    .map(
      (step, i) =>
        `<section class="guide-step"><div class="guide-main"><h4><span class="guide-no" aria-hidden="true">${chineseNumber(i + 1)}</span>${escapeHtml(step.h)}</h4><p>${guideText(step.body)}</p></div>${
          step.note ? `<aside class="guide-note"><b>${escapeHtml(step.noteLabel || "眉批")}</b>${guideText(step.note)}</aside>` : ""
        }</section>`
    )
    .join(
      ""
    )}</div><div class="guide-pager">${prev ? `<button type="button" data-guide="${prev.id}">‹ 卷${chineseNumber(index)} · ${escapeHtml(prev.title)}</button>` : "<span></span>"}${next ? `<button type="button" data-guide="${next.id}">卷${chineseNumber(index + 2)} · ${escapeHtml(next.title)} ›</button>` : "<span></span>"}</div></div>`;
}
function bindGuideEvents() {
  if (settingsTab !== "guide") return;
  $("#guidePage").addEventListener("click", event => {
    const target = /** @type {HTMLElement} */ (event.target).closest("[data-guide]");
    if (!target) return;
    guideTopic = target.dataset.guide || null;
    renderSettings();
    $("#settingsContent").scrollTop = 0;
  });
}

  // ---- 24-groups.js ----
// 言 · 分组：自立的几组，像 Claude 的 project——相关的对话聚在一处，不至散落。
// 侧栏有两处：历史里与「工」组一样按时间排（印文是「集」，组首「＋」在此组另起一段、「⋯」改名 / 设置 / 解散；对话拖到组上即移入、拖到组外即移出），
// 以及「翻页」「卷宗」之下的「分组」入口——进去是分组页：列出各组，点开一组可改名、择预设、定默认目录、看组里的对话（可移出）、解散。
// 组能带的两样都只管新起的对话：预设（提示词、工具、模型、权限一并换上）与默认目录（绑上即为行）。
// 组里的对话置顶，只在组内排到最前，不跳出组去
/** @type {string|null} 侧栏里正在改名的那一组 */
let renamingGroupId = null;
/** @type {string|null} 分组页上点开的那一组；空即列表 */
let groupPageId = null;

/** @returns {{ id: string, name: string, createdAt: string, presetId: string, workdir: string }[]} */
function groupsList() {
  return store.settings.groups;
}
/** @param {Conversation|null} c */
function groupOf(c) {
  return (c?.groupId && groupsList().find(group => group.id === c.groupId)) || null;
}
function pendingGroup() {
  return groupsList().find(group => group.id === store.settings.pendingGroupId) || null;
}
function groupMembers(id) {
  return store.conversations
    .filter(c => c.groupId === id)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}
function createGroup(name = "新分组") {
  const group = { id: uid(), name, createdAt: now(), presetId: "", workdir: "" };
  groupsList().push(group);
  saveStore();
  return group;
}
/** @param {Conversation} c @param {string} groupId 空即移出 */
function moveToGroup(c, groupId) {
  c.groupId = groupId;
  markDirty(c.id);
  saveStore();
  renderHistory();
  renderGroupTags();
  if (view === "groups") renderGroupsPage();
}
// 在此组另起一段：新对话归进这一组；组带了预设的，模型菜单先换上（预设带模型的连模型一起）
function newChatInGroup(id) {
  store.settings.pendingGroupId = id;
  const preset = presetOf(null);
  if (preset?.profileId && profiles().some(p => p.id === preset.profileId)) selectProfile(preset.profileId, false);
  saveStore();
  newChat();
}
function startGroupRename(id) {
  renamingGroupId = id;
  renderHistory();
  const input = /** @type {HTMLInputElement|null} */ ($("#history .group-rename"));
  input?.focus();
  input?.select();
}
function renameGroup(id, value) {
  const group = groupsList().find(item => item.id === id),
    name = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  if (!group || !name || name === group.name) return;
  group.name = name;
  saveStore();
  renderGroupTags();
}
function commitGroupRename(value) {
  const id = renamingGroupId;
  renamingGroupId = null;
  renameGroup(id, value);
  renderHistory();
}
async function dissolveGroup(id) {
  const group = groupsList().find(item => item.id === id);
  if (!group) return;
  const members = groupMembers(id);
  if (
    !(await askConfirm({
      title: `解散分组「${group.name}」？`,
      body: members.length ? `组里的 ${members.length} 段对话退回散列，不会删除。` : "此组尚无对话。",
      ok: "解散"
    }))
  )
    return;
  store.settings.groups = groupsList().filter(item => item !== group);
  for (const c of members) {
    c.groupId = "";
    markDirty(c.id);
  }
  if (store.settings.pendingGroupId === id) delete store.settings.pendingGroupId;
  if (groupPageId === id) groupPageId = null;
  saveStore();
  renderHistory();
  renderGroupTags();
  if (view === "groups") renderGroupsPage();
}
// 组首「⋯」：改名、打开组的设置（分组页里这一组）、解散；在此组新建已有「＋」，不再列
/** @param {string} id @param {Element} anchor */
function openGroupMenu(id, anchor) {
  if (document.querySelector(`.chip-pop[data-kind=group][data-for="${CSS.escape(id)}"]`)) return closeChipPop();
  const pop = openFloatingPop(
    anchor,
    `<button type="button" data-group-act="rename">改名</button><button type="button" data-group-act="settings">设置</button><button type="button" class="danger" data-group-act="dissolve">解散</button>`,
    { align: "right" }
  );
  pop.dataset.kind = "group";
  pop.dataset.for = id;
  pop.addEventListener("click", event => {
    const button = /** @type {HTMLElement} */ (event.target).closest("[data-group-act]");
    if (!button) return;
    closeChipPop();
    const act = button.dataset.groupAct;
    if (act === "rename") startGroupRename(id);
    else if (act === "settings") openGroupsPage(id);
    else void dissolveGroup(id);
  });
}
// 对话「⋯」里的「移入分组」：列出各组，另有新建一组与移出
/** @param {Conversation} c @param {Element} anchor */
function openMoveMenu(c, anchor) {
  const current = groupOf(c);
  const pop = openFloatingPop(
    anchor,
    `${groupsList()
      .map(
        group =>
          `<button type="button" data-move="${escapeHtml(group.id)}"${group === current ? ' class="active" disabled' : ""}>${escapeHtml(group.name)}</button>`
      )
      .join(
        ""
      )}<button type="button" data-move="__new">新建分组…</button>${current ? `<button type="button" data-move="">移出「${escapeHtml(current.name)}」</button>` : ""}`,
    { align: "right" }
  );
  pop.dataset.kind = "group-move";
  pop.addEventListener("click", event => {
    const button = /** @type {HTMLElement} */ (event.target).closest("[data-move]");
    if (!button) return;
    closeChipPop();
    const target = button.dataset.move;
    if (target === "__new") {
      const group = createGroup();
      moveToGroup(c, group.id);
      startGroupRename(group.id);
    } else moveToGroup(c, target);
  });
}

// ---------- 输入框左下「＋」旁的分组签：欢迎页是待归的那一组（可撤），对话页是这段对话所在的组（点开分组页） ----------
function renderGroupTags() {
  const pending = pendingGroup(),
    own = groupOf(currentConversation());
  for (const [tag, group] of [
    [$("#welcomeGroup"), pending],
    [$("#chatGroup"), own]
  ]) {
    tag.classList.toggle("hidden", !group);
    tag.querySelector(".group-tag-name").textContent = group?.name || "";
  }
}

// ---------- 分组页 ----------
function openGroupsPage(id = null) {
  closeSidePanel();
  persistDraft();
  rememberScrollPosition();
  groupPageId = id;
  view = "groups";
  render();
  if (isMobile()) toggleSidebar(true);
}
function closeGroupsPage() {
  view = "chat";
  render();
}
function renderGroupsCount() {
  $("#groupsCount").textContent = groupsList().length ? String(groupsList().length) : "";
}
function renderGroupsPage() {
  renderGroupsCount();
  const group = groupsList().find(item => item.id === groupPageId);
  $("#groups").innerHTML = `<div class="library-inner">${group ? groupDetailHtml(group) : groupListHtml()}</div>`;
}
const lastTouched = members => members.reduce((latest, c) => (c.updatedAt > latest ? c.updatedAt : latest), "");
function groupListHtml() {
  const groups = [...groupsList()].sort((a, b) =>
    (lastTouched(groupMembers(b.id)) || b.createdAt).localeCompare(lastTouched(groupMembers(a.id)) || a.createdAt)
  );
  return `<div class="eyebrow"><span class="seal">集</span><span>GROUPS</span></div><h1>分组</h1><p class="library-lead">相关的对话聚为一组，不至散落。组可带一个预设与一个默认目录，组里新起的对话皆依此。</p><div class="library-tools"><button id="groupsAdd" class="outline-btn" type="button">＋ 新建分组</button></div>${
    groups.length
      ? `<div class="group-toc">${groups
          .map(group => {
            const members = groupMembers(group.id),
              preset = store.settings.presets.find(item => item.id === group.presetId),
              touched = lastTouched(members),
              gist = [
                `${members.length} 段`,
                touched ? `${formatDay(touched)}动笔` : "",
                preset ? `预设 ${preset.name}` : "",
                group.workdir ? `目录 ${pathTail(group.workdir)}` : ""
              ]
                .filter(Boolean)
                .join(" · ");
            return `<button type="button" class="group-row" data-group-page="${escapeHtml(group.id)}"><span class="repo-seal" aria-hidden="true">集</span><span class="group-row-name">${escapeHtml(group.name)}</span><span class="guide-lead-line" aria-hidden="true"></span><span class="group-row-gist">${escapeHtml(gist)}</span></button>`;
          })
          .join("")}</div>`
      : `<p class="card-note">尚无分组。对话「⋯」里的「移入分组」也可就地新建。</p>`
  }`;
}
/** @param {ReturnType<typeof groupsList>[number]} group */
function groupDetailHtml(group) {
  const members = groupMembers(group.id),
    presets = store.settings.presets;
  return `<div class="guide-top"><button type="button" class="guide-back" data-group-page="">‹ 分组</button></div><div class="group-title"><span class="repo-seal" aria-hidden="true">集</span><input id="groupName" class="group-name-field" value="${escapeHtml(group.name)}" maxlength="40" spellcheck="false" aria-label="组名"></div><p class="library-lead">${members.length ? `${members.length} 段对话` : "此组尚无对话"}；以下两样只管组里新起的对话。</p><div class="group-settings"><div class="setting-row"><div class="setting-copy"><strong>预设</strong><small>组里新起的对话用它：提示词、工具、模型与权限一并换上。${presets.length ? "" : "尚无预设，可在设置 → 预设里新添"}</small></div><select id="groupPreset" class="field select"><option value="">本色（不带预设）</option>${presets
    .map(
      preset =>
        `<option value="${escapeHtml(preset.id)}"${preset.id === group.presetId ? " selected" : ""}>${escapeHtml(preset.name)}</option>`
    )
    .join(
      ""
    )}</select></div><div class="setting-row"><div class="setting-copy"><strong>默认目录</strong><small>组里新起的对话绑上此目录，即为行；留空则为言</small></div><div class="setting-actions setting-directory"><input id="groupWorkdir" class="field" spellcheck="false" autocomplete="off" placeholder="不绑目录" value="${escapeHtml(group.workdir)}"><button id="groupWorkdirPick" class="outline-btn" type="button">选择…</button></div></div></div><div class="group-actions"><button id="groupNewChat" class="outline-btn" type="button">在此组新建</button><button id="groupDissolve" class="danger-btn" type="button">解散</button></div><h3 class="settings-sub">组里的对话</h3>${
    members.length
      ? `<div class="group-toc">${members
          .map(
            c =>
              `<div class="group-member"><button type="button" class="group-row" data-group-chat="${escapeHtml(c.id)}">${c.pinned ? `<span class="group-pin" title="组内置顶" aria-label="组内置顶"></span>` : ""}<span class="group-row-name">${escapeHtml(c.title)}</span><span class="guide-lead-line" aria-hidden="true"></span><span class="group-row-gist">${escapeHtml(formatDay(c.updatedAt))}</span></button><button type="button" class="group-member-out" data-group-out="${escapeHtml(c.id)}" title="移出此组，退回散列">移出</button></div>`
          )
          .join("")}</div>`
      : `<p class="card-note">对话「⋯」里的「移入分组」可把已有的对话移进来。</p>`
  }`;
}
// 分组页上的点击与改动：一个委托，页面每画一回都还在
$("#groups").addEventListener("click", async event => {
  const target = /** @type {HTMLElement} */ (event.target);
  const page = target.closest("[data-group-page]");
  if (page) {
    groupPageId = page.dataset.groupPage || null;
    renderGroupsPage();
    return void ($("#groups").scrollTop = 0);
  }
  const out = target.closest("[data-group-out]");
  if (out) {
    const c = store.conversations.find(item => item.id === out.dataset.groupOut);
    return void (c && moveToGroup(c, ""));
  }
  const chat = target.closest("[data-group-chat]");
  if (chat) return openConversation(chat.dataset.groupChat);
  if (target.closest("#groupsAdd")) {
    const group = createGroup();
    groupPageId = group.id;
    renderHistory();
    renderGroupsPage();
    return /** @type {HTMLInputElement} */ ($("#groupName")).select();
  }
  if (target.closest("#groupNewChat")) return newChatInGroup(groupPageId);
  if (target.closest("#groupDissolve")) return dissolveGroup(groupPageId);
  const pick = /** @type {HTMLButtonElement|null} */ (target.closest("#groupWorkdirPick"));
  if (pick) {
    pick.disabled = true;
    pick.textContent = "选择中…";
    try {
      const input = /** @type {HTMLInputElement} */ ($("#groupWorkdir"));
      const data = await bridge("/api/work/pick", { current: input.value.trim() }, AbortSignal.timeout(300000));
      if (data.path) {
        input.value = data.path;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      pick.disabled = false;
      pick.textContent = "选择…";
    }
  }
});
$("#groups").addEventListener("change", event => {
  const el = /** @type {HTMLInputElement} */ (event.target),
    group = groupsList().find(item => item.id === groupPageId);
  if (!group) return;
  if (el.id === "groupName") {
    renameGroup(group.id, el.value);
    return renderHistory();
  }
  if (el.id === "groupPreset") group.presetId = el.value;
  if (el.id === "groupWorkdir") group.workdir = el.value.trim();
  saveStore();
  renderGroupsPage();
});
$("#groups").addEventListener("keydown", event => {
  if (/** @type {HTMLElement} */ (event.target).id === "groupName" && event.key === "Enter")
    /** @type {HTMLInputElement} */ (event.target).blur();
});

// ---------- 侧栏历史里的分组：收起 / 展开、组首「＋」、双击改名 ----------
$("#history").addEventListener("click", event => {
  const target = /** @type {HTMLElement} */ (event.target);
  const toggle = target.closest("[data-group-toggle]");
  if (toggle && !target.closest(".group-rename")) {
    const key = `group:${toggle.dataset.groupToggle}`,
      set = new Set(store.settings.collapsedRepos || []);
    set.has(key) ? set.delete(key) : set.add(key);
    store.settings.collapsedRepos = [...set];
    saveStoreSoon();
    return renderHistory();
  }
  const add = target.closest("[data-group-new]");
  if (add) return newChatInGroup(add.dataset.groupNew);
  const more = target.closest("[data-group-menu]");
  if (more) {
    event.stopPropagation();
    openGroupMenu(more.dataset.groupMenu, more);
  }
});
// 拖放：对话拖到一组上（组首或组里任一条）即移入那组，拖到组外即移出；拖着经过的组首提亮。只认侧栏里拖起的对话
const CHAT_DRAG = "application/x-yan-chat";
/** @param {DragEvent} event */
const dropGroupOf = event =>
  /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".history-repo-group.is-set"));
const clearDropMarks = () => document.querySelectorAll("#history .drop-into").forEach(node => node.classList.remove("drop-into"));
$("#history").addEventListener("dragstart", event => {
  const item = /** @type {HTMLElement} */ (event.target).closest?.("[data-conversation][draggable]");
  if (!item) return;
  event.dataTransfer.setData(CHAT_DRAG, item.dataset.conversation);
  event.dataTransfer.effectAllowed = "move";
  item.classList.add("dragging");
});
$("#history").addEventListener("dragover", event => {
  if (!Array.from(event.dataTransfer?.types || []).includes(CHAT_DRAG)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const group = dropGroupOf(event);
  if (group?.classList.contains("drop-into")) return;
  clearDropMarks();
  group?.classList.add("drop-into");
});
$("#history").addEventListener("dragleave", event => {
  if (!$("#history").contains(/** @type {Node|null} */ (event.relatedTarget))) clearDropMarks();
});
$("#history").addEventListener("drop", event => {
  const id = event.dataTransfer?.getData(CHAT_DRAG);
  if (!id) return;
  event.preventDefault();
  clearDropMarks();
  const c = store.conversations.find(item => item.id === id),
    target = dropGroupOf(event)?.dataset.group || "";
  if (!c || (c.groupId || "") === target) return;
  moveToGroup(c, target);
  toast(target ? `移入「${groupsList().find(group => group.id === target)?.name}」` : "已移出分组");
});
$("#history").addEventListener("dragend", () => {
  clearDropMarks();
  document.querySelectorAll("#history .dragging").forEach(node => node.classList.remove("dragging"));
});
$("#history").addEventListener("dblclick", event => {
  const toggle = /** @type {HTMLElement} */ (event.target).closest("[data-group-toggle]");
  if (toggle && !renamingGroupId) startGroupRename(toggle.dataset.groupToggle);
});
$("#history").addEventListener("keydown", event => {
  const input = /** @type {HTMLInputElement} */ (event.target);
  // 组首是 div（改名时里面要放输入框，按钮里放不得）：回车与空格照按钮开合
  if (input.dataset?.groupToggle !== undefined && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    return input.click();
  }
  if (!input.classList?.contains("group-rename")) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commitGroupRename(input.value);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    renamingGroupId = null;
    renderHistory();
  }
});
$("#history").addEventListener(
  "blur",
  event => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.classList?.contains("group-rename") && renamingGroupId) commitGroupRename(input.value);
  },
  true
);

  // ---- 99-start.js ----
// 言 · 启动
boot();
})();
