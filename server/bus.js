// 言 · 桥接的总线：一个页面一条事件流，长请求（模型流、工具、指令）的响应都从这条流回去。
// 浏览器对同一个 host:port 最多开 6 条 HTTP/1.1 连接；长请求各占一条，几段对话加几名帮手一起跑，存配置、建目录这类
// 一眨眼的请求就只能排在后面等到超时。走总线后，页面只常占一条连接（事件流），每个请求只用一次立即返回的 POST 交代。
// 交来的请求当作一次普通请求交给桥接的分发函数（门禁照旧按原请求的 Host、Origin 查），响应的头、分块与收尾逐条写回那一页的流：
// 各接口照旧读 req、写 res，不知道自己走的是总线
"use strict";
const { Readable, Writable } = require("node:stream");
const { StringDecoder } = require("node:string_decoder");
const { sendJson, readJson } = require("./http.js");

// 替各接口接响应的 res：与 http.ServerResponse 用到的那几样同形（writeHead / setHeader / write / end / close 事件），
// 写出的东西转成事件交给 emit。页面停了（cancel）或整页断开时 destroy，接口照旧从 close 事件知道对方走了
class BusResponse extends Writable {
  constructor(stream, write) {
    super({ decodeStrings: false });
    this.statusCode = 200;
    this.headersSent = false;
    this.headers = {};
    this.stream = stream;
    this.writeEvent = write;
    this.decoder = new StringDecoder("utf8");
    // writeHead/flushHeaders 也可能先于正文写入：所有事件按次序排队，背压与断线在同一处处理。
    this.events = Promise.resolve();
    // 正等页面读走的那一次：取消或断线时由 releaseWaiter 收掉，不能把监听留在页面连接上。
    this.waiter = null;
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
  sendEvent(event) {
    if (this.destroyed) throw Error("总线已断开");
    if (this.writeEvent(event)) return;
    // 页面那头堵住了：等它读走再往下写。取消作业时也要把这次等待结了，
    // 否则已销毁的任务连同监听一直挂在页面的流上。
    const stream = this.stream;
    return new Promise((resolve, reject) => {
      const finish = error => {
        stream.off("drain", drained);
        stream.off("close", closed);
        stream.off("error", failed);
        if (this.waiter === finish) this.waiter = null;
        error ? reject(error) : resolve();
      };
      const drained = () => finish(),
        closed = () => finish(Error("总线已断开")),
        failed = error => finish(error);
      this.waiter = finish;
      stream.once("drain", drained);
      stream.once("close", closed);
      stream.once("error", failed);
    });
  }
  releaseWaiter(error) {
    const finish = this.waiter;
    this.waiter = null;
    if (finish) finish(error || Error("总线已断开"));
  }
  queueEvent(event) {
    // 任意事件（包括仅 writeHead 发出的 head）失败，都必须收掉任务，
    // 不能留下无人接的 Promise rejection；排队保证 head → data → end 的顺序。
    this.events = this.events
      .then(() => {
        if (!this.destroyed) return this.sendEvent(event);
      })
      .catch(() => this.destroy());
    return this.events;
  }
  flushHead() {
    if (this.headersSent) return;
    this.headersSent = true;
    void this.queueEvent({ t: "head", status: this.statusCode, headers: { ...this.headers } });
  }
  _write(chunk, encoding, done) {
    this.flushHead();
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    // SSE 连接堵住时不能立即确认写完：要把背压传回生成内容的接口。
    (text ? this.queueEvent({ t: "data", text }) : this.events).then(() => done(), done);
  }
  _final(done) {
    this.flushHead();
    const rest = this.decoder.end();
    if (rest) this.queueEvent({ t: "data", text: rest });
    this.queueEvent({ t: "end" }).then(() => done(), done);
  }
  // 没写完就被掐了（上游断线时 pipeline 会 destroy 它）：不走总线时页面会读到断网，这里也得告诉页面，别让它一直等
  _destroy(error, done) {
    // 先结掉还在等 drain 的那一次，取消作业后不在页面连接上留监听
    this.releaseWaiter(error);
    if (!this.writableFinished)
      try {
        // 终结事件尽力写一次即可：连接已堵或已断，都不再为它挂等待
        this.writeEvent({ t: "drop" });
      } catch {}
    done(error);
  }
}

/** @param {{ dispatch: (req: any, res: any) => Promise<void>|void, onPages?: (count: number) => void }} options onPages：连着总线的页数变了 */
module.exports = function createBus({ dispatch, onPages = () => {} }) {
  // page → { res: 事件流, jobs: Map<id, BusResponse>, agent: 那一页的 User-Agent }
  const pages = new Map();

  function openStream(req, res) {
    const page = new URL(req.url, "http://127.0.0.1").searchParams.get("page") || "";
    if (!/^[\w-]{8,80}$/.test(page)) return sendJson(res, 400, { error: "缺少页面标识" });
    // 同一页重连：旧流上的请求随旧流作废；但「先到的取消」还等着拦它那一条迟到的 send，随页带走
    const pending = pages.get(page)?.cancelled;
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
    const entry = { res, jobs: new Map(), cancelled: pending || new Map(), agent };
    pages.set(page, entry);
    onPages(pages.size);
    // 本机连接一般不会断；隔一阵写一行注释，中途有东西把连接掐了也能尽快发现
    const beat = setInterval(() => res.write(": beat\n\n"), 30000);
    res.on("close", () => {
      clearInterval(beat);
      if (pages.get(page) === entry) closePage(page);
    });
  }
  function closePage(page) {
    const entry = pages.get(page);
    if (!entry) return;
    pages.delete(page);
    onPages(pages.size);
    for (const job of entry.jobs.values()) job.destroy();
    entry.jobs.clear();
    if (!entry.res.writableEnded) entry.res.end();
  }

  async function send(req, res) {
    // 大请求由客户端直连原接口，免掉嵌套 JSON 的多份副本；总线只接小的交代。
    const { page, id, path, body } = await readJson(req, 32 * 1024 * 1024),
      entry = pages.get(page);
    if (!entry) return sendJson(res, 409, { error: "总线未接通" });
    if (typeof id !== "string" || !id || typeof path !== "string" || !path.startsWith("/api/") || path.startsWith("/api/bus"))
      return sendJson(res, 400, { error: "请求无效" });
    if (entry.jobs.has(id)) return sendJson(res, 409, { error: "请求标识已在使用" });
    if (entry.cancelled.delete(id)) return sendJson(res, 410, { error: "已停止" });
    sendJson(res, 202, { ok: true });
    const job = new BusResponse(entry.res, event => {
      if (entry.res.writableEnded || entry.res.destroyed) throw Error("总线已断开");
      return entry.res.write(`data: ${JSON.stringify({ id, ...event })}\n\n`);
    });
    entry.jobs.set(id, job);
    job.on("close", () => {
      if (entry.jobs.get(id) === job) entry.jobs.delete(id);
    });
    // 原请求的 Host、Origin 原样带上：交进分发后门禁照旧，总线不另开后门
    const headers = { ...req.headers, "content-type": "application/json" };
    delete headers["content-length"];
    const inner = Object.assign(Readable.from([Buffer.from(String(body ?? ""), "utf8")]), { method: "POST", url: path, headers });
    await dispatch(inner, job);
  }
  async function cancel(req, res) {
    const { page, id } = await readJson(req);
    const entry = pages.get(page);
    // 已登记的作业照旧销毁（长度不限，与没有这张表时一样）；没登记的才记下来等那条迟到的 send。
    // 长度与条数只为给这张表封口，不挡销毁。
    const job = entry?.jobs.get(id);
    if (job) job.destroy();
    else if (entry && typeof id === "string" && id.length <= 128) {
      // 取消可能先于 send 的请求体解析完成。只在本页短暂记下尚未登记的请求。
      const now = Date.now();
      for (const [key, at] of entry.cancelled) if (now - at > 60000) entry.cancelled.delete(key);
      entry.cancelled.set(id, now);
      while (entry.cancelled.size > 256) entry.cancelled.delete(entry.cancelled.keys().next().value);
    }
    sendJson(res, 200, { ok: true });
  }

  return {
    routes: {
      "GET /api/bus": openStream,
      "POST /api/bus/send": send,
      "POST /api/bus/cancel": cancel
    }
  };
};
