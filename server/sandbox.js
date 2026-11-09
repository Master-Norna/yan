// 言 · 沙箱：给执事与卷宗的指令、文件工具划一道界。守三样：
//   目录——改动不出工作目录（写、删、搬与重定向：相对路径不上溯，绝对路径只认目录之内，不往用户目录与系统目录里写）；
//         查看则可及整台机器——给电脑做检查本就要翻系统目录、注册表与进程，锁住读等于把这件事堵死。
//         机密文件（.env、密钥、凭据）与 .git 内部另有专条，读写都不放行；文件工具这一路仍是整个目录内，不认「全盘」；
//   环境——指令看不到机密环境变量（名字里带 KEY / TOKEN / SECRET / PASSWORD 之类的一律不传；页面配置里的 API Key 本就不进桥接进程）；
//   指令——动系统的（注册表、服务、计划任务、防火墙、账户、磁盘、关机、提权、执行策略）、藏字的（编码指令、Invoke-Expression、拼出来的命令名）、
//         直接外联的（curl / iwr / wget 之类，指向本机的除外）一律拒绝，装依赖走包管理器。
// 以上是严的一档（screenCommand），给「问而后行」：拦下的由页面转给用户请示，批了这一条就出沙箱跑。
// 「审而后行」「径行」用宽的一档（screenLoose），只守系统本身，见其说明。
// 这是静态筛查，不是进程隔离：脚本里的代码仍以用户的权限跑。筛出来的每一条都带一句原因回给模型，它改一改就能过。
// 纯函数，不碰文件系统；由 server/work/index.js 装配，test/unit 直接测
"use strict";
const path = require("node:path");
const { pathIsInside } = require("./work/paths.js");

