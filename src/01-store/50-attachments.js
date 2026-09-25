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
