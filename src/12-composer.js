// 言 · 输入区、图片查看、问候语、主题与外观
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function composerHasContent() {
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
  return !!(input?.value.trim() || pendingAttachments.length || pendingQuote);
}
// 发送键是一方印：印文「寄」即发送，生成中换成「止」；只在变化时重写，免得每次刷新都打断动效
function sealGlyph(button, running) {
  const glyph = running ? "止" : "寄";
  if (button.dataset.glyph === glyph) return;
  button.dataset.glyph = glyph;
  button.innerHTML = `<span class="seal-glyph" aria-hidden="true">${glyph}</span>`;
}
// 作答途中：案上空着，印是「止」；写了话，印又成「寄」——寄出去的是补言，递给正在作答的模型
function renderSendButtons() {
  const running = conversationRunning(),
    ended = conversationDry(currentConversation()),
    has = composerHasContent(),
    stop = running && !has;
  document.querySelectorAll(".send-trigger").forEach(b => {
    sealGlyph(b, stop);
    b.title = stop ? "停止生成" : running ? "补言：递给正在作答的模型" : "发送";
    b.classList.toggle("stop-btn", stop);
    b.classList.toggle("empty", !running && !has);
    b.disabled = !running && ended;
  });
  const input = $("#chatInput");
  if (input && !input.disabled) input.placeholder = running ? "作答途中，亦可补言" : "续言于此";
}
// 图片缩略图：原件在 IndexedDB，渲染后异步补上 src；缓存最近 40 张
async function loadThumbnails(root) {
  for (const img of root.querySelectorAll("img[data-thumb]:not([src])")) {
    const id = img.dataset.thumb;
    try {
      let url = thumbCache.get(id);
      if (!url) {
        const file = await getAttachment(id);
        if (!file || file.kind !== "image") continue;
        url = file.data;
        thumbCache.set(id, url);
        if (thumbCache.size > 40) thumbCache.delete(thumbCache.keys().next().value);
      }
      img.src = url;
      img.closest(".attachment-card, .library-card")?.classList.add("has-thumb");
    } catch {}
  }
}

function toggleImageViewerZoom() {
  const stage = $("#imageViewerStage"),
    actual = !stage.classList.contains("actual");
  stage.classList.toggle("actual", actual);
  $("#imageViewerZoom").textContent = actual ? "适应" : "原图";
  $("#imageViewerZoom").setAttribute("aria-pressed", String(actual));
}
function closeImageViewer() {
  const viewer = $("#imageViewer");
  if (viewer.classList.contains("hidden")) return;
  viewer.classList.add("hidden");
  $("#imageViewerImage").removeAttribute("src");
  $("#imageViewerStage").classList.remove("actual");
  $("#imageViewerZoom").textContent = "原图";
  $("#imageViewerZoom").setAttribute("aria-pressed", "false");
  imageViewerAttachmentId = null;
  const target = imageViewerReturnFocus;
  imageViewerReturnFocus = null;
  if (target?.isConnected) target.focus();
}
async function openImageViewer(id, trigger = null) {
  try {
    const file = await getAttachment(id);
    if (!file) return toast("图片原件已不在此浏览器中");
    if (file.kind !== "image") return downloadAttachment(id);
    imageViewerAttachmentId = id;
    imageViewerArchivePath = null;
    imageViewerReturnFocus = trigger || document.activeElement;
    $("#imageViewerName").textContent = `${file.name || "图片"} · ${formatFileSize(file.size)}`;
    const image = $("#imageViewerImage");
    image.src = file.data;
    image.alt = file.name || "图片预览";
    $("#imageViewerStage").classList.remove("actual");
    $("#imageViewerZoom").textContent = "原图";
    $("#imageViewerZoom").setAttribute("aria-pressed", "false");
    $("#imageViewer").classList.remove("hidden");
    $("#imageViewerClose").focus();
  } catch {
    toast("图片读取失败");
  }
}

