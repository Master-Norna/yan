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
      dutyMemory: { ...store.settings.dutyMemory, apiKey: "" },
      dutyImage: { ...store.settings.dutyImage, apiKey: "" }
    },
    profiles: store.profiles.map(profile => ({ ...profile, apiKey: "" })),
    exportedAt: now()
  };
  let blob,
    files = 0;
  if (includeFiles) {
    // 附件原件只带仍在用的那几件：存储目录与浏览器里的暂存都翻，谁有取谁。原件合起来可能上 GB，
    // 拼成一个大字符串会超出浏览器的字符串上限、点了没反应——一件一件接进 Blob，内存里只过一件
    toast(t("正在收拢附件原件…"));
    blob = new Blob([`${JSON.stringify(safeStore, whole).slice(0, -1)},"attachments":[`], { type: "application/json" });
    for (const id of attachmentKeepIds()) {
      const record = await getAttachment(id).catch(() => null);
      if (!record) continue;
      blob = new Blob([blob, files ? "," : "", JSON.stringify(record)], { type: "application/json" });
      uncacheAttachment(id);
      files += 1;
    }
    blob = new Blob([blob, "]}"], { type: "application/json" });
  } else blob = new Blob([JSON.stringify(safeStore, whole, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = t`言-备份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(t`备份已导出${includeFiles ? t`（含 ${files} 件附件原件）` : ""}；不含 API Key`);
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
  async function* attachments() {
    let depth = 0,
      inString = false,
      escaped = false,
      start = -1;
    for (let i = at + marker.length; i < bytes.length; i++) {
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
      } else if (b === 93 && depth === 0) break;
    }
  }
  data.attachments = true;
  return { data, attachments: attachments() };
}
// 导入采用合并策略：按 id 跳过已存在的对话 / 模型 / 分组 / 预设，MCP 服务按名字跳过，附件原件只在本机缺失时写入。
// 分组与预设要随对话一起回来：对话里记着 groupId、presetId，定义不在，组织方式与提示词就丢了
async function importData(file) {
  try {
    const { data, attachments } = await readBackup(file);
    if (!data || !Number.isInteger(data.version) || data.version < 1 || data.version > STORE_VERSION || !Array.isArray(data.conversations))
      throw Error(t("不是言的备份文件，或版本不兼容"));
    // 旧版备份先按启动时同一套迁移与规整过一遍（workAuto → commandPolicy、去掉半成品的压缩分隔……），别等下次刷新才对
    const incoming = normalizeStoreData(data);
    const known = new Set(store.conversations.map(c => c.id));
    let conversations = 0,
      added = 0,
      drafts = 0,
      files = 0;
    for (const c of incoming.conversations)
      if (c?.id && !known.has(c.id) && Array.isArray(c.messages)) {
        store.conversations.push(c);
        markDirty(c.id);
        conversations += 1;
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
    for await (const record of attachments)
      if (record?.id && record.data !== undefined && !(await getAttachment(record.id))) {
        await putAttachment(record);
        uncacheAttachment(record.id);
        files += 1;
      }
    // 记忆一类一项：同名一类的全文接上去（一字不差的行不重接，见 normalizeMemory），没有的类添上
    const memoryWas = new Map(store.memory.items.map(item => [item.category, item.text]));
    store.memory = normalizeMemory({ ...store.memory, items: [...store.memory.items, ...incoming.memory.items] });
    const memories = store.memory.items.filter(item => memoryWas.get(item.category) !== item.text).length;
    if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
    saveStore();
    render();
    renderSettings();
    toast(
      t`已导入 ${conversations} 段对话、${added} 个模型${groups ? t`、${groups} 个分组` : ""}${presets ? t`、${presets} 个预设` : ""}${servers ? t`、${servers} 个 MCP 服务（密钥需重填）` : ""}${drafts ? t`、${drafts} 份草稿` : ""}${memories ? t`、${memories} 类记忆` : ""}${files ? t`，恢复 ${files} 件附件原件` : ""}${data.attachments ? "" : t("；备份不含附件原件，旧附件将显示为不可用")}`
    );
  } catch (error) {
    toast(t`导入失败：${String(error.message || error).slice(0, 80)}`);
  }
}
