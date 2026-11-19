// 言 · 设置 → 环境：给模型备一套自带的开发环境（桥接那头在 server/env/），装在存储位置的「环境」目录里，不依赖、也不改动系统。
// 一组工具一张卡，勾上的在「准备环境」时装好；模型的指令与 MCP 服务都接着这套环境，缺的库它自己 pip / npm 装进来
/** @type {{ home: string, supported?: boolean, system?: Record<string, { path: string, version: string }>|null, state: Record<string, any>|null, packs: Array<Record<string, any>>, job: Record<string, any>|null }|null} */
let envStatus = null,
  envPoll = 0;
function envSettings() {
  return store.settings.env;
}
function resetEnvStatus() {
  envStatus = null;
  clearTimeout(envPoll);
  envPoll = 0;
  renderEnvStatus();
}
function updateEnvStatus(status) {
  if (status) envStatus = status;
  renderEnvStatus();
  clearTimeout(envPoll);
  envPoll = envStatus?.job?.running ? setTimeout(refreshEnv, 1200) : 0;
}
// 问桥接要一次环境的状态；正在准备就隔一会儿再问，直到装完。
function refreshEnv() {
  return requestEnv(bootstrap.store, "status", {}, AbortSignal.timeout(8000));
}
async function requestEnv(scope, action, payload, signal = undefined) {
  // 确认框也归打开时的根：即使来回换过、路径看起来相同，也不是同一回。
  if (bootstrap.store !== scope) return;
  try {
    const status = await storeBridge(`/api/env/${action}`, payload, signal);
    if (bootstrap.store === scope) updateEnvStatus(status);
  } catch (error) {
    if (bootstrap.store !== scope) return;
    const message = String(error.message || error);
    // 别页换了根：不再轮询旧处的进度，也不把旧环境写进系统提示。
    if (message === "存储位置已变化，请刷新页面后重试") {
      resetEnvStatus();
      toast(message);
    } else if (action === "status") updateEnvStatus(null);
    else toast(message);
  }
}
function envSettingsHtml() {
  const s = envSettings();
  // 工具包一节只给 Windows：macOS 不备环境包。开页时 status 还没回来，先按平台定，
  // 否则 macOS 上会先画出这一节、等 status 回来再收起（闪一下）
  const managed = envStatus ? !envStatus.system : bootstrap.work?.platform !== "darwin";
  return `<div id="envPage"><h2>${t(`环境`)}</h2><div id="envStatus">${envStatusHtml()}</div><div id="envManaged"${managed ? "" : ' class="hidden"'}><h3 class="settings-sub">${t(`工具包`)}</h3><div id="envPacks" class="card-list">${envPacksHtml()}</div><div class="setting-row"><div class="setting-copy"><strong>${t(`另装`)}</strong><small>${t(`包名以空格分隔`)}</small></div><div class="setting-actions env-extra"><label class="setting-inline">Python<input id="envPip" class="field" spellcheck="false" placeholder="${t(`如 sympy jieba`)}" value="${escapeHtml(s.pip)}"></label><label class="setting-inline">Node<input id="envNpm" class="field" spellcheck="false" placeholder="${t(`如 pnpm`)}" value="${escapeHtml(s.npm)}"></label></div></div></div></div>`;
}
// macOS 没环境包：状态卡里列系统里探到的 Python、Node 与 ffmpeg（版本与路径），「准备」即重探一遍
function envSystemHtml(job, running) {
  const tools = envStatus?.system || {},
    // 点「重新探测」要看得见明细：探完（成功也是）就把逐件的日志列出来，不必等到出错
    log =
      job && (running || job.error || job.log.length)
        ? `${running || job.error ? `<div class="card-note">${escapeHtml(running ? t`正在${tr(job.step) || t("开始")}…` : t`探测出错：${tr(job.error)}`)}</div>` : ""}<pre class="env-log">${escapeHtml(job.log.map(tr).join("\n"))}</pre>`
        : "",
    rows = [
      ["python", "Python"],
      ["node", "Node.js"],
      ["ffmpeg", "ffmpeg"]
    ]
      .map(([id, label]) => {
        const hit = tools[id];
        return `<div class="setting-row"><div class="setting-copy"><strong>${label}</strong><small title="${escapeHtml(hit?.path || "")}">${escapeHtml(hit ? hit.version || hit.path : t("未找到"))}</small></div></div>`;
      })
      .join(""),
    found = ["python", "node", "ffmpeg"].filter(id => tools[id]).length,
    summary = t`探到 ${found}/3`;
  return `<div class="card"><div class="card-head"><span class="card-name">${running ? t("探测中") : t("系统工具")}</span><span class="card-state${found ? " ok" : ""}" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span><span class="card-actions"><button id="envPrepare" type="button" class="outline-btn"${running ? " disabled" : ""}>${running ? t("探测中…") : t("重新探测")}</button></span></div><div class="card-note">${escapeHtml(t("macOS 上不备环境包，指令直接用系统里的工具；经 Homebrew 安装的也能探到。"))}</div>${rows}${log}</div>`;
}
function envStatusHtml() {
  if (!envStatus) return `<div class="card"><div class="card-head"><span class="card-name">${t(`查看中…`)}</span></div></div>`;
  const { state, job, home, supported } = envStatus,
    running = !!job?.running;
  if (envStatus.system) return envSystemHtml(job, running);
  const unsupported = supported === false;
  const summary = unsupported
    ? t("仅 Windows")
    : state
      ? t`${state.python} · ${state.packs.length - 1} 组工具 · ${formatDay(state.at)}准备`
      : t("首次准备需下载数十至数百 MB");
  const log =
    job && (running || job.error)
      ? `<div class="card-note">${escapeHtml(running ? t`正在${tr(job.step) || t("开始")}…` : t`未能装成：${tr(job.error)}`)}</div><pre class="env-log">${escapeHtml(job.log.map(tr).join("\n"))}</pre>`
      : "";
  return `<div class="card"><div class="card-head"><span class="card-name">${running ? t("准备中") : state ? t("已备好") : t("尚未准备")}</span><span class="card-state${state ? " ok" : ""}" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span><span class="card-actions"><button id="envPrepare" type="button" class="outline-btn"${running ? " disabled" : ""}>${running ? t("准备中…") : state ? t("更新环境") : t("准备环境")}</button>${state && !running ? `<button id="envClear" type="button" class="danger-btn">${t(`清空`)}</button>` : ""}</span></div><div class="card-sub" title="${escapeHtml(home)}">${escapeHtml(home)}</div>${unsupported ? `<div class="card-note">${escapeHtml(t("环境工具包只备了 Windows 版；在这套系统上请用系统里的 Python 与 Node"))}</div>` : ""}${log}</div>`;
}
// 一组一张卡：名称与说明在左，状态在右——没选是空框，选了待装是朱色实心，装好了是一笔勾；装了又取消的标「待卸」，下回准备时卸掉。
// 底座（Python）取消不了，装好后标灰字「必备」，免得看着像点不动
function envPacksHtml() {
  const packs = envStatus?.packs || [],
    chosen = new Set(envSettings().packs),
    installed = new Set(envStatus?.state?.packs || []);
  if (!packs.length) return `<p class="card-note">${t(`桥接未接通`)}</p>`;
  return packs
    .map(pack => {
      const on = pack.base || chosen.has(pack.id),
        state = installed.has(pack.id) ? (on ? "done" : "drop") : on ? "pick" : "",
        word = { pick: t("待装"), drop: t("待卸") }[state] || (pack.base ? t("必备") : ""),
        contents = [...pack.pip, ...pack.npm].join(" · ") || tr(pack.hint);
      return `<button type="button" class="card pickable env-pack" role="checkbox" aria-checked="${on}"${pack.base ? ' aria-disabled="true"' : ""} data-env-pack="${escapeHtml(pack.id)}" data-state="${state}"><span class="card-body"><span class="card-head"><span class="card-name">${escapeHtml(tr(pack.name))}</span><span class="card-tag">${escapeHtml(tr(pack.tag))}</span></span><span class="card-note">${escapeHtml(tr(pack.note))}</span>${contents ? `<span class="card-sub" title="${escapeHtml(contents)}">${escapeHtml(contents)}</span>` : ""}</span><span class="env-pack-word">${word}</span><span class="card-tick" aria-hidden="true">${state === "done" ? `<svg viewBox="0 0 22 22"><path d="M4.5 11.8c1.6 1.2 3 2.6 4.3 4.3C11 11.4 14 7.6 18 4.8"/></svg>` : ""}</span></button>`;
    })
    .join("");
}
function renderEnvStatus() {
  if (settingsTab !== "env" || $("#settingsModal").classList.contains("hidden")) return;
  $("#envStatus").innerHTML = envStatusHtml();
  $("#envManaged").classList.toggle("hidden", envStatus ? !!envStatus.system : bootstrap.work?.platform === "darwin");
  $("#envPacks").innerHTML = envPacksHtml();
  const log = $("#envStatus .env-log");
  if (log) log.scrollTop = log.scrollHeight;
}
const splitNames = text =>
  String(text || "")
    .split(/[\s,，]+/)
    .filter(Boolean);
