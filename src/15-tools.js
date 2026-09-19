// 言 · 工具执行：桥接调用、执事工具、请示与表单、改动统计
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
async function bridge(path, payload, signal) {
  if (apiBase === null) throw Error("本机工具需要本机桥接");
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || `请求失败（${response.status}）`);
  return data;
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
// 工具参数按 JSON 给，但模型写出来的常有小毛病：裹了 ```json 围栏、结尾多一个逗号、整段被 max_tokens 截断、
// 或是把 JSON 又编码成了字符串。这些都能救回来，救不回来才算失败——每失败一次就是白花一轮的墨。
// 去围栏、去多余逗号不丢内容；补齐截断的 JSON 会丢掉末尾残缺的键值对，结果带 truncated 标记：
// 只读工具照用（顶多少一个可选参数），有副作用的工具一律拒绝——写文件时 content 被截掉，救回来的 {"path"} 若照写就把文件清空了
function parseToolArguments(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, args: {} };
  const attempt = value => {
    try {
      const parsed = JSON.parse(value);
      // 有的接口把参数对象又 JSON.stringify 了一遍，解出来是字符串
      if (typeof parsed === "string") return attempt(parsed.trim());
      return parsed && typeof parsed === "object" ? { ok: true, args: Array.isArray(parsed) ? { questions: parsed } : parsed } : null;
    } catch (error) {
      return { error };
    }
  };
  let first = attempt(text);
  if (first?.ok) return first;
  // 去掉 ```json 围栏与前后的闲话，只取第一个 { 到最后一个 }
  const fenced = text.replace(/^[^{[]*```(?:json)?\s*/i, "").replace(/\s*```[^}\]]*$/i, "");
  const start = fenced.search(/[{[]/),
    end = Math.max(fenced.lastIndexOf("}"), fenced.lastIndexOf("]"));
  let body = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
  for (const candidate of [body, body.replace(/,\s*([}\]])/g, "$1")]) {
    const parsed = candidate && candidate !== text ? attempt(candidate) : null;
    if (parsed?.ok) return parsed;
  }
  for (const repaired of repairTruncatedJson(body)) {
    const parsed = attempt(repaired);
    if (parsed?.ok) return { ...parsed, truncated: true };
  }
  return { ok: false, error: String(first?.error?.message || "不是合法 JSON"), raw: text };
}
// 有副作用的工具：参数必须是完整的 JSON，且 schema 里的必填项一个不少，否则不执行
const SIDE_EFFECT_TOOLS = new Set(["run_command", "write_file", "edit_file", "remember", "forget", "delegate"]);
// 按 prompts/tools.js 里的 schema 把参数理顺：模型写参数常有小出入，能理解的都照单收下，只有真讲不通的才算失败——
// 键名写成了常见的别名（file_path → path、cmd → command、old_string → old）、数字与布尔给成了字符串、该是数组的只给了一项、
// 该是数组的整段 JSON 又编码成了字符串、ask_user 把单个问题直接摊在顶层……都在这里归位；必填项理顺后仍缺的才报
const TOOL_ARG_ALIASES = {
  path: ["file_path", "filepath", "filename", "file", "target"],
  command: ["cmd", "script", "shell"],
  content: ["contents", "text", "data", "body", "file_content"],
  old: ["old_string", "old_text", "old_str", "from", "search", "find"],
  new: ["new_string", "new_text", "new_str", "to", "replacement", "replace"],
  query: ["q", "keyword", "keywords", "search", "term"],
  url: ["link", "href", "page"],
  task: ["prompt", "instruction", "instructions", "description"],
  name: ["document", "doc", "file"],
  id: ["conversation_id", "conversationId", "memory_id"]
};
function coerceToolValue(value, rule) {
  const type = rule?.type;
  if (value === undefined || value === null || !type) return value;
  if (type === "string") {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value) && value.every(item => typeof item === "string")) return value.join("\n");
    return JSON.stringify(value, null, 2);
  }
  if (type === "number" || type === "integer") {
    if (typeof value === "number") return value;
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : value;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    return ["true", "yes", "1", "是"].includes(text) ? true : ["false", "no", "0", "否", ""].includes(text) ? false : value;
  }
  if (type === "array" || type === "object") {
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = value;
      }
    }
    if (type === "array") return Array.isArray(parsed) ? parsed : [parsed];
    return parsed;
  }
  return value;
}
function normalizeToolArguments(name, raw) {
  const spec = PROMPTS.tools?.[name]?.parameters,
    args = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  if (!spec?.properties) return { args, problems: [] };
  const known = new Set(Object.keys(spec.properties));
  // 别名归位：schema 里没有这个键、参数里也没给正名时，把别名的值挪过来
  for (const [key, aliases] of Object.entries(TOOL_ARG_ALIASES)) {
    if (!known.has(key) || args[key] !== undefined) continue;
    const alias = aliases.find(item => !known.has(item) && args[item] !== undefined);
    if (alias) args[key] = args[alias];
  }
  // 必填的数组只给了一项、还把那一项的字段摊在顶层（ask_user 常见：{"question":…,"options":…}）：包成一项
  for (const key of spec.required || []) {
    const rule = spec.properties[key];
    if (args[key] !== undefined || rule?.type !== "array" || !rule.items?.properties) continue;
    const itemKeys = Object.keys(rule.items.properties);
    if (itemKeys.some(item => args[item] !== undefined)) {
      const one = {};
      for (const item of itemKeys) if (args[item] !== undefined) one[item] = args[item];
      args[key] = [one];
    }
  }
  for (const [key, rule] of Object.entries(spec.properties)) args[key] = coerceToolValue(args[key], rule);
  const problems = [];
  for (const key of spec.required || []) if (args[key] === undefined || args[key] === null) problems.push(`缺少必填参数 ${key}`);
  return { args, problems };
}
// 被截断的 JSON：补齐未闭合的括号，能救多少是多少——先试直接补齐（截在一个值刚写完的地方），
// 不行再退到最后一个安全的逗号处（末尾那个残缺的键值对丢掉）。给出几个候选，由调用方逐个试
function repairTruncatedJson(text) {
  const stack = [];
  let inString = false,
    escaped = false,
    lastSafe = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && stack.length) lastSafe = i;
  }
  if (!stack.length && !inString) return [];
  const closers = stack.reverse().join(""),
    candidates = [];
  if (!inString) candidates.push(text.replace(/,\s*$/, "") + closers);
  // 截在半截的字符串或键值对里：退回最后一个安全的逗号处
  if (lastSafe > 0) candidates.push(text.slice(0, lastSafe) + closers);
  return candidates;
}
/** @param {Step} step */
function toolCacheKey(step) {
  const parsed = parseToolArguments(step.arguments);
  if (!parsed.ok) return `${step.name}:invalid:${String(step.arguments || "")}`;
  const args = parsed.args;
  if (step.name === "search_web")
    args.query = String(args.query || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  if (step.name === "fetch_page") {
    try {
      const url = new URL(String(args.url || ""));
      url.hash = "";
      args.url = url.href;
    } catch {
      args.url = String(args.url || "").trim();
    }
  }
  if (step.name === "read_document") {
    args.name = String(args.name || "")
      .trim()
      .toLowerCase();
    if (args.query) args.query = String(args.query).trim().toLowerCase();
    if (args.page) args.page = Number(args.page);
  }
  return `${step.name}:${JSON.stringify(stableToolJson(args))}`;
}
// 参数出错时回给模型的一行 schema 摘要，取自 prompts/tools.js 的定义
function toolSchemaHint(name) {
  const spec = PROMPTS.tools?.[name]?.parameters;
  if (!spec?.properties) return "见工具定义";
  const required = new Set(spec.required || []);
  return Object.entries(spec.properties)
    .map(([key, value]) => `${key}（${value.type || "any"}${required.has(key) ? "，必填" : "，可选"}）`)
    .join("、");
}
/** @param {Step} step */
function toolPresentation(step) {
  return {
    title: step.title || "",
    url: step.url || "",
    note: step.note || "",
    results: Array.isArray(step.results) ? structuredClone(step.results) : null
  };
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runTool(step, conversation, assistant, signal) {
  const parsed = parseToolArguments(step.arguments);
  if (!parsed.ok)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数不是合法 JSON（${parsed.error}）。arguments 必须是一个 JSON 对象，不要加代码围栏、注释或多余的逗号，也不要把它再编码成字符串；内容过长时先精简再发。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（前 300 字）：${String(parsed.raw || "").slice(0, 300)}`,
      display: "参数解析失败"
    };
  const sideEffect = SIDE_EFFECT_TOOLS.has(step.name);
  // 截断的参数救回来也不能拿去写：内容已经不全，写下去就是把文件写坏
  if (parsed.truncated && sideEffect)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数 JSON 不完整（多半是输出被最大长度截断），为安全起见没有执行。请把内容精简或分成几次写入（大文件先 write_file 写开头，再用 edit_file 追加），确保 arguments 是完整的 JSON。这件工具收的参数：${toolSchemaHint(step.name)}\n\n收到的原文（末尾 200 字）：…${String(step.arguments || "").slice(-200)}`,
      display: "参数不完整"
    };
  const { args, problems } = normalizeToolArguments(step.name, parsed.args);
  if (problems.length)
    return {
      ok: false,
      content: `调用 ${step.name} 的参数不合要求：${problems.join("；")}。这件工具收的参数：${toolSchemaHint(step.name)}；实际收到的键：${Object.keys(parsed.args || {}).join("、") || "（无）"}${parsed.truncated ? "\n（参数 JSON 不完整，可能是输出被截断）" : ""}\n\n收到的原文（前 300 字）：${String(step.arguments || "").slice(0, 300)}`,
      display: "参数不合要求"
    };
  // 帮手对记忆只读：几名帮手同时改、删全局记忆没人把关，记与忘留给主模型
  if (step.scope && (step.name === "remember" || step.name === "forget"))
    return {
      ok: false,
      content: "帮手不能改动记忆（remember / forget 只有主模型可用）；需要记下的事写进回报里，由主模型决定。",
      display: "帮手无权"
    };
  try {
    if (step.name === "search_web") {
      step.title = String(args.query || "");
      const data = await bridge("/api/search", { query: step.title, count: 6 }, signal);
      step.results = (data.results || []).map(({ title, url, snippet }) => ({ title, url, snippet }));
      return {
        ok: true,
        content: step.results.length ? JSON.stringify(step.results) : "未找到结果",
        display: `${step.results.length} 条结果`
      };
    }
    if (step.name === "fetch_page") {
      step.url = String(args.url || "");
      const data = await bridge("/api/fetch", { url: step.url }, signal);
      step.title = data.title || step.url;
      return {
        ok: true,
        content: `标题：${data.title || ""}\n地址：${data.url || step.url}\n\n${data.text || ""}`,
        display: `${(data.text || "").length} 字`
      };
    }
    if (step.name === "read_document") return await readDocumentTool(step, args, conversation);
    if (MEMORY_TOOLS.has(step.name)) return runMemoryTool(step, args, conversation);
    if (step.name === "ask_user") return await askUserTool(step, args, conversation, assistant, signal);
    if (step.name === "delegate") return await runDelegate(step, args, conversation, assistant, signal);
    if (WORK_TOOLS.has(step.name)) return await runWorkTool(step, args, conversation, assistant, signal);
    return { ok: false, content: `未知工具 ${step.name}`, display: "未知工具" };
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return {
      ok: false,
      content: `工具执行失败：${String(error.message || error)}`,
      display: friendlyError(String(error.message || error)).slice(0, 60)
    };
  }
}
// 执事模式的四件事。run_command 默认问而后行：步骤卡上给出「运行 / 跳过 / 径行」，模型等用户点了才继续
const WORK_TOOLS = new Set(["run_command", "write_file", "edit_file", "read_file", "list_files", "search_files"]),
  // 言（对谈）里只给这四件：对谈的文件工具只为产出成品，逐字替换与代码检索是执事的活
  CHAT_FILE_TOOLS = ["run_command", "write_file", "read_file", "list_files"],
  pendingApprovals = new Map();
// 只读指令免确认：命令本身只是查看，且不带任何管道、重定向或串联，才算只读
const READ_ONLY_COMMAND =
  /^(?:git\s+(?:status|log|diff|show|rev-parse|ls-files|remote\s+-v)\b|git\s+branch(?:\s+(?:-a|-r|-v|-vv|--list))*\s*$|(?:ls|dir|tree|pwd|cat|type|head|tail|wc|grep|findstr|which|where|whoami)\b|Get-(?:ChildItem|Content|Location|Command|Item|Date)\b|Select-String\b|(?:node|npm|npx|python|python3|pip|dotnet|java|go|cargo|rustc|ruby|php)\s+(?:-v|-V|--version|version)\s*$)/i;
function isReadOnlyCommand(command) {
  const text = String(command || "").trim();
  if (/[;&|<>`\n]|\$\(/.test(text)) return false;
  return READ_ONLY_COMMAND.test(text);
}
// 本段对话里读过或写过的文件才允许 edit_file：模型必须对着真实内容改，而不是凭记忆猜。
// 帮手另记一份（按步骤上的 scope 分开）：主模型没亲眼读过帮手改过的文件，要改就得再读一遍，帮手亦然
const workSeen = new Map();
// 键里带上目录：对话中途换了目录，之前读过的文件不算数
/**
 * @param {Conversation} conversation
 * @param {Step} step
 */
function seenKey(conversation, step) {
  const base = `${conversation.id}@${workRoot(conversation)}`;
  return step?.scope ? `${base}/${step.scope}` : base;
}
function normalizeWorkPath(file) {
  const parts = [];
  for (const part of String(file || "")
    .replace(/\\/g, "/")
    .split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
/**
 * @param {Conversation} conversation
 * @param {Step} step
 */
function markSeen(conversation, file, step = null) {
  const key = seenKey(conversation, step);
  let set = workSeen.get(key);
  if (!set) {
    set = new Set();
    workSeen.set(key, set);
  }
  set.add(normalizeWorkPath(file));
}
const STEP_OUTPUT_KEEP = 6000;
/**
 * @param {Step} step
 * @param {Conversation} conversation
 */
function awaitApproval(step, conversation, signal) {
  return new Promise((resolve, reject) => {
    const done = value => {
      pendingApprovals.delete(step.id);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      pendingApprovals.delete(step.id);
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingApprovals.set(step.id, { conversationId: conversation.id, resolve: done, step });
    renderApprovalBar();
  }).finally(renderApprovalBar);
}
// 请示条：指令等待确认时从输入框上方浮出，不必去行迹里找那一行；输入框留空时按 Enter 即运行
function pendingApprovalHere() {
  const c = currentConversation();
  if (!c) return null;
  for (const entry of pendingApprovals.values()) if (entry.conversationId === c.id && entry.step) return entry;
  return null;
}
function renderApprovalBar() {
  const bar = $("#approvalBar");
  if (!bar) return;
  const entry = view === "chat" ? pendingApprovalHere() : null;
  if (!entry) {
    bar.dataset.stepId = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  if (bar.dataset.stepId !== entry.step.id) {
    bar.dataset.stepId = entry.step.id;
    bar.dataset.page = "0";
    bar.innerHTML = approvalBarHtml(entry.step);
    formPage(bar);
  }
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function askUserTool(step, args, conversation, assistant, signal) {
  const questions = (Array.isArray(args.questions) ? args.questions : [])
    .slice(0, 8)
    .map(q => ({
      question: String(q?.question || "")
        .trim()
        .slice(0, 200),
      header: String(q?.header || "")
        .trim()
        .slice(0, 12),
      multi: q?.multi === true,
      options: (Array.isArray(q?.options) ? q.options : [])
        .slice(0, 4)
        // 选项按字符串给：「选项 — 一句说明」；旧的 { label, description } 对象也照收
        .map(o =>
          typeof o === "string"
            ? (([label, ...rest]) => ({ label: label.trim().slice(0, 60), description: rest.join("—").trim().slice(0, 120) }))(
                o.split(/\s+[—–-]{1,2}\s+|—/)
              )
            : {
                label: String(o?.label || "")
                  .trim()
                  .slice(0, 60),
                description: String(o?.description || "")
                  .trim()
                  .slice(0, 120)
              }
        )
        .filter(o => o.label)
    }))
    .filter(q => q.question);
  if (!questions.length)
    return {
      ok: false,
      content: `没能从参数里读出问题。questions 是一个数组，每项至少要有 question（完整的问句）与 options（2–4 个字符串选项），要多选就给 multi: true。例如：{"questions":[{"question":"用哪种风格？","header":"风格","options":["清简 — 留白多","繁复 — 信息密"],"multi":false}]}${
        Array.isArray(args.questions)
          ? `\n收到了 ${args.questions.length} 项，但没有一项带得出 question。`
          : `\n收到的 questions 是 ${typeof args.questions}，不是数组。`
      }`,
      display: "表单为空"
    };
  // 一个选项都没有的题只能靠自填，多半是模型漏了 options：补一句提醒，但表单照出，不白费这一轮
  const missing = questions.filter(q => q.options.length < 2).length;
  step.form = { questions };
  step.title = questions
    .map(q => q.header || q.question)
    .join(" · ")
    .slice(0, 80);
  const job = requestJob(conversation.id);
  step.status = "pending";
  if (job) setJobLabel(conversation, job, "等待确认");
  refreshSteps(assistant);
  saveStore();
  renderHistory();
  const answers = await awaitApproval(step, conversation, signal);
  step.status = "running";
  if (job) setJobLabel(conversation, job, "生成中");
  refreshSteps(assistant);
  renderHistory();
  if (!Array.isArray(answers)) {
    step.skipped = true;
    return { ok: false, content: "用户没有作答。请按你的最佳判断继续，并在正文里说明你做了什么假设。", display: "未作答" };
  }
  step.answers = answers;
  step.note = questions.map((q, i) => `${q.header || q.question}：${answers[i] || "（未答）"}`).join("；");
  return {
    ok: true,
    content: `${questions.map((q, i) => `${q.question}\n→ ${answers[i] || "（未答）"}`).join("\n\n")}${missing ? `\n\n（有 ${missing} 题没给够选项，只能由用户自填；下次每题给 2–4 个选项。）` : ""}`,
    display: "已作答"
  };
}
/** @param {Step} step */
function askStepHtml(step) {
  const status = step.status || "done",
    meta =
      status === "pending"
        ? "待作答"
        : status === "skipped"
          ? escapeHtml(step.result || "未作答")
          : status === "error"
            ? escapeHtml(step.result || "失败")
            : escapeHtml(step.result || "已作答");
  const body =
    status === "done" && step.answers
      ? `<div class="tool-note">${escapeHtml(step.note || "")}</div>`
      : status === "pending"
        ? `<div class="tool-note">请于输入框上方作答</div>`
        : "";
  return `<div class="tool-step" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">请示</span><span class="tool-title" title="${escapeHtml(step.title)}">${escapeHtml(step.title)}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
// 右上角只写一个快捷键：这一页按 Enter 是下一题还是提交（输入框留空时），随翻页改，见 formPage；题数与第几问在标题里
/** @param {Step} step */
function approvalBarHtml(step) {
  if (step.name !== "ask_user")
    return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title">执事请示 · 运行此指令</span><span class="approval-hint" title="输入框留空时，Enter 即运行">Enter 运行</span></div><pre class="approval-cmd">${escapeHtml(step.title)}</pre><div class="approval-actions"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="径行：此对话中后续指令不再询问">径行</button></div>`;
  const questions = step.form?.questions || [];
  const block = (q, i) =>
    `<div class="ask-q" data-q="${i}" data-multi="${q.multi ? "true" : "false"}"><div class="ask-question">${q.header ? `<span class="ask-header">${escapeHtml(q.header)}</span>` : ""}${escapeHtml(q.question)}${q.multi ? `<span class="ask-multi">可多选</span>` : ""}</div><div class="ask-options" role="${q.multi ? "group" : "radiogroup"}">${q.options.map((o, j) => `<button type="button" class="ask-opt" role="${q.multi ? "checkbox" : "radio"}" aria-checked="false" data-opt="${j}"><span class="ask-tick" aria-hidden="true"></span><span class="ask-opt-copy"><strong>${escapeHtml(o.label)}</strong>${o.description ? `<small>${escapeHtml(o.description)}</small>` : ""}</span></button>`).join("")}</div><input class="ask-other" type="text" maxlength="200" placeholder="${q.options.length ? (q.multi ? "还可自行补充" : "或自行填写") : "请填写"}" aria-label="自行填写"></div>`;
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title"></span><span class="approval-hint" title="输入框留空时，Enter 即作答"></span></div><div class="ask-form">${questions.map(block).join("")}</div><div class="approval-actions ask-nav"><span class="ask-spacer"></span><button type="button" class="ask-arrow" data-form="prev" title="上一题" aria-label="上一题">‹</button><button type="button" class="ask-arrow" data-form="next" title="下一题（未答即跳过）" aria-label="下一题">›</button><button type="button" class="ask-arrow ask-done" data-form="submit" title="提交" aria-label="提交">✓</button></div>`;
}
function formPage(bar, page = null) {
  const blocks = [...bar.querySelectorAll(".ask-q")];
  if (!blocks.length) return;
  const total = blocks.length,
    current = Math.max(0, Math.min(total - 1, page ?? Number(bar.dataset.page || 0)));
  bar.dataset.page = String(current);
  blocks.forEach((block, index) => block.classList.toggle("hidden", index !== current));
  bar.querySelector(".approval-title").textContent = total === 1 ? "有一问" : `第${chineseNumber(current + 1)}问 · 共 ${total} 问`;
  bar.querySelector(".approval-hint").textContent = current === total - 1 ? "Enter 提交" : "Enter 下一题";
  bar.querySelector('[data-form="prev"]').disabled = current === 0;
  bar.querySelector('[data-form="next"]').classList.toggle("hidden", current === total - 1);
  bar.querySelector('[data-form="submit"]').classList.toggle("hidden", current !== total - 1);
  if (page !== null) setTimeout(() => blocks[current].querySelector(".ask-opt, .ask-other")?.focus(), 0);
}
function collectForm(bar) {
  const step = pendingApprovalHere()?.step;
  if (!step?.form) return null;
  return step.form.questions.map((q, i) => {
    const block = bar.querySelector(`.ask-q[data-q="${i}"]`);
    if (!block) return "";
    const picked = [...block.querySelectorAll('.ask-opt[aria-checked="true"]')].map(b => b.querySelector("strong").textContent),
      other = block.querySelector(".ask-other")?.value.trim();
    return [...picked, ...(other ? [other] : [])].join("、");
  });
}
function approveFrom(button) {
  const stepId = button.closest("[data-step-id]")?.dataset.stepId,
    c = currentConversation();
  if (!stepId || !c) return;
  if (button.dataset.approve === "auto") {
    c.workAuto = true;
    saveStore();
    renderWorkAuto();
  }
  settleApproval(stepId, button.dataset.approve !== "skip");
}
// 改动摘要：这一答里执事改过哪些文件、各增减多少行，挂在回复末尾，写入/修改一落地就实时累加，不等整条回复收尾
function diffCounts(oldText, newText) {
  const a = String(oldText || "").split(/\r?\n/),
    b = String(newText || "").split(/\r?\n/);
  if (!oldText) return { added: b.length, removed: 0 };
  if (!newText) return { added: 0, removed: a.length };
  if (a.length * b.length > 250000) return { added: b.length, removed: a.length };
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const common = dp[0][0];
  return { added: b.length - common, removed: a.length - common };
}
/** @param {{ steps?: Step[] }} message */
function changeStats(message) {
  const files = new Map();
  for (const step of allSteps(message)) {
    if (!step.change || step.status !== "done") continue;
    const entry = files.get(step.change.path) || { path: step.change.path, added: 0, removed: 0, created: false };
    entry.added += step.change.added;
    entry.removed += step.change.removed;
    entry.created ||= !!step.change.created;
    files.set(step.change.path, entry);
  }
  const list = [...files.values()];
  return { files: list, added: list.reduce((sum, f) => sum + f.added, 0), removed: list.reduce((sum, f) => sum + f.removed, 0) };
}
/** @param {Message} message */
function changeSummaryInner(message, open) {
  const stats = changeStats(message);
  if (!stats.files.length) return "";
  const count = `<span class="ins">+${stats.added}</span> <span class="del">−${stats.removed}</span>`;
  return `<button type="button" class="change-summary" aria-expanded="${open}"><span>${stats.files.length} 个文件已更改</span><span class="change-count">${count}</span></button><div class="change-files${open ? "" : " hidden"}">${stats.files.map(f => `<div><span class="path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}${f.created ? " <em>新建</em>" : ""}</span><span class="ins">+${f.added}</span><span class="del">−${f.removed}</span></div>`).join("")}</div>`;
}
// 成品：言里这一答在卷宗根目录新出或改过的文件。一件一行：类型、文件名、大小，右侧「看」（悬浮预览）与「下载」
// 卷宗里已经删掉的成品：条目留着（这一答确实出过这件），但标成「已移出卷宗」，不再给看与下载的按钮
function deliverableMissing(path) {
  return archiveOnline() && archiveEntries !== null && !archiveEntries.some(entry => entry.path === path);
}
function deliverableFileHtml(f) {
  const missing = deliverableMissing(f.path);
  return `<div class="deliver-file${missing ? " missing" : ""}" data-deliver="${escapeHtml(f.path)}"><span class="deliver-type">${escapeHtml(fileTypeLabel(f))}</span><span class="deliver-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span><small>${formatFileSize(f.size)}</small>${
    missing
      ? `<span class="deliver-gone">已移出卷宗</span>`
      : `<button type="button" class="deliver-btn" data-deliver-action="view" title="在此预览，不必下载">预览</button><button type="button" class="deliver-btn" data-deliver-action="download" title="另存到本机">下载</button>`
  }</div>`;
}
/** @param {Message} message */
function deliverablesHtml(message) {
  const files = message.deliverables || [];
  if (!files.length) return "";
  return `<div class="deliver-bar"><div class="deliver-head"><span class="seal deliver-seal" aria-hidden="true">成</span><span>成品 ${files.length} 件 · 已入卷宗</span></div>${files.map(deliverableFileHtml).join("")}</div>`;
}
// 卷宗目录刷新后，把页面上成品条里各件的在与不在同步一遍（消息本身没变，不必重画整条）
function syncDeliverables() {
  for (const bar of document.querySelectorAll(".deliver-bar")) {
    const article = bar.closest("[data-message]"),
      c = currentConversation(),
      message = c && allMessages(c).find(m => m.id === article?.dataset.message);
    if (!message?.deliverables?.length) continue;
    const html = message.deliverables.map(deliverableFileHtml).join("");
    const current = [...bar.querySelectorAll(".deliver-file")].map(node => node.outerHTML).join("");
    if (current !== html) bar.querySelectorAll(".deliver-file").forEach(node => node.remove()), bar.insertAdjacentHTML("beforeend", html);
  }
}
/** @param {Message} message */
function changeSummaryHtml(message, open = false) {
  const inner = changeSummaryInner(message, open);
  return inner ? `<div class="change-bar">${inner}</div>` : "";
}
// 步骤每次刷新都把改动条同步到回复末尾：数字就地更新（展开状态保留），首次出现时轻浮一下
/** @param {Message} assistant */
function syncChangeBar(block, assistant) {
  const bar = block.querySelector(":scope > .change-bar"),
    open = bar?.querySelector(".change-summary")?.getAttribute("aria-expanded") === "true",
    inner = changeSummaryInner(assistant, open);
  if (!inner) return bar?.remove();
  if (!bar) {
    block.insertAdjacentHTML("beforeend", `<div class="change-bar is-new">${inner}</div>`);
  } else if (bar.innerHTML !== inner) bar.innerHTML = inner;
}
function settleApproval(stepId, value) {
  const entry = pendingApprovals.get(stepId);
  if (entry) entry.resolve(value);
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
/** @param {Step} step */
function subChangedPaths(step) {
  return [...new Set((step.sub?.steps || []).filter(s => s.change && s.status === "done").map(s => s.change.path))];
}
// 差遣：主模型把一件自成一段的子任务交给帮手。帮手用同一个模型、同一套工具（不再差遣、不请示用户）另起一段对话跑自己的工具轮次（上限见设置），
// 步骤都画在主对话这条消息的差遣卡片里（指令照样问而后行），做完把最后一轮的回报连同改动摘要作为工具结果交回主模型
/**
 * @param {Step} step
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runDelegate(step, args, conversation, assistant, signal) {
  const task = String(args.task || "").trim();
  step.title =
    String(args.title || "")
      .trim()
      .slice(0, 40) || task.slice(0, 24);
  if (!task) return { ok: false, content: "task 不能为空：请把背景、目标、边界与要回报的内容写全", display: "任务为空" };
  const job = requestJob(conversation.id),
    profile = job?.profile || activeProfile();
  if (!profile) return { ok: false, content: "没有可用的模型", display: "无模型" };
  const tools = toolDefinitions(conversation, { sub: true });
  if (!tools) return { ok: false, content: "此对话里没有可交给帮手的工具", display: "无工具可用" };
  /** @type {SubAgent} */
  const sub = { id: `sub-${uid()}`, task, content: "", reasoning: "", steps: [], status: "streaming", usage: null, rounds: 0 };
  step.sub = sub;
  step.subOpen = true;
  const history = [{ role: "user", content: task }];
  const overrides = {
    systemPrompt: `${assistantHint(profile, tools, conversation)}\n\n${prompt("delegate.system")}`,
    tools,
    enableSearch: modelSearchEnabled(profile),
    reasoning: conversation.reasoning || ""
  };
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    toolCache = new Map(),
    started = performance.now();
  // 帮手的话是逐字流进来的，卡片每隔一小会儿刷一次，不必每个字都重画
  let painted = "";
  const paint = () => {
    const sig = `${sub.content.length}|${sub.reasoning.length}|${sub.status}|${sub.steps.map(s => s.status).join("")}`;
    if (sig === painted) return;
    painted = sig;
    refreshSteps(assistant);
  };
  const ticker = setInterval(paint, 350);
  let reportStart = 0,
    failure = "";
  try {
    for (;;) {
      sub.toolCalls = null;
      sub.usage = null;
      reportStart = sub.content.length;
      await readReply(profile, history, signal, overrides, sub);
      if (sub.usage) for (const key of Object.keys(usage)) usage[key] += Number(sub.usage[key] || 0);
      const calls = (sub.toolCalls || []).filter(call => call.name);
      if (!calls.length || !overrides.tools) break;
      if (++sub.rounds > subRoundLimit()) {
        const said = sub.content.slice(reportStart).trim();
        if (said) history.push({ role: "assistant", content: said });
        history.push({ role: "user", content: prompt("delegate.limit") });
        overrides.tools = null;
        if (sub.content) sub.content += "\n\n";
        continue;
      }
      /** @type {Step[]} */
      const steps = calls.map(call => ({
        id: call.id || `call_${uid().slice(0, 8)}`,
        name: call.name,
        arguments: call.arguments || "{}",
        status: "running",
        at: sub.content.length,
        rat: String(sub.reasoning || "").length,
        scope: sub.id
      }));
      sub.steps.push(...steps);
      refreshSteps(assistant);
      history.push({
        role: "assistant",
        content: sub.content.slice(reportStart) || null,
        tool_calls: steps.map(s => ({ id: s.id, type: "function", function: { name: s.name, arguments: s.arguments } })),
        ...(sub.thinkingBlocks?.length ? { thinking_blocks: sub.thinkingBlocks } : {})
      });
      const outcomes = await runSteps(steps, conversation, assistant, signal, toolCache);
      for (const s of steps) history.push({ role: "tool", tool_call_id: s.id, content: outcomes.get(s.id) ?? "" });
      if (sub.content) sub.content += "\n\n";
      if (job) setJobLabel(conversation, job, "帮手工作中");
    }
    sub.status = "complete";
  } catch (error) {
    if (error.name === "AbortError") {
      sub.status = "stopped";
      throw error;
    }
    sub.status = "error";
    failure = friendlyError(String(error.message || error));
  } finally {
    clearInterval(ticker);
    sub.usage = usage.total_tokens ? usage : null;
    sub.durationMs = Math.round(performance.now() - started);
    sub.report = sub.content.slice(reportStart).trim();
    sub.content = sub.content.replace(/^\n+|\n+$/g, "");
    if (job) setJobLabel(conversation, job, "生成中");
    step.subOpen = false;
    paint();
  }
  const changed = subChangedPaths(step),
    stats = changeStats({ steps: [step] }),
    changedNote = changed.length ? `，改了 ${changed.length} 个文件：${changed.join("、")}（+${stats.added} −${stats.removed}）` : "",
    seconds = Math.round(sub.durationMs / 1000),
    display = `${sub.steps.length} 步${changed.length ? ` · 改 ${changed.length} 个文件` : ""} · ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分`}`;
  if (sub.status !== "complete")
    return {
      ok: false,
      content: prompt("delegate.failed", {
        reason: failure || "未收到回报",
        steps: sub.steps.length,
        changed: changedNote,
        partial: sub.report ? `它最后说：${sub.report.slice(0, 4000)}` : ""
      }),
      display: `${display} · 未完成`
    };
  if (!sub.report)
    return {
      ok: false,
      content: prompt("delegate.failed", { reason: "帮手没有写回报", steps: sub.steps.length, changed: changedNote, partial: "" }),
      display: `${display} · 无回报`
    };
  return {
    ok: true,
    content: prompt("delegate.report", { steps: sub.steps.length, changed: changedNote, report: sub.report.slice(0, 16000) }),
    display
  };
}
// 每次发送前把工具的落脚目录备好。行：桥接必须在线、工作目录仍在（被删了就重建），否则不发；
// 言：桥接在线就顺手把卷宗目录备好，备不好也照常聊（工具用到时自会报错）
/** @param {Conversation} conversation */
async function ensureWorkReady(conversation) {
  if (!isWork(conversation)) {
    const archive = workRoot(conversation);
    // 备的是草稿目录，卷宗根随之建好
    if (archive && activeProfile()?.tools !== false)
      await bridge(
        "/api/work/prepare",
        { workdir: `${archive}${archive.includes("/") && !archive.includes("\\") ? "/" : "\\"}${scratchRel(conversation)}` },
        AbortSignal.timeout(8000)
      ).catch(error => toast(`卷宗目录不可用：${String(error.message || error)}`));
    return true;
  }
  if (activeProfile()?.tools === false) {
    toast("当前模型已关闭本机工具，请在模型高级配置中开启");
    return false;
  }
  if (apiBase === null && !(await ensureLocalBridge())) {
    toast("执事需要本机桥接，请先运行 start.cmd");
    return false;
  }
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: conversation.workdir }, AbortSignal.timeout(8000));
    if (prepared.created) toast("工作目录不存在，已新建");
    conversation.workdir = prepared.workdir;
  } catch (error) {
    toast(`工作目录不可用：${String(error.message || error)}`);
    return false;
  }
  return true;
}
function trimOutput(text) {
  const value = String(text || "");
  return value.length > STEP_OUTPUT_KEEP ? `…（前面 ${value.length - STEP_OUTPUT_KEEP} 字略去）\n${value.slice(-STEP_OUTPUT_KEEP)}` : value;
}
// 文件工具能不能出目录：设置里的「可及范围」，默认全盘（系统级配置、别处的资料本就该读得到）
function roamAllowed() {
  return store.settings.toolReach !== "inside";
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 * @param {Message} assistant
 */
async function runWorkTool(step, args, conversation, assistant, signal) {
  const workdir = workRoot(conversation),
    roam = roamAllowed(),
    sandbox = sandboxed();
  if (!workdir) return { ok: false, content: "此对话没有可用的目录（本机桥接不在线）", display: "无目录" };
  const job = requestJob(conversation.id);
  if (step.name === "run_command") {
    step.title = String(args.command || "").trim();
    if (!step.title) return { ok: false, content: "指令为空", display: "指令为空" };
    step.readOnly = isReadOnlyCommand(step.title);
    // 只有行才问；言里落在卷宗的指令径直执行
    if (isWork(conversation) && !conversation.workAuto && !step.readOnly) {
      step.status = "pending";
      if (job) setJobLabel(conversation, job, "等待确认");
      refreshSteps(assistant);
      saveStore();
      renderHistory();
      const approved = await awaitApproval(step, conversation, signal);
      step.status = "running";
      if (job) setJobLabel(conversation, job, "执行中");
      refreshSteps(assistant);
      renderHistory();
      if (!approved) {
        step.skipped = true;
        return { ok: false, content: prompt("work.skipped"), display: "已跳过" };
      }
    } else if (job) setJobLabel(conversation, job, "执行中");
    const data = await bridge("/api/work/run", { workdir, sandbox, command: step.title, timeout: Number(args.timeout) || 120 }, signal);
    step.exitCode = data.exitCode;
    step.output = trimOutput([data.stdout, data.stderr].filter(Boolean).join(data.stdout && data.stderr ? "\n--- stderr ---\n" : ""));
    const seconds = (data.durationMs / 1000).toFixed(data.durationMs < 10000 ? 1 : 0);
    const display = `${data.timedOut ? `超时终止 · ${seconds}s` : data.exitCode === 0 ? `完成 · ${seconds}s` : `退出码 ${data.exitCode} · ${seconds}s`}${step.readOnly && !conversation.workAuto && isWork(conversation) ? " · 只读免确认" : ""}`;
    return {
      ok: !data.timedOut && data.exitCode === 0,
      content: `退出码：${data.exitCode}${data.timedOut ? "（超时被终止）" : ""}\n--- stdout ---\n${data.stdout || "(空)"}\n--- stderr ---\n${data.stderr || "(空)"}`,
      display
    };
  }
  if (step.name === "write_file") {
    step.title = String(args.path || "");
    const data = await bridge("/api/work/write", { workdir, roam, sandbox, path: step.title, content: String(args.content ?? "") }, signal);
    step.title = data.path;
    markSeen(conversation, data.path, step);
    step.note = `${data.lines} 行 · ${formatFileSize(data.bytes)}${data.existed ? " · 覆盖" : ""}`;
    step.change = {
      path: data.path,
      added: data.lines,
      removed: data.existed ? Number(data.previousLines) || 0 : 0,
      created: !data.existed
    };
    return {
      ok: true,
      content: `已写入 ${data.path}（${data.bytes} 字节，${data.lines} 行${data.existed ? "，覆盖了原文件" : ""}）`,
      display: data.existed ? "已覆盖" : "已写入"
    };
  }
  if (step.name === "read_file") {
    step.title = String(args.path || "");
    const data = await bridge(
      "/api/work/read",
      { workdir, roam, sandbox, path: step.title, offset: args.offset, limit: args.limit },
      signal
    );
    step.title = data.path;
    markSeen(conversation, data.path, step);
    return {
      ok: true,
      content: `${data.path}（共 ${data.totalLines} 行，此处第 ${data.offset}–${data.offset + data.shown - 1} 行）\n${data.text}`,
      display: `${data.shown}/${data.totalLines} 行`
    };
  }
  if (step.name === "edit_file") {
    step.title = String(args.path || "");
    const seen = workSeen.get(seenKey(conversation, step)),
      normalized = normalizeWorkPath(step.title);
    if (!seen?.has(normalized)) return { ok: false, content: prompt("work.unread", { path: step.title }), display: "需先读取" };
    const data = await bridge(
      "/api/work/edit",
      {
        workdir,
        roam,
        sandbox,
        path: step.title,
        old: String(args.old ?? ""),
        new: String(args.new ?? ""),
        replaceAll: args.replace_all === true
      },
      signal
    );
    step.title = data.path;
    step.diff = { old: String(args.old ?? "").slice(0, 1500), new: String(args.new ?? "").slice(0, 1500) };
    const counts = diffCounts(String(args.old ?? ""), String(args.new ?? ""));
    step.change = { path: data.path, added: counts.added * data.replaced, removed: counts.removed * data.replaced };
    return {
      ok: true,
      content: `已修改 ${data.path}：第 ${data.line} 行起替换 ${data.replaced} 处，文件现为 ${data.lines} 行`,
      display: `第 ${data.line} 行 · ${data.replaced} 处`
    };
  }
  if (step.name === "search_files") {
    step.title = String(args.query || "");
    const data = await bridge(
      "/api/work/search",
      { workdir, roam, sandbox, query: step.title, path: args.path, glob: args.glob, literal: args.literal === true, limit: args.limit },
      signal
    );
    const lines = data.matches.map(match => `${match.file}:${match.line}: ${match.text}`);
    step.output = trimOutput(lines.join("\n"));
    step.note = data.matches.length ? "" : "无匹配";
    return {
      ok: true,
      content: lines.length
        ? `${lines.join("\n")}${data.truncated ? "\n…（结果已截断，请缩小范围或加 glob）" : ""}`
        : `未找到匹配「${step.title}」的内容（扫描了 ${data.scanned} 个文件）`,
      display: `${data.matches.length} 处 · ${data.files} 文件`
    };
  }
  step.title = `${String(args.path || ".")}${args.pattern ? ` · ${args.pattern}` : ""}`;
  const data = await bridge(
    "/api/work/list",
    { workdir, roam, sandbox, path: args.path, depth: args.depth, pattern: args.pattern },
    signal
  );
  step.title = `${data.path}${args.pattern ? ` · ${args.pattern}` : ""}`;
  step.output = trimOutput(data.entries.join("\n"));
  return {
    ok: true,
    content: data.entries.length
      ? `${data.entries.join("\n")}${data.truncated ? "\n…（条目过多已截断，请指定子目录）" : ""}`
      : "（空目录）",
    display: `${data.entries.length} 项`
  };
}
// 磁盘卷宗里的文档：取回原件，文本直接用，PDF / Office 在本机抽正文；按路径与修改时间缓存几份
const archiveDocCache = new Map();
async function archiveDocumentText(doc) {
  const key = `${doc.archive}|${doc.modifiedAt}`;
  if (archiveDocCache.has(key)) return archiveDocCache.get(key);
  const response = await fetch(archiveFileUrl(doc.archive), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("取回失败");
  const blob = await response.blob();
  const text = isTextFile({ name: doc.name, type: "" })
    ? await blob.text()
    : await extractDocumentText(doc.name, await readFile(blob, "data"));
  archiveDocCache.set(key, text);
  if (archiveDocCache.size > 12) archiveDocCache.delete(archiveDocCache.keys().next().value);
  return text;
}
/**
 * @param {Step} step
 * @param {Conversation} conversation
 */
async function readDocumentTool(step, args, conversation) {
  const docs = availableDocuments(conversation),
    wanted = String(args.name || "").toLowerCase();
  const doc =
    docs.find(d => d.name.toLowerCase() === wanted) ||
    docs.find(d => d.name.toLowerCase().includes(wanted)) ||
    (docs.length === 1 ? docs[0] : null);
  if (!doc)
    return { ok: false, content: `未找到文档「${args.name}」。可读文档：${docs.map(d => d.name).join("、") || "无"}`, display: "未找到" };
  step.title = doc.name;
  let text = "";
  if (doc.archive) {
    try {
      text = await archiveDocumentText(doc);
    } catch (error) {
      return { ok: false, content: `卷宗文档读取失败：${String(error.message || error).slice(0, 120)}`, display: "读取失败" };
    }
  } else {
    const record = await getAttachment(doc.id);
    text = record ? (record.kind === "text" ? String(record.data || "") : String(record.extractedText || "")) : "";
  }
  if (!text) return { ok: false, content: "该文档无可读取的文本", display: "无文本" };
  const pages = text.split(/^(?=第 \d+ 页$)/m),
    pageCount = pages.filter(p => /^第 \d+ 页$/m.test(p)).length;
  if (args.page) {
    const page = pages.find(p => p.startsWith(`第 ${Number(args.page)} 页`));
    if (!page) return { ok: false, content: `没有第 ${args.page} 页，共 ${pageCount || 1} 页`, display: "页码超出" };
    step.note = `第 ${args.page} 页`;
    return { ok: true, content: page.slice(0, 20000), display: `第 ${args.page} 页 · ${page.length} 字` };
  }
  if (args.query) {
    const needle = String(args.query).toLowerCase(),
      hits = [];
    let index = text.toLowerCase().indexOf(needle);
    while (index >= 0 && hits.length < 8) {
      hits.push(text.slice(Math.max(0, index - 300), index + needle.length + 300).trim());
      index = text.toLowerCase().indexOf(needle, index + needle.length + 300);
    }
    step.note = `关键词「${args.query}」`;
    return hits.length
      ? { ok: true, content: hits.map((hit, i) => `片段 ${i + 1}：…${hit}…`).join("\n\n"), display: `${hits.length} 处匹配` }
      : { ok: true, content: `全文未出现「${args.query}」`, display: "无匹配" };
  }
  const limit = 12000;
  step.note = `${text.length} 字${pageCount ? ` · ${pageCount} 页` : ""}`;
  return {
    ok: true,
    content:
      text.length > limit
        ? `${text.slice(0, limit)}\n\n[文档共 ${text.length} 字${pageCount ? `、${pageCount} 页` : ""}，此处只给出开头；可用 page 或 query 参数读取其余部分]`
        : text,
    display: `${Math.min(text.length, limit)} 字`
  };
}
