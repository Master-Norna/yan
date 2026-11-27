// 幻灯片画布的补全：版式的背景图与装饰形状、组合缩放里的字号、竖排、渐变填充、裁过的图。
// 样本现拼：一页、一份版式、一份母版，够让每一条都落在可断言的位置上。
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { connect, check, sleep, PAGE, ARCHIVE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();

// 与 doc-preview.mjs 同一套拼包法（只写解析要读的那几份）
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
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
  rels = links =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.entries(links)
      .map(
        ([id, [type, target]]) =>
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
      )
      .join("")}</Relationships>`,
  P =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

// 一个框：给位置、文字、以及可选的额外属性（竖排、渐变、组）
const box = (x, y, w, h, text, extra = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="9" name="框"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"/><a:noFill/></p:spPr><p:txBody><a:bodyPr ${extra}/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;

const SLIDE = `<p:sld ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
  ${box(600000, 400000, 6000000, 900000, "继承版式的标题", "")}
  ${box(600000, 1600000, 3600000, 800000, "竖排的副题", 'vert="eaVert"')}
  <p:sp><p:nvSpPr><p:cNvPr id="11" name="渐变块"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="2800000"/><a:ext cx="4000000" cy="1200000"/></a:xfrm><a:prstGeom prst="rect"/><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="91B4D6"/></a:gs><a:gs pos="100000"><a:srgbClr val="2368AD"><a:alpha val="60000"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:spPr></p:sp>
  <p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="组"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="6229350" y="600000"/><a:ext cx="4345305" cy="6423660"/><a:chOff x="9810" y="-687"/><a:chExt cx="6843" cy="10116"/></a:xfrm></p:grpSpPr>
    ${box(11975, 3223, 3628, 1888, "组里的小字", "")}
    <p:pic><p:nvPicPr><p:cNvPr id="21" name="裁过的图"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9"/><a:srcRect l="20000" r="20000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="11975" y="6000"/><a:ext cx="3628" cy="1888"/></a:xfrm></p:spPr></p:pic>
  </p:grpSp>
