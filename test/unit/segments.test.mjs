// 各段拼进同一个闭包：两段各写一个同名的 function，后一个悄悄盖掉前一个，不报错也不警告，只能在这里查
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const { scriptParts } = createRequire(import.meta.url)("../../build.js");

test("拼接各段的顶层函数不重名", () => {
  const seen = new Map(),
    dups = [];
  for (const file of scriptParts())
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const name = /^(?:async\s+)?function\s*\*?\s*([\w$]+)/.exec(line)?.[1];
        if (!name) return;
        const at = `${path.relative(process.cwd(), file)}:${i + 1}`;
        if (seen.has(name)) dups.push(`${name}：${seen.get(name)} 与 ${at}`);
        else seen.set(name, at);
      });
  assert.deepEqual(dups, []);
});