const GREETINGS = {
  night: ["夜深墨浓", "夜深人静，正宜长谈", "夜色未央，笔墨相候", "长夜无声，一纸独明"],
  morning: ["晨光入砚", "新墨初研", "清晨落笔，心思澄明", "晨露未晞，素纸已展"],
  day: ["落笔，便有回声", "案上清宁，纸有余白", "一纸铺展，静候墨来", "日色平和，纸墨相候"],
  evening: ["灯下长谈，不觉夜深", "一灯如豆，纸墨相亲", "暮色入窗，墨色渐深", "日暮灯明，余墨尚多"]
};
const WORK_GREETINGS = ["言毕，即行", "墨未干，事已行", "纸上落言，案前成事", "言之所至，行必随之"];
const greetingPick = Math.random();
function greeting() {
  if (workMode()) return WORK_GREETINGS[Math.floor(greetingPick * WORK_GREETINGS.length)];
  const h = new Date().getHours(),
    pool = GREETINGS[h < 6 ? "night" : h < 11 ? "morning" : h < 18 ? "day" : "evening"];
  return pool[Math.floor(greetingPick * pool.length)];
}
const WORK_SUGGESTIONS = [
  [
    "读懂这个项目",
    "先通读工作目录中的项目：用 list_files 与 read_file 了解结构与入口，然后用几段话说明它的用途、运行方式与值得留意之处。不要改动任何文件。"
  ],
  [
    "修一个问题",
    "在工作目录中定位并修复下面的问题：先用 search_files 找到相关代码，read_file 读懂上下文，再用 edit_file 做最小改动，最后运行相关测试或复现步骤验证：\n\n（问题描述）"
  ],
  [
    "加一个功能",
    "在工作目录中实现下面的功能：先看清现有结构与约定，用两三行说明方案，然后落实到文件并运行验证，不要改动无关代码：\n\n（功能描述）"
  ],
  ["写一段脚本并运行", "编写一个脚本完成下述事项，置于工作目录中；写好后运行一遍并给出输出，若有报错则修正至可运行：\n\n（要做的事）"]
];
function safeWebUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "未填写地址";
  }
}
// 明暗切换：新主题像墨一样从右上角侵蚀到左下角（View Transitions）；浏览器不支持或用户减少动态效果时退回颜色渐变
let suppressThemeFade = false;
function switchTheme(next, origin) {
  // 换主题那一下要轻：存盘推后一拍，画面只就地换色（图表由 renderConversation 里的 rethemeViz 就地重上色）
  const apply = () => {
    store.settings.theme = next;
    saveStoreSoon();
    applyAppearance();
    renderHeader();
    if (view === "chat") renderConversation(false);
  };
  const willDark = next === "dark" || (next === "system" && matchMedia("(prefers-color-scheme: dark)").matches),
    current = document.documentElement.dataset.theme;
  if (!document.startViewTransition || inkMotionOff() || (willDark ? "dark" : "light") === current) return apply();
  void rasterMasks().then(() => (willDark ? runInkDrops(apply) : runDawn(apply, origin)));
}
// 明暗切换的遮罩是几张带 feTurbulence 的 SVG（见 00-base.css）。mask-size 逐帧在变，浏览器便逐帧按整屏尺寸重新光栅化这几张矢量图，
// 湍流滤镜算到几千像素见方，再好的机器也掉帧。所以开机后闲时先把它们各画成一张位图，遮罩换成位图，逐帧就只剩缩放一张图
const MASK_VARS = ["--ink-blob-1", "--ink-blob-2", "--ink-blob-3", "--dawn-glow"],
  MASK_BITMAP_SIZE = 1024;
