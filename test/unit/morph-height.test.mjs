import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("开合半途反向：量眼前高度，撤旧动画后再量末态", () => {
  const { morphHeight, document } = load(["morphHeight", "document"]);
  const previous = document.documentElement.dataset.inkMotion;
  document.documentElement.dataset.inkMotion = "on";
  try {
    let natural = 100,
      visible = null,
      frames;
    const el = {
      getBoundingClientRect: () => ({ height: visible ?? natural }),
      animate(next) {
        frames = next;
        visible = 70;
        return {
          cancel() {
            visible = null;
          }
        };
      }
    };
    morphHeight(el, () => (natural = 30));
    morphHeight(el, () => (natural = 100));
    assert.deepEqual(frames.map(frame => frame.height), ["70px", "100px"]);
    document.documentElement.dataset.inkMotion = "off";
    morphHeight(el, () => (natural = 30));
    assert.equal(visible, null);
    assert.equal(natural, 30);
  } finally {
    document.documentElement.dataset.inkMotion = previous;
  }
});
