// 言 · 右栏：同源页面并排（最多四栏）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 右栏不另起一套界面：同一页面以 ?pane=side&slot=N&c=<id> 嵌在主页面右侧（PANE / PANE_SLOT 见 00-state.js），
// 每栏都是一处完整页面——作答、存盘、租约都与开两个标签页无异，几处页面同开的那一套（见 01-store/40-leases.js）原样管着。
// 上限四栏：主页面 + 四栏 = 五处同源页面。每处常占一条 EventSource，浏览器对同一 host:port 只开六条 HTTP/1.1 连接，
// 余一条给普通请求；开到第 6 处页面时六条全被事件流占满，所有页面的普通请求（包括总线 send）都会排队卡住（见 server/bus.js）。
// 这里管：栏的开合与槽位、宽窄与总预算、同一段对话只开一栏、逐栏的忙时确认。
// 栏页不接游目（模型所用的浏览器只有一个调试口，见 stageLocate），也不记「停在哪儿」，免得主页面刷新后回到栏里那段
const SPLIT_STORE_KEY = "yan-split-v2";
const LEGACY_SPLIT_KEY = "yan-split";
const LEGACY_WIDTH_KEY = "yan-split-width";
const SPLIT_MIN_WIDTH = 240;
const SPLIT_DEFAULT_WIDTH = 360;
const MAIN_MIN_WIDTH = 356;
const SIDEBAR_WIDTH = 270;
const SIDEBAR_COLLAPSED_WIDTH = 64;

/** @typedef {{ slot: number, id: string, width: number }} SplitPane */
const split = {
  /** @type {SplitPane[]} */
  panes: [],
  /** @type {SplitPane[]|null} */
  deferred: null,
  /** @type {{ wasCollapsed: boolean }|null} */
  autoSidebar: null,
  sidebarOverride: false,
  /** @type {{ slot: number, startX: number, startWidth: number, mainWidth: number, leftSlot: number, leftWidth: number }|null} */
  drag: null
};
let splitPruning = false;
let splitResizeRaf = 0;

// ---------- 栏这一侧 ----------
// 主页面（同源，直接调得到）；栏页是被单独打开的（父页不是言）时没有
function splitHost() {
  if (!PANE || window.parent === window) return null;
  try {
    return /** @type {any} */ (window.parent).__yanSplit || null;
  } catch {
    return null;
  }
}
// 栏里要开别的对话（候、旧谈、记忆里的出处）：交给主页面开；主页面没了就在自己这里开
function splitHandOff(id) {
  const host = splitHost();
  if (!host) return false;
  host.open(id);
  return true;
}
// 主页面问栏页：手上还有没做完的活吗（作答、后台的帮手、等着的后台指令）——关掉这一栏会断了它们
function paneBusy() {
  return !!(requestJobs.size || crews.size || bgWatches.size);
}
if (PANE) {
  /** @type {any} */ (window).__yanPane = {
    busy: paneBusy,
    id: () => currentId || "",
    slot: PANE_SLOT,
    // 这一栏的事件流接上了没有：主页面拿它从桥接报的总数里减去自家的，余下的是别的标签页、窗口
    bus: () => busOpen,
    // 主页面改了设置（明暗、朱色、字体、模型……）：读一回磁盘上的配置，三方合并后照着重画
    // 这一栏若正存着自己的配置，refreshConfigFromDisk 会把这次读盘排队到存完之后（见 01-store/20-config.js）
    refresh: () => void refreshConfigFromDisk()
  };
}

