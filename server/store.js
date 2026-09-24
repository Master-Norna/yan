// 言 · 桥接的存储根：卷宗、对话、配置统一落在一个目录里，默认 ~/.yan/：
//   对话/      一段对话一个 JSON 文件（见 server/chats.js）
//   卷宗/      模型写出的成品与用户收进来的文件（见 server/work.js 的卷宗接口）
//   附件/      对话里附件的原件，一件一个原件加一份元数据（见 server/files.js）
//   配置.json  设置、模型配置（含 API Key）、记忆、浏览器内卷宗与草稿——几个浏览器共用这一份，不再各存一套
// 在设置里换了位置，整份拷到新处，%APPDATA%\言\位置.json 写明搬去了哪（旧数据原样留着，确认无误后可自行删去）。
// 条子不放在 ~/.yan 里：旧处是叫人自行删去的，条子若在里头，删了旧数据也就删了条子，下次开又回到默认处。
// 测试用 YAN_HOME 直接指定根目录，不读也不写位置条子
// 由 server.js 装配：require("./server/store.js")({ sendJson, readJson })
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

module.exports = function createStore({ sendJson, readJson }) {
  const HOME_ROOT = path.join(os.homedir(), ".yan"),
    POINTER = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "言", "位置.json"),
    // 旧版把条子放在默认根里；读到了就搬到 POINTER 去
    LEGACY_POINTER = path.join(HOME_ROOT, "位置.json"),
    CONFIG_FILE = "配置.json",
    // 旧版的默认位置：~/言/对话 与 ~/言/卷宗。头一回开新版时从这里（以及页面报来的自定义目录）拷进来
    LEGACY_CHATS = path.join(os.homedir(), "言", "对话"),
    LEGACY_ARCHIVE = path.join(os.homedir(), "言", "卷宗");
  const expand = value => String(value || "").replace(/^~(?=$|[\\/])/, os.homedir());
  function readPointer(file) {
    try {
      const pointed = JSON.parse(fs.readFileSync(file, "utf8"))?.root;
      return pointed && path.isAbsolute(pointed) ? path.resolve(pointed) : "";
    } catch {
      return "";
    }
  }
  function writePointer(target) {
    fs.rmSync(LEGACY_POINTER, { force: true });
    if (target.toLowerCase() === HOME_ROOT.toLowerCase()) return fs.rmSync(POINTER, { force: true });
    fs.mkdirSync(path.dirname(POINTER), { recursive: true });
    writeAtomic(POINTER, JSON.stringify({ 言: "位置", root: target }, null, 1));
  }
  function initialRoot() {
    if (process.env.YAN_HOME) return path.resolve(expand(process.env.YAN_HOME));
    const pointed = readPointer(POINTER);
    if (pointed) return pointed;
    const legacy = readPointer(LEGACY_POINTER);
    if (legacy)
      try {
        writePointer(legacy);
      } catch {}
    return legacy || HOME_ROOT;
  }
  let root = initialRoot();
  const paths = () => ({
    root,
    chats: path.join(root, "对话"),
    archive: path.join(root, "卷宗"),
    files: path.join(root, "附件"),
    env: path.join(root, "环境"),
    work: path.join(root, "工作"),
    config: path.join(root, CONFIG_FILE)
  });
  function ensureRoot() {
    const { chats, archive } = paths();
    fs.mkdirSync(chats, { recursive: true });
    fs.mkdirSync(archive, { recursive: true });
  }
  function writeAtomic(file, text) {
    const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    fs.writeFileSync(temp, text, "utf8");
    fs.renameSync(temp, file);
  }
  // 给 bootstrap：页面据此知道对话与卷宗在哪、这是不是一个还没立起来的新根（要从旧处迁入）
  function describe() {
    const p = paths();
    return { ...p, parent: path.dirname(root), fresh: !fs.existsSync(p.config) };
  }
  async function handleConfigLoad(req, res) {
    try {
      await readJson(req);
      const file = paths().config;
      if (!fs.existsSync(file)) return sendJson(res, 200, { config: null, savedAt: 0 });
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const { 言: _mark, savedAt, ...config } = data || {};
      sendJson(res, 200, { config, savedAt: Number(savedAt) || 0 });
    } catch (error) {
      sendJson(res, 500, { error: `配置读不出来：${String(error.message || error).slice(0, 200)}` });
    }
  }
  async function handleConfigSave(req, res) {
    try {
      const body = await readJson(req);
      if (!body.config || typeof body.config !== "object") throw Error("缺少配置内容");
      ensureRoot();
      // 页面带着它上次对齐时的时间戳（base）来写：磁盘上已有别处写过的更新的一份，就不写，把那份交回去，由页面合并后再写。
      // 不带 base 的（头一回立根、以浏览器为准的导入）照写
      let current = 0;
      try {
        const existing = JSON.parse(fs.readFileSync(paths().config, "utf8")) || {};
        current = Number(existing.savedAt) || 0;
        if (body.base !== undefined && current > (Number(body.base) || 0)) {
          const { 言: _mark, savedAt: _savedAt, ...config } = existing;
          return sendJson(res, 409, { error: "配置已在别处更新", config, savedAt: current });
        }
      } catch {}
      const savedAt = Math.max(Number(body.savedAt) || Date.now(), current + 1);
      writeAtomic(paths().config, JSON.stringify({ 言: "配置", ...body.config, savedAt }, null, 1));
      sendJson(res, 200, { savedAt });
    } catch (error) {
      sendJson(res, 400, { error: `配置未能落盘：${String(error.message || error).slice(0, 200)}` });
    }
  }
  // 把 from 目录里的东西逐层拷进 to：已有的同名文件不覆盖（新根里的为准），返回拷了几个文件。skip 里的名字（只看顶层）不拷。
  // 不用 fs.cpSync：Node 22 在 Windows 上拿它拷中文路径会把目录名拷成乱码、进程随之崩掉
  function copyInto(from, to, skip = new Set()) {
    if (!from || !fs.existsSync(from) || path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return 0;
    let count = 0;
    const walk = (source, target, top) => {
      fs.mkdirSync(target, { recursive: true });
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (top && skip.has(entry.name)) continue;
        const a = path.join(source, entry.name),
          b = path.join(target, entry.name);
        if (entry.isDirectory()) walk(a, b, false);
        else if (entry.isFile() && !fs.existsSync(b)) {
          fs.copyFileSync(a, b);
          count += 1;
        }
      }
    };
    walk(from, to, true);
    return count;
  }
  // 头一回：旧的对话与卷宗拷进新根（拷贝，不是搬移——旧处原样留着）。页面报来它记着的自定义目录，桥接自己知道旧的默认位置
  async function handleAdopt(req, res) {
    try {
      const body = await readJson(req),
        p = paths();
      ensureRoot();
      const custom = value => (value && path.isAbsolute(expand(value)) ? path.resolve(expand(value)) : "");
      // 指定了 YAN_HOME（测试）时不碰旧的默认位置：那是真用户的数据
      const legacy = process.env.YAN_HOME ? [] : [LEGACY_CHATS, LEGACY_ARCHIVE];
      let chats = 0,
        archive = 0;
      for (const from of new Set([custom(body.chatsDir), legacy[0]].filter(Boolean)))
        chats += copyInto(from, p.chats, new Set(["设置.json"]));
      for (const from of new Set([custom(body.archiveDir), legacy[1]].filter(Boolean))) archive += copyInto(from, p.archive);
      sendJson(res, 200, { chats, archive, root });
    } catch (error) {
      sendJson(res, 400, { error: `旧数据未能迁入：${String(error.message || error).slice(0, 200)}` });
    }
  }
  // 换位置：parent 下的 .yan 就是新根。那里已有言的数据（另一台机器拷来的、先前搬过去的）就直接用它；
  // 否则把整份拷过去。旧处原样留着（可自行删去），%APPDATA%\言\位置.json 记下新根，桥接重启后也认得
  async function handleMove(req, res) {
    try {
      const body = await readJson(req),
        parent = path.resolve(expand(String(body.parent || "").trim()));
      if (!body.parent || !path.isAbsolute(expand(String(body.parent).trim()))) throw Error("存储位置需填写完整的绝对路径");
      const next = path.basename(parent).toLowerCase() === ".yan" ? parent : path.join(parent, ".yan");
      if (next.toLowerCase() === root.toLowerCase()) return sendJson(res, 200, { ...describe(), moved: false });
      const existing = fs.existsSync(path.join(next, CONFIG_FILE));
      if (!existing) {
        fs.mkdirSync(next, { recursive: true });
        // 环境不拷：虚拟环境里记着绝对路径，搬过去就坏了；到新处重新准备一遍（有缓存时很快）
        copyInto(root, next, new Set(["位置.json", "环境"]));
      }
      const previous = root;
      root = next;
      ensureRoot();
      if (!process.env.YAN_HOME) writePointer(root);
      sendJson(res, 200, { ...describe(), moved: true, adopted: existing, previous });
    } catch (error) {
      sendJson(res, 400, { error: `存储位置未能更换：${String(error.message || error).slice(0, 200)}` });
    }
  }
  return {
    paths,
    describe,
    ensureRoot,
    routes: {
      "POST /api/store/config/load": handleConfigLoad,
      "POST /api/store/config/save": handleConfigSave,
      "POST /api/store/adopt": handleAdopt,
      "POST /api/store/move": handleMove
    }
  };
};
