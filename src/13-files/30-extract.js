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
// 扩展名不在表里、浏览器也没报类型的（.vue、.kt、Dockerfile、.env……）：看开头 64KB，没有 NUL、按 UTF-8 或 GBK 解得通的当文字
async function sniffText(file) {
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  if (head.includes(0)) return false;
  for (const label of ["utf-8", "gb18030"])
    try {
      new TextDecoder(label, { fatal: true }).decode(head, { stream: true });
      return true;
    } catch {}
  return false;
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
// data：置入的原件（Blob）、或 data: URL（预览器、网页交回的 PDF）；不抽的类型不读
/** @param {string} name @param {Blob|string} data */
async function extractDocumentText(name, data) {
  const extract = fileKind(name).extract;
  if (extract === "pdf") return trimExtractedText(await extractPdfText(data));
  if (extract === "zip") return trimExtractedText(await extractZipDocumentText(fileExtension(name), await bytesOf(data)));
  if (extract === "ipynb") return trimExtractedText(ipynbMarkdown(decodeTextBytes(await bytesOf(data))));
  return "";
}
/** @param {Blob|string} data */
async function bytesOf(data) {
  return data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : bytesFromDataUrl(data);
}
/** @param {Blob|string} data */
async function extractPdfText(data) {
  if (!(await ensureLib("pdf"))) return "";
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
      pages.push(t`第 ${pageNumber} 页\n${output.join("\n")}`);
      if (pages.join("\n\n").length >= MAX_EXTRACTED_CHARS) break;
    }
  } finally {
    await document.destroy();
  }
  // 扫描版（每页只是一张图）抽出来只剩一串「第 N 页」：不当抽到了文字，原件照发给模型自己看
  if (chars < pages.length * 10) throw Error(t("PDF 没有文字层（多半是扫描件），原件照发"));
  return pages.join("\n\n");
}
// 取包里选中的几份：默认解成文字，raw 给原字节（图）
async function unzipSelected(bytes, wanted, raw = false) {
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
    entries = new Map();
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
    if (wanted(name) && uncompressedSize <= 8 * 1024 * 1024 && extractedBytes + uncompressedSize <= 16 * 1024 * 1024) {
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
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
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
const xmlKids = (node, name) => [...node.children].filter(child => child.localName === name);
const xmlDeep = (node, name) => [...node.getElementsByTagNameNS("*", name)];
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
// 画好的预览里，照 img 记下的路从原件包里取图换成 data: 地址；取不到的、浏览器画不了的（EMF、WMF、TIFF）留一行字
async function withZipImages(html, dataUrl) {
  if (!dataUrl || !html.includes("data-path")) return html;
  const box = document.createElement("template");
  box.innerHTML = html;
  const imgs = [...box.content.querySelectorAll("img[data-path]")],
    pathOf = img => archiveRelative("", img.getAttribute("data-path") || ""),
    wanted = new Set(imgs.map(pathOf)),
    media = await unzipSelected(bytesFromDataUrl(dataUrl), name => wanted.has(name), true).catch(() => new Map());
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

// docx：正文按块走（段落、表格，内容控件等容器往里钻）；标题认样式名（styles.xml 里的 heading n / Title，中文版 Word 的样式 id 是数字）
function docxMarkdown(documentXml, stylesXml, relsXml) {
  const styleNames = new Map(),
    images = zipRels(relsXml, "word");
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
      numbering = props && xmlKids(props, "numPr")[0],
      depth = Number(numbering && xmlKids(numbering, "ilvl")[0]?.getAttribute("w:val")) || 0;
    const segments = xmlDeep(p, "r").map(run => {
      const rp = xmlKids(run, "rPr")[0];
      return { text: runText(run), bold: !level && flag(rp && xmlKids(rp, "b")[0]), italic: flag(rp && xmlKids(rp, "i")[0]) };
    });
    // 段首的记号转义施在原字上（施在拼好的「**…**」上会把加粗本身转掉）
    const first = segments.find(seg => seg.text.trim());
    if (first && !level && !numbering) first.text = mdLine(first.text.trimStart());
    const text = mdRuns(segments).trim();
    if (!text) return "";
    if (level) return `${"#".repeat(Math.min(level, 6))} ${text.replace(/\n/g, " ")}`;
    if (numbering) return `${"  ".repeat(depth)}- ${text.replace(/\n/g, " ")}`;
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
    .reduce((text, block, i, all) => text + (i ? (/^\s*- /.test(block) && /^\s*- /.test(all[i - 1]) ? "\n" : "\n\n") : "") + block, "");
}
// pptx 的讲话者备注：在 notesSlide 的 body 占位符里——同一份 XML 里还有页码与那一页的缩略图，不算
function pptxNotes(notesXml) {
  if (!notesXml) return [];
  return xmlDeep(parseXml(notesXml), "sp")
    .filter(shape => /^body$/i.test(xmlDeep(shape, "ph")[0]?.getAttribute("type") || ""))
    .flatMap(shape => xmlDeep(shape, "p"))
    .map(p =>
      xmlDeep(p, "t")
        .map(t => t.textContent)
        .join("")
        .trim()
    )
    .filter(Boolean);
}
// pptx：一页一节「## 第 n 页 · 标题」，其余文字按层级列成要点，页上的表格照表格、图片照图片，讲话者备注缀在节末
function pptxMarkdown(slides) {
  return slides
    .map(({ xml, rels, notes }, index) => {
      const doc = parseXml(xml),
        images = zipRels(rels, "ppt/slides");
      let title = "";
      const points = [],
        tables = [];
      for (const shape of xmlDeep(doc, "sp")) {
        const kind = xmlDeep(shape, "ph")[0]?.getAttribute("type") || "",
          paragraphs = xmlDeep(shape, "p");
        const lines = paragraphs
          .map(p => ({
            text: xmlDeep(p, "t")
              .map(t => t.textContent)
              .join("")
              .trim(),
            depth: Number(xmlKids(p, "pPr")[0]?.getAttribute("lvl")) || 0
          }))
          .filter(line => line.text);
        if (/title/i.test(kind) && !title) title = lines.map(line => line.text).join(" ");
        else for (const line of lines) points.push(`${"  ".repeat(line.depth)}- ${line.text}`);
      }
      for (const table of xmlDeep(doc, "tbl"))
        tables.push(
          mdTable(
            xmlKids(table, "tr").map(tr =>
              xmlKids(tr, "tc").map(tc =>
                xmlDeep(tc, "t")
                  .map(t => t.textContent)
                  .join("")
              )
            )
          )
        );
      const pictures = xmlDeep(doc, "pic").map(pic => ooxmlImage(pic, images));
      const said = pptxNotes(notes);
      return [
        t`## 第 ${index + 1} 页${title ? ` · ${title}` : ""}`,
        points.join("\n"),
        ...tables,
        ...pictures,
        said.length ? `**${t("备注")}**\n\n${said.map(line => `> ${mdLine(line)}`).join("\n>\n")}` : ""
      ]
        .filter(Boolean)
        .join("\n\n");
    })
    .join("\n\n");
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
const XLSX_DATE_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58
]);
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
// 序号 → 日子。1900 系统把并不存在的 1900-02-29 当成真日子（Excel 为兼容 Lotus 留的错），60 之前的序号因此得补一天；
// 1904 系统（旧版 Mac Excel）从 1904-01-01 起算，换成 1900 系统的序号是 +1462
function xlsxDateTime(serial, withDate, date1904) {
  const at = new Date(Date.UTC(1899, 11, 30) + Math.round((date1904 ? serial + 1462 : serial < 60 ? serial + 1 : serial) * 86400000)),
    two = n => String(n).padStart(2, "0"),
    time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}`,
    date = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}`;
  // 带日子的只看有没有时分（00:00 就不必缀一个 00:00）；纯时刻的格式只给时刻
  return withDate ? (at.getUTCHours() || at.getUTCMinutes() ? `${date} ${time}` : date) : time;
}
// 千分位只动整数部分：1.234567 不该变成 1.234,567
function xlsxGroup(raw) {
  const parts = String(raw).match(/^(-?)(\d+)(.*)$/);
  return parts ? `${parts[1]}${parts[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${parts[3]}` : raw;
}
// 内置格式号对应的格式串：styles.xml 只列自定义的那些，内置的（货币、百分比、千分位……）从来不写在里面
const XLSX_BUILTIN_CODES = {
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  37: "#,##0",
  38: "#,##0",
  39: "#,##0.00",
  40: "#,##0.00",
  48: "##0.0E+0",
  49: "@"
};
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
  // 去掉引号里的字面量、转义字符与 [颜色]/[条件] 那一类修饰，剩下的才是指示符；多段格式取第一段
  const bare = String(code || XLSX_BUILTIN_CODES[numFmtId] || "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .split(";")[0];
  if (bare.includes("%")) return `${Number((number * 100).toFixed(2))}%`;
  const date = bare ? /[yd]/i.test(bare) : XLSX_DATE_IDS.has(numFmtId),
    clock = bare ? /[hs]/i.test(bare) && bare.includes(":") : [18, 19, 20, 21, 45, 46, 47].includes(numFmtId);
  if (date || clock) return xlsxDateTime(number, date, date1904);
  if (/#,##|0,0/.test(bare)) return xlsxGroup(raw);
  return xlsxGeneral(raw);
}
function xlsxMarkdown(entries) {
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
        .filter(sheet => entries.has(sheet.file))
    : [];
  if (!sheets.length)
    sheets = [...entries.keys()]
      .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((file, i) => ({ name: t`工作表 ${i + 1}`, file }));
  return sheets
    .map(({ name, file }) => {
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
                  : value !== ""
                    ? xlsxNumber(value, format, styles.codes.get(format), date1904)
                    : formula
                      ? `=${formula}`
                      : "";
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
      return [`## ${name}`, mdTable(rows) || (pictures.length ? "" : t("（空表）")), ...pictures].filter(Boolean).join("\n\n");
    })
    .join("\n\n");
}
// ODF（odt / ods / odp）：content.xml 里标题、段落、列表、表格、演示页各归其位
function odfMarkdown(contentXml) {
  const out = [];
  let pages = 0;
  const text = node => node.textContent.replace(/\s+/g, " ").trim();
  const repeat = (node, name) => Math.min(50, Number(node.getAttribute(name)) || 1);
  // 图在 draw:frame 里，路直指包内的 Pictures/…；一个框可并列几份同图（SVG 与 PNG 替身），取头一份
  const picture = frame => {
    const href = xmlKids(frame, "image")[0]?.getAttribute("xlink:href");
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return "";
    return mdImage(xmlKids(frame, "desc")[0]?.textContent || xmlKids(frame, "title")[0]?.textContent, archiveRelative("", href));
  };
  const walk = (node, depth = 0) => {
    for (const child of node.children) {
      const name = child.localName;
      if (name === "h") out.push(`${"#".repeat(Math.min(6, Number(child.getAttribute("text:outline-level")) || 1))} ${text(child)}`);
      else if (name === "p") {
        text(child) && out.push(mdLine(text(child)));
        out.push(...xmlDeep(child, "frame").map(picture));
      } else if (name === "frame" && xmlKids(child, "image").length) out.push(picture(child));
      else if (name === "list")
        for (const item of xmlKids(child, "list-item")) {
          const line = xmlKids(item, "p").map(text).join(" ");
          if (line) out.push(`${"  ".repeat(depth)}- ${line}`);
          for (const nested of xmlKids(item, "list")) walk({ children: [nested] }, depth + 1);
        }
      else if (name === "table") {
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
        out.push(
          t`## 第 ${pages} 页${child.getAttribute("draw:name") && !/^page\d+$/i.test(child.getAttribute("draw:name")) ? ` · ${child.getAttribute("draw:name")}` : ""}`
        );
        walk(child, depth);
      } else walk(child, depth);
    }
  };
  const body = xmlDeep(parseXml(contentXml), "body")[0];
  if (body) walk(body);
  return out.filter(Boolean).join("\n\n");
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
    // 输出里偶尔自带三连反引号，围栏用四连的
    fence = "`".repeat(4),
    sourceOf = cell => (Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "")).replace(/\s+$/, ""),
    blocks = [];
  for (const cell of Array.isArray(book?.cells) ? book.cells : []) {
    if (cell.cell_type === "markdown") {
      sourceOf(cell).trim() && blocks.push(sourceOf(cell));
      continue;
    }
    if (cell.cell_type !== "code") continue;
    const source = sourceOf(cell);
    source.trim() && blocks.push(`${fence}${language}\n${source}\n${fence}`);
    const said = ipynbOutputs(cell.outputs);
    if (said) blocks.push(said);
  }
  return blocks.join("\n\n");
}
// 代码格的输出：文字与报错照录，图只留一行字（JSON 里存的是 base64，抽出来也没法画在别处）
function ipynbOutputs(outputs) {
  const fence = "`".repeat(4),
    lines = [];
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
  return lines.length ? `**${t("输出")}**\n\n${fence}\n${lines.join("\n\n")}\n${fence}` : "";
}
async function extractZipDocumentText(extension, bytes) {
  if (extension === "docx") {
    const entries = await unzipSelected(bytes, name =>
        /^word\/(document|styles|footnotes|endnotes)\.xml$|^word\/_rels\/document\.xml\.rels$/.test(name)
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
    return `${entries.has("word/document.xml") ? docxMarkdown(entries.get("word/document.xml"), entries.get("word/styles.xml"), entries.get("word/_rels/document.xml.rels")) : ""}${notes.length ? `\n\n---\n\n${notes.join("\n\n")}` : ""}`;
  }
  if (extension === "pptx") {
    const entries = await unzipSelected(bytes, name =>
      /^ppt\/slides\/(_rels\/)?slide\d+\.xml(\.rels)?$|^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)
    );
    return pptxMarkdown(
      [...entries.keys()]
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map(name => {
          const rels = entries.get(relsOf(name)),
            // 这一页的备注是 notesSlide 那份，经由页的 rels 找过去（页与备注的编号不一定对得上：删过页就会错开）
            notes = [...zipRels(rels, "ppt/slides", "notesSlide").values()][0];
          return { xml: entries.get(name), rels, notes: notes ? entries.get(notes) : undefined };
        })
    );
  }
  if (extension === "xlsx")
    return xlsxMarkdown(
      await unzipSelected(bytes, name =>
        /^xl\/(sharedStrings|styles|workbook)\.xml$|^xl\/_rels\/workbook\.xml\.rels$|^xl\/(worksheets|drawings)\/(_rels\/)?(sheet|drawing)\d+\.xml(\.rels)?$/.test(
          name
        )
      )
    );
  const entries = await unzipSelected(bytes, name => name === "content.xml");
  return entries.get("content.xml") ? odfMarkdown(entries.get("content.xml")) : "";
}
