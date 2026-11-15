// 言 · 言 / 行两态：对话绑没绑目录、工具落脚在哪、沙箱与三档权限
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 言与行不是两个入口，而是一段对话有没有绑工作目录：绑了就是行（执事，改动落在那个目录，提示词也是执事的做法）；
// 没绑就是言（对谈，文件工具落在卷宗）。目录可以在对话中途绑上或解开，上下文不断
/** @param {Conversation} c */
function isWork(c) {
  return !!c?.workdir;
}
// 沙箱：言与行都套着——桥接那头筛指令、锁目录、去机密环境变量。只有设置 → 工具里一个总开关，默认开
function sandboxed() {
  return store.settings.sandbox !== false;
}
function workMode() {
  const c = currentConversation();
  // 与发送时同一口径（见 14-chat-engine/10-send.js）：待绑的目录优先，其次是待归组自带默认目录——
  // 后者发出去也是执事，欢迎页的印章、副标题与推荐语都得照这个说，不能一边称对谈、一边落进绑了目录的对话
  return c ? isWork(c) : !!(store.settings.pendingWorkdir || "").trim() || !!pendingGroup()?.workdir;
}
// 卷宗目录：存储根里的 卷宗/（桥接报来的位置）；没绑目录的对话，工具都落在这里
function archiveDir() {
  return bootstrap.work?.archive || "";
}
// 言里的草稿：卷宗下的隐藏目录 .草稿/<对话id>/，脚本与中间文件放那里，成品放根目录；卷宗页不列它
/** @param {Conversation} c */
function scratchRel(c) {
  return `${bootstrap.work?.scratch || ".草稿"}/${String(c.id)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 12)}`;
}
// 这段对话的工具落脚在哪：绑了目录是它，没绑是卷宗
/** @param {Conversation} c */
function workRoot(c) {
  return c?.workdir || archiveDir();
}
// 侧栏顶上的标识即当前的态：对谈是一笔言、执事是一笔行（设计稿/156 丙），不再另写「对谈 / 执事」；改态的入口是目录签
function renderModeSwitch() {
  const mode = workMode() ? "work" : "chat",
    mark = $("#brandMark");
  if (!mark || (mark.dataset.mode === mode && mark.childElementCount)) return;
  mark.dataset.mode = mode;
  mark.innerHTML = brushMark(mode === "work" ? "行" : "言");
  mark.title = mode === "work" ? t("行 · 执事：指令与改动落在工作目录") : t("言 · 对谈：产出收入卷宗");
  mark.setAttribute("aria-label", mode === "work" ? t("行 · 执事") : t("言 · 对谈"));
}
const COMMAND_POLICY_META = {
  ask: [t("问而后行"), t("只读指令径行，其余逐条请示")],
  review: [t("审而后行"), t("桥接代审：常规改动放行，高危动作回绝")],
  auto: [t("径行"), t("不再审查；沙箱之界照守")]
};
function commandPolicyOf(c) {
  return normalizeCommandPolicy(c?.commandPolicy, normalizeCommandPolicy(store.settings.commandPolicyDefault));
}
function nextCommandPolicy(value) {
  return { ask: "review", review: "auto", auto: "ask" }[normalizeCommandPolicy(value)];
}
// 三档权限：言与行都可逐段对话设置；按钮循环切换，设置页决定新对话默认值
function renderWorkAuto() {
  const c = currentConversation(),
    button = $("#workAuto");
  if (!button) return;
  const show = !!c && !!workRoot(c) && activeProfile()?.tools !== false;
  button.classList.toggle("hidden", !show);
  if (!show) return;
  const policy = commandPolicyOf(c),
    meta = COMMAND_POLICY_META[policy];
  button.textContent = meta[0];
  button.title = `${meta[0]}：${meta[1]}`;
  button.classList.toggle("on", policy !== "ask");
}
