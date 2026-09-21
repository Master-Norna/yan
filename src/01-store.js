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
// 启动时以 IndexedDB 为主；旧版 localStorage、显式写入的无标记数据，以及同版或较新的完整镜像优先一次并迁入。
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
    (!local.managed || !record || (!local.dbOnly && Number(local.revision || 0) >= Number(record.revision || 0)));
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
