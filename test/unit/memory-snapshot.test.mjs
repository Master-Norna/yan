// issue #72 的两条记忆修复：
//  3) 清空记忆 / 删去一类之后，本页已有对话不再把旧记忆送进系统提示；
// 12) 设置页里正在打字时，别处记入或专司理完不重画整个面板。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("memorySnapshot：清空 / 删类之后按现在的记忆重新定格", async () => {
  const f = load([
    "memorySnapshot",
    "forgetMemorySnapshots",
    "memory: () => store.memory",
    `setup: items => {
      store = { memory: { tunedAt: "", items } };
    }`
  ]);
  f.setup([{ id: "m1", category: "偏好", text: "旧话", updatedAt: "2026-01-01T00:00:00.000Z" }]);
  const conversation = { id: "c1" };
  assert.equal(f.memorySnapshot(conversation), "「偏好」\n旧话");
  // 别处改了：本页已定的那份照旧（缓存接得上）
  f.memory().items = [{ id: "m2", category: "工作", text: "别人改的", updatedAt: "2026-01-02T00:00:00.000Z" }];
  assert.equal(f.memorySnapshot(conversation), "「偏好」\n旧话");
  // 用户清空 / 删去一类：作废，下一回按现在的记忆重新定格
  f.forgetMemorySnapshots();
  assert.equal(f.memorySnapshot(conversation), "「工作」\n别人改的");
});

test("refreshMemorySettings：输入框里正打着字时不重画设置页", () => {
  const counts = { renders: 0 };
  const f = load([
    "refreshMemorySettings",
    `setup: (active, counts) => {
      settingsTab = "memory";
      document.activeElement = active;
      renderSettings = () => { counts.renders += 1; };
    }`
  ]);
  // 正文框、类名框、另起一类的名字框都是 INPUT / TEXTAREA：closest 回来的是设置面板容器（DIV）
  const focused = tag => ({ tagName: tag, closest: () => ({ tagName: "DIV" }) });
  f.setup(focused("TEXTAREA"), counts);
  f.refreshMemorySettings();
  f.setup(focused("INPUT"), counts);
  f.refreshMemorySettings();
  assert.equal(counts.renders, 0, "正在打字的面板不能重画");
  // 焦点不在可编辑处：照常刷新
  f.setup({ tagName: "DIV", closest: () => null }, counts);
  f.refreshMemorySettings();
  assert.equal(counts.renders, 1);
});
