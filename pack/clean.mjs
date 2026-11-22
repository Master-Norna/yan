// 发布便携包时只打已提交的仓库版本；不允许 ZIP 偷偷混进本机尚未提交的内容。
import { execFileSync } from "node:child_process";

export function assertCleanWorkingTree(root) {
  const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
  if (dirty) {
    const changed = dirty.split(/\r?\n/);
    const preview = changed.slice(0, 8).join("\n");
    const more = changed.length > 8 ? `\n…另有 ${changed.length - 8} 项` : "";
    throw Error(`工作区有 ${changed.length} 项未提交或未跟踪的改动，拒绝生成正式便携包；请先提交或清理：\n${preview}${more}`);
  }
}
