// 言 · 分组：侧栏里自立的几组，像 Claude 的 project——把相关的对话聚在一处，不至散落。
// 画法沿用「工」组（组首一方印、左侧一道朱线），印文是「集」；列在「置顶」之下，自成一段。
// 对话的「⋯」里移入、移出或就地新建一组；组首「＋」在此组另起一段，「⋯」改名、解散（解散只拆组，对话退回散列）
/** @type {string|null} 正在改名的那一组 */
let renamingGroupId = null;

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
function createGroup(name = "新分组") {
  const group = { id: uid(), name, createdAt: now() };
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
}
function startGroupRename(id) {
  renamingGroupId = id;
  renderHistory();
  const input = /** @type {HTMLInputElement|null} */ ($("#history .group-rename"));
  input?.focus();
  input?.select();
}
function commitGroupRename(value) {
  const group = groupsList().find(item => item.id === renamingGroupId),
    name = String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  renamingGroupId = null;
  if (group && name && name !== group.name) {
    group.name = name;
    saveStore();
  }
  renderHistory();
  renderChips(workMode(), apiBase !== null);
}
async function dissolveGroup(id) {
  const group = groupsList().find(item => item.id === id);
  if (!group) return;
  const members = store.conversations.filter(c => c.groupId === id);
  if (
    !(await askConfirm({
      title: `解散分组「${group.name}」？`,
      body: members.length ? `组里的 ${members.length} 段对话退回散列，不会删除。` : "这一组是空的。",
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
  saveStore();
  renderHistory();
  renderChips(workMode(), apiBase !== null);
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
// 组首「⋯」：改名、解散
function openGroupMenu(id, anchor) {
  const pop = openFloatingPop(
    anchor,
    `<button type="button" data-group-act="rename">改名</button><button type="button" class="danger" data-group-act="dissolve">解散</button>`,
    {
      align: "right"
    }
  );
  pop.dataset.kind = "group";
  pop.addEventListener("click", event => {
    const act = /** @type {HTMLElement} */ (event.target).closest("[data-group-act]")?.dataset.groupAct;
    if (!act) return;
    closeChipPop();
    if (act === "rename") startGroupRename(id);
    else void dissolveGroup(id);
  });
}
// 侧栏里分组那几处的点击与改名：收起 / 展开、组首「＋」、组首「⋯」
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
  if (add) {
    store.settings.pendingGroupId = add.dataset.groupNew;
    saveStore();
    return newChat();
  }
  const menu = target.closest("[data-group-menu]");
  if (menu) {
    event.stopPropagation();
    openGroupMenu(menu.dataset.groupMenu, menu);
  }
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
