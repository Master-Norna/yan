// 记忆的冲突要交到真正落盘的地方：本页按「本答读到的版本」核对，挡不住另一个浏览器已经在别处改过；
// 两边都改过同一类时，磁盘上的留作正本，冲突交回 remember 重写（见 01-store/20-config.js 的 mergeMemoryItems）
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const item = (id, category, text, updatedAt = "2026-01-01") => ({ id, category, text, updatedAt });
const meta = items => ({ version: 1, settings: {}, profiles: [], memory: { items }, drafts: {} });

function setup() {
  return load([
    "mergeConfig3",
    "memoryStamp",
    "notePendingMemory",
    "noteMemoryClash",
    "takeMemoryClash",
    "TOOLS",
    "store",
    `setup: () => {
      store = { settings: { memoryEnabled: true }, profiles: [], conversations: [], memory: { items: [] }, drafts: {} };
      saveStore = () => {};
      refreshMemorySettings = () => {};
      flushConfig = async () => true;
    }`,
    `setFlush: fn => { flushConfig = fn; }`
  ]);
}

test("两边都改过同一类：磁盘上的留作正本，冲突交回重写", () => {
  const f = setup();
  f.store.memory.items = [item("m1", "偏好", "偏好中文")];
  f.notePendingMemory("偏好");
  const merged = f.mergeConfig3(
    meta([item("m1", "偏好", "偏好中文")]),
    meta([item("m1", "偏好", "偏好中文\n回答简短")]),
    meta([item("m1", "偏好", "偏好英文")])
  );
  assert.equal(merged.memory.items.length, 1);
  assert.equal(merged.memory.items[0].text, "偏好英文");
  assert.equal(f.takeMemoryClash("偏好"), "偏好英文");
});

test("只有自己改过：照自己的写，不算冲突", () => {
  const f = setup();
  f.notePendingMemory("偏好");
  const merged = f.mergeConfig3(
    meta([item("m1", "偏好", "偏好中文")]),
    meta([item("m1", "偏好", "偏好中文\n回答简短")]),
    meta([item("m1", "偏好", "偏好中文")])
  );
  assert.equal(merged.memory.items[0].text, "偏好中文\n回答简短");
  assert.equal(f.takeMemoryClash("偏好"), null);
});

test("这边删了、那边改过：留磁盘上的，冲突交回（不把删掉的类接回来）", () => {
  const f = setup();
  f.notePendingMemory("偏好");
  const merged = f.mergeConfig3(meta([item("m1", "偏好", "偏好中文")]), meta([]), meta([item("m1", "偏好", "偏好英文")]));
  assert.equal(merged.memory.items.length, 1);
  assert.equal(merged.memory.items[0].text, "偏好英文");
  assert.equal(f.takeMemoryClash("偏好"), "偏好英文");
});

test("两边都删了：删掉，不算冲突", () => {
  const f = setup();
  f.notePendingMemory("偏好");
  const merged = f.mergeConfig3(meta([item("m1", "偏好", "偏好中文")]), meta([]), meta([]));
  assert.deepEqual(merged.memory.items, []);
  assert.equal(f.takeMemoryClash("偏好"), null);
});

test("按类名合，不按 id：删后重建（新 id）仍算同一类", () => {
  const f = setup();
  f.notePendingMemory("偏好");
  const merged = f.mergeConfig3(
    meta([item("m1", "偏好", "偏好中文")]),
    meta([item("m2", "偏好", "偏好中文\n回答简短")]),
    meta([item("m1", "偏好", "偏好英文")])
  );
  assert.equal(merged.memory.items.length, 1);
  assert.equal(merged.memory.items[0].text, "偏好英文");
  assert.equal(f.takeMemoryClash("偏好"), "偏好英文");
});

test("别处之间的冲突不算到这一步头上（只回报这一答正写的类）", () => {
  const f = setup();
  f.notePendingMemory("计划");
  const merged = f.mergeConfig3(
    meta([item("m1", "偏好", "偏好中文")]),
    meta([item("m1", "偏好", "本地改的")]),
    meta([item("m1", "偏好", "别处改的")])
  );
  assert.equal(merged.memory.items[0].text, "别处改的");
  assert.equal(f.takeMemoryClash("偏好"), null);
});

