// 文档预览：docx / xlsx / pptx 按结构抽成 Markdown 再画——标题、加粗、列表、表格照原样，xlsx 一张表一页签，pptx 一页一张卡；
// 认不得的格式给「以本机程序打开」。样本在这里现拼（不压缩的 zip，只放解析要读的那几份 XML）
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();

function zip(files) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text),
      label = Buffer.from(name),
      crc = crc32(data),
      local = Buffer.alloc(30),
      central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(label.length, 26);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(label.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, label, data);
    centrals.push(central, label);
    offset += 30 + label.length + data.length;
  }
  const directory = Buffer.concat(centrals),
    end = Buffer.alloc(22),
    count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
// 图：一张 1×1 的 PNG，与一张浏览器画不了的 EMF（只看给不给一行字）
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
  EMF = Buffer.from([1, 0, 0, 0]),
  R = `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`,
  rels = links =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.entries(links)
      .map(
        ([id, [type, target]]) =>
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
      )
      .join("")}</Relationships>`;
const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`,
  run = (text, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
mkdirSync(ARCHIVE, { recursive: true });
// docx：中文版 Word 的标题样式 id 是数字，名字在 styles.xml 里；整段加粗、段中加粗、列表、表格；一张图带说明、一张 EMF
writeFileSync(
  `${ARCHIVE}/报告.docx`,
  zip({
    "word/styles.xml": `<w:styles ${W}><w:style w:styleId="1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="2"><w:name w:val="heading 2"/></w:style></w:styles>`,
    "word/_rels/document.xml.rels": rels({ rId7: ["image", "media/image1.png"], rId8: ["image", "media/image2.emf"] }),
    "word/media/image1.png": PNG,
    "word/media/image2.emf": EMF,
    "word/document.xml": `<w:document ${W} ${R} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>
      <w:p>${run("封面标题", "<w:b/>")}</w:p>
      <w:p><w:pPr><w:pStyle w:val="1"/></w:pPr>${run("一、结论")}</w:p>
      <w:p>${run("控糖宣称占比 ")}${run("58%", "<w:b/>")}${run("，见下表。")}</w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("荞麦最多")}</w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("糙米其次")}</w:p>
      <w:p>${run("1. 不是列表，只是以数字起头")}</w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="图 1" descr="销量走势"/><a:graphic><a:graphicData><a:blip r:embed="rId7"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="图 2"/><a:graphic><a:graphicData><a:blip r:embed="rId8"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p>${run("品类")}</w:p></w:tc><w:tc><w:p>${run("款数")}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run("糙米")}</w:p></w:tc><w:tc><w:p>${run("34")}</w:p></w:tc></w:tr></w:tbl>
      <w:sectPr/></w:body></w:document>`
  })
);
// xlsx：两张表，名字经 workbook.xml 与 rels 对上；第一行 A1、C1 之间空一格，C 列的字要落在第三列
const S = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`;
writeFileSync(
  `${ARCHIVE}/数据.xlsx`,
  zip({
    "xl/workbook.xml": `<workbook ${S} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="销量" sheetId="1" r:id="rId1"/><sheet name="说明" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst ${S}><si><t>品名</t></si><si><t>价格</t></si><si><t>藜麦</t></si><si><r><t>富文</t></r><r><t>本</t></r></si></sst>`,
    "xl/worksheets/_rels/sheet1.xml.rels": rels({ rId1: ["drawing", "../drawings/drawing1.xml"] }),
    "xl/drawings/drawing1.xml": `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ${R}><xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="图 1"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": rels({ rId1: ["image", "../media/image1.png"] }),
    "xl/media/image1.png": PNG,
    "xl/worksheets/sheet1.xml": `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>48.9</v></c></row></sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>说明文字</t></is></c></row></sheetData></worksheet>`
  })
);
// pptx：两页，第一页有标题占位与两级要点
const P = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`,
  shape = (ph, paragraphs) =>
    `<p:sp><p:nvSpPr><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${paragraphs.map(([text, lvl]) => `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ""}<a:r><a:t>${text}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
writeFileSync(
  `${ARCHIVE}/讲义.pptx`,
  zip({
    "ppt/slides/slide1.xml": `<p:sld ${P}><p:cSld><p:spTree>${shape("title", [["线性回归"]])}${shape("", [["从最小二乘说起"], ["几何直观", 1]])}</p:spTree></p:cSld></p:sld>`,
    "ppt/slides/slide2.xml": `<p:sld ${P} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree>${shape("title", [["小结"]])}${shape("", [["推导闭式解"]])}<p:pic><p:nvPicPr><p:cNvPr id="3" name="图" descr="拟合直线"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide2.xml.rels": rels({ rId2: ["image", "../media/image1.png"] }),
    "ppt/media/image1.png": PNG
  })
);
writeFileSync(`${ARCHIVE}/模型.bin`, Buffer.from([0, 1, 2, 3]));
// 认不出扩展名的文字（Dockerfile、Makefile 那类），且长过预览那二十万字：要说一声「只看了开头」，别把开头当全文
writeFileSync(`${ARCHIVE}/Dockerfile`, `# 构建\n${"RUN echo hello\n".repeat(18000)}`);

