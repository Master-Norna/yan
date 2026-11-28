// 言 · 工作区：独立目录树、页签与内容区。复用桥接、文件图及预览能力，不借卷宗的页面。
const work = {
  // true 时舞台显示工作区，false 时显示浏览器；并非两个同时展开的区域。
  open: false,
  /** @type {string} 绑的目录，也是此刻站着的那一层（绝对路径，正斜杠） */
  root: "",
  /** @type {string|null} 当前对话及其绑定目录的标记；同一段里走层不重置 */
  context: null,
  /** @type {"list"|"changes"|"search"} */
  mode: "list",
  /** @type {Set<string>} */
  expanded: new Set(),
  /** @type {Map<string, any>} */
  branches: new Map(),
  /** @type {{path:string,diff:boolean,raw:boolean}[]} */
  tabs: [],
  active: -1,
  collapsed: false,
  search: "",
  /** @type {WorkRow[]} */
  searchRows: [],
  searchStatus: "",
  terminal: false,
  terminalText: "",
  /** @type {AbortController|null} */
  command: null,
  /** @type {{ path: string, name: string, size: number, modifiedAt: string }[]} 这一层的件，路径相对根 */
  entries: [],
  /** @type {{ path: string, name: string, files?: number, folders?: number, modifiedAt?: string }[]} 夹，同上 */
  dirs: [],
  /** 当前目录或改动路径已查完 */
  full: false,
  /** @type {Map<string, { kind: string, size?: number, modifiedAt?: string } | null>} */
  changeEntries: new Map(),
  /** @type {{ path: string, created: boolean }[]} 与 changeEntries 是同一趟取的快照 */
  changeFiles: [],
  truncated: false,
  error: "",
  /** 画着的是哪一副样子（""/list/empty）：壳子只在换样子时重画 */
  shape: "",
  rev: 0
};

