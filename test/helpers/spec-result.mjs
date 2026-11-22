// 测试子进程的退出码不是唯一真相：空跑但 exit 0 的脚本没有完成任何断言，也必须报错。
export function inspectSpecResult(file, out, exit, signal) {
  const code = exit ?? signal;
  const lines = out.split(/\r?\n/);
  const p = lines.filter(line => line.startsWith("PASS")).length;
  const f = lines.filter(line => line.startsWith("FAIL")).length;
  // prompt-size 只记提示词大小，不做断言，故保留唯一例外。
  const missing = !code && !p && !f && file !== "prompt-size.mjs";
  return { code, lines, p, f, missing, failures: f + (code && !f ? 1 : 0) + (missing ? 1 : 0) };
}
