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
  renderGroupTags();
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
  $("#welcomeMode").textContent = workMode() ? "执事" : "对谈";
  $("#displayNameSidebar").textContent = store.settings.name;
  $("#avatar").textContent = store.settings.name.trim().slice(0, 1) || "客";
  const dark = document.documentElement.dataset.theme === "dark",
    toggle = $("#themeToggle");
  toggle.dataset.theme = dark ? "dark" : "light";
  toggle.title = dark ? "天光 · 亮色" : "落墨 · 暗色";
  $("#greeting").textContent = greeting();
  renderModeSwitch();
  renderWelcome();
  renderQuota();
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
  status.querySelector(".quota-label").textContent = p && cap === null ? "耗墨" : "余墨";
  $("#quotaText").textContent = !p ? "" : quotaAmount(cap === null ? used : remaining);
  $("#quotaNote").textContent = !p ? "尚未接入模型" : cap === null ? "不设上限" : `上限 ${quotaAmount(cap)}`;
  status.classList.toggle("dry", !!cap && remaining === 0);
  status.classList.toggle("empty", !p);
  status.setAttribute(
    "aria-label",
    !p ? "尚未接入模型" : cap === null ? `不限用量，已耗 ${formatTokens(used)}` : `余墨 ${formatTokens(remaining)} / ${formatTokens(cap)}`
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
    button.querySelector(".model-name").textContent = p?.name || "尚未接入模型";
    button.querySelector(".model-extra").textContent = [preset?.name, used ? `思考 ${reasoningLabel(used)}` : ""]
      .filter(Boolean)
      .map(text => `· ${text}`)
      .join(" ");
  });
}
function closeModelMenu() {
  const menu = $("#modelMenu");
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
  const dropUp = below < Math.min(menu.scrollHeight, 220) && above > below;
  menu.classList.toggle("drop-up", dropUp);
  menu.style.maxHeight = `${Math.max(96, Math.min(dropUp ? above : below, 420))}px`;
}
function renderModelMenu() {
  const all = profiles();
  $("#modelMenu").innerHTML = all.length
    ? all
        .map(p => {
          const active = p.id === activeProfile()?.id;
          // 只列显示名：模型原名与接口地址长短不一，行高参差；要看去模型设置
          return `<button class="model-option${active ? " active" : ""}" data-profile="${escapeHtml(p.id)}"${active ? ' aria-current="true"' : ""} title="${escapeHtml(p.model)}"><strong><span class="model-dot"></span><span class="model-option-name">${escapeHtml(p.name)}</span></strong></button>`;
        })
        .join("")
    : `<button class="model-option" id="configureFirst"><strong>接入模型</strong></button>`;
  const c = currentConversation(),
    profile = activeProfile(),
    level = (c ? c.reasoning : profile?.reasoning) || "",
    choices = reasoningChoices(profile),
    // 选过的档位这个模型不认（换了模型、或刚学到它的档位）：菜单上点亮它实际会落到的那一档
    shown = choices.includes(level) ? level : nearestReasoning(profile, level) || "";
  if (all.length)
    $("#modelMenu").insertAdjacentHTML(
      "beforeend",
      `${presetMenuHtml()}<div class="menu-section"><div class="menu-section-title"><span>思考深度</span><span>当前模型</span></div>${choices.length > 1 ? `<div class="segmented">${choices.map(value => `<button type="button" data-reasoning="${value}" class="${value === shown ? "active" : ""}">${reasoningLabel(value)}</button>`).join("")}</div>` : `<div class="menu-section-note">此模型不认思考档位</div>`}</div><button class="model-option model-manage" data-manage>模型设置</button>`
    );
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
  $("#modelMenu").addEventListener("click", e => {
    const level = e.target.closest("[data-reasoning]");
    if (level) {
      e.stopPropagation();
      const c = currentConversation();
      const profile = activeProfile();
      if (!profile) return;
      profile.reasoning = normalizeReasoning(level.dataset.reasoning);
      if (c) c.reasoning = profile.reasoning;
      saveStore();
      renderModelMenu();
      renderModelTriggers();
      const trigger = document.querySelector('.model-trigger[aria-expanded="true"]');
      if (trigger) positionModelMenu(trigger);
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
