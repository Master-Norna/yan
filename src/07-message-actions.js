// 言 · 消息动作：复制、编辑、重答、续写……一样一份登记；编辑框的保存
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 消息上的动作：一样一份登记——按钮画什么（brush，按钮由 actionIcon 照名字画，标题随处而定）、作答途中能不能点（busy）、
// 点了做什么（run，拿到这段对话、这条消息在其中的位置、按钮与点击）。生成中（连同开工前的准备）只放行不改动对话的
//（复制、就整条回复开旁注：下面还在写时上面照样可以注）。加一样动作只需一份登记，再在要露出它的地方画一枚
/**
 * @typedef {{ c: Conversation, index: number, message: Message, button: HTMLElement, event: MouseEvent }} MessageActionContext
 * @typedef {{ brush?: string, busy?: boolean, run: (context: MessageActionContext) => any }} MessageAction
 */
/** @type {Record<string, MessageAction>} */
const MESSAGE_ACTIONS = {
  copy: {
    brush: "copy",
    busy: true,
    run: async ({ message }) => {
      await copyText(message.content);
      toast("已复制");
    }
  },
  note: { brush: "note", busy: true, run: ({ message }) => openSideIndex(message.id) },
  "branch-prev": { run: ({ c, index }) => switchBranch(c, index, -1) },
  "branch-next": { run: ({ c, index }) => switchBranch(c, index, 1) },
  // 摘件、取消改问不动对话本身，作答途中也放行（拦下了，点 × 会冒到件条上打开查看器）
  "drop-attachment": {
    busy: true,
    run: ({ c, index, message, button, event }) => {
      // 只摘掉这一枚件条、不重画：重画会把编辑框里改到一半的字冲回原文。也别让点击再冒到件条上打开查看器
      event.stopPropagation();
      editingDropped.add(button.dataset.file);
      const article = button.closest("[data-message]"),
        card = button.closest(".attachment-card"),
        list = card?.parentElement;
      card?.remove();
      if (list && !list.children.length) list.remove();
      // 签名里记着摘了几件：页上这条跟着记上，不然下一次重画见签名不同，照原文重建编辑框
      if (article) nodeSig.set(article, messageSig(message, branchAt(c, index)));
    }
  },
  edit: {
    brush: "edit",
    run: ({ c, message }) => {
      if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
      editingMessageId = message.id;
      editingDropped = new Set();
      renderConversation(false);
      requestAnimationFrame(() => {
        const input = document.querySelector(`[data-message="${message.id}"] .message-edit-input`);
        growEditor(input);
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }
  },
  "cancel-edit": {
    busy: true,
    run: () => {
      editingMessageId = null;
      renderConversation(false);
    }
  },
  "save-edit": {
    run: ({ c, index, button }) => saveEditedMessage(c, index, button.closest("[data-message]").querySelector(".message-edit-input").value)
  },
  resume: {
    brush: "forward",
    run: async ({ c, message }) => {
      if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
      const profile = activeProfile();
      if (!profile) return openSettings("models");
      if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
      await resumeAnswer(c, message, profile);
    }
  },
  regenerate: { brush: "reload", run: regenerateAt },
  retry: { brush: "reload", run: regenerateAt }
};
function actionIcon(action, title) {
  return `<button class="message-action" data-action="${action}" title="${title}" aria-label="${title}">${brushIcon(MESSAGE_ACTIONS[action].brush)}</button>`;
}
async function handleMessageAction(event) {
  const button = event.target.closest("[data-action]"),
    action = MESSAGE_ACTIONS[button?.dataset.action];
  if (!action || (!action.busy && (sendPreparing || conversationRunning() || runningElsewhere()))) return;
  const c = currentConversation();
  if (!c) return;
  const id = button.closest("[data-message]")?.dataset.message,
    index = c.messages.findIndex(m => m.id === id);
  if (index < 0) return;
  return action.run({ c, index, message: c.messages[index], button, event });
}
// 续写一答：手点「继续生成」，或这一答断着时帮手回报到了（见 wakeWithReports）
/** @param {Conversation} c @param {Message} message @param {Profile} profile */
async function resumeAnswer(c, message, profile) {
  if (!(await preparing(() => prepareTurn(c)))) return;
  foldRelayTail(c, message);
  message.status = "streaming";
  message.error = "";
  delete message.interruptedAt;
  saveStore();
  if (currentId === c.id && view === "chat") renderConversation(false);
  else renderHistory();
  await streamReply(c, message, profile, { resume: true });
}
// 重答、重试：这一答连同其后的整段留作一个版本，就着上一问另起一答
/** @param {MessageActionContext} context */
async function regenerateAt({ c, index }) {
  if (conversationDry(c)) return toast("余墨已尽，请调高上限或更换模型");
  const userIndex = [...c.messages.slice(0, index)].map(m => m.role).lastIndexOf("user");
  if (userIndex < 0) return;
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
  if (!(await preparing(() => prepareTurn(c)))) return;
  forkTail(c, userIndex + 1);
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  c.messages.push(assistant);
  saveStore();
  renderConversation(true);
  await streamReply(c, assistant, profile);
}
/** @param {Conversation} conversation */
async function saveEditedMessage(conversation, index, value) {
  const text = value.trim(),
    old = conversation.messages[index],
    attachments = (old.attachments || []).filter(file => !editingDropped.has(file.id));
  if (!text && !attachments.length) return toast("尚未落笔");
  const profile = activeProfile();
  if (!profile) return openSettings("models");
  if (quotaBlocked(profile)) return toast("余墨已尽，请调高上限或更换模型");
  if (text === old.content && attachments.length === (old.attachments || []).length) {
    editingMessageId = null;
    renderConversation(false);
    return;
  }
  if (!(await preparing(() => prepareTurn(conversation)))) return;
  // 旧问题连同它后面的回答整段留作一个版本；新问题沿用原来的引文，附件除去改问时摘掉的
  forkTail(conversation, index);
  const message = { ...old, id: uid(), content: text, ...(old.attachments ? { attachments } : {}), timestamp: now() };
  conversation.messages.push(message);
  conversation.updatedAt = now();
  if (index === 0 && conversation.titleAuto !== false) {
    conversation.title = titleFrom(text, attachments);
    conversation.titled = false;
  }
  editingMessageId = null;
  /** @type {Message} */
  const assistant = { id: uid(), role: "assistant", content: "", timestamp: now(), status: "streaming", modelName: profile.name };
  conversation.messages.push(assistant);
  saveStore();
  render(true);
  await streamReply(conversation, assistant, profile);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

// 消息上的动作（复制、编辑、重答……）；编辑框里 Ctrl+Enter 保存
function bindMessageActionEvents() {
  $("#messages").addEventListener("click", handleMessageAction);
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || !e.target.classList?.contains("message-edit-input")) return;
    e.preventDefault();
    e.target.closest(".message-editor")?.querySelector('[data-action="save-edit"]')?.click();
  });
}
// 改着一条问：Esc 放弃改动
defineLayer({
  name: "editing",
  rank: 50,
  open: () => !!editingMessageId,
  close: () => {
    editingMessageId = null;
    renderConversation(false);
    if (sidePanelOpen()) renderSidePanel();
  }
});
