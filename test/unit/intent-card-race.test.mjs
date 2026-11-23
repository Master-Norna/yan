import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const intent = tag => ({ nodes: {}, log: [], tag });

function viewer(read) {
  const f = load([
    "openIntentCard",
    "closeFileViewer",
    "showInFileViewer",
    "doc: () => document",
    "card: () => intentCard",
    `setup: read => {
      readIntent = read;
      intentPrints = async () => ({}); isWork = () => true; workdirName = c => c.id;
      intentCardHtml = intent => '<div class="intent-card">' + intent.tag + '</div>';
      listenViewerClosed = closeExpandedWork = () => {};
    }`
  ]);
  const query = f.doc().querySelector,
    nodes = new Map();
  const node = selector => {
    if (selector === ".work-expanded") return null;
    if (!nodes.has(selector)) {
      const classes = new Set(["hidden"]);
      nodes.set(selector, {
        innerHTML: "",
        textContent: "",
        dataset: {},
        classList: { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n) },
        focus() {},
        querySelector(selector) {
          return selector === ".intent-card" && this.innerHTML.includes('class="intent-card"') ? {} : null;
        }
      });
    }
    return nodes.get(selector);
  };
  f.doc().querySelector = node;
  f.setup(read);
  return {
    f,
    node,
    restore: () => {
      f.doc().querySelector = query;
    }
  };
}

for (const fail of [false, true])
  test(`图 A 还在读取时打开 B：A 迟到的${fail ? "错误" : "结果"}不覆盖 B`, async () => {
    const gate = deferred();
    const { f, node, restore } = viewer(c => (c.id === "A" ? gate.promise : Promise.resolve({ intent: intent(c.id) })));
    try {
      const opening = f.openIntentCard({ id: "A" });
      await f.openIntentCard({ id: "B" });
      if (fail) gate.reject(Error("A 未读成"));
      else gate.resolve({ intent: intent("A") });
      await opening;
      assert.equal(f.card().conversation.id, "B");
      assert.equal(node("#fileViewerStage").innerHTML, '<div class="intent-card">B</div>');
    } finally {
      restore();
    }
  });
