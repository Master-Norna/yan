// 言 · 文件 · 接入：选取、拖入、粘贴的文件读成附件；附件原件的下载
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 附件的上限：单件（置于案上与收入卷宗同一道）；界面上的提示都从这里取数（见 limitLabel），改一处即可。
// 原件直传进存储目录、不经页面的字符串（见 bridgeUpload）；单件仍卡在 256 MB：桥接不在时暂存进浏览器、导出备份，都要整份读成 data: URL，
// 256 MB 编出来三百多 MB，再大就逼近浏览器的字符串上限。
// 能过页面整份进上下文的另有一道 INLINE_FILE_BYTES：超过它的文本不当文本读、没抽出正文的不整份送，交给模型的是本机原件路径（同压缩包）
const MB = 1024 * 1024;
const MAX_FILE_BYTES = 256 * MB;
const INLINE_FILE_BYTES = 32 * MB;
const limitLabel = bytes => (bytes >= 1024 * MB ? `${bytes / (1024 * MB)} GB` : `${Math.round(bytes / MB)} MB`);
const MAX_EXTRACTED_CHARS = 300000;
async function handleFiles(event) {
  await addFiles(event.target.files);
  event.target.value = "";
}
async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  if (view === "library") return addLibraryFiles(files);
  // 一件件读的工夫里人可能已换到别的对话：读好的仍归点选时那一段（见 placeAttachment）
  const key = draftKey();
  let count = pendingAttachments.length,
    added = 0;
  for (const file of files) {
    if (count >= 10) {
      toast(t("一次最多置入 10 件附件"));
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(t`${file.name} 超过 ${limitLabel(MAX_FILE_BYTES)}，未置入`);
      continue;
    }
    try {
      if (!placeAttachment(key, await ingestFile(file))) break;
      count += 1;
      added += 1;
    } catch {
      toast(t`${file.name} 读取失败`);
    }
  }
  persistDraft();
  renderAttachments();
  if (added) toast(t`已置入 ${added} 件附件`);
}
// 读好的一件放上案：案上（pendingAttachments）此刻若已换成别段的草稿，就记进原来那段的草稿里，回去时还在
function placeAttachment(key, file) {
  // 两批同时读（选取、拖入、卷宗置入）时，开头看到的数量与容量都可能已旧；落进目标草稿的这一刻再核一次。
  const attachments = draftKey() === key ? pendingAttachments : draftRecord(key).attachments;
  if (!canPlaceAttachment(file.size, attachments)) {
    void deleteAttachments([file.id]);
    return false;
  }
  if (draftKey() === key) {
    pendingAttachments.push(file);
    // 随即记进草稿：一次拖进好几件，读着后面的时候页面若重画（restoreDraft 照草稿摆案），读好的几件不至于丢
    persistDraft();
    return true;
  }
  const draft = draftRecord(key);
  store.drafts ||= {};
  store.drafts[key] = { ...draft, attachments: [...draft.attachments, file], updatedAt: now() };
  saveStoreSoon();
  return true;
}
// 图入库时就换成各家都收的样子：手机原图动辄五六 MB、上万像素，Claude 收图不过 5 MB、长边过八千即拒；
// 认得的格式只有 PNG、JPEG、GIF、WebP。大了的缩到长边 2048、换成 JPEG（带透明的 PNG 仍存 PNG），别的格式能解开的一并转。
// 解不开的（Edge 不认 HEIC）不当图，作文件留着，抽取那栏说明原因
const IMAGE_SENDABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]),
  IMAGE_MAX_BYTES = 3.5 * MB,
  IMAGE_MAX_SIDE = 2048;
