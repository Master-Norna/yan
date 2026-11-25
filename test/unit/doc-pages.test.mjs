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

test("splitPages：认 PDF 与幻灯片的页眉，标题跟着页走", () => {
  const pages = f.splitPages("第 1 页\n正文甲\n第 2 页\n正文乙");
  assert.deepEqual(
    pages.map(page => page.page),
    [1, 2]
  );
  assert.match(pages[1].text, /正文乙/);
  const slides = f.splitPages("## 第 1 页 · 小结\n一\n## 第 2 页 · 回归\n二");
  assert.deepEqual(
    slides.map(page => page.page),
    [1, 2]
  );
  assert.equal(slides[0].title, "小结");
});

test("splitPages：英文界面的 Page n 也认", () => {
  const pages = f.splitPages("## Page 4 · Steps\n先归一化\nPage 5\n再拟合");
  assert.deepEqual(
    pages.map(page => page.page),
    [4, 5]
  );
  assert.equal(pages[0].title, "Steps");
});

test("splitPages：没有页眉即空；页眉前的零散文字接在第一页前", () => {
  assert.deepEqual(f.splitPages("只是一段正文"), []);
  const pages = f.splitPages("前言\n第 1 页\n正文");
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /^前言\n第 1 页/);
});
