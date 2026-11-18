// 导入半途失败时「已并入的部分留着了」要说准：并进来的是内存里那一截，真写进存储目录还得等这一趟落盘。
// 附件那一半常常正是「配额满、目录写不进」坏的，这时说「留着了」会让人以为已经存住（见 src/17-settings/20-backup.js 的 catch）
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const backup = version => ({
  version,
  conversations: [{ id: "c1", title: "带回来的一段", messages: [{ id: "m1", role: "user", content: "早" }], forks: [], threads: [] }],
  profiles: [],
  settings: { groups: [], presets: [], mcpServers: {} },
  memory: { items: [] },
  drafts: {},
  attachments: [{ id: "a1", data: "data:text/plain;base64,5LiA" }]
});

function setup(settled) {
  return load([
    "importData",
    "STORE_VERSION",
    "pendingChatDeletes",
    `setup: data => {
      store = {
        conversations: [],
        profiles: [],
        settings: { groups: [], presets: [], mcpServers: {}, activeProfileId: "" },
        memory: { items: [] },
        drafts: {}
      };
      readFile = async () => JSON.stringify(data);
      getAttachment = async () => null;
      // 附件写一半失败：配额满，不是截断
      putAttachment = async () => { throw Object.assign(Error("配额满"), { code: "quota" }); };
      uncacheAttachment = () => {};
      markDirty = () => {};
      saveStore = () => {};
      render = () => {};
      renderSettings = () => {};
      toast = text => { toast.said = text; };
      flushConfig = async () => ${settled};
    }`,
    `said: () => toast.said`,
    `current: () => store`
  ]);
}

test("附件写不成、配置也没落盘：说留在本页了，不说「留着了」", async () => {
  const f = setup("false");
  f.setup(backup(f.STORE_VERSION));
  await f.importData({ size: 10 });
  assert.match(String(f.said()), /留在本页了/);
  assert.match(String(f.said()), /还没能写进存储目录/);
  assert.equal(f.current().conversations.length, 1, "并进来的那一截确实在内存里");
});

test("附件写不成、配置确实落了盘：这才说「留着了」", async () => {
  const f = setup("true");
  f.setup(backup(f.STORE_VERSION));
  await f.importData({ size: 10 });
  assert.match(String(f.said()), /已并入的部分留着了/);
  assert.doesNotMatch(String(f.said()), /留在本页了/);
});

test("在等删除裁定的同 ID 对话不计入本轮导入", async () => {
  const f = setup("true"),
    data = { ...backup(f.STORE_VERSION), attachments: [] };
  f.setup(data);
  f.pendingChatDeletes.set("c1", Date.now());
  await f.importData({ size: 10 });
  assert.deepEqual(f.current().conversations, []);
  assert.match(String(f.said()), /已导入 0 段对话.*1 段对话尚在等删除确认，未导入/);
});
