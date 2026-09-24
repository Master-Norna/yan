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
    const settings = { ...defaultStore.settings, ...(data.settings || {}) };
    const legacyReasoning = normalizeReasoning(settings.reasoning),
      rawProfiles = Array.isArray(data.profiles) ? data.profiles.filter(p => p && typeof p === "object") : [],
      legacyProfileId = data.settings?.activeProfileId || rawProfiles[0]?.id;
    delete settings.reasoning;
    return {
      ...structuredClone(defaultStore),
      ...data,
      settings,
      // 旧版把新对话档位存在全局设置里；仅归给当时选中的模型，不能让它跟着切到别的模型。
      profiles: rawProfiles.map(p => ({
        ...p,
        ...(p.reasoning !== undefined
          ? { reasoning: normalizeReasoning(p.reasoning) }
          : data.settings?.reasoning !== undefined && p.id === legacyProfileId
            ? { reasoning: legacyReasoning }
            : {})
      })),
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
// ---------- 配置.json ----------
// 改动后一秒内写一次（含 API Key：这是自己机器上的文件，几个浏览器共用一套模型配置靠的就是它；导出的备份仍不含）。
// 几个浏览器共用一份，靠的是「基准」：记着上次与磁盘对齐时的那一份（configBase，连同它在磁盘上的时间戳 configSyncedAt）。
// 写的时候带上这个时间戳，磁盘上若已有别处写过的更新的一份，桥接不写、把那份交回来；这边就按基准做三方合并——
// 自己改过的取自己的，没改的取对方的——再写一次。基准记在 localStorage 里，关了页面再开也接得上
const CONFIG_BASE_KEY = "yan-config-base";
let configBase = "",
  configSaving = false,
  configSaveAgain = false;
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
      if (response.ok) rememberConfigBase(meta, Number(data.savedAt) || savedAt);
    })
    .catch(() => {})
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
  return {
    version: theirs.version ?? mine.version,
    settings: keyed(base.settings, mine.settings, theirs.settings),
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
  store.settings = { ...store.settings, ...disk.settings };
  store.profiles = union(disk.profiles, store.profiles);
  store.library = union(disk.library, store.library);
  store.memory = { enabled: disk.memory.enabled, items: union(disk.memory.items, store.memory.items) };
  store.drafts = { ...store.drafts, ...disk.drafts };
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
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
    if (!disk.config || localSeeded) {
      writeMeta({ disk: false });
      saveConfigNow({ force: true });
    } else if (freshBrowser) adoptConfig(disk.config, Number(disk.savedAt) || 0);
    else if (met !== (info.root || "")) {
      mergeConfig(disk.config);
      writeMeta({ disk: false });
      saveConfigNow({ force: true });
      renderHeader();
      renderQuota();
    } else reconcileConfig(disk.config, Number(disk.savedAt) || 0);
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
    const interval =
        conversationRunning(id) || titlingIds.has(id) || compactingIds.has(id) ? CHAT_STREAM_DISK_INTERVAL : CHAT_DISK_INTERVAL,
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
          { root: chatsDir(), savedAt: pending.savedAt, conversation: JSON.parse(pending.json) },
          AbortSignal.timeout(60000)
        );
        chatSaveWarned = false;
        if (!deletedChatIds.has(id)) {
          persisted = true;
          // pagehide 已把最新状态写进表时，旧的在途请求即使成功也不能把那份离页兜底删掉。
          if (!unloading && !pendingChatWrites.has(id))
            await stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.delete(id)).catch(() => {});
        }
      } catch (error) {
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
    deletedChatIds.delete(id);
  }
}
// 别处删掉的一段：这边只从内存与暂存表里拿掉，目录那头已经删过了（附件原件那边也删过了）
function forgetConversation(id) {
  pendingChatWrites.delete(id);
  dirtyChatIds.delete(id);
  chatHashes.delete(id);
  chatStamps.delete(id);
  delete store.drafts?.[id];
  void stateStoreRequest(CHATS_STORE_NAME, "readwrite", db => db.delete(id)).catch(() => {});
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
          busy = conversationRunning(c.id) || titlingIds.has(c.id) || compactingIds.has(c.id);
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
      })
      .filter(Boolean);
    if (dropped) toast(dropped === 1 ? "有一段对话已在别处删除，此处随之移去" : `有 ${dropped} 段对话已在别处删除，此处随之移去`);
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
    const index = store.conversations.findIndex(c => c.id === item.id);
    if (index < 0 || item.savedAt <= (chatStamps.get(item.id) || 0) || conversationRunning(item.id)) continue;
    const next = normalizeConversation(item.conversation);
    store.conversations[index] = next;
    chatStamps.set(next.id, item.savedAt);
    chatHashes.set(next.id, hashText(JSON.stringify(next)));
    if (next.id === currentId) current = true;
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
// 分叉：c.messages 始终是当前走的那条路；编辑或重答时被换下来的尾巴整段收进 c.forks（记下它接在哪条消息之后），随时可以切回来。
// 同一位置的几个版本 = 当前这条 + 接在同一位置的 forks，按首条消息的时间排序
