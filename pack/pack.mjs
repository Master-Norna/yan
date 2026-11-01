// 言 · 打 Windows 便携包：node pack/pack.mjs → dist/yan-<版本>-win-x64.zip，解开是一个「言」文件夹，双击里面的 言.exe 即用。
// 包里是：仓库里跟踪着的运行所需文件（不带测试、文档、设计稿）+ 官方 Node 原样一份（node\，带 npm）+ 启动器 言.exe。
// 言自己的代码一字不改：Node 仍是真的 Node、npm 就在旁边，桥接照旧从磁盘现拼页面——只是不用用户先装 Node。
// 启动器由系统自带的 .NET Framework csc 编出（pack/launcher.cs），图标 pack/icon.ico 由 icon.svg 画成。
// Node 的压缩包按 nodejs.org 的 SHASUMS256.txt 验过才用，下过的留在 dist/.cache 里，再打不必重下
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { fasterSide } = require("../server/mirror.js");

const NODE = "v24.22.0"; // 当时的 LTS（Krypton）；换版本后整套测试用它跑一遍再发
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist"),
  CACHE = path.join(DIST, ".cache"),
  OUT = path.join(DIST, "言");
// 运行要用的：桥接、页面、提示词、译文、前端库；README 与 LICENSE 随包
const KEEP = [
  "server.js",
  "build.js",
  "package.json",
  "index.html",
  "theme-boot.js",
  "icon.svg",
  "preview.html",
  "preview-runtime.js",
  "start.cmd",
  "README.md",
  "README.en.md",
  "LICENSE",
  "server/",
  "src/",
  "styles/",
  "prompts/",
  "skills/",
  "i18n/",
  "vendor/"
];
const SYSTEM_TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const CSC = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");

const say = text => console.log(`· ${text}`);
const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const curl = (url, out) => execFileSync("curl.exe", ["-fsSL", "--retry", "2", "-o", out, url], { stdio: "inherit" });

function copyTracked() {
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (dirty) say("工作区有未提交的改动，包里用的是磁盘上的现状");
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(file => file && KEEP.some(keep => (keep.endsWith("/") ? file.startsWith(keep) : file === keep)));
  for (const file of files) {
    const to = path.join(OUT, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), to);
  }
  say(`言的文件 ${files.length} 件`);
}

async function fetchNode() {
  const name = `node-${NODE}-win-x64`,
    zip = path.join(CACHE, `${name}.zip`);
  fs.mkdirSync(CACHE, { recursive: true });
  const sums = path.join(CACHE, `SHASUMS256-${NODE}.txt`);
  if (!fs.existsSync(sums)) curl(`https://nodejs.org/dist/${NODE}/SHASUMS256.txt`, sums);
  const expected = fs
    .readFileSync(sums, "utf8")
    .split("\n")
    .find(line => line.endsWith(`  ${name}.zip`))
    ?.split(/\s+/)[0];
  if (!expected) throw Error(`SHASUMS256.txt 里没有 ${name}.zip`);
  if (!fs.existsSync(zip) || sha256(zip) !== expected) {
    const official = `https://nodejs.org/dist/${NODE}/${name}.zip`,
      mirror = `https://registry.npmmirror.com/-/binary/node/${NODE}/${name}.zip`;
    const { side } = await fasterSide(mirror, official);
    say(`下 Node ${NODE}（${side === "china" ? "国内镜像" : "官方"}）`);
    curl(side === "china" ? mirror : official, zip);
    if (sha256(zip) !== expected) throw Error("Node 压缩包与官方校验和对不上，不用它");
  }
  say(`Node ${NODE} 校验和对上了`);
  const temp = path.join(DIST, ".node");
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });
  execFileSync(SYSTEM_TAR, ["-xf", zip, "-C", temp]);
  fs.renameSync(path.join(temp, name), path.join(OUT, "node"));
  fs.rmSync(temp, { recursive: true, force: true });
  const version = execFileSync(path.join(OUT, "node", "node.exe"), ["-v"], { encoding: "utf8" }).trim();
  if (version !== NODE) throw Error(`包里的 Node 报 ${version}，应是 ${NODE}`);
}

function buildLauncher() {
  if (!fs.existsSync(CSC)) throw Error(`找不到 ${CSC}（.NET Framework 4）`);
  const result = spawnSync(
    CSC,
    [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      "/codepage:65001",
      `/win32icon:${path.join(ROOT, "pack", "icon.ico")}`,
      `/out:${path.join(OUT, "言.exe")}`,
      path.join(ROOT, "pack", "launcher.cs")
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) throw Error(`启动器没编成：\n${result.stdout}${result.stderr}`);
  say("启动器 言.exe");
}

// 打 zip：名字一律按 UTF-8 写并标明（通用标志第 11 位），「言」这样的中文名在资源管理器、7-Zip 里解出来都不乱
function crc32(buffer) {
  return zlib.crc32(buffer) >>> 0;
}
function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}
function* walk(dir, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, base);
    else if (entry.isFile()) yield full;
  }
}
function writeZip(dir, zipFile, top) {
  const fd = fs.openSync(zipFile, "w"),
    central = [];
  let offset = 0;
  const write = buffer => {
    fs.writeSync(fd, buffer);
    offset += buffer.length;
  };
  for (const file of walk(dir)) {
    const name = Buffer.from(`${top}/${path.relative(dir, file).split(path.sep).join("/")}`, "utf8"),
      data = fs.readFileSync(file),
      packed = zlib.deflateRawSync(data, { level: 9 }),
      stored = packed.length >= data.length,
      body = stored ? data : packed,
      crc = crc32(data),
      { time, date } = dosTime(fs.statSync(file).mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const at = offset;
    write(local);
    write(name);
    write(body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(at, 42);
    central.push(entry, name);
  }
  const start = offset,
    count = central.length / 2;
  for (const part of central) write(part);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(offset - start, 12);
  end.writeUInt32LE(start, 16);
  write(end);
  fs.closeSync(fd);
  if (count > 0xffff || offset > 0xffffffff) throw Error("包太大，超出普通 zip 的上限");
  return { count, bytes: offset };
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyTracked();
await fetchNode();
buildLauncher();
const zipFile = path.join(DIST, `yan-${version}-win-x64.zip`);
const { count, bytes } = writeZip(OUT, zipFile, "言");
say(`${path.relative(ROOT, zipFile)}：${count} 件，${(bytes / 1048576).toFixed(1)} MB`);
