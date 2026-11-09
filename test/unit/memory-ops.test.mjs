// 记忆优化：专司答回来的清单只认约定好的形状——缺 text（或给 null / 数字 / 数组）是模型没按约定答，
// 不能当成「text 为空串即删去这一类」，否则一整类记忆被静默删掉、tunedAt 照样前进，再也不会回头
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
}`;
function setup(reply, seed = seedItem()) {
  const f = load(["tuneOnce", setupCode, "memory: () => store.memory"]);
  f.setup(reply, seed);
  return f;
}

test("tuneOnce：清单项缺 text 或 text 不是字符串时不动那一类", async () => {
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
    await f.tuneOnce();
    const memory = f.memory();
    assert.equal(memory.items.length, 1, reply);
    assert.equal(memory.items[0]?.text, "用户在做言的记忆模块", reply);
  }
});

test("tuneOnce：text 是空串仍是删去这一类（提示词约定如此）", async () => {
  const f = setup('[{"category":"工作","text":""}]');
  await f.tuneOnce();
  assert.equal(f.memory().items.length, 0);
});