// ---------- 主页面这一侧：读 ----------
/** @returns {HTMLElement|null} */
function splitRail() {
  return /** @type {HTMLElement|null} */ ($("#splitRail"));
}
/** @param {number} slot @returns {HTMLElement|null} */
function splitPanel(slot) {
  return /** @type {HTMLElement|null} */ (splitRail()?.querySelector(`.split-panel[data-slot="${slot}"]`) || null);
}
/** @param {number} slot @returns {HTMLIFrameElement|null} */
function splitFrame(slot) {
  return /** @type {HTMLIFrameElement|null} */ (splitPanel(slot)?.querySelector(".split-frame") || null);
}
/** @param {number} slot @returns {SplitPane|null} */
function splitEntry(slot) {
  return split.panes.find(p => p.slot === slot) || null;
}
/** @param {string} id @returns {number} */
function splitSlotOf(id) {
  return split.panes.find(p => p.id === id)?.slot ?? -1;
}
/** @param {string} id */
function splitHolds(id) {
  return !PANE && !!id && splitSlotOf(id) >= 0;
}
/** @returns {number} */
// 还能再开几栏：本页四栏的上限，与整个浏览器的连接预算（别的标签页、窗口里开着的言也占着）取小
function splitRoom() {
  const own = split.panes.length;
  let connected = busOpen ? 1 : 0;
  for (const pane of split.panes)
    try {
      if (/** @type {any} */ (splitFrame(pane.slot)?.contentWindow)?.__yanPane?.bus?.()) connected++;
    } catch {}
  // 别处的页面数 = 桥接报的总数 − 本页已接上的；还没报过（0）就只按本页算
  const elsewhere = Math.max(0, busPages - connected);
  return Math.max(0, Math.min(MAX_SPLIT_PANES - own, MAX_BROWSER_PAGES - elsewhere - 1 - own));
}
// 栏满，是本页四栏满了，还是别的标签页、窗口占着连接
function splitFullByOthers() {
  return split.panes.length < MAX_SPLIT_PANES && splitRoom() === 0;
}
function splitFreeSlot() {
  for (let slot = 0; slot < MAX_SPLIT_PANES; slot++) if (!splitEntry(slot)) return slot;
  return -1;
}
/** @param {number} slot @returns {any} */
function splitPaneAt(slot) {
  try {
    const frame = splitFrame(slot);
    return frame ? /** @type {any} */ (frame.contentWindow)?.__yanPane || null : null;
  } catch {
    return null;
  }
}
function splitSidePanelWidth() {
  const panel = $("#sidePanel");
  if (!panel || !sidePanelOpen() || panel.classList.contains("wide")) return 0;
  return panel.offsetWidth;
}
function splitSidebarWidth() {
  return $("#sidebar")?.classList.contains("collapsed") ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
}
/** @param {number} [sidebarWidth] */
function splitBudget(sidebarWidth = splitSidebarWidth()) {
  const app = /** @type {HTMLElement|null} */ ($(".app"));
  return Math.max(0, (app?.clientWidth || 0) - sidebarWidth - splitSidePanelWidth() - MAIN_MIN_WIDTH);
}

// 把 preferred 宽度压进 budget：先按比例缩，夹到每栏最小；仍超出就从最宽的栏逐像素减；有余量按槽位补
/** @param {number[]} preferred @param {number} budget @returns {number[]} */
function allocateSplitWidths(preferred, budget) {
  const count = preferred.length;
  if (!count) return [];
  const total = preferred.reduce((sum, width) => sum + width, 0);
  if (total <= budget) return preferred.map(width => Math.max(SPLIT_MIN_WIDTH, Math.round(width)));
  if (budget <= count * SPLIT_MIN_WIDTH) return preferred.map(() => SPLIT_MIN_WIDTH);
  const scale = budget / total;
  const widths = preferred.map(width => Math.max(SPLIT_MIN_WIDTH, Math.floor(width * scale)));
  let sum = widths.reduce((a, b) => a + b, 0);
  while (sum > budget) {
    let widest = -1;
    for (let i = 0; i < count; i++) if (widths[i] > SPLIT_MIN_WIDTH && (widest < 0 || widths[i] > widths[widest])) widest = i;
    if (widest < 0) break;
    widths[widest]--;
    sum--;
  }
  for (let i = 0; sum < budget; i = (i + 1) % count) {
    widths[i]++;
    sum++;
  }
  return widths;
}

