// 言 · 对话数据：分叉、模型、草稿
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// 分叉：c.messages 始终是当前走的那条路；编辑或重答时被换下来的尾巴整段收进 c.forks（记下它接在哪条消息之后），随时可以切回来。
// 同一位置的几个版本 = 当前这条 + 接在同一位置的 forks，按首条消息的时间排序
/** @param {Conversation} c */
function allMessages(c) {
  return [...(c.messages || []), ...(c.forks || []).flatMap(fork => fork.messages || [])];
}
/** @param {Conversation} c */
function forkTail(c, index) {
  const tail = c.messages.slice(index);
  if (!tail.length) return null;
  c.messages = c.messages.slice(0, index);
  // 只剩一条报错或空白的消息就不值得留作版本
  if (tail.length === 1 && !tail[0].content && !tail[0].steps?.length) {
    void deleteAttachments(attachmentIds(tail));
    return null;
  }
  const fork = { id: uid(), parentId: c.messages[index - 1]?.id ?? null, messages: tail, createdAt: now() };
  (c.forks ||= []).push(fork);
  return fork;
}
/** @param {Conversation} c */
function branchesAt(c, index) {
  const parentId = c.messages[index - 1]?.id ?? null,
    current = c.messages[index];
  if (!current) return [];
  const list = [
    { forkId: null, first: current },
    ...(c.forks || [])
      .filter(fork => fork.parentId === parentId && fork.messages?.length)
      .map(fork => ({ forkId: fork.id, first: fork.messages[0] }))
  ];
  return list.sort((a, b) => String(a.first.timestamp).localeCompare(String(b.first.timestamp)));
}
/** @param {Conversation} c */
function branchAt(c, index) {
  const list = branchesAt(c, index);
  if (list.length < 2) return null;
  return { at: list.findIndex(item => item.forkId === null) + 1, total: list.length, list };
}
/**
 * @param {Conversation} c
 * @param {number} step 往前 / 往后一个版本（-1 / 1）
 */
function switchBranch(c, index, step) {
  const branch = branchAt(c, index);
  if (!branch) return;
  const target = branch.list[branch.at - 1 + step];
  if (!target || target.forkId === null) return;
  const fork = c.forks.find(item => item.id === target.forkId),
    tail = c.messages.slice(index),
    parentId = c.messages[index - 1]?.id ?? null;
  const anchor = document.querySelector(`#messages [data-message="${CSS.escape(c.messages[index].id)}"]`),
    host = $("#chatScroll"),
    keepTop = anchor ? anchor.getBoundingClientRect().top - host.getBoundingClientRect().top : null;
  c.forks = c.forks.filter(item => item !== fork);
  if (tail.length) c.forks.push({ id: uid(), parentId, messages: tail, createdAt: now() });
  c.messages = [...c.messages.slice(0, index), ...fork.messages];
  c.updatedAt = now();
  editingMessageId = null;
  saveStore();
  renderConversation(false);
  // 面板里开着的旁注若注在被换下去的那几条上，退回目录（那里只列眼前这条路上的）
  if (sidePanelOpen()) renderSidePanel();
  // 切换后让这一条留在原来的位置，视线不用重新找
  const next = document.querySelector(`#messages [data-message="${CSS.escape(c.messages[index].id)}"]`);
  if (next && keepTop !== null) {
    followBottom = false;
    host.scrollTop += next.getBoundingClientRect().top - host.getBoundingClientRect().top - keepTop;
  }
}
function branchNavHtml(branch) {
  return branch
    ? `<span class="branch-nav"><button class="message-action" data-action="branch-prev" title="上一个版本" aria-label="上一个版本" ${branch.at <= 1 ? "disabled" : ""}>‹</button><span>${branch.at}/${branch.total}</span><button class="message-action" data-action="branch-next" title="下一个版本" aria-label="下一个版本" ${branch.at >= branch.total ? "disabled" : ""}>›</button></span>`
    : "";
}
function profiles() {
  return store.profiles;
}
function activeProfile() {
  return profiles().find(p => p.id === store.settings.activeProfileId) || profiles()[0] || null;
}
function currentConversation() {
  return store.conversations.find(c => c.id === currentId) || null;
}
function draftKey(id = currentId) {
  return id || NEW_DRAFT_ID;
}
/** @returns {Draft} */
function draftRecord(id = currentId) {
  return normalizeDraft(store.drafts?.[draftKey(id)]);
}
function persistDraft() {
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput"),
    key = draftKey(),
    text = input?.value || "",
    attachments = pendingAttachments.map(file => ({ ...file }));
  store.drafts ||= {};
  if (text || attachments.length || pendingQuote) store.drafts[key] = { text, attachments, quote: pendingQuote, updatedAt: now() };
  else delete store.drafts[key];
  saveStoreSoon();
}
function restoreDraft() {
  if (view !== "chat") return;
  const draft = draftRecord();
  pendingAttachments = draft.attachments.map(file => ({ ...file }));
  pendingQuote = currentConversation() ? draft.quote : null;
  renderQuote();
  const input = currentConversation() ? $("#chatInput") : $("#welcomeInput");
  if (!input) return;
  input.value = draft.text;
  grow(input);
}
function clearDraft(id = currentId) {
  store.drafts ||= {};
  delete store.drafts[draftKey(id)];
}
function draftAttachmentIds() {
  return Object.values(store.drafts || {})
    .flatMap(value => (Array.isArray(value?.attachments) ? value.attachments : []))
    .map(file => file?.id)
    .filter(Boolean);
}
