// 言 · 改动与成品：执事这一答改过哪些文件（改动条），这一答交给人看的是哪几件（成品条）
// 改动摘要：这一答里执事改过哪些文件、各增减多少行。生成中附在输入框上的工作条里实时累加（见 renderHelperBar），
// 不跟着正文尾巴跑；写完才落到回复之下，是一道线而不是一只框（见 设计稿/12-改动条与行迹）
// 按行切开：末尾的换行不算多出一行空行（与桥接的 countLines 同一惯例），空的就是没有行
const diffLines = text =>
  text
    ? String(text)
        .replace(/\r?\n$/, "")
        .split(/\r?\n/)
    : [];
// 增删各几行：与点开看的红绿同一套切法、同一套比法，两边对得上
function diffCounts(oldText, newText) {
  const ops = lcsOps(diffLines(oldText), diffLines(newText));
  return { added: ops.filter(op => op[0] === "i").length, removed: ops.filter(op => op[0] === "d").length };
}
/** @param {{ steps?: Step[] }} message */
function changeStats(message) {
  const files = new Map();
  for (const step of allSteps(message)) {
    if (!step.change || step.status !== "done") continue;
    const entry = files.get(step.change.path) || {
      path: step.change.path,
      added: 0,
      removed: 0,
      created: false,
      helper: false,
      lines: undefined
    };
    entry.added += step.change.added;
    entry.removed += step.change.removed;
    entry.created ||= !!step.change.created;
    entry.helper ||= !!step.scope;
    // 早先记下的步骤没有 lines；整份写入那一步的增即是写后的行数
    entry.lines = step.change.lines ?? (step.written !== undefined ? step.change.added : undefined);
    files.set(step.change.path, entry);
  }
  // 这一答里新建的件，净改动就是「增了它现在这么多行」：中途重写几遍删去的，是删自己刚写的，不算删
  for (const entry of files.values())
    if (entry.created && entry.lines !== undefined) {
      entry.added = entry.lines;
      entry.removed = 0;
    }
  const list = [...files.values()];
  return { files: list, added: list.reduce((sum, f) => sum + f.added, 0), removed: list.reduce((sum, f) => sum + f.removed, 0) };
}
// 增删的比例画成五枚小方块：绿的是增、朱的是删，余下留白
function changeSpark(added, removed) {
  const total = added + removed,
    green = total ? Math.round((5 * added) / total) : 0,
    red = total ? Math.min(5 - green, Math.round((5 * removed) / total)) : 0;
  return `<span class="change-spark" aria-hidden="true">${'<i class="g"></i>'.repeat(green)}${'<i class="r"></i>'.repeat(red)}${"<i></i>".repeat(5 - green - red)}</span>`;
}
function changeCountHtml(stats) {
  return `<span class="ins">+${stats.added}</span> <span class="del">−${stats.removed}</span>`;
}
// 清单一件一行：目录淡、文件名浓，新建 / 帮手所改的小注，增删行数（为零的不着色）；点一行看这件的改动
function changeFilesHtml(stats, open, extra = "") {
  return `<div class="change-files${extra}${open ? "" : " hidden"}">${stats.files
    .map((f, i) => {
      const tags = [f.created ? t("新建") : "", f.helper ? t("帮手") : ""].filter(Boolean).join(" · "),
        cut = f.path.lastIndexOf("/") + 1;
      return `<button type="button" data-change-path="${escapeHtml(f.path)}" title="${t`看 ${escapeHtml(f.path)} 的改动`}" style="--i:${Math.min(i, 12)}"><span class="path">${cut ? `<span class="dir">${escapeHtml(f.path.slice(0, cut))}</span>` : ""}${escapeHtml(f.path.slice(cut))}${tags ? `<em>${tags}</em>` : ""}</span><span class="ins${f.added ? "" : " zero"}">+${f.added}</span><span class="del${f.removed ? "" : " zero"}">−${f.removed}</span></button>`;
    })
    .join("")}</div>`;
}
// ---- 并排红绿：旧在左、新在右，逐行对齐（见 设计稿/38、39） ----
// 行迹里改一处的旧段与新段、预览浮层里覆盖写的前后两版，都走这一套
const MAX_EDITS = 1000;
/**
 * 两列的编辑脚本：摊成一串 s（同）/ d（删）/ i（增），次序照原样；两样都行时先删后增。
 * 首尾相同的先剥掉再比：逐个比时遇到相同的就配上，一句话中间插进一段，开头那个「不」会被配到插进来的那段里去，配歪了。
 * 中段走 Myers 的 O(ND) 比法：耗时与内存跟着改动量走，不跟有多长走——两处改动隔着一千行、改在文件后头，也只比改动那一点。
 * 桥接那头是同一套（server/work/text.js 的 lineOps），清单与红绿才对得上。超过 MAX_EDITS 步才退成整块一删一增
 * @param {string[]} a @param {string[]} b
 */
