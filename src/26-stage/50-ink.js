// 言 · 游目的朱笔：人在画面上圈点，引给执事；执事在网页上下手处，落一笔给人看。
// 圈点巧在不另起一套标注：与划选正文「引用」同一条路——每圈一处，引文即写进输入框（界面上一句「哪一页、圈了什么字」，
// 给模型的那份另带网址与各处的位置），画面连同朱笔另存一张图作附件；看得见图的模型看图，看不见的读字也找得到。
// 圈点按网页里的位置记（视口坐标加上当时滚到哪儿），网页滚动后朱笔跟着走；换了页即清去，引文送出或移除时也清去。
// 执事落笔：网页里放一个只给看台听的耳目（独立的脚本世界，网页自己的脚本碰不到），报来按下与输入的那一块；
// 执事正在调浏览器、又不是人刚按的，便是它——那一处一圈朱、贴「点击」，输入的那一栏下一道朱线、贴「键入」，一两秒淡去

const STAGE_BINDING = "__yanStageSeen",
  STAGE_WORLD = "yan-stage";
// 耳目：按下报所按的那一件（太大的整块只报指针那一小方），输入报那一栏；指针形状变了报一声（链接上是手、输入框里是竖线）
const STAGE_EAR = `(() => {
  if (window.__yanStageEar) return;
  window.__yanStageEar = 1;
  const tell = (kind, r) => { try { ${STAGE_BINDING}(JSON.stringify({ kind, x: r.left, y: r.top, w: r.width, h: r.height })); } catch {} };
  addEventListener("pointerdown", e => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const el = e.target.closest("a,button,input,select,textarea,label,summary,[role],[onclick],[tabindex]") || e.target, r = el.getBoundingClientRect();
    tell("press", r.width * r.height > 300 * 120 ? new DOMRect(e.clientX - 12, e.clientY - 12, 24, 24) : r);
  }, true);
  addEventListener("input", e => e.target instanceof Element && tell("type", e.target.getBoundingClientRect()), true);
  // 头一回动、指针从框外进来（换了页、出入同源的子框）都报一声：画面上留的可能是上一页、另一框的形状
  let shape;
  addEventListener("mouseout", e => e.relatedTarget || (shape = undefined), true);
  addEventListener("mousemove", e => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    let c = getComputedStyle(e.target).cursor;
    if (c === "auto") c = e.target.closest("input:not([type=button],[type=submit],[type=reset],[type=checkbox],[type=radio],[type=range],[type=color],[type=file]),textarea,[contenteditable]:not([contenteditable=false])") ? "text" : "";
    if (c === shape) return;
    shape = c;
    try { ${STAGE_BINDING}(JSON.stringify({ kind: "cursor", cursor: c })); } catch {}
  }, true);
})()`;
// 圈住的字：圈是框里看得见的文字，点是那一处那一件的字
const STAGE_READ = `(a => {
  const clean = t => String(t || "").replace(/\\s+/g, " ").trim();
  if (a.kind === "dot") { const el = document.elementFromPoint(a.x, a.y); return clean(el && (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || el.value)).slice(0, 60); }
  const out = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), range = document.createRange();
  for (let n; (n = walker.nextNode()) && out.join(" ").length < 120; ) {
    if (!n.data.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) { out.push(n.data); break; }
    }
  }
  return clean(out.join(" ")).slice(0, 120);
})`;

/** @type {{ kind: "loop" | "line" | "dot", pts: number[][], text: string }[]} 人圈点的各处：圈、划的一道线（下划、箭头、删去）、点；pts 是网页里的位置（视口坐标 + 滚动） */
let stageNotes = [];
/** @type {{ kind: string, x: number, y: number, w: number, h: number, at: number }[]} 执事新近落笔的几处，同样按网页里的位置 */
let stageActs = [];
/** @type {{ pts: number[][] } | null} 正在下的那一笔 */
let stageInking = null;
/** @type {any} 圈点引进去的那条引文（还是它，才算游目的），与那张图的附件 id */
let stageQuoteMade = null;

