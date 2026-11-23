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
/** @param {string} url @param {{ extracted?: string | (() => Promise<string>) }} [options] extracted：原件取不到时能退回的那份抽出来的正文 */
function urlReader(url, { extracted = "" } = {}) {
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
    extracted
  };
}
// 技能带的一件：桥接直取原件
function skillFileUrl(source, download = false) {
  return `/api/skills/raw?dir=${encodeURIComponent(source.skillDir)}&path=${encodeURIComponent(source.skillPath)}${download ? "&download=1" : ""}`;
}
async function viewerReader(source) {
  if (source.file) return urlReader(localFileUrl(source.file));
  if (source.skillDir) return urlReader(skillFileUrl(source));
  const url = `/api/files/raw?id=${encodeURIComponent(source.attachmentId)}`,
    head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (head?.ok)
    // 落了盘的附件另有上传时抽下的正文：预览时重抽不成（PDF 的库没载入、文件太大）就退回那一份，
    // 不至于明明抽过却写着「未能抽出正文」
    return urlReader(url, {
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
    if (!cells.length) return `<div class="file-viewer-empty">${t(`空文件`)}</div>`;
    return `<div class="file-viewer-text file-viewer-fit"><table class="file-viewer-table"><thead><tr>${cells[0].map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${cells
      .slice(1)
      .map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>${note ? `<p class="file-viewer-note">${note}</p>` : ""}</div>`;
  }
  if (kind === "doc") {
    // 每回从原件现抽（按结构抽成 Markdown）；原件取不到、或这回没抽出来（PDF 的库没载入、文件太大），
    // 退回上传时抽下的那一份（附件有，卷宗里的没有）。文中的图照抽出的路再从原件里取（见 withZipImages）。
    // 原件照 Blob 读成字节直接用，不再经 data: URL 转一趟 base64（大文档编一遍解一遍，纯属白耗）
    let text = "",
      bytes = null;
    try {
      bytes = new Uint8Array(await (await reader.blob()).arrayBuffer());
      text = trimExtractedText(await extractDocumentText(name, bytes));
    } catch {}
    if (!text) text = trimExtractedText(typeof reader.extracted === "function" ? await reader.extracted() : reader.extracted).trim();
    if (!text)
      return `<div class="file-viewer-empty">${t(`未能抽出正文`)}<br>${VIEWER_OPEN_BUTTON}<button type="button" class="outline-btn" data-viewer-download>${t(`下载`)}</button></div>`;
    const note = `<p class="file-viewer-note">${t(`本机按结构抽出，不含原排版 ·`)} <button type="button" class="viewer-open-link" data-viewer-open>${t(`以本机程序打开`)}</button></p>`,
      sort = fileKind(name).name,
      // 按「## 」分节：表格一张表一节，演示一页一节
      sections = text.split(/^(?=## )/m).filter(part => part.trim());
    if (sort === "sheet" && sections.length)
      return withZipImages(
        `<div class="file-viewer-text file-viewer-wide">${note}<div class="viewer-tabs">${sections
          .map(
            (part, i) =>
              `<button type="button" class="${i ? "" : "active"}" data-viewer-tab="${i}">${escapeHtml(part.match(/^## (.*)/)?.[1] || t`工作表 ${i + 1}`)}</button>`
          )
          .join("")}</div>${sections
          .map(
            (part, i) =>
              `<div class="viewer-sheet markdown${i ? " hidden" : ""}" data-viewer-panel="${i}">${renderMarkdown(part.replace(/^## .*\n+/, ""))}</div>`
          )
          .join("")}</div>`,
        bytes
      );
    if (sort === "slides" && sections.length)
      return withZipImages(
        `<div class="file-viewer-slides">${note}${sections.map(part => `<div class="viewer-slide markdown">${renderMarkdown(part)}</div>`).join("")}</div>`,
        bytes
      );
    return withZipImages(`<div class="file-viewer-text markdown">${note}${renderMarkdown(text)}</div>`, bytes);
  }
  // 只要开头这一段：几百 MB 的日志不整份取回来再切
  const text = await reader.text(VIEWER_TEXT_CHARS),
    // 截了要说一声：不然读的人当预览的末尾就是文件的末尾（原文件不动，下载、以本机程序打开都在）
    cut = text.length > VIEWER_TEXT_CHARS ? `<p class="file-viewer-note">${t("仅显示前 20 万字")}</p>` : "";
  if (kind === "markdown") return `<div class="file-viewer-text markdown">${renderMarkdown(text.slice(0, VIEWER_TEXT_CHARS))}${cut}</div>`;
  return `<div class="file-viewer-text"><pre class="file-viewer-code">${escapeHtml(text.slice(0, VIEWER_TEXT_CHARS))}</pre>${cut}</div>`;
}
// 像不像一段字：没有 NUL，坏字节与控制字符都少。压缩包、可执行文件开头一段就满是这些
/** @param {string} text */
function looksLikeText(text) {
  if (!text || text.includes("\0")) return false;
  let bad = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) bad += 1;
    if (bad > 8) return false;
  }
  return true;
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
/** 顶栏那一枚印：预览一律「览」，意的卡片换它自己的石青「意」（全页仍只一枚印） @param {string} [glyph] */
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
  $("#fileViewer").addEventListener("click", e => {
    if (e.target.closest("[data-viewer-download]")) return downloadViewerFile();
    if (e.target.closest("[data-viewer-open]")) return void openViewerWithSystem();
    // 表格的页签：一张表一页
    const tab = e.target.closest("[data-viewer-tab]");
    if (tab) {
      const stage = $("#fileViewerStage");
      stage.querySelectorAll("[data-viewer-tab]").forEach(button => button.classList.toggle("active", button === tab));
      stage
        .querySelectorAll("[data-viewer-panel]")
        .forEach(panel => panel.classList.toggle("hidden", panel.dataset.viewerPanel !== tab.dataset.viewerTab));
      return;
    }
    if (e.target === $("#fileViewer") || e.target === $("#fileViewerStage")) closeFileViewer();
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
