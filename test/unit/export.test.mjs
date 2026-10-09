import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { marked } = require("../../vendor/marked.umd.js");
const f = load(["conversationMarkdown", "dataUrlFromText", "markdownVisuals", "setMarked: value => { window.marked = value; }"]);
f.setMarked(marked);
const conversation = messages => ({ title: "中文导出", createdAt: "2026-09-28", messages });

test("工具命令中的 Markdown/HTML 作为文字导出，不吞掉正文，不截断第 17 步", () => {
  const title = "读 C:\\项目\\a_b\\*.py\n```\n<script>乱码</script>\n# 假标题";
  const steps = Array.from({ length: 18 }, (_, index) => ({ name: "run_command", title: title + index, status: "done", result: "完成" }));
  const text = f.conversationMarkdown(conversation([{ role: "assistant", content: "**真正正文**", steps }]));
  const tokens = marked.lexer(text);
  const code = tokens.find(token => token.type === "code");
  assert.ok(code.text.includes(title + "17"));
  assert.equal(tokens.filter(token => token.type === "heading").length, 2);
  assert.ok(!tokens.some(token => token.type === "html"));
  assert.match(marked.parse(text), /<strong>真正正文<\/strong>/);
});

test("正文和可视化源码的连续空行完整保留，UTF-8 存取不损失汉字和 emoji", () => {
  const content = "```html\n<script>const text = `中文🌏\n\n\n第四行`;</script>\n```";
  const text = f.conversationMarkdown(conversation([{ role: "assistant", content }]));
  assert.ok(text.includes(content));
  const data = f.dataUrlFromText(text, "text/markdown");
  assert.equal(Buffer.from(data.split(",")[1], "base64").toString("utf8"), text);
});

test("标题、路径和附件元信息不会注入 Markdown 或 HTML", () => {
  const c = conversation([{ role: "user", content: "正文", attachments: [{ name: "[附件](bad).txt" }] }]);
  c.title = "标题\n# 假标题 <img src=x>";
  c.workdir = "C:\\a_b\\repo";
  const html = marked.parse(f.conversationMarkdown(c));
  assert.equal((html.match(/<h1>/g) || []).length, 1);
  assert.ok(!html.includes("<img") && !html.includes("<a "));
  assert.ok(html.includes("C:\\a_b\\repo"));
});

test("导出识别 HTML、旧图表和流程图，命令里的代码围栏不变成作品", () => {
  const text =
    '```html\n<div>中文</div>\n```\n\n```echarts\n{"series":[{"type":"pie","data":[]}]}\n```\n\n> ```mermaid\n> graph LR\n> A-->B\n> ```\n\n````text\n```html\n不是作品\n```\n````';
  const sources = f.markdownVisuals(text);
  assert.equal(sources.length, 3);
  assert.equal(sources[0], "<div>中文</div>");
  assert.ok(sources[1].includes("yan:echarts"));
  assert.ok(sources[2].includes('class="mermaid"'));
});
