// 文档预览：docx / xlsx / pptx 按结构抽成 Markdown 再画——标题、加粗、列表、表格照原样，xlsx 一张表一页签，pptx 按页翻看；
// 认不得的格式给「以本机程序打开」。样本在这里现拼（只放解析要读的几份 XML，其中一份备注故意未压完）
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();

function zip(files, incomplete = "") {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text),
      deflated = name === incomplete,
      stored = deflated ? deflateRawSync(data).subarray(0, 1) : data,
      label = Buffer.from(name),
      crc = crc32(data),
      local = Buffer.alloc(30),
      central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(label.length, 26);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(deflated ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(label.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, label, stored);
    centrals.push(central, label);
    offset += 30 + label.length + stored.length;
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
    // 编号的定义在 numbering.xml：numId 2 是多级编号的第 0、1 层，十进制；numId 1 故意不给定义（退回项目符号）
    "word/numbering.xml": `<w:numbering ${W}><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
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
      <w:p><w:pPr><w:pStyle w:val="3"/><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr>${run("细项一")}</w:p>
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
    "xl/workbook.xml": `<workbook ${S} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="销量" sheetId="1" r:id="rId1"/><sheet name="说明" sheetId="2" r:id="rId2"/><sheet name="超限页" sheetId="3" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst ${S}><si><t>品名</t></si><si><t>价格</t></si><si><t>藜麦</t></si><si><r><t>富文</t></r><r><t>本</t></r></si></sst>`,
    // 数字格式：14 是内置的日期，10 是内置的百分比，3 是内置的千分位，164 是自定义的（格式串里带引号包着的中文）
    "xl/styles.xml": `<styleSheet ${S}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy&quot;年&quot;m&quot;月&quot;d&quot;日&quot;"/></numFmts><cellXfs count="6"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="10"/><xf numFmtId="3"/><xf numFmtId="164"/><xf numFmtId="46"/></cellXfs></styleSheet>`,
    "xl/worksheets/_rels/sheet1.xml.rels": rels({ rId1: ["drawing", "../drawings/drawing1.xml"] }),
    "xl/drawings/drawing1.xml": `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ${R}><xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>4</xdr:row></xdr:from><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="图 1"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>`,
    "xl/drawings/_rels/drawing1.xml.rels": rels({ rId1: ["image", "../media/image1.png"] }),
    "xl/media/image1.png": PNG,
    "xl/worksheets/sheet3.xml": Buffer.alloc(8 * 1024 * 1024 + 1, 32),
    "xl/worksheets/sheet1.xml": `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><v>48.9</v></c></row><row r="3"><c r="A3" s="1"><v>45306</v></c><c r="B3" s="2"><v>0.235</v></c><c r="C3" s="3"><v>12345.6</v></c></row><row r="4"><c r="A4" s="4"><v>45306</v></c><c r="B4"><f>SUM(C2:C2)</f><v></v></c><c r="C4"><v>9876543.210000001</v></c></row><row r="5"><c r="A5" t="str"><f>TEXT(A1,"00000")</f><v>00123</v></c><c r="B5" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="C5" s="5"><v>1.5</v></c></row></sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>说明文字</t></is></c></row></sheetData></worksheet>`
  })
);
// pptx：4:3，含自由排版文本框、显式标题和不同类型的列表
const P = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`,
  shape = (ph, paragraphs) =>
    `<p:sp><p:nvSpPr><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ""}</p:nvPr></p:nvSpPr><p:txBody>${paragraphs.map(([text, lvl]) => `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ""}<a:r><a:t>${text}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
const floatBox = (x, y, size, text, bold = false) =>
  `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="${size}" b="${Number(bold)}"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
// 页顶最大的是列表，旁边较小的「小结」才是标题。
const topList = `<p:sp><p:spPr><a:xfrm><a:off x="4700000" y="880000"/></a:xfrm></p:spPr><p:txBody><a:p><a:pPr><a:buAutoNum type="arabicPeriod" startAt="7"/></a:pPr><a:r><a:rPr sz="3600"/><a:t>核对输入</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:rPr sz="3600"/><a:t>记录结果</a:t></a:r></a:p></p:txBody></p:sp>`;
// 最先适用的根级 Choice 保留图；局部 d 是标准 DrawingML 的另一个前缀。
const wrappedPic = `<mc:AlternateContent xmlns:u="urn:yan:test:unsupported"><mc:Choice Requires="p u">${shape("", [["根未知分支"]])}</mc:Choice><mc:Choice xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/main" Requires="p d"><p:pic><p:nvPicPr><p:cNvPr id="3" name="图" descr="拟合直线"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic></mc:Choice><mc:Choice Requires="a">${shape("", [["根第二适用分支"]])}</mc:Choice><mc:Fallback>${shape("", [["根备用分支"]])}</mc:Fallback></mc:AlternateContent>`;
// 组内没有适用的 Choice，要走 Fallback，并继续按组内坐标排序。
const wrappedGroupText = `<mc:AlternateContent><mc:Choice xmlns:u="urn:yan:test:unsupported" Requires="u">${shape("", [["组未知分支"]])}</mc:Choice><mc:Fallback>${floatBox(0, 600000, 1600, "组内说明")}${floatBox(0, 30000, 1600, "组内题")}</mc:Fallback></mc:AlternateContent>`;
const fenceTexts = ["```", "反引号之后的文本框", "~~~", "波浪号之后的文本框"];
const fenceBoxes = fenceTexts.map(text => shape("", [[text]])).join("");
writeFileSync(
  `${ARCHIVE}/讲义.pptx`,
  zip(
    {
      "ppt/presentation.xml": `<p:presentation ${P} xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${[2, 1, 3, 4].map(i => `<p:sldId id="${255 + i}" rel:id="rId${i}"/>`).join("")}</p:sldIdLst><p:sldSz cx="9600000" cy="7200000"/></p:presentation>`,
      "ppt/_rels/presentation.xml.rels": rels(Object.fromEntries([1, 2, 3, 4].map(i => [`rId${i}`, ["slide", `slides/slide${i}.xml`]]))),
      "ppt/slides/slide5.xml": `<p:sld ${P}><p:cSld><p:spTree>${shape("title", [["不在清单里的页"]])}</p:spTree></p:cSld></p:sld>`,
      "ppt/slides/slide1.xml": `<p:sld ${P}><p:cSld><p:spTree>${shape("title", [["线性回归"]])}${shape("body", [["从最小二乘说起"], ["几何直观", 1]])}</p:spTree></p:cSld></p:sld>`,
      "ppt/slides/slide2.xml": `<p:sld ${P} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><p:cSld><p:spTree>${floatBox(4700000, 2400000, 1600, "右栏说明")}${floatBox(0, 6800000, 1100, "页脚")}${floatBox(0, 300000, 900, "页眉")}${floatBox(500000, 900000, 3200, "小结")}${topList}${floatBox(500000, 2440000, 1700, "推导闭式解", true)}<p:grpSp><p:grpSpPr><a:xfrm><a:off x="500000" y="3200000"/><a:chExt cx="2000000" cy="2000000"/></a:xfrm></p:grpSpPr>${wrappedGroupText}</p:grpSp>${wrappedPic}</p:spTree></p:cSld></p:sld>`,
      // 第三页是有序的步骤：第一条从第 5 步起（接着上一页数），第二条降一层
      "ppt/slides/slide3.xml": `<p:sld ${P}><p:cSld><p:spTree>${shape("title", [["步骤"]])}<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:pPr><a:buAutoNum type="arabicPeriod" startAt="5"/></a:pPr><a:r><a:t>先归一化</a:t></a:r></a:p><a:p><a:pPr lvl="1"><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>补充</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>再拟合</a:t></a:r></a:p><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>## 这是正文</a:t></a:r><a:br/><a:r><a:t>不是新的一页</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
      // 字母和罗马数字：不是十进制列表，Markdown 原生不能表达其 marker，渲染时改用 ol[type]。
      "ppt/slides/slide4.xml": `<p:sld ${P}><p:cSld><p:spTree>${shape("title", [["编号类型"]])}<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr><p:txBody><a:p><a:pPr><a:buAutoNum type="alphaLcPeriod" startAt="3"/></a:pPr><a:r><a:t>第三项</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="alphaLcPeriod"/></a:pPr><a:r><a:t>第四项</a:t></a:r></a:p><a:p><a:pPr lvl="1"><a:buAutoNum type="romanUcPeriod" startAt="4"/></a:pPr><a:r><a:t>子步骤四</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="romanLcPeriod" startAt="2"/></a:pPr><a:r><a:t>罗马二</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="alphaUcPeriod"/></a:pPr><a:r><a:t>大写甲</a:t></a:r></a:p><a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>分段说明</a:t></a:r></a:p><a:p><a:pPr lvl="1"><a:buAutoNum type="alphaLcPeriod" startAt="2"/></a:pPr><a:r><a:t>说明下的子项</a:t></a:r></a:p></p:txBody></p:sp>${shape("", [["另一个文字框"]])}${fenceBoxes}</p:spTree></p:cSld></p:sld>`,
      "ppt/slides/_rels/slide1.xml.rels": rels({ rId5: ["notesSlide", "../notesSlides/notesSlide1.xml"] }),
      // 备注那份里除了讲话者的话，还有页码与整页缩略图两个占位符，都不该混进正文
      "ppt/notesSlides/notesSlide1.xml": `<p:notes ${P}><p:cSld><p:spTree>${shape("sldImg", [])}${shape("body", [["讲慢一些，这里停一下"], ["先给直觉，再给公式"]])}${shape("sldNum", [["12"]])}</p:spTree></p:cSld></p:notes>`,
      "ppt/slides/_rels/slide2.xml.rels": rels({
        rId2: ["image", "../media/image1.png"],
        rId9: ["notesSlide", "../notesSlides/notesSlide9.xml"]
      }),
      "ppt/notesSlides/notesSlide9.xml": "<broken>",
      "ppt/slides/_rels/slide3.xml.rels": rels({ rId3: ["notesSlide", "../notesSlides/notesSlide3.xml"] }),
      "ppt/notesSlides/notesSlide3.xml": `<p:notes ${P}><p:cSld><p:spTree>${shape("body", [["未压完的备注"]])}</p:spTree></p:cSld></p:notes>`,
      "ppt/media/image1.png": PNG
    },
    "ppt/notesSlides/notesSlide3.xml"
  )
);
// pptx 画布：每块都有坐标的一页。预览照画面位置摆字，不再把六个阶段的数字与标签拼成三段。
// 16:9，标题 40 磅、正文 18 磅、一个圆、一条带箭头的横线、一张图——位置与字号都照原件的比例量。
const CANVAS_SLIDE = `<p:sld ${P} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="080D1D"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1219200" y="685800"/><a:ext cx="6096000" cy="1371600"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:r><a:rPr sz="4000" b="1"><a:solidFill><a:srgbClr val="F4F7FF"/></a:solidFill></a:rPr><a:t>版式标题</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="正文"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1219200" y="2743200"/><a:ext cx="6096000" cy="685800"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="A3B4CF"/></a:solidFill></a:rPr><a:t>正文一行</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="圆"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="8000000" y="2743200"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="172641"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="A78BFA"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="5" name="箭头"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="5000000"/><a:ext cx="4000000" cy="0"/></a:xfrm><a:prstGeom prst="line"/><a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="4DEBE4"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:sp><p:pic><p:nvPicPr><p:cNvPr id="6" name="图" descr="示意"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="6000000" y="5000000"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`;
writeFileSync(
  `${ARCHIVE}/版式.pptx`,
  zip({
    "ppt/presentation.xml": `<p:presentation ${P} xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" rel:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels({ rId1: ["slide", "slides/slide1.xml"] }),
    "ppt/slides/slide1.xml": CANVAS_SLIDE,
    "ppt/slides/_rels/slide1.xml.rels": rels({ rId2: ["image", "../media/image1.png"] }),
    "ppt/media/image1.png": PNG
  })
);
// 母版与版式：字号写在一级级继承里（母版 txStyles 标题 32 磅、正文 18 磅），页上只写位置。
// 正文还带 normAutofit（缩到 92.5%、行距压 20%），另有一个 wrap="none" 的框——不读这些，字就偏大、行也松。
const MASTER = `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`,
  r32 = `${MASTER} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
writeFileSync(
  `${ARCHIVE}/母版.pptx`,
  zip({
    "ppt/presentation.xml": `<p:presentation ${P} xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" rel:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels({ rId1: ["slide", "slides/slide1.xml"] }),
    "ppt/slides/slide1.xml": `<p:sld ${r32}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>母版里定的标题</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="正文"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="1828800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr><a:normAutofit fontScale="92500" lnSpcReduction="20000"/></a:bodyPr><a:p><a:r><a:t>正文照母版 18 磅</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="不折行"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="3657600"/><a:ext cx="914400" cy="457200"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="none"><a:spAutoFit/></a:bodyPr><a:p><a:r><a:rPr sz="1800"/><a:t>这一行比框长也不折</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="图"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="5486400" y="4572000"/><a:ext cx="2286000" cy="1143000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame><p:sp><p:nvSpPr><p:cNvPr id="7" name="编号"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="5943600"/><a:ext cx="3657600" cy="457200"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr marL="457200"><a:buAutoNum type="alphaLcPeriod" startAt="3"/></a:pPr><a:r><a:rPr sz="1600"/><a:t>字母第三项</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="8" name="表"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="5029200" y="5486400"/><a:ext cx="3657600" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="1828800"/><a:gridCol w="1828800"/></a:tblGrid><a:tr h="457200"><a:tc><a:txBody><a:p><a:r><a:rPr sz="1200"/><a:t>格一</a:t></a:r></a:p><a:p><a:r><a:rPr sz="1200"/><a:t>续行</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:rPr sz="1200"/><a:t>格二</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": rels({ rId1: ["slideLayout", "../slideLayouts/slideLayout1.xml"] }),
    // 版式只给正文的位置；标题的框与字号都在母版里
    "ppt/slideLayouts/slideLayout1.xml": `<p:sldLayout ${MASTER}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="正文"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="1828800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels({ rId1: ["slideMaster", "../slideMasters/slideMaster1.xml"] }),
    "ppt/slideMasters/slideMaster1.xml": `<p:sldMaster ${MASTER}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"0A0B0C\"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="b"/></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="正文"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4525963"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/></p:txBody></p:sp></p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1600"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels({ rId1: ["theme", "../theme/theme1.xml"] })
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
    "content.xml": `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><office:automatic-styles><text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/><text:list-level-style-number text:level="2" style:num-format="1"/></text:list-style><text:list-style style:name="L2"><text:list-level-style-bullet text:level="1"/></text:list-style></office:automatic-styles><office:body><office:text><text:h text:outline-level="1">步骤</text:h><text:list text:style-name="L1"><text:list-item><text:p>先归一化</text:p><text:list><text:list-item><text:p>细项</text:p></text:list-item></text:list></text:list-item><text:list-item><text:p>再拟合</text:p></text:list-item></text:list><text:list text:style-name="L2"><text:list-item><text:p>附注一</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`
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
    docx.ordered.length === 3 &&
    docx.digits &&
    docx.table === "糙米,34" &&
    docx.open,
  JSON.stringify(docx)
);
check(
  "docx 的编号挂在段落样式上时也认得出是有序列表（Word 的「编号」按钮大多这么写）",
  docx.ordered.length === 3,
  JSON.stringify(docx.ordered)
);
check(
  "docx 的下一层缩进到父项记号之后那一列，才真成一层（缩两格时有序列表的子项会被当成父项的续文）",
  await evalJs(
    `(s => s.querySelectorAll("ol ol li").length === 1 && s.querySelector("ol ol li").textContent.trim() === "细项一")(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "docx 的段落只写层级、编号 id 留给样式时，仍照样式那份编号排",
  await evalJs(
    `(s => [...s.querySelector("ol").children].map(li => li.firstChild.textContent.trim()).join() === "第一步,第二步")(document.querySelector("#fileViewerStage"))`
  )
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
  sheet.tabs.join() === "销量,说明,超限页" &&
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
check(
  "xlsx: an oversized sheet leaves the other tabs and explains its absence",
  await evalJs(`document.querySelector('[data-viewer-panel="2"]')?.textContent.includes('文档内部一份太大')`)
);
await closeViewer();

await open("讲义.pptx");
await shot("doc-preview-pptx.png");
const slideState = () =>
  evalJs(`(() => {
  const deck = document.querySelector(".file-viewer-slides");
  const visible = [...deck.querySelectorAll(".viewer-slide")].filter(s => s.getClientRects().length);
  const page = visible[0].getBoundingClientRect(), nav = deck.querySelector(".viewer-slide-nav").getBoundingClientRect();
  return { current: visible.map(s => s.querySelector("h2")?.textContent), ratio: page.width / page.height,
    below: nav.top >= page.bottom, count: deck.querySelector("[data-viewer-slide-count]").textContent,
    end: deck.querySelector('[data-viewer-slide-step="1"]').getAttribute("aria-disabled") };
})()`);
const first = await slideState();
check(
  "pptx shows only one centered slide at its 4:3 ratio, with navigation below",
  first.current.join() === "第 1 页 · 小结" && Math.abs(first.ratio - 4 / 3) < 0.02 && first.below && first.count === "1 / 4",
  JSON.stringify(first)
);
await evalJs(`document.querySelector('[data-viewer-slide="2"]').click(); true`);
check("pptx page numbers jump directly to a slide", (await slideState()).count === "3 / 4");
const dotsJumped = await evalJs(
  `(() => { const marks = [...document.querySelectorAll(".viewer-slide-strip [data-viewer-slide]")]; return JSON.stringify({ d: marks.map(m => m.style.getPropertyValue("--d")).join(","), current: marks.findIndex(m => m.getAttribute("aria-current") === "page"), near: getComputedStyle(marks[2], "::before").width, far: getComputedStyle(marks[0], "::before").width, farFade: getComputedStyle(marks[0], "::before").opacity, nearFill: getComputedStyle(marks[2], "::before").backgroundColor }); })()`
);
check(
  "页码是一排朱点：随换页重记明暗，离当前越远越淡、越小",
  JSON.parse(dotsJumped).d === "2,1,0,1" &&
    JSON.parse(dotsJumped).current === 2 &&
    JSON.parse(dotsJumped).near === "8px" &&
    JSON.parse(dotsJumped).far === "6px" &&
    Number(JSON.parse(dotsJumped).farFade) < 1 &&
    JSON.parse(dotsJumped).nearFill !== "rgba(0, 0, 0, 0)",
  dotsJumped
);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight" });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight" });
check("pptx keyboard navigation reaches the last slide and doesn't wrap", (await slideState()).end === "true");
await evalJs(`document.querySelector('[data-viewer-slide-step="1"]').click(); true`);
check("pptx next button at the end does not wrap", (await slideState()).count === "4 / 4");
await evalJs(`document.querySelector('[data-viewer-slide-step="-1"]').click(); true`);
check("pptx previous button changes the page", (await slideState()).count === "3 / 4");
await evalJs(`document.querySelector('[data-viewer-slide="0"]').click(); true`);
check(
  "抽取说明不再赘述：顶栏只留截断话，打开原件是一枚笔意小画，纸面那份留给独立文档页",
  await evalJs(`(() => {
    const head = document.querySelector("#fileViewerNote"),
      onPaper = document.querySelector("#fileViewerStage .file-viewer-note"),
      cta = document.querySelector("#fileViewerOpen"),
      nav = document.querySelector(".viewer-slide-nav");
    return (
      !!head && head.textContent.trim() === "" &&
      !!onPaper && getComputedStyle(onPaper).visibility === "hidden" && onPaper.getBoundingClientRect().height === 0 &&
      onPaper.textContent.includes("本机按") && !!onPaper.querySelector("[data-viewer-open]") &&
      document.querySelector(".file-viewer-slides").outerHTML.includes('class="file-viewer-note moved"') &&
      !!cta && cta.textContent.trim() === "" && !!cta.querySelector("svg.brush path") &&
      !document.querySelector("#fileViewerDownload") &&
      getComputedStyle(nav).borderTopWidth === "0px" && getComputedStyle(nav).backgroundColor === "rgba(0, 0, 0, 0)"
    );
  })()`),
  await evalJs(
    `(() => {
      const head = document.querySelector("#fileViewerNote"),
        onPaper = document.querySelector("#fileViewerStage .file-viewer-note"),
        cta = document.querySelector("#fileViewerOpen"),
        nav = document.querySelector(".viewer-slide-nav"),
        dots = [...document.querySelectorAll(".viewer-slide-strip [data-viewer-slide]")];
      return JSON.stringify({
        headText: head?.textContent || "",
        paperFound: !!onPaper,
        paperText: onPaper?.textContent.slice(0, 24) || "",
        paperVis: onPaper ? getComputedStyle(onPaper).visibility : "",
        paperH: onPaper ? onPaper.getBoundingClientRect().height : -1,
        deckNote: document.querySelector(".file-viewer-slides").outerHTML.includes('class="file-viewer-note moved"'),
        ctaText: cta?.textContent.trim() ?? "no cta",
        ctaBrush: !!cta?.querySelector("svg.brush path"),
        oldCta: !!document.querySelector("#fileViewerDownload"),
        navBorder: getComputedStyle(nav).borderTopWidth,
        navBg: getComputedStyle(nav).backgroundColor,
        dotsText: dots.map(d => d.textContent.trim()).join(""),
        dotsFill: dots[0] ? getComputedStyle(dots[0], "::before").backgroundColor : ""
      });
    })()`
  )
);
const deckHtml = await evalJs(`document.querySelector(".file-viewer-slides").outerHTML`);
const slides = JSON.parse(
  await evalJs(
    `JSON.stringify([...document.querySelectorAll("#fileViewerStage .viewer-slide")].map(s => s.querySelector("h2")?.textContent + "|" + [...s.querySelectorAll("li")].map(li => li.firstChild.textContent.trim()).join("/") + [...s.querySelectorAll("img")].map(i => "|" + i.alt + ":" + i.src.slice(0, 14)).join("")))`
  )
);
check(
  "pptx follows presentation order, skips unused slides, keeps headings, levels and pictures",
  slides.join("#") ===
    "第 1 页 · 小结|核对输入/记录结果|拟合直线:data:image/png#第 2 页 · 线性回归|从最小二乘说起/几何直观#第 3 页 · 步骤|先归一化/补充/再拟合#第 4 页 · 编号类型|第三项/第四项/子步骤四/罗马二/大写甲/说明下的子项",
  JSON.stringify(slides)
);
check(
  "pptx: freeform title, reading order and grouped text; ordinary text boxes are not bullets",
  await evalJs(
    `(s => [...s.querySelectorAll(':scope > p')].map(p => p.textContent).slice(0, 6).join("|") === "页眉|推导闭式解|右栏说明|组内题|组内说明|页脚" && s.querySelector("p strong")?.textContent === "推导闭式解")(document.querySelector("#fileViewerStage .viewer-slide"))`
  )
);
check(
  "pptx: root AlternateContent uses the first supported Choice; the group uses Fallback only",
  await evalJs(`(s => {
    const pics = [...s.querySelectorAll("img")];
    const paragraphs = [...s.querySelectorAll(":scope > p")].map(p => p.textContent);
    return pics.length === 1 && pics[0].alt === "拟合直线" && pics[0].getAttribute("src")?.startsWith("data:image/png") &&
      ["组内题", "组内说明"].every(text => paragraphs.filter(p => p === text).length === 1) &&
      !/根未知分支|根第二适用分支|根备用分支|组未知分支/.test(s.textContent);
  })(document.querySelector("#fileViewerStage .viewer-slide"))`)
);
check(
  "pptx: the large freeform list at the top keeps its numbering; the smaller text is the title",
  await evalJs(`(s => {
    const list = s.querySelector(':scope > ol[start="7"]');
    return s.querySelector("h2")?.textContent === "第 1 页 · 小结" &&
      !!list && [...list.querySelectorAll(":scope > li")].map(li => li.textContent.trim()).join("|") === "核对输入|记录结果";
  })(document.querySelector("#fileViewerStage .viewer-slide"))`)
);
check(
  "pptx: literal backtick and tilde fences and the following text boxes stay separate paragraphs",
  await evalJs(`(s => {
    const last = [...s.querySelectorAll(".viewer-slide")].at(-1);
    const paragraphs = [...last.querySelectorAll(":scope > p")].map(p => p.textContent);
    return !last.querySelector("pre") && JSON.stringify(paragraphs.slice(-4)) === JSON.stringify(${JSON.stringify(fenceTexts)});
  })(document.querySelector("#fileViewerStage"))`)
);
check(
  "pptx 里 PowerPoint 自动编号的那些要点也认得出是有序的（buAutoNum）",
  await evalJs(
    `[...document.querySelectorAll("#fileViewerStage .viewer-slide")].find(s => s.querySelector("h2")?.textContent.endsWith(" · 步骤")).querySelectorAll("ol li").length === 3`
  )
);
check(
  "pptx: a non-list paragraph stays separate and a soft break does not split the slide",
  await evalJs(
    `!![...document.querySelectorAll("#fileViewerStage .viewer-slide > p")].find(p => p.textContent === "## 这是正文不是新的一页" && p.querySelector("br"))`
  )
);
check(
  "pptx: malformed XML and unfinished compression in notes affect only the corresponding notes",
  (await evalJs(
    `JSON.stringify([...document.querySelectorAll("#fileViewerStage .viewer-slide")].map(s => s.textContent.includes("这一页的备注未能读出")))`
  )) === "[true,false,true,false]"
);
const numbered = JSON.parse(
  await evalJs(
    `(s => { const numbered = [...s.querySelectorAll(".viewer-slide")].find(slide => slide.querySelector("h2")?.textContent.endsWith(" · 步骤")), ol = numbered?.querySelector("ol"); return JSON.stringify({ start: ol?.getAttribute("start"), nested: numbered?.querySelectorAll("ol ol > li").length }); })(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "pptx 的 startAt 是「从第几号起」、下一层缩进到父项记号之后（不然接着上一页的流程会重又从 1 开始、子项也塌成续文）",
  numbered.start === "5" && numbered.nested === 1,
  JSON.stringify(numbered)
);
const said = JSON.parse(
  await evalJs(
    `JSON.stringify([...document.querySelectorAll("#fileViewerStage .viewer-slide")].map(s => [...s.querySelectorAll("blockquote p")].map(p => p.textContent.trim()).join("/")))`
  )
);
check(
  "pptx: the speaker's notes follow their own slide, without the page number and thumbnail placeholders",
  said.join("#") === "#讲慢一些，这里停一下/先给直觉，再给公式##",
  JSON.stringify(said)
);
check(
  "pptx 的字母/罗马数字编号保留类型与起始数，嵌套列表仍嵌在前一项下",
  await evalJs(`(s => { const last = [...s.querySelectorAll(".viewer-slide")].at(-1);
    const alpha = last.querySelector('ol[type="a"][start="3"]');
    return !!alpha && alpha.querySelectorAll(':scope > li').length === 2 &&
      !!alpha.querySelector('ol[type="I"][start="4"] > li') &&
      !!last.querySelector('ol[type="i"][start="2"] > li') &&
      !!last.querySelector('ol[type="A"] > li') &&
      [...last.querySelectorAll(':scope > p')].find(p => p.textContent === "分段说明")?.nextElementSibling?.matches('ol[type="a"][start="2"]');
  })(document.querySelector("#fileViewerStage"))`)
);
await closeViewer();

await open("版式.pptx");
const side = JSON.parse(
  await evalJs(`(() => {
  const page = document.querySelector(".file-viewer-slides .viewer-slide"),
    r = page.getBoundingClientRect(),
    at = e => { const b = e.getBoundingClientRect(); return { l: +((b.left - r.left) / r.width).toFixed(3), t: +((b.top - r.top) / r.height).toFixed(3), w: +(b.width / r.width).toFixed(3), h: +(b.height / r.height).toFixed(3) }; },
    texts = [...page.querySelectorAll(".pv-text")],
    paper = page.querySelector(".pv-page"),
    circle = page.querySelector(".pv-shape"),
    line = page.querySelector(".pv-line");
  return JSON.stringify({ cls: page.className, bg: getComputedStyle(paper).backgroundColor, heads: page.querySelectorAll("h1,h2,h3").length,
    texts: texts.map(e => ({ text: e.textContent, fs: +(parseFloat(getComputedStyle(e.querySelector("span")).fontSize) / r.width).toFixed(4), ...at(e) })),
    circle: circle && { ...at(circle), radius: getComputedStyle(circle).borderRadius, fill: getComputedStyle(circle).backgroundColor },
    line: line && { ...at(line), tail: line.hasAttribute("data-tail"), color: getComputedStyle(line).borderTopColor },
    img: page.querySelector(".pv-img")?.getAttribute("src")?.slice(0, 14) });
})()`)
);
check(
  "pptx 有坐标的一页按画面位置摆字：不拼段落、不丢标题，底色随原件",
  side.cls.includes("viewer-slide-canvas") &&
    side.heads === 0 &&
    side.texts.length === 2 &&
    side.bg === "rgb(8, 13, 29)" &&
    side.texts.map(t => t.text).join("/") === "版式标题/正文一行",
  JSON.stringify(side)
);
check(
  "pptx 画布：字落在原来的位置，字号照原件的比例（40 磅与 18 磅 vs 纸宽 960 磅）",
  Math.abs(side.texts[0].l - 0.1) < 0.01 &&
    Math.abs(side.texts[0].t - 0.1) < 0.01 &&
    Math.abs(side.texts[0].w - 0.5) < 0.01 &&
    Math.abs(side.texts[0].fs - 40 / 960) < 0.002 &&
    Math.abs(side.texts[1].fs - 18 / 960) < 0.002,
  JSON.stringify(side.texts)
);
check(
  "pptx 画布：圆与连线照原坐标，填充、描边与箭头都在；图仍从原件取",
  Math.abs(side.circle.l - 0.656) < 0.01 &&
    Math.abs(side.circle.t - 0.4) < 0.01 &&
    side.circle.radius === "50%" &&
    side.circle.fill === "rgb(23, 38, 65)" &&
    Math.abs(side.line.t - 0.729) < 0.01 &&
    Math.abs(side.line.w - 0.328) < 0.01 &&
    side.line.tail &&
    side.img === "data:image/png",
  JSON.stringify(side)
);
await open("母版.pptx");
const inherited = JSON.parse(
  await evalJs(`(() => {
  const page = document.querySelector(".file-viewer-slides .viewer-slide"),
    r = page.getBoundingClientRect(),
    paper = page.querySelector(".pv-page"),
    texts = [...page.querySelectorAll(".pv-text")],
    box = e => { const b = e.getBoundingClientRect(); return { l: +((b.left - r.left) / r.width).toFixed(3), t: +((b.top - r.top) / r.height).toFixed(3), w: +(b.width / r.width).toFixed(3), h: +(b.height / r.height).toFixed(3) }; },
    first = texts[0],
    span = first && first.querySelector("span"),
    bodySpan = texts[1] && texts[1].querySelector("span"),
    para = texts[1] && texts[1].querySelector("p");
  return JSON.stringify({
    texts: texts.map(e => e.textContent),
    titleFs: span ? +(parseFloat(getComputedStyle(span).fontSize) / r.width).toFixed(4) : 0,
    titleColor: span ? getComputedStyle(span).color : "",
    titleBox: first && box(first),
    titleAnchor: first && getComputedStyle(first).justifyContent,
    bodyFs: bodySpan ? +(parseFloat(getComputedStyle(bodySpan).fontSize) / r.width).toFixed(4) : 0,
    lineRatio: para && bodySpan ? +(parseFloat(getComputedStyle(para).lineHeight) / parseFloat(getComputedStyle(bodySpan).fontSize)).toFixed(2) : 0,
    nowrap: texts[2] ? getComputedStyle(texts[2]).whiteSpace : "",
    blank: page.querySelector(".pv-blank") && { text: page.querySelector(".pv-blank").textContent, ...box(page.querySelector(".pv-blank")) },
    bg: paper ? getComputedStyle(paper).backgroundColor : "",
    paperStyle: paper ? paper.getAttribute("style") : "",
    pad: first ? [getComputedStyle(first).paddingTop, getComputedStyle(first).paddingLeft].map(v => parseFloat(v)) : [],
    numbered: texts.map(e => e.textContent).find(t => t.includes("字母第三项")) || "",
    numberedLeft: (() => { const e = texts.find(t => t.textContent.includes("字母第三项")); return e ? +((e.getBoundingClientRect().left - r.left) / r.width).toFixed(3) : -1; })(),
    cells: [...page.querySelectorAll(".pv-table td")].map(td => td.textContent)
  });
})()`)
);
check(
  "pptx 画布：页上没写的位置与字号从版式、母版与 txStyles 继承（标题 32 磅、按母版底部对齐、颜色也照母版）",
  Math.abs(inherited.titleFs - 32 / 720) < 0.002 &&
    Math.abs(inherited.titleBox.l - 0.05) < 0.01 &&
    Math.abs(inherited.titleBox.t - 0.04) < 0.01 &&
    Math.abs(inherited.titleBox.h - 0.167) < 0.01 &&
    (inherited.titleAnchor === "flex-end" || inherited.titleAnchor === "flow-end") &&
    inherited.titleColor === "rgb(17, 34, 51)",
  JSON.stringify(inherited)
);
check(
  "pptx 画布：normAutofit 的缩字与压行距照原件（18 磅 × 92.5%，行距压两成）",
  Math.abs(inherited.bodyFs - (18 * 0.925) / 720) < 0.002 && Math.abs(inherited.lineRatio - 1.04) < 0.03,
  JSON.stringify(inherited)
);
check("pptx 画布：wrap=none 的框照一行排出去，不在框里折断", inherited.nowrap === "pre", JSON.stringify(inherited));
check(
  "pptx 画布：页上没写底色时从版式、母版继承",
  inherited.bg === "rgb(10, 11, 12)",
  JSON.stringify({ bg: inherited.bg, dbg: inherited.dbg })
);
check(
  "pptx 画布：内边距按上右下左（左右比上下宽，别把次序弄反）",
  inherited.pad[1] > inherited.pad[0] * 1.5,
  JSON.stringify(inherited.pad)
);
check(
  "pptx 画布：自动编号照 startAt 与类型（字母第三项写作 c.），段左缩进按原件折算",
  /^c\s*字母第三项/.test(inherited.numbered) && Math.abs(inherited.numberedLeft - 0.05) < 0.02,
  JSON.stringify({ numbered: inherited.numbered, left: inherited.numberedLeft })
);
check(
  "pptx 画布：一格里的两段拼成一行，不落成逗号",
  inherited.cells[0] === "格一续行" && inherited.cells[1] === "格二",
  JSON.stringify(inherited.cells)
);
check(
  "pptx 画布：画不出的图表留一块虚线框，位置照原框，不当作没这一块",
  !!inherited.blank &&
    inherited.blank.text === "图表" &&
    Math.abs(inherited.blank.l - 0.6) < 0.01 &&
    Math.abs(inherited.blank.t - 0.667) < 0.01,
  JSON.stringify(inherited.blank)
);
await closeViewer();

await open("说明.odt");
const odt = JSON.parse(
  await evalJs(
    `(s => JSON.stringify({ h1: s.querySelector("h1")?.textContent, ordered: [...s.querySelector("ol").children].map(li => li.firstChild.textContent.trim()), nested: [...s.querySelectorAll("ol ol li")].map(li => li.textContent.trim()), bullet: [...s.querySelectorAll("ul li")].map(li => li.textContent) }))(document.querySelector("#fileViewerStage"))`
  )
);
check(
  "odt: 编号列表认出是有序的、项目符号仍是无序的（编号挂在 text:list-style 上）",
  odt.h1 === "步骤" && odt.ordered.join() === "先归一化,再拟合" && odt.bullet.join() === "附注一",
  JSON.stringify(odt)
);
check("odt 的下一层不写 text:style-name 时继承外层编号样式，且缩进后真成为子列表", odt.nested.join() === "细项", JSON.stringify(odt));
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
// 游目将同一份预览正文包进带 CSP 的 file: 页面；实际导航后再点页条，防止只验了 markup。
const docPage = await evalJs(
  `fetch('/api/stage/docpage', { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ name:"讲义.pptx", url:${JSON.stringify(pathToFileURL(`${ARCHIVE}/讲义.pptx`).href)}, body:${JSON.stringify(deckHtml)} }) }).then(r => r.json())`
);
if (docPage.url) {
  await send("Page.navigate", { url: docPage.url });
  await waitFor(`location.protocol === 'file:' && document.readyState === 'complete' && !!document.querySelector('.viewer-slide')`);
  await evalJs(`document.querySelector('[data-viewer-slide-step="1"]').click(); true`);
  const standAlone = await slideState();
  check(
    "pptx standalone docpage uses the same pager under its local-file CSP, and still carries the note on the paper",
    standAlone.current.join() === "第 2 页 · 线性回归" &&
      standAlone.below &&
      !!(await evalJs(`document.querySelector(".file-viewer-note a")?.href`)) &&
      (await evalJs(`getComputedStyle(document.querySelector(".file-viewer-note")).visibility !== "hidden"`)),
    JSON.stringify(standAlone)
  );
} else check("pptx standalone docpage is generated", false, JSON.stringify(docPage));
close();
