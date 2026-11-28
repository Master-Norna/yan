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
// 对话已有工作目录就用它，不另绑、不改对话；切换对话或重新绑定时才回到根。
function workFollowConversation() {
  const c = currentConversation(),
    root = slashed(c?.workdir || archiveDir()),
    context = JSON.stringify([c?.id || "", root]);
  if (work.context === context) return false;
  work.context = context;
  workSetRoot(root);
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
  // 切面立即停推流：同一帧内网页与工作区来回切换时，尺寸观察可能合并掉中间变化。
  stageWake();
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
    workSetRoot(paths[0]);
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
  workSetRoot(root);
  workPaint();
  void workRefresh();
}
// 根、列表、页签和展开状态一起换，并作废旧请求。
function workSetRoot(root) {
  workCloseViewer();
  workResetWorkspace();
  work.root = slashed(root);
  workResetRows();
  work.mode = "list";
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
  // 刷新时保留上一趟成功的目录快照，直到新结果到齐，避免切面或工具刷新时文件行突然消失。
  const previous = work.branches.get(path),
    request = { loading: true, entries: [], dirs: [], truncated: false, error: "", ready: false };
  if (previous?.ready) {
    request.entries = previous.entries;
    request.dirs = previous.dirs;
    request.truncated = previous.truncated;
    request.ready = true;
  }
  work.branches.set(path, request);
  workPaint();
  try {
    const data = await bridge("/api/archive/list", { root: path, scratch: false, depth: 1, workspace: true }, AbortSignal.timeout(8000));
    if (work.branches.get(path) !== request) return;
    Object.assign(request, { loading: false, entries: data.entries || [], dirs: data.dirs || [], truncated: !!data.truncated });
    request.ready = true;
  } catch (error) {
    if (work.branches.get(path) !== request) return;
    request.loading = false;
    request.ready = false;
    request.entries = [];
    request.dirs = [];
    request.truncated = false;
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
  const rev = ++work.rev,
    root = work.root;
  work.searchRows = [];
  work.searchStatus = work.search ? t("正在翻…") : "";
  workPaint();
  if (!work.search || !root) return;
  try {
    const data = await bridge(
      "/api/work/search",
      { workdir: root, path: ".", query: work.search, literal: true, limit: 200 },
      AbortSignal.timeout(20000)
    );
    if (rev !== work.rev || work.mode !== "search") return;
    work.searchRows = (data.matches || []).map(hit => {
      const rel = slashed(hit.file);
      const path = /^(?:[a-z]:\/|\/)/i.test(rel) ? rel : joinFile(root, rel);
      return { dir: false, name: rel.split("/").pop() || rel, path, where: parentDir(rel), note: String(hit.line) + ": " + hit.text };
    });
    const limited = data.truncated || data.skipped?.length || data.large || data.unread;
    work.searchStatus = limited ? t("搜索范围有限") : work.searchRows.length ? "" : t("没有找到文件");
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
    const data = await bridge(
      "/api/archive/list",
      { root: work.root, scratch: false, depth: 1, workspace: true },
      AbortSignal.timeout(8000)
    );
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
    work.truncated = false;
    work.error = String(/** @type {any} */ (error).message || error).slice(0, 160);
  }
  workPaint();
  if (work.mode === "list" && rev === work.rev) {
    const paths = [...work.expanded].filter(path => {
      for (let parent = parentDir(path); parent && parent !== work.root; parent = parentDir(parent)) {
        if (!work.expanded.has(parent)) return false;
        if (parentDir(parent) === parent) return false;
      }
      return true;
    });
    for (let i = 0; i < paths.length && rev === work.rev; i += 4)
      await Promise.all(paths.slice(i, i + 4).map(path => workLoadBranch(path)));
  }
}
// 工具完成是现成的刷新信号：合并短时间内的通知，不起轮询，也不扫未打开的工作区。
let workRefreshTimer = 0;
/** @param {Conversation} conversation */
function workQueueRefresh(conversation) {
  if (!work.open || !stageShown() || currentConversation()?.id !== conversation.id) return;
  if (workRefreshTimer) clearTimeout(workRefreshTimer);
  workRefreshTimer = setTimeout(() => {
    workRefreshTimer = 0;
    if (work.open && stageShown() && currentConversation()?.id === conversation.id) void workRefresh();
  }, 150);
}
/** @param {Conversation} conversation @param {Step[]} steps */
function workRefreshAfterTools(conversation, steps) {
  if (steps.some(step => step.status === "done" && !step.readOnly && (step.change || TOOLS.get(step.name)?.writes)))
    workQueueRefresh(conversation);
}
/** 一条簿录 @typedef {{ dir: boolean, name: string, path: string, where?: string, note?: string, size?: number|null, when?: string, state?: string }} WorkRow */
/** 改动路径按原步骤落脚处归并；缺少来源的旧相对路不猜。 @param {string} raw @param {string} root */
function workAbsPath(raw, root) {
  const text = slashed(raw),
    base = slashed(root);
  if (!text) return "";
  if (/^(?:[a-z]:\/|\/)/i.test(text)) return absJoin(text, "");
  return /^(?:[a-z]:\/|\/)/i.test(base) && !/^[a-z][\w+.-]*:/i.test(text) ? absJoin(base, text) : "";
}
/** 本段对话改过的件：按路径并成一份，新建过的记着 */
function workChangedFiles() {
  const files = new Map(),
    /** @type {Conversation|null} */
    conversation = currentConversation?.() || null;
  for (const message of conversation?.messages || [])
    for (const step of allSteps(message)) {
      if (!step.change || step.status !== "done") continue;
      const path = workAbsPath(step.change.path, step.root || "");
      if (!path) continue;
      const entry = files.get(path) || { path, created: false };
      entry.created ||= !!step.change.created;
      files.set(path, entry);
    }
  return [...files.values()];
}
/** 一件在本段对话里的改动：按条按步的先后排在一起，与行迹里点改动同一套画法。
 * 每一步的路也按同一口径归成绝对路，免得「.yan/报告.md」与「E:/…/.yan/报告.md」配不上 @param {Conversation} conversation @param {string} path */
function workDiffHtml(conversation, path) {
  /** @type {Step[]} */
  const steps = [];
  for (const message of conversation?.messages || [])
    for (const step of allSteps(message))
      if (step.change && step.status === "done" && workAbsPath(step.change.path, step.root || "") === path) steps.push(step);
  if (!steps.length) return `<div class="file-viewer-text change-diff"><p class="file-viewer-note">${t("此件没有记下改动")}</p></div>`;
  return changeDiffStepsHtml(steps).replace(
    '<div class="file-viewer-text change-diff">',
    `<div class="file-viewer-text change-diff"><div class="work-diff-head"><span>${t("改动前")}</span><span>${t("改动后")}</span></div>`
  );
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
    ...dirs
      .map(dir => ({
        dir: true,
        name: dir.name,
        path: joinFile(root, dir.path),
        note: folderCountNote(dir.files, dir.folders),
        when: dir.modifiedAt ? formatDay(dir.modifiedAt) : ""
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    ...entries
      .map(entry => ({
        dir: false,
        name: entry.name,
        path: joinFile(root, entry.path),
        size: entry.size,
        when: formatDay(entry.modifiedAt)
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
  ];
}
function workViewsHtml() {
  const views = [
    ["list", "工作区", "worktree"],
    ["changes", "改动", "workdiff"],
    ["search", "查找文件", "search"]
  ];
  const buttons = views
    .map(([mode, label, icon]) => {
      return `<button type="button" data-work-mode="${mode}" aria-pressed="${work.mode === mode}" title="${t(label)}" aria-label="${t(label)}">${brushIcon(icon)}</button>`;
    })
    .join("");
  return `<div class="stage-views" role="group" aria-label="${t("工作区")}">${buttons}<button type="button" data-work-collapse aria-expanded="${!work.collapsed}" title="${t("切换目录栏")}" aria-label="${t("切换目录栏")}">‹</button><button type="button" data-work-terminal aria-pressed="${work.terminal}" title="${t("终端")}" aria-label="${t("终端")}">${brushIcon("code")}</button></div>`;
}
function workShellHtml() {
  return `<div class="work-inner"><div class="work-rail">${workViewsHtml()}</div><div class="work-explorer"><div class="work-bar"><div id="workCrumbs" class="library-crumbs"></div><button type="button" data-work-pick title="${t("选择文件夹…")}" aria-label="${t("选择文件夹…")}">${brushIcon("folder")}</button></div><form id="workFind" class="hidden"><input type="search" aria-label="${t("查找文件")}" placeholder="${t("查找文件")}" maxlength="200"><button type="submit" aria-label="${t("查找文件")}">${brushIcon("search")}</button></form><div id="workStrips" class="work-tree"></div></div><div class="work-resize" role="separator" aria-orientation="vertical" aria-label="${t("调整目录栏宽度")}" tabindex="0"></div><section class="work-editor"><div class="work-tabbar"><div id="workTabs" class="work-tabs" role="tablist"></div><div id="workDocMode" class="work-docmode stage-views"></div></div><div id="workContent" class="work-content">${workEmptyBody(t("选择文件以查看"))}</div><section id="workTerminal" class="work-terminal hidden"><div class="work-terminal-head">${t("终端")}<button type="button" data-work-stop>${t("停止")}</button><button type="button" data-work-terminal aria-label="${t("关闭")}">×</button></div><pre id="workTerminalOutput"></pre><form id="workCommand"><span aria-hidden="true">›</span><input aria-label="${t("输入指令")}" placeholder="${t("输入指令")}" autocomplete="off"><button type="submit">${t("运行")}</button></form></section></section></div>`;
}
function workEmptyBody(text) {
  return `<div class="stage-empty work-empty">${brushIcon("folder", "work-leaf")}<span>${escapeHtml(text)}</span></div>`;
}
function workCrumbsHtml() {
  const parts = workParts(work.root),
    crumbs = [];
  if (work.mode === "changes") return t("改动");
  if (work.mode === "search") return t("查找文件");
  if (!parts.length) {
    if (!work.root) return "";
    return `<button type="button" class="here" data-work-pick title="${escapeHtml(work.root)}">${escapeHtml(work.root)}</button>`;
  }
  if (work.root.startsWith("/") && !work.root.startsWith("//")) crumbs.push({ name: "/", at: "/" });
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
/** @param {WorkRow} row @param {number} [depth] */
function workRowHtml(row, depth = 0) {
  const name = escapeHtml(row.name),
    path = escapeHtml(row.path),
    details = [row.path, row.note, row.size == null ? "" : formatFileSize(row.size), row.when].filter(Boolean).join(" · "),
    indent = Math.min(depth, 30) * 14;
  if (row.dir) {
    const expanded = work.expanded.has(row.path),
      branch = work.branches.get(row.path);
    let children = "";
    if (expanded) {
      if (branch?.loading && !branch.ready) children = t("正在翻…");
      else if (branch?.error) children = escapeHtml(branch.error);
      else if (branch) {
        const rows = workDirectoryRows(row.path, branch.dirs, branch.entries);
        children = rows.map(child => workRowHtml(child, depth + 1)).join("") || t("此层尚空");
      }
    }
    return `<div class="work-row" role="button" tabindex="0" data-work-dir="${path}" aria-expanded="${expanded}" style="--work-indent:${indent}px" title="${escapeHtml(details)}"><span class="work-chevron">${expanded ? "⌄" : "›"}</span><span>${caseFigure()}</span><strong>${name}</strong></div>${expanded ? `<div class="work-children">${children}${branch?.truncated ? `<small>${t("目录列表已截断")}</small>` : ""}</div>` : ""}`;
  }
  const selected = work.tabs[work.active]?.path === row.path && work.tabs[work.active]?.diff === (work.mode === "changes");
  return `<div class="work-row" role="button" tabindex="0" data-work-file="${path}" aria-current="${selected}" style="--work-indent:${indent}px" title="${escapeHtml(details)}"><span class="work-chevron"></span><span>${fileFigure(row.name, "", row.state)}</span><span class="work-name"><strong>${name}</strong>${row.where ? `<small>${escapeHtml(row.where)}</small>` : ""}${work.mode === "search" && row.note ? `<small>${escapeHtml(row.note)}</small>` : ""}</span></div>`;
}
function workPaintTabs() {
  const tabs = $("#workTabs"),
    mode = $("#workDocMode");
  if (!tabs || !mode) return;
  const html = work.tabs
    .map((tab, index) => {
      return `<div class="work-tab${index === work.active ? " on" : ""}"><button type="button" role="tab" aria-selected="${index === work.active}" data-work-tab="${index}" title="${escapeHtml(tab.path)}">${tab.diff ? brushIcon("workdiff") : fileFigure(tab.path.split("/").pop())}<span>${escapeHtml(tab.path.split("/").pop())}</span></button><button type="button" data-work-tab-close="${index}" aria-label="${t("关闭")}">×</button></div>`;
    })
    .join("");
  stageSetHtml(tabs, html);
  const active = work.tabs[work.active],
    kind = active && fileKind(active.path).view;
  if (active && !active.diff && (kind === "markdown" || kind === "html")) {
    stageSetHtml(
      mode,
      `<button type="button" data-work-raw="false" aria-pressed="${!active.raw}" title="${t("预览")}" aria-label="${t("预览")}">${brushIcon("preview")}</button><button type="button" data-work-raw="true" aria-pressed="${active.raw}" title="${t("源码")}" aria-label="${t("源码")}">${brushIcon("code")}</button>`
    );
  } else stageSetHtml(mode, "");
}
function workPaint() {
  const box = $("#stageWork");
  if (!box) return;
  $("#stageWorkBtn").setAttribute("aria-pressed", String(work.open));
  box.classList.toggle("hidden", !work.open);
  if (!work.open) return;
  if (!$("#workContent")) box.innerHTML = workShellHtml();
  box.classList.toggle("work-collapsed", work.collapsed);
  stageSetHtml($("#workCrumbs"), workCrumbsHtml());
  $("#workFind").classList.toggle("hidden", work.mode !== "search");
  const rows = workRows();
  let empty = t("此层尚空");
  if (work.mode === "search") empty = work.searchStatus;
  else if (work.error) empty = t`目录不可用：${work.error}`;
  else if (!work.root && work.mode === "list") empty = t("选择文件夹…");
  else if (!work.full) empty = t("正在翻…");
  else if (work.mode === "changes") empty = t("本段对话还没改过文件");
  const body = rows.length ? rows.map(row => workRowHtml(row)).join("") : `<small class="work-tree-note">${escapeHtml(empty)}</small>`;
  let notice = "";
  if (work.mode === "list" && work.truncated) notice = t("目录列表已截断");
  else if (work.mode === "search" && rows.length && work.searchStatus) notice = work.searchStatus;
  stageSetHtml($("#workStrips"), body + (notice ? `<small class="work-tree-note">${escapeHtml(notice)}</small>` : ""));
  for (const button of document.querySelectorAll("#stageWork [data-work-mode]")) {
    const el = /** @type {HTMLElement} */ (button);
    el.setAttribute("aria-pressed", String(el.dataset.workMode === work.mode));
  }
  $("[data-work-collapse]").setAttribute("aria-expanded", String(!work.collapsed));
  $(".work-rail [data-work-terminal]").setAttribute("aria-pressed", String(work.terminal));
  $("#workTerminal").classList.toggle("hidden", !work.terminal);
  const output = $("#workTerminalOutput");
  if (output.textContent !== work.terminalText) {
    output.textContent = work.terminalText;
    output.scrollTop = output.scrollHeight;
  }
  $("#workCommand button").disabled = !!work.command || !work.root;
  $("[data-work-stop]").disabled = !work.command;
  workPaintTabs();
}
function workActivate(index, trigger = null) {
  const tab = work.tabs[index];
  if (!tab || !work.open) return;
  work.active = index;
  workPaint();
  if (tab.diff) {
    const conversation = currentConversation?.() || null;
    if (!conversation) return;
    showInFileViewer(t`${tab.path} · 本段改动`, workDiffHtml(conversation, tab.path), trigger, t("览"), "stage");
  } else void openFileViewer({ file: tab.path }, "", trigger, "stage", tab.raw);
}
function workOpenPath(path, trigger = null) {
  if (!work.open || !path) return;
  const diff = work.mode === "changes";
  let index = work.tabs.findIndex(tab => tab.path === path && tab.diff === diff);
  if (index < 0) {
    index = work.tabs.length;
    work.tabs.push({ path, diff, raw: false });
  }
  workActivate(index, trigger);
}
function workCloseTab(index) {
  if (!work.tabs[index]) return;
  const active = index === work.active;
  work.tabs.splice(index, 1);
  if (index < work.active) work.active--;
  if (active) {
    if (work.tabs.length) workActivate(Math.min(index, work.tabs.length - 1));
    else {
      work.active = -1;
      workCloseViewer();
    }
  }
  workPaint();
}
function workSwitch(mode) {
  work.collapsed = false;
  if (work.mode !== mode) {
    work.mode = mode;
    workResetRows();
  }
  workPaint();
  if (mode === "search") {
    const input = /** @type {HTMLInputElement} */ ($("#workFind input"));
    input.value = work.search;
    input.focus();
    if (work.search) void workSearch(work.search);
  } else void workRefresh();
}
// 人明确提交的本机指令；不向模型暴露执行入口，也不声称具备交互式 PTY。
async function workRunCommand(command) {
  if (work.command || !work.root || !command.trim()) return;
  const controller = new AbortController();
  work.command = controller;
  work.terminalText = (work.terminalText + "\n> " + command + "\n").slice(-60000);
  workPaint();
  try {
    const result = await bridge("/api/work/run", { workdir: work.root, command, timeout: 120, sandbox: false }, controller.signal);
    if (work.command !== controller) return;
    work.terminalText += (result.stdout || "") + "\n" + (result.stderr || "") + "\n[" + (result.exitCode ?? "") + "]\n";
  } catch (error) {
    if (work.command !== controller) return;
    work.terminalText += String(error.message || error) + "\n";
  } finally {
    if (work.command === controller) {
      work.command = null;
      work.terminalText = work.terminalText.slice(-60000);
      workPaint();
      void workRefresh();
    }
  }
}
function bindWork() {
  $("#stageWorkBtn").addEventListener("click", () => {
    if (!work.open) return workEnter();
    workLeave();
    stageWake();
  });
  const box = $("#stageWork");
  box.addEventListener("click", event => {
    const target = /** @type {HTMLElement} */ (event.target),
      mode = /** @type {HTMLElement|null} */ (target.closest("[data-work-mode]"));
    if (mode) return void workSwitch(/** @type {any} */ (mode.dataset.workMode));
    if (target.closest("[data-work-pick]")) return void workPick();
    if (target.closest("[data-work-collapse]")) {
      work.collapsed = !work.collapsed;
      return workPaint();
    }
    if (target.closest("[data-work-terminal]")) {
      work.terminal = !work.terminal;
      return workPaint();
    }
    if (target.closest("[data-work-stop]")) return work.command?.abort();
    const close = /** @type {HTMLElement|null} */ (target.closest("[data-work-tab-close]"));
    if (close) return workCloseTab(Number(close.dataset.workTabClose));
    const tab = /** @type {HTMLElement|null} */ (target.closest("[data-work-tab]"));
    if (tab) return workActivate(Number(tab.dataset.workTab), tab);
    const raw = /** @type {HTMLElement|null} */ (target.closest("[data-work-raw]"));
    if (raw && work.tabs[work.active]) {
      work.tabs[work.active].raw = raw.dataset.workRaw === "true";
      return workActivate(work.active, raw);
    }
    const dir = /** @type {HTMLElement|null} */ (target.closest("[data-work-dir]"));
    if (dir) return void (dir.closest("#workCrumbs") ? workEnterDir(dir.dataset.workDir) : workToggleDir(dir.dataset.workDir));
    const file = /** @type {HTMLElement|null} */ (target.closest("[data-work-file]"));
    if (file) return void workOpenPath(file.dataset.workFile, file);
  });
  box.addEventListener("pointerdown", event => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!target.classList.contains("work-resize") || event.button !== 0) return;
    const start = event.clientX,
      width = $(".work-explorer").getBoundingClientRect().width;
    target.setPointerCapture(event.pointerId);
    const move = e => box.style.setProperty("--work-tree-width", Math.max(112, width + e.clientX - start) + "px");
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("lostpointercapture", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("lostpointercapture", end);
    event.preventDefault();
  });
  box.addEventListener("submit", event => {
    const form = /** @type {HTMLFormElement} */ (event.target);
    if (form.id !== "workFind" && form.id !== "workCommand") return;
    event.preventDefault();
    const input = form.querySelector("input");
    if (form.id === "workFind") void workSearch(input.value);
    else if (!work.command && input.value.trim()) {
      void workRunCommand(input.value);
      input.value = "";
    }
  });
  box.addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight"].includes(event.key) && /** @type {HTMLElement} */ (event.target).classList.contains("work-resize")) {
      const width = $(".work-explorer").getBoundingClientRect().width;
      box.style.setProperty("--work-tree-width", Math.max(112, width + (event.key === "ArrowLeft" ? -12 : 12)) + "px");
      event.preventDefault();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest(".work-row"));
    if (!row) return;
    event.preventDefault();
    row.click();
  });
}
