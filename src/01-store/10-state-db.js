// 言 · 本地存储 · 暂存：记录怎么存、IndexedDB 的状态表、配置的本机缓存
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
const STATE_DB_NAME = "yan-chat-state-v1";
const STATE_STORE_NAME = "state"; // 旧版整份记录的表（main 一条），迁走后就空着
const STATE_RECORD_KEY = "main";
const CHATS_STORE_NAME = "conversations"; // 落盘不成与离页时对话暂存这里，一段一条
let stateDbPromise = null,
  stateDb = null;
let metaRevision = 0,
  metaSaveWarned = false;
// ---------- 记录怎么存 ----------
// 记录分两半。「配置」（设置、模型含 API Key、记忆、草稿）小而常改：正本在存储根的 配置.json（默认 ~/.yan，
// 几个浏览器共用这一份，见 syncConfigWithDisk），localStorage 里那份是缓存，记着与磁盘对齐时的基准。
// 「对话」各自一份：落在存储根的 对话/（bootstrap.work.chats；一段一个 JSON 文件，复制即备份）；
// 落盘不成（桥接中途断了）与离页那一刻，暂存进 IndexedDB 的 conversations 表，接上后推到目录里去、表里的清掉——目录是正本。
// 保存只写改过的那几段（当前这段、正在生成的、明确标过脏的，且内容的哈希与上次写的不同）；另有一趟低频的全量巡检兜底，
// 谁改了哪段没标到也逃不过。旧版把整份记录（含所有对话）塞在 localStorage / IndexedDB 的一条记录里，启动时拆开迁走。
function openStateDb() {
  if (stateDbPromise) return stateDbPromise;
  stateDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(STATE_DB_NAME, 2);
    // 另一处窗口还开着旧版页面时，升级表结构会被它挡住，open 永远不回来：等几秒就当没有 IndexedDB，页面照常开（对话从目录来）
    const timer = setTimeout(() => {
      stateDbPromise = null;
      reject(Error(t("对话存储被另一处窗口占着")));
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
      reject(request.error || Error(t("对话存储不可用")));
    };
  });
  return stateDbPromise;
}
function dbRequest(db, storeName, mode, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode),
      request = action(transaction.objectStore(storeName));
    // 单次 put/delete 成功时事务还可能中止；写入要等事务提交才算存住。
    if (mode === "readwrite") transaction.oncomplete = () => resolve(request.result);
    else request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error(t("对话存储失败")));
    transaction.onabort = () => reject(transaction.error || Error(t("对话存储已中止")));
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
    transaction.onerror = () => reject(transaction.error || Error(t("对话存储失败")));
    transaction.onabort = () => reject(transaction.error || Error(t("对话存储已中止")));
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
  // 老页面读懂的兜底：仅当独立记号没有写成时才留在配置缓存里。
  const pendingDeletes = [...pendingChatDeletes].filter(([id]) => !hasChatDeleteMarker(id)),
    localKey = `${hash}|${JSON.stringify(pendingDeletes)}`;
  if (localKey !== metaLocalKey)
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...metaOf(),
          [STORAGE_META_KEY]: { revision: metaRevision || nextMetaRevision(), split: true, pendingDeletes }
        })
      );
      metaLocalKey = localKey;
      metaSaveWarned = false;
    } catch {
      if (!metaSaveWarned) {
        metaSaveWarned = true;
        toast(t("设置未能存下（浏览器存储已满），请先导出备份"));
      }
    }
  if (disk && changed) scheduleConfigSave();
  return localKey === metaLocalKey;
}
