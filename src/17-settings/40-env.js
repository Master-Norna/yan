// 言 · 设置 → 环境：给模型备一套自带的开发环境（桥接那头在 server/env/），装在存储位置的「环境」目录里，不依赖、也不改动系统。
// 一组工具一张卡，勾上的在「准备环境」时装好；模型的指令与 MCP 服务都接着这套环境，缺的库它自己 pip / npm 装进来
/** @type {{ home: string, state: Record<string, any>|null, packs: Array<Record<string, any>>, job: Record<string, any>|null }|null} */
let envStatus = null,
  envPoll = 0;
function envSettings() {
  return store.settings.env;
}
// 问桥接要一次环境的状态；正在准备就隔一会儿再问，直到装完
async function refreshEnv() {
  const root = bootstrap.store?.root;
  const status = await bridge("/api/env/status", {}, AbortSignal.timeout(8000)).catch(() => null);
  // 换存储位置期间，旧根的慢响应不能再画到新根的环境页上。
  if (root !== bootstrap.store?.root) return;
  if (status) envStatus = status;
  renderEnvStatus();
  clearTimeout(envPoll);
  if (envStatus?.job?.running) envPoll = setTimeout(refreshEnv, 1200);
}
function envSettingsHtml() {
  const s = envSettings();
  return `<div id="envPage"><h2>${t(`环境`)}</h2><div id="envStatus">${envStatusHtml()}</div><h3 class="settings-sub">${t(`工具包`)}</h3><div id="envPacks" class="card-list">${envPacksHtml()}</div><div class="setting-row"><div class="setting-copy"><strong>${t(`另装`)}</strong><small>${t(`包名以空格分隔`)}</small></div><div class="setting-actions env-extra"><label class="setting-inline">Python<input id="envPip" class="field" spellcheck="false" placeholder="${t(`如 sympy jieba`)}" value="${escapeHtml(s.pip)}"></label><label class="setting-inline">Node<input id="envNpm" class="field" spellcheck="false" placeholder="${t(`如 pnpm`)}" value="${escapeHtml(s.npm)}"></label></div></div></div>`;
}
function envStatusHtml() {
  if (!envStatus) return `<div class="card"><div class="card-head"><span class="card-name">${t(`查看中…`)}</span></div></div>`;
  const { state, job, home } = envStatus,
    running = !!job?.running;
  const summary = state
    ? t`${state.python} · ${state.packs.length - 1} 组工具 · ${formatDay(state.at)}准备`
    : t("首次准备需下载数十至数百 MB");
  const log =
    job && (running || job.error)
      ? `<div class="card-note">${escapeHtml(running ? t`正在${tr(job.step) || t("开始")}…` : t`未能装成：${tr(job.error)}`)}</div><pre class="env-log">${escapeHtml(job.log.map(tr).join("\n"))}</pre>`
      : "";
  return `<div class="card"><div class="card-head"><span class="card-name">${running ? t("准备中") : state ? t("已备好") : t("尚未准备")}</span><span class="card-state${state ? " ok" : ""}" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span><span class="card-actions"><button id="envPrepare" type="button" class="outline-btn"${running ? " disabled" : ""}>${running ? t("准备中…") : state ? t("更新环境") : t("准备环境")}</button>${state && !running ? `<button id="envClear" type="button" class="danger-btn">${t(`清空`)}</button>` : ""}</span></div><div class="card-sub" title="${escapeHtml(home)}">${escapeHtml(home)}</div>${log}</div>`;
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
      envStatus = await bridge("/api/env/prepare", {
        packs: s.packs,
        pip: splitNames(s.pip),
        npm: splitNames(s.npm)
      }).catch(error => {
        toast(String(error.message || error));
        return envStatus;
      });
      return refreshEnv();
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
      envStatus = await bridge("/api/env/clear", {}).catch(error => {
        toast(String(error.message || error));
        return envStatus;
      });
      renderEnvStatus();
    }
  });
}
// 系统提示里 work.env 那一句的值：环境备好了，告诉模型有哪些、缺的往哪装；没备好不带
function envVars() {
  const state = envStatus?.state;
  if (!state) return null;
  const kits = (envStatus.packs || [])
    .filter(pack => !pack.base && state.packs.includes(pack.id))
    .map(pack => `${pack.name}（${pack.hint || [...pack.pip, ...pack.npm].slice(0, 6).join("、")}）`);
  const extra = [...state.pip, ...state.npm];
  return { kits: [state.python, ...kits, ...(extra.length ? [`另装 ${extra.join("、")}`] : [])].join("；") };
}
