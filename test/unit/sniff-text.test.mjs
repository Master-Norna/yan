// 「闻」一份认不得扩展名的文件是不是文字：只判没有 NUL 不够——不少二进制本来就没有 NUL，
// GB18030 又几乎什么字节都解得出来，解出来的字还得干净才算文字
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { sniffText } = load(["sniffText"]);

test("没有 NUL 的二进制不当文字", async () => {
  // 0x01–0x1e 轮着来，一个 NUL 也没有：按 UTF-8 解不通，按 GB18030 解得通，但解出来满是控制字符
  const bytes = new Uint8Array(8192);
  for (let i = 0; i < bytes.length; i++) bytes[i] = 1 + (i % 30);
  assert.equal(await sniffText(new Blob([bytes])), false);
});

test("UTF-8 的文字照旧认，中文也算", async () => {
  assert.equal(await sniffText(new Blob(["# 说明\n\n这是一份说明，带几个数字 123。\n"])), true);
});

test("GBK 存的中文也认", async () => {
  // 「中文」在 GBK 里是 D6 D4 BA C1，按 UTF-8 解不通、按 GB18030 解得通
  const bytes = new Uint8Array([0xd6, 0xd4, 0xba, 0xc1, 0x0a, 0xd6, 0xd4, 0xba, 0xc1, 0x0a]);
  assert.equal(await sniffText(new Blob([bytes])), true);
});

test("带色码的日志仍算文字", async () => {
  // ESC（0x1b）留着：命令行工具打出来的日志常带安色码，那也是人要看、模型要读的字
  const line = "\u001b[32mok\u001b[0m  构建完成\n";
  assert.equal(await sniffText(new Blob([line.repeat(200)]), { type: "" }), true);
});
