// 言 · 渲染 · 外框：整页重画、顶栏、余墨、模型菜单
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function render(shouldScroll = false) {
  rememberPlace();
  const c = currentConversation(),
    library = view === "library",
    groups = view === "groups",
    page = library || groups;
  // 人在卷宗页时这段对话的一答写完了，记了「有新回复」；回到它眼前就算看过了，不必再点一次侧栏
  if (c && !page && c.unread) {
    c.unread = false;
    saveStoreSoon();
  }
  renderHeader();
  renderHistory();
  syncDocumentTitle();
  requestAnimationFrame(() => syncJumpBottom());
  $("#library").classList.toggle("hidden", !library);
  $("#groups").classList.toggle("hidden", !groups);
  $("#welcome").classList.toggle("hidden", page || !!c);
  $("#chat").classList.toggle("hidden", page || !c);
  $("#chatScrollGrabber").classList.toggle("hidden", page || !c);
  $("#composerArea").classList.toggle("hidden", page || !c);
  $("#openLibrary").classList.toggle("active", library);
  $("#openGroups").classList.toggle("active", groups);
  renderGroupsCount();
  if (library) renderLibrary();
  else if (groups) renderGroupsPage();
  else if (c) renderConversation(shouldScroll);
  else renderOutline();
  restoreDraft();
  renderAttachments();
  renderSendButtons();
  renderApprovalBar();
  renderHelperBar();
  requestAnimationFrame(syncChatScrollGrabber);
}
function renderHeader() {
  renderModelTriggers();
  $("#displayNameSidebar").textContent = store.settings.name;
  $("#avatar").textContent = store.settings.name.trim().slice(0, 1) || t("客");
  const dark = document.documentElement.dataset.theme === "dark",
    toggle = $("#themeToggle");
  toggle.dataset.theme = dark ? "dark" : "light";
  toggle.title = dark ? t("天光 · 亮色") : t("落墨 · 暗色");
  $("#greeting").textContent = greeting();
  renderModeSwitch();
  renderWelcome();
  renderQuota();
  renderClepsydra();
  renderModelMenu();
  renderLibraryCount();
}
// 余墨：顶栏上只一笔墨色短横，随用量从笔尾往回收（笔尾三缕飞白），底下一道淡痕是全长；数目靠近才浮出（见 设计稿/30 甲）。
// 设了上限时报还剩多少，没设（不限）时墨常满、改报已耗多少。落选的：「余墨」二字 + 一笔朱色渐变 + 等宽数目常显（功能最少，占位最多）
function quotaInk(ratio) {
  const length = 22 * ratio,
    ghost = brushStroke([2, 8, 12, 6.6, 22, 7.8], 3.4, { tone: "ghost", tail: 0.3 });
  if (length < 1.5) return ghost;
  const body = brushStroke([2, 8, length * 0.5, 6.8, length * 0.78, 7.6], 3.6, { tail: 0.7 }),
    hairs = [-1.1, 0, 1.15]
      .map((d, i) =>
        brushStroke([length * 0.7, 7.6 + d, length * 0.86, 7.4 + d * 1.2, length + [2, 0, 3][i], 7.5 + d * 1.5], 0.8, { tail: 0, head: 1 })
      )
      .join("");
  return ghost + body + hairs;
}
// 浮签是一句话，数目用亿、万；别处（上下文、每答耗墨）仍是 k / m / e，与设置里填上限的写法一致
function quotaAmount(n) {
  const compact = (amount, unit) => `${Number(amount.toFixed(amount >= 10 ? 0 : 1))} ${unit}`;
  if (LANG === "en")
    return n >= 1e9 ? compact(n / 1e9, "B") : n >= 1e6 ? compact(n / 1e6, "M") : n >= 1e4 ? compact(n / 1e3, "K") : String(Math.round(n));
  return n >= 100000000 ? compact(n / 100000000, "亿") : n >= 10000 ? compact(n / 10000, "万") : String(Math.round(n));
}
function renderQuota() {
  const p = activeProfile(),
    cap = p ? parseTokenLimit(p.quota) : null,
    used = Math.max(0, Number(p?.usedTokens || 0));
  const remaining = cap ? Math.max(0, cap - used) : 0,
    ratio = !p ? 0 : cap ? remaining / cap : 1,
    status = $("#quotaStatus");
  $("#quotaInk").innerHTML = quotaInk(ratio);
  status.querySelector(".quota-label").textContent = p && cap === null ? t("耗墨") : t("余墨");
  $("#quotaText").textContent = !p ? "" : quotaAmount(cap === null ? used : remaining);
  $("#quotaNote").textContent = !p ? t("尚未接入模型") : cap === null ? t("不设上限") : t`上限 ${quotaAmount(cap)}`;
  status.classList.toggle("dry", !!cap && remaining === 0);
  status.setAttribute(
    "aria-label",
    !p
      ? t("尚未接入模型")
      : cap === null
        ? t`不限用量，已耗 ${formatTokens(used)}`
        : t`余墨 ${formatTokens(remaining)} / ${formatTokens(cap)}`
  );
}
function renderModelTriggers() {
  const p = activeProfile(),
    c = currentConversation(),
    level = (c ? c.reasoning : p?.reasoning) || "",
    preset = presetOf(c);
  // 标签写实际会送出的那一档：模型不认所选的就落到最接近的；模型不认思考档位（探过是 none）就不写
  const used = level ? nearestReasoning(p, level) : "";
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.querySelector(".model-name").textContent = p?.name || t("尚未接入模型");
    button.querySelector(".model-extra").textContent = [preset?.name, used ? t`思考 ${reasoningLabel(used)}` : ""]
      .filter(Boolean)
      .map(text => `· ${text}`)
      .join(" ");
  });
}
function closeModelMenu() {
  const menu = $("#modelMenu");
  clearTimeout(modelFlyTimer);
  modelFly = "";
  hideWithFade(menu);
  document.querySelectorAll(".model-trigger").forEach(button => button.setAttribute("aria-expanded", "false"));
}
function positionModelMenu(button) {
  const menu = $("#modelMenu");
  if (!button || menu.classList.contains("hidden")) return;
  menu.classList.remove("drop-up");
  menu.style.removeProperty("max-height");
  const rect = button.getBoundingClientRect(),
    gap = 9,
    edge = 12;
  const below = Math.max(0, innerHeight - rect.bottom - gap - edge),
    above = Math.max(0, rect.top - gap - edge);
  // 下面放不下整张、上面更宽就往上开：不为省地方让模型那一列滚起来
  const dropUp = below < menu.scrollHeight && above > below;
  menu.classList.toggle("drop-up", dropUp);
  // 栏与浮列不随主栏滚动，要占的高度得留足；只有模型那一列在里面滚
  menu.style.maxHeight = `${Math.max(176, Math.min(dropUp ? above : below, 420))}px`;
}
// 模型菜单（设计稿/148 乙）：主栏只列模型；预设、思考深度各一栏，指上即在旁边浮出竖列，点也开（触屏只有点）。
// 浮列是菜单的孩子，从栏斜着移过去时路过别的栏、跨过两板之间的缝都有一小段宽限，到了浮列上就算数
const MODEL_FLY_SWITCH = 120,
  MODEL_FLY_CLOSE = 240;
