// 退回按整片目录恢复（见 server/checkpoints.js），不只是这一段对话的文件：同目录、上层、下层的另一段对话
// 正作答、帮手在做，或正退回时，不退——否则会把别人刚写下的盖掉，而那边的作业还在继续
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const createCheckpoints = createRequire(import.meta.url)("../../server/checkpoints.js");

async function serve(home) {
  const points = createCheckpoints({ home: () => home });
  const server = http
    .createServer((req, res) => points.routes[`POST ${new URL(req.url, "http://127.0.0.1").pathname}`]?.(req, res))
    .listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw Error(JSON.stringify(data));
      return data;
    });
  return { post, close: () => new Promise(resolve => server.close(resolve)) };
}

test("同目录（连同上下层）的另一段正作答：退回不动手；没人忙时照常退回", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-rewind-scope-")),
    root = path.join(base, "work"),
    { post, close } = await serve(path.join(base, "检查点"));
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "shared.txt"), "before-A");
  const toasts = [];
  globalThis.__rewindToasts = toasts;
  try {
    await post("/api/checkpoint/take", { root, conversation: "A", answer: "A1" });
    fs.writeFileSync(path.join(root, "shared.txt"), "B-active-work");
    const f = load([
      "rewindAnswer",
      "requestJobs",
      "store",
      "install: post => { bridge = post; askConfirm = async () => true; markDirty = () => {}; saveStore = () => {}; renderConversation = () => {}; refreshArchive = async () => {}; toast = message => { globalThis.__rewindToasts.push(message); }; }"
    ]);
    f.install(post);
    const answer = { id: "A1", checkpoint: { root, at: "2026-01-01T00:00:00.000Z", files: 1 } },
      a = { id: "A", workdir: root, messages: [answer] },
      b = { id: "B", workdir: root, messages: [] };
    f.store.conversations = [a, b];
    f.requestJobs.set("B", { controller: new AbortController() });
    await f.rewindAnswer(a, answer);
    assert.equal(fs.readFileSync(path.join(root, "shared.txt"), "utf8"), "B-active-work", "B 正写着，A 的退回不覆盖");
    assert.equal(toasts.at(-1), "作答中，稍后再退");
    // B 的目录在 A 的下一层：仍是同一片
    f.requestJobs.delete("B");
    b.workdir = path.join(root, "sub");
    f.requestJobs.set("B", { controller: new AbortController() });
    await f.rewindAnswer(a, answer);
    assert.equal(fs.readFileSync(path.join(root, "shared.txt"), "utf8"), "B-active-work");
    assert.equal(toasts.at(-1), "作答中，稍后再退");
    // 没人忙：退回照常，改回那一刻的样子
    f.requestJobs.delete("B");
    b.workdir = path.join(base, "elsewhere");
    await f.rewindAnswer(a, answer);
    assert.equal(fs.readFileSync(path.join(root, "shared.txt"), "utf8"), "before-A");
  } finally {
    globalThis.__rewindToasts = [];
    await close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("目录正被别的对话退回时，这一段不开工", () => {
  const f = load(["rootRewinding", "rootBusyElsewhere", "workRoot", "rewinding", "store", "requestJobs", "install: () => {}"]);
  const root = "E:\\工作\\项目";
  f.store.conversations = [
    { id: "A", workdir: "e:/工作/项目/", messages: [] },
    { id: "B", workdir: "E:\\工作", messages: [] },
    { id: "C", workdir: "E:\\别处", messages: [] }
  ];
  f.rewinding.add("B");
  assert.equal(f.rootRewinding("E:/工作/项目/子", "A"), true, "上层在退回，这一层也写不得");
  assert.equal(f.rootRewinding("E:/工作/项目/子", "B"), false, "自己不算");
  assert.equal(f.rootRewinding("E:/别处", "C"), false, "不相交的目录不拦");
  f.requestJobs.set("A", {});
  assert.equal(f.rootBusyElsewhere("E:/工作/项目/子", "B"), true, "同目录的对话正作答");
  assert.equal(f.rootBusyElsewhere("E:/别处", "B"), false);
});

test("回报另起一答也看退回：相交的目录正退回时等它退完，不相交的照常开工", async () => {
  const started = [];
  const f = load([
    "wakeWithReports",
    "rewinding",
    "store",
    `install: started => {
      claimConversation = async () => true;
      requestJob = () => null;
      profiles = () => [];
      activeProfile = () => ({ id: "p" });
      quotaBlocked = () => false;
      startTurn = (c, user) => started.push([c.id, user.content]);
    }`
  ]);
  f.install(started);
  const report = () => [{ report: "到点", step: { id: "s1" }, relay: { step: "s1", title: "t", ok: true } }];
  const near = { id: "near", workdir: "E:\\工作\\项目\\子", messages: [] },
    far = { id: "far", workdir: "E:\\别处", messages: [] };
  f.store.conversations = [{ id: "A", workdir: "e:/工作/项目", messages: [] }, near, far];
  f.rewinding.add("A");
  await f.wakeWithReports(near, report());
  assert.deepEqual(started, [], "上层正退回，这一层不开工");
  await f.wakeWithReports(far, report());
  assert.deepEqual(started, [["far", "到点"]]);
});
