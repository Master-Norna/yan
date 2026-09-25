// 言 · 本地存储 · 记录：调桥接的口子、结构迁移、各类数据的规整
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 调本机桥接：存储、卷宗、工具都走这一个口子；桥接回的错误是一句话，原样抛出
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
