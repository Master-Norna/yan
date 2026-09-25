// 言 · 本地存储 · 配置：配置.json 的读写与三方合并（几个浏览器共用一份）
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 配置.json ----------
// 改动后一秒内写一次（含 API Key：这是自己机器上的文件，几个浏览器共用一套模型配置靠的就是它；导出的备份仍不含）。
// 几个浏览器共用一份，靠的是「基准」：记着上次与磁盘对齐时的那一份（configBase，连同它在磁盘上的时间戳 configSyncedAt）。
// 写的时候带上这个时间戳，磁盘上若已有别处写过的更新的一份，桥接不写、把那份交回来；这边就按基准做三方合并——
// 自己改过的取自己的，没改的取对方的——再写一次。基准记在 localStorage 里，关了页面再开也接得上
const CONFIG_BASE_KEY = "yan-config-base";
let configBase = "",
  configSaving = false,
  configSaveAgain = false,
  configSaveFailures = 0;
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
      const meta = JSON.parse(saved.meta);
      if (!meta || !meta.settings || typeof meta.settings !== "object" || !Array.isArray(meta.profiles)) return;
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
      if (!response.ok) throw Error(data.error || `请求失败（${response.status}）`);
      configSaveFailures = 0;
      rememberConfigBase(meta, Number(data.savedAt) || savedAt);
    })
    .catch(error => {
      if (unloading) return;
      if (!configSaveFailures) toast(`配置尚未写入存储目录，稍后重试：${String(error.message || error).slice(0, 60)}`);
      configSaveFailures += 1;
      clearTimeout(configSaveTimer);
      configSaveTimer = setTimeout(saveConfigNow, Math.min(5000 * 2 ** Math.min(configSaveFailures - 1, 4), 60000));
    })
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
  // 基准丢了就无法判断本地缓存的默认值是不是用户刚改的。磁盘是正本；只补入本地独有的记录，
  // 再以磁盘为基准写回，免得把已装工具、模型等配置退回默认值。
  if (!configBase) return mergeUnbasedConfig(config, savedAt);
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
  const baseSettings = base.settings || {},
    mineSettings = mine.settings || {},
    theirSettings = theirs.settings || {},
    settings = keyed(baseSettings, mineSettings, theirSettings),
    has = key => key in baseSettings || key in mineSettings || key in theirSettings;
  if (has("presets"))
    settings.presets = byId(baseSettings.presets, mineSettings.presets, theirSettings.presets, (b, m, t) => keyed(b, m, t));
  if (has("groups")) settings.groups = byId(baseSettings.groups, mineSettings.groups, theirSettings.groups, (b, m, t) => keyed(b, m, t));
  if (has("mcpServers")) settings.mcpServers = keyed(baseSettings.mcpServers, mineSettings.mcpServers, theirSettings.mcpServers);
  if (has("env")) {
    const oldEnv = { ...defaultStore.settings.env, ...(baseSettings.env || {}) },
      myEnv = mineSettings.env || {},
      theirEnv = theirSettings.env || {};
    settings.env = keyed(oldEnv, myEnv, theirEnv);
    // 勾选清单按每一组的增删合并：两处各添一组，不会让后写者把先写者的整份清单替掉。
    const oldPacks = new Set(oldEnv.packs || []),
      myPacks = new Set(myEnv.packs || []),
      theirPacks = new Set(theirEnv.packs || []);
    settings.env.packs = [...new Set([...theirPacks, ...myPacks])].filter(id =>
      (myPacks.has(id) !== oldPacks.has(id) ? myPacks : theirPacks).has(id)
    );
  }
  return {
    version: theirs.version ?? mine.version,
    settings,
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
  store.settings = {
    ...store.settings,
    ...disk.settings,
    // 旧版磁盘配置根本没有「环境」项时，别让规范化补出的默认三组盖掉本地已有选择。
    env: config.settings?.env && typeof config.settings.env === "object" ? disk.settings.env : store.settings.env || disk.settings.env,
    presets: union(disk.settings.presets, store.settings.presets || []),
    groups: union(disk.settings.groups, store.settings.groups || []),
    mcpServers: { ...(store.settings.mcpServers || {}), ...(disk.settings.mcpServers || {}) }
  };
  store.profiles = union(disk.profiles, store.profiles);
  store.library = union(disk.library, store.library);
  store.memory = { enabled: disk.memory.enabled, items: union(disk.memory.items, store.memory.items) };
  store.drafts = { ...store.drafts, ...disk.drafts };
  if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
}
// 没有可用的共同基准（旧版缓存、浏览器只丢了基准、头一回碰到另一个存储根）时，
// 让磁盘上的设置优先，按 id 补入本地独有的记录；差集仍用时间戳保护后写。
function mergeUnbasedConfig(config, savedAt) {
  const disk = JSON.stringify(metaOf(normalizeStoreData({ ...config, conversations: [] })));
  mergeConfig(config);
  const merged = metaOf();
  adoptConfig(merged, savedAt, disk);
  if (JSON.stringify(metaOf()) !== disk) saveConfigNow();
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
    if (!disk.config) {
      writeMeta({ disk: false });
      saveConfigNow({ force: true });
    } else if (freshBrowser) adoptConfig(disk.config, Number(disk.savedAt) || 0);
    else if (localSeeded || met !== (info.root || "")) mergeUnbasedConfig(disk.config, Number(disk.savedAt) || 0);
    else reconcileConfig(disk.config, Number(disk.savedAt) || 0);
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
