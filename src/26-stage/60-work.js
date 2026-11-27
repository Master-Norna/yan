// 言 · 游目 · 工作区：舞台上的一层，看某一处目录里的东西。
// 簿录（列、件图、夹、路径）就是卷宗那一套（src/13-files/10-archive.js），这里只换三样：根可换（地址行里输路径，
// 或点空态里那枚「选择文件夹」）、不收入不改名也不设分类签；有对话目录则跟随，未绑时沿用本机记的 yan-work-root。
// 点一件即开：夹往下走，件交给游目去开（Office 摊成文档页、md 排出来、网页直接开，见 30-input.js 的 stageGo）。
// 「改动」那一面只看本段对话改过的件：不说增删改、也不写 +几 −几——件图本身换色（朱是删、泥金是改、石绿是增）。
// 顶栏那一枚（#stageWorkBtn）只管进出、不表态；这一对（工作区 / 改动）里选着的那一枚才转朱，画面上任何时候只有一处朱。
const work = {
  open: false,
  /** @type {string} 绑的目录，也是此刻站着的那一层（绝对路径，正斜杠） */
  root: "",
  /** @type {string|null} 当前对话及其绑定目录的标记；同一段里走层不重置 */
  context: null,
  bound: "",
  /** @type {"list"|"changes"} */
  mode: "list",
  /** @type {{ path: string, name: string, size: number, modifiedAt: string }[]} 这一层的件，路径相对根 */
  entries: [],
  /** @type {{ path: string, name: string }[]} 夹，同上 */
  dirs: [],
  /** 改动涉及的路径已查完 */
  full: false,
  /** @type {Map<string, { kind: string, size?: number, modifiedAt?: string } | null>} */
  changeEntries: new Map(),
  truncated: false,
  error: "",
  /** 画着的是哪一副样子（""/list/empty）：壳子只在换样子时重画 */
  shape: "",
  rev: 0
};

/** 绑过的目录记在本机（同侧栏宽窄、缩放：不随备份走）。从前那一版在 POSIX 上会把根写成相对的（点路径里的一级），
 * 那样的留着也列不出来，当作没绑，请人重选一处 */
