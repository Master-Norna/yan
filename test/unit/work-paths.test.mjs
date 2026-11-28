// 用真实的面包屑输出及列表行复核路径，避免只覆盖未接入界面的辅助函数。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("POSIX：可点的上级带绝对路径，文件与文件夹行不丢开头的斜杠", () => {
  const { work, workCrumbsHtml, workRows } = load(["work", "workCrumbsHtml", "workRows"]);
  work.root = "/Users/me/项目";
  work.dirs = [{ path: "子夹", name: "子夹" }];
  work.entries = [{ path: "笔记.md", name: "笔记.md", size: 1, modifiedAt: "2026-11-28T00:00:00Z" }];
  const crumbs = workCrumbsHtml();
  assert.match(crumbs, /data-work-dir="\/Users"/);
  assert.match(crumbs, /data-work-dir="\/Users\/me"/);
  assert.match(crumbs, /data-work-pick title="\/Users\/me\/项目"/);
  assert.deepEqual(
    workRows().map(row => row.path),
    ["/Users/me/项目/子夹", "/Users/me/项目/笔记.md"]
  );
});

test("Windows 与 UNC：盘符与主机名不设链接，路径仍保留各自前缀", () => {
  const { work, workCrumbsHtml } = load(["work", "workCrumbsHtml"]);
  work.root = "E:/项目/Note";
  const win = workCrumbsHtml();
  assert.doesNotMatch(win, /data-work-dir="E:"/);
  assert.match(win, /data-work-dir="E:\/项目"/);
  work.root = "//nas/share/件";
  const unc = workCrumbsHtml();
  assert.doesNotMatch(unc, /data-work-dir="\/\/nas"/);
  assert.match(unc, /data-work-pick title="\/\/nas\/share\/件"/);
});

test("工作区跟随对话绑定，普通重画不打断走层，未绑定时跟随卷宗", () => {
  const f = load([
    "work",
    "workFollowConversation",
    `setup: () => {
      let c = null, archive = "/archive";
      currentConversation = () => c;
      archiveDir = () => archive;
      return { set: value => { c = value; }, setArchive: value => { archive = value; } };
    }`
  ]);
  const chat = f.setup();
  assert.equal(f.workFollowConversation(), true);
  assert.equal(f.work.root, "/archive");
  chat.set({ id: "a", workdir: "/project/a" });
  assert.equal(f.workFollowConversation(), true);
  assert.equal(f.work.root, "/project/a");
  f.work.root = "/project/a/sub";
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
  assert.equal(f.work.root, "/archive");
  chat.setArchive("/new-archive");
  assert.equal(f.workFollowConversation(), true);
  assert.equal(f.work.root, "/new-archive");
});

test("工作区夹的数量和日期复用卷宗格式，未知数量不当作空夹", () => {
  const { work, workRows, workRowHtml, folderCountNote, formatDay } = load([
    "work",
    "workRows",
    "workRowHtml",
    "folderCountNote",
    "formatDay"
  ]);
  const modifiedAt = "2026-11-28T00:00:00Z";
  work.root = "C:/one";
  work.dirs = [
    { path: "A", name: "A", files: 12, folders: 3, modifiedAt },
    { path: "B", name: "B", files: 0, folders: 0, modifiedAt },
    { path: "C", name: "C", modifiedAt }
  ];
  const rows = workRows();
  assert.deepEqual(
    rows.map(row => [row.note, row.when]),
    [
      [folderCountNote(12, 3), formatDay(modifiedAt)],
      [folderCountNote(0, 0), formatDay(modifiedAt)],
      ["", formatDay(modifiedAt)]
    ]
  );
  assert.match(workRowHtml(rows[0]), /12 件 · 3 夹/);
  assert.ok(workRowHtml(rows[0]).includes(formatDay(modifiedAt)));
  assert.match(workRowHtml(rows[1]), /空/);
});


test("POSIX 根可浏览且不混同不同大小写的目录", () => {
  const { work, workCrumbsHtml, workRows, slashed, joinFile, relInside } = load(["work", "workCrumbsHtml", "workRows", "slashed", "joinFile", "relInside"]);
  assert.equal(slashed("/"), "/");
  assert.equal(joinFile("/", "a"), "/a");
  assert.equal(relInside("/", "/a"), "a");
  assert.equal(relInside("/Home", "/home/a"), null);
  assert.equal(relInside("C:/Home", "c:/home/a"), "a");
  work.root = "/";
  work.dirs = [{ path: "home", name: "home" }];
  assert.match(workCrumbsHtml(), /data-work-pick/);
  assert.equal(workRows()[0].path, "/home");
  work.root = "/home";
  assert.match(workCrumbsHtml(), /data-work-dir="\/"/);
});
