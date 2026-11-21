// 言 · MCP 传输：只管把 JSON-RPC 消息送到、收回，不认识任何方法。三种接法同一个样子：
//   start()        建立连接（进程起来 / 端点就绪）
//   send(message)  发一条（请求、通知、回复都走它）
//   onmessage      收到一条
//   onclose(error) 断了（进程退出、流断开）
//   close()        主动收掉
// stdio：本机起一个进程，逐行一条 JSON；http：可流式的 HTTP（每次 POST，回的是 JSON 或一段事件流）；sse：旧式 HTTP+SSE（先 GET 一条事件流拿到投递地址）
"use strict";
const { spawn } = require("node:child_process");
const { OWN_GROUP, killTree } = require("../platform.js");
const { readLimitedBytes, ERROR_BODY_LIMIT } = require("../web.js");
const fs = require("node:fs");
const path = require("node:path");

const STDERR_KEEP = 4000;

class StdioTransport {
  constructor({ command, args = [], cwd, env = {} }, toolEnv = base => base) {
    this.toolEnv = toolEnv;
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.stderr = "";
    /** @type {(message: any) => void} */
    this.onmessage = () => {};
    /** @type {(error: Error) => void} */
    this.onclose = () => {};
  }
  start(limit = MESSAGE_LIMIT) {
    // 先接桥接的工具环境（Windows 自备包，macOS 系统工具目录），配置里的 env 最后盖上；
    // Python 写的服务在中文 Windows 上默认按 GBK 写 stdout：统一成 UTF-8，且不缓冲
    const env = { PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", ...this.toolEnv(process.env), ...this.env },
      { file, args, shell } = resolveCommand(this.command, this.args, env);
    this.child = spawn(file, args, {
      cwd: this.cwd || undefined,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...OWN_GROUP,
      shell
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    let buffer = "",
      broken = false;
    const tooLarge = () => {
      broken = true;
      buffer = "";
      const error = Error(`服务回的消息过大（一行超过 ${limit / 1024 / 1024} MB）`);
      this.note(error.message);
      this.onclose(error);
      killTree(this.child, "SIGTERM");
    };
    this.child.stdout.on("data", chunk => {
      if (broken) return;
      buffer += chunk;
      let start = 0,
        index;
      // 一个块可以有多行；完整行在 trim 之前量，未见换行的余段也要量。
      while ((index = buffer.indexOf("\n", start)) >= 0) {
        if (index - start > limit) return tooLarge();
        const line = buffer.slice(start, index).trim();
        start = index + 1;
        // 有的服务往 stdout 打日志：不是 JSON 的行记进 stderr，不当消息
        if (!line.startsWith("{") && !line.startsWith("[")) {
          if (line) this.note(line);
          continue;
        }
        try {
          const message = JSON.parse(line);
          for (const one of Array.isArray(message) ? message : [message]) this.onmessage(one);
        } catch {
          this.note(line);
        }
      }
      if (buffer.length - start > limit) return tooLarge();
      buffer = buffer.slice(start);
    });
    this.child.stderr.on("data", chunk => this.note(chunk));
    return new Promise((resolve, reject) => {
      this.child.once("spawn", resolve);
      this.child.once("error", error => {
        reject(Error(`启动失败：${error.message}`));
        this.onclose(error);
      });
      this.child.once("exit", code => this.onclose(Error(`进程已退出（退出码 ${code}）${this.tail()}`)));
    });
  }
  note(text) {
    this.stderr = (this.stderr + text + (text.endsWith("\n") ? "" : "\n")).slice(-STDERR_KEEP);
  }
  // 出错时带上 stderr 的最后几行：服务起不来，原因多半在那里
  tail() {
    const lines = this.stderr.trim().split("\n").slice(-6).join("\n");
    return lines ? `\n${lines}` : "";
  }
  async send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  close() {
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    // 服务可能又起了子进程：连同整棵进程树一起结束；Windows 之外发 SIGTERM，让它自己收掉另起进程组的浏览器
    killTree(child, "SIGTERM");
  }
}
// Windows 上 npx 等工具可能是 .cmd：先按 PATH 与 PATHEXT 找真身，是 .cmd / .bat 才交给 shell（参数逐个加引号）
function resolveCommand(command, args, env) {
  if (process.platform !== "win32") return { file: command, args, shell: false };
  const found = findOnPath(command, env);
  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args, shell: false };
  // 经 shell 起的这条命令，cmd 会先把参数里的 %NAME% 展开一遍；展开出来的值若带空格，cmd 还会按空格把它劈开，
  // 连同后面的参数一并错位（%PATH% 一带就散）。与其让它劈，不如照 cmd 的规矩在这里先展开好，引号与空格仍由 quote 管。
  // 未定义的、落单的 % 原样留着——cmd 也这样
  const expand = value =>
      String(value).replace(/%([^%\s]+)%/g, (whole, name) => {
        const key = Object.keys(env).find(item => item.toUpperCase() === name.toUpperCase());
        return key ? String(env[key]) : whole;
      }),
    quote = value => (!value || /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  // 展开结果里也可能含 %NAME%（环境变量的值、令牌或路径里的字面量）。经一层环境变量转交，
  // 让 cmd 只替换占位符，不再展开结果本身；直接拼进命令行会多展开一次，又把参数拆散。
  const encoded = args.map(expand).map((value, index) => {
    let key = `YAN_MCP_ARG_${index}`;
    while (Object.keys(env).some(name => name.toUpperCase() === key)) key += "_";
    env[key] = quote(value);
    return `%${key}%`;
  });
  return { file: [quote(found), ...encoded].join(" "), args: [], shell: true };
}
// 一条消息的体量上限：桥接是单进程，服务往 stdout 里灌一段没有换行的超长文本、或回一条超大的结果，
// 整份攒在内存里就能把它撑死（所有对话、后台指令一起断）。正常的结果远小于这个数。
// stdio / SSE 已解码，量 UTF-16 码元；整份 HTTP 回话在解码前量字节。
const MESSAGE_LIMIT = 16 * 1024 * 1024;
// 整份回来的（不是事件流）：按字节上限读（与别处同一个原语），超了当场说清，别拿一个残缺的 JSON 去解析
async function readLimitedText(response, limit = MESSAGE_LIMIT) {
  const { buffer, truncated } = await readLimitedBytes(response, limit);
  if (truncated) throw Error(`回的消息过大（超过 ${limit / 1024 / 1024} MB），不再往下读`);
  return buffer.toString("utf8");
}
function findOnPath(command, env) {
  if (path.isAbsolute(command) || /[\\/]/.test(command)) return command;
  const exts = path.extname(command) ? [""] : (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";"),
    pathKey = Object.keys(env).find(name => name.toUpperCase() === "PATH");
  for (const dir of String(env[pathKey] || "").split(path.delimiter))
    for (const ext of exts) {
      const file = path.join(dir, command + ext);
      if (dir && fs.existsSync(file)) return file;
    }
  return command;
}

// 事件流逐条读出：每条事件交给 onEvent(event, data)。完整事件和未见空行的余段各自限量。
async function readEvents(response, onEvent, limit = MESSAGE_LIMIT) {
  const decoder = new TextDecoder();
  let buffer = "",
    carry = "";
  const checkSize = size => {
    if (size > limit) throw Error(`事件过大（超过 ${limit / 1024 / 1024} MB），不再往下读`);
  };
  const drain = () => {
    let start = 0,
      index;
    while ((index = buffer.indexOf("\n\n", start)) >= 0) {
      checkSize(index - start);
      const block = buffer.slice(start, index);
      start = index + 2;
      let event = "message",
        data = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) onEvent(event, data.join("\n"));
    }
    buffer = buffer.slice(start);
    // 末尾单个换行可能是分隔空行的开头；若下块没接上换行，下一次会把它算进事件。
    checkSize(buffer.length - (buffer.endsWith("\n") ? 1 : 0));
  };
  for await (const chunk of response.body) {
    // 块尾的 \r 留到下一块再认：它若与下一块开头的 \n 是同一个换行，分开换就成了两个，事件被拦腰切开
    const text = carry + decoder.decode(chunk, { stream: true });
    carry = text.endsWith("\r") ? "\r" : "";
    buffer += (carry ? text.slice(0, -1) : text).replace(/\r\n?/g, "\n");
    drain();
  }
  if (carry) {
    buffer += "\n";
    drain();
  }
}
// 非成功的回话：只读开头（ERROR_BODY_LIMIT）就够认一句话，整份读进来没有用处。
// 读完把正文掐掉，别让连接挂着；截断的不拿去解析（半截 JSON 也解析不出来），只留状态码与一小段预览
async function httpError(response) {
  const { buffer, truncated } = await readLimitedBytes(response, ERROR_BODY_LIMIT).catch(() => ({
    buffer: Buffer.alloc(0),
    truncated: false
  }));
  const text = buffer.toString("utf8");
  return Error(
    `HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ""}${
      truncated ? `（正文超过 ${ERROR_BODY_LIMIT / 1024} KB，只读了开头）` : ""
    }`
  );
}

class HttpTransport {
  constructor({ url, headers = {} }) {
    this.url = url;
    this.headers = headers;
    this.session = "";
    this.protocol = "";
    /** @type {(message: any) => void} */
    this.onmessage = () => {};
    /** @type {(error: Error) => void} */
    this.onclose = () => {};
    this.aborts = new Set();
    /** @type {Map<any, AbortController>} 按请求编号记着这一条的掐断开关：等它的人不等了（超时、停止、连接已判死），读取也一并收掉 */
    this.reads = new Map();
  }
  async start() {}
  headersFor() {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
      ...(this.protocol ? { "MCP-Protocol-Version": this.protocol } : {}),
      ...this.headers
    };
  }
  async send(message) {
    const abort = new AbortController();
    this.aborts.add(abort);
    const release = () => {
      this.aborts.delete(abort);
      if (message.id !== undefined && this.reads.get(message.id) === abort) this.reads.delete(message.id);
    };
    if (message.id !== undefined) this.reads.set(message.id, abort);
    // 回复走事件流时 send 先返回、流还在读：这次请求的掐断开关要留到流读完，close() 才掐得到它
    let streaming = false;
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: this.headersFor(),
        body: JSON.stringify(message),
        signal: abort.signal
      });
      const session = response.headers.get("mcp-session-id");
      if (session) this.session = session;
      // 会话过期：交给上层重连。这份正文不采用，当场取消，别让连接挂着
      if (response.status === 404 && this.session) {
        await response.body?.cancel().catch(() => {});
        this.onclose(Error("会话已过期"));
        return;
      }
      if (!response.ok) throw Object.assign(await httpError(response), { status: response.status });
      // 202 就是「收下了」：有正文也不用
      if (response.status === 202) {
        await response.body?.cancel().catch(() => {});
        return;
      }
      if (!response.body) return;
      const type = response.headers.get("content-type") || "";
      if (type.includes("text/event-stream")) {
        // 回复在事件流里，读完为止；不等它读完，send 先返回，别的请求照常发
        streaming = true;
        void readEvents(response, (event, data) => {
          if (event === "message") this.deliver(data);
        })
          .catch(error => {
            // 自己 close() 掐的不算；流半路断了，告诉等这条回复的那一问，别让它干等到超时（已经回过的，上层认不出这个 id，自然不理）
            if (!abort.signal.aborted && message.id !== undefined)
              this.onmessage({ jsonrpc: "2.0", id: message.id, error: { message: `事件流中断：${error?.message || error}` } });
          })
          .finally(release);
      } else {
        const text = await readLimitedText(response);
        // 正文已经读完，这条不必再掐；再往后若收到的是 JSON-RPC 错误，也不该白 abort 一次
        release();
        this.deliver(text);
      }
    } finally {
      if (!streaming) release();
    }
  }
  // 等这条回复的人不再等了：把还在读的正文与连着的请求一并收掉（只在还没读完时有效）
  abort(id) {
    const abort = this.reads.get(id);
    if (!abort) return;
    this.reads.delete(id);
    abort.abort();
  }
  deliver(text) {
    if (!text.trim()) return;
    const message = JSON.parse(text);
    for (const one of Array.isArray(message) ? message : [message]) this.onmessage(one);
  }
  close() {
    for (const abort of this.aborts) abort.abort();
    this.reads.clear();
    if (this.session) void fetch(this.url, { method: "DELETE", headers: this.headersFor() }).catch(() => {});
  }
}

