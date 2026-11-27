import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { pptxChartHtml } = load(["pptxChartHtml"]);
function render(kind, grouping, values) {
  const ch = {
    kind,
    grouping,
    cats: ["A"],
    sers: values.map((vals, i) => ({ vals, colors: [], color: ["aa0000", "00aa00", "0000aa"][i], name: String(i) })),
    accents: [],
    cat: { labels: true },
    val: { labels: true, grid: {} },
    gap: 150,
    overlap: 100,
    hole: 50
  };
  return pptxChartHtml({ x: 0, y: 0, w: 1000, h: 600, ch }, 1);
}

test("堆叠：正负各自累加，数轴涵盖两边", () => {
  const html = render("bar", "stacked", [[40], [-30], [20]]);
  assert.match(html, />-30<|>-40</);
  assert.match(html, />60<|>80</);
  const bars = [...html.matchAll(/<rect x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)" fill="#(?:aa0000|00aa00|0000aa)"/g)];
  assert.equal(bars.length, 3);
  const [[, firstY, firstH], [, negativeY], [, lastY, lastH]] = bars;
  assert.ok(Math.abs(Number(firstY) + Number(firstH) - Number(negativeY)) < 0.3);
  assert.ok(Math.abs(Number(lastY) + Number(lastH) - Number(firstY)) < 0.3);
});

test("百分比堆叠：负值不翻成正值", () => {
  const html = render("bar", "percentStacked", [[50], [-50]]);
  assert.match(html, />-100</);
  assert.match(html, />100</);
});

for (const kind of ["pie", "doughnut"])
  test(`${kind}：单个非零扇形画完整圆`, () => {
    const html = render(kind, "", [[10]]);
    const d = /<path d="([^"]+)"/.exec(html)?.[1] || "";
    assert.equal((d.match(/ A/g) || []).length, kind === "pie" ? 2 : 4);
  });
