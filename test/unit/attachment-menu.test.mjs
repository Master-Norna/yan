import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./harness.mjs";

test("有原件的待发附件与已发附件都可聚焦，待发压缩包不冒充预览按钮", () => {
  const { attachmentCard } = load(["attachmentCard"]);
  const tag = (name, sent) => attachmentCard({ id: "original", name, kind: "file" }, sent ? null : 0, sent).split(">")[0];
  const document = tag("report.md", false),
    zip = tag("bundle.zip", false),
    sent = tag("bundle.zip", true);
  for (const card of [document, zip, sent]) {
    assert.match(card, /data-drag-attachment="original"/);
    assert.match(card, /tabindex="0"/);
    assert.match(card, /aria-keyshortcuts="Shift\+F10"/);
  }
  assert.match(document, /data-open-attachment=/);
  assert.doesNotMatch(zip, /role="button"|data-open-attachment=|data-download-attachment=/);
  assert.match(sent, /data-download-attachment=/);
});

test("附件右键和 Shift+F10 共用菜单与原件收存入口，取消不收存", t => {
  const events = {},
    calls = [],
    menus = [];
  const ui = load([
    "document",
    "bindAttachmentEvents",
    `setup: (menu, save) => {
      openMenu = menu;
      saveDraggedAttachment = async (...args) => save(...args);
    }`
  ]);
  t.mock.method(ui.document, "addEventListener", (name, fn) => (events[name] = fn));
  let focus;
  const card = {
    dataset: { dragAttachment: "original" },
    matches: selector => selector === ".attachment-card[data-drag-attachment]",
    focus: () => (focus = card)
  };
  ui.setup(
    (anchor, items) => {
      const button = { focus: () => (focus = button) },
        handlers = {};
      menus.push({ anchor, items, handlers, button });
      return { querySelector: () => button, addEventListener: (name, handler) => (handlers[name] = handler) };
    },
    (...args) => calls.push(args)
  );
  ui.bindAttachmentEvents();
  const fire = (type, event) => {
    let prevented = false;
    events[type]({ ...event, preventDefault: () => (prevented = true) });
    return prevented;
  };
  assert.equal(fire("contextmenu", { target: { closest: () => null } }), false);
  assert.equal(fire("keydown", { key: "F10", target: card }), false);
  assert.equal(fire("contextmenu", { target: { closest: selector => (card.matches(selector) ? card : null) } }), true);
  assert.equal(menus[0].anchor, card);
  assert.equal(focus, menus[0].button);
  menus[0].handlers.keydown({ key: "Escape" });
  assert.equal(focus, card);
  assert.deepEqual(calls, []);

  assert.equal(fire("keydown", { key: "F10", shiftKey: true, target: card }), true);
  assert.equal(menus[1].anchor, card);
  assert.equal(focus, menus[1].button);
  assert.equal(menus[1].items.length, 1);
  assert.equal(menus[1].items[0].label, "收入卷宗");
  menus[1].items[0].run();
  assert.deepEqual(calls, [["original"]]);
  assert.equal(focus, card);
});
