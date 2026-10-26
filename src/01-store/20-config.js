// 言 · 本地存储 · 配置：配置.json 的读写与三方合并（几个浏览器共用一份）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
let configSaveTimer = null,
  configSyncedAt = 0;
// ---------- 配置.json ----------
// 改动后一秒内写一次（含 API Key：这是自己机器上的文件，几个浏览器共用一套模型配置靠的就是它；导出的备份仍不含）。
// 几个浏览器共用一份，靠的是「基准」：记着上次与磁盘对齐时的那一份（configBase，连同它在磁盘上的时间戳 configSyncedAt）。
// 写的时候带上这个时间戳，磁盘上若已有别处写过的更新的一份，桥接不写、把那份交回来；这边就按基准做三方合并——
// 自己改过的取自己的，没改的取对方的——再写一次。基准记在 localStorage 里，关了页面再开也接得上
const CONFIG_BASE_KEY = "yan-config-base",
  CONFIG_SENT_KEY = "yan-config-sent";
let configBase = "",
  configSaving = false,
  configSaveAgain = false,
  configRefreshQueued = false,
  configSaveFailures = 0;
// 发出去的几份（按 savedAt 记，连同那时这边花了多少墨）：写进了磁盘却没听到回音——超时、页面关了——下回读到的「别处的新版」
// 其实是自己这份，认出来先作基准再比，不然三方合并把自己的改动当成对方的再算一遍
const sentConfigs = new Map();
function rememberSentConfig(savedAt, meta, spent = Object.fromEntries(spentHere)) {
  sentConfigs.set(savedAt, { meta, spent });
  for (const key of sentConfigs.keys()) if (sentConfigs.size > 8) sentConfigs.delete(key);
}
// 用量不靠基准相减：这边花了多少、其中多少已确认写进磁盘，按模型各记一个累计数，合并时取磁盘上的、加上还没确认的那一截。
// 基准一旦认错（回音丢了、页面关了），相减会把自己花的整份当成对方的再加一遍、一回翻一倍；这样顶多把没确认的那一截多记一回
const spentHere = new Map(),
  spentSettled = new Map();
