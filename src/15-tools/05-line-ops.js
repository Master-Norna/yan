// 言 · 工具 · 行比法：两列字串的编辑脚本。行迹与预览的红绿（22-changes.js）、桥接覆盖写的清单（server/work/text.js）共用这一份，
// 清单与红绿才对得上。纯函数，不碰页面：桥接整段读进去取 lcsOps，加东西别依赖闭包里的别的段
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
const MAX_EDITS = 1000;
/**
 * 两列的编辑脚本：摊成一串 s（同）/ d（删）/ i（增），次序照原样；两样都行时先删后增。
 * 首尾相同的先剥掉再比：逐个比时遇到相同的就配上，一句话中间插进一段，开头那个「不」会被配到插进来的那段里去，配歪了。
 * 中段走 Myers 的 O(ND) 比法：耗时与内存跟着改动量走，不跟有多长走——两处改动隔着一千行、改在文件后头，也只比改动那一点。
 * 超过 MAX_EDITS 步、文件又不大时照旧用表比（见 myersOps 的 dpOps）；再大才整块一删一增
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
// 不把整串摊进 push 的参数里（十万行的整块改写会撑爆调用栈）；超步数上限时，文件不大（两版行数之积在
// 千六百万以内）照旧用表比（dpOps），精确到每一行，再大才返回 null，由 lcsOps 整块一删一增
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
// 两版行数之积在千六百万以内才进得来（与旧法同一个上限）；再大表装不下，由 lcsOps 整块一删一增。
// 改动少时不会走到这里——那时 Myers 快得多。
// 表摊成一条：一行一个 Uint16Array 的话，极扁的形状（二百万行 × 三行）光两百多万个数组对象就要几百兆；
// 摊平只有 (n+1)*(m+1)*2 字节，同一形状十几兆
/** @param {string[]} x @param {string[]} y @returns {Array<[string, string]>} */
function dpOps(x, y) {
  const n = x.length,
    m = y.length,
    w = m + 1,
    dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  /** @type {Array<[string, string]>} */
  const ops = [];
  let i = 0,
    j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      ops.push(["s", x[i++]]);
      j++;
    } else if (i < n && (j >= m || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) ops.push(["d", x[i++]]);
    else ops.push(["i", y[j++]]);
  }
  return ops;
}
