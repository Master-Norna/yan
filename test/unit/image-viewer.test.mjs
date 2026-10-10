import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function viewer() {
  const f = load([
    "openImageViewer",
    "openArchiveImage",
    "closeImageViewer",
    "doc: () => document",
    "setup: read => { getAttachment = read; toast = () => {}; }"
  ]);
  const query = f.doc().querySelector;
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) {
      const classes = new Set(["hidden"]);
      nodes.set(selector, {
        classList: { contains: n => classes.has(n), add: n => classes.add(n), remove: n => classes.delete(n) },
        setAttribute() {},
        removeAttribute(n) {
          delete this[n];
        },
        focus() {},
        src: "",
        textContent: ""
      });
    }
    return nodes.get(selector);
  };
  f.doc().querySelector = node;
  return { f, node, restore: () => (f.doc().querySelector = query) };
}
const image = id => ({ id, kind: "image", name: `${id}.png`, data: id, size: 1 });

for (const next of ["attachment", "archive", "close"])
  test(`图片还在读取时${next === "close" ? "收起" : "换到" + (next === "archive" ? "卷宗图片" : "另一张图片")}：迟到的结果不再改画面`, async () => {
    const { f, node, restore } = viewer();
    let release;
    const gate = new Promise(resolve => (release = resolve));
    f.setup(id => (id === "A" ? gate : Promise.resolve(image(id))));
    try {
      await f.openImageViewer("B");
      const loading = f.openImageViewer("A");
      if (next === "attachment") await f.openImageViewer("C");
      else if (next === "archive") f.openArchiveImage("archive.png");
      else f.closeImageViewer();
      const expected = node("#imageViewerImage").src;
      release(image("A"));
      await loading;
      assert.equal(node("#imageViewerImage").src, expected);
      assert.equal(node("#imageViewer").classList.contains("hidden"), next === "close");
    } finally {
      release(image("A"));
      restore();
    }
  });
