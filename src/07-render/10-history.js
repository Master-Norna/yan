// 言 · 渲染 · 历史：侧栏的对话列表
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function renderHistory() {
  const query = historyQuery.trim().toLowerCase();
  const matches = c =>
    !query ||
    String(c.title).toLowerCase().includes(query) ||
    (c.messages || []).some(m => typeof m.content === "string" && m.content.toLowerCase().includes(query));
  const sorted = [...store.conversations].filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // 一条时间线：绑了目录的对话归在各自的「工」组里，组按组内最近动过的那条排（一条有动静，整组靠前），组内按时间；
  // 自立的分组（「集」）同样按组内最近动过的那条排，空组按立组的时间，与「工」组同一排法；没绑目录的对话按自己的时间散在其间；置顶另列。
  // 落选的：分组在置顶之下自成一段（组一多，刚写的对话被压到下面，且与置顶之间没有界线，看着像置顶的一部分）。
  // 组可收起，收起即整组收起（连同正开着的那条）；正开着的那条在组里时，组首标出「在此」，收起了也知道自己在哪。
  // 落选：收起时单留当前那条——看着像只收了别的几条，怪。查找时不收，也不列没有命中的组
  const collapsed = new Set(store.settings.collapsedRepos || []),
    pinned = sorted.filter(c => c.pinned && !groupOf(c)),
    repos = new Map(),
    sets = new Map(groupsList().map(group => [group.id, { kind: "set", group, at: group.createdAt, items: [] }])),
    nodes = [];
  for (const c of sorted) {
    const set = c.groupId && sets.get(c.groupId);
    if (set) {
      if (!set.items.length || c.updatedAt > set.at) set.at = c.updatedAt;
      set.items.push(c);
      continue;
    }
    if (c.pinned) continue;
    if (!isWork(c)) {
      nodes.push({ kind: "chat", at: c.updatedAt, c });
      continue;
    }
    let node = repos.get(c.workdir);
    if (!node) {
      node = { kind: "repo", dir: c.workdir, at: c.updatedAt, items: [] };
      repos.set(c.workdir, node);
      nodes.push(node);
    }
    node.items.push(c);
  }
  for (const set of sets.values()) if (!query || set.items.length) nodes.push(set);
  nodes.sort((a, b) => b.at.localeCompare(a.at));
  /** @type {Map<string, any[]>} */
  const buckets = new Map();
  buckets.set(
    "置顶",
    pinned.map(c => ({ kind: "chat", c }))
  );
  for (const label of ["今天", "过去七天", "更早"]) buckets.set(label, []);
  for (const node of nodes) buckets.get(dayBucket(node.at)).push(node);
  // 正改着名时侧栏也可能重画（别的对话拟好了题、后台一答收尾）：改到一半的字与光标得留住，不能被原标题冲掉
  // 改组名同理
  const editing = $("#history .history-rename"),
    mine = editing?.classList.contains("group-rename")
      ? !!renamingGroupId && editing.closest("[data-group]")?.dataset.group === renamingGroupId
      : !!editing && !!renamingId && editing.closest("[data-conversation]")?.dataset.conversation === renamingId,
    typed = mine ? { value: editing.value, start: editing.selectionStart, end: editing.selectionEnd } : null;
  const item = c => {
    if (renamingId === c.id)
      return `<div class="history-item active" data-conversation="${escapeHtml(c.id)}"><input class="history-rename" value="${escapeHtml(typed && renamingDirty ? typed.value : c.title)}" maxlength="60" aria-label="重命名对话"></div>`;
    // 这一答写完了、帮手还在后台做，也算在忙；帮手的请示没有哪一答替它挂「等待确认」，按请示本身认
    const job = requestJob(c.id),
      running = !!job || crewRunning(c.id),
      waiting = job?.label === "等待确认" || [...pendingApprovals.values()].some(entry => entry.conversationId === c.id),
      runningTip = job ? "后台生成中" : "帮手在后台做";
    const state = waiting
      ? `<span class="history-state waiting" title="有指令等待确认" aria-label="有指令等待确认">问</span>`
      : running
        ? `<span class="history-state running" title="${runningTip}" aria-label="${runningTip}"></span>`
        : c.unread
          ? `<span class="history-state unread" title="有新回复" aria-label="有新回复"></span>`
          : c.pinned && groupOf(c)
            ? `<span class="history-state pinned" title="组内置顶" aria-label="组内置顶"></span>`
            : "";
    return `<div class="history-item ${c.id === currentId ? "active" : ""} ${running ? "is-running" : ""} ${c.unread ? "has-unread" : ""} ${isWork(c) ? "is-work" : ""}" data-conversation="${escapeHtml(c.id)}" draggable="true"><button class="history-open" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</button>${state}<span class="history-tools"><button class="history-tool history-more" data-history-action="menu" title="更多" aria-label="更多" aria-haspopup="menu">⋯</button></span></div>`;
  };
  const repoHtml = node => {
    const name = node.dir.split(/[\\/]/).filter(Boolean).pop() || node.dir || "未定目录",
      fold = collapsed.has(node.dir) && !query,
      shown = fold ? [] : node.items,
      here = fold && node.items.some(c => c.id === currentId),
      running = node.items.filter(c => requestJob(c.id)).length;
    return `<div class="history-repo-group${fold ? " collapsed" : ""}${here ? " holds-current" : ""}" data-repo="${escapeHtml(node.dir)}"><div class="history-repo-head"><button type="button" class="history-repo" data-repo-toggle="${escapeHtml(node.dir)}" title="${escapeHtml(node.dir)}\n${fold ? "展开" : "收起"}" aria-expanded="${fold ? "false" : "true"}"><span class="repo-seal" aria-hidden="true">工</span><span class="history-repo-name">${escapeHtml(name)}</span><small>${node.items.length}${fold && running ? ` · ${running} 生成中` : ""}</small><span class="repo-caret" aria-hidden="true">›</span></button><button type="button" class="history-tool repo-new" data-history-workdir="${escapeHtml(node.dir)}" title="在此目录新建">＋</button></div>${shown.length ? `<div class="history-repo-items">${shown.map(item).join("")}</div>` : ""}</div>`;
  };
  // 分组：画法同「工」组，印文是「集」；组首右侧「＋」在此组另起一段、「⋯」改名、打开组的设置或解散；改名时组名换成输入框。
  // 对话可拖到组上移入、拖到组外移出（见 24-groups.js）
  const setHtml = node => {
    const { group } = node,
      key = `group:${group.id}`,
      fold = collapsed.has(key) && !query,
      items = [...node.items].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)),
      shown = fold ? [] : items,
      here = fold && items.some(c => c.id === currentId),
      renaming = renamingGroupId === group.id;
    const name = renaming
      ? `<input class="history-rename group-rename" value="${escapeHtml(typed ? typed.value : group.name)}" maxlength="40" aria-label="分组改名">`
      : `<span class="history-repo-name">${escapeHtml(group.name)}</span>`;
    return `<div class="history-repo-group is-set${fold ? " collapsed" : ""}${here ? " holds-current" : ""}" data-group="${escapeHtml(group.id)}"><div class="history-repo-head"><div role="button" tabindex="0" class="history-repo" data-group-toggle="${escapeHtml(group.id)}" aria-expanded="${fold ? "false" : "true"}"><span class="repo-seal" aria-hidden="true">集</span>${name}<small>${node.items.length}</small><span class="repo-caret" aria-hidden="true">›</span></div><button type="button" class="history-tool repo-new" data-group-new="${escapeHtml(group.id)}" title="在此组新建">＋</button><button type="button" class="history-tool repo-new repo-more" data-group-menu="${escapeHtml(group.id)}" title="更多" aria-label="更多" aria-haspopup="menu">⋯</button></div>${shown.length ? `<div class="history-repo-items">${shown.map(item).join("")}</div>` : ""}</div>`;
  };
  renderingHistory = true;
  try {
    $("#history").innerHTML =
      [...buckets]
        .filter(([, items]) => items.length)
        .map(
          ([label, items]) =>
            `<div class="history-group"><div class="history-label">${label}</div>${items.map(node => (node.kind === "repo" ? repoHtml(node) : node.kind === "set" ? setHtml(node) : item(node.c))).join("")}</div>`
        )
        .join("") || `<div class="history-empty">${query ? "没有匹配的对话" : "尚无旧墨"}</div>`;
    const input = $("#history .history-rename");
    if (input) {
      input.focus();
      if (typed) input.setSelectionRange(typed.start, typed.end);
      else input.select();
    }
  } finally {
    renderingHistory = false;
  }
}
