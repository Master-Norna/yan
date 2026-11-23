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
    "word/styles.xml": `<w:styles ${W}><w:style w:styleId="1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="2"><w:name w:val="heading 2"/></w:style><w:style w:styleId="3"><w:name w:val="List Number"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style></w:styles>`,
    // 编号的定义在 numbering.xml：numId 2 是多级编号的第 0 层，十进制；numId 1 故意不给定义（退回项目符号）
    "word/numbering.xml": `<w:numbering ${W}><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    "word/_rels/document.xml.rels": rels({ rId7: ["image", "media/image1.png"], rId8: ["image", "media/image2.emf"] }),
    "word/media/image1.png": PNG,
    "word/media/image2.emf": EMF,
    "word/document.xml": `<w:document ${W} ${R} xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>
      <w:p>${run("封面标题", "<w:b/>")}</w:p>
      <w:p><w:pPr><w:pStyle w:val="1"/></w:pPr>${run("一、结论")}</w:p>
      <w:p>${run("控糖宣称占比 ")}${run("58%", "<w:b/>")}${run("，见下表。")}</w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("荞麦最多")}</w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run("糙米其次")}</w:p>
      <w:p><w:pPr><w:pStyle w:val="3"/></w:pPr>${run("第一步")}</w:p>
      <w:p><w:pPr><w:pStyle w:val="3"/></w:pPr>${run("第二步")}</w:p>
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
    // 数字格式：14 是内置的日期，10 是内置的百分比，3 是内置的千分位，164 是自定义的（格式串里带引号包着的中文）
    "xl/styles.xml": `<styleSheet ${S}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/></numFmts><cellXfs count="6"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="10"/><xf numFmtId="3"/><xf numFmtId="164"/><xf numFmtId="46"/></cellXfs></styleSheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": rels({ rId1: ["drawing", "../drawings/drawing1.xml"] }),
    "xl/drawings/drawing1.xml": `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ${R}><xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="图 1"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": rels({ rId1: ["image", "../media/image1.png"] }),
    "xl/media/image1.png": PNG,
    "xl/worksheets/sheet1.xml": `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>48.9</v></c></row><row r="3"><c r="A3" s="1"><v>45306</v></c><c r="B3" s="2"><v>0.235</v></c><c r="C3" s="3"><v>12345.6</v></c></row><row r="4"><c r="A4" s="4"><v>45306</v></c><c r="B4"><f>SUM(C2:C2)</f><v></v></c><c r="C4"><v>9876543.210000001</v></c></row><row r="5"><c r="A5" t="str"><f>TEXT(A1,"00000")</f><v>00123</v></c><c r="B5" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="C5" s="5"><v>1.5</v></c></row></sheetData></worksheet>`,
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
    "ppt/slides/slide3.xml": `<p:sld ${P}><p:cSld><p:spTree>${shape("title", [["步骤"]])}<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody>${["先归一化", "再拟合"].map(text => `<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>${text}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": rels({ rId5: ["notesSlide", "../notesSlides/notesSlide1.xml"] }),
    // 备注那份里除了讲话者的话，还有页码与整页缩略图两个占位符，都不该混进正文
    "ppt/notesSlides/notesSlide1.xml": `<p:notes ${P}><p:cSld><p:spTree>${shape("sldImg", [])}${shape("body", [["讲慢一些，这里停一下"], ["先给直觉，再给公式"]])}${shape("sldNum", [["12"]])}</p:spTree></p:cSld></p:notes>`,
    "ppt/slides/_rels/slide2.xml.rels": rels({ rId2: ["image", "../media/image1.png"] }),
    "ppt/media/image1.png": PNG
  })
);
// ipynb：Markdown 格、代码格、代码格的三种输出（stdout、结果、报错）与一张图；本体是 JSON，抽出来该是可读的 Markdown
writeFileSync(
  `${ARCHIVE}/分析.ipynb`,
  JSON.stringify({
    cells: [
      { cell_type: "markdown", source: ["# 结论\n", "控糖与品类无关。"] },
      {
        cell_type: "code",
        execution_count: 1,
        source: ["print('hi')\n", "1 + 1"],
        outputs: [
          { output_type: "stream", name: "stdout", text: ["hi\n"] },
          { output_type: "execute_result", data: { "text/plain": ["2"] } }
        ]
      },
      {
        cell_type: "code",
        execution_count: 2,
        source: "boom()",
        outputs: [{ output_type: "error", ename: "NameError", evalue: "name 'boom' is not defined" }]
      },
      {
        cell_type: "code",
        execution_count: 3,
        source: "plt.plot(x)",
        outputs: [{ output_type: "display_data", data: { "image/png": PNG.toString("base64") } }]
      }
    ],
    metadata: { language_info: { name: "python" } },
    nbformat: 4,
    nbformat_minor: 5
  })
);
// odt：标题、一张有序列表（编号挂在 automatic-styles 的 text:list-style 上）、一张项目符号表
writeFileSync(
  `${ARCHIVE}/说明.odt`,
  zip({
    "content.xml": `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:automatic-styles><text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/></text:list-style><text:list-style style:name="L2"><text:list-level-style-bullet text:level="1"/></text:list-style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">步骤</text:h><text:list text:style-name="L1"><text:list-item><text:p>先归一化</text:p></text:list-item><text:list-item><text:p>再拟合</text:p></text:list-item></text:list><text:list text:style-name="L2"><text:list-item><text:p>附注一</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`
  })
);
writeFileSync(`${ARCHIVE}/模型.bin`, Buffer.from([0, 1, 2, 3]));

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
    `(s => JSON.stringify({ firstBold: s.querySelector("p strong")?.textContent, h1: s.querySelector("h1")?.textContent, inline: [...s.querySelectorAll("p")].find(p => p.textContent.startsWith("控糖"))?.querySelector("strong")?.textContent, list: [...s.querySelectorAll("ul li")].map(li => li.textContent), ordered: [...s.querySelectorAll("ol li")].map(li => li.textContent), lists: s.querySelectorAll("ul").length, digits: [...s.querySelectorAll("p")].some(p => p.textContent === "1. 不是列表，只是以数字起头"), img: [...s.querySelectorAll("img")].map(i => i.alt + "|" + i.src.slice(0, 14) + "|" + i.naturalWidth), emf: s.textContent.includes("[图片 image2.emf 预览不了]"), table: [...s.querySelectorAll("table td")].map(td => td.textContent).join(","), open: !!s.querySelector("[data-viewer-open]") }))(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "docx keeps its structure: headings by style name, bold, one list, a table",
  docx.firstBold === "封面标题" &&
    docx.h1 === "一、结论" &&
    docx.inline === "58%" &&
    docx.list.join() === "荞麦最多,糙米其次" &&
    docx.lists === 1 &&
    docx.ordered.join() === "第一步,第二步" &&
    docx.digits &&
    docx.table === "糙米,34" &&
    docx.open,
  JSON.stringify(docx)
);
check(
  "docx 的编号挂在段落样式上时也认得出是有序列表（Word 的「编号」按钮大多这么写）",
  docx.ordered.length === 2,
  JSON.stringify(docx.ordered)
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
    `(s => JSON.stringify({ tabs: [...s.querySelectorAll("[data-viewer-tab]")].map(b => b.textContent), head: [...s.querySelectorAll('[data-viewer-panel="0"] th')].map(n => n.textContent), rows: [...s.querySelectorAll('[data-viewer-panel="0"] tbody tr')].map(tr => [...tr.querySelectorAll("td")].map(td => td.textContent)), second: s.querySelector('[data-viewer-panel="1"]').classList.contains("hidden"), img: [...s.querySelectorAll('[data-viewer-panel="0"] img')].map(i => i.parentElement.textContent + "|" + i.src.slice(0, 14)) }))(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "xlsx: one tab per sheet by its name, cells land in their own columns, shared and rich strings read, a picture under its anchor cell",
  sheet.tabs.join() === "销量,说明" &&
    sheet.head.join() === "品名,,价格" &&
    sheet.rows[0].join() === "藜麦,富文本,48.9" &&
    sheet.second &&
    sheet.img.join() === "D5：|data:image/png",
  JSON.stringify(sheet)
);
check(
  "xlsx: numbers read the way they look — a date is a date, a share is a percentage, thousands are grouped; a formula without a stored result shows itself, a string result keeps its leading zeros, a duration passes 24 hours",
  sheet.rows
    .map(row => row.map(cell => cell.trim()).join("|"))
    .slice(1)
    .join("#") === "2024-01-15|23.50%|12,346#2024-01-15|=SUM(C2:C2)|9876543.21#00123|#DIV/0!|36:00:00",
  JSON.stringify(sheet.rows)
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
  slides.join("#") ===
    "第 1 页 · 线性回归|从最小二乘说起/几何直观#第 2 页 · 小结|推导闭式解|拟合直线:data:image/png#第 3 页 · 步骤|先归一化/再拟合",
  JSON.stringify(slides)
);
check(
  "pptx 里 PowerPoint 自动编号的那些要点也认得出是有序的（buAutoNum）",
  await evalJs(`[...document.querySelectorAll("#fileViewerStage .viewer-slide")].at(-1).querySelectorAll("ol li").length === 2`)
);
const said = JSON.parse(
  await evalJs(
    `JSON.stringify([...document.querySelectorAll("#fileViewerStage .viewer-slide")].map(s => [...s.querySelectorAll("blockquote p")].map(p => p.textContent.trim()).join("/")))`
  )
);
check(
  "pptx: the speaker's notes follow their own slide, without the page number and thumbnail placeholders",
  said.join("#") === "讲慢一些，这里停一下/先给直觉，再给公式##",
  JSON.stringify(said)
);
await closeViewer();

