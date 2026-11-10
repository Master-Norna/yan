// 记忆优化：专司答回来的清单只认约定好的形状——缺 text（或给 null / 数字 / 数组）是模型没按约定答，
// 不能当成「text 为空串即删去这一类」，否则一整类记忆被静默删掉、tunedAt 照样前进，再也不会回头。
// 有一条没按约定答就整回不算理成（tunedAt 不前进，下一答落定时重试）；同一类在一次答复里出现两条时两条都要落地
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const seedItem = () => ({ id: "m1", category: "工作", text: "用户在做言的记忆模块", updatedAt: "2026-01-01T00:00:00.000Z" });
const setupCode = `setup: (reply, seed) => {
  store.memory = { tunedAt: "2026-01-01T00:00:00.000Z", items: [seed] };
  askDuty = async () => reply;
  saveStore = () => {};
  refreshMemorySettings = () => {};
  toast = () => {};
},
watchSaves: () => {
  store.savesSeen = 0;
  saveStore = () => (store.savesSeen += 1);
},
saves: () => store.savesSeen`;
function setup(reply, seed = seedItem()) {
  const f = load(["tuneOnce", setupCode, "memory: () => store.memory"]);
  f.setup(reply, seed);
  return f;
}

test("tuneOnce：清单项缺 text 或 text 不是字符串时不动那一类，也不算理成", async () => {
  for (const reply of [
    '[{"category":"工作"}]',
    '[{"category":"工作","text":null}]',
    '[{"category":"工作","text":false}]',
    '[{"category":"工作","text":0}]',
    '[{"category":"工作","text":true}]',
    '[{"category":"工作","text":123}]',
    '[{"category":"工作","text":["a","b"]}]',
    '[{"category":"工作","text":[]}]',
    '[{"category":"工作","text":{}}]'
  ]) {
    const f = setup(reply);
    await assert.rejects(f.tuneOnce(), /不合约定的项/, reply);
    const memory = f.memory();
    assert.equal(memory.items.length, 1, reply);
    assert.equal(memory.items[0]?.text, "用户在做言的记忆模块", reply);
    assert.equal(memory.tunedAt, "2026-01-01T00:00:00.000Z", `${reply}：tunedAt 不能前进，不然再也不会回头理`);
  }
});

test("tuneOnce：text 是空串仍是删去这一类（提示词约定如此）", async () => {
  const f = setup('[{"category":"工作","text":""}]');
  await f.tuneOnce();
  assert.equal(f.memory().items.length, 0);
});

test("tuneOnce：同一类在一次答复里出现两条时，第二条也落地", async () => {
  const f = setup('[{"category":"工作","text":"先写的"},{"category":"工作","text":"后写的"}]');
  await f.tuneOnce();
  assert.equal(f.memory().items.find(item => item.category === "工作")?.text, "后写的");
});

test("tuneOnce：同一类先删、再重写时按后一条落地", async () => {
  const f = setup('[{"category":"工作","text":""},{"category":"工作","text":"重写的"}]');
  await f.tuneOnce();
  assert.equal(f.memory().items.find(item => item.category === "工作")?.text, "重写的");
});

test("tuneOnce：一条合约、一条不合约时整回不算理成，已落地的照留并当场存下", async () => {
  const f = setup('[{"category":"工作","text":"改过的"},{"category":"偏好"}]');
  f.watchSaves();
  await assert.rejects(f.tuneOnce(), /不合约定的项/);
  assert.equal(f.memory().items.find(item => item.category === "工作")?.text, "改过的");
  assert.equal(f.memory().tunedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(f.saves(), 1, "已落地的要当场存盘，不能只留在内存里");
});

test("tuneOnce：空清单（没有要改的）算理成，tunedAt 前进", async () => {
  const f = setup("[]");
  await f.tuneOnce();
  assert.notEqual(f.memory().tunedAt, "2026-01-01T00:00:00.000Z");
});
