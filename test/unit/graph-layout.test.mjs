// 纲卡的图：摆法本身不让它重合——字在列里、线在列间、汇点在记号前。随机生成几百张纲，逐张查：字框不相叠，线不穿字，结不压字
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load(["drawGraphLayout", "reducedNeeds", "settledFold"]);

// 可复现的随机数
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return (s >>> 0) / 4294967296;
  };
}
const STATES = ["holds", "premised", "claimed", "fails", "stale", "doing", "open", "dropped"];
const WORDS = [
  "记行列",
  "报行列",
  "行号对得上",
  "测试",
  "README",
  "自己数行",
  "js-yaml mark",
  "排版",
  "目录",
  "锚点",
  "混排",
  "高亮",
  "沿用 hljs",
  "百条一分钟",
  "转排版树",
  "PDF 无误"
];
function randomGraph(rand, n) {
  const nodes = [];
  for (let i = 0; i < n; i++) {
    // 前提只取更早的几项：天然无环
    const needs = [];
    for (let j = 0; j < i; j++) if (rand() < Math.min(0.5, 2.2 / i)) needs.push(`n${j}`);
    const state = STATES[Math.floor(rand() * STATES.length)];
    nodes.push({
      id: `n${i}`,
      label: rand() < 0.15 ? "" : `${WORDS[Math.floor(rand() * WORDS.length)]}${rand() < 0.3 ? "的那一项" : ""}`,
      when: rand() < 0.15 ? (rand() < 0.5 ? "YAML" : "中文") : undefined,
      needs,
      any: needs.length >= 2 && rand() < 0.3,
      state,
      tag: { premised: "待前提", claimed: "待验", fails: "未过", stale: "复验" }[state],
      num: rand() < 0.15 ? "①" : undefined
    });
  }
  // 根：没人以之为前提的
  const used = new Set(nodes.flatMap(node => node.needs));
  for (const node of nodes) node.root = !used.has(node.id);
  return nodes;
}
// 把路径拆成采样点
function samples(d) {
  const nums = d.match(/[MLC]|-?\d+(\.\d+)?/g),
    out = [];
  let i = 0,
    x = 0,
    y = 0;
  while (i < nums.length) {
    const op = nums[i++];
    if (op === "M" || op === "L") {
      const nx = +nums[i++],
        ny = +nums[i++];
      if (op === "L") for (let t = 0; t <= 1; t += 0.05) out.push([x + (nx - x) * t, y + (ny - y) * t]);
      x = nx;
      y = ny;
      out.push([x, y]);
    } else if (op === "C") {
      const [c1x, c1y, c2x, c2y, nx, ny] = nums.slice(i, i + 6).map(Number);
      i += 6;
      for (let t = 0; t <= 1; t += 0.04) {
        const u = 1 - t;
        out.push([
          u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * nx,
          u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ny
        ]);
      }
      x = nx;
      y = ny;
    }
  }
  return out;
}
const inside = ([x, y], [x1, y1, x2, y2]) => x > x1 + 0.5 && x < x2 - 0.5 && y > y1 + 0.5 && y < y2 - 0.5;
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

test("随机的几百张纲：字框不相叠，线不穿字，结不压字", () => {
  const rand = rng(20261011);
  let checked = 0;
  for (let round = 0; round < 400; round++) {
    const graph = randomGraph(rand, 3 + Math.floor(rand() * 18));
    const drawing = f.drawGraphLayout(graph);
    const { boxes } = drawing;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        assert.ok(!overlap(boxes[i], boxes[j]), `第 ${round} 张：${drawing.nodes[i].id} 与 ${drawing.nodes[j].id} 的字叠了`);
    for (const edge of drawing.edges)
      for (const point of samples(edge.d))
        for (const [k, box] of boxes.entries())
          assert.ok(!inside(point, box), `第 ${round} 张：${edge.from}→${edge.to} 的线穿过了 ${drawing.nodes[k].id} 的字`);
    for (const knot of drawing.knots)
      for (const [k, box] of boxes.entries())
        assert.ok(
          !overlap([knot.x - 6, knot.y - 6, knot.x + 6, knot.y + 6], box),
          `第 ${round} 张：${knot.to} 的结压在 ${drawing.nodes[k].id} 上`
        );
    assert.ok(drawing.width > 0 && drawing.height > 0);
    checked += 1;
  }
  assert.equal(checked, 400);
});

test("能经别的前提走到的直连线不画：发版—行号那条省去", () => {
  const nodes = {
    ship: { id: "ship", needs: ["lines", "tests", "docs"], state: "open" },
    tests: { id: "tests", needs: ["lines"], state: "stale" },
    lines: { id: "lines", needs: [], state: "premised" },
    docs: { id: "docs", needs: [], state: "doing" }
  };
  assert.deepEqual(f.reducedNeeds(nodes).ship, ["tests", "docs"]);
});

test("一串都已立住的前提并作最靠外那一项，注 +n；根总要画", () => {
  const graph = [
    { id: "parse", label: "记行列", needs: [], state: "holds" },
    { id: "msg", label: "报行列", needs: ["parse"], state: "holds" },
    { id: "docs", label: "README", needs: [], state: "doing" },
    { id: "ship", label: "可以发版", needs: ["msg", "docs"], state: "open", root: true }
  ];
  const drawing = f.drawGraphLayout(graph);
  assert.deepEqual(drawing.nodes.map(n => n.id).sort(), ["docs", "msg", "ship"]);
  assert.equal(drawing.nodes.find(n => n.id === "msg").more, 1);
  const all = f.drawGraphLayout(graph.map(n => ({ ...n, state: "holds" })));
  assert.deepEqual(
    all.nodes.map(n => n.id),
    ["ship"]
  );
  assert.equal(all.nodes[0].more, 3);
});

test("三条以上的前提、或择一的几条，先汇成一个结再进来；同一张纲摆出来每回一样", () => {
  const graph = [
    { id: "a", label: "甲", needs: [], state: "open" },
    { id: "b", label: "乙", needs: [], state: "open" },
    { id: "c", label: "丙", needs: [], state: "open" },
    { id: "or", label: "择一", needs: ["a", "b"], any: true, state: "open" },
    { id: "top", label: "顶", needs: ["or", "c", "a2"], state: "open", root: true },
    { id: "a2", label: "又一", needs: [], state: "open" }
  ];
  const drawing = f.drawGraphLayout(graph);
  assert.deepEqual(drawing.knots.map(k => [k.to, k.any]).sort(), [
    ["or", true],
    ["top", false]
  ]);
  assert.deepEqual(f.drawGraphLayout(graph), drawing);
});
