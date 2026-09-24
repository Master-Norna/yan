// 言 · 设置 → MCP：接入的服务一张卡一个，可新增、就地改、停用、重连、删去；整份配置也能以 JSON 改（通用的 mcpServers 写法，
// 服务说明里给的片段整段粘进来即可）。环境变量与请求头里像密钥的值默认遮住，存的时候还是遮着的就沿用原值；「显示密钥」才露出来。
// 怎么连、怎么交给模型在 15-tools/60-mcp.js 与 server/mcp/
const SECRET_KEY = /key|token|secret|pass|pwd|auth|cookie|credential|session|pat$/i,
  SECRET_MASK = "******（已隐藏）";
/** @type {string|null} 正在改的那张卡：服务名，新增时是 "" */
let mcpEditing = null,
  mcpRevealed = false,
  mcpJsonOpen = false;

function mcpSettingsHtml() {
  const bridged = apiBase !== null;
  return `<div id="mcpPage"><h2>MCP</h2><p class="settings-lead">接入外部的 MCP 服务，它们的工具便归模型所用。本机程序填命令与参数，远端服务填地址${bridged ? "" : "；MCP 服务由本机桥接起、连，桥接接通后才可用"}。</p><div id="mcpList" class="card-list">${mcpCardsHtml()}</div><div class="card-foot"><button id="mcpAdd" class="outline-btn" type="button">＋ 新增服务</button><button id="mcpJson" class="outline-btn" type="button">${mcpJsonOpen ? "收起 JSON" : "以 JSON 编辑"}</button></div><div id="mcpJsonBox" class="json-box${mcpJsonOpen ? "" : " hidden"}">${mcpJsonHtml()}</div><p class="settings-note">服务标为只读的工具径直调用，其余在「问而后行」下逐次请示。工具多的服务只给模型一张目录、按需取用。MCP 服务以你的权限运行在本机，不受沙箱约束；导出备份时不带环境变量与请求头。</p></div>`;
}
function mcpCardsHtml() {
  const names = Object.keys(mcpConfigs());
  const cards = names.map(name => (name === mcpEditing ? mcpFormHtml(name) : mcpCardHtml(name)));
  if (mcpEditing === "") cards.unshift(mcpFormHtml(""));
  return cards.join("") || `<p class="card-note">尚未接入任何服务。</p>`;
}
function mcpCardHtml(name) {
  const config = mcpConfigs()[name],
    state = mcp.servers[name];
  const [kind, text] = config.disabled
    ? ["", "已停用"]
    : !state
      ? ["", apiBase === null ? "等桥接接通" : "连接中…"]
      : state.ok
        ? [
            "ok",
            `${state.tools.length} 件工具 · ${mcp.lazy.includes(name) ? "按需给" : "逐件给"}${state.server?.version ? ` · v${state.server.version}` : ""}`
          ]
        : ["err", `连不上：${state.error}`];
  const where = config.command ? [config.command, ...(config.args || [])].join(" ") : config.url;
  const tools = state?.ok
    ? `<details class="card-more"><summary>工具</summary><div class="card-chips">${state.tools.map(tool => `<span>${escapeHtml(tool.name)}${mcpReadOnly(tool) ? "<small>只读</small>" : ""}</span>`).join("")}</div></details>`
    : "";
  return `<div class="card" data-mcp="${escapeHtml(name)}"><div class="card-head"><span class="card-name">${escapeHtml(name)}</span><span class="card-tag">${config.command ? "本机" : "远端"}</span><span class="card-state ${kind}" title="${escapeHtml(text)}">${escapeHtml(text)}</span><span class="card-actions"><button type="button" class="outline-btn" data-mcp-action="edit">编辑</button><button type="button" class="outline-btn" data-mcp-action="toggle">${config.disabled ? "启用" : "停用"}</button>${config.disabled ? "" : `<button type="button" class="outline-btn" data-mcp-action="restart">重连</button>`}</span></div><div class="card-sub" title="${escapeHtml(where)}">${escapeHtml(where)}</div>${tools}</div>`;
}
// 就地改的表单：本机与远端两种接法各有几栏；键值对一行一个；配置里表单不认得的字段原样留着
function mcpFormHtml(name) {
  const config = mcpMask(mcpConfigs()[name] || { command: "" }),
    local = mcpFormKind === "remote" ? false : mcpFormKind === "local" ? true : !config.url;
  const pairs = (object, sep) =>
    Object.entries(object || {})
      .map(([key, value]) => `${key}${sep}${value}`)
      .join("\n");
  const field = (label, key, value, hint = "", full = true) =>
    `<label${full ? ' class="profile-full"' : ""}>${label}<input class="field wide" data-f="${key}" value="${escapeHtml(value ?? "")}" placeholder="${escapeHtml(hint)}" spellcheck="false" autocomplete="off"></label>`;
  const area = (label, key, value, hint) =>
    `<label class="profile-full">${label}<textarea class="field wide field-area" data-f="${key}" placeholder="${escapeHtml(hint)}" spellcheck="false">${escapeHtml(value)}</textarea></label>`;
  const load = config.load || "auto";
  return `<div class="card editing" data-mcp-edit="${escapeHtml(name)}"><div class="profile-grid">${field("名称", "name", name, "如 github", false)}<label>接法<div class="segmented"><button type="button" data-mcp-kind="local" class="${local ? "active" : ""}">本机程序</button><button type="button" data-mcp-kind="remote" class="${local ? "" : "active"}">远端地址</button></div></label>${
    local
      ? `${field("命令", "command", config.command, "npx、uvx、python，或程序的完整路径")}${area("参数", "args", (config.args || []).join("\n"), "一行一个")}${field("工作目录", "cwd", config.cwd, "可不填")}${area("环境变量", "env", pairs(config.env, "="), "KEY=值，一行一个；令牌多放在这里")}`
      : `${field("地址", "url", config.url, "https://…/mcp")}${area("请求头", "headers", pairs(config.headers, ": "), "Authorization: Bearer …，一行一个")}<label class="check profile-full"><input type="checkbox" data-f="sse"${/sse/i.test(config.type || "") ? " checked" : ""}>旧式 HTTP+SSE（没勾时连不上也会自动退回再试）</label>`
  }${field("单次最多等（秒）", "timeout", config.timeout, "默认 600", false)}<label>交给模型<div class="segmented">${[
    ["auto", "按多少定"],
    ["inline", "逐件"],
    ["lazy", "按需"]
  ]
    .map(([value, label]) => `<button type="button" data-mcp-load="${value}" class="${load === value ? "active" : ""}">${label}</button>`)
    .join(
      ""
    )}</div></label>${field("免请示的工具", "autoApprove", (config.autoApprove || []).join(", "), "工具名，逗号分隔；只读的本就不问")}</div><div class="card-form-foot"><button type="button" class="outline-btn" data-mcp-form="save">保存</button><button type="button" class="outline-btn" data-mcp-form="cancel">取消</button><button type="button" class="outline-btn" data-mcp-form="reveal">${mcpRevealed ? "遮住密钥" : "显示密钥"}</button><span class="card-error"></span>${name ? `<button type="button" class="danger-btn" data-mcp-form="delete">删除</button>` : ""}</div></div>`;
}
/** @type {"local"|"remote"|null} 表单里切了接法、还没存时记在这里 */
let mcpFormKind = null;
function mcpJsonHtml() {
  const servers = Object.fromEntries(Object.entries(mcpConfigs()).map(([name, config]) => [name, mcpMask(config)]));
  return `<div class="json-head"><span>整份配置 · mcpServers 写法；遮住的密钥保持原样即沿用原值</span><button type="button" class="outline-btn" id="mcpJsonReveal">${mcpRevealed ? "遮住密钥" : "显示密钥"}</button></div><textarea id="mcpConfig" class="field field-area json-editor" spellcheck="false" autocomplete="off">${escapeHtml(JSON.stringify({ mcpServers: servers }, null, 2))}</textarea><div class="card-form-foot"><button id="mcpJsonSave" class="outline-btn" type="button">保存并连接</button><span id="mcpError" class="card-error"></span></div>`;
}
// 环境变量与请求头里像密钥的值遮住（显示密钥时不遮）
function mcpMask(config) {
  if (mcpRevealed) return config;
  const hide = object =>
    object && Object.fromEntries(Object.entries(object).map(([key, value]) => [key, SECRET_KEY.test(key) && value ? SECRET_MASK : value]));
  return { ...config, ...(config.env ? { env: hide(config.env) } : {}), ...(config.headers ? { headers: hide(config.headers) } : {}) };
}
// 存的时候：还是遮着的值换回原来的；原来没有这个值（改了名、新添的键却填了占位）就请用户重填
function mcpUnmask(name, config, previous) {
  for (const part of ["env", "headers"])
    for (const [key, value] of Object.entries(config[part] || {})) {
      if (value !== SECRET_MASK) continue;
      const original = previous?.[part]?.[key];
      if (original === undefined) throw Error(`「${name}」的 ${key} 还是隐藏的占位，找不到原值，请重填`);
      config[part][key] = original;
    }
  return config;
}
// 连接状态变了：卡片换新，正在改的那张不动
function renderMcpStatus() {
  if (settingsTab !== "mcp" || $("#settingsModal").classList.contains("hidden")) return;
  for (const card of $("#mcpList").querySelectorAll("[data-mcp]")) card.outerHTML = mcpCardHtml(card.dataset.mcp);
  if (!$("#mcpList").children.length) $("#mcpList").innerHTML = mcpCardsHtml();
}
function renderMcpSettings() {
  $("#mcpList").innerHTML = mcpCardsHtml();
  $("#mcpJsonBox").innerHTML = mcpJsonHtml();
  $("#mcpJsonBox").classList.toggle("hidden", !mcpJsonOpen);
  $("#mcpJson").textContent = mcpJsonOpen ? "收起 JSON" : "以 JSON 编辑";
}
// 粘进来的可能是整份 { mcpServers: {…} }，也可能只是里面那一层
function parseMcpConfig(text) {
  const parsed = JSON.parse(text || "{}");
  const servers = parsed.mcpServers ?? parsed;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw Error('应是 { "mcpServers": { 名字: 配置 } }');
  for (const [name, config] of Object.entries(servers)) {
    if (!config || typeof config !== "object" || !(typeof config.command === "string" || typeof config.url === "string"))
      throw Error(`「${name}」要有 command（本机程序）或 url（远端服务）`);
    mcpUnmask(name, config, mcpConfigs()[name]);
  }
  return servers;
}
// 从表单收一份配置：认得的几栏按表单来，其余字段照旧
function mcpFormConfig(form, previous) {
  const value = key => form.querySelector(`[data-f="${key}"]`)?.value.trim() ?? "";
  const lines = key =>
    value(key)
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean);
  const pairs = (key, sep) =>
    Object.fromEntries(
      lines(key)
        .map(line => [line.slice(0, line.indexOf(sep)).trim(), line.slice(line.indexOf(sep) + 1).trim()])
        .filter(([k]) => k)
    );
  const { command, args, cwd, env, url, headers, type, transport, timeout, load, autoApprove, ...rest } = previous || {};
  const local = !!form.querySelector('[data-mcp-kind="local"].active');
  /** @type {Record<string, any>} */
  const config = local
    ? {
        command: value("command"),
        ...(lines("args").length ? { args: lines("args") } : {}),
        ...(value("cwd") ? { cwd: value("cwd") } : {}),
        ...(lines("env").length ? { env: pairs("env", "=") } : {})
      }
    : {
        url: value("url"),
        ...(lines("headers").length ? { headers: pairs("headers", ":") } : {}),
        ...(form.querySelector('[data-f="sse"]').checked ? { type: "sse" } : {})
      };
  if (local ? !config.command : !config.url) throw Error(local ? "请填命令" : "请填地址");
  const seconds = Number(value("timeout")),
    chosen = form.querySelector("[data-mcp-load].active").dataset.mcpLoad,
    approve = value("autoApprove")
      .split(/[,，\s]+/)
      .filter(Boolean);
  return {
    ...rest,
    ...config,
    ...(seconds > 0 ? { timeout: seconds } : {}),
    ...(chosen !== "auto" ? { load: chosen } : {}),
    ...(approve.length ? { autoApprove: approve } : {})
  };
}
function bindMcpEvents() {
  if (settingsTab !== "mcp") return;
  const commit = (servers, restart = []) => {
    store.settings.mcpServers = servers;
    saveStore();
    for (const name of restart) delete mcp.servers[name];
    renderMcpSettings();
    void mcpReady(restart);
  };
  $("#mcpAdd").addEventListener("click", () => {
    mcpEditing = "";
    mcpFormKind = null;
    renderMcpSettings();
    $('#mcpList [data-f="name"]')?.focus();
  });
  $("#mcpJson").addEventListener("click", () => {
    mcpJsonOpen = !mcpJsonOpen;
    renderMcpSettings();
  });
  // 整页一个委托：设置页每画一回，这一页连同监听一起换新
  $("#mcpPage").addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.id === "mcpJsonReveal") {
      mcpRevealed = !mcpRevealed;
      return renderMcpSettings();
    }
    if (target.id === "mcpJsonSave") {
      try {
        const servers = parseMcpConfig($("#mcpConfig").value);
        mcpEditing = null;
        mcp.servers = {};
        commit(servers);
      } catch (error) {
        $("#mcpError").textContent = String(error.message || error);
      }
      return;
    }
    const card = target.closest("[data-mcp]");
    if (card && target.dataset.mcpAction) {
      const name = card.dataset.mcp,
        config = mcpConfigs()[name];
      if (target.dataset.mcpAction === "edit") {
        mcpEditing = name;
        mcpFormKind = null;
        return renderMcpSettings();
      }
      if (target.dataset.mcpAction === "toggle") {
        if (config.disabled) delete config.disabled;
        else config.disabled = true;
      }
      return commit(mcpConfigs(), [name]);
    }
    const form = target.closest("[data-mcp-edit]");
    if (!form) return;
    // 切接法：换一套栏，已填的名称留着
    if (target.dataset.mcpKind) {
      mcpFormKind = /** @type {"local"|"remote"} */ (target.dataset.mcpKind);
      const typed = form.querySelector('[data-f="name"]').value;
      form.outerHTML = mcpFormHtml(form.dataset.mcpEdit);
      $(`#mcpList [data-mcp-edit="${CSS.escape(form.dataset.mcpEdit)}"] [data-f="name"]`).value = typed;
      return;
    }
    if (target.dataset.mcpLoad) return form.querySelectorAll("[data-mcp-load]").forEach(b => b.classList.toggle("active", b === target));
    const action = target.dataset.mcpForm,
      before = form.dataset.mcpEdit;
    if (action === "cancel") {
      mcpEditing = null;
      return renderMcpSettings();
    }
    if (action === "reveal") {
      mcpRevealed = !mcpRevealed;
      return (form.outerHTML = mcpFormHtml(before));
    }
    if (action === "delete") {
      const { [before]: _gone, ...rest } = mcpConfigs();
      mcpEditing = null;
      delete mcp.servers[before];
      return commit(rest);
    }
    if (action !== "save") return;
    const error = form.querySelector(".card-error");
    try {
      const name = form.querySelector('[data-f="name"]').value.trim();
      if (!name) throw Error("请填名称");
      if (name !== before && mcpConfigs()[name]) throw Error(`已有名为「${name}」的服务`);
      const config = mcpUnmask(name, mcpFormConfig(form, mcpConfigs()[before]), mcpConfigs()[before]);
      // 改了名的留在原来的位置
      const servers = before
        ? Object.fromEntries(Object.entries(mcpConfigs()).map(([key, value]) => (key === before ? [name, config] : [key, value])))
        : { ...mcpConfigs(), [name]: config };
      mcpEditing = null;
      delete mcp.servers[before];
      commit(servers, [name]);
    } catch (problem) {
      error.textContent = String(problem.message || problem);
    }
  });
}
