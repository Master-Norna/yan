// 言 · 桌面通知：页面不在眼前时，要人看一眼的那几刻弹一条系统通知——一答收尾（这段对话再没有活在做）、待你定夺、帮手断了待续。
// 只用浏览器自带的 Notification，不另做提醒中心；同一段对话的新通知顶掉旧的（tag），点它回到那段对话。
// 准许是各浏览器自己记的：设置随存储根同步，换了浏览器没准许就不弹，回设置里再点一次「开」即可请准
/** 此刻弹不弹：开了、准了、人不在这页上 */
function notifyReady() {
  return (
    store.settings.notify === true && typeof Notification !== "undefined" && Notification.permission === "granted" && !document.hasFocus()
  );
}
/** @param {Conversation} conversation @param {string} body */
function notifyDesktop(conversation, body) {
  if (!notifyReady()) return;
  const note = new Notification(conversation.title || t("新对话"), {
    body: body.replace(/\s+/g, " ").trim().slice(0, 120),
    tag: conversation.id,
    icon: BRAND_ICON
  });
  note.onclick = () => {
    window.focus();
    if (store.conversations.includes(conversation) && (conversation.id !== currentId || view !== "chat")) openConversation(conversation.id);
    note.close();
  };
}
// 一答收尾：补言另起了一问、帮手还在做的，这段对话还没歇，等它真歇了再报（帮手回报另起的那一答收尾时）。人按停的不报
/** @param {Conversation} conversation @param {Message} assistant */
function notifyAnswerEnd(conversation, assistant) {
  if (assistant.status === "stopped" || conversationRunning(conversation.id) || crewRunning(conversation.id)) return;
  notifyDesktop(
    conversation,
    assistant.status === "complete" ? t`答毕：${plainExcerpt(assistant.content)}` : t`断了，待你续写：${assistant.error || ""}`
  );
}
/** 正文的头一句，去掉 Markdown 记号 @param {string} text */
function plainExcerpt(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|]+/g, " ")
    .trim();
}
// 设置里点「开」：头一回在这个浏览器上请准；拒了就不记成开，说明写在那一行的小字里
async function setNotify(on) {
  if (on && typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
  store.settings.notify = on && typeof Notification !== "undefined" && Notification.permission === "granted";
  saveStore();
  renderSettings();
}
function notifyHint() {
  if (typeof Notification === "undefined") return t("此浏览器不支持系统通知");
  if (Notification.permission === "denied") return t("浏览器已拒绝通知，可在地址栏左侧的站点权限里放开");
  if (store.settings.notify && Notification.permission === "default") return t("这个浏览器还没准许，再点一次「开」");
  return t("页面不在眼前时，答毕、待你定夺、帮手断了，弹一条系统通知");
}
