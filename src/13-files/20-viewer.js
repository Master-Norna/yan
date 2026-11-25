// 言 · 文件 · 预览：卷宗与附件的悬浮预览（图看画、文看字、表看格、网页进沙箱、PDF、音视频）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 卷宗文件的悬浮预览：图看画、文看字、表看格、网页进沙箱、PDF 交给浏览器、音视频就地放；都不必先下载 ----------
// 预览器看两种来源：磁盘卷宗（走桥接取回）与对话里的附件（就在这个浏览器里）。同一种文件，不论从哪儿来，看法一样——
// 自己上传的 CSV、PDF、Markdown 点开就该是看，而不是把刚发出去的东西再下载一遍。
// viewerSource 记着当前看的是哪一件：{ file } 是本机的一件（卷宗或别处目录里的），{ attachmentId } 是附件，{ skillDir, skillPath } 是技能带的一件（设置 → 技能里点开）
let viewerRevision = 0,
  viewerSource = null,
  viewerReturnFocus = null,
  viewerObjectUrls = [];
// 关了浮层，焦点交还给点开它的那一件；键盘移到那儿打开的才照旧露焦点框。鼠标点开的、哪怕按 Esc 关，也不露——
// 浏览器见了按键就当键盘在那儿，正文里那一叠会以为有人移到上头，一直斜开着
/** @param {Element|null} el */
const focusReturn = el => (el ? { el, visible: el.matches(":focus-visible") } : null);
/** @param {{ el: Element, visible: boolean } | null} target */
function returnFocus(target) {
  if (target?.el.isConnected) target.el.focus({ focusVisible: target.visible });
}
function viewerBlobUrl(blob) {
  const url = URL.createObjectURL(blob);
  viewerObjectUrls.push(url);
  return url;
}
function revokeViewerUrls() {
  for (const url of viewerObjectUrls) URL.revokeObjectURL(url);
  viewerObjectUrls = [];
}
/** 取一件东西的三种读法：直链（图、PDF、音视频交给浏览器）、正文、字节。
 * 卷宗与落了盘的附件都走桥接的同源地址——页面的 CSP 只许同源的框架与媒体，blob: 的 PDF 会被挡；
 * 原件只暂存在浏览器里（桥接中途断过、还没推进目录）时，才就地造 blob 地址 */
// 预览只用得着开头一段：取正文时按字节要一截（Range），不把几百 MB 的日志整份取回页面再切
const VIEWER_TEXT_CHARS = 200000;
// 截到的字节可能落在半个字上：退到没写完的 UTF-8 序列之前。只给真取了一截的那回用；
// 取全的照原样解，否则 GBK/GB18030 的末字节会被当成半个 UTF-8 切掉
/** @param {Uint8Array} bytes */
function trimIncomplete(bytes) {
  let end = bytes.length;
  for (let back = 1; back <= 4 && end - back >= 0; back++) {
    const byte = bytes[end - back];
    if ((byte & 0xc0) === 0x80) continue;
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    if (need > back) end -= back;
    break;
  }
  return bytes.subarray(0, end);
}
/** @param {string} url @param {{ extracted?: string | (() => Promise<string>), stamp?: string }} [options] extracted：原件取不到时能退回的那份抽出来的正文；stamp：原件的修改时刻与大小 */
function urlReader(url, { extracted = "", stamp = "" } = {}) {
  const fetched = async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(t("取回失败"));
    return response;
  };
  return {
    url: () => url,
    // limit 给了就只取一段（多一个字，用来判断后面还有没有）
    text: async (limit = 0) => {
      if (!limit) return decodeTextBytes(await (await fetched()).arrayBuffer());
      const response = await fetch(url, {
        headers: { Range: `bytes=0-${limit * 4 + 3}` },
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) throw Error(t("取回失败"));
      const bytes = new Uint8Array(await response.arrayBuffer()),
        // Content-Range 报的整份有多大；没这道头（服务器不认 Range）、或这一截已到末尾，就是取全了
        total = Number(/\/(\d+)\s*$/.exec(response.headers.get("content-range") || "")?.[1] || 0);
      // 取全了原样解；真截断的才补尾巴——先按 UTF-8 退掉半个字，再收掉解不出的替换字符
      // （GBK/GB18030 的半个字落在末尾时会解成 U+FFFD）
      const text = total > bytes.length ? decodeTextBytes(trimIncomplete(bytes)).replace(/\uFFFD+$/, "") : decodeTextBytes(bytes);
      return text.length > limit ? text.slice(0, limit + 1) : text;
    },
    blob: async () => (await fetched()).blob(),
    extracted,
    stamp
  };
}
// 技能带的一件：桥接直取原件
function skillFileUrl(source, download = false) {
  return `/api/skills/raw?dir=${encodeURIComponent(source.skillDir)}&path=${encodeURIComponent(source.skillPath)}${download ? "&download=1" : ""}`;
}
// 抽过的正文留几份（按「修改时刻 + 大小」核，改过的不算）：同一份文档开开关关，不必每回重抽
const docTextCache = new Map(),
  DOC_TEXT_CACHE_MAX = 6;
