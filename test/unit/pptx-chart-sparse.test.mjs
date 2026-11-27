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
const pt = (index, value) => node("pt", { idx: String(index) }, [node("v", {}, [], value)]);
const cache = (tag, points) => node(tag, {}, [node("ptCount", { val: "4" }), ...points]);
// 空单元格就是跳号：类别四项都写了，数值只写第 0、2、3 项（第 1 项没写 c:pt）
const sparseChart = () =>
  node("root", {}, [
    node("plotArea", {}, [
      node("pieChart", {}, [
        node("ser", {}, [
          node("cat", {}, [
            cache(
              "strCache",
              [0, 1, 2, 3].map(index => pt(index, `c${index}`))
            )
          ]),
          node("val", {}, [cache("numCache", [pt(0, "10"), pt(2, "30"), pt(3, "40")])])
        ])
      ])
    ])
  ]);

test("数据缓存跳号：空单元格补成 null，稀疏数组不漏给图例", () => {
  f.setup(sparseChart());
  assert.deepEqual(f.pptxChartSpec("xml", new Map(), 1000000).sers[0].vals, [10, null, 30, 40]);
});

for (const legend of ["b", "r"])
  test(`数据缓存跳号：${legend} 图例照常列出各项，几何里没有 NaN`, () => {
    f.setup(sparseChart());
    const spec = f.pptxChartSpec("xml", new Map(), 1000000);
    // 底部图例原先按项遍历会撞上空位，抛错后整份预览退成「未能预览」；
    // 右侧图例则是量宽度撞上 NaN，扇形与图例一起挪到框外。
    const svg = f.pptxChartHtml({ x: 0, y: 0, w: 1000, h: 600, ch: { ...spec, legend } }, 1);
    assert.ok(!/NaN/.test(svg), "几何里不该出现 NaN");
    assert.match(svg, />c0</);
    assert.match(svg, />c3</);
  });
