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
  if (apiBase === null) return;
  envStatus = await bridge("/api/env/status", {}, AbortSignal.timeout(8000)).catch(() => envStatus);
  renderEnvStatus();
  clearTimeout(envPoll);
  if (envStatus?.job?.running) envPoll = setTimeout(refreshEnv, 1200);
}
function envSettingsHtml() {
  const s = envSettings();
  return `<div id="envPage"><h2>环境</h2><p class="settings-lead">给模型备一套自带的开发环境：独立的 Python 与常用工具，装在存储位置的「环境」目录里，不依赖、也不改动系统。模型的指令与 MCP 服务都接着它；缺的库模型会自己装进这里。</p><div id="envStatus">${envStatusHtml()}</div><h3 class="settings-sub">工具包</h3><div id="envPacks" class="card-list">${envPacksHtml()}</div><div class="setting-row"><div class="setting-copy"><strong>另装</strong><small>清单之外常用的，包名以空格分开</small></div><div class="setting-actions env-extra"><label class="setting-inline">Python<input id="envPip" class="field" spellcheck="false" placeholder="如 sympy jieba" value="${escapeHtml(s.pip)}"></label><label class="setting-inline">Node<input id="envNpm" class="field" spellcheck="false" placeholder="如 pnpm" value="${escapeHtml(s.npm)}"></label></div></div><div class="setting-row"><div class="setting-copy"><strong>下载源</strong><small>国内镜像走清华、中科大与 npmmirror；官方走 PyPI、GitHub 与 npmjs。模型往后自己装包也走这一路</small></div><div class="segmented">${[
    ["china", "国内镜像"],
    ["official", "官方"]
  ]
    .map(
      ([value, label]) => `<button type="button" data-env-mirror="${value}" class="${s.mirror === value ? "active" : ""}">${label}</button>`
    )
    .join("")}</div></div></div>`;
}
function envStatusHtml() {
  if (apiBase === null)
    return `<div class="card"><div class="card-head"><span class="card-name">需要本机桥接</span><span class="card-state">环境由桥接装、由桥接起的进程用；桥接接通后再来</span></div></div>`;
  if (!envStatus) return `<div class="card"><div class="card-head"><span class="card-name">查看中…</span></div></div>`;
  const { state, job, home } = envStatus,
    running = !!job?.running;
  const summary = state
    ? `${state.python} · ${state.packs.length - 1} 组工具 · ${formatDay(state.at)}准备`
    : "勾选要用的工具，点「准备环境」；头一回要下载几十到几百 MB";
  const log =
    job && (running || job.error)
      ? `<div class="card-note">${escapeHtml(running ? `正在${job.step || "开始"}…` : `没装成：${job.error}`)}</div><pre class="env-log">${escapeHtml(job.log.join("\n"))}</pre>`
      : "";
  return `<div class="card"><div class="card-head"><span class="card-name">${running ? "准备中" : state ? "已备好" : "尚未准备"}</span><span class="card-state${state ? " ok" : ""}" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span><span class="card-actions"><button id="envPrepare" type="button" class="outline-btn"${running ? " disabled" : ""}>${running ? "准备中…" : state ? "更新环境" : "准备环境"}</button>${state && !running ? `<button id="envClear" type="button" class="danger-btn">清空</button>` : ""}</span></div><div class="card-sub" title="${escapeHtml(home)}">${escapeHtml(home)}</div>${log}</div>`;
}
// 一组一张卡：名称与说明在左，状态在右——没选是空框，选了待装是朱色实心，装好了是一笔勾；装了又取消的标「待卸」，下回准备时卸掉
function envPacksHtml() {
  const packs = envStatus?.packs || [],
    chosen = new Set(envSettings().packs),
    installed = new Set(envStatus?.state?.packs || []);
  if (!packs.length) return `<p class="card-note">桥接接通后列出可装的工具包。</p>`;
  return packs
    .map(pack => {
      const on = pack.base || chosen.has(pack.id),
        state = installed.has(pack.id) ? (on ? "done" : "drop") : on ? "pick" : "",
        word = { done: "已装", pick: "待装", drop: "待卸" }[state] || "",
        contents = [...pack.pip, ...pack.npm].join(" · ") || pack.hint;
      return `<button type="button" class="card pickable env-pack" role="checkbox" aria-checked="${on}"${pack.base ? ' aria-disabled="true"' : ""} data-env-pack="${escapeHtml(pack.id)}" data-state="${state}"><span class="card-body"><span class="card-head"><span class="card-name">${escapeHtml(pack.name)}</span><span class="card-tag">${escapeHtml(pack.tag)}</span></span><span class="card-note">${escapeHtml(pack.note)}</span>${contents ? `<span class="card-sub" title="${escapeHtml(contents)}">${escapeHtml(contents)}</span>` : ""}</span><span class="env-pack-word">${word}</span><span class="card-tick" aria-hidden="true">${state === "done" ? `<svg viewBox="0 0 22 22"><path d="M4.5 11.8c1.6 1.2 3 2.6 4.3 4.3C11 11.4 14 7.6 18 4.8"/></svg>` : ""}</span></button>`;
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
  if (settingsTab !== "env") return;
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
    if (button.dataset.envMirror) {
      envSettings().mirror = button.dataset.envMirror;
      saveStore();
      button.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === button));
      return;
    }
    if (button.id === "envPrepare") {
      const s = envSettings();
      envStatus = await bridge("/api/env/prepare", {
        packs: s.packs,
        pip: splitNames(s.pip),
        npm: splitNames(s.npm),
        mirror: s.mirror
      }).catch(error => {
        toast(String(error.message || error));
        return envStatus;
      });
      return refreshEnv();
    }
    if (button.id === "envClear") {
      if (!(await askConfirm({ title: "清空环境？", body: "环境目录整个删去；装过的包都得重装。对话、卷宗与配置不受影响。", ok: "清空" })))
        return;
      envStatus = await bridge("/api/env/clear", {}).catch(error => {
        toast(String(error.message || error));
        return envStatus;
      });
      renderEnvStatus();
    }
  });
}
// 系统提示里的一句：环境备好了，告诉模型有哪些、缺的往哪装
function envHint() {
  const state = envStatus?.state;
  if (!state) return "";
  const kits = (envStatus.packs || [])
    .filter(pack => !pack.base && state.packs.includes(pack.id))
    .map(pack => `${pack.name}（${pack.hint || [...pack.pip, ...pack.npm].slice(0, 6).join("、")}）`);
  const extra = [...state.pip, ...state.npm];
  return prompt("work.env", { kits: [state.python, ...kits, ...(extra.length ? [`另装 ${extra.join("、")}`] : [])].join("；") });
}
