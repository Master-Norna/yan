// 言 · 桥接的对话目录：对话像卷宗一样落在本机的一个目录里，一段对话一个 JSON 文件，页面经桥接读、写、删
// 由 server.js 装配：require("./server/chats.js")({ chatsHome, onDelete })——onDelete 在一段对话删去后叫（检查点跟着清）
// 目录在存储根里（chatsHome()，默认 ~/.yan/对话，见 server/store.js）。文件名带标题便于翻看，末尾缀上按对话 id 算的短码来认身份：
// 「关于滚动条·3f9a2c1b0e.json」；标题改了文件跟着改名，删对话就删文件。配置不在这里，在存储根的 配置.json
// 收了尾的一答，思绪与帮手的经过可另存在 行迹/<短码>/ 里，以 cold.key 引用；对话文件仍保存正文等其余字段（见 src/01-store/35-cold.js）
"use strict";
const { sendJson, jsonRoute, errorText, writeAtomic, parseJsonText, readJsonFile } = require("./http.js");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { expandHome, describeFsError: describe } = require("./work/paths.js");

module.exports = function createChats({ chatsHome, route = jsonRoute, onDelete = (/** @type {string} */ _id) => {} }) {
  // 旧版的设置镜像：迁进来的目录里可能还躺着一份，读目录时跳过它
  const META_FILE = "设置.json",
    FILE_LIMIT = 256 * 1024 * 1024,
    // 删除记录：哪段对话在何时删的。几个浏览器共用一个目录，那边删了的，这边内存里还留着一份——没有这份记录，
    // 这边一对目录发现「目录里没有」，就又把它推回去了。每次重写记录时只保留近三十天的条目
    TOMBSTONE_FILE = "删除记录.json",
    TOMBSTONE_DAYS = 30,
    TRAIL_DIR = "行迹",
    TRAIL_KEY = /^[A-Za-z0-9_-]{1,160}$/,
    // 没人引用的行迹放够一天才清：别处刚写下、对话文件还没跟上的那份不能当场删
    TRAIL_GRACE_MS = 24 * 60 * 60 * 1000;
  function readTombstones(home) {
    const deleted = readJsonFile(path.join(home, TOMBSTONE_FILE))?.deleted;
    return deleted && typeof deleted === "object" ? deleted : {};
  }
  function writeTombstones(home, deleted) {
    const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000,
      kept = Object.fromEntries(Object.entries(deleted).filter(([, at]) => Number(at) > cutoff));
    if (!Object.keys(kept).length) return fs.rmSync(path.join(home, TOMBSTONE_FILE), { force: true });
    writeAtomic(path.join(home, TOMBSTONE_FILE), JSON.stringify({ 言: "删除记录", deleted: kept }, null, 1));
  }
  // 请求可带来目录；留空用存储根里的对话目录
  function ensureDir(raw) {
    const expanded = expandHome(raw);
    let home = chatsHome();
    if (expanded) {
      if (!path.isAbsolute(expanded)) throw Error("对话目录需填写完整的绝对路径");
      home = path.resolve(expanded);
      if (home.toLowerCase() === path.parse(home).root.toLowerCase()) throw Error("不能把整个磁盘当作对话目录");
    }
    fs.mkdirSync(home, { recursive: true });
    if (!fs.statSync(home).isDirectory()) throw Error(`路径已被文件占用，不是目录：${home}`);
    return home;
  }
  // 对话 id 的短码：文件名靠它认对话。老版本的 id 是「时间戳-随机数」，头几位彼此相同，不能直接截，按整个 id 取哈希
  function codeOf(id) {
    return crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 10);
  }
  function trailDir(home, id) {
    return path.join(home, TRAIL_DIR, codeOf(id));
  }
  // 对话文件里记着的行迹：主线、换下的版本、旁注里各答的 cold.key
  function trailKeys(conversation) {
    const keys = new Set(),
      lists = [conversation?.messages, ...[...(conversation?.forks || []), ...(conversation?.threads || [])].map(item => item?.messages)];
    for (const list of lists)
      for (const message of Array.isArray(list) ? list : []) if (message?.cold?.key) keys.add(String(message.cold.key));
    return keys;
  }
  // 整个目录读回来时顺手清：各段对话不再引用、放了一天以上的行迹删去。读不出的对话文件（坏了、被占着）认不出它引用了什么，
  // 这一回有读不出的就不碰别的夹
  function sweepTrails(home, items, skipped) {
    const root = path.join(home, TRAIL_DIR);
    if (!fs.existsSync(root)) return;
    const cutoff = Date.now() - TRAIL_GRACE_MS,
      known = new Map(items.map(item => [codeOf(item.id), trailKeys(item.conversation)]));
    for (const code of fs.readdirSync(root)) {
      const keep = known.get(code);
      if (!keep && skipped) continue;
      const dir = path.join(root, code);
      try {
        for (const name of fs.readdirSync(dir)) {
          if (keep?.has(name.replace(/\.json$/, ""))) continue;
          const file = path.join(dir, name);
          if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
        }
        if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
      } catch {}
    }
  }
  // 按码点截、去掉落单的代理项：标题被页面按 UTF-16 截在 emoji 中间时，半个字落到盘上成了 U+FFFD，
  // 读回的文件名与这里算的对不上，「旧名的文件不留」就把刚写的那份删了
  function safeTitle(title) {
    const text = String(title || "")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/, "");
    return [...(text || "对话")].slice(0, 40).join("");
  }
  function fileNameFor(id, title) {
    return `${safeTitle(title)}·${codeOf(id)}.json`;
  }
  // 目录里这段对话现有的文件（正常只有一个；标题改过后旧名留着的也一并算上）
  function filesFor(home, id) {
    const suffix = `·${codeOf(id)}.json`;
    return fs.readdirSync(home).filter(name => name.endsWith(suffix));
  }
  function removeStale(home, name) {
    try {
      fs.rmSync(path.join(home, name), { force: true });
    } catch (error) {
      console.warn(`⚠ 旧名的对话文件没能删掉（${name}）：${error?.code || error?.message || error}`);
    }
  }
  function readConversationFile(home, name) {
    const file = path.join(home, name);
    if (fs.statSync(file).size > FILE_LIMIT) throw Error("文件过大");
    const data = parseJsonText(fs.readFileSync(file, "utf8"));
    const conversation = data?.conversation;
    if (!conversation || typeof conversation !== "object" || !conversation.id) throw Error("不是言的对话文件");
    return { id: String(conversation.id), savedAt: Number(data.savedAt) || 0, file: name, conversation };
  }
  // 写出的文件 savedAt 排在对话内容前面，不必为比一个数解析整段长对话。
  function conversationHead(file) {
    const head = Buffer.alloc(256),
      fd = fs.openSync(file, "r");
    try {
      return head.toString("utf8", 0, fs.readSync(fd, head, 0, head.length, 0));
    } finally {
      fs.closeSync(fd);
    }
  }
  // 目录里这段对话现在那份的时间戳（没有就是 0）。
  function savedAtOf(home, id) {
    let latest = 0;
    for (const name of filesFor(home, id))
      try {
        const match = /^\uFEFF?\{"言":"对话","version":\d+,"savedAt":(\d+)/.exec(conversationHead(path.join(home, name)));
        latest = Math.max(latest, match ? Number(match[1]) : readConversationFile(home, name).savedAt);
      } catch {}
    return latest;
  }
  function matchesKnown(file, id, stamp) {
    if (!Number.isSafeInteger(stamp) || stamp <= 0) return false;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > FILE_LIMIT) return false;
      // 不只认文件名：标准文件头必须能同时确认版本和对话 id。字段换了顺序、文件头不全等，都走原来的整读。
      const prefix = `{"言":"对话","version":1,"savedAt":${stamp},"conversation":{"id":${JSON.stringify(id)}`,
        head = conversationHead(file);
      return head.startsWith(prefix) && [",", "}"].includes(head[prefix.length]);
    } catch {
      return false;
    }
  }
  // 整个目录读回来（给了 ids 就只读那几段：别处正在作答的，这边跟着看进度）。读不出的文件（别的东西、损坏了）跳过并报个数，不让一个坏文件拖垮整次启动
  const handleLoad = route((body, _req, res) => {
    let home = chatsHome();
    try {
      home = ensureDir(body.root);
      const items = [],
        seen = new Map(),
        wanted = Array.isArray(body.ids) ? new Map(body.ids.map(id => [`·${codeOf(id)}.json`, String(id)])) : null,
        // 仅定向读可略过正文；全量还要收墓碑、并重名与清行迹。
        known = wanted && body.known && typeof body.known === "object" ? body.known : null,
        suffixOf = name => name.slice(name.lastIndexOf("·")),
        names = fs.readdirSync(home).filter(name => name.endsWith(".json") && name !== META_FILE && name !== TOMBSTONE_FILE),
        counts = new Map(),
        unchanged = new Set();
      if (known)
        for (const name of names) {
          const suffix = suffixOf(name);
          if (wanted.has(suffix)) counts.set(suffix, (counts.get(suffix) || 0) + 1);
        }
      let skipped = 0;
      for (const name of names) {
        if (wanted) {
          const suffix = suffixOf(name),
            id = wanted.get(suffix);
          if (id === undefined) continue;
          // 重复文件仍逐份比、照旧清；不把没有读过的文件当成已见的版本。
          if (known && counts.get(suffix) === 1 && Object.hasOwn(known, id) && matchesKnown(path.join(home, name), id, known[id])) {
            unchanged.add(id);
            continue;
          }
        }
        try {
          const item = readConversationFile(home, name),
            // 名字是言自己起的样子（标题·码.json）：改名时旧的没删成留下的，可以清。用户自己复制的（「… - 副本.json」）不动，
            // 只在没有言起名的那份时才拿来用
            own = name.endsWith(`·${codeOf(item.id)}.json`),
            prior = seen.get(item.id);
          if (prior) {
            const priorOwn = prior.file.endsWith(`·${codeOf(item.id)}.json`);
            if (own !== priorOwn) {
              if (own) seen.set(item.id, item);
              continue;
            }
            if (!own) {
              if (item.savedAt > prior.savedAt) seen.set(item.id, item);
              continue;
            }
          }
          // 两份都是言命名的文件时，以保存时刻较晚的为准；旧名清不掉不影响取新版，也不算读不出
          if (prior && prior.savedAt >= item.savedAt) {
            removeStale(home, name);
            continue;
          }
          seen.set(item.id, item);
          if (prior) removeStale(home, prior.file);
        } catch {
          skipped += 1;
        }
      }
      // 短路的标准文件也参与按正文 id 去重，不能让别的目标短码下放错的副本取代它。
      for (const item of seen.values()) if (!unchanged.has(item.id)) items.push(item);
      if (!wanted) sweepTrails(home, items, skipped);
      sendJson(res, 200, { dir: home, items, skipped, deleted: readTombstones(home) });
    } catch (error) {
      sendJson(res, 500, { error: `对话目录不可用：${describe(error, home)}` });
    }
  });
  const handleSave = route(
    async (body, req, res) => {
      const conversation = body.conversation;
      if (!conversation || typeof conversation !== "object" || !conversation.id) throw Error("缺少对话内容");
      const home = ensureDir(body.root);
      const id = String(conversation.id),
        savedAt = Number(body.savedAt) || Date.now(),
        name = fileNameFor(id, conversation.title);
      // 页面带着它上次与目录对齐时的时间戳（base）来写：目录里那份比它新，说明别处写过、这边手上的是旧的，
      // 整份写下去就把别处写的盖掉了。不写，把那份交回去，由页面并起来再写。不带 base 的（导入、测试）照写
      if (body.base !== undefined && savedAtOf(home, id) > (Number(body.base) || 0)) {
        const current = filesFor(home, id)
          .map(name => {
            try {
              return readConversationFile(home, name);
            } catch {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.savedAt - a.savedAt)[0];
        if (current) return sendJson(res, 409, { error: "这段对话已在别处更新", item: current });
      }
      // 删了以后又存：保存时刻晚于墓碑才撤墓碑；不晚于墓碑的是迟到的旧保存，不写
      const tombstones = readTombstones(home);
      if (tombstones[id]) {
        if (savedAt <= Number(tombstones[id]))
          return sendJson(res, 410, { error: "这段对话已在别处删除", deleted: true, at: Number(tombstones[id]) });
      }
      // 先让新正文落盘：落盘失败不能提前撤掉删除记录，
      // 否则其他页面可能将迟到的旧保存当成有效版本。
      writeAtomic(path.join(home, name), JSON.stringify({ 言: "对话", version: 1, savedAt, conversation }));
      if (tombstones[id]) {
        delete tombstones[id];
        writeTombstones(home, tombstones);
      }
      // 标题改过：旧名的文件不留。删不掉（被索引器、杀软、编辑器占着，或设成了只读）只记一笔——
      // 正本已经落盘，这一趟就算成了；为旧名回 400，页面会当成「没存住」写浏览器暂存、每 3 秒重试，盘上还留着两份同 id 的
      for (const stale of filesFor(home, id)) if (stale !== name) removeStale(home, stale);
      return { file: name, savedAt };
    },
    error => `对话未能落盘：${describe(error)}`
  );
  const handleDelete = route(
    async body => {
      const id = String(body.id || "");
      if (!id) throw Error("缺少对话 id");
      const home = ensureDir(body.root);
      // 补删按原删除时刻（at）裁定：磁盘版本若更晚就原样保留，不动文件、行迹、墓碑，也不触发检查点清理。
      // 与 handleSave 一样，只把晚于删除的保存认作新版本。
      const at = Math.min(Number(body.at) || Date.now(), Date.now());
      if (savedAtOf(home, id) > at) return { removed: 0, kept: true };
      let removed = 0;
      for (const name of filesFor(home, id)) {
        fs.rmSync(path.join(home, name), { force: true });
        removed += 1;
      }
      // 行迹删不掉（被占着、目录坏了）不该让整次删除落空：对话文件已经删了，墓碑不写，别的页面读到的就是
      // 「对话没了、也没有删除记录」，手上还留着的那份还能把它写回来，检查点也一直清不掉。尽力而为，留着的那份
      // 由读目录时的清扫补删（见 sweepTrails：没人引用、放了一天以上的行迹照删）
      try {
        fs.rmSync(trailDir(home, id), { recursive: true, force: true });
      } catch (error) {
        console.warn(`⚠ 行迹没能删掉（${id}）：${error?.code || error?.message || error}`);
      }
      // 墓碑记「什么时候删的」：补删要带当时那一刻，否则断的这段里别处写过、保存过的那份，
      // 其 savedAt 早于此刻的墓碑，就会被当成迟到的旧保存丢掉。
      // 已有的墓碑更晚（别处晚些时候也删了同一段）就留着更晚那个：补删一次旧的不该把新记号抹回去
      const tombstones = readTombstones(home);
      writeTombstones(home, { ...tombstones, [id]: Math.max(at, Number(tombstones[id]) || 0) });
      void Promise.resolve(onDelete(id)).catch(() => {});
      return { removed };
    },
    error => `对话未能删除：${describe(error)}`
  );
  // 另存一答的行迹。同一份内容同一个 key，重写也一样；已删的对话不收（迟到的另存不该替它留个夹）
  const handleTrailPut = route(
    async body => {
      const home = ensureDir(body.root),
        id = String(body.id || ""),
        key = String(body.key || "");
      if (!id || !TRAIL_KEY.test(key) || !body.piece || typeof body.piece !== "object") throw Error("缺少行迹内容");
      if (readTombstones(home)[id]) return { key, skipped: true };
      const dir = trailDir(home, id);
      fs.mkdirSync(dir, { recursive: true });
      writeAtomic(path.join(dir, `${key}.json`), JSON.stringify(body.piece));
      return { key };
    },
    error => `行迹未能另存：${describe(error)}`
  );
  // 取回几答的行迹；不在的不给（页面照旧缺着）
  const handleTrailGet = route(
    async body => {
      const home = ensureDir(body.root),
        dir = trailDir(home, String(body.id || "")),
        pieces = {};
      for (const key of Array.isArray(body.keys) ? body.keys.map(String) : []) {
        const piece = TRAIL_KEY.test(key) && readJsonFile(path.join(dir, `${key}.json`));
        if (piece) pieces[key] = piece;
      }
      return { pieces };
    },
    error => `行迹未能读回：${describe(error)}`
  );
  // 谁在作答：几个页面（两个浏览器、VS Code 与浏览器）同开同一个存储时，正在作答的页面每隔几秒来报一次它在跑哪几段对话，
  // 别的页面借同一次报到得知哪些对话正在别处作答——那几段只看不动、跟着进度，开页时也不当成中断。
  // 只记在内存里：桥接重启，作答的请求也断了，没什么可记；十五秒没来报到的（页面关了、崩了）就算松手
  const LEASE_MS = 15000,
    leases = new Map();
  const handleLease = route(
    async body => {
      const owner = String(body.owner || "").slice(0, 80),
        ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 200),
        claim = String(body.claim || ""),
        now = Date.now();
      const busy = new Set();
      for (const [who, lease] of leases) {
        if (now - lease.at > LEASE_MS) leases.delete(who);
        else if (who !== owner) for (const id of lease.ids) busy.add(id);
      }
      // 开工前的认领（claim）：别处正握着这段就不给，这一页的报到也不记——两页同时开工，先到的得手
      if (claim && busy.has(claim)) return { busy: [...busy] };
      if (owner && ids.length) leases.set(owner, { ids, at: now });
      else if (owner) leases.delete(owner);
      return { busy: [...busy] };
    },
    error => errorText(error, 200)
  );
  // 各页加起来正作答（连同后台帮手、最后一次存盘还没落地）的有几段：换存储位置要等它们都松手
  function working() {
    const now = Date.now(),
      ids = new Set();
    for (const lease of leases.values()) if (now - lease.at <= LEASE_MS) for (const id of lease.ids) ids.add(id);
    return ids.size;
  }
  // 目录里有没有这段对话（定时到点时认收的那一段还在不在）
  function exists(id) {
    try {
      return filesFor(chatsHome(), id).length > 0;
    } catch {
      return false;
    }
  }
  return {
    working,
    exists,
    // 检查点认同一份删除记录；恢复保存会清掉它，不另设过期窗口。
    deleted: id => Boolean(readTombstones(chatsHome())[id]),
    routes: {
      "POST /api/chats/load": handleLoad,
      "POST /api/chats/save": handleSave,
      "POST /api/chats/delete": handleDelete,
      "POST /api/chats/trail/put": handleTrailPut,
      "POST /api/chats/trail/get": handleTrailGet,
      "POST /api/chats/lease": handleLease
    }
  };
};
