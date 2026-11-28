// 页眉与分页：抽取器写、预览与 read_document 读，只此一处判四种写法
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load(["pageHeading", "splitPages"]);

test("pageHeading：PDF 的页眉单独一行，幻灯片带 ## 与标题", () => {
  assert.equal(f.pageHeading(3), "第 3 页");
  assert.equal(f.pageHeading(3, { heading: true, title: "小结" }), "## 第 3 页 · 小结");
  assert.equal(f.pageHeading(1, { heading: true }), "## 第 1 页");
});

test("splitPages：PDF 和幻灯片各认自己的页眉，幻灯片标题跟着页走", () => {
  const pages = f.splitPages("第 1 页\n正文甲\nPage 2\n正文乙", "pdf");
  assert.deepEqual(
    pages.map(page => page.page),
    [1, 2]
  );
  assert.equal(pages[1].text, "Page 2\n正文乙");
  const slides = f.splitPages("## 第 1 页 · 小结\n一\n## Page 2 · Summary\n二", "slide");
  assert.deepEqual(
    slides.map(page => [page.page, page.title]),
    [
      [1, "小结"],
      [2, "Summary"]
    ]
  );
});

test("splitPages：没有页眉即空；页眉前的零散文字接在第一页前", () => {
  assert.deepEqual(f.splitPages("只是一段正文", "pdf"), []);
  const pages = f.splitPages("前言\n第 1 页\n正文", "pdf");
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /^前言\n第 1 页/);
});

test("幻灯片预览：CRLF 下仍按中英文的 ## 页眉切页", () => {
  const { slidePagesFromText } = load(["slidePagesFromText"]);
  const pages = slidePagesFromText("## 第 1 页\r\n第一页正文\r\n\r\n## Page 2 · Summary\r\n第二页正文");
  assert.equal(pages.length, 2);
  assert.match(pages[0], /^## 第 1 页\r\n第一页正文/);
  assert.match(pages[1], /^## Page 2 · Summary\r\n第二页正文/);
});

test("幻灯片预览：裸的中英文页码行留在正文，不另切一页", () => {
  const { slidePagesFromText } = load(["slidePagesFromText"]);
  const pages = slidePagesFromText("## 第 1 页\nPage 8\n第 9 页\n正文\n\n## Page 2\n结尾");
  assert.equal(pages.length, 2);
  assert.match(pages[0], /Page 8\n第 9 页\n正文/);
});

function readDocumentPage(name, text, page) {
  const f = load([
    "TOOLS",
    `setup: text => {
      archiveEntries = [];
      getAttachmentMeta = async () => ({ kind: 'file', extractedText: text });
    }`
  ]);
  f.setup(text);
  const conversation = { messages: [{ attachments: [{ id: "a1", name, kind: "file", extracted: true }] }] };
  return f.TOOLS.get("read_document").run({}, { name, page }, { conversation });
}

test("read_document：PPTX 和 ODP 只按 ## 页眉翻页", async () => {
  const text = "## Page 1\r\nPage 8\r\n第 9 页\r\n第一页正文\r\n\r\n## 第 2 页 · 小结\r\n第二页正文";
  for (const name of ["讲义.pptx", "讲义.odp"]) {
    const first = await readDocumentPage(name, text, 1);
    assert.equal(first.ok, true);
    assert.match(first.content, /Page 8\r\n第 9 页\r\n第一页正文/);
    const second = await readDocumentPage(name, text, 2);
    assert.equal(second.ok, true);
    assert.equal(second.content, "## 第 2 页 · 小结\r\n第二页正文");
    const missing = await readDocumentPage(name, text, 8);
    assert.equal(missing.ok, false);
    assert.match(missing.content, /共 2 页/);
  }
});

test("read_document：PDF 只认裸的中英文页码行", async () => {
  const text = "第 1 页\r\n## Page 8\r\nPage 9 · 不是页眉\r\n第一页正文\r\n\r\nPage 2\r\n第二页正文";
  const first = await readDocumentPage("讲义.pdf", text, 1);
  assert.equal(first.ok, true);
  assert.match(first.content, /## Page 8\r\nPage 9 · 不是页眉\r\n第一页正文/);
  const second = await readDocumentPage("讲义.pdf", text, 2);
  assert.equal(second.ok, true);
  assert.equal(second.content, "Page 2\r\n第二页正文");
  const missing = await readDocumentPage("讲义.pdf", text, 8);
  assert.equal(missing.ok, false);
  assert.match(missing.content, /共 2 页/);
});

test("read_document：其他文档沿用裸中文页码，不把 Markdown 标题算成页", async () => {
  const text = "第 1 页\n## 第 2 页\nPage 3\n第 4 页 · 标题\n正文";
  const first = await readDocumentPage("笔记.md", text, 1);
  assert.equal(first.ok, true);
  assert.equal(first.content, text);
  const missing = await readDocumentPage("笔记.md", text, 2);
  assert.equal(missing.ok, false);
  assert.match(missing.content, /共 1 页/);
});
