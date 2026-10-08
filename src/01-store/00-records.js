// 言 · 本地存储 · 记录：结构迁移、各类数据的规整
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 言 · 常量、内置提示词取值、运行期状态
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 数据模型（JSDoc，供 tsc --checkJs 与编辑器；见 src/types.d.ts 的说明）----------
// 存下来的东西只有这几种：Store 里挂着设置、模型、对话、记忆与草稿；对话里是消息，消息上挂步骤，步骤上可挂帮手
/**
 * @typedef {Object} Attachment 附件的元数据；原件（data）另存存储根的 附件/（落盘不成时暂存 IndexedDB），只在读出时才带
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
 * @property {boolean} [quoted] 随引文的画面（游目圈点）：不进附件栏，画在引文里；引文撤了它跟着撤
 */
/** @typedef {{ text: string, messageId?: string, model?: string, url?: string, image?: string }} Quote 引用追问：划选的一段与它所在的消息（旁注锚文本作引文时没有 messageId）；游目圈点的另带给模型的一份与网址，image 是那幅画面的附件 id（附件照常随消息走，只是画在引文里） */
/** @typedef {{ id: string, name: string, arguments: string }} ToolCall 流式拼出的一次工具调用 */
/** @typedef {{ prompt_tokens: number, completion_tokens: number, total_tokens: number, cached_tokens?: number }} Usage cached_tokens：提示里读自缓存的部分 */
/** @typedef {"ask"|"review"|"auto"} CommandPolicy 问而后行 / 审而后行 / 径行 */
/** @typedef {"running"|"pending"|"done"|"error"|"skipped"} StepStatus */
/** @typedef {{ question: string, header: string, multi: boolean, options: { label: string, description: string }[] }} AskQuestion */
/**
 * @typedef {Object} SubAgent 差遣出去的帮手的一趟：自己的一段对话，步骤画在派它的那一答的差遣卡片里
 * @property {string} id
 * @property {string} [helper] 同一名帮手的几趟（差遣与续派）认同一个，取头一趟的 id
 * @property {string} task
 * @property {string} content
 * @property {string} reasoning
 * @property {Step[]} steps
 * @property {"streaming"|"complete"|"stopped"|"error"} status
 * @property {Usage|null} usage
 * @property {boolean} [charged] 用量已记进派它的那一答（帮手收工时自己记、或那一答收尾时并入），另一边不再记
 * @property {string} [effort] 这一趟的思考档位（模型实际认的那一档）；没有即不带字段、由接口定
 * @property {{ thinking: string, signature: string }[]|null} [thinkingBlocks]
 * @property {string} [report] 最后一轮说的话，即交回主模型的回报
 * @property {number} [durationMs]
 * @property {number} [startedAt] 正在做时的起始时刻（毫秒），题头据此走用时；收工即删
 * @property {boolean} [waiting] 交过进展、睡着等自己挂的后台指令（醒来即删）
 * @property {Break[]} [breaks]
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
 * @property {{ id: string, key?: string, state: "running"|"done"|"stopped"|"lost" }} [bg] 后台指令的编号与此刻的样子：结束时叫醒模型（running 时页面在等它）
 * @property {{ old: string, new: string }} [diff]
 * @property {string} [written] write_file 写下的内容（过长只留开头），改动清单点开时看
 * @property {string} [previous] write_file 覆盖掉的原文（过长只留开头），与 written 比出红绿
 * @property {{ path: string, added: number, removed: number, created?: boolean, lines?: number }} [change] lines：这一步之后这件的行数
 * @property {number} [at] 调用发起时正文的长度（时间线分组、思绪按轮切分都靠它）
 * @property {number} [rat] 调用发起时思绪的长度
 * @property {string} [scope] 帮手的步骤记它所属的帮手 id
 * @property {string} [root] 读、写、改文件时落在哪个目录（换了目录，先前读过的不算数）
 * @property {Attachment[]} [attachments] 补言（user_note）随带的附件
 * @property {boolean} [cached] 结果是复用的
 * @property {boolean} [skipped]
 * @property {boolean} [expanded] 输出摊开 / 折起；未记则按状态定（报错折起）
 * @property {boolean} [full] 输出看全 / 只看前 10 行
 * @property {boolean} [folded] 差遣卡片整张折起
 * @property {SubAgent} [sub]
 * @property {"tell"|"resume"|"stop"} [mode] 传话一步做的是哪样：递话、续派、叫停
 * @property {string} [ref] 传话、叫停说到的那一趟（步骤 id）
 * @property {string} [noteId] 传话递去的那句话在帮手时间线里的步骤 id
 * @property {{ step: string, title: string, ok: boolean, kind?: "bg", exitCode?: number }} [relay] 作答途中回来的回报（relay_note）是谁
 * @property {{ questions: AskQuestion[] }} [form]
 * @property {string[]} [answers]
 * @property {string} [conversationId] 翻旧谈
 * @property {string} [date]
 */
