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
// 指令位与包装前缀只吃行内空白，不能从每个行首重扫后续空行。
const INLINE_SPACE = String.raw`[^\S\r\n]`;
const SHELL_WORD = String.raw`(?:"(?:\\.|[^"\\\n])*"|'[^'\n]*'|[^\s"';&|()]+)`;
// xargs / env 的普通选项仍供其它命令规则使用；sudo 不靠枚举包装词的选项来识别。
const ENV_VAL_OPT = String.raw`(?:-(?:[0iv]*)?[uCSP]|--(?:chdir|split-string|unset))${INLINE_SPACE}+${SHELL_WORD}`;
const ENV_NOVAL_OPT = String.raw`-(?!(?:[0iv]*)?[uCSP](?:${INLINE_SPACE}|$)|-(?:chdir|split-string|unset)(?:${INLINE_SPACE}|$))[^\s"';&|()]+`;
const ENV_OPTS = String.raw`(?:${ENV_VAL_OPT}|${ENV_NOVAL_OPT})`;
const EXEC_VAL_OPT = String.raw`-[cl]*a(?:${INLINE_SPACE}+${SHELL_WORD}|[^\s"';&|()]+)`;
const EXEC_NOVAL_OPT = String.raw`-[cl]+`;
const EXEC_OPTS = String.raw`exec(?:${INLINE_SPACE}+(?:${EXEC_VAL_OPT}|${EXEC_NOVAL_OPT}))*(?:${INLINE_SPACE}+--)?`;
const PREFIX = String.raw`(?:(?:if|elif|while|until|!|then|do|else|${EXEC_OPTS}|nohup|nice(?:${INLINE_SPACE}+-n${INLINE_SPACE}*-?\d+)?|time(?:${INLINE_SPACE}+-p\b)?|timeout${INLINE_SPACE}+(?:-[kK]${INLINE_SPACE}*\d+(?:\.\d+)?[smhd]?${INLINE_SPACE}+)?\d+(?:\.\d+)?[smhd]?|command(?:${INLINE_SPACE}+-p\b)?(?:${INLINE_SPACE}+--)?(?=${INLINE_SPACE}+\S)|xargs(?:${INLINE_SPACE}+-[^\s"';&|()]+)*|env(?:${INLINE_SPACE}+${ENV_OPTS})*|[A-Za-z_]\w*=(?:${SHELL_WORD})?)${INLINE_SPACE}+)*`;
const SHELL = String.raw`(?:[^\s"';&|(){}]*/)?(?:ba|z|da|k)?sh(?:\.exe)?${INLINE_SPACE}+(?:--(?:rcfile|init-file)${INLINE_SPACE}+${SHELL_WORD}${INLINE_SPACE}+|--[\w-]+${INLINE_SPACE}+|-o${INLINE_SPACE}+\S+${INLINE_SPACE}+|-(?!o\s)[^c\s-]+${INLINE_SPACE}+)*-[a-z]*c[a-z]*${INLINE_SPACE}+(?:--${INLINE_SPACE}+)?["']?`;
const CMD =
  String.raw`(?:^|[;&|({)\n]|\$[\w:]+${INLINE_SPACE}*=(?=${INLINE_SPACE}*[^\s"'])|\bcmd(?:\.exe)?\b[^\n]*?/[ck]|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?(?=[\s"'&]))${INLINE_SPACE}*["']?(?:&${INLINE_SPACE}*["']?)?` +
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
const ALIASING = new RegExp(
  String.raw`${cmd("(?:Set|New)-Alias|sal|nal").source}|${CMD}alias\s+[^\s=]+\s*=|${CMD}(?:Set|New)-Item\s+(?:-(?:Path|LiteralPath)\s+)?["']?(?:function|alias):`,
  "im"
);
const ELEVATION = new RegExp(
  String.raw`-Verb\s+RunAs\b|${cmd(String.raw`(?:/\S*/)?sudo`).source}|${cmd("osascript", String.raw`[^\n]*(?:with\s+administrator\s+privileges\b|administratorPrivileges\s*:\s*true\b)`).source}`,
  "im"
);
// 藏字：编码过的指令、拿 Invoke-Expression 跑拼出来的字串——筛查与审查都只看得到一串编码，判不了它要做什么。
// Invoke-Expression 与 iex 按指令位认，后面可贴括号、引号或就此收尾（irm x | iex、iex(irm x)）；赋值的右边也算在执行。rg iex a.txt 是搜字，不算
// PowerShell 认参数名的任意前缀，也认 / 开头：-en、-encodedc、/enc 都是 -EncodedCommand，串再短也能跑。所以站在指令位的 powershell / pwsh（可带路径、可经 Start-Process）
// 后面见到就算；-Command、-File 之后的属于被跑的东西（powershell -c "node -e 1"），不算。别的程序的 -e 只认一长串 base64 那一条
const prefixesOf = (/** @type {string} */ word) => Array.from(word, (_, i) => word.slice(0, i + 1)).join("|");
// 只有带引号的程序路径能跨空白；否则会随每个前缀切分反复扫描余下的整行。
const POWERSHELL_ENCODED = String.raw`${CMD}(?:Start-Process\s+(?:-FilePath\s+)?)?["']?(?:(?:(?<=["'])[^"'\n;|&(){}]*|[^\s"'\n;|&(){}]*)[\\/])?(?:powershell|pwsh)(?:\.exe)?["']?(?:(?![\s"'][-/](?:${prefixesOf("command")}|${prefixesOf("file")})(?:[\s:]|$))[^\n;|&])*?[\s"'][-/](?:ec|${prefixesOf("encodedcommand")})(?=[\s:"']|$)`;
// 命令名是算出来的：& ("i"+"ex")、.("ie"+"x")、& (gcm i*x)，或把字串变成脚本块再跑（[scriptblock]::Create）。规则与审查都看不到它实际跑什么。
// & $exe 不算：把带空格的程序路径放进变量再调用是常规写法，拦了误伤多，真想藏的也还有 node -e 可走（见文件头）
// & 要在语句开头：a & (b) 是 pandas 之类脚本里的按位与
const COMPUTED_CALL = String.raw`(?:^|[;|({\n=])${INLINE_SPACE}*[&.]${INLINE_SPACE}*\(|\[(?:System\.Management\.Automation\.)?ScriptBlock\]::Create\b|\.InvokeCommand\.(?:InvokeScript|NewScriptBlock)\b`;
const HIDDEN_COMMAND = new RegExp(
  String.raw`(?:${CMD}|=\s*)(?:Invoke-Expression|iex|\.(?=(?<dotSpace>(?:${INLINE_SPACE}|\x60\x01\n?)+)(?:Invoke-Expression|"Invoke-Expression"|'Invoke-Expression'|(?=<#))(?![\w.-])))(?![\w.-])|-EncodedCommand\b|(^|\s)-(enc|ec|e)\s+[A-Za-z0-9+=]{32,}|${POWERSHELL_ENCODED}|${COMPUTED_CALL}` +
    String.raw`|${CMD}eval(?=[\s"']|$)|${CMD}(?:source|\.)\s+<\(` +
    String.raw`|${CMD}(?:ba|z|da|k)?sh\s+(?:-[^\s]+\s+)*<\(` +
    String.raw`|${CMD}${SHELL}\$\(`,
  "dgim"
);
const PIPE_SHELL = new RegExp(
  String.raw`^${INLINE_SPACE}*${PREFIX}["']?(?:[^\s"';&|(){}]*/)?(?:(?:ba|z|da|k)?sh|powershell|pwsh)(?:\.exe)?["']?(?=[\s<>]|$)`,
  "i"
);
const PIPE_REDIR_OP = /^(?:<<<|<<-|<<|>>|>&|<&|<>|>\||&>>|&>|>|<)/;
// 跳过一处重定向（可带 fd 前缀与目标词），返回目标之后的位置；当前位置不是重定向则返回 -1。
// 手工扫而不塞进正则：重定向目标里的数字与运算符符号会让正则回溯组合爆炸。
function skipPipeRedir(/** @type {string} */ text, /** @type {number} */ at) {
  let i = at;
  while (i < text.length && text[i] >= "0" && text[i] <= "9") i++;
  const op = PIPE_REDIR_OP.exec(text.slice(i));
  if (!op) return -1;
  i += op[0].length;
  while (i < text.length && /[^\S\r\n]/.test(text[i])) i++;
  // 目标是一个 shell 词：引号段、转义与裸段可以拼接（>"foo"sh 是文件名 foosh，不是命令 sh）
  const target = i;
  for (;;) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "\\") j++;
        else if (text[j] === '"') break;
      }
      if (j >= text.length) return -1;
      i = j + 1;
    } else if (ch === "'") {
      const close = text.indexOf("'", i + 1);
      if (close < 0) return -1;
      i = close + 1;
    } else if (ch === "\\") {
      if (i + 1 >= text.length) return -1;
      i += 2;
    } else if (i < text.length && !/[\s;&|()<>]/.test(ch)) {
      i++;
    } else break;
  }
  return i > target ? i : -1;
}
// 管道段里的 shell 前后都可以带重定向：cat x | 2>/dev/null sh、cat x | sh>out、cat x | <in sh。
// 先把前导重定向（含其目标词）整个吃掉，再认命令名——「> sh」的 sh 是文件名不是 shell。
function pipeRunsShell(/** @type {string} */ segment) {
  let i = 0;
  for (;;) {
    while (i < segment.length && /[^\S\r\n]/.test(segment[i])) i++;
    const next = skipPipeRedir(segment, i);
    if (next < 0) break;
    i = next;
  }
  return PIPE_SHELL.test(segment.slice(i));
}
const REDIRECTION =
  /(?:\b\d+)?(?:<<-?|<<<|>>?|>[&|]|<&|<>|<)\s*(?:'[^'\n]*'|"(?:\\.|[^"\\\n])*"|\\[\s\S]|[^\s"';&|()<>]+)+|&>>?\s*(?:'[^'\n]*'|"(?:\\.|[^"\\\n])*"|\\[\s\S]|[^\s"';&|()<>]+)+/g;
