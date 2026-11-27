// 言 · 幻灯片画布：按画面位置把字与基本形状摆回原处，看得出一页的结构。
// 只做「字在哪儿、多大、什么颜色」与矩形/圆/线/表的轮廓、填充；不重绘主题效果、艺术字与动画，图片照包里的原件取。
// 图表照包里带着的数据缓存重画（折线、面积、柱、饼、环形、雷达），智能图形仍留虚线框。
// 一页里但凡有一个字找不到位置（版式里也没有），这一页就退回逐段文字——宁可按段落排，也不猜它该在哪儿。

// 画面里的长度一律折成千分比（纸宽的千分之一）×10 交给 CSS，随纸缩放；EMU 只在这一层用。
const PPTX_PERMILLE = 1000;
// PowerPoint 的「单倍行距」取字体自己的行高：中日文字体约 1.3，按 1.2 排会一路往上漂
const PPTX_LINE_HEIGHT = 1.3;
// 取不到这个属性时要退回缺省：getAttribute 给的是 null，Number(null) 是 0，不能拿它当「写的就是 0」
const pptxAttr = (node, name, fallback = 0) => {
  const raw = node?.getAttribute?.(name);
  const value = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const pptxOn = value => /^(?:1|true)$/.test(String(value || ""));
// 主题的配色表：dk1/lt1/dk2/lt2 与 tx1/bg1/tx2/bg2 是同一批颜色的两个叫法
function pptxTheme(xml) {
  const map = new Map();
  let root = null;
  try {
    root = xml ? parseXml(xml) : null;
  } catch {
    return map;
  }
  const scheme = root && xmlDeep(root, "clrScheme")[0];
  for (const slot of scheme ? [...scheme.children] : []) {
    const color = [...slot.children].find(node => /Clr$/.test(node.localName)),
      value =
        color?.localName === "srgbClr" ? color.getAttribute("val") : color?.localName === "sysClr" ? color.getAttribute("lastClr") : "";
    if (/^[0-9a-f]{6}$/i.test(value || "")) map.set(slot.localName, value.toLowerCase());
  }
  for (const [alias, name] of [
    ["tx1", "dk1"],
    ["bg1", "lt1"],
    ["tx2", "dk2"],
    ["bg2", "lt2"]
  ])
    if (map.has(name)) map.set(alias, map.get(name));
  return map;
}
// 一处颜色：字色、填充、描边都走这里。深浅修饰只按乘算近似——预览看的是结构，不求与 Office 逐像素相同
function pptxColor(fill, theme) {
  const node = fill && [...fill.children].find(child => /^(?:srgbClr|schemeClr|sysClr|scrgbClr|prstClr)$/.test(child.localName));
  if (!node) return null;
  const hex =
    node.localName === "srgbClr"
      ? node.getAttribute("val") || ""
      : node.localName === "schemeClr"
        ? theme.get(node.getAttribute("val")) || ""
        : node.localName === "sysClr"
          ? node.getAttribute("lastClr") || ""
          : "";
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const ratio = name => {
    const value = Number(xmlKids(node, name)[0]?.getAttribute("val"));
    return Number.isFinite(value) ? value / 100000 : 1;
  };
  const scale = ratio("lumMod") * ratio("shade"),
    tint = xmlKids(node, "tint")[0] ? 1 - ratio("tint") : 0,
    rgb = [0, 2, 4].map(at => {
      let channel = parseInt(hex.slice(at, at + 2), 16) * scale;
      if (tint) channel += (255 - channel) * tint;
      return Math.max(0, Math.min(255, Math.round(channel)));
    }),
    alpha = Number(xmlKids(node, "alpha")[0]?.getAttribute("val"));
  return {
    c: rgb.map(value => value.toString(16).padStart(2, "0")).join(""),
    a: Number.isFinite(alpha) ? alpha / 1000 : 100
  };
}
function pptxFillOf(spPr, theme) {
  const solid = xmlKids(spPr, "solidFill")[0];
  if (solid) return pptxColor(solid, theme);
  // 渐变照色标与角度画成 CSS 渐变：模板的装饰色块多半是半透明渐变，取一处色标画实心会盖错
  const fill = xmlKids(spPr, "gradFill")[0],
    stops = fill ? xmlKids(xmlKids(fill, "gsLst")[0] || {}, "gs") : [],
    parts = stops.map(gs => {
      const color = pptxColor(gs, theme);
      // 认不出的色标整块不画：宁缺，不拿一处分不清的色冒充
      return color ? `${cssColor(color.c, color.a)} ${Math.round(pptxAttr(gs, "pos") / 1000)}%` : null;
    });
  if (!parts.length || parts.some(part => !part)) return null;
  // a:lin 的角度从「向右」顺时针算，CSS 从「向上」算：加 90° 即对齐
  const angle = (pptxAttr(xmlKids(fill, "lin")[0], "ang") / 60000 + 90) % 360;
  return { c: "", a: 100, grad: `linear-gradient(${Math.round(angle)}deg, ${parts.join(", ")})` };
}
// #rrggbb 加透明度：CSS 认八位十六进制
const cssColor = (hex, alpha = 100) =>
  `#${hex}${
    alpha < 100
      ? Math.round(alpha * 2.55)
          .toString(16)
          .padStart(2, "0")
      : ""
  }`;
function pptxStrokeOf(spPr, theme) {
  const ln = xmlKids(spPr, "ln")[0];
  if (!ln) return null;
  const color = pptxColor(xmlKids(ln, "solidFill")[0], theme);
  if (!color || !color.a) return null;
  const arrow = name => {
    const end = xmlKids(ln, name)[0];
    return !!end && end.getAttribute("type") !== "none";
  };
  return {
    c: color.c,
    a: color.a,
    w: Math.max(0.4, pptxAttr(ln, "w", 9525) / 12700),
    dash: xmlKids(ln, "prstDash")[0]?.getAttribute("val") || "",
    head: arrow("headEnd"),
    tail: arrow("tailEnd")
  };
}
// 一页的文字：每段记对齐与行距，每一截字字号、颜色。
// 字号缺省时按层往下取：这一截 → 这一段 → 这个框的 lstStyle → 版式占位符 → 母版 txStyles → 18 磅
function pptxCanvasText(shape, inherit, theme, styles) {
  const body = xmlKids(shape, "txBody")[0];
  if (!body) return null;
  const bodyPr = xmlKids(body, "bodyPr")[0],
    lst = xmlKids(body, "lstStyle")[0],
    // 占位符的种类决定取母版哪一套样式：标题、正文、别的文本框各有一套
    kind = inherit?.kind || "",
    family = /^(?:title|ctrTitle)$/i.test(kind) ? "title" : /^(?:body|obj|subTitle)$/i.test(kind) ? "body" : "other",
    // 装不下时 PowerPoint 会整体缩字、压行距；这两个数不读，字就比原件大一圈、行也松一截
    fit = xmlKids(bodyPr, "normAutofit")[0],
    scale = pptxAttr(fit, "fontScale", 100000) / 100000,
    red = pptxAttr(fit, "lnSpcReduction", 0) / 100000,
    counters = new Map(),
    paragraphs = [];
  for (const p of xmlKids(body, "p")) {
    const pPr = xmlKids(p, "pPr")[0],
      lvl = Math.max(0, Math.min(8, pptxAttr(pPr, "lvl"))),
      level = lst && (xmlKids(lst, `lvl${lvl + 1}pPr`)[0] || (lvl ? xmlKids(lst, "lvl1pPr")[0] : undefined)),
      levelRPr = level && xmlKids(level, "defRPr")[0],
      paraRPr = pPr && xmlKids(pPr, "defRPr")[0],
      style = (styles && styles.get(`@${family}|${lvl}`)) || null,
      placeholder = inherit || {},
      fallback = {
        s: pptxAttr(levelRPr, "sz", placeholder.s || style?.s || 1800),
        b: pptxOn(levelRPr?.getAttribute("b")) || !!placeholder.b || !!style?.b,
        c: pptxColor(xmlKids(levelRPr || {}, "solidFill")[0], theme)?.c || placeholder.c || style?.c || theme.get("tx1") || "1a1a1a"
      },
      pick = node => node && [...node.children].find(child => /^(?:buNone|buChar|buBlip|buAutoNum)$/.test(child.localName)),
      bullet = pick(pPr) || pick(level);
    let prefix = "";
    if (bullet?.localName === "buChar") prefix = `${bullet.getAttribute("char") || "•"} `;
    else if (bullet?.localName === "buAutoNum") {
      // 编号从 startAt 起、样式照 type（1. / a. / IV. / 一、…）；不写就是 1
      const start = pptxAttr(bullet, "startAt", 1) || 1,
        n = (counters.get(lvl) ?? start - 1) + 1;
      counters.set(lvl, n);
      prefix = `${pptxNumberText(n, bullet.getAttribute("type") || "arabicPeriod")} `;
    }
    const runs = [];
    for (const part of p.children) {
      if (part.localName === "br") {
        runs.push({ t: "\n" });
        continue;
      }
      if (part.localName !== "r" && part.localName !== "fld") continue;
      const rPr = xmlKids(part, "rPr")[0],
        text = xmlKids(part, "t")
          .map(node => node.textContent)
          .join("");
      if (!text) continue;
      const color = pptxColor(xmlKids(rPr || {}, "solidFill")[0], theme),
        boldValue = rPr?.getAttribute("b") ?? paraRPr?.getAttribute("b") ?? levelRPr?.getAttribute("b") ?? "";
      runs.push({
        t: text,
        s: pptxAttr(rPr, "sz", pptxAttr(paraRPr, "sz", fallback.s)),
        b: pptxOn(boldValue) || (!rPr?.hasAttribute("b") && fallback.b),
        i: pptxOn(rPr?.getAttribute("i")),
        u: /^(?:sng|dbl)$/.test(rPr?.getAttribute("u") || ""),
        c: color?.c || pptxColor(xmlKids(paraRPr || {}, "solidFill")[0], theme)?.c || fallback.c,
        k: pptxAttr(rPr, "spc") / 100
      });
    }
    if (!runs.length) continue;
    if (prefix) runs.unshift({ t: prefix });
    // 段前段后：spcPts 是百分之一磅，spcPct 是行高的百分之几
    const gapOf = name => {
      const node = xmlKids(pPr || {}, name)[0];
      if (!node) return 0;
      const pts = xmlKids(node, "spcPts")[0],
        pct = xmlKids(node, "spcPct")[0];
      if (pts) return { v: pptxAttr(pts, "val") };
      if (pct) return { r: pptxAttr(pct, "val") / 100000 };
      return 0;
    };
    paragraphs.push({
      a: pPr?.getAttribute("algn") || level?.getAttribute("algn") || placeholder.a || style?.a || "",
      m: pptxAttr(pPr, "marL"),
      // 行距两种写法：spcPct 是倍数的百分之几，spcPts 是「固定多少磅」（百分之一磅）
      ls: xmlKids(pPr || {}, "lnSpc")[0] ? pptxAttr(xmlKids(xmlKids(pPr, "lnSpc")[0], "spcPct")[0], "val", 100000) / 100000 : 0,
      lp: pptxAttr(xmlKids(xmlKids(pPr || {}, "lnSpc")[0] || {}, "spcPts")[0], "val"),
      bef: gapOf("spcBef"),
      aft: gapOf("spcAft"),
      r: runs
    });
  }
  if (!paragraphs.length) return null;
  return {
    p: paragraphs,
    anchor: bodyPr?.getAttribute("anchor") || inherit?.va || "t",
    // wrap="none" 的框：PowerPoint 不折行，字照一行铺出框外
    nowrap: bodyPr?.getAttribute("wrap") === "none",
    // 竖排（东亚竖排 eaVert、每行转 90° 的 vert）：字自上而下、行从右往左。画布用 writing-mode 近似
    vert: /^(?:eaVert|vert|vert270|mongolianVert)$/.test(bodyPr?.getAttribute("vert") || ""),
    scale,
    red
  };
}
// 版式与母版的占位符：位置、字号、颜色按 (类型, 序号) 传给页上那个同号占位符
function pptxPlaceholders(xml, theme) {
  const map = new Map();
  let root = null;
  try {
    root = xml ? parseXml(xml) : null;
  } catch {
    return map;
  }
  for (const shape of root ? xmlDeep(root, "sp") : []) {
    const ph = xmlDeep(shape, "ph")[0];
    if (!ph) continue;
    const idx = pptxAttr(ph, "idx"),
      type = ph.getAttribute("type") || (idx ? "body" : "obj"),
      spPr = xmlKids(shape, "spPr")[0],
      xfrm = spPr && xmlKids(spPr, "xfrm")[0],
      off = xfrm && xmlKids(xfrm, "off")[0],
      ext = xfrm && xmlKids(xfrm, "ext")[0],
      body = xmlKids(shape, "txBody")[0],
      bodyPr = body && xmlKids(body, "bodyPr")[0],
      lst = body && xmlKids(body, "lstStyle")[0],
      lvl1 = lst && xmlKids(lst, "lvl1pPr")[0],
      defRPr = lvl1 && xmlKids(lvl1, "defRPr")[0],
      fill = pptxColor(xmlKids(defRPr || {}, "solidFill")[0], theme),
      entry = {
        rect: off && ext ? { x: pptxAttr(off, "x"), y: pptxAttr(off, "y"), w: pptxAttr(ext, "cx"), h: pptxAttr(ext, "cy") } : null,
        s: pptxAttr(defRPr, "sz"),
        b: pptxOn(defRPr?.getAttribute("b")),
        c: fill?.c || "",
        a: lvl1?.getAttribute("algn") || "",
        va: bodyPr?.getAttribute("anchor") || ""
      };
    map.set(`${type}|${idx}`, entry);
    if (!map.has(`${type}|*`)) map.set(`${type}|*`, entry);
    // 页与版式是按 idx 配的（ECMA-376）：页上写 obj、版式写 body 也是同一处
    if (idx && !map.has(`#${idx}`)) map.set(`#${idx}`, entry);
  }
  return map;
}
// 母版的 txStyles：标题、正文、别的文本框各自一级一级的缺省字号与颜色。
// 版式里的占位符只管位置，字号多半写在这里；不读它，标题会按正文的 18 磅排。
function pptxTextStyles(xml, theme) {
  const map = new Map();
  let root = null;
  try {
    root = xml ? parseXml(xml) : null;
  } catch {
    return map;
  }
  const styles = root && xmlDeep(root, "txStyles")[0];
  if (!styles) return map;
  for (const [name, family] of [
    ["titleStyle", "title"],
    ["bodyStyle", "body"],
    ["otherStyle", "other"]
  ]) {
    const style = xmlKids(styles, name)[0];
    if (!style) continue;
    for (let lvl = 0; lvl < 9; lvl += 1) {
      const level = xmlKids(style, `lvl${lvl + 1}pPr`)[0];
      if (!level) continue;
      const defRPr = xmlKids(level, "defRPr")[0],
        fill = pptxColor(xmlKids(defRPr || {}, "solidFill")[0], theme);
      map.set(`@${family}|${lvl}`, {
        s: pptxAttr(defRPr, "sz"),
        b: pptxOn(defRPr?.getAttribute("b")),
        c: fill?.c || "",
        a: level.getAttribute("algn") || ""
      });
    }
  }
  return map;
}
function pptxPlaceholderOf(ph, map) {
  if (!ph || !map) return null;
  const idx = pptxAttr(ph, "idx"),
    type = ph.getAttribute("type") || (idx ? "body" : "obj"),
    entry = map.get(`${type}|${idx}`) || map.get(`${type}|*`) || (idx ? map.get(`#${idx}`) : null) || null;
  // 版式里查不到也把种类带上：母版 txStyles 还要按它取字号
  return entry ? { ...entry, kind: type } : { rect: null, s: 0, b: false, c: "", a: "", va: "", kind: type };
}
// 组的变换：子坐标先按 chOff/chExt 缩放，再落进 off/ext
const pptxCompose = (map, xfrm) => {
  const off = xfrm && xmlKids(xfrm, "off")[0],
    ext = xfrm && xmlKids(xfrm, "ext")[0],
    chOff = xfrm && xmlKids(xfrm, "chOff")[0],
    chExt = xfrm && xmlKids(xfrm, "chExt")[0];
  if (!off || !ext) return map;
  const x0 = pptxAttr(off, "x"),
    y0 = pptxAttr(off, "y"),
    w = pptxAttr(ext, "cx"),
    h = pptxAttr(ext, "cy"),
    cx0 = pptxAttr(chOff, "x", x0),
    cy0 = pptxAttr(chOff, "y", y0),
    cw = pptxAttr(chExt, "cx", w),
    ch = pptxAttr(chExt, "cy", h),
    sx = cw ? w / cw : 1,
    sy = ch ? h / ch : 1;
  return (x, y, ww, hh) => map(x0 + (x - cx0) * sx, y0 + (y - cy0) * sy, ww * sx, hh * sy);
};
// 一页的底色：<p:bg><p:bgPr> 里那一处颜色，或一张铺满的图（模板的雪景、底纹多半是图）；没有就用版式、母版的。
// images 是这份 XML 的 rId → 包内路径（zipRels 得来）：图填色只认得出路径，取不到就不画
function pptxBackground(source, theme, images) {
  // 传进来的可能是已解析的文档（页），也可能是版式/母版那份 XML 原文
  let root = null;
  try {
    root = typeof source === "string" ? (source ? parseXml(source) : null) : source;
  } catch {
    return null;
  }
  const node = xmlDeep(root, "bg")[0],
    props = xmlKids(node, "bgPr")[0],
    color = pptxColor(xmlKids(props || {}, "solidFill")[0], theme);
  if (color?.a) return { c: color.c, img: "" };
  const blip = xmlDeep(xmlKids(props || {}, "blipFill")[0] || {}, "blip")[0],
    id = blip?.getAttribute("r:embed") || blip?.getAttribute("r:link"),
    path = (id && images?.get(id)) || "";
  return path ? { c: "", img: path } : null;
}
const PPTX_CANVAS_KIND = { rect: "rect", roundRect: "round", ellipse: "ellipse", line: "line" };
// 图表：数就带在包里（strCache / numCache / multiLvlStrCache），照它重画，不必读 Excel、不必请 Office。
// 折线、面积、柱（含堆叠与横向）、饼、环形、雷达画得出；曲面、股价、树图这类认不出的，仍留给虚线框。
const PPTX_CHART_KIND = {
  lineChart: "line",
  areaChart: "area",
  barChart: "bar",
  pieChart: "pie",
  doughnutChart: "doughnut",
  radarChart: "radar"
};
// 图表的字号与线宽：原件写的是百分之一磅与 EMU，折成「框宽算作 1000」里的长度——图放在小框里，字也跟着小。
// 这一层只认数与色，怎么摆由预览那一侧画。
function pptxChartSpec(xml, theme, cx) {
  let root = null;
  try {
    root = xml ? parseXml(xml) : null;
  } catch {
    return null;
  }
  const plot = root && xmlDeep(root, "plotArea")[0],
    charts = plot ? [...plot.children].filter(node => /Chart$/.test(node.localName)) : [],
    chart = charts[0];
  // 组合图只画第一组会丢掉数据：暂不支持时照旧留虚线框。
  if (charts.length !== 1 || !PPTX_CHART_KIND[chart.localName] || !(cx > 0)) return null;
  const pt = value => Math.round(((value / 100) * 12700 * 1000 * 100) / cx) / 100,
    length = value => Math.round((value * 1000 * 100) / cx) / 100,
    solid = node => pptxColor(xmlKids(node || {}, "solidFill")[0], theme)?.c || "",
    accents = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"].map(name => theme.get(name)).filter(Boolean),
    // 一处数据缓存：c:pt 按 idx 摆位，取最内一层（多级类别时 c:lvl 从内往外排）
    pointsOf = holder => {
      if (!holder) return [];
      const level = xmlDeep(holder, "lvl")[0] || holder,
        out = [];
      for (const node of xmlDeep(level, "pt"))
        out[Math.round(pptxAttr(node, "idx"))] = xmlDeep(node, "v")
          .map(item => item.textContent.trim())
          .join("");
      return out;
    },
    textOf = node =>
      node
        ? xmlDeep(node, "v")
            .map(item => item.textContent.trim())
            .filter(Boolean)
            .join(" ")
        : "",
    sers = xmlKids(chart, "ser").map((ser, index) => {
      const spPr = xmlKids(ser, "spPr")[0],
        ln = xmlKids(spPr || {}, "ln")[0],
        marker = xmlKids(ser, "marker")[0],
        colors = [];
      // 每一段的颜色在 c:dPt 里：序号写在 c:dPt/c:idx@val 上，不是 dPt 自己的属性
      for (const point of xmlKids(ser, "dPt"))
        colors[Math.round(pptxAttr(xmlKids(point, "idx")[0], "val"))] = solid(xmlKids(point, "spPr")[0]);
      return {
        name: textOf(xmlKids(ser, "tx")[0]),
        // 折线与雷达的色常写在 ln 上，柱与饼写在 spPr 的填充上；都没写按主题的 accent 轮转
        color: solid(spPr) || solid(ln) || accents[index % (accents.length || 1)] || "4f7bff",
        colors,
        cats: pointsOf(xmlKids(ser, "cat")[0]),
        vals: pointsOf(xmlKids(ser, "val")[0]).map(value =>
          value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value)
        ),
        marker: marker ? xmlKids(marker, "symbol")[0]?.getAttribute("val") || "circle" : "",
        markerSize: pt(pptxAttr(xmlKids(marker || {}, "size")[0], "val", 5) * 100),
        lineWidth: length(pptxAttr(ln, "w", 25400))
      };
    });
  if (!sers.length) return null;
  const axisOf = name => [...plot.children].find(node => node.localName === name),
    catAx = axisOf("catAx"),
    valAx = axisOf("valAx"),
    off = node => pptxOn(xmlKids(node || {}, "delete")[0]?.getAttribute("val")),
    labelPos = node => xmlKids(node || {}, "tickLblPos")[0]?.getAttribute("val") || "nextTo",
    txStyle = node => {
      const font = xmlDeep(xmlKids(node || {}, "txPr")[0], "defRPr")[0];
      return { size: pptxAttr(font, "sz"), color: solid(font) };
    },
    lineOf = node => {
      const ln = xmlKids(xmlKids(node || {}, "spPr")[0] || {}, "ln")[0];
      return { color: solid(ln), width: length(pptxAttr(ln, "w", 12700)) };
    },
    gridOf = node => {
      const ln = xmlKids(xmlKids(xmlKids(node || {}, "majorGridlines")[0] || {}, "spPr")[0] || {}, "ln")[0];
      return { color: solid(ln), width: length(pptxAttr(ln, "w", 12700)) };
    },
    scaling = xmlKids(valAx || {}, "scaling")[0],
    chartNode = xmlDeep(root, "chart")[0],
    legendNode = xmlKids(chartNode || {}, "legend")[0],
    legendFont = txStyle(legendNode),
    spaceFont = xmlDeep(xmlKids(xmlKids(root, "chartSpace")[0] || root, "txPr")[0], "defRPr")[0],
    textColor = solid(spaceFont) || txStyle(catAx).color || txStyle(valAx).color || txStyle(legendNode).color || theme.get("tx1") || "",
    fontSize = pptxAttr(spaceFont, "sz") || txStyle(catAx).size || txStyle(valAx).size || 1000;
  return {
    kind: PPTX_CHART_KIND[chart.localName],
    cats: sers.find(ser => ser.cats.length)?.cats || [],
    sers,
    accents,
    font: pt(fontSize),
    legendFont: pt(legendFont.size || fontSize),
    text: textColor,
    // 图例的位置与有无：c:legendPos 是 b / t / l / r / tr；不写 legend 元素就是不要图例
    legend: legendNode ? xmlKids(legendNode, "legendPos")[0]?.getAttribute("val") || "r" : "",
    cat: { show: !!catAx && !off(catAx), labels: !!catAx && labelPos(catAx) !== "none", ...lineOf(catAx) },
    val: {
      show: !!valAx && !off(valAx),
      labels: !!valAx && labelPos(valAx) !== "none",
      min: pptxAttr(xmlKids(scaling || {}, "min")[0], "val", NaN),
      max: pptxAttr(xmlKids(scaling || {}, "max")[0], "val", NaN),
      unit: pptxAttr(xmlKids(valAx || {}, "majorUnit")[0], "val", NaN),
      grid: gridOf(valAx),
      ...lineOf(valAx)
    },
    // 柱：直着放还是横着放、聚成一组还是堆叠、柱间留多宽（不写 overlap 时 Office 的缺省是 -27，柱间留一丝缝）
    barDir: xmlKids(chart, "barDir")[0]?.getAttribute("val") || "col",
    grouping: xmlKids(chart, "grouping")[0]?.getAttribute("val") || "clustered",
    gap: pptxAttr(xmlKids(chart, "gapWidth")[0], "val", 150),
    overlap: pptxAttr(xmlKids(chart, "overlap")[0], "val", -27),
    // 环形：中间空多大、从几点钟起画
    hole: pptxAttr(xmlKids(chart, "holeSize")[0], "val", 50),
    angle: pptxAttr(xmlKids(chart, "firstSliceAng")[0], "val", 0),
    // 雷达：只认 standard / marker / filled 三种，别的照 standard 画
    filled: /filled/.test(xmlKids(chart, "radarStyle")[0]?.getAttribute("val") || "")
  };
}
// 自动编号的记号：阿拉伯、字母、罗马数字与中文数字；认不出的按阿拉伯数字
function pptxNumberText(n, type) {
  const roman = value => {
    /** @type {[number, string][]} */
    const table = [
      [1000, "M"],
      [900, "CM"],
      [500, "D"],
      [400, "CD"],
      [100, "C"],
      [90, "XC"],
      [50, "L"],
      [40, "XL"],
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"]
    ];
    let left = value,
      out = "";
    for (const [size, mark] of table) while (left >= size) (out += mark), (left -= size);
    return out;
  };
  if (/^alphaLc/.test(type)) return String.fromCharCode(97 + ((n - 1) % 26));
  if (/^alphaUc/.test(type)) return String.fromCharCode(65 + ((n - 1) % 26));
  if (/^romanLc/.test(type)) return roman(n).toLowerCase();
  if (/^romanUc/.test(type)) return roman(n);
  if (/^eaNum|^chinese/i.test(type)) return ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][n - 1] || String(n);
  return String(n);
}
// 一页画布。doc 是这一页的 p:sld；返回 {bg, shapes}，排不出位置时给 null
// charts 是这一页 rels 的 rId → 包内路，chartFiles 是路 → 图表 XML：图形框里是图表时照数据缓存重画
function pptxCanvas(doc, ctx) {
  const { W, H, theme, images, ph, styles, charts, chartFiles } = ctx,
    root = xmlDeep(doc, "spTree")[0];
  if (!root || !(W > 0) || !(H > 0)) return null;
  const unit = value => Math.round((value / W) * PPTX_PERMILLE * 10) / 10,
    // 折成纸宽的千分之一：1 磅 = 12700 EMU。字号在 OOXML 里是百分之一磅，线宽与字距是实磅
    pt = value => Math.round((((value / 100) * 12700) / W) * PPTX_PERMILLE * 10) / 10,
    ptv = value => Math.round(((value * 12700) / W) * PPTX_PERMILLE * 10) / 10,
    shapes = [];
  let missing = false,
    count = 0;
  const boxOf = (shape, map) => {
    const spPr = xmlKids(shape, "spPr")[0] || xmlKids(shape, "grpSpPr")[0],
      xfrm = spPr && xmlKids(spPr, "xfrm")[0],
      off = xfrm && xmlKids(xfrm, "off")[0],
      ext = xfrm && xmlKids(xfrm, "ext")[0];
    let rect = off && ext ? map(pptxAttr(off, "x"), pptxAttr(off, "y"), pptxAttr(ext, "cx"), pptxAttr(ext, "cy")) : null;
    if (!rect) {
      const inherited = pptxPlaceholderOf(xmlDeep(shape, "ph")[0], ph);
      if (inherited?.rect) rect = map(inherited.rect.x, inherited.rect.y, inherited.rect.w, inherited.rect.h);
    }
    return rect;
  };
  const walk = (node, map, skipPh = false) => {
    for (const shape of pptxShapeChildren(node)) {
      // 版式、母版上的装饰只画自己画的；占位符的空框与「单击此处编辑」不是这一页的内容
      if (skipPh && xmlDeep(shape, "ph")[0]) continue;
      if (shape.localName === "grpSp") {
        const xfrm = xmlKids(xmlKids(shape, "grpSpPr")[0] || {}, "xfrm")[0];
        walk(shape, xfrm ? pptxCompose(map, xfrm) : map, skipPh);
        continue;
      }
      const spPr = xmlKids(shape, "spPr")[0] || xmlKids(shape, "grpSpPr")[0] || {},
        prst = xmlKids(spPr, "prstGeom")[0]?.getAttribute("prst") || "",
        fill = pptxFillOf(spPr, theme),
        stroke = pptxStrokeOf(spPr, theme);
      if (shape.localName === "graphicFrame") {
        const tbl = xmlDeep(shape, "tbl")[0],
          xfrm = xmlKids(shape, "xfrm")[0],
          off = xfrm && xmlKids(xfrm, "off")[0],
          ext = xfrm && xmlKids(xfrm, "ext")[0];
        // 图表照包里的数据缓存重画；认不出类型的与智能图形仍留一块淡淡的虚线框
        if (!tbl && off && ext) {
          const box = map(pptxAttr(off, "x"), pptxAttr(off, "y"), pptxAttr(ext, "cx"), pptxAttr(ext, "cy")),
            chartId = xmlDeep(shape, "chart")[0]?.getAttribute("r:id"),
            chartXml = chartId && chartFiles ? chartFiles.get(charts?.get(chartId)) : "",
            chart = chartXml ? pptxChartSpec(chartXml, theme, box.w) : null;
          shapes.push({
            x: unit(box.x),
            y: unit(box.y),
            w: unit(box.w),
            h: unit(box.h),
            ...(chart ? { g: "chart", ch: chart } : { g: "blank", k: chartId ? "chart" : "diagram" })
          });
          continue;
        }
        if (!tbl || !off || !ext) continue;
        const rows = xmlKids(tbl, "tr")
          .map(tr => xmlKids(tr, "tc").map(tc => xmlDeep(tc, "p").map(pptxParagraph)))
          .filter(row => row.length);
        if (!rows.length) continue;
        const box = map(pptxAttr(off, "x"), pptxAttr(off, "y"), pptxAttr(ext, "cx"), pptxAttr(ext, "cy")),
          cols = xmlKids(xmlKids(tbl, "tblGrid")[0] || {}, "gridCol").map(col => pptxAttr(col, "w")),
          total = cols.reduce((sum, w) => sum + w, 0) || 1,
          // 表里的字号照格里写的取，没有就按 18 磅
          cellSizes = xmlDeep(tbl, "rPr")
            .map(node => pptxAttr(node, "sz"))
            .filter(Boolean);
        shapes.push({
          x: unit(box.x),
          y: unit(box.y),
          w: unit(box.w),
          h: unit(box.h),
          g: "table",
          cols: cols.length ? cols.map(w => Math.round((w / total) * 1000) / 10) : [],
          rows,
          s: pt(cellSizes.length ? Math.max(...cellSizes) : 1800)
        });
        continue;
      }
      if (shape.localName === "pic") {
        const box = boxOf(shape, map),
          blip = xmlDeep(shape, "blip")[0],
          path = images.get(blip?.getAttribute("r:embed") || blip?.getAttribute("r:link"));
        if (!box || !path) continue;
        const item = { x: unit(box.x), y: unit(box.y), w: unit(box.w), h: unit(box.h), g: "img", src: path },
          // 图片被裁过（头像、截图取一角）：裁掉的比例照原样算，渲染侧把图放大后偏出去，别整张塞进框里
          cut = xmlDeep(shape, "srcRect")[0],
          fractions = cut && ["l", "t", "r", "b"].map(side => pptxAttr(cut, side) / 100000);
        if (fractions && fractions.some(value => value > 0 && value < 1)) item.cr = fractions;
        shapes.push(item);
        continue;
      }
      const text = pptxCanvasText(shape, pptxPlaceholderOf(xmlDeep(shape, "ph")[0], ph), theme, styles),
        // 连接线本身就是一条线；表外的直线/折线连接符也照线画
        kind = shape.localName === "cxnSp" || /Connector\d*$/i.test(prst) ? "line" : PPTX_CANVAS_KIND[prst] || "rect";
      if (!text && !fill && !stroke) continue;
      const box = boxOf(shape, map);
      if (!box || (box.w <= 0 && box.h <= 0)) {
        // 有字却排不出位置：这一页整页退回逐段文字，不猜（版式上的装饰缺位置就不画，不拖累正文）
        if (text && !skipPh) missing = true;
        continue;
      }
      if (++count > 1200) return;
      const item = { x: unit(box.x), y: unit(box.y), w: unit(box.w), h: unit(box.h) };
      if (kind === "line") {
        if (!stroke) continue;
        const xfrm = xmlKids(spPr, "xfrm")[0],
          flipH = pptxOn(xfrm?.getAttribute("flipH")),
          flipV = pptxOn(xfrm?.getAttribute("flipV"));
        item.g = "line";
        item.x = unit(flipH ? box.x + box.w : box.x);
        item.y = unit(flipV ? box.y + box.h : box.y);
        item.w = unit(flipH ? -box.w : box.w);
        item.h = unit(flipV ? -box.h : box.h);
        item.s = stroke.c;
        item.sw = ptv(stroke.w);
        if (stroke.a < 100) item.sa = Math.round(stroke.a);
        if (/dash|Dot/i.test(stroke.dash)) item.sd = /Dot/i.test(stroke.dash) ? "dot" : "dash";
        if (stroke.head) item.sh = 1;
        if (stroke.tail) item.st = 1;
        shapes.push(item);
        continue;
      }
      if (kind !== "rect") item.g = kind;
      if (fill?.grad) item.fg = fill.grad;
      else if (fill && fill.a) {
        item.f = fill.c;
        if (fill.a < 100) item.fa = Math.round(fill.a);
      }
      if (stroke) {
        item.s = stroke.c;
        item.sw = ptv(stroke.w);
        if (stroke.a < 100) item.sa = Math.round(stroke.a);
        if (/dash|Dot/i.test(stroke.dash)) item.sd = /Dot/i.test(stroke.dash) ? "dot" : "dash";
      }
      if (text) {
        // 字号在这一层折成纸宽的比例，渲染侧只管照数写；缩字比例与段前段后也在这里算好。
        // 字号不随组合缩放走：组里的子坐标常是小单位（例如整组放大几百倍才还原），乘上去字会比纸还宽
        item.t = text.p.map(para => {
          const runs = para.r.map(run => ({ ...run, s: pt(run.s * text.scale), k: run.k ? ptv(run.k * text.scale) : 0 })),
            size = runs[0]?.s || pt(1800),
            gap = value => (value?.v ? pt(value.v) : value?.r ? Math.round(value.r * size * 10) / 10 : 0);
          return { ...para, r: runs, mt: gap(para.bef), mb: gap(para.aft), m: unit(para.m), lp: para.lp ? pt(para.lp) : 0 };
        });
        if (text.anchor === "ctr") item.va = "c";
        else if (text.anchor === "b") item.va = "b";
        if (text.nowrap) item.nw = 1;
        if (text.vert) item.vr = 1;
        item.lh = Math.round(PPTX_LINE_HEIGHT * (1 - text.red) * 1000) / 1000;
        const bodyPr = xmlKids(xmlKids(shape, "txBody")[0] || {}, "bodyPr")[0];
        // CSS 的 padding 是上、右、下、左
        item.in = [
          Math.round(unit(pptxAttr(bodyPr, "tIns", 45720)) * 10) / 10,
          Math.round(unit(pptxAttr(bodyPr, "rIns", 91440)) * 10) / 10,
          Math.round(unit(pptxAttr(bodyPr, "bIns", 45720)) * 10) / 10,
          Math.round(unit(pptxAttr(bodyPr, "lIns", 91440)) * 10) / 10
        ];
      }
      shapes.push(item);
    }
  };
  // 先画版式与母版的装饰（模板的底纹、色块、圆标大多在这一层），再画这一页自己的
  for (const layer of ctx.layers || []) walk(layer.tree, (x, y, w, h) => ({ x, y, w, h }), true);
  walk(root, (x, y, w, h) => ({ x, y, w, h }));
  if (missing) return null;
  // 页上没写底色时，底色在版式或母版里
  return { bg: pptxBackground(doc, theme, images) || ctx.bg || null, shapes };
}
