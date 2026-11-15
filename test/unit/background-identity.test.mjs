// 后台指令的编号在桥接重启后会重数（见 server/work/shell.js 的 checkBackground）：check_command 要带上开它时
// 记下的 key，不能只凭编号认身份——旧对话里的 bg1 与重启后的另一条 bg1 是两回事
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("check_command 带上开它时记下的 key：桥接按 key 认身份，同编号的另一条不会被停掉", async () => {
  const f = load([
    "TOOLS",
    "store",
    "install: post => { bridge = post; saveStoreSoon = () => {}; refreshSteps = () => {}; renderClepsydra = () => {}; }"
  ]);
  const sent = [];
  f.install((route, payload) => {
    sent.push({ route, ...payload });
    // 桥接那头：编号在，但那是重启后另一条同号的指令，key 对不上——旧的那条已随重启结束，不能动这一条
    if (payload.key && payload.key !== "new-boot-key") throw Error("没有编号为 bg1 的后台指令（桥接重启过的话，之前的后台指令已随之结束）");
    return { id: "bg1", running: false, exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  });
  const step = { id: "old-step", name: "run_command", bg: { id: "bg1", key: "old-boot-key", state: "done" } };
  const answer = { id: "old-answer", steps: [step] };
  const conversation = { id: "old-conversation", messages: [answer] };
  f.store.conversations = [conversation];
  await assert.rejects(
    f.TOOLS.get("check_command").run(
      { id: "check-step" },
      { id: "bg1", stop: true },
      { conversation, assistant: answer, signal: new AbortController().signal }
    ),
    /没有编号为 bg1 的后台指令/
  );
  assert.deepEqual(sent, [{ route: "/api/work/check", id: "bg1", stop: true, wait: 0, key: "old-boot-key" }]);
});

test("对话里没有这一条步骤时，照旧不带 key（桥接按编号认，不因缺步骤而拦）", async () => {
  const f = load([
    "TOOLS",
    "store",
    "install: post => { bridge = post; saveStoreSoon = () => {}; refreshSteps = () => {}; renderClepsydra = () => {}; }"
  ]);
  const sent = [];
  f.install((route, payload) => {
    sent.push({ route, ...payload });
    return { id: "bg9", running: true, exitCode: null, stdout: "", stderr: "", durationMs: 1 };
  });
  const answer = { id: "answer", steps: [] };
  const conversation = { id: "conversation", messages: [answer] };
  f.store.conversations = [conversation];
  await f.TOOLS.get("check_command").run(
    { id: "check-step" },
    { id: "bg9", wait: 2 },
    { conversation, assistant: answer, signal: new AbortController().signal }
  );
  assert.deepEqual(sent, [{ route: "/api/work/check", id: "bg9", stop: false, wait: 2, key: "" }]);
});

test("帮手开的后台：步骤在 sub.steps 里，也照旧带上开它时的 key", async () => {
  const f = load([
    "TOOLS",
    "store",
    "install: post => { bridge = post; saveStoreSoon = () => {}; refreshSteps = () => {}; renderClepsydra = () => {}; }"
  ]);
  const sent = [];
  f.install((route, payload) => {
    sent.push({ route, ...payload });
    if (payload.key && payload.key !== "new-boot-key") throw Error("没有编号为 bg1 的后台指令");
    return { id: "bg1", running: false, exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  });
  // 帮手自己挂的后台指令存在差遣那一步的 sub.steps 下（见 90-delegate.js）
  const step = { id: "helper-bg", name: "run_command", bg: { id: "bg1", key: "OLD-BOOT-1", state: "running" } };
  const answer = { id: "old-answer", steps: [{ id: "delegate-step", name: "delegate", sub: { steps: [step] } }] };
  const conversation = { id: "old-conversation", messages: [answer] };
  f.store.conversations = [conversation];
  await assert.rejects(
    f.TOOLS.get("check_command").run(
      { id: "check-step" },
      { id: "bg1", stop: true },
      { conversation, assistant: answer, signal: new AbortController().signal }
    ),
    /没有编号为 bg1 的后台指令/
  );
  assert.deepEqual(sent, [{ route: "/api/work/check", id: "bg1", stop: true, wait: 0, key: "OLD-BOOT-1" }]);
});

test("停止请求没送到（网络断了）：不撤完成监听，后台结束仍会叫醒", async () => {
  const f = load([
    "TOOLS",
    "store",
    "bgWatches",
    `install: () => {
      bridge = async () => { throw Error("网络断了"); };
      saveStoreSoon = () => {};
      refreshSteps = () => {};
      settleBackground = () => {};
    }`
  ]);
  const step = { id: "s1", name: "run_command", bg: { id: "bg1", key: "k", state: "running" } };
  const answer = { id: "a", steps: [step] };
  const conversation = { id: "c", messages: [answer] };
  f.store.conversations = [conversation];
  const controller = new AbortController();
  f.bgWatches.set("s1", controller);
  f.install();
  await assert.rejects(
    f.TOOLS.get("check_command").run(
      { id: "check-step" },
      { id: "bg1", stop: true },
      { conversation, assistant: answer, signal: new AbortController().signal }
    ),
    /网络断了/
  );
  assert.equal(f.bgWatches.get("s1"), controller, "监听还挂着");
  assert.equal(controller.signal.aborted, false);
});

test("停止请求成功：撤下监听，不再多叫醒一回", async () => {
  const f = load([
    "TOOLS",
    "store",
    "bgWatches",
    `install: () => {
      bridge = async () => ({ id: "bg1", running: false, exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
      saveStoreSoon = () => {};
      refreshSteps = () => {};
      settleBackground = () => {};
    }`
  ]);
  const step = { id: "s1", name: "run_command", bg: { id: "bg1", key: "k", state: "running" } };
  const answer = { id: "a", steps: [step] };
  const conversation = { id: "c", messages: [answer] };
  f.store.conversations = [conversation];
  const controller = new AbortController();
  f.bgWatches.set("s1", controller);
  f.install();
  await f.TOOLS.get("check_command").run(
    { id: "check-step" },
    { id: "bg1", stop: true },
    { conversation, assistant: answer, signal: new AbortController().signal }
  );
  assert.equal(controller.signal.aborted, true);
});
