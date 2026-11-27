// 言 · MCP 会话：握手、拉工具、调工具，协议的细节都在这一层（请求编号与超时、分页、服务端发来的通知与请求、进度续命）。
// 对外只交出三样：connect() 连上并拿到工具，call(name, args) 调一件，close() 收掉
"use strict";
const { createTransport, SseTransport } = require("./transports.js");

const PROTOCOL = "2025-06-18",
  CONNECT_MS = 60000, // 起进程、握手、拉工具：Python 服务导入重的库时要十几二十秒
  CALL_MS = 600000, // 一件工具默认最多跑十分钟（渲染、构建这类）；服务报进度就续命
  TOOL_PAGES_MAX = 50,
  TOOLS_MAX = 1000; // 一件工具默认最多跑十分钟（渲染、构建这类）；服务报进度就续命
let nextId = 1;

class McpClient {
  /** @param {{ name: string, config: Record<string, any>, version: string, toolEnv: (env: Record<string, string>) => Record<string, string> }} options */
  constructor({ name, config, version, toolEnv }) {
    this.name = name;
    this.config = config;
    this.version = version;
    this.toolEnv = toolEnv;
    this.pending = new Map();
    this.tools = [];
    this.instructions = "";
    this.toolsChanged = false;
    this.closed = false;
    this.error = "";
  }
  async connect() {
    try {
      await this.open(createTransport(this.config, this.toolEnv));
    } catch (error) {
      // 只写了 url、没说 type 的：可流式 HTTP 握手收到 4xx，退回旧式 SSE 再试一次
      if (!this.config.url || this.config.type || !(error.status >= 400 && error.status < 500)) throw error;
      this.transport.close();
      await this.open(new SseTransport(this.config));
    }
    this.tools = await this.listTools();
    // 连上时拉的这一份就是基线：页面这一问会自己来取（/api/mcp/list），此刻不算「变过」
    this.toolsChanged = false;
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
    await withTimeout(
      transport.send({ jsonrpc: "2.0", method: "notifications/initialized" }),
      CONNECT_MS,
      "notifications/initialized 超时"
    );
  }
  async listTools() {
    const tools = [];
    let cursor;
    const cursors = new Set();
    do {
      // 重复游标只是其中一种故障：服务也可能每页给一个全新游标，永远不结束。
      if (cursors.size >= TOOL_PAGES_MAX) throw Error("MCP 工具清单分页超过上限");
      const page = await this.request("tools/list", cursor ? { cursor } : {}, CONNECT_MS);
      if (!Array.isArray(page?.tools)) throw Error("MCP 工具清单缺少 tools 数组");
      if (tools.length + page.tools.length > TOOLS_MAX) throw Error("MCP 工具数量超过上限");
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && typeof cursor !== "string") throw Error("MCP 工具清单游标不是字符串");
      // 上游若反复返回同一游标，不应无限拉取并堆积工具。
      if (cursor && cursors.has(cursor)) throw Error("MCP 工具清单分页游标重复");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    // 这里不清 toolsChanged：清单变了要等页面真拿到新的一份才算交接完（见 index.js 的 handleList 与 handleCall）
    return tools;
  }
  /** 调一件工具；signal 断了就告诉服务端取消。等连接、重拉工具时已经停了的，不再发出（abort 事件只响一次，事后挂上的听不到） */
  /** @param {string} tool @param {Record<string, any>} args @param {{ timeout?: number, signal?: AbortSignal }} [options] */
  async call(tool, args, { timeout = CALL_MS, signal } = {}) {
    if (signal?.aborted) throw Error("已停止");
    if (this.toolsChanged) this.tools = await this.listTools();
    if (signal?.aborted) throw Error("已停止");
    if (!this.tools.some(item => item.name === tool))
      throw Object.assign(Error("MCP 工具未在当前服务清单中"), { toolsChanged: true });
    const id = nextId++;
    const onAbort = () => this.cancelRequest(id, "已停止", "用户停止");
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
      // 进度能延长空闲等待，但不能让工具靠持续刷进度永久占住请求。
      const deadline = Date.now() + (method === "tools/call" ? timeout * 2 : timeout);
      const entry = { resolve, reject, timeout, timer: null, lastProgressAt: null };
      entry.arm = () => {
        clearTimeout(entry.timer);
        const remaining = Math.max(1, Math.min(timeout, deadline - Date.now()));
        entry.timer = setTimeout(() => {
          const absolute = method === "tools/call" && Date.now() >= deadline;
          const reason = absolute
            ? `${method} 超时：已达绝对时限（${Math.round((timeout * 2) / 1000)} 秒；距上次进度 ${entry.lastProgressAt === null ? "无记录" : `${Math.round((Date.now() - entry.lastProgressAt) / 1000)} 秒`}）`
            : `${method} 超时（${Math.round(timeout / 1000)} 秒没有回音）`;
          if (method === "tools/call") this.cancelRequest(id, reason);
          else this.settle(id, Error(reason));
        }, remaining);
      };
      entry.arm();
      this.pending.set(id, entry);
      this.transport.send({ jsonrpc: "2.0", id, method, params }).catch(error => this.settle(id, error));
    });
  }
  cancelRequest(id, reason, notificationReason = reason) {
    if (!this.pending.has(id)) return;
    this.settle(id, Error(reason));
    void this.transport
      .send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: notificationReason } })
      .catch(() => {});
  }
  settle(id, error, result) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (error) {
      // 这一问不再等了（超时、用户停止、连接已判死）：传输那头别再读——事件流可能还在往外吐，读完也没人要
      if (typeof this.transport?.abort === "function") this.transport.abort(id);
      entry.reject(error);
    } else entry.resolve(result);
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
    else if (message.method === "notifications/progress") {
      const entry = this.pending.get(message.params?.progressToken);
      if (entry) {
        entry.lastProgressAt = Date.now();
        entry.arm();
      }
    }
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
