// 言 · 本地存储 · 对话：一段一个文件落进对话目录，脏标记、落盘、巡检与读回
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
const CHAT_DISK_INTERVAL = 1200, // 静止时同一段对话连续落盘的最短间隔（毫秒）
  CHAT_STREAM_DISK_INTERVAL = 3000; // 流式生成时少改几遍整份 JSON；收尾会恢复上面的短间隔
// 对话的存取状态：目录是否可用、正在合、指纹与时间戳、待写与在写、没删成的（见 01-store/10-state-db.js 开头的说明）
let chatsBroken = false,
  chatsSyncing = null,
  // 这一回开页后对话已从目录读全过：之后才敢按「没人用」清附件原件
  chatsLoaded = false,
  // 目录里有对话文件读不出（坏了、被同步盘或杀软占着）：它引用的附件不在留用单上，这时不清原件
  chatsSkipped = 0,
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
  // 上次读到的目录原文；并发编辑时以它为共同起点逐字段合并
  chatBases = new Map(),
  pendingChatWrites = new Map(),
  activeChatWrites = new Map(),
  chatWritePromises = new Map(),
  deletedChatIds = new Set(),
  chatDiskWrites = new Map(),
  // 待补删的对话：id → 删它的时刻。断着的时候删的，接上后要带着那一刻去补删——
  // 桥接用这个时刻比较磁盘版本：新版保留，其余按这个时刻记删除（见 server/chats.js 的 handleDelete）。
  pendingChatDeletes = new Map(),
  pendingChatDeleteDirs = new Map(),
  // 磁盘已裁定；只等浏览器事务提交，不再补删磁盘。关页前清不成，重开也不读回旧暂存。
  discardedChatSpills = new Map();
