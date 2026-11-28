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
  /** @type {{path:string,diff:boolean,raw:boolean,pinned:boolean}[]} */
  tabs: [],
  active: -1,
  collapsed: false,
  search: "",
  /** @type {WorkRow[]} */
  searchRows: [],
  searchStatus: "",
  terminal: false,
  terminalText: "",
  terminalDir: "",
  terminalWide: false,
  /** @type {string[]} */
  terminalHistory: [],
  terminalHistoryAt: 0,
  terminalDraft: "",
  /** @type {{controller:AbortController, job:{id:string,key:string}|null, stopping:boolean}|null} */
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
  /** @type {string|null} 改动面所属答复 */
  changeReply: null,
  truncated: false,
  error: "",
  /** 画着的是哪一副样子（""/list/empty）：壳子只在换样子时重画 */
  rev: 0
};

// 编辑稿留在本页内存，切换页签、浏览器、对话不会抹去未保存的字。
/** @type {Map<string, {scope:{workdir:string,path:string,roam:boolean}, base:string, text:string, sig:string, saving:boolean, office?:{parts:Record<string,string>, extension:string, labels:string[]}}>} */
const workDrafts = new Map();
function workDirty(path) {
  const draft = workDrafts.get(path);
  return !!draft && draft.base !== draft.text;
}
function workCanEdit(tab) {
  if (!tab || tab.diff) return false;
  return fileKind(tab.path).group === "text" || ["docx", "xlsx", "odt", "ods", "ipynb"].includes(fileExtension(tab.path));
}
function workRenderEditor(tab, trigger = null) {
  const draft = workDrafts.get(tab.path);
  if (!draft) return;
  if (draft.office) {
    const values = JSON.parse(draft.text);
    showInFileViewer(
      tab.path.split("/").pop(),
      '<div class="work-office-editor"><p>' +
        escapeHtml(t("仅可修改列出的文字与单元格；公式、复杂结构及其他内容保持原样。")) +
        "</p>" +
        draft.office.labels
          .map(
            (label, index) =>
              `<label><span>${escapeHtml(label)}</span><input type="text" maxlength="200000" class="work-file-editor-field" data-office-field="${index}" value="${escapeHtml(values[index])}"></label>`
          )
          .join("") +
        "</div>",
      trigger,
      t("览"),
      "stage"
    );
    $("#fileViewerStage .work-office-editor").addEventListener("input", event => {
      const input = /** @type {HTMLInputElement} */ (event.target);
      if (!input.matches("[data-office-field]")) return;
      values[Number(input.dataset.officeField)] = input.value;
      draft.text = JSON.stringify(values);
      workPaintTabs();
    });
    return;
  }
  showInFileViewer(
    tab.path.split("/").pop(),
    '<textarea class="work-file-editor" spellcheck="false" aria-label="' + escapeHtml(t("编辑")) + '"></textarea>',
    trigger,
    t("览"),
    "stage"
  );
  const input = /** @type {HTMLTextAreaElement} */ ($("#fileViewerStage .work-file-editor"));
  input.value = draft.text;
  input.addEventListener("input", () => {
    draft.text = input.value;
    workPaintTabs();
  });
}
async function workToggleEditor() {
  const tab = work.tabs[work.active];
  if (!workCanEdit(tab)) return;
  const draft = workDrafts.get(tab.path);
  if (draft) {
    if (draft.saving) return;
    if (workDirty(tab.path) && !(await askConfirm({ title: t("放弃未保存的修改？"), ok: t("放弃") }))) return;
    if (work.tabs[work.active] !== tab || workDrafts.get(tab.path) !== draft || draft.saving) return;
    workDrafts.delete(tab.path);
    workActivate(work.active);
    return;
  }
  const scope = { workdir: work.root, path: tab.path, roam: false };
  try {
    const extension = fileExtension(tab.path),
      office = ["docx", "xlsx", "odt", "ods"].includes(extension);
    const data = await bridge("/api/work/read", { ...scope, editor: office ? "office" : true }, AbortSignal.timeout(8000));
    if (!work.open || work.tabs[work.active] !== tab || workDrafts.has(tab.path)) return;
    if (typeof data.sig !== "string" || !data.sig) throw Error(t("取回失败"));
    if (office) {
      const { fields } = officeEditorModel(data.parts, extension),
        text = JSON.stringify(fields.map(field => field.value));
      workDrafts.set(tab.path, {
        scope,
        base: text,
        text,
        sig: data.sig,
        saving: false,
        office: { parts: data.parts, extension, labels: fields.map(field => field.label) }
      });
    } else {
      if (typeof data.text !== "string") throw Error(t("取回失败"));
      workDrafts.set(tab.path, { scope, base: data.text, text: data.text, sig: data.sig, saving: false });
    }
    tab.pinned = true;
    workActivate(work.active);
    $("#fileViewerStage .work-file-editor, #fileViewerStage .work-file-editor-field")?.focus();
  } catch (error) {
    toast(t`打开失败：${String(/** @type {any} */ (error).message || error).slice(0, 120)}`);
  }
}
async function workSaveEditor(tab) {
  const draft = tab && workDrafts.get(tab.path);
  if (!draft || draft.saving || !workDirty(tab.path)) return;
  const text = draft.text;
  draft.saving = true;
  try {
    const data = await bridge(
      "/api/work/write",
      {
        ...draft.scope,
        seen: draft.sig,
        ...(draft.office
          ? { editor: "office", parts: officeEditorChanges(draft.office.parts, draft.office.extension, JSON.parse(text)) }
          : { editor: true, content: text })
      },
      AbortSignal.timeout(30000)
    );
    if (data.stale) {
      toast(t("原文件已被修改，未覆盖；请保留编辑稿，确认原件后再改"));
      return;
    }
    if (typeof data.sig !== "string" || !data.sig) throw Error(t("保存失败"));
    draft.sig = data.sig;
    draft.base = text;
    workPaintTabs();
    if (work.open) void workRefresh();
  } catch (error) {
    toast(t`保存失败：${String(/** @type {any} */ (error).message || error).slice(0, 120)}`);
  } finally {
    draft.saving = false;
  }
}

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
  if (!work.open) return;
  if (workFollowConversation()) {
    workPaint();
    if (work.root) void workRefresh();
  } else if (workSyncChangeReply()) {
    workPaint();
    if (work.mode === "changes") void workRefresh();
  }
}
function workEnter() {
  work.open = true;
  workFollowConversation();
  workSyncChangeReply();
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
  for (const [path, draft] of workDrafts) if (!workDirty(path) && !draft.saving) workDrafts.delete(path);
  work.tabs = [];
  work.active = -1;
  work.changeReply = null;
  work.search = "";
  work.searchRows = [];
  work.searchStatus = "";
  workTerminalCancel();
  work.terminalText = "";
  work.terminalDir = "";
  work.terminalHistory = [];
  work.terminalHistoryAt = 0;
  work.terminalDraft = "";
  const input = /** @type {HTMLInputElement|null} */ ($("#workCommand input"));
  if (input) input.value = "";
}
// 仅展开时读取这一层；换根后迟到的结果不再生效。
async function workLoadBranch(path, animate = false) {
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
  if (animate) workPaintBranch(path);
  else workPaint();
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
  if (animate && !previous?.ready && work.open && work.mode === "list" && work.expanded.has(path)) workPaintBranch(path);
  else workPaint();
}
// 仅点开的这一夹开合；后台刷新仍直接画，不让整棵树跟着动。
function workPaintBranch(path) {
  const find = () => $(`#workStrips [data-work-branch="${CSS.escape(path)}"]`),
    before = find(),
    row = before?.querySelector(".work-row"),
    focused = row && document.activeElement === row,
    expanded = row?.getAttribute("aria-expanded");
  morphHeight(before, workPaint, 300, find);
  const next = find()?.querySelector(".work-row");
  if (focused) next?.focus({ preventScroll: true });
  if (!inkMotionOff() && next && expanded !== next.getAttribute("aria-expanded")) {
    const arrow = next.querySelector(".work-chevron"),
      open = next.getAttribute("aria-expanded") === "true";
    arrow?.animate([{ transform: `rotate(${open ? 0 : 90}deg)` }, { transform: `rotate(${open ? 90 : 0}deg)` }], {
      duration: 160,
      easing: "ease"
    });
  }
}
function workToggleDir(path) {
  if (work.expanded.delete(path)) return workPaintBranch(path);
  work.expanded.add(path);
  void workLoadBranch(path, true);
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
    work.searchStatus = limited ? t("搜索范围有限") : work.searchRows.length ? "" : t("没有匹配内容");
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
// 新答开始就撤去旧答的 diff 页签和列表，不动普通文件页签。
function workSyncChangeReply() {
  const id = latestChangeReply(currentConversation())?.id || null;
  if (work.changeReply === id) return false;
  work.changeReply = id;
  const active = work.tabs[work.active];
  if (active?.diff) workCloseViewer();
  work.tabs = work.tabs.filter(tab => !tab.diff);
  work.active = active && !active.diff ? work.tabs.indexOf(active) : -1;
  if (work.mode === "changes") workResetRows();
  return true;
}
// 一层只要一层（depth: 1）；改动直接查这一答碰过的件。
async function workRefresh() {
  workSyncChangeReply();
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
            const info = changeAbsPath(file.path, "")
              ? await bridge("/api/archive/stat", { path: file.path }, AbortSignal.timeout(8000)).catch(() => null)
              : null;
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
/** 这一答的改动与改动条共用统计口径。 */
function workChangedFiles() {
  return changeStats(latestChangeReply(currentConversation())).files.map(({ path, created }) => ({ path, created }));
}
/** @param {Message} message @param {string} path */
function workDiffHtml(message, path) {
  return changeDiffHtml(message, path).replace(
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
    ["search", "搜索", "search"]
  ];
  const buttons = views
    .map(([mode, label, icon]) => {
      return `<button type="button" data-work-mode="${mode}" aria-pressed="${!work.collapsed && work.mode === mode}" title="${t(label)}" aria-label="${t(label)}">${brushIcon(icon)}</button>`;
    })
    .join("");
  return `<div class="stage-views" role="group" aria-label="${t("工作区")}">${buttons}<button type="button" data-work-terminal aria-pressed="${work.terminal}" title="${t("终端")}" aria-label="${t("终端")}">${brushIcon("code")}</button></div>`;
}
function workShellHtml() {
  return `<div class="work-inner"><div class="work-rail">${workViewsHtml()}</div><div class="work-explorer"><div class="work-bar"><div id="workCrumbs" class="library-crumbs"></div><button type="button" data-work-pick title="${t("选择文件夹…")}" aria-label="${t("选择文件夹…")}">${brushIcon("folder")}</button></div><form id="workFind" class="hidden"><input type="search" aria-label="${t("搜索文件内容")}" placeholder="${t("搜索文件内容")}" maxlength="200"><button type="submit" title="${t("搜索")}" aria-label="${t("搜索")}">${brushIcon("search")}</button></form><div id="workStrips" class="work-tree"></div></div><div class="work-resize" role="separator" aria-orientation="vertical" aria-label="${t("调整目录栏宽度")}" tabindex="0"></div><section class="work-editor"><div class="work-tabbar"><div id="workTabs" class="work-tabs" role="tablist"></div><div id="workDocMode" class="work-docmode stage-views"></div></div><div id="workContent" class="work-content">${workEmptyBody(t("选择文件以查看"))}</div>${workTerminalHtml()}</section></div>`;
}
function workTerminalHtml() {
  const button = (action, label, icon) =>
    `<button type="button" data-work-${action} title="${t(label)}" aria-label="${t(label)}">${brushIcon(icon)}</button>`;
  return `<section id="workTerminal" class="work-terminal hidden"><div class="work-terminal-grip" role="separator" aria-orientation="horizontal" aria-label="${t("调整终端高度")}" tabindex="0"></div><div class="work-terminal-head"><span id="workTerminalShell"></span><span class="work-terminal-actions">${button("stop", "停止", "stop")}${button("clear", "清空终端", "strike")}${button("terminal-wide", "展开终端", "wide")}<button type="button" data-work-terminal title="${t("关闭")}" aria-label="${t("关闭")}">×</button></span></div><div id="workTerminalBody" class="work-terminal-body"><pre id="workTerminalOutput"></pre><form id="workCommand"><span id="workTerminalPrompt"></span><input aria-label="${t("输入指令")}" autocomplete="off" spellcheck="false"><button type="submit" title="${t("运行")}" aria-label="${t("运行")}">${brushIcon("play")}</button></form></div></section>`;
}
function workEmptyBody(text) {
  return `<div class="stage-empty work-empty">${brushIcon("folder", "work-leaf")}<span>${escapeHtml(text)}</span></div>`;
}
function workCrumbsHtml() {
  const parts = workParts(work.root),
    crumbs = [];
  if (work.mode === "changes") return t("改动");
  if (work.mode === "search") return t("搜索");
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
    return `<div data-work-branch="${path}"><div class="work-row" role="button" tabindex="0" data-work-dir="${path}" aria-expanded="${expanded}" style="--work-indent:${indent}px" title="${escapeHtml(details)}"><span class="work-chevron">›</span><span>${caseFigure()}</span><strong>${name}</strong></div>${expanded ? `<div class="work-children">${children}${branch?.truncated ? `<small>${t("目录列表已截断")}</small>` : ""}</div>` : ""}</div>`;
  }
  return `<div class="work-row" role="button" tabindex="0" data-work-file="${path}" style="--work-indent:${indent}px" title="${escapeHtml(details)}"><span class="work-chevron"></span><span>${fileFigure(row.name, "", row.state)}</span><span class="work-name"><strong>${name}</strong>${row.where ? `<small>${escapeHtml(row.where)}</small>` : ""}${work.mode === "search" && row.note ? `<small>${escapeHtml(row.note)}</small>` : ""}</span></div>`;
}
function workPaintTabs() {
  const tabs = $("#workTabs"),
    mode = $("#workDocMode");
  if (!tabs || !mode) return;
  const html = work.tabs
    .map((tab, index) => {
      return `<div class="work-tab${tab.pinned ? "" : " work-tab-preview"}"><button type="button" role="tab" data-work-tab="${index}" title="${escapeHtml(tab.path + (tab.pinned ? "" : " · " + t("双击或 Shift+Enter 固定页签")) + (!tab.diff && workDirty(tab.path) ? " · " + t("未保存") : ""))}">${tab.diff ? brushIcon("workdiff") : fileFigure(tab.path.split("/").pop())}<span>${escapeHtml(tab.path.split("/").pop())}</span>${!tab.diff && workDirty(tab.path) ? '<i class="work-dirty-dot" aria-hidden="true"></i>' : ""}</button><button type="button" data-work-tab-close="${index}" aria-label="${t("关闭")}">×</button></div>`;
    })
    .join("");
  stageSetHtml(tabs, html);
  for (const button of tabs.querySelectorAll("[data-work-tab]")) {
    const selected = Number(/** @type {HTMLElement} */ (button).dataset.workTab) === work.active;
    button.setAttribute("aria-selected", String(selected));
    button.parentElement.classList.toggle("on", selected);
  }
  const active = work.tabs[work.active],
    kind = active && fileKind(active.path).view;
  const editing = active && !active.diff && workDrafts.has(active.path);
  let views = "";
  if (active && !active.diff && !editing && (kind === "markdown" || kind === "html")) {
    views = `<button type="button" data-work-raw="false" aria-pressed="${!active.raw}" title="${t("预览")}" aria-label="${t("预览")}">${brushIcon("preview")}</button><button type="button" data-work-raw="true" aria-pressed="${active.raw}" title="${t("源码")}" aria-label="${t("源码")}">${brushIcon("code")}</button>`;
  }
  let edit = "";
  if (workCanEdit(active)) {
    edit = `<button type="button" data-work-edit aria-pressed="${!!editing}" title="${t("编辑")} · Ctrl/⌘+S" aria-label="${t("编辑")}">${brushIcon("edit")}</button>`;
  }
  stageSetHtml(mode, views + edit);
}
// 目录树重画（展开回包、工具刷新）时记住焦点落在哪一行：整树换掉后焦点会掉到 body，键盘的下一步就从别处开始了。
// 只认稳定的路径；重画前焦点已经移到工作区之外（点了工具栏、输入框）就不抢回来。
function workFocusKey() {
  const row = document.activeElement?.closest?.("#workStrips .work-row");
  if (!row) return null;
  if (row.dataset.workFile) return { file: row.dataset.workFile };
  if (row.dataset.workDir) return { dir: row.dataset.workDir };
  return null;
}
function workRestoreFocus(key) {
  if (!key) return;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return;
  const row = key.file
    ? document.querySelector(`#workStrips .work-row[data-work-file="${CSS.escape(key.file)}"]`)
    : document.querySelector(`#workStrips .work-row[data-work-dir="${CSS.escape(key.dir)}"]`);
  row?.focus({ preventScroll: true });
}
function workPaint() {
  const box = $("#stageWork");
  if (!box) return;
  const focus = workFocusKey();
  $("#stageWorkBtn").setAttribute("aria-pressed", String(work.open));
  box.classList.toggle("hidden", !work.open);
  if (!work.open) return;
  if (!$("#workContent")) box.innerHTML = workShellHtml();
  box.classList.toggle("work-collapsed", work.collapsed);
  $(".work-explorer").inert = work.collapsed;
  $(".work-resize").inert = work.collapsed;
  box.classList.toggle("work-find-mode", work.mode !== "list");
  stageSetHtml($("#workCrumbs"), workCrumbsHtml());
  $("#workFind").classList.toggle("hidden", work.mode !== "search");
  const rows = workRows();
  let empty = t("此层尚空");
  if (work.mode === "search") empty = work.searchStatus;
  else if (work.error) empty = t`目录不可用：${work.error}`;
  else if (!work.root && work.mode === "list") empty = t("选择文件夹…");
  else if (!work.full) empty = t("正在翻…");
  else if (work.mode === "changes") empty = t("这一答还没改过文件");
  const body = rows.length ? rows.map(row => workRowHtml(row)).join("") : `<small class="work-tree-note">${escapeHtml(empty)}</small>`;
  let notice = "";
  if (work.mode === "list" && work.truncated) notice = t("目录列表已截断");
  else if (work.mode === "search" && rows.length && work.searchStatus) notice = work.searchStatus;
  stageSetHtml($("#workStrips"), body + (notice ? `<small class="work-tree-note">${escapeHtml(notice)}</small>` : ""));
  // 选中态就地更新：首次点击不能替换目录行，否则浏览器可能丢掉紧随的双击。
  const active = work.tabs[work.active];
  for (const row of document.querySelectorAll("#workStrips [data-work-file]")) {
    const selected = active?.path === /** @type {HTMLElement} */ (row).dataset.workFile && active.diff === (work.mode === "changes");
    row.setAttribute("aria-current", String(selected));
  }
  for (const button of document.querySelectorAll("#stageWork [data-work-mode]")) {
    const el = /** @type {HTMLElement} */ (button);
    el.setAttribute("aria-pressed", String(!work.collapsed && el.dataset.workMode === work.mode));
  }
  workTerminalPaint();
  workPaintTabs();
  workRestoreFocus(focus);
}
function workActivate(index, trigger = null) {
  const tab = work.tabs[index];
  if (!tab || !work.open) return;
  work.active = index;
  workPaint();
  if (tab.diff) {
    const message = latestChangeReply(currentConversation());
    if (!message) return;
    showInFileViewer(t`${tab.path} · 这一答的改动`, workDiffHtml(message, tab.path), trigger, t("览"), "stage");
  } else if (workDrafts.has(tab.path)) workRenderEditor(tab, trigger);
  else void openFileViewer({ file: tab.path }, "", trigger, "stage", tab.raw);
}
// 单击只占一张临时页签；双击固定后，才为下一次查看留出新的临时页签。
function workOpenPath(path, trigger = null, pin = false) {
  if (!work.open || !path) return;
  const diff = work.mode === "changes";
  let index = work.tabs.findIndex(tab => tab.path === path && tab.diff === diff);
  if (index < 0) {
    index = pin ? -1 : work.tabs.findIndex(tab => !tab.pinned);
    const tab = { path, diff, raw: false, pinned: pin || (!diff && workDrafts.has(path)) };
    if (index < 0) {
      index = work.tabs.length;
      work.tabs.push(tab);
    } else work.tabs[index] = tab;
  } else if (pin) {
    work.tabs[index].pinned = true;
    if (index === work.active) return workPaint();
  }
  workActivate(index, trigger);
}
function workPinTab(index) {
  const tab = work.tabs[index];
  if (!tab || tab.pinned) return;
  tab.pinned = true;
  workPaint();
}
function workCloseTab(index) {
  const tab = work.tabs[index];
  if (!tab) return;
  const draft = tab.diff ? null : workDrafts.get(tab.path);
  if (draft?.saving) return;
  if (draft && workDirty(tab.path)) {
    void askConfirm({ title: t("放弃未保存的修改？"), ok: t("放弃") }).then(ok => {
      const current = work.tabs.indexOf(tab);
      if (!ok || current < 0 || workDrafts.get(tab.path) !== draft || draft.saving) return;
      workDrafts.delete(tab.path);
      workCloseTab(current);
    });
    return;
  }
  if (draft) workDrafts.delete(tab.path);
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
  if (work.mode === mode && !work.collapsed) {
    work.collapsed = true;
    return workPaint();
  }
  // 同一种面折叠后再展开：只把这一面露出来并交回焦点，输入框里没提交的字与已经搜过的那一轮都照旧。
  const same = work.mode === mode;
  work.collapsed = false;
  if (!same) {
    work.mode = mode;
    workResetRows();
  }
  workPaint();
  if (mode === "search") {
    const input = /** @type {HTMLInputElement} */ ($("#workFind input"));
    if (!same) {
      input.value = work.search;
      if (work.search) void workSearch(work.search);
    }
    input.focus();
  } else if (!same) void workRefresh();
}
// 终端只是用户独立的命令区；每次仍由原有 shell 执行，不假装支持 PTY。
function workTerminalCwd() {
  return work.terminalDir || work.root;
}
function workTerminalPromptText() {
  const cwd = workTerminalCwd();
  if (!cwd) return ">";
  return bootstrap.work?.platform === "win32" ? "PS " + cwd.replace(/\//g, "\\") + ">" : cwd + " $";
}
function workTerminalPaint() {
  $(".work-rail [data-work-terminal]").setAttribute("aria-pressed", String(work.terminal));
  const terminal = $("#workTerminal"),
    wide = work.terminal && work.terminalWide;
  terminal.classList.toggle("hidden", !work.terminal);
  terminal.inert = !work.terminal;
  $("#stageWork").classList.toggle("work-terminal-wide", wide);
  $("#workContent").inert = wide;
  $(".work-tabbar").inert = wide;
  const shell = $("#workTerminalShell");
  shell.textContent = bootstrap.work?.shell || t("终端");
  const output = $("#workTerminalOutput"),
    body = $("#workTerminalBody"),
    follow = body.scrollHeight - body.scrollTop - body.clientHeight < 32;
  if (output.textContent !== work.terminalText) {
    output.textContent = work.terminalText;
    if (follow) body.scrollTop = body.scrollHeight;
  }
  const prompt = $("#workTerminalPrompt");
  prompt.textContent = work.command ? "…" : workTerminalPromptText();
  prompt.title = workTerminalCwd();
  const input = /** @type {HTMLInputElement} */ ($("#workCommand input"));
  input.readOnly = !!work.command;
  input.disabled = !work.root;
  $("#workCommand button").disabled = !!work.command || !work.root;
  $("[data-work-stop]").disabled = !work.command || work.command.stopping;
  $("[data-work-clear]").disabled = !work.terminalText;
  $("[data-work-terminal-wide]").setAttribute("aria-pressed", String(work.terminalWide));
}
function workTerminalAppend(text) {
  work.terminalText = (work.terminalText + text).slice(-60000);
  if (work.open && $("#workTerminal")) workTerminalPaint();
}
function workTerminalCancel() {
  const state = work.command;
  if (!state) return;
  work.command = null;
  state.controller.abort();
  if (state.job) void bridge("/api/work/check", { ...state.job, stop: true }, AbortSignal.timeout(8000)).catch(() => {});
}
function workTerminalStop() {
  const state = work.command;
  if (!state || state.stopping) return;
  state.stopping = true;
  if (!state.job) state.controller.abort();
  workTerminalPaint();
}
// 仅独立 cd 的字面目录在前端会话里延续，不模拟变量、管道、复合脚本或 shell 全局状态。
function workTerminalCd(command) {
  const match = /^(?:cd|chdir|set-location)\s+(.+)$/i.exec(command.trim());
  if (!match || (bootstrap.work?.platform !== "win32" && !/^cd\s/.test(command.trim()))) return null;
  let raw = match[1].trim();
  if (/^(['"]).*\1$/.test(raw)) raw = raw.slice(1, -1);
  else if (/\s/.test(raw)) return null;
  if (!raw || /^-/.test(raw) || /[\r\n'"`$;&|<>*?()]/.test(raw)) return null;
  if (bootstrap.work?.platform !== "win32" && raw.includes("\\")) return null;
  return raw;
}
function workTerminalRecall(direction, input) {
  const history = work.terminalHistory;
  if (!history.length) return;
  if (work.terminalHistoryAt === history.length) work.terminalDraft = input.value;
  work.terminalHistoryAt = Math.max(0, Math.min(history.length, work.terminalHistoryAt + direction));
  input.value = history[work.terminalHistoryAt] ?? work.terminalDraft;
  input.setSelectionRange(input.value.length, input.value.length);
}
async function workRunCommand(command) {
  command = command.trim();
  const cwd = workTerminalCwd();
  if (work.command || !cwd || !command) return;
  if (work.terminalHistory.at(-1) !== command) work.terminalHistory = [...work.terminalHistory, command].slice(-100);
  work.terminalHistoryAt = work.terminalHistory.length;
  work.terminalDraft = "";
  const prompt = workTerminalPromptText(),
    state = { controller: new AbortController(), job: null, stopping: false };
  work.command = state;
  const signal = state.controller.signal;
  workTerminalAppend((work.terminalText && !work.terminalText.endsWith("\n") ? "\n" : "") + prompt + " " + command + "\n");
  if (work.open) $("#workTerminalBody").scrollTop = $("#workTerminalBody").scrollHeight;
  try {
    const cd = workTerminalCd(command);
    if (cd !== null) {
      const result = await bridge(
        "/api/work/terminal-dir",
        { workdir: cwd, path: cd },
        AbortSignal.any([signal, AbortSignal.timeout(8000)])
      );
      if (work.command === state) work.terminalDir = slashed(result.workdir);
      return;
    }
    let result = await bridge(
      "/api/work/run",
      { workdir: cwd, command, background: true, terminal: true, sandbox: false },
      AbortSignal.any([signal, AbortSignal.timeout(8000)])
    );
    if (result.id && result.key) state.job = { id: result.id, key: result.key };
    if (work.command !== state) {
      if (state.job && result.running)
        void bridge("/api/work/check", { ...state.job, stop: true }, AbortSignal.timeout(8000)).catch(() => {});
      return;
    }
    for (;;) {
      // 桥接在终端模式交的是按到达先后合成的同一条流；stdout 为空时才退回 stderr（旧桥接）。
      workTerminalAppend(result.stdout || result.stderr || "");
      // 进程退了不等于输出交齐：桥接一次只交一段，还有后续就接着领（见 backgroundReport 的 more）。
      if (!result.running && !result.more) break;
      if (!state.job) throw Error(t("终端指令编号已失效"));
      result = await bridge(
        "/api/work/check",
        { ...state.job, stop: state.stopping, wait: state.stopping ? 0 : 1 },
        AbortSignal.any([signal, AbortSignal.timeout(8000)])
      );
      if (work.command !== state) return;
    }
    // 自然退出、确认停止与结果未知分开报：点停止时若进程已自己退了，回执里没有 stopped，不能一律写成「已停止」。
    const status = result.timedOut ? t("执行超时") : result.stopped ? t("已停止") : t`退出码：${result.exitCode}`;
    workTerminalAppend((work.terminalText.endsWith("\n") ? "" : "\n") + "[" + status + "]\n");
  } catch (error) {
    if (work.command !== state) return;
    if (state.job) void bridge("/api/work/check", { ...state.job, stop: true }, AbortSignal.timeout(8000)).catch(() => {});
    workTerminalAppend((state.stopping ? t("停止请求已发出，结果未知") : String(error.message || error)) + "\n");
  } finally {
    if (work.command === state) {
      work.command = null;
      if (work.open) {
        workTerminalPaint();
        void workRefresh();
      }
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
  window.addEventListener("beforeunload", event => {
    if (![...workDrafts.keys()].some(workDirty)) return;
    event.preventDefault();
    event.returnValue = "";
  });
  box.addEventListener("click", event => {
    const target = /** @type {HTMLElement} */ (event.target),
      mode = /** @type {HTMLElement|null} */ (target.closest("[data-work-mode]"));
    if (mode) return void workSwitch(/** @type {any} */ (mode.dataset.workMode));
    if (target.closest("[data-work-pick]")) return void workPick();
    if (target.closest("[data-work-terminal]")) {
      work.terminal = !work.terminal;
      workPaint();
      if (work.terminal) $("#workCommand input").focus();
      return;
    }
    if (target.closest("[data-work-stop]")) return workTerminalStop();
    if (target.closest("[data-work-clear]")) {
      work.terminalText = "";
      return workTerminalPaint();
    }
    if (target.closest("[data-work-terminal-wide]")) {
      work.terminalWide = !work.terminalWide;
      return workTerminalPaint();
    }
    const close = /** @type {HTMLElement|null} */ (target.closest("[data-work-tab-close]"));
    if (close) return workCloseTab(Number(close.dataset.workTabClose));
    const tab = /** @type {HTMLElement|null} */ (target.closest("[data-work-tab]"));
    if (tab) return workActivate(Number(tab.dataset.workTab), tab);
    if (target.closest("[data-work-edit]")) return void workToggleEditor();
    const raw = /** @type {HTMLElement|null} */ (target.closest("[data-work-raw]"));
    if (raw && work.tabs[work.active]) {
      work.tabs[work.active].raw = raw.dataset.workRaw === "true";
      return workActivate(work.active, raw);
    }
    const dir = /** @type {HTMLElement|null} */ (target.closest("[data-work-dir]"));
    if (dir) return void (dir.closest("#workCrumbs") ? workEnterDir(dir.dataset.workDir) : workToggleDir(dir.dataset.workDir));
    const file = /** @type {HTMLElement|null} */ (target.closest("[data-work-file]"));
    if (file) return void workOpenPath(file.dataset.workFile, file, event.detail > 1);
  });
  box.addEventListener("dblclick", event => {
    const target = /** @type {HTMLElement} */ (event.target),
      file = /** @type {HTMLElement|null} */ (target.closest("[data-work-file]")),
      tab = /** @type {HTMLElement|null} */ (target.closest("[data-work-tab]"));
    if (file) workOpenPath(file.dataset.workFile, file, true);
    else if (tab) workPinTab(Number(tab.dataset.workTab));
  });
  box.addEventListener("pointerdown", event => {
    const target = /** @type {HTMLElement} */ (event.target);
    const vertical = target.classList.contains("work-terminal-grip");
    if ((!vertical && !target.classList.contains("work-resize")) || event.button !== 0) return;
    if (vertical && work.terminalWide) return;
    const start = vertical ? event.clientY : event.clientX,
      width = vertical ? $("#workTerminal").getBoundingClientRect().height : $(".work-explorer").getBoundingClientRect().width;
    target.setPointerCapture(event.pointerId);
    const move = e =>
      box.style.setProperty(
        vertical ? "--work-terminal-height" : "--work-tree-width",
        Math.max(112, width + (vertical ? start - e.clientY : e.clientX - start)) + "px"
      );
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("lostpointercapture", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("lostpointercapture", end);
    event.preventDefault();
  });
  box.addEventListener("input", event => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.matches("#workFind input") && !input.value.trim()) void workSearch("");
  });
  box.addEventListener("submit", event => {
    const form = /** @type {HTMLFormElement} */ (event.target);
    if (form.id !== "workFind" && form.id !== "workCommand") return;
    event.preventDefault();
    const input = form.querySelector("input");
    if (form.id === "workFind") void workSearch(input.value);
    else if (!work.command && input.value.trim()) {
      const command = input.value;
      input.value = "";
      void workRunCommand(command);
    }
  });
  box.addEventListener("keydown", event => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (event.isComposing) return;
    const active = work.tabs[work.active];
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "s" &&
      active &&
      !active.diff &&
      workDrafts.has(active.path) &&
      !input.matches("#workCommand input")
    ) {
      event.preventDefault();
      void workSaveEditor(active);
      return;
    }
    if (input.matches("#workCommand input")) {
      if (
        event.ctrlKey &&
        event.key.toLowerCase() === "c" &&
        work.command &&
        input.selectionStart === input.selectionEnd &&
        !window.getSelection()?.toString()
      ) {
        event.preventDefault();
        workTerminalStop();
      } else if (
        !work.command &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        ["ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        workTerminalRecall(event.key === "ArrowUp" ? -1 : 1, input);
      } else if (event.ctrlKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        work.terminalText = "";
        workTerminalPaint();
      }
      return;
    }
    if (input.classList.contains("work-terminal-grip") && ["ArrowUp", "ArrowDown"].includes(event.key) && !work.terminalWide) {
      event.preventDefault();
      box.style.setProperty(
        "--work-terminal-height",
        Math.max(112, $("#workTerminal").getBoundingClientRect().height + (event.key === "ArrowUp" ? 16 : -16)) + "px"
      );
      return;
    }
    if (["ArrowLeft", "ArrowRight"].includes(event.key) && /** @type {HTMLElement} */ (event.target).classList.contains("work-resize")) {
      const width = $(".work-explorer").getBoundingClientRect().width;
      box.style.setProperty("--work-tree-width", Math.max(112, width + (event.key === "ArrowLeft" ? -12 : 12)) + "px");
      event.preventDefault();
      return;
    }
    // 临时页签的键盘固定：Enter 仍只是选签（浏览器对按钮的默认激活），Shift+Enter 才固定，与双击同一条路。
    const tabButton = /** @type {HTMLElement|null} */ (event.target)?.closest?.("[data-work-tab]");
    if (tabButton && event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      return workPinTab(Number(tabButton.dataset.workTab));
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest(".work-row"));
    if (!row) return;
    event.preventDefault();
    if (event.key === "Enter" && row.dataset.workFile) workOpenPath(row.dataset.workFile, row, true);
    else row.click();
  });
}
