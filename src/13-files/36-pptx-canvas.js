// 言 · 幻灯片画布：按画面位置把字与基本形状摆回原处，看得出一页的结构。
// 只做「字在哪儿、多大、什么颜色」与矩形/圆/线的轮廓、填充；不重绘主题效果、图表与动画，图片照包里的原件取。
// 一页里但凡有一个字找不到位置（版式里也没有），这一页就退回逐段文字——宁可按段落排，也不猜它该在哪儿。

// 画面里的长度一律折成千分比（纸宽的千分之一）×10 交给 CSS，随纸缩放；EMU 只在这一层用。
const PPTX_PERMILLE = 1000;
const pptxKids = (node, name) => (node && node.children ? [...node.children].filter(child => child.localName === name) : []);
const pptxDeep = (node, name) => (node && node.getElementsByTagNameNS ? [...node.getElementsByTagNameNS("*", name)] : []);
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
  const scheme = root && pptxDeep(root, "clrScheme")[0];
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
    const value = Number(pptxKids(node, name)[0]?.getAttribute("val"));
    return Number.isFinite(value) ? value / 100000 : 1;
  };
  const scale = ratio("lumMod") * ratio("shade"),
    tint = pptxKids(node, "tint")[0] ? 1 - ratio("tint") : 0,
    rgb = [0, 2, 4].map(at => {
      let channel = parseInt(hex.slice(at, at + 2), 16) * scale;
      if (tint) channel += (255 - channel) * tint;
      return Math.max(0, Math.min(255, Math.round(channel)));
    }),
    alpha = Number(pptxKids(node, "alpha")[0]?.getAttribute("val"));
  return {
    c: rgb.map(value => value.toString(16).padStart(2, "0")).join(""),
    a: Number.isFinite(alpha) ? alpha / 1000 : 100
  };
}
function pptxFillOf(spPr, theme) {
  const solid = pptxKids(spPr, "solidFill")[0];
  if (solid) return pptxColor(solid, theme);
  // 渐变只取第一处色标，够看出这块是深是浅
  const stop = pptxDeep(pptxKids(spPr, "gradFill")[0] || { children: [] }, "gs")[0],
    pick = stop && [...stop.children].find(child => /Fill$/.test(child.localName));
  return pick ? pptxColor(pick, theme) : null;
}
function pptxStrokeOf(spPr, theme) {
  const ln = pptxKids(spPr, "ln")[0];
  if (!ln) return null;
  const color = pptxColor(pptxKids(ln, "solidFill")[0], theme);
  if (!color || !color.a) return null;
  const arrow = name => {
    const end = pptxKids(ln, name)[0];
    return !!end && end.getAttribute("type") !== "none";
  };
  return {
    c: color.c,
    a: color.a,
    w: Math.max(0.4, pptxAttr(ln, "w", 9525) / 12700),
    dash: pptxKids(ln, "prstDash")[0]?.getAttribute("val") || "",
    head: arrow("headEnd"),
    tail: arrow("tailEnd")
  };
}
// 一页的文字：每段记对齐与行距，每一截字字号、颜色。
// 字号缺省时按层往下取：这一截 → 这一段 → 这个框的 lstStyle → 版式占位符 → 母版 txStyles → 18 磅
function pptxCanvasText(shape, inherit, theme, styles) {
  const body = pptxKids(shape, "txBody")[0];
  if (!body) return null;
  const bodyPr = pptxKids(body, "bodyPr")[0],
    lst = pptxKids(body, "lstStyle")[0],
    // 占位符的种类决定取母版哪一套样式：标题、正文、别的文本框各有一套
    kind = inherit?.kind || "",
    family = /^(?:title|ctrTitle)$/i.test(kind) ? "title" : /^(?:body|obj|subTitle)$/i.test(kind) ? "body" : "other",
    // 装不下时 PowerPoint 会整体缩字、压行距；这两个数不读，字就比原件大一圈、行也松一截
    fit = pptxKids(bodyPr, "normAutofit")[0],
    scale = pptxAttr(fit, "fontScale", 100000) / 100000,
    red = pptxAttr(fit, "lnSpcReduction", 0) / 100000,
    counters = new Map(),
    paragraphs = [];
  for (const p of pptxKids(body, "p")) {
    const pPr = pptxKids(p, "pPr")[0],
      lvl = Math.max(0, Math.min(8, pptxAttr(pPr, "lvl"))),
      level = lst && (pptxKids(lst, `lvl${lvl + 1}pPr`)[0] || (lvl ? pptxKids(lst, "lvl1pPr")[0] : undefined)),
      levelRPr = level && pptxKids(level, "defRPr")[0],
      paraRPr = pPr && pptxKids(pPr, "defRPr")[0],
      style = (styles && styles.get(`@${family}|${lvl}`)) || null,
      placeholder = inherit || {},
      fallback = {
        s: pptxAttr(levelRPr, "sz", placeholder.s || style?.s || 1800),
        b: pptxOn(levelRPr?.getAttribute("b")) || !!placeholder.b || !!style?.b,
        c: pptxColor(pptxKids(levelRPr || {}, "solidFill")[0], theme)?.c || placeholder.c || style?.c || theme.get("tx1") || "1a1a1a"
      },
      pick = node => node && [...node.children].find(child => /^(?:buNone|buChar|buBlip|buAutoNum)$/.test(child.localName)),
      bullet = pick(pPr) || pick(level);
    let prefix = "";
    if (bullet?.localName === "buChar") prefix = `${bullet.getAttribute("char") || "•"} `;
    else if (bullet?.localName === "buAutoNum") {
      const n = (counters.get(lvl) || 0) + 1;
      counters.set(lvl, n);
      prefix = `${n} `;
    }
    const runs = [];
    for (const part of p.children) {
      if (part.localName === "br") {
        runs.push({ t: "\n" });
        continue;
      }
      if (part.localName !== "r" && part.localName !== "fld") continue;
      const rPr = pptxKids(part, "rPr")[0],
        text = pptxKids(part, "t")
          .map(node => node.textContent)
          .join("");
      if (!text) continue;
      const color = pptxColor(pptxKids(rPr || {}, "solidFill")[0], theme),
        boldValue = rPr?.getAttribute("b") ?? paraRPr?.getAttribute("b") ?? levelRPr?.getAttribute("b") ?? "";
      runs.push({
        t: text,
        s: pptxAttr(rPr, "sz", pptxAttr(paraRPr, "sz", fallback.s)),
        b: pptxOn(boldValue) || (!rPr?.hasAttribute("b") && fallback.b),
        i: pptxOn(rPr?.getAttribute("i")),
        u: /^(?:sng|dbl)$/.test(rPr?.getAttribute("u") || ""),
        c: color?.c || pptxColor(pptxKids(paraRPr || {}, "solidFill")[0], theme)?.c || fallback.c,
        k: pptxAttr(rPr, "spc") / 100
      });
    }
    if (!runs.length) continue;
    if (prefix) runs.unshift({ t: prefix });
    // 段前段后：spcPts 是百分之一磅，spcPct 是行高的百分之几
    const gapOf = name => {
      const node = pptxKids(pPr || {}, name)[0];
      if (!node) return 0;
      const pts = pptxKids(node, "spcPts")[0],
        pct = pptxKids(node, "spcPct")[0];
      if (pts) return { v: pptxAttr(pts, "val") };
      if (pct) return { r: pptxAttr(pct, "val") / 100000 };
      return 0;
    };
    paragraphs.push({
      a: pPr?.getAttribute("algn") || level?.getAttribute("algn") || placeholder.a || "",
      m: pptxAttr(pPr, "marL"),
      ls: pptxKids(pPr || {}, "lnSpc")[0] ? pptxAttr(pptxKids(pptxKids(pPr, "lnSpc")[0], "spcPct")[0], "val", 100000) / 100000 : 0,
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
  for (const shape of root ? pptxDeep(root, "sp") : []) {
    const ph = pptxDeep(shape, "ph")[0];
    if (!ph) continue;
    const idx = pptxAttr(ph, "idx"),
      type = ph.getAttribute("type") || (idx ? "body" : "obj"),
      spPr = pptxKids(shape, "spPr")[0],
      xfrm = spPr && pptxKids(spPr, "xfrm")[0],
      off = xfrm && pptxKids(xfrm, "off")[0],
      ext = xfrm && pptxKids(xfrm, "ext")[0],
      body = pptxKids(shape, "txBody")[0],
      bodyPr = body && pptxKids(body, "bodyPr")[0],
      lst = body && pptxKids(body, "lstStyle")[0],
      lvl1 = lst && pptxKids(lst, "lvl1pPr")[0],
      defRPr = lvl1 && pptxKids(lvl1, "defRPr")[0],
      fill = pptxColor(pptxKids(defRPr || {}, "solidFill")[0], theme),
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
  const styles = root && pptxDeep(root, "txStyles")[0];
  if (!styles) return map;
  for (const [name, family] of [
    ["titleStyle", "title"],
    ["bodyStyle", "body"],
    ["otherStyle", "other"]
  ]) {
    const style = pptxKids(styles, name)[0];
    if (!style) continue;
    for (let lvl = 0; lvl < 9; lvl += 1) {
      const level = pptxKids(style, `lvl${lvl + 1}pPr`)[0];
      if (!level) continue;
      const defRPr = pptxKids(level, "defRPr")[0],
        fill = pptxColor(pptxKids(defRPr || {}, "solidFill")[0], theme);
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
    entry = map.get(`${type}|${idx}`) || map.get(`${type}|*`) || map.get(`*|${idx}`) || null;
  // 版式里查不到也把种类带上：母版 txStyles 还要按它取字号
  return entry ? { ...entry, kind: type } : { rect: null, s: 0, b: false, c: "", a: "", va: "", kind: type };
}
// 组的变换：子坐标先按 chOff/chExt 缩放，再落进 off/ext
const pptxCompose = (map, xfrm) => {
  const off = xfrm && pptxKids(xfrm, "off")[0],
    ext = xfrm && pptxKids(xfrm, "ext")[0],
    chOff = xfrm && pptxKids(xfrm, "chOff")[0],
    chExt = xfrm && pptxKids(xfrm, "chExt")[0];
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
const PPTX_CANVAS_KIND = { rect: "rect", roundRect: "round", ellipse: "ellipse", line: "line" };
// 一页画布。doc 是这一页的 p:sld；返回 {bg, shapes}，排不出位置时给 null
function pptxCanvas(doc, ctx) {
  const { W, H, theme, images, ph, styles } = ctx,
    root = pptxDeep(doc, "spTree")[0];
  if (!root || !(W > 0) || !(H > 0)) return null;
  const unit = value => Math.round((value / W) * PPTX_PERMILLE * 10) / 10,
    // 折成纸宽的千分之一：1 磅 = 12700 EMU。字号在 OOXML 里是百分之一磅，线宽与字距是实磅
    pt = value => Math.round((((value / 100) * 12700) / W) * PPTX_PERMILLE * 10) / 10,
    ptv = value => Math.round(((value * 12700) / W) * PPTX_PERMILLE * 10) / 10,
    shapes = [];
  let missing = false,
    count = 0;
  const boxOf = (shape, map) => {
    const spPr = pptxKids(shape, "spPr")[0] || pptxKids(shape, "grpSpPr")[0],
      xfrm = spPr && pptxKids(spPr, "xfrm")[0],
      off = xfrm && pptxKids(xfrm, "off")[0],
      ext = xfrm && pptxKids(xfrm, "ext")[0];
    let rect = off && ext ? map(pptxAttr(off, "x"), pptxAttr(off, "y"), pptxAttr(ext, "cx"), pptxAttr(ext, "cy")) : null;
    if (!rect) {
      const inherited = pptxPlaceholderOf(pptxDeep(shape, "ph")[0], ph);
      if (inherited?.rect) rect = map(inherited.rect.x, inherited.rect.y, inherited.rect.w, inherited.rect.h);
    }
    return rect;
  };
  const walk = (node, map) => {
    for (const shape of pptxShapeChildren(node)) {
      if (shape.localName === "grpSp") {
        const xfrm = pptxKids(pptxKids(shape, "grpSpPr")[0] || {}, "xfrm")[0];
        walk(shape, xfrm ? pptxCompose(map, xfrm) : map);
        continue;
      }
      const spPr = pptxKids(shape, "spPr")[0] || pptxKids(shape, "grpSpPr")[0] || {},
        prst = pptxKids(spPr, "prstGeom")[0]?.getAttribute("prst") || "",
        fill = pptxFillOf(spPr, theme),
        stroke = pptxStrokeOf(spPr, theme);
      if (shape.localName === "graphicFrame") {
        const tbl = pptxDeep(shape, "tbl")[0],
          xfrm = pptxKids(shape, "xfrm")[0],
          off = xfrm && pptxKids(xfrm, "off")[0],
          ext = xfrm && pptxKids(xfrm, "ext")[0];
        if (!tbl || !off || !ext) continue;
        const rows = pptxKids(tbl, "tr")
          .map(tr => pptxKids(tr, "tc").map(tc => pptxDeep(tc, "p").map(pptxParagraph)))
          .filter(row => row.length);
        if (!rows.length) continue;
        const box = map(pptxAttr(off, "x"), pptxAttr(off, "y"), pptxAttr(ext, "cx"), pptxAttr(ext, "cy")),
          cols = pptxKids(pptxKids(tbl, "tblGrid")[0] || {}, "gridCol").map(col => pptxAttr(col, "w")),
          total = cols.reduce((sum, w) => sum + w, 0) || 1,
          // 表里的字号照格里写的取，没有就按 18 磅
          cellSizes = pptxDeep(tbl, "rPr")
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
          blip = pptxDeep(shape, "blip")[0],
          path = images.get(blip?.getAttribute("r:embed") || blip?.getAttribute("r:link"));
        if (!box || !path) continue;
        shapes.push({ x: unit(box.x), y: unit(box.y), w: unit(box.w), h: unit(box.h), g: "img", src: path });
        continue;
      }
      const text = pptxCanvasText(shape, pptxPlaceholderOf(pptxDeep(shape, "ph")[0], ph), theme, styles),
        kind = PPTX_CANVAS_KIND[prst] || "rect";
      if (!text && !fill && !stroke) continue;
      const box = boxOf(shape, map);
      if (!box || (box.w <= 0 && box.h <= 0)) {
        // 有字却排不出位置：这一页整页退回逐段文字，不猜
        if (text) missing = true;
        continue;
      }
      if (++count > 1200) return;
      const item = { x: unit(box.x), y: unit(box.y), w: unit(box.w), h: unit(box.h) };
      if (kind === "line") {
        if (!stroke) continue;
        const xfrm = pptxKids(spPr, "xfrm")[0],
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
      if (fill && fill.a) {
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
        // 字号在这一层折成纸宽的比例，渲染侧只管照数写；缩字比例与段前段后也在这里算好
        item.t = text.p.map(para => {
          const runs = para.r.map(run => ({ ...run, s: pt(run.s * text.scale), k: run.k ? ptv(run.k * text.scale) : 0 })),
            size = runs[0]?.s || pt(1800),
            gap = value => (value?.v ? pt(value.v) : value?.r ? Math.round(value.r * size * 10) / 10 : 0);
          return { ...para, r: runs, mt: gap(para.bef), mb: gap(para.aft) };
        });
        if (text.anchor === "ctr") item.va = "c";
        else if (text.anchor === "b") item.va = "b";
        if (text.nowrap) item.nw = 1;
        if (text.red) item.lh = Math.round(1.2 * (1 - text.red) * 1000) / 1000;
        const bodyPr = pptxKids(pptxKids(shape, "txBody")[0] || {}, "bodyPr")[0];
        item.in = [
          Math.round(unit(pptxAttr(bodyPr, "lIns", 91440)) * 10) / 10,
          Math.round(unit(pptxAttr(bodyPr, "tIns", 45720)) * 10) / 10,
          Math.round(unit(pptxAttr(bodyPr, "rIns", 91440)) * 10) / 10,
          Math.round(unit(pptxAttr(bodyPr, "bIns", 45720)) * 10) / 10
        ];
      }
      shapes.push(item);
    }
  };
  walk(root, (x, y, w, h) => ({ x, y, w, h }));
  if (missing || !shapes.length) return null;
  const bgNode = pptxDeep(doc, "bg")[0],
    bg = pptxColor(pptxKids(pptxKids(bgNode, "bgPr")[0] || {}, "solidFill")[0], theme);
  return { bg: bg?.a ? bg.c : "", shapes };
}
