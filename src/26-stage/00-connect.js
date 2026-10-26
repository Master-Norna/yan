// 言 · 游目（代码里叫看台 stage）：模型所用的那个浏览器，画面固定在对话右侧——不再是屏幕上另开、挡人的一个窗口。
// 巧处：浏览器仍归 MCP（如 playwright）起、关与操作；看台只是另一个连上它调试口的看客——Page.startScreencast 收画面，Input.* 递点按。
// 页面直接连调试口（浏览器以 --remote-allow-origins 放行言的页面），画面不过桥接；桥接只替页面问出连接的地址（server/stage.js）。
// 标签照抄浏览器自己的（Target.setDiscoverTargets），不另分「成品」与「网页」：模型做的网页由它自己在浏览器里开，也就上了台。
// 何时去连：开页时、打开看台时，与每次浏览器类的 MCP 调用之后（浏览器多半是这时起的）；断了就等下一次，不轮询。
// 调试口与配置目录不另设，桥接从那个 MCP 服务的参数（及它 --config 的那份文件）里读出来。
// 浏览器没开、或被关掉了：看台里点「打开浏览器」，言替你调一次那个 MCP 的 browser_navigate，浏览器照它的配置起来——言自己不起浏览器。
// 旁注与看台同在右侧：旁注开着时看台让位（纯 CSS，见 styles/56-stage/00-panel.css），让位时、言的页面在后台时都不收画面。
// 网页的尺寸：playwright 有头时不设视口，网页多大即窗口多大——看台就把屏幕外那扇窗调成自己的大小（有下限，免得网站换成手机版），
// 网页原大显示；窗口调不动的（设了视口的）照旧按宽高里较紧的一边缩放，点按按同一倍数换算回去。
// 浏览器自己画的那几样（网页弹的提示框、载入中、能否后退）在屏幕外的窗上看不到：看台照 Page 域的事件自己画。
// 画面上的朱笔（人圈点的、执事落笔处）另在 src/26-stage/50-ink.js

