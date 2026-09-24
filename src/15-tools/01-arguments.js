// 言 · 工具参数：模型给的参数在这里过一道关，理顺了才交给工具。工具里拿到的 args 已按 schema 归位、定型，必填项一个不缺
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
// 按工具的 schema 把参数理顺：模型写参数常有小出入，能理解的都照单收下，只有真讲不通的才算失败——
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
  return normalizeArguments(toolSpec(name)?.parameters, raw);
}
// 对着一份 JSON Schema 理顺：内置工具用自己的 parameters，mcp_call 用目标工具的 inputSchema
function normalizeArguments(spec, raw) {
  const args = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
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
// 参数出错时回给模型的一行 schema 摘要
function toolSchemaHint(name) {
  return schemaHint(toolSpec(name)?.parameters);
}
function schemaHint(spec) {
  if (!spec?.properties) return "见工具定义";
  const required = new Set(spec.required || []);
  return Object.entries(spec.properties)
    .map(([key, value]) => `${key}（${value.type || "any"}${required.has(key) ? "，必填" : "，可选"}）`)
    .join("、");
}
