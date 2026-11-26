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

const MASTER = `<p:sldMaster ${P}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="标题占位符"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="400000"/><a:ext cx="6000000" cy="900000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr anchor="b"/></p:txBody></p:sp>
</p:spTree></p:cSld><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1600"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="测"><a:themeElements><a:clrScheme name="测"><a:dk1><a:srgbClr val="1B1B1B"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="2368AD"/></a:dk2><a:lt2><a:srgbClr val="EEF3F8"/></a:lt2><a:accent1><a:srgbClr val="075CB1"/></a:accent1><a:accent2><a:srgbClr val="007D77"/></a:accent2><a:accent3><a:srgbClr val="A33C29"/></a:accent3><a:accent4><a:srgbClr val="C9E4F8"/></a:accent4><a:accent5><a:srgbClr val="6F6C67"/></a:accent5><a:accent6><a:srgbClr val="A4823A"/></a:accent6><a:hlink><a:srgbClr val="075CB1"/></a:hlink><a:folHlink><a:srgbClr val="7A5C9E"/></a:folHlink></a:clrScheme><a:fontScheme name="测"><a:majorFont/><a:minorFont/></a:fontScheme><a:fmtScheme name="测"/></a:themeElements></a:theme>`;

mkdirSync(ARCHIVE, { recursive: true });
writeFileSync(
  `${ARCHIVE}/版式.pptx`,
  zip({
    "ppt/presentation.xml": `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels({ rId1: ["slide", "slides/slide1.xml"] }),
    "ppt/slides/slide1.xml": SLIDE,
    "ppt/slides/_rels/slide1.xml.rels": rels({
      rId1: ["slideLayout", "../slideLayouts/slideLayout1.xml"],
      rId9: ["image", "../media/image1.png"]
    }),
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

await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await close();
