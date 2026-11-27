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
