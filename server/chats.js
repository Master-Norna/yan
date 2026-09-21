// 言 · 桥接的对话目录：对话像卷宗一样落在本机的一个目录里，一段对话一个 JSON 文件，页面经桥接读、写、删
// 由 server.js 装配：require("./server/chats.js")({ sendJson, readJson })
// 目录默认在 ~/言/对话（测试用 YAN_CHATS 指到临时目录）。文件名带标题便于翻看，末尾缀上按对话 id 算的短码来认身份：
// 「关于滚动条·3f9a2c1b0e.json」；标题改了文件跟着改名，删对话就删文件。另有一份「设置.json」是浏览器里配置的镜像（不含 API Key），
// 换浏览器或清了站点数据后开页可从它恢复
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

module.exports = function createChats({ sendJson, readJson }) {
  const CHATS_HOME = process.env.YAN_CHATS
    ? path.resolve(String(process.env.YAN_CHATS).replace(/^~(?=$|[\/])/, os.homedir()))
    : path.join(os.homedir(), "言", "对话");
  const META_FILE = "设置.json",
    FILE_LIMIT = 256 * 1024 * 1024;
  function ensureDir() {
    fs.mkdirSync(CHATS_HOME, { recursive: true });
    return CHATS_HOME;
  }
  function describe(error, target = "") {
    const code = error?.code,
      where = target ? `：${target}` : "";
    if (code === "ENOENT") return `路径不存在${where}`;
    if (code === "EACCES" || code === "EPERM") return `没有访问权限${where}`;
    if (code === "EBUSY") return `文件正被占用${where}`;
    return String(error?.message || error).slice(0, 200);
  }
  // 对话 id 的短码：文件名靠它认对话。老版本的 id 是「时间戳-随机数」，头几位彼此相同，不能直接截，按整个 id 取哈希
  function codeOf(id) {
    return crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 10);
  }
  function safeTitle(title) {
    const text = String(title || "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "");
    return (text || "对话").slice(0, 40);
  }
  function fileNameFor(id, title) {
    return `${safeTitle(title)}·${codeOf(id)}.json`;
  }
  // 目录里这段对话现有的文件（正常只有一个；标题改过后旧名留着的也一并算上）
  function filesFor(id) {
    const suffix = `·${codeOf(id)}.json`;
    return fs.readdirSync(CHATS_HOME).filter(name => name.endsWith(suffix));
  }
  // 先写临时文件再改名，写到一半断电也不会留下半个文件顶替原件
  function writeAtomic(file, text) {
    const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.writeFileSync(temp, text, "utf8");
    fs.renameSync(temp, file);
  }
  function readConversationFile(name) {
    const file = path.join(CHATS_HOME, name);
    if (fs.statSync(file).size > FILE_LIMIT) throw Error("文件过大");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const conversation = data?.conversation;
    if (!conversation || typeof conversation !== "object" || !conversation.id) throw Error("不是言的对话文件");
    return { id: String(conversation.id), savedAt: Number(data.savedAt) || 0, file: name, conversation };
  }
  // 整个目录读回来：所有对话 + 设置镜像。读不出的文件（别的东西、损坏了）跳过并报个数，不让一个坏文件拖垮整次启动
  async function handleLoad(req, res) {
    try {
      ensureDir();
      const items = [],
        seen = new Map();
      let skipped = 0;
      for (const name of fs.readdirSync(CHATS_HOME)) {
        if (!name.endsWith(".json") || name === META_FILE) continue;
        try {
          const item = readConversationFile(name);
          // 同一段对话若留了两个文件（改名时旧的没删成），以较新的为准，旧的顺手清掉
          const prior = seen.get(item.id);
          if (prior && prior.savedAt >= item.savedAt) {
            fs.rmSync(path.join(CHATS_HOME, name), { force: true });
            continue;
          }
          if (prior) fs.rmSync(path.join(CHATS_HOME, prior.file), { force: true });
          seen.set(item.id, item);
        } catch {
          skipped += 1;
        }
      }
      for (const item of seen.values()) items.push(item);
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(path.join(CHATS_HOME, META_FILE), "utf8"));
      } catch {}
      sendJson(res, 200, { dir: CHATS_HOME, items, meta: meta && typeof meta === "object" ? meta : null, skipped });
    } catch (error) {
      sendJson(res, 500, { error: `对话目录不可用：${describe(error, CHATS_HOME)}` });
    }
  }
  async function handleSave(req, res) {
    try {
      const body = await readJson(req),
        conversation = body.conversation;
      if (!conversation || typeof conversation !== "object" || !conversation.id) throw Error("缺少对话内容");
      ensureDir();
      const id = String(conversation.id),
        savedAt = Number(body.savedAt) || Date.now(),
        name = fileNameFor(id, conversation.title);
      writeAtomic(path.join(CHATS_HOME, name), JSON.stringify({ 言: "对话", version: 1, savedAt, conversation }));
      // 标题改过：旧名的文件不留
      for (const stale of filesFor(id)) if (stale !== name) fs.rmSync(path.join(CHATS_HOME, stale), { force: true });
      sendJson(res, 200, { file: name, savedAt });
    } catch (error) {
      sendJson(res, 400, { error: `对话未能落盘：${describe(error)}` });
    }
  }
  async function handleDelete(req, res) {
    try {
      const body = await readJson(req),
        id = String(body.id || "");
      if (!id) throw Error("缺少对话 id");
      ensureDir();
      let removed = 0;
      for (const name of filesFor(id)) {
        fs.rmSync(path.join(CHATS_HOME, name), { force: true });
        removed += 1;
      }
      sendJson(res, 200, { removed });
    } catch (error) {
      sendJson(res, 400, { error: `对话未能删除：${describe(error)}` });
    }
  }
  async function handleMeta(req, res) {
    try {
      const body = await readJson(req);
      if (!body.meta || typeof body.meta !== "object") throw Error("缺少设置内容");
      ensureDir();
      writeAtomic(path.join(CHATS_HOME, META_FILE), JSON.stringify({ 言: "设置", version: 1, savedAt: Date.now(), ...body.meta }));
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: `设置未能落盘：${describe(error)}` });
    }
  }
  return { CHATS_HOME, handleLoad, handleSave, handleDelete, handleMeta };
};
