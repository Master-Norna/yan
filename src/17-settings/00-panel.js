// 言 · 设置 · 外壳：各栏的登记、开合与画法；通用、工具、个性化这几栏
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 设置的各栏：画法、接事件、题下一句导语成组登记，左侧栏目钮（index.html 的 .tab-btn）照 data-tab 认。换一栏只画、只接这一栏；
// 各栏自己的面板写在各自领域里（记忆在 11-memory，游目在 26-stage/40-settings），这里只登记。加一栏只需加一行与一枚栏目钮。
// 导语是题记，只管气韵，不讲这一栏怎么用（用法进 设置 → 文档）；这一栏是什么，靠近栏目钮浮出一句白话（data-tip）
/** @type {Record<string, [() => string, (() => void) | null, string]>} */
const SETTINGS_TABS = {
  general: [generalSettingsHtml, bindGeneralSettings, t("凡事豫则立，不豫则废。")],
  appearance: [appearanceSettingsHtml, null, t("文质彬彬，然后君子。")],
  models: [modelsSettingsHtml, bindModelSettings, t("君子生非异也，善假于物也。")],
  presets: [presetsSettingsHtml, bindPresetEvents, t("画竹，必先得成竹于胸中。")],
  tools: [toolsSettingsHtml, bindToolSettings, t("工欲善其事，必先利其器。")],
  duty: [dutySettingsHtml, bindDutySettings, t("尺有所短，寸有所长。")],
  env: [envSettingsHtml, bindEnvEvents, t("万事俱备，只欠东风。")],
  mcp: [mcpSettingsHtml, bindMcpEvents, t("他山之石，可以攻玉。")],
  skills: [skillsSettingsHtml, bindSkillSettings, t("闻道有先后，术业有专攻。")],
  stage: [stageSettingsHtml, bindStageSettings, t("游目骋怀，足以极视听之娱。")],
  memory: [memorySettingsHtml, bindMemoryEvents, t("温故而知新。")],
  guide: [guideSettingsHtml, bindGuideEvents, t("清简为骨，纸墨为意。")]
};
let settingsTab = "general";
let settingsReturnFocus = null;
function openSettings(tab = settingsTab) {
  if ($("#settingsModal").classList.contains("hidden")) settingsReturnFocus = document.activeElement;
  persistDraft();
  rememberScrollPosition();
  settingsTab = tab;
  showNow($("#settingsModal"));
  renderSettings();
  $("#closeSettings").focus();
}
function closeSettings() {
  hideWithFade($("#settingsModal"));
  if (settingsReturnFocus?.isConnected) settingsReturnFocus.focus();
  settingsReturnFocus = null;
  // 「手记一条」后没写字就关了窗：那条空的不留（文本框随窗撤掉时未必触发 blur）
  const kept = store.memory.items.filter(item => String(item.text || "").trim());
  if (kept.length !== store.memory.items.length) {
    store.memory.items = kept;
    saveStore();
  }
  render();
}
function renderSettings() {
  if (!SETTINGS_TABS[settingsTab]) settingsTab = "general";
  const [html, bind, lead] = SETTINGS_TABS[settingsTab];
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === settingsTab));
  const host = $("#settingsContent");
  const tabChanged = host.dataset.tab !== settingsTab;
  host.dataset.tab = settingsTab;
  host.innerHTML = html();
  // 每栏题头：这一栏的笔意图标、标题，题下导语，压一道墨线。记忆、文档目录题后另有一行事实，自己画好题头；
  // 文档里翻开的一篇有自己的书口，不加
  const title = host.querySelector("h2");
  let head = host.querySelector(".settings-head");
  if (!head && title && !title.previousElementSibling) {
    head = document.createElement("div");
    head.className = "settings-head";
    head.innerHTML = brushIcon(settingsTab, "settings-mark");
    title.before(head);
    head.append(title);
  }
  if (head) head.insertAdjacentHTML("beforeend", `<p class="settings-lead">${lead}</p>`);
  // 栏里的内容整片换过，挂在里头的事件随旧节点撤了；只有挂在容器本身上的要撤（游目那栏用它接点按）
  host.onclick = null;
  bindSettingRows();
  bind?.();
  if (tabChanged) {
    host.classList.remove("tab-fade");
    void host.offsetWidth;
    host.classList.add("tab-fade");
  }
}
// 设置窗本身：开合、栏目钮、点窗外即收、Tab 不跑出窗外（boot 时接一次）
function bindSettingsShell() {
  $("#openSettings").onclick = () => openSettings("general");
  $("#closeSettings").onclick = closeSettings;
  $("#settingsModal").addEventListener("click", e => {
    if (e.target === $("#settingsModal")) closeSettings();
  });
  $("#settingsModal").addEventListener("keydown", e => {
    if (e.key === "Tab" && !confirmResolve) trapModalFocus(e, $("#settingsModal"));
  });
  document.querySelectorAll(".tab-btn").forEach(
    button =>
      (button.onclick = () => {
        settingsTab = button.dataset.tab;
        renderSettings();
      })
  );
  $("#importInput").onchange = async e => {
    const [file] = e.target.files;
    e.target.value = "";
    if (file) await importData(file);
  };
}
// 存储位置：对话、卷宗、配置（含模型配置）都在这一个 .yan 目录里，几个浏览器共用；换位置时整份拷过去，旧处留着
function storageSettingsHtml() {
  const info = bootstrap.store || {},
    parent = info.parent || "";
  return `<div class="setting-row"><div class="setting-copy"><strong>${t(`存储位置`)}</strong><small><code title="${escapeHtml(info.root || "")}">${escapeHtml(info.root || "")}</code></small></div><div class="setting-actions setting-directory"><input id="settingStore" class="field" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(parent)}" value="${escapeHtml(parent)}"><button id="settingStorePick" class="outline-btn" type="button">${t(`选择…`)}</button></div></div>`;
}
function generalSettingsHtml() {
  return `<h2>${t(`通用`)}</h2><div class="setting-row"><div class="setting-copy"><strong>${t(`显示名称`)}</strong><small>${t(`侧栏中显示的称呼`)}</small></div><input id="settingName" class="field" value="${escapeHtml(store.settings.name)}"></div>${segmentRow(
    t("语言"),
    t("界面所用的语言；切换后页面重新载入"),
    "language",
    [
      ["zh", "中文"],
      ["en", "English"]
    ],
    LANG
  )}${segmentRow(
    t("桌面通知"),
    notifyHint(),
    "notify",
    [
      ["true", t("开")],
      ["false", t("关")]
    ],
    store.settings.notify === true
  )}${storageSettingsHtml()}<div class="setting-row"><div class="setting-copy"><strong>${t(`本机数据`)}</strong><small>${t`${store.conversations.length} 段对话 · ${libraryTotal()} 件卷宗 · 配置 ${storageSize()} · 附件原件 ${formatFileSize(usedAttachmentBytes())}`}</small></div><div class="setting-actions"><label class="check"><input id="exportFiles" type="checkbox">${t(`含附件原件`)}</label><button id="exportData" class="outline-btn">${t(`导出备份`)}</button><button id="importData" class="outline-btn">${t(`导入备份`)}</button></div></div><div class="setting-row"><div class="setting-copy"><strong>${t(`清空所有对话`)}</strong><small>${t(`模型配置、个性化与卷宗将保留`)}</small></div><button id="clearAll" class="danger-btn">${t(`清空对话`)}</button></div>`;
}
// 工具：沙箱、三档指令权限、可及范围、卷宗可读、轮次上限——模型能动手的边界都在这一栏
function toolsSettingsHtml() {
  const policy = normalizeCommandPolicy(store.settings.commandPolicyDefault);
  return `<h2>${t(`工具`)}</h2><div class="setting-row"><div class="setting-copy"><strong>${t(`沙箱`)}</strong><small>${t(`改动不出目录，不碰机密，不动系统`)}</small></div><div class="segmented"><button data-setting="sandbox" data-value="true" class="${store.settings.sandbox !== false ? "active" : ""}">${t(`开`)}</button><button data-setting="sandbox" data-value="false" class="${store.settings.sandbox === false ? "active" : ""}">${t(`关`)}</button></div></div><div class="setting-row"><div class="setting-copy"><strong>${t(`指令权限`)}</strong><small>${t(`新对话的默认档位`)}</small></div><div class="segmented"><button data-setting="commandPolicyDefault" data-value="ask" class="${policy === "ask" ? "active" : ""}">${t(`问而后行`)}</button><button data-setting="commandPolicyDefault" data-value="review" class="${policy === "review" ? "active" : ""}">${t(`审而后行`)}</button><button data-setting="commandPolicyDefault" data-value="auto" class="${policy === "auto" ? "active" : ""}">${t(`径行`)}</button></div></div><div class="setting-row"><div class="setting-copy"><strong>${t(`文件工具可及范围`)}</strong><small>${t(`沙箱下问而后行，恒限目录内`)}</small></div><div class="segmented"><button data-setting="toolReach" data-value="anywhere" class="${store.settings.toolReach !== "inside" ? "active" : ""}">${t(`全盘`)}</button><button data-setting="toolReach" data-value="inside" class="${store.settings.toolReach === "inside" ? "active" : ""}">${t(`目录内`)}</button></div></div><div class="setting-row"><div class="setting-copy"><strong>${t(`卷宗对模型可读`)}</strong><small>${t(`模型可翻阅卷宗里的文档`)}</small></div><div class="segmented"><button data-setting="archiveRead" data-value="true" class="${store.settings.archiveRead !== false ? "active" : ""}">${t(`开`)}</button><button data-setting="archiveRead" data-value="false" class="${store.settings.archiveRead === false ? "active" : ""}">${t(`关`)}</button></div></div><div class="setting-row"><div class="setting-copy"><strong>${t(`工具轮次上限`)}</strong><small>${t(`留空不限`)}</small></div><div class="setting-actions"><label class="setting-inline">${t(`一答`)}<input id="settingToolRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="${t(`不限`)}" value="${roundLimitText(toolRoundLimit())}"></label><label class="setting-inline">${t(`帮手`)}<input id="settingSubRounds" class="field field-num" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="${t(`不限`)}" value="${roundLimitText(subRoundLimit())}"></label></div></div><div class="setting-row"><div class="setting-copy"><strong>${t(`联网检索`)}</strong><small id="searchStatus">${t(`经本机桥接`)}</small></div><button id="testSearch" class="outline-btn" type="button">${t(`测试联网`)}</button></div>`;
}
function appearanceSettingsHtml() {
  const s = store.settings;
  return `<h2>${t(`个性化`)}</h2>${segmentRow(
    t("主题"),
    t("随系统或固定明暗"),
    "theme",
    [
      ["light", t("亮")],
      ["dark", t("暗")],
      ["system", t("系统")]
    ],
    s.theme
  )}${segmentRow(
    t("界面动效"),
    t("落墨与天光、印章呼吸与开合过渡"),
    "inkMotion",
    [
      ["on", t("开")],
      ["system", t("随系统")],
      ["off", t("关")]
    ],
    s.inkMotion || "on"
  )}${fontRow(s.font)}<div class="setting-row"><div class="setting-copy"><strong>${t(`印色`)}</strong><small>${t(`界面中的点睛之色`)}</small></div><div class="segmented accent-segmented">${["#9b5540", "#536d62", "#5c6386", "#75644f"].map(v => `<button data-setting="accent" data-value="${v}" class="${s.accent === v ? "active" : ""}" style="color:${v}">●</button>`).join("")}</div></div>`;
}
// 字体一行：每个钮用自己那种字写自己的名字，一眼看出气质
function fontRow(active = "mixed") {
  const items = [
    ["mixed", t("混排")],
    ["sans", t("黑体")],
    ["serif", t("宋体")],
    ["kai", t("楷体")],
    ["fangsong", t("仿宋")]
  ];
  return `<div class="setting-row"><div class="setting-copy"><strong>${t(`字体`)}</strong><small>${t(`答复与标题用的字`)}</small></div><div class="segmented font-segmented">${items.map(([v, label]) => `<button data-setting="font" data-value="${v}" class="${(active || "mixed") === v ? "active" : ""}" style="font-family:${escapeHtml(FONT_STACKS[v].title)}">${label}</button>`).join("")}</div></div>`;
}
function segmentRow(title, desc, key, items, active) {
  return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><small>${desc}</small></div><div class="segmented">${items.map(([v, label]) => `<button data-setting="${key}" data-value="${v}" class="${String(active) === String(v) ? "active" : ""}">${label}</button>`).join("")}</div></div>`;
}

function storageSize() {
  const bytes = new Blob([JSON.stringify(store)]).size;
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
// 存储位置的更换排着队来（见 bindGeneralSettings 里的 commitStore）
let storeMoves = Promise.resolve();
// 通用：显示名称、存储位置、备份、清空对话
function bindGeneralSettings() {
  $("#settingName")?.addEventListener("input", e => {
    store.settings.name = e.target.value || t("访客");
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
        await settleConfig();
        data = await storeBridge("/api/store/move", { parent: next }, AbortSignal.timeout(600000));
      } catch (error) {
        return toast(String(error.message || error).slice(0, 80));
      }
      if (!data.moved) return;
      await switchStoreRoot(data);
      envStatus = null;
      clearTimeout(envPoll);
      void refreshEnv();
      archiveEntries = null;
      await refreshArchive();
      renderSettings();
      toast(
        t`存储已迁至 ${pathTail(data.root)}；${data.adopted ? t("沿用该处原有数据") : t("旧处原样保留")}${
          data.busyCount ? t`；${data.busyCount} 个文件正被占用未拷（如 ${data.busy[0]}），可从旧处补拷` : ""
        }`
      );
    };
  };
  storeInput?.addEventListener("change", e => commitStore(e.target.value));
  $("#settingStorePick")?.addEventListener("click", async () => {
    const button = $("#settingStorePick");
    button.disabled = true;
    try {
      const data = await bridge("/api/work/pick", { current: storeInput.value.trim() || bootstrap.store?.parent || "" });
      if (data.paths[0]) {
        storeInput.value = data.paths[0];
        commitStore(data.paths[0]);
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      button.disabled = false;
    }
  });
  $("#exportData")?.addEventListener("click", () => exportData($("#exportFiles")?.checked));
  $("#importData")?.addEventListener("click", () => $("#importInput").click());
  $("#clearAll")?.addEventListener("click", async () => {
    if (
      !(await askConfirm({
        title: t("清空全部对话？"),
        body: t`${store.conversations.length} 段对话将被移除，无法撤销；模型配置、个性化与卷宗将保留。`,
        ok: t("清空")
      }))
    )
      return;
    stopAllGenerations();
    const conversationIds = new Set(store.conversations.map(c => c.id)),
      draftFiles = Object.entries(store.drafts || {})
        .filter(([key]) => conversationIds.has(key))
        .flatMap(([, draft]) => (Array.isArray(draft?.attachments) ? draft.attachments.map(file => file.id) : []));
    const currentDraftFiles = currentId ? pendingAttachments.map(file => file.id) : [];
    void deleteAttachments([...attachmentIds(store.conversations.flatMap(everyMessage)), ...draftFiles, ...currentDraftFiles]);
    for (const c of store.conversations) void deleteConversationStorage(c.id);
    store.conversations = [];
    store.drafts = store.drafts?.[NEW_DRAFT_ID] ? { [NEW_DRAFT_ID]: store.drafts[NEW_DRAFT_ID] } : {};
    scrollPositions.clear();
    currentId = null;
    pendingAttachments = [];
    saveStore();
    render();
    renderSettings();
    toast(t("所有对话已清空"));
  });
}
// 工具：轮次上限、测试联网
function bindToolSettings() {
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
  // 测试联网：检索走的是桥接，与哪个模型无关，放在工具一栏
  $("#testSearch")?.addEventListener("click", async () => {
    const status = $("#searchStatus");
    status.textContent = t("检索中…");
    try {
      // 多几个词：被拦时搜索引擎只认第一个词，单个词测不出来
      const data = await bridge("/api/search", { query: t("苏轼 定风波 原文"), count: 3 }, AbortSignal.timeout(30000));
      status.textContent = !data.results?.length
        ? t("已接通，未得结果")
        : data.offTopic
          ? t("已接通，但结果对不上关键词（多半被拦了）")
          : t`可用 · ${data.source} · ${data.results.length} 条结果`;
    } catch (error) {
      status.textContent = friendlyError(error.message).slice(0, 60);
    }
  });
}
// 各栏共用的分段钮：data-setting 是设置里的键、data-value 是值（主题与记忆总开关另有讲究）
function bindSettingRows() {
  document.querySelectorAll("[data-setting]").forEach(
    button =>
      (button.onclick = () => {
        const key = button.dataset.setting,
          value = button.dataset.value;
        // 主题要等动效盖满才写进设置，这时重画会照旧值点亮；选中态就地先挪过来
        if (key === "theme") {
          button.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === button));
          switchTheme(value, button);
          return;
        }
        // 换语言：译文表在开页时载入（见 theme-boot.js），存下即重新载入
        // 点的正是眼前的语言（多半是随浏览器来的）：不必重载，但记下这是选定的，往后换了浏览器也照它
        if (key === "language") {
          const was = store.settings.language;
          store.settings.language = value === "en" ? "en" : "zh";
          if (store.settings.language === was) return;
          saveStore();
          if (value !== LANG) location.reload();
          return;
        }
        if (key === "notify") return void setNotify(value === "true");
        store.settings[key] = ["autoTitle", "archiveRead", "sandbox", "stageFit"].includes(key) ? value === "true" : value;
        saveStore();
        applyAppearance();
        renderSettings();
      })
  );
}
defineLayer({ name: "settings", rank: 60, open: () => isShown("#settingsModal"), close: closeSettings });
