// 工作区的路：拆成层、拼回去、上一层、与根拼一件。
// POSIX 的开头那一道斜杠丢不得——macOS 上真丢过：点路径里的一级，根就成了相对路径，整块工作区空掉
// （Windows 有 E: 打头，拼回去照样是绝对路径，所以本机测不出来）。根是 / 时也别拼出「一加一」的后斜杠。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("POSIX：拆层、拼回来都留着开头那一道斜杠；第一级不再往上", () => {
  const f = load(["workParts", "workAt", "workUp", "workJoin"]),
    root = "/Users/me/项目";
  assert.deepEqual(f.workParts(root), ["Users", "me", "项目"]);
  assert.equal(f.workAt(root, f.workParts(root), 1), "/Users");
  assert.equal(f.workAt(root, f.workParts(root), 3), root, "点最后一枚回到这一层，仍是整条绝对路径");
  assert.equal(f.workJoin(root, "子夹/深.md"), `${root}/子夹/深.md`);
  assert.equal(f.workUp(root), "/Users/me");
  assert.equal(f.workUp("/Users"), "", "第一级不再往上：/ 不能当工作目录");
  assert.equal(f.workUp("/"), "");
});

test("Windows 与 UNC 照旧", () => {
  const f = load(["workParts", "workAt", "workUp", "workJoin"]),
    root = "E:/项目/Note";
  assert.deepEqual(f.workParts(root), ["E:", "项目", "Note"]);
  assert.equal(f.workAt(root, f.workParts(root), 1), "E:");
  assert.equal(f.workAt(root, f.workParts(root), 2), "E:/项目");
  assert.equal(f.workJoin(root, "一页.txt"), `${root}/一页.txt`);
  assert.equal(f.workUp(root), "E:/项目");
  assert.equal(f.workUp("E:"), "", "盘符不能当工作目录，不再往上");
  const unc = "//nas/share/件";
  assert.deepEqual(f.workParts(unc), ["nas", "share", "件"]);
  assert.equal(f.workAt(unc, f.workParts(unc), 2), "//nas/share");
  assert.equal(f.workUp(unc), "//nas/share");
});

test("工作区跟随对话绑定，普通重画不打断走层，未绑定时仍用本机目录", () => {
  const f = load([
    "work",
    "workFollowConversation",
    "workRemember",
    `setup: () => {
      let c = null, stored = "/fallback";
      currentConversation = () => c;
      localStorage.getItem = () => stored;
      localStorage.setItem = (_key, value) => { stored = value; };
      return { set: value => { c = value; }, stored: () => stored };
    }`
  ]);
  const chat = f.setup();
  assert.equal(f.workFollowConversation(), true);
  assert.equal(f.work.root, "/fallback");
  chat.set({ id: "a", workdir: "/project/a" });
  assert.equal(f.workFollowConversation(), true);
  assert.equal(f.work.root, "/project/a");
  f.work.root = "/project/a/sub";
  f.workRemember();
  assert.equal(chat.stored(), "/fallback");
  assert.equal(f.workFollowConversation(), false);
  assert.equal(f.work.root, "/project/a/sub");
  chat.set({ id: "b", workdir: "/project/b" });
  assert.equal(f.workFollowConversation(), true);
  assert.equal(f.work.root, "/project/b");
  chat.set({ id: "b", workdir: "E:\\new" });
  assert.equal(f.workFollowConversation(), true);
  assert.equal(f.work.root, "E:/new");
  chat.set({ id: "b", workdir: "" });
  assert.equal(f.workFollowConversation(), true);
  assert.equal(f.work.root, "/fallback");
});