await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0 }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(`document.querySelector("#library").classList.contains("hidden") && document.querySelector("#openLibrary").click(); true`);
await waitFor(`!!document.querySelector('[data-library-disk="讲义.pptx"]')`);
const open = async name => {
  await evalJs(`document.querySelector('[data-library-disk="${name}"]').click(); true`);
  await waitFor(
    `!document.querySelector("#fileViewerStage .file-viewer-empty") || !document.querySelector("#fileViewerStage").textContent.includes("正在取出")`,
    10000
  );
  await sleep(300);
};
const closeViewer = () => evalJs(`document.querySelector("#fileViewerClose").click(); true`);

await open("报告.docx");
await shot("doc-preview-docx.png");
const docx = JSON.parse(
  await evalJs(
    `(s => JSON.stringify({ firstBold: s.querySelector("p strong")?.textContent, h1: s.querySelector("h1")?.textContent, inline: [...s.querySelectorAll("p")].find(p => p.textContent.startsWith("控糖"))?.querySelector("strong")?.textContent, list: [...s.querySelectorAll("li")].map(li => li.textContent), lists: s.querySelectorAll("ul").length, digits: [...s.querySelectorAll("p")].some(p => p.textContent === "1. 不是列表，只是以数字起头"), img: [...s.querySelectorAll("img")].map(i => i.alt + "|" + i.src.slice(0, 14) + "|" + i.naturalWidth), emf: s.textContent.includes("[图片 image2.emf 预览不了]"), table: [...s.querySelectorAll("table td")].map(td => td.textContent).join(","), open: !!s.querySelector("[data-viewer-open]") }))(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "docx keeps its structure: headings by style name, bold, one list, a table",
  docx.firstBold === "封面标题" &&
    docx.h1 === "一、结论" &&
    docx.inline === "58%" &&
    docx.list.join() === "荞麦最多,糙米其次" &&
    docx.lists === 1 &&
    docx.digits &&
    docx.table === "糙米,34" &&
    docx.open,
  JSON.stringify(docx)
);
check(
  "docx images: drawn from the original with their caption; a format the browser can't draw leaves a line",
  docx.img.join() === "销量走势|data:image/png|1" && docx.emf,
  JSON.stringify(docx)
);
await closeViewer();

await open("数据.xlsx");
await shot("doc-preview-xlsx.png");
const sheet = JSON.parse(
  await evalJs(
    `(s => JSON.stringify({ tabs: [...s.querySelectorAll("[data-viewer-tab]")].map(b => b.textContent), head: [...s.querySelectorAll('[data-viewer-panel="0"] th')].map(n => n.textContent), row: [...s.querySelectorAll('[data-viewer-panel="0"] tbody td')].map(n => n.textContent), second: s.querySelector('[data-viewer-panel="1"]').classList.contains("hidden"), img: [...s.querySelectorAll('[data-viewer-panel="0"] img')].map(i => i.parentElement.textContent + "|" + i.src.slice(0, 14)) }))(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "xlsx: one tab per sheet by its name, cells land in their own columns, shared and rich strings read, a picture under its anchor cell",
  sheet.tabs.join() === "销量,说明" &&
    sheet.head.join() === "品名,,价格" &&
    sheet.row.join() === "藜麦,富文本,48.9" &&
    sheet.second &&
    sheet.img.join() === "D5：|data:image/png",
  JSON.stringify(sheet)
);
await evalJs(`document.querySelectorAll("[data-viewer-tab]")[1].click(); true`);
check(
  "switching the tab shows the other sheet",
  await evalJs(
    `(s => s.querySelector('[data-viewer-panel="0"]').classList.contains("hidden") && s.querySelector('[data-viewer-panel="1"] td, [data-viewer-panel="1"] th')?.textContent === "说明文字")(document.querySelector("#fileViewerStage"))`
  )
);
await closeViewer();

await open("讲义.pptx");
await shot("doc-preview-pptx.png");
const slides = JSON.parse(
  await evalJs(
    `JSON.stringify([...document.querySelectorAll("#fileViewerStage .viewer-slide")].map(s => s.querySelector("h2")?.textContent + "|" + [...s.querySelectorAll("li")].map(li => li.firstChild.textContent.trim()).join("/") + [...s.querySelectorAll("img")].map(i => "|" + i.alt + ":" + i.src.slice(0, 14)).join("")))`
  )
);
check(
  "pptx: one card per slide, titled, points by level, pictures drawn",
  slides.join("#") === "第 1 页 · 线性回归|从最小二乘说起/几何直观#第 2 页 · 小结|推导闭式解|拟合直线:data:image/png",
  JSON.stringify(slides)
);
await closeViewer();

await open("模型.bin");
check(
  "an unknown format offers to open it with the local program",
  await evalJs(
    `!!document.querySelector("#fileViewerStage .file-viewer-empty [data-viewer-open]") && !!document.querySelector("#fileViewerStage [data-viewer-download]")`
  )
);
await closeViewer();

// 认不出扩展名、其实是文字的：照文字看，且看的是预览那二十万字、不是只闻味的那 64 KB；到头了要说一声
await open("Dockerfile");
const plain = JSON.parse(
  await evalJs(
    `(s => JSON.stringify({ code: s.querySelector("pre.file-viewer-code")?.textContent.length || 0, cut: s.textContent.includes("仅显示前 20 万字") }))(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "an extension-less text file reads as text, well past the sniffing window, and says when it was cut",
  plain.code > 150000 && plain.cut,
  JSON.stringify(plain)
);
await closeViewer();
close();
