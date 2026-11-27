import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 上传的回执是个对象（落点、名字、大小），调用方直接拿它记附件与成品；
// 解析不成对象时不能当成功，否则记下来的是一份空元数据。
const f = load(["bridgeUpload", "setup: response => { globalThis.fetch = async () => response; }"]);

test("上传：成功状态的残缺 JSON 不算操作成功", async () => {
  f.setup(new Response("{", { status: 200 }));
  await assert.rejects(f.bridgeUpload("/api/mock", {}, new Blob(["x"])), SyntaxError);
});

test("上传：正常回执照旧交出对象", async () => {
  f.setup(new Response('{"name":"a.png","size":3}', { status: 200 }));
  assert.deepEqual(await f.bridgeUpload("/api/mock", {}, new Blob(["x"])), { name: "a.png", size: 3 });
});

test("上传：失败时仍按桥接那句话报错", async () => {
  f.setup(new Response('{"error":"放不下"}', { status: 400 }));
  await assert.rejects(f.bridgeUpload("/api/mock", {}, new Blob(["x"])), error => error.status === 400 && error.message === "放不下");
  f.setup(new Response("{", { status: 400 }));
  await assert.rejects(f.bridgeUpload("/api/mock", {}, new Blob(["x"])), error => error.status === 400);
});