/** 开头的斜杠：POSIX 的根（/Users/…）、UNC 的 //host，不算一级，拼回去时要留在前头；Windows 的 E:/ 归第一级自己带着 */
function workLead(path) {
  const lead = /^\/+/.exec(slashed(path));
  return lead ? lead[0] : "";
}
/** 路径按层拆开：E:/项目/Note → E: › 项目 › Note */
function workParts(path) {
  const text = slashed(path),
    lead = workLead(text);
  return text.slice(lead.length).split("/").filter(Boolean);
}
/** 前 end 级拼回去：POSIX 上丢了开头那一道斜杠就成了相对路径，下一趟列目录会落到桥接的工作目录去 */
function workAt(path, parts, end) {
  return workLead(path) + parts.slice(0, end).join("/");
}
/** 根与一条相对的路拼起来：根是 / 时不写成一加一的后斜杠 */
function workJoin(root, rel) {
  const base = slashed(root);
  return base.endsWith("/") ? `${base}${rel}` : `${base}/${rel}`;
}
// 对话已有工作目录就用它，不另绑、不改对话；切换对话或重新绑定时才回到根。
function workFollowConversation() {
  const c = currentConversation(),
    root = slashed(c?.workdir || archiveDir()),
    context = JSON.stringify([c?.id || "", root]);
  if (work.context === context) return false;
  workCloseViewer();
  workResetWorkspace();
  work.context = context;
  work.root = root;
  workResetRows();
  work.mode = "list";
  work.shape = "";
  return true;
}
// render() 在切换对话、绑定或解绑目录时都会走到这里；平时重画只比一个标记，不读盘。
function workSyncConversation() {
  if (!work.open || !workFollowConversation()) return;
  workPaint();
  if (work.root) void workRefresh();
}
function workEnter() {
  work.open = true;
  workFollowConversation();
  stageRender();
  if (work.active >= 0) workActivate(work.active);
  void workRefresh();
}
function workLeave() {
  if (!work.open) return;
  work.open = false;
  workCloseViewer();
  stageRender();
}
/** 游目里开着预览时，收起、切走或换对话先把它关上：那一层是这一面的，不该跟着到别处去 */
function workCloseViewer() {
  const viewer = $("#fileViewer");
  if (!viewer?.classList?.contains("in-stage") || !isShown("#fileViewer")) return;
  closeFileViewer();
}
/** 选一处目录：系统的选夹子窗（与卷宗「收入文件」同一个口，见 server/work/picker.js） */
async function workPick() {
  const context = work.context,
    root = work.root;
  try {
    const { paths } = await bridge("/api/work/pick", {});
    if (!paths?.[0] || !work.open || work.context !== context || work.root !== root) return;
    workCloseViewer();
    workResetWorkspace();
    work.root = slashed(paths[0]);
    workResetRows();
    work.mode = "list";
    workPaint();
    await workRefresh();
  } catch (error) {
    toast(t`打开失败：${String(/** @type {any} */ (error).message || error).slice(0, 80)}`);
  }
}
/** 点路径里的一级或子目录，都走这一条 */
function workEnterDir(path) {
  const root = slashed(String(path || ""));
  if (!root || root === work.root) return;
  workCloseViewer();
  workResetWorkspace();
  work.root = root;
  workResetRows();
  work.mode = "list";
  workPaint();
  void workRefresh();
}
// ---------- 列 ----------
function workResetWorkspace() {
  work.expanded.clear();
  work.branches.clear();
  work.tabs = [];
  work.active = -1;
  work.search = "";
  work.searchRows = [];
  work.searchStatus = "";
  work.command?.abort();
  work.command = null;
  work.terminalText = "";
}
// 仅展开时读取这一层；换根后迟到的结果不再生效。
async function workLoadBranch(path) {
  const request = { loading: true, entries: [], dirs: [], truncated: false, error: "" };
  work.branches.set(path, request);
  workPaint();
  try {
    const data = await bridge("/api/archive/list", { root: path, scratch: false, depth: 1 }, AbortSignal.timeout(8000));
    if (work.branches.get(path) !== request) return;
    Object.assign(request, { loading: false, entries: data.entries || [], dirs: data.dirs || [], truncated: !!data.truncated });
  } catch (error) {
    if (work.branches.get(path) !== request) return;
    request.loading = false;
    request.error = String(error.message || error).slice(0, 160);
  }
  workPaint();
}
function workToggleDir(path) {
  if (work.expanded.delete(path)) return workPaint();
  work.expanded.add(path);
  void workLoadBranch(path);
}
async function workSearch(query) {
  work.search = String(query || "").trim();
  const rev = ++work.rev, root = work.root;
  work.searchRows = [];
  work.searchStatus = work.search ? t("正在翻…") : "";
  workPaint();
  if (!work.search || !root) return;
  try {
    const data = await bridge("/api/work/search", { workdir: root, path: ".", query: work.search, literal: true, limit: 200 }, AbortSignal.timeout(20000));
    if (rev !== work.rev || work.mode !== "search") return;
    work.searchRows = (data.matches || []).map(hit => {
      const rel = slashed(hit.file);
      const path = /^(?:[a-z]:\/|\/)/i.test(rel) ? rel : workJoin(root, rel);
      return { dir: false, name: rel.split("/").pop() || rel, path, where: parentDir(rel), note: String(hit.line) + ": " + hit.text };
    });
    work.searchStatus = data.truncated || data.skipped?.length || data.large || data.unread ? t("搜索范围有限") : work.searchRows.length ? "" : t("没有找到文件");
  } catch (error) {
    if (rev !== work.rev) return;
    work.searchStatus = t`目录不可用：${String(error.message || error).slice(0, 160)}`;
  }
  workPaint();
}

// 换根或换面时，旧列表不可拿新根拼路径；在发出新请求前就使旧请求失效。
function workResetRows() {
  ++work.rev;
  work.entries = [];
  work.dirs = [];
  work.changeEntries.clear();
  work.changeFiles = [];
  work.full = false;
  work.truncated = false;
  work.error = "";
}
// 一层只要一层（depth: 1）；改动直接查本段对话碰过的件。
async function workRefresh() {
  if (work.mode === "search") return;
  if (!work.root && work.mode !== "changes") return;
  const rev = ++work.rev;
  try {
    if (work.mode === "changes") {
      const files = workChangedFiles(),
        entries = new Map();
      // 小批并行：不扫无关目录，也不一次发出无界数量的请求。
      for (let i = 0; i < files.length; i += 16) {
        await Promise.all(
          files.slice(i, i + 16).map(async file => {
            const info = await bridge("/api/archive/stat", { path: file.path }, AbortSignal.timeout(8000)).catch(() => null);
            entries.set(file.path, info);
          })
        );
        if (rev !== work.rev) return;
      }
      if (rev !== work.rev) return;
      work.changeEntries = entries;
      work.changeFiles = files;
      work.full = true;
      work.error = "";
      workPaint();
      return;
    }
    const data = await bridge("/api/archive/list", { root: work.root, scratch: false, depth: 1 }, AbortSignal.timeout(8000));
    if (rev !== work.rev) return;
    work.entries = data.entries || [];
    work.dirs = data.dirs || [];
    work.truncated = !!data.truncated;
    work.full = true;
    work.error = "";
  } catch (error) {
    if (rev !== work.rev) return;
    work.entries = [];
    work.dirs = [];
    work.full = false;
    work.error = String(/** @type {any} */ (error).message || error).slice(0, 160);
  }
  workPaint();
  if (work.mode === "list" && rev === work.rev) {
    const paths = [...work.expanded];
    for (let i = 0; i < paths.length && rev === work.rev; i += 4)
      await Promise.all(paths.slice(i, i + 4).map(path => workLoadBranch(path)));
  }
}
/** 一条簿录 @typedef {{ dir: boolean, name: string, path: string, where?: string, note?: string, size?: number|null, when?: string, state?: string }} WorkRow */
/** 改动记下的路归成绝对路：相对的以对话落脚处算（对话没绑目录则为卷宗），带 scheme 的（sandbox:）不认。
 * workChangedFiles 与 workDiffHtml 共用这一处，两边配对才对得上 @param {string} raw @param {string} root */