</p:spTree></p:cSld></p:sld>`;

const LAYOUT = `<p:sldLayout ${P}><p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId7"/><a:stretch><a:fillRect/></a:stretch></a:blipFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="装饰圆"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="200000" y="200000"/><a:ext cx="900000" cy="900000"/></a:xfrm><a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="2368AD"/></a:solidFill></p:spPr></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="3" name="标题占位符"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="400000"/><a:ext cx="6000000" cy="900000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/></p:txBody></p:sp>
</p:spTree></p:cSld></p:sldLayout>`;

// 图表的样本：数按 PowerPoint 的写法放在缓存里（strCache / numCache），颜色写在 dPt 的 idx 上
const C =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const LINE_CHART = `<c:chartSpace ${C}><c:chart><c:plotArea><c:layout/>
  <c:lineChart><c:ser>
    <c:idx val="0"/><c:order val="0"/>
    <c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>甲线</c:v></c:pt></c:strCache></c:strRef></c:tx>
    <c:spPr><a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln></c:spPr>
    <c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>
    <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>一</c:v></c:pt><c:pt idx="1"><c:v>二</c:v></c:pt><c:pt idx="2"><c:v>三</c:v></c:pt></c:strCache></c:strRef></c:cat>
    <c:val><c:numRef><c:f>Sheet1!$B$2:$B$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>5</c:v></c:pt><c:pt idx="1"><c:v>15</c:v></c:pt><c:pt idx="2"><c:v>10</c:v></c:pt></c:numCache></c:numRef></c:val>
  </c:ser></c:lineChart>
  <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>
  <c:valAx><c:axId val="2"/><c:scaling><c:max val="20"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:majorUnit val="10"/><c:crossAx val="1"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>`;
const DOUGHNUT_CHART = `<c:chartSpace ${C}><c:chart><c:plotArea><c:layout/>
  <c:doughnutChart><c:varyColors val="1"/><c:ser>
    <c:idx val="0"/><c:order val="0"/>
    <c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>份额</c:v></c:pt></c:strCache></c:strRef></c:tx>
    <c:spPr><a:solidFill><a:srgbClr val="999999"/></a:solidFill></c:spPr>
    <c:dPt><c:idx val="0"/><c:spPr><a:solidFill><a:srgbClr val="112233"/></a:solidFill></c:spPr></c:dPt>
    <c:dPt><c:idx val="1"/><c:spPr><a:solidFill><a:srgbClr val="445566"/></a:solidFill></c:spPr></c:dPt>
    <c:dPt><c:idx val="2"/><c:spPr><a:solidFill><a:srgbClr val="778899"/></a:solidFill></c:spPr></c:dPt>
    <c:dPt><c:idx val="3"/><c:spPr><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></c:spPr></c:dPt>
    <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$5</c:f><c:strCache><c:ptCount val="4"/><c:pt idx="0"><c:v>甲</c:v></c:pt><c:pt idx="1"><c:v>乙</c:v></c:pt><c:pt idx="2"><c:v>丙</c:v></c:pt><c:pt idx="3"><c:v>丁</c:v></c:pt></c:strCache></c:strRef></c:cat>
    <c:val><c:numRef><c:f>Sheet1!$B$2:$B$5</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="4"/><c:pt idx="0"><c:v>70</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt><c:pt idx="2"><c:v>6</c:v></c:pt><c:pt idx="3"><c:v>4</c:v></c:pt></c:numCache></c:numRef></c:val>
  </c:ser><c:holeSize val="60"/></c:doughnutChart>
  <c:catAx><c:axId val="1"/><c:delete val="1"/></c:catAx><c:valAx><c:axId val="2"/><c:delete val="1"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>`;
const STOCK_CHART = `<c:chartSpace ${C}><c:chart><c:plotArea><c:layout/><c:stockChart><c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:stockChart>
  <c:catAx><c:axId val="1"/><c:delete val="0"/></c:catAx><c:valAx><c:axId val="2"/><c:delete val="0"/></c:valAx></c:plotArea></c:chart></c:chartSpace>`;
// 堆叠柱：不写 max / majorUnit，刻度要照各段之和（40、60）取，而不是单系列的最大值 40
const STACK_CHART = `<c:chartSpace ${C}><c:chart><c:plotArea><c:layout/>
  <c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:overlap val="100"/>
    <c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>甲</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:spPr><a:solidFill><a:srgbClr val="010203"/></a:solidFill></c:spPr>
      <c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>前</c:v></c:pt><c:pt idx="1"><c:v>后</c:v></c:pt></c:strCache></c:strRef></c:cat>
      <c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
    <c:ser><c:idx val="1"/><c:order val="1"/><c:tx><c:strRef><c:f>Sheet1!$C$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>乙</c:v></c:pt></c:strCache></c:strRef></c:tx>
      <c:spPr><a:solidFill><a:srgbClr val="040506"/></a:solidFill></c:spPr>
      <c:val><c:numRef><c:f>Sheet1!$C$2:$C$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>30</c:v></c:pt><c:pt idx="1"><c:v>40</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
  </c:barChart>
  <c:catAx><c:axId val="1"/><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="2"/></c:catAx>
  <c:valAx><c:axId val="2"/><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines><c:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:crossAx val="1"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart></c:chartSpace>`;
const frame = (id, x, y, w, h, rid) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="图表${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
// 第二页：一张折线、一张环形；另两张一张认不出（股价图）、一张在包里取不到，都该退回虚线框
const SLIDE2 = `<p:sld ${P} xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
  ${frame(30, 400000, 1500000, 5000000, 3000000, "rId5")}
  ${frame(31, 5700000, 1500000, 3000000, 1600000, "rId6")}
  ${frame(32, 400000, 4800000, 3000000, 1500000, "rId7")}
  ${frame(33, 5700000, 4800000, 3000000, 1500000, "rId8")}
  ${frame(34, 5700000, 3400000, 3000000, 1200000, "rId9")}
