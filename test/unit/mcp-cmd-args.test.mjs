// Windows 上 npx、uvx 这类 MCP 启动器是 .cmd，参数要经 cmd 再转一道才到得了服务手里。
// 这里走真实链路：起一个把收到的参数原样写下来的 .cmd（与 npx.cmd 同为 %* 转发），
// 看哪些原样、%变量% 展开之后是不是仍算一个参数（改前 %PATH% 一带就会把整条命令拆散）
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { createTransport } = createRequire(import.meta.url)("../../server/mcp/transports.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-cmd-args-"));
const launcher = path.join(dir, "fwd.cmd");
fs.writeFileSync(
  launcher,
  ["@echo off", `node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))" "%~dp0argv.json" %*`].join(
    "\r\n"
  ),
  "utf8"
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// 起一个 .cmd，交两个参数（前缀 + 待测的那一个），回它最后交给 node 的 argv
async function argvOf(value, env = {}) {
  const out = path.join(dir, "argv.json");
  fs.rmSync(out, { force: true });
  const transport = createTransport({ command: launcher, args: ["PREFIX", value], env });
  try {
    await transport.start();
    for (let i = 0; i < 60 && !fs.existsSync(out); i++) await sleep(100);
    return fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
  } finally {
    transport.close();
  }
}

test(
  "经 cmd 起 .cmd：参数原样到服务手里，%变量% 展开后仍是一个参数",
  { skip: process.platform !== "win32" && "只有 Windows 上经 cmd 起 .cmd" },
  async () => {
    // 原样的这一批：空格、引号、感叹号、cmd 的元字符、中文
    for (const value of ["C:\\Temp\\a b\\c.json", 'he said "hi"', "exclaim!one", "a&b|c^d", "汉字 参数"])
      assert.deepEqual(await argvOf(value), ["PREFIX", value], value);
    // %变量% 照 cmd 的规矩展开（服务配 %APPDATA% 这样的写法即按此生效），但不再把后面劈成几个参数
    assert.deepEqual(await argvOf("%PATH%"), ["PREFIX", process.env.PATH], "%PATH%");
    assert.deepEqual(await argvOf("100%USERPROFILE%\\x"), ["PREFIX", `100${process.env.USERPROFILE}\\x`]);
    // 未定义的、落单的 % 原样留着——cmd 也这样
    assert.deepEqual(await argvOf("%NOPE%\\x"), ["PREFIX", "%NOPE%\\x"]);
    assert.deepEqual(await argvOf("100%"), ["PREFIX", "100%"]);
    // cmd 的变量替换不会递归展开值：自己先展开后也不能再让 shell 多展开一层。
    assert.deepEqual(await argvOf("%YAN_OUTER%", { YAN_OUTER: "%YAN_INNER%", YAN_INNER: "inner value" }), ["PREFIX", "%YAN_INNER%"]);
    assert.deepEqual(await argvOf("%YAN_OUTER%", { YAN_OUTER: "prefix %YAN_INNER% suffix", YAN_INNER: "inner value" }), [
      "PREFIX",
      "prefix %YAN_INNER% suffix"
    ]);
  }
);

test("经 cmd 起 .cmd：空串参数也保留位置", { skip: process.platform !== "win32" && "只有 Windows 上经 cmd 起 .cmd" }, async () => {
  assert.deepEqual(await argvOf(""), ["PREFIX", ""]);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