// ---------- 网页里的耳目 ----------
/** @param {string} sessionId @param {string} frameId 主框架的 id 即页的 targetId */
async function stageInkAttach(sessionId, frameId) {
  try {
    // 绑定要 Runtime 域开着才装得进各个脚本世界（网页的 console 也会随之报来，看台不理）
    await stageSend("Runtime.enable", {}, sessionId);
    await stageSend("Runtime.addBinding", { name: STAGE_BINDING, executionContextName: STAGE_WORLD }, sessionId);
    // 下拉框与右键那一段（55-popup.js）同住这个世界，一并装上
    const source = `${STAGE_EAR};\n${STAGE_POPUP_EAR}`;
    await stageSend("Page.addScriptToEvaluateOnNewDocument", { source, worldName: STAGE_WORLD }, sessionId);
    const { executionContextId } = await stageSend("Page.createIsolatedWorld", { frameId, worldName: STAGE_WORLD }, sessionId);
    await stageSend("Runtime.evaluate", { expression: source, contextId: executionContextId }, sessionId);
  } catch {}
}
/** @param {string} payload */
function stageActSeen(payload) {
  let box;
  try {
    box = JSON.parse(payload);
  } catch {
    return;
  }
  if (box.kind === "cursor") return void ($("#stageFrame").style.cursor = /^[a-z-]+$/.test(box.cursor) ? box.cursor : "");
  if (box.kind === "pick") return stagePickOpen(box);
  if (box.kind === "menu") return stageMenuOpen(box);
  if (!stage.busy || Date.now() - stage.userAt < 600) return;
  const act = { ...box, x: box.x + stage.scroll.x, y: box.y + stage.scroll.y, at: Date.now() };
  stageActs = [...stageActs.filter(a => Date.now() - a.at < 1800 && !(a.kind === "type" && act.kind === "type")), act];
  stageInkRender();
  setTimeout(() => {
    stageActs = stageActs.filter(a => a !== act);
    stageInkRender();
  }, 1800);
}

