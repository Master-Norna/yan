// 言 · 目录签与附件签：欢迎页输入框上方的小签、附件菜单与卷宗选件、目录弹层与中途绑定
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 欢迎页输入框上方的一行小签：目录签（空着是言、落在卷宗；填了是行）、新对话的三档指令权限
function pathTail(dir) {
  const parts = String(dir || "")
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts.at(-1) || dir;
}
function renderChips(work) {
  const dirChip = $("#workdirChip"),
    pending = (store.settings.pendingWorkdir || "").trim() || pendingGroup()?.workdir || "";
  dirChip.classList.remove("hidden");
  dirChip.querySelector(".chip-text").textContent = pending ? pathTail(pending) : t("卷宗");
  dirChip.title = pending ? t`${pending}\n行：指令与改动落在此目录` : t`言：产出收入卷宗（${archiveDir()}）`;
  dirChip.classList.toggle("on", !!pending);
  const approve = $("#approveChip");
  const policy = normalizeCommandPolicy(store.settings.commandPolicyDefault),
    meta = COMMAND_POLICY_META[policy];
  approve.classList.remove("hidden");
  approve.querySelector(".chip-text").textContent = meta[0];
  approve.classList.toggle("on", policy !== "ask");
  approve.title = t`${meta[0]}：${meta[1]}（新对话默认）`;
  renderGroupTags();
}
// 附件签「＋」：展开后二选一——外件（本机文件）或卷宗（已收入的文件，点选即置于案上，在这张菜单里接着选）
function openAttachMenu(anchor) {
  const total = libraryTotal(),
    skills = skillList().filter(skill => !skill.hidden).length;
  openMenu(
    anchor,
    [
      { id: "file", label: t("外件"), note: t("本机文件"), run: () => $("#fileInput").click() },
      {
        id: "archive",
        label: t("卷宗"),
        note: total ? t`${total} 件` : t("尚空"),
        keep: true,
        run: (button, pop) => (total ? renderArchivePicker(pop, anchor) : toast(t("卷宗尚空")))
      },
      {
        id: "skill",
        label: t("Skill"),
        note: skills ? t`${skills} 份` : t("尚空"),
        keep: true,
        run: (button, pop) => (skills ? renderSkillPicker(pop, anchor) : toast(t("尚无 Skill，可在设置 → Skill 里写一份")))
      }
    ],
    { align: "left", kind: "attach" }
  );
  // 刚放进技能目录的：下回点开就列得出
  void refreshSkills();
}
// 选件的清单换了内容、宽高随之变：重新贴一次锚点（已向上翻的仍在上边，底边贴住锚点；菜单换成更宽的清单，也收回视口里）
/** @param {HTMLElement} pop @param {Element} anchor */
function settlePickerPop(pop, anchor) {
  placeFloating(pop, anchor.getBoundingClientRect(), {
    side: pop.classList.contains("drop-up") ? "above" : "below",
    align: /** @type {"left"|"right"} */ (pop.dataset.align || "left")
  });
}
// 卷宗选件：与卷宗页一样逐层看——先列这一层的夹、再列件，点夹即进、顶上一行「‹」回上一层，点一件即置于案上；
// 一旦查找，就跨各层平铺，件旁注上它所在的夹，查找也认夹名
function renderArchivePicker(pop, anchor) {
  const files = archiveEntries || [];
  let at = "";
  pop.classList.add("attach-picker");
  pop.innerHTML = `<input class="field" placeholder="${t(`按文件名查找`)}" aria-label="${t(`查找卷宗`)}"><div class="chip-pop-list"></div>`;
  const input = pop.querySelector("input"),
    list = pop.querySelector(".chip-pop-list");
  const fileHtml = (file, flat) => {
    const dir = parentDir(file.path);
    return `<button type="button" data-pick="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}"><span>${escapeHtml(file.name)}</span><small>${flat && dir ? `${escapeHtml(dir)} · ` : ""}${formatFileSize(file.size)}</small></button>`;
  };
  const folderHtml = dir => {
    const count = files.filter(file => file.path.startsWith(`${dir.path}/`)).length;
    return `<button type="button" class="picker-dir" data-dir="${escapeHtml(dir.path)}" title="${t`打开 ${escapeHtml(dir.path)}`}"><span>${escapeHtml(dir.name)}<i aria-hidden="true">›</i></span><small>${count ? t`${count} 件` : t("空")}</small></button>`;
  };
  const paint = () => {
    const query = input.value.trim().toLowerCase();
    let html;
    if (query) {
      const shown = files.filter(file => file.path.toLowerCase().includes(query));
      html = shown.length ? shown.map(file => fileHtml(file, true)).join("") : `<div class="chip-pop-label">${t(`没有匹配的卷宗`)}</div>`;
    } else {
      const folders = archiveDirs.filter(dir => parentDir(dir.path) === at).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
        here = files.filter(file => parentDir(file.path) === at),
        up = at
          ? `<button type="button" class="picker-up" data-dir="${escapeHtml(parentDir(at))}" title="${t(`回上一层`)}"><span>‹ ${escapeHtml([t("卷宗"), ...at.split("/")].join(" › "))}</span></button>`
          : "";
      html = `${up}${folders.map(folderHtml).join("")}${here.map(file => fileHtml(file, false)).join("")}${folders.length || here.length ? "" : `<div class="chip-pop-label">${t(`此夹尚空`)}</div>`}`;
    }
    list.innerHTML = html;
    list.scrollTop = 0;
    // 清单的高随层而变：每画一回重新贴一次锚点
    settlePickerPop(pop, anchor);
  };
  paint();
  input.addEventListener("input", paint);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      list.querySelector("[data-pick]")?.click();
    }
  });
  list.addEventListener("click", event => {
    const dir = event.target.closest("[data-dir]");
    if (dir) {
      at = dir.dataset.dir;
      paint();
      return input.focus();
    }
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    closeChipPop();
    void placeFromArchive(button.dataset.pick);
  });
  setTimeout(() => input.focus(), 0);
}
// 目录签的弹层，欢迎页与对话页共用：输入 / 选择；不列「最近」——删掉的目录会留在那儿、点了又能把它绑回来，每次自己选。
// live 时每敲一字都落值（欢迎页记到待绑目录），否则回车、点选才落值（对话页要经桥接绑定）
// floating：不挂在 host 里而是浮在锚点旁（侧栏历史条目的「绑定目录」用），其余一样
function openWorkdirPop({ anchor, host, value, live, bound, onCommit, floating = false }) {
  if ((floating ? document : host).querySelector(".chip-pop[data-kind=workdir]")) return closeChipPop();
  const html = `<div class="chip-pop-row"><input id="workdirInput" class="field" spellcheck="false" autocomplete="off" placeholder="${live ? t("留空则为言") : t("输入或选择目录")}" value="${escapeHtml(value || "")}"><button id="workdirPick" class="outline-btn" type="button">${t(`选择…`)}</button>${live ? "" : `<button id="workdirCommit" class="outline-btn" type="button">${bound ? t("更换") : t("绑定")}</button>`}</div>${bound ? `<button type="button" class="chip-pop-unbind" data-unbind>${t(`解开目录，回到言`)}</button>` : live ? `<button type="button" class="chip-pop-unbind${value ? "" : " hidden"}" data-unbind>${t(`不绑目录，回到言`)}</button>` : ""}`;
  const pop = floating ? openFloatingPop(anchor, html, { align: "right", menu: false }) : openChipPop(anchor, host, html);
  pop.dataset.kind = "workdir";
  const input = pop.querySelector("#workdirInput"),
    commit = (dir, close = false) => {
      onCommit(dir.trim());
      if (close) closeChipPop();
      else if (live) pop.querySelector("[data-unbind]")?.classList.toggle("hidden", !dir.trim());
    };
  if (live) input.addEventListener("input", () => commit(input.value));
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (live) {
      closeChipPop();
      $("#welcomeInput").focus();
    } else commit(input.value, true);
  });
  pop.querySelector("#workdirCommit")?.addEventListener("click", () => commit(input.value, true));
  pop.querySelector("[data-unbind]")?.addEventListener("click", () => commit("", true));
  // 「选择…」：由桥接弹出本机的文件夹对话框，选好回填
  pop.querySelector("#workdirPick").onclick = async () => {
    const button = pop.querySelector("#workdirPick");
    button.disabled = true;
    button.textContent = t("择取中…");
    try {
      const data = await bridge("/api/work/pick", { current: input.value.trim() });
      if (data.paths[0]) {
        input.value = data.paths[0];
        commit(data.paths[0], !live);
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      button.disabled = false;
      button.textContent = t("择目录…");
    }
  };
  setTimeout(() => input.focus(), 0);
}
// 这段正作答（连同开工前的准备、后台的帮手、别的页面在答）：目录不许换——写了一半的文件、读过的记录、帮手手上的活都落在旧目录，
// 中途一换，余下的照新目录写，前后对不上。正退回目录的也算
/** @param {Conversation} c */
function workdirLocked(c) {
  return (
    conversationRunning(c.id) || crewRunning(c.id) || runningElsewhere(c.id) || rewinding.has(c.id) || (sendPreparing && c.id === currentId)
  );
}
// 对话中途绑上 / 解开目录：只是给对话记一个目录，下一问起工具与提示词随之而变，历史一字不丢
/** @param {Conversation} c */
async function bindWorkdir(c, dir) {
  // 目录弹层可能在开答之前打开、开答之后才点定：落值时再看一回
  if (workdirLocked(c)) return toast(t("作答中，稍后再改"));
  dir = String(dir || "").trim();
  if (!dir) {
    if (!isWork(c)) return;
    c.workdir = "";
    markDirty(c.id);
    saveStore();
    render();
    toast(t("已解开目录，回到言"));
    return;
  }
  if (activeProfile()?.tools === false) return toast(t("当前模型已关闭本机工具，请在模型高级配置中开启"));
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: dir }, AbortSignal.timeout(8000));
    if (prepared.workdir === c.workdir) return;
    if (workdirLocked(c)) return toast(t("作答中，稍后再改"));
    c.workdir = prepared.workdir;
    c.commandPolicy = commandPolicyOf(c);
    markDirty(c.id);
    saveStore();
    render();
    toast(t`已绑定 ${pathTail(prepared.workdir)}${prepared.created ? t("（新建）") : ""}，此后为行`);
  } catch (error) {
    toast(t`工作目录不可用：${String(error.message || error)}`);
  }
}
function setupChips() {
  const chips = $("#welcomeChips");
  chips.addEventListener("click", event => event.stopPropagation());
  document.addEventListener("click", closeChipPop);
  $("#workdirChip").onclick = () =>
    openWorkdirPop({
      anchor: $("#workdirChip"),
      host: chips,
      value: store.settings.pendingWorkdir || "",
      live: true,
      bound: false,
      onCommit: dir => {
        if (dir) store.settings.pendingWorkdir = dir;
        else delete store.settings.pendingWorkdir;
        saveStoreSoon();
        renderHeader();
        renderHistory();
      }
    });
  $("#welcomeGroup").onclick = () => {
    delete store.settings.pendingGroupId;
    saveStore();
    renderChips(workMode());
    renderHeader();
  };
  $("#chatGroup").onclick = () => openGroupsPage(groupOf(currentConversation())?.id || null);
  $("#approveChip").onclick = () => {
    store.settings.commandPolicyDefault = nextCommandPolicy(store.settings.commandPolicyDefault);
    saveStore();
    renderChips(workMode());
  };
}
