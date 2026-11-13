// check_command 有两面：看后台、看定时只是读，结束它、取消它才是动手。守挂了 on: check_command 的，
// 只能拦住真动手的那几次（见 15-tools/00-registry.js 的 sideEffectOf、19-intent/10-store.js 的 keepHook）
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

const win = { YAN_PROMPTS: {} };
new Function("window", readFileSync(new URL("../../prompts/work.js", import.meta.url), "utf8"))(win);

test("sideEffectOf：看后台是读，结束它才是动手；run_command 照旧", () => {
  const f = load(["sideEffectOf", "TOOLS"]);
  const check = f.TOOLS.get("check_command");
  assert.equal(f.sideEffectOf(check, { id: "bg1" }), false);
  assert.equal(f.sideEffectOf(check, { id: "bg1", stop: true }), true);
  assert.equal(f.sideEffectOf(f.TOOLS.get("run_command"), { command: "ls" }), true);
  // 函数式的副作用不自动带 digest：看一眼后台不该在下一问里留一行
  assert.equal(check.digest, undefined);
});

test("守写了 on: check_command：结束后台过不了禁令，普通查看照旧放行", async () => {
  const f = load([
    "keepHook",
    "TOOLS",
    `setup: prompts => {
      Object.assign(PROMPTS, prompts);
      intents.set("c1", {
        intent: {
          nodes: {
            训练: { id: "训练", claim: "不经批准不结束训练", check: "批准过", keep: true, on: "check_command", anchors: [] }
          }
        },
        closed: new Set()
      });
      commandPolicyOf = () => "auto";
    }`
  ]);
  f.setup(win.YAN_PROMPTS);
  const ctx = { conversation: { id: "c1", messages: [] } };
  assert.equal(await f.keepHook({ name: "check_command" }, { id: "bg1" }, ctx), null, "查看不被拦");
  const blocked = await f.keepHook({ name: "check_command" }, { id: "bg1", stop: true }, ctx);
  assert.equal(blocked?.ok, false);
  assert.match(blocked.content, /不经批准不结束训练/);
});

test("取消定时同样算动手", async () => {
  const f = load(["sideEffectOf", "TOOLS"]);
  assert.equal(f.sideEffectOf(f.TOOLS.get("check_command"), { id: "t1", stop: true }), true);
});
