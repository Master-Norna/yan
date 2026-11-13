// 沙箱回放：把存储根里真实对话用过的指令全捞出来，按当前的筛查规则过一遍。
// 为什么要有这一步：改 server/sandbox.js 后单测全过、真实用法却可能被误伤——规则是照「可能危险的写法」写的，
// 而模型实际写出来的指令千奇百怪（详见 CONTRIBUTING 与 .yan/记忆.md 的 yan-sandbox-replay）。
// 用法：
//   node test/sandbox-replay.mjs            只看当前规则拦下哪些、共几条
//   node test/sandbox-replay.mjs --diff     再与 HEAD 那版比，列出判定变了的（新拦的多半是误伤，逐条看）
//   node test/sandbox-replay.mjs --limit 50 多列几条（默认 20）
//   node test/sandbox-replay.mjs --platform win32  按指定平台判（默认本机；判定与平台有关，别拿 mac 的语料按 win32 过）
// 只读：不写存储根，不碰 8787；--diff 会在 server/ 下临时放一份 HEAD 的 sandbox.js，跑完即删。
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || 20;
const platformIndex = args.indexOf("--platform");
const platform = platformIndex >= 0 && args[platformIndex + 1] ? args[platformIndex + 1] : process.platform;

// 存在 YAN_HOME 就用它；否则读 %APPDATA%\言\位置.json 的 root（换过存储位置的机器靠它找到现在的根）
function storeRoot() {
  if (process.env.YAN_HOME) return process.env.YAN_HOME;
  const pointer = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "言", "位置.json");
  try {
    const found = JSON.parse(fs.readFileSync(pointer, "utf8")).root;
    if (found) return found;
  } catch {
    /* 没换过位置 */
  }
  return path.join(os.homedir(), ".yan");
}

// 当前路径、换下的版本与旁注都留着真实指令；接冷行迹与捞指令须走同一份消息名单。
const messageLists = chat => [
  chat.messages,
  ...(Array.isArray(chat.forks) ? chat.forks : []).map(item => item?.messages),
  ...(Array.isArray(chat.threads) ? chat.threads : []).map(item => item?.messages)
];
// 对话里指令躺在 steps[].arguments（JSON 字符串），帮手的那一层在 step.sub.steps 里；逐层走，不假设层级
function commandsIn(chat) {
  const found = [];
  const stack = messageLists(chat);
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) if (item && typeof item === "object") stack.push(item);
      continue;
    }
    if (node.name === "run_command" && node.arguments) {
      try {
        const call = typeof node.arguments === "string" ? JSON.parse(node.arguments) : node.arguments;
        if (typeof call?.command === "string" && call.command.trim()) found.push(call.command);
      } catch {
        /* 半截参数不完整，跳过 */
      }
    }
    for (const value of Object.values(node)) if (value && typeof value === "object") stack.push(value);
  }
  return found;
}

// 收了尾的一答，帮手的步骤与思绪另存在 对话/行迹/<对话短码>/<key>.json（见 src/01-store/35-cold.js），
// 对话文件里只留 cold 记号。不接回来，那些帮手跑过的 run_command 一条都捞不到
const codeOf = id => crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 10);
function coldPieces(id) {
  const dir = path.join(talks, "行迹", codeOf(id)),
    pieces = new Map();
  if (!id || !fs.existsSync(dir)) return pieces;
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith(".json"))) {
    try {
      pieces.set(name.replace(/\.json$/, ""), JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
    } catch {
      /* 坏的接不上就不接，照实少数几条 */
    }
  }
  return pieces;
}
// 接回冷行迹：与页面 warmConversation 一样，手上已有（并进来的新份）的不盖；返回接上了几答
function warmCold(chat, pieces) {
  let warmed = 0;
  for (const list of messageLists(chat))
    for (const message of Array.isArray(list) ? list : []) {
      const piece = message?.cold?.key && pieces.get(String(message.cold.key));
      if (!piece) continue;
      for (const step of message.steps || []) {
        const part = step.sub?.id && piece.subs?.[step.sub.id];
        if (part && step.sub.steps === undefined) step.sub.steps = part.steps || [];
      }
      warmed += 1;
    }
  return warmed;
}

const root = storeRoot();
const talks = path.join(root, "对话");
// 没绑定目录的对话（普通聊天），指令实际是在卷宗里跑的（src/06-mode-welcome/00-mode.js 的 workRoot → archiveDir）
const archive = path.join(root, "卷宗");
if (!fs.existsSync(talks)) {
  console.error(`没有找到对话目录：${talks}\n（存储根不对时用 YAN_HOME 指定，或先在设置里换位置）`);
  process.exit(1);
}

const cases = [];
let warmedMessages = 0;
for (const name of fs.readdirSync(talks).filter(file => file.endsWith(".json"))) {
  let chat;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(talks, name), "utf8"));
    chat = saved.conversation || saved; // 存盘的外面套着 { 言, version, savedAt, conversation }
  } catch {
    continue;
  }
  warmedMessages += warmCold(chat, coldPieces(chat.id));
  const workdir = typeof chat.workdir === "string" && chat.workdir ? chat.workdir : archive;
  for (const command of commandsIn(chat)) cases.push({ command, workdir, talk: chat.title || name });
}

const { screenCommand } = require(path.join(ROOT, "server/sandbox.js"));
const verdict = (screen, item) => screen(item.command, item.workdir, { platform });
const blocked = cases.filter(item => verdict(screenCommand, item));
console.log(`存储根 ${root}　按 ${platform} 判　接回冷行迹 ${warmedMessages} 答`);
console.log(
  `共 ${cases.length} 条指令（${new Set(cases.map(item => item.talk)).size} 段对话）：放行 ${cases.length - blocked.length}、拦下 ${blocked.length}`
);

const byReason = new Map();
for (const item of blocked) {
  const reason = String(verdict(screenCommand, item))
    .replace(/^沙箱拒绝：/, "")
    .slice(0, 60);
  byReason.set(reason, (byReason.get(reason) || 0) + 1);
}
for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(4)}  ${reason}`);
const show = text => text.replace(/\s+/g, " ").slice(0, 120);
for (const item of blocked.slice(0, limit)) console.log(`\n· ${show(item.command)}\n  ${verdict(screenCommand, item)}`);

if (args.includes("--diff")) {
  const previousFile = path.join(ROOT, "server", ".sandbox-prev.js");
  let previous;
  try {
    fs.writeFileSync(previousFile, execFileSync("git", ["show", "HEAD:server/sandbox.js"], { cwd: ROOT, encoding: "utf8" }));
    previous = require(previousFile);
  } catch (error) {
    console.error(`\n拿不到 HEAD 那版 sandbox.js：${error.message}`);
    process.exit(1);
  } finally {
    fs.rmSync(previousFile, { force: true });
  }
  const changed = cases
    .map(item => ({ ...item, now: verdict(screenCommand, item), before: verdict(previous.screenCommand, item) }))
    .filter(item => Boolean(item.now) !== Boolean(item.before));
  const tightened = changed.filter(item => item.now),
    loosened = changed.filter(item => !item.now);
  console.log(`\n与 HEAD 判定不同 ${changed.length} 条：新拦 ${tightened.length}、新放行 ${loosened.length}`);
  for (const item of changed.slice(0, limit))
    console.log(`\n${item.now ? "× 新拦" : "✓ 新放行"} ${show(item.command)}\n  ${item.now || item.before}`);
}
