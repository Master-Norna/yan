// 言 · 设置 · 专司：主答之外各司一事的几位——拟题随对话的模型、只有开关；记忆、审查与生图各自另配一份，
// 不借模型栏里的那几份：同一份发，会挤掉主答的提示缓存，本机的模型还得多扛一路并发。
// 审查可走 ChatGPT 订阅：借的是登录的账号、不是哪一份模型，另挑的小模型缓存各归各，免得只为审查另养一个 Key。
// 一职一张卡，样子同模型栏：收起一行只写职名与模型名（拟题、没配的不写），最右一粒记号——墨点是开或已配，空圈是关或未配；
// 点开先是开关，开了才铺开接口、地址、Key、模型（设计稿/110–112）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
/** @typedef {"memory"|"review"|"image"} DutyId */
/** @type {Record<DutyId, { key: "dutyMemory"|"dutyReview"|"dutyImage", name: () => string, apis: Duty["api"][], off: () => string }>} */
const DUTIES = {
  // 记忆：配好了每段对话开头带上记忆，离开一段后由它整理（见 11-memory.js）；关着即不带不记
  memory: {
    key: "dutyMemory",
    name: () => t("记忆"),
    apis: ["siliconflow", "openai", "anthropic", "chatgpt"],
    off: () => t("关，不带记忆")
  },
  review: {
    key: "dutyReview",
    name: () => t("审查"),
    apis: ["siliconflow", "openai", "anthropic", "chatgpt"],
    off: () => t("关，照规则")
  },
  image: { key: "dutyImage", name: () => t("生图"), apis: ["siliconflow", "openai"], off: () => t("未配") }
};
const DUTY_API_LABEL = {
  siliconflow: () => t("硅基流动"),
  openai: () => t("OpenAI 兼容"),
  anthropic: () => "Anthropic",
  chatgpt: () => t("ChatGPT 订阅")
};
// 哪几张卡开着：整栏重画后照样开着
const dutyOpen = new Set();
/** 开着且填够了（模型与地址；本机的服务可不要 Key，ChatGPT 订阅连地址也不要）才算配好 @param {Duty} d */
function dutyReady(d) {
  return !!(d?.on && d.model.trim() && (d.api === "chatgpt" || d.baseUrl.trim()));
}
/** @param {DutyId} id */
function dutyOf(id) {
  return store.settings[DUTIES[id].key];
}
function dutyMarkHtml(on, tip) {
  return `<span class="duty-mark${on ? " on" : ""}" title="${escapeHtml(tip)}" aria-label="${escapeHtml(tip)}"></span>`;
}
/** 收起时那一行：职名、配好了的模型名、记号 @param {DutyId} id */
function dutyHeadHtml(id) {
  const d = dutyOf(id),
    ready = dutyReady(d);
  return `<strong class="profile-name">${DUTIES[id].name()}</strong><span class="profile-gist">${ready ? escapeHtml(d.model) : ""}</span>${dutyMarkHtml(ready, ready ? t("已配") : d.on ? t("未填完") : DUTIES[id].off())}`;
}
function dutyCardHtml(id, head, body) {
  return `<details class="profile-card" data-duty="${id}"${dutyOpen.has(id) ? " open" : ""}><summary class="profile-head">${head}</summary><div class="profile-body">${body}</div></details>`;
}
/** @param {DutyId} id */
function dutyFormHtml(id) {
  const d = dutyOf(id),
    onOff = `<div class="segmented"><button data-duty-on="${id}" data-value="true" class="${d.on ? "active" : ""}">${t(`开`)}</button><button data-duty-on="${id}" data-value="false" class="${d.on ? "" : "active"}">${t(`关`)}</button></div>`;
  if (!d.on) return `<div class="profile-grid"><label class="profile-full">${t(`启用`)}${onOff}</label></div>`;
  const apis = DUTIES[id].apis
      .map(api => `<button data-duty-api="${api}" class="${d.api === api ? "active" : ""}">${DUTY_API_LABEL[api]()}</button>`)
      .join(""),
    model = modelPickerHtml(d.modelList, d.model, id === "image" ? "Kwai-Kolors/Kolors" : t("如 gpt-4o-mini"), {
      field: "data-duty-field",
      select: "data-duty-select",
      action: "data-duty-action"
    });
  return `<div class="profile-grid"><label class="profile-full">${t(`启用`)}${onOff}</label><label class="profile-full">${t(`接口`)}<div class="segmented">${apis}</div><small>${id === "image" ? "images/generations" : d.api === "chatgpt" ? t("额度记在 ChatGPT 订阅上") : d.api === "anthropic" ? "Messages API" : "chat/completions"}</small></label>${d.api === "chatgpt" ? chatgptAccountHtml() : `<label class="profile-full">Base URL<input class="field wide" data-duty-field="baseUrl" value="${escapeHtml(d.baseUrl)}" placeholder="${baseUrlPlaceholder(d)}"></label><label class="profile-full">API Key<input type="password" class="field wide" data-duty-field="apiKey" value="${escapeHtml(d.apiKey)}" placeholder="sk-…" autocomplete="off"></label>`}<label class="profile-full">${t(`模型`)}${model}</label></div><div class="profile-actions">${id !== "image" ? `<button class="outline-btn" data-duty-action="test">${t(`测试连接`)}</button>` : ""}<span class="profile-status"></span></div>`;
}
function dutySettingsHtml() {
  const title = store.settings.autoTitle,
    titleCard = dutyCardHtml(
      "title",
      `<strong class="profile-name">${t(`拟题`)}</strong><span class="profile-gist"></span>${dutyMarkHtml(title, title ? t("开") : t("关"))}`,
      `<div class="profile-grid"><label class="profile-full">${t(`自动拟题`)}<div class="segmented"><button data-setting="autoTitle" data-value="true" class="${title ? "active" : ""}">${t(`开`)}</button><button data-setting="autoTitle" data-value="false" class="${title ? "" : "active"}">${t(`关`)}</button></div></label></div>`
    );
  return `<h2>${t(`专司`)}</h2>${titleCard}${/** @type {DutyId[]} */ (["memory", "review", "image"]).map(id => dutyCardHtml(id, dutyHeadHtml(id), dutyFormHtml(id))).join("")}`;
}
function bindDutySettings() {
  document.querySelectorAll("[data-duty]").forEach(card => {
    card.addEventListener("toggle", e => {
      if (e.target !== card) return;
      if (card.open) dutyOpen.add(card.dataset.duty);
      else dutyOpen.delete(card.dataset.duty);
    });
    if (card.dataset.duty === "title") return;
    const id = /** @type {DutyId} */ (card.dataset.duty),
      d = dutyOf(id),
      status = () => card.querySelector(".profile-status");
    // 收起时那一行跟着改：模型名、记号
    const refreshHead = () => (card.querySelector(".profile-head").innerHTML = dutyHeadHtml(id));
    card.querySelectorAll("[data-duty-on]").forEach(
      button =>
        (button.onclick = () => {
          d.on = button.dataset.value === "true";
          // 头一回开：硅基流动的地址替它填上
          if (d.on && d.api === "siliconflow" && !d.baseUrl) d.baseUrl = SILICONFLOW_BASE;
          // 记忆从开起这一刻算起：此前的旧对话不拿去整理（关着那阵的也不补）
          if (d.on && id === "memory") store.memory.since = now();
          saveStore();
          renderSettings();
        })
    );
    card.querySelectorAll("[data-duty-api]").forEach(
      button =>
        (button.onclick = () => {
          const api = /** @type {Duty["api"]} */ (button.dataset.dutyApi);
          d.baseUrl = baseUrlAfterSwitch(d, api);
          d.api = api;
          saveStore();
          renderSettings();
        })
    );
    card.querySelectorAll("[data-duty-field]").forEach(input =>
      input.addEventListener("input", e => {
        d[e.target.dataset.dutyField] = e.target.value;
        refreshHead();
        saveStoreSoon();
      })
    );
    card.querySelector("[data-duty-select]")?.addEventListener("change", e => {
      const model = pickModel(/** @type {HTMLSelectElement} */ (e.target), card.querySelector('[data-duty-field="model"]'));
      if (!model) return;
      d.model = model;
      refreshHead();
      saveStoreSoon();
    });
    card.querySelectorAll("[data-duty-action]").forEach(
      button =>
        (button.onclick = async () => {
          if (button.dataset.dutyAction === "models") {
            status().textContent = t("取列表中…");
            try {
              const models = await fetchModelList(d, id === "image" ? "image" : undefined);
              if (!models.length) throw Error(t("接口未返回模型列表，请手动输入模型 ID"));
              d.modelList = models;
              if (!models.includes(d.model)) d.model = models[0];
              saveStore();
              renderSettings();
              const fresh = document.querySelector(`[data-duty="${id}"] .profile-status`);
              if (fresh) fresh.textContent = t`已取回 ${models.length} 个模型`;
            } catch (error) {
              status().textContent = friendlyError(error.message);
            }
            return;
          }
          status().textContent = t("接通中…");
          try {
            const started = performance.now();
            await bridge("/api/test", { profile: profileForRequest(d) });
            status().textContent = t`可用 · ${Math.round(performance.now() - started)} ms`;
          } catch (error) {
            status().textContent = friendlyError(error.message);
          }
        })
    );
  });
  if (document.querySelector("[data-duty] [data-chatgpt-account]")) void refreshChatgptAccount();
}
