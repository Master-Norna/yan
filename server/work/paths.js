// 言 · 桥接 · 执事与卷宗共用的路径：工作目录的认定、目录内外、越界的链接、文件系统错误的译文
// 纯函数（至多读一读文件系统），由 server/work/ 下各段 require
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// 脚本与中间文件放在卷宗里的隐藏目录 .草稿/<对话id>/，页面不列它
const SCRATCH_DIR = ".草稿";
// 列目录、检索、卷宗都不往里钻的目录
const WORK_SKIP = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  "target",
  ".cache",
  ".idea",
  ".vscode",
  "coverage"
]);
function expandHome(value) {
  const text = String(value || "").trim();
  return text.startsWith("~") ? path.join(os.homedir(), text.slice(1)) : text;
}
// home：没给目录时的退路（执事的 工作/ 目录）
// 工作目录必须是完整限定的路径：path.isAbsolute 在 Windows 上会把「\foo」「/foo」也算作绝对，实际却跟着桥接进程所在的盘符走；
// 「C:foo」则是相对当前目录。只认 resolve 前后一致的写法（盘符 / UNC / POSIX 根），其余一律拒绝
function resolveWorkdir(raw, home = () => "") {
  const expanded = expandHome(raw) || home();
  const dir = path.resolve(expanded),
    plain = path.normalize(expanded).replace(/(?<=.)[\\/]+$/, "");
  const root = path.parse(dir).root;
  if (dir === root) throw Error("不可将整个磁盘作为工作目录");
  if (!path.isAbsolute(expanded) || plain.toLowerCase() !== dir.toLowerCase())
    throw Error(
      `工作目录必须是完整的绝对路径${process.platform === "win32" ? "（须带盘符，如 D:\\项目）" : ""}：${String(raw || "").trim()}`
    );
  return dir;
}
// 把 Node 的文件系统错误译成可读的说明，页面与模型都不必面对 ENOENT 之类的代号
function describeFsError(error, target = "") {
  const code = error?.code,
    where = target ? `：${target}` : "";
  if (code === "ENOENT") return `路径不存在${where}`;
  if (code === "EEXIST" || code === "ENOTDIR") return `路径已被文件占用，不是目录${where}`;
  if (code === "EACCES" || code === "EPERM") return `没有访问权限${where}`;
  if (code === "EISDIR") return `目标是目录，不是文件${where}`;
  if (code === "EBUSY") return `文件正被占用${where}`;
  return String(error?.message || error).slice(0, 200);
}
function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}
function pathIsInside(root, target) {
  const relative = path.relative(root, target);
  return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function resolveInside(workdir, raw) {
  const target = path.resolve(workdir, String(raw || "."));
  if (!pathIsInside(workdir, target)) throw Error(`路径越出了工作目录：${raw}`);
  return target;
}
// 文件工具的落点。默认限定在工作目录之内；用户在设置里放开（roam）后，完整限定的绝对路径（盘符 / UNC / POSIX 根）可以指向目录之外——
// 系统级的配置、别处的资料本就该读得到；相对路径仍相对工作目录。目录之外的路径不再查链接（那是为守住目录边界设的），也不能是整个磁盘
function resolveTarget(workdir, raw, roam) {
  const text = String(raw || ".").trim();
  if (!roam || !path.isAbsolute(text)) return resolveInside(workdir, text);
  const target = path.resolve(text);
  if (pathIsInside(workdir, target)) return target;
  if (
    path
      .normalize(text)
      .replace(/(?<=.)[\/]+$/, "")
      .toLowerCase() !== target.toLowerCase()
  )
    throw Error(`目录之外的路径必须是完整的绝对路径${process.platform === "win32" ? "（须带盘符）" : ""}：${raw}`);
  if (target === path.parse(target).root) throw Error("不可把整个磁盘当作目标");
  return target;
}
async function assertReachable(workdir, target) {
  if (pathIsInside(workdir, target)) await assertNoEscapingLink(workdir, target);
}
// 逐层检查符号链接与 Windows junction；允许链接仍指向工作目录内部，拒绝借链接跳到目录外。
async function assertNoEscapingLink(workdir, target) {
  const realRoot = await fs.promises.realpath(workdir).catch(error => {
    throw Error(describeFsError(error, workdir));
  });
  const relative = path.relative(workdir, target);
  let current = workdir;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.promises.lstat(current).catch(error => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw Error(describeFsError(error, current));
    });
    if (!stat) break;
    if (!stat.isSymbolicLink()) continue;
    const real = await fs.promises.realpath(current).catch(() => {
      throw Error(`路径包含失效的链接：${relPath(workdir, current)}`);
    });
    if (!pathIsInside(realRoot, real)) throw Error(`路径经过链接越出了工作目录：${relPath(workdir, current)}`);
  }
}
function relPath(workdir, file) {
  return path.relative(workdir, file).split(path.sep).join("/");
}

module.exports = {
  SCRATCH_DIR,
  WORK_SKIP,
  expandHome,
  resolveWorkdir,
  describeFsError,
  clampNumber,
  pathIsInside,
  resolveInside,
  resolveTarget,
  assertReachable,
  assertNoEscapingLink,
  relPath
};
