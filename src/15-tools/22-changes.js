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
  const a = diffLines(oldText),
    b = diffLines(newText);
  if (a.length * b.length > 250000) return { added: b.length, removed: a.length };
  const ops = lcsOps(a, b);
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
/**
 * 两列序列的最长公共子序列，摊成一串 s（同）/ d（删）/ i（增）；两样都行时先删后增。
 * 首尾相同的先剥掉再比：逐个比时遇到相同的就配上，一句话中间插进一段，开头那个「不」会被配到插进来的那段里去，配歪了
 * @param {string[]} a @param {string[]} b
 */
function lcsOps(a, b) {
  let head = 0,
    tail = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail),
    y = b.slice(head, b.length - tail);
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  /** @type {Array<[string, string]>} */
  const ops = a.slice(0, head).map(t => ["s", t]);
  let i = 0,
    j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push(["s", x[i++]]);
      j++;
    } else if (i < x.length && (j >= y.length || dp[i + 1][j] >= dp[i][j + 1])) ops.push(["d", x[i++]]);
    else ops.push(["i", y[j++]]);
  }
  for (const t of a.slice(a.length - tail)) ops.push(["s", t]);
  return ops;
}
// 行内按词比：英文数字连成一词，汉字与标点逐个
const diffTokens = (/** @type {string} */ line) => line.match(/[A-Za-z0-9_$]+|\s+|[^\sA-Za-z0-9_$]/gu) || [];
// 两行像不像：去掉空白后同词占四成以上才算「改了这一行」，否则是删一行、另增一行
function linesAlike(a, b) {
  const x = diffTokens(a).filter(t => t.trim()),
    y = diffTokens(b).filter(t => t.trim());
  if (!x.length || !y.length || x.length * y.length > 40000) return false;
  return (2 * lcsOps(x, y).filter(op => op[0] === "s").length) / (x.length + y.length) >= 0.4;
}
// 配上对的两行：改了的那几个字包进 <mark>。逐词比出来的常是碎片——夹在两处改动之间的一两个字、一个标点也被挖成「没改」，
// 中文改一句就成了满行的碎块，所以这样的小缝并进改动里（只标真有改动的那一侧：只插了字的，旧的那侧不因并进的小缝挂上标记）。
// 两边都改了大半的，不再逐字标：整行本就是红 / 绿的，满行的标记只是噪声
function wordMarks(oldLine, newLine) {
  const a = diffTokens(oldLine),
    b = diffTokens(newLine),
    plain = [escapeHtml(oldLine), escapeHtml(newLine)];
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
// 两对之间落单的删与跳过的增左右并进同几行（loose，不逐字比）——各占一行会排成台阶，一边一块空洞
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
    for (let k = j; k < ins.length; k++)
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
 * wrap 为假时一行放不下只放写得下的，末尾省略、悬停看整行（行迹里一步不该被一行长注释撑成半屏）；预览浮层与展开全部时照常折行
 * @param {string} oldText @param {string} newText @param {{ limit?: number, wrap?: boolean }} [options]
 * @returns {{ html: string, rows: number, clipped: boolean, added: number, removed: number }}
 */
function splitDiffHtml(oldText, newText, { limit = Infinity, wrap = true } = {}) {
  let a = diffLines(oldText),
    b = diffLines(newText);
  // 太长的不逐行比，仍是旧的一块、新的一块
  if (a.length * b.length > 250000)
    return {
      html: `<pre class="tool-output diff-del">${escapeHtml(a.join("\n"))}</pre><pre class="tool-output diff-ins">${escapeHtml(b.join("\n"))}</pre>`,
      rows: 0,
      clipped: false,
      added: b.length,
      removed: a.length
    };
  const lead = Math.min(...[...a, ...b].filter(line => line.trim()).map(line => line.match(/^ */)[0].length));
  if (lead > 0 && Number.isFinite(lead)) [a, b] = [a, b].map(lines => lines.map(line => line.slice(Math.min(lead, line.length))));
  const ops = lcsOps(a, b),
    near = ops.map((_, k) => ops.slice(Math.max(0, k - 2), k + 3).some(op => op[0] !== "s"));
  /** @type {string[]} */
  const rows = [];
  let skipped = 0,
    added = 0,
    removed = 0;
  const gap = () => {
    if (skipped && rows.length) rows.push(`<span class="gap"></span>`);
    skipped = 0;
  };
  const cell = (kind, html, raw = "") =>
    html === null
      ? `<span class="e"></span>`
      : `<span class="${kind}"${!wrap && raw.length > 30 ? ` title="${escapeHtml(raw)}"` : ""}>${html || " "}</span>`;
  for (let k = 0; k < ops.length; ) {
    if (ops[k][0] === "s") {
      if (!near[k]) skipped++;
      else {
        gap();
        rows.push(cell("s", escapeHtml(ops[k][1]), ops[k][1]).repeat(2));
      }
      k++;
      continue;
    }
    gap();
    const dels = [],
      ins = [];
    while (k < ops.length && ops[k][0] !== "s") (ops[k][0] === "d" ? dels : ins).push(ops[k++][1]);
    removed += dels.length;
    added += ins.length;
    for (const { d, i, loose } of pairLines(dels, ins)) {
      const [left, right] =
        d !== undefined && i !== undefined && !loose
          ? wordMarks(d, i)
          : [d === undefined ? null : escapeHtml(d), i === undefined ? null : escapeHtml(i)];
      rows.push(cell("d", left, d) + cell("i", right, i));
    }
  }
  const shown = rows.slice(0, limit);
  return {
    html: `<div class="tool-output split-diff${wrap ? "" : " clip"}">${shown.join("")}</div>`,
    rows: rows.length,
    clipped: shown.length < rows.length,
    added,
    removed
  };
}
// 一件文件在这一答里的改动：不另起接口、不另存一份，用的就是各步本来记着的——改文件那步的前后两段（行迹里同一副红绿），
// 写文件那步写下的内容与它覆盖掉的原文（逐行比出红绿）；按先后排，摊在预览浮层里。帮手改的也在内。
// 这一答里新建的件，从它最后一回整份写入看起：之前几版是草稿，与清单上「只增不删」对得上
/** @param {Message} message @param {string} path */
function changeDiffHtml(message, path) {
  let steps = allSteps(message).filter(step => step.change?.path === path && step.status === "done");
  const created = steps.some(step => step.change.created),
    lastWrite = steps.findLastIndex(step => step.written !== undefined);
  if (created && lastWrite > 0) steps = steps.slice(lastWrite);
  return `<div class="file-viewer-text change-diff">${steps
    .map(step => {
      const note = [toolLabel(step.name), step.scope ? t("帮手") : "", stepText(step.result || step.note)].filter(Boolean).join(" · "),
        head = `<p class="file-viewer-note">${escapeHtml(note)}</p>`;
      if (step.diff) return `${head}<div class="tool-diff">${splitDiffHtml(step.diff.old, step.diff.new).html}</div>`;
      // 新建的件（或没记下原文的）也并排画：左边留空，与改动同一种画法，不一会儿整宽一会儿两栏
      if (step.written !== undefined)
        return `${head}<div class="tool-diff">${splitDiffHtml(created ? "" : (step.previous ?? ""), step.written).html}</div>`;
      return head;
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
// 解压出的一堆、顺手改的代码不列，别的对话与人同时放进卷宗的也混不进来。收尾时按这段对话的落脚处认路（见 localLinkTarget），
// 在的记下路与大小；落在卷宗里的只记卷宗里的路，别处的另记所在的根。一件一行：件图、文件名、大小，右侧「预览」与「下载」
/** @param {Conversation} conversation @param {string} content @returns {Promise<Deliverable[]>} */
async function replyDeliverables(conversation, content) {
  /** @type {string[]} */
  const hrefs = [];
  marked.walkTokens(marked.lexer(String(content || "")), token => {
    if (token.type === "link" || token.type === "image") hrefs.push(token.href);
  });
  const archive = archiveDir(),
    seen = new Set();
  /** @type {Deliverable[]} */
  const files = [];
  for (const href of hrefs) {
    const name = localFileName(href),
      target = name ? localLinkTarget(href, conversation) : null;
    if (!target || seen.has(`${target.root}|${target.path}`)) continue;
    seen.add(`${target.root}|${target.path}`);
    const head = await fetch(archiveFileUrl(target.path, true, target.root), { method: "HEAD" }).catch(() => null);
    if (!head?.ok) continue;
    files.push({
      path: target.path,
      name: target.path.split("/").pop() || name,
      size: Number(head.headers.get("content-length")) || 0,
      ...(target.root === archive ? {} : { root: target.root })
    });
  }
  return files;
}
// 卷宗里已经删掉的成品：条目留着（这一答确实出过这件），但标成「已移出卷宗」，不再给看与下载的按钮。卷宗之外的认不出在不在，点了取不到再说
/** @param {Deliverable} f */
function deliverableMissing(f) {
  return !f.root && archiveEntries !== null && !archiveEntries.some(entry => entry.path === f.path);
}
/** @param {Deliverable} f */
function deliverableFileHtml(f, extra = false) {
  const missing = deliverableMissing(f);
  return `<div class="deliver-file${missing ? " missing" : ""}${extra ? " extra" : ""}" data-deliver="${escapeHtml(f.path)}"${f.root ? ` data-root="${escapeHtml(f.root)}"` : ""}>${fileFigure(f.name, f.path)}<span class="deliver-name" title="${escapeHtml(f.path)}">${escapeHtml(f.name)}</span><small>${formatFileSize(f.size)}</small>${
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