const SECRET_ENV = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|PRIVATE/i;
// 「指令位」：一行的开头，或 ; & | ( { 之后（& 调用、脚本块也算），只有站在这个位置上的词才算在执行它——
// 「npm run format」「echo shutdown」里的 format / shutdown 不是。
// 套一层壳的也算：cmd /c、powershell -Command、pwsh -c 后面跟的整段都在执行——指令本就由 PowerShell 跑，
// 「powershell -Command "Set-Content C:\x y"」与直接写没有分别；这类壳之后同一行里的任何词都按指令位看，宁可多拦。
// 赋值的右边也在执行（$r = reg delete …）；右边是带引号的字串（$mode = "copy"）不算
const CMD = String.raw`(?:^|[;&|({\n]|\$[\w:]+\s*=(?=\s*[^\s"'])|\bcmd(?:\.exe)?\b[^\n]*?/[ck]|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?(?=[\s"'&]))\s*["']?(?:&\s*["']?)?`;
// 带引号的命令名要两头都有引号（& "reg.exe" delete）：rg "start|shutdown" src 里的 |shutdown" 是搜字。
// args 是非跟不可的参数，不写就只认命令名到此为止；后面贴着 | 或 ) 的不算，(start|shutdown) 多半是一段正则
const cmd = (names, args = "") => {
  const name = String.raw`(?:${names})(?:\.exe|\.com)?`;
  return new RegExp(
    String.raw`${CMD}(?:(?<=["'])${name}["']|${name})${args ? String.raw`\s+(?:${args})` : String.raw`(?=[\s;}]|$)`}`,
    "im"
  );
};
// cmdlet 带连字符，不会是正则里的一个词，后面贴着什么都算：$(Stop-Computer)、Stop-Computer|x、powershell -c "Stop-Computer"
const cmdlet = (/** @type {string} */ names) => new RegExp(String.raw`${CMD}(?:${names})(?=[\s;|&)}"']|$)`, "im");
// 改「项」的 cmdlet 与它们在 Windows PowerShell 里的别名（ni = New-Item、sp = Set-ItemProperty……）：注册表那条与写动词表都用
const ITEM_WRITERS = String.raw`(?:New|Set|Remove|Clear|Rename|Copy|Move)-Item(?:Property)?|ni|si|ri|cli|rni|rn|cpi|mi|sp|rp|clp|rnp|mp`;
// 定义别名等于给写动词换个名字，静态筛查就认不出来了；与 Invoke-Expression 同属「藏字」
const ALIASING = /\b(?:Set|New)-Alias\b|(^|[\s;&|({])(?:sal|nal)\s/i;
// 藏字：编码过的指令、拿 Invoke-Expression 跑拼出来的字串——筛查与审查都只看得到一串编码，判不了它要做什么。
// iex 按指令位认，后面可贴括号、引号或就此收尾（irm x | iex、iex(irm x)）；赋值的右边也算在执行。rg iex a.txt 是搜字，不算
// PowerShell 认参数名的任意前缀，也认 / 开头：-en、-encodedc、/enc 都是 -EncodedCommand，串再短也能跑。所以站在指令位的 powershell / pwsh（可带路径、可经 Start-Process）
// 后面见到就算；-Command、-File 之后的属于被跑的东西（powershell -c "node -e 1"），不算。别的程序的 -e 只认一长串 base64 那一条
const prefixesOf = (/** @type {string} */ word) => Array.from(word, (_, i) => word.slice(0, i + 1)).join("|");
const POWERSHELL_ENCODED = String.raw`${CMD}(?:Start-Process\s+(?:-FilePath\s+)?)?["']?(?:[^"'\n;|&(){}]*[\\/])?(?:powershell|pwsh)(?:\.exe)?["']?(?:(?![\s"'][-/](?:${prefixesOf("command")}|${prefixesOf("file")})(?:[\s:]|$))[^\n;|&])*?[\s"'][-/](?:ec|${prefixesOf("encodedcommand")})(?=[\s:"']|$)`;
// 命令名是算出来的：& ("i"+"ex")、.("ie"+"x")、& (gcm i*x)，或把字串变成脚本块再跑（[scriptblock]::Create）。规则与审查都看不到它实际跑什么。
// & $exe 不算：把带空格的程序路径放进变量再调用是常规写法，拦了误伤多，真想藏的也还有 node -e 可走（见文件头）
// & 要在语句开头：a & (b) 是 pandas 之类脚本里的按位与
const COMPUTED_CALL = String.raw`(?:^|[;|({\n=])\s*[&.]\s*\(|\[(?:System\.Management\.Automation\.)?ScriptBlock\]::Create\b|\.InvokeCommand\.(?:InvokeScript|NewScriptBlock)\b`;
const HIDDEN = new RegExp(
    String.raw`\bInvoke-Expression\b|(?:${CMD}|=\s*)iex(?![\w.-])|-EncodedCommand\b|(^|\s)-(enc|ec|e)\s+[A-Za-z0-9+=]{32,}|${POWERSHELL_ENCODED}|${COMPUTED_CALL}`,
    "im"
  ),
  HIDDEN_WHY = "不用编码或拼接的指令，直接写出来";
// 指令位上的程序可以写全路径（C:\Windows\System32\reg.exe、& "C:\Program Files\…\reg.exe"）。规则都按命令名认，筛之前先去掉程序的目录，
// 禁用规则、外联、写动词就不必各自认路径；程序自己的路径也不再算它碰的路径——& "C:\Program Files\7-Zip\7z.exe" x a.zip 并没有往系统目录里写。
// 带引号的只认 & 与 . 之后的：别处的引号是字串，("C:\Windows\x") 正可能是写入目标；cmd /c、powershell -c 后面的引号裹的是整条指令，也按不带引号的认。
// 续行（反引号、反斜杠）之后的一行不是指令位，那可能正是写入目标
const LINE_START = String.raw`(?<![${"`"}\\][ \t]*\r?\n)^`,
  CALL_SITE = String.raw`(?:${LINE_START}|[;|({&])[ \t]*`,
  UNQUOTED_EXE_DIR = new RegExp(
    String.raw`((?:${CALL_SITE}(?:\.[ \t]+)?|\$[\w:]+[ \t]*=[ \t]*|\bcmd(?:\.exe)?\b[^\n]*?\s/[ck][ \t]*["']?|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?\s[-/](?:${prefixesOf("command")})[ \t]+["']?))[^\s"'${"`"};|&<>(){}]*[\\/]`,
    "gim"
  ),
  QUOTED_EXE_DIR = new RegExp(String.raw`((?:(?<!&)&|${CALL_SITE}\.)[ \t]*["'])[^"'\n]*[\\/]`, "gim");
const withoutExeDir = (/** @type {string} */ text) => text.replace(UNQUOTED_EXE_DIR, "$1").replace(QUOTED_EXE_DIR, "$1");
// 指令里禁用的写法，只此一张表：[正则, 一句原因, 适用的档]。逐条对整段指令文本查，命中即拒。
// 严＝screenCommand（问而后行）；宽＝screenLoose（审而后行、径行开着沙箱时）；审＝screenAutoReview（审而后行的规则）。
// 宽与审不是第二个沙箱：常规开发、安装、Git（含回退与清理）、本机进程、联网、整机查看、写到目录之外都放行，只拦明确会伤及宿主机或难以恢复的动作。
// 它们不向用户请示；拿不准而确实需要做时，模型可以换用结构化工具，或用户切到「问而后行 / 径行」。沙箱开着时沙箱先筛，审查规则再筛
const EVERY = "严宽审",
  WIDE = "宽审";
/** @type {[RegExp, string, string][]} */
const RULES = [
  [cmd("reg", String.raw`(?:add|delete|import|restore|load|unload|copy|save)\b`), "不动注册表", EVERY],
  // 注册表：查看放行（启动项、已装软件、驱动版本都在里头，是电脑检查的常规去处），改则拒绝
  [
    new RegExp(String.raw`\bregedit\b|\b(?:${ITEM_WRITERS})\b[^\n]*(?:\bHK(?:LM|CU|CR|U|CC)\s*:|\bHKEY_|\bRegistry::)`, "i"),
    "不动注册表——查看可以，改不行",
    EVERY
  ],
  // 计划任务：严档连查看也拦，宽档只拦改动与触发
  [cmd("schtasks"), "不动计划任务", "严"],
  [/\bschtasks(?:\.exe)?\b[^\n]*(?:\/create|\/delete|\/change|\/run|\/end)\b/i, "不动计划任务", WIDE],
  [cmdlet("(?:Register|Unregister|Set|Enable|Disable|Start|Stop)-ScheduledTask"), "不动计划任务", EVERY],
  [cmd("sc", String.raw`(?:create|delete|config|start|stop|failure)\b`), "不动系统服务", EVERY],
  [cmd("net", String.raw`(?:stop\b|start\s+\S)`), "不动系统服务", EVERY],
  [cmdlet("(?:New|Set|Remove|Start|Stop|Restart)-Service"), "不动系统服务", EVERY],
  [/\bnetsh(?:\.exe)?\b[^\n]*\b(?:set|add|delete|reset|exec|import)\b/i, "不动网络与防火墙配置", EVERY],
  [
    cmdlet(String.raw`(?:New|Set|Remove|Enable|Disable)-NetFirewallRule|Set-NetFirewallProfile|Set-DnsClient\w*`),
    "不动网络与防火墙配置",
    EVERY
  ],
  [cmd("net", String.raw`(?:user|localgroup|group|share|accounts)\b`), "不动用户、账户与共享", EVERY],
  // 映射网络盘只在严档拦：宽档本就放行写到目录之外
  [cmd("net", String.raw`use\b`), "不动用户、账户与共享", "严"],
  [cmdlet("(?:New|Remove|Set|Enable|Disable)-LocalUser|(?:Add|Remove)-LocalGroupMember"), "不动用户与账户", EVERY],
  [/-Verb\s+RunAs\b|(^|\s)sudo\s/i, "不提权", EVERY],
  [cmd("runas|shutdown|bcdedit|diskpart|reagentc|sfc|dism|takeown|icacls|cacls|logoff"), "不动系统、磁盘与权限", EVERY],
  // 老命令对应的 cmdlet 与老命令同样按指令位认：rg Format-Volume src 只是搜字
  [
    cmdlet("Format-Volume|Clear-Disk|Initialize-Disk|Set-Disk|(?:New|Remove|Resize|Set)-Partition|Stop-Computer|Restart-Computer|Set-Acl"),
    "不动系统、磁盘与权限",
    EVERY
  ],
  [/\bwmic(?:\.exe)?\b[^\n]*\b(?:call|delete)\b/i, "不通过 WMI 改系统", EVERY],
  [cmdlet("Invoke-(?:Cim|Wmi)Method|Remove-(?:CimInstance|WmiObject)|Set-(?:CimInstance|WmiInstance)"), "不通过 WMI 改系统", EVERY],
  [cmd("format", String.raw`[a-z]:`), "不动磁盘", EVERY],
  [cmdlet("Set-ExecutionPolicy|(?:Set|Add|Remove)-MpPreference"), "不改执行策略与安全设置", EVERY],
  [HIDDEN, HIDDEN_WHY, EVERY],
  [ALIASING, "不定义别名，直接写出指令", "严宽"],
  // .NET 联网只认真在用的写法（[System.Net.…]、New-Object Net.…、::new）：rg HttpClient、Select-String System.Net 这类只是搜字的不算
  [
    /\bcertutil(\.exe)?\b[^\n]*-urlcache|\bStart-BitsTransfer\b|\[(?:System\.)?Net\.[\w.]+\]|New-Object\s+(?:-TypeName\s+)?["']?(?:System\.)?Net\.|\[(?:System\.Net\.Http\.)?HttpClient\]/i,
    "沙箱里不直接外联",
    "严"
  ]
];
/** 这一档里命中的第一条的原因，没有返回 undefined @param {string} text @param {string} tier */
const forbiddenWhy = (text, tier) => RULES.find(([pattern, , tiers]) => tiers.includes(tier) && pattern.test(text))?.[1];
// 环境变量的两种写法（$env:X、${env:X} 与 %X%）从同一份名单生成，补一个名字两边都有
const envVars = (/** @type {string} */ names) => String.raw`\$\{?env:(?:${names})\b|%(?:${names})%`;
const SYSTEM_VARS = String.raw`ProgramData|ProgramFiles(?:\(x86\))?|ProgramW6432|SystemRoot|windir`;
// 用户目录与系统目录：查看放行，写入拒绝。只在判定为「写」的指令上查
const HOME_SYSTEM_PATH = new RegExp(
  String.raw`${envVars(`USERPROFILE|HOME|HOMEPATH|HOMEDRIVE|SystemDrive|APPDATA|LOCALAPPDATA|TEMP|TMP|Public|ALLUSERSPROFILE|${SYSTEM_VARS}`)}|\$\{?HOME\b|(^|[\s"'=])~([\\/]|$)`,
  "i"
);
// 外联工具：只放行目标全在本机的（curl http://127.0.0.1:3000 这样测本地服务是常事；桥接自己的端口另有一条）。
// 带引号的只认站在指令位的（& "curl.exe" …）：rg "curl" src 是搜字。curl 的 --connect-to、-x 之类不往下追：静态筛查追不完，问而后行里这些本来就要请示
const NET_TOOL_NAMES = "curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod";
const NET_TOOLS = new RegExp(
  String.raw`(^|[\s;&|(])(${NET_TOOL_NAMES})(\.exe)?(\s|$)|(^|[;&|(\n]\s*)["'](${NET_TOOL_NAMES})(\.exe)?["'](\s|$)`,
  "i"
);
const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1)$/i;
// 桥接自己的端口：本机别的服务随便测，唯独桥接不行——它的执事接口不带请示与沙箱，指令借 curl、脚本调它就整个绕过去了。
// 严宽两档都拦（径行开着沙箱时也拦：径行放开的是这段对话的指令，不是桥接的门禁）；静态筛查，脚本里拼出来的地址管不到。
// 这是有意不再往下堵：能跑脚本就已有用户的全部权限（node -e 删用户目录一样过得去），调桥接并不多出什么；
// 加口令也藏不住——页面只能把它存进浏览器的 localStorage，那在磁盘上是明文。真要管住脚本得靠进程隔离
const BRIDGE_PORT = Number(process.env.YAN_PORT || 8787);
function callsBridge(text) {
  // 端口可写前导零（:08787）：.NET 与 Node 都当作同一个端口解析，这一道也要认出来
  return new RegExp(String.raw`(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])\s*:\s*0*${BRIDGE_PORT}(?!\d)`, "i").test(text);
}
const BRIDGE_WHY = "指令不调言的本机桥接（它的接口不经请示与沙箱）；要读写文件、跑指令直接用相应的工具";
/**
 * 审查准了也不放行的两样（与存储根那一道一样是底线）：调言自己的桥接——它的接口不经请示与沙箱，跑指令那个口子还认「已审准」，
 * 等于自己给自己盖章；藏字——审查看不见它实际要跑什么，准与驳都只能猜。通过返回 null
 * @param {string} command
 */
function screenUnreviewable(command) {
  const text = String(command || "");
  if (callsBridge(text)) return BRIDGE_WHY;
  return HIDDEN.test(withoutExeDir(text)) ? HIDDEN_WHY : null;
}
// 文件工具会用 screenPath 拦机密文件；指令通道也得拦显式点名，否则 `Get-Content .env` 能从 shell 绕过去。
// 这里只认完整的路径片段，避免把 `dotnet user-secrets list`、`env.d.ts` 这类正常参数误判成文件。
// 不带后缀的 credentials（~/.aws/credentials）要带路径才算：`rg credentials src` 只是搜字。
// 尾部把「:」也算终点：`.env::$DATA` 是 Windows 上碰同一件文件本身（见 withoutDataStream）。
const SECRET_PATH_IN_COMMAND =
  /(^|[\s"'=;|&(])(?:[^\s"'`;|&<>()]*[\\/]credentials|(?:[^\s"'`;|&<>()]*[\\/])?(?:\.env(?:\.[^\s"'`;|&<>()\\/]*)?|[^\s"'`;|&<>()\\/]*\.(?:pem|key|pfx|p12|jks|keystore)|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|[^\s"'`;|&<>()\\/]*\.(?:credentials|secret|secrets)|credentials\.json|secrets\.(?:json|ya?ml|toml)))(?=$|:|[\s"'`;|&)])/i;
// Windows 的 NTFS 数据流：「x::$DATA」「x:stream」写的是同一件文件 x 的另一个流（未命名流即 x 本身），fs 照常打开 x——
// 「.env::$DATA」若原样去比，就绕过了机密文件这一道。比之前把每段里冒号起往后截掉；盘符段「C:」的冒号后是
// 分隔符，开头的单个字母是盘符，都不截。只用于单条路径：混着别的话的文本（指令）不能这么截。
// 别的平台上冒号就是文件名的一部分（keys/service:prod.pem、/tmp/user:data/.yan），不动
function withoutDataStream(value) {
  const text = String(value || "");
  return process.platform === "win32" ? text.replace(/(^|[\\/])([^\\/]*?)(?<!^[A-Za-z]):(?![\\/])[^\\/]*/g, "$1$2") : text;
}
// `.git` 要由 git 自己维护；显式读可以，直接用 shell 写、删、搬则拒绝。脚本内部仍不在静态筛查能力之内。
const GIT_INTERNAL_PATH = /(^|[\s"'=;|&(])[^\s"'`;|&<>()]*\.git[\\/][^\s"'`;|&<>()]*/i;
// 「这条指令会不会改东西」——目录那一道全压在它身上（判定为改，路径才受约束），所以宁可多列：
// 漏一个动词，就等于放行一次目录外的写入。重叠的前缀按长在前排（rmdir 在 rm 前、rename 在 ren 前）。
// 指令由 Windows PowerShell 跑，它的别名是真会执行的：sc = Set-Content、ni = New-Item、ri = Remove-Item、mi / cpi / rni 同理，
// 一并列上；解包、克隆这类把东西放到某处的也算
const WRITE_VERBS = String.raw`Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Set-Item|Clear-Item|Clear-Content|Set-Acl|Compress-Archive|Expand-Archive|Export-Csv|Export-Clixml|Tee-Object|Start-Transcript|(?:New|Set|Remove|Copy|Move|Clear|Rename)-ItemProperty|robocopy|xcopy|copy|rmdir|rd|rm|del|erase|move|mv|cp|rename|ren|mkdir|md|touch|tee|attrib|mklink|fsutil|dd|sc|ac|ni|ri|mi|cpi|rni|rn|si|cli|clc|sp|rp|clp|mp|rnp|epcsv|tar|7za?|unzip|zip|git\s+(?:clone|worktree\s+add)`;
// 带输出目标的参数：curl -o、wget -O、iwr -OutFile、Start-Process 的重定向——动词本身像读，却在往某处写
const OUTPUT_PARAMS = String.raw`(?:^|\s)(?:-o|-O|-OutFile|-OutputPath|-Destination(?:Path)?|-RedirectStandard(?:Output|Error)|--output(?:-document|-dir)?|--outdir|--out-dir)(?=[\s=:]|$)|(?:^|\s)-o(?=[\\/"'A-Za-z])`;
// .NET 直写文件：[IO.File]::WriteAllText、[IO.Directory]::Delete、New-Object IO.StreamWriter 之类
const DOTNET_WRITE = String.raw`\[(?:System\.)?IO\.(?:File|Directory|FileInfo|DirectoryInfo)\]::(?:Write|Append|Create|Delete|Move|Copy|Replace|Set)\w*|\b(?:System\.)?IO\.(?:StreamWriter|FileStream|BinaryWriter)\b`;
const DIRECT_FILE_MUTATION = new RegExp(
  String.raw`${CMD}(?:${WRITE_VERBS})(?:\.exe)?\b|(?:^|[^<])>{1,2}\s*[^&]|${OUTPUT_PARAMS}|${DOTNET_WRITE}`,
  "im"
);

// 审而后行只守系统目录；POSIX 的 /usr、/etc、macOS 的 /System 等也认。用户目录、临时目录、别的项目照常可写。
const REVIEW_SYSTEM_PATH = new RegExp(
  String.raw`${envVars(SYSTEM_VARS)}|(?<![A-Za-z0-9_])[a-z]:[\\/](?:windows|program files(?: \(x86\))?|programdata)(?=[\\/\s"']|$)|(?:^|[\s"'=])\/(?:usr|etc|bin|sbin|boot|lib(?:32|64)?|opt|System|Library|Applications|private\/(?:etc|var)|var\/(?:db|lib|log|run))(?=[\/\s"']|$)`,
  "i"
);
const BROAD_DELETE =
  /\bRemove-Item\b(?=[^\n]*(?:-Recurse|-Force))(?=[^\n]*\s(?:\.(?:[\\/]\*)?|\*|\/|[a-z]:[\\/]?)(?:\s|$))[^\n]*|(^|[;&|(]\s*)rm\s+-[^\s]*r[^\s]*\s+(?:\.|\*|\/|[a-z]:[\\/]?)\s*$|\b(?:rmdir|rd)\b(?=[^\n]*\/s)(?=[^\n]*\s(?:\.|\*|[\\/]|[a-z]:[\\/]?)(?:\s|$))[^\n]*/i;

function normalizeLower(p) {
  return path
    .normalize(p)
    .replace(/(?<=.)[\\/]+$/, "")
    .toLowerCase();
}
// 指令文本里所有像绝对路径的片段：盘符（C:\… 与 C:/…，光秃的 C: 也算——那是盘符相对路径）、UNC（\\server\share 与 //server/share，
// 正斜杠的要带出第二段：//todo 多半是代码注释）；非 Windows 上再加 POSIX 根（/usr/…）。URL 里的 http: 与 key:value 这类前面贴着字母的不算
function absolutePathsIn(command, win) {
  const found = [];
  const drive = /(?<![A-Za-z0-9_])([A-Za-z]:(?:[\\/][^\s"'`;|&<>()]*|(?=[\s"'`;|&<>()]|$)))/g,
    unc = /(?<![\w\\/])(\\\\[^\s\\"'`;|&<>()]+(?:\\[^\s"'`;|&<>()]*)?)/g,
    slashUnc = /(?<![\w\\/:.-])(\/\/[^\s\\/"'`;|&<>()]+\/[^\s"'`;|&<>()]*)/g,
    posix = /(?<![\w./~:-])(\/(?!\/)[^\s"'`;|&<>()]+)/g;
  for (const match of command.matchAll(drive)) found.push(match[1]);
  for (const match of command.matchAll(unc)) found.push(match[1]);
  for (const match of command.matchAll(slashUnc)) found.push(match[1]);
  if (!win) for (const match of command.matchAll(posix)) found.push(match[1]);
  return found;
}
// 只读的来源不受目录约束——从外面拿东西进工作目录是正常的活（查看不限，改动才限）。只认两种最常见的写法，不做 shell 语义解析：
//   Copy-Item / cp / copy / xcopy / robocopy 紧跟动词的第一个路径是源（Move-Item 的源会被删掉，不算；robocopy 带 /MOV 也不算）；
//   Get-Content / gc / cat / type 读出来往管道或重定向里送的那个路径是源。
// 路径里带空格的写法本就认不出来（absolutePathsIn 到空格为止），这里也一样
const PATH_TOKEN = "[^\\s\"'`;|&<>()]+";
const READ_SOURCES = new RegExp(
  String.raw`(?:^|[;&|({\n]\s*)(?:Copy-Item|cpi|cp|copy|xcopy|robocopy)(?:\.exe)?\s+(?:-(?:Recurse|Force|Container)\s+)*(?:-(?:Path|LiteralPath)\s+)?["']?(${PATH_TOKEN})(?![^\n]*/mov)` +
    "|" +
    String.raw`(?:^|[;&|({\n]\s*)(?:Get-Content|gc|cat|type)(?:\.exe)?\s+(?:-(?:Raw|Encoding\s+\S+)\s+)*(?:-(?:Path|LiteralPath)\s+)?["']?(${PATH_TOKEN})(?=[^|>\n]*[|>])`,
  "gim"
);
/**
 * 只记源参数这一次出现的位置，不能按字符串全局豁免：
 * `Copy-Item C:\x .; Remove-Item C:\x` 里前一个 C:\x 是只读来源，后一个仍是删除目标。
 */
function stripReadSources(text) {
  // 正则索引按 UTF-16 code unit 计；split("") 保持同一套索引（指令前有 emoji 时也不会错位）
  const chars = text.split("");
  for (const match of text.matchAll(READ_SOURCES)) {
    const source = match[1] || match[2],
      offset = match[0].lastIndexOf(source),
      start = Number(match.index) + offset;
    if (!source || offset < 0) continue;
    for (let i = start; i < start + source.length; i++) chars[i] = " ";
  }
  return chars.join("");
}
/**
 * 会改动东西的指令，它碰的路径必须都在工作目录之内。判定从严：一条指令里只要出现写、删、搬或重定向，
 * 整条都按「写」处理，它顺带读的那些路径也一并受约束——静态看不出哪个参数是源、哪个是目标，
 * 只有 READ_SOURCES 认得出的那几种来源例外。沙箱与审而后行共用，只差开头的称呼。通过返回 null。
 * @param {string} text @param {string} workdir @param {boolean} win @param {string} prefix
 */
function screenWritePaths(text, workdir, win, prefix) {
  const writeText = stripReadSources(text);
  // 用户目录与系统目录：只是读的来源可以（把 ~/x.txt 拷进来），写进去不行
  if (HOME_SYSTEM_PATH.test(writeText)) return `${prefix}：不往用户目录或系统目录里写，改动一律落在工作目录之内`;
  // .. 上溯：起点在工作目录，往上一级就出去了；深处的 cd .. 静态看不出来，一律不许，改用相对工作目录的路径
  if (/(^|[\s"'=(\\/:])\.\.([\\/]|$|["'\s;|&)])/.test(writeText)) return `${prefix}：改动的路径不用 .. 上溯，一律相对工作目录写`;
  const root = win ? normalizeLower(workdir) : path.normalize(workdir).replace(/(?<=.)[\\/]+$/, "");
  for (const raw of absolutePathsIn(writeText, win)) {
    if (win && /^[a-z]:$/i.test(raw)) return `${prefix}：不用盘符相对路径（${raw}），写完整路径`;
    const candidate = win ? normalizeLower(raw) : path.normalize(raw).replace(/(?<=.)[\\/]+$/, "");
    if (!pathIsInside(root, candidate))
      return `${prefix}：改动的路径越出了工作目录（${raw}）；只能改 ${workdir} 之内的东西。只是查看的话，去掉这条指令里的写、删、搬与重定向即可`;
  }
  return null;
}
// git 的全局选项里会吃掉一个参数的几个：-C <dir>（也可连写成 -C<dir>）、--git-dir / --work-tree（= 或空格）；
// 别的开关（--no-pager、--bare…）不带参数
const GIT_GLOBAL_ARG = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--exec-path",
  "--namespace",
  "--super-prefix",
  "--config-env",
  "--attr-source"
]);
// 这些全局开关能把一条命令塞进 git 来跑（alias、pager、外部 diff），带着就不算「查看」
const GIT_RUNS_COMMANDS = new Set(["-c", "--exec-path", "--config-env", "--namespace", "--super-prefix"]);
// 仓库指到工作目录之外时还放行的子命令：只列敢放行的。写子命令不能穷举——列不全就等于放行一条
// （add、commit、rm、tag 都曾漏在名单外，挪到「只认查看」才收得住）
const GIT_READ_SUB = new Set([
  "log",
  "status",
  "diff",
  "show",
  "blame",
  "rev-parse",
  "rev-list",
  "ls-files",
  "ls-tree",
  "cat-file",
  "describe",
  "shortlog",
  "grep",
  "whatchanged",
  "name-rev",
  "for-each-ref",
  "show-ref",
  "diff-tree",
  "diff-files",
  "diff-index",
  "count-objects",
  "version",
  "help",
  "var",
  "cherry",
  "check-ignore",
  "check-attr",
  "range-diff",
  "verify-commit",
  "verify-tag"
]);
// 有的子命令要看参数才分得清读与写：branch 不带参数是列出、branch -d 是删；只认白名单里的开关
const GIT_READ_ARGS = {
  branch: [
    "-a",
    "--all",
    "-r",
    "--remotes",
    "-v",
    "-vv",
    "--verbose",
    "-l",
    "--list",
    "--show-current",
    "--contains",
    "--merged",
    "--no-merged",
    "--points-at",
    "--format",
    "--sort",
    "--column",
    "--no-column",
    "-i",
    "--ignore-case",
    "--abbrev"
  ],
  tag: [
    "-l",
    "--list",
    "-n",
    "-v",
    "--contains",
    "--merged",
    "--no-merged",
    "--points-at",
    "--format",
    "--sort",
    "--column",
    "--no-column",
    "-i",
    "--ignore-case"
  ],
  remote: ["-v", "--verbose", "show", "get-url"],
  stash: ["list", "show"],
  worktree: ["list"],
  submodule: ["status", "summary"],
  notes: ["list", "show"],
  reflog: ["show", "--all", "-n", "--pretty", "--format", "--date"]
};
// 这些开关后面跟一个取值（--contains main；--sort=-committerdate 用 = 就自成一体）
const GIT_READ_VALUE = new Set(["--contains", "--merged", "--no-merged", "--points-at", "--format", "--sort", "--date", "-n", "get-url"]);
/** 把一条指令切成段（未加引号的 ; | & 换行 括号处断开），每段再切成词（认单双引号） @param {string} text @returns {string[][]} */
function commandSegments(text) {
  const segments = [];
  let tokens = [],
    word = "",
    quote = "";
  const endWord = () => {
      if (word) tokens.push(word);
      word = "";
    },
    endSegment = () => {
      endWord();
      if (tokens.length) segments.push(tokens);
      tokens = [];
    };
  for (const ch of String(text)) {
    if (quote) {
      if (ch === quote) quote = "";
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ";" || ch === "|" || ch === "&" || ch === "\n" || ch === "\r" || ch === "(" || ch === ")") endSegment();
    else if (/\s/.test(ch)) endWord();
    else word += ch;
  }
  endSegment();
  return segments;
}
/**
 * 一段词是不是 git 调用；是就把全局选项与子命令拆开。
 * 只认头一个词是 git 的那种——包在引号里交给别的程序（pwsh -c "git …"）算脚本，本就不在静态筛查之内
 * @param {string[]} tokens @returns {{dirs: string[], gitDir: string | null, workTree: string | null, opts: string[], sub: string, args: string[]} | null}
 */
function gitInvocation(tokens) {
  if (!/^git(?:\.exe|\.cmd)?$/i.test(tokens[0] || "")) return null;
  const invocation = { dirs: [], gitDir: null, workTree: null, opts: [], sub: "", args: [] };
  let i = 1;
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--") {
      i++;
      break;
    }
    if (!token.startsWith("-")) break;
    // -C<dir> / -c<k=v> 可以连写，--git-dir=<dir> 用等号
    const glued = /^-([Cc])(.+)$/.exec(token),
      eq = token.startsWith("--") ? token.indexOf("=") : -1,
      name = eq > 0 ? token.slice(0, eq) : token;
    if (glued && glued[1] === "C") {
      invocation.dirs.push(glued[2]);
      continue;
    }
    if (glued && glued[1] === "c") {
      invocation.opts.push("-c");
      continue;
    }
    let value = eq > 0 ? token.slice(eq + 1) : null;
    if (value === null && GIT_GLOBAL_ARG.has(name)) value = tokens[++i] ?? "";
    if (name === "-C") invocation.dirs.push(value ?? "");
    else if (name === "--git-dir") invocation.gitDir = value ?? "";
    else if (name === "--work-tree") invocation.workTree = value ?? "";
    else invocation.opts.push(name);
  }
  invocation.sub = tokens[i] ?? "";
  invocation.args = tokens.slice(i + 1);
  return invocation;
}
/** 子命令是不是只看不改（仓库指到目录外时才问） @param {string} sub @param {string[]} args */
function gitReadOnly(sub, args) {
  const name = sub.toLowerCase();
  // 没有子命令：只打印用法
  if (!name) return true;
  if (GIT_READ_SUB.has(name)) return true;
  // config：`git config 键` 是读、`git config 键 值` 是写；--unset / --add 这些一律算写
  if (name === "config")
    return (
      args.filter(arg => !arg.startsWith("-")).length <= 1 &&
      !args.some(arg => /^(?:--(?:unset|unset-all|add|replace-all|rename-section|remove-section|edit|append)|-e)$/.test(arg))
    );
  const allowed = GIT_READ_ARGS[name];
  if (!allowed) return false;
  // `git stash` 不带参数是存起来，不是列出
  if (!args.length && name === "stash") return false;
  let takesValue = false;
  for (const arg of args) {
    if (takesValue) {
      takesValue = false;
      continue;
    }
    const flag = arg.startsWith("--") && arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : "";
    if (flag && GIT_READ_VALUE.has(flag) && allowed.includes(flag)) continue;
    if (!allowed.includes(arg)) return false;
    if (GIT_READ_VALUE.has(arg)) takesValue = true;
  }
  return true;
}
/** 参数里有 shell 展开（$HOME、%USERPROFILE%、~/x）时静态看不出落到哪，一律按出去了算 */
function dynamicPath(value) {
  return /[$`~]|%[^%\\/]+%/.test(value);
}
/**
 * git 的 -C / --git-dir / --work-tree 有没有把仓库指到工作目录之外：是则返回拒绝语，否则 null。
 * 目录选项按出现次序生效（-C sub -C .. 又绕回工作目录；后一个 --work-tree 覆盖前一个）；
 * 指到外面时只放行查看类子命令。子命令自己的 pathspec 不在这里管：git 自身拒绝工作树外的路径
 * （`git checkout -- ../x` 报 is outside repository）
 * @param {string} text @param {string} workdir @param {boolean} win @returns {string | null}
 */
function gitEscapeWhy(text, workdir, win) {
  // 按 win 选 path 的那一套：测试会在 macOS 上跑 Windows 路径，不能拿 POSIX 的 resolve 去解析盘符
  const api = win ? path.win32 : path,
    root = win ? api.normalize(workdir).toLowerCase() : api.normalize(workdir).replace(/(?<=.)[\\/]+$/, ""),
    inside = target => {
      const relative = api.relative(root, target);
      return !relative || (relative !== ".." && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative));
    };
  for (const tokens of commandSegments(text)) {
    const invocation = gitInvocation(tokens);
    if (!invocation) continue;
    let cwd = workdir,
      outside = null;
    for (const dir of invocation.dirs) {
      if (dynamicPath(dir)) {
        outside = dir;
        break;
      }
      cwd = api.resolve(cwd, dir);
    }
    for (const target of outside ? [] : [cwd, invocation.gitDir, invocation.workTree]) {
      if (target === null) continue;
      if (dynamicPath(target) || !inside(api.resolve(cwd, target))) {
        outside = target;
        break;
      }
    }
    if (!outside) continue;
    if (!invocation.opts.some(opt => GIT_RUNS_COMMANDS.has(opt)) && gitReadOnly(invocation.sub, invocation.args)) continue;
    return `沙箱拒绝：git 的 -C / --git-dir / --work-tree 指到了工作目录之外（${outside}）；只有 log、status、diff、show 这类查看子命令能跨出去，要改动那一处请把工作目录设在那一处`;
  }
  return null;
}
/**
 * 筛一条指令。通过返回 null；拒绝返回一句原因（给模型看的，说清怎么改）
 * @param {string} command
 * @param {string} workdir 完整的绝对路径
 */
function screenCommand(command, workdir, { platform = process.platform } = {}) {
  const raw = String(command || "");
  if (callsBridge(raw)) return `沙箱拒绝：${BRIDGE_WHY}`;
  const text = withoutExeDir(raw),
    win = platform === "win32";
  const forbidden = forbiddenWhy(text, "严");
  if (forbidden) return `沙箱拒绝：${forbidden}`;
  if (SECRET_PATH_IN_COMMAND.test(text)) return "沙箱拒绝：指令不读写 .env、密钥或凭据文件；需要普通配置时请改用不含机密的文件";
  if (GIT_INTERNAL_PATH.test(text) && DIRECT_FILE_MUTATION.test(text)) return "沙箱拒绝：不直接改 .git 内部；请使用相应的 git 指令";
  // 目录这一道只锁「写」：查看整台机器是电脑检查的本分，锁住读等于把这件事堵死
  if (DIRECT_FILE_MUTATION.test(text)) {
    const why = screenWritePaths(text, workdir, win, "沙箱拒绝");
    if (why) return why;
  }
  // git 的 -C / --git-dir / --work-tree 把仓库指到别处：`git -C .. checkout -- f` 里没有一个「改动路径」，
  // 上面的写路径规则看不出它动的是上层的工作树，于是整个漏过。这三个选项在这里按工作目录判一遍；
  // 指到外面时只放行查看类子命令（git -C .. log 仍放行），目录内的 -C sub 照旧
  const gitWhy = gitEscapeWhy(text, workdir, win);
  if (gitWhy) return gitWhy;
  if (NET_TOOLS.test(text)) {
    const hosts = [...text.matchAll(/https?:\/\/([^\s/"'`:]+)(?::\d+)?/gi)].map(m => m[1]);
    if (!hosts.length || hosts.some(host => !LOCAL_HOST.test(host)))
      return "沙箱拒绝：不直接外联（只放行指向本机 127.0.0.1 / localhost 的）；装依赖走 npm / pip 等包管理器，查资料用 search_web / fetch_page";
  }
  return null;
}
/**
 * 「审而后行」这一档的筛查，不向用户请示。通过返回 null；明确高风险返回拒绝原因。
 * 规则刻意比沙箱宽得多：目录、机密文件、.git 内部、Git 回退都不管，只看会不会伤到系统本身。
 * @param {string} command
 */
function screenAutoReview(command) {
  const raw = String(command || "");
  if (callsBridge(raw)) return `审查拒绝：${BRIDGE_WHY}`;
  const text = withoutExeDir(raw),
    forbidden = forbiddenWhy(text, "审");
  if (forbidden) return `审查拒绝：${forbidden}`;
  if (BROAD_DELETE.test(text)) return "审查拒绝：不代为执行整目录、通配符或磁盘级删除";
  if (DIRECT_FILE_MUTATION.test(text) && REVIEW_SYSTEM_PATH.test(stripReadSources(text)))
    return "审查拒绝：不往 Windows、Program Files、/usr、/System 这类系统目录里写";
  return null;
}
/**
 * 宽的沙箱：给「审而后行」与「径行」。三档由严到宽是 问而后行 ≤ 审而后行 ≤ 径行——问而后行里沙箱拦下的会转给用户请示、
 * 批了便出沙箱跑；后两档不向用户请示，沙箱就只守系统本身：注册表、服务、计划任务、账户、磁盘、提权、执行策略、
 * 藏字与别名、往系统目录里写。联网、写目录之外、机密文件、.git 内部都放行。通过返回 null
 * @param {string} command
 */
function screenLoose(command) {
  const raw = String(command || "");
  if (callsBridge(raw)) return `沙箱拒绝：${BRIDGE_WHY}`;
  const text = withoutExeDir(raw),
    forbidden = forbiddenWhy(text, "宽");
  if (forbidden) return `沙箱拒绝：${forbidden}`;
  if (DIRECT_FILE_MUTATION.test(text) && REVIEW_SYSTEM_PATH.test(stripReadSources(text)))
    return "沙箱拒绝：不往 Windows、Program Files、/usr、/System 这类系统目录里写";
  return null;
}
/**
 * 给指令的环境变量：去掉名字像机密的；其余照传（PATH、SystemRoot、TEMP 这些没了程序起不来）
 * @param {NodeJS.ProcessEnv} env
 */
function sandboxEnv(env) {
  const out = {};
  for (const [name, value] of Object.entries(env || {})) if (!SECRET_ENV.test(name)) out[name] = value;
  return out;
}
// 目录之内也有不该碰的：机密文件不读不写，.git 的内部不写（改 .git/config 能塞钩子与远端）
const SECRET_FILE =
  /(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|pfx|p12|jks|keystore)|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|[^/]*\.(credentials|secret|secrets)|credentials(\.json)?|secrets\.(json|ya?ml|toml))$/i;
/**
 * 目录内的相对路径（/ 或 \ 分隔）能不能碰。通过返回 null；否则返回原因
 * @param {string} rel
 * @param {{ write?: boolean }} [options]
 */
function screenPath(rel, { write = false } = {}) {
  const text = withoutDataStream(rel).split("\\").join("/");
  if (SECRET_FILE.test(text)) return `沙箱拒绝：不读写机密文件（${text}）`;
  if (write && /(^|\/)\.git(\/|$)/.test(text)) return `沙箱拒绝：不改 .git 内部（${text}），用 git 指令`;
  return null;
}

// 存储根里装着 API Key 与登录令牌的几样：配置（连每小时一份的备份）与 ChatGPT 登录。模型没有正当理由碰它们——改设置有界面；
// 读得到就能被一段网页里的话骗去拼进网址发走，写得到就能自己关沙箱、改预设。所以不论档位、沙箱开不开都守，只认桥接此刻的存储根，
// 开发言自己时仓库里的同名字样不受牵连。静态筛查：脚本里拼出来的路径管不到
const STORE_SECRETS = ["配置.json", "配置备份", "ChatGPT 登录.json"];
const STORE_WHY = "不碰言的配置与登录文件（内有 API Key 与令牌）；要改设置，请用户在设置里改";
/** 一个绝对路径是不是落在存储根的这几样上（或就是存储根里它们之下）。是则返回原因 @param {string} full @param {string} root */
function screenStorePath(full, root) {
  if (!root) return null;
  const base = normalizeLower(path.resolve(root)),
    target = normalizeLower(path.resolve(withoutDataStream(full)));
  return STORE_SECRETS.some(name => pathIsInside(normalizeLower(path.join(base, name)), target)) ? `拒绝：${STORE_WHY}` : null;
}
/**
 * 指令文本里点没点到这几样：写了它们的名字，且又写了存储根（或 .yan），或就在存储根里跑（卷宗、工作都在根下，..\配置.json 即到）；
 * 对存储根顶层用通配（.yan\*）也算。 @param {string} command @param {string} root @param {string} workdir
 */
function screenStoreCommand(command, root, workdir) {
  if (!root) return null;
  const text = String(command || "")
      .replace(/\//g, "\\")
      .toLowerCase(),
    rootPath = normalizeLower(path.resolve(root)),
    // 对指令文本的那份换成反斜杠；比目录用原样的，不然 macOS 上两边斜杠对不上、在根下跑也认不出
    base = rootPath.replace(/\//g, "\\"),
    named = STORE_SECRETS.some(name => text.includes(name.toLowerCase())),
    near =
      text.includes(base) || /\\\.yan(?:\\|["'\s]|$)/.test(text) || pathIsInside(rootPath, normalizeLower(path.resolve(workdir || "")));
  if (named && near) return `拒绝：${STORE_WHY}`;
  const wild = new RegExp(`(?:${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|\\\\\\.yan)\\\\\\*`);
  return wild.test(text) ? `拒绝：${STORE_WHY}` : null;
}

module.exports = {
  screenCommand,
  screenLoose,
  screenAutoReview,
  screenUnreviewable,
  sandboxEnv,
  screenPath,
  screenStorePath,
  screenStoreCommand
};
