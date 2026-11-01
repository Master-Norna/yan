// 言 · 本地存储 · 开页：读出启动镜像，立起整页共用的 store（对话随后从存储根补齐，见 hydrateStore）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 放在存储各段之后：读记录、规整、迁移要用的常量与簿记都已立起
/** @type {Store} */
let store = loadStore();
// 给端到端测试看内存里的记录（对话不再整份镜像在 localStorage 里，测试没别的地方读）
window.__yanState = () => store;
window.__yanSave = () => saveStore();
// 存储根换了位置（设置 → 通用，桥接已整份拷过去或认了那边原有的）：引导信息换成新路径，对话的指纹与时间戳作废，
// 配置照新处的来（认了那边原有的）或把这边的推过去（拷过去的），再与新处的对话目录对一遍
async function switchStoreRoot(data) {
  // 新处的各条路径整份换上（技能目录审查要认，见 insideSkills），只去掉这一回迁移本身的结果
  const { moved: _moved, adopted: _adopted, previous: _previous, busy: _busy, busyCount: _busyCount, ...where } = data;
  bootstrap.store = { ...where, fresh: false };
  bootstrap.work = { ...bootstrap.work, chats: data.chats, archive: data.archive, files: data.files };
  chatsBroken = false;
  chatHashes.clear();
  chatStamps.clear();
  chatDiskStamps.clear();
  chatBases.clear();
  chatDiskWrites.clear();
  // 搬到一个已有言数据的地方：那边的配置为准；拷过去的：这边的就是那边的
  if (data.adopted) {
    configBase = "";
    configSyncedAt = 0;
    const disk = await bridge("/api/store/config/load", {}, AbortSignal.timeout(20000)).catch(() => null);
    if (disk?.config) adoptConfig(disk.config, Number(disk.savedAt) || 0);
  } else saveConfigNow({ force: true });
  await syncChatsWithDisk();
  const ids = store.conversations.map(conversation => conversation.id);
  flushConversations(ids, { force: true });
  try {
    localStorage.setItem(STORE_ROOT_KEY, data.root);
  } catch {}
}
