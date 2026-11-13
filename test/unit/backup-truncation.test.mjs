// 大备份（≥128 MiB）的附件是一件一件读的：读到好处就交出一件。复制、下载断在中途的备份不能当完整的——
// 尾部的原件没了，提示还会是「已导入」。收口（数组的 ]、顶层的 }、其后只有空白）由 attachmentReader 核对
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const MARKER = ',"attachments":[';
const encoder = new TextEncoder();

async function read(text) {
  const f = load(["attachmentReader"]);
  const bytes = encoder.encode(text),
    from = encoder.encode(text.slice(0, text.indexOf(MARKER) + MARKER.length)).length,
    items = [];
  let error = null;
  try {
    for await (const item of f.attachmentReader(bytes, from)) items.push(item);
  } catch (caught) {
    error = caught;
  }
  return { items, error };
}

test("完整的备份：逐件读出，不报错", async () => {
  const { items, error } = await read('{"version":6,"conversations":[],"attachments":[{"id":"a","data":"一"},{"id":"b","data":"二"}]}');
  assert.equal(error, null);
  assert.deepEqual(
    items.map(item => item.id),
    ["a", "b"]
  );
});

test("附件里的字符串含括号、引号：照常配平", async () => {
  const { items, error } = await read('{"version":6,"attachments":[{"id":"a","data":"{\\"x\\":[1,2]}"},{"id":"b","data":"尾部 ] }"}]}');
  assert.equal(error, null);
  assert.deepEqual(
    items.map(item => item.id),
    ["a", "b"]
  );
});

test("断在附件字符串中途：前面已读出的照交，最后抛不完整", async () => {
  const full = '{"version":6,"attachments":[{"id":"a","data":"一"},{"id":"b","data":"二的正文断了';
  const { items, error } = await read(full);
  assert.deepEqual(
    items.map(item => item.id),
    ["a"]
  );
  assert.equal(error?.code, "truncated");
});

test("断在一件对象中途：不交出半件，最后抛不完整", async () => {
  const full = '{"version":6,"attachments":[{"id":"a","data":"一"},{"id":"b","data":';
  const { items, error } = await read(full);
  assert.deepEqual(
    items.map(item => item.id),
    ["a"]
  );
  assert.equal(error?.code, "truncated");
});

test("附件数组收了口、顶层对象没合上：抛不完整", async () => {
  const { error } = await read('{"version":6,"attachments":[{"id":"a","data":"一"}]');
  assert.equal(error?.code, "truncated");
});

test("合上之后还有多余的东西：抛不完整", async () => {
  const { error } = await read('{"version":6,"attachments":[{"id":"a","data":"一"}]}乱码');
  assert.equal(error?.code, "truncated");
});

test("收口之后只多些空白：照常算完整", async () => {
  const { items, error } = await read('{"version":6,"attachments":[{"id":"a","data":"一"}]}\n  \r\n');
  assert.equal(error, null);
  assert.equal(items.length, 1);
});
