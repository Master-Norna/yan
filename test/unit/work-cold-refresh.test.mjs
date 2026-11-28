import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 冷读接回的是这一答另存的帮手经过，里面可能带着工作区还没见过的改动：接回后要照工具完成那条路重算工作区。
test("冷读接回后通知工作区重算改动", async () => {
  const f = load([
    "warmInView",
    "store",
    "bootstrap",
    "view",
    `setup: () => {
      const calls = [], c = { id: "cold" };
      bootstrap = { store: {} };
      store.conversations = [c];
      chatsDir = () => "C:/chats";
      everyMessage = () => [{ id: "a1", role: "assistant", cold: { key: "k" }, steps: [] }];
      unreadThought = () => false;
      warmTrails = async () => 1;
      workQueueRefresh = target => calls.push(target?.id);
      rewatchBackground = () => {};
      renderClepsydra = () => {};
      currentConversation = () => c;
      renderConversation = () => {};
      renderHelperPanel = () => {};
      sidePanelOpen = () => false;
      renderSidePanel = () => {};
      view = "chat";
      return { c, calls };
    }`
  ]);
  const { c, calls } = f.setup();
  await f.warmInView(c);
  assert.deepEqual(calls, ["cold"]);
});