let maskBitmaps = null;
function rasterMasks() {
  if (maskBitmaps) return maskBitmaps;
  maskBitmaps = Promise.all(
    MASK_VARS.map(async name => {
      const url = cssVar(name).match(/^url\((["']?)(.*)\1\)$/s)?.[2];
      if (!url || !url.startsWith("data:image/svg+xml")) return;
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = MASK_BITMAP_SIZE;
      canvas.getContext("2d").drawImage(image, 0, 0, MASK_BITMAP_SIZE, MASK_BITMAP_SIZE);
      document.documentElement.style.setProperty(name, `url("${canvas.toDataURL("image/png")}")`);
    })
  ).catch(() => {});
  return maskBitmaps;
}
// 亮到暗「落墨」：三滴墨先后从画面上方落到纸上，各自洇开——大的那滴居中先落、洇得最快，另两滴偏左右、晚一步、慢一些。
// 落点与各自的半径写在 --x1/--y1/--r1… 上，三层遮罩各走各的动画（见 00-base.css）
const INK_DROPS = [
  { x: 0.5, y: 0.46, size: 1, delay: 0, fall: 0.5 },
  { x: 0.34, y: 0.58, size: 0.76, delay: 85, fall: 0.4 },
  { x: 0.66, y: 0.37, size: 0.62, delay: 165, fall: 0.33 }
];
async function runInkDrops(apply) {
  const html = document.documentElement,
    points = INK_DROPS.map(drop => ({ ...drop, px: innerWidth * drop.x, py: innerHeight * drop.y }));
  points.forEach((point, i) => {
    const reach = Math.hypot(Math.max(point.px, innerWidth - point.px), Math.max(point.py, innerHeight - point.py));
    html.style.setProperty(`--x${i + 1}`, `${point.px}px`);
    html.style.setProperty(`--y${i + 1}`, `${point.py}px`);
    html.style.setProperty(`--r${i + 1}`, `${Math.ceil(reach * 1.15)}px`);
  });
  await Promise.all(points.map(point => inkDropFall(point)));
  // 触纸：滴身钻进纸面，脚下洇出一圈墨——这圈墨就是随后那团暗色的起点。洇开一小会儿再起过渡：旧画面里定格着这几圈墨，
  // 新画面的暗色正从同一处漫出来盖过去，看着就是墨渗进纸里再摊开，而不是先落一滴、再另起一团
  points.forEach(point => inkSoak(point));
  await new Promise(resolve => setTimeout(resolve, 140));
  html.dataset.themeMotion = "ink";
  suppressThemeFade = true;
  const transition = document.startViewTransition(apply);
  transition.finished.finally(() => {
    suppressThemeFade = false;
    delete html.dataset.themeMotion;
    document.querySelectorAll(".ink-drop, .ink-soak").forEach(node => node.remove());
  });
}
// 一滴墨：在落点上方凝出、垂下、坠落时被拉长，触纸的一瞬摊成一小摊。滴身带高光与拖尾，落得越久拉得越长
function inkDropFall(point) {
  const fall = innerHeight * point.fall,
    width = Math.round(26 * point.size),
    height = Math.round(32 * point.size),
    drop = document.createElement("div");
  drop.className = "ink-drop";
  drop.style.cssText = `left:${point.px}px;top:${point.py - fall}px;width:${width}px;height:${height}px`;
  document.body.append(drop);
  const trail = document.createElement("div");
  trail.className = "ink-trail";
  trail.style.cssText = `left:${point.px}px;top:${point.py - fall}px;width:${Math.max(2, Math.round(width * 0.22))}px;height:${fall}px`;
  document.body.append(trail);
  trail
    .animate(
      [
        { transform: "translate(-50%, 0) scaleY(0)", opacity: 0 },
        { transform: "translate(-50%, 0) scaleY(0.75)", opacity: 0.45, offset: 0.6 },
        { transform: "translate(-50%, 0) scaleY(1)", opacity: 0 }
      ],
      { duration: 330, delay: point.delay + 165, easing: "cubic-bezier(0.55, 0, 0.9, 0.42)", fill: "both" }
    )
    .finished.catch(() => {});
  // 凝出、垂下、坠落、触纸摊开。坠落那一段单独用接近自由落体的曲线（位移随时间平方增长），
  // 前面的凝聚与末尾的摊开各用各的节奏，才不像一个匀速下滑的圆点
  const gather = drop.animate(
    [
      { transform: "translate(-50%, -62%) scale(0.2)", opacity: 0 },
      { transform: "translate(-50%, -52%) scale(0.92, 1.02)", opacity: 1, offset: 0.55 },
      // 将坠未坠：被自己的重量拉尖
      { transform: "translate(-50%, -46%) scale(0.74, 1.34)", opacity: 1 }
    ],
    { duration: 170, delay: point.delay, easing: "cubic-bezier(0.3, 0.6, 0.4, 1)", fill: "both" }
  );
  return gather.finished
    .catch(() => {})
    .then(() =>
      drop
        .animate(
          [
            { transform: "translate(-50%, -46%) scale(0.74, 1.34)" },
            { transform: `translate(-50%, calc(-46% + ${fall * 0.55}px)) scale(0.6, 1.72)`, offset: 0.68 },
            { transform: `translate(-50%, calc(-50% + ${fall}px)) scale(1.55, 0.48)` }
          ],
          // 自由落体：起步几乎不动，越落越快，最后一帧才砸到纸上
          { duration: 300, easing: "cubic-bezier(0.55, 0, 0.9, 0.42)", fill: "both" }
        )
        .finished.catch(() => {})
    )
    .finally(() => trail.remove());
}
// 渗入：落点上一圈边缘毛糙的墨，从滴身底下洇出来，越摊越大、越摊越淡；滴身随之压扁、沉进纸里。
// 一滴只画一个元素、只动 transform 与 opacity——旧版落地时溅的十几粒墨点是暗底上的暗点，几乎看不见，白费一份功夫
function inkSoak(point) {
  const size = Math.round(46 * point.size),
    soak = document.createElement("div");
  soak.className = "ink-soak";
  soak.style.cssText = `left:${point.px}px;top:${point.py}px;width:${size}px;height:${size}px`;
  document.body.append(soak);
  soak
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(0.35, 0.22)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1, 0.72)", opacity: 0.92, offset: 0.3 },
        { transform: "translate(-50%, -50%) scale(2.4, 2)", opacity: 0.55 }
      ],
      { duration: 620, easing: "cubic-bezier(0.2, 0.7, 0.25, 1)", fill: "both" }
    )
    .finished.catch(() => {});
  const drop = [...document.querySelectorAll(".ink-drop")].find(node => node.style.left === `${point.px}px`);
  drop
    ?.animate(
      [
        { transform: `translate(-50%, calc(-50% + ${innerHeight * point.fall}px)) scale(1.55, 0.48)`, opacity: 1 },
        { transform: `translate(-50%, calc(-50% + ${innerHeight * point.fall}px)) scale(1.9, 0.16)`, opacity: 0 }
      ],
      { duration: 260, easing: "ease-in", fill: "both" }
    )
    .finished.catch(() => {});
}
// 暗到亮「天光」：墨是从高处落下来的，光则是从按下的那一点亮起来的——以砚台为心向四下漫开，
// 先急后缓，过处的墨色被照淡；旧的暗色在底下略略提亮又退去，像天亮了
function runDawn(apply, origin) {
  const html = document.documentElement,
    rect = origin?.getBoundingClientRect?.(),
    x = rect ? rect.left + rect.width / 2 : innerWidth - 60,
    y = rect ? rect.top + rect.height / 2 : 28;
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  html.style.setProperty("--tx", `${x}px`);
  html.style.setProperty("--ty", `${y}px`);
  // 遮罩外圈近一半是渐隐，要放到两倍多，实心的部分才够推过最远的角
  html.style.setProperty("--tr", `${Math.ceil(reach * 2.2)}px`);
  html.dataset.themeMotion = "dawn";
  suppressThemeFade = true;
  const transition = document.startViewTransition(apply);
  transition.finished.finally(() => {
    suppressThemeFade = false;
    delete html.dataset.themeMotion;
  });
}
function applyAppearance() {
  const { theme, inkMotion, font, width, accent } = store.settings;
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  const html = document.documentElement,
    nextTheme = dark ? "dark" : "light";
  // 只在明暗实际变化时挂一次颜色过渡，避免初始加载闪一下
  html.classList.toggle("theme-fade", !suppressThemeFade && !!html.dataset.theme && html.dataset.theme !== nextTheme);
  clearTimeout(themeFadeTimer);
  if (html.classList.contains("theme-fade")) themeFadeTimer = setTimeout(() => html.classList.remove("theme-fade"), 480);
  html.dataset.theme = nextTheme;
  html.dataset.inkMotion = inkMotion === "off" || (inkMotion === "system" && reducedMotion.matches) ? "off" : "on";
  if (window.mermaid) setupMermaid();
  document.documentElement.style.setProperty("--read", `${Number(width) || 760}px`);
  document.documentElement.style.setProperty("--accent", accent || "#9b5540");
  const root = document.documentElement.style;
  root.setProperty(
    "--body",
    font === "serif" ? '"Noto Serif SC","Songti SC","STSong",serif' : '"Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif'
  );
  root.setProperty(
    "--title",
    font === "sans" ? '"Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif' : '"Noto Serif SC","Songti SC","STSong",serif'
  );
}
