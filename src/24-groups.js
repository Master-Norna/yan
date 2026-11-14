// 言 · 分组：自立的几组，像 Claude 的 project——相关的对话聚在一处，不至散落。
// 侧栏有两处：历史里与「工」组一样按时间排（印文是「集」，组首「＋」在此组另起一段、「⋯」改名 / 设置 / 解散；对话拖到组上即移入、拖到组外即移出），
// 以及「翻页」「卷宗」之下的「分组」入口——进去是分组页（与卷宗同一本簿，一组一条）：点开一组可改名、择预设、定默认目录、看组里的对话（可移出）、解散。
// 组能带的两样都只管新起的对话：预设（提示词、工具、模型、权限一并换上）与默认目录（绑上即为行）。
// 组里的对话置顶，只在组内排到最前，不跳出组去。
// 「工」组是同一套画法的另一头：它由对话的 workdir 派生，不另存实体，组首「⋯」只有改名（只改侧栏显示，不动真实目录）与删除（整组对话一并移除）
/** @type {string|null} 侧栏里正在改名的那一段：键同 collapsedRepos——「集」组是 group:组 id，目录组是目录 */
let renamingSection = null;
/** @type {string|null} 分组页上点开的那一组；空即列表 */
let groupPageId = null;

/** @returns {{ id: string, name: string, createdAt: string, presetId: string, workdir: string }[]} */
function groupsList() {
  return store.settings.groups;
}
/** @param {Conversation|null} c */
function groupOf(c) {
  return (c?.groupId && groupsList().find(group => group.id === c.groupId)) || null;
}
function pendingGroup() {
  return groupsList().find(group => group.id === store.settings.pendingGroupId) || null;
}
function groupMembers(id) {
  return store.conversations
    .filter(c => c.groupId === id)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}
