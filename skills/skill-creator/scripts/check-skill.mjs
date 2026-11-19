// 检查一份技能：node check-skill.mjs <技能文件夹>
// 只读不改，零依赖（用运行言的 Node 即可跑）。错——言认不出或会用错——退出码 1；提醒——未必错、值得看一眼——退出码 0
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] || ".");
const errors = [],
  warnings = [],
  notes = [];
const SKIP = new Set(["node_modules", ".git", "__pycache__", ".venv"]);
const TEXT = /\.(md|markdown|txt|py|js|mjs|cjs|ts|json|ya?ml|toml|ini|sh|ps1|bat|cmd|html?|css|csv|xml|xsd)$/i;

const main = path.join(dir, "SKILL.md");
if (!fs.existsSync(main)) {
  console.log(`✗ 没有 SKILL.md：${dir}`);
  process.exit(1);
}
const text = fs.readFileSync(main, "utf8").replace(/^﻿/, "");

// 头部：只认用得着的几种写法——key: 值、引号里的值、| 与 > 的块、缩进续行。用于检查常见写法，不是桥接解析器的完整复刻
const head = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
const meta = {};
if (!head) errors.push("开头没有 --- 包起的头部（name、description）");
else {
  const lines = head[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      value = value[0] === "|" ? block.join("\n") : block.join(" ");
    } else if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) value += ` ${lines[++i].trim()}`;
    meta[kv[1]] = value.trim();
  }
}
const body = head ? text.slice(head[0].length) : text;

// 名字
const folder = path.basename(dir);
if (!meta.name) warnings.push(`头部没写 name，言会用文件夹名「${folder}」`);
else {
  if (meta.name.length > 64 || /[<>:"/\\|?*\x00-\x1f]/.test(meta.name) || /^\.|[. ]$/.test(meta.name))
    errors.push(`name「${meta.name}」不合用：至多 64 字，不含 < > : " / \\ | ? *，不以点开头、不以点或空格结尾`);
  if (meta.name !== folder) warnings.push(`name「${meta.name}」与文件夹名「${folder}」不同：言以 name 为准，设置里改名时目录不跟着走`);
}

// 何时用
const description = meta.description || "";
if (!description) errors.push("头部没写 description：模型只凭这一句决定何时翻它");
else if (description.length > 1024) errors.push(`description 有 ${description.length} 字，言至多认 1024 字`);
else if (description.length > 200) warnings.push(`description 有 ${description.length} 字：系统提示里每份一行，宜一两句写清做什么、何时用`);

for (const key of ["disable-model-invocation", "user-invocable"])
  if (key in meta && !/^(true|false)$/i.test(meta[key])) warnings.push(`${key} 应写 true 或 false，现在是「${meta[key]}」`);
const known = new Set(["name", "description", "disable-model-invocation", "user-invocable", "license", "metadata"]);
const unknown = Object.keys(meta).filter(key => !known.has(key));
if (unknown.length) notes.push(`头部另有 ${unknown.join("、")}：言不认，留着无害`);

// 正文
if (!body.trim()) errors.push("正文是空的");
if (body.length > 60000) warnings.push(`正文 ${body.length} 字，言翻阅时只给前 6 万字：长参考拆到 references/`);
if (/\b[A-Z]:\\(Users|Documents and Settings)\\|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\//.test(body))
  warnings.push("正文写死了某台机器上的路径：换台机器就不对，改成相对技能目录的路径");

// 目录里的件
const files = [];
(function walk(at) {
  for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const full = path.join(at, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(path.relative(dir, full).split(path.sep).join("/"));
  }
})(dir);
if (files.length > 1000) warnings.push(`共 ${files.length} 件，言只列前 1000 件`);

// 引用：各文本件里提到的相对路径（行内代码与链接；代码块里的是示例，不算）
const mentioned = new Set(),
  mentionedDirs = new Set(),
  missing = new Set();
const texts = files.filter(file => /\.(md|markdown|txt)$/i.test(file));
for (const file of texts) {
  const source = fs.readFileSync(path.join(dir, file), "utf8").replace(/^```[\s\S]*?^```/gm, "");
  const refs = [...source.matchAll(/`([^`\n]+)`|\]\(([^)\s]+)\)/g)].map(m => (m[1] || m[2]).trim());
  for (const ref of refs) {
    if (!ref.includes("/") || /^[a-z]+:|^[/#~]|[<>{}$*\s]/i.test(ref)) continue;
    const clean = ref.replace(/^\.\//, "").replace(/[#?].*$/, "");
    if (clean.endsWith("/")) {
      mentionedDirs.add(clean);
      continue;
    }
    // 引用相对技能目录，或相对引用它的那件
    const candidates = [clean, path.posix.join(path.posix.dirname(file), clean)];
    const hit = candidates.find(candidate => files.includes(candidate));
    if (hit) mentioned.add(hit);
    else if (/\.\w{1,5}$/.test(clean) && !fs.existsSync(path.join(dir, clean))) missing.add(`${clean}（${file} 提到）`);
  }
}
for (const ref of missing) errors.push(`引用的文件不在：${ref}`);
const orphan = files.filter(
  file =>
    file !== "SKILL.md" &&
    !/^LICEN[CS]E/i.test(path.posix.basename(file)) &&
    !mentioned.has(file) &&
    ![...mentionedDirs].some(prefix => file.startsWith(prefix))
);
if (orphan.length)
  warnings.push(`${orphan.length} 件没被提到，模型不知道何时去翻：${orphan.slice(0, 8).join("、")}${orphan.length > 8 ? " 等" : ""}`);

// 疑似密钥
const SECRET = /sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
for (const file of files.filter(file => TEXT.test(file)))
  if (SECRET.test(fs.readFileSync(path.join(dir, file), "utf8"))) errors.push(`疑似写进了密钥：${file}`);

console.log(`技能「${meta.name || folder}」 · ${files.length} 件 · ${dir}`);
for (const line of errors) console.log(`✗ ${line}`);
for (const line of warnings) console.log(`! ${line}`);
for (const line of notes) console.log(`· ${line}`);
console.log(
  errors.length ? `有 ${errors.length} 处错、${warnings.length} 处提醒` : `没有错${warnings.length ? `，${warnings.length} 处提醒` : ""}`
);
process.exit(errors.length ? 1 : 0);
