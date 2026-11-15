// 行迹另存：收了尾的一答，思绪与帮手的经过挪出对话文件（src/01-store/35-cold.js、server/chats.js 的 行迹/）
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readdirSync, existsSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const createChats = createRequire(import.meta.url)("../../server/chats.js");

const helperStep = (id, status = "complete") => ({
  id: `call_${id}`,
  name: "delegate",
  arguments: "{}",
  status: status === "complete" ? "done" : "running",
  sub: {
    id: `sub-${id}`,
    task: "活",
    content: "回报",
    reasoning: "帮手想了很多",
    steps: [{ id: "s1", name: "run_command", status: "done", attachments: [{ id: `shot-${id}`, size: 9 }] }],
    status
  }
});
const conversation = () => ({
  id: "c1",
  title: "长活",
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  messages: [
    { id: "u1", role: "user", content: "做", timestamp: "t" },
    {
      id: "a1",
      role: "assistant",
      content: "做完了",
      timestamp: "t",
      status: "complete",
      reasoning: "主答的思绪",
      steps: [helperStep("x")]
    },
    {
      id: "a2",
      role: "assistant",
      content: "还在做",
      timestamp: "t",
      status: "streaming",
      reasoning: "正想着",
      steps: [helperStep("y", "streaming")]
    }
  ],
  forks: [],
  threads: []
});

test("没有记号时落盘的样子与原来逐字相同（升级前后指纹不变）", () => {
  const { chatJson } = load(["chatJson"]);
  const c = conversation();
  assert.equal(chatJson(c), JSON.stringify(c));
});

test("收了尾才算：作答中、帮手还在做、后台还在跑的都不挪", () => {
  const { settledMessage } = load(["settledMessage"]);
  const [, done, live] = conversation().messages;
  assert.equal(settledMessage(done), true);
  assert.equal(settledMessage(live), false);
  assert.equal(settledMessage({ ...done, status: "stopped" }), false, "停了的还能续写");
  assert.equal(settledMessage({ ...done, steps: [{ ...done.steps[0], status: "interrupted" }] }), false, "帮手断着等人续");
  assert.equal(
    settledMessage({ ...done, steps: [{ id: "b", name: "run_command", status: "done", bg: { id: "1", state: "running" } }] }),
    false
  );
});

for (const status of ["complete", "stopped", "error"])
  test(`帮手${status}后后台指令仍在执行：保存与重载都保留候`, () => {
    const f = load(["settledMessage", "chatJson", "warmMessages", "store", "runningBackground"]);
    const c = conversation(),
      message = c.messages[1],
      helper = message.steps[0];
    helper.sub.status = status;
    helper.sub.steps[0].bg = { id: "bg1", key: "k1", state: "running", started: Date.now() };
    f.store.conversations = [c];
    assert.equal(f.runningBackground().length, 1);
    assert.equal(f.settledMessage(message), false, "帮手的状态不能代替它所开指令的状态");
    // 已经另存过的旧记录接回来后，也不能继续把仍在执行的步骤从对话里剥离。
    message.cold = { key: "old-trail" };
    f.warmMessages.add(message);
    const saved = JSON.parse(f.chatJson(c));
    assert.equal(saved.messages[1].cold, undefined);
    f.store.conversations = [saved];
    assert.equal(f.runningBackground().length, 1, "刷新后候仍能找到后台指令");
    helper.sub.steps[0].bg.state = "done";
    assert.equal(f.settledMessage(message), true, "指令结束后仍可正常另存行迹");
  });

test("带记号的一答：接回了与没接回的落盘一模一样，只留记号与帮手的题头", () => {
  const { chatJson, coldPiece, applyColdPiece, warmMessages } = load(["chatJson", "coldPiece", "applyColdPiece", "warmMessages"]);
  const warm = conversation();
  const piece = coldPiece(warm.messages[1]);
  warm.messages[1].cold = { key: "a1-k", files: [{ id: "shot-x", size: 9 }] };
  warmMessages.add(warm.messages[1]);
  const disk = JSON.parse(chatJson(warm));
  const saved = disk.messages[1];
  assert.equal(saved.reasoning, undefined);
  assert.equal(saved.steps[0].sub.steps, undefined);
  assert.equal(saved.steps[0].sub.reasoning, undefined);
  assert.equal(saved.steps[0].sub.content, "回报", "回报留在对话文件里");
  assert.equal(disk.messages[2].reasoning, "正想着", "作答中的不动");
  // 从盘上读回来（缺着那几样）再落盘：一字不差
  const cold = structuredClone(disk);
  assert.equal(chatJson(cold), chatJson(warm));
  // 接回来：思绪与帮手的步骤都回到原处，手上已有的不盖
  applyColdPiece(cold.messages[1], piece);
  assert.equal(cold.messages[1].reasoning, "主答的思绪");
  assert.deepEqual(cold.messages[1].steps[0].sub.steps, warm.messages[1].steps[0].sub.steps);
  const fresh = structuredClone(disk.messages[1]);
  fresh.reasoning = "新的";
  applyColdPiece(fresh, piece);
  assert.equal(fresh.reasoning, "新的");
});

