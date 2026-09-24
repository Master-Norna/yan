// 言 · MCP 会话：握手、拉工具、调工具，协议的细节都在这一层（请求编号与超时、分页、服务端发来的通知与请求、进度续命）。
// 对外只交出三样：connect() 连上并拿到工具，call(name, args) 调一件，close() 收掉
"use strict";
const { createTransport, SseTransport } = require("./transports.js");

const PROTOCOL = "2025-06-18",
  CONNECT_MS = 60000, // 起进程、握手、拉工具：Python 服务导入重的库时要十几二十秒
  CALL_MS = 600000; // 一件工具默认最多跑十分钟（渲染、构建这类）；服务报进度就续命
let nextId = 1;

class McpClient {
  /** @param {{ name: string, config: Record<string, any>, version: string }} options */
  constructor({ name, config, version }) {
    this.name = name;
    this.config = config;
    this.version = version;
    this.pending = new Map();
    this.tools = [];
    this.instructions = "";
    this.toolsChanged = false;
    this.closed = false;
    this.error = "";
  }
  async connect() {
    try {
      await this.open(createTransport(this.config));
    } catch (error) {
      // 只写了 url、没说 type 的：可流式 HTTP 握手被拒（多是 4xx），退回旧式 SSE 再试一次
      if (!this.config.url || this.config.type || !(error.status >= 400 && error.status < 500)) throw error;
      this.transport.close();
      await this.open(new SseTransport(this.config));
    }
    this.tools = await this.listTools();
    return this;
  }
  async open(transport) {
    this.transport = transport;
    this.closed = false;
    transport.onmessage = message => this.receive(message);
    transport.onclose = error => this.lost(error);
    await withTimeout(transport.start(), CONNECT_MS, "连接超时");
    const result = await this.request(
      "initialize",
      { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "yan", title: "言", version: this.version } },
      CONNECT_MS
    );
    if (transport.protocol !== undefined) transport.protocol = result.protocolVersion;
    this.instructions = result.instructions || "";
    this.server = result.serverInfo || {};
    await transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  async listTools() {
    const tools = [];
    let cursor;
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {}, CONNECT_MS);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    this.toolsChanged = false;
    return tools;
  }
  /** 调一件工具；signal 断了就告诉服务端取消 */
  async call(tool, args, { timeout = CALL_MS, signal } = {}) {
    if (this.toolsChanged) this.tools = await this.listTools();
    const id = nextId++;
    const onAbort = () => {
      this.settle(id, Error("已停止"));
      void this.transport
        .send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "用户停止" } })
        .catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await this.request("tools/call", { name: tool, arguments: args, _meta: { progressToken: id } }, timeout, id);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }
  request(method, params, timeout, id = nextId++) {
    if (this.closed) return Promise.reject(Error(this.error || "连接已断开"));
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timeout, timer: null };
      entry.arm = () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this.settle(id, Error(`${method} 超时（${Math.round(timeout / 1000)} 秒没有回音）`)), timeout);
      };
      entry.arm();
      this.pending.set(id, entry);
      this.transport.send({ jsonrpc: "2.0", id, method, params }).catch(error => this.settle(id, error));
    });
  }
  settle(id, error, result) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (error) entry.reject(error);
    else entry.resolve(result);
  }
  receive(message) {
    // 回复
    if (message.id !== undefined && !message.method) {
      const error =
        message.error && Error(`${message.error.message || "服务端出错"}${message.error.code ? `（${message.error.code}）` : ""}`);
      return this.settle(message.id, error, message.result);
    }
    // 服务端发来的请求：ping 照回；别的能力（采样、追问、目录根）都没声明，回「不支持」
    if (message.id !== undefined) {
      const reply =
        message.method === "ping"
          ? { result: {} }
          : message.method === "roots/list"
            ? { result: { roots: [] } }
            : { error: { code: -32601, message: `言不支持 ${message.method}` } };
      void this.transport.send({ jsonrpc: "2.0", id: message.id, ...reply }).catch(() => {});
      return;
    }
    // 通知：工具变了下次调用前重拉；报进度的给那次调用续命
    if (message.method === "notifications/tools/list_changed") this.toolsChanged = true;
    else if (message.method === "notifications/progress") this.pending.get(message.params?.progressToken)?.arm();
  }
  lost(error) {
    if (this.closed) return;
    this.closed = true;
    this.error = String(error?.message || "连接已断开");
    for (const id of [...this.pending.keys()]) this.settle(id, Error(this.error));
  }
  close() {
    this.lost(Error("已关闭"));
    this.transport?.close();
  }
}
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => (timer = setTimeout(() => reject(Error(message)), ms)))]).finally(() =>
    clearTimeout(timer)
  );
}

module.exports = { McpClient };