class SseTransport {
  /** @param {{ url?: string, headers?: Record<string, string> }} config */
  constructor({ url, headers = {} }) {
    this.url = url;
    this.headers = headers;
    /** @type {(message: any) => void} */
    this.onmessage = () => {};
    /** @type {(error: Error) => void} */
    this.onclose = () => {};
    this.abort = new AbortController();
  }
  async start() {
    const response = await fetch(this.url, {
      headers: { Accept: "text/event-stream", ...this.headers },
      signal: this.abort.signal
    });
    if (!response.ok) throw await httpError(response);
    // 第一条 endpoint 事件告诉往哪里投递，此后的 message 事件都是回来的消息
    await new Promise((resolve, reject) => {
      readEvents(response, (event, data) => {
        if (event === "endpoint") {
          this.endpoint = new URL(data, this.url).href;
          resolve();
        } else if (event === "message") this.onmessage(JSON.parse(data));
      })
        .then(() => this.onclose(Error("事件流已断开")))
        .catch(error => {
          reject(error);
          this.onclose(error);
        });
    });
  }
  async send(message) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(message)
    });
    if (!response.ok) throw await httpError(response);
    // 旧式 SSE 的投递回执不采用正文（通行是 202 空体）：有也不读，当场取消
    await response.body?.cancel().catch(() => {});
  }
  close() {
    this.abort.abort();
  }
}

// 按配置挑传输：有 command 是本机进程；有 url 的，type 写了 sse 走旧式，否则走可流式的 HTTP
function createTransport(config, toolEnv) {
  if (config.command) return new StdioTransport(config, toolEnv);
  if (config.url) return /sse/i.test(config.type || config.transport || "") ? new SseTransport(config) : new HttpTransport(config);
  throw Error("配置里既没有 command 也没有 url");
}

module.exports = { createTransport, SseTransport, readEvents, readLimitedText };