</p:spTree></p:cSld></p:sld>`;

const MASTER = `<p:sldMaster ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="标题占位符"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="400000"/><a:ext cx="6000000" cy="900000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="b"/></p:txBody></p:sp>
</p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1600"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="测"><a:themeElements><a:clrScheme name="测"><a:dk1><a:srgbClr val="1B1B1B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="2368AD"/></a:dk2><a:lt2><a:srgbClr val="EEF3F8"/></a:lt2><a:accent1><a:srgbClr val="075CB1"/></a:accent1><a:accent2><a:srgbClr val="007D77"/></a:accent2><a:accent3><a:srgbClr val="A33C29"/></a:accent3><a:accent4><a:srgbClr val="C9E4F8"/></a:accent4><a:accent5><a:srgbClr val="6F6C67"/></a:accent5><a:accent6><a:srgbClr val="A4823A"/></a:accent6><a:hlink><a:srgbClr val="075CB1"/></a:hlink><a:folHlink><a:srgbClr val="7A5C9E"/></a:folHlink></a:clrScheme><a:fontScheme name="测"><a:majorFont/><a:minorFont/></a:fontScheme><a:fmtScheme name="测"/></a:themeElements></a:theme>`;

mkdirSync(ARCHIVE, { recursive: true });
writeFileSync(
  `${ARCHIVE}/版式.pptx`,
  zip({
    "ppt/presentation.xml": `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels({ rId1: ["slide", "slides/slide1.xml"], rId2: ["slide", "slides/slide2.xml"] }),
    "ppt/slides/slide1.xml": SLIDE,
    "ppt/slides/slide2.xml": SLIDE2,
    "ppt/slides/_rels/slide1.xml.rels": rels({
      rId1: ["slideLayout", "../slideLayouts/slideLayout1.xml"],
      rId9: ["image", "../media/image1.png"]
    }),
    // 第四张指向包里没有的一份：取不到图表的数，就该留虚线框
    "ppt/slides/_rels/slide2.xml.rels": rels({
      rId1: ["slideLayout", "../slideLayouts/slideLayout1.xml"],
      rId5: ["chart", "../charts/chart1.xml"],
      rId6: ["chart", "../charts/chart2.xml"],
      rId7: ["chart", "../charts/chart3.xml"],
      rId8: ["chart", "../charts/chart4.xml"],
      rId9: ["chart", "../charts/chart5.xml"]
    }),
    "ppt/charts/chart1.xml": LINE_CHART,
    "ppt/charts/chart2.xml": DOUGHNUT_CHART,
    "ppt/charts/chart3.xml": STOCK_CHART,
    "ppt/charts/chart5.xml": STACK_CHART,
    "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels({
      rId1: ["slideMaster", "../slideMasters/slideMaster1.xml"],
      rId7: ["image", "../media/image1.png"]
    }),
    "ppt/slideMasters/slideMaster1.xml": MASTER,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels({ rId1: ["theme", "../theme/theme1.xml"] }),
    "ppt/theme/theme1.xml": THEME,
    "ppt/media/image1.png": PNG,
    "[Content_Types].xml": "<Types/>"
  })
);

await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0 }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(`document.querySelector("#library").classList.contains("hidden") && document.querySelector("#openLibrary").click(); true`);
await waitFor(`!!document.querySelector('[data-library-disk="版式.pptx"]')`);
await evalJs(`document.querySelector('[data-library-disk="版式.pptx"]').click(); true`);
await waitFor(`!!document.querySelector(".pv-page")`, 20000);
await sleep(600);

const seen = JSON.parse(
  await evalJs(`(() => {
  const page = document.querySelector("#fileViewerStage .viewer-slide-canvas"),
    paper = page.querySelector(".pv-page"), pr = paper.getBoundingClientRect(),
    bg = page.querySelector(".pv-bg"),
    texts = [...page.querySelectorAll(".pv-text")].map(el => {
      const r = el.getBoundingClientRect(),
        span = el.querySelector("span") || el.querySelector("p") || el,
        cs = getComputedStyle(el);
      return { text: el.textContent.trim(), fs: parseFloat(getComputedStyle(span).fontSize) || 0,
        wm: cs.writingMode, x: Math.round(r.left - pr.left), y: Math.round(r.top - pr.top), w: Math.round(r.width), h: Math.round(r.height) };
    }),
    shapes = [...page.querySelectorAll(".pv-shape, .pv-imgclip")].map(el => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return { x: Math.round(r.left - pr.left), y: Math.round(r.top - pr.top), w: Math.round(r.width), h: Math.round(r.height),
        grad: cs.backgroundImage.slice(0, 22), radius: cs.borderRadius, img: el.querySelector("img")?.getBoundingClientRect().width || 0 };
    });
  return JSON.stringify({ w: Math.round(pr.width), bg: bg && { src: (bg.getAttribute("src") || "").slice(0, 22), w: Math.round(bg.getBoundingClientRect().width) },
    texts, shapes });
})()`)
);

