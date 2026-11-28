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
    "historyPlacement",
    "compareHistoryMembers",
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
      deleteConversationStorage = async id => { deleted.push(id); return true; };
      canCleanAttachments = () => true;
      let cleanup;
      const remove = deleteStoredConversations;
      deleteStoredConversations = entries => (cleanup = remove(entries));
      return () => cleanup;
    }`
  ]);
  f.store.conversations = conversations;
  f.store.settings.groups = [{ id: "g1", name: "诗书" }];
  f.store.settings.workdirNames = { [dir]: "言记" };
  const settleDeletes = f.install(() => new Promise(resolve => (approve = resolve)), deleted, files, notices);
  return { f, deleted, files, notices, settleDeletes, approve: () => approve(true) };
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

test("目录键与集组保序键恰好同名，也只删工组里的对话", async () => {
  const workdir = "group:g1";
  const { f, deleted, approve } = setup([
    conversation("grouped", { groupId: "g1", workdir }),
    conversation("repo", { groupId: "missing", workdir }),
    conversation("pinned", { pinned: true, workdir })
  ]);
  const pending = f.removeWorkdirGroup(workdir);
  approve();
  await pending;
  assert.deepEqual(deleted, ["repo"]);
});

for (const kind of ["目录组", "单条"]) {
  test(`${kind}删除使用确认后按 id 读回的新版记录清理附件`, async () => {
    const { f, deleted, files, approve, settleDeletes } = setup([conversation("c1")]);
    const pending = kind === "目录组" ? f.removeWorkdirGroup(dir) : f.deleteConversation("c1");
    f.store.conversations = [conversation("c1", { messages: [{ id: "m1", role: "user", attachments: [{ id: "new-file" }] }] })];
    approve();
    await pending;
    assert.deepEqual(deleted, ["c1"]);
    await settleDeletes();
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

test("置顶不改变目录或显式分组归属，组内先置顶再按时间", () => {
  const { f } = setup([]);
  const older = conversation("older", { pinned: true, updatedAt: "2026-11-13T00:00:00Z" });
  const newer = conversation("newer");
  assert.equal(f.historyPlacement(older), "repo");
  assert.equal(f.historyPlacement({ ...older, groupId: "g1" }), "set");
  assert.equal(f.historyPlacement({ ...older, workdir: "" }), "pinned");
  assert.equal(f.historyPlacement({ ...newer, workdir: "" }), "chat");
  assert.deepEqual([newer, older].sort(f.compareHistoryMembers).map(c => c.id), ["older", "newer"]);
  assert.deepEqual([older, { ...newer, pinned: true }].sort(f.compareHistoryMembers).map(c => c.id), ["newer", "older"]);
});

test("只剩置顶的目录组不会批量删除", async () => {
  const { f, deleted, notices } = setup([conversation("pinned", { pinned: true })]);
  await f.removeWorkdirGroup(dir);
  assert.deepEqual(deleted, []);
  assert.equal(notices.at(-1), "此组只有置顶对话，暂不删除");
});
