// 言 · 桥接的附件目录：附件原件与对话、卷宗、配置放在同一个存储根里（附件/），不再只存在某一个浏览器的 IndexedDB 里
// 由 server.js 装配：require("./server/files.js")({ filesHome })
// 一件附件两份文件：原件本身「<id>.<扩展名>」（文本就是文本，图片就是图片，双击能开）与「<id>.json」（名字、类型、大小、抽出的正文）。
// 页面按 id 存取，交出去的还是它原先在 IndexedDB 里的样子：{ id, kind, name, mime, size, data, extractedText… }，data 是文本或 data: URL
"use strict";
const {
  sendJson,
  jsonRoute,
  errorText,
  writeAtomic,
  replaceFile,
  receiveUpload,
  sendFile,
  openWithSystem,
  readJsonFile
} = require("./http.js");
const fs = require("node:fs");
const path = require("node:path");

module.exports = function createFiles({ filesHome, playable }) {
  const ID = /^[A-Za-z0-9_-]{1,80}$/,
    // 页面那头单件上限 256 MB（见 src/13-files/00-ingest.js），与收入卷宗同
    PUT_LIMIT = 256 * 1024 * 1024,
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
  const readMeta = (dir, id) => readJsonFile(path.join(dir, `${id}.json`));
  // 原件直传（见 http.js 的 receiveUpload）：说明是 { record }——附件的元数据与抽出的正文，不带 data；其后是原件的字节（文本附件是 UTF-8 的正文）
  async function handlePut(req, res) {
    try {
      const dir = home();
      /** @type {Record<string, any>} */
      let record = {},
        id = "",
        kind = "file",
        file = "";
      const { file: temp, bytes } = await receiveUpload(req, PUT_LIMIT, head => {
        record = head?.record;
        if (!record || typeof record !== "object") throw Error("缺少附件内容");
        id = checkId(record.id);
        kind = ["image", "text", "file"].includes(record.kind) ? record.kind : "file";
        // 原件本身是 .json 的，与元数据同名会被元数据盖掉：另取「<id>.raw.json」（id 里没有点，不与别件相混）
        const extension = extensionOf(record.name);
        file = `${id}${extension === ".json" ? ".raw" : ""}${extension}`;
        return path.join(dir, `${file}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`);
      });
      // 同一 id 换了扩展名（极少见）：旧的原件不留
      const previous = rawFileOf(dir, id, readMeta(dir, id)),
        { data: _data, ...rest } = record;
      try {
        replaceFile(temp, path.join(dir, file));
      } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
      }
      writeAtomic(path.join(dir, `${id}.json`), JSON.stringify({ 言: "附件", ...rest, id, kind, file, bytes }, null, 1));
      if (previous && previous !== file) fs.rmSync(path.join(dir, previous), { force: true });
      sendJson(res, 200, { id, bytes });
    } catch (error) {
      if (!res.headersSent) sendJson(res, 400, { error: `附件未能落盘：${errorText(error, 200)}` });
    }
  }
  // meta：只要元数据与抽出的正文（文本附件的正文就是原件，照给）——发问时翻历史里的文档只用得着这些，不必把整份原件编成 base64 取回
  const handleGet = jsonRoute(
    async (body, req, res) => {
      const id = checkId(body.id),
        dir = home(),
        meta = readMeta(dir, id);
      if (!meta) return sendJson(res, 404, { error: "附件不在存储目录里" });
      if (body.meta && meta.kind !== "text") {
        const { 言: _mark, file: _file, bytes: _bytes, ...record } = meta;
        return { record };
      }
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
  // 压缩包交给本机工具处理：只取位置，不把整包编成 base64 再送进模型接口。
  const handlePath = jsonRoute(
    async body => {
      const id = checkId(body.id),
        dir = home(),
        raw = rawFileOf(dir, id, readMeta(dir, id));
      if (!raw) throw Error("附件原件不在存储目录里");
      return { id, path: path.resolve(dir, raw) };
    },
    error => errorText(error, 200)
  );
  // 原件直取：GET /api/files/raw?id=…。预览器看 PDF、放音视频用它——同源地址，不必把整份原件编成 data: URL 经 JSON 取回，也免得 blob: 地址被页面的 CSP 挡住
  async function handleRaw(req, res) {
    try {
      const query = new URL(req.url, "http://127.0.0.1").searchParams,
        id = checkId(query.get("id")),
        dir = home(),
        meta = readMeta(dir, id),
        raw = meta && rawFileOf(dir, id, meta);
      if (!raw) return sendJson(res, 404, { error: "附件原件不在存储目录里" });
      const file = path.join(dir, raw),
        name = meta.name || raw,
        download = !!query.get("download");
      await sendFile(req, res, download ? file : await playable(req, file, name), { name, download });
    } catch (error) {
      if (!res.headersSent) sendJson(res, 404, { error: errorText(error, 200) });
    }
  }
  // 以本机程序打开附件原件（原件落盘时带着原扩展名，系统认得该用什么开）
  const handleOpen = jsonRoute(
    async body => {
      const id = checkId(body.id),
        dir = home(),
        raw = rawFileOf(dir, id, readMeta(dir, id));
      if (!raw) throw Error("附件原件不在存储目录里");
      openWithSystem(path.join(dir, raw));
      return { opened: id };
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
        const id = name.split(".")[0];
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
      "POST /api/files/path": handlePath,
      "GET /api/files/raw": handleRaw,
      "POST /api/files/has": handleHas,
      "POST /api/files/open": handleOpen,
      "POST /api/files/delete": handleDelete,
      "POST /api/files/clean": handleClean
    }
  };
};