function createGroup(name = t("新分组")) {
  const group = { id: uid(), name, createdAt: now(), presetId: "", workdir: "" };
  groupsList().push(group);
  saveStore();
  return group;
}
/** @param {Conversation} c @param {string} groupId 空即移出 */
function moveToGroup(c, groupId) {
  c.groupId = groupId;
  markDirty(c.id);
  saveStore();
  renderHistory();
  renderGroupTags();
  if (view === "groups") renderGroupsPage();
}
// 在此组另起一段：新对话归进这一组；组带了预设的就用组的预设（预设带模型的连模型一起，见 activeProfile）
function newChatInGroup(id) {
  store.settings.pendingGroupId = id;
  saveStore();
  newChat();
}
function startGroupRename(id) {
  startSectionRename(`group:${id}`);
}
/** @param {string} key 侧栏里那一段的键：group:组 id，或目录 */
function startSectionRename(key) {
  renamingSection = key;
  renderHistory();
  const input = /** @type {HTMLInputElement|null} */ ($("#history .group-rename"));
  input?.focus();
  input?.select();
}
function renameGroup(id, value) {
  const group = groupsList().find(item => item.id === id),
    name = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  if (!group || !name || name === group.name) return;
  group.name = name;
  saveStore();
  renderGroupTags();
}
// 目录组的名字：自起的名字优先，没起过就用目录末段。只改侧栏显示的字，真实路径不动（悬停仍是完整目录）
/** @param {string} dir */
function workdirBase(dir) {
  return dir.split(/[\\/]/).filter(Boolean).pop() || dir || t("未定目录");
}
/** @param {string} dir */
function workdirTitle(dir) {
  return (store.settings.workdirNames || {})[dir] || workdirBase(dir);
}
/** @param {string} dir @param {string} value 空、或与目录末段同名，即回到用目录名 */
function renameWorkdir(dir, value) {
  const base = workdirBase(dir),
    name = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40),
    names = (store.settings.workdirNames ||= {});
  if (!name || name === base) {
    if (!(dir in names)) return;
    delete names[dir];
  } else {
    if (names[dir] === name) return;
    names[dir] = name;
  }
  saveStore();
}
function commitSectionRename(value) {
  const key = renamingSection;
  renamingSection = null;
  if (!key) return renderHistory();
  if (key.startsWith("group:")) renameGroup(key.slice(6), value);
  else renameWorkdir(key, value);
  renderHistory();
}
async function dissolveGroup(id) {
  const group = groupsList().find(item => item.id === id);
  if (!group) return;
  const members = groupMembers(id);
  if (
    !(await askConfirm({
      title: t`解散分组「${group.name}」？`,
      body: members.length ? t`组里的 ${members.length} 段对话退回散列，不会删除。` : t("此组尚无对话。"),
      ok: t("解散")
    }))
  )
    return;
  store.settings.groups = groupsList().filter(item => item !== group);
  for (const c of members) {
    c.groupId = "";
    markDirty(c.id);
  }
  if (store.settings.pendingGroupId === id) delete store.settings.pendingGroupId;
  if (groupPageId === id) groupPageId = null;
  saveStore();
  renderHistory();
  renderGroupTags();
  if (view === "groups") renderGroupsPage();
}
// 组首「⋯」：改名、打开组的设置（分组页里这一组）、解散；在此组新建已有「＋」，不再列
/** @param {string} id @param {Element} anchor */
function openGroupMenu(id, anchor) {
  openMenu(
    anchor,
    [
      { id: "rename", label: t("改名"), run: () => startGroupRename(id) },
      { id: "settings", label: t("设置"), run: () => openGroupsPage(id) },
      { id: "dissolve", label: t("解散"), danger: true, run: () => void dissolveGroup(id) }
    ],
    { kind: "group", key: id }
  );
}
// 「工」组首「⋯」：改名（只改侧栏显示，不动真实目录）、删除（整组对话一并移除，目录里的文件不动）。
// 「设置」「在此目录新建」不重复进菜单：前者是「集」组独有的配置，后者组首已有「＋」
/** @param {string} dir @param {Element} anchor */
function openRepoMenu(dir, anchor) {
  openMenu(
    anchor,
    [
      { id: "rename", label: t("改名"), run: () => startSectionRename(dir) },
      { id: "delete", label: t("删除"), danger: true, run: () => void removeWorkdirGroup(dir) }
    ],
    { kind: "group", key: dir }
  );
}
// 删除一整组：组里的对话连同附件一并移除（目录里的文件一个不碰）。别的页面正写着的那几段跳过，不硬删。
// 「组里」照侧栏的归组口径算：置顶的单列、归进「集」组的在那一组里，都绑着这个目录也不属于这一组（见 renderHistory 的分法）
/** @param {string} dir */
async function removeWorkdirGroup(dir) {
  const members = store.conversations.filter(c => !c.pinned && !groupOf(c) && isWork(c) && c.workdir === dir),
    busy = members.filter(c => runningElsewhere(c.id)),
    targets = members.filter(c => !busy.includes(c)),
    outside = store.conversations.filter(c => (c.pinned || groupOf(c)) && isWork(c) && c.workdir === dir).length,
    name = workdirTitle(dir);
  if (!targets.length) return toast(busy.length ? t("此组正在另一页面作答，暂不能删除") : t("这一组已没有对话"));
  const notes = [
    t`组里的 ${targets.length} 段对话将连同附件一并移除，目录里的文件不动，无法撤销。`,
    busy.length ? t`另有 ${busy.length} 段正在另一页面作答，这回不动。` : "",
    outside ? t`另有 ${outside} 段置顶或已归入分组的对话，不在此组，也不动。` : ""
  ].filter(Boolean);
  if (!(await askConfirm({ title: t`删除「${name}」这一组？`, body: notes.join("\n"), ok: t("删除") }))) return;
  for (const c of targets) purgeConversation(c);
  // 组散尽了，自起的名字也就没处可挂；还有对话绑着就留着
  if (!store.conversations.some(c => isWork(c) && c.workdir === dir)) delete (store.settings.workdirNames || {})[dir];
  saveStore();
  render();
  toast(t`已删除 ${targets.length} 段对话`);
}
// 对话「⋯」里的「移入分组」：列出各组，另有新建一组与移出
/** @param {Conversation} c @param {Element} anchor */
function openMoveMenu(c, anchor) {
  const current = groupOf(c);
  openMenu(
    anchor,
    [
      ...groupsList().map(group => ({
        id: group.id,
        label: group.name,
        active: group === current,
        disabled: group === current,
        run: () => moveToGroup(c, group.id)
      })),
      {
        id: "new",
        label: t("新建分组…"),
        run: () => {
          const group = createGroup();
          moveToGroup(c, group.id);
          startGroupRename(group.id);
        }
      },
      current && { id: "out", label: t`移出「${current.name}」`, run: () => moveToGroup(c, "") }
    ],
    { kind: "group-move" }
  );
}

