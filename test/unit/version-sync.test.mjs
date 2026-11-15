// 版本号两处同步：package.json 与 src/00-state.js 的 APP_VERSION。
// 发版流程要求两处一起改（见 docs/development.md）；漏一处，页面上「关于」写一个版本、桥接 /api/bootstrap 报另一个，
// 排障时先被这两个数字带偏。只守这一条，不接管版本号从哪来。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const state = readFileSync(new URL("src/00-state.js", root), "utf8");
const found = state.match(/const APP_VERSION = "([^"]+)"/);

test("版本号两处一致", () => {
  assert.ok(found, 'src/00-state.js 里没有 const APP_VERSION = "…"');
  assert.equal(found[1], pkg.version, "package.json 与 src/00-state.js 的版本号不一致");
});