const stage = {
  /** @type {WebSocket | null} */
  ws: null,
  /** @type {Promise<void> | null} */
  locating: null,
  seq: 0,
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
  pending: new Map(),
  /** @type {Map<string, { title: string, url: string }>} 浏览器里开着的页，按开的先后 */
  tabs: new Map(),
  // setDiscoverTargets 会把已开着的页逐个报来：那些不算「新开」，别跟过去
  listing: false,
  current: "",
  // 上回问到的浏览器前台那一页：模型换页（选签会把那页请到前台）时它变，看台跟过去；用户自己点签换的也记成前台，不算模型换页
  front: "",
  attached: "",
  session: "",
  framed: false,
  meta: { width: 1280, height: 720 },
  // 网页此刻滚到哪儿（画面帧里带的，CSS 像素）：圈点按网页里的位置记，滚动后跟着走
  scroll: { x: 0, y: 0 },
  // 正看的那一页：载入中、能否后退前进、网页弹出的提示框
  loading: false,
  back: false,
  forward: false,
  /** @type {{ type: string, message: string, defaultPrompt?: string, multiple?: boolean, node?: number } | null} */
  dialog: null,
  // 浏览器配置目录里有收藏（桥接答的），才挂「收藏」
  marks: false,
  /** @type {any[] | null} 收藏的树（夹与条，带 id），读过一回记着：书签带着不着朱、收藏签都从它来 */
  markTree: null,
  // 上面那棵树是刚改完时浏览器递回的：配置文件过一两秒才落盘，这会儿先信它
  markTreeAt: 0,
  // 改收藏借的那个浏览器上下文：它里头的页不列进标签
  helperCtx: "",
  // 浏览器自家页的协议（edge:// 或 chrome://），连上时问一回
  scheme: "edge",
  // 那个服务存下载的目录（桥接从参数里读的，设置 → 游目里给人看）
  output: "",
  /** @type {{ width: number, height: number } | null} 正看的这一页视口被定死了多大；没定死是 null */
  pinned: null,
  // 执事亲手定过视口（browser_resize、setViewportSize）：「适应页面」只在这时才等它歇手后自动放开。
  // 光凭量出来的尺寸不作数——量的那一下窗口可能还没跟上，而放开是新开一页，网页里挂着的脚本、填了一半的表都会冲掉
  executorPinned: false,
  // 放开过的那一页与时刻：放不开时不一回回再试
  released: { url: "", at: 0 },
  // 缩放：调那扇窗的宽，窗窄一档网页里的字就大一档（浏览器自己的缩放调不动，见 docs/stage.md）
  zoom: 1,
  /** @type {{ guid: string, name: string, url: string, total: number, got: number, state: string, at: number, path?: string, by?: string }[]} 下载过的，新的在前 */
  downloads: [],
  // 下载签打开后才算看过：纸签上「下载」后的数目是没看过的
  downloadsSeen: 0,
  /** @type {{ text: string, at: number }[]} 执事在浏览器里新近的几步，写成人话 */
  trail: [],
  // 执事最近一步的时刻：地址行那两字「执事」在它歇手后再留一会儿
  lastAct: 0,
  actTimer: 0,
  // 指针形状跟着网页：上一回问的时刻、是否还在问
  cursorAt: 0,
  cursorAsking: false,
  // 输入法：正在组字（组字当中不挪隐藏输入框）、量光标的计时
  composing: false,
  caretTimer: 0,
  // 浏览器的调试口（桥接从配置里读出来的：报错、开发者工具用）
  port: 0,
  seen: false,
  busy: 0,
  launching: false,
  width: 0,
  poll: 0,
  fitTimer: 0,
  empty: "",
  click: { at: 0, x: 0, y: 0, count: 0 },
  // 圈点开着：画面上的点按是下笔，不递进网页（见 src/26-stage/50-ink.js）
  pen: false,
  // 人最近一回在画面上按下的时刻：网页报来的按下若紧跟着它，是人按的，不当执事落笔
  userAt: 0,
  /** @type {PointerEvent | null} */
  moved: null
};

