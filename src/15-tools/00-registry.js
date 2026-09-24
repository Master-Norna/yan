// 言 · 工具注册表：一件工具一份登记，写明给谁用、什么性质、怎么执行、行迹怎么画、带给下一问怎么说
// 本目录各段与 src/ 下其余各段一样，由桥接（或 node build.js）按路径顺序拼进同一个闭包；无需模块系统。
// 说给模型听的话（description 与参数）不在登记里，在 prompts/tools.js，按工具名对上；日后外来的工具（接口卡、MCP）自带 schema。
// 交给模型的工具定义、执行、行迹卡片、摘要、出处都从这张表派生：加一件工具，只需在本目录加一份登记、在 prompts/tools.js 加一段说明
/**
 * @typedef {Object} ToolContext 执行时的处境
 * @property {Conversation} conversation
 * @property {Message} assistant 页面上的那一答（帮手的步骤也画在它的行迹里）
 * @property {AbortSignal} signal
 *
 * @typedef {Object} OfferContext 此处给不给某件工具，看这几样
 * @property {Conversation} conversation
 * @property {boolean} work 执事（绑了工作目录，且不是旁注）
 * @property {boolean} bridge 本机桥接在线
 * @property {boolean} files 有可落脚的目录（工作目录或卷宗）
 * @property {Array<Record<string, any>>} docs 可读的文档
 * @property {string[]} offered 登记在前、此处已经给出的工具
 *
 * @typedef {{ ok: boolean, content: string, display: string }} ToolOutcome content 回给模型，display 写在标题行右侧
 * @typedef {{ url?: string, title?: string, read?: boolean, talk?: string, date?: string, memory?: string }} Source 答末「出处」的一条：网页、旧谈或记忆
 *
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} label 行迹上的名字
 * @property {false | ((ctx: OfferContext) => boolean)} [offer] 此处给不给；不写即处处都给，false 是只登记画法、从不交给模型的步骤（补言）
 * @property {boolean} [mainOnly] 只给主模型，帮手拿不到
 * @property {boolean} [lookup] 旁注（只查不改）也给
 * @property {(ctx: OfferContext) => Record<string, any>} [vars] 说明里 {{名字}} 的值
 * @property {{ description: string, brief?: string, parameters: Record<string, any> }} [schema] 自带的说明与参数；不写则取 prompts/tools.js
 * @property {boolean} [parallel] 可与相邻的同类一起跑
 * @property {boolean} [sideEffect] 有副作用：参数 JSON 残缺就不执行
 * @property {boolean} [writes] 会在目录里出新文件：言里据此收成品
 * @property {true | ((args: Record<string, any>) => Record<string, any> | null)} [cache] 同一答里同样的参数直接复用结果；函数给出规范化后的参数，给 null 即这次不复用
 * @property {(step: Step, args: Record<string, any>, ctx: ToolContext) => ToolOutcome | Promise<ToolOutcome>} [run]
 * @property {(step: Step, title: string) => string} [html] 行迹卡片；不写用通用的一种
 * @property {(el: Element, step: Step, prev: { status: string } | undefined) => void} [sync] 卡片就地更新（不写则变了就整张换）
 * @property {(step: Step) => string} [approval] 请示条的内容
 * @property {true | ((step: Step) => string)} [digest] 带给下一问的一行；true 用通用写法，不写即不带
 * @property {(step: Step) => Source[]} [sources] 答末「出处」里列的条目
 */
/** @type {Map<string, Tool>} 按登记先后排，交给模型时也是这个次序 */
const TOOLS = new Map();
/** @param {Tool} tool */
function defineTool(tool) {
  TOOLS.set(tool.name, tool);
}
function toolLabel(name) {
  return TOOLS.get(name)?.label || name;
}
function toolSpec(name) {
  return TOOLS.get(name)?.schema || PROMPTS.tools[name];
}
// 此处交给模型的工具。sub：帮手的一套（只给主模型的除外）；lookup：旁注的一套，只查不改。
// 言（对谈）里带 brief 的用短说明：对谈的每一问都背着这份定义，越轻越好
/** @param {Conversation} conversation */
function toolDefinitions(conversation, { sub = false, lookup = false } = {}) {
  /** @type {OfferContext} */
  const ctx = {
    conversation,
    work: isWork(conversation) && !lookup,
    bridge: apiBase !== null,
    files: !!workRoot(conversation),
    docs: availableDocuments(conversation),
    offered: []
  };
  const tools = [];
  for (const tool of TOOLS.values()) {
    if (!tool.run || (sub && tool.mainOnly) || (lookup && !tool.lookup) || (tool.offer && !tool.offer(ctx))) continue;
    const spec = toolSpec(tool.name),
      text = !ctx.work && spec.brief ? spec.brief : spec.description;
    tools.push({
      type: "function",
      function: { name: tool.name, description: fillTemplate(text, tool.vars?.(ctx)), parameters: spec.parameters }
    });
    ctx.offered.push(tool.name);
  }
  return tools.length ? tools : null;
}
/**
 * 跑一步：先把参数理顺（见 01-arguments.js），讲不通的原样告诉模型错在哪；理顺了交给那件工具
 * @param {Step} step
 * @param {ToolContext} ctx
 * @returns {Promise<ToolOutcome>}
 */
