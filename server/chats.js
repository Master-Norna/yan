// 言 · 桥接的对话目录：对话像卷宗一样落在本机的一个目录里，一段对话一个 JSON 文件，页面经桥接读、写、删
// 由 server.js 装配：require("./server/chats.js")({ sendJson, readJson })
// 目录在存储根里（chatsHome()，默认 ~/.yan/对话，见 server/store.js）。文件名带标题便于翻看，末尾缀上按对话 id 算的短码来认身份：
// 「关于滚动条·3f9a2c1b0e.json」；标题改了文件跟着改名，删对话就删文件。配置不在这里，在存储根的 配置.json
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

module.exports = function createChats({ sendJson, readJson, chatsHome }) {
  // 旧版的设置镜像：迁进来的目录里可能还躺着一份，读目录时跳过它
  const META_FILE = "设置.json",
    FILE_LIMIT = 256 * 1024 * 1024,
    // 删除记录：哪段对话在何时删的。几个浏览器共用一个目录，那边删了的，这边内存里还留着一份——没有这份记录，
    // 这边一对目录发现「目录里没有」，就又把它推回去了。记三十天，久了的清掉
    TOMBSTONE_FILE = "删除记录.json",
    TOMBSTONE_DAYS = 30;
  function readTombstones(home) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(home, TOMBSTONE_FILE), "utf8"));
      return data && typeof data.deleted === "object" ? data.deleted : {};
    } catch {
      return {};
    }
  }
  function writeTombstones(home, deleted) {
    const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000,
      kept = Object.fromEntries(Object.entries(deleted).filter(([, at]) => Number(at) > cutoff));
    if (!Object.keys(kept).length) return fs.rmSync(path.join(home, TOMBSTONE_FILE), { force: true });
    writeAtomic(path.join(home, TOMBSTONE_FILE), JSON.stringify({ 言: "删除记录", deleted: kept }, null, 1));
  }
  // 请求可带来目录；留空用存储根里的对话目录
  function ensureDir(raw) {
    const value = String(raw || "").trim();
    let home = chatsHome();
    if (value) {
      const expanded = value.replace(/^~(?=$|[\\/])/, os.homedir());
      if (!path.isAbsolute(expanded)) throw Error("对话目录需填写完整的绝对路径");
      home = path.resolve(expanded);
      if (home.toLowerCase() === path.parse(home).root.toLowerCase()) throw Error("不能把整个磁盘当作对话目录");
    }
    fs.mkdirSync(home, { recursive: true });
    if (!fs.statSync(home).isDirectory()) throw Error(`路径已被文件占用，不是目录：${home}`);
    return home;
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
  function filesFor(home, id) {
    const suffix = `·${codeOf(id)}.json`;
    return fs.readdirSync(home).filter(name => name.endsWith(suffix));
  }
  // 先写临时文件再改名，写到一半断电也不会留下半个文件顶替原件
  function writeAtomic(file, text) {
    const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.writeFileSync(temp, text, "utf8");
    fs.renameSync(temp, file);
  }
  function readConversationFile(home, name) {
    const file = path.join(home, name);
    if (fs.statSync(file).size > FILE_LIMIT) throw Error("文件过大");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const conversation = data?.conversation;
    if (!conversation || typeof conversation !== "object" || !conversation.id) throw Error("不是言的对话文件");
    return { id: String(conversation.id), savedAt: Number(data.savedAt) || 0, file: name, conversation };
  }
  // 整个目录读回来（给了 ids 就只读那几段：别处正在作答的，这边跟着看进度）。读不出的文件（别的东西、损坏了）跳过并报个数，不让一个坏文件拖垮整次启动
  async function handleLoad(req, res) {
    let home = chatsHome();
    try {
      const body = await readJson(req);
      home = ensureDir(body.root);
      const items = [],
        seen = new Map(),
        wanted = Array.isArray(body.ids) ? body.ids.map(id => `·${codeOf(id)}.json`) : null;
      let skipped = 0;
      for (const name of fs.readdirSync(home)) {
        if (!name.endsWith(".json") || name === META_FILE || name === TOMBSTONE_FILE) continue;
        if (wanted && !wanted.some(suffix => name.endsWith(suffix))) continue;
        try {
          const item = readConversationFile(home, name);
          // 同一段对话若留了两个文件（改名时旧的没删成），以较新的为准，旧的顺手清掉
          const prior = seen.get(item.id);
          if (prior && prior.savedAt >= item.savedAt) {
            fs.rmSync(path.join(home, name), { force: true });
            continue;
          }
          if (prior) fs.rmSync(path.join(home, prior.file), { force: true });
          seen.set(item.id, item);
        } catch {
          skipped += 1;
        }
      }
      for (const item of seen.values()) items.push(item);
      sendJson(res, 200, { dir: home, items, skipped, deleted: readTombstones(home) });
    } catch (error) {
      sendJson(res, 500, { error: `对话目录不可用：${describe(error, home)}` });
    }
  }
  async function handleSave(req, res) {
    try {
      const body = await readJson(req),
        conversation = body.conversation;
      if (!conversation || typeof conversation !== "object" || !conversation.id) throw Error("缺少对话内容");
      const home = ensureDir(body.root);
      const id = String(conversation.id),
        savedAt = Number(body.savedAt) || Date.now(),
        name = fileNameFor(id, conversation.title);
      // 删了以后又存：比删除晚的是真要它（接着在里头说话、从备份导回来），删除记录作废；比删除早的是迟到的旧保存，不写
      const tombstones = readTombstones(home);
      if (tombstones[id]) {
        if (savedAt <= Number(tombstones[id])) return sendJson(res, 410, { error: "这段对话已在别处删除", deleted: true });
        delete tombstones[id];
        writeTombstones(home, tombstones);
      }
      writeAtomic(path.join(home, name), JSON.stringify({ 言: "对话", version: 1, savedAt, conversation }));
      // 标题改过：旧名的文件不留
      for (const stale of filesFor(home, id)) if (stale !== name) fs.rmSync(path.join(home, stale), { force: true });
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
      const home = ensureDir(body.root);
      let removed = 0;
      for (const name of filesFor(home, id)) {
        fs.rmSync(path.join(home, name), { force: true });
        removed += 1;
      }
      writeTombstones(home, { ...readTombstones(home), [id]: Date.now() });
      sendJson(res, 200, { removed });
    } catch (error) {
      sendJson(res, 400, { error: `对话未能删除：${describe(error)}` });
    }
  }
  // 谁在作答：几个页面（两个浏览器、VS Code 与浏览器）同开同一个存储时，正在作答的页面每隔几秒来报一次它在跑哪几段对话，
  // 别的页面借同一次报到得知哪些对话正在别处作答——那几段只看不动、跟着进度，开页时也不当成中断。
  // 只记在内存里：桥接重启，作答的请求也断了，没什么可记；十五秒没来报到的（页面关了、崩了）就算松手
  const LEASE_MS = 15000,
    leases = new Map();
  async function handleLease(req, res) {
    try {
      const body = await readJson(req),
        owner = String(body.owner || "").slice(0, 80),
        ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 200),
        now = Date.now();
      if (owner && ids.length) leases.set(owner, { ids, at: now });
      else if (owner) leases.delete(owner);
      const busy = new Set();
      for (const [who, lease] of leases) {
        if (now - lease.at > LEASE_MS) leases.delete(who);
        else if (who !== owner) for (const id of lease.ids) busy.add(id);
      }
      sendJson(res, 200, { busy: [...busy] });
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error).slice(0, 200) });
    }
  }
  return {
    routes: {
      "POST /api/chats/load": handleLoad,
      "POST /api/chats/save": handleSave,
      "POST /api/chats/delete": handleDelete,
      "POST /api/chats/lease": handleLease
    }
  };
};
