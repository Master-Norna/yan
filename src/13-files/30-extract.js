// 言 · 文件 · 文档抽取：PDF 与 Office / ODF 文档抽成文字与 Markdown
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function readFile(file, mode) {
  if (mode !== "data") return file.arrayBuffer().then(decodeTextBytes);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
// 文字按 UTF-8 读，读不通再按 GB18030（中文 Excel 另存的 CSV、旧记事本存的 txt 多是 GBK，按 UTF-8 读满屏乱码）
/** @param {ArrayBuffer|Uint8Array} bytes */
function decodeTextBytes(bytes) {
  // 带 BOM 的 UTF-16（PowerShell 5.1 的 > 重定向、记事本另存的「Unicode」）照 BOM 读
  // 只看头两个字节；空文件、单字节的文件不够两个，按实有的看（越界会抛 RangeError）
  const head = new Uint8Array(
    bytes instanceof ArrayBuffer ? bytes : bytes.buffer,
    bytes instanceof ArrayBuffer ? 0 : bytes.byteOffset,
    Math.min(2, bytes.byteLength)
  );
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}
// 扩展名不在表里、浏览器也没报类型的（.vue、.kt、Dockerfile、.env……）：看开头 64KB，解得通、且不像二进制的当文字。
// 只判「没有 NUL」不够：不少二进制本来就没有 NUL，GB18030 又几乎什么字节都解得出来——解出来的字还得干净。
// 控制字符（\t \n \r \f 与 ESC 除外）与替换字符过 2% 的算二进制；ESC 留着，带色码的日志也算文字
// 解出来的字像不像文字：控制字符（\t \n \r \f 与 ESC 除外）与替换字符过 2% 的算二进制。
// ESC 留着，带色码的日志也算文字；预览那边「扩展名认不出」也照这一处判（见 20-viewer 的 looksLikeText）
function textLooksBinary(text) {
  let bad = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12 && code !== 27)) bad += 1;
  }
  return bad > text.length * 0.02;
}
async function sniffText(file) {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  if (head.includes(0)) return false;
  let text = null;
  for (const label of ["utf-8", "gb18030"])
    try {
      // 真的只取了一截才留着尾巴不判；整份文件末尾的残字仍算解码失败。
      text = new TextDecoder(label, { fatal: true }).decode(head, { stream: file.size > head.length });
      break;
    } catch {}
  return text !== null && !textLooksBinary(text);
}
function bytesFromDataUrl(value) {
  const encoded = String(value).slice(String(value).indexOf(",") + 1),
    binary = atob(encoded),
    bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function trimExtractedText(value) {
  const text = String(value || "")
    .replace(/\0/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  return text.length > MAX_EXTRACTED_CHARS
    ? t`${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[文档内容过长，已在本机截取前 ${MAX_EXTRACTED_CHARS} 个字符]`
    : text;
}
// 页眉与分页：抽取器写下、预览与 read_document 读回，只此一处。PDF 的页眉单独一行「第 n 页」，
// 幻灯片写成「## 第 n 页 · 题」；英文界面里是 Page n（见 i18n/en.js 的「第 {0} 页」）
/** @param {number} page @param {{ heading?: boolean, title?: string }} [options] */
function pageHeading(page, { heading = false, title = "" } = {}) {
  return `${heading ? "## " : ""}${t`第 ${page} 页`}${title ? ` · ${title}` : ""}`;
}
/**
 * 幻灯片只认 `##` 页眉（可带标题），PDF 只认裸页码行，其余文档沿用裸中文页码。
 * 页眉之前的零散文字（少见）接在第一页前，不丢。
 * @param {string} text
 * @param {"slide" | "pdf" | "plain"} style
 * @returns {{ page: number, title: string, text: string }[]}
 */
function splitPages(text, style) {
  const pages = [],
    before = [],
    slide = style === "slide";
  let current = null;
  // 带着行尾切分，识别 LF / CRLF 的同时保留原文换行。
  for (const line of String(text ?? "").split(/(?<=\n)/)) {
    const head = line.match(/^(## )?(?:第 (\d+) 页|Page (\d+))(?: · (.*))?\r?\n?$/);
    if (head && Boolean(head[1]) === slide && (slide || head[4] === undefined) && (style !== "plain" || head[2])) {
      current = { page: Number(head[2] || head[3]), title: head[4] || "", lines: [line] };
      pages.push(current);
    } else if (current) current.lines.push(line);
    else if (line.trim()) before.push(line);
  }
  return pages.map(({ page, title, lines }, i) => ({ page, title, text: (i ? "" : before.join("")) + lines.join("") }));
}
// data：置入的原件（Blob）、原件的字节（预览器现抽时用），或 data: URL（网页交回的 PDF）；不抽的类型不读
/** @param {string} name @param {Blob|string|Uint8Array} data */
async function extractDocumentText(name, data) {
  const extract = fileKind(name).extract;
  if (extract === "pdf") return trimExtractedText(await extractPdfText(data));
  if (extract === "zip") return trimExtractedText(await extractZipDocumentText(fileExtension(name), await bytesOf(data)));
  if (extract === "ipynb") return trimExtractedText(ipynbMarkdown(decodeTextBytes(await bytesOf(data))));
  return "";
}
/** @param {Blob|string|Uint8Array} data */
async function bytesOf(data) {
  return data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof Uint8Array ? data : bytesFromDataUrl(data);
}
/** @param {Blob|string|Uint8Array} data */
async function extractPdfText(data) {
  // 库没载入就抽不了：说一声，别当成「这份 PDF 没内容」悄悄过去（见 00-ingest.js 的 extractionError）
  if (!(await ensureLib("pdf"))) throw Error(t("PDF 抽取库未能载入，原件照发"));
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  const loading = window.pdfjsLib.getDocument({
      data: await bytesOf(data),
      cMapUrl: "./vendor/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "./vendor/standard_fonts/"
    }),
    document = await loading.promise,
    pages = [];
  let chars = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber),
        content = await page.getTextContent();
      let line = "",
        output = [];
      for (const item of content.items || []) {
        if (item.str) line += `${line ? " " : ""}${item.str}`;
        if (item.hasEOL && line) {
          output.push(line);
          line = "";
        }
      }
      if (line) output.push(line);
      chars += output.join("").replace(/\s/g, "").length;
      pages.push(`${pageHeading(pageNumber)}\n${output.join("\n")}`);
      if (pages.join("\n\n").length >= MAX_EXTRACTED_CHARS) break;
    }
  } finally {
    await document.destroy();
  }
  // 扫描版（每页只是一张图）抽出来只剩一串「第 N 页」：不当抽到了文字，原件照发给模型自己看
  if (chars < pages.length * 10) throw Error(t("PDF 没有文字层（多半是扫描件），原件照发"));
  return pages.join("\n\n");
}
// 取包里选中的几份：默认解成文字，raw 给原字节（图）；optional 的条目解不开时留给调用方降级
async function unzipSelected(bytes, wanted, { raw = false, optional = false } = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder(),
    minimum = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset--)
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  if (eocd < 0) throw Error(t("文档压缩结构无效"));
  const count = view.getUint16(eocd + 10, true),
    centralOffset = view.getUint32(eocd + 16, true),
    /** @type {Map<string, string | Uint8Array> & { tooLarge?: string[] }} */
    entries = new Map(),
    // 要的那几份里太大、没解开的：抽正文的那条路据此照实说，别悄悄抽出半份
    tooLarge = [];
  let cursor = centralOffset,
    extractedBytes = 0;
  for (let index = 0; index < count; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true),
      compressedSize = view.getUint32(cursor + 20, true),
      uncompressedSize = view.getUint32(cursor + 24, true),
      nameLength = view.getUint16(cursor + 28, true),
      extraLength = view.getUint16(cursor + 30, true),
      commentLength = view.getUint16(cursor + 32, true),
      localOffset = view.getUint32(cursor + 42, true),
      name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (wanted(name)) {
      if (uncompressedSize > 8 * 1024 * 1024 || extractedBytes + uncompressedSize > 16 * 1024 * 1024) tooLarge.push(name);
      else
        try {
          const localNameLength = view.getUint16(localOffset + 26, true),
            localExtraLength = view.getUint16(localOffset + 28, true),
            start = localOffset + 30 + localNameLength + localExtraLength,
            compressed = bytes.slice(start, start + compressedSize);
          let output;
          if (method === 0) output = compressed;
          else if (method === 8) {
            const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
            output = new Uint8Array(await new Response(stream).arrayBuffer());
          }
          if (output) {
            entries.set(name, raw ? output : decoder.decode(output));
            extractedBytes += output.length;
          }
        } catch (error) {
          if (!optional) throw error;
        }
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (!raw && tooLarge.length) entries.tooLarge = tooLarge;
  return entries;
}
function parseXml(value) {
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.querySelector("parsererror")) throw Error(t("文档 XML 无效"));
  return document;
}
// ---------- 文档抽成 Markdown：标题、加粗、列表、表格照原样，预览交给现成的 Markdown 渲染，送给模型的也是这一份 ----------
// 早先只抽一串字（段落换行、表格用 Tab 连），结构全丢，预览挤成一片、模型也读不出行列。
// 只还原结构与图，不还原版式（字体、配色、图的位置大小、合并单元格）；要看原样，预览里「以本机程序打开」
const MD_TABLE_ROWS = 500,
  MD_TABLE_COLS = 40;