// ---------- 连上浏览器 ----------
// 已连着时也问一回：模型若把别的页请到了前台（选签、新开），看台跟过去
function stageLocate() {
  // 栏页不接游目：调试口只有一个，几处页面同连会互抢画面与输入（见 27-split.js）
  if (PANE) return Promise.resolve();
  if (stage.locating) return stage.locating;
  stage.locating = bridge("/api/stage", stageService())
    .then(({ ws, front, marks, port, output }) => {
      stage.marks = !!marks;
      stage.port = port;
      stage.output = output || "";
      if (!stage.ws) return ws ? stageConnect(ws, front) : stageSync();
      if (front && front !== stage.front && stage.tabs.has(front)) stageShow(front);
      stage.front = front || stage.front;
      stageSync();
    })
    .catch(() => {})
    .finally(() => (stage.locating = null));
  return stage.locating;
}
/** @param {string} url @param {string} front */
function stageConnect(url, front) {
  return new Promise(resolve => {
    const ws = new WebSocket(url);
    stage.ws = ws;
    ws.onmessage = event => stageMessage(JSON.parse(event.data));
    // 浏览器关了（模型收工、playwright 闲置关掉）：看台清空，等下一次浏览器类的调用再来找
    ws.onclose = () => {
      if (stage.ws !== ws) return;
      stage.ws = null;
      stage.tabs.clear();
      stage.current = stage.front = stage.attached = stage.session = "";
      stage.framed = false;
      stageResetPage();
      for (const waiter of stage.pending.values()) waiter.reject(Error(t("游目已断开")));
      stage.pending.clear();
      $("#stageFrame").removeAttribute("src");
      stageSync();
      resolve();
    };
    ws.onopen = async () => {
      try {
        stage.listing = true;
        await stageSend("Target.setDiscoverTargets", { discover: true });
        stage.listing = false;
        const { product = "" } = await stageSend("Browser.getVersion").catch(() => ({}));
        stage.scheme = /^Edg/.test(product) ? "edge" : "chrome";
        stage.front = front;
        stageShow(stage.tabs.has(front) ? front : [...stage.tabs.keys()].at(-1) || "");
        stageSync();
        void stageReadMarks();
      } catch {
        ws.close();
      }
      resolve();
    };
  });
}
/** @param {string} method @param {Record<string, any>} [params] @param {string} [sessionId] */
function stageSend(method, params = {}, sessionId = "") {
  const ws = stage.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(Error(t("游目未连上")));
  const id = ++stage.seq;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => stage.pending.set(id, { resolve, reject }));
}
function stageMessage(message) {
  if (message.id) {
    const waiter = stage.pending.get(message.id);
    stage.pending.delete(message.id);
    if (waiter) message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result);
    return;
  }
  const params = message.params || {};
  if (message.method === "Target.targetCreated" || message.method === "Target.targetInfoChanged") {
    const info = params.targetInfo;
    if (!stageTabType(info) || (stage.helperCtx && info.browserContextId === stage.helperCtx)) return;
    if (stageNotTab(info)) return void stageDropTab(info.targetId);
    const fresh = !stage.tabs.has(info.targetId);
    stage.tabs.set(info.targetId, { title: info.title, url: info.url });
    // 模型新开了一页：跟过去
    if (fresh && !stage.listing) stageShow(info.targetId);
    else stageRender();
  } else if (message.method === "Target.targetDestroyed") {
    stage.tabs.delete(params.targetId);
    if (params.targetId === stage.current) stageShow([...stage.tabs.keys()].at(-1) || "");
    else stageRender();
  } else if (message.method === "Target.detachedFromTarget") {
    if (params.sessionId === stage.session) stage.session = stage.attached = "";
  } else if (message.sessionId && message.sessionId === stage.session) stagePageEvent(message.method, params);
}
// 列成签的：寻常网页；Edge 的设置页报成 browser_ui，也算（不列它，点「浏览器设置」就像没反应）
/** @param {{ type: string, url: string }} info */
const stageTabType = info => info.type === "page" || (info.type === "browser_ui" && /^(edge|chrome):\/\/settings/.test(info.url));
// Edge 自己的气泡与对话框（下载时弹的 downloads-hub、登录后弹的 sync-confirmation-dialog 之类）也报成一页：不是网页，不列，也不跟过去。
// 它起初网址是空的、后来才补上，报来时与轮询时都要认
/** @param {{ url: string }} info */
const stageNotTab = info => /^edge:\/\/[\w-]*-(hub|dialog)\b/.test(info.url);
/** @param {string} id */
function stageDropTab(id) {
  if (!stage.tabs.delete(id)) return;
  if (id === stage.current) stageShow([...stage.tabs.keys()].at(-1) || "");
  else stageRender();
}
// 正看的那一页上的事。主框架的 id 与页的 targetId 相同，子框架（iframe）的载入不算
/** @param {string} method @param {any} params */
function stagePageEvent(method, params) {
  if (method === "Page.screencastFrame") {
    const { scrollOffsetX: x = 0, scrollOffsetY: y = 0 } = params.metadata,
      moved = x !== stage.scroll.x || y !== stage.scroll.y;
    stage.scroll = { x, y };
    const session = stage.session,
      ack = () => void stageSend("Page.screencastFrameAck", { sessionId: params.sessionId }, session).catch(() => {});
    // 这一帧解出来了再要下一帧：言这边忙（流式渲染、拖分隔线）时，浏览器跟着放慢，不至于帧帧排队、越积越卡
    stageFrame(params.data, params.metadata.deviceWidth, params.metadata.deviceHeight).then(ack);
    // 网页滚了：圈点与执事落笔跟着走
    if (moved) stageInkRender();
  } else if (method === "Page.frameStartedLoading" || method === "Page.frameStoppedLoading") {
    if (params.frameId !== stage.attached) return;
    stage.loading = method === "Page.frameStartedLoading";
    stageRenderNav();
    // frameNavigated 由网页那头报来，常赶在浏览器记下这一步历史之前：载完再问一回
    if (!stage.loading) void stageReadHistory();
  } else if ((method === "Page.frameNavigated" && !params.frame.parentId) || method === "Page.navigatedWithinDocument") {
    if (method === "Page.frameNavigated") stageInkClear();
    void stageReadHistory();
  } else if (method === "Runtime.bindingCalled" && params.name === STAGE_BINDING) {
    stageActSeen(params.payload);
  } else if (method === "Page.javascriptDialogOpening") {
    stage.dialog = { type: params.type, message: params.message, defaultPrompt: params.defaultPrompt };
    stageRenderDialog();
  } else if (method === "Page.javascriptDialogClosed") {
    stage.dialog = null;
    stageRenderDialog();
  } else if (method === "Page.fileChooserOpened" && params.backendNodeId) {
    stage.dialog = { type: "file", message: "", multiple: params.mode === "selectMultiple", node: params.backendNodeId };
    stageRenderDialog();
    void stageWatchChooser(stage.dialog);
  } else if (method === "Page.downloadWillBegin") {
    // 下载：浏览器在屏幕外存，游目只记一笔（名、来处、多大、到哪一步）；存到哪由 MCP 的结果补上（见 stageNoteDownload）
    stage.downloads = [
      {
        guid: params.guid,
        name: params.suggestedFilename || t("未命名"),
        url: params.url || "",
        total: 0,
        got: 0,
        state: "inProgress",
        at: Date.now()
      },
      ...stage.downloads.filter(item => item.guid !== params.guid)
    ].slice(0, 30);
    stageSaveDownloads();
  } else if (method === "Page.downloadProgress") {
    const item = stage.downloads.find(entry => entry.guid === params.guid);
    if (!item) return;
    Object.assign(item, { total: params.totalBytes || item.total, got: params.receivedBytes || item.got, state: params.state });
    if (params.state !== "inProgress") stageSaveDownloads();
  }
}
function stageResetPage() {
  stage.loading = stage.back = stage.forward = false;
  stagePin(null);
  stage.dialog = null;
  stageInkClear();
  stageRenderNav();
  stageRenderDialog();
}
async function stageReadHistory() {
  const session = stage.session;
  const history = await stageSend("Page.getNavigationHistory", {}, session).catch(() => null);
  if (!history || session !== stage.session) return;
  stage.back = history.currentIndex > 0;
  stage.forward = history.currentIndex < history.entries.length - 1;
  stageRenderNav();
}
/** @param {number} step -1 后退，1 前进 */
async function stageTravel(step) {
  const session = stage.session;
  const history = await stageSend("Page.getNavigationHistory", {}, session).catch(() => null),
    entry = history?.entries[history.currentIndex + step];
  if (entry) void stageSend("Page.navigateToHistoryEntry", { entryId: entry.id }, session).catch(() => {});
}
function stageRenderNav() {
  $("#stageNav").classList.toggle("loading", stage.loading);
  /** @type {HTMLButtonElement} */ ($("[data-stage-nav=back]")).disabled = !stage.back;
  /** @type {HTMLButtonElement} */ ($("[data-stage-nav=forward]")).disabled = !stage.forward;
}
// 网页弹的提示框（alert / confirm / prompt / 离页挽留）与选文件的窗：浏览器画在屏幕外的窗上，网页就此停住——看台在画面上另画一张，答了递回去。
// 模型那头 playwright 也收得到，谁先答都行
function stageRenderDialog() {
  const box = $("#stageDialog"),
    dialog = stage.dialog;
  box.classList.toggle("hidden", !dialog);
  if (!dialog) return void (box.innerHTML = "");
  const leave = dialog.type === "beforeunload",
    file = dialog.type === "file",
    ask = dialog.type !== "alert",
    host = stageHost(stage.tabs.get(stage.current)?.url || "");
  const [head, text, yes, no] = file
    ? [t("网页要你选文件"), t`${host || t("此页")}请你上传文件${dialog.multiple ? t("，可多选") : ""}`, t("选文件"), t("取消")]
    : leave
      ? [t("离开此页？"), dialog.message || t("此页有尚未存下的改动。"), t("离开"), t("留下")]
      : [t("网页的提示"), dialog.message, t("确定"), t("取消")];
  box.innerHTML = `<div class="stage-dialog-card" role="alertdialog" aria-label="${head}"><div class="stage-dialog-head">${head}</div><div class="stage-dialog-text">${escapeHtml(text)}</div>${dialog.type === "prompt" ? `<input class="stage-dialog-input" spellcheck="false" value="${escapeHtml(dialog.defaultPrompt || "")}">` : ""}<div class="stage-dialog-actions">${ask ? `<button type="button" class="outline-btn" data-stage-answer="no">${no}</button>` : ""}<button type="button" class="outline-btn primary" data-stage-answer="yes">${yes}</button></div></div>`;
  /** @type {HTMLElement} */ (box.querySelector(".stage-dialog-input, [data-stage-answer=yes]")).focus({ preventScroll: true });
}
/** @param {boolean} accept */
function stageAnswer(accept) {
  const dialog = stage.dialog;
  // 答完键盘仍交还网页：人是在网页里做事时被问的
  $("#stageKeys").focus({ preventScroll: true });
  if (dialog?.type === "file") {
    stage.dialog = null;
    stageRenderDialog();
    if (accept) stagePickFiles(dialog);
    return;
  }
  const input = /** @type {HTMLInputElement | null} */ ($("#stageDialog .stage-dialog-input"));
  void stageSend("Page.handleJavaScriptDialog", { accept, ...(input ? { promptText: input.value } : {}) }, stage.session).catch(() => {});
  stage.dialog = null;
  stageRenderDialog();
}
// 选文件没有「关了」的事件：模型那头（playwright）替人选了、网页换了页、那个 <input> 没了，卡片都得自己收——隔一会儿看一眼它
/** @param {{ node?: number }} dialog */
async function stageWatchChooser(dialog) {
  const session = stage.session;
  const look = async () => {
    const { object } = await stageSend("DOM.resolveNode", { backendNodeId: dialog.node }, session);
    const { result } = await stageSend(
      "Runtime.callFunctionOn",
      {
        objectId: object.objectId,
        functionDeclaration: "function () { return this.isConnected ? [...this.files].map(f => f.name + ':' + f.size).join('/') : null; }",
        returnByValue: true
      },
      session
    );
    void stageSend("Runtime.releaseObject", { objectId: object.objectId }, session).catch(() => {});
    return result.value ?? null;
  };
  const before = await look().catch(() => null);
  if (before === null) return;
  while (stage.dialog === dialog && stage.session === session) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (stage.dialog !== dialog) return;
    if ((await look().catch(() => null)) === before) continue;
    stage.dialog = null;
    stageRenderDialog();
  }
}
// 选文件用言这边的窗（点「选文件」那一下即是人手的动作，浏览器才许开窗）；选好的落到桥接的临时目录，路径交给网页里那个 <input type=file>
/** @param {{ multiple?: boolean, node?: number }} dialog */
function stagePickFiles(dialog) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = !!dialog.multiple;
  input.addEventListener("change", () => void stageSendFiles([...(input.files || [])], dialog.node));
  input.click();
}
/** @param {File[]} files @param {number} [node] */
async function stageSendFiles(files, node) {
  const session = stage.session;
  if (!files.length || !session) return;
  try {
    const paths = [];
    for (const file of files) paths.push((await bridge("/api/stage/upload", { name: file.name, data: await readFile(file, "data") })).path);
    await stageSend("DOM.setFileInputFiles", { files: paths, backendNodeId: node }, session);
  } catch (error) {
    toast(t`文件未能传入网页：${String(error.message || error).slice(0, 80)}`);
  }
}
/** @param {string} url */
function stageHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
