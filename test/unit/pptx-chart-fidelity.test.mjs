import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load(["pptxChartSpec", "pptxChartHtml", "setup: root => { parseXml = () => root; }"]);
function node(localName, attrs = {}, children = [], textContent = "") {
  return {
    localName,
    children,
    textContent,
    getAttribute: name => attrs[name] ?? null,
    getElementsByTagNameNS: (_ns, name) =>
      children.flatMap(child => [...(child.localName === name ? [child] : []), ...child.getElementsByTagNameNS(_ns, name)])
  };
}

const series = () => node("ser", {}, [node("val", {}, [node("pt", { idx: "0" }, [node("v", {}, [], "1")])])]);

test("组合图：不能把第一组单独当作完整图表", () => {
  // 两组都真有系列：只取第一组会把另一组的数据整个丢掉
  f.setup(node("root", {}, [node("plotArea", {}, [node("lineChart", {}, [series()]), node("barChart", {}, [series()])])]));
  assert.equal(f.pptxChartSpec("xml", new Map(), 1000000), null);
});

test("组合图：另一组只是没有系列的空壳时，照旧画得出来", () => {
  f.setup(node("root", {}, [node("plotArea", {}, [node("lineChart", {}, [series()]), node("barChart")])]));
  assert.equal(f.pptxChartSpec("xml", new Map(), 1000000).kind, "line");
});

test("折线标记：读取 symbol 子元素而非 marker 属性", () => {
  const marker = node("marker", {}, [node("symbol", { val: "none" })]);
  f.setup(node("root", {}, [node("plotArea", {}, [node("lineChart", {}, [node("ser", {}, [marker])])])]));
  assert.equal(f.pptxChartSpec("xml", new Map(), 1000000).sers[0].marker, "none");
});

for (const legend of ["l", "r"])
  test(`折线：${legend} 侧图例不消失`, () => {
    const ch = {
      kind: "line",
      legend,
      cats: ["A", "B"],
      accents: [],
      sers: ["First", "Second"].map(name => ({ name, color: "112233", vals: [1, 2] })),
      cat: {},
      val: { grid: {} }
    };
    const html = f.pptxChartHtml({ x: 0, y: 0, w: 1000, h: 600, ch }, 1);
    assert.match(html, />First</);
    assert.match(html, />Second</);
  });

test("柱：右侧图例画出来，且柱子不压在图例底下", () => {
  const ch = {
    kind: "bar",
    legend: "r",
    cats: ["A", "B"],
    accents: [],
    sers: ["First", "Second"].map(name => ({ name, color: "112233", colors: [], vals: [1, 2] })),
    cat: { labels: true },
    val: { labels: true, grid: {} },
    gap: 0,
    overlap: 0
  };
  const html = f.pptxChartHtml({ x: 0, y: 0, w: 1000, h: 600, ch }, 1),
    // 图例的小色块带圆角，柱子不带：用它把两种 rect 分开
    chips = [...html.matchAll(/<rect x="([\d.-]+)" y="[^"]*" width="[^"]*" height="[^"]*" rx="/g)].map(match => Number(match[1]));
  assert.ok(chips.length, "右侧图例要画出来");
  const rights = [...html.matchAll(/<rect x="([\d.-]+)" y="[^"]*" width="([\d.-]+)" height="[^"]*" fill="#/g)].map(
    match => Number(match[1]) + Number(match[2])
  );
  assert.ok(Math.max(...rights) <= Math.min(...chips), `柱子右缘 ${Math.max(...rights)} 越过了图例起点 ${Math.min(...chips)}`);
});
