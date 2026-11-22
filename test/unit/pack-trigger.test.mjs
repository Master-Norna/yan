import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("便携包 CI 由实际打入包内的源码触发", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/pack.yml", import.meta.url), "utf8");
  for (const path of ["server/**", "src/**", "web/**", "styles/**", "prompts/**", "skills/**", "i18n/**", "vendor/**"])
    assert.ok(workflow.includes(`"${path}"`), `${path} 的改动必须触发便携包验证`);
});