// 原件的「这一份」记号：优先用桥接回的 ETag（带毫秒），其次「修改时刻 + 大小」。
// 只有后两者时秒级不够——同一秒里改成长短一样的内容就看不出来，抽过的旧正文会再拿出来用。都取不到给空串，那份不进缓存、宁可重抽
function stampFromHead(head) {
  if (!head?.ok) return "";
  const etag = head.headers.get("etag"),
    modified = head.headers.get("last-modified"),
    size = head.headers.get("content-length");
  return etag || (modified && size !== null ? `${modified}|${size}` : "");
}
async function stampOf(url) {
  const head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(() => null);
  return stampFromHead(head);
}
async function viewerReader(source) {
  if (source.file) {
    const url = localFileUrl(source.file);
    return urlReader(url, { stamp: await stampOf(url) });
  }
  if (source.skillDir) {
    const url = skillFileUrl(source);
    return urlReader(url, { stamp: await stampOf(url) });
  }
  const url = `/api/files/raw?id=${encodeURIComponent(source.attachmentId)}`,
    head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (head?.ok)
    // 落了盘的附件另有上传时抽下的正文：预览时重抽不成（PDF 的库没载入、文件太大）就退回那一份，
    // 不至于明明抽过却写着「未能抽出正文」
    return urlReader(url, {
      stamp: stampFromHead(head),
      extracted: async () => (await getAttachmentMeta(source.attachmentId).catch(() => null))?.extractedText || ""
    });
  const file = await getAttachment(source.attachmentId);
  if (!file) throw Error(t("附件原件已找不到"));
  const blob = attachmentBlob(file);
  return {
    url: () => viewerBlobUrl(blob),
    text: async (limit = 0) => {
      const text = file.kind === "text" ? String(file.data) : await blob.text();
      return limit && text.length > limit ? text.slice(0, limit + 1) : text;
    },
    blob: async () => blob,
    extracted: String(file.extractedText || "")
  };
}
/** @param {{file?:string, attachmentId?:string, skillDir?:string, skillPath?:string}} source 本机的一件 { file }，或 { attachmentId }，或技能里的一件 */
async function openFileViewer(source, name = "", trigger = null) {
  const revision = ++viewerRevision;
  const viewer = $("#fileViewer");
  if (!viewer) return;
  const title =
      name ||
      String(source.file || "")
        .split("/")
        .pop() ||
      t("附件"),
    kind = fileKind(title).view || "none";
  viewerSource = source;
  viewerReturnFocus = focusReturn(trigger || document.activeElement);
  revokeViewerUrls();
  showNow(viewer);
  setViewerSeal();
  $("#fileViewerDownload").classList.remove("hidden");
  $("#fileViewerName").textContent = title;
  $("#fileViewerStage").innerHTML = `<div class="file-viewer-empty">${t(`正在取出…`)}</div>`;
  $("#fileViewerClose").focus();
  try {
    const reader = await viewerReader(source);
    if (revision !== viewerRevision) return;
    const html = await fileViewerBody(reader, title, kind, revision);
    if (revision !== viewerRevision) return;
    $("#fileViewerStage").innerHTML = html;
    renderEnhancements($("#fileViewerStage"));
  } catch (error) {
    if (revision !== viewerRevision) return;
    $("#fileViewerStage").innerHTML =
      `<div class="file-viewer-empty">${t`未能预览：${escapeHtml(String(error.message || error).slice(0, 120))}`}<br><button type="button" class="outline-btn" data-viewer-download>${t(`下载查看`)}</button></div>`;
  }
}
// 认不得、或只抽得出结构的文件：交给 Windows 的默认程序打开原件（卷宗与落了盘的附件都走桥接），不逐类去补预览
const VIEWER_OPEN_BUTTON = `<button type="button" class="outline-btn" data-viewer-open>${t(`以本机程序打开`)}</button>`;
async function openViewerWithSystem() {
  const source = viewerSource;
  try {
    if (source?.file) await bridge("/api/archive/open", { file: source.file }, AbortSignal.timeout(8000));
    else if (source?.attachmentId) await bridge("/api/files/open", { id: source.attachmentId }, AbortSignal.timeout(8000));
    else if (source?.skillDir)
      await bridge("/api/skills/open-item", { dir: source.skillDir, path: source.skillPath }, AbortSignal.timeout(8000));
    else return;
    toast(t("已在本机程序中打开"));
  } catch (error) {
    toast(t`打开失败：${String(error.message || error).slice(0, 80)}`);
  }
}
// 预览器头上的「下载」：看的是卷宗就走桥接，是附件就从浏览器里取
function downloadViewerFile() {
  if (viewerSource?.attachmentId) void downloadAttachment(viewerSource.attachmentId);
  else if (viewerSource?.skillDir) {
    downloadHref(skillFileUrl(viewerSource, true), String(viewerSource.skillPath).split("/").pop() || "");
  } else if (viewerSource?.file) downloadFile(viewerSource.file);
}
// ODP 与旧附件只有 Markdown：只认抽取器写的页眉，不把正文里的二级标题另算一页。
/** @param {string} text */
function slidePagesFromText(text) {
  return text.split(/^(?=## (?:第 \d+ 页|Page \d+)(?: · |\r?$))/m);
}
/** @param {string[]} source @param {number} [ratio] */
function boundSlidePages(source, ratio = 16 / 9) {
  const pages = [];
  let left = MAX_EXTRACTED_CHARS;
  for (const raw of source) {
    const page = trimExtractedText(raw.slice(0, Math.max(0, left)));
    if (page) pages.push(page);
    if (raw.length > left) return { text: "", pages, ratio, cut: true };
    left -= raw.length;
  }
  return { text: "", pages, ratio, cut: false };
}
// 幻灯片画布：一页一张定位好的纸。长短一律折成纸宽的百分之一（cqw），字号、边距、纸一起缩放。
// 只摆字与基本形状；画不出的（图表、艺术字、渐变填充）宁可不画，也不拿别的东西冒充。
function pptxCanvasHtml(layout, ratio) {
  const size = value => {
      const text = (Number(value) || 0).toFixed(3);
      return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
    },
    pct = value => `${size(value / 10)}%`,
    // 纵向的百分比按纸高算：位置都按纸宽折的，乘以宽高比即得
    vpct = value => `${size((value * ratio) / 10)}%`,
    cqw = value => `${size(value / 10)}cqw`,
    alpha = value =>
      Math.round((value / 100) * 255)
        .toString(16)
        .padStart(2, "0"),
    alignOf = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" },
    runHtml = run => {
      const style = [];
      if (run.c) style.push(`color:#${run.c}`);
      if (run.s) style.push(`font-size:${cqw(run.s)}`);
      if (run.b) style.push("font-weight:700");
      if (run.i) style.push("font-style:italic");
      if (run.u) style.push("text-decoration:underline");
      if (run.k) style.push(`letter-spacing:${cqw(run.k)}`);
      const text = escapeHtml(run.t || "").replace(/\n/g, "<br>");
      return style.length ? `<span style="${style.join(";")}">${text}</span>` : text;
    },
    paraHtml = (para, shape) => {
      const style = ["margin:0"],
        // 行高写成倍数，得挂在真正有字号的那一层，否则按外层默认字号算，行会塌
        size = Math.max(0, ...para.r.map(run => run.s || 0));
      if (size) style.push(`font-size:${cqw(size)}`);
      if (alignOf[para.a]) style.push(`text-align:${alignOf[para.a]}`);
      // 固定磅数的行距是长度，倍数行距才随字号走
      style.push(`line-height:${para.lp ? cqw(para.lp) : Math.round((para.ls || 1) * (shape?.lh || 1.3) * 100) / 100}`);
      if (para.m) style.push(`margin-left:${cqw(para.m)}`);
      // 段前段后：原件里写的是「几磅」或「行高的百分之几」，到这里都已折成纸宽的比例
      if (para.mt) style.push(`margin-top:${cqw(para.mt)}`);
      if (para.mb) style.push(`margin-bottom:${cqw(para.mb)}`);
      return `<p style="${style.join(";")}">${para.r.map(runHtml).join("")}</p>`;
    },
    shapeHtml = shape => {
      if (shape.g === "line") {
        const length = Math.hypot(shape.w, shape.h) / 10,
          angle = Math.round(((Math.atan2(shape.h, shape.w) * 180) / Math.PI) * 100) / 100,
          style = [
            `left:${pct(shape.x)}`,
            `top:${vpct(shape.y)}`,
            `width:${size(length)}cqw`,
            `border-top:${cqw(Math.max(shape.sw || 0.75, 0.4))} ${shape.sd === "dot" ? "dotted" : shape.sd === "dash" ? "dashed" : "solid"} currentColor`,
            `font-size:${cqw(Math.max(shape.sw || 0.75, 0.4))}`,
            `color:#${shape.s}${shape.sa != null ? alpha(shape.sa) : ""}`,
            `transform:rotate(${angle}deg)`
          ];
        return `<i class="pv-line"${shape.st ? " data-tail" : ""}${shape.sh ? " data-head" : ""} style="${style.join(";")}"></i>`;
      }
      if (shape.g === "table") {
        const cols = shape.cols?.length
            ? `<colgroup>${shape.cols.map(width => `<col style="width:${size(width)}%">`).join("")}</colgroup>`
            : "",
          rows = shape.rows
            .map(
              row =>
                `<tr>${row
                  .map(
                    cell =>
                      `<td>${escapeHtml((Array.isArray(cell) ? cell.filter(Boolean).join("\n") : String(cell || "")).trim()).replace(/\n/g, "<br>")}</td>`
                  )
                  .join("")}</tr>`
            )
            .join("");
        return `<table class="pv-table" style="left:${pct(shape.x)};top:${vpct(shape.y)};width:${pct(shape.w)};height:${vpct(shape.h)};font-size:${cqw(shape.s || 140)}">${cols}<tbody>${rows}</tbody></table>`;
      }
      // 图表、智能图形画不出来：一块淡虚线框，标一句这是什么
      if (shape.g === "blank")
        return `<i class="pv-blank" style="left:${pct(shape.x)};top:${vpct(shape.y)};width:${pct(shape.w)};height:${vpct(shape.h)}">${shape.k === "chart" ? t`图表` : t`图示`}</i>`;
      if (shape.g === "img")
        return `<img class="pv-img" data-path="${escapeHtml(shape.src)}" alt="" style="left:${pct(shape.x)};top:${vpct(shape.y)};width:${pct(shape.w)};height:${vpct(shape.h)}">`;
      const style = [`left:${pct(shape.x)}`, `top:${vpct(shape.y)}`, `width:${pct(shape.w)}`, `height:${vpct(shape.h)}`];
      if (shape.g === "ellipse") style.push("border-radius:50%");
      else if (shape.g === "round") style.push("border-radius:8%");
      if (shape.f) style.push(`background:#${shape.f}${shape.fa != null ? alpha(shape.fa) : ""}`);
      if (shape.s)
        style.push(
          `border:${cqw(Math.max(shape.sw || 0.75, 0.4))} ${shape.sd === "dot" ? "dotted" : shape.sd === "dash" ? "dashed" : "solid"} #${shape.s}${shape.sa != null ? alpha(shape.sa) : ""}`
        );
      if (shape.t?.length) {
        style.push(
          "display:flex",
          "flex-direction:column",
          `justify-content:${shape.va === "c" ? "center" : shape.va === "b" ? "flex-end" : "flex-start"}`
        );
        // 原件写 wrap="none"：这一段就照一行排出去，不在框里折断
        if (shape.nw) style.push("white-space:pre");
        if (shape.in) style.push(`padding:${shape.in.map(cqw).join(" ")}`);
        return `<div class="pv-text" style="${style.join(";")}">${shape.t.map(para => paraHtml(para, shape)).join("")}</div>`;
      }
      return `<i class="pv-shape" style="${style.join(";")}"></i>`;
    };
  return layout.shapes.map(shapeHtml).join("");
}
/** @param {string[]} pages @param {number} ratio @param {string} note @param {"pptx"|"odp"} format */
function slideViewerHtml(pages, ratio, note, format, canvases = [], titles = [], notes = []) {
  const last = pages.length - 1,
    step = (name, direction, glyph) =>
      `<button type="button" data-viewer-slide-step="${direction}" aria-disabled="${direction === -1 || !last}" title="${name}" aria-label="${name}">${glyph}</button>`,
    // 排得出位置的页走画布；排不出的（ODP、旧附件、缺坐标的页）照旧一段段 Markdown
    panel = (part, i) => {
      const layout = canvases[i];
      if (!layout)
        return `<div class="viewer-slide markdown" data-viewer-slide-panel="${i}" tabindex="0"${i ? " hidden" : ""}>${renderMarkdown(part)}</div>`;
      const label = titles[i] ? `${i + 1} / ${pages.length} · ${titles[i]}` : `${i + 1} / ${pages.length}`,
        bg = layout.bg || "ffffff",
        // 没写颜色的字（表格、缺字色的框）随底色的明暗取墨或取白
        level = parseInt(bg, 16) || 0,
        ink = ((level >> 16) & 255) * 0.299 + ((level >> 8) & 255) * 0.587 + (level & 255) * 0.114 > 140 ? "#1a1a1a" : "#f5f5f5";
      const said = (notes[i] || []).filter(Boolean);
      return `<div class="viewer-slide viewer-slide-canvas" data-viewer-slide-panel="${i}" tabindex="0" aria-label="${escapeHtml(label)}"${i ? " hidden" : ""}><div class="pv-page" style="background:#${bg};color:${ink}">${pptxCanvasHtml(layout, ratio)}</div>${
        said.length
          ? `<details class="pv-notes"><summary>${t`备注`}</summary><div class="markdown">${renderMarkdown(said.join("\n\n"))}</div></details>`
          : ""
      }</div>`;
    };
  return `<div class="file-viewer-slides" data-slide-format="${format}" style="--slide-ratio:${Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9}">${note}<div class="viewer-slide-well"><div class="viewer-slide-stage">${pages
    .map(panel)
    .join(
      ""
    )}</div></div><nav class="viewer-slide-nav" aria-label="${t`演示页导航`}">${step(t`上一页`, -1, "‹")}<div class="viewer-slide-strip">${pages
    .map(
      (_, i) =>
        `<button type="button" data-viewer-slide="${i}" aria-label="${t`第 ${i + 1} 页`}"${i ? ' tabindex="-1"' : ' aria-current="page"'}>${i + 1}</button>`
    )
    .join(
      ""
    )}</div>${step(t`下一页`, 1, "›")}<span class="viewer-slide-count" data-viewer-slide-count aria-live="polite">1 / ${pages.length}</span></nav></div>`;
}

async function fileViewerBody(reader, name, kind, revision = viewerRevision) {
  if (kind === "image") return `<img class="file-viewer-image" src="${escapeHtml(reader.url())}" alt="${escapeHtml(name)}">`;
  // PDF 交给浏览器自带的阅读器；卷宗的响应带 CSP: sandbox，脚本不会以本站身份运行
  if (kind === "pdf") return `<iframe class="file-viewer-frame" src="${escapeHtml(reader.url())}" title="${escapeHtml(name)}"></iframe>`;
  // 音频摊成听音整页（放音不在这层浮层里，关了也不断，见 src/25-listen.js）；视频交给浏览器自带的播放器，编码认不得（如某些 mkv）时换成下载提示，见 bindViewerEvents
  if (kind === "audio") return listenPageHtml(listenTrackFrom(viewerSource, name, reader));
  if (kind === "video")
    return `<div class="file-viewer-media"><video controls preload="metadata" src="${escapeHtml(reader.url())}" title="${escapeHtml(name)}"></video></div>`;
  // 扩展名认不出、其实是文字的（Dockerfile、Makefile、.env…）：取开头一段闻一下，是字就照文字看，不给「无法预览」。
  // 闻中了不在这儿画：落下去走下面那条通用的文字路——这里只读了 64 KB，几百 MB 的日志照它画就少了「仅显示前 20 万字」那句
  if (kind === "none") {
    const head = await reader.text(65536).catch(() => "");
    if (!looksLikeText(head))
      return `<div class="file-viewer-empty">${t(`此类文件无法在此预览`)}<br>${VIEWER_OPEN_BUTTON}<button type="button" class="outline-btn" data-viewer-download>${t(`下载`)}</button></div>`;
  }
  // 网页放进与页内 ```html 同一个隔离沙箱：不能读本站的存储，也不能联网
  if (kind === "html") {
    let source = await reader.text();
    let theme = vizTheme();
    // 自带运行时的导出作品：在言里重新打开时取出原始源码，仍用当前的隔离预览，不嵌套导出外壳。
    const outer = new DOMParser().parseFromString(source, "text/html"),
      frameSource = outer.querySelector('iframe[sandbox="allow-scripts"][srcdoc]')?.getAttribute("srcdoc");
    if (frameSource) {
      const packed = new DOMParser().parseFromString(frameSource, "text/html").getElementById("yan-preview-export");
      if (packed) {
        const data = JSON.parse(packed.textContent);
        if (typeof data.html === "string") {
          source = data.html;
          theme = data.theme || theme;
        }
      }
    }
    const id = `app${uid().replace(/[^a-z0-9]/gi, "")}`;
    setTimeout(() => {
      if (revision !== viewerRevision) return;
      const frame = $(`#fileViewerStage iframe[data-viewer-app="${id}"][sandbox="allow-scripts"]`);
      if (!frame) return;
      frame.addEventListener(
        "load",
        () => {
          if (revision === viewerRevision && frame.isConnected && frame.getAttribute("sandbox") === "allow-scripts")
            frame.contentWindow?.postMessage({ type: "yan-preview-render", id, html: source, theme, scroll: true }, "*");
        },
        { once: true }
      );
      frame.src = `./preview.html#${id}`;
    }, 0);
    return `<iframe class="file-viewer-frame" data-viewer-app="${id}" sandbox="allow-scripts" title="${t(`隔离的网页预览`)}"></iframe>`;
  }
  if (kind === "table") {
    // 四百行就够看了：只取一段（一行也可能很长），不把整个大表取回来
    const text = await reader.text(2000000),
      // 字符先到顶也是截了（一行上万字的大表，行数远不到四百）：末条记录没写完，不算数
      cut = text.length > 2000000,
      split = fileExtension(name) === "tsv" ? "\t" : ",",
      rows = parseDelimited(cut ? text.slice(0, 2000000) : text, split, 401, cut),
      cells = rows.slice(0, 400),
      note = [cut ? t`内容过长，只解析了开头一段` : "", rows.length > 400 ? t`仅显示前 400 行` : ""].filter(Boolean).join("；");
    if (!cells.length) return `<div class="file-viewer-empty">${cut ? t(`预览范围内没有完整记录`) : t(`空文件`)}</div>`;
    return `<div class="file-viewer-text file-viewer-fit"><table class="file-viewer-table"><thead><tr>${cells[0].map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${cells
      .slice(1)
      .map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>${note ? `<p class="file-viewer-note">${note}</p>` : ""}</div>`;
  }
  if (kind === "doc") {
    // 从原件现抽（按结构抽成 Markdown）；原件取不到、或这回没抽出来（PDF 的库没载入、文件太大），
    // 退回上传时抽下的那一份（附件有，卷宗里的没有）。文中的图照抽出的路再从原件里取（见 withZipImages）。
    // 原件照 Blob 读成字节直接用，不再经 data: URL 转一趟 base64（大文档编一遍解一遍，纯属白耗）。
    // 抽过的正文按原件的「修改时刻 + 大小」留几份：同一份再打开不必重抽，原件改过则照新抽
    let bytes = null;
    const sort = fileKind(name).name,
      stamp = String(reader.stamp || ""),
      // 名字不够：同名的两件（两层的 README.md）大小与时刻恰好一样也少见，但地址各有各的
      cacheKey = stamp ? `${reader.url?.() || name}|${stamp}` : "",
      cached = cacheKey ? docTextCache.get(cacheKey) : null,
      readBytes = async () => new Uint8Array(await (await reader.blob()).arrayBuffer());
    let doc = cached;
    if (!doc)
      try {
        bytes = await readBytes();
        if (sort === "slides") {
          if (fileExtension(name) === "pptx") {
            const { pages, ratio, canvases, titles, notes } = await extractPptxSlides(bytes);
            doc = boundSlidePages(pages, ratio);
            // 画布与页一一对：截了字就只留截得住的那几页
            doc.canvases = canvases.slice(0, doc.pages.length);
            doc.titles = titles.slice(0, doc.pages.length);
            doc.notes = notes.slice(0, doc.pages.length);
          } else doc = boundSlidePages(slidePagesFromText(await extractZipDocumentText("odp", bytes)));
        } else doc = { text: trimExtractedText(await extractDocumentText(name, bytes)) };
        if ((doc.text || doc.pages?.length) && cacheKey) {
          docTextCache.set(cacheKey, doc);
          if (docTextCache.size > DOC_TEXT_CACHE_MAX) docTextCache.delete(docTextCache.keys().next().value);
        }
      } catch {}
    if (!doc?.text && !doc?.pages?.length) {
      const fallback = String((typeof reader.extracted === "function" ? await reader.extracted() : reader.extracted) || "");
      // 上传时的旧正文可能已带截断尾注；照原字符上限取，尾注另写到页外，不交给 Markdown 分页。
      doc = sort === "slides" ? boundSlidePages(slidePagesFromText(fallback)) : { text: trimExtractedText(fallback) };
    }
    if (!doc.text && !doc.pages?.length)
      return `<div class="file-viewer-empty">${t(`未能抽出正文`)}<br>${VIEWER_OPEN_BUTTON}<button type="button" class="outline-btn" data-viewer-download>${t(`下载`)}</button></div>`;
    // 画布页不再说「不含原排版」：字的位置与大小照原件摆，只是图形从简
    const note = `<p class="file-viewer-note">${doc.canvases?.some(Boolean) ? t(`本机按文字位置排出，图形从简 ·`) : t(`本机按结构抽出，不含原排版 ·`)} <button type="button" class="viewer-open-link" data-viewer-open>${t(`以本机程序打开`)}</button>${doc.cut ? ` · ${t`内容过长，只解析了开头一段`}` : ""}</p>`;
    let html;
    if (doc.pages?.length)
      html = slideViewerHtml(
        doc.pages,
        doc.ratio,
        note,
        fileExtension(name) === "pptx" ? "pptx" : "odp",
        doc.canvases,
        doc.titles,
        doc.notes
      );
    else {
      // 工作簿抽取器按「## 」一张表一节，其余文档不分页。
      const sections = sort === "sheet" ? doc.text.split(/^(?=## )/m).filter(part => part.trim()) : [];
      html = sections.length
        ? `<div class="file-viewer-text file-viewer-wide">${note}<div class="viewer-tabs">${sections
            .map(
              (part, i) =>
                `<button type="button" class="${i ? "" : "active"}" data-viewer-tab="${i}">${escapeHtml(part.match(/^## (.*)/)?.[1] || t`工作表 ${i + 1}`)}</button>`
            )
            .join("")}</div>${sections
            .map(
              (part, i) =>
                `<div class="viewer-sheet markdown${i ? " hidden" : ""}" data-viewer-panel="${i}">${renderMarkdown(part.replace(/^## .*\n+/, ""))}</div>`
            )
            .join("")}</div>`
        : `<div class="file-viewer-text markdown">${note}${renderMarkdown(doc.text)}</div>`;
    }
    // 缓存住的正文若带图，仍要从原件里取图（data-path 由 withZipImages 换掉）。
    if (cached && html.includes("data-path")) bytes = await readBytes().catch(() => null);
    return withZipImages(html, bytes);
  }
  // 只要开头这一段：几百 MB 的日志不整份取回来再切
  const text = await reader.text(VIEWER_TEXT_CHARS),
    // 截了要说一声：不然读的人当预览的末尾就是文件的末尾（原文件不动，下载、以本机程序打开都在）
    cut = text.length > VIEWER_TEXT_CHARS ? `<p class="file-viewer-note">${t("仅显示前 20 万字")}</p>` : "";
  if (kind === "markdown") return `<div class="file-viewer-text markdown">${renderMarkdown(text.slice(0, VIEWER_TEXT_CHARS))}${cut}</div>`;
  return `<div class="file-viewer-text"><pre class="file-viewer-code">${escapeHtml(text.slice(0, VIEWER_TEXT_CHARS))}</pre>${cut}</div>`;
}
// 像不像一段字：与抽取器「闻」的是同一处判据（见 30-extract 的 textLooksBinary）——没有 NUL，控制字符与坏字不过 2%。
// 压缩包、可执行文件开头一段就满是这些
/** @param {string} text */
function looksLikeText(text) {
  return !!text && !text.includes("\0") && !textLooksBinary(text);
}
// CSV / TSV：引号里的换行仍属于同一个字段，显示上限按记录计。
// open＝给进来的这一段是被截断的（字符先到顶），末条多半没写完，不算
function parseDelimited(text, split, limit = Infinity, open = false) {
  const rows = [];
  let row = [];
  let cell = "",
    quoted = false,
    started = false;
  const finish = () => {
    if (started || row.length) rows.push([...row, cell]);
    row = [];
    cell = "";
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      finish();
      if (rows.length >= limit) return rows;
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else if (ch === '"') {
      quoted = true;
      started = true;
    } else if (ch === split) {
      row.push(cell);
      cell = "";
      started = true;
    } else {
      cell += ch;
      started = true;
    }
  }
  if (!open) finish();
  return rows;
}
/** @param {boolean} [stop] 点的是 ×：摊着的若是正放的那一曲，一并停下；别的关法只收起，正放着的挂上顶栏接着放 */
function closeFileViewer(stop = false) {
  viewerRevision++;
  listenViewerClosed(stop);
  const target = viewerReturnFocus;
  viewerSource = null;
  viewerReturnFocus = null;
  revokeViewerUrls();
  // 纸沉下去、底淡掉（见 90-motion-responsive.css 的「开层」），淡完再清台面；其间又开了别的（revision 变了）就不清
  const revision = viewerRevision;
  hideWithFade($("#fileViewer"));
  setTimeout(() => {
    if (revision === viewerRevision) $("#fileViewerStage").innerHTML = "";
    // 预览里全屏着的作品随预览一起没了：页上的 work-mode 也得撤，不然对话区滚不动
    if (!document.querySelector(".work-expanded")) closeExpandedWork();
  }, 180);
  returnFocus(target);
}
// 不是一件文件、而是现成的一段内容（如一件文件在这一答里的改动）也摊在这层浮层里看：没有可下载的，下载键收起
/** 顶栏那一枚印：预览一律「览」，图的卡片换它自己的石青「图」（全页仍只一枚印） @param {string} [glyph] */
function setViewerSeal(glyph = t("览")) {
  const seal = $("#fileViewer .file-viewer-head > .seal");
  if (seal) seal.textContent = seal.dataset.seal = glyph;
}
/** @param {string} title @param {string} html @param {Element|null} [trigger] @param {string} [seal] 顶栏的印 */
function showInFileViewer(title, html, trigger = null, seal = t("览")) {
  viewerRevision++;
  viewerSource = null;
  viewerReturnFocus = focusReturn(trigger || document.activeElement);
  revokeViewerUrls();
  showNow($("#fileViewer"));
  setViewerSeal(seal);
  $("#fileViewerDownload").classList.add("hidden");
  $("#fileViewerName").textContent = title;
  $("#fileViewerStage").innerHTML = html;
  $("#fileViewerClose").focus();
}
/** @type {{ src: string, name: string, url: string } | null} 正看的是取来的外链图 */
let imageViewerRemote = null;
let imageViewerFile = null,
  imageViewerRevision = 0;
// 卷宗里的图；paths 是同看的一组（卷宗此刻列着的图），看图框底下排成一条小样、左右翻
function openArchiveImage(path, trigger = null, paths = [path]) {
  openImageSet(
    paths.map(item => ({ file: archiveFile(item) })),
    Math.max(0, paths.indexOf(path)),
    trigger
  );
}
// 看图框一回看的一组：每件是附件 { id }、本机的图 { file }，或点了取来的外链图 { src, name, url }；只一件时不出小样
let imageViewerSet = [],
  imageViewerIndex = 0;
/** @param {{ id?: string, file?: string, src?: string, name?: string, url?: string }[]} items @param {number} index @param {Element|null} trigger */
function openImageSet(items, index, trigger = null) {
  imageViewerSet = items;
  imageViewerReturnFocus = focusReturn(trigger || document.activeElement);
  const strip = $("#imageViewerStrip"),
    many = items.length > 1;
  $("#imageViewer").classList.toggle("has-strip", many);
  strip.classList.toggle("hidden", !many);
  strip.innerHTML = many
    ? items
        .map(
          (item, i) =>
            `<button type="button" data-strip-index="${i}"${item.file ? ` title="${escapeHtml(item.file.split("/").pop())}"` : ""}>${
              item.id
                ? `<img data-thumb="${escapeHtml(item.id)}" alt="">`
                : item.src
                  ? `<img src="${escapeHtml(item.src)}" alt="">`
                  : `<img src="${escapeHtml(localFileUrl(item.file))}" loading="lazy" decoding="async" alt="">`
            }</button>`
        )
        .join("")
    : "";
  if (many) void loadThumbnails(strip);
  // 底下那排小样取不回来时收掉，不挂破图；大图那一枚是复用的（closeImageViewer 还要 removeAttribute），不在这里换
  mendImages(strip);
  return showImageAt(index, true);
}
// 摊开组里的第几件，先按窗口大小看；附件先取元数据，落了盘的照同源地址画，取到时已换了别件就作罢
async function showImageAt(index, opening = false) {
  const item = imageViewerSet[index];
  if (!item) return;
  const revision = ++imageViewerRevision;
  let src, name, label;
  if (item.id) {
    let file;
    try {
      file = await getAttachmentMeta(item.id);
    } catch {
      if (revision === imageViewerRevision) toast(t("图片读取失败"));
      return;
    }
    if (revision !== imageViewerRevision) return;
    if (!file) {
      // 原件没了：大图那一枚是复用的，不能把上一幅留在画面里（名字也照实写）
      $("#imageViewerImage")?.removeAttribute("src");
      const empty = $("#imageViewerName");
      if (empty) empty.textContent = t("图片原件已找不到");
      return toast(t("图片原件已找不到"));
    }
    if (file.kind !== "image") return openFileViewer({ attachmentId: item.id }, file.name, imageViewerReturnFocus?.el);
    // 落了盘的照同源地址画：整张图不必先编成 data: URL 攥在页面里
    const url = await attachmentSrc(item.id);
    if (revision !== imageViewerRevision) return;
    if (!url) {
      $("#imageViewerImage")?.removeAttribute("src");
      const empty = $("#imageViewerName");
      if (empty) empty.textContent = t("图片原件已找不到");
      return toast(t("图片原件已找不到"));
    }
    [src, name, label] = [url, file.name, `${file.name || t("图片")} · ${formatFileSize(file.size)}`];
  } else if (item.src) {
    [src, name, label] = [item.src, item.name || "", `${item.name || t("图片")} · ${stageHost(item.url || "")}`];
  } else {
    // 卷宗之外的没有件数大小可报
    const rel = archiveRel(item.file),
      entry = rel === null ? null : (archiveEntries || []).find(file => file.path === rel);
    src = localFileUrl(item.file);
    name = entry?.name || "";
    label = entry ? `${entry.name} · ${formatFileSize(entry.size || 0)}` : item.file.split("/").pop();
  }
  imageViewerIndex = index;
  imageViewerAttachmentId = item.id || null;
  imageViewerFile = item.file || null;
  imageViewerRemote = item.src ? { src: item.src, name: item.name || "", url: item.url || "" } : null;
  $("#imageViewerName").textContent = label;
  const image = $("#imageViewerImage");
  // 取不回来就摘掉 src：这一枚是复用的，不能换成别的节点（否则后再看别的图就指不到它了）
  image.onerror = () => image.removeAttribute("src");
  image.src = src;
  image.alt = name || t("图片预览");
  setImageViewerZoom(false);
  const marks = $("#imageViewerStrip").children;
  for (const mark of marks) mark.classList.toggle("on", mark === marks[index]);
  if (opening) {
    showNow($("#imageViewer"));
    $("#imageViewerClose").focus();
  }
  marks[index]?.scrollIntoView({ block: "nearest", inline: "center" });
}

// 文件查看器与图片查看器
function bindViewerEvents() {
  $("#fileViewerClose").onclick = () => closeFileViewer(true);
  $("#fileViewerDownload").onclick = downloadViewerFile;
  const fileViewer = $("#fileViewer");
  bindDocPreviewPaging(fileViewer, () => !!viewerSource && !isShown("#imageViewer"));
  fileViewer.addEventListener("click", e => {
    if (e.target.closest("[data-viewer-download]")) return downloadViewerFile();
    if (e.target.closest("[data-viewer-open]")) return void openViewerWithSystem();
    if (e.target === fileViewer || e.target === $("#fileViewerStage")) closeFileViewer();
  });
  // 媒体的 error 不冒泡，在捕获阶段接：浏览器放不了这种编码，就别留一个转不动的播放器。
  // 桥接能用 ffmpeg 时会尝试给不兼容的封装换壳（见 server/video.js）；仍播不了可能是编码不兼容，或工具不可用、转封装未成。
  $("#fileViewerStage").addEventListener(
    "error",
    e => {
      if (!e.target.matches?.("audio, video")) return;
      e.target.closest(".file-viewer-media").outerHTML =
        `<div class="file-viewer-empty">${t(`此视频浏览器放不了，可交本机程序打开`)}<br>${VIEWER_OPEN_BUTTON}<button type="button" class="outline-btn" data-viewer-download>${t(`下载`)}</button></div>`;
    },
    true
  );
  $("#imageViewerClose").onclick = closeImageViewer;
  $("#imageViewerDownload").onclick = () => {
    if (imageViewerAttachmentId) void downloadAttachment(imageViewerAttachmentId);
    else if (imageViewerFile) downloadFile(imageViewerFile);
    else if (imageViewerRemote) {
      let name = imageViewerRemote.url.split(/[?#]/)[0].split("/").pop() || "";
      try {
        name = decodeURIComponent(name);
      } catch {}
      downloadHref(imageViewerRemote.src, name || imageViewerRemote.name || t("图片"));
    }
  };
  $("#imageViewerZoom").onclick = toggleImageViewerZoom;
  $("#imageViewerStage").addEventListener("click", e => {
    if (e.target === $("#imageViewerImage")) toggleImageViewerZoom();
    else if (e.target === $("#imageViewerStage")) closeImageViewer();
  });
  // 一组里：点小样换那幅，← → 翻上一幅、下一幅，到头不绕回
  $("#imageViewerStrip").addEventListener("click", e => {
    const mark = /** @type {HTMLElement|null} */ (e.target.closest("[data-strip-index]"));
    if (mark) void showImageAt(Number(mark.dataset.stripIndex));
  });
  document.addEventListener("keydown", e => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step || e.altKey || e.ctrlKey || e.metaKey || imageViewerSet.length < 2 || !isShown("#imageViewer")) return;
    e.preventDefault();
    const next = imageViewerIndex + step;
    if (next >= 0 && next < imageViewerSet.length) void showImageAt(next);
  });
}
function toggleImageViewerZoom() {
  setImageViewerZoom(!$("#imageViewerStage").classList.contains("actual"));
}
// 原图大小还是适应窗口；按钮写的是点了换成哪样
function setImageViewerZoom(actual) {
  $("#imageViewerStage").classList.toggle("actual", actual);
  $("#imageViewerZoom").textContent = actual ? t("适应") : t("原图");
  $("#imageViewerZoom").setAttribute("aria-pressed", String(actual));
}
let imageViewerAttachmentId = null,
  imageViewerReturnFocus = null;
function closeImageViewer() {
  const revision = ++imageViewerRevision;
  const viewer = $("#imageViewer");
  if (!isShown("#imageViewer")) return;
  hideWithFade(viewer);
  // 图随纸沉下去，淡完再撤
  setTimeout(() => {
    if (revision !== imageViewerRevision) return;
    $("#imageViewerImage").removeAttribute("src");
    $("#imageViewerStrip").innerHTML = "";
    setImageViewerZoom(false);
  }, 180);
  imageViewerSet = [];
  imageViewerAttachmentId = null;
  const target = imageViewerReturnFocus;
  imageViewerReturnFocus = null;
  returnFocus(target);
}
// 图片查看器盖在卷宗预览之上，先收它（连同底下的预览）；CSV、Markdown、PDF 这些预览单独开着时，Esc 也得关得掉
defineLayer({
  name: "image",
  rank: 130,
  open: () => isShown("#imageViewer"),
  close: () => {
    closeImageViewer();
    closeFileViewer();
  }
});
defineLayer({ name: "file", rank: 120, open: () => isShown("#fileViewer"), close: () => closeFileViewer() });