/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {"user"|"assistant"|"context"} role context 是上下文分隔：带 summary 的是压缩，不带的是旧版硬切
 * @property {{ step: string, title: string, ok: boolean, kind?: "bg", exitCode?: number }[]} [relay] 帮手的回报（或后台指令结束）另起的一问：谁回来了（内容是回报原文，只送给模型）
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
 * @property {Break[]} [breaks]
 * @property {number} [durationMs]
 * @property {number} [startedAt] 正在作答时的起始时刻（毫秒），行迹题头据此走用时；收尾即删
 * @property {{ path: string, name: string, size: number }[]} [deliverables] 言里这一答做出的成品
 * @property {boolean} [toolsOpen]
 * @property {boolean} [toolsTouched]
 * @property {boolean} [reasoningOpen]
 * @property {boolean} [reasoningTouched]
 * @property {string} [summary] 压缩分隔上的摘要
 * @property {number} [compacted] 压进摘要的条数
 * @property {boolean} [compacting]
 */
/** @typedef {{ at: string, why: string, auto?: boolean }} Break 途中断过的一回：何时、为何；auto 是自动接着写上了的。续写不清，查「为何总断」时翻它 */
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
 * @property {boolean} [titleAuto]
 * @property {boolean} [titled]
 * @property {number} [titleTries]
 * @property {boolean} [showCompacted]
 * @property {{ report: string, relay: { step: string, title: string, ok: boolean, kind?: "bg", exitCode?: number } }[]} [heldReports] 上一答断着时回来的回报，下一答开工时递上
 */
/**
 * @typedef {Object} Profile 一份模型配置
 * @property {string} id
 * @property {string} name
 * @property {string} model
 * @property {string} [baseUrl]
 * @property {string} [apiKey]
 * @property {"openai"|"anthropic"|"chatgpt"} [api] 接口类型；没写按地址认（anthropic.com）；chatgpt 是在浏览器里登录的 ChatGPT 订阅
 * @property {number} [temperature] 留空即不传，由接口定
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
/** @typedef {{ id: string, text: string, category?: string, createdAt: string, updatedAt: string, source: { conversationId: string, title: string }|null }} MemoryItem */
/** @typedef {{ text: string, attachments: Attachment[], quote?: Quote|null, updatedAt?: string }} Draft */
/**
 * @typedef {Object} Settings
 * @property {string} name
 * @property {"light"|"dark"|"system"} theme
 * @property {"on"|"off"|"system"} inkMotion
 * @property {"sans"|"serif"|"mixed"|"kai"|"fangsong"} font
 * @property {string} accent
 * @property {string} activeProfileId 默认模型：新对话起手用它；只在设置里「设为默认」时改，打开旧对话、在菜单里换模型都不动它
 * @property {Preset[]} presets
 * @property {string} presetId 新对话用的预设（上回选的）；空即本色
 * @property {{ id: string, name: string, createdAt: string, presetId: string, workdir: string }[]} groups 分组：自立的几组，对话各记 groupId；组里新起的对话用组的预设、绑组的默认目录
 * @property {string} [pendingGroupId] 从组首「＋」另起的新对话归进这一组（用过即清）
 * @property {boolean} autoTitle
 * @property {string} [pendingWorkdir] 欢迎页目录签里待绑的目录
 * @property {string[]} collapsedRepos
 * @property {CommandPolicy} commandPolicyDefault 新对话默认的指令权限模式
 * @property {boolean} [sandbox] 沙箱总开关（默认开）：桥接那头筛指令、锁目录、去机密环境变量
 * @property {"anywhere"|"inside"} toolReach
 * @property {{ enabled?: boolean, browser?: "msedge"|"chrome"|"chromium" }} [stage] 游目自己的浏览器（设置 → 游目）：开没开、用哪个；家当都在存储根/游目
 * @property {boolean} [stageFit] 游目「适应页面」：执事定死的视口等它歇手后放开（默认开）
 * @property {"bing"|"baidu"|"google"} [stageSearch] 游目地址栏里输的不像网址时交给哪家搜（默认必应）
 * @property {boolean} archiveRead
 * @property {number} toolRounds
 * @property {number} subRounds
 * @property {"chat"|"library"|"groups"} [lastView] 上次停在哪一页，刷新后回到原处
 * @property {string} [lastConversationId]
 * @property {{ packs: string[], pip: string, npm: string }} env 沙箱环境：选了哪几组工具、另装的包（下载源不让人选，桥接准备时自己比，见 server/mirror.js）
 * @property {Record<string, Record<string, any>>} mcpServers 接入的 MCP 服务，照通行的 mcpServers 写法：{ 名字: { command, args, cwd, env } 或 { url, headers, type } }
 */
