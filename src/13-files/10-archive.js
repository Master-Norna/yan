// 言 · 文件 · 卷宗：跨对话保存的文件库——列表、件图、夹，收入、置入、改名与移动
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
let libraryQuery = "",
  libraryKind = "all";
// ---------- 卷宗：跨对话保存的文件库 ----------
// 卷宗是存储根里的一个目录（bootstrap.work.archive）：拖进来的文件落盘，没绑目录的对话里模型写出的文件也在这里，页面即目录的视图。
let archiveEntries = null,
  archiveDirs = [],
  archiveScratch = null,
  archiveLoading = null,
  /** @type {Promise<void> | null} 排在正取着的那一趟后面的下一趟 */
  archiveQueued = null,
  // 卷宗页此刻站在哪一层（相对卷宗根，"" 即根）：只列这一层的夹与件，拖进来的文件也落在这一层
  libraryDir = "",
  // 正在就地改名的那一项（文件或夹的路径）；空即没有
  libraryRenaming = "";
// 卷宗里谁动过的件与夹：路径 → 何时、谁。谁空着是人在页面上收入、改名、挪动的，是对话 id 的是那段对话里的工具写的（生图、写文件、下载）。
// 答末认成品照的是开工前后卷宗的差：作答途中人收进来的、别的对话同时写出的也在差里，得凭这份剔掉
/** @type {Map<string, { at: number, by: string }>} */
const archiveWrites = new Map();
function noteArchiveWrite(path, by = "") {
  if (path) archiveWrites.set(path, { at: Date.now(), by });
}
// 工具在这段对话的落脚处写了件：言的落脚处就是卷宗，记下是这段对话写的（行写在自己的目录里，不碰卷宗的账）
function noteToolWrite(conversation, path) {
  if (!isWork(conversation)) noteArchiveWrite(path, conversation.id);
}
/** 这件（或它所在的夹）是不是 since 之后别人放进来的：人，或 by 以外的对话 */
function archiveWrittenByOther(path, since, by) {
  for (const [own, write] of archiveWrites)
    if (write.at >= since && write.by !== by && (path === own || path.startsWith(`${own}/`))) return true;
  return false;
}
const ARCHIVE_DRAG = "application/x-yan-archive";
function parentDir(path) {
  const at = String(path).lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}
