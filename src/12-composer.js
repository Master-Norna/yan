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
// 作答途中：案上空着，印是「止」；写了话，印又成「寄」——寄出去的是补言，递给正在作答的模型，它读了就改道
function renderSendButtons() {
  const elsewhere = runningElsewhere(),
    running = conversationRunning() || elsewhere,
    ended = conversationDry(currentConversation()),
    has = composerHasContent(),
    stop = running && !has;
  document.querySelectorAll(".send-trigger").forEach(b => {
    sealGlyph(b, stop);
    b.title = elsewhere
      ? "另一个页面正在这段对话里作答，这里跟着看"
      : stop
        ? "停止生成"
        : running
          ? "插言引路：模型说到落点便读这句，可就此改道"
          : "发送";
    b.classList.toggle("stop-btn", stop);
    b.classList.toggle("empty", !running && !has);
    b.disabled = !running && ended;
  });
  const input = $("#chatInput");
  if (input && !input.disabled) input.placeholder = "续言于此"; // 生成中也不换提示语，能插言这件事由印上的「寄」示意
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
    if (!file) return toast("图片原件已找不到");
    if (file.kind !== "image") return openFileViewer({ attachmentId: id }, file.name, trigger);
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
// 明暗切换只动 transform 与 opacity：墨（或光）是几张铺在页面上的位图，从落点放大到盖满整屏，屏幕被完全盖住的那一帧换主题，
// 再让墨色退去、字迹从中浮出。全程在合成层上——不套遮罩、不动滤镜、不用 View Transitions。
// 此前是把新画面套在逐帧变化的遮罩里：遮罩每帧都要按整屏合成一遍，240 Hz 的屏上一眼看得出掉帧；主题重排那一下现在也藏在墨底下
let suppressThemeFade = false;
function switchTheme(next, origin) {
  const apply = () => {
    store.settings.theme = next;
    applyAppearance();
    renderHeader();
    if (view === "chat") renderConversation(false);
  };
  const willDark = next === "dark" || (next === "system" && matchMedia("(prefers-color-scheme: dark)").matches),
    current = document.documentElement.dataset.theme;
  if (inkMotionOff() || (willDark ? "dark" : "light") === current) {
    apply();
    saveStoreSoon();
    return;
  }
  // 存盘等动效走完再做：整个 store 序列化一次可能要几十毫秒，别落在动效中间
  void themeSheets()
    .then(sheets => (willDark ? runInkDrops(apply, sheets) : runDawn(apply, origin, sheets)))
    .finally(saveStoreSoon);
}
// 墨团与光晕的形状是 00-base.css 里几张带湍流滤镜的 SVG（--ink-blob-1/2/3、--dawn-glow）。开机后闲时各画成一张上了色的位图：
// 墨团填墨色、光晕填纸色，切换时只是把这几张图放大——矢量与滤镜一次也不在动效里算
const THEME_SHEETS = [
    ["blob1", "--ink-blob-1", "#1c1a17"],
    ["blob2", "--ink-blob-2", "#1c1a17"],
    ["blob3", "--ink-blob-3", "#1c1a17"],
    ["glow", "--dawn-glow", "#fffdf7"]
  ],
  SHEET_PX = 1024;
/** @type {Promise<Record<string, string>|null>|null} */
let themeSheetCache = null;
function themeSheets() {
  if (themeSheetCache) return themeSheetCache;
  themeSheetCache = Promise.all(
    THEME_SHEETS.map(async ([, name, color]) => {
      const url = cssVar(name).match(/^url\((["']?)(.*)\1\)$/s)?.[2];
      if (!url) throw Error(name);
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = SHEET_PX;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, SHEET_PX, SHEET_PX);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, SHEET_PX, SHEET_PX);
      return `url("${canvas.toDataURL("image/png")}")`;
    })
  )
    .then(urls => Object.fromEntries(THEME_SHEETS.map(([key], i) => [key, urls[i]])))
    .catch(() => {
      themeSheetCache = null;
      return null;
    });
  return themeSheetCache;
}
// 一张铺开的图：定在 (x, y)，从 from 放大到 to；返回节点与放大完成的 promise
function spreadSheet(url, x, y, { from, to, duration, delay = 0, easing }) {
  const el = document.createElement("div");
  el.className = "theme-sheet";
  el.style.cssText = `left:${x}px;top:${y}px;background-image:${url}`;
  document.body.append(el);
  const finished = el
    .animate([{ transform: `translate(-50%, -50%) scale(${from})` }, { transform: `translate(-50%, -50%) scale(${to})` }], {
      duration,
      delay,
      easing,
      fill: "both"
    })
    .finished.catch(() => {});
  return { el, finished };
}
// 盖住整屏之后：换主题、等一帧让新画面在底下画好，再让盖着的图退去
async function revealUnder(apply, sheets, fade) {
  apply();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await Promise.all(
    sheets.map(el =>
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fade, easing: "ease-out", fill: "both" }).finished.catch(() => {})
    )
  );
  sheets.forEach(el => el.remove());
}
const farthestCorner = (x, y) => Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
// 亮到暗「落墨」：三滴墨先后从画面上方落到纸上，各自洇开——大的那滴居中先落、洇得最快，另两滴偏左右、晚一步、慢一些。
// 墨团铺满整屏那一刻换主题，墨色再退成暗色的纸、字迹浮出
const INK_DROPS = [
  { x: 0.5, y: 0.46, size: 1, delay: 0, fall: 0.5, duration: 640, easing: "cubic-bezier(0.12, 0.86, 0.28, 1)" },
  { x: 0.34, y: 0.58, size: 0.76, delay: 60, fall: 0.4, duration: 760, easing: "cubic-bezier(0.12, 0.86, 0.28, 1)" },
  { x: 0.66, y: 0.37, size: 0.62, delay: 120, fall: 0.33, duration: 860, easing: "cubic-bezier(0.18, 0.78, 0.32, 1)" }
];
// 墨团图里实心的部分到半径的 52%，墨团本身占图的 80%：最远的角要落进实心里，图就得放到这么大；
// 位移滤镜把边缘往里推了些，再放宽近一半才保险。放大走到 COVER_AT 时换主题——不等铺完，全黑只停一两帧
const INK_SOLID = 0.8 * 0.52,
  GLOW_SOLID = 0.96 * 0.4,
  COVER_MARGIN = 1.45,
  COVER_AT = 0.55;
async function runInkDrops(apply, sheets) {
  if (!sheets) return apply();
  const points = INK_DROPS.map(drop => ({ ...drop, px: innerWidth * drop.x, py: innerHeight * drop.y }));
  await Promise.all(points.map(point => inkDropFall(point)));
  // 触纸：滴身钻进纸面，脚下洇出一圈墨——这圈墨就是随后那团暗色的起点
  points.forEach(point => inkSoak(point));
  suppressThemeFade = true;
  const spreads = points.map((point, i) =>
    spreadSheet(sheets[`blob${i + 1}`], point.px, point.py, {
      from: 0.04,
      to: (farthestCorner(point.px, point.py) / ((SHEET_PX / 2) * INK_SOLID)) * COVER_MARGIN * [1, 0.9, 0.8][i],
      duration: point.duration,
      delay: [30, 70, 110][i],
      easing: point.easing
    })
  );
  // 盖满就换，不等三团都铺完：第一团放大到五成半时（缓动前急后缓，这时已到九成六）实心已过最远的角，全黑只停一两帧
  await new Promise(resolve => setTimeout(resolve, 30 + points[0].duration * COVER_AT));
  try {
    await revealUnder(
      apply,
      spreads.map(spread => spread.el),
      400
    );
  } finally {
    suppressThemeFade = false;
    document.querySelectorAll(".ink-drop, .ink-soak, .theme-sheet").forEach(node => node.remove());
  }
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
      { duration: 290, delay: point.delay + 135, easing: "cubic-bezier(0.55, 0, 0.9, 0.42)", fill: "both" }
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
    { duration: 140, delay: point.delay, easing: "cubic-bezier(0.3, 0.6, 0.4, 1)", fill: "both" }
  );
  point.drop = drop;
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
          { duration: 260, easing: "cubic-bezier(0.55, 0, 0.9, 0.42)", fill: "both" }
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
  point.drop
    ?.animate(
      [
        { transform: `translate(-50%, calc(-50% + ${innerHeight * point.fall}px)) scale(1.55, 0.48)`, opacity: 1 },
        { transform: `translate(-50%, calc(-50% + ${innerHeight * point.fall}px)) scale(1.9, 0.16)`, opacity: 0 }
      ],
      { duration: 180, easing: "ease-in", fill: "both" }
    )
    .finished.catch(() => {});
}
// 暗到亮「天光」：墨是从高处落下来的，光则是从按下的那一点亮起来的——以砚台为心向四下漫开，先急后缓；
// 光把整屏照白的那一刻换主题，再让光退去，眼睛适应了天光，字迹浮出
async function runDawn(apply, origin, sheets) {
  if (!sheets) return apply();
  const rect = origin?.getBoundingClientRect?.(),
    x = rect ? rect.left + rect.width / 2 : innerWidth - 60,
    y = rect ? rect.top + rect.height / 2 : 28;
  suppressThemeFade = true;
  const glow = spreadSheet(sheets.glow, x, y, {
    from: 0.02,
    to: (farthestCorner(x, y) / ((SHEET_PX / 2) * GLOW_SOLID)) * COVER_MARGIN,
    duration: 820,
    easing: "cubic-bezier(0.5, 0.06, 0.3, 1)"
  });
  // 光先急后缓，照白整纸大约在七成处；照白就换，再让光退去
  await new Promise(resolve => setTimeout(resolve, 820 * 0.7));
  try {
    await revealUnder(apply, [glow.el], 480);
  } finally {
    suppressThemeFade = false;
    document.querySelectorAll(".theme-sheet").forEach(node => node.remove());
  }
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
  document.documentElement.style.setProperty("--read", `${Number(width) || 760}px`);
  document.documentElement.style.setProperty("--accent", accent || "#9b5540");
  const root = document.documentElement.style,
    stacks = FONT_STACKS[font] || FONT_STACKS.mixed;
  html.dataset.font = FONT_STACKS[font] ? font : "mixed";
  root.setProperty("--body", stacks.body);
  root.setProperty("--title", stacks.title);
  rethemeHtmlApps();
}
// 字体档。--title 是读的字（回复正文、标题、印），--body 是界面的字（侧栏、输入、设置）：混排（默认）界面黑、读宋；黑与宋是通体一种；
// 楷与仿宋只换读的字，界面仍是黑——楷与仿宋清瘦，小字号的界面用它费眼。楷与仿宋取自系统（Windows 的 KaiTi / FangSong，
// macOS 的楷体-简 / 仿宋-简），没有的机器落到宋。theme-boot.js 里有同一份表，改这里也要改那里
const SANS = '"Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif',
  SERIF = '"Noto Serif SC","Songti SC","STSong",serif',
  KAI = '"Kaiti SC","KaiTi","STKaiti","楷体","AR PL UKai CN",serif',
  FANGSONG = '"Fangsong SC","FangSong","STFangsong","仿宋","AR PL UMing CN",serif';
