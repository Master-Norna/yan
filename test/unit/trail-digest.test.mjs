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

test("后台随桥接重启而止之后行迹摘要也重写：摘要不再写着「进行中」", () => {
  const f = load(["settledDigest"]);
  const step = {
    id: "s2",
    name: "run_command",
    title: "起开发服务器",
    status: "done",
    effect: true,
    bg: { id: "bg1", key: "BOOT-1", state: "running" },
    result: "后台 bg1 · 进行中",
    arguments: "{}"
  };
  const message = { steps: [step] };
  const running = f.settledDigest(message);
  // settleBackground（15-tools/20-command.js）把签改成「随桥接重启而止」，步数没变
  step.bg.state = "lost";
  step.result = "后台 bg1 · 随桥接重启而止";
  const lost = f.settledDigest(message);
  assert.notEqual(lost, running, "候没了要重写，别让模型照着旧编号再开一条同号的");
  assert.match(lost, /随桥接重启而止/);
});

test("结果被挤出记录（evicted）也一样：同是不会再有回报的终态，摘要要重写", () => {
  // #100 起 settleBackground 会记一个 evicted：结束得久、记录留不住，结果丢了。与 lost 同属终态，
  // 只数 lost 的话这一路摘要仍写着「进行中」
  const f = load(["settledDigest"]);
  const step = {
    id: "s3",
    name: "run_command",
    title: "挂着的预览",
    status: "done",
    effect: true,
    bg: { id: "bg7", key: "BOOT-7", state: "running" },
    result: "后台 bg7 · 进行中",
    arguments: "{}"
  };
  const message = { steps: [step] };
  const running = f.settledDigest(message);
  step.bg.state = "evicted";
  step.result = "后台 bg7 · 结束得久，结果没能留住";
  const evicted = f.settledDigest(message);
  assert.notEqual(evicted, running, "结果没能留住也要重写，别让模型以为它还在跑");
  assert.match(evicted, /结果没能留住/);
});
