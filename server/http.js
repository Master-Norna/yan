// 言 · 桥接各接口共用的几件：回 JSON、读 JSON、原子写盘，以及把「读请求体 → 办事 → 出错回 400」收成一处的 jsonRoute
// 纯工具，不持状态；server.js 与 server/ 下各模块直接 require
"use strict";
const fs = require("node:fs");

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
// handle(body, req, res) 返回的值即响应；自己写了响应（别的状态码、流）就返回 undefined
function jsonRoute(handle, describe = errorText) {
  return async (req, res) => {
    try {
      const data = await handle(await readJson(req), req, res);
      if (data !== undefined && !res.writableEnded && !res.destroyed) sendJson(res, 200, data);
    } catch (error) {
      if (!res.headersSent) sendJson(res, 400, { error: describe(error) });
      else res.end();
    }
  };
}
// 先写临时文件再改名：写到一半断电、进程被杀，正本也不会只剩半截
function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(temp, data, typeof data === "string" ? "utf8" : undefined);
  fs.renameSync(temp, file);
}

module.exports = { sendJson, readJson, jsonRoute, errorText, writeAtomic };
