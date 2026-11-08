// 言 · 设置 · 模型：模型卡片、ChatGPT 账号、思考档位探测、测试连接与模型列表
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
const advancedOpen = new Set();
const SILICONFLOW_BASE = "https://api.siliconflow.cn/v1";
// 模型设置里摊开着的那几个（一个模型平时收成一行，点开才是整张表）
const profileOpen = new Set();
// 模型卡与专司卡共用的几件：模型一栏（取回的列表可选，末项「手动输入…」）、Base URL 的示例、换接口时地址怎么跟。
// attrs 是这一栏各件挂的属性名（两种卡各绑各的）
/** @param {string[]} models @param {string} model @param {string} placeholder @param {{ field: string, select: string, action: string }} attrs */
function modelPickerHtml(models, model, placeholder, { field, select, action }) {
  const listed = models.includes(model);
  return `<div class="field-row">${models.length ? `<select class="field wide select" ${select}>${models.map(m => `<option value="${escapeHtml(m)}"${m === model ? " selected" : ""}>${escapeHtml(m)}</option>`).join("")}<option value="__custom__"${listed ? "" : " selected"}>${t(`手动输入…`)}</option></select>` : ""}<input class="field wide${models.length && listed ? " hidden" : ""}" ${field}="model" value="${escapeHtml(model)}" placeholder="${escapeHtml(placeholder)}"><button class="outline-btn" ${action}="models" title="${t(`从接口的 /models 获取可用模型`)}">${models.length ? t("刷新") : t("获取列表")}</button></div>`;
}
/** 下拉换了：选「手动输入…」露出输入框给人填、交回空；选定一个即填进输入框并交回 @param {HTMLSelectElement} select @param {HTMLInputElement} input */
function pickModel(select, input) {
  const custom = select.value === "__custom__";
  input.classList.toggle("hidden", !custom);
  if (custom) {
    input.focus();
    return "";
  }
  return (input.value = select.value);
}
/** @param {Endpoint} endpoint */
function baseUrlPlaceholder(endpoint) {
  const api = profileApi(endpoint);
  return api === "anthropic" ? "https://api.anthropic.com" : api === "siliconflow" ? SILICONFLOW_BASE : "https://example.com/v1";
}
// 选硅基流动即填好它的地址；从它换走时地址一并清掉，免得别家的请求还发去硅基流动
/** @param {Endpoint} endpoint @param {string} api 换成的接口 */
function baseUrlAfterSwitch(endpoint, api) {
  const to = api === "siliconflow";
  return to === (profileApi(endpoint) === "siliconflow") ? endpoint.baseUrl : to ? SILICONFLOW_BASE : "";
}
function modelsSettingsHtml() {
  return `<h2>${t(`模型`)}</h2>${usageCardHtml()}<div id="profileList">${profiles().map(profileCardHtml).join("")}</div><button id="addProfile" class="outline-btn profile-add">${t(`＋ 接入模型`)}</button>`;
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
    chatgpt = profileApi(p) === "chatgpt",
    siliconflow = profileApi(p) === "siliconflow";
  const modelField = modelPickerHtml(models, p.model, t("如 gpt-4o-mini"), {
    field: "data-field",
    select: "data-model-select",
    action: "data-profile-action"
  });
  const quotaField = `<div class="field-row"><input type="number" min="0" step="any" class="field wide" data-quota-amount value="${escapeHtml(quota.amount)}" placeholder="${t(`不限`)}" ${invalidQuota ? `aria-invalid="true"` : ""}><select class="field select" data-quota-unit>${[
    ["k", t("千 (k)")],
    ["m", t("百万 (m)")],
    ["e", t("亿 (e)")]
  ]
    .map(([v, label]) => `<option value="${v}"${quota.unit === v ? " selected" : ""}>${label}</option>`)
    .join("")}</select></div>`;
  // 平时收成一行：名字、模型 ID 与接口、是否默认；点开才是整张表。模型一多，一行一个翻得过来
  return `<details class="profile-card" data-profile-card="${escapeHtml(p.id)}"${profileOpen.has(p.id) ? " open" : ""}><summary class="profile-head"><strong class="profile-name">${escapeHtml(p.name)}</strong><span class="profile-gist">${escapeHtml(profileGist(p))}</span>${p.id === store.settings.activeProfileId ? `<span class="profile-badge">${t(`默认`)}</span>` : ""}</summary><div class="profile-body"><div class="profile-grid"><label>${t(`显示名称`)}<input class="field wide" data-field="name" value="${escapeHtml(p.name)}"></label><label>${t`用量上限${quotaField}`}<small>${t(`留空不限`)}</small></label><label class="profile-full">${t(`接口`)}<div class="segmented"><button data-choice-field="api" data-value="siliconflow" class="${siliconflow ? "active" : ""}">${t(`硅基流动`)}</button><button data-choice-field="api" data-value="openai" class="${profileApi(p) === "openai" ? "active" : ""}">${t(`OpenAI 兼容`)}</button><button data-choice-field="api" data-value="anthropic" class="${anthropicLike(p) ? "active" : ""}">Anthropic</button><button data-choice-field="api" data-value="chatgpt" class="${chatgpt ? "active" : ""}">${t(`ChatGPT 订阅`)}</button></div><small>${chatgpt ? t("额度记在 ChatGPT 订阅上") : anthropicLike(p) ? "Messages API" : "chat/completions"}</small></label>${chatgpt ? chatgptAccountHtml() : `<label class="profile-full">Base URL<input class="field wide" data-field="baseUrl" value="${escapeHtml(p.baseUrl || "")}" placeholder="${baseUrlPlaceholder(p)}"></label><label class="profile-full">API Key<input type="password" class="field wide" data-field="apiKey" value="${escapeHtml(p.apiKey || "")}" placeholder="sk-…" autocomplete="off"></label>`}<label class="profile-full">${t`模型${modelField}`}</label></div><details class="profile-advanced"${advancedOpen.has(p.id) ? " open" : ""}><summary><span class="advanced-title">${t(`高级配置`)}</span><small>${p.tools === false ? t("本机工具关") : ""}</small></summary><div class="profile-grid"><label>${t(`本机联网与文档工具`)}<div class="segmented"><button data-toggle-field="tools" data-value="true" class="${p.tools !== false ? "active" : ""}">${t(`开`)}</button><button data-toggle-field="tools" data-value="false" class="${p.tools === false ? "active" : ""}">${t(`关`)}</button></div><small>${t(`需接口支持 function calling`)}</small></label>${chatgpt ? "" : `<label><code>temperature</code><input type="number" min="0" max="2" step="0.1" class="field wide" data-field="temperature" value="${Number.isFinite(p.temperature) ? p.temperature : ""}" placeholder="${t(`接口默认`)}"><small>${t(`0–2，留空由接口定`)}</small></label>`}${anthropicLike(p) ? `<label><code>max_tokens</code><input type="number" min="16" class="field wide" data-field="maxTokens" value="${Number(p.maxTokens) || ""}" placeholder="${DEFAULT_MAX_TOKENS}"><small>${t`留空按 ${DEFAULT_MAX_TOKENS}`}</small></label>` : ""}<label>${t(`上下文窗口`)}<input type="number" min="1000" step="1000" class="field wide" data-field="contextWindow" value="${Number(p.contextWindow) || ""}" placeholder="${t(`如 128000`)}"><small>${t(`过七成半自动压缩前文`)}</small></label><label>${t(`思考档位`)}<input class="field wide" data-field="reasoningLevels" value="${escapeHtml(p.reasoningLevels || "")}" placeholder="low, medium, high"><small>${t(`逗号分隔；选定模型时自动探测`)}</small></label></div></details><div class="profile-actions"><button class="outline-btn" data-profile-action="test">${t(`测试连接`)}</button>${p.id !== store.settings.activeProfileId ? `<button class="outline-btn" data-profile-action="default">${t(`设为默认`)}</button>` : ""}<button class="danger-btn" data-profile-action="delete">${t(`删除`)}</button><span class="profile-status">${invalidQuota ? t("请填写大于 0 的数值，或留空不限") : ""}</span></div></div></details>`;
}
// ChatGPT 订阅的账号：在浏览器里授权登录（OpenAI 的「Sign in with ChatGPT」），凭证只在桥接里，页面只问登没登、是谁。
// 不用 label 包：label 里的按钮会被点标签文字连带按下
/** @type {{ signedIn: boolean, email: string, pending: boolean, error: string } | null} 还没问过是 null */
let chatgptAccount = null;
function chatgptAccountHtml() {
  const a = chatgptAccount,
    text = !a ? "…" : a.signedIn ? t`已登录${a.email ? ` · ${a.email}` : ""}` : a.pending ? t("等待浏览器授权…") : t("未登录");
  return `<div class="profile-full profile-cell">${t(`账号`)}<div class="field-row"><span class="field wide" data-chatgpt-account>${escapeHtml(text)}</span><button class="outline-btn" data-chatgpt-action="${a?.signedIn ? "logout" : "login"}">${a?.signedIn ? t("退出登录") : t("登录")}</button></div><small>${t(`以 ChatGPT 账号授权，用量记在订阅上`)}</small></div>`;
}
// 问一回桥接，只改账号那一行，不重画整页（卡片里正填着的字不丢）
async function refreshChatgptAccount() {
  bindChatgptButtons();
  chatgptAccount = await bridge("/api/chatgpt/status", {}).catch(() => chatgptAccount);
  document.querySelectorAll("[data-chatgpt-account]").forEach(el => {
    const row = /** @type {HTMLElement} */ (el.closest(".profile-cell"));
    row.outerHTML = chatgptAccountHtml();
  });
  bindChatgptButtons();
  return chatgptAccount;
}
// 账号那一行在模型卡里，也在专司审查的卡里：登录、退出不认是哪张卡
function bindChatgptButtons() {
  document.querySelectorAll("[data-chatgpt-action]").forEach(el => {
    const button = /** @type {HTMLElement} */ (el),
      card = /** @type {HTMLElement} */ (button.closest(".profile-card"));
    button.onclick = () => (button.dataset.chatgptAction === "login" ? chatgptLogin(card) : chatgptLogout());
  });
}
async function chatgptLogout() {
  await bridge("/api/chatgpt/logout", {}).catch(() => null);
  await refreshChatgptAccount();
}
// 登录：桥接开回调口、用系统浏览器打开授权页；这边每隔一会儿问一回，登上了就顺手按下这张卡的「获取列表」
/** @param {HTMLElement} card */
async function chatgptLogin(card) {
  const again = card.dataset.profileCard ? `[data-profile-card="${card.dataset.profileCard}"]` : `[data-duty="${card.dataset.duty}"]`,
    status = card.querySelector(".profile-status");
  try {
    const { url } = await bridge("/api/chatgpt/login", {});
    status.innerHTML = `${t(`授权页已在浏览器中打开 ·`)} <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${t(`手动打开`)}</a>`;
    await refreshChatgptAccount();
    for (let i = 0; i < 400; i++) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const a = await refreshChatgptAccount();
      if (a?.signedIn || !a?.pending) break;
    }
    const now = document.querySelector(again);
    if (!now) return;
    if (chatgptAccount?.signedIn)
      /** @type {HTMLElement|null} */ (now.querySelector('[data-profile-action="models"], [data-duty-action="models"]'))?.click();
    else now.querySelector(".profile-status").textContent = chatgptAccount?.error || t("未登录");
  } catch (error) {
    status.textContent = friendlyError(error.message);
  }
}
/** @param {Profile} p */
function profileGist(p) {
  return [
    p.model || t("未填模型"),
    { chatgpt: t("ChatGPT 订阅"), anthropic: "Anthropic", openai: t("OpenAI 兼容"), siliconflow: t("硅基流动") }[profileApi(p)]
  ].join(" · ");
}