const SCRIPT_START = new RegExp(
  String.raw`^${INLINE_SPACE}*${PREFIX}(?:${SHELL}|(?:cmd(?:\.exe)?\b[^\n]*?/[ck]|(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?[-/](?:${prefixesOf("command")}))${INLINE_SPACE}+["'])`,
  "i"
);
const CMD_SCRIPT = new RegExp(String.raw`^${INLINE_SPACE}*${PREFIX}cmd(?:\.exe)?\b[^\n]*?/[ck]${INLINE_SPACE}*$`, "i");
const POSIX_SCRIPT = new RegExp(String.raw`^${INLINE_SPACE}*${PREFIX}${SHELL}$`, "i");
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
function quoteContext(text, shell, offset = 0, dotComments = false) {
  const single = new Int32Array(text.length + 2).fill(-1),
    double = new Int32Array(text.length + 2).fill(-1),
    substitution = new Int32Array(text.length + 2).fill(-1);
  let newline = text.length,
    blockEnd = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (dotComments && ch === "#" && text[i + 1] === ">") blockEnd = i + 2;
    if (ch === "\n" || ch === "\r") newline = i;
    single[i] = ch === "'" ? i : single[i + 1];
    if (escapes(text, i, shell, '"')) double[i] = double[i + 2];
    else if (ch === '"') double[i] = i;
    else if (shell !== "cmd" && ch === "$" && text[i + 1] === "(" && substitution[i + 2] >= 0) double[i] = double[substitution[i + 2] + 1];
    else double[i] = double[i + 1];

    if (escapes(text, i, shell)) substitution[i] = substitution[i + 2];
    else if (dotComments && shell !== "cmd" && blockEnd >= 0 && ch === "<" && text[i + 1] === "#") substitution[i] = substitution[blockEnd];
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
function decodeAnsiC(str) {
  let res = "";
  let i = 0;
  while (i < str.length) {
    if (str.charCodeAt(i) === 0) break;
    if (str[i] === "\\" && i + 1 < str.length) {
      const c = str[i + 1];
      if (c === "a") {
        res += "\x07";
        i += 2;
      } else if (c === "b") {
        res += "\b";
        i += 2;
      } else if (c === "e" || c === "E") {
        res += "\x1b";
        i += 2;
      } else if (c === "f") {
        res += "\f";
        i += 2;
      } else if (c === "n") {
        res += "\n";
        i += 2;
      } else if (c === "r") {
        res += "\r";
        i += 2;
      } else if (c === "t") {
        res += "\t";
        i += 2;
      } else if (c === "v") {
        res += "\v";
        i += 2;
      } else if (c === "\\") {
        res += "\\";
        i += 2;
      } else if (c === "'") {
        res += "'";
        i += 2;
      } else if (c === '"') {
        res += '"';
        i += 2;
      } else if (c === "?") {
        res += "?";
        i += 2;
      } else if (c === "x") {
        const hex = str.slice(i + 2, i + 4).match(/^[0-9a-fA-F]{1,2}/);
        if (hex) {
          const b = parseInt(hex[0], 16);
          if (b === 0) break;
          res += String.fromCharCode(b);
          i += 2 + hex[0].length;
        } else {
          res += "\\x";
          i += 2;
        }
      } else if (c === "u" || c === "U") {
        const maxLen = c === "u" ? 4 : 8;
        const hex = str.slice(i + 2, i + 2 + maxLen).match(/^[0-9a-fA-F]+/);
        if (hex) {
          const cp = parseInt(hex[0], 16);
          if (cp === 0) break;
          if (cp >= 0 && cp <= 0x10ffff) {
            res += String.fromCodePoint(cp);
          } else {
            res += "\\" + c;
          }
          i += 2 + hex[0].length;
        } else {
          res += "\\" + c;
          i += 2;
        }
      } else if (c === "c") {
        if (i + 2 < str.length) {
          const ctrl = str.charCodeAt(i + 2);
          const b = ctrl >= 64 && ctrl <= 95 ? ctrl - 64 : ctrl >= 97 && ctrl <= 122 ? ctrl - 96 : ctrl;
          if (b === 0) break;
          res += String.fromCharCode(b);
          i += 3;
        } else {
          res += "\\c";
          i += 2;
        }
      } else if (/^[0-7]/.test(c)) {
        const oct = str.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
        if (oct) {
          const byte = parseInt(oct[0], 8) & 0xff;
          if (byte === 0) break;
          res += String.fromCharCode(byte);
          i += 1 + oct[0].length;
        } else {
          res += "\\" + c;
          i += 2;
        }
      } else {
        res += "\\" + c;
        i += 2;
      }
    } else {
      res += str[i];
      i++;
    }
  }
  return res;
}
function findHeredocEnd(text, delim, dash, startPos, to, quoted = true) {
  let pos = startPos;
  while (pos < to) {
    let logicalLine = "";
    let lineStart = pos;
    let lineEnd = pos;
    while (lineEnd < to) {
      let nl = text.indexOf("\n", lineEnd);
      if (nl === -1 || nl > to) nl = to;
      let piece = text.slice(lineEnd, nl);
      if (piece.endsWith("\r")) piece = piece.slice(0, -1);
      let trailingSlashes = 0;
      let k = piece.length - 1;
      while (k >= 0 && piece[k] === "\\") {
        trailingSlashes++;
        k--;
      }
      if (!quoted && trailingSlashes % 2 === 1 && nl < to) {
        logicalLine += piece.slice(0, -1);
        lineEnd = nl + 1;
        continue;
      }
      logicalLine += piece;
      lineEnd = nl < to ? nl + 1 : nl;
      break;
    }
    let line = logicalLine;
    if (dash) line = line.replace(/^[ \t]+/, "");
    if (line === delim) {
      const termLineStart = lineStart;
      const termLineEnd = lineEnd;
      return { termLineStart, termLineEnd };
    }
    pos = lineEnd;
  }
  return null;
}
function findParamEnd(text, startPos, to) {
  let p = startPos;
  let braceDepth = 1;
  while (p < to) {
    const c = text[p];
    if (c === "\\") {
      p += 2;
      continue;
    }
    if (c === "$" && text[p + 1] === "'") {
      let q = p + 2;
      while (q < to && text[q] !== "'") {
        if (text[q] === "\\" && q + 1 < to) q += 2;
        else q++;
      }
      p = q < to ? q + 1 : to;
      continue;
    }
    if (c === "$" && text[p + 1] === '"') {
      let q = p + 2;
      while (q < to && text[q] !== '"') {
        if (text[q] === "\\" && q + 1 < to) q += 2;
        else q++;
      }
      p = q < to ? q + 1 : to;
      continue;
    }
    if (c === "'") {
      const end = text.indexOf("'", p + 1);
      p = end === -1 || end >= to ? to : end + 1;
      continue;
    }
    if (c === '"') {
      let q = p + 1;
      while (q < to) {
        if (text[q] === "\\") q += 2;
        else if (text[q] === "$" && text[q + 1] === "(") {
          const sub = findSubstEnd(text, q + 2, to);
          q = sub === -1 ? to : sub + 1;
        } else if (text[q] === "`") {
          let b = q + 1;
          while (b < to && text[b] !== "`") {
            if (text[b] === "\\" && b + 1 < to) b += 2;
            else b++;
          }
          q = b < to ? b + 1 : to;
        } else if (text[q] === '"') {
          q++;
          break;
        } else q++;
      }
      p = q;
      continue;
    }
    if (c === "`") {
      let b = p + 1;
      while (b < to && text[b] !== "`") {
        if (text[b] === "\\" && b + 1 < to) b += 2;
        else b++;
      }
      p = b < to ? b + 1 : to;
      continue;
    }
    if (c === "$" && text[p + 1] === "(") {
      const sub = findSubstEnd(text, p + 2, to);
      p = sub === -1 ? to : sub + 1;
      continue;
    }
    if (c === "$" && text[p + 1] === "{") {
      braceDepth++;
      p += 2;
      continue;
    }
    if (c === "}") {
      braceDepth--;
      if (braceDepth === 0) return p;
      p++;
      continue;
    }
    p++;
  }
  return -1;
}
function isReservedWordPos(text, pos, startPos) {
  let b = pos - 1;
  while (b >= startPos && (text[b] === " " || text[b] === "\t")) b--;
  if (b < startPos) return true;
  if (text[b] === "\n" || text[b] === ";" || text[b] === "&" || text[b] === "|" || text[b] === "(") return true;
  if (text[b] === "!") {
    let prev = b - 1;
    while (prev >= startPos && (text[prev] === " " || text[prev] === "\t")) prev--;
    if (prev < startPos || /[\s;&|()]/.test(text[prev])) return true;
  }
  const prevWord = text.slice(Math.max(startPos, b - 5), b + 1).match(/\b(then|else|do)$/);
  if (prevWord) {
    let prev = b + 1 - prevWord[1].length - 1;
    while (prev >= startPos && (text[prev] === " " || text[prev] === "\t")) prev--;
    if (prev < startPos || /[\s;&|()]/.test(text[prev])) return true;
  }
  return false;
}
function matchCaseHeader(text, pos, to) {
  let p = pos;
  if (p >= to || !/\s/.test(text[p])) return null;
  while (p < to && /\s/.test(text[p])) p++;
  let hasWord = false;
  while (p < to) {
    const c = text[p];
    if (c === "$" && (text[p + 1] === "'" || text[p + 1] === '"')) {
      const qChar = text[p + 1];
      let q = p + 2;
      while (q < to && text[q] !== qChar) {
        if (text[q] === "\\" && q + 1 < to) q += 2;
        else q++;
      }
      p = q < to ? q + 1 : to;
      hasWord = true;
    } else if (c === "$" && text[p + 1] === "{") {
      const paramEnd = findParamEnd(text, p + 2, to);
      if (paramEnd === -1) return null;
      p = paramEnd + 1;
      hasWord = true;
    } else if (c === "'" || c === '"') {
      const quote = c;
      p++;
      while (p < to && text[p] !== quote) {
        if (quote === '"' && text[p] === "\\" && p + 1 < to) p += 2;
        else p++;
      }
      if (p < to) p++;
      hasWord = true;
    } else if (c === "\\") {
      p += 2;
      hasWord = true;
    } else if (c === "$" && text[p + 1] === "(") {
      const sub = findSubstEnd(text, p + 2, to);
      if (sub === -1) return null;
      p = sub + 1;
      hasWord = true;
    } else if (c === "`") {
      let b = p + 1;
      while (b < to && text[b] !== "`") {
        if (text[b] === "\\" && b + 1 < to) b += 2;
        else b++;
      }
      p = b < to ? b + 1 : to;
      hasWord = true;
    } else if (/\s/.test(c)) {
      let next = p;
      while (next < to && /\s/.test(text[next])) next++;
      // case 的 WORD 与 in 必须同在一行（bash 对跨行报语法错误）；\<换行> 由上面的转义分支吃掉，不受影响
      if (/[\r\n]/.test(text.slice(p, next))) return null;
      if (hasWord && text.startsWith("in", next) && (next + 2 >= to || /[\s;&|()]/.test(text[next + 2]))) {
        return next + 2;
      }
      p = next;
    } else if (/^[;&|()]/.test(c)) {
      return null;
    } else {
      hasWord = true;
      p++;
    }
  }
  return null;
}
// 解析 << 后的定界符字：可含引号、$'...'、$"..." 与转义；end 是定界符之后的位置。
// 定界符是单个字，跨行的 '...' 不算（与 shellText 既有判断一致）。findSubstEnd、shellText 与 substEnds 共用。
function heredocOp(text, pos, to) {
  const dash = text[pos + 2] === "-";
  let p = pos + 2 + (dash ? 1 : 0);
  while (p < to && (text[p] === " " || text[p] === "\t")) p++;
  let delim = "",
    quoted = false,
    end = p;
  while (end < to) {
    const c = text[end];
    if (c === "'") {
      const nextSingle = text.indexOf("'", end + 1);
      if (nextSingle === -1 || nextSingle >= to || text.slice(end + 1, nextSingle).includes("\n")) break;
      delim += text.slice(end + 1, nextSingle);
      end = nextSingle + 1;
      quoted = true;
    } else if (c === '"') {
      let nextQuote = end + 1;
      let content = "";
      let closed = false;
      while (nextQuote < to && text[nextQuote] !== "\n") {
        if (text[nextQuote] === "\\") {
          if (nextQuote + 1 < to && text[nextQuote + 1] !== "\n") {
            const nextCh = text[nextQuote + 1];
            if (/[$`"\\\r\n]/.test(nextCh)) {
              content += nextCh;
              nextQuote += 2;
              continue;
            }
          }
        }
        if (text[nextQuote] === '"') {
          closed = true;
          break;
        }
        content += text[nextQuote];
        nextQuote++;
      }
      if (!closed) break;
      delim += content;
      end = nextQuote + 1;
      quoted = true;
    } else if (c === "$" && text[end + 1] === "'") {
      let q = end + 2;
      let raw = "";
      let closed = false;
      while (q < to && text[q] !== "\n") {
        if (text[q] === "\\") {
          if (q + 1 < to && text[q + 1] !== "\n") {
            raw += text.slice(q, q + 2);
            q += 2;
            continue;
          }
        }
        if (text[q] === "'") {
          closed = true;
          q++;
          break;
        }
        raw += text[q];
        q++;
      }
      if (!closed) break;
      delim += decodeAnsiC(raw);
      end = q;
      quoted = true;
    } else if (c === "$" && text[end + 1] === '"') {
      let q = end + 2;
      let content = "";
      let closed = false;
      while (q < to && text[q] !== "\n") {
        if (text[q] === "\\") {
          if (q + 1 < to && text[q + 1] !== "\n") {
            const nextCh = text[q + 1];
            if (/[$`"\\\r\n]/.test(nextCh)) {
              content += nextCh;
              q += 2;
              continue;
            }
          }
        }
        if (text[q] === '"') {
          closed = true;
          q++;
          break;
        }
        content += text[q];
        q++;
      }
      if (!closed) break;
      delim += content;
      end = q;
      quoted = true;
    } else if (c === "\\") {
      if (end + 1 < to && text[end + 1] !== "\n" && text[end + 1] !== "\r") {
        delim += text[end + 1];
        end += 2;
        quoted = true;
      } else if (end + 1 < to && text[end + 1] === "\n") {
        end += 2;
      } else if (end + 2 < to && text[end + 1] === "\r" && text[end + 2] === "\n") {
        end += 3;
      } else break;
    } else if (/[\s;&|()<>]/.test(c)) break;
    else {
      delim += c;
      end++;
    }
  }
  return delim ? { delim, dash, quoted, end } : null;
}
function findSubstEnd(text, startPos, to) {
  let depth = 1;
  let arithDepth = 0;
  let pos = startPos;
  const heredocs = [];
  const caseStack = [];
  while (pos < to) {
    const ch = text[pos];
    if (ch === "\\") {
      pos += 2;
      continue;
    }
    if (ch === "#" && (pos === startPos || /[\s;&|()]/.test(text[pos - 1]))) {
      while (pos < to && text[pos] !== "\n" && text[pos] !== "\r") pos++;
      continue;
    }
    if (ch === "$" && text[pos + 1] === "'") {
      let q = pos + 2;
      while (q < to && text[q] !== "'") {
        if (text[q] === "\\" && q + 1 < to) q += 2;
        else q++;
      }
      pos = q < to ? q + 1 : to;
      continue;
    }
    if (ch === "$" && text[pos + 1] === '"') {
      let q = pos + 2;
      while (q < to && text[q] !== '"') {
        if (text[q] === "\\" && q + 1 < to) q += 2;
        else q++;
      }
      pos = q < to ? q + 1 : to;
      continue;
    }
    if (ch === "'") {
      const end = text.indexOf("'", pos + 1);
      pos = end === -1 || end >= to ? to : end + 1;
      continue;
    }
    if (ch === '"') {
      let p = pos + 1;
      while (p < to) {
        if (text[p] === "\\") {
          p += 2;
        } else if (text[p] === "$" && text[p + 1] === "(") {
          const sub = findSubstEnd(text, p + 2, to);
          p = sub === -1 ? to : sub + 1;
        } else if (text[p] === "`") {
          let b = p + 1;
          while (b < to && text[b] !== "`") {
            if (text[b] === "\\" && b + 1 < to) b += 2;
            else b++;
          }
          p = b < to ? b + 1 : to;
        } else if (text[p] === '"') {
          p++;
          break;
        } else p++;
      }
      pos = p;
      continue;
    }
    if (ch === "`") {
      let b = pos + 1;
      while (b < to && text[b] !== "`") {
        if (text[b] === "\\" && b + 1 < to) b += 2;
        else b++;
      }
      pos = b < to ? b + 1 : to;
      continue;
    }
    if (ch === "$" && text[pos + 1] === "(" && text[pos + 2] === "(") {
      depth += 2;
      arithDepth += 2;
      pos += 3;
      continue;
    }
    if (ch === "$" && text[pos + 1] === "{") {
      const paramEnd = findParamEnd(text, pos + 2, to);
      pos = paramEnd === -1 ? to : paramEnd + 1;
      continue;
    }
    if (arithDepth === 0 && ch === "<" && text[pos + 1] === "<" && text[pos + 2] !== "<") {
      const op = heredocOp(text, pos, to);
      if (op) {
        heredocs.push({ delim: op.delim, dash: op.dash, quoted: op.quoted });
        pos = op.end;
        continue;
      }
    }
    if (ch === "\n") {
      pos++;
      if (heredocs.length) {
        let cur = pos;
        while (heredocs.length) {
          const doc = heredocs.shift();
          const found = findHeredocEnd(text, doc.delim, doc.dash, cur, to, doc.quoted);
          if (!found) break;
          cur = found.termLineEnd;
        }
        pos = cur;
      }
      continue;
    }
    if (ch === "c" && text.slice(pos, pos + 4) === "case" && isReservedWordPos(text, pos, startPos)) {
      const afterIn = matchCaseHeader(text, pos + 4, to);
      if (afterIn !== null) {
        caseStack.push(depth);
        pos = afterIn;
        continue;
      }
    }
    if (
      ch === "e" &&
      text.slice(pos, pos + 4) === "esac" &&
      isReservedWordPos(text, pos, startPos) &&
      (pos + 4 >= to || /[\s;&|()<>]/.test(text[pos + 4]))
    ) {
      if (caseStack.length > 0 && depth === caseStack[caseStack.length - 1]) {
        caseStack.pop();
        pos += 4;
        continue;
      }
    }
    if (ch === "(") {
      if (arithDepth > 0) arithDepth++;
      depth++;
      pos++;
      continue;
    }
    if (ch === ")") {
      if (arithDepth > 0) arithDepth--;
      if (caseStack.length > 0 && depth === caseStack[caseStack.length - 1]) {
        pos++;
        continue;
      }
      depth--;
      if (depth === 0) return pos;
      pos++;
      continue;
    }
    pos++;
  }
  return -1;
}
// $() 收尾的一趟前扫：ends[$ 的位置] = 配对 ) 的位置，配对规则与 findSubstEnd 相同
// （引号、注释、heredoc、case、${}、$(())），powershell 用反引号转义、无 ANSI-C 串与反引号命令替换；
// 但用显式栈代替递归，深层嵌套不会爆栈，整表一次算完不按起点重扫。
// ${}、未加引号 heredoc 正文与 case 匹配词里的 $( 也会执行：它们不影响外层括号配对，
// 但内部 $( 的收尾要记进同一张表——这些区域作为子串任务入队扫描，彼此不重叠，总开销仍是 O(n)。
/**
 * @typedef {{ kind: "code", depth: number, arith: number, heredocs: { delim: string, dash: boolean, quoted: boolean }[], cases: number[], start: number, open: number } | { kind: "param", depth: number } | { kind: "squote" | "ansi" | "btick" | "dquote" | "pshere" }} SubstMode
 */
function substEnds(text, shell, doubleQuoted = false, dotComments = false) {
  const ends = new Int32Array(text.length).fill(-1),
    jobs = [{ text, shell, base: 0, doubleQuoted }];
  while (jobs.length) {
    const job = jobs.pop();
    scanSubst(job.text, job.shell, job.base, ends, jobs, job.doubleQuoted, dotComments);
  }
  return ends;
}
function scanSubst(text, shell, base, ends, jobs, doubleQuoted = false, dotComments = false) {
  const posix = shell !== "powershell",
    n = text.length,
    /** @type {SubstMode[]} */
    stack = doubleQuoted ? [{ kind: "dquote" }] : [{ kind: "code", depth: 0, arith: 0, heredocs: [], cases: [], start: 0, open: -1 }];
  const top = () => stack[stack.length - 1];
  const openSubst = (dollar, arith) => {
    stack.push({ kind: "code", depth: arith ? 2 : 1, arith: arith ? 2 : 0, heredocs: [], cases: [], start: dollar + 2, open: dollar });
  };
  const mergeSubst = (from, to, subShell) => {
    if (to > from + 1) jobs.push({ text: text.slice(from, to), shell: subShell, base: base + from });
  };
  let i = 0,
    noBlockEnd = false;
  while (i < n) {
    const mode = top(),
      ch = text[i];
    if (mode.kind === "pshere") {
      // PowerShell @"..."@ here-string：正文里只有 $( 会展开，` 转义，行首 "@ 收尾。
      if (ch === "\n") {
        i++;
        if (text[i] === '"' && text[i + 1] === "@") {
          stack.pop();
          i += 2;
        }
        continue;
      }
      if (ch === "`") {
        i += 2;
        continue;
      }
      if (ch === "$" && text[i + 1] === "(") {
        openSubst(i, text[i + 2] === "(");
        i += text[i + 2] === "(" ? 3 : 2;
        continue;
      }
      i++;
      continue;
    }
    if (mode.kind === "param") {
      // ${...}：里面的 $( 会执行、) 不外溢；嵌套 ${} 计深度，转义与引号跟所在 shell。
      if (posix && ch === "\\") {
        i += 2;
        continue;
      }
      if (!posix && ch === "`") {
        i += 2;
        continue;
      }
      if (ch === "$" && text[i + 1] === "(") {
        openSubst(i, text[i + 2] === "(");
        i += text[i + 2] === "(" ? 3 : 2;
        continue;
      }
      if (ch === "$" && text[i + 1] === "{") {
        mode.depth++;
        i += 2;
        continue;
      }
      if (ch === "}") {
        if (--mode.depth === 0) stack.pop();
        i++;
        continue;
      }
      if (posix && ch === "$" && text[i + 1] === "'") {
        stack.push({ kind: "ansi" });
        i += 2;
        continue;
      }
      if (posix && ch === "$" && text[i + 1] === '"') {
        stack.push({ kind: "dquote" });
        i += 2;
        continue;
      }
      if (posix && ch === "`") {
        stack.push({ kind: "btick" });
        i++;
        continue;
      }
      if (ch === "'") {
        stack.push({ kind: "squote" });
        i++;
        continue;
      }
      if (ch === '"') {
        stack.push({ kind: "dquote" });
        i++;
        continue;
      }
      i++;
      continue;
    }
    if (mode.kind !== "code") {
      if (mode.kind === "dquote") {
        if (posix ? ch === "\\" : ch === "`") {
          i += 2;
          continue;
        }
        if (posix && ch === "`") {
          stack.push({ kind: "btick" });
          i++;
          continue;
        }
        if (ch === "$" && text[i + 1] === "(") {
          openSubst(i, text[i + 2] === "(");
          i += text[i + 2] === "(" ? 3 : 2;
          continue;
        }
        if (ch === '"') {
          stack.pop();
          i++;
          continue;
        }
        i++;
        continue;
      }
      if (mode.kind === "btick") {
        // 反引号体是执行上下文：$( 要照常配对，但 ) 不外溢到外层括号。
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === "$" && text[i + 1] === "(") {
          openSubst(i, text[i + 2] === "(");
          i += text[i + 2] === "(" ? 3 : 2;
          continue;
        }
        if (ch === "`") {
          stack.pop();
          i++;
          continue;
        }
        i++;
        continue;
      }
      const close = mode.kind === "squote" || mode.kind === "ansi" ? "'" : "`";
      if (ch === close) {
        stack.pop();
        i++;
      } else if (ch === "\\" && mode.kind !== "squote" && i + 1 < n) i += 2;
      else i++;
      continue;
    }
    // code：执行上下文。posix 的 \ 与反引号串、powershell 的反引号转义在这里分岔。
    if (posix && ch === "\\") {
      i += 2;
      continue;
    }
    if (!posix && ch === "`") {
      i += 2;
      continue;
    }
    if (dotComments && !noBlockEnd && ch === "<" && text[i + 1] === "#") {
      const end = text.indexOf("#>", i + 2);
      if (end >= 0) {
        i = end + 2;
        continue;
      }
      noBlockEnd = true;
    }
    if (ch === "#" && commentAt(text, i, shell)) {
      while (i < n && text[i] !== "\n" && text[i] !== "\r") i++;
      continue;
    }
    if (posix && ch === "$" && text[i + 1] === "'") {
      stack.push({ kind: "ansi" });
      i += 2;
      continue;
    }
    if (ch === "$" && text[i + 1] === '"') {
      // $"..." 在 bash 里仍展开 $( 与反引号，按可展开双引号处理。
      stack.push({ kind: "dquote" });
      i += 2;
      continue;
    }
    if (posix && ch === "`") {
      stack.push({ kind: "btick" });
      i++;
      continue;
    }
    if (ch === "$" && text[i + 1] === "(") {
      openSubst(i, text[i + 2] === "(");
      i += text[i + 2] === "(" ? 3 : 2;
      continue;
    }
    if (ch === "$" && text[i + 1] === "{") {
      stack.push({ kind: "param", depth: 1 });
      i += 2;
      continue;
    }
    if (ch === "'") {
      stack.push({ kind: "squote" });
      i++;
      continue;
    }
    if (ch === '"') {
      stack.push({ kind: "dquote" });
      i++;
      continue;
    }
    if (!posix && ch === "@") {
      // PowerShell here-string：@" / @' 后只跟空白到行尾；"@ 正文里 $( 展开，'@ 全字面量。
      const q = text[i + 1];
      if (q === '"' || q === "'") {
        let nl = i + 2;
        while (nl < n && (text[nl] === " " || text[nl] === "\t")) nl++;
        if (nl < n && (text[nl] === "\n" || text[nl] === "\r")) {
          if (q === '"') {
            stack.push({ kind: "pshere" });
            i = nl;
            continue;
          }
          const term = text.indexOf("\n" + q + "@", nl);
          if (term !== -1) {
            i = term + 3;
            continue;
          }
        }
      }
    }
    if (ch === "<" && text[i + 1] === "<" && text[i + 2] !== "<" && (i === 0 || text[i - 1] !== "<") && mode.arith === 0) {
      const op = heredocOp(text, i, n);
      if (op) {
        mode.heredocs.push({ delim: op.delim, dash: op.dash, quoted: op.quoted });
        i = op.end;
        continue;
      }
    }
    if (ch === "\n") {
      i++;
      if (mode.heredocs.length) {
        let cur = i;
        while (mode.heredocs.length) {
          const doc = mode.heredocs.shift();
          const found = findHeredocEnd(text, doc.delim, doc.dash, cur, n, doc.quoted);
          if (!found) break;
          if (!doc.quoted) mergeSubst(cur, found.termLineStart, "posix");
          cur = found.termLineEnd;
        }
        i = cur;
      }
      continue;
    }
    if (ch === "c" && text.slice(i, i + 4) === "case" && isReservedWordPos(text, i, mode.start)) {
      const afterIn = matchCaseHeader(text, i + 4, n);
      if (afterIn !== null) {
        mode.cases.push(mode.depth);
        mergeSubst(i + 4, afterIn, shell);
        i = afterIn;
        continue;
      }
    }
    if (
      ch === "e" &&
      text.slice(i, i + 4) === "esac" &&
      isReservedWordPos(text, i, mode.start) &&
      (i + 4 >= n || /[\s;&|()<>]/.test(text[i + 4]))
    ) {
      if (mode.cases.length > 0 && mode.depth === mode.cases[mode.cases.length - 1]) {
        mode.cases.pop();
        i += 4;
        continue;
      }
    }
    if (ch === "(") {
      if (mode.arith > 0) mode.arith++;
      mode.depth++;
      i++;
      continue;
    }
    if (ch === ")") {
      if (mode.arith > 0) mode.arith--;
      if (mode.cases.length > 0 && mode.depth === mode.cases[mode.cases.length - 1]) {
        i++;
        continue;
      }
      if (mode.depth > 0) mode.depth--;
      if (mode.depth === 0) {
        if (mode.open >= 0) {
          ends[base + mode.open] = base + i;
          stack.pop();
        }
      }
      i++;
      continue;
    }
    i++;
  }
}
function unquoteWord(text) {
  let res = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "$" && text[i + 1] === "'") {
      let p = i + 2;
      let raw = "";
      while (p < text.length && text[p] !== "'") {
        if (text[p] === "\\" && p + 1 < text.length) {
          raw += text.slice(p, p + 2);
          p += 2;
        } else {
          raw += text[p];
          p++;
        }
      }
      res += decodeAnsiC(raw);
      i = p < text.length ? p + 1 : text.length;
    } else if (ch === "$" && text[i + 1] === '"') {
      let p = i + 2;
      while (p < text.length) {
        if (text[p] === "\\" && p + 1 < text.length) {
          if (text[p + 1] === "\n") {
            p += 2;
          } else if (text[p + 1] === "\r" && text[p + 2] === "\n") {
            p += 3;
          } else {
            res += text[p + 1];
            p += 2;
          }
        } else if (text[p] === '"') {
          p++;
          break;
        } else {
          res += text[p];
          p++;
        }
      }
      i = p;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) {
        res += text.slice(i + 1);
        break;
      }
      res += text.slice(i + 1, end);
      i = end + 1;
    } else if (ch === '"') {
      let p = i + 1;
      while (p < text.length) {
        if (text[p] === "\\" && p + 1 < text.length) {
          if (text[p + 1] === "\n") {
            p += 2;
          } else if (text[p + 1] === "\r" && text[p + 2] === "\n") {
            p += 3;
          } else {
            res += text[p + 1];
            p += 2;
          }
        } else if (text[p] === '"') {
          p++;
          break;
        } else {
          res += text[p];
          p++;
        }
      }
      i = p;
    } else if (ch === "\\") {
      if (i + 1 < text.length && text[i + 1] === "\n") {
        i += 2;
      } else if (i + 2 < text.length && text[i + 1] === "\r" && text[i + 2] === "\n") {
        i += 3;
      } else if (i + 1 < text.length) {
        res += text[i + 1];
        i += 2;
      } else break;
    } else {
      res += ch;
      i++;
    }
  }
  return res;
}
// 一份扫描同时提供注释已抹掉的文本、语法视图与 sudo 整词视图，索引始终不变。
// 普通参数隐藏分隔符与整段引号内容；执行字符串展开一层，$() 则进入自己的上下文。
function shellText(text, shell, dotComments = false) {
  const chars = text.split(""),
    syntax = text.split(""),
    unquoted = text.split("");
  const quotes = new Map();
  const frames = [];
  const push = (context, from, to, shellBody, quote = "", outerQuote = false) => {
    frames.push({
      context,
      at: from,
      to,
      shellBody,
      quote,
      outerQuote,
      start: from,
      stmtStart: from,
      parenDepth: 0,
      braceDepth: 0,
      checked: false,
      scriptAt: -1,
      heredocs: [],
      arithDepth: 0
    });
  };
  push(quoteContext(text, shell, 0, dotComments), 0, text.length, false);
  // $() 的收尾不能用 substitution 表：它只按裸括号配对，case 的 )、${} 与 heredoc 正文里的 ) 会被当成收尾，
  // 把 ; sudo id 这类正文留在引号视图里。substEnds 一趟前扫按 findSubstEnd 同一套规则配对，按 context 缓存。
  const substEnd = (context, dollar) => (context.ends ??= substEnds(context.text, context.shell, false, dotComments))[dollar];
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
        subst = !escaped && frame.quote === '"' && shell !== "cmd" && text[i] === "$" && text[i + 1] === "(",
        end = subst ? substEnd(context, i) : -1;
      if (subst && end >= 0 && end < to) {
        if (frame.outerQuote) {
          for (let j = i; j <= end; j++) {
            const index = offset + j;
            chars[index] = syntax[index] = unquoted[index] = text[j];
          }
        } else {
          unquoted[at] = " ";
          unquoted[at + 1] = "(";
          unquoted[offset + end] = ")";
        }
        frame.at = end + 1;
        push(context, i + 2, end, frame.shellBody);
      } else {
        const next = Math.min(i + (escaped ? 2 : 1), to);
        if (!frame.outerQuote)
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
    if (shell === "powershell" && text[i] === "@" && (text[i + 1] === "'" || text[i + 1] === '"')) {
      let nl = i + 2;
      while (nl < to && text[nl] !== "\n" && text[nl] !== "\r") {
        if (text[nl] !== " " && text[nl] !== "\t") break;
        nl++;
      }
      if (nl < to && (text[nl] === "\n" || text[nl] === "\r")) {
        const q = text[i + 1];
        let termIdx = text.indexOf("\n" + q + "@", nl);
        if (termIdx === -1) termIdx = text.indexOf("\r\n" + q + "@", nl);
        if (termIdx !== -1 && termIdx < to) {
          if (termIdx > 0 && text[termIdx - 1] === "\r") termIdx--;
          const endAt = termIdx + (text[termIdx] === "\r" ? 4 : 3);
          quotes.set(at, offset + endAt);
          if (q === '"') {
            let j = i;
            while (j < endAt) {
              if (text[j] === "`" && j + 1 < endAt) {
                unquoted[offset + j] = unquoted[offset + j + 1] = " ";
                syntax[offset + j] = syntax[offset + j + 1] = " ";
                j += 2;
                continue;
              }
              const subEnd = text[j] === "$" && text[j + 1] === "(" ? substEnd(context, j) : -1;
              if (text[j] === "$" && text[j + 1] === "(" && subEnd >= 0 && subEnd < endAt) {
                unquoted[offset + j] = " ";
                unquoted[offset + j + 1] = "(";
                unquoted[offset + subEnd] = ")";
                push(context, j + 2, subEnd, frame.shellBody);
                j = subEnd + 1;
              } else {
                unquoted[offset + j] = " ";
                syntax[offset + j] = text[j] === "\n" || text[j] === "\r" ? text[j] : " ";
                j++;
              }
            }
          } else {
            for (let j = i; j < endAt; j++) {
              unquoted[offset + j] = " ";
              syntax[offset + j] = text[j] === "\n" || text[j] === "\r" ? text[j] : " ";
            }
          }
          frame.at = endAt;
          continue;
        }
      }
    }
    if (shell !== "cmd" && text[i] === "$" && text[i + 1] === "(" && text[i + 2] === "(") {
      frame.arithDepth += 2;
      frame.at += 3;
      continue;
    }
    if (frame.arithDepth > 0) {
      if (text[i] === "(") {
        frame.arithDepth++;
        frame.at++;
        continue;
      }
      if (text[i] === ")") {
        frame.arithDepth--;
        frame.at++;
        continue;
      }
    }
    if (
      frame.arithDepth === 0 &&
      shell !== "cmd" &&
      text[i] === "<" &&
      text[i + 1] === "<" &&
      text[i + 2] !== "<" &&
      (i === 0 || text[i - 1] !== "<")
    ) {
      const op = heredocOp(text, i, to);
      if (op) {
        frame.heredocs.push({ delim: op.delim, dash: op.dash, quoted: op.quoted, cmdStart: frame.stmtStart });
        quotes.set(at, offset + op.end - 1);
        frame.at = op.end;
        continue;
      }
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
          body = text.slice(i + 1, end),
          bodyShell = CMD_SCRIPT.test(command) ? "cmd" : POSIX_SCRIPT.test(command) ? "posix" : "powershell";
        if (text[i] === '"') {
          const outer = quoteContext(body, shell, at + 1, dotComments);
          outer.ends = substEnds(body, shell, true, dotComments);
          push(outer, 0, body.length, true, '"', true);
        }
        push(quoteContext(body, bodyShell, at + 1, dotComments), 0, body.length, true);
      } else push(context, i + 1, end, frame.shellBody, text[i]);
    } else if (";&|(){}\n".includes(text[i])) {
      if (text[i] === "(") {
        if (frame.arithDepth === 0) frame.parenDepth++;
      } else if (text[i] === ")") {
        if (frame.arithDepth === 0 && frame.parenDepth > 0) frame.parenDepth--;
      } else if (text[i] === "{") {
        frame.braceDepth++;
      } else if (text[i] === "}") {
        if (frame.braceDepth > 0) frame.braceDepth--;
      }
      if (";&|\n".includes(text[i]) && frame.parenDepth === 0 && frame.braceDepth === 0) {
        frame.stmtStart = i + 1;
      }
      if (text[i] === "\n" && frame.heredocs?.length) {
        let nextStart = i + 1;
        while (frame.heredocs.length) {
          const doc = frame.heredocs.shift();
          const found = findHeredocEnd(text, doc.delim, doc.dash, nextStart, to, doc.quoted);
          if (!found) {
            frame.heredocs.length = 0;
            break;
          }
          const { termLineStart, termLineEnd } = found;
          const rawCmd = text.slice(doc.cmdStart, i);
          const cleanCmd = rawCmd.replace(REDIRECTION, " ");
          let isShell = PIPE_SHELL.test(unquoteWord(cleanCmd));
          if (!isShell) {
            const segments = cleanCmd.split(/[;&|(){}]/);
            for (const seg of segments) {
              const trimmed = unquoteWord(seg.trim());
              if (trimmed && PIPE_SHELL.test(trimmed)) {
                isShell = true;
                break;
              }
            }
          }
          if (!isShell && /[|]/.test(cleanCmd)) {
            let p = termLineEnd;
            while (p < to) {
              let nl = text.indexOf("\n", p);
              if (nl === -1 || nl > to) nl = to;
              let line = text.slice(p, nl).trim();
              if (line && !line.startsWith("#")) break;
              p = nl < to ? nl + 1 : nl;
            }
            const nextSegment = text
              .slice(p, to)
              .split(/[;&|\n(){}]/)[0]
              .trim();
            if (nextSegment && PIPE_SHELL.test(unquoteWord(nextSegment))) {
              isShell = true;
            }
          }
          if (isShell) {
            push(
              quoteContext(text.slice(nextStart, termLineStart), "posix", offset + nextStart, dotComments),
              0,
              termLineStart - nextStart,
              frame.shellBody
            );
            for (let j = termLineStart; j < termLineEnd; j++) {
              unquoted[offset + j] = " ";
              if (text[j] !== "\n" && text[j] !== "\r") {
                syntax[offset + j] = " ";
                chars[offset + j] = " ";
              }
            }
          } else {
            if (!doc.quoted) {
              let j = nextStart;
              while (j < termLineStart) {
                if (text[j] === "\\" && j + 1 < termLineStart && /[$`"\\\r\n]/.test(text[j + 1])) {
                  const step = text[j + 1] === "\r" && text[j + 2] === "\n" ? 3 : 2;
                  for (let s = 0; s < step; s++) {
                    unquoted[offset + j + s] = " ";
                    syntax[offset + j + s] = " ";
                    if (text[j + s] !== "\n" && text[j + s] !== "\r") chars[offset + j + s] = " ";
                  }
                  j += step;
                  continue;
                }
                if (text[j] === "$") {
                  let p = j + 1;
                  while (p < termLineStart && text[p] === "\\") {
                    if (text[p + 1] === "\n") p += 2;
                    else if (text[p + 1] === "\r" && text[p + 2] === "\n") p += 3;
                    else break;
                  }
                  if (p < termLineStart && text[p] === "(") {
                    const subEnd = findSubstEnd(text, p + 1, termLineStart);
                    if (subEnd >= 0 && subEnd < termLineStart) {
                      unquoted[offset + j] = " ";
                      unquoted[offset + p] = "(";
                      unquoted[offset + subEnd] = ")";
                      push(context, p + 1, subEnd, frame.shellBody);
                      j = subEnd + 1;
                      continue;
                    } else {
                      push(context, p + 1, termLineStart, frame.shellBody);
                      j = termLineStart;
                      continue;
                    }
                  }
                }
                if (text[j] === "`") {
                  let btEnd = j + 1;
                  while (btEnd < termLineStart && text[btEnd] !== "`") {
                    if (text[btEnd] === "\\" && btEnd + 1 < termLineStart) btEnd += 2;
                    else btEnd++;
                  }
                  if (btEnd < termLineStart && text[btEnd] === "`") {
                    unquoted[offset + j] = " ";
                    unquoted[offset + btEnd] = " ";
                    syntax[offset + j] = "(";
                    syntax[offset + btEnd] = ")";
                    push(context, j + 1, btEnd, frame.shellBody);
                    j = btEnd + 1;
                    continue;
                  } else {
                    push(context, j + 1, termLineStart, frame.shellBody);
                    j = termLineStart;
                    continue;
                  }
                } else {
                  unquoted[offset + j] = " ";
                  syntax[offset + j] = text[j] === "\n" || text[j] === "\r" ? text[j] : " ";
                  if (text[j] !== "\n" && text[j] !== "\r") chars[offset + j] = " ";
                  j++;
                }
              }
            } else {
              for (let j = nextStart; j < termLineStart; j++) {
                unquoted[offset + j] = " ";
                syntax[offset + j] = text[j] === "\n" || text[j] === "\r" ? text[j] : " ";
                if (text[j] !== "\n" && text[j] !== "\r") chars[offset + j] = " ";
              }
            }
            for (let j = termLineStart; j < termLineEnd; j++) {
              unquoted[offset + j] = " ";
              if (text[j] !== "\n" && text[j] !== "\r") {
                syntax[offset + j] = " ";
                chars[offset + j] = " ";
              }
            }
            quotes.set(offset + nextStart, offset + termLineEnd - 1);
          }
          nextStart = termLineEnd;
        }
        frame.start = nextStart;
        frame.stmtStart = nextStart;
        frame.parenDepth = 0;
        frame.braceDepth = 0;
        frame.checked = false;
        frame.at = nextStart;
        continue;
      }
      frame.start = i + 1;
      frame.checked = false;
      frame.at++;
    } else frame.at++;
  }
  return { text: chars.join(""), source: text, shell, quotes, syntax: syntax.join(""), unquoted: unquoted.join("") };
}
// 引号内的分隔符已由共用扫描遮掉，每段只检查一次。
function pipesToShell(/** @type {string} */ text) {
  if (!text.includes("|")) return false;
  let start = 0,
    piped = false,
    pipeAmp = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (piped && ch === "\n" && !text.slice(start, i).trim()) {
      start = i + 1;
      continue;
    }
    if (i < text.length && !";&|\n(){".includes(ch)) continue;
    // >&、<&、&>、&>> 里的 & 属于重定向运算符，不是命令分隔符
    if (ch === "&" && (text[i - 1] === ">" || text[i - 1] === "<" || text[i + 1] === ">")) continue;
    const segment = text.slice(start, i);
    if (piped && pipeRunsShell(segment)) return true;
    // |& 是 bash 的管道运算符（stdout 与 stderr 一起喂给下一个指令），& 不结束这条管道
    if (pipeAmp && ch === "&") {
      pipeAmp = false;
      start = i + 1;
      continue;
    }
    piped = ch === "|" && text[i - 1] !== "|" && text[i + 1] !== "|";
    pipeAmp = ch === "|" && text[i + 1] === "&";
    start = i + 1;
  }
  return false;
}
const HIDDEN = HIDDEN_COMMAND,
  SUDO_WORD = /(^|[\s;&|()<>])sudo(?=$|[\s;&|()<>])/i,
  HIDDEN_WHY = "不用编码或拼接的指令，直接写出来";
