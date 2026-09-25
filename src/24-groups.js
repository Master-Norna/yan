// 言 · 分组：自立的几组，像 Claude 的 project——相关的对话聚在一处，不至散落。
// 侧栏有两处：历史里与「工」组一样按时间排（印文是「集」，组首「＋」在此组另起一段、「⋯」改名 / 设置 / 解散；对话拖到组上即移入、拖到组外即移出），
// 以及「翻页」「卷宗」之下的「分组」入口——进去是分组页：列出各组，点开一组可改名、择预设、定默认目录、看组里的对话（可移出）、解散。
// 组能带的两样都只管新起的对话：预设（提示词、工具、模型、权限一并换上）与默认目录（绑上即为行）。
// 组里的对话置顶，只在组内排到最前，不跳出组去
/** @type {string|null} 侧栏里正在改名的那一组 */
let renamingGroupId = null;
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
function createGroup(name = "新分组") {
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
// 在此组另起一段：新对话归进这一组；组带了预设的，模型菜单先换上（预设带模型的连模型一起）
function newChatInGroup(id) {
  store.settings.pendingGroupId = id;
  const preset = presetOf(null);
  if (preset?.profileId && profiles().some(p => p.id === preset.profileId)) selectProfile(preset.profileId, false);
  saveStore();
  newChat();
}
function startGroupRename(id) {
  renamingGroupId = id;
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
function commitGroupRename(value) {
  const id = renamingGroupId;
  renamingGroupId = null;
  renameGroup(id, value);
  renderHistory();
}
async function dissolveGroup(id) {
  const group = groupsList().find(item => item.id === id);
  if (!group) return;
  const members = groupMembers(id);
  if (
    !(await askConfirm({
      title: `解散分组「${group.name}」？`,
      body: members.length ? `组里的 ${members.length} 段对话退回散列，不会删除。` : "此组尚无对话。",
      ok: "解散"
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
  if (document.querySelector(`.chip-pop[data-kind=group][data-for="${CSS.escape(id)}"]`)) return closeChipPop();
  const pop = openFloatingPop(
    anchor,
    `<button type="button" data-group-act="rename">改名</button><button type="button" data-group-act="settings">设置</button><button type="button" class="danger" data-group-act="dissolve">解散</button>`,
    { align: "right" }
  );
  pop.dataset.kind = "group";
  pop.dataset.for = id;
  pop.addEventListener("click", event => {
    const button = /** @type {HTMLElement} */ (event.target).closest("[data-group-act]");
    if (!button) return;
    closeChipPop();
    const act = button.dataset.groupAct;
    if (act === "rename") startGroupRename(id);
    else if (act === "settings") openGroupsPage(id);
    else void dissolveGroup(id);
  });
}
// 对话「⋯」里的「移入分组」：列出各组，另有新建一组与移出
/** @param {Conversation} c @param {Element} anchor */
function openMoveMenu(c, anchor) {
  const current = groupOf(c);
  const pop = openFloatingPop(
    anchor,
    `${groupsList()
      .map(
        group =>
          `<button type="button" data-move="${escapeHtml(group.id)}"${group === current ? ' class="active" disabled' : ""}>${escapeHtml(group.name)}</button>`
      )
      .join(
        ""
      )}<button type="button" data-move="__new">新建分组…</button>${current ? `<button type="button" data-move="">移出「${escapeHtml(current.name)}」</button>` : ""}`,
    { align: "right" }
  );
  pop.dataset.kind = "group-move";
  pop.addEventListener("click", event => {
    const button = /** @type {HTMLElement} */ (event.target).closest("[data-move]");
    if (!button) return;
    closeChipPop();
    const target = button.dataset.move;
    if (target === "__new") {
      const group = createGroup();
      moveToGroup(c, group.id);
      startGroupRename(group.id);
    } else moveToGroup(c, target);
  });
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
function groupListHtml() {
  const groups = [...groupsList()].sort((a, b) =>
    (lastTouched(groupMembers(b.id)) || b.createdAt).localeCompare(lastTouched(groupMembers(a.id)) || a.createdAt)
  );
  return `<div class="eyebrow"><span class="seal">集</span><span>GROUPS</span></div><h1>分组</h1><p class="library-lead">相关的对话聚为一组，不至散落。组可带一个预设与一个默认目录，组里新起的对话皆依此。</p><div class="library-tools"><button id="groupsAdd" class="outline-btn" type="button">＋ 新建分组</button></div>${
    groups.length
      ? `<div class="group-toc">${groups
          .map(group => {
            const members = groupMembers(group.id),
              preset = store.settings.presets.find(item => item.id === group.presetId),
              touched = lastTouched(members),
              gist = [
                `${members.length} 段`,
                touched ? `${formatDay(touched)}动笔` : "",
                preset ? `预设 ${preset.name}` : "",
                group.workdir ? `目录 ${pathTail(group.workdir)}` : ""
              ]
                .filter(Boolean)
                .join(" · ");
            return `<button type="button" class="group-row" data-group-page="${escapeHtml(group.id)}"><span class="repo-seal" aria-hidden="true">集</span><span class="group-row-name">${escapeHtml(group.name)}</span><span class="guide-lead-line" aria-hidden="true"></span><span class="group-row-gist">${escapeHtml(gist)}</span></button>`;
          })
          .join("")}</div>`
      : `<p class="card-note">尚无分组。对话「⋯」里的「移入分组」也可就地新建。</p>`
  }`;
}
/** @param {ReturnType<typeof groupsList>[number]} group */
function groupDetailHtml(group) {
  const members = groupMembers(group.id),
    presets = store.settings.presets;
  return `<div class="guide-top"><button type="button" class="guide-back" data-group-page="">‹ 分组</button></div><div class="group-title"><span class="repo-seal" aria-hidden="true">集</span><input id="groupName" class="group-name-field" value="${escapeHtml(group.name)}" maxlength="40" spellcheck="false" aria-label="组名"></div><p class="library-lead">${members.length ? `${members.length} 段对话` : "此组尚无对话"}；以下两样只管组里新起的对话。</p><div class="group-settings"><div class="setting-row"><div class="setting-copy"><strong>预设</strong><small>组里新起的对话用它：提示词、工具、模型与权限一并换上。${presets.length ? "" : "尚无预设，可在设置 → 预设里新添"}</small></div><select id="groupPreset" class="field select"><option value="">本色（不带预设）</option>${presets
    .map(
      preset =>
        `<option value="${escapeHtml(preset.id)}"${preset.id === group.presetId ? " selected" : ""}>${escapeHtml(preset.name)}</option>`
    )
    .join(
      ""
    )}</select></div><div class="setting-row"><div class="setting-copy"><strong>默认目录</strong><small>组里新起的对话绑上此目录，即为行；留空则为言</small></div><div class="setting-actions setting-directory"><input id="groupWorkdir" class="field" spellcheck="false" autocomplete="off" placeholder="不绑目录" value="${escapeHtml(group.workdir)}"><button id="groupWorkdirPick" class="outline-btn" type="button">选择…</button></div></div></div><div class="group-actions"><button id="groupNewChat" class="outline-btn" type="button">在此组新建</button><button id="groupDissolve" class="danger-btn" type="button">解散</button></div><h3 class="settings-sub">组里的对话</h3>${
    members.length
      ? `<div class="group-toc">${members
          .map(
            c =>
              `<div class="group-member"><button type="button" class="group-row" data-group-chat="${escapeHtml(c.id)}">${c.pinned ? `<span class="group-pin" title="组内置顶" aria-label="组内置顶"></span>` : ""}<span class="group-row-name">${escapeHtml(c.title)}</span><span class="guide-lead-line" aria-hidden="true"></span><span class="group-row-gist">${escapeHtml(formatDay(c.updatedAt))}</span></button><button type="button" class="group-member-out" data-group-out="${escapeHtml(c.id)}" title="移出此组，退回散列">移出</button></div>`
          )
          .join("")}</div>`
      : `<p class="card-note">对话「⋯」里的「移入分组」可把已有的对话移进来。</p>`
  }`;
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
    pick.textContent = "选择中…";
    try {
      const input = /** @type {HTMLInputElement} */ ($("#groupWorkdir"));
      const data = await bridge("/api/work/pick", { current: input.value.trim() }, AbortSignal.timeout(300000));
      if (data.path) {
        input.value = data.path;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (error) {
      toast(String(error.message || error).slice(0, 80));
    } finally {
      pick.disabled = false;
      pick.textContent = "选择…";
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
  if (/** @type {HTMLElement} */ (event.target).id === "groupName" && event.key === "Enter")
    /** @type {HTMLInputElement} */ (event.target).blur();
});

// ---------- 侧栏历史里的分组：收起 / 展开、组首「＋」、双击改名 ----------
$("#history").addEventListener("click", event => {
  const target = /** @type {HTMLElement} */ (event.target);
  const toggle = target.closest("[data-group-toggle]");
  if (toggle && !target.closest(".group-rename")) {
    const key = `group:${toggle.dataset.groupToggle}`,
      set = new Set(store.settings.collapsedRepos || []);
    set.has(key) ? set.delete(key) : set.add(key);
    store.settings.collapsedRepos = [...set];
    saveStoreSoon();
    return renderHistory();
  }
  const add = target.closest("[data-group-new]");
  if (add) return newChatInGroup(add.dataset.groupNew);
  const more = target.closest("[data-group-menu]");
  if (more) {
    event.stopPropagation();
    openGroupMenu(more.dataset.groupMenu, more);
  }
});
// 拖放：对话拖到一组上（组首或组里任一条）即移入那组，拖到组外即移出；拖着经过的组首提亮。只认侧栏里拖起的对话
const CHAT_DRAG = "application/x-yan-chat";
/** @param {DragEvent} event */
const dropGroupOf = event => /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest?.(".history-repo-group.is-set"));
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
  toast(target ? `移入「${groupsList().find(group => group.id === target)?.name}」` : "已移出分组");
});
$("#history").addEventListener("dragend", () => {
  clearDropMarks();
  document.querySelectorAll("#history .dragging").forEach(node => node.classList.remove("dragging"));
});
$("#history").addEventListener("dblclick", event => {
  const toggle = /** @type {HTMLElement} */ (event.target).closest("[data-group-toggle]");
  if (toggle && !renamingGroupId) startGroupRename(toggle.dataset.groupToggle);
});
$("#history").addEventListener("keydown", event => {
  const input = /** @type {HTMLInputElement} */ (event.target);
  // 组首是 div（改名时里面要放输入框，按钮里放不得）：回车与空格照按钮开合
  if (input.dataset?.groupToggle !== undefined && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    return input.click();
  }
  if (!input.classList?.contains("group-rename")) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commitGroupRename(input.value);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    renamingGroupId = null;
    renderHistory();
  }
});
$("#history").addEventListener(
  "blur",
  event => {
    const input = /** @type {HTMLInputElement} */ (event.target);
    if (input.classList?.contains("group-rename") && renamingGroupId) commitGroupRename(input.value);
  },
  true
);
