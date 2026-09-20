// 言 · 文件接入、卷宗（磁盘目录 / 浏览器内）、文档抽取、下载
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
async function handleFiles(event) {
  await addFiles(event.target.files);
  event.target.value = "";
}
function isTextFile(file) {
  const extension = String(file.name || "")
      .split(".")
      .pop()
      .toLowerCase(),
    mime = String(file.type || "").toLowerCase();
  return (
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/x-javascript",
      "application/typescript",
      "application/yaml",
      "application/x-yaml",
      "application/csv"
    ].includes(mime) ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml") ||
    [
      "txt",
      "md",
      "markdown",
      "json",
      "jsonl",
      "csv",
      "tsv",
      "xml",
      "yaml",
      "yml",
      "js",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "jsx",
      "html",
      "htm",
      "css",
      "scss",
      "less",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "c",
      "h",
      "cpp",
      "hpp",
      "cs",
      "php",
      "sh",
      "ps1",
      "sql",
      "toml",
      "ini",
      "log"
    ].includes(extension)
  );
}
async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (view === "library") return addLibraryFiles(files);
  let total = pendingAttachments.reduce((sum, file) => sum + Number(file.size || 0), 0),
    attachmentUsage = usedAttachmentBytes(),
    added = 0;
  for (const file of files) {
    if (pendingAttachments.length >= 10) {
      toast("一次最多置入 10 件附件");
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} 超过 ${limitLabel(MAX_FILE_BYTES)}，未置入`);
      continue;
    }
    if (total + file.size > MAX_PENDING_BYTES) {
      toast(`本次附件合计不超过 ${limitLabel(MAX_PENDING_BYTES)}`);
      break;
    }
    if (attachmentUsage + file.size > MAX_ATTACHMENTS_BYTES) {
      toast(`卷宗与附件原件合计已达 ${limitLabel(MAX_ATTACHMENTS_BYTES)} 上限，请先清理`);
      break;
    }
    try {
      pendingAttachments.push(await ingestFile(file));
      total += file.size;
      attachmentUsage += file.size;
      added += 1;
    } catch {
      toast(`${file.name} 读取失败`);
    }
  }
  persistDraft();
  renderAttachments();
  if (added) toast(`已置入 ${added} 件附件`);
}
async function ingestFile(file) {
  /** @type {Attachment["kind"]} */
  const kind = file.type.startsWith("image/") ? "image" : isTextFile(file) ? "text" : "file",
    id = uid();
  const data = await readFile(file, kind === "text" ? "text" : "data");
  const metadata = {
    id,
    kind,
    name: file.name || "未命名文件",
    mime: file.type || "application/octet-stream",
    size: file.size,
    modifiedAt: file.lastModified || Date.now()
  };
  let extractedText = "",
    extractionError = "";
  if (kind === "file")
    try {
      extractedText = await extractDocumentText(metadata.name, data);
    } catch (error) {
      extractionError = String(error.message || error).slice(0, 200);
    }
  await putAttachment({ ...metadata, data, extractedText, extractionError });
  // 顺手记下文字量的估算：上下文计数与「是否整份塞进提示」都按它算，不再拿文件字节数粗估（压缩过的 docx 字节数与字数没什么关系）
  const text = kind === "text" ? String(data || "") : extractedText;
  return { ...metadata, extracted: !!extractedText, ...(text ? { tokens: estimateText(text) } : {}) };
}

// ---------- 卷宗：跨对话保存的文件库 ----------
// 桥接在线时卷宗是磁盘上的一个目录（bootstrap.work.archive）：拖进来的文件落盘，没绑目录的对话里模型写出的文件也在这里，页面即目录的视图；
// 直连没桥接时退回浏览器内的版本：原件存在 IndexedDB，元数据记录在 store.library。两边都有时，浏览器内的旧件另列一组，可一键落盘
let archiveEntries = null,
  archiveScratch = null,
  archiveLoading = null;
function archiveOnline() {
  return apiBase !== null && !!archiveDir();
}
function archiveFileUrl(path, download = false) {
  return `${apiBase}/api/archive/file?root=${encodeURIComponent(archiveDir())}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}