await open("说明.odt");
const odt = JSON.parse(
  await evalJs(
    `(s => JSON.stringify({ h1: s.querySelector("h1")?.textContent, ordered: [...s.querySelectorAll("ol li")].map(li => li.textContent), bullet: [...s.querySelectorAll("ul li")].map(li => li.textContent) }))(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "odt: 编号列表认出是有序的、项目符号仍是无序的（编号挂在 text:list-style 上）",
  odt.h1 === "步骤" && odt.ordered.map(t => t.trim()).join() === "先归一化,再拟合" && odt.bullet.join() === "附注一",
  JSON.stringify(odt)
);
await closeViewer();

await open("分析.ipynb");
await shot("doc-preview-ipynb.png");
const notebook = JSON.parse(
  await evalJs(
    `(s => JSON.stringify({ h1: [...s.querySelectorAll("h1")].map(h => h.textContent), pre: [...s.querySelectorAll("pre")].map(p => p.textContent.replace(/\\s+$/, "")) }))(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "ipynb: markdown cells read as prose, code cells as code, each with what it printed, raised or drew",
  notebook.h1.join() === "结论" &&
    notebook.pre.join("#") === "print('hi')\n1 + 1#hi\n\n2#boom()#NameError: name 'boom' is not defined#plt.plot(x)#[图片]",
  JSON.stringify(notebook)
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
close();
