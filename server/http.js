// 言 · 桥接各接口共用的几件：回 JSON、读 JSON、收直传的原件、原子写盘、读盘上的 JSON 与算文件指纹，以及把「读请求体 → 办事 → 出错回 400」收成一处的 jsonRoute
// 纯工具，不持状态；server.js 与 server/ 下各模块直接 require
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { openPath } = require("./platform.js");

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}
function readJson(req, limit = 128 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on("data", chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > limit) {
        rejected = true;
        reject(Error("请求内容过大"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(Error("请求 JSON 无效"));
      }
    });
    req.on("error", reject);
  });
}
// 出错时回给页面的那句话：取 message，截到 limit 字
function errorText(error, limit = 500) {
  return String(error?.message || error).slice(0, limit);
}
// 接口的常见形状：读请求体，办完回 200 与结果；中途抛错就回 400，那句话由 describe 定（各模块的前缀、截断长度不同）。
// handle(body, req, res) 返回的值即响应；自己写了响应（别的状态码、流）就返回 undefined；limit 是请求体上限，缺省同 readJson
// 对方在响应写出之前走了（页面点停止、断线；走总线时是 BusResponse 被 destroy）：接口据此放弃还没开始的事，如排队等锁
function requestSignal(res) {
  const abort = new AbortController();
  if (res.destroyed && !res.writableEnded) abort.abort();
  else
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
  return abort.signal;
}
// 桥接日志每行打头的时刻
const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
function jsonRoute(handle, describe = errorText, limit = undefined) {
  return async (req, res) => {
    try {
      const data = await handle(await readJson(req, limit), req, res);
      if (data !== undefined && !res.writableEnded && !res.destroyed) sendJson(res, 200, data);
    } catch (error) {
      if (!res.headersSent) sendJson(res, 400, { error: describe(error) });
      else res.end();
    }
  };
}
// 原件直传：请求体头一段是 JSON 的说明（多长写在网址的 head= 里），紧跟原件的字节（页面的 bridgeUpload 这样送）。
// 说明读完交给 place，由它核过、定下写进哪个临时文件；其余的字节边收边写，不在内存里攒整份——几百 MB 的原件，
// 先前编成 data: URL 拼进 JSON，页面与桥接两头各要托住几整份。原件超过 limit 即作罢；出错都删掉写了一半的
/** @param {import("node:http").IncomingMessage} req @param {number} limit @param {(head: any) => string | Promise<string>} place */
async function receiveUpload(req, limit, place) {
  const headLength = Number(new URL(req.url || "", "http://127.0.0.1").searchParams.get("head"));
  if (!Number.isInteger(headLength) || headLength <= 0 || headLength > 16 * 1024 * 1024) throw Error("上传缺少说明");
  let head = Buffer.alloc(0),
    size = 0,
    temp = "",
    /** @type {import("node:fs/promises").FileHandle | null} */
    out = null,
    meta;
  try {
    for await (const chunk of req) {
      let rest = chunk;
      if (!temp) {
        const need = headLength - head.length;
        head = Buffer.concat([head, rest.subarray(0, need)]);
        rest = rest.subarray(need);
        if (head.length < headLength) continue;
        try {
          meta = JSON.parse(head.toString("utf8"));
        } catch {
          throw Error("上传的说明不是 JSON");
        }
        temp = await place(meta);
        out = await fs.promises.open(temp, "wx");
      }
      size += rest.length;
      if (size > limit) throw Object.assign(Error("请求内容过大"), { tooLarge: true });
      if (rest.length) await out?.write(rest);
    }
    if (!out) throw Error("上传的内容不完整");
    await out.close();
    return { head: meta, file: temp, bytes: size };
  } catch (error) {
    await out?.close().catch(() => {});
    if (temp) fs.rmSync(temp, { force: true });
    if (error.tooLarge) req.destroy();
    throw error;
  }
}
// 临时文件换成正本。Windows 上目标文件被索引器或杀毒程序短暂打开时，替换可能报 EPERM / EBUSY：
// 等几个很短的间隔再试同一份临时文件；永久错误仍原样交给调用方
function replaceFile(temp, file) {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt++)
    try {
      fs.renameSync(temp, file);
      return;
    } catch (error) {
      if (attempt >= 3 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      Atomics.wait(wait, 0, 0, 15 * 2 ** attempt);
    }
}
// 先写临时文件再改名：写到一半断电、进程被杀，正本也不会只剩半截
function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`;
  try {
    fs.writeFileSync(temp, data, typeof data === "string" ? "utf8" : undefined);
    replaceFile(temp, file);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {}
    throw error;
  }
}

// 交给页面看的文件（卷宗、附件原件）：类型按扩展名定。网页、脚本一律当纯文本——文件是模型写的或随手拖进来的，
// 若以本站源头当网页打开，脚本便能读到页面的 localStorage；再加 CSP: sandbox 兜底。
// SVG 按图送（卷宗的缩略图、预览要画得出来）：放进 <img> 里脚本本就不跑，直接打开时 CSP: sandbox 也不许它跑
const FILE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  zip: "application/zip",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska"
};
function fileMime(name) {
  const extension = String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
  if (["html", "htm", "xml", "js", "mjs", "cjs"].includes(extension)) return "text/plain; charset=utf-8";
  return FILE_MIME[extension] || "application/octet-stream";
}
// 送出一件文件：带 Range（音视频拖进度条只取那一段），?download 时让浏览器另存
async function sendFile(req, res, file, { name, download = false }) {
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) throw Error("文件不存在");
  const size = stat.size,
    range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ""));
  let start = 0,
    end = size - 1;
  if (range && size && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else start = Math.max(0, size - Number(range[2]));
    if (start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      return res.end();
    }
  }
  const partial = start > 0 || end < size - 1;
  res.writeHead(partial ? 206 : 200, {
    "Content-Type": fileMime(name),
    "Content-Length": size ? end - start + 1 : 0,
    "Accept-Ranges": "bytes",
    ...(partial ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    "Cache-Control": "no-cache",
    "Last-Modified": stat.mtime.toUTCString(),
    "Content-Security-Policy": "sandbox",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`
  });
  if (req.method === "HEAD" || !size) return res.end();
  // 读到一半文件没了（预览途中被删、被移走）：头已发出，只能掐断这条连接，不然页面那头一直等着
  fs.createReadStream(file, { start, end })
    .on("error", () => res.destroy())
    .pipe(res);
}

