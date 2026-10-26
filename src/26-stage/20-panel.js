// 言 · 游目 · 开合与画面之外的几样：宽窄、浏览器起停、地址与标签、模型动作的提示
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 开合与画面之外的几样 ----------
// 开着（用户没收起它）
function stageShown() {
  const panel = $("#stagePanel");
  return !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
// 开着且看得见：没被旁注挤开、言的页面不在后台
function stageVisible() {
  return stageShown() && $("#stageView").clientWidth > 0 && !document.hidden;
}
// 看得见才收画面，看不见即停收、入口那一笔回来；回来再接上
function stageWake() {
  stage.seen = stageVisible();
  if (stage.seen) void stageAttach();
  else if (stage.session || stage.attached) void stageDetach();
  stageSync();
}
function openStage() {
  if (sidePanelOpen()) closeSidePanel();
  let saved = 0;
  try {
    saved = Number(localStorage.getItem("yan-stage-width")) || 0;
  } catch {}
  stageSetWidth(stage.width || saved || innerWidth * 0.46);
  showNow($("#stagePanel"));
  layoutRail({ mayCollapseSidebar: false });
  stageWake();
  // 浏览器早开着、看台却没连上的（桥接重启过、浏览器是别处起的）：开时再找一回
  if (!stage.ws) void stageLocate();
  clearInterval(stage.poll);
  stage.poll = window.setInterval(() => {
    if (document.hidden) return;
    void stageRefreshTabs();
    stageMaybeRelease();
  }, 1500);
}
function closeStage() {
  stageSetWide(false);
  hideWithFade($("#stagePanel"));
  layoutRail({ mayCollapseSidebar: true });
  clearInterval(stage.poll);
  stageWake();
}
/** @param {boolean} on */
function stageSetWide(on) {
  $("#stagePanel").classList.toggle("wide", on);
  $("#stageWide").setAttribute("aria-pressed", String(on));
}
/** @param {number} px */
function stageSetWidth(px) {
  stage.width = Math.round(Math.max(320, Math.min(px, innerWidth - 420)));
  $("#stagePanel").style.width = `${stage.width}px`;
}
// 入口那一笔：接了浏览器类的 MCP（或浏览器已开着）、游目收着（或被旁注挤开）时自页顶垂下；模型正操作浏览器时笔尖下一粒朱一明一暗
function stageSync() {
  const pin = $("#stagePin");
  pin.classList.toggle("hidden", (!stage.ws && !stageServer()) || stageVisible());
  pin.classList.toggle("busy", stage.busy > 0);
  // 地址行的「执事」：执事在动、或歇手不到八秒时挂着，指着浮出近几步
  const acting = stage.busy > 0 || Date.now() - stage.lastAct < 8000;
  $("#stageBusy").classList.toggle("hidden", !acting);
  $("#stageBusy").classList.toggle("busy", stage.busy > 0);
  clearTimeout(stage.actTimer);
  if (acting && !stage.busy) stage.actTimer = window.setTimeout(stageSync, 8000 - (Date.now() - stage.lastAct) + 50);
  // 收藏：连上了就挂（收藏此页要它）；没连上时浏览器配置目录里有收藏也挂，点一条可开
  $("#stageMarks").classList.toggle("hidden", !stage.ws && !stage.marks);
  stageRender();
}
// 接进来的浏览器类 MCP：工具里有 browser_navigate 的那个服务（playwright 即是）
function stageServer() {
  const configs = mcpConfigs();
  return (
    Object.keys(mcp.servers).find(
      name => mcp.servers[name].ok && !configs[name]?.disabled && mcp.servers[name].tools?.some(tool => tool.name === "browser_navigate")
    ) || ""
  );
}
// 那个服务的配置：调试口、配置目录都由桥接从它的参数里读。服务还没连上（刚开页）时，从配置里找像浏览器的那个
function stageConfig() {
  const configs = mcpConfigs();
  return (
    configs[stageServer()] ||
    Object.values(configs).find(
      config => config.stage || (config.args || []).some(arg => /playwright|^--(config|user-data-dir|cdp-endpoint)\b/.test(String(arg)))
    )
  );
}
// 问桥接时递的那个服务：游目自己的递几项选择（桥接拼成整条），别的递参数与目录
function stageService() {
  const config = stageConfig();
  return config?.stage ? { stage: config.stage } : { args: config?.args || [], cwd: config?.cwd || "" };
}
// 浏览器没开（或被关了）：替用户调一次那个服务的 browser_navigate，浏览器照它的配置起来，再去连
async function stageLaunch() {
  const server = stageServer();
  if (!server || stage.launching) return;
  stage.launching = true;
  stageRender();
  try {
    await bridge("/api/mcp/call", {
      server,
      config: mcpConfigs()[server],
      tool: "browser_navigate",
      arguments: { url: "about:blank" },
      timeout: 60
    });
    await stageLocate();
    if (!stage.ws) toast(t`浏览器已开，但连不上调试口${stage.port ? ` ${stage.port}` : ""}`);
  } catch (error) {
    toast(t`浏览器打开失败：${String(error.message || error).slice(0, 80)}`);
  } finally {
    stage.launching = false;
    stageSync();
  }
}
function stageNewTab() {
  if (!stage.ws) return void stageLaunch();
  // 新开的一页由 targetCreated 报来，看台跟过去；地址栏等着输网址
  void stageSend("Target.createTarget", { url: "about:blank" })
    .then(stageEditUrl)
    .catch(() => {});
}
// ---------- 收藏 ----------
// 看台只转网页，浏览器自己的收藏栏看不到。读：桥接读它配置目录里那份（每回现读）；改：借浏览器自己的收藏页——那一页里调得到 chrome.bookmarks，
// 改了浏览器即刻生效，不碰配置文件。那一页开在另起的一个浏览器上下文里：执事（Playwright）不认得它、游目也不列它；收藏是整个配置共用的，照样进主收藏夹
/** @typedef {{ id: string, name: string, url?: string, children?: StageMark[] }} StageMark */
/** @param {any} node @returns {StageMark} */
const stageMarkOf = node => ({
  id: String(node.id ?? ""),
  name: String(node.name ?? node.title ?? ""),
  ...(node.children ? { children: node.children.map(stageMarkOf) } : { url: String(node.url || "") })
});
// 读一回：刚改过的十秒内用改完时浏览器递回的那份（配置文件过一两秒才落盘）
async function stageReadMarks() {
  if (stage.markTree && Date.now() - stage.markTreeAt < 10000) return stage.markTree;
  const data = await bridge("/api/stage/bookmarks", stageService()).catch(() => null);
  if (data) {
    stage.markTree = [
      { id: data.barId || "1", name: t("收藏夹栏"), children: (data.bar || []).map(stageMarkOf) },
      { id: data.otherId || "2", name: t("其他收藏"), children: (data.other || []).map(stageMarkOf) }
    ];
    stage.markTreeAt = 0;
  }
  stageRenderMarkBtn();
  return stage.markTree;
}
/** @param {StageMark[]} nodes @returns {StageMark[]} */
const stageMarkFlat = nodes => nodes.flatMap(node => (node.children ? stageMarkFlat(node.children) : [node]));
// 这一页收没收：书签带着朱
function stageThisMark() {
  const url = stage.tabs.get(stage.current)?.url || "";
  return url ? stageMarkFlat(stage.markTree || []).find(node => node.url === url) : undefined;
}
function stageRenderMarkBtn() {
  $("#stageMarks").classList.toggle("on", !!stageThisMark());
}
// 在浏览器的收藏页里跑一段：body 里可用 bm(方法, ...参数)，跑完递回整棵收藏树
/** @param {string} body */
async function stageMarkDo(body) {
  if (!stage.ws) throw Error(t("游目未连上"));
  const { browserContextId } = await stageSend("Target.createBrowserContext", { disposeOnDetach: true });
  stage.helperCtx = browserContextId;
  try {
    const { targetId } = await stageSend("Target.createTarget", { url: stageInsideUrl("favorites"), browserContextId });
    const { sessionId } = await stageSend("Target.attachToTarget", { targetId, flatten: true });
    const run = (/** @type {string} */ expression) =>
      stageSend("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    // 页里的 chrome.bookmarks 载好才有
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      ready = !!(await run("typeof chrome === 'object' && !!chrome.bookmarks").catch(() => null))?.result?.value;
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw Error(t("浏览器的收藏页未能载入"));
    const { result, exceptionDetails } = await run(
      `(async () => { const bm = (fn, ...args) => new Promise((ok, no) => chrome.bookmarks[fn](...args, r => chrome.runtime.lastError ? no(Error(chrome.runtime.lastError.message)) : ok(r))); ${body}; return (await bm("getTree"))[0].children; })()`
    );
    if (exceptionDetails) throw Error(exceptionDetails.exception?.description?.split("\n")[0] || t("收藏未能更改"));
    const roots = /** @type {any[]} */ (result.value || []);
    stage.markTree = roots.slice(0, 2).map((root, i) => ({ ...stageMarkOf(root), name: i ? t("其他收藏") : t("收藏夹栏") }));
    stage.markTreeAt = Date.now();
    stageRenderMarkBtn();
  } finally {
    void stageSend("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }
}
// 收藏签：头一行是这一页（收 / 已收可改可移除）；底下按夹分层，指着一条露「改 · 删」，改就地展开；签底「新夹」「整理…」（浏览器自己的收藏页）
/** @param {HTMLElement} anchor */
async function stageOpenMarks(anchor) {
  if (document.querySelector(".chip-pop.stage-marks")) return closeChipPop();
  await stageReadMarks();
  const pop = openFloatingPop(anchor, stageMarksHtml(), { align: "right", menu: false });
  pop.classList.add("stage-marks", "stage-pop");
  pop.addEventListener("click", e => void stageMarksClick(pop, /** @type {HTMLElement} */ (e.target)));
  pop.addEventListener("keydown", e => {
    const form = /** @type {HTMLElement} */ (e.target).closest(".stage-mark-form");
    if (!form) return;
    e.stopPropagation();
    if (e.key === "Enter") void stageMarksClick(pop, /** @type {HTMLElement} */ (form.querySelector("[data-mark-save]")));
    else if (e.key === "Escape") stageMarksRefresh(pop);
  });
}
/** @param {HTMLElement} pop */
function stageMarksRefresh(pop) {
  pop.innerHTML = stageMarksHtml();
}
// 收起了哪些夹：记在本机
function stageMarksShut() {
  try {
    return new Set(/** @type {string[]} */ (JSON.parse(localStorage.getItem("yan-stage-marks-shut") || "[]")));
  } catch {
    return new Set();
  }
}
// 层次（设计稿/48 丙）：夹是一枚细折角、一只小函（卷宗夹的件图缩小）、墨色加重的名字与条数，点题头开合；
// 同夹的条以一道淡墨竖痕收拢，条前一枚淡墨书签带。改、删是小画（那支笔、字上一笔划去），指着才露
function stageMarksHtml() {
  const tab = stage.tabs.get(stage.current),
    mine = stageThisMark(),
    canMark = !!tab?.url && !/^(about|devtools|edge|chrome):/.test(tab.url),
    tree = stage.markTree || [],
    shut = stageMarksShut(),
    ribbon = brushIcon("mark", "stage-mark-ribbon"),
    box = `<svg class="fi stage-mark-case" viewBox="0 0 16 20" aria-hidden="true"><rect class="case" x="1" y=".5" width="14.5" height="19"/><rect class="slip" x="4" y="3" width="4" height="11.5"/></svg>`,
    ops = (/** @type {StageMark} */ node) =>
      `<span class="stage-mark-ops"><button type="button" data-mark-edit="${escapeHtml(node.id)}" title="${t(`改`)}" aria-label="${t(`改`)}">${brushIcon("edit")}</button><button type="button" class="del" data-mark-del="${escapeHtml(node.id)}" title="${t(`删`)}" aria-label="${t(`删`)}">${brushIcon("strike")}</button></span>`;
  // fixed：「其他收藏」是浏览器自己的根，不改不删
  /** @param {StageMark} node @param {boolean} [fixed] */
  const dir = (node, fixed = false) => {
    const closed = shut.has(node.id);
    return `<div class="stage-mark-dir${closed ? " shut" : ""}"><button type="button" class="stage-mark-fold" data-mark-fold="${escapeHtml(node.id)}" aria-expanded="${!closed}"><i class="stage-mark-chev" aria-hidden="true"></i>${box}<span>${escapeHtml(node.name)}</span><small>${stageMarkFlat(node.children || []).length}</small></button>${fixed ? "" : ops(node)}</div>${closed ? "" : `<div class="stage-mark-group">${list(node.children || [])}</div>`}`;
  };
  /** @param {StageMark[]} nodes @returns {string} */
  const list = nodes =>
    nodes
      .map(node =>
        node.children
          ? dir(node)
          : `<div class="stage-mark-row"><button type="button" class="stage-mark-name" data-stage-mark="${escapeHtml(node.url || "")}" title="${escapeHtml(node.url || "")}">${ribbon}<span>${escapeHtml(node.name || node.url || "")}</span></button>${ops(node)}</div>`
      )
      .join("");
  // 头一行是这一页：题在左，右端一枚书签带——没收是墨、点即收；已收着朱，旁边改与删
  const head = !canMark
    ? ""
    : mine
      ? `<div class="stage-mark-this on"><span>${escapeHtml(mine.name)}</span>${ops(mine)}<i class="stage-mark-badge" title="${t(`此页已收`)}">${brushIcon("mark")}</i></div>`
      : `<div class="stage-mark-this"><span>${escapeHtml(stageTitle(tab))}</span><button type="button" class="stage-mark-badge" data-mark-add title="${t(`收藏此页`)}" aria-label="${t(`收藏此页`)}">${brushIcon("mark")}</button></div>`;
  const bar = tree[0]?.children || [],
    other = tree[1],
    body = list(bar) + (other?.children?.length ? dir({ ...other, name: t("其他收藏") }, true) : "");
  return `${head}<div class="stage-mark-list">${body || `<div class="stage-mark-empty">${t(`尚无收藏`)}</div>`}</div><div class="stage-pop-foot"><button type="button" data-mark-folder>${t(`新夹`)}</button><button type="button" data-mark-manage>${t(`整理…`)}</button></div>`;
}
/** @param {string} id @param {StageMark[]} [nodes] @returns {StageMark | undefined} */
function stageMarkById(id, nodes = stage.markTree || []) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = node.children && stageMarkById(id, node.children);
    if (found) return found;
  }
}
/** @param {HTMLElement} pop @param {HTMLElement} target */
async function stageMarksClick(pop, target) {
  const hit = (/** @type {string} */ attr) => /** @type {HTMLElement | null} */ (target.closest(`[${attr}]`)),
    js = (/** @type {unknown} */ value) => JSON.stringify(value);
  const go = hit("data-stage-mark"),
    edit = hit("data-mark-edit"),
    del = hit("data-mark-del"),
    save = hit("data-mark-save");
  try {
    if (go) {
      closeChipPop();
      return stageGo(go.dataset.stageMark || "");
    }
    const fold = hit("data-mark-fold");
    if (fold) {
      const shut = stageMarksShut(),
        id = fold.dataset.markFold || "";
      shut.has(id) ? shut.delete(id) : shut.add(id);
      try {
        localStorage.setItem("yan-stage-marks-shut", JSON.stringify([...shut]));
      } catch {}
      return stageMarksRefresh(pop);
    }
    if (hit("data-mark-manage")) {
      closeChipPop();
      return stageOpenInside("favorites");
    }
    if (hit("data-mark-add")) {
      const tab = stage.tabs.get(stage.current);
      if (!tab) return;
      await stageMarkDo(
        `await bm("create", { parentId: ${js(stage.markTree?.[0]?.id || "1")}, title: ${js(stageTitle(tab))}, url: ${js(tab.url)} })`
      );
      return stageMarksRefresh(pop);
    }
    if (hit("data-mark-cancel")) return stageMarksRefresh(pop);
    if (hit("data-mark-folder")) {
      stageMarksRefresh(pop);
      pop.querySelector(".stage-mark-list")?.insertAdjacentHTML("afterbegin", stageMarkFormHtml("", t("新夹"), null));
      return /** @type {HTMLInputElement | null} */ (pop.querySelector(".stage-mark-form input"))?.select();
    }
    if (edit) {
      const node = stageMarkById(edit.dataset.markEdit || "");
      if (!node) return;
      stageMarksRefresh(pop);
      const row =
        [...pop.querySelectorAll(`[data-mark-edit="${CSS.escape(node.id)}"]`)].at(-1)?.closest(".stage-mark-row, .stage-mark-dir") ||
        pop.querySelector(".stage-mark-this");
      row?.insertAdjacentHTML("afterend", stageMarkFormHtml(node.id, node.name, node.children ? null : node.url || ""));
      row?.classList.add("hidden");
      return /** @type {HTMLInputElement | null} */ (pop.querySelector(".stage-mark-form input"))?.select();
    }
    if (save) {
      const form = /** @type {HTMLElement} */ (save.closest(".stage-mark-form")),
        [name, url] = [...form.querySelectorAll("input")].map(input => input.value.trim()),
        id = form.dataset.id || "",
        node = stageMarkById(id);
      if (!name && !url) return;
      // 址一栏给人看的是解开的网址：没改就不存它，免得把原网址换成解开的那串
      const changes = { title: name, ...(url && node?.url && url !== stageReadable(node.url) ? { url: stageUrlOf(url) || url } : {}) };
      if (!id)
        await stageMarkDo(`await bm("create", { parentId: ${js(stage.markTree?.[0]?.id || "1")}, title: ${js(name || t("新夹"))} })`);
      else await stageMarkDo(`await bm("update", ${js(id)}, ${js(changes)})`);
      return stageMarksRefresh(pop);
    }
    if (del) {
      const node = stageMarkById(del.dataset.markDel || "");
      if (!node) return;
      // 夹里有东西：先换成「确定删」，再点一下才删
      if (node.children?.length && !del.classList.contains("sure")) {
        del.classList.add("sure");
        del.title = t("再点一下删去");
        del
          .closest(".stage-mark-ops")
          ?.insertAdjacentHTML("afterbegin", `<small>${t`连同 ${stageMarkFlat(node.children).length} 条，再点删去`}</small>`);
        return;
      }
      await stageMarkDo(`await bm(${js(node.children ? "removeTree" : "remove")}, ${js(node.id)})`);
      return stageMarksRefresh(pop);
    }
  } catch (error) {
    toast(t`收藏未能更改：${String(/** @type {any} */ (error).message || error).slice(0, 80)}`);
  }
}
/** @param {string} id 空即新建夹 @param {string} name @param {string | null} url 夹没有网址 */
function stageMarkFormHtml(id, name, url) {
  return `<div class="stage-mark-form" data-id="${escapeHtml(id)}"><label>${t(`名`)}<input value="${escapeHtml(name)}" spellcheck="false"></label>${url === null ? "" : `<label>${t(`址`)}<input value="${escapeHtml(stageReadable(url))}" spellcheck="false"></label>`}<div class="stage-mark-acts"><button type="button" data-mark-cancel>${t(`取消`)}</button><button type="button" data-mark-save>${t(`存`)}</button></div></div>`;
}

// ---------- 浏览器自己的页 ----------
// 历史、下载、收藏、设置：浏览器本有，经调试口在游目里开得出、能点能改，言不另做一套。开成一张新签。
// 收藏页 Edge 叫 favorites，Chrome 与自带内核叫 bookmarks（chrome://favorites 是错误页）；其余同名
/** @param {string} page favorites / history / downloads / settings */
function stageInsideUrl(page) {
  return `${stage.scheme}://${stage.scheme === "chrome" && page === "favorites" ? "bookmarks" : page}/`;
}
/** @param {string} page */
function stageOpenInside(page) {
  if (!stage.ws) return void stageLaunch();
  void stageSend("Target.createTarget", { url: stageInsideUrl(page) }).catch(error =>
    toast(t`打开失败：${String(error.message || error).slice(0, 80)}`)
  );
}

// ---------- 栏顶「调律」的纸签：游目的杂项 ----------
// 平时一眼要的放上头（查找、缩放），翻旧账的居中（历史、下载、收藏），偶尔一用的居后
const STAGE_SEARCH = /** @type {const} */ ({
  bing: [t("必应"), "https://www.bing.com/search?q="],
  baidu: [t("百度"), "https://www.baidu.com/s?wd="],
  google: ["Google", "https://www.google.com/search?q="]
});
// 地址栏里输的不像网址时交给哪家：纸签里点一下换一家，记在配置里
function stageSearchEngine() {
  const key = store.settings.stageSearch || "bing";
  return /** @type {keyof typeof STAGE_SEARCH} */ (key in STAGE_SEARCH ? key : "bing");
}
/** @param {HTMLElement} anchor */
function stageOpenMenu(anchor) {
  const fresh = stage.downloads.filter(item => item.at > stage.downloadsSeen).length,
    url = () => stage.tabs.get(stage.current)?.url || "",
    rule = `<i class="stage-pop-rule"></i>`;
  openMenu(
    anchor,
    [
      { id: "find", label: t("查找"), note: "Ctrl+F", run: () => stageFindOpen() },
      `<div class="stage-menu-zoom"><span>${t(`缩放`)}</span><span class="stage-zoom"><button type="button" data-stage-zoom="-1" aria-label="${t(`缩小`)}">−</button><button type="button" class="stage-zoom-pct" data-stage-zoom="0" title="${t(`复原`)}">${Math.round(stage.zoom * 100)}%</button><button type="button" data-stage-zoom="1" aria-label="${t(`放大`)}">＋</button></span></div>`,
      rule,
      { id: "history", label: t("历史"), run: () => stageOpenInside("history") },
      { id: "downloads", label: t("下载"), note: fresh ? String(fresh) : "", noteClass: "fresh", run: () => stageOpenDownloads(anchor) },
      { id: "favorites", label: t("整理收藏…"), run: () => stageOpenInside("favorites") },
      rule,
      {
        id: "copy",
        label: t("复制网址"),
        run: () =>
          url() &&
          void navigator.clipboard.writeText(stageReadable(url())).then(
            () => toast(t("网址已复制")),
            () => toast(t("复制失败"))
          )
      },
      // 交给系统默认的浏览器开（经桥接：言跑在 VS Code 里时 window.open 不管用）：要登自己的账号、或要看外头那扇窗时
      {
        id: "system",
        label: t("用系统浏览器打开"),
        run: () => {
          if (!/^https?:/.test(url())) return toast(t("仅网页（http / https）可交系统浏览器打开"));
          void bridge("/api/stage/open", { url: url() }).then(
            () => toast(t("已交给系统浏览器")),
            error => toast(t`打开失败：${String(error.message || error).slice(0, 80)}`)
          );
        }
      },
      // 开发者工具：浏览器自带的那套前端，由它的调试口供出；要在调试口的放行来源里加上它自己（见 docs/stage.md）
      {
        id: "devtools",
        label: t("开发者工具"),
        run: () =>
          stage.current &&
          stage.port &&
          window.open(
            `http://127.0.0.1:${stage.port}/devtools/inspector.html?ws=127.0.0.1:${stage.port}/devtools/page/${stage.current}`,
            "_blank",
            "noopener"
          )
      },
      rule,
      // 适应页面、搜索用哪家：点了就换，不收纸签（记进配置）
      {
        id: "fit",
        label: t("适应页面"),
        note: stageFitOn() ? t("开") : t("关"),
        keep: true,
        run: button => {
          stageSetFit(!stageFitOn());
          button.querySelector("small").textContent = stageFitOn() ? t("开") : t("关");
        }
      },
      {
        id: "search",
        label: t("搜索用"),
        note: `${STAGE_SEARCH[stageSearchEngine()][0]} ›`,
        keep: true,
        run: button => {
          const keys = /** @type {(keyof typeof STAGE_SEARCH)[]} */ (Object.keys(STAGE_SEARCH));
          store.settings.stageSearch = keys[(keys.indexOf(stageSearchEngine()) + 1) % keys.length];
          saveStore();
          button.querySelector("small").textContent = `${STAGE_SEARCH[stageSearchEngine()][0]} ›`;
        }
      },
      rule,
      { id: "settings", label: t("浏览器设置…"), run: () => stageOpenInside("settings") },
      { id: "stage-settings", label: t("游目设置…"), run: () => openSettings("stage") }
    ],
    {
      kind: "stage-menu",
      className: "stage-menu stage-pop",
      onClick: event => {
        const zoom = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest("[data-stage-zoom]"));
        if (zoom) stageZoomStep(Number(zoom.dataset.stageZoom));
      }
    }
  );
}

// ---------- 下载 ----------
// 网页里开始下载（人点的、执事点的都算），浏览器在屏幕外存下：游目记一笔。执事经 MCP 下的，结果里写着存到哪，补上（见 60-mcp 的 stageNoteDownload）
function stageSaveDownloads() {
  try {
    localStorage.setItem("yan-stage-downloads", JSON.stringify(stage.downloads.slice(0, 30)));
  } catch {}
}
/** @param {string} name 浏览器给的文件名 @param {string} path 存到的地方 */
function stageNoteDownload(name, path) {
  const item = stage.downloads.find(entry => !entry.path && (entry.name === name || path.endsWith(entry.name)));
  if (item) item.path = path;
  else stage.downloads.unshift({ guid: uid(), name, url: "", total: 0, got: 0, state: "completed", at: Date.now(), path, by: t("执事") });
  stageSaveDownloads();
}
/** @param {HTMLElement} anchor */
function stageOpenDownloads(anchor) {
  stage.downloadsSeen = Date.now();
  const tone = (/** @type {string} */ name) =>
    /\.(exe|msi|bat|cmd|ps1|vbs|js|lnk|scr|com)$/i.test(name)
      ? "var(--accent)"
      : /\.(zip|rar|7z|tar|gz)$/i.test(name)
        ? "var(--gold)"
        : "var(--ink-3)";
  const rows = stage.downloads
    .map(item => {
      const state =
          item.state === "inProgress"
            ? `${item.total ? Math.round((item.got / item.total) * 100) : 0}%`
            : item.state === "canceled"
              ? t("已取消")
              : "✓",
        size = item.total ? formatFileSize(item.total) : "",
        meta = [size, item.by || "", stageHost(item.url), stageAgo(item.at)].filter(Boolean).join(" · ");
      return `<button type="button" class="stage-dl" data-stage-reveal="${escapeHtml(item.path || "")}" title="${escapeHtml(item.path || item.url)}"><i class="stage-dl-file" style="--fc:${tone(item.name)}"></i><span class="stage-dl-name">${escapeHtml(item.name)}</span><span class="stage-dl-state${item.state === "canceled" ? " off" : ""}">${state}</span><span class="stage-dl-meta">${escapeHtml(meta)}</span></button>`;
    })
    .join("");
  const pop = openFloatingPop(
    anchor,
    `<div class="stage-pop-head">${t(`下载`)}</div>${rows || `<div class="stage-mark-empty">${t(`尚无下载`)}</div>`}<div class="stage-pop-foot"><button type="button" data-stage-reveal="">${t(`打开所在文件夹`)}</button><button type="button" data-stage-inside="downloads">${t(`全部下载…`)}</button></div>`,
    { align: "right", menu: false }
  );
  pop.classList.add("stage-downloads", "stage-pop");
  pop.addEventListener("click", e => {
    const target = /** @type {HTMLElement} */ (e.target),
      reveal = /** @type {HTMLElement | null} */ (target.closest("[data-stage-reveal]"));
    if (target.closest("[data-stage-inside]")) {
      closeChipPop();
      return stageOpenInside("downloads");
    }
    if (!reveal) return;
    void bridge("/api/stage/reveal", { ...stageService(), path: reveal.dataset.stageReveal || "" }).catch(error =>
      toast(String(error.message || error).slice(0, 80))
    );
  });
}
/** @param {number} at */
function stageAgo(at) {
  const minutes = Math.round((Date.now() - at) / 60000);
  return minutes < 1
    ? t("刚才")
    : minutes < 60
      ? t`${minutes} 分钟前`
      : minutes < 1440
        ? t`${Math.round(minutes / 60)} 小时前`
        : t`${Math.round(minutes / 1440)} 天前`;
}
/** @param {{ title: string, url: string }} tab */
function stageTitle(tab) {
  if (tab.url === "about:blank") return t("空白页");
  if (tab.title && tab.title !== tab.url) return tab.title;
  try {
    return new URL(tab.url).host || tab.url;
  } catch {
    return tab.url || t("新标签页");
  }
}
// 地址栏给人看：%E5… 解回汉字（解不开的原样）
/** @param {string} url */
function stageReadable(url) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
// 地址行给人看的一句：域名 › 页题；本机的页不收短（localhost 写端口与路径、本机文件写文件名）。整串网址在 title 里，点它才露出可改
/** @param {{ title: string, url: string } | undefined} tab */
function stageAddrHtml(tab) {
  if (!tab?.url) return "";
  const text = stageReadable(tab.url);
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return `<b>${escapeHtml(text)}</b>`;
  }
  const sep = `<i aria-hidden="true">›</i>`;
  if (url.protocol === "about:") return `<b>${escapeHtml(stageTitle(tab))}</b>`;
  if (url.protocol === "file:") {
    const path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:)/i, "$1");
    return `<b>${escapeHtml(path.split("/").pop() || path)}</b>${sep}${escapeHtml(path.split("/").slice(0, -1).join("/"))}`;
  }
  // data: 之类整串没法看：写协议与页题
  if (!/^https?:$/.test(url.protocol))
    return `<b>${escapeHtml(url.protocol.slice(0, -1))}</b>${tab.title && tab.title !== tab.url ? `${sep}${escapeHtml(tab.title)}` : ""}`;
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname),
    rest = local ? stageReadable(url.pathname + url.search + url.hash) : tab.title && tab.title !== tab.url ? tab.title : "";
  return `<b>${escapeHtml(local ? url.host : url.host.replace(/^www\./, ""))}</b>${rest && rest !== "/" ? `${sep}${escapeHtml(rest)}` : ""}`;
}
// 改网址：地址行换成输入框、整串选中（点地址行、Ctrl+L）
function stageEditUrl() {
  const url = /** @type {HTMLInputElement} */ ($("#stageUrl"));
  $("#stageAddr").classList.add("hidden");
  url.classList.remove("hidden");
  url.value = stageReadable(stage.tabs.get(stage.current)?.url || "");
  url.focus();
  url.select();
}
// 空台：一页空册（淡墨四笔、角上一方小印），底下一词，有事可做时是一个带朱线的词
let stageLeaf = "";
function stageEmptyHtml(text, action = "") {
  stageLeaf ||=
    `<rect class="wash" x="18" y="10" width="114" height="70"/>` +
    brushStroke([14, 9, 75, 7.6, 136, 9.4], 2.2, { tone: "ink2", tail: 0.4 }) +
    brushStroke([17, 10, 16.4, 45, 17.4, 81], 1.8, { tone: "ink2", tail: 0.3 }) +
    brushStroke([133, 10, 133.8, 45, 132.6, 81], 1.8, { tone: "ink2", tail: 0.3 }) +
    brushStroke([14, 81.4, 75, 82.6, 136, 80.8], 2.2, { tone: "ink2", tail: 0.2 }) +
    `<rect class="zhu" x="118" y="66" width="7" height="7" rx=".6"/>`;
  return `<svg class="brush stage-leaf" viewBox="0 0 150 92" aria-hidden="true">${stageLeaf}</svg><span>${text}</span>${action}`;
}
function stageRender() {
  if (!stageShown()) return;
  // 标签是一行字、丝栏相隔；当前那张底下一笔朱，执事所在的那张题后一粒朱
  const under = brushStroke([1, 2.6, 9, 1.8, 17, 2.4], 2.2, { tone: "zhu", tail: 0 }),
    acting = stage.busy > 0 || Date.now() - stage.lastAct < 8000;
  $("#stageTabs").innerHTML = [...stage.tabs]
    .map(
      ([id, tab]) =>
        `<div class="stage-tab${id === stage.current ? " on" : ""}" role="tab" aria-selected="${id === stage.current}" data-stage-tab="${escapeHtml(id)}" title="${escapeHtml(tab.title || tab.url)}"><span class="stage-tab-name">${escapeHtml(stageTitle(tab))}</span>${acting && id === stage.front ? `<span class="stage-tab-live" title="${t(`执事在这一页`)}"></span>` : ""}<button type="button" class="stage-tab-x" data-stage-close="${escapeHtml(id)}" title="${t(`关闭此页`)}" aria-label="${t(`关闭此页`)}">×</button>${id === stage.current ? `<svg class="stage-tab-under" viewBox="0 0 18 5" aria-hidden="true">${under}</svg>` : ""}</div>`
    )
    .join("");
  stageRenderMarkBtn();
  const tab = stage.tabs.get(stage.current),
    addr = $("#stageAddr");
  if (document.activeElement !== $("#stageUrl")) {
    addr.innerHTML = stageAddrHtml(tab);
    addr.title = tab?.url ? stageReadable(tab.url) : "";
  }
  const empty = stage.launching
    ? stageEmptyHtml(t("正在打开浏览器…"))
    : !stage.ws
      ? stageEmptyHtml(
          t("浏览器未开"),
          stageServer() ? `<button type="button" class="stage-go" data-stage-launch>${t(`打开浏览器`)}</button>` : ""
        )
      : !tab
        ? stageEmptyHtml(t("没有开着的页"), `<button type="button" class="stage-go" data-stage-new>${t(`新建标签页`)}</button>`)
        : "";
  // 隔一会儿就重画一回：没变不动，免得按钮在指针下被换掉
  if (empty !== stage.empty) $("#stageEmpty").innerHTML = stage.empty = empty;
  $("#stageEmpty").classList.toggle("hidden", !empty);
  $("#stageView").classList.toggle("empty", !!empty);
}
/**
 * 浏览器类的 MCP 调用（playwright 的 browser_*）进行时点一粒朱、记一笔它在做什么；调完去找一回浏览器——它多半是这一下起的
 * @param {string} tool
 * @param {Record<string, any>} [args]
 */