// ---------- 建 DOM：只在主页面生成四块栏壳 ----------
/** @returns {HTMLElement|null} */
function splitRailReady() {
  const rail = splitRail();
  if (!rail) return null;
  if (rail.dataset.built !== "1") {
    for (let slot = 0; slot < MAX_SPLIT_PANES; slot++) {
      const panel = document.createElement("div");
      panel.className = "split-panel hidden";
      panel.dataset.slot = String(slot);
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", t`右栏 ${slot + 1}`);
      const grip = document.createElement("div");
      grip.className = "split-grip";
      grip.dataset.splitGrip = String(slot);
      grip.title = t("拖动调宽窄");
      const frame = document.createElement("iframe");
      frame.className = "split-frame";
      frame.dataset.splitFrame = String(slot);
      frame.title = t("右栏的对话");
      frame.src = "about:blank";
      panel.append(grip, frame);
      rail.appendChild(panel);
      bindSplitGrip(grip);
    }
    rail.dataset.built = "1";
  }
  return rail;
}

// ---------- 开合 ----------
/** @param {SplitPane} pane */
function setSplitFrameSrc(pane) {
  const frame = splitFrame(pane.slot);
  if (frame && splitEntry(pane.slot)?.id === pane.id) frame.src = `./?pane=side&slot=${pane.slot}&c=${encodeURIComponent(pane.id)}`;
}
/** @param {SplitPane} pane @returns {boolean} */
function mountSplitPane(pane) {
  const rail = splitRailReady();
  if (!rail) return false;
  split.panes = split.panes.filter(item => item.slot !== pane.slot);
  split.panes.push({ ...pane });
  split.panes.sort((a, b) => a.slot - b.slot);
  const panel = splitPanel(pane.slot);
  if (panel) panel.classList.remove("hidden");
  rail.classList.remove("hidden");
  document.documentElement.dataset.split = "open";
  setSplitFrameSrc(pane);
  return true;
}
/** @param {SplitPane[]} list */
function mountSplitRestore(list) {
  const all = list.filter(pane => pane.id !== currentId).slice(0, MAX_SPLIT_PANES);
  // 刷新后接着开：别的标签页、窗口占着连接时只挂得下的那几栏，余下的不挂（挂了会把整个浏览器的言卡死）
  const clean = all.slice(0, splitRoom());
  if (clean.length < all.length) toast(t`别的标签页、窗口也开着言，这回只接着开了 ${clean.length} 栏`);
  if (!clean.length) return;
  const rail = splitRailReady();
  if (!rail) return;
  split.deferred = null;
  split.panes = clean.map(pane => ({ ...pane })).sort((a, b) => a.slot - b.slot);
  for (const pane of split.panes) splitPanel(pane.slot)?.classList.remove("hidden");
  rail.classList.remove("hidden");
  document.documentElement.dataset.split = "open";
  // 错峰挂载：四份页面同时启动会抢最后一条普通请求连接
  split.panes.forEach((pane, index) => {
    if (index === 0) setSplitFrameSrc(pane);
    else setTimeout(() => setSplitFrameSrc(pane), index * 150);
  });
  splitSave();
  layoutRail({ mayCollapseSidebar: true });
}
/** @param {string} id @returns {boolean} */
function openSplit(id) {
  if (PANE) return false;
  if (!store.conversations.some(c => c.id === id)) return false;
  const held = splitSlotOf(id);
  if (held >= 0) {
    focusSplit(held);
    return false;
  }
  if (id === currentId) {
    toast(t("这段对话正开在左边"));
    return false;
  }
  if (isMobile()) {
    toast(t("窗口太窄，右栏开不了"));
    return false;
  }
  if (split.panes.length >= MAX_SPLIT_PANES) {
    toast(t("右栏最多四栏，先收起一栏再开"));
    return false;
  }
  if (splitRoom() <= 0) {
    toast(t("这个浏览器里别的标签页、窗口也开着言，连接不够再开一栏；先关掉几处再开"));
    return false;
  }
  // 游目或铺满的旁注会盖住 rail：先收起来，新栏才看得见
  if (stageShown()) closeStage();
  if (sidePanelOpen() && $("#sidePanel").classList.contains("wide")) closeSidePanel();
  const slot = splitFreeSlot();
  if (slot < 0) return false;
  if (!mountSplitPane({ slot, id, width: SPLIT_DEFAULT_WIDTH })) return false;
  splitSave();
  layoutRail({ mayCollapseSidebar: true });
  renderHistory();
  return true;
}
/** @param {number} slot */
function removeSplitPane(slot) {
  split.panes = split.panes.filter(pane => pane.slot !== slot);
  const frame = splitFrame(slot);
  // 换成空页：这一栏那一页照常离页（存草稿、落盘、松开租约）
  if (frame) frame.src = "about:blank";
  splitPanel(slot)?.classList.add("hidden");
}
/** @param {number} slot @returns {Promise<boolean>} */
function splitMayLeave(slot) {
  if (!splitPaneAt(slot)?.busy()) return Promise.resolve(true);
  const many = split.panes.length > 1;
  return askConfirm({
    title: many ? t`右栏第 ${slot + 1} 栏的对话还在作答` : t("右栏的对话还在作答"),
    body: t("关掉右栏会中断它，已写的部分都在。"),
    ok: t("仍要关掉")
  });
}
/** @param {number} slot @param {string} [expectedId] @param {boolean} [force] @returns {Promise<boolean>} */
async function closeSplit(slot, expectedId = "", force = false) {
  const pane = splitEntry(slot);
  if (!pane) return false;
  if (expectedId && pane.id !== expectedId) return false;
  if (!force && !(await splitMayLeave(slot))) return false;
  // 等确认的工夫里这一槽可能已经换了人家：再对一次
  const again = splitEntry(slot);
  if (!again || again.id !== pane.id) return false;
  removeSplitPane(slot);
  splitSave();
  layoutRail({ mayCollapseSidebar: true });
  renderHistory();
  return true;
}
/** @param {number} slot */
function focusSplit(slot) {
  const pane = splitEntry(slot);
  if (!pane) return;
  if (isMobile()) return toast(t("这段对话开在右栏，窗口放宽些即可看到"));
  if (stageShown()) closeStage();
  if (sidePanelOpen() && $("#sidePanel").classList.contains("wide")) closeSidePanel();
  const frame = splitFrame(slot);
  if (!frame) return;
  frame.focus();
  try {
    /** @type {HTMLElement|null} */ (frame.contentDocument?.querySelector("#chatInput"))?.focus();
  } catch {}
  const panel = splitPanel(slot);
  if (panel) {
    panel.classList.remove("flash");
    void panel.offsetWidth;
    panel.classList.add("flash");
    scrollPaneIntoRail(slot);
  }
}
/** @param {number} slot */
function scrollPaneIntoRail(slot) {
  const rail = splitRail();
  const panel = splitPanel(slot);
  if (!rail || !panel) return;
  const left = panel.offsetLeft;
  const right = left + panel.offsetWidth;
  if (left < rail.scrollLeft) rail.scrollLeft = Math.max(0, left - 8);
  else if (right > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = right - rail.clientWidth + 8;
}
/** @param {number} slot @param {number} px */
function splitSetWidth(slot, px) {
  const pane = splitEntry(slot);
  if (!pane) return;
  const others = split.panes.filter(item => item.slot !== slot).reduce((sum, item) => sum + (item.width || SPLIT_DEFAULT_WIDTH), 0);
  const max = Math.max(SPLIT_MIN_WIDTH, splitBudget() - others);
  pane.width = Math.round(Math.max(SPLIT_MIN_WIDTH, Math.min(px, max)));
  layoutRail({ mayCollapseSidebar: false });
}
/** @param {number} slot @param {number} px */
function splitDragTo(slot, px) {
  const drag = split.drag;
  const pane = splitEntry(slot);
  if (!drag || !pane) return;
  const left = drag.leftSlot >= 0 ? splitEntry(drag.leftSlot) : null;
  const target = Math.round(px);
  const delta = target - drag.startWidth;
  if (!delta) return;
  if (delta > 0) {
    const mainRoom = Math.max(0, drag.mainWidth - MAIN_MIN_WIDTH);
    const fromMain = Math.min(delta, mainRoom);
    const leftRoom = left ? Math.max(0, drag.leftWidth - SPLIT_MIN_WIDTH) : 0;
    const fromLeft = Math.min(delta - fromMain, leftRoom);
    const grown = fromMain + fromLeft;
    if (!grown) return;
    pane.width = drag.startWidth + grown;
    if (left) left.width = drag.leftWidth - fromLeft;
  } else {
    const shrink = Math.min(-delta, drag.startWidth - SPLIT_MIN_WIDTH);
    if (!shrink) return;
    pane.width = drag.startWidth - shrink;
    if (left) left.width = drag.leftWidth + shrink;
  }
  layoutRail({ mayCollapseSidebar: false });
}

// ---------- 布局：一个写者，先算预算再写每栏宽度 ----------
/** @param {{ mayCollapseSidebar?: boolean }} [options] */
function layoutRail({ mayCollapseSidebar = false } = {}) {
  if (PANE) return;
  const rail = splitRail();
  if (!rail) return;
  if (!split.panes.length) {
    rail.classList.add("hidden");
    rail.style.maxWidth = "";
    delete document.documentElement.dataset.split;
    delete document.documentElement.dataset.splitTight;
    if (split.autoSidebar) {
      toggleSidebar(split.autoSidebar.wasCollapsed, { persist: false, relayout: false });
      split.autoSidebar = null;
    }
    split.sidebarOverride = false;
    return;
  }
  if (isMobile()) {
    delete document.documentElement.dataset.splitTight;
    return; // CSS 收着 rail；栏页不卸载
  }
  if (stageShown()) {
    delete document.documentElement.dataset.splitTight;
    return; // 游目盖住 rail；栏页不卸载
  }
  const side = $("#sidePanel");
  if (side && sidePanelOpen() && side.classList.contains("wide")) {
    delete document.documentElement.dataset.splitTight;
    return;
  }

  const sidebar = $("#sidebar");
  const expanded = !!sidebar && !sidebar.classList.contains("collapsed");
  if (
    mayCollapseSidebar &&
    expanded &&
    !split.sidebarOverride &&
    splitBudget(SIDEBAR_WIDTH) < split.panes.length * SPLIT_MIN_WIDTH
  ) {
    split.autoSidebar = { wasCollapsed: false };
    toggleSidebar(true, { persist: false, relayout: false });
  } else if (split.autoSidebar && split.panes.length * SPLIT_MIN_WIDTH <= splitBudget(SIDEBAR_WIDTH)) {
    toggleSidebar(split.autoSidebar.wasCollapsed, { persist: false, relayout: false });
    split.autoSidebar = null;
  }

  const sidebarWidth = splitSidebarWidth();
  const budget = splitBudget(sidebarWidth);
  const widths = allocateSplitWidths(
    split.panes.map(pane => pane.width || SPLIT_DEFAULT_WIDTH),
    budget
  );
  split.panes.forEach((pane, index) => {
    const panel = splitPanel(pane.slot);
    if (panel) panel.style.width = `${widths[index]}px`;
  });
  rail.classList.remove("hidden");
  rail.style.maxWidth = `${budget}px`;
  document.documentElement.dataset.split = "open";
  const railWidth = widths.reduce((sum, width) => sum + width, 0);
  rail.dataset.overflow = railWidth > budget ? "1" : "0";
  const app = /** @type {HTMLElement|null} */ ($(".app"));
  const mainWidth = (app?.clientWidth || 0) - sidebarWidth - splitSidePanelWidth() - railWidth;
  if (mainWidth < 460) document.documentElement.dataset.splitTight = "";
  else delete document.documentElement.dataset.splitTight;
}

// ---------- 持久化与恢复 ----------
function splitSave() {
  if (PANE) return;
  try {
    const data = split.panes
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map(pane => ({ slot: pane.slot, id: pane.id, width: Math.round(pane.width) || SPLIT_DEFAULT_WIDTH }));
    if (!data.length) localStorage.removeItem(SPLIT_STORE_KEY);
    else localStorage.setItem(SPLIT_STORE_KEY, JSON.stringify(data));
    localStorage.removeItem(LEGACY_SPLIT_KEY);
    localStorage.removeItem(LEGACY_WIDTH_KEY);
  } catch {}
}
/** @returns {SplitPane[]} */
function splitReadSaved() {
  let raw = null;
  try {
    raw = localStorage.getItem(SPLIT_STORE_KEY);
  } catch {}
  /** @type {any[]} */
  let list = [];
  if (raw !== null) {
    // v2 存在即权威（含空数组）；坏掉的当空，不再回头读旧键
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {}
  } else {
    let id = "",
      width = 0;
    try {
      id = localStorage.getItem(LEGACY_SPLIT_KEY) || "";
      width = Number(localStorage.getItem(LEGACY_WIDTH_KEY)) || 0;
    } catch {}
    if (id) list = [{ slot: 0, id, width }];
  }
  /** @type {SplitPane[]} */
  const out = [];
  const seenSlots = new Set(),
    seenIds = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const slot = Number(item.slot);
    const id = String(item.id || "");
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_SPLIT_PANES || seenSlots.has(slot)) continue;
    if (!id || seenIds.has(id) || !store.conversations.some(c => c.id === id)) continue;
    seenSlots.add(slot);
    seenIds.add(id);
    const width = Number(item.width);
    out.push({
      slot,
      id,
      width: Number.isFinite(width) && width >= SPLIT_MIN_WIDTH ? Math.round(width) : SPLIT_DEFAULT_WIDTH
    });
  }
  out.sort((a, b) => a.slot - b.slot);
  return out;
}
function restoreSplit() {
  if (PANE) return;
  const saved = splitReadSaved();
  if (!saved.length) return;
  const filtered = saved.filter(pane => pane.id !== currentId);
  if (!filtered.length) {
    splitSave();
    return;
  }
  // 窄屏先不挂：留到窗口放宽（见 maybeMountDeferred）
  if (isMobile()) {
    split.deferred = filtered;
    return;
  }
  mountSplitRestore(filtered);
}
function maybeMountDeferred() {
  if (!split.deferred || PANE || isMobile()) return;
  const list = split.deferred;
  split.deferred = null;
  mountSplitRestore(list.filter(pane => pane.id !== currentId));
}
// 右栏里那段被删了（这边删的、别处删的）：只收对应那一栏
function pruneSplitPanes() {
  if (PANE || splitPruning) return;
  splitPruning = true;
  try {
    let changed = false;
    const seen = new Set();
    for (const pane of split.panes.slice()) {
      const missing = !store.conversations.some(c => c.id === pane.id);
      const duplicate = seen.has(pane.id) || pane.id === currentId;
      seen.add(pane.id);
      if (!missing && !duplicate) continue;
      removeSplitPane(pane.slot);
      changed = true;
    }
    if (changed) {
      splitSave();
      layoutRail({ mayCollapseSidebar: true });
    }
  } finally {
    splitPruning = false;
  }
}
function syncSplit() {
  pruneSplitPanes();
}
// 主页面改了设置、或配置刚写进磁盘：叫每一栏读一回（错峰，别四份页面同时读盘）
function splitRefreshPanes() {
  if (PANE || !split.panes.length) return;
  split.panes.forEach((pane, index) => setTimeout(() => splitPaneAt(pane.slot)?.refresh(), index * 120));
}

