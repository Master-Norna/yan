import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("收尾排的补言在路径换版后放回草稿，不在旧版另起一答", async () => {
  const f = load([
    "settleSupplements",
    "draftKey",
    "drafts: () => store.drafts",
    `setup: (conversation, start) => {
      store = { settings: {}, conversations: [conversation], drafts: {} };
      startTurn = start;
      rewindingOver = runningElsewhere = () => false;
      saveStore = toast = restoreDraft = () => {};
    }`
  ]);
  const assistant = { id: "a", status: "complete", steps: [{ id: "note" }] };
  const conversation = { id: "c", messages: [assistant] };
  let starts = 0;
  f.setup(conversation, async () => { starts++; });
  const job = { queue: [{ user: { content: "补充", attachments: [] }, step: { id: "note" } }] };
  assert.equal(f.settleSupplements(conversation, assistant, job, {}), true);
  conversation.messages = [{ id: "new", status: "complete" }];
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(starts, 0);
  assert.equal(f.drafts()[f.draftKey("c")].text, "补充");
});