async function refreshArchive() {
  if (!archiveOnline()) return;
  if (archiveLoading) return archiveLoading;
  archiveLoading = bridge("/api/archive/list", { root: archiveDir() }, AbortSignal.timeout(8000))
    .then(data => {
      archiveEntries = data.entries || [];
      archiveScratch = data.scratch || null;
    })
    .catch(error => {
      if (archiveEntries === null) toast(`卷宗目录不可用：${String(error.message || error).slice(0, 80)}`);
    })
    .finally(() => {
      archiveLoading = null;
      renderLibraryCount();
      if (view === "library") renderLibrary();
      // 答末的成品条：卷宗里删掉的那几件标成「已移出卷宗」
      syncDeliverables();
    });
  return archiveLoading;
}
function archiveKind(name) {
  const extension = String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(extension)) return "image";
  return isTextFile({ name, type: "" }) ? "text" : "file";
}
function openLibrary() {
  closeSidePanel();
  persistDraft();
  rememberScrollPosition();
  view = "library";
  render();
  void refreshArchive();
  if (isMobile()) toggleSidebar(true);
  setTimeout(() => $("#librarySearch").focus(), 0);
}
function closeLibrary() {
  view = "chat";
  render();
}
function libraryTotal() {
  return (archiveOnline() ? (archiveEntries || []).length : 0) + store.library.length;
}
function renderLibraryCount() {
  const total = libraryTotal();
  $("#libraryCount").textContent = total ? String(total) : "";
}
function libraryEntry(file) {
  return {
    id: file.id,
    kind: file.kind,
    name: file.name,
    mime: file.mime,
    size: file.size,
    modifiedAt: file.modifiedAt,
    extracted: !!file.extracted,
    savedAt: now()
  };
}
function libraryCardHtml(file, disk) {
  const kind = disk ? archiveKind(file.name) : file.kind,
    key = disk ? `data-library-disk="${escapeHtml(file.path)}"` : `data-library-item="${escapeHtml(file.id)}"`,
    thumb =
      kind !== "image"
        ? ""
        : disk
          ? `<img class="library-thumb" src="${escapeHtml(archiveFileUrl(file.path))}" alt="">`
          : `<img class="library-thumb" data-thumb="${escapeHtml(file.id)}" alt="">`,
    note = disk
      ? `${formatFileSize(file.size)} · ${escapeHtml(formatDay(file.modifiedAt))}${file.path.includes("/") ? ` · ${escapeHtml(file.path.slice(0, file.path.lastIndexOf("/")))}` : ""}`
      : `${formatFileSize(file.size)} · 收于 ${escapeHtml(formatDay(file.savedAt))}${file.kind === "file" && !file.extracted ? " · 未能提取正文" : ""}`;
  return `<div class="library-card${disk && kind === "image" ? " has-thumb" : ""}" ${key}><div class="library-preview"${kind === "image" ? ` role="button" tabindex="0" ${disk ? `data-open-disk-image="${escapeHtml(file.path)}"` : `data-open-image="${escapeHtml(file.id)}"`} title="查看 ${escapeHtml(file.name)}"` : ""}>${thumb}<span class="library-glyph" aria-hidden="true">${kindGlyph(kind)}</span><span class="attachment-type">${escapeHtml(fileTypeLabel(file))}</span></div><div class="library-body"><strong title="${escapeHtml(disk ? file.path : file.name)}">${escapeHtml(file.name)}</strong><small>${note}</small></div><div class="library-actions">${disk || previewKind(file.name) !== "none" ? `<button data-library-action="view" title="在此预览，不必下载">预览</button>` : ""}<button data-library-action="download">下载</button><button data-library-action="remove">${disk ? "删除" : "移出"}</button></div></div>`;
}
function renderLibrary() {
  const query = libraryQuery.trim().toLowerCase(),
    disk = archiveOnline(),
    matches = (name, kind) => (libraryKind === "all" || kind === libraryKind) && (!query || String(name).toLowerCase().includes(query));
  const diskItems = disk ? (archiveEntries || []).filter(file => matches(file.name, archiveKind(file.name))) : [],
    items = store.library.filter(file => matches(file.name, file.kind));
  const total = libraryTotal(),
    bytes = [...(disk ? archiveEntries || [] : []), ...store.library].reduce((sum, file) => sum + Number(file.size || 0), 0);
  $("#libraryCountText").textContent = total ? `现存 ${total} 件 · ${formatFileSize(bytes)}` : "";
  const lead = $("#libraryLead");
  if (lead)
    lead.innerHTML = disk
      ? `常用的文件收于此处；置于案上，便随下一问送出。卷宗即本机的一个目录：<code title="${escapeHtml(archiveDir())}">${escapeHtml(archiveDir())}</code>（可在设置里更换）；未绑目录的对话里，模型写出的文件亦落于此。${
          archiveScratch?.count
            ? `<span class="library-scratch">草稿 ${archiveScratch.count} 处 · ${formatFileSize(archiveScratch.bytes)}<button type="button" id="libraryCleanScratch" title="清理模型留下的脚本与中间文件（${escapeHtml(bootstrap.work?.scratch || ".草稿")}）">清理</button></span>`
            : ""
        }`
      : "常用的文件收于此处；置于案上，便随下一问送出。原件只存于此浏览器；运行 start.cmd 后，卷宗便落于本机目录。";
  $("#libraryCleanScratch")?.addEventListener("click", () => void cleanScratch(null));
  document
    .querySelectorAll("[data-library-kind]")
    .forEach(button => button.classList.toggle("active", button.dataset.libraryKind === libraryKind));
  const legacy =
    disk && store.library.length
      ? `<div class="library-section"><span>浏览器内的旧件 · ${store.library.length}</span><button type="button" id="libraryMigrate" class="outline-btn">全部落盘</button></div>`
      : "";
  $("#libraryGrid").innerHTML =
    diskItems.length || items.length
      ? `${diskItems.map(file => libraryCardHtml(file, true)).join("")}${legacy}${items.map(file => libraryCardHtml(file, false)).join("")}`
      : `<div class="library-empty">${total ? "没有匹配的卷宗" : disk && archiveEntries === null ? "正在翻开卷宗…" : "卷宗尚空<br>拖入文件即收入"}</div>`;
  $("#libraryMigrate")?.addEventListener("click", () => void migrateLibraryToArchive());
  void loadThumbnails($("#libraryGrid"));
}
// 文本以 UTF-8 编成 data: URL；二进制附件本就是 data: URL
function dataUrlFromText(text, mime = "text/plain") {
  const bytes = new TextEncoder().encode(String(text || ""));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(binary)}`;
}
async function putArchiveFile(name, data) {
  return bridge("/api/archive/put", { root: archiveDir(), name, data }, AbortSignal.timeout(120000));
}
// 清草稿：给对话则只清它那一处（删对话时顺手），不给则整个 .草稿 目录（卷宗页上的「清理」）
/** @param {Conversation} conversation */
async function cleanScratch(conversation) {
  if (!archiveOnline() || (conversation && isWork(conversation))) return;
  if (
    !conversation &&
    !(await askConfirm({ title: "清理全部草稿？", body: "模型在卷宗里留下的脚本与中间文件将被删除，成品不受影响。", ok: "清理" }))
  )
    return;
  try {
    await bridge(
      "/api/archive/clean",
      { root: archiveDir(), id: conversation ? scratchRel(conversation).split("/").pop() : "" },
      AbortSignal.timeout(30000)
    );
    if (!conversation) {
      toast("草稿已清理");
      await refreshArchive();
    }
  } catch (error) {
    if (!conversation) toast(`清理失败：${String(error.message || error).slice(0, 80)}`);
  }
}
async function addLibraryFiles(fileList) {
  const files = Array.from(fileList || []);
  let added = 0;
  if (archiveOnline()) {
    for (const file of files) {
      if (file.size > MAX_ARCHIVE_FILE_BYTES) {
        toast(`${file.name} 超过 ${limitLabel(MAX_ARCHIVE_FILE_BYTES)}，未收入`);
        continue;
      }
      try {
        await putArchiveFile(file.name, await readFile(file, "data"));
        added += 1;
      } catch (error) {
        toast(`${file.name} 收入失败：${String(error.message || error).slice(0, 60)}`);
      }
    }
    await refreshArchive();
    if (added) toast(`已收入 ${added} 件`);
    return;
  }
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} 超过 ${limitLabel(MAX_FILE_BYTES)}，未收入`);
      continue;
    }
    if (usedAttachmentBytes() + file.size > MAX_ATTACHMENTS_BYTES) {
      toast(`卷宗与附件原件合计已达 ${limitLabel(MAX_ATTACHMENTS_BYTES)} 上限，请先清理`);
      continue;
    }
    try {
      store.library.unshift(libraryEntry(await ingestFile(file)));
      added += 1;
    } catch {
      toast(`${file.name} 读取失败`);
    }
  }
  saveStore();
  if (view === "library") renderLibrary();
  renderLibraryCount();
  if (added) toast(`已收入 ${added} 件`);
}
// 附件上的「藏」：桥接在线时原件落盘到卷宗目录，否则记进浏览器内的卷宗
async function saveToLibrary(id) {
  const metadata =
    pendingAttachments.find(file => file.id === id) ||
    store.conversations
      .flatMap(allMessages)
      .flatMap(m => m.attachments || [])
      .find(file => file.id === id);
  const file = metadata && (await getAttachment(id));
  if (!file) return toast("附件原件已不在此浏览器中");
  if (archiveOnline()) {
    try {
      const saved = await putArchiveFile(metadata.name, file.kind === "text" ? dataUrlFromText(file.data, file.mime) : file.data);
      void refreshArchive();
      toast(`${saved.name} 已收入卷宗`);
    } catch (error) {
      toast(`收入失败：${String(error.message || error).slice(0, 80)}`);
    }
    return;
  }
  if (inLibrary(id)) return toast("已在卷宗中");
  store.library.unshift(libraryEntry(metadata));
  saveStore();
  renderLibraryCount();
  toast(`${metadata.name} 已收入卷宗`);
}
// 浏览器内的旧件逐件落盘；落盘成功的从浏览器内移出（原件若没被对话引用则一并删去）
async function migrateLibraryToArchive() {
  if (!archiveOnline()) return;
  let moved = 0;
  for (const item of [...store.library]) {
    const file = await getAttachment(item.id);
    if (!file) continue;
    try {
      await putArchiveFile(item.name, file.kind === "text" ? dataUrlFromText(file.data, file.mime) : file.data);
      store.library = store.library.filter(entry => entry.id !== item.id);
      if (!isReferenced(item.id)) void deleteAttachment(item.id);
      moved += 1;
    } catch (error) {
      toast(`${item.name} 落盘失败：${String(error.message || error).slice(0, 60)}`);
      break;
    }
  }
  saveStore();
  await refreshArchive();
  toast(moved ? `已落盘 ${moved} 件` : "没有可落盘的文件");
}
async function removeFromLibrary(id) {
  store.library = store.library.filter(file => file.id !== id);
  saveStore();
  if (!isReferenced(id)) void deleteAttachment(id);
  renderLibrary();
  renderLibraryCount();
}
async function removeArchiveFile(path) {
  if (!(await askConfirm({ title: "删除这件卷宗？", body: `将从本机目录删除「${path}」，无法撤销。`, ok: "删除" }))) return;
  try {
    await bridge("/api/archive/remove", { root: archiveDir(), path }, AbortSignal.timeout(8000));
    toast("已删除");
  } catch (error) {
    toast(`删除失败：${String(error.message || error).slice(0, 80)}`);
  }
  await refreshArchive();
}
function canPlaceAttachment(size) {
  if (currentConversation()?.ended) return toast("此对话已收尾，请翻页后再置入"), false;
  if (pendingAttachments.length >= 10) return toast("一次最多置入 10 件附件"), false;
  if (size > MAX_FILE_BYTES) return toast(`单个附件不超过 ${limitLabel(MAX_FILE_BYTES)}`), false;
  const total = pendingAttachments.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (total + Number(size || 0) > MAX_PENDING_BYTES) return toast(`本次附件合计不超过 ${limitLabel(MAX_PENDING_BYTES)}`), false;
  return true;
}
function placeFromLibrary(id) {
  const item = store.library.find(file => file.id === id);
  if (!item) return;
  if (pendingAttachments.some(file => file.id === id)) return toast("此件已在案上");
  if (!canPlaceAttachment(item.size)) return;
  const { savedAt, ...metadata } = item;
  pendingAttachments.push(metadata);
  persistDraft();
  closeLibrary();
  toast(`${item.name} 已置于案上`);
  setTimeout(() => (currentConversation() ? $("#chatInput") : $("#welcomeInput")).focus(), 0);
}
// 磁盘上的卷宗置于案上：取回原件，按普通附件收进浏览器（图片、可提取的文档照常处理）
async function placeFromArchive(path) {
  let entry = (archiveEntries || []).find(file => file.path === path);
  if (!entry) {
    await refreshArchive();
    entry = (archiveEntries || []).find(file => file.path === path);
  }
  if (!entry) return toast("卷宗里已没有这件");
  if (!canPlaceAttachment(entry.size)) return;
  try {
    const response = await fetch(archiveFileUrl(path), { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error("取回失败");
    const blob = await response.blob(),
      file = new File([blob], entry.name, { type: blob.type || "", lastModified: Date.parse(entry.modifiedAt) || Date.now() });
    pendingAttachments.push(await ingestFile(file));
    persistDraft();
    closeLibrary();
    toast(`${entry.name} 已置于案上`);
    setTimeout(() => (currentConversation() ? $("#chatInput") : $("#welcomeInput")).focus(), 0);
  } catch (error) {
    toast(`置入失败：${String(error.message || error).slice(0, 80)}`);
  }
}
// ---------- 卷宗文件的悬浮预览：图看画、文看字、表看格、网页进沙箱、PDF 交给浏览器；都不必先下载 ----------
const PREVIEW_IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]),
  PREVIEW_DOC = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp"]);