const FONT_STACKS = {
  mixed: { body: SANS, title: SERIF },
  sans: { body: SANS, title: SANS },
  serif: { body: SERIF, title: SERIF },
  kai: { body: SANS, title: KAI },
  fangsong: { body: SANS, title: FANGSONG }
};

// 输入：欢迎页的提示词、两处输入框（回车发送、粘贴图片）、输入区高度、引文
function bindComposerEvents() {
  const welcomeInput = $("#welcomeInput"),
    restPlaceholder = welcomeInput.placeholder;
  chatSuggestionsHtml = $("#welcome .suggestions").innerHTML;
  bindSuggestions = () =>
    document.querySelectorAll(".suggestion").forEach(button => {
      const prompt = button.dataset.prompt || button.textContent;
      button.onclick = () => {
        welcomeInput.value = prompt;
        welcomeInput.placeholder = restPlaceholder;
        welcomeInput.classList.remove("previewing");
        grow(welcomeInput);
        persistDraft();
        welcomeInput.focus();
        const start = prompt.indexOf("（"),
          end = start < 0 ? prompt.length : prompt.indexOf("）", start) + 1;
        welcomeInput.setSelectionRange(start < 0 ? prompt.length : start, end);
      };
      // 预览只占一行：取提示词首句并加省略号，不撑高输入框、不推挤按钮
      const preview = `${prompt.split(/\r?\n/)[0].slice(0, 60)}…`;
      button.addEventListener("pointerenter", () => {
        if (welcomeInput.value) return;
        welcomeInput.placeholder = preview;
        welcomeInput.classList.add("previewing");
      });
      button.addEventListener("pointerleave", () => {
        if (welcomeInput.placeholder === preview) {
          welcomeInput.placeholder = restPlaceholder;
          welcomeInput.classList.remove("previewing");
        }
      });
    });
  bindSuggestions();
  [$("#welcomeInput"), $("#chatInput")].forEach(input => {
    input.addEventListener("input", () => {
      grow(input);
      persistDraft();
      renderSendButtons();
    });
    input.addEventListener("keydown", e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const waiting = input.id === "chatInput" && !input.value.trim() ? pendingApprovalHere() : null;
        if (waiting) return approveByEnter(waiting);
        sendOrStop();
      }
    });
    input.addEventListener("paste", e => {
      const images = Array.from(e.clipboardData?.files || []).filter(file => file.type.startsWith("image/"));
      if (!images.length) return;
      e.preventDefault();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "").slice(4);
      void addFiles(
        images.map(
          (file, index) =>
            new File(
              [file],
              `粘贴图片-${stamp}${images.length > 1 ? `-${index + 1}` : ""}.${file.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`,
              { type: file.type }
            )
        )
      );
    });
  });
  // 输入框上方多了请示条、帮手条与改动摘要，正文底部留白随之增减，末句不被盖住
  if ("ResizeObserver" in window)
    new ResizeObserver(() => {
      const area = $("#composerArea");
      if (area && !area.classList.contains("hidden")) {
        $("#chatScroll").style.paddingBottom = `${area.offsetHeight + 16}px`;
        document.documentElement.style.setProperty("--composer-h", `${area.offsetHeight}px`);
        syncChatScrollGrabber();
      }
    }).observe($("#composerArea"));
  $("#composerQuoteClose").onclick = () => {
    pendingQuote = null;
    renderQuote();
    persistDraft();
    $("#chatInput").focus();
  };
  $("#messages").addEventListener("click", event => {
    const block = event.target.closest(".user-quote");
    if (!block) return;
    const source =
      block.dataset.quoteSource && document.querySelector(`#messages [data-message="${CSS.escape(block.dataset.quoteSource)}"]`);
    if (!source) return toast("出处已不在当前页面");
    followBottom = false;
    scrollChatTo(source, "center");
    source.classList.remove("flash");
    void source.offsetWidth;
    source.classList.add("flash");
  });
}
