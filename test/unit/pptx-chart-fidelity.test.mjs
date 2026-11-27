import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load([
  "pptxChartSpec",
  "pptxChartHtml",
  `setup: root => {
    parseXml = () => root;
    xmlKids = (node, name) => (node?.children || []).filter(child => child.localName === name);
    xmlDeep = (node, name) => (node?.children || []).flatMap(child => [
      ...(child.localName === name ? [child] : []), ...xmlDeep(child, name)
    ]);
  }`
]);
function node(localName, attrs = {}, children = [], textContent = "") {
  return { localName, children, textContent, getAttribute: name => attrs[name] ?? null };
}

test("组合图：不能把第一组单独当作完整图表", () => {
  f.setup(node("root", {}, [node("plotArea", {}, [node("lineChart"), node("barChart")])]));
  assert.equal(f.pptxChartSpec("xml", new Map(), 1000000), null);
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
      sers: ["First", "Second"].map(name => ({ name, color: "112233", vals: [1, 2] })),
      cat: {},
      val: { grid: {} }
    };
    const html = f.pptxChartHtml({ x: 0, y: 0, w: 1000, h: 600, ch }, 1);
    assert.match(html, />First</);
    assert.match(html, />Second</);
  });