let modelFly = "",
  /** @type {any} */ modelFlyTimer = 0;
/** 一栏的浮列靠哪边、多高：右边放得下放右边，再左边，两边都放不下（窄屏）就地摊开在栏下 @param {HTMLElement} row @param {HTMLElement} sub */
function placeModelSub(row, sub) {
  const menu = $("#modelMenu"),
    gap = 6,
    edge = 12;
  sub.classList.remove("inline", "on-left");
  sub.style.removeProperty("top");
  const box = menu.getBoundingClientRect(),
    room = sub.offsetWidth + gap + edge;
  if (innerWidth - box.right < room && box.left < room) return sub.classList.add("inline");
  sub.classList.toggle("on-left", innerWidth - box.right < room);
  sub.style.maxHeight = `${innerHeight - edge * 2}px`;
  // 与栏齐平；碰到窗沿往回收
  const top = Math.max(edge, Math.min(row.getBoundingClientRect().top - 8, innerHeight - edge - sub.offsetHeight));
  sub.style.top = `${top - box.top - menu.clientTop}px`;
}
/** 照 modelFly 开合各栏的浮列 */
function paintModelFly() {
  document.querySelectorAll("#modelMenu [data-fly]").forEach(node => {
    const row = /** @type {HTMLElement} */ (node),
      sub = /** @type {HTMLElement} */ (row.nextElementSibling),
      open = row.dataset.fly === modelFly;
    row.classList.toggle("open", open);
    row.setAttribute("aria-expanded", String(open));
    sub.classList.toggle("hidden", !open);
    if (open) placeModelSub(row, sub);
    row.classList.toggle("to-left", open && sub.classList.contains("on-left"));
  });
}
/** @param {string} name 要开的栏；空即都收起 @param {number} [delay] */
function flyModelMenu(name, delay = 0) {
  clearTimeout(modelFlyTimer);
  if (name === modelFly) return;
  if (!delay) {
    modelFly = name;
    return paintModelFly();
  }
  modelFlyTimer = setTimeout(() => flyModelMenu(name), delay);
}
/** @param {string} name @param {string} label @param {string} value 栏右端写此刻选的 @param {string} list 浮列里的各项 */
const modelFlyHtml = (name, label, value, list) =>
  `<button type="button" class="model-fly" data-fly="${name}" aria-haspopup="menu" aria-expanded="false"><span>${label}</span><span class="model-fly-value">${value}</span><span class="model-fly-arrow" aria-hidden="true">›</span></button><div class="model-sub hidden" role="menu">${list}</div>`;
