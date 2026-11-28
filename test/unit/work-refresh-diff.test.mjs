import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 同一答再次改了同一件：列表刷新时，正显示着的 diff 也该换到新的一笔，而不是停在第一次；别的预览不碰。
// 页面代码在载入时就会取几个元素，桩得带上常用成员；上个用例换过的 document.querySelector 也照同一份桩还原。
function fixture(inStage, other) {
  return load([
    "work",
    "workPaintOpenDiff",
    `setup: () => {
      work.open = true;
      work.tabs = [{ path: "C:/w/a.md", diff: true }];
      work.active = 0;
      stageShown = () => true;
      latestChangeReply = () => ({ id: "a1" });
      workDiffHtml = (message, path) => "<div class='file-viewer-text change-diff'>" + message.id + ":" + path + "</div>";
      const stage = {
        scrollTop: 37,
        innerHTML: "<div class='file-viewer-text change-diff'>old</div>",
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        dataset: {},
        style: { setProperty() {}, removeProperty() {} },
        addEventListener() {},
        setAttribute() {},
        removeAttribute() {},
        getAttribute: () => null,
        querySelectorAll: () => [],
        querySelector: selector => (selector === ".change-diff" && ${inStage} ? {} : null)
      };
      document.querySelector = selector => (selector === "#fileViewerStage" ? stage : ${other});
      return stage;
    }`
  ]);
}

test("同答再改同一件：正显示着的 diff 换到新的一笔，滚动不动", () => {
  const f = fixture(true, "stage"),
    stage = f.setup();
  f.workPaintOpenDiff();
  assert.match(stage.innerHTML, /a1:C:\/w\/a\.md/);
  assert.equal(stage.scrollTop, 37);
});

test("显示的是一份普通文件时不碰", () => {
  const f = fixture(false, "null"),
    stage = f.setup();
  f.workPaintOpenDiff();
  assert.equal(stage.innerHTML, "<div class='file-viewer-text change-diff'>old</div>");
});
