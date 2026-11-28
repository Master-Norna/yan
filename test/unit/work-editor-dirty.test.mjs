import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("保存中把输入改回旧文，未结清仍算脏", () => {
  const f = load(["workDrafts", "workDirty"]);
  f.workDrafts.set("a.txt", { base: "A", text: "B", sig: "s", saving: true, sent: "B" });
  assert.equal(f.workDirty("a.txt"), true);
  // 回执未到，输入改回 A：盘上可能已写成 B，这一答还没结清，不能当作没改
  f.workDrafts.get("a.txt").text = "A";
  assert.equal(f.workDirty("a.txt"), true);
  // 回执到了（base 换成 B、sent 清掉），输入仍是 A：照常算脏
  Object.assign(f.workDrafts.get("a.txt"), { base: "B", saving: false, sent: undefined });
  assert.equal(f.workDirty("a.txt"), true);
  // 结清且一致：不脏
  f.workDrafts.get("a.txt").text = "B";
  assert.equal(f.workDirty("a.txt"), false);
});

test("保存提交出去的那份留在手上，直到回执结清", async () => {
  const f = load([
    "work",
    "workDrafts",
    "workDirty",
    "workSaveEditor",
    `setup: () => {
      let release;
      bridge = () => new Promise(resolve => { release = resolve; });
      toast = () => {};
      workPaintTabs = () => {};
      workRefresh = async () => {};
      work.open = false;
      const draft = { scope: { workdir: "C:/w", path: "a.txt", roam: false }, base: "A", text: "B", sig: "s1", saving: false };
      workDrafts.set("a.txt", draft);
      const done = workSaveEditor({ path: "a.txt" });
      return { draft, done, finish: data => release(data) };
    }`
  ]);
  const { draft, done, finish } = f.setup();
  assert.equal(draft.saving, true);
  assert.equal(draft.sent, "B");
  // 写入已发生、回执未到，输入改回 A：离页保护仍要拦
  draft.text = "A";
  assert.equal(f.workDirty("a.txt"), true);
  finish({ sig: "s2" });
  await done;
  assert.equal(draft.saving, false);
  assert.equal(draft.sent, undefined);
  assert.equal(draft.base, "B");
  assert.equal(f.workDirty("a.txt"), true);
  draft.text = "B";
  assert.equal(f.workDirty("a.txt"), false);
});