// 遍历 XML 的两件小工具：只在 children 里找、或整棵子树里找（取不到就回空数组，版式/母版里常有缺的节点）
const xmlKids = (node, name) => (node && node.children ? [...node.children].filter(child => child.localName === name) : []);
const xmlDeep = (node, name) => (node && node.getElementsByTagNameNS ? [...node.getElementsByTagNameNS("*", name)] : []);
const mdCell = text =>
  String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
// 段首会被当成 Markdown 记号的字垫一个反斜杠：# > - * + 垫在前面，「1.」垫在点前
const mdLine = text =>
  String(text || "")
    .replace(/^(\s*)([#>*+-])/, "$1\\$2")
    .replace(/^(\s*\d+)\./, "$1\\.");
// 一张表：首行作表头；参差的行补齐，尾上全空的列与行去掉，过大的截住并注一句
function mdTable(rows) {
  let body = rows.map(row => row.map(mdCell));
  while (body.length && body.at(-1).every(cell => !cell)) body.pop();
  let width = Math.min(MD_TABLE_COLS, Math.max(0, ...body.map(row => row.length)));
  while (width && body.every(row => !row[width - 1])) width -= 1;
  if (!body.length || !width) return "";
  const more = body.length - MD_TABLE_ROWS;
  body = body.slice(0, MD_TABLE_ROWS);
  const line = row => `| ${Array.from({ length: width }, (_, i) => row[i] || " ").join(" | ")} |`;
  return (
    [line(body[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...body.slice(1).map(line)].join("\n") +
    (more > 0 ? t`\n\n（其后 ${more} 行未列出）` : "")
  );
}
// 一段里的字：相邻同样式的并成一截再包 ** / *，免得出现「****」
function mdRuns(segments) {
  const merged = [];
  for (const seg of segments) {
    const last = merged.at(-1);
    if (last && last.bold === seg.bold && last.italic === seg.italic) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged
    .map(({ text, bold, italic }) => {
      const mark = bold && italic ? "***" : bold ? "**" : italic ? "*" : "";
      if (!mark) return text;
      const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
      return core ? `${lead}${mark}${core}${mark}${trail}` : text;
    })
    .join("");
}

// ---------- 文档里的图：抽取时只记成包里的路（![说明](word/media/image1.png)），模型知道此处有图；预览时照路从原件取出画上（见 withZipImages）----------
// rels 里某类关系（默认图片）：Id → 包里的路；base 是这份 rels 所属那份 XML 所在的一层（word、ppt/slides、xl/drawings）
function zipRels(relsXml, base, type = "image") {
  const targets = new Map();
  if (relsXml)
    for (const rel of xmlDeep(parseXml(relsXml), "Relationship"))
      if (String(rel.getAttribute("Type") || "").endsWith(`/${type}`) && rel.getAttribute("TargetMode") !== "External") {
        const target = String(rel.getAttribute("Target") || "");
        targets.set(rel.getAttribute("Id"), archiveRelative(target.startsWith("/") ? "" : base, target));
      }
  return targets;
}
const relsOf = path => path.replace(/([^/]+)$/, "_rels/$1.rels");
const mdImage = (alt, path) =>
  path
    ? `![${
        String(alt || "")
          .replace(/[\s[\]]+/g, " ")
          .trim() || t("图片")
      }](${path.replace(/ /g, "%20")})`
    : "";
// OOXML 的一处图（blip 的 r:embed、旧式 Word 的 imagedata r:id；说明在 docPr / cNvPr 的 descr 上）
const ooxmlImage = (node, images) => {
  const blip = xmlDeep(node, "blip")[0],
    legacy = xmlDeep(node, "imagedata")[0];
  return mdImage(
    (xmlDeep(node, "docPr")[0] || xmlDeep(node, "cNvPr")[0])?.getAttribute("descr") || legacy?.getAttribute("o:title"),
    images.get(blip ? blip.getAttribute("r:embed") : legacy?.getAttribute("r:id"))
  );
};
const ZIP_IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml"
};
// 画好的预览里，照 img 记下的路从原件包里取图换成 data: 地址；取不到的、浏览器画不了的（EMF、WMF、TIFF）留一行字。
// bytes 是原件本身（Uint8Array）：抽正文与取图共用同一份，不必编成 data: URL 再解一遍
async function withZipImages(html, bytes) {
  if (!bytes || !html.includes("data-path")) return html;
  const box = document.createElement("template");
  box.innerHTML = html;
  const imgs = [...box.content.querySelectorAll("img[data-path]")],
    pathOf = img => archiveRelative("", img.getAttribute("data-path") || ""),
    wanted = new Set(imgs.map(pathOf)),
    media = await unzipSelected(bytes, name => wanted.has(name), { raw: true }).catch(() => new Map());
  for (const img of imgs) {
    const path = pathOf(img),
      type = ZIP_IMAGE_TYPES[fileExtension(path)];
    img.removeAttribute("data-path");
    img.removeAttribute("data-file");
    if (media.has(path) && type) img.setAttribute("src", await readFile(new Blob([media.get(path)], { type }), "data"));
    else img.replaceWith(t`[图片 ${path.split("/").pop()} 预览不了]`);
  }
  return box.innerHTML;
}

// 编号：Word 把「1. 2. 3.」的定义放在 numbering.xml，段落的 pPr 里只说「用第几号」；而用「编号」「项目符号」
// 按钮设的列表常常连 pPr 都不写，编号挂在对齐的段落样式上（styles.xml 的 pStyle 里的 numPr）。两处都要认，
// 否则最常见的 Word 列表会塌成普通段落（实测卷宗里《全谷物数据分析报告》54 段 ListBullet 全是这样）。
// 返回 { styleNum: 样式 id → { numId, ilvl }, levels: numId → (ilvl → { fmt, start }) }
function docxNumbering(stylesXml, numberingXml) {
  const styleNum = new Map(),
    levels = new Map();
  if (stylesXml)
    for (const style of xmlDeep(parseXml(stylesXml), "style")) {
      const numPr = xmlKids(xmlKids(style, "pPr")[0] || style, "numPr")[0];
      if (!numPr) continue;
      const numId = xmlKids(numPr, "numId")[0]?.getAttribute("w:val");
      if (numId != null)
        styleNum.set(style.getAttribute("w:styleId"), { numId, ilvl: Number(xmlKids(numPr, "ilvl")[0]?.getAttribute("w:val")) || 0 });
    }
  if (!numberingXml) return { styleNum, levels };
  const root = parseXml(numberingXml),
    abstracts = new Map();
  for (const abstract of xmlDeep(root, "abstractNum")) {
    const byLevel = new Map();
    for (const lvl of xmlKids(abstract, "lvl"))
      byLevel.set(Number(lvl.getAttribute("w:ilvl")) || 0, {
        fmt: xmlKids(lvl, "numFmt")[0]?.getAttribute("w:val") || "decimal",
        start: Number(xmlKids(lvl, "start")[0]?.getAttribute("w:val")) || 1
      });
    abstracts.set(abstract.getAttribute("w:abstractNumId"), byLevel);
  }
  for (const num of xmlDeep(root, "num")) {
    const byLevel = abstracts.get(xmlKids(num, "abstractNumId")[0]?.getAttribute("w:val"));
    if (byLevel) levels.set(num.getAttribute("w:numId"), byLevel);
  }
  return { styleNum, levels };
}
// docx：正文按块走（段落、表格，内容控件等容器往里钻）；标题认样式名（styles.xml 里的 heading n / Title，中文版 Word 的样式 id 是数字）
function docxMarkdown(documentXml, stylesXml, relsXml, numberingXml) {
  const styleNames = new Map(),
    images = zipRels(relsXml, "word"),
    lists = docxNumbering(stylesXml, numberingXml),
    // 各号列表自己的计数：Markdown 的有序列表靠数字开头，序号得自己数（渲染器会重排，但读原文的人与模型看的是这个）
    counters = new Map(),
    // 各号列表在每一层用过的记号宽度：子项要缩进到父项记号之后那一列，`- ` 是 2 格、`1. ` 是 3 格
    seenMarks = new Map();
  const listSeen = numId => {
    if (!seenMarks.has(numId)) seenMarks.set(numId, []);
    return seenMarks.get(numId);
  };
  const listMark = (numId, depth) => {
    const level = lists.levels.get(numId)?.get(depth);
    // 没有编号定义（合成样本、或 numbering.xml 不全）时退回项目符号：至少仍是一条列表，不冒充有序
    if (!level) return "- ";
    if (level.fmt === "none") return "";
    if (level.fmt === "bullet") return "- ";
    const slots = counters.get(numId) || new Map();
    counters.set(numId, slots);
    const n = slots.has(depth) ? slots.get(depth) + 1 : (level.start ?? 1);
    slots.set(depth, n);
    for (const key of [...slots.keys()]) if (key > depth) slots.delete(key);
    return `${n}. `;
  };
  if (stylesXml)
    for (const style of xmlDeep(parseXml(stylesXml), "style"))
      styleNames.set(style.getAttribute("w:styleId"), String(xmlKids(style, "name")[0]?.getAttribute("w:val") || "").toLowerCase());
  const flag = node => !!node && !["0", "false"].includes(String(node.getAttribute("w:val")));
  // 图在 run 里：新式 drawing、旧式 pict / object；AlternateContent 两份都有，ooxmlImage 只取头一份
  const image = part => ooxmlImage(part, images);
  const runText = run => {
    let text = "";
    for (const part of run.children)
      if (part.localName === "t") text += part.textContent;
      else if (part.localName === "tab") text += " ";
      else if (part.localName === "br" || part.localName === "cr") text += "\n";
      else if (/^(drawing|pict|object|AlternateContent)$/.test(part.localName)) text += image(part);
    return text;
  };
  const paragraph = p => {
    const props = xmlKids(p, "pPr")[0],
      styleId = props && xmlKids(props, "pStyle")[0]?.getAttribute("w:val"),
      name = styleNames.get(styleId) || String(styleId || "").toLowerCase(),
      level = name === "title" ? 1 : Number(name.match(/heading ?(\d)/)?.[1]) || 0,
      // 段落自己写了 numPr 就听它的，没写才看它挂的段落样式（Word 的「编号」「项目符号」按钮大多写进样式里）。
      // 两样各按各的取：段落只写 ilvl、把 numId 留给样式的写法很常见（沿用上一段的编号、只降一级），
      // 一并当成「没写 numPr」会把继承来的编号整个丢掉，那一段就落成普通文字。
      // numId 写 0 是显式取消编号，仍按普通段落排
      own = props && xmlKids(props, "numPr")[0],
      ownId = own ? xmlKids(own, "numId")[0]?.getAttribute("w:val") : undefined,
      ownLevel = own ? xmlKids(own, "ilvl")[0]?.getAttribute("w:val") : undefined,
      inherited = lists.styleNum.get(styleId),
      numId = ownId !== undefined ? ownId : inherited?.numId,
      depth = ownLevel !== undefined ? Number(ownLevel) || 0 : (inherited?.ilvl ?? 0),
      mark = numId && numId !== "0" ? listMark(numId, depth) : "";
    const segments = xmlDeep(p, "r").map(run => {
      const rp = xmlKids(run, "rPr")[0];
      return { text: runText(run), bold: !level && flag(rp && xmlKids(rp, "b")[0]), italic: flag(rp && xmlKids(rp, "i")[0]) };
    });
    // 段首的记号转义施在原字上（施在拼好的「**…**」上会把加粗本身转掉）
    const first = segments.find(seg => seg.text.trim());
    if (first && !level && !mark) first.text = mdLine(first.text.trimStart());
    const text = mdRuns(segments).trim();
    if (!text) return "";
    if (level) return `${"#".repeat(Math.min(level, 6))} ${text.replace(/\n/g, " ")}`;
    // 缩进到父项记号之后那一列：有序列表的记号比项目符号宽一格，一律缩两格时渲染器不认这一层，子项会被当成父项的续文
    if (mark) {
      const seen = listSeen(numId),
        indent = seen.slice(0, depth).reduce((spaces, width) => spaces + Math.max(2, width), 0);
      seen[depth] = mark.length;
      return `${" ".repeat(indent)}${mark}${text.replace(/\n/g, " ")}`;
    }
    // 段内换行用反斜杠硬换行（行尾两个空格的写法会被 trimExtractedText 收掉）
    return text.replace(/\n/g, "\\\n");
  };
  const cellText = cell =>
    xmlDeep(cell, "p")
      .map(p => xmlDeep(p, "r").map(runText).join(""))
      .join(" ");
  const out = [];
  const walk = node => {
    for (const child of node.children) {
      if (child.localName === "p") out.push(paragraph(child));
      else if (child.localName === "tbl") out.push(mdTable(xmlKids(child, "tr").map(tr => xmlKids(tr, "tc").map(cellText))));
      else if (child.localName !== "sectPr") walk(child);
    }
  };
  const body = xmlDeep(parseXml(documentXml), "body")[0];
  if (body) walk(body);
  // 列表项之间不空行，别的块之间空一行
  return out
    .filter(Boolean)
    .reduce(
      (text, block, i, all) =>
        text + (i ? (/^\s*(?:- |\d+\. )/.test(block) && /^\s*(?:- |\d+\. )/.test(all[i - 1]) ? "\n" : "\n\n") : "") + block,
      ""
    );
}
// xlsx：一张表一节「## 表名」；单元格按引用（C5）落到它自己的列上，空格子不挤掉后面的列
function xlsxColumn(ref) {
  let n = 0;
  for (const ch of String(ref || "").replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}
// 反过来：零起的列、行 → C5
function xlsxRef(col, row) {
  let letters = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters && Number.isFinite(row) ? `${letters}${row + 1}` : "";
}
// 单元格只存数值，看起来的样子（日期、百分比、千分位）全在 styles.xml 里：numFmt 是自定义的格式串，cellXfs 是「格的 s 属性 → 格式号」那张表。
// 不照它写，2024-01-15 抽出来是 45306、23.5% 是 0.235——读者（人和模型）得自己拿计算器倒推
function xlsxFormats(stylesXml) {
  const codes = new Map(),
    xfs = [];
  if (!stylesXml) return { codes, xfs };
  const styles = parseXml(stylesXml);
  for (const fmt of xmlDeep(styles, "numFmt")) codes.set(Number(fmt.getAttribute("numFmtId")), fmt.getAttribute("formatCode") || "");
  const list = xmlDeep(styles, "cellXfs")[0];
  if (list) for (const xf of xmlKids(list, "xf")) xfs.push(Number(xf.getAttribute("numFmtId")) || 0);
  return { codes, xfs };
}
// 序号 → 字面。三种形态分开：带日子的日历；只有时刻；经过时长（[h]:mm:ss 的 36 小时写 36:00:00，
// 不绕回 24 小时以内、也不进位成日子）。秒只在格式里有 s 时才写，格式里没有 h 的（mm:ss）从分钟起。
// 时刻一律写成 24 小时制：格式里的 AM/PM 与「上午/下午」不另转，给人读时 24 小时制反倒是没有歧义的。
// 1900 系统把并不存在的 1900-02-29 当成真日子（Excel 为兼容 Lotus 留的错），60 之前的序号因此得补一天；
// 1904 系统（旧版 Mac Excel）从 1904-01-01 起算，换成 1900 系统的序号是 +1462
function xlsxTimeText(serial, bare, date1904, elapsed, withDate) {
  const two = n => String(n).padStart(2, "0"),
    withHour = /h/i.test(bare) || elapsed === "h",
    withSecond = /s/i.test(bare) || elapsed === "s",
    // 秒数先进位再拆，免得 59.9999 秒落成 59:60
    clockOf = seconds =>
      `${withHour ? `${Math.floor(seconds / 3600)}:${two(Math.floor(seconds / 60) % 60)}` : two(Math.floor(seconds / 60) % 60)}${withSecond ? `:${two(seconds % 60)}` : ""}`;
  // 累计时长连整天一起算，不绕回 24 小时：[h] 数总小时、[m] 数总分钟、[s] 数总秒；
  // 格式里没写的单位不缀（[h] 就是 36、[m]:ss 才是 2160:00）。
  // 只认 [h] 的话，[m]:ss 的 36 小时会被剥掉修饰、当成「只有秒的时刻」，显示成 00:00
  if (elapsed) {
    const total = Math.round(serial * 86400);
    if (elapsed === "s") return String(total);
    if (elapsed === "m") return withSecond ? `${Math.floor(total / 60)}:${two(total % 60)}` : String(Math.floor(total / 60));
    const hours = Math.floor(total / 3600);
    if (!withSecond && !/m/i.test(bare)) return String(hours);
    return `${hours}:${two(Math.floor(total / 60) % 60)}${withSecond ? `:${two(total % 60)}` : ""}`;
  }
  const days = date1904 ? serial + 1462 : serial < 60 ? serial + 1 : serial,
    whole = Math.floor(days),
    at = new Date(Date.UTC(1899, 11, 30) + whole * 86400000),
    date = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`,
    clock = clockOf(Math.round((days - whole) * 86400));
  // 格式里有 h 就一定缀时刻（22 号「m/d/yyyy h:mm」的 00:00 也是它的一部分）；只有日子的不缀
  return withDate ? (withHour || withSecond ? `${date} ${clock}` : date) : clock;
}
// 按格式把数写成它看起来的样子：# 是「有才写」的可选位（末尾的 0 要收掉），0 是必写位（留着）。
// 百分比也一样照格式：0.##% 的 0.235 是 23.5%、不是 24%——只数 0 会把它当没有小数位、四舍五入掉
function xlsxFixed(number, bare) {
  const spec = (bare.match(/\.([0#]+)/) || [])[1];
  if (!spec) return number.toFixed(0);
  const [whole, fraction = ""] = number.toFixed(spec.length).split("."),
    least = spec.replace(/#/g, "").length;
  let end = fraction.length;
  while (end > least && fraction[end - 1] === "0") end--;
  return end ? `${whole}.${fraction.slice(0, end)}` : whole;
}
// 千分位只动整数部分：1.234567 不该变成 1.234,567
function xlsxGroup(raw) {
  const parts = String(raw).match(/^(-?)(\d+)(.*)$/);
  return parts ? `${parts[1]}${parts[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${parts[3]}` : raw;
}
// 内置格式号对应的格式串：styles.xml 只列自定义的那些，内置的（日期、时刻、百分比、千分位……）从来不写在里面。
// 要判准是不是日期、要不要带秒，就得知道格式串，常用的这些照 Excel 自己的定义补在这里
const XLSX_BUILTIN_CODES = {
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0",
  38: "#,##0",
  39: "#,##0.00",
  40: "#,##0.00",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
  48: "##0.0E+0",
  49: "@"
};
// 上表没列的内置号只有各语言（中日韩等）的日期与时刻格式，判不出格式串，就只认它属于哪一类
const XLSX_DATE_IDS = new Set([27, 28, 29, 30, 31, 36, 50, 51, 52, 53, 54, 57, 58]),
  XLSX_CLOCK_IDS = new Set([32, 33, 34, 35, 55, 56]);
// General 格式不写小数位，二进制浮点的尾巴就露出来了（0.1+0.2 存成 0.30000000000000004，Excel 自己显示 0.3）：
// 按 Excel 自家的精度（15 位有效数字）收一下，收完更短的才用——长的整数不碰
function xlsxGeneral(raw) {
  const number = Number(raw);
  if (!Number.isFinite(number)) return raw;
  const tidy = String(Number(number.toPrecision(15)));
  return tidy.length < String(raw).length ? tidy : raw;
}
// 一格数字写成它看起来的样子；格式认不出、或本来就是字符串的，照原值
function xlsxNumber(raw, numFmtId, code, date1904) {
  const number = Number(raw);
  if (!Number.isFinite(number)) return raw;
  const sections = String(code || XLSX_BUILTIN_CODES[numFmtId] || "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .split(";");
  // 条件可能让正数也跳到后面的段；不猜条件，保留原值。颜色与累计单位不是条件。
  if (sections.some(section => /\[\s*[<>=]/.test(section))) return raw;
  // 复杂的正/负/零分段不猜；先挑出这一格能用的段，再辨累计单位。
  if ((number < 0 && sections.length > 1) || (number === 0 && sections.length > 2)) return raw;
  const written = sections[0],
    elapsed = /\[h+\]/i.test(written) ? "h" : /\[m+\]/i.test(written) ? "m" : /\[s+\]/i.test(written) ? "s" : "",
    bare = written.replace(/\[[^\]]*\]/g, ""),
    numeric = /^(?:[#0]|#,##0)(?:\.[0#]{1,20})?%?$/.test(bare);
  if (numeric) {
    const percent = bare.endsWith("%"),
      fixed = xlsxFixed(percent ? number * 100 : number, bare);
    return `${bare.startsWith("#,##") ? xlsxGroup(fixed) : fixed}${percent ? "%" : ""}`;
  }
  // 判不出格式串的内置号只能照号认：那几号是日期还是时刻
  const date = /[yd]/i.test(bare) || (!bare && XLSX_DATE_IDS.has(numFmtId)),
    clock = elapsed || /[hs]/i.test(bare) || (!bare && XLSX_CLOCK_IDS.has(numFmtId));
  if (date || clock) return xlsxTimeText(number, bare, date1904, elapsed, date);
  return bare ? raw : xlsxGeneral(raw);
}
function xlsxMarkdown(entries) {
  const oversized = new Set(entries.tooLarge || []),
    skippedSheets = new Set([...oversized].filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))),
    omit = name => t`（文档内部一份太大，未能列出：${name}）`;
  // 缺共享字符串或工作簿索引，内容可能整体读错。缺单张表，则留住其它表并标明缺页。
  const missing = [...oversized].find(name => /^xl\/(sharedStrings|workbook)\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(name));
  if (missing) throw Error(t`文档内部有一份太大（${missing}），本机没能抽出正文`);
  const sharedXml = entries.get("xl/sharedStrings.xml"),
    shared = sharedXml
      ? xmlDeep(parseXml(sharedXml), "si").map(si =>
          xmlDeep(si, "t")
            .filter(t => t.parentElement?.localName !== "rPh")
            .map(t => t.textContent)
            .join("")
        )
      : [];
  const styles = xlsxFormats(entries.get("xl/styles.xml")),
    // 1904 起算的（旧版 Mac Excel）在 workbook.xml 的 workbookPr 上标着
    date1904 = /date1904="(1|true)"/.test(entries.get("xl/workbook.xml") || "");
  // 表名与表文件的对应：workbook.xml 里的 sheet（名字、r:id）经 rels 找到 worksheets/sheetN.xml；对不上就按文件名顺序、以「工作表 n」为名
  const targets = new Map();
  const rels = entries.get("xl/_rels/workbook.xml.rels");
  if (rels)
    for (const rel of xmlDeep(parseXml(rels), "Relationship"))
      targets.set(rel.getAttribute("Id"), `xl/${String(rel.getAttribute("Target")).replace(/^\/?xl\//, "")}`);
  const workbook = entries.get("xl/workbook.xml");
  let sheets = workbook
    ? xmlDeep(parseXml(workbook), "sheet")
        .map(sheet => ({ name: sheet.getAttribute("name"), file: targets.get(sheet.getAttribute("r:id")) }))
        .filter(sheet => entries.has(sheet.file) || skippedSheets.has(sheet.file))
    : [];
  if (!sheets.length)
    sheets = [...entries.keys(), ...skippedSheets]
      .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((file, i) => ({ name: t`工作表 ${i + 1}`, file }));
  return sheets
    .map(({ name, file }, i) => {
      if (skippedSheets.has(file)) return `## ${name}\n\n${omit(file)}`;
      const rows = xmlDeep(parseXml(entries.get(file)), "row").map(row => {
        const cells = [];
        let next = 0;
        for (const cell of xmlKids(row, "c")) {
          const at = cell.getAttribute("r") ? xlsxColumn(cell.getAttribute("r")) : next,
            type = cell.getAttribute("t"),
            value = xmlKids(cell, "v")[0]?.textContent ?? "",
            // 格上没写 s 就是第 0 号格式（General）；公式没有缓存值时 <v> 是空的，这时把式子本身写出来，比留一格空白诚实
            format = styles.xfs[Number(cell.getAttribute("s")) || 0] || 0,
            formula = xmlKids(cell, "f")[0]?.textContent || "";
          next = at + 1;
          if (at >= MD_TABLE_COLS) continue;
          cells[at] =
            type === "s"
              ? (shared[Number(value)] ?? "")
              : type === "inlineStr"
                ? xmlDeep(cell, "t")
                    .map(t => t.textContent)
                    .join("")
                : type === "b"
                  ? value === "1"
                    ? "TRUE"
                    : "FALSE"
                  : value === ""
                    ? formula
                      ? `=${formula}`
                      : ""
                    : // 字符串型的公式结果（t="str"）与错误（t="e"）照原值：TEXT(A1,"00000") 的 00123 不能收成 123
                      type === "str" || type === "e"
                      ? value
                      : xlsxNumber(value, format, styles.codes.get(format), date1904);
        }
        return Array.from(cells, cell => cell ?? "");
      });
      // 图挂在绘图层上：表的 rels → drawingN.xml → 它的 rels → media；每张注上锚在哪一格
      const pictures = [...zipRels(entries.get(relsOf(file)), parentDir(file), "drawing").values()]
        .filter(drawing => entries.has(drawing))
        .flatMap(drawing => {
          const images = zipRels(entries.get(relsOf(drawing)), parentDir(drawing));
          return [...parseXml(entries.get(drawing)).documentElement.children].map(anchor => {
            const pic = xmlKids(anchor, "pic")[0],
              from = xmlKids(anchor, "from")[0],
              picture = pic ? ooxmlImage(pic, images) : "",
              at = from ? xlsxRef(Number(xmlKids(from, "col")[0]?.textContent), Number(xmlKids(from, "row")[0]?.textContent)) : "";
            return picture && at ? `${at}：${picture}` : picture;
          });
        })
        .filter(Boolean);
      const other = i === 0 ? [...oversized].filter(part => !skippedSheets.has(part)).map(omit) : [];
      return [`## ${name}`, mdTable(rows) || (pictures.length ? "" : t("（空表）")), ...pictures, ...other].filter(Boolean).join("\n\n");
    })
    .join("\n\n");
}
// ODF（odt / ods / odp）：content.xml 里标题、段落、列表、表格、演示页各归其位
function odfMarkdown(contentXml) {
  const out = [];
  let pages = 0;
  // 每一层用过的记号宽度：子项要缩进到父项记号之后那一列（同 docx、pptx）
  const seen = [];
  const text = node => node.textContent.replace(/\s+/g, " ").trim();
  const repeat = (node, name) => Math.min(50, Number(node.getAttribute(name)) || 1);
  // 列表的编号也挂在样式上（text:list 的 text:style-name → office:automatic-styles 里的 text:list-style）：
  // list-level-style-number 是有序、list-level-style-bullet 是项目符号，按 text:level 分层
  const listStyles = new Map();
  for (const style of xmlDeep(parseXml(contentXml), "list-style")) {
    const byLevel = new Map();
    for (const level of style.children) {
      const at = Number(level.getAttribute("text:level")) || 1;
      if (level.localName === "list-level-style-number")
        byLevel.set(at, { ordered: true, start: Number(level.getAttribute("text:start-value")) || 1 });
      else if (level.localName === "list-level-style-bullet") byLevel.set(at, { ordered: false });
    }
    listStyles.set(style.getAttribute("style:name"), byLevel);
  }
  // 图在 draw:frame 里，路直指包内的 Pictures/…；一个框可并列几份同图（SVG 与 PNG 替身），取头一份
  const picture = frame => {
    const href = xmlKids(frame, "image")[0]?.getAttribute("xlink:href");
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return "";
    return mdImage(xmlKids(frame, "desc")[0]?.textContent || xmlKids(frame, "title")[0]?.textContent, archiveRelative("", href));
  };
  const walk = (node, depth = 0, inheritedListStyle = "") => {
    for (const child of node.children) {
      const name = child.localName;
      if (name === "h") out.push(`${"#".repeat(Math.min(6, Number(child.getAttribute("text:outline-level")) || 1))} ${text(child)}`);
      else if (name === "p") {
        text(child) && out.push(mdLine(text(child)));
        out.push(...xmlDeep(child, "frame").map(picture));
      } else if (name === "frame" && xmlKids(child, "image").length) out.push(picture(child));
      else if (name === "list") {
        // ODF 的编号每个 text:list 各数各的；层级按嵌套深度对到 list-level 的 text:level
        // ODF 允许内层 text:list 省略 text:style-name：此时沿用外层列表的样式，
        // 而不是把有序的第二层错误退回项目符号。
        const styleName = child.getAttribute("text:style-name") || inheritedListStyle,
          levels = listStyles.get(styleName),
          level = levels?.get(depth + 1),
          counts = new Map();
        for (const item of xmlKids(child, "list-item")) {
          const line = xmlKids(item, "p").map(text).join(" ");
          if (line) {
            let mark = "- ";
            if (level?.ordered) {
              const n = (counts.get(depth + 1) ?? level.start - 1) + 1;
              counts.set(depth + 1, n);
              mark = `${n}. `;
            }
            const indent = seen.slice(0, depth).reduce((spaces, width) => spaces + Math.max(2, width), 0);
            seen[depth] = mark.length;
            out.push(`${" ".repeat(indent)}${mark}${line}`);
          }
          for (const nested of xmlKids(item, "list")) walk({ children: [nested] }, depth + 1, styleName);
        }
      } else if (name === "table") {
        const rows = [];
        for (const row of xmlDeep(child, "table-row")) {
          const cells = xmlKids(row, "table-cell").flatMap(cell =>
            Array(repeat(cell, "table:number-columns-repeated")).fill(xmlKids(cell, "p").map(text).join(" "))
          );
          if (cells.some(Boolean)) for (let i = 0; i < repeat(row, "table:number-rows-repeated"); i++) rows.push(cells);
        }
        const table = mdTable(rows);
        if (table)
          out.push(
            child.getAttribute("table:name") && !node.localName?.match(/^(text|table-cell)$/)
              ? `## ${child.getAttribute("table:name")}\n\n${table}`
              : table
          );
      } else if (name === "page") {
        pages += 1;
        const pageName = child.getAttribute("draw:name"),
          pageTitle = pageName && !/^page\d+$/i.test(pageName) ? pageName : "";
        out.push(pageHeading(pages, { heading: true, title: pageTitle }));
        walk(child, depth, inheritedListStyle);
      } else walk(child, depth, inheritedListStyle);
    }
  };
  const body = xmlDeep(parseXml(contentXml), "body")[0];
  if (body) walk(body);
  return out.filter(Boolean).join("\n\n");
}
// 围栏要比内容里最长的那一串反引号还长：代码格里的 Markdown 文档常带三连、四连反引号，
// 固定四连时会被提前闭合，后面的字跑到代码块外面去
function ipynbFence(texts) {
  let longest = 2;
  for (const text of texts) for (const run of String(text).match(/`+/g) || []) longest = Math.max(longest, run.length);
  return "`".repeat(longest + 1);
}
// ipynb：一格一节——Markdown 格照原样，代码格放进围栏、它跑出来的东西跟在下面。
// 本体是一份 JSON，几万字里大半是代码串、base64 的图和执行计数；直接当文字读，人和模型都得自己从 JSON 里扒
function ipynbMarkdown(text) {
  let book;
  try {
    book = JSON.parse(text);
  } catch {
    throw Error(t("这份 ipynb 不是有效的 JSON，抽不出正文"));
  }
  const language = String(book?.metadata?.language_info?.name || book?.metadata?.kernelspec?.language || "").trim(),
    sourceOf = cell => (Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "")).replace(/\s+$/, ""),
    blocks = [];
  for (const cell of Array.isArray(book?.cells) ? book.cells : []) {
    if (cell.cell_type === "markdown") {
      sourceOf(cell).trim() && blocks.push(sourceOf(cell));
      continue;
    }
    if (cell.cell_type !== "code") continue;
    const source = sourceOf(cell);
    if (source.trim()) {
      const fence = ipynbFence([source]);
      blocks.push(`${fence}${language}\n${source}\n${fence}`);
    }
    const said = ipynbOutputs(cell.outputs);
    if (said) blocks.push(said);
  }
  return blocks.join("\n\n");
}
// 代码格的输出：文字与报错照录，图只留一行字（JSON 里存的是 base64，抽出来也没法画在别处）
function ipynbOutputs(outputs) {
  const lines = [];
  for (const output of Array.isArray(outputs) ? outputs : []) {
    const text =
      output?.output_type === "stream"
        ? output.text
        : output?.output_type === "error"
          ? `${output.ename || ""}: ${output.evalue || ""}`
          : output?.data?.["text/plain"];
    const body = Array.isArray(text) ? text.join("") : typeof text === "string" ? text : "";
    if (body.trim()) lines.push(body.replace(/\s+$/, ""));
    else if (output?.data && Object.keys(output.data).some(type => type.startsWith("image/"))) lines.push(`[${t("图片")}]`);
  }
  if (!lines.length) return "";
  const fence = ipynbFence(lines);
  return `**${t("输出")}**\n\n${fence}\n${lines.join("\n\n")}\n${fence}`;
}
// 抽正文的那条路：要的那几份太大、解不开时照实说，别悄悄抽出半份或空（扫描件、超大表都比空文好说清）
async function unzipDocument(bytes, wanted) {
  const entries = await unzipSelected(bytes, wanted);
  if (entries.tooLarge?.length) throw Error(t`文档内部有一份太大（${entries.tooLarge[0]}），本机没能抽出正文`);
  return entries;
}
async function extractZipDocumentText(extension, bytes) {
  if (extension === "docx") {
    const entries = await unzipDocument(bytes, name =>
        /^word\/(document|styles|numbering|footnotes|endnotes)\.xml$|^word\/_rels\/document\.xml\.rels$/.test(name)
      ),
      notes = ["word/footnotes.xml", "word/endnotes.xml"]
        .filter(name => entries.has(name))
        .map(name =>
          xmlDeep(parseXml(entries.get(name)), "p").map(p =>
            xmlDeep(p, "t")
              .map(t => t.textContent)
              .join("")
              .trim()
          )
        )
        .flat()
        .filter(Boolean);
    return `${entries.has("word/document.xml") ? docxMarkdown(entries.get("word/document.xml"), entries.get("word/styles.xml"), entries.get("word/_rels/document.xml.rels"), entries.get("word/numbering.xml")) : ""}${notes.length ? `\n\n---\n\n${notes.join("\n\n")}` : ""}`;
  }
  if (extension === "pptx") return (await extractPptxSlides(bytes)).pages.join("\n\n");
  if (extension === "xlsx")
    return xlsxMarkdown(
      await unzipSelected(bytes, name =>
        /^xl\/(sharedStrings|styles|workbook)\.xml$|^xl\/_rels\/workbook\.xml\.rels$|^xl\/(worksheets|drawings)\/(_rels\/)?(sheet|drawing)\d+\.xml(\.rels)?$/.test(
          name
        )
      )
    );
  const entries = await unzipDocument(bytes, name => name === "content.xml");
  return entries.get("content.xml") ? odfMarkdown(entries.get("content.xml")) : "";
}