/**
 * @typedef {Object} Store 整个本地存储（主体在 IndexedDB；localStorage 只留启动镜像）
 * @property {number} version
 * @property {Settings} settings
 * @property {Profile[]} profiles
 * @property {Conversation[]} conversations
 * @property {{ enabled: boolean, items: MemoryItem[] }} memory
 * @property {Record<string, Draft>} drafts
 */
const STORAGE_KEY = "yan-chat-v1";
const STORAGE_META_KEY = "__yanStorage";
const STORE_VERSION = 6;
const NEW_DRAFT_ID = "__new__";
/** @type {Store} */
const defaultStore = {
  version: STORE_VERSION,
  settings: {
    name: "访客",
    theme: "light",
    inkMotion: "on",
    font: "mixed",
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
    toolReach: "anywhere",
    archiveRead: true,
    toolRounds: DEFAULT_TOOL_ROUNDS,
    subRounds: DEFAULT_SUB_ROUNDS,
    mcpServers: {},
    env: { packs: ["data", "office", "web"], pip: "", npm: "" }
  },
  profiles: [],
  conversations: [],
  memory: { enabled: true, items: [] },
  drafts: {}
};
// 结构迁移：缺的字段由下面的规整补上，这里只管「同一个字段换了意思」的那几回。
// 2026-10-01 断旧：v5 之前的几步（草稿、分叉、权限三档、全局思考档位、模型上的 system prompt）都已迁完多时，不再随带。
// v6：温度改为留空即不传、由接口定——此前新接入的模型都写着默认的 0.7，这一回清掉；亲手填了别的数的照留
function migrateStore(data) {
  if (data.version < 6) for (const p of Array.isArray(data.profiles) ? data.profiles : []) if (p?.temperature === 0.7) delete p.temperature;
  data.version = STORE_VERSION;
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
    migrateStore(data);
    // 不再有的东西：浏览器内的旧卷宗、旧版的对话 / 卷宗目录（都已迁进存储根）
    delete data.library;
    const settings = { ...defaultStore.settings, ...(data.settings || {}) };
    delete settings.chatsDir;
    delete settings.archiveDir;
    delete settings.reasoning;
    delete settings.workAutoDefault;
    // mirror：早先页面上可选下载源，现由桥接自己比，旧存档里的这一项丢掉
    const { mirror: _mirror, ...env } = settings.env && typeof settings.env === "object" ? settings.env : {};
    settings.env = {
      ...defaultStore.settings.env,
      ...env,
      packs: Array.isArray(env.packs) ? [...new Set(env.packs.map(String))] : [...defaultStore.settings.env.packs],
      pip: String(env.pip || ""),
      npm: String(env.npm || "")
    };
    const profiles = (Array.isArray(data.profiles) ? data.profiles : [])
      .filter(p => p && typeof p === "object")
      .map(({ source, systemPrompt, ...p }) => ({
        ...p,
        // 借 Codex CLI 登录的「Codex 订阅」换成了官方登录的「ChatGPT 订阅」
        ...(p.api === "codex" ? { api: "chatgpt" } : {}),
        ...(p.reasoning !== undefined ? { reasoning: normalizeReasoning(p.reasoning) } : {})
      }));
    settings.presets = normalizePresets(settings.presets);
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
// 旧版留下的两个字段（ended 整段锁死、workAuto 径行开关）读到即去掉
function normalizeConversation({ ended, workAuto, ...c }) {
  return /** @type {Conversation} */ ({
    ...c,
    commandPolicy: normalizeCommandPolicy(c.commandPolicy),
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
    // 游目圈点的引文另带给模型的一份（model）与网址（url）：漏了，模型便不知道圈在哪、引文也回不到那一页
    quote:
      value.quote && typeof value.quote === "object" && value.quote.text
        ? {
            text: String(value.quote.text),
            messageId: String(value.quote.messageId || ""),
            ...(value.quote.model ? { model: String(value.quote.model) } : {}),
            ...(value.quote.url ? { url: String(value.quote.url) } : {}),
            ...(value.quote.image ? { image: String(value.quote.image) } : {})
          }
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
        category: String(item.category || ""),
        createdAt: item.createdAt || now(),
        updatedAt: item.updatedAt || item.createdAt || now(),
        source:
          item.source && typeof item.source === "object"
            ? { conversationId: item.source.conversationId || "", title: String(item.source.title || "") }
            : null
      }))
  };
}
