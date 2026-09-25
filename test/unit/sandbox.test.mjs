// 沙箱（server/sandbox.js）：指令筛查、机密环境变量、目录内的机密文件
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { screenCommand, screenLoose, screenAutoReview, sandboxEnv, screenPath } = require("../../server/sandbox.js");
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
    "curl http://127.0.0.1:3000/api/health",
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
test("screenCommand：出目录的改动拒绝——.. 上溯、别处的绝对路径、盘符相对、UNC、用户目录与 ~", () => {
  assert.match(screen("Move-Item a ../other"), /\.\. 上溯/);
  assert.match(screen("echo x > ../other/y"), /\.\. 上溯/);
  assert.match(screen("Copy-Item a C:\\Users\\me"), /越出了工作目录/);
  assert.match(screen("docker run -v x:/y img > log.txt"), /越出了工作目录/);
  assert.match(screen("copy x \\\\server\\share\\x"), /越出了工作目录/);
  assert.match(screen("New-Item C: -ItemType Directory"), /盘符相对路径/);
  assert.match(screen("Set-Content ~/x.txt hi"), /用户目录|系统目录/);
  assert.match(screen("echo hi > $env:USERPROFILE\\x"), /用户目录|系统目录/);
  assert.match(screen("Out-File %APPDATA%\\x"), /用户目录|系统目录/);
});
test("screenCommand：cmd 那套写动词也算改动——目录那一道全压在这个判定上，漏一个就是放行一次目录外写入", () => {
  for (const command of [
    String.raw`copy x C:\Windows\y`,
    String.raw`xcopy /s src C:\Users\me\bak`,
    String.raw`robocopy src C:\Users\me\bak`,
    String.raw`move x C:\Users\me\y`,
    String.raw`ren C:\Users\me\a b`,
    String.raw`md C:\Users\me\newdir`,
    String.raw`mkdir C:\Users\me\newdir`,
    String.raw`attrib +h C:\Users\me\x`,
    String.raw`mklink C:\Users\me\l x`,
    String.raw`Rename-Item C:\Users\me\a b`,
    String.raw`Compress-Archive src C:\Users\me\a.zip`,
    String.raw`Export-Csv -Path C:\Users\me\a.csv`
  ])
    assert.match(screen(command), /越出了工作目录|用户目录|系统目录/, command);
  // 同样这些动词，落在工作目录之内照常放行
  for (const command of ["copy a b", "md build", "move a b", "Rename-Item a b", "Compress-Archive src out.zip"])
    assert.equal(screen(command), null, command);
});
test("screenCommand：PowerShell 的写别名、套壳的 powershell / cmd、带输出参数的与 .NET 直写，都算改动", () => {
  for (const command of [
    String.raw`sc C:\Windows\yan-probe.txt x`,
    String.raw`ni C:\Windows\yan-probe.txt -ItemType File`,
    String.raw`ri C:\Windows\x`,
    String.raw`mi a C:\Windows\x`,
    String.raw`cpi a C:\Windows\x`,
    String.raw`rni C:\Windows\a b`,
    String.raw`ac C:\Users\me\x.txt y`,
    String.raw`powershell -Command Set-Content C:\Windows\yan-probe.txt x`,
    String.raw`powershell -NoProfile -Command "Set-Content C:\Windows\yan-probe.txt x"`,
    String.raw`pwsh -c "Remove-Item C:\Windows\x"`,
    String.raw`Start-Process powershell -ArgumentList "-Command", "Remove-Item C:\Windows\x"`,
    String.raw`cmd /c "del C:\Windows\x"`,
    String.raw`Invoke-Command -ScriptBlock { Remove-Item C:\Windows\x }`,
    String.raw`curl http://127.0.0.1:3000/x -o C:\Windows\yan-probe.txt`,
    String.raw`Invoke-WebRequest http://127.0.0.1:1/x -OutFile C:\Windows\x`,
    String.raw`Start-Process node -RedirectStandardOutput C:\Users\me\log.txt`,
    String.raw`[IO.File]::WriteAllText("C:\Windows\x", "y")`,
    String.raw`tar -xf a.tar -C C:\Users\me\out`,
    String.raw`git clone https://github.com/a/b C:\Users\me\b`
  ]) {
    assert.match(screen(command), /越出了工作目录|用户目录|系统目录/, command);
  }
  // 别名定义与注册表别名：给写动词换个名字就认不出来了，一律拒
  assert.match(screen("sal zz Remove-Item; zz C:\\Windows\\x"), /别名/);
  assert.match(screen("Set-Alias zz Remove-Item"), /别名/);
  assert.match(screen("sp HKCU:\\Software\\x -Name a -Value 1"), /注册表/);
  assert.match(screen('powershell -c "reg add HKLM\\Software\\x"'), /注册表/);
  // 同名的别的东西照常：sc query 是看服务，Get-Process powershell 只是列进程，gcc -o 写在目录内
  for (const command of [
    "sc query spooler",
    "Get-Process powershell",
    "tar -tf a.tar",
    "git clone https://github.com/a/b",
    "gcc -o build/a.exe a.c"
  ])
    assert.equal(screen(command), null, command);
});
test("screenCommand：只读的来源不受目录限——拷进来、读出来送进管道的那个路径可以在外面，写的那头仍要在目录内", () => {
  for (const command of [
    String.raw`Copy-Item C:\Users\me\input.txt .\input.txt`,
    String.raw`Copy-Item -Recurse C:\Users\me\src .\src`,
    String.raw`Copy-Item -Path C:\Users\me\a -Destination .\a`,
    String.raw`copy C:\Users\me\a .\a`,
    String.raw`robocopy C:\Users\me\src .\src /E`,
    String.raw`Get-Content C:\Users\me\input.txt | Set-Content .\input.txt`,
    String.raw`type C:\Users\me\x > out.txt`,
    String.raw`Copy-Item $env:USERPROFILE\x.txt .`,
    String.raw`Copy-Item $env:TEMP\x.txt .`,
    String.raw`copy %TMP%\x.txt .`,
    "Copy-Item ../other/x ."
  ]) {
    assert.equal(screen(command), null, command);
  }
  // 搬走会删掉源头，robocopy /MOV 同理；目标在外面、通过管道去删外面的，都不放
  for (const command of [
    String.raw`Move-Item C:\Users\me\input.txt .\input.txt`,
    String.raw`robocopy C:\Users\me\src .\src /MOV`,
    String.raw`Copy-Item .\a C:\Users\me\b`,
    String.raw`Copy-Item C:\Users\me\a C:\Users\me\b`,
    String.raw`Get-ChildItem C:\Users\me | Remove-Item`,
    String.raw`Get-Content C:\Users\me\x | Set-Content C:\Users\me\y`
  ])
    assert.match(screen(command), /越出了工作目录/, command);
  // 来源豁免只属于那一次参数；同一路径稍后成为写入或删除目标时，不能跟着被全局豁免
  for (const command of [
    String.raw`Copy-Item C:\Users\me\a .; Set-Content C:\Users\me\a x`,
    String.raw`Get-Content C:\Users\me\a | Set-Content .\a; Remove-Item C:\Users\me\a`,
    String.raw`copy C:\Users\me\a . & del C:\Users\me\a`,
    String.raw`Copy-Item $env:USERPROFILE\a .; Set-Content $env:USERPROFILE\a x`,
    "Copy-Item ../other/x .; Remove-Item ../other/x"
  ]) {
    assert.match(screen(command), /越出了工作目录|用户目录|系统目录|上溯/, command);
  }
  // TEMP / TMP 要留在进程环境里供程序使用，但显式文件指令不能借它们写出工作目录
  for (const command of [
    String.raw`Set-Content $env:TEMP\yan.txt x`,
    String.raw`Set-Content $env:TMP\yan.txt x`,
    String.raw`Set-Content %TEMP%\yan.txt x`,
    String.raw`Set-Content %TMP%\yan.txt x`
  ]) {
    assert.match(screen(command), /用户目录|系统目录/, command);
  }
});
test("screenCommand：查看可及整台机器——电脑检查要翻系统目录、注册表与进程，读不设目录限", () => {
  for (const command of [
    "Get-ChildItem C:\\Windows\\System32\\drivers\\etc",
    "Get-Content C:\\Windows\\System32\\drivers\\etc\\hosts",
    "dir %APPDATA%",
    "Get-ChildItem $env:ProgramFiles",
    "cat ~/.gitconfig",
    "Get-ChildItem ../other",
    "cd ..",
    "cd C:",
    "reg query HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
    "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
    "Get-Process | Sort-Object WorkingSet64 -Descending",
    "Get-Service | Where-Object {$_.Status -eq 'Running'}",
    "systeminfo",
    "Get-WinEvent -LogName System -MaxEvents 20",
    "type \\\\server\\share\\x"
  ])
    assert.equal(screen(command), null, command);
});
test("screenCommand：注册表查看放行、改动仍拒", () => {
  assert.match(screen("reg add HKLM\\Software\\x /v a /d 1"), /注册表/);
  assert.match(screen("Set-ItemProperty HKCU:\\Software\\x -Name a -Value 1"), /注册表/);
  assert.match(screen("Remove-Item HKCU:\\Software\\x"), /注册表/);
  assert.match(screen("regedit /s x.reg"), /注册表/);
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
  assert.equal(screen("Start-Process notepad"), null);
  assert.match(screen("Start-Process powershell -Verb RunAs"), /提权/);
  assert.match(screen("Set-ExecutionPolicy Unrestricted"), /执行策略/);
  assert.match(screen("powershell -enc AGUAYwBoAG8AIABoAGkAAGUAYwBoAG8AIABoAGkA"), /编码/);
  assert.match(screen('iex "dir"'), /编码/);
  assert.match(screen("curl https://example.com"), /外联/);
  assert.match(screen("iwr https://example.com -OutFile x"), /外联/);
  assert.match(screen("curl $url"), /外联/);
  assert.match(screen("(New-Object Net.WebClient).DownloadString('http://x')"), /外联/);
});
test("screenAutoReview：只拦伤及系统与难以恢复的；目录、机密、Git 回退、别名都放行", () => {
  for (const command of [
    "npm install",
    "git commit -m test",
    "git reset --hard",
    "git clean -fdx",
    "Start-Process notepad",
    "Stop-Process -Id 1234",
    "curl https://example.com",
    "Set-Content src/out.txt ok",
    "Remove-Item build -Recurse -Force",
    "rmdir /s /q build",
    "Get-Content .env",
    "Set-Content .git/config x",
    "sal zz Remove-Item",
    String.raw`Move-Item .\dist D:\code\other\dist`,
    String.raw`Set-Content C:\Users\me\note.txt x`,
    String.raw`Set-Content $env:TEMP\yan.txt x`,
    String.raw`Copy-Item C:\Windows\System32\drivers\etc\hosts .\hosts.bak`,
    String.raw`Get-ChildItem C:\Windows`
  ])
    assert.equal(screenAutoReview(command), null, command);
  for (const command of [
    "Set-ExecutionPolicy Unrestricted",
    "Stop-Service WinDefend",
    "shutdown /s",
    "Remove-Item . -Recurse -Force",
    'iex "dir"',
    String.raw`Set-Content C:\Windows\temp\x.txt x`,
    String.raw`Copy-Item .\a.dll "C:\Program Files\x\a.dll"`,
    String.raw`Set-Content $env:ProgramData\x.txt x`,
    String.raw`echo x > %windir%\x.txt`
  ])
    assert.match(screenAutoReview(command), /审查拒绝/, command);
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
test("screenCommand：只是搜字的不算外联——rg HttpClient、Select-String System.Net 放行，真用 .NET 联网的仍拒", () => {
  for (const command of ["rg HttpClient src", 'Select-String -Path src/*.cs -Pattern "System.Net"', "git grep WebClient"])
    assert.equal(screen(command), null, command);
  for (const command of [
    "[System.Net.WebClient]::new().DownloadString('http://x')",
    "(New-Object System.Net.WebClient).DownloadFile('http://x', 'a')",
    "[System.Net.Http.HttpClient]::new()",
    "[Net.ServicePointManager]::SecurityProtocol"
  ])
    assert.match(screen(command), /外联/, command);
});
test("screenLoose：审而后行与径行的沙箱只守系统——联网、目录外、机密、.git 都放行，动系统与系统目录仍拒", () => {
  for (const command of [
    "curl https://example.com",
    "iwr https://example.com -OutFile x.zip",
    "Set-Content ../sibling/x.txt ok",
    "Set-Content ~/note.txt x",
    String.raw`Set-Content $env:TEMP\yan.txt x`,
    "Get-Content .env",
    "Set-Content .git/config x",
    "Remove-Item build -Recurse -Force",
    "npm run dev"
  ])
    assert.equal(screenLoose(command), null, command);
  for (const command of [
    String.raw`reg add HKLM\Software\x`,
    "Stop-Service WinDefend",
    "shutdown /s",
    "Start-Process powershell -Verb RunAs",
    'iex "dir"',
    "sal zz Remove-Item",
    String.raw`Set-Content C:\Windows\x.txt x`
  ])
    assert.match(screenLoose(command), /沙箱拒绝/, command);
});

test("三档筛查都不放指令调言的本机桥接：它的接口不经请示与沙箱，调它就绕过了整套门禁", () => {
  const port = Number(process.env.YAN_PORT || 8787);
  for (const command of [
    `curl -X POST http://127.0.0.1:${port}/api/work/run -d "{}"`,
    `Invoke-RestMethod http://localhost:${port}/api/store`,
    `node -e "fetch('http://[::1]:${port}/api/work/run')"`,
    `wget 127.0.0.1:${port}/api/bootstrap`
  ]) {
    assert.match(screen(command), /沙箱拒绝：指令不调言的本机桥接/, command);
    assert.match(screenLoose(command), /沙箱拒绝：指令不调言的本机桥接/, command);
    assert.match(screenAutoReview(command), /审查拒绝：指令不调言的本机桥接/, command);
  }
  // 别的本机端口照常能测；端口只是前缀相同的不算
  for (const command of ["curl http://127.0.0.1:3000/", `curl http://127.0.0.1:${port}0/`]) {
    assert.equal(screen(command), null, command);
    assert.equal(screenAutoReview(command), null, command);
  }
});
