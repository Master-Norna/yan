import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { connect } = createRequire(import.meta.url)("../../server/headless.js");

class SilentSocket {
  static latest;
  readyState = 0;
  constructor() {
    SilentSocket.latest = this;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

test("无头浏览器的 WebSocket 握手无回音也会到时收掉", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = SilentSocket;
  try {
    await assert.rejects(connect("ws://127.0.0.1:1", 20), /连接浏览器调试口超时/);
    assert.equal(SilentSocket.latest.readyState, 3);
  } finally {
    globalThis.WebSocket = original;
  }
});

test("调试请求无回音时，释放同一连接上所有等待者", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = SilentSocket;
  try {
    const connecting = connect("ws://127.0.0.1:1", 20);
    SilentSocket.latest.open();
    const browser = await connecting;
    const first = browser.send("Page.navigate");
    const second = browser.send("Runtime.evaluate");
    await Promise.all([
      assert.rejects(first, /浏览器调试请求超时/),
      assert.rejects(second, /浏览器调试请求超时/)
    ]);
    assert.equal(SilentSocket.latest.readyState, 3);
    await assert.rejects(browser.send("Page.navigate"), /浏览器已断开/);
  } finally {
    globalThis.WebSocket = original;
  }
});

test("正常收到调试回复时，清除超时等待", async () => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = SilentSocket;
  try {
    const connecting = connect("ws://127.0.0.1:1", 20);
    SilentSocket.latest.open();
    const browser = await connecting;
    const request = browser.send("Browser.getVersion");
    SilentSocket.latest.onmessage({ data: JSON.stringify({ id: 1, result: { userAgent: "Chrome" } }) });
    assert.deepEqual(await request, { userAgent: "Chrome" });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(SilentSocket.latest.readyState, 1);
    SilentSocket.latest.close();
  } finally {
    globalThis.WebSocket = original;
  }
});
