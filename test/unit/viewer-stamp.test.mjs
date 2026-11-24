// 预览抽取缓存的「这一份还是不是同一份」：优先 ETag（带毫秒），其次「修改时刻 + 大小」。
// 起因（评审）：同一秒里改成长短一样的内容，Last-Modified 与 Content-Length 都看不出，旧正文会被再拿出来用。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load(["stampFromHead"]);
const head = extra => ({
  ok: true,
  headers: new Headers({ "last-modified": "Mon, 24 Nov 2026 04:00:00 GMT", "content-length": "31", ...extra })
});

test("有 ETag 就用 ETag——它带着毫秒，同一秒里改过也分得开", () => {
  assert.equal(f.stampFromHead(head({ etag: 'W/"1f-19abc"' })), 'W/"1f-19abc"');
});

test("没有 ETag 的取件口退回「修改时刻 + 大小」", () => {
  assert.equal(f.stampFromHead(head({})), "Mon, 24 Nov 2026 04:00:00 GMT|31");
});

test("取不到（HEAD 不成功、根本没有回话）给空串，那份就不进缓存", () => {
  assert.equal(f.stampFromHead({ ok: false, headers: new Headers() }), "");
  assert.equal(f.stampFromHead(null), "");
});