function workStored() {
  try {
    const root = slashed(localStorage.getItem("yan-work-root") || "");
    return /^([a-z]:\/|\/)/i.test(root) ? root : "";
  } catch {
    return "";
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
/** 根与一条相对的路拼起来：根是 / 时不写成一加一的后斜杠 */
function workJoin(root, rel) {
  const base = slashed(root);
  return base.endsWith("/") ? `${base}${rel}` : `${base}/${rel}`;
}
/** 上一层：第一级不再往上（/ 与盘符都不能当工作目录，去了只会报错）；POSIX 开头那一道斜杠由 parentDir 原样留着 */
function workUp(path) {
  return workParts(path).length > 1 ? parentDir(slashed(path)) : "";
}
/** 地址行里写的那一句：这一层叫什么，前头是它所在的那一路 */
function workAddrHtml() {
  if (!work.root) return `<b>${t("尚未绑目录")}</b>`;
  const parts = workParts(work.root),
    here = parts.pop() || work.root,
    rest = parts.join("/");
  return `<b>${escapeHtml(here)}</b>${rest ? `<i aria-hidden="true">›</i>${escapeHtml(rest)}` : ""}`;
}
/** 这一层的路径（条子上的、地址行里改的，都用它） */
function workHere() {
  return work.root;
}
// 对话已有工作目录就用它，不另绑、不改对话；切换对话或重新绑定时才回到根。
function workFollowConversation() {
  const c = currentConversation(),
    bound = slashed(c?.workdir || ""),
    context = JSON.stringify([c?.id || "", bound]);
  if (work.context === context) return false;
  work.context = context;
  work.bound = bound;
  work.root = bound || workStored();
  workResetRows();
  work.mode = "list";
  work.shape = "";
  return true;
}
// render() 在切换对话、绑定或解绑目录时都会走到这里；平时重画只比一个标记，不读盘。
function workSyncConversation() {
  if (!work.open || !workFollowConversation()) return;
  if (document.activeElement === $("#stageUrl")) $("#stageUrl").blur();
  stageRender();
  if (work.root) void workRefresh();
}
function workEnter() {
  work.open = true;
  workFollowConversation();
  // 进工作区先把画面收着：网页在屏幕外照旧开着，回网页时再接上
  if (stage.session || stage.attached) void stageDetach();
  workPaint();
  stageRender();
  if (work.root) void workRefresh();
  else void workPick();
}
/** 收起这一层、回到网页；画面交给调用它的那一步去接（点签换页时自己会接，见 30-input.js） */
function workHide() {
  if (!work.open) return;
  work.open = false;
  // 前后两枚还原成浏览器记的那一份（见 00-connect.js 的 stageReadHistory）
  /** @type {HTMLButtonElement} */ ($("[data-stage-nav=back]")).disabled = !stage.back;
  /** @type {HTMLButtonElement} */ ($("[data-stage-nav=forward]")).disabled = !stage.forward;
  workPaint();
  stageRender();
}
function workLeave() {
  if (!work.open) return;
  workHide();
  stageWake();
}
/** 选一处目录：系统的选夹子窗（与卷宗「收入文件」同一个口，见 server/work/picker.js） */
async function workPick() {
  const context = work.context,
    root = work.root;
  try {
    const { paths } = await bridge("/api/work/pick", {});
    if (!paths?.[0] || !work.open || work.context !== context || work.root !== root) return;
    work.root = slashed(paths[0]);
    workResetRows();
    work.mode = "list";
    workRemember();
    workPaint();
    stageRender();
    await workRefresh();
  } catch (error) {
    toast(t`打开失败：${String(/** @type {any} */ (error).message || error).slice(0, 80)}`);
  }
}
/** 去某一层：点路径里的一级、点回上一层、地址行里输的，都走这一条 */
function workEnterDir(path) {
  const root = slashed(String(path || ""));
  if (!root || root === work.root) return;
  work.root = root;
  workResetRows();
  work.mode = "list";
  workRemember();
  workPaint();
  stageRender();
  void workRefresh();
}
// 本机记的只是未绑定对话时的浏览位置，不能被另一段对话的目录覆盖。
function workRemember() {
  if (work.bound) return;
  try {
    localStorage.setItem("yan-work-root", work.root);
  } catch {}
}
// ---------- 列 ----------
// 换根或换面时，旧列表不可拿新根拼路径；在发出新请求前就使旧请求失效。
function workResetRows() {
  ++work.rev;
  work.entries = [];
  work.dirs = [];
  work.changeEntries.clear();
  work.full = false;
  work.truncated = false;
  work.error = "";
}
// 一层只要一层（depth: 1）；改动直接查本段对话碰过的件。
async function workRefresh() {
  if (!work.root) return;
  const rev = ++work.rev;
  try {
    if (work.mode === "changes") {
      const files = workChangedFiles().filter(file => relInside(work.root, file.path)),
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
    work.error = "";
  } catch (error) {
    if (rev !== work.rev) return;
    work.entries = [];
    work.dirs = [];
    work.full = false;
    work.error = String(/** @type {any} */ (error).message || error).slice(0, 160);
  }
  workPaint();
}
/** 一条簿录 @typedef {{ dir: boolean, name: string, path: string, where?: string, note?: string, size?: number|null, when?: string, state?: string }} WorkRow */
/** 本段对话改过的件：按路径并成一份，新建过的记着 */
function workChangedFiles() {
  const files = new Map(),
    /** @type {Conversation|null} */
    conversation = currentConversation?.() || null;
  for (const message of conversation?.messages || [])
    for (const file of changeStats(message).files) {
      const entry = files.get(file.path) || { path: file.path, created: false };
      entry.created ||= !!file.created;
      files.set(file.path, entry);
    }
  return [...files.values()];
}
/** 改动那一面的条子：新建的是石绿、还在的是泥金、盘上已经没有的是朱（大小、日子照现有那一份，删掉的留空） @returns {WorkRow[]} */
function workChangeRows() {
  if (!work.full) return [];
  const rows = [];
  for (const file of workChangedFiles()) {
    const rel = relInside(work.root, file.path);
    if (!rel) continue;
    const entry = work.changeEntries.get(file.path),
      cut = file.path.lastIndexOf("/");
    rows.push({
      dir: false,
      name: cut < 0 ? file.path : file.path.slice(cut + 1),
      where: cut < 0 ? "" : parentDir(rel),
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
  return [
    ...work.dirs
      .map(dir => ({ dir: true, name: dir.name, path: workJoin(work.root, dir.path), note: "", when: "" }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    ...work.entries.map(entry => ({
      dir: false,
      name: entry.name,
      path: workJoin(work.root, entry.path),
      where: "",
      size: entry.size,
      when: formatDay(entry.modifiedAt),
      state: ""
    }))
  ];
}
// ---------- 画 ----------
function workViewsHtml() {
  return `<div class="stage-views" role="group" aria-label="${t("看整层还是看改动")}"><button type="button" data-work-mode="list" aria-pressed="${work.mode === "list"}" title="${t("工作区：这一层的东西")}" aria-label="${t("工作区")}">${brushIcon("worktree")}</button><button type="button" data-work-mode="changes" aria-pressed="${work.mode === "changes"}" title="${t("改动：本段对话改过的")}" aria-label="${t("改动")}">${brushIcon("workdiff")}</button></div>`;
}
function workShellHtml() {
  return `<div class="work-inner"><div class="work-bar"><div id="workCrumbs" class="library-crumbs"></div>${workViewsHtml()}</div><div id="workStrips" class="strips"></div></div>`;
}
function workEmptyHtml() {
  return `<div class="work-inner"><div class="work-bar work-bar-empty">${workViewsHtml()}</div><div class="work-empty"><p>${t("这一处还没有绑目录")}</p><button type="button" data-work-pick>${t("选择文件夹…")}</button></div></div>`;
}
/** 路径：一层一枚键，点哪一级去哪一级（整条是绝对路径，越出原先那一处也只是换根，仍是这一层）。
 * 超过四级的，中间并成一枚「…」：窄到三百来像素时，开头与末尾仍看得见 */
function workCrumbsHtml() {
  const parts = workParts(work.root),
    crumbs = [];
  if (!parts.length) return `<span class="here" title="${escapeHtml(work.root)}">${escapeHtml(work.root)}</span>`;
  if (parts.length > 4) crumbs.push({ name: parts[0], at: workAt(work.root, parts, 1) }, { name: "…", at: "" });
  for (let i = parts.length > 4 ? parts.length - 2 : 0; i < parts.length; i++)
    crumbs.push({ name: parts[i], at: workAt(work.root, parts, i + 1) });
  return crumbs
    .map((crumb, i) => {
      const sep = i ? `<span class="sep" aria-hidden="true">›</span>` : "";
      if (i === crumbs.length - 1) return `${sep}<span class="here" title="${escapeHtml(crumb.at)}">${escapeHtml(crumb.name)}</span>`;
      if (!crumb.at) return `${sep}<span class="sep" aria-hidden="true">…</span>`;
      return `${sep}<button type="button" data-work-dir="${escapeHtml(crumb.at)}" title="${escapeHtml(crumb.at)}">${escapeHtml(crumb.name)}</button>`;
    })
    .join("");
}
/** @param {WorkRow} row */
function workRowHtml(row) {
  if (row.dir)
    return `<div class="strip dir" role="button" tabindex="0" data-work-dir="${escapeHtml(row.path)}" title="${t`打开 ${escapeHtml(row.name)}`}"><span>${caseFigure()}</span><span class="strip-name"><strong>${escapeHtml(row.name)}</strong></span><span class="strip-note">${escapeHtml(row.note || "")}</span><span class="strip-date"><span class="strip-when"></span></span></div>`;
  const where = row.where ? `<span class="dir">${escapeHtml(row.where)}/</span>` : "",
    size = row.size === null || row.size === undefined ? "" : escapeHtml(formatFileSize(row.size));
  // 删掉的件不再向盘上取缩略（取也取不到），只留那一片换过色的纸
  return `<div class="strip file" role="button" tabindex="0" data-work-file="${escapeHtml(row.path)}" title="${escapeHtml(row.path)}"><span>${fileFigure(row.name, row.state === "del" ? "" : row.path, row.state)}</span><span class="strip-name"><strong>${where}${escapeHtml(row.name)}</strong></span><span>${size}</span><span class="strip-date"><span class="strip-when">${escapeHtml(row.when || "")}</span></span></div>`;
}
function workPaint() {
  const box = $("#stageWork"),
    view = $("#stageView");
  if (!box) return;
  view.classList.toggle("work", work.open);
  box.classList.toggle("hidden", !work.open);
  if (!work.open) {
    work.shape = "";
    return;
  }
  const shape = work.root ? "list" : "empty";
  if (work.shape !== shape) {
    work.shape = shape;
    box.innerHTML = shape === "list" ? workShellHtml() : workEmptyHtml();
    return;
  }
  if (shape !== "list") return;
  // 工作区里前后按目录走：还有上一层就能退，前进没有去处（离开这一层时 workHide 按浏览器记的还原）
  const up = workUp(work.root);
  /** @type {HTMLButtonElement} */ ($("[data-stage-nav=back]")).disabled = !up;
  /** @type {HTMLButtonElement} */ ($("[data-stage-nav=forward]")).disabled = true;
  const rows = workRows();
  stageSetHtml($("#workCrumbs"), workCrumbsHtml());
  const back = up
      ? `<button type="button" class="strip-back" data-work-dir="${escapeHtml(up)}" title="${t("回上一层")}" aria-label="${t("回上一层")}">‹</button>`
      : "",
    empty = work.error
      ? t`目录不可用：${work.error}`
      : work.mode === "changes" && !work.full
        ? t("正在翻…")
        : work.mode === "changes"
          ? t("本段对话还没改过文件")
          : t("此层尚空"),
    body = rows.length
      ? `<div class="strip-cols"><span>${back}</span><span>${t("名目")}</span><span>${t("大小")}</span><span>${t("日期")}</span></div>${rows.map(workRowHtml).join("")}`
      : `${back ? `<div class="strip-cols"><span>${back}</span></div>` : ""}<div class="library-empty">${escapeHtml(empty)}</div>`;
  stageSetHtml($("#workStrips"), body);
  for (const button of document.querySelectorAll("#workCrumbs [data-work-dir], #stageWork [data-work-mode]")) {
    const el = /** @type {HTMLElement} */ (button);
    if (el.dataset.workMode) el.setAttribute("aria-pressed", String(el.dataset.workMode === work.mode));
  }
}
// ---------- 动手 ----------
/** 点开一件：离开这一层交给游目去开（Office 摊文档、md 排出来、网页直接开，都是 stageGo 的老路） */
async function workOpenPath(path) {
  if (!path) return;
  workHide();
  if (!stage.ws) {
    await stageLocate().catch(() => {});
    if (!stage.ws) {
      await stageLaunch();
      if (!stage.ws) {
        // 浏览器起不来：还留在原处，别把人晾在一片空白上
        work.open = true;
        workPaint();
        stageRender();
        return;
      }
    }
  }
  stageGo(path);
}
/** 地址行里输的一句话落到工作区：目录即换到那一层，件即交给游目去开；不像路径的仍照网址、搜索办 */
async function workGo(raw) {
  const text = String(raw || "").trim();
  if (!text) return;
  let path = "";
  if (/^file:/i.test(text)) {
    try {
      path = decodeURIComponent(new URL(text).pathname).replace(/^\/([a-z]:)/i, "$1");
    } catch {
      path = "";
    }
  } else if (/^([a-z]:[\\/]|\/(?!\/))/i.test(text)) path = text;
  if (!path) {
    workLeave();
    return void stageGo(text);
  }
  const context = work.context,
    root = work.root;
  try {
    const info = await bridge("/api/archive/stat", { path: slashed(path) });
    if (!work.open || work.context !== context || work.root !== root) return;
    if (info.kind === "dir") return void workEnterDir(info.path);
    if (info.kind === "file") return void workOpenPath(info.path);
    toast(t`没有这一处：${path}`);
  } catch (error) {
    toast(t`打开失败：${String(/** @type {any} */ (error).message || error).slice(0, 80)}`);
  }
}
function workSwitch(mode) {
  if (work.mode === mode) return;
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
    if (file) return void workOpenPath(file.dataset.workFile);
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
