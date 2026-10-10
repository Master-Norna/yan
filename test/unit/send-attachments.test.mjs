import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

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
