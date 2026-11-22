// 测试子进程的退出码不是唯一真相：空跑但 exit 0 的脚本没有完成任何断言，也必须报错。
import { basename } from "node:path";

// 纯诊断脚本只产出统计，不承诺 PASS/FAIL 断言；集中登记，传入路径时也能识别。
const NON_ASSERTING_SPECS = new Set(["prompt-size.mjs"]);
export function inspectSpecResult(file, out, exit, signal) {
  const code = exit ?? signal;
  const lines = out.split(/\r?\n/);
  const p = lines.filter(line => line.startsWith("PASS")).length;
  const f = lines.filter(line => line.startsWith("FAIL")).length;
  // prompt-size 只记提示词大小，不做断言，故保留唯一例外。
  const missing = !code && !p && !f && !NON_ASSERTING_SPECS.has(basename(file));
  return { code, lines, p, f, missing, failures: f + (code && !f ? 1 : 0) + (missing ? 1 : 0) };
}
