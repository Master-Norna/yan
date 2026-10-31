// 言 · 文件 · 预览：卷宗与附件的悬浮预览（图看画、文看字、表看格、网页进沙箱、PDF、音视频）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 卷宗文件的悬浮预览：图看画、文看字、表看格、网页进沙箱、PDF 交给浏览器、音视频就地放；都不必先下载 ----------
// 预览器看两种来源：磁盘卷宗（走桥接取回）与对话里的附件（就在这个浏览器里）。同一种文件，不论从哪儿来，看法一样——
// 自己上传的 CSV、PDF、Markdown 点开就该是看，而不是把刚发出去的东西再下载一遍。
// viewerSource 记着当前看的是哪一件：{ path } 是卷宗，{ attachmentId } 是附件，{ skillDir, skillPath } 是技能带的一件（设置 → 技能里点开）；
// viewerPath 仍留给卷宗那一路的下载
let viewerPath = "",
  viewerRevision = 0,
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
function urlReader(url) {
  const fetched = async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(t("取回失败"));
    return response;
  };
  return {
    url: () => url,
    text: async () => decodeTextBytes(await (await fetched()).arrayBuffer()),
    blob: async () => (await fetched()).blob(),
    extracted: ""
  };
}
// 技能带的一件：桥接直取原件
function skillFileUrl(source, download = false) {
  return `${apiBase}/api/skills/raw?dir=${encodeURIComponent(source.skillDir)}&path=${encodeURIComponent(source.skillPath)}${download ? "&download=1" : ""}`;
}
async function viewerReader(source) {
  if (source.path) return urlReader(archiveFileUrl(source.path));
  if (source.skillDir) return urlReader(skillFileUrl(source));
  const url = `${apiBase}/api/files/raw?id=${encodeURIComponent(source.attachmentId)}`,
    head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (head?.ok) return urlReader(url);
  const file = await getAttachment(source.attachmentId);
  if (!file) throw Error(t("附件原件已找不到"));
  const blob = attachmentBlob(file);
  return {
    url: () => viewerBlobUrl(blob),
    text: async () => (file.kind === "text" ? String(file.data) : blob.text()),
    blob: async () => blob,
    dataUrl: file.kind === "text" ? "" : String(file.data),
    extracted: String(file.extractedText || "")
  };
}
/** @param {string|{path?:string, attachmentId?:string, skillDir?:string, skillPath?:string}} target 卷宗路径，或 { attachmentId }，或技能里的一件 */
async function openFileViewer(target, name = "", trigger = null) {
  const revision = ++viewerRevision;
  const source = typeof target === "string" ? { path: target } : target;
  const viewer = $("#fileViewer");
  if (!viewer) return;
  const title =
      name ||
      String(source.path || "")
        .split("/")
        .pop() ||
      t("附件"),
    kind = fileKind(title).view || "none";
  viewerPath = source.path || "";
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
    if (source?.path) await bridge("/api/archive/open", { root: archiveDir(), path: source.path }, AbortSignal.timeout(8000));
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
    const anchor = document.createElement("a");
    anchor.href = skillFileUrl(viewerSource, true);
    anchor.download = String(viewerSource.skillPath).split("/").pop() || "";
    anchor.click();
  } else if (viewerPath) downloadArchiveFile(viewerPath);
}
async function fileViewerBody(reader, name, kind, revision = viewerRevision) {
  if (kind === "image") return `<img class="file-viewer-image" src="${escapeHtml(reader.url())}" alt="${escapeHtml(name)}">`;
  // PDF 交给浏览器自带的阅读器；卷宗的响应带 CSP: sandbox，脚本不会以本站身份运行
  if (kind === "pdf") return `<iframe class="file-viewer-frame" src="${escapeHtml(reader.url())}" title="${escapeHtml(name)}"></iframe>`;
  // 音频摊成听音整页（放音不在这层浮层里，关了也不断，见 src/25-listen.js）；视频交给浏览器自带的播放器，编码认不得（如某些 mkv）时换成下载提示，见 bindViewerEvents
  if (kind === "audio") return listenPageHtml(listenTrackFrom(viewerSource, name, reader));
  if (kind === "video")
    return `<div class="file-viewer-media"><video controls preload="metadata" src="${escapeHtml(reader.url())}" title="${escapeHtml(name)}"></video></div>`;
  if (kind === "none")
    return `<div class="file-viewer-empty">${t(`此类文件无法在此预览`)}<br>${VIEWER_OPEN_BUTTON}<button type="button" class="outline-btn" data-viewer-download>${t(`下载`)}</button></div>`;
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
    const text = await reader.text(),
      split = fileExtension(name) === "tsv" ? "\t" : ",",
      rows = parseDelimited(text, split, 401),
      cells = rows.slice(0, 400);
    if (!cells.length) return `<div class="file-viewer-empty">${t(`空文件`)}</div>`;
    return `<div class="file-viewer-text file-viewer-fit"><table class="file-viewer-table"><thead><tr>${cells[0].map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${cells
      .slice(1)
      .map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>${rows.length > 400 ? `<p class="file-viewer-note">${t(`仅显示前 400 行`)}</p>` : ""}</div>`;
  }
  if (kind === "doc") {
    // 每回从原件现抽（按结构抽成 Markdown）；原件取不到时才用附件上传时抽下的那份。文中的图照抽出的路再从原件里取（见 withZipImages）
    let text = "",
      data = "";
    try {
      data = reader.dataUrl || (await readFile(await reader.blob(), "data"));
      text = trimExtractedText(await extractDocumentText(name, data));
    } catch {
      text = trimExtractedText(reader.extracted);
    }
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
        data
      );
    if (sort === "slides" && sections.length)
      return withZipImages(
        `<div class="file-viewer-slides">${note}${sections.map(part => `<div class="viewer-slide markdown">${renderMarkdown(part)}</div>`).join("")}</div>`,
        data
      );
    return withZipImages(`<div class="file-viewer-text markdown">${note}${renderMarkdown(text)}</div>`, data);
  }
  const text = await reader.text();
  if (kind === "markdown")
    return `<div class="file-viewer-text markdown">${rebaseMarkdownImages(renderMarkdown(text.slice(0, 200000)), viewerSource?.path || "")}</div>`;
  return `<div class="file-viewer-text"><pre class="file-viewer-code">${escapeHtml(text.slice(0, 200000))}</pre>${text.length > 200000 ? `<p class="file-viewer-note">${t(`仅显示前 20 万字`)}</p>` : ""}</div>`;
}
// CSV / TSV：引号里的换行仍属于同一个字段，显示上限按记录计。
// Markdown 里的相对图片（![](images/a.png)）：照这份文件所在的那一层去卷宗里取，与 VS Code 一样——不然渲染进言的页面，
// 相对地址落到言自己的根上。消毒时本地的图已摘了 src、原路记在 data-path（见 04-markdown 的钩子），从那里取回；
// 本机盘符不动，/ 开头的从卷宗根算。附件里的 Markdown 没有「所在的那一层」，不改
/** @param {string} html @param {string} path 这份 Markdown 在卷宗里的路径 */
function rebaseMarkdownImages(html, path) {
  if (!path || !html.includes("data-path")) return html;
  const box = document.createElement("template");
  box.innerHTML = html;
  for (const img of box.content.querySelectorAll("img[data-path]")) {
    const ref = img.getAttribute("data-path") || "";
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;
    img.setAttribute("src", archiveFileUrl(archiveRelative(ref.startsWith("/") ? "" : parentDir(path), ref)));
    img.removeAttribute("data-path");
    img.removeAttribute("data-file");
  }
  return box.innerHTML;
}
/** @param {string} base 卷宗里的一层（"" 即根） @param {string} ref 相对的路，可带 ./ ../ 与 %20 一类转义 */
function archiveRelative(base, ref) {
  let clean = ref.replace(/[?#].*$/, "").replace(/\\/g, "/");
  try {
    clean = decodeURIComponent(clean).replace(/\\/g, "/");
  } catch {}
  const parts = base ? base.split("/") : [];
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
function parseDelimited(text, split, limit = Infinity) {
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
  finish();
  return rows;
}
/** @param {boolean} [stop] 点的是 ×：摊着的若是正放的那一曲，一并停下；别的关法只收起，正放着的挂上顶栏接着放 */
function closeFileViewer(stop = false) {
  viewerRevision++;
  listenViewerClosed(stop);
  const target = viewerReturnFocus;
  viewerPath = "";
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
  viewerPath = "";
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
let imageViewerArchivePath = null,
  imageViewerArchiveRoot = "",
  imageViewerRevision = 0;
// 卷宗里的图；root 给了是别处目录里的（正文引的工作目录里的图），那里没有件数大小可报。
// paths 是同看的一组（卷宗此刻列着的图），看图框底下排成一条小样、左右翻
function openArchiveImage(path, trigger = null, root = archiveDir(), paths = [path]) {
  openImageSet(
    paths.map(item => ({ path: item, root })),
    Math.max(0, paths.indexOf(path)),
    trigger
  );
}
// 看图框一回看的一组：每件是附件 { id }、目录里的图 { path, root }，或点了取来的外链图 { src, name, url }；只一件时不出小样
let imageViewerSet = [],
  imageViewerIndex = 0;
/** @param {{ id?: string, path?: string, root?: string, src?: string, name?: string, url?: string }[]} items @param {number} index @param {Element|null} trigger */
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
            `<button type="button" data-strip-index="${i}"${item.path ? ` title="${escapeHtml(item.path.split("/").pop())}"` : ""}>${
              item.id
                ? `<img data-thumb="${escapeHtml(item.id)}" alt="">`
                : item.src
                  ? `<img src="${escapeHtml(item.src)}" alt="">`
                  : `<img src="${escapeHtml(archiveFileUrl(item.path, false, item.root))}" loading="lazy" decoding="async" alt="">`
            }</button>`
        )
        .join("")
    : "";
  if (many) void loadThumbnails(strip);
  return showImageAt(index, true);
}
// 摊开组里的第几件，先按窗口大小看；附件要先从库里取，取到时已换了别件就作罢
async function showImageAt(index, opening = false) {
  const item = imageViewerSet[index];
  if (!item) return;
  const revision = ++imageViewerRevision;
  let src, name, label;
  if (item.id) {
    let file;
    try {
      file = await getAttachment(item.id);
    } catch {
      if (revision === imageViewerRevision) toast(t("图片读取失败"));
      return;
    }
    if (revision !== imageViewerRevision) return;
    if (!file) return toast(t("图片原件已找不到"));
    if (file.kind !== "image") return openFileViewer({ attachmentId: item.id }, file.name, imageViewerReturnFocus?.el);
    [src, name, label] = [file.data, file.name, `${file.name || t("图片")} · ${formatFileSize(file.size)}`];
  } else if (item.src) {
    [src, name, label] = [item.src, item.name || "", `${item.name || t("图片")} · ${stageHost(item.url || "")}`];
  } else {
    const entry = item.root === archiveDir() ? (archiveEntries || []).find(file => file.path === item.path) : null;
    src = archiveFileUrl(item.path, false, item.root);
    name = entry?.name || "";
    label = entry ? `${entry.name} · ${formatFileSize(entry.size || 0)}` : item.path.split("/").pop();
  }
  imageViewerIndex = index;
  imageViewerAttachmentId = item.id || null;
  imageViewerArchivePath = item.path || null;
  imageViewerRemote = item.src ? { src: item.src, name: item.name || "", url: item.url || "" } : null;
  imageViewerArchiveRoot = item.root || "";
  $("#imageViewerName").textContent = label;
  const image = $("#imageViewerImage");
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
function downloadArchiveFile(path, root = archiveDir()) {
  const anchor = document.createElement("a");
  anchor.href = archiveFileUrl(path, true, root);
  anchor.download = path.split("/").pop() || t("卷宗");
  anchor.click();
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
  // 封装认不得的（扩展名写作 mp4 的 TS 之类），桥接已借环境里的 ffmpeg 换过壳（见 server/video.js）；到这里的是编码本身放不了，或没装「音视频」
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
    else if (imageViewerArchivePath) downloadArchiveFile(imageViewerArchivePath, imageViewerArchiveRoot);
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