// ---------- 绑定 ----------
/** @param {HTMLElement} grip */
function bindSplitGrip(grip) {
  grip.addEventListener("pointerdown", e => {
    const slot = Number(grip.dataset.splitGrip);
    if (!splitEntry(slot)) return;
    e.preventDefault();
    // 压缩渲染时 preferred 可能大于眼前宽度：拖拽从眼前的实际宽度起算
    for (const pane of split.panes) {
      const panel = splitPanel(pane.slot);
      if (panel) pane.width = panel.offsetWidth || pane.width;
    }
    const ordered = split.panes.slice().sort((a, b) => a.slot - b.slot);
    const index = ordered.findIndex(pane => pane.slot === slot);
    const left = index > 0 ? ordered[index - 1] : null;
    const pe = /** @type {PointerEvent} */ (e);
    split.drag = {
      slot,
      startX: pe.clientX,
      startWidth: splitPanel(slot)?.offsetWidth || SPLIT_DEFAULT_WIDTH,
      mainWidth: /** @type {HTMLElement} */ ($(".main")).offsetWidth,
      leftSlot: left?.slot ?? -1,
      leftWidth: left ? splitPanel(left.slot)?.offsetWidth || left.width : 0
    };
    grip.setPointerCapture(pe.pointerId);
    document.body.classList.add("split-dragging");
  });
  grip.addEventListener("pointermove", e => {
    const drag = split.drag;
    if (!drag || drag.slot !== Number(grip.dataset.splitGrip)) return;
    const pe = /** @type {PointerEvent} */ (e);
    if (!grip.hasPointerCapture(pe.pointerId)) return;
    splitDragTo(drag.slot, drag.startWidth - (pe.clientX - drag.startX));
  });
  grip.addEventListener("lostpointercapture", () => {
    if (!split.drag) return;
    split.drag = null;
    document.body.classList.remove("split-dragging");
    splitSave();
  });
}
function bindSplit() {
  if (PANE) return;
  const rail = splitRailReady();
  if (!rail) return;
  /** @type {any} */ (window).__yanSplit = {
    // 栏页 hand-off / 测试：已开就聚焦那一栏；在主页面当前那段就聚焦主页面；否则在主页打开
    open: id => {
      const slot = splitSlotOf(id);
      if (slot >= 0) return focusSplit(slot);
      if (id === currentId) {
        window.focus();
        return;
      }
      openConversation(id);
      window.focus();
    },
    add: id => openSplit(id),
    close: (slot = 0, id = "") => void closeSplit(Number(slot) || 0, String(id || "")),
    focus: slot => focusSplit(Number(slot)),
    state: () => ({
      busPages,
      room: splitRoom(),
      panes: split.panes
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map(pane => ({
          slot: pane.slot,
          id: pane.id,
          width: pane.width,
          actual: splitPanel(pane.slot)?.offsetWidth || 0
        })),
      sidebar: {
        collapsed: !!$("#sidebar")?.classList.contains("collapsed"),
        auto: !!split.autoSidebar,
        override: split.sidebarOverride
      },
      rail: {
        maxWidth: splitRail()?.style.maxWidth || "",
        scrollWidth: splitRail()?.scrollWidth || 0,
        clientWidth: splitRail()?.clientWidth || 0,
        overflow: splitRail()?.dataset.overflow === "1"
      },
      mobile: isMobile()
    }),
    setWidth: (slot, px) => {
      splitSetWidth(Number(slot), Number(px));
      splitSave();
    }
  };
  rail.addEventListener("animationend", e => {
    const panel = /** @type {HTMLElement} */ (e.target).closest?.(".split-panel");
    if (panel) panel.classList.remove("flash");
  });
  // 这边改了设置：叫每一栏读一回（错峰，别四份页面同时读盘）。
  // 头一回趁早；配置写盘有防抖，稍后再补一回，免得头一回读到的还是旧的那份。
  // 只看明暗/字体/动效：内联 style 会被输入区高度、季印这类常变的东西碰到，
  // 拿它当设置变化会让计时器反复重置，栏里的明暗要等到下一次布局变动才跟上
  let refreshTimer = 0,
    refreshTimerLate = 0;
  new MutationObserver(() => {
    if (!split.panes.length) return;
    clearTimeout(refreshTimer);
    clearTimeout(refreshTimerLate);
    refreshTimer = window.setTimeout(splitRefreshPanes, 800);
    refreshTimerLate = window.setTimeout(splitRefreshPanes, 3200);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-font", "data-ink-motion"] });
  window.addEventListener("resize", () => {
    if (splitResizeRaf) return;
    splitResizeRaf = requestAnimationFrame(() => {
      splitResizeRaf = 0;
      maybeMountDeferred();
      layoutRail({ mayCollapseSidebar: true });
    });
  });
}
// 栏页自己的顶栏：一枚「收起第 N 栏」
function bindPane() {
  if (!PANE) return;
  const close = document.createElement("button");
  close.id = "paneClose";
  close.className = "icon-btn pane-close";
  close.type = "button";
  close.title = t`收起第 ${PANE_SLOT + 1} 栏`;
  close.setAttribute("aria-label", close.title);
  close.textContent = "×";
  close.onclick = () => splitHost()?.close?.(PANE_SLOT, currentId || "");
  $(".top-actions").append(close);
  // 光标进栏页时也读一回配置：主页面改了什么，这边当场跟上
  window.addEventListener("focus", () => void refreshConfigFromDisk());
}