test("remember：落盘时发现别处改过，交回最新正文而不报成功", async () => {
  const f = setup();
  f.store.memory.items = [item("m1", "偏好", "偏好中文")];
  const memory = new Map([["偏好", f.memoryStamp(f.store.memory.items[0])]]),
    memoryUpdates = new Map();
  const disk = item("m1", "偏好", "偏好英文");
  // 模拟落盘那一回：磁盘上的那份是别处改的，adoptConfig 把本页也换成它
  f.setFlush(async () => {
    f.noteMemoryClash("偏好", disk);
    f.store.memory.items = [disk];
  });
  const result = await f.TOOLS.get("remember").run(
    {},
    { category: "偏好", text: "偏好中文\n回答简短" },
    { memory, memoryUpdates, conversation: { id: "c1" } }
  );
  assert.equal(result.ok, false);
  assert.match(result.content, /偏好英文/);
  assert.equal(f.store.memory.items[0].text, "偏好英文", "本页换成磁盘上的那份");
  assert.equal(memoryUpdates.get("偏好"), f.memoryStamp(f.store.memory.items[0]), "同批再写按新版核对");
});

test("remember：真写进了存储目录才报「已写入」", async () => {
  const f = setup();
  f.store.memory.items = [item("m1", "偏好", "偏好中文")];
  f.setFlush(async () => true);
  const memory = new Map([["偏好", f.memoryStamp(f.store.memory.items[0])]]);
  const result = await f.TOOLS.get("remember").run(
    {},
    { category: "偏好", text: "偏好中文\n回答简短" },
    { memory, memoryUpdates: new Map(), conversation: { id: "c1" } }
  );
  assert.equal(result.ok, true);
  assert.match(result.content, /已写入/);
  assert.equal(result.display, "", "这一类原本就有，行迹上不必另标");
  assert.equal(f.store.memory.items[0].text, "偏好中文\n回答简短");
});

test("remember：桥接不在、写不成时说「待落盘」，不报已写入", async () => {
  // 保存失败时另有一个提示条，但那一条长任务里未必看得见：工具结果自己得说清没存住
  const f = setup();
  f.store.memory.items = [item("m1", "偏好", "偏好中文")];
  f.setFlush(async () => false);
  const memory = new Map([["偏好", f.memoryStamp(f.store.memory.items[0])]]);
  const result = await f.TOOLS.get("remember").run(
    {},
    { category: "偏好", text: "偏好中文\n回答简短" },
    { memory, memoryUpdates: new Map(), conversation: { id: "c1" } }
  );
  assert.equal(result.ok, true, "本页确实改好了，不算失败");
  assert.doesNotMatch(result.content, /已写入/);
  assert.match(result.content, /还没写进存储目录/);
  assert.equal(result.display, "待落盘");
  assert.equal(f.store.memory.items[0].text, "偏好中文\n回答简短", "本页照旧改成新内容");
});

test("没有基准时两边同类记忆按类名接起，两处记下的都不丢；本地独有的类别留着", () => {
  const f = load([
    "mergeConfig",
    "store",
    `setup: () => {
      store.settings = { memoryEnabled: true, activeProfileId: "" };
      store.profiles = [];
      store.conversations = [];
      store.memory = {
        items: [
          { id: "m1", category: "偏好", text: "偏好中文", updatedAt: "2026-01-01" },
          { id: "m3", category: "计划", text: "在本机立的计划", updatedAt: "2026-01-01" }
        ]
      };
      store.drafts = {};
      renderHeader = () => {};
      renderHistory = () => {};
      renderQuota = () => {};
    }`
  ]);
  const disk = {
    version: 1,
    settings: {},
    profiles: [],
    memory: { items: [{ id: "m2", category: "偏好", text: "偏好英文", updatedAt: "2026-01-02" }] },
    drafts: {}
  };
  f.setup();
  f.mergeConfig(disk);
  // 同名一类：两段正文依次接起（不是取其一），模型看得到两处记下的东西
  const pref = f.store.memory.items.find(item => item.category === "偏好");
  assert.equal(f.store.memory.items.filter(item => item.category === "偏好").length, 1);
  assert.match(pref.text, /偏好中文/);
  assert.match(pref.text, /偏好英文/);
  // 磁盘上没有的类别，本地那份留着
  assert.equal(f.store.memory.items.find(item => item.category === "计划")?.text, "在本机立的计划");
});