// 交给 Windows 的默认程序打开一件文件（预览认不得、或只抽得出结构时，看原样）。
// 可执行的一类不开：对它们「打开」就是运行，而文件常是模型写的或随手拖进来的
const RUNNABLE = new Set([
  "exe",
  "com",
  "bat",
  "cmd",
  "msi",
  "ps1",
  "vbs",
  "vbe",
  "js",
  "jse",
  "wsf",
  "wsh",
  "hta",
  "scr",
  "pif",
  "lnk",
  "cpl",
  "reg",
  "jar"
]);
function openWithSystem(file) {
  if (RUNNABLE.has(path.extname(file).slice(1).toLowerCase())) throw Error("可执行的文件不在此打开，请到资源管理器里自行处理");
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw Error("文件不存在");
  openPath(file);
}
// 读盘上的 JSON 文本：带 UTF-8 BOM 的（PowerShell 5.1 的 -Encoding UTF8、旧记事本都会写）先去掉，不然 JSON.parse 认不得
function parseJsonText(text) {
  return JSON.parse(String(text).replace(/^\uFEFF/, ""));
}
// \u8BFB\u6865\u63A5\u81EA\u5DF1\u8BB0\u7684\u4E00\u4EFD JSON\uFF08\u767B\u5F55\u3001\u7C3F\u8BB0\u3001\u7D22\u5F15\u2026\u2026\uFF09\uFF1A\u6CA1\u6709\u3001\u8BFB\u4E0D\u4E86\u3001\u574F\u4E86\u90FD\u5F53\u6CA1\u6709\uFF0C\u56DE fallback
function readJsonFile(file, fallback = null) {
  try {
    return parseJsonText(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
// \u4E00\u4EF6\u6587\u4EF6\u5185\u5BB9\u7684 SHA-1\uFF1A\u8FB9\u8BFB\u8FB9\u7B97\uFF0C\u4E0D\u628A\u6574\u4EFD\u8BFB\u8FDB\u5185\u5B58
async function fileHash(file) {
  const hash = crypto.createHash("sha1");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
module.exports = {
  sendJson,
  readJson,
  jsonRoute,
  requestSignal,
  stamp,
  errorText,
  writeAtomic,
  replaceFile,
  receiveUpload,
  fileMime,
  sendFile,
  openWithSystem,
  parseJsonText,
  readJsonFile,
  fileHash
};
