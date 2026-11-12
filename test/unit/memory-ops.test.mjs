// 主模型维护记忆：每问读最新版，整类覆盖校验本答见过的版本；旧专司配置仅迁移开关。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const seed = () => ({ id: "m1", category: "偏好", text: "偏好中文", updatedAt: "2026-01-01" });
function setup() {
  const f = load([
    "memoryText",
    "writeMemory",
    "TOOLS",
    "PROMPT_VARS",
    "normalizeStoreData",
    "DUTIES",
    "toolDefinitions",
    "memory: () => store.memory",
    `setup: () => {
      store = normalizeStoreData({ settings: { memoryEnabled: true }, memory: { items: [] } });
      saveStore = () => {};
      refreshMemorySettings = () => {};
    }`,
    "settings: () => store.settings"
  ]);
  f.setup();
  f.memory().items.push(seed());
  const read = () => {
    const memory = new Map();
    f.memoryText(memory);
    return memory;
  };
  const write = (memory, text, category = "偏好") => {
    const memoryUpdates = new Map();
    const result = f.TOOLS.get("remember").run({}, { category, text }, { memory, memoryUpdates, conversation: { id: "c1" } });
    for (const [name, stamp] of memoryUpdates) memory.set(name, stamp);
    return result;
  };
  return { ...f, read, write };
}

test("记忆不需专司模型：默认可读写，预设与角色仍控制工具范围", () => {
  const f = setup();
  assert.equal(f.settings().memoryEnabled, true);
  assert.equal("memory" in f.DUTIES, false);
  const c = { id: "c1", messages: [], workdir: "" };
  const names = options => (f.toolDefinitions(c, options) || []).map(t => t.function.name);
  assert(names().includes("remember"));
  assert(!names({ lookup: true }).includes("remember"));
  assert(!names({ sub: true }).includes("remember"));
  f.settings().memoryEnabled = false;
  assert(!names().includes("remember"));
  assert(names().includes("search_conversations"));
  assert(names().includes("read_conversation"));
});

test("旧专司配置迁移开关，保留正文，撤去模型配置与整理时间", () => {
  const f = setup();
  for (const on of [true, false]) {
    const old = { settings: { dutyMemory: { on, apiKey: "old-key", model: "old-model" } }, memory: { tunedAt: "old", items: [seed()] } };
    const next = f.normalizeStoreData(old);
    assert.equal(next.settings.memoryEnabled, on);
    assert.equal("dutyMemory" in next.settings, false);
    assert.equal("tunedAt" in next.memory, false);
    assert.deepEqual(next.memory.items, [seed()]);
    assert.equal(JSON.stringify(next).includes("old-key"), false);
  }
  assert.equal(f.normalizeStoreData({ settings: { memoryEnabled: true, dutyMemory: { on: false } } }).settings.memoryEnabled, true);
  assert.equal(f.normalizeStoreData({ memory: { enabled: false } }).settings.memoryEnabled, false);
});

test("同一对话下一问带最新版；内容未变时全文稳定", () => {
  const f = setup();
  const memory = new Map();
  const ctx = { conversation: { id: "c1" }, memory };
  const first = f.PROMPT_VARS["memory.body"](ctx).items;
  assert.equal(first, "「偏好」\n偏好中文");
  assert.equal(f.PROMPT_VARS["memory.body"](ctx).items, first);
  f.writeMemory("偏好", "偏好中文\n命令用 PowerShell");
  assert.equal(first, "「偏好」\n偏好中文", "已发出的这一答不变");
  assert.equal(f.PROMPT_VARS["memory.body"](ctx).items, "「偏好」\n偏好中文\n命令用 PowerShell");
  f.memory().items = [];
  assert.equal(f.PROMPT_VARS["memory.body"](ctx), null);
});

test("主模型同一答内可连续修改、增加、删除；成功结果给回保存的正文", () => {
  const f = setup(),
    seen = f.read();
  assert.equal(f.write(seen, "偏好中文\n命令用 PowerShell").ok, true);
  assert.equal(f.write(seen, "偏好中文\n命令用 PowerShell\n解释简短").ok, true);
  assert.match(f.write(seen, "新的计划", "计划").content, /新的计划/);
  assert.equal(f.write(seen, "", "计划").ok, true);
  assert(!f.memory().items.some(item => item.category === "计划"));
  assert.equal(f.write(seen, "", "计划").ok, true);
});

for (const change of ["edit", "delete", "recreate", "add"])
  test(`整类覆盖前 ${change}：拒绝旧版，返回最新内容后可以重新修改`, () => {
    const f = setup(),
      seen = f.read();
    const category = change === "add" ? "计划" : "偏好";
    if (change === "edit") f.writeMemory(category, "他处纠正的新偏好");
    if (change === "delete") f.writeMemory(category, "");
    if (change === "recreate") {
      f.writeMemory(category, "");
      f.writeMemory(category, "偏好中文");
    }
    if (change === "add") f.writeMemory(category, "别处刚记的计划");
    const before = JSON.stringify(f.memory());
    const rejected = f.write(seen, "按旧认识写的", category);
    assert.equal(rejected.ok, false);
    assert.equal(JSON.stringify(f.memory()), before);
    assert.match(
      rejected.content,
      change === "delete" ? /此类已删去/ : new RegExp(f.memory().items.find(i => i.category === category).text)
    );
    assert.equal(f.write(seen, "结合最新正文改过的", category).ok, true);
  });

test("另一答、旁注或计数读取不会刷新正在作答者的版本；无关分类的改动不拦写", () => {
  const f = setup(),
    first = f.read();
  f.writeMemory("偏好", "别处刚纠正的");
  f.read();
  f.memoryText();
  assert.equal(f.write(first, "旧偏好").ok, false);
  const latest = f.read();
  f.writeMemory("计划", "别处的计划");
  assert.equal(f.write(latest, "偏好中文\n已确认的新偏好").ok, true);
});

test("作答期间关闭记忆，不再允许记入", () => {
  const f = setup(),
    seen = f.read();
  f.settings().memoryEnabled = false;
  assert.equal(f.write(seen, "不应保存").ok, false);
  assert.equal(f.memory().items[0].text, "偏好中文");
});

test("同批预拟的两次覆盖都须核对原版本，冲突回话尚未交回时不能越过检查", () => {
  const f = setup(),
    memory = f.read(),
    memoryUpdates = new Map();
  const ctx = { memory, memoryUpdates, conversation: { id: "c1" } };
  f.writeMemory("偏好", "别处刚纠正的");
  for (const text of ["旧版第一次覆盖", "旧版第二次覆盖"])
    assert.equal(f.TOOLS.get("remember").run({}, { category: "偏好", text }, ctx).ok, false);
  assert.equal(f.memory().items[0].text, "别处刚纠正的");
  for (const [category, stamp] of memoryUpdates) memory.set(category, stamp);
  assert.equal(f.write(memory, "模型看过新正文后的修改").ok, true);
});
