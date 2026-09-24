// 言 · 设置 → MCP：接入外部 MCP 服务的配置与各服务的状态。配置照通用的 mcpServers 写法，服务说明里给的片段整段粘进来即可；
// 怎么连、怎么交给模型在 15-tools/60-mcp.js 与 server/mcp/
function mcpSettingsHtml() {
  const bridged = apiBase !== null;
  return `<h2>MCP</h2><p class="settings-lead">接入外部的 MCP 服务，它们的工具便归模型所用。配置照通用写法：本机程序填 command、args（可带 cwd、env），远端服务填 url、headers；服务说明里给的配置片段，整段粘进来即可。${bridged ? "" : "MCP 服务由本机桥接起、连，桥接接通后才可用。"}</p><div id="mcpStatus" class="mcp-list">${mcpStatusHtml()}</div><textarea id="mcpConfig" class="field field-area mcp-editor" spellcheck="false" autocomplete="off">${escapeHtml(JSON.stringify({ mcpServers: mcpConfigs() }, null, 2))}</textarea><div class="mcp-foot"><button id="mcpSave" class="outline-btn" type="button">保存并连接</button><span id="mcpError" class="mcp-error"></span></div><p class="mcp-note">可选字段：<code>disabled</code> 停用；<code>autoApprove</code> 列出免请示的工具名；<code>timeout</code> 单次调用最多等几秒（默认 600）；<code>load</code> 写 "inline" 逐件交给模型、"lazy" 只给目录按需取用，不写则按工具的多少自动定。服务标为只读的工具径直调用，其余在「问而后行」下逐次请示。MCP 服务以你的权限运行在本机，不受沙箱约束。</p>`;
}
function mcpStatusHtml() {
  const names = Object.keys(mcpConfigs());
  if (!names.length) return `<p class="mcp-empty">尚未接入任何服务。</p>`;
  return names
    .map(name => {
      const config = mcpConfigs()[name],
        state = mcp.servers[name];
      const [kind, text] = config.disabled
        ? ["off", "已停用"]
        : !state
          ? ["", apiBase === null ? "等桥接接通" : "连接中…"]
          : state.ok
            ? [
                "ok",
                `${state.tools.length} 件工具 · ${mcp.lazy.includes(name) ? "按需" : "逐件"}${state.server?.version ? ` · v${state.server.version}` : ""}`
              ]
            : ["err", `连不上：${state.error}`];
      return `<div class="mcp-row" data-mcp="${escapeHtml(name)}"><span class="mcp-name">${escapeHtml(name)}</span><span class="mcp-state ${kind}" title="${escapeHtml(text)}">${escapeHtml(text)}</span><button type="button" class="outline-btn" data-mcp-action="toggle">${config.disabled ? "启用" : "停用"}</button>${config.disabled ? "" : `<button type="button" class="outline-btn" data-mcp-action="restart">重连</button>`}</div>`;
    })
    .join("");
}
// 连接状态变了：只换状态列表，正在改的配置不动
function renderMcpStatus() {
  if (settingsTab !== "mcp" || $("#settingsModal").classList.contains("hidden")) return;
  $("#mcpStatus").innerHTML = mcpStatusHtml();
}
// 粘进来的可能是整份 { mcpServers: {…} }，也可能只是里面那一层
function parseMcpConfig(text) {
  const parsed = JSON.parse(text || "{}");
  const servers = parsed.mcpServers ?? parsed;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) throw Error('应是 { "mcpServers": { 名字: 配置 } }');
  for (const [name, config] of Object.entries(servers))
    if (!config || typeof config !== "object" || !(typeof config.command === "string" || typeof config.url === "string"))
      throw Error(`「${name}」要有 command（本机程序）或 url（远端服务）`);
  return servers;
}
function bindMcpEvents() {
  if (settingsTab !== "mcp") return;
  const reconnect = (restart = []) => {
    saveStore();
    renderMcpStatus();
    void mcpReady(restart);
  };
  $("#mcpSave").addEventListener("click", () => {
    try {
      store.settings.mcpServers = parseMcpConfig($("#mcpConfig").value);
    } catch (error) {
      $("#mcpError").textContent = String(error.message || error);
      return;
    }
    $("#mcpError").textContent = "";
    $("#mcpConfig").value = JSON.stringify({ mcpServers: mcpConfigs() }, null, 2);
    // 改过的服务重连：状态先回到「连接中」
    mcp.servers = {};
    reconnect();
  });
  $("#mcpStatus").addEventListener("click", event => {
    const button = event.target.closest("[data-mcp-action]");
    if (!button) return;
    const name = button.closest("[data-mcp]").dataset.mcp,
      config = mcpConfigs()[name];
    delete mcp.servers[name];
    if (button.dataset.mcpAction === "toggle") {
      if (config.disabled) delete config.disabled;
      else config.disabled = true;
      $("#mcpConfig").value = JSON.stringify({ mcpServers: mcpConfigs() }, null, 2);
      reconnect();
    } else reconnect([name]);
  });
}
