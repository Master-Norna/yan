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

test("CSV：字符先到顶（行数远不到四百）也要报，末条没写完的不算", async () => {
  // 两百行、每行一万一千字：两百二十万字符，截断落在第 182 行中间
  const rows = Array.from({ length: 200 }, (_, i) => `r${i},${"x".repeat(11000)}`),
    f = load(["fileViewerBody"]),
    reader = { text: async () => rows.join("\n") };
  const html = await f.fileViewerBody(reader, "宽.csv", "table", -1);
  assert.match(html, /内容过长，只解析了开头一段/);
  assert.doesNotMatch(html, /仅显示前 400 行/);
  assert.match(html, /r180/);
  assert.doesNotMatch(html, /r181/); // 被截断的那一条不当作完整记录
});

test("CSV / TSV 预览截在首条记录内时，不说文件是空的", async () => {
  const f = load(["fileViewerBody"]);
  for (const [ext, split] of [
    ["csv", ","],
    ["tsv", "\t"]
  ]) {
    const reader = text => ({ text: async () => text });
    const long = await f.fileViewerBody(reader(`名称${split}"${"x".repeat(2000000)}\n仍在引号里"`), `宽.${ext}`, "table", -1);
    assert.match(long, /预览范围内没有完整记录/);
    assert.doesNotMatch(long, /空文件|<table/);
    assert.match(await f.fileViewerBody(reader(""), `空.${ext}`, "table", -1), /空文件/);
  }
});

test("取全的文本照原样解：GBK 末尾的字不被当成半个 UTF-8 切掉", async () => {
  const f = load(["urlReader"]),
    original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]), { status: 200 });
  try {
    assert.equal(await f.urlReader("http://127.0.0.1/x").text(200000), "中文");
  } finally {
    globalThis.fetch = original;
  }
});

test("真截断的一截：末尾解不出的字照旧退掉", async () => {
  const f = load(["urlReader"]),
    original = globalThis.fetch;
  // 「中」的三个字节只给了前两个，Content-Range 说整份还有第三个
  globalThis.fetch = async () => new Response(new Uint8Array([0xe4, 0xb8]), { status: 206, headers: { "content-range": "bytes 0-1/3" } });
  try {
    assert.equal(await f.urlReader("http://127.0.0.1/x").text(200000), "");
  } finally {
    globalThis.fetch = original;
  }
});

test("超大 HTML 降级为截断源码，不运行残缺的交互网页", async () => {
  const f = load(["fileViewerBody"]),
    source = "<script>" + "x".repeat(2000000) + "</script>",
    reader = {
      text: async limit => {
        assert.equal(limit, 2000000);
        return source.slice(0, limit + 1);
      }
    };
  const html = await f.fileViewerBody(reader, "大网页.html", "html", -1);
  assert.match(html, /网页过大，仅显示前 20 万字源码/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<iframe|<script>/);
  assert.ok(html.length < 201000);
});
