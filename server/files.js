// 言 · 桥接的附件目录：附件原件与对话、卷宗、配置放在同一个存储根里（附件/），不再只存在某一个浏览器的 IndexedDB 里
// 由 server.js 装配：require("./server/files.js")({ filesHome })
// 一件附件两份文件：原件本身「<id>.<扩展名>」（文本就是文本，图片就是图片，双击能开）与「<id>.json」（名字、类型、大小、抽出的正文）。
// 页面按 id 存取，交出去的还是它原先在 IndexedDB 里的样子：{ id, kind, name, mime, size, data, extractedText… }，data 是文本或 data: URL
"use strict";
const { sendJson, jsonRoute, errorText, writeAtomic } = require("./http.js");
const fs = require("node:fs");
const path = require("node:path");

module.exports = function createFiles({ filesHome }) {
  const ID = /^[A-Za-z0-9_-]{1,80}$/,
    // 清理只动放了一天以上的：别的标签页刚置入、草稿还没来得及写进配置的那件，不能因为「没人引用」被当场删掉
    CLEAN_GRACE_MS = 24 * 60 * 60 * 1000;
  function checkId(value) {
    const id = String(value || "");
    if (!ID.test(id)) throw Error("附件 id 无效");
    return id;
  }
  function home() {
    const dir = filesHome();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  // 原件的扩展名取自原名，只留字母数字，免得怪名字在目录里生事
  function extensionOf(name) {
    const ext = path.extname(String(name || "")).slice(1);
    return /^[A-Za-z0-9]{1,10}$/.test(ext) ? `.${ext.toLowerCase()}` : "";
  }
  // 这件附件在目录里的原件（扩展名以元数据为准；元数据坏了就按 id 前缀找）
  function rawFileOf(dir, id, meta) {
    if (meta?.file && fs.existsSync(path.join(dir, meta.file))) return meta.file;
    return fs.readdirSync(dir).find(name => name === id || (name.startsWith(`${id}.`) && name !== `${id}.json`)) || "";
  }
  function readMeta(dir, id) {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8"));
    } catch {
      return null;
    }
  }
  const handlePut = jsonRoute(
    async body => {
      const record = body.record;
      if (!record || typeof record !== "object") throw Error("缺少附件内容");
      const id = checkId(record.id),
        dir = home(),
        kind = ["image", "text", "file"].includes(record.kind) ? record.kind : "file";
      let bytes;
      if (kind === "text") bytes = Buffer.from(String(record.data ?? ""), "utf8");
      else {
        const data = String(record.data || ""),
          comma = data.indexOf(",");
        if (!data.startsWith("data:") || comma < 0) throw Error("附件原件格式无效");
        bytes = Buffer.from(data.slice(comma + 1), /;base64/i.test(data.slice(0, comma)) ? "base64" : "utf8");
      }
      const { data: _data, ...rest } = record,
        file = `${id}${extensionOf(record.name)}`;
      // 同一 id 换了扩展名（极少见）：旧的原件不留
      const previous = rawFileOf(dir, id, readMeta(dir, id));
      writeAtomic(path.join(dir, file), bytes);
      writeAtomic(path.join(dir, `${id}.json`), JSON.stringify({ 言: "附件", ...rest, id, kind, file, bytes: bytes.length }, null, 1));
      if (previous && previous !== file) fs.rmSync(path.join(dir, previous), { force: true });
      return { id, bytes: bytes.length };
    },
    error => `附件未能落盘：${errorText(error, 200)}`
  );
  const handleGet = jsonRoute(
    async (body, req, res) => {
      const id = checkId(body.id),
        dir = home(),
        meta = readMeta(dir, id);
      if (!meta) return sendJson(res, 404, { error: "附件不在存储目录里" });
      const raw = rawFileOf(dir, id, meta);
      if (!raw) return sendJson(res, 404, { error: "附件原件不在存储目录里" });
      const bytes = fs.readFileSync(path.join(dir, raw)),
        { 言: _mark, file: _file, bytes: _bytes, ...record } = meta;
      record.data =
        meta.kind === "text"
          ? bytes.toString("utf8")
          : `data:${meta.mime || "application/octet-stream"};base64,${bytes.toString("base64")}`;
      return { record };
    },
    error => errorText(error, 200)
  );
  // 只问在不在：迁入时用，不必把原件整个读回来
  const handleHas = jsonRoute(
    async body => {
      const dir = home(),
        ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(id => ID.test(id));
      return { has: ids.filter(id => fs.existsSync(path.join(dir, `${id}.json`))) };
    },
    error => errorText(error, 200)
  );
  const handleDelete = jsonRoute(
    async body => {
      const dir = home();
      let removed = 0;
      for (const value of Array.isArray(body.ids) ? body.ids : [body.id]) {
        if (!ID.test(String(value || ""))) continue;
        const id = String(value),
          raw = rawFileOf(dir, id, readMeta(dir, id));
        if (raw) fs.rmSync(path.join(dir, raw), { force: true });
        if (fs.existsSync(path.join(dir, `${id}.json`))) {
          fs.rmSync(path.join(dir, `${id}.json`), { force: true });
          removed += 1;
        }
      }
      return { removed };
    },
    error => `附件未能删除：${errorText(error, 200)}`
  );
  // 清掉没人引用的：页面报来仍在用的 id（对话、旁注、补言、草稿、浏览器内卷宗），其余放了一天以上的删去
  const handleClean = jsonRoute(
    async body => {
      if (!Array.isArray(body.keep)) throw Error("缺少仍在用的附件清单");
      const keep = new Set(body.keep.map(String)),
        dir = home(),
        cutoff = Date.now() - CLEAN_GRACE_MS;
      let removed = 0,
        bytes = 0;
      for (const name of fs.readdirSync(dir)) {
        if (name.endsWith(".tmp")) {
          const stat = fs.statSync(path.join(dir, name));
          if (stat.mtimeMs < cutoff) fs.rmSync(path.join(dir, name), { force: true });
          continue;
        }
        const id = name.replace(/\.[^.]*$/, "");
        if (!ID.test(id) || keep.has(id)) continue;
        const stat = fs.statSync(path.join(dir, name));
        if (stat.mtimeMs >= cutoff) continue;
        fs.rmSync(path.join(dir, name), { force: true });
        if (name === `${id}.json`) removed += 1;
        else bytes += stat.size;
      }
      return { removed, bytes };
    },
    error => `附件未能清理：${errorText(error, 200)}`
  );
  return {
    routes: {
      "POST /api/files/put": handlePut,
      "POST /api/files/get": handleGet,
      "POST /api/files/has": handleHas,
      "POST /api/files/delete": handleDelete,
      "POST /api/files/clean": handleClean
    }
  };
};
