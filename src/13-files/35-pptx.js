// 言 · 幻灯片：同一份结构供眼前逐页看、也供模型读。这里只复原阅读层次，不重画 Office 画布。

// DrawingML 的软换行和单元格里各自独立的段落都不是相邻的字。
const pptxParagraph = p =>
  [...p.children]
    .map(part =>
      part.localName === "br"
        ? "\n"
        : xmlKids(part, "t")
            .map(t => t.textContent)
            .join("")
    )
    .join("")
    .trim();
// 备注只取 body 占位符；页码与缩略图不算。一份坏备注不该拖掉所有幻灯片正文。
function pptxNotes(notesXml) {
  if (notesXml === undefined) return [];
  try {
    return xmlDeep(parseXml(notesXml), "sp")
      .filter(shape => /^body$/i.test(xmlDeep(shape, "ph")[0]?.getAttribute("type") || ""))
      .flatMap(shape => xmlDeep(shape, "p"))
      .map(pptxParagraph)
      .filter(Boolean);
  } catch {
    return null;
  }
}
const pptxInline = (text, bold) => {
  const plain = escapeHtml(text).replace(/\n/g, "<br>");
  return bold ? `<strong>${plain}</strong>` : plain;
};
// 非阿拉伯式自动编号不能直接写成 Markdown 的 a. / iv.：marked 不认它们是列表。
// 遇到这些编号时，仅把那一组要点写成安全的 HTML ol/ul；数字列表仍沿用原来的 Markdown 路。
// ol 的 type/start 由浏览器负责显示 c.、IV. 等标记，不丢层级，也不自己拼一串容易出错的罗马数字。
function pptxSpecialLists(lines) {
  const roots = [],
    parents = [];
  for (const line of lines) {
    let depth = Math.max(0, Math.min(line.depth, parents.length));
    if (depth && !parents[depth - 1]) depth = 0;
    const item = { ...line, children: [] };
    if (depth) parents[depth - 1].children.push(item);
    else roots.push(item);
    parents.length = depth;
    parents[depth] = item;
  }
  const typeOf = line => {
    if (!line.ordered) return "ul";
    const code = String(line.numberType || "");
    if (/^alphaLc/.test(code)) return "a";
    if (/^alphaUc/.test(code)) return "A";
    if (/^romanLc/.test(code)) return "i";
    if (/^romanUc/.test(code)) return "I";
    return "1";
  };
  const render = items => {
    let out = "",
      group = [],
      current = "";
    const flush = () => {
      if (!group.length) return;
      const ordered = current !== "ul",
        start = group[0].startAt || 1;
      out += `<${ordered ? "ol" : "ul"}${ordered ? ` type="${current}" start="${start}"` : ""}>${group
        .map(item => `<li>${pptxInline(item.text, item.bold)}${render(item.children)}</li>`)
        .join("")}</${ordered ? "ol" : "ul"}>`;
      group = [];
    };
    for (const item of items) {
      if (item.plain) {
        flush();
        out += `<p>${pptxInline(item.text, item.bold)}</p>${render(item.children)}`;
        continue;
      }
      const type = typeOf(item);
      if (group.length && (type !== current || (item.startSpecified && item.startAt !== 1))) flush();
      current = type;
      group.push(item);
    }
    flush();
    return out;
  };
  return render(roots);
}
// 坐标只用于找阅读顺序。同一行按左右，组内另用组自己的坐标，不将不同坐标系混排。
function pptxPosition(shape) {
  const props = [...shape.children].find(child => /^(?:spPr|grpSpPr|xfrm)$/.test(child.localName)),
    transform = props?.localName === "xfrm" ? props : props && xmlKids(props, "xfrm")[0],
    offset = transform && xmlKids(transform, "off")[0],
    x = offset?.getAttribute("x"),
    y = offset?.getAttribute("y");
  return x != null && y != null && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? { x: Number(x), y: Number(y) } : null;
}
function pptxReadingOrder(items, height) {
  if (!(height > 0)) return items;
  const positioned = items.filter(item => item.position).sort((a, b) => a.position.y - b.position.y),
    rows = [];
  for (let i = 0; i < positioned.length; ) {
    const start = i++,
      top = positioned[start].position.y;
    while (i < positioned.length && positioned[i].position.y - top <= height * 0.008) i++;
    rows.push(...positioned.slice(start, i).sort((a, b) => a.position.x - b.position.x));
  }
  // 继承版式而没有明确位置的框保留原有槽位，不猜在画面哪一侧。
  let next = 0;
  return items.map(item => (item.position ? rows[next++] : item));
}
function pptxTextBox(shape) {
  const body = xmlKids(shape, "txBody")[0];
  if (!body) return null;
  const ph = xmlDeep(shape, "ph")[0],
    kind = ph?.getAttribute("type") || (ph ? "obj" : ""),
    style = xmlKids(body, "lstStyle")[0];
  let size = 0;
  const lines = xmlKids(body, "p").flatMap(p => {
    const text = pptxParagraph(p);
    if (!text) return [];
    const direct = xmlKids(p, "pPr")[0],
      depth = Math.max(0, Math.min(8, Number(direct?.getAttribute("lvl")) || 0)),
      level = style && xmlKids(style, `lvl${depth + 1}pPr`)[0],
      pick = pr => pr && [...pr.children].find(node => /^(?:buNone|buChar|buBlip|buAutoNum)$/.test(node.localName)),
      bullet = pick(direct) || pick(level),
      auto = bullet?.localName === "buAutoNum" ? bullet : null,
      ownFont = direct && xmlKids(direct, "defRPr")[0],
      levelFont = level && xmlKids(level, "defRPr")[0],
      runs = [...p.children].filter(run => xmlKids(run, "t")[0]?.textContent.trim());
    const fontOf = (run, key) =>
      xmlKids(run, "rPr")[0]?.getAttribute(key) ?? ownFont?.getAttribute(key) ?? levelFont?.getAttribute(key) ?? "";
    for (const run of runs) size = Math.max(size, Number(fontOf(run, "sz")) || 0);
    return [
      {
        text,
        depth,
        bold: runs.length > 0 && runs.every(run => /^(?:1|true)$/.test(fontOf(run, "b"))),
        ordered: !!auto,
        numberType: auto?.getAttribute("type") || "",
        startAt: Number(auto?.getAttribute("startAt")) || 1,
        startSpecified: auto?.hasAttribute("startAt") || false,
        // 普通文本框不是无序列表。正文占位符可能从版式继承项目符号，显式 buNone 优先。
        plain: bullet ? bullet.localName === "buNone" : !depth && !/^(?:body|obj)$/.test(kind)
      }
    ];
  });
  return lines.length ? { kind, lines, size } : null;
}
function pptxTextBlocks(lines) {
  if (lines.some(line => /^(?:alpha|roman)(?:Lc|Uc)/.test(line.numberType))) return [pptxSpecialLists(lines)];
  const points = [],
    counts = new Map(),
    seen = [],
    group = [],
    flush = () => {
      if (group.length) points.push(group.splice(0).join("\n"));
    };
  for (const line of lines) {
    const text = line.bold ? [pptxInline(line.text, true)] : line.text.split("\n").map(mdLine);
    if (line.plain) {
      flush();
      // 文本框中的字面围栏不是代码块，不能把下一框也卷进去。
      points.push(text.map(part => part.replace(/^(\s*)(?=```|~~~)/, "$1\\")).join("\\\n"));
      counts.clear();
      seen.length = 0;
      continue;
    }
    for (const key of counts.keys()) if (key > line.depth) counts.delete(key);
    let mark = "- ";
    if (line.ordered) {
      const n = (counts.get(line.depth) ?? line.startAt - 1) + 1;
      counts.set(line.depth, n);
      mark = `${n}. `;
    }
    // 同 docx：子项缩进到父项记号之后那一列，段内换行留在同一项。
    const indent = seen.slice(0, line.depth).reduce((spaces, width) => spaces + Math.max(2, width), 0);
    seen[line.depth] = mark.length;
    group.push(`${" ".repeat(indent)}${mark}${text.join(`\\\n${" ".repeat(indent + mark.length)}`)}`);
  }
  flush();
  return points;
}
const PPTX_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006",
  PPTX_SHAPE_NAMESPACES = new Set([
    "http://schemas.openxmlformats.org/presentationml/2006/main",
    "http://schemas.openxmlformats.org/drawingml/2006/main",
    "http://purl.oclc.org/ooxml/presentationml/main",
    "http://purl.oclc.org/ooxml/drawingml/main"
  ]);
// 兼容包装不另建坐标系，只把可以读的那一支当作原位置上的孩子；不能把两支一同列出。
/** @param {Element} root @returns {Element[]} */
function pptxShapeChildren(root) {
  return [...root.children].flatMap(child => {
    if (child.namespaceURI !== PPTX_MC || child.localName !== "AlternateContent") return [child];
    const branches = [...child.children].filter(branch => branch.namespaceURI === PPTX_MC),
      selected =
        branches.find(branch => {
          const requires = branch.getAttribute("Requires")?.trim();
          return (
            branch.localName === "Choice" &&
            requires &&
            requires.split(/\s+/).every(prefix => PPTX_SHAPE_NAMESPACES.has(branch.lookupNamespaceURI(prefix)))
          );
        }) || branches.find(branch => branch.localName === "Fallback");
    return selected ? pptxShapeChildren(selected) : [];
  });
}
function pptxPage(tree, rels, notes, index, height) {
  const images = zipRels(rels, "ppt/slides");
  const collect = (root, frameHeight) => {
    const items = [];
    for (const shape of pptxShapeChildren(root)) {
      const position = pptxPosition(shape);
      let box = null,
        blocks = [];
      if (shape.localName === "sp") box = pptxTextBox(shape);
      if (shape.localName === "pic") blocks = [ooxmlImage(shape, images)].filter(Boolean);
      if (shape.localName === "graphicFrame")
        blocks = xmlDeep(shape, "tbl")
          .map(table => mdTable(xmlKids(table, "tr").map(tr => xmlKids(tr, "tc").map(tc => xmlDeep(tc, "p").map(pptxParagraph).join(" ")))))
          .filter(Boolean);
      if (shape.localName === "grpSp") {
        const props = xmlKids(shape, "grpSpPr")[0],
          xfrm = props && xmlKids(props, "xfrm")[0],
          extent = xfrm && xmlKids(xfrm, "chExt")[0];
        blocks = collect(shape, Number(extent?.getAttribute("cy"))).flatMap(readBlocks);
      }
      if (box || blocks.length) items.push({ position, box, blocks });
    }
    return pptxReadingOrder(items, frameHeight);
  };
  const readBlocks = item => (item.box ? pptxTextBlocks(item.box.lines) : item.blocks),
    items = tree ? collect(tree, height) : [],
    titleOf = box => box.lines.map(line => line.text.replace(/\n/g, " ")).join(" "),
    // 自由排版没有 title 占位符时，才在页上部取字号最大的短文本作题。
    heading =
      items.find(item => /^(?:title|ctrTitle)$/i.test(item.box?.kind || "")) ||
      items
        .filter(
          item =>
            item.box &&
            !item.box.kind &&
            item.box.lines.length === 1 &&
            item.box.lines[0].plain &&
            item.box.size >= 2000 &&
            item.position?.y >= 0 &&
            item.position.y <= height / 3 &&
            titleOf(item.box).length <= 120
        )
        .sort((a, b) => b.box.size - a.box.size)[0],
    title = heading ? titleOf(heading.box) : "",
    said = pptxNotes(notes);
  return {
    title,
    // 讲者备注另带一份：画布页不复述 Markdown，但备注要能看
    notes: Array.isArray(said) ? said : [],
    text: [
      pageHeading(index + 1, { heading: true, title }),
      ...items.filter(item => item !== heading).flatMap(readBlocks),
      said === null
        ? t("（这一页的备注未能读出）")
        : said.length
          ? `**${t("备注")}**\n\n${said.map(line => `> ${line.split("\n").map(mdLine).join("\\\n> ")}`).join("\n>\n")}`
          : ""
    ]
      .filter(Boolean)
      .join("\n\n")
  };
}
/** @param {Uint8Array} bytes */
async function extractPptxSlides(bytes) {
  const index = await unzipDocument(bytes, name => name === "ppt/presentation.xml" || name === "ppt/_rels/presentation.xml.rels"),
    manifest = index.get("ppt/presentation.xml"),
    targets = zipRels(index.get("ppt/_rels/presentation.xml.rels"), "ppt", "slide"),
    // 包内文件名不是页序。按 presentation.xml 的关系走，没清单的残缺件才沿用编号顺序。
    presentation = manifest ? parseXml(manifest) : null,
    size = presentation && xmlDeep(presentation, "sldSz")[0],
    width = Number(size?.getAttribute("cx")),
    height = Number(size?.getAttribute("cy")),
    ratio = width / height,
    order = presentation
      ? xmlDeep(presentation, "sldIdLst")
          .flatMap(list => xmlKids(list, "sldId"))
          .map(id =>
            targets.get(
              id.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ||
                id.getAttributeNS("http://purl.oclc.org/ooxml/officeDocument/relationships", "id")
            )
          )
          .filter(Boolean)
      : null,
    wanted = order ? new Set(order.flatMap(name => [name, relsOf(name)])) : null,
    entries = await unzipDocument(bytes, name =>
      wanted ? wanted.has(name) : /^ppt\/slides\/(_rels\/)?slide\d+\.xml(\.rels)?$/.test(name)
    ),
    slides =
      order ||
      [...entries.keys()]
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    parts = slides
      .filter(name => entries.has(name))
      .map(name => {
        const rels = entries.get(relsOf(name)),
          // 重排后备注仍跟着本页；备注编号与幻灯片编号无关。
          note = zipRels(rels, "ppt/slides", "notesSlide").values().next().value;
        return { xml: entries.get(name), rels, note };
      }),
    notes = new Set(parts.map(part => part.note).filter(Boolean)),
    noteEntries = notes.size ? await unzipSelected(bytes, name => notes.has(name), { optional: true }) : new Map(),
    // 画布另要版式、母版与主题：只有占位符的字号、颜色、位置从那里来。没有也能排字，只是继承的取不到
    support = await unzipSelected(
      bytes,
      name => /^ppt\/(?:slideLayouts|slideMasters|theme)\/(?:_rels\/)?[^/]+\.xml(?:\.rels)?$/.test(name),
      { optional: true }
    ).catch(() => new Map()),
    // 图表的数与样式都在 ppt/charts/*.xml 里以缓存形式带着：取齐一次，交给画布照着重画
    chartFiles = await unzipSelected(bytes, name => /^ppt\/charts\/[^/]+\.xml$/.test(name), { optional: true }).catch(() => new Map()),
    frames = new Map(),
    // 版式/母版那份 XML 的 spTree；解析不了就不画这一层装饰
    treeOf = xml => {
      try {
        return (xml && xmlDeep(parseXml(xml), "spTree")[0]) || null;
      } catch {
        return null;
      }
    },
    // 一页的版式 → {theme, ph, styles, bg, layers}。同版式的页共用一份，几十页也只解析几回
    frameOf = rels => {
      const layout = zipRels(rels, "ppt/slides", "slideLayout").values().next().value || "";
      if (frames.has(layout)) return frames.get(layout);
      /** @type {{theme: Map<string,string>, ph: Map<string, any>, styles: Map<string, any>, bg: any, layers: {tree: Element, images: Map<string,string>}[]}} */
      let ctx = { theme: new Map(), ph: new Map(), styles: new Map(), bg: null, layers: [] };
      try {
        const layoutBase = layout.replace(/[^/]+$/, "").replace(/\/$/, ""),
          layoutRels = support.get(relsOf(layout)),
          master = layout ? zipRels(layoutRels, layoutBase, "slideMaster").values().next().value || "" : "",
          masterBase = master.replace(/[^/]+$/, "").replace(/\/$/, ""),
          masterRels = support.get(relsOf(master)),
          themePath = master ? zipRels(masterRels, masterBase, "theme").values().next().value || "" : "",
          theme = pptxTheme(themePath ? support.get(themePath) : undefined),
          layoutImages = zipRels(layoutRels, layoutBase),
          masterImages = zipRels(masterRels, masterBase),
          masterPh = pptxPlaceholders(support.get(master), theme),
          // 母版那套「标题 32 磅、正文 18 磅」的缺省，版式与页上都不写时才有用
          styles = pptxTextStyles(support.get(master), theme),
          // 底色多半写在版式或母版上：版式有就用版式的，否则用母版的（纯色或一张铺满的图）
          bg = pptxBackground(support.get(layout), theme, layoutImages) || pptxBackground(support.get(master), theme, masterImages),
          ph = new Map(masterPh),
          // 版式与母版上自己画的装饰（底纹、色块、圆标）：画在页的形状之下，占位符的空框不画
          layers = [
            { tree: treeOf(support.get(master)), images: masterImages },
            { tree: treeOf(support.get(layout)), images: layoutImages }
          ].filter(layer => layer.tree);
        // 版式优先、母版补缺：同一处字段按「有就用」合，别让空值盖掉继承来的
        for (const [key, entry] of pptxPlaceholders(support.get(layout), theme)) {
          const base = masterPh.get(key) || {};
          ph.set(key, {
            rect: entry.rect || base.rect || null,
            s: entry.s || base.s || 0,
            b: entry.b || base.b,
            c: entry.c || base.c || "",
            a: entry.a || base.a || "",
            va: entry.va || base.va || ""
          });
        }
        ctx = { theme, ph, styles, bg, layers };
      } catch {}
      frames.set(layout, ctx);
      return ctx;
    };
  const pages = [],
    canvases = [];
  parts.forEach(({ xml, rels, note }, index) => {
    let doc = null;
    try {
      doc = parseXml(xml);
    } catch {}
    const tree = doc ? xmlDeep(doc, "spTree")[0] || null : null;
    pages.push(pptxPage(tree, rels, note ? (noteEntries.get(note) ?? "") : undefined, index, height));
    let canvas = null;
    try {
      canvas = tree
        ? pptxCanvas(doc, {
            W: width,
            H: height,
            images: zipRels(rels, "ppt/slides"),
            charts: zipRels(rels, "ppt/slides", "chart"),
            chartFiles,
            ...frameOf(rels)
          })
        : null;
    } catch {}
    canvases.push(canvas);
  });
  return {
    // 模型读的还是这份逐页的 Markdown；画布另一路，只给眼前看
    pages: pages.map(page => page.text),
    titles: pages.map(page => page.title),
    notes: pages.map(page => page.notes),
    canvases,
    ratio: width > 0 && height > 0 && Number.isFinite(ratio) ? ratio : 16 / 9
  };
}
