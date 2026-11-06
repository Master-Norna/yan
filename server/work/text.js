// 言 · 桥接 · 执事的文字：文本文件的编码认读与写回、PowerShell 的编码指令与 CLIXML 报错还原、截尾、数行、对不上时找最像的一段。纯函数
"use strict";
const { isUtf8 } = require("node:buffer");
const { decodeEntities } = require("../web.js");

function tail(text, limit) {
  return text.length > limit ? `…（前面 ${text.length - limit} 字已省略）\n${text.slice(-limit)}` : text;
}
// PowerShell 脚本一律走 -EncodedCommand（UTF-16LE base64）：引号、换行、$ 符号都不经过命令行解析
function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}
// stderr 被重定向时，PowerShell 会把错误记录序列化成 CLIXML（#< CLIXML <Objs>…）；还原成纯文字，模型与步骤卡看到的都是可读的报错
function decodeClixml(text) {
  if (!text.includes("#< CLIXML") && !text.includes('<S S="Error">')) return text;
  const unescape = value => decodeEntities(value).replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const errorsOf = block => [...block.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map(match => unescape(match[1])).join("");
  return text
    .replace(/#< CLIXML\r?\n?<Objs[\s\S]*?<\/Objs>/g, errorsOf)
    .replace(/<Obj S="progress"[\s\S]*?<\/Obj>/g, "")
    .replace(/<S S="Error">([\s\S]*?)<\/S>/g, (_, body) => unescape(body))
    .replace(/#< CLIXML\r?\n?|<\/?Objs[^>]*>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}
// 文本文件的编码：UTF-8（可带 BOM）为常；Windows PowerShell 5.1 的 > 与 Out-File 写出的是带 BOM 的 UTF-16LE，老的中文文件多是 GBK。
// 认得出的都解成文字，真是二进制（没有 BOM 却有 NUL）才回 null。UTF-8 里夹着零星几个坏字节的仍按 UTF-8 读，不整篇改按 GBK 读成乱码。
// 严格合法的 UTF-8 直接留下——文件里本来就写着 U+FFFD 时那是真内容，不是坏字节，不能拿它当好坏的证据。
// 只有真的解不成 UTF-8 才进判据：在解出来的非 ASCII 字里比好坏，坏字节解成的 U+FFFD 比好字少，就还是 UTF-8。
// 按比例两头都会错：短文件末字断一个字节（二十个汉字里一个坏）就过百分之一，整篇被当成 GBK 读成乱码；
// 反过来以 ASCII 为主、只夹几个 GBK 汉字的老文件，坏字节占比不到百分之一，汉字却全成了 U+FFFD。
// 比好坏两边都不吃亏：一处断口只出一个 U+FFFD，好字却是成篇的；真是 GBK 的「你好」按 UTF-8 解出三个 U+FFFD、一个好字也没有，判 GBK。
// 好字按字节数记：三字节以上的字记一个，两字节的字（希腊、西里尔这段）记半个——GBK 被误读时凑巧配上对的几乎都是两字节序列，
// 真 UTF-8 的中文是三个字节。这样「系统信息」这类短 GBK 句不会因为配上几对两字节字就被判成 UTF-8
function decodeText(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf-16le" };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2, 2 + ((buffer.length - 2) & ~1)));
    return { text: body.swap16().toString("utf16le"), encoding: "utf-16be" };
  }
  if (buffer.subarray(0, 4096).includes(0)) return null;
  const text = buffer.toString("utf8");
  if (isUtf8(buffer)) return { text, encoding: "utf-8" };
  let bad = 0,
    good = 0;
  for (const char of text) {
    if (char === "\uFFFD") bad++;
    else if (char >= "\u0800") good++;
    else if (char > "\u007f") good += 0.5;
  }
  if (bad < good) return { text, encoding: "utf-8" };
  return { text: new TextDecoder("gb18030").decode(buffer), encoding: "gbk" };
}
// 按原来的编码写回；GBK 编不回去（Node 只会编 UTF-8 / UTF-16），给 null，由调用者拒绝
function encodeText(text, encoding) {
  if (encoding === "utf-8") return Buffer.from(text, "utf8");
  if (encoding === "utf-8-bom") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
  if (encoding === "utf-16le") return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  if (encoding === "utf-16be") return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]);
  return null;
}
// 行数按惯例：末尾的换行不算多一行（"a\nb\n" 是 2 行），空文件 0 行
function countLines(text) {
  const value = String(text || "");
  if (!value) return 0;
  return value.split(/\r?\n/).length - (/\r?\n$/.test(value) ? 1 : 0);
}

// 覆盖写一份文件时，前后两版按行比出各增删几行：先去掉首尾相同的行，中段求最长公共子序列（只留两行表，省内存）；
// 中段太大（两边行数之积过千六百万）就不细比，中段整算一删一增
function lineDiffCounts(oldText, newText) {
  const lines = text =>
      text
        ? String(text)
            .replace(/\r?\n$/, "")
            .split(/\r?\n/)
        : [],
    a = lines(oldText),
    b = lines(newText);
  let start = 0,
    endA = a.length,
    endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const m = endA - start,
    n = endB - start;
  if (!m || !n || m * n > 16e6) return { added: n, removed: m };
  let prev = new Uint32Array(n + 1),
    row = new Uint32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    const line = a[start + i - 1];
    for (let j = 1; j <= n; j++) row[j] = line === b[start + j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    [prev, row] = [row, prev];
  }
  return { added: n - prev[n], removed: m - prev[n] };
}

// edit_file 的 old 对不上时：文件里最像它的那一段，照现在的样子带行号交回。
// 拿 old 的每一行（去掉首尾空白）到文件里找同样的行，各自推出「old 若从这里开始」的起点，起点得票最多的那段即是；
// 太短的行（}、else:、空行）满文件都是，不投票，除非 old 里只有这种行。票太少（多行的 old 只对上一行）的不算像，宁可不给
function nearestPassage(source, oldText, { context = 1, maxLines = 60 } = {}) {
  const lines = String(source).split(/\r?\n/),
    want = String(oldText).split(/\r?\n/),
    keyed = want.map((line, k) => ({ k, text: line.trim() })).filter(item => item.text);
  if (!keyed.length) return "";
  const strong = keyed.filter(item => item.text.length >= 8),
    voters = strong.length ? strong : keyed;
  const at = new Map();
  lines.forEach((line, i) => {
    const text = line.trim();
    if (!text) return;
    const seen = at.get(text);
    if (seen) seen.push(i);
    else at.set(text, [i]);
  });
  const votes = new Map();
  for (const { k, text } of voters) for (const i of at.get(text) || []) votes.set(i - k, (votes.get(i - k) || 0) + 1);
  let best = null,
    score = 0;
  for (const [start, count] of votes) if (count > score || (count === score && start < best)) [best, score] = [start, count];
  if (best === null || score < Math.min(2, voters.length)) return "";
  const from = Math.max(0, best - context),
    to = Math.min(lines.length, best + want.length + context, from + maxLines),
    width = String(to).length;
  return lines
    .slice(from, to)
    .map((line, i) => `${String(from + i + 1).padStart(width)}│${line}`)
    .join("\n");
}

module.exports = { tail, encodePowerShell, decodeClixml, decodeText, encodeText, countLines, lineDiffCounts, nearestPassage };
