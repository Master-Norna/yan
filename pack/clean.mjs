// 发布便携包时只打已提交的仓库版本；不允许 ZIP 偷偷混进本机尚未提交的内容。
import { execFileSync } from "node:child_process";

export function assertCleanWorkingTree(root) {
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
  if (dirty) throw Error("工作区有未提交或未跟踪的改动，拒绝生成正式便携包；请先提交或清理改动");
}