let saveTimer = null;
// 对话目录可用：桥接报了目录、上次读它没出错
function chatsOnline() {
  return !!chatsDir() && !chatsBroken;
}
function chatsDir() {
  return bootstrap.work?.chats || "";
}
// 两个根可以有同一个 id。新暂存用 IndexedDB 的复合键，不覆盖旧版字符串键。
const LEGACY_CHAT_DIR_KEY = "yan-chat-legacy-dir";
let legacyChatDir;
function rememberLegacyChatDir() {
  if (legacyChatDir !== undefined) return;
  legacyChatDir = chatsDir();
  try {
    const known = localStorage.getItem(LEGACY_CHAT_DIR_KEY),
      oldRoot = localStorage.getItem(STORE_ROOT_KEY);
    if (known !== null) legacyChatDir = known;
    else {
      if (oldRoot && oldRoot !== bootstrap.store?.root)
        legacyChatDir = oldRoot.replace(/[\\/]$/, "") + (oldRoot.includes("\\") ? "\\" : "/") + "对话";
      localStorage.setItem(LEGACY_CHAT_DIR_KEY, legacyChatDir);
    }
  } catch {}
}
const chatSpillKey = (dir, id) => (dir ? [dir, id] : id);
const spillChatId = row => (Array.isArray(row.id) ? row.id[1] : row.id);
const spillBelongs = (row, dir) => (row.dir || legacyChatDir || "") === dir;
// 均在读写事务里看当前行，而不是拿发请求时见过的缓存或时间戳猜。
function visitChatSpills(table, dir, id, visit) {
  const keys = dir ? [chatSpillKey(dir, id), id] : [id];
  for (const key of keys) {
    const request = table.get(key);
    request.onsuccess = () => {
      const row = request.result;
      if (row && spillBelongs(row, dir)) visit(row, key);
    };
  }
}
function clearSavedChatSpills(dir, written) {
  if (!written.size) return Promise.resolve();
  rememberLegacyChatDir();
  return openStateDb()
    .then(db =>
      dbBatch(db, CHATS_STORE_NAME, table => {
        for (const [id, json] of written)
          visitChatSpills(table, dir, id, (row, key) => {
            // 冷正文完整的暂存不等同于磁盘上只有 cold.key 的版本。
            if (row.json === json || spillCoveredBy(row, json)) table.delete(key);
          });
      })
    )
    .catch(() => {});
}
// 合并结果可能还有别页的改动，不一定字节相等。只认有共同起点、且暂存的改动已被这份正本吸收的情形。
function spillCoveredBy(row, json) {
  if (!row.baseJson || !json) return false;
  try {
    const spill = normalizeConversation(JSON.parse(row.json)),
      disk = normalizeConversation(JSON.parse(json));
    const cold = new Set(
      everyMessage(disk)
        .filter(m => m.cold)
        .map(m => m.id)
    );
    if (
      everyMessage(spill).some(
        m => cold.has(m.id) && (m.reasoning || m.steps?.some(step => step.sub?.reasoning || step.sub?.steps?.length))
      )
    )
      return false;
    const merged = mergeConversation(spill, disk, JSON.parse(row.baseJson), false);
    return JSON.stringify(merged) === JSON.stringify(disk);
  } catch {
    return false;
  }
}
function chatDeletePending(id) {
  const dir = pendingChatDeleteDirs.get(id);
  return pendingChatDeletes.has(id) && (!dir || dir === chatsDir());
}
const CHAT_DELETE_KEY = "yan-chat-delete:";
const chatDeleteKey = (id, dir = chatsDir()) => CHAT_DELETE_KEY + JSON.stringify([dir, id]);
function hasChatDeleteMarker(id) {
  try {
    return !!localStorage.getItem(chatDeleteKey(id));
  } catch {
    return false;
  }
}
function saveChatDeleteMarker(id) {
  const key = chatDeleteKey(id);
  try {
    if (pendingChatDeletes.has(id))
      localStorage.setItem(key, JSON.stringify({ at: pendingChatDeletes.get(id), dir: pendingChatDeleteDirs.get(id) }));
    else if (discardedChatSpills.has(id)) localStorage.setItem(key, JSON.stringify(discardedChatSpills.get(id)));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
// 每段单记，另一页保存设置不会把这页的标记盖掉。
function readChatDeleteMarkers(legacy) {
  for (const item of legacy) {
    const [id, at] = Array.isArray(item) ? item : [item, 0];
    if (id) {
      const key = String(id);
      pendingChatDeletes.set(key, Number(at) || 0);
      if (!hasChatDeleteMarker(key)) saveChatDeleteMarker(key);
    }
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CHAT_DELETE_KEY)) continue;
      const id = key.slice(CHAT_DELETE_KEY.length);
      try {
        const marker = JSON.parse(localStorage.getItem(key));
        const scoped = id.startsWith("[") ? JSON.parse(id) : null;
        if (scoped ? scoped[0] !== chatsDir() : (marker?.dir || legacyChatDir) !== chatsDir()) continue;
        const chatId = scoped ? scoped[1] : id;
        if (!scoped && hasChatDeleteMarker(chatId)) continue;
        if (Number.isFinite(marker?.through) && marker.through > 0) {
          discardedChatSpills.set(chatId, { ...marker, dir: chatsDir() });
          pendingChatDeletes.delete(chatId);
          pendingChatDeleteDirs.delete(chatId);
        } else if (Number.isFinite(marker?.at)) {
          pendingChatDeletes.set(chatId, marker.at);
          pendingChatDeleteDirs.set(chatId, chatsDir());
        } else continue;
        if (!scoped && saveChatDeleteMarker(chatId)) localStorage.removeItem(key), i--;
      } catch {}
    }
  } catch {}
}
function setChatDeleteDir(id, dir) {
  pendingChatDeleteDirs.set(id, dir);
  saveChatDeleteMarker(id);
}
// 标记这段对话有改动（改名、置顶、后台一答收尾这些不在「当前对话」上的改动要亲手标；当前这段与正在生成的自动算在内）
function markDirty(id) {
  if (id) dirtyChatIds.add(id);
}
// 这边正在写它：作答、旁注、后台帮手、拟题、压缩中——这些都拿着对象本身在写，同步时不能把它换掉
function busyHere(id) {
  return (
    conversationRunning(id) ||
    crews.has(id) ||
    titlingIds.has(id) ||
    compactingIds.has(id) ||
    [...requestJobs.values()].some(job => job.conversationId === id)
  );
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
  const queuedIds = [];
  for (const id of ids) {
    // 别处正作答的不写：磁盘上那份由它写，这边只跟着看
    if (chatDeletePending(id) || runningElsewhere(id) || !store.conversations.some(item => item.id === id)) continue;
    const queued = pendingChatWrites.get(id);
    pendingChatWrites.set(id, { force: force || !!queued?.force });
    queuedIds.push(id);
  }
  void drainChatWrites();
  return queuedIds;
}
// 导入只等本批 ID，不等别段作答。强制过一轮写队列：同指纹可能来自磁盘，也可能只来自暂存。
async function flushImportedConversations(ids) {
  const queued = new Set(flushConversations(ids, { force: true }));
  return Promise.all(ids.map(id => (queued.has(id) ? chatWritePromises.get(id)?.catch(() => null) : null)));
}
function drainChatWrites() {
  for (const id of pendingChatWrites.keys()) {
    if (chatDeletePending(id) || chatWritePromises.has(id)) continue;
    const task = writeConversation(id).finally(() => {
      if (chatWritePromises.get(id) !== task) return;
      chatWritePromises.delete(id);
      if (pendingChatWrites.has(id) && !chatDeletePending(id)) drainChatWrites();
    });
    chatWritePromises.set(id, task);
  }
}
async function writeConversation(id) {
  /** @type {"disk"|"browser"|"page"|null} */
  let result = null;
  const scope = bootstrap.store,
    dir = chatsDir(),
    sameRoot = () => bootstrap.store === scope && chatsDir() === dir;
  while (sameRoot() && pendingChatWrites.has(id) && !chatDeletePending(id)) {
    // 先等、后 stringify。生成中三秒一份，收尾与普通编辑最多等一秒多；离页另有同步入 IndexedDB 的兜底，不靠这里抢时间。
    const interval = busyHere(id) ? CHAT_STREAM_DISK_INTERVAL : CHAT_DISK_INTERVAL,
      wait = unloading ? 0 : interval - (performance.now() - (chatDiskWrites.get(id) || -interval));
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    if (!sameRoot() || chatDeletePending(id)) break;
    const queued = pendingChatWrites.get(id);
    pendingChatWrites.delete(id);
    let conversation = store.conversations.find(item => item.id === id);
    if (!conversation) continue;
    await coldify(conversation);
    if (!sameRoot()) return null;
    // 另存的那一会儿里可能被删、被并进来的新份换掉
    conversation = store.conversations.find(item => item.id === id);
    if (!conversation || chatDeletePending(id)) continue;
    const json = chatJson(conversation),
      hash = hashText(json);
    if (!queued?.force && chatHashes.get(id) === hash) {
      if (!pendingChatWrites.has(id)) dirtyChatIds.delete(id);
      continue;
    }
    const pending = { json, hash, savedAt: nextChatStamp(id), title: conversation.title, dir };
    activeChatWrites.set(id, pending);
    chatDiskWrites.set(id, performance.now());
    // 目录在线先落盘；离线或落盘不成就暂存。导入用返回值区分已落盘、浏览器事务已提交、仍只在本页。
    let spilled = !chatsOnline(),
      diskError = null;
    result = "page";
    if (!spilled)
      try {
        await bridgeJson(
          "/api/chats/save",
          `{"root":${JSON.stringify(pending.dir)},"storeRoot":${JSON.stringify(scope?.root || "")},"savedAt":${pending.savedAt},"base":${chatDiskStamps.get(id) || 0},"conversation":${pending.json}}`,
          AbortSignal.timeout(60000)
        );
        if (!sameRoot()) return null;
        chatDiskStamps.set(id, pending.savedAt);
        chatBases.set(id, pending.json);
        chatSaveWarned = false;
        if (!chatDeletePending(id)) {
          result = "disk";
          // pagehide 已把最新状态写进表时，旧的在途请求即使成功也不能把那份离页兜底删掉。
          if (!unloading && !pendingChatWrites.has(id)) await clearSavedChatSpills(dir, new Map([[id, pending.json]]));
          if (!sameRoot()) return null;
        }
      } catch (error) {
        if (!sameRoot()) return null;
        // 目录里那份比这边上次见过的新（别处写过）：两份并起来，下一轮带着新的时间戳再写
        if (error.status === 409 && error.data?.item && !chatDeletePending(id)) {
          activeChatWrites.delete(id);
          const caughtUp = catchUpConversation(error.data.item);
          // 409 跟读会就地重画；仍在重画之后核对这份正文。
          if (caughtUp && chatJson(caughtUp.next) === chatBases.get(id)) result = "disk";
          continue;
        }
        // 迟到的旧保存撞上了别处的删除：不暂存、不复活，这边也跟着拿掉
        if (/已在别处删除/.test(String(error.message))) {
          activeChatWrites.delete(id);
          store.conversations = store.conversations.filter(item => item.id !== id);
          forgetConversation(id, Number(error.data?.at) || pending.savedAt);
          if (currentId === id) {
            currentId = null;
            render();
          } else renderHistory();
          return;
        }
        spilled = true;
        diskError = error;
      }
    if (spilled && !chatDeletePending(id))
      try {
        const record = {
          id: chatSpillKey(dir, id),
          savedAt: pending.savedAt,
          json: chatSpillJson(conversation),
          baseJson: chatBases.get(id),
          dir
        };
        await keepChatSpills([record]);
        if (!sameRoot()) return null;
        result = "browser";
        if (!chatsOnline()) chatSaveWarned = false;
        else if (diskError && !chatSaveWarned) {
          chatSaveWarned = true;
          toast(t`对话未能落盘，先暂存在浏览器里：${String(diskError.message || diskError).slice(0, 60)}`);
        }
      } catch {
        if (!sameRoot()) return null;
        if (!chatSaveWarned) {
          chatSaveWarned = true;
          toast(t("本机对话存储失败，请先导出备份"));
        }
      }
    if (activeChatWrites.get(id) === pending) activeChatWrites.delete(id);
    // 桥接在线却没写进盘（文件被占着之类）：浏览器里暂存着，但脏标记留着，下回保存再往盘上写
    if ((result === "disk" || (result === "browser" && !chatsOnline())) && !chatDeletePending(id)) {
      chatHashes.set(id, hash);
      if (!pendingChatWrites.has(id)) dirtyChatIds.delete(id);
    }
  }
  return !sameRoot() || chatDeletePending(id) ? null : result;
}
// 磁盘与本机暂存分别收尾。删暂存只动这一回之前的旧份；另一页后来存的不能连带清掉。
async function clearDiscardedChatSpills() {
  const work = bootstrap.work,
    dir = chatsDir(),
    discarded = [...discardedChatSpills].filter(([, marker]) => !marker.dir || marker.dir === dir),
    newer = [],
    unresolved = new Set();
  if (!discarded.length) return true;
  rememberLegacyChatDir();
  try {
    await dbBatch(await openStateDb(), CHATS_STORE_NAME, table => {
      for (const [id, marker] of discarded)
        visitChatSpills(table, dir, id, (row, key) => {
          if ((Number(row.savedAt) || 0) <= marker.through) table.delete(key);
          else newer.push(row);
        });
    });
    if (bootstrap.work !== work) return false;
    let complete = true;
    for (const row of newer) {
      const id = spillChatId(row),
        current = store.conversations.find(c => c.id === id);
      // 可能已经在读浏览器暂存的同时开工；不能用旧对象覆盖，留给重开读回。
      if (!current || chatDeletePending(id) || busyHere(id)) {
        unresolved.add(id);
        complete = false;
        continue;
      }
      try {
        const saved = normalizeConversation(JSON.parse(row.json)),
          base = row.baseJson ? JSON.parse(row.baseJson) : null,
          currentJson = chatJson(current),
          clean = chatHashes.get(id) === hashText(currentJson),
          merged = clean && base ? mergeConversation(saved, current, base) : mergeConversation(current, saved, base);
        if (currentJson === chatJson(merged)) continue;
        carryWarm(current, merged);
        store.conversations[store.conversations.indexOf(current)] = merged;
        chatStamps.set(id, Math.max(chatStamps.get(id) || 0, Number(row.savedAt) || 0));
        markDirty(id);
        flushConversations([id]);
        renderHistory();
        if (currentId === id && view === "chat") renderConversation(false);
      } catch {
        unresolved.add(id);
        complete = false;
      }
    }
    for (const [id, marker] of discarded) {
      if (discardedChatSpills.get(id) !== marker || unresolved.has(id)) continue;
      discardedChatSpills.delete(id);
      // 别页可能已对同一段发起新删除；只撤自己写下的这一份。
      const key = chatDeleteKey(id);
      try {
        if (localStorage.getItem(key) === JSON.stringify(marker)) localStorage.removeItem(key);
      } catch {}
    }
    return complete;
  } catch {
    // 事务没提交，保留记号；不能因此挡住磁盘上的对话，但也不能假定浏览器里没有新版引用。
    return false;
  }
}
function deleteConfirmed(answer) {
  return Number.isSafeInteger(answer?.removed) && answer.removed >= 0 && (answer.kept === undefined || answer.kept === true);
}
function settleChatDelete(id, at) {
  pendingChatDeletes.delete(id);
  pendingChatDeleteDirs.delete(id);
  discardedChatSpills.set(id, { through: at || Date.now(), dir: chatsDir() });
  saveChatDeleteMarker(id);
}
// 删一段：先记下删除时刻并等已经发出的保存收尾，再删文件，保证「旧保存」不会排在删除之后把它复活。
// 先写此段自己的浏览器删除记号，写不成则尝试用配置缓存兜底；读回时凭记号略过旧暂存。
async function deleteConversationStorage(id) {
  const at = Date.now(),
    root = chatsDir(),
    scope = bootstrap.store;
  deletedChatIds.add(id);
  pendingChatDeletes.set(id, at);
  setChatDeleteDir(id, root);
  pendingChatWrites.delete(id);
  dirtyChatIds.delete(id);
  writeMeta();
  let kept = false;
  try {
    await chatWritePromises.get(id)?.catch(() => {});
    if (bootstrap.store !== scope || chatsDir() !== root || !chatsOnline()) return;
    const answer = await bridge("/api/chats/delete", { root, storeRoot: scope?.root, id, at }, AbortSignal.timeout(20000));
    if (bootstrap.store !== scope || chatsDir() !== root || pendingChatDeletes.get(id) !== at) return;
    if (!deleteConfirmed(answer)) return;
    kept = answer.kept === true;
    if (!kept) {
      settleChatDelete(id, at);
      writeMeta({ disk: false });
      return true;
    }
  } catch {
    // 没收到明确裁定，重连后补删。
  } finally {
    if (bootstrap.store === scope && chatsDir() === root) {
      deletedChatIds.delete(id);
      clearChatSaveState(id);
      activeChatWrites.delete(id);
    }
  }
  if (kept) await syncChatsWithDisk();
}
function hasPendingChatDeletes() {
  for (const id of pendingChatDeletes.keys()) if (chatDeletePending(id)) return true;
  return false;
}
function hasDiscardedChatSpills() {
  return [...discardedChatSpills.values()].some(marker => !marker.dir || marker.dir === chatsDir());
}
// 只有对话确认删成、引用单也齐全，才立即清该段的附件。保留或未知时交给对齐后的清扫。
async function deleteStoredConversations(entries) {
  const work = bootstrap.work;
  const files = await Promise.all(
    entries.map(async ([id, ids, afterDelete]) => {
      if (!(await deleteConversationStorage(id))) return [];
      if (bootstrap.work === work) void afterDelete?.();
      return ids;
    })
  );
  if (bootstrap.work !== work) return;
  if ((await clearDiscardedChatSpills()) && bootstrap.work === work && canCleanAttachments()) await deleteAttachments(files.flat());
}
function clearChatSaveState(id) {
  pendingChatWrites.delete(id);
  dirtyChatIds.delete(id);
  chatHashes.delete(id);
  chatStamps.delete(id);
  chatDiskStamps.delete(id);
  chatBases.delete(id);
}
// 磁盘已判这段被删：调用方移出对话，这里清本页保存状态、草稿与浏览器暂存；不在这里清原件。
function forgetConversation(id, through) {
  clearChatSaveState(id);
  delete store.drafts?.[id];
  const dir = chatsDir();
  rememberLegacyChatDir();
  void openStateDb()
    .then(db =>
      dbBatch(db, CHATS_STORE_NAME, table =>
        visitChatSpills(table, dir, id, (row, key) => {
          if ((Number(row.savedAt) || 0) <= through) table.delete(key);
        })
      )
    )
    .catch(() => {});
}
// 目录里有一份比这边新的（别处写过）。这边手上的已落过盘、之后没再动过，直接换上；
// 否则（这边改过、正写着、或只暂存在浏览器里）两份并起来再写回去，谁写的都不丢。
// 返回换上的那份及是否与磁盘正文一致；quiet：调用方自己重画；localHash：本轮已算过的本地指纹。
/** @param {{ id: string, conversation: Conversation, savedAt: number }} item @param {{ quiet?: boolean, localHash?: string }} [options] */
function catchUpConversation(item, { quiet = false, localHash } = {}) {
  const index = store.conversations.findIndex(c => c.id === item.id);
  if (index < 0) return null;
  const c = store.conversations[index],
    theirs = normalizeConversation(item.conversation),
    theirJson = chatJson(theirs),
    stamp = chatStamps.get(c.id) || 0,
    clean = chatHashes.get(c.id) === (localHash ?? hashText(chatJson(c))) && chatDiskStamps.get(c.id) === stamp && !busyHere(c.id),
    base = chatBases.has(c.id) ? JSON.parse(chatBases.get(c.id)) : null,
    next = clean ? theirs : mergeConversation(c, theirs, base);
  carryWarm(c, next);
  store.conversations[index] = next;
  chatDiskStamps.set(c.id, item.savedAt);
  chatBases.set(c.id, theirJson);
  chatStamps.set(c.id, Math.max(stamp, item.savedAt));
  const matchesDisk = chatJson(next) === theirJson;
  if (matchesDisk) {
    chatStamps.set(c.id, item.savedAt);
    chatHashes.set(c.id, hashText(theirJson));
  } else {
    // 并出来的与目录里的不一样：要写回去（chatHashes 不动，下一趟写时指纹对不上，自然会写）
    // 别处正作答的等它松手再写（脏标记留着，见 flushConversations）
    markDirty(c.id);
    if (!runningElsewhere(c.id)) pendingChatWrites.set(c.id, { force: true });
    // 这边有、目录里没有的内容接了进去，才值得说一声（只差个未读标记之类的不算）
    const grew = ["messages", "forks", "threads"].some(key => next[key].length > theirs[key].length);
    if (grew && !mergeNoticed) toast(t("这段对话在另一处也写过，两边的内容已并在一起"));
    mergeNoticed ||= grew;
  }
  if (!quiet) {
    if (c.id === currentId && view === "chat") renderConversation(false);
    renderHistory();
    renderClepsydra();
  }
  return { next, matchesDisk };
}
let mergeNoticed = false;
// 共同起点上没改的字段取对方，只有一边改了的取改动；同一字段都改了时本机胜出。
// 按 id 合并消息和分支，避免「改标题」把另一处的置顶覆盖掉。
function mergeConversation(c, theirs, base = null, live = busyHere(c.id)) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const merge = (ours, other, old) => {
    if (same(ours, other)) return ours;
    if (same(ours, old)) return other;
    if (same(other, old)) return ours;
    if (Array.isArray(ours) && Array.isArray(other) && [...ours, ...other].every(item => item?.id)) {
      const own = new Map(ours.map(item => [item.id, item])),
        before = new Map((Array.isArray(old) ? old : []).map(item => [item.id, item])),
        seen = new Set(other.map(item => item.id));
      // 这边独有的接上；起点上就有、这边没动过、对方拿掉了的（重答时收进分支的旧答）是对方删的，不再接回来
      return [
        ...other.map(item => (own.has(item.id) ? merge(own.get(item.id), item, before.get(item.id)) : item)),
        ...ours.filter(item => !seen.has(item.id) && !(before.has(item.id) && same(item, before.get(item.id))))
      ];
    }
    if (ours && other && typeof ours === "object" && typeof other === "object" && !Array.isArray(ours) && !Array.isArray(other)) {
      const result = {};
      for (const key of new Set([...Object.keys(other), ...Object.keys(ours)])) {
        const value = merge(ours[key], other[key], old?.[key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    // 旧版暂存没有共同起点：沿用「目录字段优先、本机新增条目接上」的规则。
    return base ? ours : other;
  };
  if (live) {
    // 作答中的消息对象要留在原位；独立改动的标题、置顶等字段仍可接收。
    if (base)
      for (const key of Object.keys(theirs))
        if (!["messages", "forks", "threads", "unread"].includes(key) && same(c[key], base[key])) c[key] = theirs[key];
    for (const key of ["messages", "forks", "threads"]) {
      const own = new Map(c[key].map(item => [item.id, item]));
      for (const item of theirs[key]) {
        const mine = own.get(item.id);
        if (!mine) c[key].push(item);
        // 两边都有的旁注：对方在里头新写的往来照常并进来；这边正写着的那条留在原位不动
        else if (key === "threads" && !requestJobs.has(`side:${item.id}`))
          c.threads[c.threads.indexOf(mine)] = merge(
            mine,
            item,
            base?.threads?.find(thread => thread.id === item.id)
          );
      }
    }
    return c;
  }
  // 未读只是这一处的提示：开着看的这段不因为并了一份又亮起来
  const merged = merge(c, theirs, base);
  if (c.unread !== theirs.unread) merged.unread = c.unread;
  merged.updatedAt = c.updatedAt > theirs.updatedAt ? c.updatedAt : theirs.updatedAt;
  return merged;
}
// 定向读只带已经见过的磁盘版本；本页暂存的时间不算。
function chatLoadQuery(root, ids, knownIds = ids) {
  const known = Object.fromEntries(knownIds.filter(id => chatDiskStamps.get(id) > 0).map(id => [id, chatDiskStamps.get(id)]));
  const query = { root, storeRoot: bootstrap.store?.root, ids };
  return Object.keys(known).length ? { ...query, known } : query;
}
// 跟上目录里的这几段：页面切回前台时看的那段。只查指定对话，磁盘版本未变时可不传正文。
async function catchUpFromDisk(ids) {
  if (!chatsOnline() || !ids.length) return;
  const scope = bootstrap.store,
    root = chatsDir();
  try {
    const data = await bridge("/api/chats/load", chatLoadQuery(root, ids), AbortSignal.timeout(8000));
    if (bootstrap.store !== scope || chatsDir() !== root) return;
    for (const item of data.items || [])
      if (item.savedAt > (chatDiskStamps.get(item.id) || 0) && !runningElsewhere(item.id) && !chatDeletePending(item.id))
        catchUpConversation(item);
    drainChatWrites();
  } catch {}
}
// 全量巡检：每段都算一遍指纹，变了的写下去。页面转入后台时跑，哪处改了没标脏也兜得住
function sweepConversations() {
  flushConversations(store.conversations.map(c => c.id));
}
// 前台的定时巡检：整份 stringify 再算指纹，几十 MB 的对话要卡上几百毫秒（一处存储根 47 MB、最大一段 20 MB）。
// 一趟只巡眼前这段与轮到的另一段，各等闲时；作答中的三秒存一回，不靠这里。整份巡留给页面藏起来时
let sweepTurn = 0;
function sweepSomeConversations() {
  const others = store.conversations.filter(c => c.id !== currentId),
    ids = [currentId, others.length ? others[sweepTurn++ % others.length].id : null].filter(Boolean),
    idle = window.requestIdleCallback || (fn => setTimeout(fn, 200));
  const scope = bootstrap.store;
  for (const id of ids)
    idle(
      () => {
        if (bootstrap.store === scope) flushConversations([id]);
      },
      { timeout: 5000 }
    );
}
// 页面要关了：不再新发普通 fetch（卸载时它不可靠），而是在一个同步开启的 IndexedDB 事务里把所有未落稳的最新状态兜住；
// 包括已经从待写表拿走、正在 fetch 的那份。暂存带上最近见到的磁盘基准，重开时据此合并，不凭离页时刻判胜。
function flushOnUnload() {
  if (unloading) return;
  unloading = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeMeta({ disk: false });
  if (configSaveTimer) saveConfigNow();
  keepSentConfigs();
  if (!stateDb) return;
  try {
    const records = collectChatSpills();
    if (!records.length) return;
    const table = stateDb.transaction(CHATS_STORE_NAME, "readwrite").objectStore(CHATS_STORE_NAME);
    for (const record of records) putChatSpill(table, record);
  } catch {}
}
function collectChatSpills() {
  const dir = chatsDir(),
    records = [];
  for (const conversation of store.conversations) {
    const id = conversation.id;
    if (chatDeletePending(id)) continue;
    // 待写与在途无论指纹是否相同都要暂存；只用指纹兜空闲时漏标脏的改动。
    if (!pendingChatWrites.has(id) && !activeChatWrites.has(id) && chatHashes.get(id) === hashText(chatJson(conversation))) continue;
    records.push({
      id: chatSpillKey(dir, id),
      savedAt: nextChatStamp(id),
      json: chatSpillJson(conversation),
      baseJson: chatBases.get(id),
      dir
    });
  }
  return records;
}
function putChatSpill(table, record) {
  const request = table.get(record.id);
  request.onsuccess = () => {
    // 较旧的失败回执可能比别页暂存更晚抵达；不能用旧快照盖掉它。
    if (!request.result || Number(request.result.savedAt) <= record.savedAt) table.put(record);
  };
}
function keepChatSpills(records) {
  if (!records.length) return Promise.resolve();
  return openStateDb().then(db =>
    dbBatch(db, CHATS_STORE_NAME, table => {
      for (const record of records) putChatSpill(table, record);
    })
  );
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
    chatHashes.set(c.id, hashText(chatJson(c)));
    if (record.baseJson) chatBases.set(c.id, record.baseJson);
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
  // 老记录有纯 id 的，也有 [id, 删除时刻]；第一次接到目录时补记它的来源。
  rememberLegacyChatDir();
  readChatDeleteMarkers(local?.pendingDeletes || []);
  store.conversations = store.conversations.filter(c => !chatDeletePending(c.id));
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
          store.conversations = store.conversations.filter(c => !chatDeletePending(c.id));
          for (const c of store.conversations) {
            const json = chatJson(c);
            chatStamps.set(c.id, stamp);
            chatHashes.set(c.id, hashText(json));
            s.put({ id: chatSpillKey(chatsDir(), c.id), savedAt: stamp, json, dir: chatsDir() });
          }
        });
        await dbRequest(db, STATE_STORE_NAME, "readwrite", s => s.delete(STATE_RECORD_KEY)).catch(() => {});
      } catch {}
      writeMeta();
    }
  }
  if (local?.split || !store.conversations.length) await readChatSpills();
  // 尽量让浏览器把这份本机数据视作持久存储；不支持或不准时静默退回普通 IndexedDB
  try {
    const persistence = navigator.storage?.persist?.();
    persistence?.catch?.(() => {});
  } catch {}
}
// 旧字符串键按已知归属收进复合键，同一事务移动。不能留下先前带 dir 的旧行，等新版被清掉后再次读回。
function migrateChatSpillKeys(table, records, dir) {
  if (!dir) return;
  const scoped = new Map(records.filter(row => Array.isArray(row.id) && spillBelongs(row, dir)).map(row => [spillChatId(row), row]));
  for (let i = 0; i < records.length; i++) {
    const row = records[i],
      id = row.id;
    if (typeof id !== "string" || !spillBelongs(row, dir) || chatDeletePending(id) || discardedChatSpills.has(id)) continue;
    const existing = scoped.get(id);
    let migrated = { ...row, id: chatSpillKey(dir, id), dir };
    if (existing) {
      try {
        const [older, newer] = Number(existing.savedAt) >= Number(row.savedAt) ? [row, existing] : [existing, row];
        const a = normalizeConversation(JSON.parse(older.json)),
          b = normalizeConversation(JSON.parse(newer.json));
        const base = newer.baseJson || older.baseJson;
        const merged = base ? mergeConversation(b, a, JSON.parse(base), false) : mergeConversation(a, b, null, false);
        migrated = { ...migrated, savedAt: newer.savedAt, json: JSON.stringify(merged), baseJson: base };
        Object.assign(existing, migrated);
      } catch {
        continue;
      }
    }
    records[i] = migrated;
    table.put(migrated);
    table.delete(id);
  }
}
// 开页与接用已有根共用：只读属于这一根的行。旧版键和新键若并存，取较晚的一份。
async function readChatSpills() {
  const scope = bootstrap.store,
    dir = chatsDir();
  try {
    const records = await stateStoreRequest(CHATS_STORE_NAME, "readwrite", table => {
      const request = table.getAll();
      request.onsuccess = () => migrateChatSpillKeys(table, request.result, dir);
      return request;
    });
    if (bootstrap.store !== scope || chatsDir() !== dir) return false;
    const known = new Set(store.conversations.map(c => c.id)),
      spills = new Map();
    for (const record of records) {
      const id = spillChatId(record),
        marker = discardedChatSpills.get(id);
      if (!spillBelongs(record, dir) || known.has(id) || chatDeletePending(id) || (marker && Number(record.savedAt) <= marker.through))
        continue;
      if (!spills.has(id) || Number(spills.get(id).savedAt) <= Number(record.savedAt)) spills.set(id, record);
    }
    for (const record of spills.values()) {
      const c = adoptRecord(record);
      if (c) store.conversations.push(c);
    }
    return true;
  } catch {
    return false;
  }
}
// 桥接断了又接上（重启、闪断），或开页那一回目录没读成：配置与对话目录各再对一次。开页那一回还没对过的不算（boot 自己来）
function resyncWithDisk() {
  if (!chatsLoaded && !chatsBroken) return;
  void syncConfigWithDisk().then(() => syncChatsWithDisk());
}
// 与对话目录合一次：开页接上桥接时、桥接中途断了又接上时都来一遍。
// 先处理待补删：明确删除的移去，明确保留的重读磁盘新版，未裁定的不采用旧快照。
// 其余对话按磁盘基准合并；本机独有的或合并后有差的推回，只清已和磁盘对齐的暂存及裁定范围内的旧暂存。
async function syncChatsWithDisk({ spillsReady = true } = {}) {
  const root = chatsDir(),
    scope = bootstrap.store,
    work = bootstrap.work;
  if (!root || chatsSyncing === work) return;
  chatsSyncing = work;
  const sameRoot = () => bootstrap.store === scope && bootstrap.work === work && chatsDir() === root;
  try {
    const data = await bridge("/api/chats/load", { root, storeRoot: scope?.root }, AbortSignal.timeout(120000));
    if (!sameRoot()) return;
    if (!Array.isArray(data?.items)) throw Error("对话目录未读全");
    // 快照是补删前的。名单上的段只认补删裁定；保留的也要重读，因为新版可能是在取快照之后才写成的。
    const deleting = new Map([...pendingChatDeletes].filter(([id]) => chatDeletePending(id))),
      decisions = new Map();
    for (const [id, at] of deleting) {
      if (!pendingChatDeleteDirs.get(id)) setChatDeleteDir(id, root);
      // 当前页刚删、却还有旧保存正在收尾的，由 deleteConversationStorage 等完后亲自再删。
      if (deletedChatIds.has(id)) continue;
      try {
        const answer = await bridge(
          "/api/chats/delete",
          { root, storeRoot: scope?.root, id, at: at || undefined },
          AbortSignal.timeout(20000)
        );
        if (!sameRoot()) return;
        if (!deleteConfirmed(answer)) continue;
        if (!answer.kept) {
          decisions.set(id, null);
          continue;
        }
        const fresh = await bridge("/api/chats/load", { root, storeRoot: scope?.root, ids: [id] }, AbortSignal.timeout(20000));
        if (!sameRoot()) return;
        const item =
          Array.isArray(fresh?.items) && fresh.items.find(item => item?.id === id && item.conversation?.id === id && item.savedAt > at);
        if (item && !fresh.skipped) decisions.set(id, item);
      } catch {
        if (!sameRoot()) return;
      }
    }
    chatsBroken = false;
    chatsLoaded = true;
    chatsSkipped = Number(data.skipped) || 0;
    const disk = new Map();
    for (const item of data.items) if (item?.id && !deleting.has(item.id) && !chatDeletePending(item.id)) disk.set(item.id, item);
    // 隔开本页旧暂存和磁盘裁定：即便本机暂存库坏了，也能当场恢复桥接明确保留的那份。
    const before = store.conversations.length;
    store.conversations = store.conversations.filter(c => !deleting.has(c.id) && !chatDeletePending(c.id));
    for (const id of deleting.keys()) {
      if (deletedChatIds.has(id)) continue;
      clearChatSaveState(id);
      if (pendingChatDeletes.get(id) !== deleting.get(id) || !decisions.has(id)) continue;
      const item = decisions.get(id);
      settleChatDelete(id, deleting.get(id));
      if (item) {
        disk.set(id, item);
        toast(t`这段在别处又有新的，没删`);
      }
    }
    const push = new Set(),
      settled = new Set(),
      gone = data.deleted && typeof data.deleted === "object" ? data.deleted : {};
    let changed = store.conversations.length !== before,
      currentReplaced = false,
      dropped = 0;
    store.conversations = store.conversations
      .map(c => {
        const item = disk.get(c.id),
          diskStamp = chatDiskStamps.get(c.id),
          stamp = chatStamps.get(c.id) || 0,
          hash = hashText(chatJson(c)),
          unsaved = chatHashes.get(c.id) !== hash,
          busy = busyHere(c.id);
        if (!item) {
          // 别处删了、这边又没再动过：跟着删，不推回去让它复活；这边删后又说过话的，照推（桥接那头按时间认）
          if (Number(gone[c.id]) > stamp && !unsaved && !busy) {
            forgetConversation(c.id, Number(gone[c.id]));
            changed = true;
            dropped += 1;
            return null;
          }
          push.add(c.id);
          return c;
        }
        // 全量快照可能晚于更新的定向跟读返回；不能往回改磁盘基准。
        if (diskStamp !== undefined && item.savedAt < diskStamp) return c;
        // 刚读回的暂存版有共同起点时，按起点合并；离页时刻并不是它见过的磁盘版本。
        if (diskStamp === undefined ? item.savedAt > stamp || chatBases.has(c.id) : item.savedAt > diskStamp) {
          const { next, matchesDisk } = catchUpConversation(item, { quiet: true, localHash: hash });
          // 指纹也可能只是暂存版的；只有合并结果已在磁盘上才能清暂存。
          (matchesDisk ? settled : push).add(c.id);
          changed = true;
          if (c.id === currentId) currentReplaced = true;
          return next;
        }
        // 这边的不比目录里的旧：以这边的为准写过去（带上目录里那份的时间戳，免得被当成旧份拒掉）
        chatDiskStamps.set(c.id, item.savedAt);
        const theirs = chatJson(normalizeConversation(item.conversation));
        chatBases.set(c.id, theirs);
        if (item.savedAt < stamp || unsaved || hashText(theirs) !== hash) push.add(c.id);
        else settled.add(c.id);
        return c;
      })
      .filter(Boolean);
    if (dropped) toast(dropped === 1 ? t("有一段对话已在别处删除，此处随之移去") : t`有 ${dropped} 段对话已在别处删除，此处随之移去`);
    const known = new Set(store.conversations.map(c => c.id));
    for (const item of disk.values())
      if (!known.has(item.id)) {
        const c = normalizeConversation(item.conversation);
        chatStamps.set(c.id, item.savedAt);
        chatDiskStamps.set(c.id, item.savedAt);
        const json = chatJson(c);
        chatBases.set(c.id, json);
        chatHashes.set(c.id, hashText(json));
        store.conversations.push(c);
        if (!discardedChatSpills.has(c.id)) settled.add(c.id);
        changed = true;
        if (c.id === currentId) currentReplaced = true;
      }
    void clearSavedChatSpills(root, new Map([...settled].filter(id => !discardedChatSpills.has(id)).map(id => [id, chatBases.get(id)])));
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
    // 显示磁盘正版不等 IndexedDB；清扫则等这批可能有新引用的暂存查完。
    void settleAttachmentStore(clearDiscardedChatSpills().then(ready => ready && spillsReady));
  } catch (error) {
    if (!sameRoot()) return;
    // 巡检里重试也没读成的不再说一遍
    if (!chatsBroken) toast(t`对话目录不可用，先存在浏览器里：${String(error.message || error).slice(0, 60)}`);
    chatsBroken = true;
  } finally {
    if (chatsSyncing === work) chatsSyncing = null;
  }
}
