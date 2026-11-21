// 收尾时把没递出去的补言放回案上（见 14-chat-engine/10-send.js 的 putBack）：话、引文、附件三样都得回来。
// 补言带的附件本来只在那一问里，放回案上后就该在附件条里看得见——由 restoreDraft 一并画，这条路不走整页 render。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const picture = { id: "a1", name: "图.png", size: 2048, kind: "image" };

function fixture(draft) {
  const probe = { drawn: 0, boxes: {} };
  const f = load([
    "restoreDraft",
    "attachments: () => pendingAttachments",
    "pendingQuote",
    "currentId",
    "store",
    `setup: probe => {
      const box = () => ({
        classList: { toggle() {} },
        style: {},
        innerHTML: "",
        value: "",
        scrollHeight: 0,
        clientHeight: 0,
        addEventListener() {},
        querySelector: () => ({ textContent: "", innerHTML: "", style: {}, classList: { toggle() {} } })
      });
      currentId = "c1";
      view = "chat";
      pendingAttachments = [];
      pendingQuote = null;
      store.drafts = { c1: probe.draft };
      // 画到测试拿得到的盒子里：真 renderAttachments 写的是 #attachments / #welcomeAttachments 的 innerHTML
      document.querySelector = sel => (probe.boxes[sel] ||= box());
      loadThumbnails = async () => {};
      renderSendButtons = () => {};
      scheduleContextGauge = () => {};
      stageQuoteChanged = () => {};
    }`
  ]);
  f.setup(Object.assign(probe, { draft }));
  return { f, probe };
}

test("收尾放回案上的补言：附件条里看得见那几件，与案上的记录一致", () => {
  const { f, probe } = fixture({ text: "接着写", attachments: [picture], quote: null, updatedAt: 1 });
  f.restoreDraft();
  assert.deepEqual(
    f.attachments().map(file => file.id),
    ["a1"],
    "附件回到了案上"
  );
  const html = probe.boxes["#attachments"].innerHTML;
  assert.match(html, /图\.png/, "附件条里画出了这一件");
  assert.equal(probe.boxes["#welcomeAttachments"].innerHTML, html, "欢迎页那份案子同一批件，一起画");
});

test("案上原来就有的件与放回来的件并在一处，画的是合并后那一份", () => {
  const { f, probe } = fixture({
    text: "原来写的",
    attachments: [picture, { ...picture, id: "a2", name: "表.csv", kind: "text" }],
    quote: null,
    updatedAt: 1
  });
  f.restoreDraft();
  assert.deepEqual(
    f.attachments().map(file => file.id),
    ["a1", "a2"]
  );
  assert.match(probe.boxes["#attachments"].innerHTML, /图\.png/);
  assert.match(probe.boxes["#attachments"].innerHTML, /表\.csv/);
});
