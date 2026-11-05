// 言 · 桥接 · 执事的文字：文本文件的编码认读与写回、PowerShell 的编码指令与 CLIXML 报错还原、截尾、数行、对不上时找最像的一段。纯函数
"use strict";
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
// 认得出的都解成文字，真是二进制（没有 BOM 却有 NUL）才回 null。UTF-8 里夹着零星几个坏字节的仍按 UTF-8 读，不整篇改按 GBK 读成乱码
function decodeText(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf-16le" };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2, 2 + ((buffer.length - 2) & ~1)));
    return { text: body.swap16().toString("utf16le"), encoding: "utf-16be" };
  }
  if (buffer.subarray(0, 4096).includes(0)) return null;
  const text = buffer.toString("utf8"),
    bad = (text.match(/�/g) || []).length;
  if (!bad || bad < text.length / 100) return { text, encoding: "utf-8" };
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

// 两版的逐行增删：先切掉首尾相同的行，中段求最长公共子序列（放得下就细比，放不下整块当作一删一增）。
// 's' 未改、'd' 旧有、'i' 新有，次序照文件走
function lineOps(a, b) {
  let start = 0,
    endA = a.length,
    endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const ops = [];
  for (let i = 0; i < start; i++) ops.push(["s", a[i]]);
  const m = endA - start,
    n = endB - start;
  if (m && n && m * n <= 250000) {
    // 回溯要整张表：两边各五百行以内放得下
    const width = n + 1,
      table = new Uint32Array((m + 1) * width);
    for (let i = 1; i <= m; i++) {
      const line = a[start + i - 1],
        row = i * width,
        up = row - width;
      for (let j = 1; j <= n; j++)
        table[row + j] = line === b[start + j - 1] ? table[up + j - 1] + 1 : Math.max(table[up + j], table[row + j - 1]);
    }
    const back = [];
    let i = m,
      j = n;
    while (i && j) {
      if (a[start + i - 1] === b[start + j - 1]) back.push(["s", a[start + --i]]), j--;
      else if (table[(i - 1) * width + j] >= table[i * width + j - 1]) back.push(["d", a[start + --i]]);
      else back.push(["i", b[start + --j]]);
    }
    while (i) back.push(["d", a[start + --i]]);
    while (j) back.push(["i", b[start + --j]]);
    ops.push(...back.reverse());
  } else {
    for (let i = start; i < endA; i++) ops.push(["d", a[i]]);
    for (let j = start; j < endB; j++) ops.push(["i", b[j]]);
  }
  for (let i = endA; i < a.length; i++) ops.push(["s", a[i]]);
  return ops;
}
// 覆盖写一份文件时，改动要给人看全：整份存不下就按改动取，两侧各留改动连同前后各 context 行。
// 不这么取、只留开头 N 字的话，改在文件后头时两侧的开头一模一样，并排一比成了「什么都没改」，
// 末尾那句「其后 N 字未留存」的字数反倒成了唯一的改动。两侧取自同一批窗口，页面照旧逐行比。
// 每侧不超过 limit 字：窗口多得放不下就舍掉后头的，并写明还剩几处
function changeExcerpts(oldText, newText, { context = 3, limit = 20000 } = {}) {
  const a = String(oldText ?? "").split(/\r?\n/),
    b = String(newText ?? "").split(/\r?\n/),
    ops = lineOps(a, b);
  // 改动在 ops 里的区间，前后各带 context 行未改的；挨上的并成一块
  const ranges = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k][0] === "s") continue;
    let end = k;
    while (end < ops.length && ops[end][0] !== "s") end++;
    const from = Math.max(0, k - context),
      to = Math.min(ops.length, end + context),
      last = ranges.at(-1);
    if (last && from <= last[1]) last[1] = to;
    else ranges.push([from, to]);
    k = end - 1;
  }
  if (!ranges.length) return { old: "", new: "", hunks: 0, omitted: 0 };
  // 这一段里两侧各自的行（未改的两边都有）
  const cut = (from, to) => {
    const oldLines = [],
      newLines = [];
    for (let k = from; k < to; k++) {
      if (ops[k][0] !== "i") oldLines.push(ops[k][1]);
      if (ops[k][0] !== "d") newLines.push(ops[k][1]);
    }
    return { oldLines, newLines };
  };
  const oldOut = [],
    newOut = [];
  const size = lines => lines.reduce((n, line) => n + line.length + 1, 0);
  let from = 0,
    omitted = 0;
  for (let index = 0; index < ranges.length; index++) {
    const [start, end] = ranges[index],
      part = cut(start, end),
      // 段与段之间跳过的都是未改的行，两侧同样多，写同一句话，并排看过去对得上
      skipped = start > from && oldOut.length ? [`…（跳过 ${start - from} 行未改）`] : [],
      oldNext = [...skipped, ...part.oldLines],
      newNext = [...skipped, ...part.newLines];
    if (oldOut.length && (size(oldOut) + size(oldNext) > limit || size(newOut) + size(newNext) > limit)) {
      omitted = ranges.length - index;
      break;
    }
    oldOut.push(...oldNext);
    newOut.push(...newNext);
    from = end;
  }
  // 头一块就超了 limit：留它，截到 limit 字，说明停在哪
  const clip = lines => {
    if (size(lines) <= limit) return lines;
    const out = [];
    let used = 0;
    for (const line of lines) {
      if (used + line.length + 1 > limit) break;
      out.push(line);
      used += line.length + 1;
    }
    out.push(`…（这一处改动太长，只列到这里）`);
    return out;
  };
  if (omitted) {
    const note = `…（另有 ${omitted} 处改动未列）`;
    oldOut.push(note);
    newOut.push(note);
  }
  return { old: clip(oldOut).join("\n"), new: clip(newOut).join("\n"), hunks: ranges.length, omitted };
}

module.exports = {
  tail,
  encodePowerShell,
  decodeClixml,
  decodeText,
  encodeText,
  countLines,
  lineDiffCounts,
  changeExcerpts,
  nearestPassage
};