// ---------- 输入框左下「＋」旁的分组签：欢迎页是待归的那一组（可撤），对话页是这段对话所在的组（点开分组页） ----------
function renderGroupTags() {
  const pending = pendingGroup(),
    own = groupOf(currentConversation());
  for (const [tag, group] of [
    [$("#welcomeGroup"), pending],
    [$("#chatGroup"), own]
  ]) {
    tag.classList.toggle("hidden", !group);
    tag.querySelector(".group-tag-name").textContent = group?.name || "";
  }
}

// ---------- 分组页 ----------
function openGroupsPage(id = null) {
  closeSidePanel();
  persistDraft();
  rememberScrollPosition();
  groupPageId = id;
  view = "groups";
  render();
  if (isMobile()) toggleSidebar(true);
}
function closeGroupsPage() {
  view = "chat";
  render();
}
function renderGroupsCount() {
  $("#groupsCount").textContent = groupsList().length ? String(groupsList().length) : "";
}
function renderGroupsPage() {
  renderGroupsCount();
  const group = groupsList().find(item => item.id === groupPageId);
  $("#groups").innerHTML = `<div class="library-inner">${group ? groupDetailHtml(group) : groupListHtml()}</div>`;
}
const lastTouched = members => members.reduce((latest, c) => (c.updatedAt > latest ? c.updatedAt : latest), "");
// 列表与卷宗同一本簿：一组一条，行首一只小函；列是 组名 · 段 · 预设 · 目录 · 日期（最近一段对话动笔的日子）
function groupListHtml() {
  const groups = [...groupsList()].sort((a, b) =>
      (lastTouched(groupMembers(b.id)) || b.createdAt).localeCompare(lastTouched(groupMembers(a.id)) || a.createdAt)
    ),
    chats = store.conversations.filter(c => groups.some(group => group.id === c.groupId)).length;
  return `<div class="page-head">${brushIcon("groups")}<h1>${t(`分组`)}</h1><span class="page-facts">${groups.length ? t`${groups.length} 组 · ${chats} 段对话` : ""}</span><div class="page-acts"><button id="groupsAdd" type="button">${t(`新建分组`)}</button></div></div><div class="page-sub"></div>${
    groups.length
      ? `<div class="strips group-strips"><div class="strip-cols"><span></span><span>${t(`组名`)}</span><span>${t(`段`)}</span><span>${t(`预设`)}</span><span>${t(`目录`)}</span><span>${t(`日期`)}</span></div>${groups
          .map(group => {
            const members = groupMembers(group.id),
              preset = store.settings.presets.find(item => item.id === group.presetId),
              touched = lastTouched(members) || group.createdAt;
            return `<button type="button" class="strip dir" data-group-page="${escapeHtml(group.id)}"><span>${caseFigure()}</span><span class="strip-name"><strong>${escapeHtml(group.name)}</strong></span><span>${members.length}</span><span><span class="ell">${escapeHtml(preset?.name || "—")}</span></span><span title="${escapeHtml(group.workdir)}"><span class="ell">${escapeHtml(group.workdir || "—")}</span></span><span>${escapeHtml(formatDay(touched))}</span></button>`;
          })
          .join("")}</div>`
      : `<div class="library-empty">${t(`尚无分组`)}</div>`
  }`;
}
// 一组：页头即组名（就地可改），右边「在此组新建 · 解散」；下是两行设置与组里的对话，簿头的 ‹ 回列表
/** @param {ReturnType<typeof groupsList>[number]} group */
function groupDetailHtml(group) {
  const members = groupMembers(group.id),
    presets = store.settings.presets;
  return `<div class="page-head">${brushIcon("groups")}<input id="groupName" class="group-name-field" value="${escapeHtml(group.name)}" maxlength="40" spellcheck="false" aria-label="${t(`组名`)}"><span class="page-facts">${members.length ? t`${members.length} 段对话` : t("尚无对话")}</span><div class="page-acts"><button id="groupNewChat" type="button">${t(`在此组新建`)}</button><button id="groupDissolve" class="danger" type="button">${t(`解散`)}</button></div></div><div class="page-sub"><div class="library-crumbs"><button type="button" data-group-page="">${t(`分组`)}</button><span class="sep" aria-hidden="true">›</span><span class="here">${escapeHtml(group.name)}</span></div></div><div class="group-settings"><div class="setting-row"><div class="setting-copy"><strong>${t(`预设`)}</strong><small>${presets.length ? "" : t("尚无预设")}</small></div><select id="groupPreset" class="field select"><option value="">${t(`本色（不带预设）`)}</option>${presets
    .map(
      preset =>
        `<option value="${escapeHtml(preset.id)}"${preset.id === group.presetId ? " selected" : ""}>${escapeHtml(preset.name)}</option>`
    )
    .join(
      ""
    )}</select></div><div class="setting-row"><div class="setting-copy"><strong>${t(`默认目录`)}</strong></div><div class="setting-actions setting-directory"><input id="groupWorkdir" class="field" spellcheck="false" autocomplete="off" placeholder="${t(`不绑目录`)}" value="${escapeHtml(group.workdir)}"><button id="groupWorkdirPick" class="outline-btn" type="button">${t(`选择…`)}</button></div></div></div><div class="strips group-members"><div class="strip-cols"><span><button type="button" class="strip-back" data-group-page="" title="${t(`回分组`)}" aria-label="${t(`回分组`)}">‹</button></span><span>${t(`组里的对话`)}</span><span>${t(`日期`)}</span></div>${members
    .map(
      c =>
        `<div class="strip" role="button" tabindex="0" data-group-chat="${escapeHtml(c.id)}"><span>${fileFigure(t("对话.md"))}</span><span class="strip-name"><strong>${escapeHtml(c.title)}</strong></span><span class="strip-date"><span class="strip-when">${escapeHtml(formatDay(c.updatedAt))}</span><span class="strip-acts"><button type="button" data-group-out="${escapeHtml(c.id)}" title="${t(`移出此组，退回散列`)}">${t(`移出`)}</button></span></span>${c.pinned ? `<i class="group-pin" title="${t(`组内置顶`)}" aria-label="${t(`组内置顶`)}"></i>` : ""}</div>`
    )
    .join("")}</div>`;
}
// 分组页上的点击与改动：一个委托，页面每画一回都还在
$("#groups").addEventListener("click", async event => {
  const target = /** @type {HTMLElement} */ (event.target);
  const page = target.closest("[data-group-page]");
  if (page) {
    groupPageId = page.dataset.groupPage || null;
    renderGroupsPage();
    return void ($("#groups").scrollTop = 0);
  }
  const out = target.closest("[data-group-out]");
  if (out) {
    const c = store.conversations.find(item => item.id === out.dataset.groupOut);
    return void (c && moveToGroup(c, ""));
  }
  const chat = target.closest("[data-group-chat]");
  if (chat) return openConversation(chat.dataset.groupChat);
  if (target.closest("#groupsAdd")) {
    const group = createGroup();
    groupPageId = group.id;
    renderHistory();
    renderGroupsPage();
    return /** @type {HTMLInputElement} */ ($("#groupName")).select();
  }
  if (target.closest("#groupNewChat")) return newChatInGroup(groupPageId);
  if (target.closest("#groupDissolve")) return dissolveGroup(groupPageId);
  const pick = /** @type {HTMLButtonElement|null} */ (target.closest("#groupWorkdirPick"));
  if (pick) {
    pick.disabled = true;
    pick.textContent = t("择取中…");
    try {
      const input = /** @type {HTMLInputElement} */ ($("#groupWorkdir"));
      const data = await bridge("/api/work/pick", { current: input.value.trim() });
      if (data.paths[0]) {
        input.value = data.paths[0];
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      pick.disabled = false;
      pick.textContent = t("择目录…");
    }
  }
});
$("#groups").addEventListener("change", event => {
  const el = /** @type {HTMLInputElement} */ (event.target),
    group = groupsList().find(item => item.id === groupPageId);
  if (!group) return;
  if (el.id === "groupName") {
    renameGroup(group.id, el.value);
    return renderHistory();
  }
  if (el.id === "groupPreset") group.presetId = el.value;
  if (el.id === "groupWorkdir") group.workdir = el.value.trim();
  saveStore();
  renderGroupsPage();
});
$("#groups").addEventListener("keydown", event => {
  const target = /** @type {HTMLElement} */ (event.target);
  if (target.id === "groupName" && event.key === "Enter") return /** @type {HTMLInputElement} */ (target).blur();
  // 组里的对话一条是 div（条尾还放着「移出」按钮）：回车与空格照按钮打开
  if (target.dataset.groupChat && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openConversation(target.dataset.groupChat);
  }
});

// ---------- 侧栏历史里的分组：收起 / 展开、组首「＋」、双击改名、组首「⋯」 ----------
$("#history").addEventListener("click", event => {
  const target = /** @type {HTMLElement} */ (event.target);
  const toggle = target.closest("[data-group-toggle]");
  if (toggle && !target.closest(".group-rename")) {
    const key = `group:${toggle.dataset.groupToggle}`,
      set = new Set(store.settings.collapsedRepos || []);
    set.has(key) ? set.delete(key) : set.add(key);
    store.settings.collapsedRepos = [...set];
    saveStoreSoon();
    const at = `.history-repo-group[data-group="${CSS.escape(toggle.dataset.groupToggle)}"]`;
    return morphHeight(toggle.closest(".history-repo-group"), renderHistory, 300, () => $("#history").querySelector(at));
  }
  const add = target.closest("[data-group-new]");
  if (add) return newChatInGroup(add.dataset.groupNew);
  const more = target.closest("[data-group-menu]");
  if (more) {
    event.stopPropagation();
    return openGroupMenu(more.dataset.groupMenu, more);
  }
  const repoMore = target.closest("[data-repo-menu]");
  if (repoMore) {
    event.stopPropagation();
    openRepoMenu(repoMore.dataset.repoMenu, repoMore);
  }
});
// 拖放：对话拖到一组上（组首或组里任一条）即移入那组，拖到组外即移出；拖着经过的组首提亮。只认侧栏里拖起的对话
const CHAT_DRAG = "application/x-yan-chat";
/** @param {DragEvent} event */
const dropGroupOf = event =>
  /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".history-repo-group.is-set"));
