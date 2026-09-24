// 言 · 消息动作、设置页、导入导出
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 生成中只拦会改动对话的动作（编辑、重答、续写、重试、切版本）；复制与就整条回复开旁注不碍事，下面还在写时上面照样可以注
const ACTIONS_WHILE_RUNNING = new Set(["copy", "note"]);
async function handleMessageAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button || (conversationRunning() && !ACTIONS_WHILE_RUNNING.has(button.dataset.action))) return;
  const c = currentConversation();
  if (!c) return;
  const id = button.closest("[data-message]")?.dataset.message,
    index = c.messages.findIndex(m => m.id === id);
  if (index < 0) return;
  const message = c.messages[index];
  if (button.dataset.action === "copy") {
    await copyText(message.content);
    return toast("已复制");
  }
  if (button.dataset.action === "note") return openSideIndex(message.id);
  if (button.dataset.action === "branch-prev" || button.dataset.action === "branch-next")
    return switchBranch(c, index, button.dataset.action === "branch-prev" ? -1 : 1);
  if (button.dataset.action === "cancel-edit") {
    editingMessageId = null;
    renderConversation(false);
    return;
  }
  if (button.dataset.action === "edit") {
    if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
    editingMessageId = message.id;
    renderConversation(false);
    requestAnimationFrame(() => {
      const input = document.querySelector(`[data-message="${message.id}"] .message-edit-input`);
      growEditor(input);
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
    return;
  }
  if (button.dataset.action === "save-edit")
    return saveEditedMessage(c, index, button.closest("[data-message]").querySelector(".message-edit-input").value);
  if (button.dataset.action === "resume") {
    if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
    let profile = activeProfile();
    if (!profile) return openSettings("models");
    if (profile.tools !== false && apiBase === null) {
      await ensureLocalBridge();
      profile = activeProfile() || profile;
    }
    if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
    if (!(await ensureWorkReady(c))) return;
    message.status = "streaming";
    message.error = "";
    delete message.interruptedAt;
    saveStore();
    renderConversation(false);
    await streamReply(c, message, profile, { resume: true });
    return;
  }
  if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
  const userIndex = [...c.messages.slice(0, index)].map(m => m.role).lastIndexOf("user");
  if (userIndex < 0) return;
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
  if (!(await ensureWorkReady(c))) return;
  forkTail(c, userIndex + 1);
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  c.messages.push(assistant);
  saveStore();
  renderConversation(true);
  await streamReply(c, assistant, profile);
}
/** @param {Conversation} conversation */
async function saveEditedMessage(conversation, index, value) {
  const text = value.trim();
  if (!text) return toast("尚未落笔");
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
  const old = conversation.messages[index];
  if (text === old.content) {
    editingMessageId = null;
    renderConversation(false);
    return;
  }
  if (!(await ensureWorkReady(conversation))) return;
  // 旧问题连同它后面的回答整段留作一个版本；新问题沿用原来的附件与引文
  forkTail(conversation, index);
  const message = { ...old, id: uid(), content: text, timestamp: now() };
  conversation.messages.push(message);
  conversation.updatedAt = now();
  if (index === 0 && conversation.titleAuto !== false) {
    conversation.title = titleFrom(text, message.attachments || []);
    conversation.titled = false;
  }
  editingMessageId = null;
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  conversation.messages.push(assistant);
  saveStore();
  render(true);
  await streamReply(conversation, assistant, profile);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

function openSettings(tab = settingsTab) {
  persistDraft();
  rememberScrollPosition();
  settingsTab = tab;
  showNow($("#settingsModal"));
  renderSettings();
}
function closeSettings() {
  hideWithFade($("#settingsModal"));
  // 「手记一条」后没写字就关了窗：那条空的不留（文本框随窗撤掉时未必触发 blur）
  const kept = store.memory.items.filter(item => String(item.text || "").trim());
  if (kept.length !== store.memory.items.length) {
    store.memory.items = kept;
    saveStore();
  }
  render();
}
function renderSettings() {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === settingsTab));
  const host = $("#settingsContent");
  const tabChanged = host.dataset.tab !== settingsTab;
  host.dataset.tab = settingsTab;
  if (settingsTab === "general") host.innerHTML = generalSettingsHtml();
  if (settingsTab === "appearance") host.innerHTML = appearanceSettingsHtml();
  if (settingsTab === "models") host.innerHTML = modelsSettingsHtml();
  if (settingsTab === "tools") host.innerHTML = toolsSettingsHtml();
  if (settingsTab === "memory") host.innerHTML = memorySettingsHtml();
  if (settingsTab === "about") host.innerHTML = aboutSettingsHtml();
  bindSettingsEvents();
  bindMemoryEvents();
  if (tabChanged) {
    host.classList.remove("tab-fade");
    void host.offsetWidth;
    host.classList.add("tab-fade");
  }
}
// 存储位置：对话、卷宗、配置（含模型配置）都在这一个 .yan 目录里，几个浏览器共用；换位置时整份拷过去，旧处留着
function storageSettingsHtml() {
  if (apiBase === null) return "";
  const info = bootstrap.store || {},
    parent = info.parent || "";
  return `<div class="setting-row"><div class="setting-copy"><strong>存储位置</strong><small>对话、卷宗与配置（含模型配置）都在 <code title="${escapeHtml(info.root || "")}">${escapeHtml(info.root || "")}</code> 里，几个浏览器共用这一份。填一个目录，就在它下面立 .yan 并把整份拷过去，旧处原样留着；那里已有言的数据则直接用它</small></div><div class="setting-actions setting-directory"><input id="settingStore" class="field" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(parent)}" value="${escapeHtml(parent)}"><button id="settingStorePick" class="outline-btn" type="button">选择…</button></div></div>`;
}
function generalSettingsHtml() {
  return `<h2>通用</h2><p class="settings-lead">数据只存于本机；桥接在线时，对话、卷宗与配置都落在存储位置里。</p><div class="setting-row"><div class="setting-copy"><strong>显示名称</strong><small>侧栏中显示的称呼</small></div><input id="settingName" class="field" value="${escapeHtml(store.settings.name)}"></div><div class="setting-row"><div class="setting-copy"><strong>自动拟题</strong><small>首次问答后由模型拟题，略耗额度；手动修改过的标题不再覆盖</small></div><div class="segmented"><button data-setting="autoTitle" data-value="true" class="${store.settings.autoTitle ? "active" : ""}">开</button><button data-setting="autoTitle" data-value="false" class="${store.settings.autoTitle ? "" : "active"}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>自动压缩上下文</strong><small>一答收尾后，若下一问估算送出的 token 超过此数，便请模型把前文压成摘要；留空为不自动。右下角的计数亦可随时手动压缩</small></div><div class="setting-actions"><label class="setting-inline">超过<input id="settingCompactAt" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不自动" value="${Number(store.settings.compactAt) || ""}"></label></div></div>${storageSettingsHtml()}<div class="setting-row"><div class="setting-copy"><strong>本机数据</strong><small>${store.conversations.length} 段对话 · ${store.library.length} 件卷宗 · 配置 ${storageSize()} · 附件原件 ${formatFileSize(usedAttachmentBytes())}</small></div><div class="setting-actions"><label class="check"><input id="exportFiles" type="checkbox">含附件原件</label><button id="exportData" class="outline-btn">导出备份</button><button id="importData" class="outline-btn">导入备份</button></div></div><div class="setting-row"><div class="setting-copy"><strong>清空所有对话</strong><small>模型配置、个性化与卷宗将保留</small></div><button id="clearAll" class="danger-btn">清空对话</button></div>`;
}
// 工具：沙箱、三档指令权限、可及范围、卷宗可读、轮次上限——模型能动手的边界都在这一栏
function toolsSettingsHtml() {
  const policy = normalizeCommandPolicy(store.settings.commandPolicyDefault);
  return `<h2>工具</h2><p class="settings-lead">模型能做什么、做到哪一步问一声，都在这里定。</p><div class="setting-row"><div class="setting-copy"><strong>沙箱</strong><small>言与行的指令与文件工具都套着一层：改动不出工作目录、机密文件不碰、动系统与直接外联的指令拒绝、指令看不到机密环境变量；查看则可及整台机器，要它看看电脑也走得通。在桥接那头守，模型绕不过。这是静态筛查，不是进程隔离。非要让模型改目录之外的东西时再关</small></div><div class="segmented"><button data-setting="sandbox" data-value="true" class="${store.settings.sandbox !== false ? "active" : ""}">开</button><button data-setting="sandbox" data-value="false" class="${store.settings.sandbox === false ? "active" : ""}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>指令权限</strong><small>新对话默认档位：问而后行逐条请示，明确只读的径直跑；审而后行由桥接代审，常规改动、整机查看、写到目录之外都放行，只把伤及系统与难以恢复的当场回绝，不来打扰；径行不再审查。三档都不另调模型，沙箱开着时那道界仍在</small></div><div class="segmented"><button data-setting="commandPolicyDefault" data-value="ask" class="${policy === "ask" ? "active" : ""}">问而后行</button><button data-setting="commandPolicyDefault" data-value="review" class="${policy === "review" ? "active" : ""}">审而后行</button><button data-setting="commandPolicyDefault" data-value="auto" class="${policy === "auto" ? "active" : ""}">径行</button></div></div><div class="setting-row"><div class="setting-copy"><strong>文件工具可及范围</strong><small>没套沙箱时，模型读写文件、列目录与搜索能否越出工作目录或卷宗：「全盘」可指向任何绝对路径，「目录内」一律拒绝越出；指令不受此限。沙箱开着时一律目录内</small></div><div class="segmented"><button data-setting="toolReach" data-value="anywhere" class="${store.settings.toolReach !== "inside" ? "active" : ""}">全盘</button><button data-setting="toolReach" data-value="inside" class="${store.settings.toolReach === "inside" ? "active" : ""}">目录内</button></div></div><div class="setting-row"><div class="setting-copy"><strong>卷宗对模型可读</strong><small>开启后，模型可在任何对话中翻阅卷宗里的文档（PDF、Office、文本），用到时才取回并在本机提取正文</small></div><div class="segmented"><button data-setting="archiveRead" data-value="true" class="${store.settings.archiveRead !== false ? "active" : ""}">开</button><button data-setting="archiveRead" data-value="false" class="${store.settings.archiveRead === false ? "active" : ""}">关</button></div></div><div class="setting-row"><div class="setting-copy"><strong>工具轮次上限</strong><small>一次回答里模型最多调几轮工具，同一轮并发的几次调用只算一轮；到顶后收回工具请它收尾。帮手另计，留空即不限</small></div><div class="setting-actions"><label class="setting-inline">一答<input id="settingToolRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不限" value="${roundLimitText(toolRoundLimit())}"></label><label class="setting-inline">帮手<input id="settingSubRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="不限" value="${roundLimitText(subRoundLimit())}"></label></div></div>`;
}
function appearanceSettingsHtml() {
  const s = store.settings;
  return `<h2>个性化</h2><p class="settings-lead">清简为骨，纸墨为意。</p>${segmentRow(
    "主题",
    "随系统或固定明暗",
    "theme",
    [
      ["light", "亮"],
      ["dark", "暗"],
      ["system", "系统"]
    ],
    s.theme
  )}${segmentRow(
    "界面动效",
    "落墨与天光、印章呼吸与开合过渡",
    "inkMotion",
    [
      ["on", "开"],
      ["system", "随系统"],
      ["off", "关"]
    ],
    s.inkMotion || "on"
  )}${fontRow(s.font)}${segmentRow(
    "阅读宽度",
    "长文的行宽",
    "width",
    [
      [680, "窄"],
      [760, "适中"],
      [860, "宽"]
    ],
    s.width
  )}<div class="setting-row"><div class="setting-copy"><strong>印色</strong><small>界面中的点睛之色</small></div><div class="segmented">${["#9b5540", "#536d62", "#5c6386", "#75644f"].map(v => `<button data-setting="accent" data-value="${v}" class="${s.accent === v ? "active" : ""}" style="color:${v}">●</button>`).join("")}</div></div>`;
}
// 关于：身份、边界、键与手势、开源致谢。随项目本地分发的库与许可见 vendor/
const CREDITS = [
  ["marked", "18.0.13", "MIT"],
  ["DOMPurify", "3.4.15", "Apache-2.0"],
  ["highlight.js", "11.12.0", "BSD-3-Clause"],
  ["KaTeX", "0.18.7", "MIT"],
  ["Mermaid", "11.17.2", "MIT"],
  ["Apache ECharts", "5.6.1", "Apache-2.0"],
  ["PDF.js", "3.11.174", "Apache-2.0"]
];
const kbd = keys =>
  keys
    .split("+")
    .map(key => `<span class="kbd">${escapeHtml(key)}</span>`)
    .join(" + ");
