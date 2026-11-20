// 言 · 本地存储 · 开页：读出启动镜像，立起整页共用的 store（对话随后从存储根补齐，见 hydrateStore）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
/** @type {Store} */
let store = loadStore();
// 给端到端测试看内存里的记录（对话不再整份镜像在 localStorage 里，测试没别的地方读）
window.__yanState = () => store;
window.__yanSave = () => saveStore();
// 归当前存储根的接口：发起时定下根，回话仍归这一回。换根原地进行，旧请求不能跟着去新处读写或递信。
async function storeBridge(path, payload, signal = undefined) {
  const scope = bootstrap.store;
  const data = await bridge(path, { ...payload, root: scope?.root }, signal);
  if (bootstrap.store !== scope) throw new DOMException("存储位置已变化", "AbortError");
  return data;
}
async function switchStoreRoot(data) {
  // 保存尚未落稳的旧根状态。拷贝不是移动：原处以后重新接用时，仍能读回归它的这份暂存。
  rememberLegacyChatDir();
  const oldSpills = keepChatSpills(collectChatSpills()).catch(() => toast(t("本机对话存储失败，请先导出备份"))),
    deletes = [...pendingChatDeletes].filter(([id]) => chatDeletePending(id));
  clearTimeout(saveTimer);
  saveTimer = null;
  resetConfigSync();
  const { moved: _moved, adopted: _adopted, previous: _previous, busy: _busy, busyCount: _busyCount, ...where } = data;
  bootstrap.store = { ...where, fresh: false };
  bootstrap.work = {
    ...bootstrap.work,
    home: data.work || bootstrap.work?.home,
    chats: data.chats,
    archive: data.archive,
    files: data.files
  };
  chatsBroken = chatsLoaded = chatSaveWarned = false;
  chatsSkipped = 0;
  chatsSyncing = null;
  for (const state of [
    chatDiskStamps,
    chatDiskWrites,
    pendingChatWrites,
    activeChatWrites,
    chatWritePromises,
    deletedChatIds,
    pendingChatDeletes,
    pendingChatDeleteDirs,
    discardedChatSpills,
    lostTrails,
    warming
  ])
    state.clear();
  // 拷贝时磁盘见过的时刻作废，三方合并的旧正文不作废：否则 B 里复制来的旧题会覆盖 A 尚未落盘的新题。
  if (data.adopted) for (const state of [dirtyChatIds, chatHashes, chatStamps, chatBases]) state.clear();
  resetChatLeases();
  resetEnvStatus();
  readChatDeleteMarkers([]);
  // 只有拷贝迁移才复制删除意图；原处也保留其删除记号，不能改写成目标根。
  if (!data.adopted)
    for (const [id, at] of deletes)
      if (at > (pendingChatDeletes.get(id) ?? -1)) {
        pendingChatDeletes.set(id, at);
        setChatDeleteDir(id, data.chats);
      }
  let spillsReady = true;
  if (data.adopted) {
    // 先卸下旧根的活对象，不能让全量同步把 A 的独有对话或同 ID 冷指针推往 B。
    store.conversations = [];
    store.drafts = {};
    closeSidePanel();
    closeHelperPanel();
    scrollPositions.clear();
    currentId = editingMessageId = renamingId = renamingSection = null;
    pendingAttachments = [];
    pendingProfileId = "";
    pendingQuote = null;
    view = "chat";
    const disk = await storeBridge("/api/store/config/load", {}, AbortSignal.timeout(20000)).catch(() => null);
    adoptConfig(disk?.config || {}, Number(disk?.savedAt) || 0, "", { preserveEditor: false });
    spillsReady = await readChatSpills();
  } else saveConfigNow({ force: true });
  await syncChatsWithDisk({ spillsReady });
  if (data.adopted) {
    restorePlace();
    render();
  }
  rewatchBackground();
  void reconcileTimers();
  try {
    localStorage.setItem(STORE_ROOT_KEY, data.root);
  } catch {}
  await oldSpills;
}
