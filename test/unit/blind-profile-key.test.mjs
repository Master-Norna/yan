import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("图像拒绝缓存按实际模型端点隔离，改模型配置后仍尝试带图", () => {
  const f = load(["blindProfiles", "blindProfileKey", "dropToolImages"]);
  const first = { id: "p1", api: "openai", source: "custom", baseUrl: "http://local.invalid/v1", model: "text-only" };
  const other = { ...first, model: "vision-capable" };
  const changedUrl = { ...first, baseUrl: "http://another.invalid/v1" };
  const history = [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,a" } }] }];
  assert.equal(f.dropToolImages(history, first, "image inputs are not supported"), true);
  assert.equal(f.blindProfiles.has(f.blindProfileKey(first)), true);
  assert.equal(f.blindProfiles.has(f.blindProfileKey(other)), false);
  assert.equal(f.blindProfiles.has(f.blindProfileKey(changedUrl)), false);
});