function archiveFileUrl(path, download = false, root = archiveDir()) {
  return `${apiBase}/api/archive/file?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}
// 正文链接里的本地路落在哪：相对路相对这段对话的落脚处（绑了目录是它，没绑是卷宗）；绝对路在落脚处之内的折成相对，
// 之外的以它所在那层为根。sandbox:/、/mnt/… 这类不是本机的路，返回 null
function localLinkTarget(raw) {
  let text = String(raw || "")
    .trim()
    .replace(/[?#].*$/, "");
  try {
    text = decodeURIComponent(text);
  } catch {}
  text = text.replace(/^file:\/*/i, "").replace(/\\/g, "/");
  const root = workRoot(currentConversation());
  if (/^[a-z]:\//i.test(text)) {
    const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
    if (base && text.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return { root, path: text.slice(base.length + 1) };
    const cut = text.lastIndexOf("/");
    return { root: text.slice(0, cut), path: text.slice(cut + 1) };
  }
  if (/^[a-z][\w+.-]*:|^\//i.test(text)) return null;
  return { root, path: text.replace(/^(?:\.\/)+/, "") };
}
// 先问一声在不在：直接下一个不存在的件，浏览器只会报一行「下载失败」
async function archiveFileExists({ root, path }) {
  const control = new AbortController();
  try {
    const response = await fetch(archiveFileUrl(path, false, root), { signal: control.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    control.abort();
  }
}
async function refreshArchive() {
  // 正取着的那一趟可能早于刚才的改动（新建夹、改名、收入）：复用它就拿回改动前的列表，重画时冲掉新夹与改名框。
  // 排一趟在它后面再取，几处同时要的并成这一趟
  if (archiveLoading)
    return (archiveQueued ||= archiveLoading.then(() => {
      archiveQueued = null;
      return refreshArchive();
    }));
  archiveLoading = bridge("/api/archive/list", { root: archiveDir() }, AbortSignal.timeout(8000))
    .then(data => {
      archiveEntries = data.entries || [];
      archiveDirs = data.dirs || [];
      archiveScratch = data.scratch || null;
      // 站着的那一层在别处被删了：退回根
      if (libraryDir && !archiveDirs.some(dir => dir.path === libraryDir)) libraryDir = "";
    })
    .catch(error => {
      if (archiveEntries === null) toast(t`卷宗目录不可用：${String(error.message || error).slice(0, 80)}`);
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

// ---------- 件图：每一件画成一张右上折角的小纸，纸面上的记号分出是什么；夹与分组是一只布面小函 ----------
// 记号借项目里现成的专色（码 花青、表 石绿、文书 朱、演示 泥金、网页 青绿、音 黛、影 胭脂），纸面淡染一层：
// 先按颜色分大类，再看形状。见 设计稿/17-卷宗包边与件图（落选：一律墨色——列表里十来像素，文、码、文书分不开）
// 纸面 16×20，记号画在 3.5–13 × 7–17 之间
const FIGURE_MARKS = {
  text: `<path class="m" d="M3.8 8.3H12.5M3.8 10.8H12.5M3.8 13.3H12.5M3.8 15.8H9"/>`,
  code: `<path class="m" d="M3.8 8.3H8.5M5.8 10.8H12.3M5.8 13.3H10.5M3.8 15.8H6.8"/>`,
  table: `<path class="m" d="M3.5 7.5H12.8V16.5H3.5ZM3.5 10.5H12.8M3.5 13.5H12.8M7.2 7.5V16.5"/>`,
  doc: `<path class="m bold" d="M3.8 8.2H9.5"/><path class="m" d="M3.8 11H12.5M3.8 13.4H12.5M3.8 15.8H10.5"/>`,
  slides: `<path class="m" d="M3.3 8.2H12.8V14.2H3.3Z"/><path class="m" d="M6 16.4H10.2"/>`,
  html: `<path class="m" d="M3.3 7.5H12.8V16.8H3.3ZM3.3 9.6H12.8"/><path class="m" d="M5 12H11M5 14.4H9"/>`,
  audio: `<path class="m" d="M4 11.2V13.2M6 9.2V15.2M8.1 10.4V14M10.2 8.4V16M12.2 10.8V13.6"/>`,
  video: `<path class="f" d="M6.4 9.4L10.4 12.2L6.4 15ZM3 8h1.2v1.2H3zM3 10.9h1.2v1.2H3zM3 13.8h1.2v1.2H3zM12.1 8h1.2v1.2h-1.2zM12.1 10.9h1.2v1.2h-1.2zM12.1 13.8h1.2v1.2h-1.2z"/>`,
  zip: `<path class="m" d="M8.2 1.2V3M8.2 4.4V6.2M8.2 7.6V9.4M7 10.6H9.4V14.4H7Z"/>`
};
/** 一件的小图：图片就是它自己的缩略，别的按类画记号 */
function fileFigure(name, path = "") {
  const figure = fileKind(name).figure;
  if (figure === "image" && path)
    return `<span class="fi fi-thumb" aria-hidden="true"><img src="${escapeHtml(archiveFileUrl(path))}" alt="" loading="lazy"></span>`;
  return `<svg class="fi" data-figure="${figure}" viewBox="0 0 16 20" aria-hidden="true"><path class="body" d="M1 .5H11L15.5 5V19.5H1Z"/><path class="fold" d="M11 .5V5H15.5Z"/>${FIGURE_MARKS[figure] || ""}</svg>`;
}
function caseFigure() {
  return `<svg class="fi" viewBox="0 0 16 20" aria-hidden="true"><rect class="case" x="1" y=".5" width="14.5" height="19"/><rect class="slip" x="4" y="3" width="4" height="11.5"/></svg>`;
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
  return (archiveEntries || []).length;
}
function renderLibraryCount() {
  const total = libraryTotal();
  $("#libraryCount").textContent = total ? String(total) : "";
}
// 名目一格：平时是名字（平铺查找时下注所在的那一层），改名时换成一个输入框
function libraryNameCell(item, where = "") {
  if (libraryRenaming === item.path)
    return `<span class="strip-name"><input class="strip-rename" value="${escapeHtml(item.name)}" maxlength="200" spellcheck="false" autocomplete="off" aria-label="${t(`新名称`)}"></span>`;
  return `<span class="strip-name"><strong title="${escapeHtml(item.path)}">${escapeHtml(item.name)}</strong>${where ? `<small>${escapeHtml(where)}</small>` : ""}</span>`;
}
function libraryRowHtml(file, showDir = true) {
  const path = escapeHtml(file.path),
    renaming = libraryRenaming === file.path;
  return `<div class="strip file" data-library-disk="${path}" data-library-item="${path}" draggable="${!renaming}" tabindex="0"><span>${fileFigure(file.name, file.path)}</span>${libraryNameCell(
    file,
    showDir ? parentDir(file.path) : ""
  )}<span>${formatFileSize(file.size)}</span><span class="strip-date"><span class="strip-when">${escapeHtml(formatDay(file.modifiedAt))}</span><span class="strip-acts"><button type="button" data-library-action="view">${t(`预览`)}</button><button type="button" data-library-action="download">${t(`下载`)}</button><button type="button" data-library-action="rename">${t(`改名`)}</button><button type="button" class="danger" data-library-action="remove">${t(`删除`)}</button></span></span></div>`;
}
// 一个夹：里头共几件（连同更深的层）、有几个子夹、最近一件的日子
function libraryFolderHtml(dir) {
  const inside = (archiveEntries || []).filter(file => file.path.startsWith(`${dir.path}/`)),
    subs = archiveDirs.filter(other => parentDir(other.path) === dir.path).length,
    latest = inside.reduce((last, file) => (file.modifiedAt > last ? file.modifiedAt : last), ""),
    note = inside.length || subs ? [t`${inside.length} 件`, subs ? t`${subs} 夹` : ""].filter(Boolean).join(" · ") : t("空"),
    path = escapeHtml(dir.path),
    renaming = libraryRenaming === dir.path;
  return `<div class="strip dir" role="button" tabindex="0" data-library-dir="${path}" data-library-item="${path}" draggable="${!renaming}" title="${t`打开 ${escapeHtml(dir.name)}`}"><span>${caseFigure()}</span>${libraryNameCell(dir)}<span class="strip-note">${note}</span><span class="strip-date"><span class="strip-when">${latest ? escapeHtml(formatDay(latest)) : ""}</span><span class="strip-acts"><button type="button" data-library-action="rename">${t(`改名`)}</button><button type="button" class="danger" data-library-action="remove">${t(`删除`)}</button></span></span></div>`;
}
// 路径：卷宗 › 课程 › 深度学习。点哪一级回哪一级；各级也接得住拖来的条子（挪回上一层）
function renderLibraryCrumbs(show) {
  const crumbs = $("#libraryCrumbs");
  crumbs.classList.toggle("hidden", !show);
  if (!show) return (crumbs.innerHTML = "");
  if (!libraryDir) return (crumbs.innerHTML = `<span class="here">${t(`卷宗`)}</span>`);
  const parts = libraryDir.split("/");
  crumbs.innerHTML = `<button type="button" data-library-dir="">${t(`卷宗`)}</button>${parts
    .map((part, index) =>
      index === parts.length - 1
        ? `<span class="sep" aria-hidden="true">›</span><span class="here">${escapeHtml(part)}</span>`
        : `<span class="sep" aria-hidden="true">›</span><button type="button" data-library-dir="${escapeHtml(parts.slice(0, index + 1).join("/"))}">${escapeHtml(part)}</button>`
    )
    .join("")}`;
}
function enterLibraryDir(dir) {
  libraryDir = dir;
  libraryRenaming = "";
  renderLibrary();
  $("#library").scrollTop = 0;
}
// 重画卷宗时改名框还在写：把写到一半的字与选区带过去（后台刷新卷宗不该冲掉它）
let libraryRepainting = false;
function renderLibrary() {
  const query = libraryQuery.trim().toLowerCase(),
    matches = (name, kind) => (libraryKind === "all" || kind === libraryKind) && (!query || String(name).toLowerCase().includes(query)),
    // 逐层看；一旦查找或按类筛选，就跨各层平铺，名字下注它所在的那一层
    browsing = !query && libraryKind === "all";
  const diskItems = browsing
      ? (archiveEntries || []).filter(file => parentDir(file.path) === libraryDir)
      : (archiveEntries || []).filter(file => matches(file.name, fileKind(file.name).group)),
    folders = browsing
      ? archiveDirs.filter(dir => parentDir(dir.path) === libraryDir).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      : [];
  renderLibraryCrumbs(browsing);
  const total = libraryTotal(),
    bytes = (archiveEntries || []).reduce((sum, file) => sum + Number(file.size || 0), 0);
  $("#libraryCountText").textContent = total ? t`现存 ${total} 件 · ${formatFileSize(bytes)}` : "";
  $("#libraryLead").innerHTML = `<span title="${escapeHtml(archiveDir())}">${escapeHtml(archiveDir())}</span>${
    archiveScratch?.count
      ? `<span class="library-scratch">${t`草稿 ${archiveScratch.count} 处 · ${formatFileSize(archiveScratch.bytes)}`}<button type="button" id="libraryCleanScratch" title="${t`清理模型留下的脚本与中间文件（${escapeHtml(bootstrap.work?.scratch || ".草稿")}）`}">${t(`清理`)}</button></span>`
      : ""
  }`;
  $("#libraryCleanScratch")?.addEventListener("click", () => void cleanScratch(null));
  document
    .querySelectorAll("[data-library-kind]")
    .forEach(button => button.classList.toggle("active", button.dataset.libraryKind === libraryKind));
  // 只接回正改着的那一件的字：上一件改完失焦、桥接还没回话时它的输入框还在页上，紧接着点了另一件的改名，不能把上一件的新名带过去
  const draft = /** @type {HTMLInputElement|null} */ ($("#libraryGrid .strip-rename")),
    kept = draft?.closest("[data-library-item]")?.getAttribute("data-library-item") === libraryRenaming && {
      value: draft.value,
      start: draft.selectionStart,
      end: draft.selectionEnd,
      focused: document.activeElement === draft
    };
  // 簿头「名目」左边一枚 ‹ 回上一层（在根上不显）；它也接得住拖来的条子
  const back =
    browsing && libraryDir
      ? `<button type="button" class="strip-back" data-library-dir="${escapeHtml(parentDir(libraryDir))}" title="${t(`回上一层`)}" aria-label="${t(`回上一层`)}">‹</button>`
      : "";
  libraryRepainting = true;
  $("#libraryGrid").innerHTML =
    folders.length || diskItems.length
      ? `<div class="strip-cols"><span>${back}</span><span>${t(`名目`)}</span><span>${t(`大小`)}</span><span>${t(`日期`)}</span></div>${folders.map(libraryFolderHtml).join("")}${diskItems
          .map(file => libraryRowHtml(file, !browsing))
          .join("")}`
      : `${back ? `<div class="strip-cols"><span>${back}</span></div>` : ""}<div class="library-empty">${
          browsing && libraryDir
            ? t("此夹尚空") + "<br>" + t("拖入文件即收于此夹")
            : total
              ? t("没有匹配的卷宗")
              : archiveEntries === null
                ? t("正在翻开卷宗…")
                : t("卷宗尚空") + "<br>" + t("拖入文件即收入")
        }</div>`;
  libraryRepainting = false;
  const field = /** @type {HTMLInputElement|null} */ ($("#libraryGrid .strip-rename"));
  if (!field) return;
  if (kept) {
    field.value = kept.value;
    if (kept.focused) {
      field.focus();
      field.setSelectionRange(kept.start, kept.end);
    }
  } else {
    // 刚起的改名：选中名字里扩展名之前的那段
    field.focus();
    const dot = field.value.lastIndexOf(".");
    field.setSelectionRange(0, dot > 0 && !archiveDirs.some(dir => dir.path === libraryRenaming) ? dot : field.value.length);
  }
}
function startLibraryRename(path) {
  libraryRenaming = path;
  renderLibrary();
}
// 改名落定：名字没变就只收起输入框；变了交给桥接（同一层已有同名则报错，不悄悄换名）
async function commitLibraryRename(value) {
  const path = libraryRenaming;
  libraryRenaming = "";
  const name = String(value || "").trim();
  if (!path || !name || name === path.split("/").pop()) return renderLibrary();
  try {
    const moved = await bridge("/api/archive/move", { root: archiveDir(), path, name }, AbortSignal.timeout(20000));
    noteArchiveWrite(moved.path);
    rebaseDeliverables(path, moved.path);
  } catch (error) {
    toast(t`改名失败：${String(error.message || error).slice(0, 80)}`);
  }
  await refreshArchive();
}
function cancelLibraryRename() {
  libraryRenaming = "";
  renderLibrary();
}
// 新建夹：落在此刻这一层，建好即就地起名。正在查找或筛选时先收起，不然新夹不在眼前
async function newArchiveFolder() {
  try {
    const made = await bridge("/api/archive/mkdir", { root: archiveDir(), dir: libraryDir, name: t("新建夹") }, AbortSignal.timeout(8000));
    libraryQuery = "";
    libraryKind = "all";
    /** @type {HTMLInputElement} */ ($("#librarySearch")).value = "";
    libraryRenaming = made.path;
    await refreshArchive();
  } catch (error) {
    toast(t`新建失败：${String(error.message || error).slice(0, 80)}`);
  }
}
/** dir：落进卷宗的哪一层，缺省为根（导出、附件上的「藏」都落在根上；卷宗页上拖入的落在此刻所在的那一层） @param {string} name @param {Blob} body 原件 */
async function putArchiveFile(name, body, dir = "", root = archiveDir()) {
  const saved = await bridgeUpload("/api/archive/put", { root, name, dir }, body, AbortSignal.timeout(120000));
  noteArchiveWrite(saved.path);
  return saved;
}
// 答末成品条记的是路径：件挪了、改了名，或它所在的夹挪了、改了名，条子跟着改，不然就成了「已移出卷宗」
function rebaseDeliverables(from, to) {
  if (from === to) return;
  for (const c of store.conversations)
    for (const message of allMessages(c))
      for (const file of message.deliverables || [])
        if (file.path === from || file.path.startsWith(`${from}/`)) {
          file.path = to + file.path.slice(from.length);
          file.name = file.path.split("/").pop();
          markDirty(c.id);
        }
  saveStoreSoon();
}
// 条子拖到夹上、或拖回路径里的上一级：挪进那一层（件与夹一样）；那一层有同名的就另取名
async function moveArchiveItem(path, dir) {
  if (parentDir(path) === dir || dir === path) return;
  if (dir.startsWith(`${path}/`)) return toast(t("夹不能移入其自身"));
  try {
    const moved = await bridge("/api/archive/move", { root: archiveDir(), path, dir }, AbortSignal.timeout(20000)),
      renamed = moved.name !== path.split("/").pop();
    noteArchiveWrite(moved.path);
    rebaseDeliverables(path, moved.path);
    toast(t`已移入「${dir ? dir.split("/").pop() : t("卷宗")}」${renamed ? t`，同名已有，改作 ${moved.name}` : ""}`);
  } catch (error) {
    toast(t`移动失败：${String(error.message || error).slice(0, 80)}`);
  }
  await refreshArchive();
}
// 清草稿：给对话则只清它那一处（删对话时顺手），不给则整个 .草稿 目录（卷宗页上的「清理」）
/** @param {Conversation} conversation */
async function cleanScratch(conversation) {
  if (conversation && isWork(conversation)) return;
  if (
    !conversation &&
    !(await askConfirm({ title: t("清理全部草稿？"), body: t("模型在卷宗里留下的脚本与中间文件将被删除，成品不受影响。"), ok: t("清理") }))
  )
    return;
  try {
    await bridge(
      "/api/archive/clean",
      { root: archiveDir(), id: conversation ? scratchRel(conversation).split("/").pop() : "" },
      AbortSignal.timeout(30000)
    );
    if (!conversation) {
      toast(t("草稿已清理"));
      await refreshArchive();
    }
  } catch (error) {
    if (!conversation) toast(t`清理失败：${String(error.message || error).slice(0, 80)}`);
  }
}
async function addLibraryFiles(fileList, dir = libraryDir) {
  await storeLibraryFiles(Array.from(fileList || []).map(file => ({ file, dir })));
}
/** @param {{ file: File, dir: string }[]} items @param {number} [folders] 一并建了几个夹（只为最后那句报数） */
async function storeLibraryFiles(items, folders = 0, root = archiveDir()) {
  let added = 0;
  for (const { file, dir } of items) {
    if (file.size > MAX_FILE_BYTES) {
      toast(t`${file.name} 超过 ${limitLabel(MAX_FILE_BYTES)}，未收入`);
      continue;
    }
    try {
      await putArchiveFile(file.name, file, dir, root);
      added += 1;
    } catch (error) {
      toast(t`${file.name} 收入失败：${String(error.message || error).slice(0, 60)}`);
    }
  }
  await refreshArchive();
  if (folders) toast(t`已收入 ${folders} 个夹、${added} 件`);
  else if (added) toast(t`已收入 ${added} 件`);
}
// ---------- 拖进文件夹 ----------
// 浏览器交来的 files 里，文件夹只是一个读不出内容的空条目：得在 drop 当下从 items 取出条目（过了这一刻就取不到了），再一层层往下走
/** @param {DataTransfer} data @returns {FileSystemEntry[]} */
function droppedEntries(data) {
  return Array.from(data.items || [])
    .map(item => (item.kind === "file" ? item.webkitGetAsEntry?.() : null))
    .filter(entry => !!entry);
}
/** @param {FileSystemDirectoryEntry} entry @returns {Promise<FileSystemEntry[]>} 一次只给一批（Chromium 一百条），读到空为止 */
async function folderChildren(entry) {
  const reader = entry.createReader(),
    all = [];
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
  }
}
/** @param {FileSystemFileEntry} entry @returns {Promise<File>} */
const entryFile = entry => new Promise((resolve, reject) => entry.file(resolve, reject));
// 收进卷宗：夹照原样建（同名的另取名，与文件一样不覆盖），文件落进各自的夹。点开头的（.git、.DS_Store）跳过——卷宗里它们本就是藏着的
/** @param {FileSystemEntry[]} entries */
async function addLibraryEntries(entries) {
  // 一批拖入固定落点；枚举目录、读取文件期间，人可以继续翻卷宗或更换存储位置。
  const root = archiveDir(),
    targetDir = libraryDir;
  /** @type {{ file: File, dir: string }[]} */
  const items = [];
  let folders = 0;
  const walk = async (/** @type {FileSystemEntry} */ entry, /** @type {string} */ dir) => {
    if (entry.name.startsWith(".")) return;
    if (entry.isFile) return void items.push({ file: await entryFile(/** @type {FileSystemFileEntry} */ (entry)), dir });
    const made = await bridge("/api/archive/mkdir", { root, dir, name: entry.name }, AbortSignal.timeout(20000));
    folders += 1;
    for (const child of await folderChildren(/** @type {FileSystemDirectoryEntry} */ (entry))) await walk(child, made.path);
  };
  try {
    for (const entry of entries) await walk(entry, targetDir);
  } catch (error) {
    toast(t`文件夹未能收入：${String(/** @type {any} */ (error).message || error).slice(0, 80)}`);
  }
  await storeLibraryFiles(items, folders, root);
}
// 附件上的「藏」：原件落进卷宗目录
async function saveToLibrary(id) {
  const metadata =
    pendingAttachments.find(file => file.id === id) ||
    store.conversations
      .flatMap(allMessages)
      .flatMap(m => m.attachments || [])
      .find(file => file.id === id);
  const body = metadata && (await attachmentBody(id));
  if (!body) return toast(t("附件原件已找不到"));
  try {
    const saved = await putArchiveFile(metadata.name, body);
    void refreshArchive();
    toast(t`${saved.name} 已收入卷宗`);
  } catch (error) {
    toast(t`收入失败：${String(error.message || error).slice(0, 80)}`);
  }
}
// 删一项：夹连同里头的一并删，确认时说清有多少
async function removeArchiveItem(path) {
  const dir = archiveDirs.find(item => item.path === path);
  let ask = { title: t("删除这件卷宗？"), body: t`将从本机目录删除「${path}」，无法撤销。`, ok: t("删除") };
  if (dir) {
    const files = (archiveEntries || []).filter(file => file.path.startsWith(`${path}/`)).length,
      subs = archiveDirs.filter(item => item.path.startsWith(`${path}/`)).length;
    ask = {
      title: t`删除夹「${dir.name}」？`,
      body:
        files || subs
          ? t`连同其中 ${files} 件${subs ? t`、${subs} 夹` : ""}，将从本机目录删除，无法撤销。`
          : t("将从本机目录删除这个空夹。"),
      ok: t("删除")
    };
  }
  if (!(await askConfirm(ask))) return;
  try {
    await bridge("/api/archive/remove", { root: archiveDir(), path }, AbortSignal.timeout(20000));
    toast(t("已删除"));
  } catch (error) {
    toast(t`删除失败：${String(error.message || error).slice(0, 80)}`);
  }
  await refreshArchive();
}
function canPlaceAttachment(size, attachments = pendingAttachments) {
  if (attachments.length >= 10) return toast(t("一次最多置入 10 件附件")), false;
  if (size > MAX_FILE_BYTES) return toast(t`单个附件不超过 ${limitLabel(MAX_FILE_BYTES)}`), false;
  return true;
}
// 磁盘上的卷宗置于案上：取回原件，按普通附件收进浏览器（图片、可提取的文档照常处理）
async function placeFromArchive(path) {
  let entry = (archiveEntries || []).find(file => file.path === path);
  if (!entry) {
    await refreshArchive();
    entry = (archiveEntries || []).find(file => file.path === path);
  }
  if (!entry) return toast(t("卷宗里已没有这件"));
  if (!canPlaceAttachment(entry.size)) return;
  const key = draftKey();
  try {
    const response = await fetch(archiveFileUrl(path), { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(t("取回失败"));
    const blob = await response.blob(),
      file = new File([blob], entry.name, { type: blob.type || "", lastModified: Date.parse(entry.modifiedAt) || Date.now() });
    if (!placeAttachment(key, await ingestFile(file))) return;
    persistDraft();
    if (draftKey() !== key) return toast(t`${entry.name} 已置于原对话的案上`);
    closeLibrary();
    toast(t`${entry.name} 已置于案上`);
    setTimeout(() => (currentConversation() ? $("#chatInput") : $("#welcomeInput")).focus(), 0);
  } catch (error) {
    toast(t`置入失败：${String(error.message || error).slice(0, 80)}`);
  }
}

// 卷宗：收入、新建夹、检索、分类、条上的动作与就地改名；整页拖入文件；正文里指向卷宗文件的链接与答末的成品卡
function bindLibraryEvents() {
  $("#fileInput").onchange = handleFiles;
  $("#libraryAdd").onclick = () => $("#libraryFileInput").click();
  $("#libraryNewDir").onclick = () => void newArchiveFolder();
  $("#libraryFileInput").onchange = async e => {
    await addLibraryFiles(e.target.files);
    e.target.value = "";
  };
  $("#librarySearch").addEventListener("input", e => {
    libraryQuery = e.target.value;
    renderLibrary();
  });
  document.querySelectorAll("[data-library-kind]").forEach(
    button =>
      (button.onclick = () => {
        libraryKind = button.dataset.libraryKind;
        renderLibrary();
      })
  );
  $("#libraryCrumbs").addEventListener("click", e => {
    const crumb = e.target.closest("[data-library-dir]");
    if (crumb) enterLibraryDir(crumb.dataset.libraryDir);
  });
  // 一件：点条子即预览（图进看图，同此刻列着的图一起左右翻；余者进预览器）；一夹：点条子即入。条尾悬停露出的几样动作另算
  const openItem = (row, trigger = row) => {
    if (row.dataset.libraryDisk === undefined) return enterLibraryDir(row.dataset.libraryDir);
    const path = row.dataset.libraryDisk,
      images = [...$("#libraryGrid").querySelectorAll("[data-library-disk]")]
        .map(item => /** @type {HTMLElement} */ (item).dataset.libraryDisk)
        .filter(item => fileKind(item).group === "image");
    fileKind(path).group === "image" ? openArchiveImage(path, trigger, archiveDir(), images) : void openFileViewer(path, "", trigger);
  };
  $("#libraryGrid").addEventListener("click", e => {
    if (e.target.closest(".strip-rename")) return;
    const button = e.target.closest("[data-library-action]"),
      row = e.target.closest("[data-library-item]");
    if (button && row) {
      const path = row.dataset.libraryItem,
        action = button.dataset.libraryAction;
      if (action === "view") void openFileViewer(path, "", button);
      else if (action === "download") downloadArchiveFile(path);
      else if (action === "rename") startLibraryRename(path);
      else if (action === "remove") void removeArchiveItem(path);
      return;
    }
    const back = e.target.closest(".strip-back");
    if (back) return enterLibraryDir(back.dataset.libraryDir);
    if (row) openItem(row);
  });
  $("#libraryGrid").addEventListener("keydown", e => {
    const field = e.target.closest?.(".strip-rename");
    if (field) {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitLibraryRename(field.value);
      } else if (e.key === "Escape") {
        e.stopPropagation();
        cancelLibraryRename();
      }
      return;
    }
    const row = e.target.matches?.("[data-library-item]") ? e.target : null;
    if (!row) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openItem(row);
      if (row.dataset.libraryDisk === undefined) $("#libraryGrid .strip")?.focus();
    } else if (e.key === "F2") {
      e.preventDefault();
      startLibraryRename(row.dataset.libraryItem);
    } else if (e.key === "Delete") {
      e.preventDefault();
      void removeArchiveItem(row.dataset.libraryItem);
    }
  });
  // 改名框失了焦即落定；重画时换掉的旧框不算
  $("#libraryGrid").addEventListener(
    "blur",
    e => {
      if (e.target.matches?.(".strip-rename") && libraryRenaming && !libraryRepainting) void commitLibraryRename(e.target.value);
    },
    true
  );
  // 卷宗里的条子（件或夹）拖到夹上、路径里的上一级或簿头的 ‹ 上即挪进去：落点提亮，松手就挪
  const library = $("#library"),
    dropTarget = event =>
      Array.from(event.dataTransfer?.types || []).includes(ARCHIVE_DRAG) ? event.target.closest?.("#library [data-library-dir]") : null,
    clearDropMark = () => library.querySelectorAll(".drop-over").forEach(node => node.classList.remove("drop-over"));
  library.addEventListener("dragstart", event => {
    const row = event.target.closest?.("[data-library-item]");
    if (!row) return;
    event.dataTransfer.setData(ARCHIVE_DRAG, row.dataset.libraryItem);
    event.dataTransfer.effectAllowed = "move";
  });
  library.addEventListener("dragover", event => {
    const target = dropTarget(event);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!target.classList.contains("drop-over")) {
      clearDropMark();
      target.classList.add("drop-over");
    }
  });
  library.addEventListener("dragleave", event => {
    const target = dropTarget(event);
    if (target && !target.contains(event.relatedTarget)) target.classList.remove("drop-over");
  });
  library.addEventListener("dragend", clearDropMark);
  library.addEventListener("drop", event => {
    const target = dropTarget(event);
    clearDropMark();
    if (!target) return;
    event.preventDefault();
    void moveArchiveItem(event.dataTransfer.getData(ARCHIVE_DRAG), target.dataset.libraryDir);
  });
  let dragHideTimer = null,
    dragFromPage = false;
  // 拖的是页面里自己的东西（卷宗里的图、案上的附件、答里的图片）时浏览器也会把它当文件拖入：
  // 松手就又收一份进卷宗。页内起手的拖动一概不接——卷宗可能绑着用户自己的目录，里面本就允许有重样的文件，不能靠查重来挡
  window.addEventListener("dragstart", () => (dragFromPage = true));
  window.addEventListener("dragend", () => (dragFromPage = false));
  const hasDraggedFiles = event => !dragFromPage && Array.from(event.dataTransfer?.types || []).includes("Files");
  const showDropVeil = () => {
    clearTimeout(dragHideTimer);
    const toLibrary = view === "library";
    $("#dropTitle").textContent = toLibrary ? t("松手，收入卷宗") : t("松手，置于案上");
    $("#dropHint").textContent = toLibrary
      ? libraryDir
        ? t`任何文件 · 落进「${libraryDir.split("/").pop()}」这一层`
        : t("任何文件 · 落到本机的卷宗目录")
      : t`图片、文档与代码文件 · 单件 ${limitLabel(MAX_FILE_BYTES)}`;
    $("#dropVeil").classList.remove("hidden");
  };
  const hideDropVeil = () => {
    clearTimeout(dragHideTimer);
    $("#dropVeil").classList.add("hidden");
  };
  window.addEventListener("dragenter", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    showDropVeil();
  });
  window.addEventListener("dragover", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    showDropVeil();
  });
  window.addEventListener("dragleave", event => {
    if (!hasDraggedFiles(event)) return;
    dragHideTimer = setTimeout(hideDropVeil, 80);
  });
  window.addEventListener("drop", event => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    hideDropVeil();
    const entries = droppedEntries(event.dataTransfer);
    if (view === "library") return void (entries.length ? addLibraryEntries(entries) : addLibraryFiles(event.dataTransfer.files));
    // 案上只放文件：拖来的夹不展开（一个夹动辄几百件），请它进卷宗
    const folders = entries.filter(entry => entry.isDirectory);
    if (folders.length) toast(t("文件夹请拖进卷宗：案上只放文件"));
    const files = Array.from(event.dataTransfer.files).filter(file => !folders.some(entry => entry.name === file.name));
    if (files.length) void addFiles(files);
  });
  // 正文里指向本地文件的链接（模型写的「下载《x.docx》」）：页面上没有那样的路。先按原路在这段对话的落脚处取，
  // 取不到（sandbox:/ 之类、或路写错了层）再到卷宗里找同名的那件。答复后又动了手，那段话退进行迹成了 .trail-note，帮手的回报是 .sub-report，同样认
  document.addEventListener("click", async event => {
    const link = event.target.closest(":is(.markdown, .trail-note, .sub-report) a[data-file]");
    if (!link) return;
    event.preventDefault();
    const name = link.dataset.file,
      target = localLinkTarget(link.dataset.path);
    if (target && (await archiveFileExists(target))) return downloadArchiveFile(target.path, target.root);
    if (archiveEntries === null) await refreshArchive();
    const entry = (archiveEntries || []).find(file => file.name === name || file.path === name);
    if (!entry) return toast(t`找不到「${name}」`);
    downloadArchiveFile(entry.path);
  });
  $("#messages").addEventListener("click", event => {
    const more = event.target.closest(".deliver-more");
    if (more) return toggleDeliverables(more);
    const button = event.target.closest("[data-deliver-action]");
    if (!button) return;
    const path = button.closest("[data-deliver]")?.dataset.deliver;
    if (!path) return;
    if (deliverableMissing(path)) return toast(t("这件已从卷宗移除"));
    if (button.dataset.deliverAction === "download") downloadArchiveFile(path);
    else void openFileViewer(path, "", button);
  });
}