function stageWatch(tool, args = {}) {
  if (!/^browser_/.test(tool)) return () => {};
  stage.busy += 1;
  stage.trail = [...stage.trail, { text: stageActionText(tool, args), at: Date.now() }].slice(-6);
  stage.lastAct = Date.now();
  stageSync();
  return () => {
    stage.busy -= 1;
    stage.lastAct = Date.now();
    stageSync();
    // 调完再量一回视口：执事若刚把它定死，留白处写明
    void stageLocate().then(stageFit);
  };
}

// 执事在浏览器里的一步，写成一句：前往 某站、点击「某处」、键入「某字」……两字动词；参数照 playwright MCP 的写法，认不得的只写工具名
/** @param {string} tool @param {Record<string, any>} args */
function stageActionText(tool, args) {
  const quote = (/** @type {any} */ value) =>
      `「${String(value ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 24)}」`,
    name = tool.replace(/^browser_/, "");
  /** @type {Record<string, () => string>} */
  const say = {
    navigate: () => t`前往 ${stageHost(args.url) || args.url || ""}`,
    navigate_back: () => t("返回上页"),
    navigate_forward: () => t("前进一页"),
    click: () => `${args.doubleClick ? t("双击") : t("点击")}${quote(args.element)}`,
    hover: () => t`悬停${quote(args.element)}`,
    type: () => t`键入${quote(args.text)}`,
    fill_form: () => t("填写表单"),
    select_option: () => t`选取${quote([].concat(args.values || []).join("、"))}`,
    press_key: () => t`按键 ${args.key || ""}`,
    drag: () => t`拖动${quote(args.startElement)}`,
    snapshot: () => t("阅读此页"),
    take_screenshot: () => t("截取画面"),
    wait_for: () =>
      args.text ? t`等候${quote(args.text)}` : args.textGone ? t`等候${quote(args.textGone)}消失` : t`等候 ${args.time || ""} 秒`,
    tabs: () =>
      ({ new: t("新开一页"), close: t("关闭一页"), select: t("切换标签"), list: t("查看各页") })[String(args.action)] || t("查看各页"),
    evaluate: () => t("运行脚本"),
    file_upload: () => t("上传文件"),
    handle_dialog: () => (args.accept ? t("应允提示") : t("回绝提示")),
    close: () => t("关闭浏览器"),
    resize: () => t("调整窗口"),
    console_messages: () => t("查看控制台"),
    network_requests: () => t("查看网络请求")
  };
  return say[name]?.() || name;
}
defineLayer({ name: "stage-wide", rank: 75, open: () => $("#stagePanel").classList.contains("wide"), close: () => stageSetWide(false) });
