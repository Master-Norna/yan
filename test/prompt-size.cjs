// 提示词体量：拼出各模式下模型实际读到的系统提示 + 工具定义，粗估 token（中日韩字符按 1，其余按 4 字符 1）。
// 用法：node test/prompt-size.cjs [--dump 打印全文] [--tools 逐件列出]。改过 prompts/ 后跑一下，看总量有没有涨回去
const fs = require("fs"),
  path = require("path");
const ROOT = path.join(__dirname, "..");
global.window = {};
for (const f of fs.readdirSync(path.join(ROOT, "prompts")).filter(f => f.endsWith(".js"))) require(path.join(ROOT, "prompts", f));
const P = window.YAN_PROMPTS;
const prompt = (p, vars = {}) => {
  const text = p.split(".").reduce((n, k) => n?.[k], P);
  if (text == null) return `<<缺 ${p}>>`;
  return (Array.isArray(text) ? text.join("\n") : String(text)).replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? "")).trim();
};
const est = s => {
  let n = 0;
  for (const ch of String(s)) n += /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 1 : 0.28;
  return Math.round(n);
};
const desc = (name, vars, work) => prompt(`tools.${name}.${!work && P.tools[name].brief ? "brief" : "description"}`, vars);
const toolDef = (name, vars, work) =>
  JSON.stringify({ type: "function", function: { name, description: desc(name, vars, work), parameters: P.tools[name].parameters } });
const WORK = ["run_command", "write_file", "edit_file", "read_file", "list_files", "search_files"],
  CHAT_FILES = ["run_command", "write_file", "read_file", "list_files"],
  MEM = ["remember", "forget", "recall", "search_conversations", "read_conversation"];
function sys(names, { work = false, archive = false, sub = false } = {}) {
  const lines = [prompt("assistant.today", { day: "九月十六日", iso: "2026-09-16" })];
  const env = { platform: "Windows", shell: "PowerShell", shellNote: prompt("work.windowsShell") };
  if (work) lines.push(prompt("work.hint", { workdir: "E:\\项目\\demo", ...env }));
  else if (archive) lines.push(prompt("work.archive", { workdir: "C:\\Users\\我\\言\\卷宗", scratch: ".草稿/8f3a2c1b", ...env }));
  if (names.has("search_web")) lines.push(prompt("assistant.search"));
  if (names.has("ask_user")) lines.push(prompt("assistant.asking"));
  if (names.has("remember")) lines.push(prompt("memory.hint", { count: 12 }));
  lines.push(prompt("assistant.drawing"));
  if (!work) lines.push(prompt("assistant.manner"));
  if (sub) lines.push(prompt("delegate.system"));
  return lines.join("\n");
}
const modes = {
  "言（桥接+记忆，工具落卷宗）": {
    tools: ["search_web", "fetch_page", "http_request", "run_js", "inspect_computer", ...CHAT_FILES, "download_file", "ask_user", ...MEM, "delegate"],
    archive: true
  },
  "行（桥接+记忆）": {
    tools: ["search_web", "fetch_page", "http_request", "run_js", "inspect_computer", ...WORK, "download_file", "update_plan", "ask_user", ...MEM, "delegate"],
    work: true
  },
  "行·帮手": { tools: ["search_web", "fetch_page", "http_request", "run_js", "inspect_computer", ...WORK, "download_file", ...MEM], work: true, sub: true },
  "言（直连，无桥接、无记忆）": { tools: ["run_js", "ask_user"] }
};
let out = "";
for (const [label, m] of Object.entries(modes)) {
  const names = new Set(m.tools);
  const system = sys(names, m);
  const tools = m.tools.map(n => toolDef(n, { docs: "a.pdf" }, !!m.work));
  const toolsText = tools.join("\n");
  out += `\n== ${label}\n系统提示 ${system.length} 字 ≈ ${est(system)} tok；工具定义 ${toolsText.length} 字 ≈ ${est(toolsText)} tok（${tools.length} 件）；合计 ≈ ${est(system) + est(toolsText)} tok\n`;
  if (process.argv.includes("--dump"))
    out +=
      "---- system ----\n" +
      system +
      "\n---- tools ----\n" +
      m.tools.map(n => `${n}: ${desc(n, { docs: "a.pdf" }, !!m.work)}`).join("\n") +
      "\n";
}
if (process.argv.includes("--tools"))
  for (const n of Object.keys(P.tools)) {
    const d = toolDef(n, { docs: "a.pdf" });
    console.log(
      `${n.padEnd(22)} ${String(d.length).padStart(5)} 字 ≈ ${String(est(d)).padStart(4)} tok（说明 ${est(P.tools[n].description)} tok）`
    );
  }
console.log(out);
