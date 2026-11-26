import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup(t, host, following) {
  const f = load([
    "scrollSnapshot",
    "restoreScrollPosition",
    "document",
    "setup: following => { currentId = 'chat'; view = 'chat'; followBottom = following; }"
  ]);
  const query = f.document.querySelector;
  t.after(() => (f.document.querySelector = query));
  f.document.querySelector = selector => (selector === "#chatScroll" ? host : query(selector));
  f.setup(following);
  return f;
}

test("贴底只保存跟随，不扫描旧消息；恢复时按新高度贴底", t => {
  const host = {
    scrollTop: 800,
    clientHeight: 400,
    scrollHeight: 1200,
    getBoundingClientRect: () => ({ top: 0 }),
    querySelectorAll: () => assert.fail("跟随时不需要找阅读锚点")
  };
  const { scrollSnapshot, restoreScrollPosition } = setup(t, host, true);
  const snapshot = scrollSnapshot();
  host.scrollHeight += 250;
  restoreScrollPosition(snapshot);
  assert.equal(host.scrollTop, 1050);
});

test("不跟随时照旧按消息锚点恢复阅读位置", t => {
  let anchorTop = 80;
  const anchor = { dataset: { message: "m1" }, getBoundingClientRect: () => ({ top: anchorTop, bottom: anchorTop + 100 }) };
  const host = {
    scrollTop: 300,
    clientHeight: 400,
    scrollHeight: 1200,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelectorAll: () => [anchor],
    querySelector: selector => (selector === '[data-message="m1"]' ? anchor : null)
  };
  const { scrollSnapshot, restoreScrollPosition } = setup(t, host, false);
  const snapshot = scrollSnapshot();
  anchorTop += 90;
  restoreScrollPosition(snapshot);
  assert.equal(host.scrollTop, 390);
});
