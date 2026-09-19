// 言 · 沙箱：给执事与卷宗的指令、文件工具划一道界。守三样：
//   目录——改动不出工作目录（写、删、搬与重定向：相对路径不上溯，绝对路径只认目录之内，不往用户目录与系统目录里写）；
//         查看则可及整台机器——给电脑做检查本就要翻系统目录、注册表与进程，锁住读等于把这件事堵死。
//         机密文件（.env、密钥、凭据）与 .git 内部另有专条，读写都不放行；文件工具这一路仍是整个目录内，不认「全盘」；
//   环境——指令看不到机密环境变量（名字里带 KEY / TOKEN / SECRET / PASSWORD 之类的一律不传；页面配置里的 API Key 本就不进桥接进程）；
//   指令——动系统的（注册表、服务、计划任务、防火墙、账户、磁盘、关机、提权、执行策略）、藏字的（编码指令、Invoke-Expression）、
//         直接外联的（curl / iwr / wget 之类，指向本机的除外）一律拒绝，装依赖走包管理器。
// 这是静态筛查，不是进程隔离：脚本里的代码仍以用户的权限跑。筛出来的每一条都带一句原因回给模型，它改一改就能过。
// 纯函数，不碰文件系统；由 server/work.js 装配，test/unit 直接测
"use strict";
const path = require("node:path");