async function runTool(step, ctx) {
  const tool = TOOLS.get(step.name);
  if (!tool?.run) return { ok: false, content: `未知工具 ${step.name}`, display: "未知工具" };
  // 帮手没拿到的工具，它也可能照着名字调
  if (step.scope && tool.mainOnly)
    return { ok: false, content: `${step.name} 只有主模型可用；需要它做的事写进回报里，由主模型决定。`, display: "帮手无权" };
  const parsed = parseToolArguments(step.arguments);
  if (!parsed.ok)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数不是合法 JSON（${parsed.error}）。arguments 必须是一个 JSON 对象，不要加代码围栏、注释或多余的逗号，也不要把它再编码成字符串；内容过长时先精简再发。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（前 300 字）：${parsed.raw.slice(0, 300)}`,
      display: "参数解析失败"
    };
  // 截断的参数救回来也不能拿去写：内容已经不全，写下去就是把文件写坏
  if (parsed.truncated && tool.sideEffect)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数 JSON 不完整（多半是输出被最大长度截断），为安全起见没有执行。请把内容精简或分成几次写入（大文件先 write_file 写开头，再用 edit_file 追加），确保 arguments 是完整的 JSON。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（末尾 200 字）：…${step.arguments.slice(-200)}`,
      display: "参数不完整"
    };
  const { args, problems } = normalizeToolArguments(step.name, parsed.args);
  if (problems.length)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数不合要求：${problems.join("；")}。这件工具收的参数：${toolSchemaHint(step.name)}；实际收到的键：${Object.keys(parsed.args).join("、") || "（无）"}${parsed.truncated ? "\n（参数 JSON 不完整，可能是输出被截断）" : ""}\n\n收到的原文（前 300 字）：${step.arguments.slice(0, 300)}`,
      display: "参数不合要求"
    };
  try {
    return await tool.run(step, args, ctx);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    const message = String(error.message || error);
    return { ok: false, content: `工具执行失败：${message}`, display: friendlyError(message).slice(0, 60) };
  }
}
// 同一答里同样的参数不必再跑一遍：键是工具名加规范化后的参数，怎么规范由各工具的 cache 定
/** @param {Step} step */
function toolCacheKey(step) {
  const cache = TOOLS.get(step.name)?.cache,
    parsed = cache ? parseToolArguments(step.arguments) : null;
  if (!parsed?.ok) return null;
  const args = cache === true ? parsed.args : cache(parsed.args);
  return args ? `${step.name}:${JSON.stringify(stableToolJson(args))}` : null;
}
function stableToolJson(value) {
  if (Array.isArray(value)) return value.map(stableToolJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableToolJson(value[key])])
    );
  return typeof value === "string" ? value.trim() : value;
}
// 复用结果时连同呈现一起搬过来：标题、网址、备注、命中
/** @param {Step} step */
function toolPresentation(step) {
  return {
    title: step.title || "",
    url: step.url || "",
    note: step.note || "",
    results: step.results ? structuredClone(step.results) : null
  };
}
// 把一批工具调用跑完，返回各步回给模型的结果。相邻的可并发的一起跑（读、搜、翻网页、翻记忆彼此无关）；会改状态或要请示的按原顺序逐个来。
// 主模型、帮手与旁注共用这一段：assistant 是页面上那条消息（帮手的步骤也画在它的行迹里）
/**
 * @param {Step[]} steps
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runSteps(steps, conversation, assistant, signal, toolCache) {
  const outcomes = new Map(),
    ctx = { conversation, assistant, signal };
  const runOne = async step => {
    const started = performance.now(),
      key = toolCacheKey(step),
      cached = key ? toolCache.get(key) : null;
    let outcome;
    if (cached) {
      Object.assign(step, structuredClone(cached.presentation));
      step.cached = true;
      outcome = structuredClone(cached.outcome);
      outcome.display = `复用 · ${outcome.display}`;
    } else {
      outcome = await runTool(step, ctx);
      // 只缓存成功的：临时的 502、超时若也缓存，模型想重试只会一直拿到同一个旧失败
      if (key && outcome.ok) toolCache.set(key, { outcome: structuredClone(outcome), presentation: toolPresentation(step) });
    }
    const remaining = MIN_TOOL_STATUS_MS - (performance.now() - started);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    step.status = step.skipped ? "skipped" : outcome.ok ? "done" : "error";
    step.result = outcome.display;
    outcomes.set(step.id, String(outcome.content).slice(0, 60000));
    refreshSteps(assistant);
    saveStore();
  };
  const parallel = step => !!TOOLS.get(step.name)?.parallel;
  for (let i = 0; i < steps.length; ) {
    let j = i + 1;
    if (parallel(steps[i])) while (j < steps.length && parallel(steps[j])) j += 1;
    await Promise.all(steps.slice(i, j).map(runOne));
    i = j;
  }
  return outcomes;
}
// 生成结束（停止、出错或中断）时，还在转圈或等待确认的步骤一并收束，不留下永远转圈的卡片
/** @param {Message} assistant */
function settleSteps(assistant, note) {
  for (const step of allSteps(assistant))
    if (step.status === "running" || step.status === "pending") {
      pendingApprovals.delete(step.id);
      step.status = step.status === "pending" ? "skipped" : "error";
      step.result = note;
    }
  for (const step of assistant.steps || []) if (step.sub?.status === "streaming") step.sub.status = "stopped";
}
// 一答里的全部步骤，含帮手在差遣卡片里跑的那些（只嵌一层：帮手不再差遣）
/** @param {{ steps?: Step[] }} message 消息或帮手 */
function allSteps(message) {
  return (message?.steps || []).flatMap(step => [step, ...(step.sub?.steps || [])]);
}
// 步骤上留着的输出只留末尾一截：指令跑出几万行，整份存进对话既占地方也没人看
const STEP_OUTPUT_KEEP = 6000;
function trimOutput(text) {
  const value = String(text || "");
  return value.length > STEP_OUTPUT_KEEP ? `…（前面 ${value.length - STEP_OUTPUT_KEEP} 字略去）\n${value.slice(-STEP_OUTPUT_KEEP)}` : value;
}
function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
}
