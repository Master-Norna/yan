// 确认框等着时，别的页面仍可接手作答、改归组或换进新版记录；点确认只能删除原来选中且仍可删除的对话。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const dir = "C:/项目/言";
const conversation = (id, extra = {}) => ({
  id,
  title: id,
  workdir: dir,
  updatedAt: "2026-11-14T00:00:00Z",
  messages: [],
  forks: [],
  threads: [],
  ...extra
});

function setup(conversations) {
  let approve;
  const deleted = [],
    files = [],
    notices = [];
  const f = load([
    "store",
    "remoteBusy",
    "removeWorkdirGroup",
    "deleteConversation",
    `install: (confirm, deleted, files, notices) => {
      askConfirm = confirm;
      saveStore = () => {};
      render = () => {};
      toast = text => notices.push(text);
      haltConversation = () => {};
      clearDraft = () => {};
      cleanScratch = async () => {};
      deleteAttachments = async ids => { files.push(...ids); };
      deleteConversationStorage = async id => { deleted.push(id); };
    }`
  ]);
  f.store.conversations = conversations;
  f.store.settings.groups = [{ id: "g1", name: "诗书" }];
  f.store.settings.workdirNames = { [dir]: "言记" };
  f.install(() => new Promise(resolve => (approve = resolve)), deleted, files, notices);
  return { f, deleted, files, notices, approve: () => approve(true) };
}

test("删目录组确认后重查占用和归属，不带走新加入或已离组的对话", async () => {
  const { f, deleted, notices, approve } = setup(
    ["keep-busy", "keep-grouped", "keep-pinned", "keep-moved", "gone", "remove"].map(id => conversation(id))
  );
  const pending = f.removeWorkdirGroup(dir);
  f.remoteBusy.add("keep-busy");
  f.store.conversations = f.store.conversations
    .filter(c => c.id !== "gone")
    .map(c => ({
      ...c,
      ...(c.id === "keep-grouped" ? { groupId: "g1" } : {}),
      ...(c.id === "keep-pinned" ? { pinned: true } : {}),
      ...(c.id === "keep-moved" ? { workdir: "C:/别处" } : {})
    }));
  f.store.conversations.push(conversation("newcomer"));
  approve();
  await pending;
  assert.deepEqual(deleted, ["remove"]);
  assert.deepEqual(
    f.store.conversations.map(c => c.id),
    ["keep-busy", "keep-grouped", "keep-pinned", "keep-moved", "newcomer"]
  );
  assert.equal(notices.at(-1), "已删除 1 段对话");
  assert.equal(f.store.settings.workdirNames[dir], "言记");
});

for (const kind of ["目录组", "单条"]) {
  test(`${kind}删除使用确认后按 id 读回的新版记录清理附件`, async () => {
    const { f, deleted, files, approve } = setup([conversation("c1")]);
    const pending = kind === "目录组" ? f.removeWorkdirGroup(dir) : f.deleteConversation("c1");
    f.store.conversations = [conversation("c1", { messages: [{ id: "m1", role: "user", attachments: [{ id: "new-file" }] }] })];
    approve();
    await pending;
    assert.deepEqual(deleted, ["c1"]);
    assert.deepEqual(files, ["new-file"]);
    assert.deepEqual(f.store.conversations, []);
  });

  test(`${kind}删除跳过确认期间被另一页接手的对话`, async () => {
    const { f, deleted, files, notices, approve } = setup([conversation("c1")]);
    const pending = kind === "目录组" ? f.removeWorkdirGroup(dir) : f.deleteConversation("c1");
    f.remoteBusy.add("c1");
    approve();
    await pending;
    assert.deepEqual(deleted, []);
    assert.deepEqual(files, []);
    assert.equal(f.store.conversations[0].id, "c1");
    assert.equal(f.store.settings.workdirNames[dir], "言记");
    assert.equal(notices.at(-1), kind === "目录组" ? "这一组已没有对话" : "此对话正在另一页面作答，暂不能删除");
  });
}
