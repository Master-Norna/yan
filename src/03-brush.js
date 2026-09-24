// 言 · 笔意图标：卷宗、设置入口与设置各栏的小画。一件是几笔墨、一点朱，不是等宽的线稿——
// 一笔是一串二次曲线（起点、控制点、终点、控制点、终点……），照「起笔顿、行笔匀、收笔出锋」的笔形铺成一片面。
// 页面里写 <svg data-brush="名字"></svg>，开页时由 paintBrushIcons 画上；设置里用 brushIcon(名字) 直接拼进 HTML。
// 落选的：等宽圆头的线稿加实心色块（UI 图标的画法，怎么减细节都偏卡通）

/**
 * 一笔。points 是 x0 y0 cx cy x1 y1 [cx cy x2 y2 …]；width 最粗处；tail 收笔处的粗细比（0 出锋，0.6 以上是顿笔收住）
 * @param {number[]} points
 * @param {number} width
 * @param {{ tail?: number, head?: number, tone?: "ink"|"ink2"|"zhu" }} [options]
 */
function brushStroke(points, width, { tail = 0, head = 0.78, tone = "ink" } = {}) {
  const samples = [];
  for (let i = 0; i + 4 < points.length; i += 4) {
    const [x0, y0, cx, cy, x1, y1] = points.slice(i, i + 6);
    for (let k = i ? 1 : 0; k <= 12; k++) {
      const t = k / 12,
        u = 1 - t;
      samples.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
    }
  }
  const lengths = [0];
  for (let i = 1; i < samples.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(samples[i][0] - samples[i - 1][0], samples[i][1] - samples[i - 1][1]));
  const total = lengths.at(-1) || 1,
    shape = t => (t < 0.16 ? head + ((1 - head) * t) / 0.16 : t < 0.62 ? 1 : 1 - ((1 - tail) * (t - 0.62)) / 0.38),
    left = [],
    right = [];
  samples.forEach(([x, y], i) => {
    const [ax, ay] = samples[Math.max(0, i - 1)],
      [bx, by] = samples[Math.min(samples.length - 1, i + 1)],
      len = Math.hypot(bx - ax, by - ay) || 1,
      half = (width * shape(lengths[i] / total)) / 2,
      nx = -(by - ay) / len,
      ny = (bx - ax) / len;
    left.push([x + nx * half, y + ny * half]);
    right.push([x - nx * half, y - ny * half]);
  });
  // 起笔是个圆头：从右边绕回左边时往笔尖反方向鼓出去一点
  const [sx, sy] = samples[0],
    [tx, ty] = samples[1],
    back = Math.hypot(tx - sx, ty - sy) || 1,
    bulge = [sx - ((tx - sx) / back) * width * 0.55, sy - ((ty - sy) / back) * width * 0.55];
  const f = n => n.toFixed(2),
    line = list => list.map(([x, y]) => `L${f(x)} ${f(y)}`).join("");
  return `<path class="${tone}" d="M${f(left[0][0])} ${f(left[0][1])}${line(left.slice(1))}${line(right.reverse())}Q${f(bulge[0])} ${f(bulge[1])} ${f(left[0][0])} ${f(left[0][1])}Z"/>`;
}
// 圆相：以 (cx, cy) 为心、r 为径，从 from 度起顺时针走到 to 度的一笔
function brushArc(cx, cy, r, from, to, width, options) {
  const points = [],
    steps = 6,
    span = (to - from) / steps,
    at = (deg, radius = r) => [cx + radius * Math.cos((deg * Math.PI) / 180), cy + radius * Math.sin((deg * Math.PI) / 180)];
  points.push(...at(from));
  for (let i = 0; i < steps; i++)
    points.push(...at(from + span * (i + 0.5), r / Math.cos((span * Math.PI) / 360)), ...at(from + span * (i + 1)));
  return brushStroke(points, width, options);
}
const brushSeal = (x, y, size) => `<rect class="zhu" x="${x}" y="${y}" width="${size}" height="${size}" rx=".25"/>`,
  brushDot = (x, y, r, tone = "ink") => `<circle class="${tone}" cx="${x}" cy="${y}" r="${r}"/>`;

