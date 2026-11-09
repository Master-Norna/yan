// 提示词体量：用页面同一份代码（src/ 照单元测试的拼法拼起来）拼出各模式下模型实际读到的系统提示 + 工具定义，粗估 token
// （中日韩字符按 1，其余按 4 字符 1）。设置取默认档：沙箱开、问而后行、记忆开（12 条）。
// 用法：node test/prompt-size.mjs [--dump 打印全文] [--tools 逐件列出]。改过 prompts/ 后跑一下，看总量有没有涨回去
import { readFileSync, readdirSync } from "node:fs";
import { load } from "./unit/harness.mjs";

const prompts = {};
const promptDir = new URL("../prompts/", import.meta.url);
for (const name of readdirSync(promptDir).filter(f => f.endsWith(".js")))
  new Function("window", readFileSync(new URL(name, promptDir), "utf8"))({ YAN_PROMPTS: prompts });

const f = load([
  "systemPrompt",
  "toolDefinitions",
  `setup: prompts => {
    Object.assign(PROMPTS, prompts);
    bootstrap = { work: { archive: "C:\\\\Users\\\\我\\\\.yan\\\\卷宗", platform: "win32", shell: "PowerShell 7", scratch: ".草稿" } };
    store.settings.dutyMemory = { on: true, api: "openai", baseUrl: "http://127.0.0.1:1/v1", apiKey: "", model: "m", modelList: [] };
    store.memory.items = Array.from({ length: 12 }, (_, i) => ({ id: "m" + i, text: "一条记忆", category: i % 2 ? "偏好" : "言的开发", createdAt: "", updatedAt: "" }));
  }`
]);
f.setup(prompts);

const est = s => {
  let n = 0;
  for (const ch of String(s)) n += /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 1 : 0.28;
  return Math.round(n);
};
const chat = { id: "8f3a2c1b-0000", messages: [] },
  work = { id: "w", messages: [], workdir: "E:\\项目\\demo" };
const modes = {
  "言（桥接+记忆，工具落卷宗）": { conversation: chat },
  "行（桥接+记忆）": { conversation: work },
  "行·帮手": { conversation: work, sub: true }
};
let out = "";
for (const [label, { conversation, sub }] of Object.entries(modes)) {
  const tools = f.toolDefinitions(conversation, { sub }) || [],
    system = f.systemPrompt(conversation, tools, { role: sub ? "sub" : "main" }),
    toolsText = tools.map(tool => JSON.stringify(tool)).join("\n");
  out += `\n== ${label}\n系统提示 ${system.length} 字 ≈ ${est(system)} tok；工具定义 ${toolsText.length} 字 ≈ ${est(toolsText)} tok（${tools.length} 件）；合计 ≈ ${est(system) + est(toolsText)} tok\n`;
  if (process.argv.includes("--dump"))
    out += `---- system ----\n${system}\n---- tools ----\n${tools.map(tool => `${tool.function.name}: ${tool.function.description}`).join("\n")}\n`;
  if (process.argv.includes("--tools"))
    out += tools.map(tool => `  ${tool.function.name.padEnd(22)} ≈ ${String(est(JSON.stringify(tool))).padStart(4)} tok`).join("\n") + "\n";
}
console.log(out);
