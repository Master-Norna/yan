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
      flushConfig = async () => {};
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

test("remember：没有冲突（写不成就判不了）照旧算写下了", async () => {
  const f = setup();
  f.store.memory.items = [item("m1", "偏好", "偏好中文")];
  const memory = new Map([["偏好", f.memoryStamp(f.store.memory.items[0])]]);
  const result = await f.TOOLS.get("remember").run(
    {},
    { category: "偏好", text: "偏好中文\n回答简短" },
    { memory, memoryUpdates: new Map(), conversation: { id: "c1" } }
  );
  assert.equal(result.ok, true);
  assert.equal(f.store.memory.items[0].text, "偏好中文\n回答简短");
});
