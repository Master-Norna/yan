// 言 · 笔意图标：卷宗、设置入口与设置各栏的小画。一件是几笔墨、一点朱，不是等宽的线稿——
// 一笔是一串二次曲线（起点、控制点、终点、控制点、终点……），照「起笔顿、行笔匀、收笔出锋」的笔形铺成一片面。
// 页面里写 <svg data-brush="名字"></svg>，开页时由 paintBrushIcons 画上；设置里用 brushIcon(名字) 直接拼进 HTML。
// 落选的：等宽圆头的线稿加实心色块（UI 图标的画法，怎么减细节都偏卡通）

/**
 * 一笔。points 是 x0 y0 cx cy x1 y1 [cx cy x2 y2 …]；width 最粗处；tail 收笔处的粗细比（0 出锋，0.6 以上是顿笔收住）
 * @param {number[]} points
 * @param {number} width
 * @param {{ tail?: number, head?: number, tone?: "ink"|"ink2"|"zhu"|"ghost"|"gold"|"green" }} [options]
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
  // 分组：三册书叠放，最上一册垂下一条朱色书签
  groups: () =>
    brushStroke([3, 16.4, 10, 16, 17, 16.2], 2.6, { tail: 0.5 }) +
    brushStroke([4, 12.6, 10, 12.1, 16, 12.4], 2.6, { tail: 0.5 }) +
    brushStroke([5, 8.8, 10, 8.3, 15, 8.6], 2.6, { tail: 0.5 }) +
    brushStroke([12.4, 8.6, 12.7, 6, 12.5, 3.2], 1, { tone: "zhu", tail: 0.4 }),
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
  // 技能：锦囊——用时才拆。囊身一笔兜底，囊口一束、两耳，系口一粒朱（设计稿/78 一）
  skills: () =>
    brushStroke([6.8, 7.6, 2.4, 17.4, 10, 17.2, 17.6, 17.4, 13.2, 7.6], 2.2, { tail: 0.4 }) +
    brushStroke([6.2, 7.2, 10, 6.4, 13.8, 7.2], 1.3) +
    brushStroke([8.2, 6.6, 9.4, 3.8, 7.6, 2.4], 1, { tone: "ink2", tail: 0.4 }) +
    brushStroke([11.8, 6.6, 10.8, 3.8, 12.6, 2.4], 1, { tone: "ink2", tail: 0.4 }) +
    brushDot(10, 7, 1.15, "zhu"),
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
  // 专司：笔架一横，挂两支笔——主答之外另请的几位，一支点朱（设计稿/110）
  duty: () =>
    brushStroke([2.8, 4.4, 10, 3.7, 17.2, 4.3], 1.7, { tail: 0.5 }) +
    brushStroke([7, 4.8, 7.2, 8, 7, 11], 0.95, { tone: "ink2", tail: 0.7 }) +
    brushStroke([7, 10.8, 7.25, 13.6, 6.9, 16.8], 2.5) +
    brushStroke([13, 4.8, 13.2, 8, 13, 11], 0.95, { tone: "ink2", tail: 0.7 }) +
    brushStroke([13, 10.8, 13.25, 13.6, 12.9, 16.8], 2.5, { tone: "zhu" }),
  // 看台的几件小工具，只用墨、不落朱（朱留给「正在操作」）。后退：一笔自右向左的横，左端一撇一捺作头；前进反之
  back: () =>
    brushStroke([16, 10.2, 10, 9.6, 4.2, 10], 1.7, { tail: 0.2 }) +
    brushStroke([8.6, 5.6, 6, 7.6, 4.2, 10], 1.3, { tail: 0.3 }) +
    brushStroke([4.4, 10.2, 6.4, 12.4, 8.8, 14.2], 1.2),
  forward: () =>
    brushStroke([4, 10, 10, 9.6, 15.8, 10.2], 1.7, { tail: 0.2 }) +
    brushStroke([11.4, 5.6, 14, 7.6, 15.8, 10], 1.3, { tail: 0.3 }) +
    brushStroke([15.6, 10.2, 13.6, 12.4, 11.2, 14.2], 1.2),
  // 奏：一竖一折写成尖朝右的三角，里头一片淡朱；止：两笔短竖，顿笔收住。都用朱（听音那一缕的纸签，设计稿/121 乙）
  play: () =>
    `<path class="zhu" opacity=".16" d="M6.6 5 L15.4 10 L6.6 15Z"/>` +
    brushStroke([6.4, 4.4, 6.6, 10, 6.4, 15.6], 1.7, { tone: "zhu", tail: 0.6 }) +
    brushStroke([6.6, 4.6, 11.2, 7.2, 15.6, 10, 11.2, 12.8, 6.6, 15.4], 1.5, { tone: "zhu", tail: 0.2 }),
  pause: () =>
    brushStroke([7.2, 4.6, 7.4, 10, 7.2, 15.4], 2.1, { tone: "zhu", tail: 0.7 }) +
    brushStroke([12.8, 4.6, 13, 10, 12.8, 15.4], 2.1, { tone: "zhu", tail: 0.7 }),
  // 下载：一笔竖落下来、两笔收成箭头（与前进、后退同一笔法），底下一道淡墨是落到的那张纸
  download: () =>
    brushStroke([10, 2.8, 10.2, 7.6, 10, 12.6], 1.7, { tail: 0.3 }) +
    brushStroke([6.2, 9, 8.2, 10.8, 10, 12.8], 1.3, { tail: 0.3 }) +
    brushStroke([13.8, 9, 11.8, 10.8, 10, 12.8], 1.2) +
    brushStroke([3.6, 16.4, 10, 15.9, 16.4, 16.3], 1.3, { tone: "ink2", tail: 0.4 }),
  // 回到最新：同下载的那一竖两收，去掉底下那道纸
  down: () =>
    brushStroke([10, 3.6, 10.2, 8.6, 10, 15], 1.8, { tail: 0.3 }) +
    brushStroke([5.6, 10.6, 7.8, 12.6, 10, 15.2], 1.4, { tail: 0.3 }) +
    brushStroke([14.4, 10.6, 12.2, 12.6, 10, 15.2], 1.3),
  // 重载：一笔圆相留一口，口上一点
  reload: () => brushArc(10, 10.4, 5.6, -60, 230, 1.6, { tail: 0.15 }) + brushDot(13.4, 4.6, 1.1),
  // 收藏：一条书签带——顶上一笔横，两侧两笔竖，底下剪成燕尾，带面染一层淡墨（五角星是别家的记号）
  mark: () =>
    `<path class="wash" d="M6.2 3.4H13.8V16.4L10 13.4L6.2 16.4Z"/>` +
    brushStroke([5.6, 3.3, 10, 2.9, 14.4, 3.4], 1.6, { tail: 0.5 }) +
    brushStroke([6.2, 3.6, 6.4, 10, 6.2, 16.4], 1.3, { tail: 0.4 }) +
    brushStroke([13.8, 3.6, 13.6, 10, 13.8, 16.4], 1.3, { tail: 0.4 }) +
    brushStroke([6.4, 16.2, 8.2, 14.6, 10, 13.4], 1, { tail: 0.3 }) +
    brushStroke([10, 13.4, 11.8, 14.6, 13.6, 16.2], 1, { tail: 0.2 }),
  // 阔（铺满整页）：一笔斜画两头各出一角，往右上、左下撑开；中间一层淡墨是纸
  wide: () =>
    `<rect class="wash" x="6.6" y="6.6" width="6.8" height="6.8"/>` +
    brushStroke([9, 11, 12, 8, 15.4, 4.6], 1.5, { tail: 0.5 }) +
    brushStroke([11.2, 4.2, 13.6, 4.1, 16, 4.2], 1.3, { tail: 0.4 }) +
    brushStroke([15.9, 4.1, 16, 6.5, 15.8, 8.8], 1.3, { tail: 0.3 }) +
    brushStroke([11, 9, 8, 12, 4.6, 15.4], 1.5, { tail: 0.5 }) +
    brushStroke([4.1, 11.2, 4, 13.6, 4.2, 16], 1.3, { tail: 0.4 }) +
    brushStroke([4.2, 15.9, 6.5, 16, 8.8, 15.8], 1.3, { tail: 0.3 }),
  // 游目：两道远山一淡一浓，天边一点朱日——游目骋怀，极目所见
  stage: () =>
    brushStroke([7.4, 11.4, 10.8, 5.4, 14.2, 8.8, 16.2, 7.2, 18.4, 9.8], 1.2, { tone: "ink2", tail: 0.3 }) +
    brushStroke([1.8, 15.8, 5.2, 8.2, 8.6, 12.6, 11.6, 9.6, 18, 15.4], 1.6, { tail: 0.3 }) +
    brushStroke([2.4, 17.6, 10, 17.2, 17.6, 17.6], 1, { tone: "ink2", tail: 0.4 }) +
    brushDot(5.2, 4.6, 1.6, "zhu"),
  // 添（记忆的「手记一条」）：一笔横、一笔竖，写成一个「十」，竖笔收处一点朱
  add: () =>
    brushStroke([3.6, 10.2, 10, 9.6, 16.4, 10], 2, { tail: 0.4 }) +
    brushStroke([10.2, 3.6, 9.9, 10, 10.1, 16.2], 2, { tail: 0.5 }) +
    brushDot(14.6, 15, 1.2, "zhu"),
  // 删：两行淡墨字，一笔浓墨斜着划去
  strike: () =>
    brushStroke([3.4, 7.6, 8, 7.3, 12.6, 7.7], 1.3, { tone: "ink2", tail: 0.4 }) +
    brushStroke([3.4, 12.4, 7, 12.1, 10.6, 12.5], 1.3, { tone: "ink2", tail: 0.4 }) +
    brushStroke([2.6, 15.6, 10, 10.4, 17.2, 4.4], 2, { tail: 0.2 }),
  // 行间小画（回复下的复制、旁注，问句上的改，侧栏的查找）：只用墨、不落朱，颜色随按钮走（见 styles/30-chat/30-diff-edit.css）。
  // 重答、重试与「重载」同一笔圆相，续写与「前进」同一笔，不另画。见 设计稿/26 一
  // 复制：两张纸叠着——后一张只露左上两笔淡墨，前一张一片淡染、左与上各一笔
  copy: () =>
    brushStroke([3.2, 12.4, 3.3, 7.6, 3.2, 3.2], 1.2, { tone: "ink2", tail: 0.5 }) +
    brushStroke([3.2, 3.1, 7.6, 2.9, 12, 3.2], 1.2, { tone: "ink2", tail: 0.5 }) +
    `<rect class="wash" x="7" y="6.6" width="10" height="10.6" rx=".4"/>` +
    brushStroke([7, 6.6, 7.2, 12, 7, 17.2], 1.6, { tail: 0.5 }) +
    brushStroke([7, 6.5, 12, 6.2, 17, 6.6], 1.6, { tail: 0.4 }),
  // 旁注：左边三行字，右边一道夹批的竖笔
  note: () =>
    [5, 10, 15].map(y => brushStroke([2.8, y + 0.2, 6.4, y - 0.2, 10.2, y + 0.1], 1.3, { tone: "ink2", tail: 0.3 })).join("") +
    brushStroke([14.6, 3.6, 14.9, 10, 14.5, 16.6], 2, { tail: 0.2 }),
  // 改：一支笔落在纸上，笔下一道淡墨（个性化那支笔去了朱）
  edit: () =>
    brushStroke([16.4, 3, 12.4, 7.2, 8.4, 11.4], 1.3, { tail: 0.7 }) +
    brushStroke([8.8, 11, 5.8, 13.4, 3.6, 16.4], 3.2) +
    brushStroke([8.4, 16.8, 12.6, 16.2, 17, 16.6], 1.2, { tone: "ink2" }),
  // 查找：一笔圆相作镜，一笔顿下作柄
  search: () => brushArc(8.4, 8.4, 5, 120, 450, 1.6, { tail: 0.3 }) + brushStroke([12.2, 12.2, 14.2, 14.4, 16.8, 16.8], 2.3, { tail: 0.6 }),
  // 明暗：一笔圆相，里头半边染墨——昼夜各半；换明暗时这一染转过半圈（见 styles/10-layout.css）
  theme: () => `<path class="wash theme-wash" d="M10 3.6A6.4 6.4 0 0 1 10 16.4Z"/>` + brushArc(10, 10, 6.4, 200, 520, 1.7, { tail: 0.15 })
};
/** @param {string} name @param {string} [className] */
function brushIcon(name, className = "") {
  return `<svg class="brush${className ? ` ${className}` : ""}" viewBox="0 0 20 20" aria-hidden="true">${BRUSH_ICONS[name]?.() || ""}</svg>`;
}
// ---------- 标识：一笔言（对谈）、一笔行（执事） ----------
// 侧栏顶上的标识随态换字（设计稿/156 丙）；画幅 16.5 12.5 68 68，一笔墨加一点朱。web/icon.svg 是一笔言的定稿副本（设计稿/149），
// 一笔行是 155 辛（亍的下横收了一点，免得兜回时出画幅）
/** 把每段二次曲线再细分几段：笔走得长、转得急时，brushStroke 按段铺的笔形才不见棱角 @param {number[]} points */
function brushFine(points, parts = 6) {
  const out = [points[0], points[1]],
    blossom = (a, b, p0, c, p1) => (1 - a) * (1 - b) * p0 + (a * (1 - b) + b * (1 - a)) * c + a * b * p1;
  for (let i = 0; i + 4 < points.length; i += 4) {
    const [x0, y0, cx, cy, x1, y1] = points.slice(i, i + 6);
    for (let k = 0; k < parts; k++) {
      const a = k / parts,
        b = (k + 1) / parts;
      out.push(blossom(a, b, x0, cx, x1), blossom(a, b, y0, cy, y1), blossom(b, b, x0, cx, x1), blossom(b, b, y0, cy, y1));
    }
  }
  return out;
}
const BRUSH_DROP = "M-6 -8.5Q-2.5 -8.5 3.5 -2.5Q8.5 2.5 6 6.5Q3.5 9.8 -.4 6.6Q-3 4 -4.4 -1.5Q-5.2 -5 -6 -8.5Z";
/** @type {Record<string, () => string>} */
const BRUSH_MARKS = {
  // 草书连写，三横一路折回、收笔出锋，口化在笔势里；上面一点朱。急弯处笔形自交留个破口，补一点墨
  言: () =>
    `<path class="zhu" transform="translate(50 23) scale(.9)" d="${BRUSH_DROP}"/>` +
    brushStroke(
      brushFine([22, 42, 48, 36, 74, 40, 83, 42, 72, 47, 58, 52, 36, 55, 27, 57, 37, 59, 50, 60, 64, 62, 72, 65, 62, 69, 53, 73, 43, 78]),
      6.8,
      {
        tail: 0.04,
        head: 0.9
      }
    ) +
    `<circle class="ink" cx="34.1" cy="54.7" r=".6"/>`,
  // 彳：朱一撇在上，墨一撇折下接竖；亍：上横收处斜牵到下横，走到头兜回接竖钩、出锋
  行: () =>
    `<path class="zhu" transform="translate(30 22) rotate(-35) scale(.9)" d="${BRUSH_DROP}"/>` +
    brushStroke(brushFine([34, 34, 29, 41, 23, 47, 27, 45, 30, 48, 32, 62, 29, 77]), 6.6, { tail: 0.3, head: 0.9 }) +
    brushStroke(
      brushFine([47, 32, 59, 29, 71, 30, 62, 38, 45, 46, 61, 41, 77, 42, 82, 43, 75, 46, 67, 49, 67, 62, 67, 74, 61, 78, 57, 79, 53, 73]),
      6.4,
      {
        tail: 0.04,
        head: 0.9
      }
    )
};
/** @param {string} name @param {string} [className] */
function brushMark(name, className = "") {
  return `<svg class="brush${className ? ` ${className}` : ""}" viewBox="16.5 12.5 68 68" aria-hidden="true">${BRUSH_MARKS[name]?.() || ""}</svg>`;
}
// 标签页与通知的图标：一笔言衬一方圆角纸，字照亮色画，颜色写死（设计稿/157 乙）。标签栏的明暗网页读不到，
// icon.svg 按系统明暗换色，系统报暗、标签栏却是浅色时浅灰的笔就淡了；README 仍用透明底的 icon.svg
const BRAND_ICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="16.5 12.5 68 68"><style>.ink{fill:#3f3d3a}.zhu{fill:#9b5540}</style><rect x="17.5" y="13.5" width="66" height="66" rx="12" fill="#f1ece2"/>${BRUSH_MARKS.言()}</svg>`
)}`;
// 页面里写好位置的（侧栏的卷宗、设置入口，设置各栏的名字前）：开页时画上
function paintBrushIcons(root = document) {
  for (const svg of root.querySelectorAll("svg[data-brush]"))
    if (!svg.childElementCount) svg.innerHTML = BRUSH_ICONS[svg.dataset.brush]?.() || "";
}
paintBrushIcons();