const clearDropMarks = () => document.querySelectorAll("#history .drop-into").forEach(node => node.classList.remove("drop-into"));
$("#history").addEventListener("dragstart", event => {
  const item = /** @type {HTMLElement} */ (event.target).closest?.("[data-conversation][draggable]");
  if (!item) return;
  event.dataTransfer.setData(CHAT_DRAG, item.dataset.conversation);
  event.dataTransfer.effectAllowed = "move";
  item.classList.add("dragging");
});
$("#history").addEventListener("dragover", event => {
  if (!Array.from(event.dataTransfer?.types || []).includes(CHAT_DRAG)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  const group = dropGroupOf(event);
  if (group?.classList.contains("drop-into")) return;
  clearDropMarks();
  group?.classList.add("drop-into");
});
$("#history").addEventListener("dragleave", event => {
  if (!$("#history").contains(/** @type {Node|null} */ (event.relatedTarget))) clearDropMarks();
});
$("#history").addEventListener("drop", event => {
  const id = event.dataTransfer?.getData(CHAT_DRAG);
  if (!id) return;
  event.preventDefault();
  clearDropMarks();
  const c = store.conversations.find(item => item.id === id),
    target = dropGroupOf(event)?.dataset.group || "";
  if (!c || (c.groupId || "") === target) return;
  moveToGroup(c, target);
  toast(target ? t`移入「${groupsList().find(group => group.id === target)?.name}」` : t("已移出分组"));
});
$("#history").addEventListener("dragend", () => {
  clearDropMarks();
  document.querySelectorAll("#history .dragging").forEach(node => node.classList.remove("dragging"));
});
$("#history").addEventListener("dblclick", event => {
  const target = /** @type {HTMLElement} */ (event.target),
    set = target.closest("[data-group-toggle]"),
    repo = set ? null : target.closest("[data-repo-toggle]");
  if (!set && !repo) return;
  if (renamingSection) return;
  startSectionRename(set ? `group:${set.dataset.groupToggle}` : repo.dataset.repoToggle);
});
$("#history").addEventListener("keydown", event => {
  const input = /** @type {HTMLInputElement} */ (event.target);
  // 组首是 div（改名时里面要放输入框，按钮里放不得）：「集」「工」两处都靠这一句，回车与空格照按钮开合
  if (
    (input.dataset?.groupToggle !== undefined || input.dataset?.repoToggle !== undefined) &&
    (event.key === "Enter" || event.key === " ")
  ) {
    event.preventDefault();
    return input.click();
  }
  if (!input.classList?.contains("group-rename")) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commitSectionRename(input.value);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    renamingSection = null;
    renderHistory();
  }
});
$("#history").addEventListener(
  "blur",
  event => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    // 侧栏重画时旧输入框被移走也会失焦：那不是改完了（重画已把敲的字接到新框里）
    if (input.classList?.contains("group-rename") && renamingSection && !renderingHistory) commitSectionRename(input.value);
  },
  true
);
