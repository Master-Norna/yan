// 桥接客户端只用页面同源路由；总线交给 EventSource 自己重连，不因反复调用重开连接。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { load } from "./harness.mjs";

const source = readFileSync(new URL("../../src/01-bridge.js", import.meta.url), "utf8");
function client(overrides = {}) {
  const connections = [],
    state = { resyncs: 0 };
  class EventSource {
    constructor(url) {
      this.url = url;
      this.closes = 0;
      connections.push(this);
    }
    close() {
      this.closes++;
    }
    message(data) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }
  const context = vm.createContext({
    window: {},
    location: { protocol: "http:", hostname: "127.0.0.1" },
    PAGE_ID: "page /同源",
    uid: () => "job-1",
    t: text => text,
    toast: () => assert.fail("不该出现更新提示"),
    resyncWithDisk: () => state.resyncs++,
    fetch: () => assert.fail("不该发出请求"),
    EventSource,
    AbortSignal,
    TextEncoder,
    ReadableStream,
    Response,
    Blob,
    setTimeout: (...args) => setTimeout(...args).unref(),
    ...overrides
  });
  const api = vm.runInContext(`${source}\n({ connectBridge, busConnect, busReady, bridgeFetch, bridgeUpload })`, context);
  return { ...api, connections, state };
}

test("桥接引导与直连请求从首次调用起就用同源根路径", async () => {
  const calls = [];
  const api = client({
    EventSource: undefined,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ version: "test" });
    }
  });
  // 不用先完成 connectBridge；不再拼出 null/api/...。
  for (const route of ["/api/chats/load", "/api/chats/trail/get", "/api/files/get", "/api/work/prepare"])
    await api.bridgeFetch(route, "{}");
  assert.equal(await api.connectBridge(), true);
  assert.deepEqual(
    calls.map(call => call.url),
    ["/api/chats/load", "/api/chats/trail/get", "/api/files/get", "/api/work/prepare", "/api/bootstrap"]
  );
  assert.equal(api.connections.length, 0);
});

test("原件上传只在同源动态路径上加说明长度，说明和字节不变", async () => {
  const calls = [];
  const api = client({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ ok: true });
    }
  });
  const head = { name: "中文.bin" },
    bytes = new TextEncoder().encode(JSON.stringify(head)),
    controller = new AbortController();
  await api.bridgeUpload("/api/files/put", head, new Blob(["raw"]), controller.signal);
  assert.equal(calls[0].url, `/api/files/put?head=${bytes.length}`);
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.headers["Content-Type"], "application/octet-stream");
  assert.equal(await calls[0].options.body.text(), `${JSON.stringify(head)}raw`);
});

test("本机文件和技能文件的预览、下载链接始终是编码后的同源根路径", () => {
  const { localFileUrl, skillFileUrl } = load(["localFileUrl", "skillFileUrl"]);
  const file = "E:/资料/a #.pdf",
    skill = { skillDir: "设计", skillPath: "配图/a #.png" };
  assert.equal(localFileUrl(file), `/api/archive/file?file=${encodeURIComponent(file)}`);
  assert.equal(localFileUrl(file, true), `/api/archive/file?file=${encodeURIComponent(file)}&download=1`);
  assert.equal(
    skillFileUrl(skill),
    `/api/skills/raw?dir=${encodeURIComponent(skill.skillDir)}&path=${encodeURIComponent(skill.skillPath)}`
  );
  assert.equal(skillFileUrl(skill, true), `${skillFileUrl(skill)}&download=1`);
});

test("总线连接幂等，断线时不换 EventSource，自动重连后只重新同步一次", async () => {
  const api = client();
  api.busConnect();
  api.busConnect();
  assert.equal(api.connections.length, 1);
  const stream = api.connections[0];
  assert.equal(stream.url, `/api/bus?page=${encodeURIComponent("page /同源")}`);
  stream.onopen();
  assert.equal(await api.busReady(), true);
  stream.onerror();
  assert.equal(await api.busReady(), false);
  api.busConnect();
  assert.equal(api.connections.length, 1, "EventSource 自己重连，不另建连接");
  assert.equal(stream.closes, 0);
  stream.onopen();
  assert.equal(await api.busReady(), true);
  assert.equal(api.state.resyncs, 1);
  stream.onopen();
  assert.equal(api.state.resyncs, 1, "没有再断线就不重复同步");
});

test("总线 send/cancel 使用同源根路径，返回状态与流式正文照旧", async () => {
  const calls = [];
  const api = client({
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ ok: true });
    }
  });
  api.busConnect();
  const stream = api.connections[0];
  stream.onopen();
  const controller = new AbortController(),
    pending = api.bridgeFetch("/api/chat", '{"messages":[]}', controller.signal);
  // bridgeFetch 等 busReady 后才把任务放进总线。
  await Promise.resolve();
  assert.deepEqual(calls, [
    { url: "/api/bus/send", body: { page: "page /同源", id: "job-1", path: "/api/chat", body: '{"messages":[]}' } }
  ]);
  stream.message({ id: "job-1", t: "head", status: 201, headers: { "Content-Type": "text/plain" } });
  const response = await pending;
  assert.equal(response.status, 201);
  const reader = response.body.getReader();
  stream.message({ id: "job-1", t: "data", text: "正文" });
  assert.equal(new TextDecoder().decode((await reader.read()).value), "正文");
  const ended = reader.read();
  controller.abort();
  await assert.rejects(ended, { name: "AbortError" });
  assert.deepEqual(calls[1], { url: "/api/bus/cancel", body: { page: "page /同源", id: "job-1" } });
});

test("总线断线仍让在途请求报网络错误，随后的请求直接同源 fetch", async () => {
  const calls = [];
  const api = client({
    fetch: async url => {
      calls.push(url);
      return Response.json({ ok: true });
    }
  });
  api.busConnect();
  const stream = api.connections[0];
  stream.onopen();
  const pending = api.bridgeFetch("/api/chat", "{}");
  await Promise.resolve();
  stream.onerror();
  await assert.rejects(pending, { name: "TypeError", message: "Failed to fetch" });
  assert.equal((await api.bridgeFetch("/api/work/prepare", "{}")).status, 200);
  assert.deepEqual(calls, ["/api/bus/send", "/api/work/prepare"]);
  assert.equal(api.connections.length, 1);
});

test("总线回 409 仍回退到原接口，其他失败状态不偷偷重试", async () => {
  for (const status of [409, 403]) {
    const calls = [];
    const api = client({
      fetch: async url => {
        calls.push(url);
        return url === "/api/bus/send" ? Response.json({ error: "rejected" }, { status }) : new Response("fallback");
      }
    });
    api.busConnect();
    api.connections[0].onopen();
    const pending = api.bridgeFetch("/api/work/prepare", "{}");
    if (status === 409) {
      assert.equal(await (await pending).text(), "fallback");
      assert.deepEqual(calls, ["/api/bus/send", "/api/work/prepare"]);
    } else {
      await assert.rejects(pending, { message: "rejected" });
      assert.deepEqual(calls, ["/api/bus/send"]);
    }
  }
});
