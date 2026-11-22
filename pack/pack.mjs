// 言 · 打本机便携包：运行文件 + 经官方校验和验证的 Node（含 npm）+ 平台启动入口。
// Windows x64 用系统 csc 编 言.exe；Apple 芯片 Mac 用 start.command 与原生归档工具。
// Node 下载留在 dist/.cache；成功后只清理本平台的旧版 ZIP。
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { assertCleanWorkingTree } from "./clean.mjs";

const require = createRequire(import.meta.url);
const { fasterSide } = require("../server/mirror.js");

const MAC = process.platform === "darwin" && process.arch === "arm64";
const WIN = process.platform === "win32" && process.arch === "x64";
if (!MAC && !WIN) throw Error("仅支持在 Windows x64 或 Apple 芯片 Mac 上打本机便携包（Mac 请用原生 arm64 Node）");
const TARGET = MAC ? "mac-arm64" : "win-x64";
const NODE_TARGET = MAC ? "darwin-arm64" : "win-x64";
const NODE_BIN = MAC ? "bin/node" : "node.exe";
const NODE = "v24.22.0"; // 当时的 LTS（Krypton）；换版本后整套测试用它跑一遍再发
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist"),
  CACHE = path.join(DIST, ".cache"),
  OUT = path.join(DIST, "言");
// 运行要用的：桥接、页面、提示词、译文、前端库；README 与 LICENSE 随包
const KEEP = [
  "server.js",
  "package.json",
  MAC ? "start.command" : "start.cmd",
  "README.md",
  "README.en.md",
  "LICENSE",
  "server/",
  "web/",
  "src/",
  "styles/",
  "prompts/",
  "skills/",
  "i18n/",
  "vendor/"
];
const SYSTEM_TAR = MAC ? "/usr/bin/tar" : path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const CSC = path.join(process.env.SystemRoot || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");

const say = text => console.log(`· ${text}`);
const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const curl = (url, out) =>
  execFileSync(MAC ? "/usr/bin/curl" : "curl.exe", ["-fsSL", "--retry", "2", "-o", out, url], { stdio: "inherit" });

function copyTracked() {
  assertCleanWorkingTree(ROOT);
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(file => file && KEEP.some(keep => (keep.endsWith("/") ? file.startsWith(keep) : file === keep)));
  for (const file of files) {
    const to = path.join(OUT, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), to);
  }
  // copyFile 不可代替发布物的执行位契约；start.command 解压后须能从访达启动。
  if (MAC) fs.chmodSync(path.join(OUT, "start.command"), 0o755);
  say(`言的文件 ${files.length} 件`);
}

async function fetchNode() {
  const name = `node-${NODE}-${NODE_TARGET}`,
    archiveName = `${name}.${MAC ? "tar.gz" : "zip"}`,
    archive = path.join(CACHE, archiveName);
  fs.mkdirSync(CACHE, { recursive: true });
  const sums = path.join(CACHE, `SHASUMS256-${NODE}.txt`);
  if (!fs.existsSync(sums)) curl(`https://nodejs.org/dist/${NODE}/SHASUMS256.txt`, sums);
  const expected = fs
    .readFileSync(sums, "utf8")
    .split("\n")
    .find(line => line.trimEnd().endsWith(`  ${archiveName}`))
    ?.split(/\s+/)[0];
  if (!expected) throw Error(`SHASUMS256.txt 里没有 ${archiveName}`);
  if (!fs.existsSync(archive) || sha256(archive) !== expected) {
    const official = `https://nodejs.org/dist/${NODE}/${archiveName}`,
      mirror = `https://registry.npmmirror.com/-/binary/node/${NODE}/${archiveName}`;
    const { side } = await fasterSide(mirror, official);
    say(`下 Node ${NODE}（${side === "china" ? "国内镜像" : "官方"}）`);
    curl(side === "china" ? mirror : official, archive);
    if (sha256(archive) !== expected) throw Error("Node 压缩包与官方校验和对不上，不用它");
  }
  say(`Node ${NODE} 校验和对上了`);
  const temp = path.join(DIST, ".node");
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });
  execFileSync(SYSTEM_TAR, ["-xf", archive, "-C", temp]);
  fs.renameSync(path.join(temp, name), path.join(OUT, "node"));
  fs.rmSync(temp, { recursive: true, force: true });
  const version = execFileSync(path.join(OUT, "node", NODE_BIN), ["-v"], { encoding: "utf8" }).trim();
  if (version !== NODE) throw Error(`包里的 Node 报 ${version}，应是 ${NODE}`);
  if (MAC && execFileSync(path.join(OUT, "node", NODE_BIN), ["-p", "process.arch"], { encoding: "utf8" }).trim() !== "arm64")
    throw Error("包里的 macOS Node 不是 arm64");
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
const zipFile = path.join(DIST, `yan-${version}-${TARGET}.zip`);
if (MAC) {
  // 原生 ZIP 保留执行位与 npm/npx 的相对软链，也让系统自带的归档实用工具能解开。
  fs.rmSync(zipFile, { force: true });
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--norsrc", "--keepParent", OUT, zipFile], { stdio: "inherit" });
  say(`${path.relative(ROOT, zipFile)}：${(fs.statSync(zipFile).size / 1048576).toFixed(1)} MB`);
} else {
  buildLauncher();
  const { count, bytes } = writeZip(OUT, zipFile, "言");
  say(`${path.relative(ROOT, zipFile)}：${count} 件，${(bytes / 1048576).toFixed(1)} MB`);
}
for (const name of fs.readdirSync(DIST))
  if (name.startsWith("yan-") && name.endsWith(`-${TARGET}.zip`) && name !== path.basename(zipFile))
    fs.rmSync(path.join(DIST, name), { force: true });
for (const name of fs.readdirSync(CACHE)) if (!name.includes(NODE)) fs.rmSync(path.join(CACHE, name), { force: true });
