// 言 · 文件 · 预览：卷宗与附件的悬浮预览（图看画、文看字、表看格、网页进沙箱、PDF、音视频）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 卷宗文件的悬浮预览：图看画、文看字、表看格、网页进沙箱、PDF 交给浏览器、音视频就地放；都不必先下载 ----------
// 预览器看两种来源：磁盘卷宗（走桥接取回）与对话里的附件（就在这个浏览器里）。同一种文件，不论从哪儿来，看法一样——
// 自己上传的 CSV、PDF、Markdown 点开就该是看，而不是把刚发出去的东西再下载一遍。
// viewerSource 记着当前看的是哪一件：{ path } 是卷宗，{ attachmentId } 是附件；viewerPath 仍留给卷宗那一路的下载
let viewerPath = "",
  viewerSource = null,
  viewerReturnFocus = null,
  viewerObjectUrls = [];
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
    if (!response.ok) throw Error("取回失败");
    return response;
  };
  return {
    url: () => url,
    text: async () => decodeTextBytes(await (await fetched()).arrayBuffer()),
    blob: async () => (await fetched()).blob(),
    extracted: ""
  };
}
async function viewerReader(source) {
  if (source.path) return urlReader(archiveFileUrl(source.path));
  const url = `${apiBase}/api/files/raw?id=${encodeURIComponent(source.attachmentId)}`,
    head = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (head?.ok) return urlReader(url);
  const file = await getAttachment(source.attachmentId);
  if (!file) throw Error("附件原件已找不到");
  const blob = file.kind === "text" ? new Blob([file.data], { type: file.mime || "text/plain" }) : await (await fetch(file.data)).blob();
  return {
    url: () => viewerBlobUrl(blob),
    text: async () => (file.kind === "text" ? String(file.data) : blob.text()),
    blob: async () => blob,
    dataUrl: file.kind === "text" ? "" : String(file.data),
    extracted: String(file.extractedText || "")
  };
}
/** @param {string|{path?:string, attachmentId?:string}} target 卷宗路径，或 { attachmentId } */
async function openFileViewer(target, name = "", trigger = null) {
  const source = typeof target === "string" ? { path: target } : target;
  const viewer = $("#fileViewer");
  if (!viewer) return;
  const title =
      name ||
      String(source.path || "")
        .split("/")
        .pop() ||
      "附件",
    kind = fileKind(title).view || "none";
  viewerPath = source.path || "";
  viewerSource = source;
  viewerReturnFocus = trigger || document.activeElement;
  revokeViewerUrls();
  viewer.classList.remove("hidden");
  $("#fileViewerDownload").classList.remove("hidden");
  $("#fileViewerName").textContent = title;
  $("#fileViewerStage").innerHTML = `<div class="file-viewer-empty">正在取出…</div>`;
  $("#fileViewerClose").focus();
  try {
    const html = await fileViewerBody(await viewerReader(source), title, kind);
    if (viewerSource !== source) return;
    $("#fileViewerStage").innerHTML = html;
    renderEnhancements($("#fileViewerStage"));
  } catch (error) {
    if (viewerSource !== source) return;
    $("#fileViewerStage").innerHTML =
      `<div class="file-viewer-empty">未能预览：${escapeHtml(String(error.message || error).slice(0, 120))}<br><button type="button" class="outline-btn" data-viewer-download>下载查看</button></div>`;
  }
}
// 认不得、或只抽得出结构的文件：交给 Windows 的默认程序打开原件（卷宗与落了盘的附件都走桥接），不逐类去补预览
const VIEWER_OPEN_BUTTON = `<button type="button" class="outline-btn" data-viewer-open>以本机程序打开</button>`;
async function openViewerWithSystem() {
  const source = viewerSource;
  try {
    if (source?.path) await bridge("/api/archive/open", { root: archiveDir(), path: source.path }, AbortSignal.timeout(8000));
    else if (source?.attachmentId) await bridge("/api/files/open", { id: source.attachmentId }, AbortSignal.timeout(8000));
    else return;
    toast("已交给本机程序打开");
  } catch (error) {
    toast(`打开失败：${String(error.message || error).slice(0, 80)}`);
  }
}
// 预览器头上的「下载」：看的是卷宗就走桥接，是附件就从浏览器里取
function downloadViewerFile() {
  if (viewerSource?.attachmentId) void downloadAttachment(viewerSource.attachmentId);
  else if (viewerPath) downloadArchiveFile(viewerPath);
}
async function fileViewerBody(reader, name, kind) {
  if (kind === "image") return `<img class="file-viewer-image" src="${escapeHtml(reader.url())}" alt="${escapeHtml(name)}">`;
  // PDF 交给浏览器自带的阅读器；卷宗的响应带 CSP: sandbox，脚本不会以本站身份运行
  if (kind === "pdf") return `<iframe class="file-viewer-frame" src="${escapeHtml(reader.url())}" title="${escapeHtml(name)}"></iframe>`;
  // 音频摊成听音整页（放音不在这层浮层里，关了也不断，见 src/25-listen.js）；视频交给浏览器自带的播放器，编码认不得（如某些 mkv）时换成下载提示，见 bindViewerEvents
  if (kind === "audio") return listenPageHtml(listenTrackFrom(viewerSource, name, reader));
  if (kind === "video")
    return `<div class="file-viewer-media"><video controls preload="metadata" src="${escapeHtml(reader.url())}" title="${escapeHtml(name)}"></video></div>`;
  if (kind === "none")
    return `<div class="file-viewer-empty">此类文件无法在此预览<br>${VIEWER_OPEN_BUTTON}<button type="button" class="outline-btn" data-viewer-download>下载</button></div>`;
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
      const frame = $("#fileViewerStage iframe");
      if (!frame) return;
      frame.addEventListener("load", () => frame.contentWindow?.postMessage({ type: "yan-preview-render", id, html: source, theme }, "*"), {
        once: true
      });
      frame.src = `./preview.html#${id}`;
    }, 0);
    return `<iframe class="file-viewer-frame" sandbox="allow-scripts" title="隔离的网页预览"></iframe>`;
  }
  if (kind === "table") {
    const text = await reader.text(),
      rows = text.split(/\r?\n/).filter(Boolean).slice(0, 400),
      split = fileExtension(name) === "tsv" ? "\t" : ",";
    if (!rows.length) return `<div class="file-viewer-empty">空文件</div>`;
    const cells = rows.map(row => splitDelimited(row, split));
    return `<div class="file-viewer-text file-viewer-fit"><table class="file-viewer-table"><thead><tr>${cells[0].map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${cells
      .slice(1)
      .map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
      .join(
        ""
      )}</tbody></table>${text.split(/\r?\n/).filter(Boolean).length > 400 ? `<p class="file-viewer-note">仅显示前 400 行</p>` : ""}</div>`;
  }
  if (kind === "doc") {
    // 每回从原件现抽（按结构抽成 Markdown）；原件取不到时才用附件上传时抽下的那份
    let text = "";
    try {
      text = trimExtractedText(await extractDocumentText(name, reader.dataUrl || (await readFile(await reader.blob(), "data"))));
    } catch {
      text = trimExtractedText(reader.extracted);
    }
    if (!text)
      return `<div class="file-viewer-empty">未能抽出正文<br>${VIEWER_OPEN_BUTTON}<button type="button" class="outline-btn" data-viewer-download>下载</button></div>`;
    const note = `<p class="file-viewer-note">本机按结构抽出，不含原排版 · <button type="button" class="viewer-open-link" data-viewer-open>以本机程序打开</button></p>`,
      sort = fileKind(name).name,
      // 按「## 」分节：表格一张表一节，演示一页一节
      sections = text.split(/^(?=## )/m).filter(part => part.trim());
    if (sort === "sheet" && sections.length)
      return `<div class="file-viewer-text file-viewer-wide">${note}<div class="viewer-tabs">${sections
        .map(
          (part, i) =>
            `<button type="button" class="${i ? "" : "active"}" data-viewer-tab="${i}">${escapeHtml(part.match(/^## (.*)/)?.[1] || `工作表 ${i + 1}`)}</button>`
        )
        .join("")}</div>${sections
        .map(
          (part, i) =>
            `<div class="viewer-sheet markdown${i ? " hidden" : ""}" data-viewer-panel="${i}">${renderMarkdown(part.replace(/^## .*\n+/, ""))}</div>`
        )
        .join("")}</div>`;
    if (sort === "slides" && sections.length)
      return `<div class="file-viewer-slides">${note}${sections.map(part => `<div class="viewer-slide markdown">${renderMarkdown(part)}</div>`).join("")}</div>`;
    return `<div class="file-viewer-text markdown">${note}${renderMarkdown(text)}</div>`;
  }
  const text = await reader.text();
  if (kind === "markdown") return `<div class="file-viewer-text markdown">${renderMarkdown(text.slice(0, 200000))}</div>`;
  return `<div class="file-viewer-text"><pre class="file-viewer-code">${escapeHtml(text.slice(0, 200000))}</pre>${text.length > 200000 ? `<p class="file-viewer-note">仅显示前 20 万字</p>` : ""}</div>`;
}
// CSV 的一行：带引号的字段里可以有分隔符与转义的引号
function splitDelimited(row, split) {
  const out = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === split) {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}
/** @param {boolean} [stop] 点的是 ×：摊着的若是正放的那一曲，一并停下；别的关法只收起，正放着的挂上顶栏接着放 */
function closeFileViewer(stop = false) {
  listenViewerClosed(stop);
  const target = viewerReturnFocus;
  viewerPath = "";
  viewerSource = null;
  viewerReturnFocus = null;
  revokeViewerUrls();
  $("#fileViewer")?.classList.add("hidden");
  $("#fileViewerStage").innerHTML = "";
  // 预览里全屏着的作品随预览一起没了：页上的 work-mode 也得撤，不然对话区滚不动
  if (!document.querySelector(".work-expanded")) closeExpandedWork();
  if (target?.isConnected) target.focus();
}
// 不是一件文件、而是现成的一段内容（如一件文件在这一答里的改动）也摊在这层浮层里看：没有可下载的，下载键收起
function showInFileViewer(title, html, trigger = null) {
  viewerPath = "";
  viewerSource = null;
  viewerReturnFocus = trigger || document.activeElement;
  revokeViewerUrls();
  $("#fileViewer").classList.remove("hidden");
  $("#fileViewerDownload").classList.add("hidden");
  $("#fileViewerName").textContent = title;
  $("#fileViewerStage").innerHTML = html;
  $("#fileViewerClose").focus();
}
let imageViewerArchivePath = null,
  imageViewerRevision = 0;
function openArchiveImage(path, trigger = null) {
  imageViewerRevision++;
  const entry = (archiveEntries || []).find(file => file.path === path);
  imageViewerAttachmentId = null;
  imageViewerArchivePath = path;
  imageViewerReturnFocus = trigger || document.activeElement;
  $("#imageViewerName").textContent = `${entry?.name || path} · ${formatFileSize(entry?.size || 0)}`;
  const image = $("#imageViewerImage");
  image.src = archiveFileUrl(path);
  image.alt = entry?.name || "图片预览";
  $("#imageViewerStage").classList.remove("actual");
  $("#imageViewerZoom").textContent = "原图";
  $("#imageViewerZoom").setAttribute("aria-pressed", "false");
  $("#imageViewer").classList.remove("hidden");
  $("#imageViewerClose").focus();
}
function downloadArchiveFile(path, root = archiveDir()) {
  const anchor = document.createElement("a");
  anchor.href = archiveFileUrl(path, true, root);
  anchor.download = path.split("/").pop() || "卷宗";
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
        `<div class="file-viewer-empty">此视频浏览器放不了，可交本机程序打开<br>${VIEWER_OPEN_BUTTON}<button type="button" class="outline-btn" data-viewer-download>下载</button></div>`;
    },
    true
  );
  $("#imageViewerClose").onclick = closeImageViewer;
  $("#imageViewerDownload").onclick = () => {
    if (imageViewerAttachmentId) void downloadAttachment(imageViewerAttachmentId);
    else if (imageViewerArchivePath) downloadArchiveFile(imageViewerArchivePath);
  };
  $("#imageViewerZoom").onclick = toggleImageViewerZoom;
  $("#imageViewerStage").addEventListener("click", e => {
    if (e.target === $("#imageViewerImage")) toggleImageViewerZoom();
    else if (e.target === $("#imageViewerStage")) closeImageViewer();
  });
}
function toggleImageViewerZoom() {
  const stage = $("#imageViewerStage"),
    actual = !stage.classList.contains("actual");
  stage.classList.toggle("actual", actual);
  $("#imageViewerZoom").textContent = actual ? "适应" : "原图";
  $("#imageViewerZoom").setAttribute("aria-pressed", String(actual));
}
let imageViewerAttachmentId = null,
  imageViewerReturnFocus = null;
function closeImageViewer() {
  imageViewerRevision++;
  const viewer = $("#imageViewer");
  if (viewer.classList.contains("hidden")) return;
  viewer.classList.add("hidden");
  $("#imageViewerImage").removeAttribute("src");
  $("#imageViewerStage").classList.remove("actual");
  $("#imageViewerZoom").textContent = "原图";
  $("#imageViewerZoom").setAttribute("aria-pressed", "false");
  imageViewerAttachmentId = null;
  const target = imageViewerReturnFocus;
  imageViewerReturnFocus = null;
  if (target?.isConnected) target.focus();
}
async function openImageViewer(id, trigger = null) {
  const revision = ++imageViewerRevision;
  try {
    const file = await getAttachment(id);
    if (revision !== imageViewerRevision) return;
    if (!file) return toast("图片原件已找不到");
    if (file.kind !== "image") return openFileViewer({ attachmentId: id }, file.name, trigger);
    imageViewerAttachmentId = id;
    imageViewerArchivePath = null;
    imageViewerReturnFocus = trigger || document.activeElement;
    $("#imageViewerName").textContent = `${file.name || "图片"} · ${formatFileSize(file.size)}`;
    const image = $("#imageViewerImage");
    image.src = file.data;
    image.alt = file.name || "图片预览";
    $("#imageViewerStage").classList.remove("actual");
    $("#imageViewerZoom").textContent = "原图";
    $("#imageViewerZoom").setAttribute("aria-pressed", "false");
    $("#imageViewer").classList.remove("hidden");
    $("#imageViewerClose").focus();
  } catch {
    if (revision === imageViewerRevision) toast("图片读取失败");
  }
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
