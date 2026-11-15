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
  return `<div id="mcpPage"><h2>MCP</h2><div id="mcpList" class="card-list">${mcpCardsHtml()}</div><div class="card-foot"><button id="mcpAdd" class="outline-btn" type="button">${t(`＋ 新增服务`)}</button><button id="mcpJson" class="outline-btn" type="button">${mcpJsonOpen ? t("收起 JSON") : t("以 JSON 编辑")}</button></div><div id="mcpJsonBox" class="json-box${mcpJsonOpen ? "" : " hidden"}">${mcpJsonHtml()}</div></div>`;
}
function mcpCardsHtml() {
  const names = Object.keys(mcpUserConfigs());
  const cards = names.map(name => (name === mcpEditing ? mcpFormHtml(name) : mcpCardHtml(name)));
  if (mcpEditing === "") cards.unshift(mcpFormHtml(""));
  return cards.join("") || `<p class="card-note">${t(`尚未接入任何服务`)}</p>`;
}
function mcpCardHtml(name) {
  const config = mcpUserConfigs()[name],
    state = mcp.servers[name];
  const [kind, text] = config.disabled
    ? ["", t("已停用")]
    : !state
      ? ["", t("接通中…")]
      : state.ok
        ? [
            "ok",
            t`${state.tools.length} 件工具 · ${mcp.lazy.includes(name) ? t("按需给") : t("逐件给")}${state.server?.version ? ` · v${state.server.version}` : ""}`
          ]
        : ["err", t`连接失败：${state.error}`];
  const where = config.command ? [config.command, ...(config.args || [])].join(" ") : config.url;
  const tools = state?.ok
    ? `<details class="card-more"><summary>${t(`工具`)}</summary><div class="card-chips">${state.tools.map(tool => `<span>${escapeHtml(tool.name)}${mcpReadOnly(tool) ? "<small>" + t("只读") + "</small>" : ""}</span>`).join("")}</div></details>`
    : "";
  return `<div class="card" data-mcp="${escapeHtml(name)}"><div class="card-head"><span class="card-name">${escapeHtml(name)}</span><span class="card-tag">${config.command ? t("本机") : t("远端")}</span><span class="card-state ${kind}" title="${escapeHtml(text)}">${escapeHtml(text)}</span><span class="card-actions"><button type="button" class="outline-btn" data-mcp-action="edit">${t(`编辑`)}</button><button type="button" class="outline-btn" data-mcp-action="toggle">${config.disabled ? t("启用") : t("停用")}</button>${config.disabled ? "" : `<button type="button" class="outline-btn" data-mcp-action="restart">${t(`重连`)}</button>`}</span></div><div class="card-sub" title="${escapeHtml(where)}">${escapeHtml(where)}</div>${tools}</div>`;
}
// 就地改的表单：本机与远端两种接法各有几栏；键值对一行一个；配置里表单不认得的字段原样留着
function mcpFormHtml(name) {
  const config = mcpMask(mcpUserConfigs()[name] || { command: "" }),
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
  return `<div class="card editing" data-mcp-edit="${escapeHtml(name)}"><div class="profile-grid">${field(t("名称"), "name", name, t("如 github"), false)}<label>${t(`接法`)}<div class="segmented"><button type="button" data-mcp-kind="local" class="${local ? "active" : ""}">${t(`本机程序`)}</button><button type="button" data-mcp-kind="remote" class="${local ? "" : "active"}">${t(`远端地址`)}</button></div></label>${
    local
      ? `${field(t("命令"), "command", config.command, t("npx、uvx、python，或程序的完整路径"))}${area(t("参数"), "args", (config.args || []).join("\n"), t("一行一个"))}${field(t("工作目录"), "cwd", config.cwd, t("可不填"))}${area(t("环境变量"), "env", pairs(config.env, "="), t("KEY=值，一行一个；令牌多放在这里"))}`
      : `${field(t("地址"), "url", config.url, "https://…/mcp")}${area(t("请求头"), "headers", pairs(config.headers, ": "), t("Authorization: Bearer …，一行一个"))}<label class="check profile-full"><input type="checkbox" data-f="sse"${/sse/i.test(config.type || "") ? " checked" : ""}>${t(`旧式 HTTP+SSE（未勾选时连接失败亦会自动回退）`)}</label>`
  }${field(t("单次最多等（秒）"), "timeout", config.timeout, t("默认 600"), false)}<label>${t(`交给模型`)}<div class="segmented">${[
    ["auto", t("按多少定")],
    ["inline", t("逐件")],
    ["lazy", t("按需")]
  ]
    .map(([value, label]) => `<button type="button" data-mcp-load="${value}" class="${load === value ? "active" : ""}">${label}</button>`)
    .join(
      ""
    )}</div></label>${field(t("免请示的工具"), "autoApprove", (config.autoApprove || []).join(", "), t("工具名，逗号分隔；只读工具本不请示"))}${area(t("给模型的话"), "note", config.note || "", t("随系统提示交给模型"))}</div><div class="card-form-foot"><button type="button" class="outline-btn" data-mcp-form="save">${t(`保存`)}</button><button type="button" class="outline-btn" data-mcp-form="cancel">${t(`取消`)}</button><button type="button" class="outline-btn" data-mcp-form="reveal">${mcpRevealed ? t("遮住密钥") : t("显示密钥")}</button><span class="card-error"></span>${name ? `<button type="button" class="danger-btn" data-mcp-form="delete">${t(`删除`)}</button>` : ""}</div></div>`;
}
/** @type {"local"|"remote"|null} 表单里切了接法、还没存时记在这里 */
let mcpFormKind = null;
function mcpJsonHtml() {
  const servers = Object.fromEntries(Object.entries(mcpUserConfigs()).map(([name, config]) => [name, mcpMask(config)]));
  return `<div class="json-head"><span>${t(`整份配置 · mcpServers 格式；遮蔽的密钥原样保留即沿用`)}</span><button type="button" class="outline-btn" id="mcpJsonReveal">${mcpRevealed ? t("遮住密钥") : t("显示密钥")}</button></div><textarea id="mcpConfig" class="field field-area json-editor" spellcheck="false" autocomplete="off">${escapeHtml(JSON.stringify({ mcpServers: servers }, null, 2))}</textarea><div class="card-form-foot"><button id="mcpJsonSave" class="outline-btn" type="button">${t(`保存并连接`)}</button><span id="mcpError" class="card-error"></span></div>`;
}
// 环境变量与请求头里像密钥的值遮住（显示密钥时不遮）
function mcpMask(config) {
  if (mcpRevealed) return config;
  const hide = object =>
    object && Object.fromEntries(Object.entries(object).map(([key, value]) => [key, SECRET_KEY.test(key) && value ? SECRET_MASK : value]));
  return { ...config, ...(config.env ? { env: hide(config.env) } : {}), ...(config.headers ? { headers: hide(config.headers) } : {}) };
}
// 显示/遮住只换值、不重画（重画会冲掉在填的）：遮着的换回原值；遮时只遮没改过的原值——新填的遮了就找不回，照旧露着
function mcpSwapSecret(name, part, key, value) {
  const original = mcpUserConfigs()[name]?.[part]?.[key];
  if (mcpRevealed) return value === SECRET_MASK && original !== undefined ? original : value;
  return SECRET_KEY.test(key) && value && value === original ? SECRET_MASK : value;
}
// 表单里的键值对一行一个（env 用「=」、请求头用「: 」）
function mcpSwapLines(area, name, part, sep) {
  if (!area) return;
  area.value = area.value
    .split("\n")
    .map(line => {
      const at = line.indexOf(sep),
        value = line.slice(at + 1).trim(),
        next = at < 0 ? value : mcpSwapSecret(name, part, line.slice(0, at).trim(), value);
      return next === value ? line : `${line.slice(0, at + 1)}${part === "headers" ? " " : ""}${next}`;
    })
    .join("\n");
}
function mcpSwapJson(textarea) {
  const parsed = JSON.parse(textarea.value || "{}"),
    servers = parsed.mcpServers ?? parsed;
  for (const [name, config] of Object.entries(servers || {}))
    for (const part of ["env", "headers"])
      for (const [key, value] of Object.entries(config?.[part] || {}))
        if (typeof value === "string") config[part][key] = mcpSwapSecret(name, part, key, value);
  textarea.value = JSON.stringify(parsed, null, 2);
}
// 存的时候：还是遮着的值换回原来的；原来没有这个值（改了名、新添的键却填了占位）就请用户重填
function mcpUnmask(name, config, previous) {
  for (const part of ["env", "headers"])
    for (const [key, value] of Object.entries(config[part] || {})) {
      if (value !== SECRET_MASK) continue;
      const original = previous?.[part]?.[key];
      if (original === undefined) throw Error(t`「${name}」的 ${key} 仍是遮蔽占位，原值已不可寻，请重填`);
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
  $("#mcpJson").textContent = mcpJsonOpen ? t("收起 JSON") : t("以 JSON 编辑");
}
// 粘进来的可能是整份 { mcpServers: {…} }，也可能只是里面那一层
function parseMcpConfig(text) {
  const parsed = JSON.parse(text || "{}");
  const servers = parsed.mcpServers ?? parsed;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw Error(t('应是 { "mcpServers": { 名字: 配置 } }'));
  for (const [name, config] of Object.entries(servers)) {
    if (!config || typeof config !== "object" || !(typeof config.command === "string" || typeof config.url === "string"))
      throw Error(t`「${name}」要有 command（本机程序）或 url（远端服务）`);
    mcpUnmask(name, config, mcpUserConfigs()[name]);
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
  // 一行漏了分隔符：indexOf 得 -1，会存成截掉末字的怪键（GITHUB_TOKEN → {"GITHUB_TOKE": "GITHUB_TOKEN"}），连上了报的错也看不懂；当场说
  const pairs = (key, sep) =>
    Object.fromEntries(
      lines(key)
        .map((line, i) => {
          const at = line.indexOf(sep);
          if (at < 0) throw Error(t`${key === "env" ? t("环境变量") : t("请求头")}第 ${i + 1} 行缺「${sep}」：${line}`);
          return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
        })
        .filter(([k]) => k)
    );
  const { command, args, cwd, env, url, headers, type, transport, timeout, load, autoApprove, note, ...rest } = previous || {};
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
  if (local ? !config.command : !config.url) throw Error(local ? t("请填命令") : t("请填地址"));
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
    ...(approve.length ? { autoApprove: approve } : {}),
    ...(value("note") ? { note: value("note") } : {})
  };
}
function bindMcpEvents() {
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
  // 只开合，不重画：在改的卡片与框里没存的字都留着
  $("#mcpJson").addEventListener("click", () => {
    mcpJsonOpen = !mcpJsonOpen;
    $("#mcpJsonBox").classList.toggle("hidden", !mcpJsonOpen);
    $("#mcpJson").textContent = mcpJsonOpen ? t("收起 JSON") : t("以 JSON 编辑");
  });
  // 整页一个委托：设置页每画一回，这一页连同监听一起换新
  $("#mcpPage").addEventListener("click", async event => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.id === "mcpJsonReveal") {
      try {
        mcpRevealed = !mcpRevealed;
        mcpSwapJson($("#mcpConfig"));
        $("#mcpError").textContent = "";
      } catch {
        mcpRevealed = !mcpRevealed;
        $("#mcpError").textContent = t("JSON 有误，改好再切");
      }
      target.textContent = mcpRevealed ? t("遮住密钥") : t("显示密钥");
      return;
    }
    if (target.id === "mcpJsonSave") {
      try {
        const servers = parseMcpConfig($("#mcpConfig").value);
        mcpEditing = null;
        mcp.servers = {};
        commit(servers);
      } catch (error) {
        $("#mcpError").textContent = tr(String(error.message || error));
      }
      return;
    }
    const card = target.closest("[data-mcp]");
    if (card && target.dataset.mcpAction) {
      const name = card.dataset.mcp,
        config = mcpUserConfigs()[name];
      if (target.dataset.mcpAction === "edit") {
        mcpEditing = name;
        mcpFormKind = null;
        return renderMcpSettings();
      }
      if (target.dataset.mcpAction === "toggle") {
        if (config.disabled) delete config.disabled;
        else config.disabled = true;
      }
      return commit(mcpUserConfigs(), [name]);
    }
    const form = target.closest("[data-mcp-edit]");
    if (!form) return;
    // 切接法：换一套栏，两套共有的几栏（名称、等多久、交给模型、免请示、给模型的话）已填的留着
    if (target.dataset.mcpKind) {
      mcpFormKind = /** @type {"local"|"remote"} */ (target.dataset.mcpKind);
      const typed = [...form.querySelectorAll("input[data-f]:not([type=checkbox]), textarea[data-f]")].map(el => [el.dataset.f, el.value]),
        load = form.querySelector("[data-mcp-load].active")?.dataset.mcpLoad;
      form.outerHTML = mcpFormHtml(form.dataset.mcpEdit);
      const fresh = $(`#mcpList [data-mcp-edit="${CSS.escape(form.dataset.mcpEdit)}"]`);
      for (const [key, value] of typed) {
        const el = fresh.querySelector(`[data-f="${key}"]`);
        if (el) el.value = value;
      }
      fresh.querySelectorAll("[data-mcp-load]").forEach(b => b.classList.toggle("active", b.dataset.mcpLoad === load));
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
      mcpSwapLines(form.querySelector('[data-f="env"]'), before, "env", "=");
      mcpSwapLines(form.querySelector('[data-f="headers"]'), before, "headers", ":");
      target.textContent = mcpRevealed ? t("遮住密钥") : t("显示密钥");
      return;
    }
    if (action === "delete") {
      if (
        !(await askConfirm({
          title: t`删除服务「${before}」？`,
          body: t("该服务将断开连接，配置将被移除。"),
          ok: t("删除")
        })) ||
        !form.isConnected
      )
        return;
      const { [before]: _gone, ...rest } = mcpUserConfigs();
      mcpEditing = null;
      delete mcp.servers[before];
      return commit(rest);
    }
    if (action !== "save") return;
    const error = form.querySelector(".card-error");
    try {
      const name = form.querySelector('[data-f="name"]').value.trim();
      if (!name) throw Error(t("请填名称"));
      if (name !== before && mcpUserConfigs()[name]) throw Error(t`已有名为「${name}」的服务`);
      const config = mcpUnmask(name, mcpFormConfig(form, mcpUserConfigs()[before]), mcpUserConfigs()[before]);
      // 改了名的留在原来的位置
      const servers = before
        ? Object.fromEntries(Object.entries(mcpUserConfigs()).map(([key, value]) => (key === before ? [name, config] : [key, value])))
        : { ...mcpUserConfigs(), [name]: config };
      mcpEditing = null;
      delete mcp.servers[before];
      commit(servers, [name]);
    } catch (problem) {
      error.textContent = String(problem.message || problem);
    }
  });
}
