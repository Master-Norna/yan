// 言 · 工具注册表：一件工具一份登记，写明给谁用、什么性质、怎么执行、行迹怎么画、带给下一问怎么说
// 本目录各段与 src/ 下其余各段一样，由桥接按路径顺序拼进同一个闭包；无需模块系统。
const MIN_TOOL_STATUS_MS = 240;
// 说给模型听的话（description 与参数）不在登记里，在 prompts/tools.js，按工具名对上；日后外来的工具（接口卡、MCP）自带 schema。
// 交给模型的工具定义、执行、行迹卡片、摘要、出处都从这张表派生：加一件工具，只需在本目录加一份登记、在 prompts/tools.js 加一段说明
/**
 * @typedef {Object} ToolContext 执行时的处境
 * @property {Conversation} conversation
 * @property {Message} assistant 页面上的那一答（帮手的步骤也画在它的行迹里）
 * @property {AbortSignal} signal
 * @property {Set<string>} [offered] 这一轮交给模型的工具名：不在其中的一律不执行
 * @property {boolean} [lookup] 旁注：只查不改（按需给的 MCP 只放只读的几件）
 *
 * @typedef {Object} OfferContext 此处给不给某件工具，看这几样
 * @property {Conversation} conversation
 * @property {boolean} work 执事（绑了工作目录，且不是旁注）
 * @property {boolean} files 有可落脚的目录（工作目录或卷宗）
 * @property {Array<Record<string, any>>} docs 可读的文档
 * @property {string[]} offered 登记在前、此处已经给出的工具
 * @property {Preset|null} preset 这段对话用的预设：只给它挑中的几组与几个 MCP 服务
 * @property {Profile|null} profile 这一答用的模型：参数里有随模型而定的（帮手的思考档位）
 * @property {boolean} [lookup] 旁注的一套：只查不改
 *
 * @typedef {{ ok: boolean, content: string, display: string, background?: boolean, images?: string[] }} ToolOutcome content 回给模型，display 写在标题行右侧；background：活在后台接着做，步骤由它自己收尾；images：交回的图（data: 地址），随工具结果给模型看
 * @typedef {{ url?: string, title?: string, read?: boolean, talk?: string, date?: string, memory?: string }} Source 答末「出处」的一条：网页、旧谈或记忆
 *
 * @typedef {Object} Tool
 * @property {string} name
 * @property {string} label 行迹上的名字
 * @property {keyof typeof TOOL_GROUPS} [group] 属哪一组：预设按组挑内置工具
 * @property {string} [server] MCP 工具属哪个服务：预设按服务挑
 * @property {false | ((ctx: OfferContext) => boolean)} [offer] 此处给不给；不写即处处都给，false 是只登记画法、从不交给模型的步骤（补言）
 * @property {boolean} [mainOnly] 只给主模型，帮手拿不到
 * @property {boolean} [lookup] 旁注（只查不改）也给
 * @property {(ctx: OfferContext) => Record<string, any>} [vars] 说明里 {{名字}} 的值
 * @property {(parameters: Record<string, any>, ctx: OfferContext) => Record<string, any>} [params] 参数随处境改写（如枚举只列此模型认的几档）
 * @property {{ description: string, brief?: string, parameters: Record<string, any> }} [schema] 自带的说明与参数；不写则取 prompts/tools.js
 * @property {boolean} [parallel] 可与相邻的同类一起跑
 * @property {boolean} [sideEffect] 有副作用：参数 JSON 残缺就不执行；做过之后这一答里复用的结果作废；不写 digest 也照通用写法留痕
 * @property {boolean} [writes] 会在目录里出新文件：言里据此收成品
 * @property {true | ((args: Record<string, any>) => Record<string, any> | null)} [cache] 同一答里同样的参数直接复用结果（其间做过有副作用的一步就作废）；函数给出规范化后的参数，给 null 即这次不复用。
 *   只给「外头不会自己变」的：本机开发服务、带时间与随机数的代码，参数一样结果也会变，不该登记
 * @property {(step: Step, args: Record<string, any>, ctx: ToolContext) => ToolOutcome | Promise<ToolOutcome>} [run]
 * @property {string} [busy] 通用卡片上做着时右侧写的字；不写是「查阅中」
 * @property {(step: Step, title: string) => string} [html] 行迹卡片；不写用通用的一种
 * @property {(el: Element, step: Step, prev: { status: string } | undefined) => boolean} [sync] 卡片就地更新，返回真即已画好；不写或返回假则变了就整张换
 * @property {(step: Step) => string} [approval] 请示条的内容
 * @property {true | ((step: Step) => string)} [digest] 带给下一问的一行；true 用通用写法，不写即不带
 * @property {(step: Step, opts: { latest: boolean, budget?: number }) => Promise<Record<string, any>>|Record<string, any>|null} [replay] 作答途中从外面递进来的话（补言、回报、传话）：
 *   写成给模型的一条消息。当场递上（latest，附件整份带上）与往后重装这一答（见 answerParts，只带摘要）都经它，模型往后读到的与当时一字不差；给 null 即无可重装
 * @property {boolean} [coda] 收尾前递的话（收尾前对照意）：它是这一答最后一步时（放了行、没再动手），之前那段话仍作答复，这一步画在它之后、不进行迹
 * @property {(step: Step) => Source[]} [sources] 答末「出处」里列的条目
 * @property {boolean} [mcp] 由 MCP 服务登记的（配置一变就整批换掉）
 */
