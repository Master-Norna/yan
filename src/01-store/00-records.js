// 言 · 本地存储 · 记录：结构迁移、各类数据的规整
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
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
