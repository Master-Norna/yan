// 提示词体量：用页面同一份代码（src/ 照单元测试的拼法拼起来）拼出各模式下模型实际读到的系统提示 + 工具定义，粗估 token
// （中日韩字符按 1，其余按 4 字符 1）。设置取默认档：沙箱开、问而后行、记忆开（12 条）。
// 用法：node test/prompt-size.mjs [--dump 打印全文] [--tools 逐件列出] [--save 更新基准]
// 默认与 test/prompt-size.json 里记的上一次比，只报差值——不判红、不设上限。改过 prompts/ 后跑一下，
// 增量明显时复核「这句非写不可吗」；确认这组数合理再 --save，基准随提交走，往后每次都能看出涨了还是降了。
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
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
    store.settings.memoryEnabled = true;
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
// 四档：主答的两种模式、旁注（只查不改的工具、可带引文）、帮手（另有一份任务说明）
const modes = {
  "言（桥接+记忆，工具落卷宗）": { conversation: chat, tools: {} },
  "行（桥接+记忆）": { conversation: work, tools: {} },
  "行·旁注": { conversation: work, tools: { lookup: true }, prompt: { role: "side", anchor: true } },
  "行·帮手": { conversation: work, tools: { sub: true }, prompt: { role: "sub" } }
};

const snapshot = new URL("./prompt-size.json", import.meta.url);
const previous = existsSync(snapshot) ? JSON.parse(readFileSync(snapshot, "utf8")) : null;
const current = {};
let out = "";
for (const [label, { conversation, tools: options, prompt = {} }] of Object.entries(modes)) {
  const tools = f.toolDefinitions(conversation, options) || [],
    system = f.systemPrompt(conversation, tools, { role: prompt.role || "main", anchor: !!prompt.anchor }),
    toolsText = tools.map(tool => JSON.stringify(tool)).join("\n"),
    systemSize = est(system),
    toolsSize = est(toolsText),
    total = systemSize + toolsSize;
  current[label] = { system: systemSize, tools: toolsSize, total };
  out += `\n== ${label}\n系统提示 ${system.length} 字 ≈ ${systemSize} tok；工具定义 ${toolsText.length} 字 ≈ ${toolsSize} tok（${tools.length} 件）；合计 ≈ ${total} tok`;
  if (previous?.[label]) {
    const delta = total - previous[label].total;
    out += `（上次 ${previous[label].total}，${delta === 0 ? "持平" : delta > 0 ? `+${delta}` : delta}）`;
  }
  if (process.argv.includes("--dump"))
    out += `\n---- system ----\n${system}\n---- tools ----\n${tools.map(tool => `${tool.function.name}: ${tool.function.description}`).join("\n")}`;
  if (process.argv.includes("--tools"))
    out += tools.map(tool => `\n  ${tool.function.name.padEnd(22)} ≈ ${String(est(JSON.stringify(tool))).padStart(4)} tok`).join("");
  out += "\n";
}
if (!previous) out += "\n还没有基准（test/prompt-size.json）：确认这组数可以作起点，就加 --save\n";
if (process.argv.includes("--save")) {
  writeFileSync(snapshot, `${JSON.stringify(current, null, 2)}\n`);
  out += "\n已记入 test/prompt-size.json\n";
}
console.log(out);
