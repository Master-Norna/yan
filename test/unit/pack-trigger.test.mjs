import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("便携包 CI 跟随打包清单，新增随包文件不能漏掉触发路径", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/pack.yml", import.meta.url), "utf8");
  const source = readFileSync(new URL("../../pack/pack.mjs", import.meta.url), "utf8");
  const keep = source.match(/const KEEP = \[([\s\S]*?)\];/)?.[1];
  assert.ok(keep, "必须找到打包文件清单");
  // 条件选项（Windows/Mac 启动器）两边都要覆盖。
  const paths = [...keep.matchAll(/"([^"]+)"/g)].map(([, name]) => (name.endsWith("/") ? `${name}**` : name));
  assert.ok(paths.length > 0, "清单不得为空");
  for (const path of paths) assert.ok(workflow.includes(`"${path}"`), `${path} 随包发布，它的改动必须触发便携包验证`);
});
