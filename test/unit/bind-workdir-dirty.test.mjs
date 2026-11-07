// 从侧栏给「不是眼前这段」的对话绑/解目录（src/06-mode-welcome/20-chips.js 的 bindWorkdir）：
// 项目里改对话的约定是「markDirty(c.id) 再 saveStore()」——saveStore 只冲刷脏的、当前的、在跑的；
// 少这一句，绑定只留内存，靠 45 秒一轮的巡检或离页兜底才落盘。改动前本文件红。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup(pushMark) {
  const f = load([
    "bindWorkdir",
    `setup: (push) => {
      markDirty = id => push(id);
      saveStore = () => {};
      render = () => {};
      toast = () => {};
      workdirLocked = () => false;
      bridge = async (path, body) => ({ workdir: body.workdir, created: false });
      store = {
        settings: { groups: [], presets: [], pendingGroupId: "", activeProfileId: "", presetId: "", commandPolicyDefault: "ask" },
        profiles: [],
        conversations: [],
        drafts: {}
      };
    }`
  ]);
  f.setup(pushMark);
  return f;
}

test("绑定与解开目录都标脏，不只 saveStore", async () => {
  const dirty = [];
  const f = setup(id => dirty.push(id));
  const c = { id: "c1", workdir: "E:\\旧", messages: [], commandPolicy: "ask" };
  await f.bindWorkdir(c, "E:\\项目\\新");
  assert.deepEqual(dirty, ["c1"], "绑定要标脏");
  dirty.length = 0;
  await f.bindWorkdir(c, "");
  assert.deepEqual(dirty, ["c1"], "解开也要标脏");
});