function hasHiddenCommand(scanned, dotComments = false) {
  const spacing = /<#[\s\S]*?#>|(?:[^\S\r\n]|\x60\r?\n)+/y,
    name = /(?:Invoke-Expression|"Invoke-Expression"|'Invoke-Expression')(?![\w.-])/iy;
  let commentEnd = 0;
  for (const match of scanned.syntax.matchAll(HIDDEN)) {
    const gap = match.indices.groups.dotSpace;
    // syntax 把所有转义的下一字符都换成 \x01；点调用只把真实的反引号换行当空白。
    if (!gap) {
      if (!dotComments) return true;
      continue;
    }
    if (!/^(?:[^\S\r\n]|\x60\r?\n)+$/.test(scanned.text.slice(gap[0], gap[1]))) continue;
    if (!scanned.syntax.startsWith("<#", gap[1])) {
      if (!dotComments) return true;
      continue;
    }
    if (gap[1] < commentEnd) continue;
    // 块注释的 #> 可能已被行注释视图抹掉；只从已确认的点调用位置读原文，不改共用视图。
    let at = gap[1];
    while (true) {
      spacing.lastIndex = at;
      if (!spacing.test(scanned.source)) break;
      at = spacing.lastIndex;
    }
    commentEnd = scanned.source.startsWith("<#", at) ? scanned.source.length : at;
    name.lastIndex = at;
    if (name.test(scanned.source)) return true;
  }
  // 只补查块注释点调用的 $() 配对；原扫描及其它规则的命中不变。
  return !dotComments && scanned.source.includes("<#") && hasHiddenCommand(shellText(scanned.source, scanned.shell, true), true);
}
// 指令位上的程序可以写全路径（C:\Windows\System32\reg.exe、& "C:\Program Files\…\reg.exe"）。规则都按命令名认，筛之前先去掉程序的目录，
// 禁用规则、外联、写动词就不必各自认路径；程序自己的路径也不再算它碰的路径——& "C:\Program Files\7-Zip\7z.exe" x a.zip 并没有往系统目录里写。
// 带引号的只认 & 与 . 之后的：别处的引号是字串，("C:\Windows\x") 正可能是写入目标；cmd /c、powershell -c 后面的引号裹的是整条指令，也按不带引号的认。
// 无引号的位置复用 PREFIX / SHELL，env 等前缀与单层 sh -c 后的程序目录也统一在这里去掉。
// 续行（反引号、反斜杠）之后的一行不是指令位，那可能正是写入目标
const LINE_START = String.raw`(?<![${"`"}\\][ \t]*\r?\n)^`,
  CALL_SITE = String.raw`(?:${LINE_START}|[;|({&])[ \t]*`,
  UNQUOTED_EXE_DIR_WIN = new RegExp(
    String.raw`((?:${CALL_SITE}(?:\.[ \t]+)?|\$[\w:]+[ \t]*=[ \t]*|\bcmd(?:\.exe)?\b[^\n]*?\s/[ck][ \t]*["']?|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?\s[-/](?:${prefixesOf("command")})[ \t]+["']?)${PREFIX}(?:${SHELL}${PREFIX})?)[^\s"'${"`"};|&<>(){}]*[\\/](?=[^\s"'${"`"};|&<>(){}]+)`,
    "gim"
  ),
  UNQUOTED_EXE_DIR_POSIX = new RegExp(
    String.raw`((?:${CALL_SITE}(?:\.[ \t]+)?|\$[\w:]+[ \t]*=[ \t]*|\bcmd(?:\.exe)?\b[^\n]*?\s/[ck][ \t]*["']?|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?\s[-/](?:${prefixesOf("command")})[ \t]+["']?)${PREFIX}(?:${SHELL}${PREFIX})?)(?:[A-Za-z]:[^\s"'${"`"};|&<>(){}]*[\\/]|[\w.]+\.[\w.]+\\|[^\s"'${"`"};|&<>(){}]*\/)(?=[^\s"'${"`"};|&<>(){}]+)`,
    "gim"
  ),
  QUOTED_EXE_DIR = new RegExp(String.raw`((?:(?<!&)&|${CALL_SITE}\.)[ \t]*["'])[^"'\n]*[\\/]`, "gim"),
  POSIX_CMD_ESCAPES = new RegExp(
    String.raw`((?:${CALL_SITE}(?:\.[ \t]+)?|\$[\w:]+[ \t]*=[ \t]*|\bcmd(?:\.exe)?\b[^\n]*?\s/[ck][ \t]*["']?|\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?\s[-/](?:${prefixesOf("command")})[ \t]+["']?)${PREFIX}(?:${SHELL}${PREFIX})?)([^\s"'${"`"};|&<>()]+)`,
    "gim"
  );
const withoutExeDir = (/** @type {string} */ text, win = process.platform === "win32") =>
  win
    ? text.replace(UNQUOTED_EXE_DIR_WIN, "$1").replace(QUOTED_EXE_DIR, "$1")
    : text
        .replace(UNQUOTED_EXE_DIR_POSIX, "$1")
        .replace(QUOTED_EXE_DIR, "$1")
        .replace(POSIX_CMD_ESCAPES, (_, pfx, cmd) => pfx + cmd.replace(/\\([a-zA-Z0-9_.-])/g, "$1"));
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
      (pattern === HIDDEN
        ? hasHiddenCommand(scanned) || pipesToShell(scanned.syntax)
        : pattern.test(pattern === SUDO_WORD ? scanned.unquoted : scanned.syntax))
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
  String.raw`(^|[\s;&|(])(${NET_TOOL_NAMES})(\.exe)?(\s|$)|(^|[;&|(\n]${INLINE_SPACE}*)["'](${NET_TOOL_NAMES})(\.exe)?["'](\s|$)`,
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
function screenUnreviewable(command, { platform = process.platform } = {}) {
  const text = String(command || "");
  if (callsBridge(text)) return BRIDGE_WHY;
  const win = platform === "win32";
  const scanned = shellText(withoutExeDir(text, win), win ? "powershell" : "posix");
  return hasHiddenCommand(scanned) || pipesToShell(scanned.syntax) ? HIDDEN_WHY : null;
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
const WRITE_VERBS = String.raw`Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Rename-Item|New-Item|Set-Item|Clear-Item|Clear-Content|Set-Acl|Compress-Archive|Expand-Archive|Export-Csv|Export-Clixml|Tee-Object|Start-Transcript|(?:New|Set|Remove|Copy|Move|Clear|Rename)-ItemProperty|robocopy|xcopy|copy|rmdir|rd|rm|del|erase|move|mv|cp|rename|ren|mkdir|md|touch|tee|attrib|mklink|fsutil|dd|sc|ac|ni|ri|mi|cpi|rni|rn|si|cli|clc|sp|rp|clp|mp|rnp|epcsv|tar|7za?|unzip|zip|chmod|chown|chflags|ln|rsync|ditto|sed\s+(?:-[^\s]+\s+)*(?:-[A-Za-z]*i|--in-place)|git\s+(?:clone|worktree\s+add)`;
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
  "exclude include filter exclude-from include-from files-from rsh rsync-path remote-option address port bwlimit timeout contimeout max-size min-size block-size checksum-seed compress-level skip-compress suffix backup-dir compare-dest copy-dest link-dest log-file out-format temp-dir chmod chown usermap groupmap".split(
    " "
  )
);
const RSYNC_READ_VALUES = new Set(
  "exclude include filter exclude-from include-from files-from link-dest compare-dest copy-dest rsh rsync-path address".split(" ")
);
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
          const short = /^-[A-Za-z]*?([efBT])(.*)$/.exec(value),
            takesValue = RSYNC_VALUES.has(name) || !!short,
            hasAttached = short ? short[2] !== "" : attached !== undefined;
          ignored = RSYNC_READ_VALUES.has(name) || !!(short && "ef".includes(short[1]));
          if (takesValue && !hasAttached && tokens[i + 1]) {
            if (ignored) {
              const arg = tokens[i + 1];
              for (let j = arg.start; j < arg.end; j++) chars[j] = " ";
            }
            i++;
          }
        } else if (tool === "ditto") {
          ignored = name === "bom";
          if ((value === "-arch" || name === "arch" || name === "bom") && attached === undefined && tokens[i + 1]) {
            const arg = tokens[++i];
            if (ignored) for (let j = arg.start; j < arg.end; j++) chars[j] = " ";
          }
        } else {
          const script = /^(?:-[ef]|--(?:expression|file)(?:=|$))/.exec(value);
          if (script) {
            sedScript = true;
            ignored = true;
            if (value.length === script[0].length && !value.endsWith("=") && tokens[i + 1]) {
              const arg = tokens[++i];
              for (let j = arg.start; j < arg.end; j++) chars[j] = " ";
            }
          } else if ((/^-[A-Za-z]*i$/.test(value) || value === "--in-place") && tokens[i + 1]?.value === "") i++;
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
// 判定「写」时用的文本：只读来源先抹掉；7z、curl 这类把输出路径紧贴在 -o 后面（-oC:\x、-o..\x）的，
// 路径前没有空白，盘符与 .. 都认不出来，先拆开再扫（--output 与 -o 不混；只影响判定，不改实际指令）
/** @param {ReturnType<typeof shellText>} scanned */
function writeScanText(scanned) {
  return stripReadSources(scanned).replace(/(^|[\s"'])-o(?=[\\/"']|\.\.[\\/]|[A-Za-z]:[\\/])/gi, "$1-o ");
}
/**
 * 会改动东西的指令，它碰的路径必须都在工作目录之内。判定从严：一条指令里只要出现写、删、搬或重定向，
 * 整条都按「写」处理，它顺带读的那些路径也一并受约束——静态看不出哪个参数是源、哪个是目标，
 * 只有 READ_SOURCES 认得出的那几种来源例外。沙箱与审而后行共用，只差开头的称呼。通过返回 null。
 * @param {ReturnType<typeof shellText>} scanned @param {string} workdir @param {boolean} win @param {string} prefix
 */
function screenWritePaths(scanned, workdir, win, prefix) {
  const writeText = writeScanText(scanned);
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
  // config：`git config 键` 是读、`git config 键 值` 是写；--unset / --add 这些一律算写；
  // 写明了 --get 一类的，后面多出的是值的模式或 URL（--get-urlmatch http https://x），仍是读
  if (name === "config")
    return (
      !args.some(arg => /^(?:--(?:unset|unset-all|add|replace-all|rename-section|remove-section|edit|append)|-e)$/.test(arg)) &&
      (args.some(arg => /^(?:--get(?:-all|-regexp|-urlmatch|-color|-colorbool)?|--list|-l)$/.test(arg)) ||
        args.filter(arg => !arg.startsWith("-")).length <= 1)
    );
  const allowed = GIT_READ_ARGS[name];
  if (!allowed) return false;
  // `git stash` 不带参数是存起来，不是列出
  if (!args.length && name === "stash") return false;
  // branch / tag 带了 -l / --list，位置参数是筛名字的模式（git tag --list "v1.3*"），不是要建的名
  const listing = (name === "branch" || name === "tag") && args.some(arg => arg === "-l" || arg === "--list");
  let takesValue = false;
  for (const arg of args) {
    if (takesValue || (listing && !arg.startsWith("-"))) {
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
/** 参数里有 shell 展开（$HOME、%USERPROFILE%、~/x）时静态看不出落到哪，一律按出去了算。
 * ~ 只在开头才展开：短文件名 C:\PROGRA~1 里的不算 */
function dynamicPath(value) {
  return /[$`]|^~|%[^%\\/]+%/.test(value);
}
// 换目录的几种写法：`cd ..; git checkout -- f` 里那个 `..` 不是「改动路径」，写路径规则不会拿它去判
const CD_COMMAND = /^(?:cd|chdir|sl|set-location|pushd|push-location)$/i;
/**
 * git 动的仓库落没落在工作目录之外：是则返回拒绝语，否则 null。
 * 按段依次走，cd 换过的目录接着算（`git commit; cd 别处` 里 git 在 cd 之前，不受它牵连）；
 * 每个 git 调用从当时的目录出发，再叠 -C（按出现次序生效，-C sub -C .. 又绕回来）与 --git-dir / --work-tree（取最后一个）。
 * 落到外面时只放行查看类子命令。子命令自己的 pathspec 不在这里管：git 自身拒绝工作树外的路径
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
  /** 当前目录；cd 到静态看不出的地方（不带参数回家目录、带 shell 展开）后记那个写法，按出去了算 */
  let here = workdir,
    unknown = "";
  for (const tokens of commandSegments(text)) {
    if (CD_COMMAND.test(tokens[0] || "")) {
      // Set-Location -Path x：跳过开关取头一个目录参数
      const target = tokens.slice(1).find(token => !token.startsWith("-"));
      if (!target || dynamicPath(target)) unknown = target || tokens[0];
      else if (!unknown) here = api.resolve(here, target);
      continue;
    }
    const invocation = gitInvocation(tokens);
    if (!invocation) continue;
    let cwd = here,
      outside = unknown || null;
    for (const dir of outside ? [] : invocation.dirs) {
      if (dynamicPath(dir)) {
        outside = dir;
        break;
      }
      cwd = api.resolve(cwd, dir);
    }
    for (const target of outside ? [] : [cwd, invocation.gitDir, invocation.workTree]) {
      if (target === null) continue;
      // cwd 是已解析好的目录（工作目录里本就可能有 $），只对指令里原样写的 --git-dir / --work-tree 查 shell 展开
      if ((target !== cwd && dynamicPath(target)) || !inside(api.resolve(cwd, target))) {
        outside = target;
        break;
      }
    }
    if (!outside) continue;
    if (!invocation.opts.some(opt => GIT_RUNS_COMMANDS.has(opt)) && gitReadOnly(invocation.sub, invocation.args)) continue;
    return `沙箱拒绝：git 动的仓库在工作目录之外（${outside}，经 cd 或 -C / --git-dir / --work-tree）；只有 log、status、diff、show 这类查看子命令能跨出去，要改动那一处请把工作目录设在那一处`;
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
  const win = platform === "win32",
    text = withoutExeDir(raw, win),
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
  // git 把仓库指到别处：`git -C .. checkout -- f`、`cd ..; git reset --hard` 里都没有一个「改动路径」，
  // 上面的写路径规则看不出它动的是上层的工作树，于是整个漏过。这里跟着 cd 与 -C / --git-dir / --work-tree 判一遍；
  // 落到外面时只放行查看类子命令（git -C .. log 仍放行），目录内的 -C sub 照旧
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
function screenAutoReview(command, { platform = process.platform } = {}) {
  const raw = String(command || "");
  if (callsBridge(raw)) return `审查拒绝：${BRIDGE_WHY}`;
  const win = platform === "win32",
    text = withoutExeDir(raw, win),
    scanned = shellText(text, win ? "powershell" : "posix"),
    forbidden = forbiddenWhy(scanned, "审");
  if (forbidden) return `审查拒绝：${forbidden}`;
  if (BROAD_DELETE.test(text)) return "审查拒绝：不代为执行整目录、通配符或磁盘级删除";
  if (DIRECT_FILE_MUTATION.test(scanned.syntax) && REVIEW_SYSTEM_PATH.test(writeScanText(scanned)))
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
  const win = platform === "win32",
    text = withoutExeDir(raw, win),
    scanned = shellText(text, win ? "powershell" : "posix"),
    forbidden = forbiddenWhy(scanned, "宽");
  if (forbidden) return `沙箱拒绝：${forbidden}`;
  if (DIRECT_FILE_MUTATION.test(scanned.syntax) && REVIEW_SYSTEM_PATH.test(writeScanText(scanned)))
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