// ---------- 画 ----------
// 椭圆的一笔：与 brushArc 同法，横竖各一个半径，首尾略搭
/** @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} width */
function stageEllipse(cx, cy, rx, ry, width) {
  const points = [],
    steps = 8,
    from = 200,
    span = 345 / steps,
    k = 1 / Math.cos((span * Math.PI) / 360),
    at = (deg, s = 1) => [cx + rx * s * Math.cos((deg * Math.PI) / 180), cy + ry * s * Math.sin((deg * Math.PI) / 180)];
  points.push(...at(from));
  for (let i = 0; i < steps; i++) points.push(...at(from + span * (i + 0.5), k), ...at(from + span * (i + 1)));
  return brushStroke(points, width, { tone: "zhu", tail: 0.1, head: 0.6 });
}
// 手画的一圈：相邻两点的中点作端点、点本身作控制点，连成一笔
/** @param {number[][]} pts @param {number} width */
function stageFreehand(pts, width) {
  const flat = [...pts[0]];
  for (let i = 1; i < pts.length - 1; i++)
    flat.push(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
  const last = pts.at(-1) || pts[0];
  flat.push(last[0], last[1], last[0], last[1]);
  return brushStroke(flat, width, { tone: "zhu", tail: 0.15, head: 0.7 });
}
/** @param {number[][]} pts @param {number} width 视口坐标里的一笔（圈）或一粒（点） */
function stageNoteShape(note, pts, width) {
  if (note.kind === "dot") return `<circle class="zhu" cx="${pts[0][0]}" cy="${pts[0][1]}" r="${width * 1.7}"/>`;
  return stageFreehand(pts, width);
}
/** @param {number[][]} pts */
const stageToView = pts => pts.map(([x, y]) => [x - stage.scroll.x, y - stage.scroll.y]);
// 朱笔画在画面上一层：坐标即网页视口的 CSS 像素，与画面同比缩放；笔粗按缩放折回，屏上看着一样粗
function stageInkRender() {
  const svg = $("#stageInk"),
    sheet = $("#stageSheet"),
    { width, height } = stage.meta,
    k = width / (sheet.clientWidth || width);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const notes = [...stageNotes, ...(stageInking ? [{ kind: /** @type {"loop"} */ ("loop"), pts: stageInking.pts, text: "" }] : [])]
    .filter(note => note.pts.length > 1 || note.kind === "dot")
    .map(note => stageNoteShape(note, stageToView(note.pts), 2.6 * k));
  const acts = stageActs.map(act => {
    const x = act.x - stage.scroll.x,
      y = act.y - stage.scroll.y;
    return act.kind === "type"
      ? brushStroke([x, y + act.h + 3 * k, x + act.w / 2, y + act.h + 1.5 * k, x + act.w, y + act.h + 3.5 * k], 2.2 * k, {
          tone: "zhu",
          tail: 0.1
        })
      : stageEllipse(x + act.w / 2, y + act.h / 2, act.w / 2 + 8 * k, act.h / 2 + 6 * k, 2 * k);
  });
  svg.innerHTML = notes.join("") + `<g class="stage-acts">${acts.join("")}</g>`;
  $("#stageLabels").innerHTML = stageActs
    .map(act => {
      const left = ((act.x - stage.scroll.x + act.w + (act.kind === "type" ? 0 : 6 * k)) / width) * 100,
        top = ((act.y - stage.scroll.y + (act.kind === "type" ? act.h - 6 * k : -18 * k)) / height) * 100;
      return `<span class="stage-label" style="left:${Math.min(92, left)}%;top:${Math.max(0, top)}%">${act.kind === "type" ? t("键入") : t("点击")}</span>`;
    })
    .join("");
}
// 换页、断开：画面上的朱笔清去；已引进输入框的引文与图不动
function stageInkClear() {
  stageNotes = [];
  stageActs = [];
  stageInking = null;
  stageInkRender();
}

// ---------- 圈点 ----------
/** @param {boolean} on */
function stageSetPen(on) {
  stage.pen = on;
  $("#stagePen").setAttribute("aria-pressed", String(on));
  $("#stageView").classList.toggle("pen", on);
}
/** @param {PointerEvent} e */
function stageInkStart(e) {
  const { x, y } = stagePoint(e);
  stageInking = { pts: [[x + stage.scroll.x, y + stage.scroll.y]] };
}
/** @param {PointerEvent} e */
function stageInkMove(e) {
  if (!stageInking) return false;
  const { x, y } = stagePoint(e),
    last = stageInking.pts.at(-1) || [0, 0],
    point = [x + stage.scroll.x, y + stage.scroll.y];
  // 隔几个像素记一点，一圈几十点足矣
  if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 5) {
    stageInking.pts.push(point);
    stageInkRender();
  }
  return true;
}
// 落笔：几乎没动的是点；拖开了的，首尾合拢是圈，不合拢是一道线（划在字下、画个箭头、删去一处都是）。记下那一处的字，随即引进输入框
/** @param {PointerEvent} e */
function stageInkEnd(e) {
  if (!stageInking) return false;
  const pts = stageInking.pts;
  stageInking = null;
  const xs = pts.map(p => p[0]),
    ys = pts.map(p => p[1]),
    box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
    dot = Math.hypot(box.w, box.h) < 12,
    [first, last] = [pts[0], pts.at(-1) || pts[0]],
    closed = Math.hypot(last[0] - first[0], last[1] - first[1]) < Math.max(24, Math.hypot(box.w, box.h) * 0.3),
    note = {
      kind: /** @type {"loop" | "line" | "dot"} */ (dot ? "dot" : closed ? "loop" : "line"),
      pts: dot ? [pts[0]] : pts,
      text: ""
    },
    // 读字的框：一道细线（多是划在字下）上下各放开些，字的中线才落得进来
    padX = Math.max(0, (32 - box.w) / 2),
    padY = Math.max(0, (32 - box.h) / 2);
  stageNotes.push(note);
  stageInkRender();
  const view =
    note.kind === "dot"
      ? { x: pts[0][0] - stage.scroll.x, y: pts[0][1] - stage.scroll.y }
      : { x: box.x - padX - stage.scroll.x, y: box.y - padY - stage.scroll.y, w: box.w + padX * 2, h: box.h + padY * 2 };
  void stageSend(
    "Runtime.evaluate",
    { expression: `(${STAGE_READ})(${JSON.stringify({ kind: note.kind, ...view })})`, returnByValue: true },
    stage.session
  )
    .then(({ result }) => (note.text = String(result?.value || "")))
    .catch(() => {})
    .finally(() => void stageQuote());
  return true;
}
// 圈点各处此刻在视口里的位置（引文给模型写的、附图画的都按这一刻）
function stageNoteBoxes() {
  return stageNotes.map(note => {
    const pts = stageToView(note.pts),
      xs = pts.map(p => p[0]),
      ys = pts.map(p => p[1]);
    return {
      x: Math.round(Math.min(...xs)),
      y: Math.round(Math.min(...ys)),
      w: Math.round(Math.max(...xs) - Math.min(...xs)),
      h: Math.round(Math.max(...ys) - Math.min(...ys))
    };
  });
}
// 引进输入框：一条引文（游目的那句给人看，带位置的那份给模型），连同一张画面叠朱笔的图——图是附件、画在引文里（见 renderQuote）；
// 再圈一处，引文换新，先前那幅随之撤下
async function stageQuote() {
  const tab = stage.tabs.get(stage.current);
  if (!tab || !stageNotes.length) return;
  const host = stageHost(tab.url),
    place = stagePlace(tab),
    boxes = stageNoteBoxes(),
    said = stageNotes.map(
      note =>
        `${{ dot: t("点"), loop: t("圈"), line: t("划") }[note.kind]}${note.text ? `「${note.text.slice(0, 24)}${note.text.length > 24 ? "…" : ""}」` : t("一处")}`
    ),
    name = t`游目 · ${host || t("网页")}.jpg`,
    lines = stageNotes.map((note, i) => {
      const b = boxes[i],
        said = note.text ? ` ——「${note.text}」` : "";
      if (note.kind === "dot") return t`点：网页左 ${b.x}、上 ${b.y}${said}`;
      if (note.kind === "loop") return t`圈：网页左 ${b.x}、上 ${b.y}，宽 ${b.w}、高 ${b.h}${said}`;
      // 一道线记起止：箭头、删去的方向要看得出
      const [from, to] = [stageToView([note.pts[0]])[0], stageToView([note.pts.at(-1) || note.pts[0]])[0]].map(p => p.map(Math.round));
      return t`划：自网页左 ${from[0]}、上 ${from[1]} 至左 ${to[0]}、上 ${to[1]}${said}`;
    });
  // 生成附图要等：其间引文可能被撤（两者都成 null）或换成新圈的，回来只认这一条
  /** @type {any} */
  const made = (stageQuoteMade = {
    text: t`游目 · ${place}　${said.join("　")}`,
    model: [
      t`游目 · ${stageReadable(tab.url)}${tab.title ? `（${tab.title}）` : ""}`,
      ...lines,
      t`附图「${name}」上的朱笔是用户画上去的；位置是网页视口里的 CSS 像素，与附图同一取景`
    ].join("\n"),
    url: tab.url
  });
  pendingQuote = made;
  renderQuote();
  // 附图：此刻的画面，叠上朱笔
  const blob = await stageInkImage();
  if (pendingQuote !== made) return;
  if (blob) {
    const file = await ingestFile(new File([blob], name, { type: "image/jpeg" })).catch(() => null);
    if (file && pendingQuote === made) {
      pendingAttachments = [...pendingAttachments, { ...file, quoted: true }];
      made.image = file.id;
      renderQuote();
      renderAttachments();
    } else if (file) void deleteAttachments([file.id]);
  }
  persistDraft();
}
// 引文里写的「哪一页」：域名 › 页题
/** @param {{ title: string, url: string }} tab */
function stagePlace(tab) {
  const host = stageHost(tab.url);
  return `${host || stageTitle(tab)}${host && tab.title && tab.title !== tab.url ? ` › ${tab.title}` : ""}`;
}
// 右键「引给执事」：网页里选中的一段作引文，与划选正文「引用」同一条路；给模型的那份另带网址
/** @param {string} text */
function stageQuoteText(text) {
  const tab = stage.tabs.get(stage.current);
  if (!tab) return;
  const short = text.replace(/\s+/g, " ");
  pendingQuote = {
    text: t`游目 · ${stagePlace(tab)}　「${short.slice(0, 80)}${short.length > 80 ? "…" : ""}」`,
    model: [t`游目 · ${stageReadable(tab.url)}${tab.title ? `（${tab.title}）` : ""}`, t`网页里选中的一段：${text}`].join("\n"),
    url: tab.url
  };
  renderQuote();
  persistDraft();
}
/** @returns {Promise<Blob | null>} */
async function stageInkImage() {
  const img = /** @type {HTMLImageElement} */ ($("#stageFrame"));
  if (!img.naturalWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  ctx.scale(img.naturalWidth / stage.meta.width, img.naturalHeight / stage.meta.height);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#9b5540";
  for (const note of stageNotes) {
    const shape = stageNoteShape(note, stageToView(note.pts), 3.4),
      circle = shape.match(/cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/);
    if (circle) {
      ctx.beginPath();
      ctx.arc(Number(circle[1]), Number(circle[2]), Number(circle[3]), 0, Math.PI * 2);
      ctx.fill();
    } else for (const [, d] of shape.matchAll(/ d="([^"]+)"/g)) ctx.fill(new Path2D(d));
  }
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.88));
}
// 引文换了（送出、移除、引了别的）：画面上的圈点随之清去
function stageQuoteChanged() {
  if (stageQuoteMade && pendingQuote !== stageQuoteMade) {
    stageQuoteMade = null;
    stageNotes = [];
    stageInkRender();
  }
}
// 点那一问上方的引文：回到游目那一页（开着就换过去，没开着就在当前页打开）
/** @param {string} url */
function stageRevisit(url) {
  openStage();
  if (!stage.ws) return toast(t("浏览器未开"));
  const open = [...stage.tabs].find(([, tab]) => tab.url === url);
  if (open) stageActivate(open[0]);
  else stageGo(url);
}

function bindStageInk() {
  $("#stagePen").addEventListener("click", () => stageSetPen(!stage.pen));
  // 画面换了大小：朱笔的粗细按新的缩放重画
  new ResizeObserver(() => (stageNotes.length || stageActs.length) && stageInkRender()).observe($("#stageSheet"));
}
defineLayer({ name: "stage-pen", rank: 80, open: () => !!stage.pen, close: () => stageSetPen(false) });
