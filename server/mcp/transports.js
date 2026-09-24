// 言 · MCP 传输：只管把 JSON-RPC 消息送到、收回，不认识任何方法。三种接法同一个样子：
//   start()        建立连接（进程起来 / 端点就绪）
//   send(message)  发一条（请求、通知、回复都走它）
//   onmessage      收到一条
//   onclose(error) 断了（进程退出、流断开）
//   close()        主动收掉
// stdio：本机起一个进程，逐行一条 JSON；http：可流式的 HTTP（每次 POST，回的是 JSON 或一段事件流）；sse：旧式 HTTP+SSE（先 GET 一条事件流拿到投递地址）
"use strict";
const { spawn, execFileSync } = require("node:child_process");
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
    this.onmessage = () => {};
    this.onclose = () => {};
  }
  start() {
    // 先接上沙箱环境（环境里的 Python、uvx、npm 装的工具都找得到），配置里写的 env 最后盖上；
    // Python 写的服务在中文 Windows 上默认按 GBK 写 stdout：统一成 UTF-8，且不缓冲
    const env = { PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", ...this.toolEnv(process.env), ...this.env },
      { file, args, shell } = resolveCommand(this.command, this.args, env);
    this.child = spawn(file, args, {
      cwd: this.cwd || undefined,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    let buffer = "";
    this.child.stdout.on("data", chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
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
    // 服务可能又起了子进程：Windows 上连同整棵进程树一起结束
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } catch {}
    } else child.kill();
  }
}
// Windows 上 npx、uvx 这类是 .cmd：得经 cmd 才起得来。先按 PATH 与 PATHEXT 找到真身，是 .cmd / .bat 就交给 shell（参数逐个加引号）
function resolveCommand(command, args, env) {
  if (process.platform !== "win32") return { file: command, args, shell: false };
  const found = findOnPath(command, env);
  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args, shell: false };
  const quote = value => (/[\s"&|<>^()]/.test(value) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
  return { file: [found, ...args].map(quote).join(" "), args: [], shell: true };
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

// 事件流逐条读出：每条事件交给 onEvent(event, data)
async function readEvents(response, onEvent) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, "\n");
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      let event = "message",
        data = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) onEvent(event, data.join("\n"));
    }
  }
}
async function httpError(response) {
  const text = await response.text().catch(() => "");
  return Error(`HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ""}`);
}

class HttpTransport {
  constructor({ url, headers = {} }) {
    this.url = url;
    this.headers = headers;
    this.session = "";
    this.protocol = "";
    this.onmessage = () => {};
    this.onclose = () => {};
    this.aborts = new Set();
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
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: this.headersFor(),
        body: JSON.stringify(message),
        signal: abort.signal
      });
      const session = response.headers.get("mcp-session-id");
      if (session) this.session = session;
      // 会话过期：交给上层重连
      if (response.status === 404 && this.session) {
        this.onclose(Error("会话已过期"));
        return;
      }
      if (!response.ok) throw Object.assign(await httpError(response), { status: response.status });
      if (response.status === 202 || !response.body) return;
      const type = response.headers.get("content-type") || "";
      if (type.includes("text/event-stream"))
        // 回复在事件流里，读完为止；不等它读完，send 先返回，别的请求照常发
        void readEvents(response, (event, data) => {
          if (event === "message") this.deliver(data);
        }).catch(() => {});
      else this.deliver(await response.text());
    } finally {
      this.aborts.delete(abort);
    }
  }
  deliver(text) {
    if (!text.trim()) return;
    const message = JSON.parse(text);
    for (const one of Array.isArray(message) ? message : [message]) this.onmessage(one);
  }
  close() {
    for (const abort of this.aborts) abort.abort();
    if (this.session) void fetch(this.url, { method: "DELETE", headers: this.headersFor() }).catch(() => {});
  }
}

class SseTransport {
  constructor({ url, headers = {} }) {
    this.url = url;
    this.headers = headers;
    this.onmessage = () => {};
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

module.exports = { createTransport, SseTransport };
