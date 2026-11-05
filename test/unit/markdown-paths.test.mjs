// Windows 路径里的反斜杠是分隔符，不是 Markdown 的转义：E:\聊天记录\.yan 不能变成 E:\聊天记录.yan。
// 经过 setupMarkdown 走真的 marked：渲染与只分词（记成品走 lexer，见 src/15-tools/22-changes.js）两路都要对
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const { Marked, Tokenizer } = createRequire(import.meta.url)("../../vendor/marked.umd.js");
const instance = new Marked();
instance.Tokenizer = Tokenizer;
globalThis.marked = instance;
const f = load([
  "setupMarkdown",
  "localLinkTarget: (raw, c, m) => refTarget(raw, messageAnchor(c, m))",
  "setup: value => { window.marked = value; bootstrap = { work: { platform: 'win32' } }; }"
]);
f.setup(instance);
f.setupMarkdown();

const B = "\\";
const win = (...parts) => parts.join(B);
const hrefsOf = text => {
  const hrefs = [];
  instance.walkTokens(instance.lexer(text), token => {
    if (token.type === "link" || token.type === "image") hrefs.push(token.href);
  });
  return hrefs;
};
const decodedHref = html => decodeURI(/(?:href|src)="([^"]*)"/.exec(html)[1]).replace(/%5C/gi, B);

test("链接与图片：绝对路径的反斜杠照原样留着，渲染与只分词一致", () => {
  const file = win("E:", "聊天记录", ".yan", "技能", "course-progress", "references", "platforms.md");
  for (const text of [`[platforms](${file})`, `![图](${file})`, `[带题](${file} "题")`, `[尖括号](<${file}>)`]) {
    assert.deepEqual(hrefsOf(text), [file], text);
    assert.equal(decodedHref(instance.parse(text)), file, text);
  }
  const spaced = win("E:", "my dir", ".x", "c.md");
  assert.deepEqual(hrefsOf(`[空格](<${spaced}>)`), [spaced]);
  for (const part of ["_b", "-b", "~b", "#b"]) {
    const path = win("E:", "a", part, "c.md");
    assert.deepEqual(hrefsOf(`[x](${path})`), [path], part);
  }
  const unc = win("", "", "server", ".share", "x.md");
  assert.deepEqual(hrefsOf(`[共享](${unc})`), [unc]);
  // 配平括号的 \( \) 还是转义
  assert.deepEqual(hrefsOf(`[括号](E:${B}a${B}(1${B}).md)`), [`E:${B}a(1).md`]);
  // 成对的括号不必转义
  assert.deepEqual(hrefsOf(`[括号](${win("E:", "a(1)", ".b", "c.md")})`), [win("E:", "a(1)", ".b", "c.md")]);
  // 图片外头包链接：外层取最后那一段，里层的图片是相对路径
  assert.deepEqual(hrefsOf(`[![图](a.png)](${file})`).sort(), ["a.png", file].sort());
});

test("落到打开文件的那一步：根还是真实的根，不多出 E:\\聊天记录.yan 这样的目录", () => {
  const [href] = hrefsOf(`[x](${win("E:", "聊天记录", ".yan", "卷宗", "x.docx")})`);
  assert.deepEqual(f.localLinkTarget(href, { workdir: win("D:", "proj") }), { file: "E:/聊天记录/.yan/卷宗/x.docx" });
});

test("网址与相对路径照 Markdown 的规矩：反斜杠仍是转义", () => {
  assert.deepEqual(hrefsOf(`[x](https://a.example/foo${B}_bar)`), ["https://a.example/foo_bar"]);
  assert.deepEqual(hrefsOf(`[x](docs/a${B}_b.md)`), ["docs/a_b.md"]);
  assert.deepEqual(hrefsOf("[x](/usr/a.md)"), ["/usr/a.md"]);
});

test("正文里的路径：显示不丢反斜杠，也不当强调；别处的转义照旧", () => {
  const root = win("E:", "聊天记录", ".yan", "卷宗");
  assert.ok(instance.parse(`存在 ${root}，然后`).includes(`存在 ${root}，然后`));
  assert.ok(instance.parse(`路径 ${win("C:", "a_b_c", "d_e.txt")} 里`).includes(win("C:", "a_b_c", "d_e.txt")));
  assert.ok(instance.parse(`共享 ${win("", "", "server", ".x", "y")} 处`).includes(win("", "", "server", ".x", "y")));
  assert.match(instance.parse(`**${root}**`), /<strong>E:\\聊天记录\\\.yan\\卷宗<\/strong>/);
  assert.ok(instance.parse(`\`${root}\``).includes(`<code>${root}</code>`));
  // 不是路径的：转义、强调都照旧
  assert.ok(instance.parse(`1${B}.5 与 ${B}*字${B}*`).includes("1.5 与 *字*"));
  assert.ok(instance.parse(`abc:${B}.x`).includes("abc:.x"), "前面贴着字母的不是盘符");
  assert.match(instance.parse("*斜*"), /<em>斜<\/em>/);
  // HTML 照样转义
  assert.ok(instance.parse(`${win("E:", "a&b")} 处`).includes(`E:${B}a&amp;b`));
});
