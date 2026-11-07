// 行迹摘要（src/14-chat-engine/00-history.js 的 settledDigest）的缓存：送出去的前文不再改写，
// 但「帮手断了」得重写——不会再有回报送到，不重写就此后每问都告诉模型「后台进行中」。
// 改动前 broken 只数 error / skipped，holdHelper 收成的 interrupted 不计入，本文件是红的。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("帮手断了之后行迹摘要重写：不再写「后台进行中」，改为中辍等人续", () => {
  const f = load(["settledDigest"]);
  const step = { id: "s1", name: "delegate", title: "查三家框架", status: "running", result: "后台进行中", arguments: "{}" };
  const message = { steps: [step] };
  const running = f.settledDigest(message);
  assert.match(running, /后台进行中/);
  // holdHelper（90-delegate.js）：断了，等用户续
  step.status = "interrupted";
  step.result = "连接中断";
  const broken = f.settledDigest(message);
  assert.notEqual(broken, running, "断了要重写，不能沿用定格的那份");
  assert.match(broken, /中辍/);
  // 续上之后收工：恢复正常那一行
  step.status = "done";
  step.result = "3 步 · 12 秒";
  assert.match(f.settledDigest(message), /3 步 · 12 秒/);
});
