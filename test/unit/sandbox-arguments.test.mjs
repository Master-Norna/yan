// 同一操作换了赋值、缩进、套壳或参数引号，沙箱的边界不应改变。
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { screenCommand, screenLoose, screenAutoReview } = require("../../server/sandbox.js");
const win = { platform: "win32" },
  mac = { platform: "darwin" },
  wd = "E:\\项目\\言";
const verdicts = (command, options = win) => [
  screenCommand(command, options.platform === "win32" ? wd : "/Users/a/proj", options),
  screenLoose(command, options),
  screenAutoReview(command, options)
];

test("输出目标：赋值、缩进、脚本块、单层壳与引号参数组合后，三档仍守系统目录", () => {
  const wraps = [
    c => c,
    c => `Write-Output ready; ${c}`,
    c => `Write-Output ready\n  ${c}`,
    c => `if ($true) { ${c} }`,
    c => `powershell -NoProfile -Command '${c}'`
  ];
  for (const archive of ["a.zip", '"a b.zip"'])
    for (const output of ["-oC:\\Windows\\x", '"-oC:\\Windows\\x"', '-o"C:\\Windows\\x"']) {
      const raw = `7z x ${archive} ${output}`;
      for (const body of [raw, `$r = ${raw}`, `$r=${raw}`])
        for (const wrap of wraps) for (const why of verdicts(wrap(body))) assert.match(why || "", /越出了工作目录|系统目录/, wrap(body));
      for (const why of verdicts(`cmd /d /c ${raw}`)) assert.match(why || "", /越出了工作目录|系统目录/, raw);
    }
  for (const command of [
    "env gcc a.c -o/usr/local/bin/a",
    "true; env gcc a.c -o/usr/local/bin/a",
    "true\n  env gcc a.c -o/usr/local/bin/a",
    'sh -c "env gcc a.c -o/usr/local/bin/a"'
  ])
    for (const why of verdicts(command, mac)) assert.match(why || "", /越出了工作目录|系统目录/, command);
  for (const command of [
    "7z x a.zip `\n-oC:\\Windows\\x",
    "7z x a.zip `\r\n-oC:\\Windows\\x",
    "Write-Output ready; & 'C:\\Program Files\\7-Zip\\7z.exe' x a.zip -oC:\\Windows\\x"
  ])
    for (const why of verdicts(command)) assert.match(why || "", /越出了工作目录|系统目录/, command);
  for (const why of verdicts("gcc a.c \\\n-o/usr/local/bin/a", mac)) assert.match(why || "", /越出了工作目录|系统目录/);
});

test("重复输出参数、字面量与嵌套替换：筛查耗时不随每个 -o 重扫整段", () => {
  const commands = [
    `Write-Output "${"-oC:\\Windows\\x ".repeat(2000)}"`,
    `7z x a.zip ${"-o.\\build ".repeat(2000)}`,
    `Write-Output "${"$(".repeat(800)}7z x a.zip -oC:\\Windows\\x${")".repeat(800)}"`
  ];
  verdicts("7z x a.zip -o.\\build");
  for (const command of commands) {
    const start = performance.now();
    verdicts(command);
    assert.ok(performance.now() - start < 600, `${command.length} 字符的三档筛查应在 600ms 内返回`);
  }
});

test("输出目标与写判定共用参数：紧贴上溯只在严档拦，目录内目标三档可写", () => {
  for (const tool of ["7z", "7za", "7zr", "curl", "gcc", "g++", "clang", "dotnet"])
    for (const prefix of ["", "Write-Output ready; $r = "])
      for (const quoted of [false, true]) {
        const out = path => (quoted ? `"-o${path}"` : `-o${path}`),
          input = tool === "curl" ? " http://127.0.0.1:9/a" : "",
          command = `${prefix}${tool} ${out("..\\x")}${input}`,
          [strict, loose, review] = verdicts(command);
        assert.match(strict || "", /不用 \.\. 上溯/, command);
        assert.equal(loose, null, command);
        assert.equal(review, null, command);
        assert.deepEqual(verdicts(`${prefix}${tool} ${out(".\\build")}${input}`), [null, null, null]);
      }
});

