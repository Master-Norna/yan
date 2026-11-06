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
