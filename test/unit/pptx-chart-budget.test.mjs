import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load(["pptxChartSpec", "setup: root => { parseXml = () => root; }"]);
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
function chart(index) {
  const pt = node("pt", { idx: index }, [node("v", {}, [], "42")]);
  const ser = node("ser", {}, [node("val", {}, [pt])]);
  return node("root", {}, [node("plotArea", {}, [node("barChart", {}, [ser])])]);
}

test("图表缓存：拒绝异常稀疏或非整数下标，普通缓存照常读取", () => {
  for (const index of ["1000000000", "-1", "1.5"]) {
    f.setup(chart(index));
    assert.equal(f.pptxChartSpec("xml", new Map(), 1000000), null);
  }
  f.setup(chart("0"));
  assert.deepEqual(f.pptxChartSpec("xml", new Map(), 1000000).sers[0].vals, [42]);
});
