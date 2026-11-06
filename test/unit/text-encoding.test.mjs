// 编码认读：末字被写断一个字节的短 UTF-8 仍按 UTF-8 读（末尾一个 U+FFFD），整篇 ASCII 只夹几个 GBK 汉字的照旧认作 GBK，
// 判据是在非 ASCII 字里比好坏（两字节的字记半个）；合法 UTF-8 里的字面 U+FFFD 不算坏；GBK「你好」、真 GBK 整段、纯 ASCII、空文件、带 BOM 的都不变
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { decodeText } = require("../../server/work/text.js");

// 一行汉字末尾还带换行：末字最后一个字节被写断，正好落在换行之前（head -c、断电、下载不全都这样）
const line = "会议记录：讨论了三个方案，下周一再定\r\n";
const whole = Buffer.from(line, "utf8"),
  cut = whole.subarray(0, whole.length - 3); // 砍掉末尾的换行与「定」的最后一个字节：末字就断在那里

test("短文本末字被写断一个字节：仍按 UTF-8 读，只有末尾一个 U+FFFD", () => {
  const decoded = decodeText(cut);
  assert.equal(decoded.encoding, "utf-8");
  const bad = (decoded.text.match(/\uFFFD/g) || []).length;
  assert.equal(bad, 1);
  assert.match(decoded.text, /\uFFFD\x0d?\n?$/);
  // 前面的汉字一个没坏：从上一个完整的字之后到末尾，只剩这个 U+FFFD
  assert.ok(decoded.text.startsWith("会议记录：讨论了三个方案，下周一再"));
});

test("同样的内容字节齐全：UTF-8，文字完好", () => {
  const decoded = decodeText(whole);
  assert.equal(decoded.encoding, "utf-8");
  assert.equal(decoded.text, line);
  assert.ok(!decoded.text.includes("\uFFFD"));
});

test("GBK 的「你好」：按 UTF-8 解出三个 U+FFFD、没一个好字，判 GBK", () => {
  const decoded = decodeText(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
  assert.equal(decoded.encoding, "gbk");
  assert.equal(decoded.text, "你好");
});

test("镜像情形：1200 字 ASCII 夹两个 GBK 汉字，坏字节占比不到 1%，也判 GBK", () => {
  const ascii = Buffer.from("a".repeat(600) + "\n" + "b".repeat(600) + "\n", "ascii"),
    gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), // GBK 的「你好」
    decoded = decodeText(Buffer.concat([ascii, gbk, ascii]));
  assert.equal(decoded.encoding, "gbk");
  assert.ok(decoded.text.includes("你好"));
});

test("UTF-8 中文尾部多一个 0xff：仍按 UTF-8 读", () => {
  const decoded = decodeText(Buffer.concat([Buffer.from("一二三四五六七八九十", "utf8"), Buffer.from([0xff])]));
  assert.equal(decoded.encoding, "utf-8");
  assert.equal(decoded.text, "一二三四五六七八九十\uFFFD");
});

test("整段真 GBK 中文：判 GBK，解得回原文", () => {
  // 141 个汉字（259 字节）的 GBK 字节，由 Python 的 str.encode("gbk") 造出；Node 只会编码 UTF-8，编码器这里只能靠引
  const hex =
    "bbe1d2e9bccdd2aaa3bab1beb4ceccd6c2dbc1cbb9a4d7f7c4bfc2bcb5c4b6c1d0b4bdd3bfdaa1a2b1e0c2ebc8cfb6c1d3ebd0d0cafdbfdabeb6c8fdbcfecac2a1a3b6cccec4bcfeb6cfd4dad7eebaf3d2bbb8f6b6e0d7d6bddad7d6b7fbc9cfcab1a3acc8d4b0b4205554462d3820b6c1a3acd6bbd4dac4a9ceb2cfd4cabed2bbb8f6cce6bbbbd7d6b7fba3bbd5fbc6aad2d420415343494920ceaad6f7a1a2d6bbbcd0bcb8d0d02047424b20babad7d6b5c4bec9bdc5b1bea3acb7b4b9fdc0b4cbb5a3acb8c3c8cfd7f72047424ba1a3d0d0cafdd2bbc2c9d5d5c4a9ceb2bbbbd0d0b2bbcbe3b6e0d2bbd0d0b5c4b9dfc0fda3acbfd5cec4bcfecbe3c1e3d0d0a1a3";
  const decoded = decodeText(Buffer.from(hex, "hex"));
  assert.equal(decoded.encoding, "gbk");
  assert.equal(decoded.text.length, 141);
  assert.ok(decoded.text.startsWith("会议纪要：本次讨论了工作目录的读写接口"));
  assert.ok(decoded.text.endsWith("空文件算零行。"));
});

test("文件里本来就写着 U+FFFD（合法 UTF-8）：仍按 UTF-8 读，那是真内容不是坏字节", () => {
  const ascii = Buffer.from("x".repeat(200), "ascii"),
    decoded = decodeText(Buffer.concat([ascii, Buffer.from("\uFFFD", "utf8")]));
  assert.equal(decoded.encoding, "utf-8");
  assert.equal(decoded.text, "x".repeat(200) + "\uFFFD");
});

test("合法 UTF-8 里 U+FFFD 比别的非 ASCII 字还多：仍是 UTF-8", () => {
  const decoded = decodeText(Buffer.from("好\uFFFD\uFFFD\uFFFD", "utf8")); // 好 一个，U+FFFD 三个
  assert.equal(decoded.encoding, "utf-8");
  assert.equal(decoded.text, "好\uFFFD\uFFFD\uFFFD");
});

test("短 GBK 的「系统信息」：三对凑巧配上的两字节字压不过两个 U+FFFD，判 GBK", () => {
  // cfb5cdb3d0c5cfa2 按 UTF-8 解出 ϵͳ��Ϣ：三个两字节字（各记半个）与两个 U+FFFD
  const decoded = decodeText(Buffer.from("cfb5cdb3d0c5cfa2", "hex"));
  assert.equal(decoded.encoding, "gbk");
  assert.equal(decoded.text, "系统信息");
});

test("纯 ASCII、空文件、带 BOM 的照旧", () => {
  assert.deepEqual(decodeText(Buffer.from("hello\nworld\n", "utf8")), { text: "hello\nworld\n", encoding: "utf-8" });
  assert.deepEqual(decodeText(Buffer.alloc(0)), { text: "", encoding: "utf-8" });
  assert.deepEqual(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), { text: "a", encoding: "utf-8-bom" });
});