test("provider 目标：路径参数与位置目标都认，普通值与缩写值参数不算定义别名", () => {
  for (const name of ["Set-Item", "New-Item", "si", "ni"])
    for (const args of [
      "-Force -Path alias:t -Value Write-Output",
      "-Value Write-Output -Path alias:t -Force",
      "-Path:function:t -Value Write-Output",
      "-Force alias:t Write-Output"
    ]) {
      const command = `Write-Output ready; ${name} ${args}`,
        [strict, loose] = verdicts(command);
      assert.match(strict || "", /不定义别名/, command);
      assert.match(loose || "", /不定义别名/, command);
    }
  for (const command of [
    "Set-Item env:FOO alias:t",
    "Set-Item -Force env:FOO function:t",
    "Set-Item -Path env:FOO alias:t",
    "Set-Item env:FOO -Val alias:t",
    "Set-Item -Path env:FOO -Va function:t",
    "Set-Item -Path env:FOO -Value alias:t",
    "Set-Item -Path env:FOO -Value:alias:t",
    "New-Item -Path . -Name a.txt -Value function:t",
    "New-Item -Path . -Name a.txt -Target alias:t"
  ])
    assert.deepEqual(verdicts(command), [null, null, null], command);
});

test("执行正文与参数值分开：普通字符串、搜索词和注释中的命令不产生输出目标", () => {
  for (const command of [
    'Write-Output "-oC:\\Windows\\note.txt"; Set-Content .\\a ok',
    'Set-Content .\\a "7z x a.zip -oC:\\Windows\\x"',
    'git commit -m "7z -oC:\\Windows\\x"',
    'rg "Set-Item alias:t" src',
    "powershell -Command 'Write-Output \"7z x a.zip -oC:\\Windows\\x\"'",
    "powershell -Command 'Set-Content .\\a \"7z x a.zip -oC:\\Windows\\x\"'",
    'cmd /c echo "7z x a.zip -oC:\\Windows\\x"',
    "Get-ChildItem C:\\Windows | Where-Object { $_.Name -like '*.txt' -or $_.Length -eq 0 }",
    "grep -oE 'name' /etc/hosts",
    "Set-Content .\\a @'\n7z x a.zip -oC:\\Windows\\x\n'@",
    'Set-Content .\\a @"\nSet-Item alias:t\n"@',
    "7z x a.zip # -oC:\\Windows\\x"
  ])
    assert.deepEqual(verdicts(command), [null, null, null], command);
  // 参数中的命令替换仍是真执行，不能跟普通字串一起遮掉。
  for (const command of ['Write-Output "$(7z x a.zip -oC:\\Windows\\x)"', 'Write-Output "$(si alias:t Write-Output)"'])
    assert.ok(verdicts(command)[0], command);
});

test("真实执行入口：三种权限都拦输出到系统目录，普通 provider 值可到达执行器", async () => {
  const shellPath = require.resolve("../../server/work/shell.js"),
    workPath = require.resolve("../../server/work/index.js"),
    originalShell = require.cache[shellPath],
    originalWork = require.cache[workPath],
    executed = [];
  // 只替代最后的执行器，保留真实 JSON 路由、档位选择和沙箱筛查，避免回归时真的运行危险指令。
  require.cache[shellPath] = {
    id: shellPath,
    filename: shellPath,
    loaded: true,
    exports: () => ({
      WORK_SHELL: "测试桩",
      runShell: async command => {
        executed.push(command);
        return { stdout: "intercepted", stderr: "", exitCode: 0 };
      }
    })
  };
  delete require.cache[workPath];
  try {
    const work = require(workPath)({ archiveHome: () => process.cwd(), workHome: () => process.cwd(), toolEnv: env => env });
    for (const permission of ["ask", "review", "auto"])
      for (const command of [
        "Write-Output ready; $r = 7z x a.zip -oC:\\Windows\\x",
        'cmd /c 7z x "a b.zip" -oC:\\Windows\\x',
        "Set-Item env:FOO alias:t"
      ]) {
        // 入口按本机平台筛查，POSIX 用同一类输出与普通参数值验证。
        const input =
            process.platform === "win32"
              ? command
              : command.startsWith("Set-Item")
                ? "printf '%s' alias:t"
                : "true; env gcc a.c -o/usr/local/bin/a",
          allowed = command.startsWith("Set-Item"),
          before = executed.length,
          req = Readable.from([Buffer.from(JSON.stringify({ workdir: process.cwd(), sandbox: true, permission, command: input }))]),
          res = new EventEmitter();
        res.writeHead = status => {
          res.status = status;
        };
        res.end = body => {
          res.body = JSON.parse(body);
          res.writableEnded = true;
        };
        await work.routes["POST /api/work/run"](req, res);
        assert.equal(res.status, allowed ? 200 : 400, `${permission}: ${input}`);
        assert.equal(executed.length - before, allowed ? 1 : 0, `${permission}: ${input}`);
        if (!allowed) assert.match(res.body.error, /越出了工作目录|系统目录/);
      }
  } finally {
    if (originalShell) require.cache[shellPath] = originalShell;
    else delete require.cache[shellPath];
    if (originalWork) require.cache[workPath] = originalWork;
    else delete require.cache[workPath];
  }
});
