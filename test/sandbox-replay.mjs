// 沙箱回放：把存储根里真实对话用过的指令全捞出来，按当前的筛查规则过一遍。
// 为什么要有这一步：改 server/sandbox.js 后单测全过、真实用法却可能被误伤——规则是照「可能危险的写法」写的，
// 而模型实际写出来的指令千奇百怪（详见 CONTRIBUTING 与 .yan/记忆.md 的 yan-sandbox-replay）。
// 用法：
//   node test/sandbox-replay.mjs            只看当前规则拦下哪些、共几条
//   node test/sandbox-replay.mjs --diff     再与 HEAD 那版比，列出判定变了的（新拦的多半是误伤，逐条看）
//   node test/sandbox-replay.mjs --limit 50 多列几条（默认 20）
// 只读：不写存储根，不碰 8787；--diff 会在 server/ 下临时放一份 HEAD 的 sandbox.js，跑完即删。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || 20;

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

// 对话里指令躺在 steps[].arguments（JSON 字符串），帮手的那一层在 step.sub.steps 里；逐层走，不假设层级
function commandsIn(chat) {
  const found = [];
  const stack = [chat.messages || []];
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

const root = storeRoot();
const talks = path.join(root, "对话");
if (!fs.existsSync(talks)) {
  console.error(`没有找到对话目录：${talks}\n（存储根不对时用 YAN_HOME 指定，或先在设置里换位置）`);
  process.exit(1);
}

const cases = [];
for (const name of fs.readdirSync(talks).filter(file => file.endsWith(".json"))) {
  let chat;
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(talks, name), "utf8"));
    chat = saved.conversation || saved; // 存盘的外面套着 { 言, version, savedAt, conversation }
  } catch {
    continue;
  }
  const workdir = typeof chat.workdir === "string" && chat.workdir ? chat.workdir : ROOT;
  for (const command of commandsIn(chat)) cases.push({ command, workdir, talk: chat.title || name });
}

const { screenCommand } = require(path.join(ROOT, "server/sandbox.js"));
const verdict = (screen, item) => screen(item.command, item.workdir, { platform: "win32" });
const blocked = cases.filter(item => verdict(screenCommand, item));
console.log(`存储根 ${root}`);
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
