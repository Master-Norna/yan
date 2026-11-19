// 言 · 备份：导出与导入
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
async function exportData(includeFiles) {
  // 备份不带密钥：模型与专司（审查、生图）的 API Key，MCP 配置里的环境变量与请求头（令牌多在这两处）；可选带上附件原件
  // 另存出去的行迹（见 01-store/35-cold.js）先一段段接回来；备份是整份的，不带 cold 记号——换一台机器导入，那边没有这些另存的文件
  for (const c of store.conversations) await warmConversation(c);
  const unwarmed = store.conversations.reduce((sum, c) => sum + everyMessage(c).filter(m => m.cold && !warmMessages.has(m)).length, 0),
    whole = (/** @type {string} */ key, /** @type {any} */ value) => (key === "cold" ? undefined : value);
  if (unwarmed) toast(t`有 ${unwarmed} 答另存的行迹没能取回，备份里缺它们的思绪与帮手经过`);
  const mcpServers = Object.fromEntries(Object.entries(store.settings.mcpServers).map(([name, { env, headers, ...rest }]) => [name, rest]));
  /** @type {Store & { exportedAt: string, attachments?: Attachment[] }} */
  const safeStore = {
    ...store,
    settings: {
      ...store.settings,
      mcpServers,
      dutyReview: { ...store.settings.dutyReview, apiKey: "" },
      dutyImage: { ...store.settings.dutyImage, apiKey: "" }
    },
    profiles: store.profiles.map(profile => ({ ...profile, apiKey: "" })),
    exportedAt: now()
  };
  let blob,
    files = 0;
  const missing = [];
  if (includeFiles) {
    // 附件原件只带仍在用的那几件：存储目录与浏览器里的暂存都翻，谁有取谁。原件合起来可能上 GB，
    // 拼成一个大字符串会超出浏览器的字符串上限、点了没反应——一件一件接进 Blob，内存里只过一件
    toast(t("正在收拢附件原件…"));
    blob = new Blob([`${JSON.stringify(safeStore, whole).slice(0, -1)},"attachments":[`], { type: "application/json" });
    for (const id of attachmentKeepIds()) {
      const record = await getAttachment(id).catch(() => null);
      if (!record) {
        // 取不到的原件照样略过，但要照实说：不能让人以为备份是完整的（与冷行迹取不回来时的提示同一个原则）
        missing.push(attachmentNameOf(id));
        continue;
      }
      blob = new Blob([blob, files ? "," : "", JSON.stringify(record)], { type: "application/json" });
      uncacheAttachment(id);
      files += 1;
    }
    blob = new Blob([blob, "]}"], { type: "application/json" });
  } else blob = new Blob([JSON.stringify(safeStore, whole, 2)], { type: "application/json" });
  downloadHref(URL.createObjectURL(blob), t`言-备份-${new Date().toISOString().slice(0, 10)}.json`, true);
  toast(
    includeFiles
      ? t`备份已导出（含 ${files} 件附件原件${missing.length ? t`，${missing.length} 件未能取到：${missing.slice(0, 3).join("、")}${missing.length > 3 ? "…" : ""}` : ""}）；不含 API Key`
      : t("备份已导出；不含 API Key"),
    missing.length ? 8000 : undefined
  );
}
// 附件 id 对应的名字：导出时点出哪几件没带上
/** @param {string} id */
function attachmentNameOf(id) {
  for (const message of store.conversations.flatMap(everyMessage))
    for (const attachment of message.attachments || []) if (attachment.id === id) return attachment.name || id;
  return id;
}
// 大备份里附件数组的读法：从 `,"attachments":[` 之后逐字节走，括号配平了才交出一件，内存里只过一件。
// 走到末尾还要核对确实收了口：数组的 `]`、顶层的 `}` 都在，其后只有空白。复制、下载断在中途的备份不能当完整的，
// 否则尾部原件悄悄没了、提示还是「已导入」（见 importData 的 incomplete）
/** @param {Uint8Array} bytes @param {number} from 数组内容的起点 */
function attachmentReader(bytes, from) {
  const decoder = new TextDecoder(),
    blank = b => b === 32 || b === 9 || b === 10 || b === 13;
  return (async function* () {
    let depth = 0,
      inString = false,
      escaped = false,
      start = -1,
      closed = false,
      after = bytes.length;
    for (let i = from; i < bytes.length; i++) {
      const b = bytes[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (b === 92) escaped = true;
        else if (b === 34) inString = false;
        continue;
      }
      if (b === 34) inString = true;
      else if (b === 123) {
        if (depth++ === 0) start = i;
      } else if (b === 125) {
        if (--depth === 0) yield JSON.parse(decoder.decode(bytes.subarray(start, i + 1)));
      } else if (b === 93 && depth === 0) {
        closed = true;
        after = i + 1;
        break;
      }
    }
    let i = after;
    while (i < bytes.length && blank(bytes[i])) i += 1;
    const whole = closed && !inString && depth === 0 && bytes[i] === 125;
    if (whole) while (++i < bytes.length && blank(bytes[i]));
    if (!whole || i < bytes.length) throw Object.assign(Error(t("备份文件不完整，尾部在复制或下载时断掉了")), { code: "truncated" });
  })();
}
// 读备份：小的整份解析；带着上百 MB 附件原件的，整份读成一个字符串会超出浏览器的上限——按字节找到末尾的附件数组，
// 前面的记录照常解析，原件一件一件解出来交给调用者，内存里只过一件
async function readBackup(file) {
  if (file.size < 128 * MB) {
    const data = JSON.parse(await readFile(file, "text"));
    return {
      data,
      attachments: (async function* () {
        yield* Array.isArray(data.attachments) ? data.attachments : [];
      })()
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer()),
    decoder = new TextDecoder(),
    marker = new TextEncoder().encode(',"attachments":[');
  // 附件数组是导出时最后接上的一项，原件里的引号都转义过，从末尾往前找到的第一处就是它
  let at = -1;
  for (let i = bytes.lastIndexOf(marker[0]); i >= 0; i = i > 0 ? bytes.lastIndexOf(marker[0], i - 1) : -1)
    if (marker.every((b, k) => bytes[i + k] === b)) {
      at = i;
      break;
    }
  if (at < 0) return { data: JSON.parse(decoder.decode(bytes)), attachments: (async function* () {})() };
  const data = JSON.parse(`${decoder.decode(bytes.subarray(0, at))}}`);
  // 末尾的收口在 attachmentReader 里核对：读到半截即抛，前面已读出的照旧交出
  data.attachments = true;
  return { data, attachments: attachmentReader(bytes, at + marker.length) };
}
// 导入采用合并策略：按 id 跳过已存在的对话 / 模型 / 分组 / 预设，MCP 服务按名字跳过，附件原件只在本机缺失时写入。
// 分组与预设要随对话一起回来：对话里记着 groupId、presetId，定义不在，组织方式与提示词就丢了
async function importData(file) {
  const scope = bootstrap.store,
    filesHome = bootstrap.work?.files || "";
  let backup, incoming;
  try {
    backup = await readBackup(file);
    const { data } = backup;
    if (!data || !Number.isInteger(data.version) || data.version < 1 || data.version > STORE_VERSION || !Array.isArray(data.conversations))
      throw Error(t("不是言的备份文件，或版本不兼容"));
    // 与开页共用迁移和规整，不把半成品压缩分隔等旧数据留到下一次刷新。
    incoming = normalizeStoreData(data);
  } catch (error) {
    toast(t`导入失败：${String(error.message || error).slice(0, 80)}`);
    return;
  }
  const rootChanged = () => toast(t("导入期间存储位置已变化，请检查已保存的内容"), 8000);
  const sameRoot = () => {
    if (bootstrap.store === scope) return true;
    rootChanged();
    return false;
  };
  if (!sameRoot()) return;
  const known = new Set(store.conversations.map(c => c.id));
  const conversations = [];
  let added = 0,
    drafts = 0,
    deleting = 0;
  for (const c of incoming.conversations)
    if (c?.id && !known.has(c.id) && Array.isArray(c.messages)) {
      if (chatDeletePending(c.id)) {
        deleting += 1;
        continue;
      }
      store.conversations.push(c);
      markDirty(c.id);
      conversations.push(c.id);
      known.add(c.id);
    }
  const profileIds = new Set(profiles().map(p => p.id));
  for (const p of incoming.profiles)
    if (p?.id && !profileIds.has(p.id)) {
      store.profiles.push({ ...p, apiKey: p.apiKey || "" });
      added += 1;
    }
  const groupIds = new Set(store.settings.groups.map(g => g.id)),
    presetIds = new Set(store.settings.presets.map(p => p.id));
  let groups = 0,
    presets = 0,
    servers = 0;
  for (const g of incoming.settings.groups)
    if (g?.id && !groupIds.has(g.id)) {
      store.settings.groups.push(g);
      groups += 1;
    }
  for (const p of incoming.settings.presets)
    if (p?.id && !presetIds.has(p.id)) {
      store.settings.presets.push(p);
      presets += 1;
    }
  // 备份里的 MCP 服务不带环境变量与请求头（令牌多在那里），导入后要用到密钥的需自己补上
  for (const [name, config] of Object.entries(incoming.settings.mcpServers || {}))
    if (!store.settings.mcpServers[name] && config && typeof config === "object") {
      store.settings.mcpServers[name] = config;
      servers += 1;
    }
  for (const [key, draft] of Object.entries(incoming.drafts))
    if (!store.drafts[key] && (draft.text || draft.attachments.length || draft.quote)) {
      store.drafts[key] = draft;
      drafts += 1;
    }
  // 记忆一类一项：同名一类的全文接上去（一字不差的行不重接，见 normalizeMemory），没有的类添上。
  const memoryWas = new Map(store.memory.items.map(item => [item.category, item.text]));
  store.memory = normalizeMemory({ ...store.memory, items: [...store.memory.items, ...incoming.memory.items] });
  const memories = store.memory.items.filter(item => memoryWas.get(item.category) !== item.text);
  const activeBefore = store.settings.activeProfileId;
  if (!profiles().some(p => p.id === activeBefore)) store.settings.activeProfileId = profiles()[0]?.id || "";
  const otherConfig = !!(added || groups || presets || servers || drafts || activeBefore !== store.settings.activeProfileId),
    configChanged = otherConfig || !!memories.length;

  // 大备份一件一件读。无法写入的原件不计成已恢复，也不挡住后面的原件。
  const files = [];
  let attachmentError = "",
    unreadable = "",
    failed = 0;
  try {
    for await (const record of backup.attachments) {
      if (!sameRoot()) return;
      try {
        if (!record?.id || record.data == null) throw Error(t("缺少附件内容"));
        if (await getAttachment(record.id, { scoped: true })) continue;
        if (!sameRoot()) return;
        files.push(await putAttachment(record, null, filesHome));
      } catch (error) {
        if (attachmentStoreMoved(error)) return rootChanged();
        failed += 1;
        attachmentError ||= String(error.message || error).slice(0, 80);
      }
    }
  } catch (error) {
    unreadable = String(error.message || error).slice(0, 80);
  }
  if (!sameRoot()) return;

  // 配置和对话分开确认；排入写队列不算写成。只等本批对话，别把无关的长答也算进来。
  if (configChanged) writeMeta();
  const [diskConfig, chats] = await Promise.all([
    configChanged && flushConfig().catch(() => false),
    flushImportedConversations(conversations)
  ]);
  if (!sameRoot()) return;
  // 同类记忆落盘冲突仍以磁盘为准；不能把被合并舍弃的备份正文计入成功。
  const memoryNow = new Map(store.memory.items.map(item => [item.category, item.text])),
    lostMemories = memories.filter(item => memoryNow.get(item.category) !== item.text).length,
    configKept = otherConfig || memories.length > lostMemories,
    browserConfig = configKept && !diskConfig && writeMeta();
  render();
  if (!$("#settingsModal").classList.contains("hidden")) renderSettings();
  const parts = [];
  const present = new Set(store.conversations.map(c => c.id)),
    chatReceipts = chats.map((where, i) => (present.has(conversations[i]) ? where || "page" : null));
  for (const where of ["disk", "browser", "page"]) {
    const n = chatReceipts.filter(item => item === where).length,
      m = files.filter(item => item === where).length,
      config = (diskConfig ? "disk" : browserConfig ? "browser" : "page") === where && configKept;
    const items = [n ? t`${n} 段对话` : "", m ? t`${m} 件附件原件` : "", config ? t("配置（含模型、分组、预设、草稿等）") : ""].filter(
      Boolean
    );
    if (!items.length) continue;
    const names = items.join(t("、"));
    parts.push(
      where === "disk"
        ? t`已写入存储目录：${names}`
        : where === "browser"
          ? t`已在此浏览器暂存：${names}`
          : t`只留在本页：${names}。请先别关闭页面`
    );
  }
  const removed = chatReceipts.filter(where => !where).length;
  if (removed) parts.push(t`${removed} 段对话已不在本页，未能确认保存`);
  if (lostMemories) parts.push(t`${lostMemories} 类记忆与存储目录里的版本冲突，未并入`);
  if (deleting) parts.push(t`${deleting} 段对话尚在等删除确认，未导入`);
  if (failed) parts.push(t`${failed} 件附件原件未能恢复：${attachmentError}`);
  if (unreadable) parts.push(t`未能读完备份：${unreadable}；已读到的部分按上述结果保存`);
  if (!backup.data.attachments && conversations.length) parts.push(t("备份不含附件原件，缺失的旧附件会显示为不可用"));
  if (servers) parts.push(t("MCP 服务的密钥需重填"));
  toast(parts.length ? parts.join(t("；")) : t("备份中没有需要并入的新内容"), 8000);
}