check(
  "版式的图片背景铺满纸面（模板的雪景、底纹多半写在版式上）",
  !!seen.bg && seen.bg.src.startsWith("data:image/") && Math.abs(seen.bg.w - seen.w) <= 1,
  JSON.stringify(seen.bg)
);
check(
  "版式上自己画的圆也画（模板的圆标、色块），占位符的空框不画",
  seen.shapes.some(s => s.w > 80 && s.radius === "50%" && s.grad === "none") && !seen.texts.some(t => t.text === ""),
  JSON.stringify(seen.shapes)
);
const small = seen.texts.find(t => t.text === "组里的小字");
// 18 磅 / 纸宽 12192000 EMU ≈ 1.9cqw，在 1270px 的纸上约 24px；乘了组的 635 倍会到几千
check("组合放大几百倍时，框里的字号不跟着放大（字号是绝对的磅值）", small && small.fs > 14 && small.fs < 40, JSON.stringify(small));
check("竖排（eaVert）照竖排画", seen.texts.find(t => t.text === "竖排的副题")?.wm === "vertical-rl", JSON.stringify(seen.texts));
check(
  "渐变填充画成 CSS 渐变，不拿一处色标画成实心",
  seen.shapes.some(s => s.grad.startsWith("linear-gradient")),
  JSON.stringify(seen.shapes.map(s => s.grad))
);
const clipped = seen.shapes.find(s => s.img > 0);
check("裁过的图：外框照裁后的矩形，里面的图放大后偏出去", clipped && clipped.img > clipped.w, JSON.stringify(clipped));

// 第二页：图表照包里的数据缓存重画（一张折线、一张环形），认不出的类型与取不到的那份仍留虚线框
await evalJs(`document.querySelector('[data-viewer-slide="1"]').click(); true`);
await waitFor(`!document.querySelector('[data-viewer-slide-panel="1"]').hasAttribute("hidden")`);
await sleep(300);
const charts = JSON.parse(
  await evalJs(`(() => {
  const panel = document.querySelector('[data-viewer-slide-panel="1"]'),
    svgs = [...panel.querySelectorAll("svg.pv-chart")],
    polylines = svg => [...svg.querySelectorAll("polyline")];
  return JSON.stringify({
    count: svgs.length,
    blanks: panel.querySelectorAll(".pv-blank").length,
    strokes: svgs.map(svg => polylines(svg).map(node => node.getAttribute("stroke"))),
    points: svgs.map(svg => polylines(svg).map(node => node.getAttribute("points").trim().split(/ +/).length)),
    fills: svgs.map(svg => [...svg.querySelectorAll("path")].map(node => node.getAttribute("fill"))),
    texts: svgs.map(svg => [...svg.querySelectorAll("text")].map(node => node.textContent))
  });
})()`)
);
check("图表照包里那份数据缓存重画成 SVG（折线、环形、堆叠柱各一枚）", charts.count === 3, JSON.stringify(charts.count));
check("折线的颜色取自图表 XML，不按主题猜", charts.strokes[0]?.[0] === "#ff0000", JSON.stringify(charts.strokes));
check("折线的点数与 c:pt 一致", charts.points[0]?.[0] === 3, JSON.stringify(charts.points));
check(
  "数值轴照 majorUnit 写刻度",
  ["0", "10", "20"].every(text => (charts.texts[0] || []).includes(text)),
  JSON.stringify(charts.texts[0])
);
check(
  "环形图每段取 dPt 里的颜色（四段）",
  charts.fills[1]?.length === 4 && charts.fills[1][0] === "#112233" && charts.fills[1][3] === "#aabbcc",
  JSON.stringify(charts.fills[1])
);
check(
  "堆叠柱的刻度照各段之和取（40、60，不是单系列的最大值 40）",
  Math.max(...(charts.texts[2] || []).map(Number).filter(Number.isFinite)) >= 60,
  JSON.stringify(charts.texts[2])
);
check("认不出的图表与取不到的图表仍留虚线框", charts.blanks === 2, String(charts.blanks));

await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await close();
