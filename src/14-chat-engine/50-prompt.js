// 言 · 对话引擎 · 系统提示：预设的提示词与 prompts/ 各段的拼接
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 系统提示：预设的提示词在最前，其后照 prompts/assistant.js 的 order 表逐段拼——每段何时带上（给了哪件工具、言还是行、主答 / 旁注 / 帮手）写在表里；
// 要填值、或视情形不带的，在这里给出：给 null 即这回不带。工具各自做什么、何时用，在工具说明里说，这里不重复
/** @type {Record<string, (ctx: { conversation: Conversation, tools: Set<string>, preset: Preset|null, anchor: boolean }) => Record<string, any>|null>} */
const PROMPT_VARS = {
  // 都取本地日期：取 UTC 的话，东八区零点到八点之间差一天
  "assistant.today": () => ({ iso: localDay(), week: "日一二三四五六"[new Date().getDay()] }),
  "work.hint": ctx => workVars(ctx.conversation),
  "work.archive": ctx => workVars(ctx.conversation),
  "work.env": () => envVars(),
  // 整份记忆，这段对话第一次拼进系统提示时定格（打开即定格，刷新后重新定格；见 memorySnapshot）：此后记的、理过的都不改它，系统提示一变整段的缓存就作废
  "memory.body": ctx => {
    const items = memoryOn(ctx.conversation) ? memorySnapshot(ctx.conversation) : "";
    return items ? { items } : null;
  },
  "mcp.hint": ctx => mcpHintVars(ctx.tools, ctx.preset),
  "skills.hint": () => skillCatalog(),
  "skills.home": () => (skillSet?.home ? { dir: skillSet.home } : null),
  "side.passage": ctx => (ctx.anchor ? {} : null),
  "side.whole": ctx => (ctx.anchor ? null : {}),
  "side.noTools": ctx => (ctx.tools.size ? null : {}),
  // 账本那句的补充，跟着账本走：写不了文件就没有账本
  "work.ledgerMemory": ctx => (ctx.tools.has("write_file") ? {} : null)
};
/**
 * @param {Conversation} conversation
 * @param {any[]|null} tools 这回交给模型的工具定义
 * @param {{ role?: "main"|"side"|"sub", anchor?: boolean }} [options] anchor：旁注注的是划选的一段（否则是整条回复）
 */
function systemPrompt(conversation, tools, { role = "main", anchor = false } = {}) {
  const preset = presetOf(conversation),
    ctx = { conversation, tools: new Set((tools || []).map(tool => tool?.function?.name)), preset, anchor },
    mode = isWork(conversation) ? "work" : "chat",
    lines = [];
  for (const section of PROMPTS.order || []) {
    if (
      (section.tool && !ctx.tools.has(section.tool)) ||
      (section.mode && section.mode !== mode) ||
      (section.roles && !section.roles.includes(role))
    )
      continue;
    const vars = PROMPT_VARS[section.key] ? PROMPT_VARS[section.key](ctx) : {};
    if (vars) lines.push(prompt(section.key, vars));
  }
  const own = String(preset?.prompt || "").trim();
  return own ? `${own}\n\n${lines.join("\n")}` : lines.join("\n");
}
// 执事（work.hint）与卷宗（work.archive）两段的值：目录、平台、可及范围
/** @param {Conversation} conversation */
function workVars(conversation) {
  const win = (bootstrap.work?.platform || "win32") === "win32",
    shell = bootstrap.work?.shell || (win ? "PowerShell" : "sh");
  return {
    workdir: workRoot(conversation),
    scratch: scratchRel(conversation),
    // 沙箱两档：问而后行用严的（拦下的转请用户定夺），审而后行、径行用宽的（只守系统本身）
    reach: prompt(
      sandboxed()
        ? commandPolicyOf(conversation) === "ask"
          ? "work.reachSandbox"
          : "work.reachSandboxLoose"
        : roamAllowed()
          ? "work.reachAnywhere"
          : "work.reachInside"
    ),
    platform: win ? "Windows" : bootstrap.work?.platform === "darwin" ? "macOS" : "类 Unix",
    shell,
    shellNote: win ? prompt(/5\.1/.test(shell) ? "work.windowsShellLegacy" : "work.windowsShell") : ""
  };
}
