// 言 · 游目 · 画面：看哪一页，连上它、按大小收它的画面
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 看哪一页：连上它、收它的画面 ----------
let stageAttachRevision = 0;
/** @param {string} targetId */
function stageShow(targetId) {
  stage.current = targetId;
  stageRender();
  if (stageVisible()) void stageAttach();
}
async function stageAttach() {
  const target = stage.current,
    ws = stage.ws;
  if (!stage.ws || !target || stage.attached === target) return;
  const detaching = stageDetach(),
    revision = stageAttachRevision,
    current = () => revision === stageAttachRevision && stage.ws === ws && stage.current === target && stageVisible();
  await detaching;
  if (!current()) return;
  stage.attached = target;
  let streaming = false;
  const abort = (sessionId, screencast = false) => {
    if (stage.ws === ws) {
      if (screencast) void stageSend("Page.stopScreencast", {}, sessionId).catch(() => {});
      void stageSend("Target.detachFromTarget", { sessionId }).catch(() => {});
    }
    if (revision === stageAttachRevision) stage.attached = stage.session = "";
  };
  try {
    const { sessionId } = await stageSend("Target.attachToTarget", { targetId: target, flatten: true });
    if (!current()) return abort(sessionId);
    stage.session = sessionId;
    // 浏览器的窗口在屏幕外、不在焦点上：不模拟焦点，递进去的按键没人接（playwright 自己也这么做）
    void stageSend("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
    // 收 Page 域的事件：载入、跳转、提示框（开着的提示框，enable 时会补报一回）
    await stageSend("Page.enable", {}, sessionId);
    if (!current()) return abort(sessionId);
    // 网页要人选文件：不让浏览器在屏幕外开窗，报给看台
    void stageSend("Page.setInterceptFileChooserDialog", { enabled: true }, sessionId).catch(() => {});
    // 执事在网页上哪儿下手：网页里放一个只给看台听的耳目
    void stageInkAttach(sessionId, target);
    void stageReadHistory();
    await stageSend("Page.startScreencast", { format: "jpeg", quality: 90 }, sessionId);
    if (!current()) return abort(sessionId, true);
    streaming = true;
    // 静着的页不重绘就不出帧：先截一张垫底（后台的页截不出来，等不到就算了）
    if (current() && !stage.framed) await stageBaseFrame(sessionId);
  } catch {
    // 没连成（目标刚关、Page.enable 被拒）：不留「已连着」的空壳，否则同一页再也接不上；垫底那张截不出来不算
    if (!streaming && current()) void stageDetach();
  }
  void stageFit();
}
// 静着的页不重绘就不出帧：截一张垫底；调窗后补的要视口尺寸对上才画，免得把旧画面画上去
/** @param {string} sessionId @param {{ width: number, height: number }} [want] */
async function stageBaseFrame(sessionId, want) {
  try {
    const [shot, inner] = await Promise.race([
      Promise.all([
        stageSend("Page.captureScreenshot", { format: "jpeg", quality: 90 }, sessionId),
        stageSend("Runtime.evaluate", { expression: "[innerWidth, innerHeight]", returnByValue: true }, sessionId)
      ]),
      new Promise((_, reject) => setTimeout(() => reject(Error("timeout")), 2000))
    ]);
    if (stage.session !== sessionId || !stageVisible()) return;
    const [innerWidth, innerHeight] = inner?.result?.value || [0, 0],
      cw = Math.round(Number(innerWidth) || 0),
      ch = Math.round(Number(innerHeight) || 0);
    if (!shot?.data || !cw || !ch) return;
    if (want && (Math.abs(cw - want.width) > 2 || Math.abs(ch - want.height) > 2)) return;
    if (!want && stage.framed) return;
    void stageFrame(shot.data, cw, ch);
  } catch {}
}
// 屏幕外那扇窗调成看台的大小：窗比网页多出的边（标签栏、地址栏、边框）照现量补上。窗口的尺寸与网页的 CSS 像素同一单位。
// 画面要一比一才清楚：宽高都往下取整、与画幅的 CSS（见 20-view.css 的 .stage-sheet）同减 24，视口按 innerWidth 量（带滚动条，与推来的帧同宽）——
// 差一两个像素，整幅就被重采一回，字边发虚。窄过下限的只能按比例缩小。
// 缩放即调窗：放大一档，窗按倍数收窄，网页照自己的断点重排、字在游目里大一档（浏览器自己的缩放经调试口调不动）
const STAGE_FLOOR = { width: 960, height: 600 };
async function stageFit() {
  const session = stage.session,
    target = stage.attached;
  if (!session || !stageVisible()) return;
  const view = $("#stageView").getBoundingClientRect(),
    want = {
      width: Math.floor(Math.max(STAGE_FLOOR.width, view.width - 24) / stage.zoom),
      height: Math.floor(Math.max(STAGE_FLOOR.height, view.height - 24) / stage.zoom)
    };
  try {
    const [{ windowId, bounds }, inner] = await Promise.all([
      stageSend("Browser.getWindowForTarget", { targetId: target }),
      stageSend("Runtime.evaluate", { expression: "[innerWidth, innerHeight]", returnByValue: true }, session)
    ]);
    const [innerWidth, innerHeight] = inner.result?.value || [0, 0],
      port = { clientWidth: Number(innerWidth) || 0, clientHeight: Number(innerHeight) || 0 };
    if (!port.clientWidth) return;
    const edgeX = bounds.width - port.clientWidth,
      edgeY = bounds.height - port.clientHeight;
    // 网页的视口被定死了（执事 setViewportSize / browser_resize 过）：窗口管不着它，多出的边不是边，再照着调只会一回小一圈。
    // 记下定死的大小：留白处写一行，开着「适应页面」的等执事歇手后放开
    const pinned = edgeX < 0 || edgeY < 0 || edgeX > 120 || edgeY > 320;
    stagePin(pinned ? { width: Math.round(port.clientWidth), height: Math.round(port.clientHeight) } : null);
    if (pinned) return;
    const width = Math.round(edgeX + want.width),
      height = Math.round(edgeY + want.height);
    if (bounds.windowState !== "normal" || (width === bounds.width && height === bounds.height)) return;
    stage.fittedAt = Date.now();
    await stageSend("Browser.setWindowBounds", { windowId, bounds: { width, height } });
    // 静着的页调窗后可能不重绘：补一张垫底
    await stageBaseFrame(session, want);
  } catch {}
}
/** @param {{ width: number, height: number } | null} size */
function stagePin(size) {
  if (JSON.stringify(size) === JSON.stringify(stage.pinned)) return;
  stage.pinned = size;
  if (!size) stage.executorPinned = false;
  stageRenderLetter();
  stageMaybeRelease();
}
// 留白处的一行：视口被定死、画面因此留白时写明是谁定的、多大；开着「适应页面」的补一句何时铺满
function stageRenderLetter() {
  const letter = $("#stageLetter"),
    size = stage.pinned;
  letter.classList.toggle("hidden", !size);
  if (size)
    letter.innerHTML = `${t(`执事把视口定在`)} <b>${size.width}×${size.height}</b>${stageFitOn() && stage.executorPinned ? t("，它歇手后铺满") : `<button type="button" data-stage-release>${t(`放开`)}</button>`}`;
}
// 执事调了 browser_resize 或 setViewportSize（见 60-mcp.js 的 stageResultNote）
function stageMarkExecutorPinned() {
  stage.executorPinned = true;
  stageRenderLetter();
}
// 放开定死的视口：执事那头（Playwright）记着那个尺寸，换页也会再钉回去，游目这头清不掉——只有新开一页最干净。
// 经那个 MCP 服务的 browser_tabs 办：同一网址新开一页、关掉旧的，执事那边的标签账也对得上（它下回调用时看得到）。
// 「适应页面」开着且确是执事定的：它歇手（没有在途的浏览器调用、也没有在答的对话）才放；其余只在人点「放开」时放
/** @param {boolean} [now] 人点了「放开」 */
async function stageRelease(now = false) {
  const server = stageServer(),
    tab = stage.tabs.get(stage.current),
    url = tab?.url || "";
  if (!server || !stage.pinned || !url || /^(about|data|devtools|edge|chrome):/.test(url)) return;
  if (!now && stage.released.url === url && Date.now() - stage.released.at < 60000) return;
  stage.released = { url, at: Date.now() };
  const config = mcpConfigs()[server],
    call = (/** @type {Record<string, any>} */ args) =>
      bridge("/api/mcp/call", { server, config, tool: "browser_tabs", arguments: args, timeout: 30 });
  try {
    // 执事那边的第几页：照它报的「- 2: (current) [题](网址)」认
    const listed = await call({ action: "list" }),
      lines = String((listed.result?.content || []).map((/** @type {any} */ item) => item.text || "").join("\n")).split("\n"),
      rows = lines.map(line => line.match(/^- (\d+): (\(current\) )?\[.*\]\((.*)\)\s*$/)).filter(Boolean),
      old = rows.find(row => row?.[3] === url && row[2]) || rows.find(row => row?.[3] === url);
    if (!old) return;
    await call({ action: "new", url });
    await call({ action: "close", index: Number(old[1]) });
    stage.executorPinned = false;
  } catch (error) {
    if (now) toast(t`未能放开：${String(/** @type {any} */ (error).message || error).slice(0, 80)}`);
  }
}
// 执事歇手了吗：没有在途的浏览器调用、没有在答的对话与差遣
function stageIdle() {
  return !stage.busy && !requestJobs.size && !crews.size;
}
function stageMaybeRelease() {
  if (stageFitOn() && stage.pinned && stage.executorPinned && stageIdle() && stageVisible()) void stageRelease();
}
// 适应页面（纸签里的开关，默认开，记在配置里）
const stageFitOn = () => store.settings.stageFit !== false;
/** @param {boolean} on */
function stageSetFit(on) {
  store.settings.stageFit = on;
  saveStore();
  stageRenderLetter();
  stageMaybeRelease();
}
/** @param {number} zoom */
function stageSetZoom(zoom) {
  stage.zoom = Math.round(Math.max(0.5, Math.min(2, zoom)) * 100) / 100;
  try {
    localStorage.setItem("yan-stage-zoom", String(stage.zoom));
  } catch {}
  const pct = document.querySelector(".stage-zoom-pct");
  if (pct) pct.textContent = `${Math.round(stage.zoom * 100)}%`;
  stageFrameSize();
  void stageFit();
}
const STAGE_ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** @param {number} step 1 放大一档，-1 缩小一档，0 复原 */
function stageZoomStep(step) {
  if (!step) return stageSetZoom(1);
  const at = STAGE_ZOOMS.findIndex(z => z >= stage.zoom - 0.001);
  stageSetZoom(STAGE_ZOOMS[Math.max(0, Math.min(STAGE_ZOOMS.length - 1, (at < 0 ? STAGE_ZOOMS.length - 1 : at) + step))]);
}
async function stageDetach() {
  stageAttachRevision += 1;
  const session = stage.session;
  stage.session = stage.attached = "";
  stage.framed = false;
  stageDropHeldFrame();
  stageResetPage();
  if (!session) return;
  await stageSend("Page.stopScreencast", {}, session).catch(() => {});
  void stageSend("Target.detachFromTarget", { sessionId: session }).catch(() => {});
}
// 截图越出视口时（截比视口大的元素、整页截图，Playwright 带 captureBeyondViewport），浏览器把视口临时撑到要截的大小，
// 撑开的那一两帧照样推来，画面一缩一放地抖。换了尺寸的帧先压着：稳住 300 毫秒才认（窗口真调了大小），其间回到原尺寸的就是截图那一下，丢掉。
// 游目自己刚调过窗（拖宽窄、阔、缩放）的那一阵，换尺寸是意料中的，随到随画——不然每回调完都要多僵一拍再跳过去
const STAGE_RESIZE_SETTLE = 300,
  STAGE_FIT_GRACE = 1500;
let stageHeldFrame = null,
  stageHoldTimer = 0;
// 动着时推 JPEG（照片多的页 PNG 一帧近 2 MB、一秒只出十几帧），静下来 400 毫秒截一张 PNG 换上：读字时没有 JPEG 的毛边。
// 截图会让浏览器再推一帧同样的画面——同一画面编出的 JPEG 一字不差（实测），与上一帧相同的就不画，不然 PNG 又被换回去、再截、再换
const STAGE_SETTLE = 400;
let stageLastData = "",
  stageFrameSeq = 0,
  stageSettleTimer = 0;
function stageSettleSoon() {
  clearTimeout(stageSettleTimer);
  stageSettleTimer = window.setTimeout(() => void stageSettle(), STAGE_SETTLE);
}
async function stageSettle() {
  const session = stage.session,
    seq = stageFrameSeq,
    { width, height } = stage.meta;
  if (!session || !stage.framed || stageHeldFrame || !stageVisible()) return;
  const shot = await stageSend("Page.captureScreenshot", { format: "png" }, session).catch(() => null);
  if (!shot || session !== stage.session || seq !== stageFrameSeq || stageHeldFrame) return;
  // 截的是此刻的视口：比例与画面对不上（其间调了窗、定了视口）就不换
  const probe = new Image();
  probe.src = `data:image/png;base64,${shot.data}`;
  if (
    !(await probe.decode().then(
      () => true,
      () => false
    ))
  )
    return;
  if (seq !== stageFrameSeq || Math.abs(probe.naturalWidth / probe.naturalHeight - width / height) > 0.01) return;
  void stageShowFrame(shot.data, width, height, "png");
}
function stageDropHeldFrame() {
  clearTimeout(stageHoldTimer);
  stageHoldTimer = 0;
  stageHeldFrame = null;
}
/** @param {string} data @param {number} width @param {number} height @returns {Promise<void>} */
function stageFrame(data, width, height) {
  // 与上一帧一模一样（截那张 PNG 引来的）：不画，也不另起一回静候
  if (stage.framed && data === stageLastData && width === stage.meta.width && height === stage.meta.height) return Promise.resolve();
  stageLastData = data;
  stageFrameSeq += 1;
  stageSettleSoon();
  if (stage.framed && (width !== stage.meta.width || height !== stage.meta.height) && Date.now() - stage.fittedAt > STAGE_FIT_GRACE) {
    stageHeldFrame = { data, width, height };
    stageHoldTimer ||= window.setTimeout(() => {
      const held = stageHeldFrame;
      stageDropHeldFrame();
      if (held && stage.framed) void stageShowFrame(held.data, held.width, held.height);
    }, STAGE_RESIZE_SETTLE);
    return Promise.resolve();
  }
  stageDropHeldFrame();
  return stageShowFrame(data, width, height);
}
/** @param {string} data @param {number} width @param {number} height @param {"jpeg" | "png"} [type] @returns {Promise<void>} */
function stageShowFrame(data, width, height, type = "jpeg") {
  const fresh = !stage.framed;
  if (width !== stage.meta.width || height !== stage.meta.height || fresh) {
    stage.meta = { width, height };
    stageFrameSize();
  }
  stage.framed = true;
  const img = /** @type {HTMLImageElement} */ ($("#stageFrame"));
  img.src = `data:image/${type};base64,${data}`;
  if (fresh) requestAnimationFrame(stageSnap);
  // 解码中途换了下一帧会报错，不碍事
  return img.decode().catch(() => {});
}

// 画面的比例与最大宽：不放大过原尺寸，缩放过的按倍数放大
function stageFrameSize() {
  const view = $("#stageView"),
    { width, height } = stage.meta;
  view.style.setProperty("--ar", String(width / height));
  view.style.setProperty("--fw", String(Math.round(width * stage.zoom)));
  stageSnap();
}
// 画面落在整的设备像素上：居中常落在半个像素上，一比一的图也被重采一回、整幅发虚。量出零头，挪回去
function stageSnap() {
  const sheet = $("#stageSheet"),
    dpr = devicePixelRatio || 1;
  sheet.style.translate = "";
  const r = sheet.getBoundingClientRect(),
    dx = r.left * dpr - Math.round(r.left * dpr),
    dy = r.top * dpr - Math.round(r.top * dpr);
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) sheet.style.translate = `${-dx / dpr}px ${-dy / dpr}px`;
}

// 网页改了标题，浏览器不发通知（开页、关页、跳转才发）：看台开着时隔一会儿问一次，变了才重画
async function stageRefreshTabs() {
  const result = await stageSend("Target.getTargets").catch(() => null);
  let changed = false;
  for (const info of result?.targetInfos || []) {
    const tab = stage.tabs.get(info.targetId);
    if (!stageTabType(info) || !tab || (tab.title === info.title && tab.url === info.url)) continue;
    if (stageNotTab(info)) {
      stageDropTab(info.targetId);
      continue;
    }
    Object.assign(tab, { title: info.title, url: info.url });
    changed = true;
  }
  if (changed) stageRender();
}