function workAbsPath(raw, root) {
  const text = slashed(raw);
  if (!text) return "";
  if (/^(?:[a-z]:\/|\/)/i.test(text)) return absJoin(text, "");
  return root && !/^[a-z][\w+.-]*:/i.test(text) ? absJoin(root, text) : "";
}
/** 本段对话改过的件：按路径并成一份，新建过的记着 */
function workChangedFiles() {
  const files = new Map(),
    /** @type {Conversation|null} */
    conversation = currentConversation?.() || null,
    root = slashed(conversation?.workdir || archiveDir());
  for (const message of conversation?.messages || [])
    for (const file of changeStats(message).files) {
      // 改动可能只记了相对路（例如 .yan/报告.md）。以对话落脚处算，不随簿录当前所处目录变。
      const path = workAbsPath(file.path, root);
      if (!path) continue;
      const entry = files.get(path) || { path, created: false };
      entry.created ||= !!file.created;
      files.set(path, entry);
    }
  return [...files.values()];
}
/** 一件在本段对话里的改动：按条按步的先后排在一起，与行迹里点改动同一套画法。
 * 每一步的路也按同一口径归成绝对路，免得「.yan/报告.md」与「E:/…/.yan/报告.md」配不上 @param {Conversation} conversation @param {string} path */