function fileExtension(name) {
  return String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
}
function previewKind(name) {
  const extension = fileExtension(name);
  if (PREVIEW_IMAGE.has(extension)) return "image";
  if (extension === "svg") return "svg";
  if (extension === "pdf") return "pdf";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "csv" || extension === "tsv") return "table";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (PREVIEW_DOC.has(extension)) return "doc";
  if (isTextFile({ name, type: "" })) return "text";
  return "none";
}
// 预览器看两种来源：磁盘卷宗（走桥接取回）与对话里的附件（就在这个浏览器里）。同一种文件，不论从哪儿来，看法一样——
// 自己上传的 CSV、PDF、Markdown 点开就该是看，而不是把刚发出去的东西再下载一遍。
// viewerSource 记着当前看的是哪一件：{ path } 是卷宗，{ attachmentId } 是附件；viewerPath 仍留给卷宗那一路的下载
let viewerPath = "",
  viewerSource = null,
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
/** 取一件东西的三种读法：直链（图与 PDF 交给浏览器）、正文、字节。卷宗的直链是桥接地址；附件的是就地造的 blob 地址 */
async function viewerReader(source) {
  if (source.path) {
    const url = archiveFileUrl(source.path),
      fetched = async () => {
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error("取回失败");
        return response;
      };
    return { url: () => url, text: async () => (await fetched()).text(), blob: async () => (await fetched()).blob(), extracted: "" };
  }
  const file = await getAttachment(source.attachmentId);
  if (!file) throw Error("附件原件已不在此浏览器中");
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
async function openFileViewer(target, name = "") {
  const source = typeof target === "string" ? { path: target } : target;
  const viewer = $("#fileViewer");
  if (!viewer) return;
  if (source.path && !archiveOnline()) return toast("预览需要本机桥接");
  const title =
      name ||
      String(source.path || "")
        .split("/")
        .pop() ||
      "附件",
    kind = previewKind(title);
  viewerPath = source.path || "";
  viewerSource = source;
  revokeViewerUrls();
  viewer.classList.remove("hidden");
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
// 预览器头上的「下载」：看的是卷宗就走桥接，是附件就从浏览器里取
function downloadViewerFile() {
  if (viewerSource?.attachmentId) void downloadAttachment(viewerSource.attachmentId);
  else if (viewerPath) downloadArchiveFile(viewerPath);
}
async function fileViewerBody(reader, name, kind) {
  if (kind === "image" || kind === "svg")
    return `<img class="file-viewer-image" src="${escapeHtml(reader.url())}" alt="${escapeHtml(name)}">`;
  // PDF 交给浏览器自带的阅读器；卷宗的响应带 CSP: sandbox，脚本不会以本站身份运行
  if (kind === "pdf") return `<iframe class="file-viewer-frame" src="${escapeHtml(reader.url())}" title="${escapeHtml(name)}"></iframe>`;
  if (kind === "none")
    return `<div class="file-viewer-empty">此类文件无法在此预览，请下载后以本机程序打开<br><button type="button" class="outline-btn" data-viewer-download>下载</button></div>`;
  // 网页放进与页内 ```html 同一个隔离沙箱：不能读本站的存储，也不能联网
  if (kind === "html") {
    const source = await reader.text(),
      id = `app${uid().replace(/[^a-z0-9]/gi, "")}`;
    setTimeout(() => {
      const frame = $("#fileViewerStage iframe");
      if (!frame) return;
      frame.addEventListener("load", () => frame.contentWindow?.postMessage({ type: "yan-preview-render", id, html: source }, "*"), {
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
    // 附件上传时若已在本机抽过正文，直接用；否则从字节里抽
    const text = trimExtractedText(
      reader.extracted || (await extractDocumentText(name, reader.dataUrl || (await readFile(await reader.blob(), "data"))))
    );
    return text
      ? `<div class="file-viewer-text file-viewer-extracted"><p class="file-viewer-note">本机提取的正文，不含排版</p>${text
          .split(/\n{2,}/)
          .map(block => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
          .join("")}</div>`
      : `<div class="file-viewer-empty">未能提取正文，请下载查看<br><button type="button" class="outline-btn" data-viewer-download>下载</button></div>`;
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
function closeFileViewer() {
  viewerPath = "";
  viewerSource = null;
  revokeViewerUrls();
  $("#fileViewer")?.classList.add("hidden");
  $("#fileViewerStage").innerHTML = "";
}
let imageViewerArchivePath = null;
function openArchiveImage(path, trigger = null) {
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
function downloadArchiveFile(path) {
  const anchor = document.createElement("a");
  anchor.href = archiveFileUrl(path, true);
  anchor.download = path.split("/").pop() || "卷宗";
  anchor.click();
}

function readFile(file, mode) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    mode === "data" ? reader.readAsDataURL(file) : reader.readAsText(file);
  });
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
    ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[文档内容过长，已在本机截取前 ${MAX_EXTRACTED_CHARS} 个字符]`
    : text;
}
async function extractDocumentText(name, data) {
  const extension = String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (extension === "pdf") return trimExtractedText(await extractPdfText(data));
  if (["docx", "pptx", "xlsx", "odt", "ods", "odp"].includes(extension))
    return trimExtractedText(await extractZipDocumentText(extension, bytesFromDataUrl(data)));
  return "";
}
async function extractPdfText(data) {
  if (!(await ensureLib("pdf"))) return "";
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  const loading = window.pdfjsLib.getDocument({
      data: bytesFromDataUrl(data),
      cMapUrl: "./vendor/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "./vendor/standard_fonts/"
    }),
    document = await loading.promise,
    pages = [];
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
      pages.push(`第 ${pageNumber} 页\n${output.join("\n")}`);
      if (pages.join("\n\n").length >= MAX_EXTRACTED_CHARS) break;
    }
  } finally {
    await document.destroy();
  }
  return pages.join("\n\n");
}
async function unzipSelected(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder(),
    minimum = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset--)
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  if (eocd < 0) throw Error("文档压缩结构无效");
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
        entries.set(name, decoder.decode(output));
        extractedBytes += output.length;
      }
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function parseXml(value) {
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (document.querySelector("parsererror")) throw Error("文档 XML 无效");
  return document;
}
function paragraphsFromXml(value) {
  const document = parseXml(value),
    paragraphs = [...document.getElementsByTagNameNS("*", "p")];
  if (!paragraphs.length) return document.documentElement.textContent || "";
  return paragraphs
    .map(node => [...node.getElementsByTagNameNS("*", "t")].map(text => text.textContent).join("") || node.textContent)
    .filter(Boolean)
    .join("\n");
}
async function extractZipDocumentText(extension, bytes) {
  if (extension === "docx") {
    const entries = await unzipSelected(bytes, name => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(name));
    return [...entries.entries()]
      .sort()
      .map(([, xml]) => paragraphsFromXml(xml))
      .join("\n\n");
  }
  if (extension === "pptx") {
    const entries = await unzipSelected(bytes, name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    return [...entries.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([name, xml], index) => `第 ${index + 1} 页\n${paragraphsFromXml(xml)}`)
      .join("\n\n");
  }
  if (extension === "xlsx") {
    const entries = await unzipSelected(bytes, name => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name)),
      sharedXml = entries.get("xl/sharedStrings.xml"),
      shared = sharedXml
        ? [...parseXml(sharedXml).getElementsByTagNameNS("*", "si")].map(node =>
            [...node.getElementsByTagNameNS("*", "t")].map(t => t.textContent).join("")
          )
        : [];
    return [...entries.entries()]
      .filter(([name]) => /\/worksheets\//.test(name))
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([name, xml], index) => {
        const document = parseXml(xml),
          rows = [...document.getElementsByTagNameNS("*", "row")].map(row =>
            [...row.getElementsByTagNameNS("*", "c")]
              .map(cell => {
                const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent || cell.textContent || "";
                return cell.getAttribute("t") === "s" ? (shared[Number(value)] ?? value) : value;
              })
              .join("\t")
          );
        return `工作表 ${index + 1}\n${rows.join("\n")}`;
      })
      .join("\n\n");
  }
  const entries = await unzipSelected(bytes, name => name === "content.xml");
  return entries.get("content.xml") ? paragraphsFromXml(entries.get("content.xml")) : "";
}

async function downloadAttachment(id) {
  try {
    const file = await getAttachment(id);
    if (!file) return toast("附件原件已不在此浏览器中");
    const anchor = document.createElement("a");
    let objectUrl = "";
    if (file.kind === "text") {
      objectUrl = URL.createObjectURL(new Blob([file.data], { type: file.mime || "text/plain" }));
      anchor.href = objectUrl;
    } else anchor.href = file.data;
    anchor.download = file.name || "附件";
    anchor.click();
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    toast("附件读取失败");
  }
}
// 只有本轮要回答的那条用户消息携带附件原件；更早的消息改为文本摘要，避免每轮重发图片与长文
