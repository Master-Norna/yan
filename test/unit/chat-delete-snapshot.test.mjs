// 补删与目录快照：桥接交回的 data 是补删之前取的，过滤它得用补删之前的名单（见 src/01-store/30-chats.js 的 syncChatsWithDisk）。
// 从前边删边从 pendingChatDeletes 里拿掉，删成功后集合变小，紧接着用变小后的集合过滤旧快照，刚删掉那条就漏过去，
// 被当成「目录里多出来的」重新捡回 store——这一段对话删了又活
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const conversation = (id, title) => ({
  id,
  title,
  messages: [{ id: `${id}-m1`, role: "user", content: "早", timestamp: "" }],
  forks: [],
  threads: []
});

// 桥接桩：load 交回给定快照；delete 成功，failing 里的那几个抛错（补删没成，名单里留着，下一轮接上还要删）
function setup({ items, failing = [] }) {
  const routes = [];
  const f = load([
    "syncChatsWithDisk",
    "store",
    "pendingChatDeletes",
    "bootstrap",
    `install: (items, failing, routes) => {
      bridge = async (route, payload) => {
        routes.push({ route, id: payload.id || "" });
        if (route !== "/api/chats/delete") return { items, deleted: {} };
        if (failing.includes(payload.id)) throw Error("补删没成");
        return { deleted: true };
      };
      flushConversations = () => {};
      writeMeta = () => {};
      settleAttachmentStore = async () => {};
      stateStoreRequest = async () => {};
      renderHeader = () => {};
      renderHistory = () => {};
      render = () => {};
      renderConversation = () => {};
      toast = () => {};
    }`
  ]);
  f.install(items, failing, routes);
  f.bootstrap.work = { chats: "C:\\对话" };
  return { f, routes };
}

test("补删成功的那一段不会被补删之前的快照捡回来", async () => {
  const { f, routes } = setup({ items: [{ id: "X", savedAt: 5, conversation: conversation("X", "要删的") }] });
  f.store.conversations = [{ ...conversation("Y", "留下的") }];
  f.pendingChatDeletes.add("X");
  await f.syncChatsWithDisk();
  assert.deepEqual(
    routes,
    [
      { route: "/api/chats/load", id: "" },
      { route: "/api/chats/delete", id: "X" }
    ],
    "先取快照，再补删"
  );
  assert.deepEqual([...f.pendingChatDeletes], [], "删成了，名单清掉");
  assert.deepEqual(
    f.store.conversations.map(c => c.id),
    ["Y"],
    "刚删掉的 X 不在 store 里，另一个照旧留着"
  );
});

test("这一轮没删成的那一段同样不捡回来，名单留着等下一轮", async () => {
  const { f, routes } = setup({
    items: [
      { id: "X", savedAt: 5, conversation: conversation("X", "要删的") },
      { id: "Z", savedAt: 5, conversation: conversation("Z", "没删成的") }
    ],
    failing: ["Z"]
  });
  f.store.conversations = [];
  f.pendingChatDeletes.add("X");
  f.pendingChatDeletes.add("Z");
  await f.syncChatsWithDisk();
  assert.deepEqual(
    routes.slice(1),
    [
      { route: "/api/chats/delete", id: "X" },
      { route: "/api/chats/delete", id: "Z" }
    ],
    "名单上的两份都补删过"
  );
  assert.deepEqual([...f.pendingChatDeletes], ["Z"], "删成的清掉，没删成的留着");
  assert.deepEqual(f.store.conversations, [], "两份都不从旧快照复活");
});