function workDiffHtml(conversation, path) {
  const base = slashed(conversation?.workdir || archiveDir()),
    /** @type {Step[]} */
    steps = [];
  for (const message of conversation?.messages || [])
    for (const step of allSteps(message))
      if (step.change && step.status === "done" && workAbsPath(step.change.path, base) === path) steps.push(step);
  if (!steps.length) return `<div class="file-viewer-text change-diff"><p class="file-viewer-note">${t("此件没有记下改动")}</p></div>`;
  return changeDiffStepsHtml(steps);
}
/** 改动那一面的条子：新建的是石绿、还在的是泥金、盘上已经没有的是朱（大小、日子照现有那一份，删掉的留空） @returns {WorkRow[]} */
function workChangeRows() {
  if (!work.full) return [];
  const rows = [];
  const base = slashed(currentConversation()?.workdir || archiveDir());
  for (const file of work.changeFiles) {
    const rel = base ? relInside(base, file.path) : "",
      entry = work.changeEntries.get(file.path),
      cut = file.path.lastIndexOf("/");
    rows.push({
      dir: false,
      name: cut < 0 ? file.path : file.path.slice(cut + 1),
      where: cut < 0 ? "" : parentDir(rel || file.path),
      path: file.path,
      size: entry ? entry.size : null,
      when: entry?.modifiedAt ? formatDay(entry.modifiedAt) : "",
      state: entry?.kind === "missing" ? "del" : entry?.kind === "file" ? (file.created ? "add" : "mod") : ""
    });
  }
  return rows.sort((a, b) => `${a.where}/${a.name}`.localeCompare(`${b.where}/${b.name}`, "zh-CN"));
}
/** 这一眼要画的条子：夹在前、件在后 @returns {WorkRow[]} */
function workRows() {
  if (work.mode === "changes") return workChangeRows();
  if (work.mode === "search") return work.searchRows;
  return workDirectoryRows(work.root, work.dirs, work.entries);
}
function workDirectoryRows(root, dirs, entries) {
  return [
    ...dirs.map(dir => ({
      dir: true, name: dir.name, path: workJoin(root, dir.path),
      note: folderCountNote(dir.files, dir.folders), when: dir.modifiedAt ? formatDay(dir.modifiedAt) : ""
    })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    ...entries.map(entry => ({
      dir: false, name: entry.name, path: workJoin(root, entry.path),
      size: entry.size, when: formatDay(entry.modifiedAt)
    })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  ];
}
function workViewsHtml() {
  return `<div class="stage-views" role="group" aria-label="${t("工作区")}">${[["list","工作区","worktree"],["changes","改动","workdiff"],["search","查找文件","search"]].map(([mode,label,icon]) => `<button type="button" data-work-mode="${mode}" aria-pressed="${work.mode === mode}" title="${t(label)}" aria-label="${t(label)}">${brushIcon(icon)}</button>`).join("")}<button type="button" data-work-collapse aria-expanded="${!work.collapsed}" title="${t("切换目录栏")}" aria-label="${t("切换目录栏")}">‹</button><button type="button" data-work-terminal aria-pressed="${work.terminal}" title="${t("终端")}" aria-label="${t("终端")}">${brushIcon("code")}</button></div>`;
}
function workShellHtml() {
  return `<div class="work-inner"><div class="work-rail">${workViewsHtml()}</div><div class="work-explorer"><div class="work-bar"><div id="workCrumbs" class="library-crumbs"></div><button type="button" data-work-pick title="${t("选择文件夹…")}" aria-label="${t("选择文件夹…")}">${brushIcon("folder")}</button></div><form id="workFind" class="hidden"><input type="search" aria-label="${t("查找文件")}" placeholder="${t("查找文件")}" maxlength="200"><button type="submit" aria-label="${t("查找文件")}">${brushIcon("search")}</button></form><div id="workStrips" class="work-tree"></div></div><section class="work-editor"><div class="work-tabbar"><div id="workTabs" class="work-tabs" role="tablist"></div><div id="workDocMode" class="work-docmode stage-views"></div></div><div id="workContent" class="work-content">${workEmptyBody(t("选择文件以查看"))}</div><section id="workTerminal" class="work-terminal hidden"><div class="work-terminal-head">${t("终端")}<button type="button" data-work-stop>${t("停止")}</button><button type="button" data-work-terminal aria-label="${t("关闭")}">×</button></div><pre id="workTerminalOutput"></pre><form id="workCommand"><span aria-hidden="true">›</span><input aria-label="${t("输入指令")}" placeholder="${t("输入指令")}" autocomplete="off"><button type="submit">${t("运行")}</button></form></section></section></div>`;
}
function workEmptyBody(text) {
  return `<div class="stage-empty work-empty">${brushIcon("folder", "work-leaf")}<span>${escapeHtml(text)}</span></div>`;
}
function workCrumbsHtml() {
  const parts = workParts(work.root),
    crumbs = [];
  if (work.mode === "changes") return t("改动");
  if (work.mode === "search") return t("查找文件");
  if (!parts.length) return "";
  if (parts.length > 4) crumbs.push({ name: parts[0], at: workAt(work.root, parts, 1) }, { name: "…", at: "" });
  for (let i = parts.length > 4 ? parts.length - 2 : 0; i < parts.length; i++)
    crumbs.push({ name: parts[i], at: workAt(work.root, parts, i + 1) });
  return crumbs
    .map((crumb, i) => {
      const sep = i ? `<span class="sep" aria-hidden="true">›</span>` : "";
      if (i === crumbs.length - 1)
        return `${sep}<button type="button" class="here" data-work-pick title="${escapeHtml(crumb.at)}" aria-label="${t("选择文件夹…")}">${escapeHtml(crumb.name)}</button>`;
      if (/^[a-z]:$/i.test(crumb.at) || (crumb.at.startsWith("//") && workParts(crumb.at).length < 2))
        return `${sep}<span>${escapeHtml(crumb.name)}</span>`;
      if (!crumb.at) return `${sep}<span class="sep" aria-hidden="true">…</span>`;
      return `${sep}<button type="button" data-work-dir="${escapeHtml(crumb.at)}" title="${escapeHtml(crumb.at)}">${escapeHtml(crumb.name)}</button>`;
    })
    .join("");
}
/** @param {WorkRow} row */
function workRowHtml(row) {
  if (row.dir)
    return `<div class="strip dir" role="button" tabindex="0" data-work-dir="${escapeHtml(row.path)}" title="${t`打开 ${escapeHtml(row.name)}`}"><span>${caseFigure()}</span><span class="strip-name"><strong>${escapeHtml(row.name)}</strong></span><span class="strip-note"><span class="ell" title="${escapeHtml(row.note || "")}">${escapeHtml(row.note || "")}</span></span><span class="strip-date"><span class="strip-when">${escapeHtml(row.when || "")}</span></span></div>`;
  const where = row.where ? `<span class="dir">${escapeHtml(row.where.replace(/\/$/, ""))}/</span>` : "",
    size = row.size === null || row.size === undefined ? "" : escapeHtml(formatFileSize(row.size));
  // 删掉的件不再向盘上取缩略（取也取不到），只留那一片换过色的纸
  return `<div class="strip file" role="button" tabindex="0" data-work-file="${escapeHtml(row.path)}" title="${escapeHtml(row.path)}"><span>${fileFigure(row.name, row.state === "del" ? "" : row.path, row.state)}</span><span class="strip-name"><strong>${where}${escapeHtml(row.name)}</strong></span><span>${size}</span><span class="strip-date"><span class="strip-when">${escapeHtml(row.when || "")}</span></span></div>`;
}
function workPaint() {
  const box = $("#stageWork");
  if (!box) return;
  $("#stageWorkBtn").setAttribute("aria-pressed", String(work.open));
  box.classList.toggle("hidden", !work.open);
  if (!work.open) return;
  const shape = work.root || work.mode === "changes" ? "list" : "empty";
  if (work.shape !== shape) {
    work.shape = shape;
    box.innerHTML = shape === "list" ? workShellHtml() : workEmptyHtml();
  }
  if (shape !== "list") return;
  const rows = workRows();
  stageSetHtml($("#workCrumbs"), workCrumbsHtml());
  const empty = work.error
      ? t`目录不可用：${work.error}`
      : !work.full
        ? t("正在翻…")
        : work.mode === "changes"
          ? t("本段对话还没改过文件")
          : t("此层尚空"),
    body = rows.length
      ? `<div class="strip-cols"><span></span><span>${t("名目")}</span><span>${t("大小")}</span><span>${t("日期")}</span></div>${rows.map(workRowHtml).join("")}`
      : workEmptyBody(empty);
  stageSetHtml($("#workStrips"), body);
  for (const button of document.querySelectorAll("#workCrumbs [data-work-dir], #stageWork [data-work-mode]")) {
    const el = /** @type {HTMLElement} */ (button);
    if (el.dataset.workMode) el.setAttribute("aria-pressed", String(el.dataset.workMode === work.mode));
  }
}
// ---------- 动手 ----------
/** 点件打开：列表面看原件、改动面看这件在本段对话里的改动；都交给预览器、落在游目这一栏里（见 20-viewer.js 的 placeViewer）。
 * 关闭后回到原簿录，不启动浏览器也不改页签。 */
function workOpenPath(path, trigger = null) {
  if (!work.open || !path) return;
  if (work.mode === "changes") {
    const conversation = currentConversation?.() || null;
    if (!conversation) return;
    showInFileViewer(t`${path} · 本段改动`, workDiffHtml(conversation, path), trigger, t("览"), "stage");
    return;
  }
  void openFileViewer({ file: path }, "", trigger, "stage");
}
function workSwitch(mode) {
  if (work.mode === mode) return void workRefresh();
  work.mode = mode;
  workResetRows();
  workPaint();
  void workRefresh();
}
function bindWork() {
  $("#stageWorkBtn").addEventListener("click", () => (work.open ? workLeave() : workEnter()));
  const box = $("#stageWork");
  box.addEventListener("click", event => {
    const target = /** @type {HTMLElement} */ (event.target),
      mode = /** @type {HTMLElement|null} */ (target.closest("[data-work-mode]"));
    if (mode) return void workSwitch(/** @type {any} */ (mode.dataset.workMode));
    if (target.closest("[data-work-pick]")) return void workPick();
    const dir = /** @type {HTMLElement|null} */ (target.closest("[data-work-dir]"));
    if (dir) return void workEnterDir(dir.dataset.workDir);
    const file = /** @type {HTMLElement|null} */ (target.closest("[data-work-file]"));
    if (file) return void workOpenPath(file.dataset.workFile, file);
  });
  // 条子也能用键盘走：回车、空格与点一样
  box.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest(".strip"));
    if (!row) return;
    event.preventDefault();
    row.click();
  });
}
