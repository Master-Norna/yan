// 言 · 桥接的总线：一个页面一条事件流，长请求（模型流、工具、指令）的响应都从这条流回去。
// 浏览器对同一个 host:port 最多开 6 条 HTTP/1.1 连接；长请求各占一条，几段对话加几名帮手一起跑，存配置、建目录这类
// 一眨眼的请求就只能排在后面等到超时。走总线后，页面只常占一条连接（事件流），每个请求只用一次立即返回的 POST 交代。
// 第 6 个页面加入时六条全被事件流占满，所有页面的普通请求（包括总线 send）一起排队；所以言的页面上限是五处。
// 交来的请求当作一次普通请求交给桥接的分发函数（门禁照旧按原请求的 Host、Origin 查），响应的头、分块与收尾逐条写回那一页的流：
// 各接口照旧读 req、写 res，不知道自己走的是总线
"use strict";
const { Readable, Writable } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");
const { sendJson, readJson } = require("./http.js");

// 替各接口接响应的 res：与 http.ServerResponse 用到的那几样同形（writeHead / setHeader / write / end / close 事件），
// 写出的东西转成事件交给 emit。页面停了（cancel）或整页断开时 destroy，接口照旧从 close 事件知道对方走了
class BusResponse extends Writable {
  constructor(emit) {
    super({ decodeStrings: false });
    this.statusCode = 200;
    this.headersSent = false;
    this.headers = {};
    this.emitEvent = emit;
    this.decoder = new StringDecoder("utf8");
  }
  setHeader(name, value) {
    this.headers[String(name).toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
    return this;
  }
  getHeader(name) {
    return this.headers[String(name).toLowerCase()];
  }
  hasHeader(name) {
    return String(name).toLowerCase() in this.headers;
  }
  removeHeader(name) {
    delete this.headers[String(name).toLowerCase()];
  }
  writeHead(status, reason, headers) {
    this.statusCode = status;
    for (const [name, value] of Object.entries((typeof reason === "object" ? reason : headers) || {})) this.setHeader(name, value);
    this.flushHead();
    return this;
  }
  flushHeaders() {
    this.flushHead();
  }
  flushHead() {
    if (this.headersSent) return;
    this.headersSent = true;
    this.emitEvent({ t: "head", status: this.statusCode, headers: this.headers });
  }
  _write(chunk, encoding, done) {
    this.flushHead();
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (text) this.emitEvent({ t: "data", text });
    done();
  }
  _final(done) {
    this.flushHead();
    const rest = this.decoder.end();
    if (rest) this.emitEvent({ t: "data", text: rest });
    this.emitEvent({ t: "end" });
    done();
  }
  // 没写完就被掐了（上游断线时 pipeline 会 destroy 它）：不走总线时页面会读到断网，这里也得告诉页面，别让它一直等
  _destroy(error, done) {
    if (!this.writableFinished) this.emitEvent({ t: "drop" });
    done(error);
  }
}

/** @param {{ dispatch: (req: any, res: any) => Promise<void>|void }} options */
module.exports = function createBus({ dispatch }) {
  // page → { res: 事件流, jobs: Map<id, BusResponse>, agent: 那一页的 User-Agent }
  const pages = new Map();

  function openStream(req, res) {
    const query = new URL(req.url, "http://127.0.0.1").searchParams,
      page = query.get("page") || "",
      stream = query.get("stream") || "";
    if (!/^[\w-]{8,80}$/.test(page)) return sendJson(res, 400, { error: "缺少页面标识" });
    if (stream && !/^[\w-]{8,80}$/.test(stream)) return sendJson(res, 400, { error: "事件流标识无效" });
    // 同一页重连：旧流上的请求随旧流作废
    closePage(page);
    // 同一浏览器里已有五页各占一条事件流：这一页再占，六条连接就全满了，各页的普通请求都排着不动。
    // 不接，页面那头 EventSource 遇非 200 即关、不再重连，退回一请求一连接（见 src/01-bridge.js 的 bridgeFetch）。
    // 按 User-Agent 认同一浏览器：同款浏览器的两份配置会算在一起，只会早降、不会漏
    const agent = String(req.headers["user-agent"] || "");
    if ([...pages.values()].filter(entry => entry.agent === agent).length >= 5)
      return sendJson(res, 503, { error: "此浏览器已开五处言，这一页不走总线" });
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    });
    res.write(": open\n\n");
    const entry = { res, jobs: new Map(), agent, stream };
    pages.set(page, entry);
    announcePages(entry.agent);
    // 本机连接一般不会断；隔一阵写一行注释，中途有东西把连接掐了也能尽快发现
    const beat = setInterval(() => res.write(": beat\n\n"), 30000);
    res.on("close", () => {
      clearInterval(beat);
      if (pages.get(page) === entry) closePage(page);
    });
  }
  // 同一个浏览器里言开着几处页面（主页面、各栏、别的标签页、别的窗口）：每处常占一条事件流，
  // 浏览器对同一 host:port 只给六条 HTTP/1.1 连接，是整个浏览器共用的。按 User-Agent 归作同一个浏览器
  // （同款浏览器的两份配置会被算在一起，只会多算、不会少算）；有页开合就告诉同一浏览器里的每一页，右栏据此判还能不能再开一栏
  function announcePages(agent) {
    const same = [...pages.values()].filter(entry => entry.agent === agent);
    const line = `event: pages\ndata: ${JSON.stringify({ n: same.length })}\n\n`;
    for (const entry of same) if (!entry.res.writableEnded) entry.res.write(line);
  }
  function closePage(page) {
    const entry = pages.get(page);
    if (!entry) return;
    pages.delete(page);
    for (const job of entry.jobs.values()) job.destroy();
    entry.jobs.clear();
    if (!entry.res.writableEnded) entry.res.end();
    announcePages(entry.agent);
  }

  async function send(req, res) {
    // 大请求由客户端直连原接口，免掉嵌套 JSON 的多份副本；总线只接小的交代。
    const { page, id, path, body } = await readJson(req, 32 * 1024 * 1024),
      entry = pages.get(page);
    if (!entry) return sendJson(res, 409, { error: "总线未接通" });
    if (typeof id !== "string" || !id || typeof path !== "string" || !path.startsWith("/api/") || path.startsWith("/api/bus"))
      return sendJson(res, 400, { error: "请求无效" });
    sendJson(res, 202, { ok: true });
    const job = new BusResponse(event => {
      if (!entry.res.writableEnded) entry.res.write(`data: ${JSON.stringify({ id, ...event })}\n\n`);
    });
    entry.jobs.set(id, job);
    job.on("close", () => entry.jobs.delete(id));
    // 原请求的 Host、Origin 原样带上：交进分发后门禁照旧，总线不另开后门
    const headers = { ...req.headers, "content-type": "application/json" };
    delete headers["content-length"];
    const inner = Object.assign(Readable.from([Buffer.from(String(body ?? ""), "utf8")]), { method: "POST", url: path, headers });
    await dispatch(inner, job);
  }
  async function cancel(req, res) {
    const { page, id } = await readJson(req);
    pages.get(page)?.jobs.get(id)?.destroy();
    sendJson(res, 200, { ok: true });
  }
  async function close(req, res) {
    const { page, stream } = await readJson(req);
    if (typeof page !== "string" || !/^[\w-]{8,80}$/.test(page) || typeof stream !== "string" || !/^[\w-]{8,80}$/.test(stream))
      return sendJson(res, 400, { error: "页面或事件流标识无效" });
    // pagehide 的延迟请求不能误关 pageshow 后已经重连的新流。
    if (pages.get(page)?.stream === stream) closePage(page);
    sendJson(res, 200, { ok: true });
  }

  return {
    routes: {
      "GET /api/bus": openStream,
      "POST /api/bus/send": send,
      "POST /api/bus/cancel": cancel,
      "POST /api/bus/close": close
    }
  };
};