// 内置工具的分组：预设按组挑（一件件挑太碎），设置里照这个次序列
const TOOL_GROUPS = {
  web: t("联网"),
  compute: t("计算"),
  image: t("生图"),
  work: t("指令与文件"),
  docs: t("翻文档"),
  ask: t("请示"),
  memory: t("记忆与旧谈"),
  delegate: t("差遣")
};
/** @type {Map<string, Tool>} 按登记先后排，交给模型时也是这个次序 */
const TOOLS = new Map();
/** @param {Tool} tool */
// 有副作用的必须留痕：下一问、续写时模型得知道自己已 POST 过、记过、传过话，不然再做一遍
/** @param {Tool} tool */
function defineTool(tool) {
  if (tool.sideEffect && tool.digest === undefined) tool.digest = true;
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
/** @param {Conversation} conversation @param {{ sub?: boolean, lookup?: boolean, profile?: Profile|null }} [o] */
function toolDefinitions(conversation, { sub = false, lookup = false, profile = null } = {}) {
  /** @type {OfferContext} */
  const ctx = {
    conversation,
    work: isWork(conversation) && !lookup,
    files: !!workRoot(conversation),
    docs: availableDocuments(conversation),
    offered: [],
    preset: presetOf(conversation),
    profile,
    lookup
  };
  const tools = [];
  for (const tool of TOOLS.values()) {
    if (
      !tool.run ||
      (sub && tool.mainOnly) ||
      (lookup && !tool.lookup) ||
      !presetAllows(ctx.preset, tool) ||
      (tool.offer && !tool.offer(ctx))
    )
      continue;
    const spec = toolSpec(tool.name),
      text = !ctx.work && spec.brief ? spec.brief : spec.description,
      // 外来工具自带的说明原样给，不当模板填（里头的 {{…}} 是人家的字）
      description = tool.schema ? text : fillTemplate(text, tool.vars?.(ctx));
    tools.push({
      type: "function",
      function: { name: tool.name, description, parameters: tool.params ? tool.params(spec.parameters, ctx) : spec.parameters }
    });
    ctx.offered.push(tool.name);
  }
  return tools.length ? tools : null;
}
// 预设挑了哪几组、哪几个 MCP 服务：内置的按组，逐件摊开的 MCP 工具按服务；按需给的两件（mcp_describe / mcp_call）看目录里还剩不剩服务，由它们自己的 offer 管
/** @param {Preset|null} preset @param {Tool} tool */
function presetAllows(preset, tool) {
  if (!preset) return true;
  if (tool.server) return !preset.mcp || preset.mcp.includes(tool.server);
  return !tool.group || !preset.tools || preset.tools.includes(tool.group);
}
/**
 * 跑一步：先把参数理顺（见 01-arguments.js），讲不通的原样告诉模型错在哪；理顺了交给那件工具
 * @param {Step} step
 * @param {ToolContext} ctx
 * @returns {Promise<ToolOutcome>}
 */
async function runTool(step, ctx) {
  const tool = TOOLS.get(step.name);
  if (!tool?.run) return { ok: false, content: t`未知工具 ${step.name}`, display: "未知工具" };
  // 没交给它的工具，它也可能照着名字调（旁注只查不改、预设只挑了几组、帮手拿不到只给主模型的）：给哪些就只认哪些
  if (ctx.offered && !ctx.offered.has(step.name))
    return step.scope && tool.mainOnly
      ? { ok: false, content: t`${step.name} 只有主模型可用；需要它做的事写进回报里，由主模型决定。`, display: "帮手无权" }
      : { ok: false, content: t`此处没有提供 ${step.name}，只能用这一轮给出的工具。`, display: "此处未提供" };
  const parsed = parseToolArguments(step.arguments);
  if (!parsed.ok)
    return {
      ok: false,
      content: t`调用 ${step.name} 的参数不是合法 JSON（${parsed.error}）。arguments 必须是一个 JSON 对象，不要加代码围栏、注释或多余的逗号，也不要把它再编码成字符串；内容过长时先精简再发。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（前 300 字）：${parsed.raw.slice(0, 300)}`,
      display: "参数解析失败"
    };
  // 截断的参数救回来也不能拿去写：内容已经不全，写下去就是把文件写坏
  if (parsed.truncated && tool.sideEffect)
    return {
      ok: false,
      content: t`调用 ${step.name} 的参数 JSON 不完整（多半是输出被最大长度截断），为安全起见没有执行。请把内容精简或分成几次写入（大文件先 write_file 写开头，再用 edit_file 追加），确保 arguments 是完整的 JSON。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（末尾 200 字）：…${step.arguments.slice(-200)}`,
      display: "参数不完整"
    };
  const { args, problems } = normalizeToolArguments(step.name, parsed.args);
  if (problems.length)
    return {
      ok: false,
      content: t`调用 ${step.name} 的参数不合要求：${problems.join("；")}。这件工具收的参数：${toolSchemaHint(step.name)}；实际收到的键：${Object.keys(parsed.args).join("、") || t("（无）")}${parsed.truncated ? t("\n（参数 JSON 不完整，可能是输出被截断）") : ""}\n\n收到的原文（前 300 字）：${step.arguments.slice(0, 300)}`,
      display: "参数不合要求"
    };
  // 给人看的一句（工具参数里的 description）：请示条与行迹题头用它，守的关口在工具跑之前就问，所以这里先记下
  if (toolSpec(step.name)?.parameters?.properties?.description && typeof args.description === "string" && args.description.trim())
    step.gist = args.description.trim();
  try {
    // 工具与审查都可能翻到先前几答的行迹（帮手的经过、看过的网址）：另存出去的先接回来
    await warmConversation(ctx.conversation);
    // 意里的守写了触发条件的：对得上的这一步动手前先过它的测试（见 19-intent/10-store.js 的 keepHook）；
    // 审而后行里规则标疑的，再交专司的审查模型判（见 03-review.js）
    const stopped = (await keepHook(step, args, ctx)) || (await reviewHook(step, args, ctx));
    if (stopped) return stopped;
    const outcome = await tool.run(step, args, ctx);
    return step.reviewed?.ok ? { ...outcome, display: [outcome.display, "审准"].filter(Boolean).join(" · ") } : outcome;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    const message = String(error.message || error);
    return { ok: false, content: t`工具执行失败：${message}`, display: bridgeErrorText(message).slice(0, 60) };
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
// 复用结果时连同呈现一起搬过来：标签、标题、网址、备注、命中
/** @param {Step} step */
function toolPresentation(step) {
  return {
    label: step.label,
    title: step.title || "",
    url: step.url || "",
    note: step.note || "",
    results: step.results ? structuredClone(step.results) : null
  };
}
// 把一批工具调用跑完，返回各步回给模型的结果，连同各步交回的图。相邻的可并发的一起跑（读、搜、翻网页、翻记忆彼此无关）；会改状态或要请示的按原顺序逐个来。
// 主模型、帮手与旁注共用这一段：assistant 是页面上那条消息（帮手的步骤也画在它的行迹里）
/**
 * @param {Step[]} steps
 * @param {Conversation} conversation
 * @param {Message} assistant
 * @param {boolean} [lookup] 旁注：只查不改
 */
async function runSteps(steps, conversation, assistant, signal, toolCache, offered, lookup = false) {
  const outcomes = new Map(),
    images = [],
    ctx = { conversation, assistant, signal, offered, lookup };
  const runOne = async step => {
    // 一批里前一件跑着时按了停：后面排着的不再动手（写记忆、起请示都算动手）
    signal.throwIfAborted();
    const started = performance.now(),
      key = toolCacheKey(step),
      cached = key ? toolCache.get(key) : null;
    let outcome;
    if (cached) {
      Object.assign(step, structuredClone(cached.presentation));
      step.cached = true;
      outcome = structuredClone(cached.outcome);
      outcome.content = t`（与本答先前一次同样的调用，结果照搬）\n${outcome.content}`;
      outcome.display = ["复用", outcome.display].filter(Boolean).join(" · ");
    } else {
      outcome = await runTool(step, ctx);
      // 动过外头的（写了文件、跑了指令、调了接口）：先前查到的可能已经不是那样，一概作废
      if (TOOLS.get(step.name)?.sideEffect) toolCache.clear();
      // 只缓存成功的：临时的 502、超时若也缓存，模型想重试只会一直拿到同一个旧失败
      else if (key && outcome.ok) toolCache.set(key, { outcome: structuredClone(outcome), presentation: toolPresentation(step) });
    }
    const remaining = MIN_TOOL_STATUS_MS - (performance.now() - started);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    // 在后台接着做的（差遣）：这一步仍是进行中，做完由它自己收尾；先记一句「后台进行中」，下一问的行迹摘要里模型才知道它还没回来
    // 帮手快，上面凑够显示时长的那一会儿里就已交差：它收尾时记的结果不能被这句盖掉
    if (!outcome.background) step.status = step.skipped ? "skipped" : outcome.ok ? "done" : "error";
    if (!outcome.background || step.status === "running") step.result = outcome.display;
    outcomes.set(step.id, clipForModel(outcome.content, 60000, { hint: t("要看后面的请缩小范围分次取") }));
    if (outcome.images) images.push(...outcome.images);
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
  return { outcomes, images };
}
// 生成结束（停止、出错或中断）时，还在转圈或等待确认的步骤一并收束，不留下永远转圈的卡片。
// 后台还在做的帮手不归这一答管：它不随这一答收尾，做完自己收这一步（见 90-delegate.js）；
// 做它的那一处已不在了（页面刷新、连接中断）的帮手挂着等人续（见 holdHelper），按「止」的照旧收束
/** @param {Message} assistant */
function settleSteps(assistant, note) {
  const live = new Set([...crews.values()].flat().map(box => box.step));
  for (const step of assistant.steps || []) {
    if (live.has(step)) continue;
    if (step.sub && step.status === "running" && note !== "已止") {
      holdHelper(step, note);
      continue;
    }
    settleStepList([step, ...(step.sub?.steps || [])], note);
    if (step.sub?.status === "streaming") step.sub.status = "stopped";
  }
}
/** @param {Step[]} steps */
function settleStepList(steps, note) {
  for (const step of steps)
    if (step.status === "running" || step.status === "pending") {
      pendingApprovals.delete(step.id);
      step.status = step.status === "pending" ? "skipped" : "error";
      step.result = note;
    }
}
// 一答里的全部步骤，含帮手在差遣卡片里跑的那些（只嵌一层：帮手不再差遣）
/** @param {{ steps?: Step[] }} message 消息或帮手 */
function allSteps(message) {
  return (message?.steps || []).flatMap(step => [step, ...(step.sub?.steps || [])]);
}
// 交给模型的长文截短：照实标出截去多少，不然它当那就是全部。tail：留头留尾（回报、日志的结论多在末尾）
function clipForModel(text, limit, { tail = false, hint = "" } = {}) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  const cut = value.length - limit,
    note = t`${cut} 字截去${hint ? `；${hint}` : ""}`;
  if (!tail) return t`${value.slice(0, limit)}\n…（其后 ${note}）`;
  const head = Math.floor(limit * 0.3);
  return t`${value.slice(0, head)}\n…（中间 ${note}）…\n${value.slice(value.length - (limit - head))}`;
}
// 步骤上留着的输出只留末尾一截：指令跑出几万行，整份存进对话既占地方也没人看
const STEP_OUTPUT_KEEP = 6000;
function trimOutput(text) {
  const value = String(text || "");
  return value.length > STEP_OUTPUT_KEEP
    ? t`…（前面 ${value.length - STEP_OUTPUT_KEEP} 字略去）\n${value.slice(-STEP_OUTPUT_KEEP)}`
    : value;
}
function clampNumber(value, fallback, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
}
