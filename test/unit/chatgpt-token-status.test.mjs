// ChatGPT 订阅那路换令牌失败时给页面什么状态码：网络、5xx、限流是该再试的一类（502，页面等一等再发）；
// 其余 4xx 多是要改配置，当场交回（400），不把 RETRY_DELAYS 排满。凭证真的作废了另说：清掉，请重新登录。
// 授权端地址由 YAN_CHATGPT_AUTH 换掉（chatgpt.js 开头留的口子，且只在 require 那一刻读），故起一个假服务，
// 它每回照 reply 答；要验「连不上」，到最后把服务关掉即可。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const home = fs.mkdtempSync(path.join(os.tmpdir(), "yan-chatgpt-status-"));
const authFile = path.join(home, "ChatGPT 登录.json");

/** @type {[number, any]} 假授权端这回报什么 */
let reply = [500, { error: "server_error" }];
const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    const [status, body] = reply;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.env.YAN_CHATGPT_AUTH = `http://127.0.0.1:${server.address().port}`;
const createChatgpt = require("../../server/model/chatgpt.js");
const { provider } = createChatgpt({ home: () => home });

/** 过了一分钟的凭证：一调 headers() 就去换新 */
function signIn() {
  fs.writeFileSync(
    authFile,
    JSON.stringify({
      email: "a@b.c",
      clientId: "oaiapp_x",
      tokens: { access_token: "old", refresh_token: "r1", expires_at: Date.now() - 60000 }
    })
  );
}
/** 换新这一路的结果：给出来的状态码，或 "ok" */
async function statusOf() {
  try {
    await provider.headers({}, {});
  } catch (error) {
    return error.status;
  }
  return "ok";
}

test("换到了：headers 用新的 Bearer，凭证落盘", async () => {
  signIn();
  reply = [200, { access_token: "new", refresh_token: "r2", expires_in: 3600 }];
  const headers = await provider.headers({}, {});
  assert.equal(headers.Authorization, "Bearer new");
  assert.equal(JSON.parse(fs.readFileSync(authFile, "utf8")).tokens.access_token, "new");
  assert.equal(JSON.parse(fs.readFileSync(authFile, "utf8")).tokens.refresh_token, "r2");
});

test("授权端回 5xx：502，页面该等一等再发", async () => {
  signIn();
  reply = [500, { error: "server_error" }];
  assert.equal(await statusOf(), 502);
});

test("授权端限流：也归可重试的一类（502）", async () => {
  signIn();
  reply = [429, { error: "slow_down" }];
  assert.equal(await statusOf(), 502);
});

test("授权端回别的 4xx：400，当场交回不重试", async () => {
  signIn();
  reply = [400, { error: "invalid_request", error_description: "少了 scope" }];
  assert.equal(await statusOf(), 400);
});

test("凭证真的作废：清掉登录，请重新登录，不给可重试的状态码", async () => {
  signIn();
  reply = [400, { error: "invalid_grant", error_description: "refresh token 已被作废" }];
  await assert.rejects(provider.headers({}, {}), error => {
    assert.equal(error.status, undefined);
    assert.match(error.message, /登录已失效/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(authFile, "utf8")).tokens, undefined, "作废的凭证要从盘上清掉");
});

test("连不上授权端：502，并说清多半是桥接没走代理", async () => {
  signIn();
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(provider.headers({}, {}), error => {
    assert.equal(error.status, 502);
    assert.match(error.message, /连不上 OpenAI 授权端/);
    return true;
  });
});

test.after(() => {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});
