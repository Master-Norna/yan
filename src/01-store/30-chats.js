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
