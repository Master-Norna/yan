// 言 · 对话引擎 · 系统提示：预设的提示词与 prompts/ 各段的拼接
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 系统提示：预设的提示词在最前，其后照 prompts/assistant.js 的 order 表逐段拼——每段何时带上（给了哪件工具、言还是行、主答 / 旁注 / 帮手）写在表里；
// 要填值、或视情形不带的，在这里给出：给 null 即这回不带。工具各自做什么、何时用，在工具说明里说，这里不重复
/** @type {Record<string, (ctx: { conversation: Conversation, tools: Set<string>, preset: Preset|null, anchor: boolean }) => Record<string, any>|null>} */
const PROMPT_VARS = {
  "assistant.today": () => ({ day: formatDay(now()), iso: new Date().toISOString().slice(0, 10) }),
  "work.hint": ctx => workVars(ctx.conversation),
  "work.archive": ctx => workVars(ctx.conversation),
  "work.env": () => envVars(),
  // 不报条数：记一条就变，系统提示一变，整段对话的缓存都作废
  "memory.hint": () => {
    const names = memoryCategories().map(cat => cat.name);
    return { categories: names.length ? `，分作${names.map(name => `「${name}」`).join("")}` : "" };
  },
  "mcp.hint": ctx => mcpHintVars(ctx.tools, ctx.preset),
  "side.passage": ctx => (ctx.anchor ? {} : null),
  "side.whole": ctx => (ctx.anchor ? null : {}),
  "side.noTools": ctx => (ctx.tools.size ? null : {})
};
/**
 * @param {Conversation} conversation
 * @param {any[]|null} tools 这回交给模型的工具定义
 * @param {{ role?: "main"|"side"|"sub"|"audit", anchor?: boolean }} [options] anchor：旁注注的是划选的一段（否则是整条回复）
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
    platform: win ? "Windows" : bootstrap.work?.platform || "类 Unix",
    shell,
    shellNote: win ? prompt(/5\.1/.test(shell) ? "work.windowsShellLegacy" : "work.windowsShell") : ""
  };
}
