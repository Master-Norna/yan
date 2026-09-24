// 言 · 预设：一套打包好的做法——提示词、给哪几组工具与哪几个 MCP 服务、用哪个模型、指令权限。
// 在模型菜单里选用：选了的对话都照这一套（提示词排在系统提示最前，工具只给挑中的，见 systemPrompt 与 toolDefinitions）；
// 新对话照上回选的。不选即言的本色。设置 → 预设里一张卡一个，就地改、改了即存
/** @type {string|null} 正在改的那张卡 */
let presetEditing = null;

/** @param {Conversation|null} conversation @returns {Preset|null} */
function presetOf(conversation) {
  // 还没发出的新对话：从组首「＋」来且组带了预设的，用组的
  const id = conversation ? conversation.presetId || "" : pendingGroup()?.presetId || store.settings.presetId;
  return (id && store.settings.presets.find(preset => preset.id === id)) || null;
}
// 选一个预设：记在这段对话上，新对话也照它；带了模型的换过去，带了权限的换上
function selectPreset(id) {
  const preset = store.settings.presets.find(item => item.id === id) || null,
    c = currentConversation();
  store.settings.presetId = preset?.id || "";
  if (c) {
    c.presetId = preset?.id || "";
    if (preset?.policy) c.commandPolicy = preset.policy;
    markDirty(c.id);
  }
  saveStore();
  if (preset?.profileId && profiles().some(p => p.id === preset.profileId)) selectProfile(preset.profileId);
  else closeModelMenu();
  renderHeader();
  renderSendButtons();
}
// 模型菜单里的一段：本色与各个预设；一个预设都没有时不占地方
function presetMenuHtml() {
  const presets = store.settings.presets;
  if (!presets.length) return "";
  const current = presetOf(currentConversation())?.id || "";
  const option = (id, name, note) =>
    `<button class="model-option preset-option${id === current ? " active" : ""}" data-preset="${escapeHtml(id)}"${id === current ? ' aria-current="true"' : ""} title="${escapeHtml(note)}"><strong><span class="model-dot"></span><span class="model-option-name">${escapeHtml(name)}</span></strong></button>`;
  return `<div class="menu-section"><div class="menu-section-title"><span>预设</span></div></div>${option("", "本色", "言之本色，不加预设")}${presets.map(preset => option(preset.id, preset.name, preset.prompt.split("\n")[0].slice(0, 80))).join("")}`;
}