function renderModelMenu() {
  const all = profiles();
  $("#modelMenu").innerHTML = all.length
    ? `<div class="model-menu-list">${all
        .map(p => {
          const active = p.id === activeProfile()?.id;
          // 只列显示名：模型原名与接口地址长短不一，行高参差；要看去模型设置
          return `<button class="model-option${active ? " active" : ""}" data-profile="${escapeHtml(p.id)}"${active ? ' aria-current="true"' : ""} title="${escapeHtml(p.model)}"><strong><span class="model-dot"></span><span class="model-option-name">${escapeHtml(p.name)}</span></strong></button>`;
        })
        .join("")}</div>`
    : `<button class="model-option" id="configureFirst"><strong>${t(`接入模型`)}</strong></button>`;
  const c = currentConversation(),
    profile = activeProfile(),
    level = (c ? c.reasoning : profile?.reasoning) || "",
    choices = reasoningChoices(profile),
    // 选过的档位这个模型不认（换了模型、或刚学到它的档位）：菜单上点亮它实际会落到的那一档
    shown = choices.includes(level) ? level : nearestReasoning(profile, level) || "",
    presets = presetMenuHtml(),
    // 默认不占一行（设计稿/148 乙；落选的甲是一行只一粒朱点，用起来像字丢了）：一档都不点亮，栏上写「默认」（只放朱点难认）；再点选中的那档退回默认
    levels = choices
      .filter(Boolean)
      .map(value => {
        const on = value === shown;
        return `<button type="button" class="model-option${on ? " active" : ""}" data-reasoning="${value}"${on ? ` aria-current="true" title="${t`再点一下退回默认`}"` : ""}><strong><span class="model-dot"></span><span class="model-option-name">${reasoningLabel(value)}</span></strong></button>`;
      })
      .join("");
  if (all.length)
    $("#modelMenu").insertAdjacentHTML(
      "beforeend",
      `<div class="model-flies">${presets ? modelFlyHtml("preset", t(`预设`), escapeHtml(presetOf(c)?.name || t("本色")), presets) : ""}${
        choices.length > 1
          ? modelFlyHtml("reasoning", t(`思考深度`), reasoningLabel(shown), levels)
          : `<div class="menu-section-note">${t(`此模型不认思考档位`)}</div>`
      }</div><button class="model-option model-manage" data-manage>${t(`模型设置`)}</button>`
    );
  paintModelFly();
  $("#configureFirst")?.addEventListener("click", () => openSettings("models"));
  $("#modelMenu [data-manage]")?.addEventListener("click", e => {
    e.stopPropagation();
    closeModelMenu();
    openSettings("models");
  });
}
// 模型菜单：各处的模型签点开同一张菜单，挂到被点的那枚旁边；菜单里选模型、选思考档位、选预设
function bindModelMenuEvents() {
  document.querySelectorAll(".model-trigger").forEach(button => {
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "modelMenu");
    button.setAttribute("aria-expanded", "false");
    button.onclick = e => {
      e.stopPropagation();
      const menu = $("#modelMenu"),
        opening = menu.classList.contains("hidden") || menu.classList.contains("leaving");
      if (menu.parentElement !== button.parentElement) {
        menu.classList.add("hidden");
        menu.classList.remove("leaving", "drop-up");
        button.parentElement.append(menu);
      }
      if (!opening) {
        closeModelMenu();
        return;
      }
      renderModelMenu();
      showNow(menu);
      button.setAttribute("aria-expanded", "true");
      positionModelMenu(button);
    };
  });
  document.addEventListener("click", closeModelMenu);
  window.addEventListener("resize", () => {
    const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
    if (trigger) positionModelMenu(trigger);
  });
  $("#modelMenu").addEventListener("mouseover", e => {
    const row = e.target.closest("[data-fly]");
    if (row) return flyModelMenu(row.dataset.fly, modelFly ? MODEL_FLY_SWITCH : 0);
    if (e.target.closest(".model-sub")) return clearTimeout(modelFlyTimer);
    if (e.target.closest(".model-option")) flyModelMenu("", MODEL_FLY_SWITCH);
  });
  $("#modelMenu").addEventListener("mouseleave", () => flyModelMenu("", MODEL_FLY_CLOSE));
  // 键盘：→ 开，← 收回到栏上；Tab 顺着往下走到浮列
  $("#modelMenu").addEventListener("keydown", e => {
    const row = e.target.closest("[data-fly]"),
      inside = e.target.closest(".model-sub");
    if (row && e.key === "ArrowRight") {
      flyModelMenu(row.dataset.fly);
      row.nextElementSibling.querySelector(".active, button")?.focus();
    } else if (inside && e.key === "ArrowLeft") {
      flyModelMenu("");
      inside.previousElementSibling.focus();
    }
  });
  $("#modelMenu").addEventListener("click", e => {
    const fly = e.target.closest("[data-fly]");
    if (fly) {
      e.stopPropagation();
      const same = modelFly === fly.dataset.fly;
      // 鼠标指上已开，点一下不该收；触屏才是点开点合
      if (!(same && e.pointerType === "touch")) flyModelMenu(fly.dataset.fly);
      else flyModelMenu("");
      return;
    }
    const level = e.target.closest("[data-reasoning]");
    if (level) {
      e.stopPropagation();
      const c = currentConversation();
      const profile = activeProfile();
      if (!profile) return;
      profile.reasoning = level.classList.contains("active") ? "" : normalizeReasoning(level.dataset.reasoning);
      if (c) c.reasoning = profile.reasoning;
      saveStore();
      renderModelMenu();
      renderModelTriggers();
      const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
      if (trigger) positionModelMenu(trigger);
      paintModelFly();
      return;
    }
    const preset = e.target.closest("[data-preset]");
    if (preset) return selectPreset(preset.dataset.preset);
    const item = e.target.closest("[data-profile]");
    if (!item) return;
    selectProfile(item.dataset.profile);
    // 这个模型还没探过认哪几档：探一下，发送键旁的标签与菜单跟着换（探不成就按通用四档，撞了错再学）
    const picked = activeProfile();
    if (picked && !reasoningProbed(picked))
      void probeReasoningLevels(picked).then(levels => {
        if (levels === null || activeProfile() !== picked) return;
        renderModelTriggers();
        if ($("#modelMenu")?.classList.contains("hidden") === false) renderModelMenu();
      });
  });
}
defineLayer({
  name: "model-menu",
  rank: 85,
  open: () => isShown("#modelMenu") && !$("#modelMenu").classList.contains("leaving"),
  close: closeModelMenu
});
