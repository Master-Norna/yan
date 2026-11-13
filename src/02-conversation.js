// 言 · 对话数据：分叉、模型、草稿
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 分叉：c.messages 始终是当前走的那条路；编辑或重答时被换下来的尾巴整段收进 c.forks（记下它接在哪条消息之后），随时可以切回来。
// 同一位置的几个版本 = 当前这条 + 接在同一位置的 forks，按首条消息的时间排序
/** @param {Conversation} c */
function allMessages(c) {
  return [...(c.messages || []), ...(c.forks || []).flatMap(fork => fork.messages || [])];
}
// 再加上旁注里的往来：数附件、找消息这类要一网打尽的用它
/** @param {Conversation} c */
function everyMessage(c) {
  return [...allMessages(c), ...(c.threads || []).flatMap(thread => thread.messages || [])];
}
/** @param {Conversation} c */
function forkTail(c, index) {
  const tail = c.messages.slice(index);
  if (!tail.length) return null;
  // 收起来的那几答派出的帮手还在后台做：回报已无处可落（落到新的这一版里就张冠李戴），一并停下，停了不回报
  const orphans = crewOf(c, tail);
  for (const box of orphans) {
    box.halted = true;
    box.controller.abort();
  }
  if (orphans.length) toast(t("旧答派出的帮手已停下"));
  // 旧答开的后台指令也一样：结束时无处可报，进程一并收掉
  releaseBackground(c, tail);
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
  // 眼前这一版的帮手还在做：切走了它的回报会落进别的版本里
  if (crewOf(c, tail).length) return toast(t("这一版派出的帮手还在做，做完再切"));
  // 挂在这一版上的后台与定时一并收口（与重答换下旧答同一套，见 releaseBackground）：留着它们跑完，
  // 结果会按对话寄给换上的这一版（见 14-chat-engine/70-mail.js 的 mailReport）
  releaseBackground(c, tail);
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
    ? `<span class="branch-nav"><button class="message-action" data-action="branch-prev" title="${t(`上一个版本`)}" aria-label="${t(`上一个版本`)}" ${branch.at <= 1 ? "disabled" : ""}>‹</button><span>${branch.at}/${branch.total}</span><button class="message-action" data-action="branch-next" title="${t(`下一个版本`)}" aria-label="${t(`下一个版本`)}" ${branch.at >= branch.total ? "disabled" : ""}>›</button></span>`
    : "";
}
function profiles() {
  return store.profiles;
}
// 此刻在用的模型：打开的对话用它自己记的；还没发出的新对话用欢迎页上挑的，没挑就照预设带的，再照默认。
// 默认模型（settings.activeProfileId）只是新对话的起手，不随打开哪段、换了什么而变
/** 这段对话用的模型：不给即眼前这段，欢迎页上是待发的那一档。后台叫醒的、正作答的那段未必是眼前这段，要把它传进来 @param {Conversation|null} [c] */
function activeProfile(c = currentConversation()) {
  const byId = id => (id && profiles().find(p => p.id === id)) || null;
  return (
    (c ? byId(c.profileId) : byId(pendingProfileId) || byId(presetOf(null)?.profileId)) ||
    byId(store.settings.activeProfileId) ||
    profiles()[0] ||
    null
  );
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
  // 欢迎页也有引文框（游目圈点可引进新对话），草稿里有就照样放回
  pendingQuote = draft.quote;
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
