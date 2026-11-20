import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("附件引用共用消息遍历；用量按原件去重，待发和发送快照只保留不计量", () => {
  const f = load([
    "store",
    "everyMessage",
    "attachmentIds",
    "attachmentKeepIds",
    "usedAttachmentBytes",
    `setup: (pending, held) => { pendingAttachments = pending; holdAttachments(held); }`
  ]);
  const file = (id, size = 1) => ({ id, size }),
    c = {
      messages: [
        {
          attachments: [file("main"), file("shared", 100)],
          steps: [{ attachments: [file("step")], sub: { steps: [{ attachments: [file("helper")] }] } }],
          cold: { files: [file("cold")] }
        }
      ],
      forks: [{ messages: [{ attachments: [file("fork")] }] }],
      threads: [{ messages: [{ attachments: [file("side")] }] }]
    },
    messageIds = ["main", "shared", "step", "helper", "cold", "fork", "side"];
  f.store.conversations = [c];
  f.store.drafts = { c: { attachments: [file("draft"), file("shared", 10)] } };
  f.setup([file("pending", 1000)], [file("held", 1000)]);
  assert.deepEqual(f.attachmentIds(f.everyMessage(c)), messageIds);
  assert.deepEqual(f.attachmentKeepIds(), new Set([...messageIds, "draft", "pending", "held"]));
  assert.equal(f.usedAttachmentBytes(), 17);
});

for (const ready of [true, false])
  test(ready ? "发送准备期间摘掉附件：已点发送的那份原件留到消息接手" : "发送准备失败：等待时摘掉的附件原件仍会清掉", async () => {
    let release;
    const gate = new Promise(resolve => (release = resolve));
    const removed = [];
    const field = { value: "查看附件", style: {} };
    const file = { id: "f", name: "file.txt", kind: "text", size: 1 };
    const f = load([
      "sendOrStop",
      "deleteAttachments",
      "attachmentKeepIds",
      "doc: () => document",
      "state: () => store",
      "remove: () => { pendingAttachments = []; store.drafts.c = { text: '查看附件', attachments: [], quote: null }; }",
      "setup: (field, file, gate, removed) => { store.conversations = [{ id: 'c', messages: [], forks: [], threads: [] }]; currentId = 'c'; store.drafts = {}; pendingAttachments = [file]; pendingQuote = null; document.querySelector = () => field; renderSendButtons = renderAttachments = renderQuote = () => {}; activeProfile = () => ({ id: 'p' }); quotaBlocked = () => false; prepareTurn = () => gate; startTurn = async (c, user) => { c.messages.push(user); }; deleteAttachment = async id => { removed.push(id); }; }"
    ]);
    const query = f.doc().querySelector;
    let sending;
    try {
      f.setup(field, file, gate, removed);
      sending = f.sendOrStop();
      f.remove();
      await f.deleteAttachments([file.id]);
      assert.deepEqual(removed, []);
      assert.ok(f.attachmentKeepIds().has(file.id));
      release(ready);
      await sending;
      await Promise.resolve();
      if (ready) {
        assert.equal(f.state().conversations[0].messages[0].attachments[0].id, file.id);
        assert.deepEqual(removed, []);
      } else {
        assert.deepEqual(f.state().conversations[0].messages, []);
        assert.deepEqual(removed, [file.id]);
        assert.equal(f.attachmentKeepIds().has(file.id), false);
      }
    } finally {
      release(ready);
      await sending;
      f.doc().querySelector = query;
    }
  });
