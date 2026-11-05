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

// 按行切开：末尾的换行不算多出一行空行（与 countLines 同一惯例），空的就是没有行
function splitLines(text) {
  const value = String(text ?? "");
  return value ? value.replace(/\r?\n$/, "").split(/\r?\n/) : [];
}
// 覆盖写一份文件时，前后两版按行比出各增删几行。与预览、与页面同一套比法（见 lineOps），清单和红绿才对得上
function lineDiffCounts(oldText, newText) {
  let added = 0,
    removed = 0;
  for (const [kind] of lineOps(splitLines(oldText), splitLines(newText))) {
    if (kind === "i") added++;
    else if (kind === "d") removed++;
  }
  return { added, removed };
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

// 两版的逐行编辑脚本：'s' 未改、'd' 旧有、'i' 新有，次序照文件走。中段走 Myers 的 O(ND) 比法：
// 耗时与内存跟着改动量走，不跟文件有多长走——改在文件后头、两处改动隔着一千行，也只比改动那一点。
// 改动多到超过 maxD 步、文件又不大时照旧用表比（见 myersOps 的 dpOps）；再大才整块一删一增。
// 页面的 lcsOps 是同一套（src/15-tools/22-changes.js）
function lineOps(a, b, maxD = 1000) {
  const ops = [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) ops.push(["s", a[head++]]);
  let endA = a.length,
    endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const middle = myersOps(a.slice(head, endA), b.slice(head, endB), maxD);
  if (middle) for (const op of middle) ops.push(op);
  else {
    for (let i = head; i < endA; i++) ops.push(["d", a[i]]);
    for (let j = head; j < endB; j++) ops.push(["i", b[j]]);
  }
  for (let i = endA; i < a.length; i++) ops.push(["s", a[i]]);
  return ops;
}
// Myers 的最短编辑脚本：一步一条斜线，走一步记下这一步各条斜线到了哪，走到头再照记录退回来。
// 超过 maxD 步（改动太多，细比不如整块看）时，文件不大（两版行数之积在千六百万以内，与旧法同一个上限）
// 就照旧用表比（dpOps），精确到每一行；再大才返回 null，由 lineOps 整块一删一增
// 回溯只按记下的那份走，不把整串摊进 push 的参数里——十万行的整块改写也不会撑爆调用栈
function myersOps(x, y, maxD) {
  const n = x.length,
    m = y.length,
    ops = [];
  if (!n || !m) {
    for (const line of x) ops.push(["d", line]);
    for (const line of y) ops.push(["i", line]);
    return ops;
  }
  const max = n + m + 1,
    at = max,
    v = new Int32Array(2 * max + 1),
    trace = [];
  let found = -1;
  for (let d = 0; d <= Math.min(maxD, n + m); d++) {
    // 这一步开始前各斜线到哪：只留 k ∈ [-d-1, d+1] 这一段，回溯时够用
    trace.push(v.slice(at - d - 1, at + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let px = k === -d || (k !== d && v[at + k - 1] < v[at + k + 1]) ? v[at + k + 1] : v[at + k - 1] + 1,
        py = px - k;
      while (px < n && py < m && x[px] === y[py]) px++, py++;
      v[at + k] = px;
      if (px >= n && py >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return n * m <= 16e6 ? dpOps(x, y) : null;
  /** @type {Array<[string, string]>} */
  const back = [];
  let px = n,
    py = m;
  for (let d = found; d > 0; d--) {
    const row = trace[d],
      k = px - py,
      prevK = k === -d || (k !== d && row[k + d] < row[k + d + 2]) ? k + 1 : k - 1,
      prevX = row[prevK + d + 1],
      prevY = prevX - prevK;
    while (px > prevX && py > prevY) {
      back.push(["s", x[--px]]);
      py--;
    }
    if (px === prevX) back.push(["i", y[--py]]);
    else back.push(["d", x[--px]]);
  }
  while (px > 0) back.push(["d", x[--px]]);
  while (py > 0) back.push(["i", y[--py]]);
  return back.reverse();
}
// 改动多到 Myers 走不完、文件又不大时照旧用表比：一张 (n+1)×(m+1) 的最长公共子序列表，从头退回来。
// 两版行数之积在千六百万以内才进得来（与旧法同一个上限），4000×4000 约三十来兆、一两百毫秒；
// 再大表装不下，由 lineOps 整块一删一增。改动少时不会走到这里——那时 Myers 快得多
function dpOps(x, y) {
  const n = x.length,
    m = y.length,
    dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  /** @type {Array<[string, string]>} */
  const ops = [];
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      ops.push(["s", x[i++]]);
      j++;
    } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) ops.push(["d", x[i++]]);
    else ops.push(["i", y[j++]]);
  }
  return ops;
}
// 覆盖写一份文件时，改动要给人看全：按改动取，每处连同前后各 context 行。只存旧侧的行——
// 新的一侧整份还在这一步的参数（step.arguments）里，页面画的时候从那儿取，不另存第二份。
// 每块记下两侧的行号：页面按号取新侧、按号写「跳过 N 行未改」。不设字数上限，改动一处不落
function changeHunks(oldText, newText, { context = 3 } = {}) {
  const a = splitLines(oldText),
    b = splitLines(newText),
    ops = lineOps(a, b),
    oldAt = new Int32Array(ops.length + 1),
    newAt = new Int32Array(ops.length + 1);
  let added = 0,
    removed = 0;
  for (let k = 0; k < ops.length; k++) {
    const kind = ops[k][0];
    oldAt[k + 1] = oldAt[k] + (kind === "i" ? 0 : 1);
    newAt[k + 1] = newAt[k] + (kind === "d" ? 0 : 1);
    if (kind === "i") added++;
    else if (kind === "d") removed++;
  }
  // 改动在 ops 里的区间，前后各带 context 行未改的；挨上的并成一块
  const ranges = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k][0] === "s") continue;
    let end = k;
    while (end < ops.length && ops[end][0] !== "s") end++;
    const from = Math.max(0, k - context),
      to = Math.min(ops.length, end + context),
      last = ranges.at(-1);
    if (last && from <= last.to) last.to = to;
    else ranges.push({ from, to });
    k = end - 1;
  }
  const rows = [],
    hunks = ranges.map(({ from, to }) => {
      for (let k = from; k < to; k++) if (ops[k][0] !== "i") rows.push(ops[k][1]);
      return {
        oldStart: oldAt[from],
        newStart: newAt[from],
        oldCount: oldAt[to] - oldAt[from],
        newCount: newAt[to] - newAt[from]
      };
    });
  return { hunks, old: rows.join("\n"), added, removed };
}

module.exports = {
  tail,
  encodePowerShell,
  decodeClixml,
  decodeText,
  encodeText,
  countLines,
  splitLines,
  lineDiffCounts,
  changeHunks,
  nearestPassage
};