function presetsSettingsHtml() {
  const presets = store.settings.presets;
  return `<div id="presetPage"><h2>预设</h2><p class="settings-lead">将提示词、工具、MCP 服务、模型与指令权限合为一套，即是预设。于输入框旁的模型菜单中选用，所选的对话皆依此行事；不选即为本色。</p><div class="card-list">${
    presets.map(preset => (preset.id === presetEditing ? presetFormHtml(preset) : presetCardHtml(preset))).join("") ||
    `<p class="card-note">尚无预设。</p>`
  }</div><div class="card-foot"><button id="presetAdd" class="outline-btn" type="button">＋ 新添预设</button></div></div>`;
}
/** @param {Preset} preset */
function presetCardHtml(preset) {
  const profile = profiles().find(p => p.id === preset.profileId),
    groups = preset.tools ? preset.tools.map(id => TOOL_GROUPS[id]).filter(Boolean) : null,
    parts = [
      groups ? (groups.length ? `工具：${groups.join("、")}` : "不带工具") : "工具全给",
      preset.mcp ? (preset.mcp.length ? `MCP：${preset.mcp.join("、")}` : "不接 MCP") : ""
    ].filter(Boolean);
  const first = preset.prompt.trim().split("\n")[0] || "（未写提示词）";
  return `<div class="card" data-preset-card="${escapeHtml(preset.id)}"><div class="card-head"><span class="card-name">${escapeHtml(preset.name)}</span>${profile ? `<span class="card-tag">${escapeHtml(profile.name)}</span>` : ""}${preset.policy ? `<span class="card-tag">${policyName(preset.policy)}</span>` : ""}<span class="card-state"></span><span class="card-actions"><button type="button" class="outline-btn" data-preset-action="edit">编辑</button><button type="button" class="outline-btn" data-preset-action="use">选用</button></span></div><div class="card-note" title="${escapeHtml(preset.prompt)}">${escapeHtml(first.slice(0, 120))}</div><div class="card-sub">${escapeHtml(parts.join(" · "))}</div></div>`;
}
/** @param {Preset} preset */
function presetFormHtml(preset) {
  const servers = Object.keys(mcpConfigs());
  const checks = (kind, entries, chosen) =>
    `<div class="preset-checks">${entries
      .map(
        ([id, label]) =>
          `<label class="check"><input type="checkbox" data-preset-${kind}="${escapeHtml(id)}"${!chosen || chosen.includes(id) ? " checked" : ""}>${escapeHtml(label)}</label>`
      )
      .join("")}</div>`;
  const policies = [
    ["", "照设置"],
    ["ask", "问而后行"],
    ["review", "审而后行"],
    ["auto", "径行"]
  ];
  return `<div class="card editing" data-preset-card="${escapeHtml(preset.id)}"><div class="profile-grid"><label class="profile-full">名称<input class="field wide" data-preset-field="name" value="${escapeHtml(preset.name)}" maxlength="24"></label><label class="profile-full">提示词<textarea class="field wide field-area preset-prompt" data-preset-field="prompt" placeholder="所任何职、所司何事、答以何种风格；列于系统提示之首" spellcheck="false">${escapeHtml(preset.prompt)}</textarea></label><label>模型<select class="field wide select" data-preset-field="profileId"><option value="">沿用当前模型</option>${profiles()
    .map(p => `<option value="${escapeHtml(p.id)}"${p.id === preset.profileId ? " selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join(
      ""
    )}</select></label><label>指令权限<div class="segmented">${policies.map(([value, label]) => `<button type="button" data-preset-policy="${value}" class="${preset.policy === value ? "active" : ""}">${label}</button>`).join("")}</div></label><div class="profile-full"><span class="preset-label">工具</span>${checks("tool", Object.entries(TOOL_GROUPS), preset.tools)}</div>${
    servers.length
      ? `<div class="profile-full"><span class="preset-label">MCP 服务</span>${checks(
          "mcp",
          servers.map(name => [name, name]),
          preset.mcp
        )}</div>`
      : ""
  }</div><div class="card-form-foot"><button type="button" class="outline-btn" data-preset-action="done">完成</button><button type="button" class="outline-btn" data-preset-action="use">选用</button><button type="button" class="danger-btn" data-preset-action="delete">删除</button></div></div>`;
}
function policyName(policy) {
  return { ask: "问而后行", review: "审而后行", auto: "径行" }[policy] || "";
}
function renderPresetSettings() {
  if (settingsTab !== "presets" || $("#settingsModal").classList.contains("hidden")) return;
  renderSettings();
}
function bindPresetEvents() {
  if (settingsTab !== "presets") return;
  const page = $("#presetPage"),
    presetIn = el => store.settings.presets.find(preset => preset.id === el.closest("[data-preset-card]")?.dataset.presetCard);
  $("#presetAdd").addEventListener("click", () => {
    const preset = normalizePreset({ id: uid(), name: "新预设", prompt: "" });
    store.settings.presets.push(preset);
    presetEditing = preset.id;
    saveStore();
    renderPresetSettings();
    /** @type {HTMLInputElement|null} */ (page.ownerDocument.querySelector('#presetPage [data-preset-field="name"]'))?.select();
  });
  // 文字与模型：边改边存，不重画（重画会丢光标）
  page.addEventListener("input", event => {
    const el = /** @type {HTMLInputElement} */ (event.target),
      preset = presetIn(el),
      key = el.dataset.presetField;
    if (!preset || !key) return;
    preset[key] = key === "name" ? el.value.trim() || "未命名" : el.value;
    saveStoreSoon();
    renderHeader();
  });
  // 勾选：全勾上存成 null（往后新添的组与服务也跟着给），否则存勾中的那几个
  page.addEventListener("change", event => {
    const el = /** @type {HTMLInputElement} */ (event.target),
      preset = presetIn(el);
    if (!preset || el.type !== "checkbox") return;
    const kind = el.dataset.presetTool !== undefined ? "tool" : "mcp",
      boxes = [...el.closest(".preset-checks").querySelectorAll("input")],
      chosen = boxes.filter(box => box.checked).map(box => box.dataset[kind === "tool" ? "presetTool" : "presetMcp"]);
    preset[kind === "tool" ? "tools" : "mcp"] = chosen.length === boxes.length ? null : chosen;
    saveStore();
  });
  page.addEventListener("click", async event => {
    const button = /** @type {HTMLElement} */ (event.target).closest("button"),
      preset = button && presetIn(button);
    if (!button || !preset) return;
    if (button.dataset.presetPolicy !== undefined) {
      preset.policy = /** @type {Preset["policy"]} */ (button.dataset.presetPolicy);
      saveStore();
      return button.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === button));
    }
    const action = button.dataset.presetAction;
    if (action === "edit") presetEditing = preset.id;
    if (action === "done") presetEditing = null;
    if (action === "use") {
      selectPreset(preset.id);
      toast(`已选用「${preset.name}」`);
    }
    if (action === "delete") {
      if (!(await askConfirm({ title: `删除预设「${preset.name}」？`, body: "选用它的对话将回到本色。", ok: "删除" }))) return;
      store.settings.presets = store.settings.presets.filter(item => item !== preset);
      if (store.settings.presetId === preset.id) store.settings.presetId = "";
      for (const c of store.conversations)
        if (c.presetId === preset.id) {
          c.presetId = "";
          markDirty(c.id);
        }
      presetEditing = null;
      saveStore();
      renderHeader();
    }
    renderPresetSettings();
  });
}
