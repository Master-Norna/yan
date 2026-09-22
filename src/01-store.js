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
      conversations: (Array.isArray(data.conversations) ? data.conversations : []).map(normalizeConversation),
      library: Array.isArray(data.library) ? data.library : [],
      drafts: normalizeDrafts(data.drafts),
      memory: normalizeMemory(data.memory)
    };
  } catch {
    return structuredClone(defaultStore);
  }
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
// ---------- 记录怎么存 ----------
// 记录分两半。「配置」（设置、模型、浏览器内卷宗、记忆、草稿）小而常改，整份存在 localStorage，桥接在线时另镜像一份到对话目录
// （设置.json，不含 API Key），换浏览器、清了站点数据后开页可从它恢复。
// 「对话」各自一份：桥接在线时落在本机的对话目录（bootstrap.work.chats，一段一个 JSON 文件，像卷宗一样是个普通目录，复制即备份）；
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
function writeMeta() {
  const json = JSON.stringify({
    ...metaOf(),
    [STORAGE_META_KEY]: { revision: nextMetaRevision(), split: true, pendingDeletes: [...pendingChatDeletes] }
  });
  try {
    localStorage.setItem(STORAGE_KEY, json);
    metaSaveWarned = false;
  } catch {
    if (!metaSaveWarned) {
      metaSaveWarned = true;
      toast("设置未能存下（浏览器存储已满），请先导出备份");
    }
  }
  scheduleMetaMirror();
}
// 设置镜像到对话目录：不带 API Key（与导出备份同一规矩），改动后两秒内写一次
function metaForDisk() {
  const meta = metaOf();
  return { ...meta, profiles: meta.profiles.map(({ apiKey, ...rest }) => rest) };
}
function scheduleMetaMirror() {
  if (!chatsOnline()) return;
  clearTimeout(metaMirrorTimer);
  metaMirrorTimer = setTimeout(writeMetaMirror, 2000);
}
function writeMetaMirror() {
  clearTimeout(metaMirrorTimer);
  metaMirrorTimer = null;
  if (!chatsOnline()) return;
  const body = JSON.stringify({ meta: metaForDisk() });
  // 页面要关时用 keepalive 送出去（浏览器只给它 64 KB 的余地；配置一般远小于此，超了就随它去，下次开页再镜像）
  fetch(`${apiBase}/api/chats/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: unloading && body.length < 60000,
    signal: unloading ? undefined : AbortSignal.timeout(20000)
  }).catch(() => {});
}
// 对话目录可用：桥接在线、桥接报了目录、上次读它没出错
function chatsOnline() {
  return apiBase !== null && !!bootstrap.work?.chats && !chatsBroken;
}
function chatsDir() {
  return chatsOnline() ? bootstrap.work.chats : "";
}
// 标记这段对话有改动（改名、置顶、后台一答收尾这些不在「当前对话」上的改动要亲手标；当前这段与正在生成的自动算在内）
function markDirty(id) {
  if (id) dirtyChatIds.add(id);
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
    if (deletedChatIds.has(id) || !store.conversations.some(item => item.id === id)) continue;
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
    const interval = conversationRunning(id) || titlingIds.has(id) || compactingIds.has(id) ? CHAT_STREAM_DISK_INTERVAL : CHAT_DISK_INTERVAL,
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
        await bridge("/api/chats/save", { savedAt: pending.savedAt, conversation: JSON.parse(pending.json) }, AbortSignal.timeout(60000));
        chatSaveWarned = false;
        if (!deletedChatIds.has(id)) {
          persisted = true;
          // pagehide 已把最新状态写进表时，旧的在途请求即使成功也不能把那份离页兜底删掉。
          if (!unloading && !pendingChatWrites.has(id))
            await stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.delete(id)).catch(() => {});
        }
      } catch (error) {
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
      await bridge("/api/chats/delete", { id }, AbortSignal.timeout(20000));
      pendingChatDeletes.delete(id);
      writeMeta();
    } catch {}
  } finally {
    chatHashes.delete(id);
    chatStamps.delete(id);
    deletedChatIds.delete(id);
  }
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
  writeMeta();
  if (metaMirrorTimer) writeMetaMirror();
  const db = stateDb;
  if (!db) return;
  const records = [];
  for (const conversation of store.conversations) {
    if (deletedChatIds.has(conversation.id)) continue;
    const json = JSON.stringify(conversation),
      hash = hashText(json);
    if (!pendingChatWrites.has(conversation.id) && !activeChatWrites.has(conversation.id) && chatHashes.get(conversation.id) === hash) continue;
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
  for (const id of local?.pendingDeletes || []) pendingChatDeletes.add(id);
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
    const localWins = !!local && (!local.managed || !legacy || (!local.dbOnly && Number(local.revision || 0) >= Number(legacy.revision || 0)));
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
// 目录里没有的推过去，目录里更新的换进来（正在生成的、改了还没存的不换），两边一样的把表里的暂存清掉；先前没删成的补删；
// 全新的浏览器（localStorage 空着）从设置镜像里把配置捡回来
async function syncChatsWithDisk() {
  if (apiBase === null || !bootstrap.work?.chats || chatsSyncing) return;
  chatsSyncing = true;
  try {
    const data = await bridge("/api/chats/load", {}, AbortSignal.timeout(120000));
    chatsBroken = false;
    if (data.dir) bootstrap.work.chats = data.dir;
    for (const id of [...pendingChatDeletes]) {
      // 当前页刚删、却还有旧保存正在收尾的，由 deleteConversationStorage 等完后亲自再删；这里抢先删会留下 save-after-delete 的窗口。
      if (deletedChatIds.has(id)) continue;
      try {
        await bridge("/api/chats/delete", { id }, AbortSignal.timeout(20000));
        pendingChatDeletes.delete(id);
      } catch {}
    }
    const disk = new Map();
    for (const item of data.items || []) if (item?.id && !pendingChatDeletes.has(item.id)) disk.set(item.id, item);
    const push = new Set(),
      settled = new Set();
    let changed = false,
      currentReplaced = false;
    store.conversations = store.conversations.map(c => {
      const item = disk.get(c.id),
        stamp = chatStamps.get(c.id) || 0,
        hash = hashText(JSON.stringify(c)),
        unsaved = chatHashes.get(c.id) !== hash,
        busy = conversationRunning(c.id) || titlingIds.has(c.id) || compactingIds.has(c.id);
      if (!item) {
        push.add(c.id);
        return c;
      }
      if (item.savedAt > stamp && !unsaved && !busy) {
        const next = normalizeConversation(item.conversation);
        chatStamps.set(c.id, item.savedAt);
        chatHashes.set(c.id, hashText(JSON.stringify(next)));
        settled.add(c.id);
        changed = true;
        if (c.id === currentId) currentReplaced = true;
        return next;
      }
      if (item.savedAt < stamp || unsaved || hashText(JSON.stringify(normalizeConversation(item.conversation))) !== hash) push.add(c.id);
      else settled.add(c.id);
      return c;
    });
    const known = new Set(store.conversations.map(c => c.id));
    for (const item of disk.values())
      if (!known.has(item.id)) {
        const c = normalizeConversation(item.conversation);
        chatStamps.set(c.id, item.savedAt);
        chatHashes.set(c.id, hashText(JSON.stringify(c)));
        store.conversations.push(c);
        settled.add(c.id);
        changed = true;
      }
    for (const id of settled) void stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.delete(id)).catch(() => {});
    if (push.size) flushConversations(push, { force: true });
    if (freshBrowser && data.meta && typeof data.meta === "object") {
      freshBrowser = false;
      const meta = normalizeStoreData({ ...data.meta, conversations: [] });
      store.settings = { ...meta.settings, activeProfileId: store.settings.activeProfileId || meta.settings.activeProfileId };
      store.profiles = meta.profiles;
      store.library = meta.library;
      store.memory = meta.memory;
      store.drafts = meta.drafts;
      if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
      applyAppearance();
      changed = true;
    }
    writeMeta();
    if (changed) {
      renderHeader();
      renderHistory();
      if (currentReplaced && view === "chat") renderConversation(false);
      if (currentId && !known.has(currentId) && !store.conversations.some(c => c.id === currentId)) {
        currentId = null;
        render();
      }
    }
  } catch (error) {
    chatsBroken = true;
    toast(`对话目录不可用，先存在浏览器里：${String(error.message || error).slice(0, 60)}`);
  } finally {
    chatsSyncing = false;
  }
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