function aboutSettingsHtml() {
  const version = bootstrap.version || APP_VERSION,
    bridged = apiBase !== null;
  const rows = list => `<dl class="about-list">${list.map(([term, detail]) => `<dt>${term}</dt><dd>${detail}</dd>`).join("")}</dl>`;
  return (
    `<div class="about-head"><h2>言</h2><span class="about-version">v${escapeHtml(version)} · ${bridged ? "本机桥接" : "浏览器直连"}</span></div><p class="about-ethos">清简为骨，纸墨为意。<br>长问慢答，尽付纸墨；言毕，即行。</p>` +
    `<div class="about-section"><h3>数据与边界</h3>${rows([
      [
        "存放",
        "桥接在线时一切落在本机的存储位置（默认 ~/.yan，可在通用设置更换）：对话/ 一段一个文件，卷宗/ 是成品与收进来的文件，附件/ 是附件原件，配置.json 是设置、模型配置（含 API Key）、记忆与草稿；复制整个目录即备份。没桥接时暂存于此浏览器，接上后推过去。不经任何云端"
      ],
      ["桥接", "本机进程仅监听 127.0.0.1，负责转发模型请求、联网检索与读取网页；拒绝访问本机与内网地址"],
      [
        "执事",
        "指令在你的机器上、以你的权限执行，只读指令直接执行，其余默认逐条确认；文件工具能否越出工作目录由设置 → 工具的「可及范围」定（默认全盘，问而后行开着沙箱时只在目录内）"
      ],
      [
        "沙箱",
        "指令与文件工具默认套着：路径不出目录、机密文件不碰、动系统与直接外联的指令拒绝、机密环境变量不给指令，在桥接那头守。是静态筛查，不是进程隔离——脚本里的代码仍以你的权限运行；设置 → 工具可关"
      ],
      ["记忆", "模型在对谈中记下的一句句话，只存于本机；何时记、何时看由它判断，不随每次请求发送，可在「记忆」页查改或关闭"],
      ["备份", "导出的备份不含 API Key；可选择是否带上附件原件"]
    ])}</div>` +
    `<div class="about-section"><h3>键与操作</h3>${rows([
      [kbd("Enter"), "发送；" + kbd("Shift+Enter") + " 换行"],
      [kbd("Esc"), "关闭弹层、取消编辑、去掉引文、退出全屏"],
      ["划选正文", "浮出「引用 · 旁注」：引用随下一问送出；旁注于右侧另开一线，读得到正文，却不入正文"],
      ["拖入 · 粘贴", "文件拖入页面或粘贴图片，即置于案上；在卷宗页拖入则收入卷宗"],
      ["双击侧栏标题", "重命名对话；亦可直接修改页面上方的标题"],
      ["消息旁 ‹ ›", "在同一位置的不同版本之间切换"]
    ])}</div>` +
    `<div class="about-section"><h3>开源致谢</h3><ul class="about-credits">${CREDITS.map(([name, ver, license]) => `<li><span>${escapeHtml(name)}</span><small>${escapeHtml(ver)} · ${escapeHtml(license)}</small></li>`).join("")}</ul><p class="about-note">以上库全部随项目本地分发，不加载任何在线资源；许可全文见 vendor 目录。运行环境仅需 Node.js 18 或更高版本，无需安装依赖。</p></div>`
  );
}
// 字体一行：每个钮用自己那种字写自己的名字，一眼看出气质
function fontRow(active = "mixed") {
  const items = [
    ["mixed", "混排"],
    ["sans", "黑体"],
    ["serif", "宋体"],
    ["kai", "楷体"],
    ["fangsong", "仿宋"]
  ];
  return `<div class="setting-row"><div class="setting-copy"><strong>字体</strong><small>回复与标题用的字；楷体与仿宋取自系统，没有的机器落回宋体</small></div><div class="segmented font-segmented">${items.map(([v, label]) => `<button data-setting="font" data-value="${v}" class="${(active || "mixed") === v ? "active" : ""}" style="font-family:${escapeHtml(FONT_STACKS[v].title)}">${label}</button>`).join("")}</div></div>`;
}
function segmentRow(title, desc, key, items, active) {
  return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><small>${desc}</small></div><div class="segmented">${items.map(([v, label]) => `<button data-setting="${key}" data-value="${v}" class="${String(active) === String(v) ? "active" : ""}">${label}</button>`).join("")}</div></div>`;
}
function modelsSettingsHtml() {
  const transport =
    apiBase !== null
      ? `本机桥接已接通${apiBase ? "（VS Code 预览）" : ""}，联网与转发均可用。`
      : "当前由浏览器直连模型，联网检索不可用；本机桥接启动后将自动接通。";
  const keyNote =
    apiBase !== null
      ? "API Key 与其余配置一起存于本机存储位置的 配置.json，几个浏览器共用；导出的备份不含它。"
      : "API Key 暂存于此浏览器，桥接接上后存进本机的存储位置；导出的备份不含它。";
  return `<h2>模型</h2><p class="settings-lead">任何 OpenAI 兼容接口均可接入。${keyNote}${transport}</p>${bootstrap.notice ? `<div class="server-notice">${escapeHtml(bootstrap.notice)}</div>` : ""}<div id="profileList">${profiles().map(profileCardHtml).join("")}</div><button id="addProfile" class="outline-btn profile-add">＋ 接入模型</button>`;
}
function quotaParts(value) {
  const match = String(value ?? "")
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*([kme])?$/);
  return match ? { amount: match[1], unit: match[2] || "k" } : { amount: "", unit: "k" };
}
/** @param {Profile} p */
function profileCardHtml(p) {
  const invalidQuota = !!String(p.quota || "").trim() && parseTokenLimit(p.quota) === null,
    quota = quotaParts(p.quota),
    models = Array.isArray(p.modelList) ? p.modelList : [],
    listed = models.includes(p.model);
  const modelField = `<div class="field-row">${models.length ? `<select class="field wide select" data-model-select>${models.map(m => `<option value="${escapeHtml(m)}"${m === p.model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}<option value="__custom__"${listed ? "" : " selected"}>手动输入…</option></select>` : ""}<input class="field wide${models.length && listed ? " hidden" : ""}" data-field="model" value="${escapeHtml(p.model)}" placeholder="如 gpt-4o-mini"><button class="outline-btn" data-profile-action="models" title="从接口的 /models 获取可用模型">${models.length ? "刷新" : "获取列表"}</button></div>`;
  const quotaField = `<div class="field-row"><input type="number" min="0" step="any" class="field wide" data-quota-amount value="${escapeHtml(quota.amount)}" placeholder="不限" ${invalidQuota ? `aria-invalid="true"` : ""}><select class="field select" data-quota-unit>${[
    ["k", "千 (k)"],
    ["m", "百万 (m)"],
    ["e", "亿 (e)"]
  ]
    .map(([v, label]) => `<option value="${v}"${quota.unit === v ? " selected" : ""}>${label}</option>`)
    .join("")}</select></div>`;
  return `<div class="profile-card" data-profile-card="${escapeHtml(p.id)}"><div class="profile-head"><strong>${escapeHtml(p.name)}</strong>${p.id === store.settings.activeProfileId ? `<span class="profile-badge">默认</span>` : ""}</div><div class="profile-grid"><label>显示名称<input class="field wide" data-field="name" value="${escapeHtml(p.name)}"></label><label>用量上限${quotaField}<small>留空不限，只计已耗；改动后重新计量</small></label><label>接口<div class="segmented"><button data-choice-field="api" data-value="openai" class="${anthropicLike(p) ? "" : "active"}">OpenAI 兼容</button><button data-choice-field="api" data-value="anthropic" class="${anthropicLike(p) ? "active" : ""}">Anthropic</button></div><small>${anthropicLike(p) ? "Messages API；思考档位换算成思考预算" : "chat/completions；大多数服务与中转站"}</small></label><label class="profile-full">Base URL<input class="field wide" data-field="baseUrl" value="${escapeHtml(p.baseUrl || "")}" placeholder="${anthropicLike(p) ? "https://api.anthropic.com" : "https://example.com/v1"}"></label><label class="profile-full">API Key<input type="password" class="field wide" data-field="apiKey" value="${escapeHtml(p.apiKey || "")}" placeholder="sk-…" autocomplete="off"></label><label class="profile-full">模型${modelField}<small>填写 Base URL 与 API Key 后可获取列表，亦可手动输入</small></label></div><details class="profile-advanced"${advancedOpen.has(p.id) ? " open" : ""}><summary><span class="advanced-title">高级配置</span><small>${[p.tools === false ? "本机工具关" : "", p.systemPrompt ? "已设 system prompt" : ""].filter(Boolean).join(" · ")}</small></summary><div class="profile-grid"><label>本机联网与文档工具<div class="segmented"><button data-toggle-field="tools" data-value="true" class="${p.tools !== false ? "active" : ""}">开</button><button data-toggle-field="tools" data-value="false" class="${p.tools === false ? "active" : ""}">关</button></div><small>由本机桥接执行检索、网页读取与文档翻阅；需接口支持 function calling</small></label><label><code>temperature</code><input type="number" min="0" max="2" step="0.1" class="field wide" data-field="temperature" value="${Number(p.temperature ?? 0.7)}"><small>0–2，默认 0.7；数值越高越发散</small></label>${anthropicLike(p) ? `<label><code>max_tokens</code><input type="number" min="16" class="field wide" data-field="maxTokens" value="${Number(p.maxTokens) || ""}" placeholder="${DEFAULT_MAX_TOKENS}"><small>Messages API 必填的输出上限；留空按 ${DEFAULT_MAX_TOKENS}，模型嫌大会报错，照报错调小即可</small></label>` : ""}<label>上下文窗口<input type="number" min="1000" step="1000" class="field wide" data-field="contextWindow" value="${Number(p.contextWindow) || ""}" placeholder="如 128000"><small>此模型一次可读的 token 数；填写后右下角按比例计量，逾七成半即提醒</small></label><label>思考档位<input class="field wide" data-field="reasoningLevels" value="${escapeHtml(p.reasoningLevels || "")}" placeholder="low, medium, high"><small>此模型所认的 <code>reasoning_effort</code> 档位，逗号分隔（minimal、low、medium、high、xhigh、max）；选定模型时会自动探测并填在这里（none 是不认）；留空按 low / medium / high / max 四档列，接口拒绝某档时也会记下</small></label><label class="profile-full"><code>system prompt</code><textarea class="field wide field-area" data-field="systemPrompt" placeholder="可选。设定模型的身份与应答方式">${escapeHtml(p.systemPrompt || "")}</textarea></label></div></details><div class="profile-actions"><button class="outline-btn" data-profile-action="test">测试连接</button>${p.id !== store.settings.activeProfileId ? `<button class="outline-btn" data-profile-action="default">设为默认</button>` : ""}<button class="danger-btn" data-profile-action="delete">删除</button><span class="profile-status">${invalidQuota ? "请填写大于 0 的数值，或留空不限" : ""}</span></div></div>`;
}
function storageSize() {
  const bytes = new Blob([JSON.stringify(store)]).size;
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
// 存储位置的更换排着队来（见 bindSettingsEvents 里的 commitStore）
let storeMoves = Promise.resolve();
function bindSettingsEvents() {
  $("#settingName")?.addEventListener("input", e => {
    store.settings.name = e.target.value || "访客";
    saveStoreSoon();
  });
  for (const [id, key, fallback] of [
    ["#settingToolRounds", "toolRounds", DEFAULT_TOOL_ROUNDS],
    ["#settingSubRounds", "subRounds", DEFAULT_SUB_ROUNDS]
  ])
    $(id)?.addEventListener("input", e => {
      // 留空记作 0：不限
      const text = e.target.value.trim(),
        value = Math.floor(Number(text));
      store.settings[key] = !text ? 0 : value >= 1 ? value : fallback;
      saveStoreSoon();
    });
  // 存储位置：桥接把整份拷到新处（那里已有言的数据就直接用），页面换上新路径后把对话与配置对一遍、卷宗重翻；旧处不删
  const storeInput = $("#settingStore");
  let storeTimer = null;
  const commitStore = value => {
    clearTimeout(storeTimer);
    // 一次换完（对话对齐、卷宗重翻、设置页重画）再换下一次：连着换两回时，前一回迟到的收尾不能把页面又画回它那个位置
    storeTimer = setTimeout(() => (storeMoves = storeMoves.then(moveStore, moveStore)), 600);
    const moveStore = async () => {
      const next = String(value || "").trim();
      if (!next || next === (bootstrap.store?.parent || "")) return;
      let data;
      try {
        data = await bridge("/api/store/move", { parent: next }, AbortSignal.timeout(600000));
      } catch (error) {
        return toast(String(error.message || error).slice(0, 80));
      }
      if (!data.moved) return;
      bootstrap.store = { root: data.root, parent: data.parent, fresh: false };
      bootstrap.work = { ...bootstrap.work, chats: data.chats, archive: data.archive, files: data.files };
      chatsBroken = false;
      chatHashes.clear();
      chatStamps.clear();
      chatDiskWrites.clear();
      // 搬到一个已有言数据的地方：那边的配置为准；拷过去的：这边的就是那边的
      if (data.adopted) {
        configBase = "";
        configSyncedAt = 0;
        const disk = await bridge("/api/store/config/load", {}, AbortSignal.timeout(20000)).catch(() => null);
        if (disk?.config) adoptConfig(disk.config, Number(disk.savedAt) || 0);
      } else saveConfigNow({ force: true });
      await syncChatsWithDisk();
      const ids = store.conversations.map(conversation => conversation.id);
      flushConversations(ids, { force: true });
      archiveEntries = null;
      await refreshArchive();
      try {
        localStorage.setItem(STORE_ROOT_KEY, data.root);
      } catch {}
      renderSettings();
      toast(`存储已换到 ${pathTail(data.root)}；${data.adopted ? "用的是那里原有的数据" : "旧处原样留着"}`);
    };
  };
  storeInput?.addEventListener("change", e => commitStore(e.target.value));
  $("#settingStorePick")?.addEventListener("click", async () => {
    const button = $("#settingStorePick");
    button.disabled = true;
    try {
      const data = await bridge(
        "/api/work/pick",
        { current: storeInput.value.trim() || bootstrap.store?.parent || "" },
        AbortSignal.timeout(300000)
      );
      if (data.path) {
        storeInput.value = data.path;
        commitStore(data.path);
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      button.disabled = false;
    }
  });
  $("#settingCompactAt")?.addEventListener("input", e => {
    const value = Math.floor(Number(String(e.target.value).replace(/[^\d]/g, "")));
    store.settings.compactAt = value >= 1000 ? value : 0;
    saveStoreSoon();
    updateContextGauge();
  });
  $("#exportData")?.addEventListener("click", () => exportData($("#exportFiles")?.checked));
  $("#importData")?.addEventListener("click", () => $("#importInput").click());
  $("#importInput").onchange = async e => {
    const [file] = e.target.files;
    e.target.value = "";
    if (file) await importData(file);
  };
  $("#clearAll")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: "清空全部对话？",
        body: `${store.conversations.length} 段对话将被移除，无法撤销；模型配置、个性化与卷宗将保留。`,
        ok: "清空"
      }))
    )
      return;
    stopAllGenerations();
    const conversationIds = new Set(store.conversations.map(c => c.id)),
      draftFiles = Object.entries(store.drafts || {})
        .filter(([key]) => conversationIds.has(key))
        .flatMap(([, draft]) => (Array.isArray(draft?.attachments) ? draft.attachments.map(file => file.id) : []));
    const currentDraftFiles = currentId ? pendingAttachments.map(file => file.id) : [];
    void deleteAttachments([...attachmentIds(store.conversations.flatMap(allMessages)), ...draftFiles, ...currentDraftFiles]);
    for (const c of store.conversations) void deleteConversationStorage(c.id);
    store.conversations = [];
    store.drafts = store.drafts?.[NEW_DRAFT_ID] ? { [NEW_DRAFT_ID]: store.drafts[NEW_DRAFT_ID] } : {};
    scrollPositions.clear();
    currentId = null;
    pendingAttachments = [];
    saveStore();
    render();
    renderSettings();
    toast("所有对话已清空");
  });
  document.querySelectorAll("[data-setting]").forEach(
    button =>
      (button.onclick = () => {
        const key = button.dataset.setting,
          value = button.dataset.value;
        if (key === "theme") {
          switchTheme(value, button);
          renderSettings();
          return;
        }
        if (key === "memoryEnabled") {
          store.memory.enabled = value === "true";
          saveStore();
          renderSettings();
          return;
        }
        store.settings[key] =
          key === "width" ? Number(value) : ["autoTitle", "archiveRead", "sandbox"].includes(key) ? value === "true" : value;
        saveStore();
        applyAppearance();
        renderSettings();
      })
  );
  $("#addProfile")?.addEventListener("click", () => {
    /** @type {Profile} */
    const p = {
      id: uid(),
      source: "custom",
      name: "新模型",
      model: "",
      baseUrl: "",
      apiKey: "",
      temperature: 0.7,
      quota: "",
      usedTokens: 0,
      systemPrompt: ""
    };
    store.profiles.push(p);
    store.settings.activeProfileId ||= p.id;
    saveStore();
    renderSettings();
    setTimeout(() => document.querySelector(`[data-profile-card="${p.id}"] [data-field="name"]`)?.focus(), 0);
  });
  document.querySelectorAll("[data-profile-card]").forEach(card => {
    const p = profiles().find(item => item.id === card.dataset.profileCard);
    if (!p) return;
    card
      .querySelector('[data-profile-action="test"]')
      ?.insertAdjacentHTML("afterend", '<button class="outline-btn" data-profile-action="search">测试联网</button>');
    card.querySelectorAll("[data-field]").forEach(input =>
      input.addEventListener("input", e => {
        const field = e.target.dataset.field;
        p[field] = ["temperature", "maxTokens", "usedTokens", "contextWindow"].includes(field) ? Number(e.target.value) : e.target.value;
        if (field === "contextWindow") updateContextGauge();
        // 亲手填的档位就是定论，不再探；清空了下次选模型再探
        if (field === "reasoningLevels") p.reasoningProbed = e.target.value.trim() ? `manual|${reasoningProbeKey(p)}` : "";
        saveStoreSoon();
      })
    );
    // 手动输入的模型 ID：改定了（失焦或回车）探一下它认哪几档
    card.querySelector('[data-field="model"]')?.addEventListener("change", () => void reportReasoningProbe(p, card));
    const amount = card.querySelector("[data-quota-amount]"),
      unit = card.querySelector("[data-quota-unit]");
    const applyQuota = () => {
      const value = amount.value.trim() ? `${amount.value.trim()}${unit.value}` : "",
        valid = !value || parseTokenLimit(value) !== null;
      if (valid) amount.removeAttribute("aria-invalid");
      else amount.setAttribute("aria-invalid", "true");
      card.querySelector(".profile-status").textContent = valid ? "" : "请填写大于 0 的数值，或留空不限";
      if (!valid) return;
      if (p.quota !== value) {
        p.quota = value;
        p.usedTokens = 0;
        saveStoreSoon();
        if (p.id === store.settings.activeProfileId) renderQuota();
      }
    };
    amount.addEventListener("input", applyQuota);
    unit.addEventListener("change", applyQuota);
    card.querySelector("[data-model-select]")?.addEventListener("change", e => {
      const input = card.querySelector('[data-field="model"]');
      if (e.target.value === "__custom__") {
        input.classList.remove("hidden");
        input.focus();
        return;
      }
      input.classList.add("hidden");
      input.value = e.target.value;
      p.model = e.target.value;
      saveStoreSoon();
      renderHeader();
      void reportReasoningProbe(p, card);
    });
    card.querySelectorAll("[data-toggle-field]").forEach(
      button =>
        (button.onclick = () => {
          p[button.dataset.toggleField] = button.dataset.value === "true";
          saveStore();
          renderSettings();
        })
    );
    card.querySelectorAll("[data-choice-field]").forEach(
      button =>
        (button.onclick = () => {
          if (button.disabled) return;
          p[button.dataset.choiceField] = button.dataset.value;
          saveStore();
          renderSettings();
        })
    );
    card.querySelector(".profile-advanced")?.addEventListener("toggle", e => {
      if (e.target.open) advancedOpen.add(p.id);
      else advancedOpen.delete(p.id);
    });
    card
      .querySelectorAll("[data-profile-action]")
      .forEach(button => (button.onclick = () => handleProfileAction(p, button.dataset.profileAction, card)));
  });
}
// 选定模型后探它认哪几档，结果写在卡片的状态行上，高级配置里的「思考档位」也跟着填；探不成不吭声（撞了错再学）。
// 亲手填过档位的不探（测试连接也不），状态行照实写它填的。同一张卡片连着探了两次（模型改了两回），只有最后一次能动状态行——
// 先前那次迟到回来是作废的，不能把后一次已经写上的结果抹掉
const probeSerial = new Map();
/** @param {Profile} profile */
async function reportReasoningProbe(profile, card, force = false) {
  if (force && !reasoningManual(profile)) profile.reasoningProbed = "";
  if (!profile.model) return;
  const status = () => document.querySelector(`[data-profile-card="${profile.id}"] .profile-status`);
  // 状态行上此前的话留着（「可用 · 4 ms」），但上一回探到的档位不留——刷新列表探了一次、再从下拉里选一个又探一次，不能越接越长
  const before = (status()?.textContent || "")
    .split(" · ")
    .filter(part => !/^(探测)?思考档位/.test(part))
    .join(" · ");
  if (reasoningProbed(profile)) {
    if (force && status()) {
      const levels = profileReasoningLevels(profile);
      status().textContent = `${before ? `${before} · ` : ""}思考档位 ${levels.length ? levels.map(reasoningLabel).join(" / ") : "此模型不认"}${reasoningManual(profile) ? "（手填）" : ""}`;
    }
    return;
  }
  const serial = (probeSerial.get(profile.id) || 0) + 1;
  probeSerial.set(profile.id, serial);
  if (status()) status().textContent = `${before ? `${before} · ` : ""}探测思考档位…`;
  const levels = await probeReasoningLevels(profile);
  const el = status();
  if (!el || probeSerial.get(profile.id) !== serial) return;
  if (levels === null) el.textContent = before;
  else {
    el.textContent = `${before ? `${before} · ` : ""}思考档位 ${levels.length ? levels.map(reasoningLabel).join(" / ") : "此模型不认"}`;
    const field = document.querySelector(`[data-profile-card="${profile.id}"] [data-field="reasoningLevels"]`);
    if (field) field.value = profile.reasoningLevels || "";
    renderModelTriggers();
  }
}
/** @param {Profile} profile */
async function handleProfileAction(profile, action, card) {
  if (action === "default") {
    selectProfile(profile.id, false);
    renderSettings();
    renderHeader();
    return;
  }
  if (action === "delete") {
    if (
      !(await askConfirm({
        title: "删除这个模型？",
        body: `「${profile.name || profile.model || "未命名"}」的配置连同 API Key 将一并移除，无法撤销。`,
        ok: "删除"
      }))
    )
      return;
    store.profiles = store.profiles.filter(p => p.id !== profile.id);
    if (store.settings.activeProfileId === profile.id) store.settings.activeProfileId = profiles().find(p => p.id !== profile.id)?.id || "";
    saveStore();
    renderSettings();
    renderHeader();
    return;
  }
  if (action === "models") {
    const status = card.querySelector(".profile-status");
    status.textContent = "获取中…";
    try {
      const models = await fetchModelList(profile);
      if (!models.length) throw Error("接口未返回模型列表，请手动输入模型 ID");
      profile.modelList = models;
      if (!models.includes(profile.model)) profile.model = models[0];
      saveStore();
      renderSettings();
      renderHeader();
      card = document.querySelector(`[data-profile-card="${profile.id}"]`);
      if (card) card.querySelector(".profile-status").textContent = `已获取 ${models.length} 个模型`;
      void reportReasoningProbe(profile, card);
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
    return;
  }
  if (action === "search") {
    let status = card.querySelector(".profile-status");
    status.textContent = "检索中…";
    try {
      if (apiBase === null && !(await ensureLocalBridge()))
        throw Error("未连接本机桥接；请先运行 start.cmd 或 VS Code 任务「言：启动模型桥接」");
      card = document.querySelector(`[data-profile-card="${profile.id}"]`) || card;
      status = card.querySelector(".profile-status");
      status.textContent = "检索中…";
      const data = await bridge("/api/search", { query: "OpenAI", count: 1 }, AbortSignal.timeout(20000));
      status.textContent = data.results?.length ? `本机联网可用 · ${data.results.length} 条结果` : "搜索服务已连接，但本次未返回结果";
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
    return;
  }
  if (action === "test") {
    let status = card.querySelector(".profile-status");
    status.textContent = "连接中…";
    try {
      if (apiBase === null) await ensureLocalBridge();
      card = document.querySelector(`[data-profile-card="${profile.id}"]`) || card;
      status = card.querySelector(".profile-status");
      status.textContent = "连接中…";
      const started = performance.now();
      const response =
        apiBase !== null
          ? await fetch(`${apiBase}/api/test`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ profile: profileForRequest(profile) })
            })
          : await fetch(directModelsRequest(profile).url, { headers: directModelsRequest(profile).headers });
      const type = response.headers.get("content-type") || "";
      const data = type.includes("application/json") ? await response.json() : {};
      if (!response.ok) throw Error(data.error || data.message || `连接失败（${response.status}）`);
      status.textContent = `可用 · ${Math.round(performance.now() - started)} ms`;
      // 测试连接是亲手要的一次核对：档位也重探一遍
      void reportReasoningProbe(profile, card, true);
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
  }
}
/** @param {Profile} profile */
async function fetchModelList(profile) {
  if (!String(profile.baseUrl || "").trim()) throw Error("请先填写 Base URL");
  if (apiBase === null) await ensureLocalBridge();
  let response, data;
  if (apiBase !== null) {
    response = await fetch(`${apiBase}/api/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: profileForRequest(profile) })
    });
    data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || `请求失败（${response.status}）`);
    return [...new Set(data.models || [])].sort();
  }
  response = await fetch(directModelsRequest(profile).url, { headers: directModelsRequest(profile).headers });
  data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error?.message || data.message || `请求失败（${response.status}）`);
  return [
    ...new Set((Array.isArray(data.data) ? data.data : []).map(item => (typeof item === "string" ? item : item?.id)).filter(Boolean))
  ].sort();
}
async function exportData(includeFiles) {
  /** @type {Store & { exportedAt: string, attachments?: Attachment[] }} 备份：去掉 API Key，可选带上附件原件 */
  const safeStore = { ...store, profiles: store.profiles.map(profile => ({ ...profile, apiKey: "" })), exportedAt: now() };
  let blob,
    files = 0;
  if (includeFiles) {
    // 附件原件只带仍在用的那几件：存储目录与浏览器里的暂存都翻，谁有取谁。原件合起来可能上 GB，
    // 拼成一个大字符串会超出浏览器的字符串上限、点了没反应——一件一件接进 Blob，内存里只过一件
    toast("正在收拢附件原件…");
    blob = new Blob([`${JSON.stringify(safeStore).slice(0, -1)},"attachments":[`], { type: "application/json" });
    for (const id of attachmentKeepIds()) {
      const record = await getAttachment(id).catch(() => null);
      if (!record) continue;
      blob = new Blob([blob, files ? "," : "", JSON.stringify(record)], { type: "application/json" });
      uncacheAttachment(id);
      files += 1;
    }
    blob = new Blob([blob, "]}"], { type: "application/json" });
  } else blob = new Blob([JSON.stringify(safeStore, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `言-备份-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`备份已导出${includeFiles ? `（含 ${files} 件附件原件）` : ""}；不含 API Key`);
}
// 读备份：小的整份解析；带着上百 MB 附件原件的，整份读成一个字符串会超出浏览器的上限——按字节找到末尾的附件数组，
// 前面的记录照常解析，原件一件一件解出来交给调用者，内存里只过一件
async function readBackup(file) {
  if (file.size < 128 * MB) {
    const data = JSON.parse(await readFile(file, "text"));
    return {
      data,
      attachments: (async function* () {
        yield* Array.isArray(data.attachments) ? data.attachments : [];
      })()
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer()),
    decoder = new TextDecoder(),
    marker = new TextEncoder().encode(',"attachments":[');
  // 附件数组是导出时最后接上的一项，原件里的引号都转义过，从末尾往前找到的第一处就是它
  let at = -1;
  for (let i = bytes.lastIndexOf(marker[0]); i >= 0; i = i > 0 ? bytes.lastIndexOf(marker[0], i - 1) : -1)
    if (marker.every((b, k) => bytes[i + k] === b)) {
      at = i;
      break;
    }
  if (at < 0) return { data: JSON.parse(decoder.decode(bytes)), attachments: (async function* () {})() };
  const data = JSON.parse(`${decoder.decode(bytes.subarray(0, at))}}`);
  async function* attachments() {
    let depth = 0,
      inString = false,
      escaped = false,
      start = -1;
    for (let i = at + marker.length; i < bytes.length; i++) {
      const b = bytes[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (b === 92) escaped = true;
        else if (b === 34) inString = false;
        continue;
      }
      if (b === 34) inString = true;
      else if (b === 123) {
        if (depth++ === 0) start = i;
      } else if (b === 125) {
        if (--depth === 0) yield JSON.parse(decoder.decode(bytes.subarray(start, i + 1)));
      } else if (b === 93 && depth === 0) break;
    }
  }
  data.attachments = true;
  return { data, attachments: attachments() };
}
// 导入采用合并策略：按 id 跳过已存在的对话 / 模型 / 卷宗，附件原件只在本机缺失时写入
async function importData(file) {
  try {
    const { data, attachments } = await readBackup(file);
    if (!data || !Number.isInteger(data.version) || data.version < 1 || data.version > STORE_VERSION || !Array.isArray(data.conversations))
      throw Error("不是言的备份文件，或版本不兼容");
    // 旧版备份先按启动时同一套迁移与规整过一遍（workAuto → commandPolicy、去掉半成品的压缩分隔……），别等下次刷新才对
    const incoming = normalizeStoreData(data);
    const known = new Set(store.conversations.map(c => c.id));
    let conversations = 0,
      added = 0,
      library = 0,
      drafts = 0,
      files = 0;
    for (const c of incoming.conversations)
      if (c?.id && !known.has(c.id) && Array.isArray(c.messages)) {
        store.conversations.push(c);
        markDirty(c.id);
        conversations += 1;
      }
    const profileIds = new Set(profiles().map(p => p.id));
    for (const p of incoming.profiles)
      if (p?.id && p.source !== "server" && !profileIds.has(p.id)) {
        store.profiles.push({ ...p, apiKey: p.apiKey || "" });
        added += 1;
      }
    const libraryIds = new Set(store.library.map(f => f.id));
    for (const f of incoming.library)
      if (f?.id && !libraryIds.has(f.id)) {
        store.library.push(f);
        library += 1;
      }
    for (const [key, draft] of Object.entries(incoming.drafts))
      if (!store.drafts[key] && (draft.text || draft.attachments.length || draft.quote)) {
        store.drafts[key] = draft;
        drafts += 1;
      }
    for await (const record of attachments)
      if (record?.id && record.data !== undefined && !(await getAttachment(record.id))) {
        await putAttachment(record);
        uncacheAttachment(record.id);
        files += 1;
      }
    const memoryIds = new Set(store.memory.items.map(item => item.id)),
      memoryTexts = new Set(store.memory.items.map(item => item.text));
    let memories = 0;
    for (const item of incoming.memory.items)
      if (!memoryIds.has(item.id) && !memoryTexts.has(item.text) && store.memory.items.length < MAX_MEMORY_ITEMS) {
        store.memory.items.push(item);
        memoryIds.add(item.id);
        memoryTexts.add(item.text);
        memories += 1;
      }
    if (!profiles().some(p => p.id === store.settings.activeProfileId)) store.settings.activeProfileId = profiles()[0]?.id || "";
    saveStore();
    render();
    renderSettings();
    toast(
      `已导入 ${conversations} 段对话、${added} 个模型、${library} 件卷宗${drafts ? `、${drafts} 份草稿` : ""}${memories ? `、${memories} 条记忆` : ""}${files ? `，恢复 ${files} 件附件原件` : ""}${data.attachments ? "" : "；备份不含附件原件，旧附件将显示为不可用"}`
    );
  } catch (error) {
    toast(`导入失败：${String(error.message || error).slice(0, 80)}`);
  }
}
