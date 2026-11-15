// 设置页里正在打字时，别处记入不重画整个面板。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

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
