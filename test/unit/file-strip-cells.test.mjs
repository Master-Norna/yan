import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("共用四列外壳保留各视图的操作，日期只转义一次", () => {
  const { fileStripCells } = load(["fileStripCells"]);
  const cells = fileStripCells("icon", '<span class="strip-name">name</span>', "<span>size</span>", "a<b", "<button>操作</button>");
  assert.equal(
    cells,
    '<span>icon</span><span class="strip-name">name</span><span>size</span><span class="strip-date"><span class="strip-when">a&lt;b</span><button>操作</button></span>'
  );
  assert.doesNotMatch(fileStripCells("icon", "", "", ""), /button/);
});