/** @type {Record<string, () => string>} 20 × 20 的画幅 */
const BRUSH_ICONS = {
  // 卷宗：写意手卷——两根轴各一笔竖画，纸是一片淡墨，字是两笔短横，角上一方小朱印
  scroll: () =>
    `<rect class="wash" x="5" y="5" width="10.2" height="9.6" rx=".4"/>` +
    brushStroke([4, 3, 4.3, 10, 4.2, 17], 2.2) +
    brushStroke([16, 3.2, 15.8, 10, 15.9, 16.8], 2.2) +
    brushStroke([7.2, 8.3, 10, 8, 12.8, 8.1], 1.3, { tone: "ink2" }) +
    brushStroke([7.2, 11.2, 9.1, 11, 11, 11.1], 1.3, { tone: "ink2" }) +
    brushSeal(11.6, 12, 2.1),
  // 设置入口：调律——三道弦各一笔淡墨，弦上三枚墨码，中间一枚是朱
  tune: () =>
    [5.2, 10, 14.8].map(y => brushStroke([2.6, y + 0.2, 10, y - 0.3, 17.4, y + 0.1], 1.2, { tone: "ink2", tail: 0.2 })).join("") +
    brushDot(12.8, 5, 1.9) +
    brushDot(6.8, 9.8, 1.9, "zhu") +
    brushDot(10.8, 14.9, 1.9),
  // 翻页：一页纸正被翻起——左边一笔是纸边，一道弧是翻起的那一页，页角一点朱
  newpage: () =>
    `<path class="wash" d="M5 3.6h10.6v13H5z"/>` +
    brushStroke([4.6, 3.2, 4.8, 10, 4.6, 17], 1.6, { tail: 0.5 }) +
    brushStroke([5, 16.4, 13, 14.6, 16.4, 3.8], 1.4) +
    brushDot(15.8, 4.6, 1.1, "zhu"),
  // 通用：一张几案，案上一方小印
  general: () =>
    brushStroke([2.6, 8, 10, 7.2, 17.4, 7.8], 2, { tail: 0.4 }) +
    brushStroke([5, 8.4, 4.9, 12, 4.4, 16.2], 1.6) +
    brushStroke([15, 8.4, 15.1, 12, 15.6, 16.2], 1.6) +
    brushSeal(10.6, 3.6, 2.4),
  // 个性化：一支笔，笔下一道朱
  appearance: () =>
    brushStroke([16.2, 2.8, 12, 7.4, 8.2, 11.6], 1.3, { tail: 0.7 }) +
    brushStroke([8.6, 11.2, 5.6, 13.6, 3.4, 16.8], 3.4) +
    brushStroke([8.4, 17, 12.6, 16.2, 17, 16.6], 1.4, { tone: "zhu" }),
  // 模型：一锭墨，墨下一汪
  models: () =>
    `<ellipse class="wash" cx="10" cy="16.2" rx="6.6" ry="1.9"/>` +
    brushStroke([10, 2.8, 10.3, 8, 10, 13.2], 4.4, { tail: 0.85, head: 0.9 }) +
    brushSeal(9.1, 5, 1.8),
  // 预设：一方印——印钮一笔墨，印身一笔粗横，印下一方朱痕
  presets: () =>
    brushStroke([10, 2.6, 10.2, 5, 10, 7.6], 3.4, { tail: 0.9, head: 0.9 }) +
    brushStroke([4.6, 9.4, 10, 9, 15.4, 9.4], 2.6, { tail: 0.8 }) +
    `<rect class="zhu" x="6" y="12" width="8" height="5.6" rx=".4" transform="rotate(-3 10 14.8)"/>`,
  // 工具：一把矩尺
  tools: () =>
    brushStroke([4.2, 3, 4.4, 9.6, 4.3, 16.2], 1.9, { tail: 0.6 }) +
    brushStroke([4.3, 16.2, 10.6, 16, 16.8, 16.3], 1.9) +
    brushStroke([4.6, 10.6, 7, 12.8, 9.6, 15.6], 1.1, { tone: "ink2" }) +
    brushSeal(12.6, 4.2, 2.2),
  // 环境：远山两叠，山头一轮朱日
  env: () =>
    brushStroke([2.4, 15.8, 6.4, 6.6, 10.4, 13.2], 1.8, { tail: 0.3 }) +
    brushStroke([8.4, 11, 12.6, 3.8, 17.6, 15.8], 1.9, { tail: 0.2 }) +
    brushStroke([2.2, 16.6, 10, 16.2, 17.8, 16.6], 1, { tone: "ink2" }) +
    brushDot(15.2, 4.6, 1.5, "zhu"),
  // MCP：一座拱桥，桥下一道水，桥头一点朱
  mcp: () =>
    brushStroke([2.4, 13.4, 10, 3.8, 17.6, 13.4], 2.1, { tail: 0.3 }) +
    brushStroke([4.6, 12.6, 4.8, 14.4, 4.6, 16.2], 1.3, { tail: 0.5 }) +
    brushStroke([15.4, 12.6, 15.2, 14.4, 15.4, 16.2], 1.3, { tail: 0.5 }) +
    brushStroke([2, 17.2, 10, 16.8, 18, 17.3], 0.9, { tone: "ink2" }) +
    brushDot(10, 7.2, 1.1, "zhu"),
  // 记忆：结绳记事——一根绳，三个结，末一结是朱
  memory: () =>
    brushStroke([10, 2.4, 11.6, 10, 9.6, 17.6], 1.1, { tone: "ink2", tail: 0.3 }) +
    brushDot(10.6, 6, 1.8) +
    brushDot(10.8, 10.4, 2) +
    brushDot(10.3, 14.6, 1.7, "zhu"),
  // 文档：半展的书卷——卷着的一轴一笔粗竖，纸面上下两笔长横，两行字，一方小印
  guide: () =>
    brushStroke([4.2, 3.2, 4.5, 10, 4.4, 16.8], 3) +
    brushStroke([6.2, 5.4, 11.6, 5.3, 17, 5.8], 1.4) +
    brushStroke([6.2, 14.4, 11.4, 14.6, 16.6, 14.2], 1.4) +
    brushStroke([8, 9, 11, 8.7, 14, 8.8], 1.1, { tone: "ink2" }) +
    brushStroke([8, 11.3, 10.2, 11.1, 12.4, 11.2], 1.1, { tone: "ink2" }) +
    brushSeal(15, 9.3, 1.9),
  // 关于：一笔圆相，旁落一方小印
  about: () => brushArc(9.6, 9.8, 6.4, 200, 505, 2.2, { tail: 0.15 }) + brushSeal(14.8, 14.8, 2.2)
};
/** @param {string} name @param {string} [className] */
function brushIcon(name, className = "") {
  return `<svg class="brush${className ? ` ${className}` : ""}" viewBox="0 0 20 20" aria-hidden="true">${BRUSH_ICONS[name]?.() || ""}</svg>`;
}
// 页面里写好位置的（侧栏的卷宗、设置入口，设置各栏的名字前）：开页时画上
function paintBrushIcons(root = document) {
  for (const svg of root.querySelectorAll("svg[data-brush]"))
    if (!svg.childElementCount) svg.innerHTML = BRUSH_ICONS[svg.dataset.brush]?.() || "";
}
paintBrushIcons();