test("记号在却又动了起来：接回了的整份写回、去掉记号；没接回的仍只写记号", () => {
  const { chatJson, warmMessages } = load(["chatJson", "warmMessages"]);
  const c = conversation();
  c.messages[1].cold = { key: "a1-k" };
  c.messages[1].status = "stopped";
  const missing = JSON.parse(chatJson(c)).messages[1];
  assert.equal(missing.reasoning, undefined);
  assert.equal(missing.cold.key, "a1-k");
  warmMessages.add(c.messages[1]);
  const whole = JSON.parse(chatJson(c)).messages[1];
  assert.equal(whole.reasoning, "主答的思绪");
  assert.equal(whole.cold, undefined);
});

test("目录里的新份换下手上这段：并起来不丢接回的那几样，同一份另存的直接搬过去", () => {
  const { chatJson, mergeConversation, carryWarm, warmMessages } = load(["chatJson", "mergeConversation", "carryWarm", "warmMessages"]);
  const ours = conversation();
  ours.messages[1].cold = { key: "a1-k" };
  warmMessages.add(ours.messages[1]);
  const base = JSON.parse(chatJson(ours));
  const theirs = structuredClone(base);
  theirs.pinned = true;
  theirs.messages[1].usage = { total_tokens: 3 };
  const merged = mergeConversation(ours, theirs, base);
  assert.equal(merged.pinned, true);
  assert.equal(merged.messages[1].reasoning, "主答的思绪");
  assert.equal(merged.messages[1].usage.total_tokens, 3);
  // 干净时整份换成盘上的：接回的那几样从旧对象搬过去，标作已接回
  const replaced = structuredClone(theirs);
  carryWarm(ours, replaced);
  assert.equal(replaced.messages[1].reasoning, "主答的思绪");
  assert.equal(replaced.messages[1].steps[0].sub.steps.length, 1);
  assert.equal(warmMessages.has(replaced.messages[1]), true);
});

test("挪走的步骤里带的附件仍算在用", () => {
  const { attachmentKeepIds, store } = load(["attachmentKeepIds", "store"]);
  const c = conversation();
  c.messages[1] = {
    ...c.messages[1],
    reasoning: undefined,
    steps: [{ ...c.messages[1].steps[0], sub: { id: "sub-x", status: "complete" } }],
    cold: { key: "k", files: [{ id: "shot-x", size: 9 }] }
  };
  store.conversations = [c];
  assert.equal(attachmentKeepIds().has("shot-x"), true);
});

test("桥接：另存、取回、删对话连夹删、读整个目录时清掉没人引用的旧份", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "yan-trail-"));
  const { routes } = createChats({ chatsHome: () => home });
  const server = http.createServer((req, res) => routes[`POST ${new URL(req.url, "http://x").pathname}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify({ root: home, ...body }) }).then(r =>
      r.json()
    );
  try {
    const c = conversation();
    c.messages[1].cold = { key: "a1-keep" };
    await post("/api/chats/save", { savedAt: 1, conversation: c });
    await post("/api/chats/trail/put", { id: "c1", key: "a1-keep", piece: { reasoning: "主答的思绪", subs: {} } });
    await post("/api/chats/trail/put", { id: "c1", key: "a1-stale", piece: { reasoning: "旧", subs: {} } });
    assert.deepEqual((await post("/api/chats/trail/get", { id: "c1", keys: ["a1-keep", "nope", "../x"] })).pieces, {
      "a1-keep": { reasoning: "主答的思绪", subs: {} }
    });
    const dir = path.join(home, "行迹", readdirSync(path.join(home, "行迹"))[0]);
    // 刚写的不清（别处可能正要跟上）；放久了、没人引用的清
    await post("/api/chats/load", {});
    assert.equal(readdirSync(dir).length, 2);
    const old = new Date(Date.now() - 2 * 86400000);
    for (const name of readdirSync(dir)) utimesSync(path.join(dir, name), old, old);
    await post("/api/chats/load", {});
    assert.deepEqual(readdirSync(dir), ["a1-keep.json"]);
    await post("/api/chats/delete", { id: "c1" });
    assert.equal(existsSync(dir), false);
    // 删了以后迟到的另存不收
    assert.equal((await post("/api/chats/trail/put", { id: "c1", key: "late", piece: { subs: {} } })).skipped, true);
    assert.equal(existsSync(dir), false);
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});