const SECRET_ENV = /KEY|TOKEN|SECRET|PASSW|CREDENTIAL|AUTH|COOKIE|PRIVATE|^YAN_API_CONFIG$/i;
// 「指令位」：一行的开头，或 ; & | ( 之后（cmd /c、& 调用也算），只有站在这个位置上的词才算在执行它——
// 「npm run format」「echo shutdown」里的 format / shutdown 不是
const CMD = String.raw`(?:^|[;&|(\n]|\bcmd(?:\.exe)?\s+/c)\s*(?:&\s*)?`;
const cmd = (names, tail = String.raw`(?:\.exe|\.com)?(?:\s|$)`) => new RegExp(`${CMD}(?:${names})${tail}`, "im");
// 指令里禁用的写法：[正则, 一句原因]。逐条对整段指令文本查，命中即拒
const FORBIDDEN = [
  [cmd("reg", String.raw`(?:\.exe)?\s+(?:add|delete|import|restore|load|unload|copy|save)\b`), "不动注册表"],
  // 注册表：查看放行（启动项、已装软件、驱动版本都在里头，是电脑检查的常规去处），改则拒绝
  [
    /\bregedit\b|\b(?:New|Set|Remove|Clear|Rename|Copy|Move)-Item(?:Property)?\b[^\n]*(?:\bHK(?:LM|CU|CR|U|CC)\s*:|\bHKEY_|\bRegistry::)/i,
    "不动注册表——查看可以，改不行"
  ],
  [cmd("schtasks"), "不动计划任务"],
  [cmd("sc", String.raw`(?:\.exe)?\s+(?:create|delete|config|start|stop|failure)\b`), "不动系统服务"],
  [/\b(New|Set|Remove|Start|Stop|Restart)-Service\b/i, "不动系统服务"],
  [/\bnetsh(?:\.exe)?\b[^\n]*\b(?:set|add|delete|reset|exec|import)\b/i, "不动网络与防火墙配置"],
  [/\b(New|Set|Remove)-NetFirewallRule\b|\bSet-DnsClient/i, "不动网络与防火墙配置"],
  [cmd("net", String.raw`(?:\.exe)?\s+(?:user|localgroup|group|share|use|accounts)\b`), "不动用户与账户"],
  [/\b(New|Remove|Set|Enable|Disable)-LocalUser\b|\bAdd-LocalGroupMember\b/i, "不动用户与账户"],
  [cmd("runas|shutdown|bcdedit|diskpart|reagentc|sfc|dism|takeown|icacls|cacls|logoff"), "不动系统、磁盘与权限"],
  [/\bwmic(?:\.exe)?\b[^\n]*\b(?:call|delete)\b/i, "不通过 WMI 改系统"],
  [cmd("format", String.raw`(?:\.com)?\s+[a-z]:`), "不动磁盘"],
  [/-Verb\s+RunAs\b|(^|\s)sudo\s/i, "不提权"],
  [/\bSet-ExecutionPolicy\b|\b(Set|Add|Remove)-MpPreference\b/i, "不改执行策略与安全设置"],
  [/\bInvoke-Expression\b|(^|[\s;&|(])iex\s|-EncodedCommand\b|(^|\s)-(enc|ec|e)\s+[A-Za-z0-9+=]{32,}/i, "不用编码或拼接的指令，直接写出来"],
  [/\bcertutil(\.exe)?\b[^\n]*-urlcache|\bStart-BitsTransfer\b|\bNet\.WebClient\b|\bHttpClient\b|\bSystem\.Net\b/i, "沙箱里不直接外联"]
];
// 用户目录与系统目录：查看放行，写入拒绝。只在判定为「写」的指令上查
const HOME_SYSTEM_PATH =
  /\$env:(USERPROFILE|HOME|HOMEPATH|HOMEDRIVE|APPDATA|LOCALAPPDATA|ProgramData|ProgramFiles(\(x86\))?|ProgramW6432|SystemRoot|windir|Public|ALLUSERSPROFILE)\b|%(USERPROFILE|HOMEPATH|HOMEDRIVE|APPDATA|LOCALAPPDATA|ProgramData|ProgramFiles(\(x86\))?|ProgramW6432|SystemRoot|windir|Public|ALLUSERSPROFILE)%|\$HOME\b|(^|[\s"'=])~([\\/]|$)/i;
// 外联工具：只放行目标全在本机的（curl http://127.0.0.1:8787 这样测本地服务是常事）
const NET_TOOLS = /(^|[\s;&|(])(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)(\.exe)?(\s|$)/i;
const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1)$/i;
// 文件工具会用 screenPath 拦机密文件；指令通道也得拦显式点名，否则 `Get-Content .env` 能从 shell 绕过去。
// 这里只认完整的路径片段，避免把 `dotnet user-secrets list`、`env.d.ts` 这类正常参数误判成文件。
const SECRET_PATH_IN_COMMAND =
  /(^|[\s"'=;|&(])(?:[^\s"'`;|&<>()]*[\\/])?(?:\.env(?:\.[^\s"'`;|&<>()\\/]*)?|[^\s"'`;|&<>()\\/]*\.(?:pem|key|pfx|p12|jks|keystore)|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|[^\s"'`;|&<>()\\/]*\.(?:credentials|secret|secrets)|credentials\.json|secrets\.(?:json|ya?ml|toml))(?=$|[\s"'`;|&)])/i;
// `.git` 要由 git 自己维护；显式读可以，直接用 shell 写、删、搬则拒绝。脚本内部仍不在静态筛查能力之内。
const GIT_INTERNAL_PATH = /(^|[\s"'=;|&(])[^\s"'`;|&<>()]*\.git[\\/][^\s"'`;|&<>()]*/i;
// 「这条指令会不会改东西」——目录那一道全压在它身上（判定为改，路径才受约束），所以宁可多列：
// 漏一个动词，就等于放行一次目录外的写入。重叠的前缀按长在前排（rmdir 在 rm 前、rename 在 ren 前）。
const WRITE_VERBS =
  String.raw`Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Clear-Content|Set-Acl|Compress-Archive|Expand-Archive|Export-Csv|Export-Clixml|(?:New|Set|Remove|Copy|Move|Clear|Rename)-ItemProperty|robocopy|xcopy|copy|rmdir|rd|rm|del|erase|move|mv|cp|rename|ren|mkdir|md|touch|tee|attrib|mklink|fsutil|dd`;
const DIRECT_FILE_MUTATION = new RegExp(
  String.raw`(^|[;&|(\n]\s*|\bcmd(?:\.exe)?\s+/c\s+)(?:${WRITE_VERBS})(?:\.exe)?\b|(?:^|[^<])>{1,2}\s*[^&]`,
  "im"
);

// 审而后行不是第二个沙箱：常规开发、安装、Git 提交、本机进程、联网与整机查看都放行，只拦明确可能伤及宿主机或难以恢复的动作。
// 它不向用户请示；拿不准而确实需要做时，模型可以换用结构化工具，或用户切到「问而后行 / 径行」。
const REVIEW_FORBIDDEN = [
  [cmd("reg", String.raw`(?:\.exe)?\s+(?:add|delete|import|restore|load|unload|copy|save)\b`), "不代为修改注册表"],
  [/\bregedit\b|\b(New|Set|Remove)-ItemProperty\b[^\n]*(?:HKLM|HKCU|Registry::)/i, "不代为修改注册表"],
  [/\bschtasks(?:\.exe)?\b[^\n]*(?:\/create|\/delete|\/change|\/run|\/end)\b/i, "不代为修改或触发计划任务"],
  [cmd("sc", String.raw`(?:\.exe)?\s+(?:create|delete|config|start|stop|failure)\b`), "不代为修改系统服务"],
  [/\b(New|Set|Remove|Start|Stop|Restart)-Service\b/i, "不代为修改系统服务"],
  [/\bnetsh(?:\.exe)?\b[^\n]*\b(?:set|add|delete|reset|exec|import)\b/i, "不代为修改网络与防火墙配置"],
  [/\b(New|Set|Remove)-NetFirewallRule\b|\bSet-DnsClient/i, "不代为修改网络与防火墙配置"],
  [cmd("net", String.raw`(?:\.exe)?\s+(?:user|localgroup|group|share|accounts)\b`), "不代为修改用户、账户与共享"],
  [/\b(New|Remove|Set|Enable|Disable)-LocalUser\b|\bAdd-LocalGroupMember\b/i, "不代为修改用户与账户"],
  [cmd("runas|shutdown|bcdedit|diskpart|reagentc|sfc|dism|takeown|icacls|cacls|logoff"), "不代为提权或修改系统、磁盘与权限"],
  [cmd("format", String.raw`(?:\.com)?\s+[a-z]:`), "不代为格式化磁盘"],
  [/-Verb\s+RunAs\b|(^|\s)sudo\s/i, "不代为提权"],
  [/\bSet-ExecutionPolicy\b|\b(Set|Add|Remove)-MpPreference\b/i, "不代为修改执行策略与安全设置"],
  [/\bInvoke-Expression\b|(^|[\s;&|(])iex\s|-EncodedCommand\b|(^|\s)-(enc|ec|e)\s+[A-Za-z0-9+=]{32,}/i, "不代为执行隐藏或动态拼接的指令"],
  [/\bwmic(?:\.exe)?\b[^\n]*\b(?:call|delete)\b/i, "不代为通过 WMI 修改系统"],
  [/\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*[fdx]|checkout\s+--\s|restore\b[^\n]*\s--source\b)/i, "不代为执行难以恢复的 Git 清理或回退"]
];
const BROAD_DELETE =
  /\bRemove-Item\b(?=[^\n]*(?:-Recurse|-Force))(?=[^\n]*\s(?:\.(?:[\\/]\*)?|\*|\/|[a-z]:[\\/]?)(?:\s|$))[^\n]*|(^|[;&|(]\s*)rm\s+-[^\s]*r[^\s]*\s+(?:\.|\*|\/|[a-z]:[\\/]?)\s*$|\b(?:rmdir|rd)\b(?=[^\n]*\/s)(?=[^\n]*\s(?:\.|\*|[\\/]|[a-z]:[\\/]?)(?:\s|$))[^\n]*/i;

function normalizeLower(p) {
  return path
    .normalize(p)
    .replace(/(?<=.)[\\/]+$/, "")
    .toLowerCase();
}
function inside(root, target) {
  const rel = path.relative(root, target);
  return !rel || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
// 指令文本里所有像绝对路径的片段：盘符（C:\… 与 C:/…，光秃的 C: 也算——那是盘符相对路径）、UNC（\\server\share）；
// 非 Windows 上再加 POSIX 根（/usr/…）。URL 里的 http: 与 key:value 这类前面贴着字母的不算
function absolutePathsIn(command, win) {
  const found = [];
  const drive = /(?<![A-Za-z0-9_])([A-Za-z]:(?:[\\/][^\s"'`;|&<>()]*|(?=[\s"'`;|&<>()]|$)))/g,
    unc = /(?<![\w\\/])(\\\\[^\s\\"'`;|&<>()]+(?:\\[^\s"'`;|&<>()]*)?)/g,
    posix = /(?<![\w./~:-])(\/(?!\/)[^\s"'`;|&<>()]+)/g;
  for (const match of command.matchAll(drive)) found.push(match[1]);
  for (const match of command.matchAll(unc)) found.push(match[1]);
  if (!win) for (const match of command.matchAll(posix)) found.push(match[1]);
  return found;
}
/**
 * 会改动东西的指令，它碰的路径必须都在工作目录之内。判定从严：一条指令里只要出现写、删、搬或重定向，
 * 整条都按「写」处理，它顺带读的那些路径也一并受约束——静态看不出哪个参数是源、哪个是目标。
 * 沙箱与审而后行共用，只差开头的称呼。通过返回 null。
 * @param {string} text @param {string} workdir @param {boolean} win @param {string} prefix
 */
function screenWritePaths(text, workdir, win, prefix) {
  if (HOME_SYSTEM_PATH.test(text)) return `${prefix}：不往用户目录或系统目录里写，改动一律落在工作目录之内`;
  // .. 上溯：起点在工作目录，往上一级就出去了；深处的 cd .. 静态看不出来，一律不许，改用相对工作目录的路径
  if (/(^|[\s"'=(\\/:])\.\.([\\/]|$|["'\s;|&)])/.test(text)) return `${prefix}：改动的路径不用 .. 上溯，一律相对工作目录写`;
  const root = win ? normalizeLower(workdir) : path.normalize(workdir).replace(/(?<=.)[\\/]+$/, "");
  for (const raw of absolutePathsIn(text, win)) {
    if (win && /^[a-z]:$/i.test(raw)) return `${prefix}：不用盘符相对路径（${raw}），写完整路径`;
    const candidate = win ? normalizeLower(raw) : path.normalize(raw).replace(/(?<=.)[\\/]+$/, "");
    if (!inside(root, candidate)) return `${prefix}：改动的路径越出了工作目录（${raw}）；只能改 ${workdir} 之内的东西。只是查看的话，去掉这条指令里的写、删、搬与重定向即可`;
  }
  return null;
}
/**
 * 筛一条指令。通过返回 null；拒绝返回一句原因（给模型看的，说清怎么改）
 * @param {string} command
 * @param {string} workdir 完整的绝对路径
 */
function screenCommand(command, workdir, { platform = process.platform } = {}) {
  const text = String(command || "");
  const win = platform === "win32";
  for (const [pattern, why] of FORBIDDEN) if (pattern.test(text)) return `沙箱拒绝：${why}`;
  if (SECRET_PATH_IN_COMMAND.test(text)) return "沙箱拒绝：指令不读写 .env、密钥或凭据文件；需要普通配置时请改用不含机密的文件";
  if (GIT_INTERNAL_PATH.test(text) && DIRECT_FILE_MUTATION.test(text))
    return "沙箱拒绝：不直接改 .git 内部；请使用相应的 git 指令";
  // 目录这一道只锁「写」：查看整台机器是电脑检查的本分，锁住读等于把这件事堵死
  if (DIRECT_FILE_MUTATION.test(text)) {
    const why = screenWritePaths(text, workdir, win, "沙箱拒绝");
    if (why) return why;
  }
  if (NET_TOOLS.test(text)) {
    const hosts = [...text.matchAll(/https?:\/\/([^\s/"'`:]+)(?::\d+)?/gi)].map(m => m[1]);
    if (!hosts.length || hosts.some(host => !LOCAL_HOST.test(host)))
      return "沙箱拒绝：不直接外联（只放行指向本机 127.0.0.1 / localhost 的）；装依赖走 npm / pip 等包管理器，查资料用 search_web / fetch_page";
  }
  return null;
}
/**
 * 「审而后行」这一档的筛查，不向用户请示。通过返回 null；明确高风险返回拒绝原因。
 * 规则刻意比沙箱宽：常规开发、诊断与整机查看都不拦。
 * @param {string} command
 * @param {string} workdir
 */
function screenAutoReview(command, workdir, { platform = process.platform } = {}) {
  const text = String(command || ""),
    win = platform === "win32";
  for (const [pattern, why] of REVIEW_FORBIDDEN) if (pattern.test(text)) return `审查拒绝：${why}`;
  if (SECRET_PATH_IN_COMMAND.test(text)) return "审查拒绝：不代为读取或改写 .env、密钥与凭据文件";
  if (GIT_INTERNAL_PATH.test(text) && DIRECT_FILE_MUTATION.test(text)) return "审查拒绝：不直接修改 .git 内部，请使用 git 指令";
  if (BROAD_DELETE.test(text)) return "审查拒绝：不代为执行整目录、通配符或磁盘级删除";
  if (DIRECT_FILE_MUTATION.test(text)) return screenWritePaths(text, workdir, win, "审查拒绝");
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
  const text = String(rel || "")
    .split("\\")
    .join("/");
  if (SECRET_FILE.test(text)) return `沙箱拒绝：不读写机密文件（${text}）`;
  if (write && /(^|\/)\.git(\/|$)/.test(text)) return `沙箱拒绝：不改 .git 内部（${text}），用 git 指令`;
  return null;
}

module.exports = { screenCommand, screenAutoReview, sandboxEnv, screenPath, SECRET_ENV };