function lcsOps(a, b) {
  /** @type {Array<[string, string]>} */
  const ops = [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) ops.push(["s", a[head++]]);
  let endA = a.length,
    endB = b.length;
  while (endA > head && endB > head && a[endA - 1] === b[endB - 1]) endA--, endB--;
  const middle = myersOps(a.slice(head, endA), b.slice(head, endB));
  if (middle) for (const op of middle) ops.push(op);
  else {
    for (let i = head; i < endA; i++) ops.push(["d", a[i]]);
    for (let j = head; j < endB; j++) ops.push(["i", b[j]]);
  }
  for (let i = endA; i < a.length; i++) ops.push(["s", a[i]]);
  return ops;
}
// Myers 的最短编辑脚本：一步一条斜线，走一步记下这一步各条斜线到了哪，走到头再照记录退回来。
// 不把整串摊进 push 的参数里（十万行的整块改写会撑爆调用栈）；超步数上限就返回 null，由 lcsOps 整块一删一增
/** @param {string[]} x @param {string[]} y @returns {Array<[string, string]> | null} */
function myersOps(x, y) {
  const n = x.length,
    m = y.length;
  /** @type {Array<[string, string]>} */
  const ops = [];
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
  for (let d = 0; d <= Math.min(MAX_EDITS, n + m); d++) {
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
  if (found < 0) return null;
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
// 行内按词比：英文数字连成一词，汉字与标点逐个
const diffTokens = (/** @type {string} */ line) => line.match(/[A-Za-z0-9_$]+|\s+|[^\sA-Za-z0-9_$]/gu) || [];
// 两行共同的首尾各有多长（字符级）：几万字一行时只靠这个认「改的是一处，不是整行换掉」
function commonEnds(a, b) {
  let head = 0;
  const min = Math.min(a.length, b.length);
  while (head < min && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < min - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { head, tail };
}
// 两行像不像：去掉空白后同词占四成以上才算「改了这一行」，否则是删一行、另增一行。
// 一行几万字的没法逐词比，按共同的首尾占多少认
function linesAlike(a, b) {
  if (a.length > LONG_LINE || b.length > LONG_LINE) {
    const { head, tail } = commonEnds(a, b);
    return (head + tail) * 2 >= Math.max(a.length, b.length);
  }
  const x = diffTokens(a).filter(t => t.trim()),
    y = diffTokens(b).filter(t => t.trim());
  if (!x.length || !y.length || x.length * y.length > 40000) return false;
  return (2 * lcsOps(x, y).filter(op => op[0] === "s").length) / (x.length + y.length) >= 0.4;
}
// 一行几万字（压缩的 JSON、一行到底的日志）：不逐词比，只找共同的首尾，把改动那一小段露出来，其余折成「…（前 N 字略）」。
// 不这么折，整行八万字摊进 HTML，改在末尾也等于是没看见。相似不到一半的就返回 null：整删整增比硬配清楚
const LONG_LINE = 2000,
  LONG_PAD = 80,
  LONG_MOST = 400;
function longMarks(oldLine, newLine) {
  const { head, tail } = commonEnds(oldLine, newLine);
  if ((head + tail) * 2 < Math.max(oldLine.length, newLine.length)) return null;
  const part = text => {
    if (text.length <= LONG_MOST) return escapeHtml(text);
    const half = LONG_MOST >> 1;
    return `${escapeHtml(text.slice(0, half))}<span class="elide">…（中间 ${text.length - LONG_MOST} 字略）</span>${escapeHtml(text.slice(-half))}`;
  };
  const side = line => {
    const pre = head > LONG_PAD ? `…（前 ${head - LONG_PAD} 字略）` : "",
      post = tail > LONG_PAD ? `…（后 ${tail - LONG_PAD} 字略）` : "",
      before = line.slice(Math.max(0, head - LONG_PAD), head),
      after = line.slice(line.length - tail, line.length - tail + LONG_PAD);
    return `${escapeHtml(pre)}${escapeHtml(before)}<mark>${part(line.slice(head, line.length - tail))}</mark>${escapeHtml(after)}${escapeHtml(post)}`;
  };
  return [side(oldLine), side(newLine)];
}
// 配上对的两行：改了的那几个字包进 <mark>。逐词比出来的常是碎片——夹在两处改动之间的一两个字、一个标点也被挖成「没改」，
// 中文改一句就成了满行的碎块，所以这样的小缝并进改动里（只标真有改动的那一侧：只插了字的，旧的那侧不因并进的小缝挂上标记）。
// 两边都改了大半的，不再逐字标：整行本就是红 / 绿的，满行的标记只是噪声
function wordMarks(oldLine, newLine) {
  const plain = [escapeHtml(oldLine), escapeHtml(newLine)];
  if (oldLine.length > LONG_LINE || newLine.length > LONG_LINE) return longMarks(oldLine, newLine) || plain;
  const a = diffTokens(oldLine),
    b = diffTokens(newLine);
  if (a.length * b.length > 40000) return plain;
  /** @type {Array<{ same: boolean, old: string, new: string, cut: boolean, put: boolean }>} 同与改交替的几段；cut / put：这段里旧的那侧真删了、新的那侧真增了 */
  const runs = [];
  for (const [kind, text] of lcsOps(a, b)) {
    const same = kind === "s";
    if (runs.at(-1)?.same !== same) runs.push({ same, old: "", new: "", cut: false, put: false });
    const run = runs[runs.length - 1];
    if (kind !== "i") run.old += text;
    if (kind !== "d") run.new += text;
    run.cut ||= kind === "d";
    run.put ||= kind === "i";
  }
  /** @type {typeof runs} */
  const merged = [];
  runs.forEach((run, k) => {
    const seam = run.same && k > 0 && k < runs.length - 1 && run.old.replace(/\s/g, "").length <= 2,
      last = merged.at(-1);
    if ((seam || !run.same) && last && !last.same) {
      last.old += run.old;
      last.new += run.new;
      last.cut ||= run.cut;
      last.put ||= run.put;
    } else merged.push({ ...run, same: run.same && !seam });
  });
  const marked = (/** @type {typeof runs[number]} */ run, /** @type {"old"|"new"} */ side) =>
    !run.same && (side === "old" ? run.cut : run.put);
  const share = (/** @type {"old"|"new"} */ side, /** @type {string} */ line) =>
    merged.filter(run => marked(run, side)).reduce((n, run) => n + run[side].replace(/\s/g, "").length, 0) /
    (line.replace(/\s/g, "").length || 1);
  if (Math.min(share("old", oldLine), share("new", newLine)) > 0.5) return plain;
  // 标记不含两头的空白：对齐注释的那串空格跟着变长变短，标上了只是一截截空的色块
  const mark = (/** @type {string} */ text) => {
    const [, lead, body, trail] = /** @type {RegExpMatchArray} */ (text.match(/^(\s*)([\s\S]*?)(\s*)$/));
    return body ? `${escapeHtml(lead)}<mark>${escapeHtml(body)}</mark>${escapeHtml(trail)}` : escapeHtml(text);
  };
  const html = (/** @type {"old"|"new"} */ side) =>
    merged.map(run => (marked(run, side) ? mark(run[side]) : escapeHtml(run[side]))).join("");
  return [html("old"), html("new")];
}
// 一段连着的删与增怎么排：按先后，删的那行往后找第一行像它的配成一对。
// 两对之间落单的删与跳过的增左右并进同几行（loose，不逐字比）——各占一行会排成台阶，一边一块空洞。
// 只在往后 PAIR_WINDOW 行里找：改动块里要认亲的本来就在近旁，翻遍整块是平方的代价（几十万行的整块改写会卡死）
const PAIR_WINDOW = 50;
/** @param {string[]} dels @param {string[]} ins */
function pairLines(dels, ins) {
  /** @type {Array<{ d?: string, i?: string, loose?: boolean }>} */
  const out = [];
  /** @type {string[]} */
  let lone = [];
  let j = 0;
  const flush = (/** @type {number} */ until) => {
    const skipped = ins.slice(j, until);
    for (let k = 0; k < Math.max(lone.length, skipped.length); k++) out.push({ d: lone[k], i: skipped[k], loose: true });
    lone = [];
    j = until;
  };
  for (const d of dels) {
    let hit = -1;
    const until = Math.min(ins.length, j + PAIR_WINDOW);
    for (let k = j; k < until; k++)
      if (linesAlike(d, ins[k])) {
        hit = k;
        break;
      }
    if (hit < 0) {
      lone.push(d);
      continue;
    }
    flush(hit);
    out.push({ d, i: ins[j++] });
  }
  flush(ins.length);
  return out;
}
/**
 * 前后两版比出并排的各行：成片未动的只留改动上下各两行，两处改动之间隔一道丝线、不写跳过几行（本就只列变化）；两边共有的缩进一起去掉。
 * limit 只画前几行（行迹里先看前 20 行，「展开全部」再看全），比对总按全文来——先截后比会把截掉的行当成删了。
 * wrap 为假时一行放不下只放写得下的，末尾省略、悬停看整行（行迹里一步不该被一行长注释撑成半屏）；预览浮层与展开全部时照常折行。
 * all 为真时一行也不省：摘录里本来就只留改动上下几行，那句「跳过 N 行未改」也得画出来（见 changeDiffHtml）。
 * 比法按改动量走（见 lcsOps）：两处改动隔着一千行、改在文件后头，都不会退成一整块红一整块绿；改动多到超过上限才整块一删一增，
 * 也是逐行画，limit 与「展开全部」照常
 * @param {string} oldText @param {string} newText @param {{ limit?: number, wrap?: boolean, all?: boolean }} [options]
 * @returns {{ html: string, rows: number, clipped: boolean, added: number, removed: number }}
 */
function splitDiffHtml(oldText, newText, { limit = Infinity, wrap = true, all = false } = {}) {
  let a = diffLines(oldText),
    b = diffLines(newText);
  // 两边共有的缩进一起去掉（一行一行找，不摊成参数：十几万行的文件会撑爆调用栈）
  let lead = Infinity;
  const indentOf = line => (line.trim() ? line.match(/^ */)[0].length : Infinity);
  for (const line of a) lead = Math.min(lead, indentOf(line));
  for (const line of b) lead = Math.min(lead, indentOf(line));
  if (Number.isFinite(lead) && lead > 0) [a, b] = [a, b].map(lines => lines.map(line => line.slice(Math.min(lead, line.length))));
  const ops = lcsOps(a, b),
    near = all
      ? null
      : ops.map((_, k) => {
          for (let i = Math.max(0, k - 2), end = Math.min(ops.length, k + 3); i < end; i++) if (ops[i][0] !== "s") return true;
          return false;
        });
  let added = 0,
    removed = 0;
  for (const [kind] of ops) {
    if (kind === "i") added++;
    else if (kind === "d") removed++;
  }
  /** @type {string[]} */
  const rows = [];
  // 行数另有计数：limit 之外的行不再拼 HTML（整块改写几十万行，拼出来也没人看，白占内存）
  let total = 0,
    skipped = 0;
  const pushRow = (/** @type {string} */ row) => {
    total++;
    if (rows.length < limit) rows.push(row);
  };
  const gap = () => {
    if (!all && skipped && total) pushRow(`<span class="gap"></span>`);
    skipped = 0;
  };
  const titleOf = raw => (raw.length > LONG_LINE ? `${raw.slice(0, LONG_LINE)}…` : raw);
  const cell = (kind, html, raw = "") =>
    html === null
      ? `<span class="e"></span>`
      : `<span class="${kind}${kind === "s" && raw.startsWith("…（") ? " hint" : ""}"${!wrap && raw.length > 30 ? ` title="${escapeHtml(titleOf(raw))}"` : ""}>${html || " "}</span>`;
  // 没配上对的长行：只写开头一段；配过对的走 wordMarks 的折叠（改动那一段留着）
  const shownLine = raw =>
    raw.length > LONG_LINE
      ? `${escapeHtml(raw.slice(0, LONG_MOST))}<span class="elide">…（${raw.length - LONG_MOST} 字略）</span>`
      : escapeHtml(raw);
  for (let k = 0; k < ops.length; ) {
    if (ops[k][0] === "s") {
      if (!all && !near[k]) skipped++;
      else {
        gap();
        pushRow(cell("s", escapeHtml(ops[k][1]), ops[k][1]).repeat(2));
      }
      k++;
      continue;
    }
    gap();
    const dels = [],
      ins = [];
    while (k < ops.length && ops[k][0] !== "s") (ops[k][0] === "d" ? dels : ins).push(ops[k++][1]);
    // 整块一删一增（改动多到超过比法上限）：按先后左右并排，不逐行认亲——平方的代价，几十万行会卡死
    if (dels.length * ins.length > 40000) {
      for (let n = 0; n < Math.max(dels.length, ins.length); n++) {
        const d = dels[n],
          i = ins[n];
        pushRow(cell("d", d === undefined ? null : shownLine(d), d) + cell("i", i === undefined ? null : shownLine(i), i));
      }
      continue;
    }
    for (const { d, i, loose } of pairLines(dels, ins)) {
      const [left, right] =
        d !== undefined && i !== undefined && !loose
          ? wordMarks(d, i)
          : [d === undefined ? null : shownLine(d), i === undefined ? null : shownLine(i)];
      pushRow(cell("d", left, d) + cell("i", right, i));
    }
  }
  return {
    html: `<div class="tool-output split-diff${wrap ? "" : " clip"}">${rows.join("")}</div>`,
    rows: total,
    clipped: rows.length < total,
    added,
    removed
  };
}
// 写文件那一步写下的整份：就在这一步的参数里（见 src/15-tools/21-files.js），不另存第二份；取不到才是 null
/** @param {Step} step @returns {string|null} */
function writtenContent(step) {
  const parsed = parseToolArguments(step.arguments);
  return parsed.ok && typeof parsed.args.content === "string" ? parsed.args.content : null;
}
// 覆盖写那一步的改动：桥接只存了旧侧的行与两侧行号（见 server/work/text.js 的 changeHunks），
// 新的一侧整份在参数里，按行号切出同一批窗口，拼回来照旧逐行比；跳过未改的那几行两侧写同一句，并排看过去对得上
/** @param {Step} step @returns {{ old: string, new: string, all: boolean }|null} */
function hunksText(step) {
  const diff = step.diff;
  if (!diff || !("hunks" in diff) || !Array.isArray(diff.hunks) || !diff.hunks.length) return null;
  const hunks = diff.hunks;
  const content = writtenContent(step);
  if (content === null) return null;
  const b = diffLines(content),
    oldRows = step.diff.old ? step.diff.old.split("\n") : [],
    old = [],
    next = [];
  let cursor = 0,
    prevEnd = 0;
  for (const hunk of hunks) {
    const skip = hunk.oldStart - prevEnd;
    if (skip > 0) {
      const note = `…（跳过 ${skip} 行未改）`;
      old.push(note);
      next.push(note);
    }
    for (let i = 0; i < hunk.oldCount; i++) old.push(oldRows[cursor + i] ?? "");
    for (const line of b.slice(hunk.newStart, hunk.newStart + hunk.newCount)) next.push(line);
    cursor += hunk.oldCount;
    prevEnd = hunk.oldStart + hunk.oldCount;
  }
  return { old: old.join("\n"), new: next.join("\n"), all: true };
}
// 这一步该画的红绿：新格式（hunks）、旧格式（diff.old/new、written/previous）、改文件那步（参数里的前后两段）。
// 解析参数不便宜（一行到底的 JSON 也有几万字），按这一步的 diff 与参数原文记一份，重画时不必再解
/** @type {WeakMap<Step, { diff: unknown, arguments: string, parts: { old: string, new: string, all?: boolean }|null }>} */
const stepDiffCache = new WeakMap();
/** @param {Step} step @returns {{ old: string, new: string, all?: boolean }|null} */
function stepDiffParts(step) {
  const cached = stepDiffCache.get(step);
  if (cached && cached.diff === step.diff && cached.arguments === step.arguments) return cached.parts;
  const parts = stepDiffPartsOf(step);
  stepDiffCache.set(step, { diff: step.diff, arguments: step.arguments, parts });
  return parts;
}
function stepDiffPartsOf(step) {
  if (step.diff && "hunks" in step.diff) return hunksText(step);
  if (step.diff && typeof step.diff.old === "string" && typeof step.diff.new === "string")
    return { old: step.diff.old, new: step.diff.new };
  if (step.written !== undefined) return { old: step.previous ?? "", new: step.written };
  // 新建的件：没有旧的一版，写下的整份就是这一处改动（左边留空），与覆盖写同一种画法
  if (step.name === "write_file" && step.change?.created) {
    const content = writtenContent(step);
    if (content !== null) return { old: "", new: content };
  }
  if (step.name === "edit_file") {
    const parsed = parseToolArguments(step.arguments);
    if (parsed.ok && typeof parsed.args.old === "string" && typeof parsed.args.new === "string")
      return { old: parsed.args.old, new: parsed.args.new };
  }
  return null;
}
// 一件文件在这一答里的改动：不另起接口、不另存一份，用的就是各步本来记着的——改文件那步的参数（前后两段），
// 写文件那步的旧侧摘录与写下的整份；按先后排，摊在预览浮层里。帮手改的也在内。
// 这一答里新建的件只画最后那一版对空的多行：之前几版是草稿，与清单上「只增不删」对得上
/** @param {Message} message @param {string} path */
function changeDiffHtml(message, path) {
  let steps = allSteps(message).filter(step => step.change?.path === path && step.status === "done");
  const created = steps.some(step => step.change.created);
  if (created) {
    const lastWrite = steps.findLastIndex(step => step.name === "write_file" && writtenContent(step) !== null);
    if (lastWrite > 0) steps = steps.slice(lastWrite);
  }
  return `<div class="file-viewer-text change-diff">${steps
    .map(step => {
      const note = [toolLabel(step.name), step.scope ? t("帮手") : "", stepText(step.result || step.note)].filter(Boolean).join(" · "),
        head = `<p class="file-viewer-note">${escapeHtml(note)}</p>`,
        content = created && step.name === "write_file" ? writtenContent(step) : null;
      // 新建的件（或没记下原文的）也并排画：左边留空，与改动同一种画法，不一会儿整宽一会儿两栏
      if (content !== null) return `${head}<div class="tool-diff">${splitDiffHtml("", content, { all: true }).html}</div>`;
      const parts = stepDiffParts(step);
      if (!parts) return head;
      return `${head}<div class="tool-diff">${splitDiffHtml(parts.old, parts.new, { all: parts.all }).html}</div>`;
    })
    .join("")}</div>`;
}
/** @param {Message} message @param {string} path @param {Element} trigger */
function openChangeDiff(message, path, trigger) {
  showInFileViewer(t`${path} · 这一答的改动`, changeDiffHtml(message, path), trigger);
}
/** @param {Message} message */
function changeSummaryInner(message, open) {
  const stats = changeStats(message);
  if (!stats.files.length) return "";
  return `<button type="button" class="change-summary" aria-expanded="${open}"><span class="seal change-seal" aria-hidden="true">${t(`改`)}</span><span class="change-title">${t`改动 ${stats.files.length} 个文件`}</span><span class="change-count">${changeCountHtml(stats)}${changeSpark(stats.added, stats.removed)}</span></button>${changeFilesHtml(stats, open)}`;
}
// 成品：这一答的答复里链到的本机文件（模型写「[报告](报告.md)」「![图](图.png)」）。列哪几件由模型定：交给人看的核心文件才写成链接，
// 解压出的一堆、顺手改的代码不列，别的对话与人同时放进卷宗的也混不进来。收尾时按这段对话的落脚处认路（见 refTarget），
// 在的记下路与大小。存下的是相对的路：落在卷宗里的只记卷宗里的路，存储目录搬了家也认得；别处的另记所在的根。一件一行：件图、文件名、大小，右侧「预览」与「下载」
/** @param {Conversation} conversation @param {string} content @returns {Promise<Deliverable[]>} */
async function replyDeliverables(conversation, content) {
  /** @type {string[]} */
  const hrefs = [];
  marked.walkTokens(marked.lexer(String(content || "")), token => {
    if (token.type === "link" || token.type === "image") hrefs.push(token.href);
  });
  const anchor = messageAnchor(conversation),
    root = workRoot(conversation),
    seen = new Set();
  /** @type {Deliverable[]} */
  const files = [];
  for (const href of hrefs) {
    const name = localFileName(href),
      file = name ? refTarget(href, anchor)?.file : null;
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const head = await fetch(localFileUrl(file, true), { method: "HEAD" }).catch(() => null);
    if (!head?.ok) continue;
    const inArchive = archiveRel(file),
      inRoot = relInside(root, file);
    files.push({
      path: inArchive ?? inRoot ?? file.split("/").pop(),
      name: file.split("/").pop() || name,
      size: Number(head.headers.get("content-length")) || 0,
      ...(inArchive !== null ? {} : { root: inRoot !== null ? root : parentDir(file) })
    });
  }
  return files;
}
// 卷宗里已经删掉的成品：条目留着（这一答确实出过这件），但标成「已移出卷宗」，不再给看与下载的按钮。卷宗之外的认不出在不在，点了取不到再说
/** 存下的一件成品是哪件文件 @param {Deliverable} f */
function deliverableFile(f) {
  return f.root ? joinFile(f.root, f.path) : archiveFile(f.path);
}
/** @param {Deliverable} f */
function deliverableMissing(f) {
  return !f.root && archiveEntries !== null && !archiveEntries.some(entry => entry.path === f.path);
}
/** @param {Deliverable} f */
function deliverableFileHtml(f, extra = false) {
  const missing = deliverableMissing(f);
  return `<div class="deliver-file${missing ? " missing" : ""}${extra ? " extra" : ""}" data-deliver="${escapeHtml(deliverableFile(f))}">${fileFigure(f.name, deliverableFile(f))}<span class="deliver-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span><small>${formatFileSize(f.size)}</small>${
    missing
      ? `<span class="deliver-gone">${t(`已移出卷宗`)}</span>`
      : `<button type="button" class="deliver-btn" data-deliver-action="view" title="${t(`预览`)}">${t(`预览`)}</button><button type="button" class="deliver-btn" data-deliver-action="download" title="${t(`另存到本机`)}">${t(`下载`)}</button>`
  }</div>`;
}
// 成品多了只摊前四件，余下的折进末行一句「余 n 件」（五件以内照旧全摊）；点开的记在本页、不存进消息，重画时照旧开着（设计稿/108 甲）
const DELIVER_FOLD = 5,
  DELIVER_SHOWN = 4;
/** @type {Set<string>} */
const deliverOpen = new Set();
/** @param {Deliverable[]} files */
function deliverableRowsHtml(files) {
  const fold = files.length > DELIVER_FOLD;
  return files.map((f, i) => deliverableFileHtml(f, fold && i >= DELIVER_SHOWN)).join("");
}
function deliverMoreInner(rest, open) {
  return `${open ? t("收起") : t`余 ${rest} 件`}<i aria-hidden="true">▾</i>`;
}
/** @param {Message} message */
function deliverablesHtml(message) {
  const files = message.deliverables || [];
  if (!files.length) return "";
  const open = deliverOpen.has(message.id),
    more =
      files.length > DELIVER_FOLD
        ? `<button type="button" class="deliver-more" aria-expanded="${open}">${deliverMoreInner(files.length - DELIVER_SHOWN, open)}</button>`
        : "";
  return `<div class="deliver-bar${open ? " open" : ""}"><div class="deliver-head"><span class="seal deliver-seal" aria-hidden="true">${t(`成`)}</span><span>${files.some(f => f.root) ? t`成品 ${files.length} 件` : t`成品 ${files.length} 件 · 已入卷宗`}</span></div>${deliverableRowsHtml(files)}${more}</div>`;
}
/** @param {HTMLElement} button 末行那句「余 n 件 / 收起」 */
function toggleDeliverables(button) {
  const bar = /** @type {HTMLElement} */ (button.closest(".deliver-bar")),
    id = /** @type {HTMLElement|null} */ (bar.closest("[data-message]"))?.dataset.message || "",
    open = !bar.classList.contains("open");
  if (open) deliverOpen.add(id);
  else deliverOpen.delete(id);
  bar.classList.toggle("open", open);
  button.setAttribute("aria-expanded", String(open));
  button.innerHTML = deliverMoreInner(bar.querySelectorAll(".deliver-file.extra").length, open);
}
// 卷宗目录刷新后，把页面上成品条里各件的在与不在同步一遍（消息本身没变，不必重画整条）
function syncDeliverables() {
  for (const bar of document.querySelectorAll(".deliver-bar")) {
    const article = bar.closest("[data-message]"),
      c = currentConversation(),
      message = c && allMessages(c).find(m => m.id === article?.dataset.message);
    if (!message?.deliverables?.length) continue;
    const html = deliverableRowsHtml(message.deliverables);
    const current = [...bar.querySelectorAll(".deliver-file")].map(node => node.outerHTML).join("");
    if (current !== html)
      bar.querySelectorAll(".deliver-file").forEach(node => node.remove()),
        bar.querySelector(".deliver-head")?.insertAdjacentHTML("afterend", html);
  }
}
