// 预览截了要说一声：超过 20 万字的 Markdown 与纯文本同样标出「仅显示前 20 万字」，
// 不然读的人把预览的末尾当成文件的末尾（原文件不动，下载与本机打开都还在）
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const LONG = `${"# 标题\n正文一行。\n".repeat(20000)}尾部标记`;

test("Markdown 长文截断：与纯文本一样标出来", async () => {
  const f = load(["fileViewerBody"]),
    reader = { text: async () => LONG };
  const html = await f.fileViewerBody(reader, "长文.md", "markdown", -1);
  assert.match(html, /仅显示前 20 万字/);
});

test("纯文本长文截断：照旧标出来", async () => {
  const f = load(["fileViewerBody"]),
    reader = { text: async () => LONG };
  const html = await f.fileViewerBody(reader, "长文.txt", "text", -1);
  assert.match(html, /仅显示前 20 万字/);
});

test("没超上限的不加提示", async () => {
  const f = load(["fileViewerBody"]),
    reader = { text: async () => "# 短\n正文" };
  const html = await f.fileViewerBody(reader, "短.md", "markdown", -1);
  assert.doesNotMatch(html, /仅显示前 20 万字/);
});
