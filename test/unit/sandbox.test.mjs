// 沙箱（server/sandbox.js）：指令筛查、机密环境变量、目录内的机密文件
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { screenCommand, sandboxEnv, screenPath } = require("../../server/sandbox.js");
const wd = "E:\\项目\\言",
  win = { platform: "win32" },
  screen = command => screenCommand(command, wd, win);

test("screenCommand：日常的开发指令放行——包管理、git、目录内的绝对路径、本机 curl、.草稿 脚本", () => {
  for (const command of [
    "npm run format",
    "npm test",
    "git status",
    "git log a..b --oneline",
    "git diff main...HEAD",
    'git commit -m "look at this"',
    "Get-Content src/a.js",
    "Get-ChildItem E:\\项目\\言\\src",
    "Get-ChildItem e:/项目/言/src/",
    "curl http://127.0.0.1:8787/api/health",
    "python .草稿/x/make.py",
    'node -e "console.log([...a])"',
    "echo shutdown now",
    "dotnet user-secrets list",
    "sed -e s/aaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbb/ x",
    "Remove-Item -Recurse -Force dist",
    "git push origin HEAD:main"
  ])
    assert.equal(screen(command), null, command);
});
test("screenCommand：出目录的路径拒绝——.. 上溯、别处的绝对路径、盘符相对、UNC、用户目录与 ~", () => {
  assert.match(screen("cd .."), /\.\. 上溯/);
  assert.match(screen("Get-ChildItem ../other"), /\.\. 上溯/);
  assert.match(screen("Get-ChildItem C:\\Users\\me"), /越出了工作目录/);
  assert.match(screen("docker run -v x:/y img"), /越出了工作目录/);
  assert.match(screen("type \\\\server\\share\\x"), /越出了工作目录/);
  assert.match(screen("cd C:"), /盘符相对路径/);
  assert.match(screen("cat ~/.ssh/id_rsa"), /用户目录/);
  assert.match(screen("Get-Content $env:USERPROFILE\\x"), /用户目录/);
  assert.match(screen("dir %APPDATA%"), /用户目录/);
});
test("screenCommand：动系统的拒绝——注册表、计划任务、服务、账户、磁盘、提权、执行策略；藏字的与外联的也拒绝", () => {
  assert.match(screen("reg add HKLM\\Software\\x"), /注册表/);
  assert.match(screen("cmd /c reg add x"), /注册表/);
  assert.match(screen("Set-ItemProperty HKCU:\\Software\\x -Name a -Value 1"), /注册表/);
  assert.match(screen("schtasks /create /tn x"), /计划任务/);
  assert.match(screen("New-Service -Name x"), /系统服务/);
  assert.match(screen("sc stop spooler"), /系统服务/);
  assert.match(screen("net user admin pw /add"), /账户/);
  assert.match(screen("shutdown /s"), /系统、磁盘与权限/);
  assert.match(screen("format c:"), /磁盘/);
  assert.match(screen("Start-Process notepad"), /提权/);
  assert.match(screen("Set-ExecutionPolicy Unrestricted"), /执行策略/);
  assert.match(screen("powershell -enc AGUAYwBoAG8AIABoAGkAAGUAYwBoAG8AIABoAGkA"), /编码/);
  assert.match(screen('iex "dir"'), /编码/);
  assert.match(screen("curl https://example.com"), /外联/);
  assert.match(screen("iwr https://example.com -OutFile x"), /外联/);
  assert.match(screen("curl $url"), /外联/);
  assert.match(screen("(New-Object Net.WebClient).DownloadString('http://x')"), /外联/);
});
test("screenCommand：指令通道也不许显式碰机密文件或直接改 .git 内部", () => {
  for (const command of [
    "Get-Content .env",
    "type src\\.env.local",
    'cat "keys/id_rsa"',
    "Get-Content config/secrets.yaml",
    "Remove-Item certs/site.pfx"
  ])
    assert.match(screen(command), /机密|凭据/, command);
  for (const command of ["Set-Content .git/config x", "Remove-Item .git/hooks/pre-commit", "echo x > .git/config"])
    assert.match(screen(command), /\.git 内部/, command);
  for (const command of ["Get-Content .git/config", "git config user.name", "dotnet user-secrets list", "Get-Content env.d.ts"])
    assert.equal(screen(command), null, command);
});
test("sandboxEnv：名字像机密的环境变量不给指令，其余照传", () => {
  const env = sandboxEnv({
    PATH: "1",
    OPENAI_API_KEY: "x",
    GITHUB_TOKEN: "y",
    TEMP: "z",
    YAN_API_CONFIG: "c",
    YAN_PORT: "1",
    DB_PASSWORD: "p",
    AWS_SECRET_ACCESS_KEY: "s"
  });
  assert.deepEqual(Object.keys(env).sort(), ["PATH", "TEMP", "YAN_PORT"]);
});
test("screenPath：机密文件不读不写，.git 内部不写、可读；别的照常", () => {
  for (const p of [".env", "src/.env.local", "a/id_rsa", "key.pem", "config\\secrets.json", "x.credentials"]) {
    assert.match(screenPath(p), /机密文件/, p);
    assert.match(screenPath(p, { write: true }), /机密文件/, p);
  }
  assert.equal(screenPath(".git/config"), null);
  assert.match(screenPath(".git/config", { write: true }), /\.git 内部/);
  assert.match(screenPath(".git\\hooks\\pre-commit", { write: true }), /\.git 内部/);
  for (const p of ["src/index.js", ".github/workflows/ci.yml", "monkey.txt", "keys/readme.md", "env.d.ts"]) {
    assert.equal(screenPath(p), null, p);
    assert.equal(screenPath(p, { write: true }), null, p);
  }
});
