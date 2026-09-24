// 沙箱环境的注入：环境备好了才接；PATH 照原来的键名（Windows 上常写作 Path）往前接，不另起一个；pip、uv、npm 都指向环境
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const createEnv = createRequire(import.meta.url)("../../server/env/index.js");
const home = mkdtempSync(path.join(tmpdir(), "yan-env-"));
const env = createEnv({ sendJson() {}, readJson: async () => ({}), envHome: () => home });

test("环境没备好：原样返回", () => {
  const base = { Path: "C:\\Windows" };
  assert.equal(env.apply(base), base);
});
test("环境备好了：接在原来的 Path 前面，不另起 PATH；pip、uv、npm 指向环境", () => {
  writeFileSync(
    path.join(home, "已备.json"),
    JSON.stringify({ python: "Python 3.12", packs: ["python"], pip: [], npm: [], mirror: "china" })
  );
  const out = env.apply({ Path: "C:\\Windows", HOME: "x" });
  assert.equal(out.PATH, undefined);
  const parts = out.Path.split(path.delimiter);
  assert.deepEqual(parts.slice(0, 3), [path.join(home, "bin"), path.join(home, "py", "Scripts"), path.join(home, "node")]);
  assert.equal(parts.at(-1), "C:\\Windows");
  assert.equal(out.VIRTUAL_ENV, path.join(home, "py"));
  assert.match(out.PIP_INDEX_URL, /tuna/);
  assert.equal(out.npm_config_prefix, path.join(home, "node"));
  assert.equal(out.UV_PYTHON_INSTALL_DIR, path.join(home, "python"));
  assert.equal(out.HOME, "x");
  rmSync(home, { recursive: true, force: true });
});
