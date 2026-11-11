import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

process.env.YAN_CHATGPT_AUTH = "http://auth.test";
const createChatgpt = createRequire(import.meta.url)("../../server/model/chatgpt.js");
const realFetch = globalThis.fetch;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => (resolve = done));
  return { promise, resolve };
};
const auth = (who = "A") => ({
  clientId: `client-${who}`,
  email: `${who}@example.invalid`,
  tokens: { access_token: `access-${who}`, refresh_token: `refresh-${who}`, expires_at: Date.now() - 60000 }
});
const fresh = who => new Response(JSON.stringify({ access_token: `new-${who}`, refresh_token: `next-${who}`, expires_in: 3600 }));

async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-auth-race-"));
  let current = path.join(root, "A");
  const write = (who, value = auth(who)) => {
    const dir = path.join(root, who);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ChatGPT 登录.json"), JSON.stringify(value));
  };
  write("A");
  write("B");
  const client = createChatgpt({ home: () => current });
  const call = async name => {
    const res = Object.assign(new EventEmitter(), {
      writeHead(status) {
        this.status = status;
      },
      end(body) {
        this.body = body;
      }
    });
    await client.routes[`POST /api/chatgpt/${name}`](Readable.from([Buffer.from("{}")]), res);
    return JSON.parse(res.body);
  };
  globalThis.fetch = async () => new Response("{}");
  try {
    await run({
      ...client,
      call,
      write,
      switchRoot: who => (current = path.join(root, who)),
      read: who => JSON.parse(fs.readFileSync(path.join(root, who, "ChatGPT 登录.json"), "utf8"))
    });
  } finally {
    globalThis.fetch = async () => new Response("{}");
    await call("logout");
    globalThis.fetch = realFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("同根、同凭证的并发换新只发一回", async () =>
  fixture(async ({ provider }) => {
    const reply = deferred();
    let calls = 0;
    globalThis.fetch = () => {
      calls += 1;
      return reply.promise;
    };
    const first = provider.headers({}, {}),
      second = provider.headers({}, {});
    reply.resolve(fresh("A"));
    assert.deepEqual(
      (await Promise.all([first, second])).map(h => h.Authorization),
      ["Bearer new-A", "Bearer new-A"]
    );
    assert.equal(calls, 1);
  }));

test("换新途中退出：本机立即清掉凭证，迟到的成功不能重新登录", async () =>
  fixture(async ({ provider, call, read }) => {
    const reply = deferred();
    globalThis.fetch = url => (String(url).endsWith("/oauth/token") ? reply.promise : Promise.resolve(new Response("{}")));
    const stopped = assert.rejects(provider.headers({}, {}), /登录或存储位置已变化/);
    await call("logout");
    assert.equal(read("A").tokens, undefined);
    reply.resolve(fresh("A"));
    await stopped;
    assert.equal(read("A").tokens, undefined);
  }));

for (const invalid of [false, true])
  test(`换新途中换根：旧请求${invalid ? "失效" : "成功"}也不动新根，新根独立换新`, async () =>
    fixture(async ({ provider, read, switchRoot }) => {
      const replies = [deferred(), deferred()];
      let calls = 0;
      globalThis.fetch = () => replies[calls++].promise;
      const old = assert.rejects(provider.headers({}, {}), /登录或存储位置已变化/);
      switchRoot("B");
      const next = provider.headers({}, {});
      assert.equal(calls, 2);
      replies[0].resolve(invalid ? new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) : fresh("A"));
      await old;
      assert.equal(read("B").tokens.access_token, "access-B");
      // 旧请求收尾不能撤去新根的在途换新。
      const together = provider.headers({}, {});
      assert.equal(calls, 2);
      replies[1].resolve(fresh("B"));
      assert.deepEqual(
        (await Promise.all([next, together])).map(h => h.Authorization),
        ["Bearer new-B", "Bearer new-B"]
      );
      assert.equal(read("A").tokens.access_token, "access-A");
      assert.equal(read("B").tokens.access_token, "new-B");
    }));

for (const change of ["logout", "root"])
  test(`授权回调换令牌途中 ${change}：旧授权不能落盘`, async () =>
    fixture(async ({ call, read, switchRoot }) => {
      const reply = deferred(),
        seen = deferred();
      globalThis.fetch = url => {
        if (String(url).endsWith("/oauth/token")) {
          seen.resolve();
          return reply.promise;
        }
        return Promise.resolve(new Response("{}"));
      };
      const { url } = await call("login");
      const query = new URL(url).searchParams;
      const callback = new URL(query.get("redirect_uri"));
      callback.searchParams.set("state", query.get("state"));
      callback.searchParams.set("code", "test-code");
      const answer = realFetch(callback);
      await seen.promise;
      if (change === "logout") await call("logout");
      else switchRoot("B");
      reply.resolve(fresh("A"));
      const response = await answer;
      assert.equal(response.status, 409);
      assert.match(await response.text(), /登录或存储位置已变化/);
      if (change === "logout") assert.equal(read("A").tokens, undefined);
      assert.equal(read("B").tokens.access_token, "access-B");
    }));
