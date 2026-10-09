// 提示缓存接得上：送出过的前文不再改写（行迹摘要定格），ChatGPT 订阅的缓存键另放进请求头的 session_id
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { load } from "./harness.mjs";

test("a settled answer's trail digest stays put when a helper finishes later", () => {
  const { settledDigest } = load(["settledDigest"]);
  const helper = { id: "d1", name: "delegate", title: "改 a.js", status: "running", result: "后台进行中", sub: { steps: [] } };
  const answer = { steps: [{ id: "r1", name: "read_file", title: "src/a.js", status: "done", result: "4/4 行" }, helper] };
  const first = settledDigest(answer);
  assert.match(first, /后台进行中/);
  // 帮手收工：签上的字变了、还改了文件——已送出的摘要照旧
  Object.assign(helper, { status: "done", result: "2 步 · 改 1 个文件 · 2 秒" });
  helper.sub.steps.push({ id: "e1", name: "edit_file", status: "done", change: { path: "src/a.js" } });
  assert.equal(settledDigest(answer), first);
  // 续写又做了几步：步数变了才重写
  answer.steps.push({ id: "r2", name: "read_file", title: "src/b.js", status: "done", result: "2/2 行" });
  assert.notEqual(settledDigest(answer), first);
  assert.match(settledDigest(answer), /src\/b\.js/);
});

test("ChatGPT sends the cache key in the session_id header too", async () => {
  const createChatgpt = createRequire(import.meta.url)("../../server/model/chatgpt.js");
  // 一份还没过期的假凭证：取令牌不必换新、不出网
  const home = mkdtempSync(path.join(tmpdir(), "yan-chatgpt-"));
  writeFileSync(
    path.join(home, "ChatGPT 登录.json"),
    JSON.stringify({ tokens: { access_token: "t", refresh_token: "r", expires_at: Date.now() + 3600e3 } })
  );
  const { provider } = createChatgpt({ home: () => home });
  const body = provider.request({
    model: "gpt-x",
    messages: [
      { role: "system", content: "S" },
      { role: "user", content: "Q" }
    ]
  });
  assert.ok(body.prompt_cache_key);
  const headers = await provider.headers({}, body);
  assert.equal(headers.session_id, body.prompt_cache_key);
  assert.equal(headers.Authorization, "Bearer t");
  // 列模型之类不带请求体的，不带这个头
  assert.ok(!("session_id" in (await provider.headers({}))));
  rmSync(home, { recursive: true, force: true });
});
