// 「以本机程序打开」：可执行的一类不开（含 Windows 上点开即运行的解释器脚本与安装清单），普通文件走到打开那一步
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { openWithSystem } = createRequire(import.meta.url)("../../server/http.js");

test("openWithSystem：解释器脚本、管理控制台与安装清单不当成可查看的文件去打开", () => {
  // 后缀判定在查文件之前：这些名字即便不存在，也先报「可执行的不在此打开」
  for (const name of [
    "a.py",
    "a.PY",
    "a.pyw",
    "a.pyc",
    "a.pyo",
    "a.pyz",
    "a.pyzw",
    "a.mjs",
    "a.cjs",
    "a.msc",
    "a.application",
    "a.exe",
    "a.js",
    "a.ps1",
    "a.bat",
    "a.jar"
  ])
    assert.throws(() => openWithSystem(name), /可执行的文件不在此打开/, name);
});

test("openWithSystem：普通文件不被可执行名单误伤，照常走到打开前那一步", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yan-open-"));
  try {
    for (const name of ["a.txt", "a.md", "a.py.txt", "a.json", "a.csv"])
      assert.throws(() => openWithSystem(path.join(dir, name)), /文件不存在/, name);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
