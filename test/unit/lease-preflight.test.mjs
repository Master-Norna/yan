import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const createChats = createRequire(import.meta.url)("../../server/chats.js");
function leaseServer() {
  const route = createChats({ chatsHome: () => "" }).routes["POST /api/chats/lease"];
  return async body => {
    let data;
    const res = {
      headersSent: false,
      writableEnded: false,
      destroyed: false,
      writeHead() {
        this.headersSent = true;
      },
      end(text) {
        data = JSON.parse(text);
        this.writableEnded = true;
      }
    };
    await route(Readable.from([Buffer.from(JSON.stringify(body))]), res);
    return data;
  };
}

test("认领回话未到时的心跳不释放这段，另一页仍不能认领", async () => {
  const invoke = leaseServer();
  let release, entered;
  const gate = new Promise(resolve => (release = resolve));
  const started = new Promise(resolve => (entered = resolve));
  const f = load([
    "claimConversation",
    "syncLeases",
    "setup: fn => { chatsOnline = () => true; bridge = fn; renderHistory = renderSendButtons = () => {}; }"
  ]);
  f.setup(async (_path, body) => {
    const result = await invoke(body);
    if (body.claim) {
      entered();
      await gate;
    }
    return result;
  });
  const claiming = f.claimConversation("c");
  await started;
  const syncing = f.syncLeases();
  await Promise.resolve();
  // 服务端的认领仍在：检查真实门禁，而不只看页面那张表。
  const other = await invoke({ owner: "other", ids: ["c"], claim: "c" });
  release();
  assert.equal(await claiming, true);
  await syncing;
  assert.deepEqual(other.busy, ["c"]);
});

test("先前的心跳尚未投递时认领：先等旧报到结束，不让迟到的空清单撤回认领", async () => {
  const invoke = leaseServer();
  let release, entered;
  const gate = new Promise(resolve => (release = resolve));
  const started = new Promise(resolve => (entered = resolve));
  const f = load([
    "claimConversation",
    "syncLeases",
    "setup: fn => { chatsOnline = () => true; bridge = fn; renderHistory = renderSendButtons = () => {}; }"
  ]);
  f.setup(async (_path, body) => {
    if (!body.claim) {
      entered();
      await gate;
    }
    return invoke(body);
  });
  const syncing = f.syncLeases();
  await started;
  const claiming = f.claimConversation("c");
  release();
  await syncing;
  assert.equal(await claiming, true);
  assert.deepEqual((await invoke({ owner: "other", ids: ["c"], claim: "c" })).busy, ["c"]);
});

test("心跳已报到、仍在读别处对话时：新认领不等磁盘读取", async () => {
  const invoke = leaseServer();
  await invoke({ owner: "other", ids: ["remote"] });
  let release,
    entered,
    claimed = false;
  const gate = new Promise(resolve => (release = resolve));
  const started = new Promise(resolve => (entered = resolve));
  const f = load([
    "claimConversation",
    "syncLeases",
    "setup: (fn, follow) => { chatsOnline = () => true; bridge = fn; store.conversations = [{ id: 'remote', messages: [] }]; followConversations = follow; renderHistory = renderSendButtons = () => {}; }"
  ]);
  f.setup(
    async (_path, body) => {
      if (body.claim) claimed = true;
      return invoke(body);
    },
    async () => {
      entered();
      await gate;
    }
  );
  const syncing = f.syncLeases();
  await started;
  const claiming = f.claimConversation("c");
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(claimed, true);
    assert.equal(await claiming, true);
    assert.deepEqual((await invoke({ owner: "other", ids: ["remote", "c"], claim: "c" })).busy, ["c"]);
  } finally {
    release();
    await Promise.all([syncing, claiming]);
  }
});