/** @param {File} file @returns {Promise<File|null>} 原样可用给原件，换过的给新件，解不开给 null */
async function sendableImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return IMAGE_SENDABLE.has(file.type) ? file : null;
  const long = Math.max(bitmap.width, bitmap.height);
  if (IMAGE_SENDABLE.has(file.type) && file.size <= IMAGE_MAX_BYTES && long <= IMAGE_MAX_SIDE) {
    bitmap.close();
    return file;
  }
  // GIF 缩了就不动了，不大的照原样留着
  if (file.type === "image/gif" && file.size <= IMAGE_MAX_BYTES) {
    bitmap.close();
    return file;
  }
  const scale = Math.min(1, IMAGE_MAX_SIDE / long),
    canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  let blob = await canvas.convertToBlob({ type, quality: 0.88 });
  if (blob.size > IMAGE_MAX_BYTES) blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  const name =
    blob.type === file.type
      ? file.name
      : `${String(file.name || t("图片")).replace(/\.[^.]+$/, "")}.${blob.type === "image/png" ? "png" : "jpg"}`;
  return new File([blob], name, { type: blob.type, lastModified: file.lastModified });
}
async function ingestFile(original) {
  let file = original,
    unreadable = "";
  if (original.type.startsWith("image/") || /\.(heic|heif|avif|bmp|tiff?)$/i.test(original.name)) {
    const sendable = await sendableImage(original);
    if (sendable) file = sendable;
    else unreadable = t("浏览器解不开这种图片（HEIC 之类），没法转成模型收的格式；可先另存成 JPG 再置入");
  }
  /** @type {Attachment["kind"]} */
  const kind =
      file.type.startsWith("image/") && !unreadable
        ? "image"
        : file.size <= INLINE_FILE_BYTES && (isTextFile(file) || (fileKind(file.name) === OTHER_FILE && (await sniffText(file))))
          ? "text"
          : "file",
    id = uid();
  // 文本读成正文（GBK 的也转成 UTF-8 存）；别的不读进页面，原件径直交给桥接（见 putAttachment）
  const text = kind === "text" ? await readFile(file, "text") : "";
  const metadata = {
    id,
    kind,
    name: file.name || t("未命名文件"),
    mime: file.type || "application/octet-stream",
    size: file.size,
    modifiedAt: file.lastModified || Date.now()
  };
  let extractedText = "",
    extractionError = unreadable;
  if (kind === "file" && !unreadable)
    try {
      extractedText = await extractDocumentText(metadata.name, file);
    } catch (error) {
      extractionError = String(error.message || error).slice(0, 200);
    }
  if (kind === "text") await putAttachment({ ...metadata, data: text, extractedText, extractionError });
  else await putAttachment({ ...metadata, extractedText, extractionError }, file);
  // 顺手记下文字量的估算：上下文计数与「是否整份塞进提示」都按它算，不再拿文件字节数粗估（压缩过的 docx 字节数与字数没什么关系）
  const words = kind === "text" ? text : extractedText;
  return { ...metadata, extracted: !!extractedText, ...(words ? { tokens: estimateText(words) } : {}) };
}

async function downloadAttachment(id) {
  // 原件在存储目录里：照同源地址直接下（桥接按原名回附件头），不把整份读进页面编成 data: URL。
  // 只暂存在浏览器里的（落盘时桥接断着，还没推进目录）才从表里取
  const onDisk = await bridge("/api/files/has", { ids: [id] }, AbortSignal.timeout(8000))
    .then(data => data.has?.includes(id))
    .catch(() => false);
  if (onDisk) {
    const anchor = document.createElement("a");
    anchor.href = `${apiBase}/api/files/raw?id=${encodeURIComponent(id)}&download=1`;
    anchor.download = "";
    anchor.click();
    return;
  }
  try {
    const file = await getAttachment(id);
    if (!file) return toast(t("附件原件已找不到"));
    const anchor = document.createElement("a"),
      objectUrl = URL.createObjectURL(attachmentBlob(file));
    anchor.href = objectUrl;
    anchor.download = file.name || t("附件");
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    toast(t("附件读取失败"));
  }
}
