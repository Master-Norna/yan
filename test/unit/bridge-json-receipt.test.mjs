import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("桥接：成功状态的残缺 JSON 不算操作成功", async () => {
  const f = load(["bridgeJson", "setup: response => { bridgeFetch = async () => response; }"]);
  f.setup(new Response("{", { status: 200 }));
  await assert.rejects(f.bridgeJson("/api/mock", "{}"), SyntaxError);
  f.setup(new Response("{", { status: 409 }));
  await assert.rejects(f.bridgeJson("/api/mock", "{}"), error => error.status === 409);
  f.setup(new Response('{"ok":true}', { status: 200 }));
  assert.deepEqual(await f.bridgeJson("/api/mock", "{}"), { ok: true });
});

test("图：无版本回执不得报告写入成功", async () => {
  const f = load([
    "changeIntent",
    "setup: () => { readIntent = async () => ({ intent: {}, version: 'old' }); workScope = () => ({}); bridge = async () => ({}); }"
  ]);
  f.setup();
  await assert.rejects(f.changeIntent({}, undefined, async () => ({ next: {} })));
});

test("图：无版本回执的提示与真冲突分得开", async () => {
  // 没带版本又没报冲突时写入往往已经落地；与「被别处接连改动」同一句，模型分不出该重读还是该放弃
  const f = load([
    "changeIntent",
    "setup: () => { readIntent = async () => ({ intent: {}, version: 'old' }); workScope = () => ({}); bridge = async () => ({}); }"
  ]);
  f.setup();
  const error = await f.changeIntent({}, undefined, async () => ({ next: {} })).catch(reason => reason);
  assert.match(error.message, /回执读不出/);
  assert.doesNotMatch(error.message, /接连改动/);
});

test("图：真的被别处接连改动时仍报原句", async () => {
  const f = load([
    "changeIntent",
    "setup: () => { readIntent = async () => ({ intent: {}, version: 'old' }); workScope = () => ({}); bridge = async () => ({ conflict: true }); }"
  ]);
  f.setup();
  const error = await f.changeIntent({}, undefined, async () => ({ next: {} })).catch(reason => reason);
  assert.match(error.message, /接连改动/);
});
