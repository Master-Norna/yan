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
// 「指令位」：一行的开头，或 ; & | ( { 与引号外的 ) 之后（& 调用、脚本块也算），只有站在这个位置上的词才算在执行它——
// 「npm run format」「echo shutdown」里的 format / shutdown 不是。
// 套一层壳的也算：cmd /c、powershell -Command、pwsh -c 后面跟的整段都在执行——指令本就由 PowerShell 跑，
// 「powershell -Command "Set-Content C:\x y"」与直接写没有分别；这类壳之后同一行里的任何词都按指令位看，宁可多拦。
// 赋值的右边也在执行（$r = reg delete …）；右边是带引号的字串（$mode = "copy"）不算
const SHELL_WORD = String.raw`(?:"(?:\\.|[^"\\\n])*"|'[^'\n]*'|[^\s"';&|()]+)`;
// xargs / env 的普通选项仍供其它命令规则使用；sudo 不靠枚举包装词的选项来识别。
const PREFIX = String.raw`(?:(?:if|elif|while|until|!|then|do|else|exec|nohup|nice(?:\s+-n\s+-?\d+)?|time|timeout\s+\d+(?:\.\d+)?[smhd]?|command(?=\s+[^-\s])|xargs(?:\s+-[^\s"';&|()]+)*|env(?:\s+-[^\s"';&|()]+)*|[A-Za-z_]\w*=(?:${SHELL_WORD})?)\s+)*`;
const SHELL = String.raw`(?:[^\s"';&|(){}]*/)?(?:ba|z|da|k)?sh(?:\.exe)?\s+(?:--(?:rcfile|init-file)\s+${SHELL_WORD}\s+|--[\w-]+\s+|-o\s+\S+\s+|-(?!o\s)[^c\s-]+\s+)*-[a-z]*c[a-z]*\s+(?:--\s+)?["']?`;
const CMD =
  String.raw`(?:^|[;&|({)\n]|\$[\w:]+\s*=(?=\s*[^\s"'])|\bcmd(?:\.exe)?\b[^\n]*?/[ck]|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?(?=[\s"'&]))\s*["']?(?:&\s*["']?)?` +
  PREFIX +
  // 第二段前缀必须跟在 Shell 后，避免两段前缀任意切分造成回溯。
  String.raw`(?:${SHELL}${PREFIX})?`;
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
const ALIASING = new RegExp(String.raw`${cmd("(?:Set|New)-Alias|sal|nal").source}|${CMD}alias\s+[^\s=]+\s*=`, "im");
const ELEVATION = new RegExp(
  String.raw`-Verb\s+RunAs\b|${cmd(String.raw`(?:/\S*/)?sudo`).source}|${cmd("osascript", String.raw`[^\n]*(?:with\s+administrator\s+privileges\b|administratorPrivileges\s*:\s*true\b)`).source}`,
  "im"
);
// 藏字：编码过的指令、拿 Invoke-Expression 跑拼出来的字串——筛查与审查都只看得到一串编码，判不了它要做什么。
// iex 按指令位认，后面可贴括号、引号或就此收尾（irm x | iex、iex(irm x)）；赋值的右边也算在执行。rg iex a.txt 是搜字，不算
// PowerShell 认参数名的任意前缀，也认 / 开头：-en、-encodedc、/enc 都是 -EncodedCommand，串再短也能跑。所以站在指令位的 powershell / pwsh（可带路径、可经 Start-Process）
// 后面见到就算；-Command、-File 之后的属于被跑的东西（powershell -c "node -e 1"），不算。别的程序的 -e 只认一长串 base64 那一条
const prefixesOf = (/** @type {string} */ word) => Array.from(word, (_, i) => word.slice(0, i + 1)).join("|");
// 只有带引号的程序路径能跨空白；否则会随每个前缀切分反复扫描余下的整行。
const POWERSHELL_ENCODED = String.raw`${CMD}(?:Start-Process\s+(?:-FilePath\s+)?)?["']?(?:(?:(?<=["'])[^"'\n;|&(){}]*|[^\s"'\n;|&(){}]*)[\\/])?(?:powershell|pwsh)(?:\.exe)?["']?(?:(?![\s"'][-/](?:${prefixesOf("command")}|${prefixesOf("file")})(?:[\s:]|$))[^\n;|&])*?[\s"'][-/](?:ec|${prefixesOf("encodedcommand")})(?=[\s:"']|$)`;
// 命令名是算出来的：& ("i"+"ex")、.("ie"+"x")、& (gcm i*x)，或把字串变成脚本块再跑（[scriptblock]::Create）。规则与审查都看不到它实际跑什么。
// & $exe 不算：把带空格的程序路径放进变量再调用是常规写法，拦了误伤多，真想藏的也还有 node -e 可走（见文件头）
// & 要在语句开头：a & (b) 是 pandas 之类脚本里的按位与
const COMPUTED_CALL = String.raw`(?:^|[;|({\n=])\s*[&.]\s*\(|\[(?:System\.Management\.Automation\.)?ScriptBlock\]::Create\b|\.InvokeCommand\.(?:InvokeScript|NewScriptBlock)\b`;
const HIDDEN_COMMAND = new RegExp(
  String.raw`\bInvoke-Expression\b|(?:${CMD}|=\s*)iex(?![\w.-])|-EncodedCommand\b|(^|\s)-(enc|ec|e)\s+[A-Za-z0-9+=]{32,}|${POWERSHELL_ENCODED}|${COMPUTED_CALL}` +
    String.raw`|${CMD}eval(?=[\s"']|$)|${CMD}(?:source|\.)\s+<\(` +
    String.raw`|${CMD}(?:ba|z|da|k)?sh\s+(?:-[^\s]+\s+)*<\(` +
    String.raw`|${CMD}${SHELL}\$\(`,
  "im"
);
const PIPE_SHELL = new RegExp(
  String.raw`^\s*${PREFIX}["']?(?:[^\s"';&|(){}]*/)?(?:(?:ba|z|da|k)?sh|powershell|pwsh)(?:\.exe)?["']?(?=\s|$)`,
  "i"
);
const SCRIPT_START = new RegExp(
  String.raw`^\s*${PREFIX}(?:${SHELL}|(?:cmd(?:\.exe)?\b[^\n]*?/[ck]|(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?[-/](?:${prefixesOf("command")}))\s+["'])`,
  "i"
);
const CMD_SCRIPT = new RegExp(String.raw`^\s*${PREFIX}cmd(?:\.exe)?\b[^\n]*?/[ck]\s*$`, "i");
const POSIX_SCRIPT = new RegExp(String.raw`^\s*${PREFIX}${SHELL}$`, "i");
// 转义跟随执行这段文本的 Shell；cmd 的 ^ 只在引号外转义。
function escapes(text, at, shell, quote = "") {
  if (quote === "'") return false;
  if (shell === "powershell") return text[at] === "`";
  if (shell === "cmd") return !quote && text[at] === "^";
  return text[at] === "\\" && (!quote || /[$`"\\\r\n]/.test(text[at + 1] || ""));
}
function commentAt(text, at, shell) {
  return shell !== "cmd" && text[at] === "#" && (at === 0 || /[\s;&|()]/.test(text[at - 1]));
}
// 每个位置只计算一次单引号、双引号和 $() 的收尾；依赖都在右边，倒序填表即可。
// -1 也缓存：未收尾时按普通字符前进，不为下一个起点重扫同一后缀。
function quoteContext(text, shell, offset = 0) {
  const single = new Int32Array(text.length + 2).fill(-1),
    double = new Int32Array(text.length + 2).fill(-1),
    substitution = new Int32Array(text.length + 2).fill(-1);
  let newline = text.length;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "\n" || ch === "\r") newline = i;
    single[i] = ch === "'" ? i : single[i + 1];
    if (escapes(text, i, shell, '"')) double[i] = double[i + 2];
    else if (ch === '"') double[i] = i;
    else if (shell !== "cmd" && ch === "$" && text[i + 1] === "(" && substitution[i + 2] >= 0) double[i] = double[substitution[i + 2] + 1];
    else double[i] = double[i + 1];

    if (escapes(text, i, shell)) substitution[i] = substitution[i + 2];
    else if (commentAt(text, i, shell)) substitution[i] = substitution[newline + 1];
    else if (ch === '"' || (shell !== "cmd" && ch === "'")) {
      const end = ch === '"' ? double[i + 1] : single[i + 1];
      substitution[i] = substitution[end < 0 ? i + 1 : end + 1];
    } else if (ch === "(") {
      const end = substitution[i + 1];
      substitution[i] = end < 0 ? -1 : substitution[end + 1];
    } else substitution[i] = ch === ")" ? i : substitution[i + 1];
  }
  return { text, shell, offset, single, double, substitution };
}
// 一份扫描同时提供注释已抹掉的文本、语法视图与 sudo 整词视图，索引始终不变。
// 普通参数隐藏分隔符与整段引号内容；执行字符串展开一层，$() 则进入自己的上下文。
function shellText(text, shell) {
  const chars = text.split(""),
    syntax = text.split(""),
    unquoted = text.split("");
  const quotes = new Map();
  const frames = [];
  const push = (context, from, to, shellBody, quote = "") => {
    frames.push({ context, at: from, to, shellBody, quote, start: from, checked: false, scriptAt: -1 });
  };
  push(quoteContext(text, shell), 0, text.length, false);
  // 引号与 $() 共用所在文本的收尾表；执行字符串另建一层，彼此不重叠。
  // 每个字符只生成一次视图，深层 $() 不再递归复制整段正文。
  while (frames.length) {
    const frame = frames[frames.length - 1],
      { context, at: i, to } = frame,
      { text, shell, offset } = context,
      at = offset + i;
    if (i >= to) {
      frames.pop();
      continue;
    }
    if (frame.quote) {
      const escaped = escapes(text, i, shell, frame.quote),
        end = context.substitution[i + 2];
      if (!escaped && frame.quote === '"' && shell !== "cmd" && text[i] === "$" && text[i + 1] === "(" && end >= 0 && end < to) {
        unquoted[at] = " ";
        unquoted[at + 1] = "(";
        unquoted[offset + end] = ")";
        frame.at = end + 1;
        push(context, i + 2, end, frame.shellBody);
      } else {
        const next = Math.min(i + (escaped ? 2 : 1), to);
        for (let j = i; j < next; j++) {
          unquoted[offset + j] = " ";
          if (";&|(){}\r\n".includes(text[j])) syntax[offset + j] = "\x01";
        }
        frame.at = next;
      }
      continue;
    }
    if (escapes(text, i, shell)) {
      if (i + 1 < to) syntax[at + 1] = "\x01";
      frame.at += 2;
      continue;
    }
    if (commentAt(text, i, shell)) {
      while (frame.at < to && text[frame.at] !== "\n" && text[frame.at] !== "\r") {
        const at = offset + frame.at++;
        chars[at] = syntax[at] = unquoted[at] = " ";
      }
      continue;
    }
    if (text[i] === '"' || (shell !== "cmd" && text[i] === "'")) {
      const end = text[i] === '"' ? context.double[i + 1] : context.single[i + 1];
      if (end < 0 || end >= to) {
        frame.at++;
        continue;
      }
      quotes.set(at, offset + end);
      if (!frame.checked && !frame.shellBody) {
        const script = SCRIPT_START.exec(text.slice(frame.start, to));
        frame.scriptAt = script ? frame.start + script[0].length - 1 : -1;
        frame.checked = true;
      }
      unquoted[at] = unquoted[offset + end] = " ";
      frame.at = end + 1;
      if (i === frame.scriptAt) {
        const command = text.slice(frame.start, i),
          bodyShell = CMD_SCRIPT.test(command) ? "cmd" : POSIX_SCRIPT.test(command) ? "posix" : "powershell";
        push(quoteContext(text.slice(i + 1, end), bodyShell, at + 1), 0, end - i - 1, true);
      } else push(context, i + 1, end, frame.shellBody, text[i]);
    } else if (";&|(){}\n".includes(text[i])) {
      frame.start = i + 1;
      frame.checked = false;
      frame.at++;
    } else frame.at++;
  }
  return { text: chars.join(""), quotes, syntax: syntax.join(""), unquoted: unquoted.join("") };
}
// 引号内的分隔符已由共用扫描遮掉，每段只检查一次。
function pipesToShell(/** @type {string} */ text) {
  if (!text.includes("|")) return false;
  let start = 0,
    piped = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (piped && ch === "\n" && !text.slice(start, i).trim()) {
      start = i + 1;
      continue;
    }
    if (i < text.length && !";&|\n(){".includes(ch)) continue;
    const segment = text.slice(start, i);
    if (piped && PIPE_SHELL.test(segment)) return true;
    piped = ch === "|" && text[i - 1] !== "|" && text[i + 1] !== "|";
    start = i + 1;
  }
  return false;
}
const HIDDEN = HIDDEN_COMMAND,
  SUDO_WORD = /(^|[\s;&|()])sudo(?=$|[\s;&|()])/i,
  HIDDEN_WHY = "不用编码或拼接的指令，直接写出来";
// 指令位上的程序可以写全路径（C:\Windows\System32\reg.exe、& "C:\Program Files\…\reg.exe"）。规则都按命令名认，筛之前先去掉程序的目录，
// 禁用规则、外联、写动词就不必各自认路径；程序自己的路径也不再算它碰的路径——& "C:\Program Files\7-Zip\7z.exe" x a.zip 并没有往系统目录里写。
// 带引号的只认 & 与 . 之后的：别处的引号是字串，("C:\Windows\x") 正可能是写入目标；cmd /c、powershell -c 后面的引号裹的是整条指令，也按不带引号的认。
// 无引号的位置复用 PREFIX / SHELL，env 等前缀与单层 sh -c 后的程序目录也统一在这里去掉。
// 续行（反引号、反斜杠）之后的一行不是指令位，那可能正是写入目标
const LINE_START = String.raw`(?<![${"`"}\\][ \t]*\r?\n)^`,
  CALL_SITE = String.raw`(?:${LINE_START}|[;|({&])[ \t]*`,
  UNQUOTED_EXE_DIR = new RegExp(
    String.raw`((?:${CALL_SITE}(?:\.[ \t]+)?|\$[\w:]+[ \t]*=[ \t]*|\bcmd(?:\.exe)?\b[^\n]*?\s/[ck][ \t]*["']?|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?\s[-/](?:${prefixesOf("command")})[ \t]+["']?)${PREFIX}(?:${SHELL}${PREFIX})?)[^\s"'${"`"};|&<>(){}]*[\\/]`,
    "gim"
  ),
  QUOTED_EXE_DIR = new RegExp(String.raw`((?:(?<!&)&|${CALL_SITE}\.)[ \t]*["'])[^"'\n]*[\\/]`, "gim");
const withoutExeDir = (/** @type {string} */ text) => text.replace(UNQUOTED_EXE_DIR, "$1").replace(QUOTED_EXE_DIR, "$1");
// 指令里禁用的写法，只此一张表：[筛查器（test）, 一句原因, 适用的档]。逐条对整段指令文本查，命中即拒。
// 严＝screenCommand（问而后行）；宽＝screenLoose（审而后行、径行开着沙箱时）；审＝screenAutoReview（审而后行的规则）。
// 宽与审不是第二个沙箱：常规开发、安装、Git（含回退与清理）、本机进程、联网、整机查看、写到目录之外都放行，只拦明确会伤及宿主机或难以恢复的动作。
// 它们不向用户请示；拿不准而确实需要做时，模型可以换用结构化工具，或用户切到「问而后行 / 径行」。沙箱开着时沙箱先筛，审查规则再筛
const EVERY = "严宽审",
  WIDE = "宽审";
const SECURITY_COMMAND = String.raw`(?:-[lqv]+\s+)*`;
/** @type {[{ test(text: string): boolean }, string, string][]} */
const RULES = [
  [
    cmd(
      "launchctl",
      String.raw`(?:load|unload|bootstrap|bootout|enable|disable|kickstart|submit|remove|start|stop|kill|attach|setenv|unsetenv|config|debug|reboot)\b`
    ),
    "不动系统服务",
    EVERY
  ],
  [cmd("defaults", String.raw`(?:(?:-currentHost|-host\s+\S+)\s+)?(?:write|delete|import|rename)\b`), "不动系统设置", EVERY],
  [
    new RegExp(String.raw`${cmd("crontab").source}(?!(?=[^;|&\n]*\s-l\b)(?:\s+(?:-l|-u\s+[^\s"';|&]+))*\s*(?=$|["';|&<>)\n]))`, "im"),
    "不动计划任务",
    EVERY
  ],
  [
    cmd(
      "networksetup",
      String.raw`-(?:set\w+|create\w+|delete\w+|remove\w+|add\w+|rename\w+|duplicate\w+|ordernetworkservices|switchtolocation|detectnewhardware|connectpppoeservice|disconnectpppoeservice)\b`
    ),
    "不动网络与防火墙配置",
    EVERY
  ],
  [
    cmd(
      "diskutil",
      String.raw`(?:quiet\s+)?(?:erase\w*|partitionDisk|reformat|zeroDisk|secureErase|repairVolume|repairDisk|apfs\s+(?:deleteVolume|deleteContainer|addVolume|resizeContainer))\b`
    ),
    "不动磁盘",
    EVERY
  ],
  [
    cmd(
      "security",
      SECURITY_COMMAND +
        String.raw`(?:-[ip]|(?:add|delete|set|create|remove)-[\w-]+|import|lock-keychain|unlock-keychain|install-mds|trust-settings-import|execute-with-privileges|(?:list-keychains|default-keychain|login-keychain)\b[^;|&\n]*\s-s\b|user-trust-settings-enable\s+-[ed]\b|authorizationdb\s+(?:write|remove)\b)(?=\s|$)`
    ),
    "不动钥匙串与安全设置",
    EVERY
  ],
  [
    cmd(
      "security",
      SECURITY_COMMAND +
        String.raw`(?:export\b|dump-keychain\b[^;|&\n]*\s-(?=[a-z]*d)[a-z]+(?=[\s"']|$)|find-(?:generic|internet)-password\b[^;|&\n]*\s-(?=[a-z]*[wg])[a-z]+(?=[\s"']|$))`
    ),
    "不直接读取或导出钥匙串密码与密钥",
    "严"
  ],

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
  [ELEVATION, "不提权", EVERY],
  [SUDO_WORD, "不提权", EVERY],
  [cmd("osascript"), "不直接执行 AppleScript 或 JXA", "严"],
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
/** 这一档里命中的第一条的原因，没有返回 undefined */
const forbiddenWhy = (scanned, tier) => {
  return RULES.find(
    ([pattern, , tiers]) =>
      tiers.includes(tier) &&
      (pattern.test(pattern === SUDO_WORD ? scanned.unquoted : scanned.syntax) || (pattern === HIDDEN && pipesToShell(scanned.syntax)))
  )?.[1];
};
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
  return new RegExp(String.raw`(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])\s*:\s*${BRIDGE_PORT}(?!\d)`, "i").test(text);
}
const BRIDGE_WHY = "指令不调言的本机桥接（它的接口不经请示与沙箱）；要读写文件、跑指令直接用相应的工具";
/**
 * 审查准了也不放行的两样（与存储根那一道一样是底线）：调言自己的桥接——它的接口不经请示与沙箱，跑指令那个口子还认「已审准」，
 * 等于自己给自己盖章；藏字——审查看不见它实际要跑什么，准与驳都只能猜。通过返回 null
 * @param {string} command
 */
function screenUnreviewable(command, { platform = process.platform } = {}) {
  const text = String(command || "");
  if (callsBridge(text)) return BRIDGE_WHY;
  const scanned = shellText(withoutExeDir(text), platform === "win32" ? "powershell" : "posix");
  return HIDDEN.test(scanned.syntax) || pipesToShell(scanned.syntax) ? HIDDEN_WHY : null;
}
// 文件工具会用 screenPath 拦机密文件；指令通道也得拦显式点名，否则 `Get-Content .env` 能从 shell 绕过去。
// 这里只认完整的路径片段，避免把 `dotnet user-secrets list`、`env.d.ts` 这类正常参数误判成文件。
// 不带后缀的 credentials（~/.aws/credentials）要带路径才算：`rg credentials src` 只是搜字。
const SECRET_PATH_IN_COMMAND =
  /(^|[\s"'=;|&(])(?:[^\s"'`;|&<>()]*[\\/]credentials|(?:[^\s"'`;|&<>()]*[\\/])?(?:\.env(?:\.[^\s"'`;|&<>()\\/]*)?|[^\s"'`;|&<>()\\/]*\.(?:pem|key|pfx|p12|jks|keystore)|id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?|[^\s"'`;|&<>()\\/]*\.(?:credentials|secret|secrets)|credentials\.json|secrets\.(?:json|ya?ml|toml)))(?=$|[\s"'`;|&)])/i;
// `.git` 要由 git 自己维护；显式读可以，直接用 shell 写、删、搬则拒绝。脚本内部仍不在静态筛查能力之内。
const GIT_INTERNAL_PATH = /(^|[\s"'=;|&(])[^\s"'`;|&<>()]*\.git[\\/][^\s"'`;|&<>()]*/i;
// 「这条指令会不会改东西」——目录那一道全压在它身上（判定为改，路径才受约束），所以宁可多列：
// 漏一个动词，就等于放行一次目录外的写入。重叠的前缀按长在前排（rmdir 在 rm 前、rename 在 ren 前）。
// 指令由 Windows PowerShell 跑，它的别名是真会执行的：sc = Set-Content、ni = New-Item、ri = Remove-Item、mi / cpi / rni 同理，
// 一并列上；解包、克隆这类把东西放到某处的也算
const WRITE_VERBS = String.raw`Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Set-Item|Clear-Item|Clear-Content|Set-Acl|Compress-Archive|Expand-Archive|Export-Csv|Export-Clixml|Tee-Object|Start-Transcript|(?:New|Set|Remove|Copy|Move|Clear|Rename)-ItemProperty|robocopy|xcopy|copy|rmdir|rd|rm|del|erase|move|mv|cp|rename|ren|mkdir|md|touch|tee|attrib|mklink|fsutil|dd|sc|ac|ni|ri|mi|cpi|rni|rn|si|cli|clc|sp|rp|clp|mp|rnp|epcsv|tar|7za?|unzip|zip|chmod|chown|chflags|ln|rsync|ditto|sed\s+(?:-[^\s]+\s+)*-[A-Za-z]*i|git\s+(?:clone|worktree\s+add)`;
// 带输出目标的参数：curl -o、wget -O、iwr -OutFile、Start-Process 的重定向——动词本身像读，却在往某处写
const OUTPUT_PARAMS = String.raw`(?:^|\s)(?:-o|-O|-OutFile|-OutputPath|-Destination(?:Path)?|-RedirectStandard(?:Output|Error)|--output(?:-document|-dir)?|--outdir|--out-dir)(?=[\s=:]|$)|(?:^|\s)-o(?=[\\/"'A-Za-z])`;
// .NET 直写文件：[IO.File]::WriteAllText、[IO.Directory]::Delete、New-Object IO.StreamWriter 之类
const DOTNET_WRITE = String.raw`\[(?:System\.)?IO\.(?:File|Directory|FileInfo|DirectoryInfo)\]::(?:Write|Append|Create|Delete|Move|Copy|Replace|Set)\w*|\b(?:System\.)?IO\.(?:StreamWriter|FileStream|BinaryWriter)\b`;
const DIRECT_FILE_MUTATION = new RegExp(
  String.raw`${CMD}(?:${WRITE_VERBS})(?:\.exe)?\b|(?:^|[^<])>{1,2}\s*[^&\x01]|${OUTPUT_PARAMS}|${DOTNET_WRITE}`,
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
// 只读来源不受目录约束，只豁免这次参数出现的位置；移动与删除来源不豁免。
// Windows 复制与管道读取沿用既有写法；POSIX 带值选项与 sed 脚本在下面按参数处理。
const PATH_TOKEN = "[^\\s\"'`;|&<>()]+";
const READ_SOURCES = new RegExp(
  String.raw`${CMD}(?:Copy-Item|cpi|cp|copy|xcopy|robocopy)(?:\.exe)?\s+(?:-(?:Recurse|Force|Container|[aHLPRfinprsvX]+)\s+)*(?:-(?:Path|LiteralPath)\s+)?["']?(${PATH_TOKEN})(?![^;|&\n]*/mov)` +
    "|" +
    String.raw`${CMD}(?:Get-Content|gc|cat|type)(?:\.exe)?\s+(?:-(?:Raw|Encoding\s+\S+)\s+)*(?:-(?:Path|LiteralPath)\s+)?["']?(${PATH_TOKEN})(?=[^|>\n]*[|>])` +
    "|" +
    String.raw`${CMD}ln\s+(?:-[sfnivh]+\s+)*["']?(${PATH_TOKEN})`,
  "gim"
);
const POSIX_ARGUMENTS = new RegExp(String.raw`${CMD}(rsync|ditto|sed)\s+`, "gim");
// 列带值选项，而不是列无值选项；日志、临时目录等写入参数只跨过，不豁免其路径。
const RSYNC_VALUES = new Set(
  "exclude include filter exclude-from include-from files-from rsh remote-option address port bwlimit timeout contimeout max-size min-size block-size checksum-seed compress-level skip-compress suffix backup-dir compare-dest copy-dest link-dest log-file out-format temp-dir chmod chown usermap groupmap".split(
    " "
  )
);
const RSYNC_PATTERNS = new Set(["exclude", "include", "filter"]);
function argumentsAt(scanned, start) {
  const text = scanned.text;
  const tokens = [];
  for (let i = start; i < text.length; ) {
    if (/\s/.test(text[i]) && text[i] !== "\n") {
      i++;
      continue;
    }
    if (";&|()<>{}\n".includes(text[i])) break;
    const from = i;
    for (; i < text.length && !/[\s;&|()<>{}]/.test(text[i]); i++) {
      if (scanned.quotes.has(i)) i = scanned.quotes.get(i);
    }
    const raw = text.slice(from, i),
      value = /^(["']).*\1$/s.test(raw) ? raw.slice(1, -1) : raw;
    tokens.push({ start: from, end: i, value });
  }
  return tokens;
}
/**
 * 只记源参数这一次出现的位置，不能按字符串全局豁免：
 * `Copy-Item C:\x .; Remove-Item C:\x` 里前一个 C:\x 是只读来源，后一个仍是删除目标。
 */
function stripReadSources(scanned, sources = true) {
  // 正则索引按 UTF-16 code unit 计；split("") 保持同一套索引（指令前有 emoji 时也不会错位）
  const chars = scanned.text.split("");
  const syntax = scanned.syntax;
  for (const match of sources ? syntax.matchAll(READ_SOURCES) : []) {
    const source = match[1] || match[2] || match[3],
      offset = match[0].lastIndexOf(source),
      start = Number(match.index) + offset;
    if (!source || offset < 0) continue;
    for (let i = start; i < start + source.length; i++) chars[i] = " ";
  }
  for (const match of syntax.matchAll(POSIX_ARGUMENTS)) {
    const tool = match[1].toLowerCase(),
      tokens = argumentsAt(scanned, Number(match.index) + match[0].length),
      removeSource = tool === "rsync" && tokens.some(t => t.value === "--remove-source-files");
    let operand = false,
      options = true,
      sedScript = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i],
        value = token.value;
      let ignored = false;
      if (options && value === "--") {
        options = false;
        continue;
      }
      if (options && value.startsWith("-")) {
        const [name, attached] = value.replace(/^--/, "").split("=", 2);
        if (tool === "rsync") {
          const takesValue = RSYNC_VALUES.has(name) || /^-[efBT]$/.test(value);
          ignored = RSYNC_PATTERNS.has(name) || value === "-f";
          if (takesValue && attached === undefined && tokens[i + 1]) {
            if (ignored) {
              const arg = tokens[i + 1];
              for (let j = arg.start; j < arg.end; j++) chars[j] = " ";
            }
            i++;
          }
        } else if (tool === "ditto") {
          if ((name === "arch" || name === "bom") && attached === undefined) i++;
        } else {
          if (value === "-e" || value === "--expression" || value === "-f" || value === "--file") {
            sedScript = true;
            ignored = true;
            if (tokens[i + 1]) {
              const arg = tokens[++i];
              for (let j = arg.start; j < arg.end; j++) chars[j] = " ";
            }
          } else if (/^-[A-Za-z]*i$/.test(value) && tokens[i + 1]?.value === "") i++;
        }
      } else if (!operand) {
        operand = true;
        ignored = tool === "sed" ? !sedScript : sources && !removeSource;
      }
      if (ignored) for (let j = token.start; j < token.end; j++) chars[j] = " ";
    }
  }
  return chars.join("");
}
/**
 * 会改动东西的指令，它碰的路径必须都在工作目录之内。判定从严：一条指令里只要出现写、删、搬或重定向，
 * 整条都按「写」处理，它顺带读的那些路径也一并受约束——静态看不出哪个参数是源、哪个是目标，
 * 只有 READ_SOURCES 认得出的那几种来源例外。沙箱与审而后行共用，只差开头的称呼。通过返回 null。
 * @param {ReturnType<typeof shellText>} scanned @param {string} workdir @param {boolean} win @param {string} prefix
 */
function screenWritePaths(scanned, workdir, win, prefix) {
  const writeText = stripReadSources(scanned);
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
/**
 * 筛一条指令。通过返回 null；拒绝返回一句原因（给模型看的，说清怎么改）
 * @param {string} command
 * @param {string} workdir 完整的绝对路径
 */
function screenCommand(command, workdir, { platform = process.platform } = {}) {
  const raw = String(command || "");
  if (callsBridge(raw)) return `沙箱拒绝：${BRIDGE_WHY}`;
  const text = withoutExeDir(raw),
    win = platform === "win32",
    scanned = shellText(text, win ? "powershell" : "posix");
  const forbidden = forbiddenWhy(scanned, "严");
  if (forbidden) return `沙箱拒绝：${forbidden}`;
  if (SECRET_PATH_IN_COMMAND.test(text)) return "沙箱拒绝：指令不读写 .env、密钥或凭据文件；需要普通配置时请改用不含机密的文件";
  // 目录这一道只锁「写」：查看整台机器是电脑检查的本分，锁住读等于把这件事堵死
  if (DIRECT_FILE_MUTATION.test(scanned.syntax)) {
    if (GIT_INTERNAL_PATH.test(stripReadSources(scanned, false))) return "沙箱拒绝：不直接改 .git 内部；请使用相应的 git 指令";
    const why = screenWritePaths(scanned, workdir, win, "沙箱拒绝");
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
 * 规则刻意比沙箱宽得多：目录、机密文件、.git 内部、Git 回退都不管，只看会不会伤到系统本身。
 * @param {string} command
 */
function screenAutoReview(command, { platform = process.platform } = {}) {
  const raw = String(command || "");
  if (callsBridge(raw)) return `审查拒绝：${BRIDGE_WHY}`;
  const text = withoutExeDir(raw),
    scanned = shellText(text, platform === "win32" ? "powershell" : "posix"),
    forbidden = forbiddenWhy(scanned, "审");
  if (forbidden) return `审查拒绝：${forbidden}`;
  if (BROAD_DELETE.test(text)) return "审查拒绝：不代为执行整目录、通配符或磁盘级删除";
  if (DIRECT_FILE_MUTATION.test(scanned.syntax) && REVIEW_SYSTEM_PATH.test(stripReadSources(scanned)))
    return "审查拒绝：不往 Windows、Program Files、/usr、/System 这类系统目录里写";
  return null;
}
/**
 * 宽的沙箱：给「审而后行」与「径行」。三档由严到宽是 问而后行 ≤ 审而后行 ≤ 径行——问而后行里沙箱拦下的会转给用户请示、
 * 批了便出沙箱跑；后两档不向用户请示，沙箱就只守系统本身：注册表、服务、计划任务、账户、磁盘、提权、执行策略、
 * 藏字与别名、往系统目录里写。联网、写目录之外、机密文件、.git 内部都放行。通过返回 null
 * @param {string} command
 */
function screenLoose(command, { platform = process.platform } = {}) {
  const raw = String(command || "");
  if (callsBridge(raw)) return `沙箱拒绝：${BRIDGE_WHY}`;
  const text = withoutExeDir(raw),
    scanned = shellText(text, platform === "win32" ? "powershell" : "posix"),
    forbidden = forbiddenWhy(scanned, "宽");
  if (forbidden) return `沙箱拒绝：${forbidden}`;
  if (DIRECT_FILE_MUTATION.test(scanned.syntax) && REVIEW_SYSTEM_PATH.test(stripReadSources(scanned)))
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
  const text = String(rel || "")
    .split("\\")
    .join("/");
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
    target = normalizeLower(path.resolve(full));
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
  screenStoreCommand,
  SECRET_ENV
};