// 选定模型后探它认哪几档，结果写在卡片的状态行上，高级配置里的「思考档位」也跟着填；探不成不吭声（撞了错再学）。
// 亲手填过档位的不探（测试连接也不），状态行照实写它填的。同一张卡片连着探了两次（模型改了两回），只有最后一次能动状态行——
// 先前那次迟到回来是作废的，不能把后一次已经写上的结果抹掉
const probeSerial = new Map();
/** @param {Profile} profile */
async function reportReasoningProbe(profile, card, force = false) {
  if (!profile.model) return;
  // 重探不能靠清掉「探过」的标记：reasoningProbed 会把「有档位、没标记」当旧版手填的，重探一回反倒成了手填
  const redo = force && !reasoningManual(profile);
  const status = () => document.querySelector(`[data-profile-card="${profile.id}"] .profile-status`);
  // 状态行上此前的话留着（「可用 · 4 ms」），但上一回探到的档位不留——刷新列表探了一次、再从下拉里选一个又探一次，不能越接越长
  const before = (status()?.textContent || "")
    .split(" · ")
    .filter(part => !/^(探测)?思考档位|^(Detecting t|T)hinking levels/.test(part))
    .join(" · ");
  if (!redo && reasoningProbed(profile)) {
    if (force && status()) {
      const levels = profileReasoningLevels(profile);
      status().textContent = t`${before ? `${before} · ` : ""}思考档位 ${levels.length ? levels.map(reasoningLabel).join(" / ") : t("此模型不认")}${reasoningManual(profile) ? t("（手填）") : ""}`;
    }
    return;
  }
  const serial = (probeSerial.get(profile.id) || 0) + 1;
  probeSerial.set(profile.id, serial);
  if (status()) status().textContent = t`${before ? `${before} · ` : ""}探测思考档位…`;
  const levels = await probeReasoningLevels(profile, redo);
  const el = status();
  if (!el || probeSerial.get(profile.id) !== serial) return;
  if (levels === null) el.textContent = before;
  else {
    el.textContent = t`${before ? `${before} · ` : ""}思考档位 ${levels.length ? levels.map(reasoningLabel).join(" / ") : t("此模型不认")}`;
    const field = document.querySelector(`[data-profile-card="${profile.id}"] [data-field="reasoningLevels"]`);
    if (field) field.value = profile.reasoningLevels || "";
    renderModelTriggers();
  }
}
/** @param {Profile} profile */
async function handleProfileAction(profile, action, card) {
  if (action === "default") {
    store.settings.activeProfileId = profile.id;
    saveStore();
    renderSettings();
    renderHeader();
    return;
  }
  if (action === "delete") {
    if (
      !(await askConfirm({
        title: t("删除这个模型？"),
        body: t`「${profile.name || profile.model || t("未命名")}」的配置连同 API Key 将一并移除，无法撤销。`,
        ok: t("删除")
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
    status.textContent = t("取列表中…");
    try {
      const models = await fetchModelList(profile);
      if (!models.length) throw Error(t("接口未返回模型列表，请手动输入模型 ID"));
      profile.modelList = models;
      if (!models.includes(profile.model)) profile.model = models[0];
      saveStore();
      renderSettings();
      renderHeader();
      card = document.querySelector(`[data-profile-card="${profile.id}"]`);
      if (card) card.querySelector(".profile-status").textContent = t`已取回 ${models.length} 个模型`;
      void reportReasoningProbe(profile, card);
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
    return;
  }
  if (action === "test") {
    let status = card.querySelector(".profile-status");
    status.textContent = t("接通中…");
    try {
      card = document.querySelector(`[data-profile-card="${profile.id}"]`) || card;
      status = card.querySelector(".profile-status");
      status.textContent = t("接通中…");
      const started = performance.now();
      const result = await bridge("/api/test", { profile: profileForRequest(profile) });
      // 清单里没有它：接口通着，这个模型却不在（填错了名字，或服务端只列此刻答得上来的、它正挂着）
      if (result.modelFound === false) {
        status.textContent = t`已接通，但接口的模型列表里没有 ${profile.model}`;
        return;
      }
      status.textContent = t`可用 · ${Math.round(performance.now() - started)} ms`;
      // 测试连接是亲手要的一次核对：档位也重探一遍
      void reportReasoningProbe(profile, card, true);
    } catch (error) {
      status.textContent = friendlyError(error.message);
    }
  }
}
/** @param {Endpoint} profile */
/** @param {"image"} [kind] 列画图的（专司里的生图；硅基流动据此筛） */
async function fetchModelList(profile, kind) {
  if (!String(profile.baseUrl || "").trim() && profileApi(profile) !== "chatgpt") throw Error(t("请先填写 Base URL"));
  const data = await bridge("/api/models", { profile: profileForRequest(profile), ...(kind ? { kind } : {}) });
  return [...new Set(data.models || [])].sort();
}
// 模型一栏：添一个模型、各张模型卡里的输入与按钮
function bindModelSettings() {
  bindUsageCard();
  $("#addProfile")?.addEventListener("click", () => {
    /** @type {Profile} */
    const p = {
      id: uid(),
      name: t("新模型"),
      model: "",
      baseUrl: "",
      apiKey: "",
      quota: "",
      usedTokens: 0
    };
    store.profiles.push(p);
    store.settings.activeProfileId ||= p.id;
    profileOpen.add(p.id);
    saveStore();
    renderSettings();
    setTimeout(() => document.querySelector(`[data-profile-card="${p.id}"] [data-field="name"]`)?.focus(), 0);
  });
  document.querySelectorAll("[data-profile-card]").forEach(card => {
    const p = profiles().find(item => item.id === card.dataset.profileCard);
    if (!p) return;
    card.querySelectorAll("[data-field]").forEach(input =>
      input.addEventListener("input", e => {
        const field = e.target.dataset.field;
        // 温度清空即不传（Number("") 是 0，不能照转）
        if (field === "temperature" && !e.target.value.trim()) delete p.temperature;
        else
          p[field] = ["temperature", "maxTokens", "usedTokens", "contextWindow"].includes(field) ? Number(e.target.value) : e.target.value;
        if (field === "contextWindow") updateContextGauge();
        // 亲手填的档位就是定论，不再探；清空了下次选模型再探
        if (field === "reasoningLevels") p.reasoningProbed = e.target.value.trim() ? `manual|${reasoningProbeKey(p)}` : "";
        // 收起时那一行跟着改
        if (field === "name") card.querySelector(".profile-name").textContent = p.name;
        if (field === "model") card.querySelector(".profile-gist").textContent = profileGist(p);
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
      card.querySelector(".profile-status").textContent = valid ? "" : t("请填写大于 0 的数值，或留空不限");
      if (!valid) return;
      if (p.quota !== value) {
        p.quota = value;
        p.usedTokens = 0;
        saveStoreSoon();
        if (p.id === activeProfile()?.id) renderQuota();
      }
    };
    amount.addEventListener("input", applyQuota);
    unit.addEventListener("change", applyQuota);
    card.querySelector("[data-model-select]")?.addEventListener("change", e => {
      const model = pickModel(/** @type {HTMLSelectElement} */ (e.target), card.querySelector('[data-field="model"]'));
      if (!model) return;
      p.model = model;
      card.querySelector(".profile-gist").textContent = profileGist(p);
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
          const field = button.dataset.choiceField;
          if (field === "api") p.baseUrl = baseUrlAfterSwitch(p, button.dataset.value);
          p[field] = button.dataset.value;
          saveStore();
          renderSettings();
        })
    );
    // toggle 不冒泡：卡片自己的开合与里头「高级配置」的开合各听各的
    card.addEventListener("toggle", e => {
      if (e.target !== card) return;
      if (card.open) profileOpen.add(p.id);
      else profileOpen.delete(p.id);
    });
    card.querySelector(".profile-advanced")?.addEventListener("toggle", e => {
      if (e.target.open) advancedOpen.add(p.id);
      else advancedOpen.delete(p.id);
    });
    card
      .querySelectorAll("[data-profile-action]")
      .forEach(button => (button.onclick = () => handleProfileAction(p, button.dataset.profileAction, card)));
  });
  if (document.querySelector("[data-chatgpt-account]")) void refreshChatgptAccount();
}
