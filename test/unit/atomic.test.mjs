import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const writeTextAtomic = createRequire(import.meta.url)("../../server/work/atomic.js");

test("文件替换失败时保留原文并清理临时文件", async () => {
  const parent = path.resolve("test/.tmp");
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, "atomic-"));
  const file = path.join(dir, "draft.txt");
  fs.writeFileSync(file, "原文");
  const rename = fs.promises.rename;
  try {
    fs.promises.rename = async () => {
      throw Error("模拟替换失败");
    };
    await assert.rejects(writeTextAtomic(file, "新文"), /模拟替换失败/);
  } finally {
    fs.promises.rename = rename;
  }
  try {
    assert.equal(fs.readFileSync(file, "utf8"), "原文");
    assert.deepEqual(fs.readdirSync(dir), ["draft.txt"]);
    await writeTextAtomic(file, "新文");
    assert.equal(fs.readFileSync(file, "utf8"), "新文");
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