function bindEnvEvents() {
  if (!envStatus) void refreshEnv();
  for (const [id, key] of [
    ["#envPip", "pip"],
    ["#envNpm", "npm"]
  ])
    $(id).addEventListener("input", event => {
      envSettings()[key] = event.target.value;
      saveStoreSoon();
    });
  $("#envPage").addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button) return;
    const pack = button.dataset.envPack;
    if (pack && button.getAttribute("aria-disabled") !== "true") {
      const s = envSettings();
      s.packs = s.packs.includes(pack) ? s.packs.filter(id => id !== pack) : [...s.packs, pack];
      saveStore();
      return renderEnvStatus();
    }
    const scope = bootstrap.store;
    if (button.id === "envPrepare") {
      const s = envSettings();
      const removed = (envStatus?.state?.packs || []).filter(
        id => !s.packs.includes(id) && !envStatus?.packs?.some(pack => pack.id === id && pack.base)
      );
      if (removed.length) {
        const names = removed.map(id => envStatus.packs.find(pack => pack.id === id)?.name || id);
        if (
          !(await askConfirm({
            title: t`卸载 ${removed.length} 组工具？`,
            body: t`当前已安装、但未勾选的 ${names.join("、")} 将在更新环境时卸载。`,
            ok: t("卸载并更新")
          }))
        )
          return;
      }
      return requestEnv(scope, "prepare", { packs: s.packs, pip: splitNames(s.pip), npm: splitNames(s.npm) });
    }
    if (button.id === "envClear") {
      if (
        !(await askConfirm({
          title: t("清空环境？"),
          body: t("整个环境目录将被删除，已装的包需重新安装；对话、卷宗与配置不受影响。"),
          ok: t("清空")
        }))
      )
        return;
      return requestEnv(scope, "clear", {});
    }
  });
}
// 系统提示里 work.env 那一句的值：环境备好了，告诉模型有哪些、缺的往哪装；没备好不带
function envVars() {
  const state = envStatus?.state;
  if (!state) return null;
  // macOS：用的是系统里的工具、没有另备的环境，这一句（python、pip 都指向环境）不成立，改由 envSystemVars 说
  if (envStatus?.system) return null;
  const kits = (envStatus.packs || [])
    .filter(pack => !pack.base && state.packs.includes(pack.id))
    .map(pack => `${pack.name}（${pack.hint || [...pack.pip, ...pack.npm].slice(0, 6).join("、")}）`);
  const extra = [...state.pip, ...state.npm];
  return { kits: [state.python, ...kits, ...(extra.length ? [`另装 ${extra.join("、")}`] : [])].join("；") };
}
// macOS 那一句（work.envSystem）：没有另备的环境，只说系统里现成有哪几件。
// 给路径不给名字——PATH 里的未必就是它们（从 Finder 起的桥接 PATH 很窄）；
// 一件都没探到时整句不带，免得拼出半句
function envSystemVars() {
  const tools = Object.values(envStatus?.system || {})
    .map(tool => tool?.path)
    .filter(Boolean);
  return tools.length ? { tools: tools.join("、") } : null;
}