function noteSpend(id, amount) {
  spentHere.set(id, (spentHere.get(id) || 0) + amount);
}
function unsettledSpend(id) {
  return Math.max(0, (spentHere.get(id) || 0) - (spentSettled.get(id) || 0));
}
// 某次写入落了盘：它带着的那些都算确认了（之后谁再写，都是在它之上合并的）
function settleSpend(spent) {
  for (const [id, amount] of Object.entries(spent || {})) spentSettled.set(id, Math.max(spentSettled.get(id) || 0, Number(amount) || 0));
}
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
    // 上回离页时还没确认的：没等到回音的几份，与还没确认落盘的墨
    const sent = JSON.parse(localStorage.getItem(CONFIG_SENT_KEY) || "null");
    if (sent?.root === (bootstrap.store?.root || "")) {
      for (const [id, amount] of Object.entries(sent.unsettled || {})) noteSpend(id, Number(amount) || 0);
      for (const item of Array.isArray(sent.items) ? sent.items : [])
        if (item?.meta) rememberSentConfig(Number(item.savedAt) || 0, String(item.meta), item.spent || {});
    }
  } catch {}
}
// 页面要关：还没确认的记进 localStorage，下回开页认得出磁盘上那份是自己写的、也不丢这几笔墨。
// 累计数换成相对已确认的那一截，下回从零记起
function keepSentConfigs() {
  const relative = spent =>
    Object.fromEntries(Object.entries(spent).map(([id, amount]) => [id, Math.max(0, amount - (spentSettled.get(id) || 0))]));
  const items = [...sentConfigs]
      .filter(([savedAt]) => savedAt > configSyncedAt)
      .map(([savedAt, sent]) => ({ savedAt, meta: sent.meta, spent: relative(sent.spent) })),
    unsettled = Object.fromEntries([...spentHere.keys()].map(id => [id, unsettledSpend(id)]).filter(([, amount]) => amount > 0));
  try {
    if (items.length || Object.keys(unsettled).length)
      localStorage.setItem(CONFIG_SENT_KEY, JSON.stringify({ root: bootstrap.store?.root || "", items, unsettled }));
    else localStorage.removeItem(CONFIG_SENT_KEY);
  } catch {}
}
function scheduleConfigSave() {
  clearTimeout(configSaveTimer);
  configSaveTimer = setTimeout(saveConfigNow, 1000);
}
/** @param {{ force?: boolean }} [options] force：不比时间戳，这边就是定论（头一回立根、以浏览器为准的导入） */
function saveConfigNow({ force = false } = {}) {
  clearTimeout(configSaveTimer);
  configSaveTimer = null;
  // 上一次还在路上：等它回来再写这一次，免得两次互相比时间戳
  if (configSaving && !unloading) {
    configSaveAgain = true;
    return;
  }
  const meta = JSON.stringify(metaOf()),
    spent = Object.fromEntries(spentHere),
    savedAt = Math.max(Date.now(), configSyncedAt + 1),
    body = `{"config":${meta},"savedAt":${savedAt}${force ? "" : `,"base":${configSyncedAt}`}}`;
  configSaving = true;
  rememberSentConfig(savedAt, meta, spent);
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
      if (!response.ok) throw Error(data.error || t`请求失败（${response.status}）`);
      configSaveFailures = 0;
      // 路上已从别处认过更新的一份（对齐时认出了这份，或已合并了更新的）：基准不往回退
      const written = Number(data.savedAt) || savedAt;
      if (written > configSyncedAt) rememberConfigBase(meta, written);
      settleSpend(spent);
      // 配置已落盘：主页面叫每一栏读一回，明暗/字体/朱色不必等下一次布局变动
      if (!PANE) splitRefreshPanes();
    })
    .catch(error => {
      if (unloading) return;
      if (!configSaveFailures)
        toast(
          bridgeTimedOut(error)
            ? t("本机桥接响应超时，配置仍在本页，稍后自动重试")
            : t`配置尚未写入存储目录，稍后重试：${String(error.message || error).slice(0, 60)}`
        );
      configSaveFailures += 1;
      clearTimeout(configSaveTimer);
      configSaveTimer = setTimeout(saveConfigNow, Math.min(5000 * 2 ** Math.min(configSaveFailures - 1, 4), 60000));
    })
    .finally(() => {
      configSaving = false;
      if (configSaveAgain) {
        configSaveAgain = false;
        saveConfigNow();
      } else if (configRefreshQueued) {
        configRefreshQueued = false;
        void refreshConfigFromDisk();
      }
    });
}
// 磁盘上有一份配置：与这边对一对。磁盘上的不比基准新——这边改过就写下去；磁盘上的更新、这边没改过——换进来；
// 两边都改过——三方合并后换进来，再写回去
function reconcileConfig(config, savedAt) {
  // 磁盘上那份正是自己发出的（时间戳对得上、内容一字不差——桥接原样存、原样交回）：先认它作基准
  const own = sentConfigs.get(savedAt);
  if (own && JSON.stringify(config) === own.meta) {
    settleSpend(own.spent);
    if (savedAt > configSyncedAt) rememberConfigBase(own.meta, savedAt);
  }
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
  adoptConfig(mergeConfig3(JSON.parse(configBase), JSON.parse(mine), theirs, unsettledSpend), savedAt, JSON.stringify(theirs));
  saveConfigNow();
}
// 三方合并：base 是上次对齐时的那份。同一样东西，自己没动过的取对方的，自己动过的取自己的；
// 模型、卷宗、记忆按 id 逐件比，设置与草稿按键逐项比；用量取对方的、加上这边还没确认写下的（unsettled，缺省按基准相减），不互相抹掉
function mergeConfig3(base, mine, theirs, unsettled = null) {
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
    if (b && same(m.quota, b.quota) && same(t.quota, b.quota)) {
      const mineNew = unsettled ? unsettled(m.id) : Number(m.usedTokens || 0) - Number(b.usedTokens || 0);
      out.usedTokens = Math.max(0, Number(t.usedTokens || 0) + mineNew);
    }
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
// 与 配置.json 对一次：开页接上桥接时、桥接断了又接上时、页面从后台切回来时。看两边谁新：
// 全新的浏览器取磁盘那份；灌进来的（没带版本标记的旧记录）以浏览器为准；这台浏览器头一回碰上这个根就合并；其余按时间戳，新的为准
async function syncConfigWithDisk() {
  const info = bootstrap.store || {};
  let met = "";
  try {
    met = localStorage.getItem(STORE_ROOT_KEY) || "";
  } catch {}
  // 桥接落在一个全新的根上，这台浏览器上回用的却是别处：多半是记位置的条子没了，说一声，免得以为数据丢了
  const strayed = info.fresh && met && met.toLowerCase() !== String(info.root || "").toLowerCase();
  try {
    const disk = await bridge("/api/store/config/load", {}, AbortSignal.timeout(20000));
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
    if (strayed) toast(t`存储落在了 ${pathTail(info.root || "")}，上回用的是 ${met}；在设置 → 通用的「存储位置」填回去即可`, 8000);
    followLanguage();
  } catch (error) {
    toast(t`配置未能与存储目录对齐：${String(error.message || error).slice(0, 60)}`);
  }
}
// 开页时对齐来的配置换了界面语言（这台浏览器头一回打开、存储里记着英文，或别处改过）：译文表只在开页时载得进来，
// 存下即重新载入一回。只在开页这一次跟：切回页面时再跟，就把正在作答的打断了。
// 重载过还没换过来（如直接打开 index.html 载不进译文表）就不再重载，免得来回转；换过来了即撤下记号，往后别处再改照样跟
function followLanguage() {
  const want = store.settings.language;
  if (!want || want === LANG) {
    try {
      sessionStorage.removeItem("yan-language-reload");
    } catch {}
    return;
  }
  try {
    if (sessionStorage.getItem("yan-language-reload") === want) return;
    sessionStorage.setItem("yan-language-reload", want);
  } catch {
    return;
  }
  saveStore();
  location.reload();
}
// 从后台切回来：另一个浏览器可能改过配置，与磁盘上的对一对（这边有没写下去的改动也不丢，见 reconcileConfig）
async function refreshConfigFromDisk() {
  // 正在写盘：记下来，写完再读，别把这次设置漏掉（多栏同开时，栏页可能正存着自己的配置）
  if (configSaving) {
    configRefreshQueued = true;
    return;
  }
  try {
    const disk = await bridge("/api/store/config/load", {}, AbortSignal.timeout(8000));
    if (!disk.config) return;
    if (configSaving) configRefreshQueued = true;
    else reconcileConfig(disk.config, Number(disk.savedAt) || 0);
  } catch {}
}
