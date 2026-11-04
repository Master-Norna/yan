// 言 · 桥接的检查点：一答头一回动手改本地文件之前，把它的目录此刻的样子记下来，日后可整个退回到那一刻。
// 由 server.js 装配：require("./server/checkpoints.js")({ home, skip })。不靠 git（目录不必是仓库，本机也不必装 git），自己存：
//   检查点/<目录短码>/对象/ab/cdef…   文件内容按 SHA-1 存一份（同样的内容只存一回），目录也是一件对象：按名排好的 [类, 名, 哈希, 大小]
//   检查点/<目录短码>/册/<对话>~<答>.json  一答一张：目录与那一刻的根对象。没变的子目录哈希不变、对象共用，一张册只几十字节
//   检查点/<目录短码>/索引.json         上回见过的 路径 → [大小, 修改时刻, 哈希]：大小、时刻都没变的不重读，第二回起只读变了的
// 不进的：列目录、检索也不钻的那几类（node_modules、.git、dist……，见 work/paths.js 的 WORK_SKIP），.gitignore 里写了的，链接，
// 存储根本身（工作目录把它包在里面时）；.git/info/exclude 与 .gitignore 同样认。读不了的文件（被占着）记一笔「不明」，退回时不动它——不能因为没读到就当它不该在。
// 忽略的也记一笔「不明」：这一答可能改了忽略规则，那一刻忽略的（.env、数据集）此刻露了出来，它们没进快照也恢复不了，不能当这一答新加的删掉。
// 只管目录里的文件：指令写到目录之外的、MCP 改的远端，都退不了
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { jsonRoute, errorText, writeAtomic, readJsonFile, fileHash } = require("./http.js");
const { WORK_SKIP } = require("./work/paths.js");

const KEY = /^[\w-]{1,80}~[\w-]{1,80}$/;

// ---------- .gitignore：常用的那些写法（注释、! 取反、末尾 / 只管目录、带 / 的从所在目录算起、* ? ** [..]） ----------
function ignoreRule(line, base) {
  let text = line.replace(/(?<!\\)\s+$/, "");
  if (!text || text.startsWith("#")) return null;
  const negate = text.startsWith("!");
  if (negate) text = text.slice(1);
  text = text.replace(/^\\([#!])/, "$1");
  const dirOnly = text.endsWith("/");
  if (dirOnly) text = text.slice(0, -1);
  const anchored = text.includes("/");
  text = text.replace(/^\//, "");
  if (!text) return null;
  let body = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "*" && text[i + 1] === "*") {
      const slash = text[i + 2] === "/";
      body += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (ch === "*") body += "[^/]*";
    else if (ch === "?") body += "[^/]";
    else if (ch === "[") {
      const end = text.indexOf("]", i + 1);
      if (end < 0) body += "\\[";
      else {
        body += `[${text
          .slice(i + 1, end)
          .replace(/^!/, "^")
          .replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else if (ch === "\\" && i + 1 < text.length) body += text[++i].replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    else body += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return { negate, dirOnly, base, test: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`) };
}
/** 这一层的 .gitignore 接在上层的规则后面；根上先读仓库自己的 .git/info/exclude（不随仓库走的那份，git 一样认） @param {string} abs @param {string} rel @param {any[]} rules */
function rulesFor(abs, rel, rules) {
  if (!rel) rules = rulesIn(path.join(abs, ".git", "info", "exclude"), "", rules);
  return rulesIn(path.join(abs, ".gitignore"), rel, rules);
}
/** @param {string} file @param {string} rel @param {any[]} rules */
function rulesIn(file, rel, rules) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return rules;
  }
  const own = text
    .split(/\r?\n/)
    .map(line => ignoreRule(line, rel))
    .filter(Boolean);
  return own.length ? [...rules, ...own] : rules;
}
// 后写的规则盖过先写的（git 的规矩）；规则里的路径从写它的那一层算起
function ignored(rules, rel, dir) {
  let out = false;
  for (const rule of rules) {
    if (rule.dirOnly && !dir) continue;
    const sub = rule.base ? (rel.startsWith(`${rule.base}/`) ? rel.slice(rule.base.length + 1) : null) : rel;
    if (sub !== null && rule.test.test(sub)) out = !rule.negate;
  }
  return out;
}

/** @param {{ home: () => string, skip?: () => string[] }} options */
module.exports = function createCheckpoints({ home, skip = () => [] }) {
  const same = (a, b) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  /** @param {string} dir */
  const storeAt = dir => ({ dir, objects: path.join(dir, "对象"), book: path.join(dir, "册"), index: path.join(dir, "索引.json") });
  /** @param {string} root */
  function storeOf(root) {
    const full = path.resolve(root),
      code = crypto
        .createHash("sha1")
        .update(process.platform === "win32" ? full.toLowerCase() : full)
        .digest("hex")
        .slice(0, 12);
    return { full, ...storeAt(path.join(home(), code)) };
  }
  const objectPath = (store, hash) => path.join(store.objects, hash.slice(0, 2), hash.slice(2));
  // 同一个目录一回只办一件（两段对话同绑一个目录、同时动手）：索引、对象都不至于互相踩
  /** @type {Map<string, Promise<any>>} */
  const queues = new Map();
  function serial(store, task) {
    const before = queues.get(store.dir) || Promise.resolve(),
      run = before.catch(() => {}).then(task);
    queues.set(
      store.dir,
      run.catch(() => {})
    );
    return run;
  }
  function putObject(store, text) {
    const hash = crypto.createHash("sha1").update(text).digest("hex"),
      file = objectPath(store, hash);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeAtomic(file, text);
    }
    return hash;
  }
  // 一件文件：边读边算哈希边写进临时文件，读完按哈希归位（已有同样内容的就扔掉这份）
  async function storeFile(store, abs) {
    fs.mkdirSync(store.objects, { recursive: true });
    const temp = path.join(store.objects, `.in-${process.pid}-${crypto.randomBytes(4).toString("hex")}`),
      hash = crypto.createHash("sha1");
    try {
      await pipeline(
        fs.createReadStream(abs),
        new Transform({
          transform(chunk, _encoding, done) {
            hash.update(chunk);
            done(null, chunk);
          }
        }),
        fs.createWriteStream(temp)
      );
      const digest = hash.digest("hex"),
        file = objectPath(store, digest);
      if (fs.existsSync(file)) fs.rmSync(temp, { force: true });
      else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.renameSync(temp, file);
      }
      return digest;
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
  }
  // 走一遍目录：每件文件交给 visit（拿到相对路径与 stat），返回这一层的条目；跳过的与读不了的照上面的规矩
  async function walk(root, visit) {
    const skipped = skip().map(dir => path.resolve(dir));
    const down = async (abs, rel, rules) => {
      const own = rulesFor(abs, rel, rules),
        entries = (await fs.promises.readdir(abs, { withFileTypes: true })).sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0
        ),
        items = [];
      for (const entry of entries) {
        const full = path.join(abs, entry.name),
          sub = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink() || skipped.some(dir => same(dir, full))) continue;
        if (entry.isDirectory()) {
          if (WORK_SKIP.has(entry.name)) continue;
          if (ignored(own, sub, true)) {
            items.push(["x", entry.name]);
            continue;
          }
          let inner;
          try {
            inner = await down(full, sub, own);
          } catch {
            items.push(["x", entry.name]);
            continue;
          }
          items.push(["d", entry.name, inner]);
        } else if (entry.isFile()) {
          items.push(ignored(own, sub, false) ? ["x", entry.name] : await visit(full, sub, entry.name));
        }
      }
      return items;
    };
    return down(root, "", []);
  }
  // ---------- 记下此刻 ----------
  async function take(rootDir, key) {
    const store = storeOf(rootDir);
    return serial(store, async () => {
      const started = Date.now(),
        index = readJsonFile(store.index, {}),
        next = {};
      let files = 0,
        read = 0;
      const tree = await walk(store.full, async (abs, rel, name) => {
        let stat;
        try {
          stat = await fs.promises.stat(abs);
          const seen = index[rel];
          let hash = seen && seen[0] === stat.size && seen[1] === stat.mtimeMs && fs.existsSync(objectPath(store, seen[2])) ? seen[2] : "";
          if (!hash) {
            hash = await storeFile(store, abs);
            read += 1;
          }
          next[rel] = [stat.size, stat.mtimeMs, hash];
          files += 1;
          return ["f", name, hash, stat.size];
        } catch {
          return ["x", name];
        }
      });
      // 目录树自下而上存成对象：没变的子目录哈希不变
      const save = items => putObject(store, JSON.stringify(items.map(item => (item[0] === "d" ? ["d", item[1], save(item[2])] : item))));
      const rootHash = save(tree);
      fs.mkdirSync(store.book, { recursive: true });
      writeAtomic(
        path.join(store.book, `${key}.json`),
        JSON.stringify({ 言: "检查点", root: store.full, at: Date.now(), tree: rootHash, files })
      );
      writeAtomic(store.index, JSON.stringify(next));
      return { key, files, read, ms: Date.now() - started };
    });
  }
  // ---------- 对照、退回 ----------
  // 册上那一刻：路径 → 哈希；不明的另记（退回时不碰）
  function snapshotOf(store, key) {
    const page = readJsonFile(path.join(store.book, `${key}.json`), null);
    if (!page?.tree) throw Error("这一答的检查点已不在");
    const files = new Map(),
      unknown = new Set(),
      dirs = new Set();
    const read = (hash, rel) => {
      const items = JSON.parse(fs.readFileSync(objectPath(store, hash), "utf8"));
      for (const [kind, name, ref] of items) {
        const sub = rel ? `${rel}/${name}` : name;
        if (kind === "d") {
          dirs.add(sub);
          read(ref, sub);
        } else if (kind === "f") files.set(sub, ref);
        else unknown.add(sub);
      }
    };
    read(page.tree, "");
    return { files, unknown, dirs };
  }
  // 此刻的目录：路径 → 哈希（大小、时刻与索引对得上的不重读），连同此刻有哪些夹
  async function presentOf(store) {
    const index = readJsonFile(store.index, {}),
      files = new Map(),
      dirs = new Set();
    const tree = await walk(store.full, async (abs, rel, name) => {
      try {
        const stat = await fs.promises.stat(abs),
          seen = index[rel];
        files.set(rel, seen && seen[0] === stat.size && seen[1] === stat.mtimeMs ? seen[2] : await fileHash(abs));
      } catch {
        files.set(rel, null);
      }
      return ["f", name];
    });
    const collectDirs = (items, rel) => {
      for (const item of items)
        if (item[0] === "d") {
          const sub = rel ? `${rel}/${item[1]}` : item[1];
          dirs.add(sub);
          collectDirs(item[2], sub);
        }
    };
    collectDirs(tree, "");
    return { files, dirs };
  }
  // 要动哪几件：changed 改回、removed（此刻没有）补回、added（那一刻没有）删去。
  // 夹只在底下一件文件也不牵涉时才单列（路径带 /）：空夹建了或删了，文件那几行管不到它
  async function changesOf(store, key) {
    const then = snapshotOf(store, key),
      now = await presentOf(store),
      changes = [];
    for (const [rel, hash] of then.files)
      if (!now.files.has(rel)) changes.push({ path: rel, kind: "removed", hash });
      else if (now.files.get(rel) !== hash) changes.push({ path: rel, kind: "changed", hash });
    // 那一刻读不了的（被占着的文件、进不去的夹）与忽略的，连同其下的，此刻有也不删
    const unclear = rel => [...then.unknown].some(item => rel === item || rel.startsWith(`${item}/`));
    for (const rel of now.files.keys()) if (!then.files.has(rel) && !unclear(rel)) changes.push({ path: rel, kind: "added" });
    const holds = (paths, dir) => [...paths].some(rel => rel.startsWith(`${dir}/`));
    for (const dir of then.dirs)
      if (!now.dirs.has(dir) && !holds(then.files.keys(), dir) && !holds(then.dirs, dir))
        changes.push({ path: `${dir}/`, kind: "removed" });
    for (const dir of now.dirs)
      if (
        !then.dirs.has(dir) &&
        !unclear(dir) &&
        !holds(now.files.keys(), dir) &&
        !holds(now.dirs, dir) &&
        // 底下只有忽略的（node_modules、.gitignore 写了的）不算空夹，删不得
        !fs.readdirSync(path.join(store.full, ...dir.split("/"))).length
      )
        changes.push({ path: `${dir}/`, kind: "added" });
    changes.sort((a, b) => (a.path < b.path ? -1 : 1));
    return { changes, dirs: then.dirs };
  }
  // 补回、改回之前，从根往下逐层看那条路：那一刻的夹此刻成了链接（目录联接、符号链接）的拆掉链接、建回真夹——
  // 不然 mkdir 与写入会顺着链接落到目录之外；成了文件的、或别的说不清的，宁可这一件不动
  function realParent(root, rel) {
    let dir = root;
    for (const name of rel.split("/").slice(0, -1)) {
      dir = path.join(dir, name);
      const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) fs.unlinkSync(dir);
      else if (stat && !stat.isDirectory()) throw Error("那一刻的夹此刻是一件文件");
      if (!stat?.isDirectory()) fs.mkdirSync(dir);
    }
    return dir;
  }
  async function restore(rootDir, key) {
    const store = storeOf(rootDir);
    return serial(store, async () => {
      const { changes, dirs } = await changesOf(store, key),
        failed = [];
      let restored = 0,
        removed = 0;
      // 先删后补：文件被换成同名的夹（或反过来）时，占着那条路的先让开
      for (const change of [...changes.filter(c => c.kind === "added"), ...changes.filter(c => c.kind !== "added")]) {
        const rel = change.path.replace(/\/$/, ""),
          target = path.join(store.full, ...rel.split("/"));
        let temp = "";
        try {
          if (change.kind === "added") {
            if (change.path.endsWith("/")) fs.rmdirSync(target);
            else fs.rmSync(target, { force: true });
            removed += 1;
            // 删空了的夹，那一刻没有的一并删去（一层层往上，到根为止）
            for (let up = path.posix.dirname(rel); up !== "." && !dirs.has(up); up = path.posix.dirname(up)) {
              const dir = path.join(store.full, ...up.split("/"));
              if (fs.readdirSync(dir).length) break;
              fs.rmdirSync(dir);
            }
          } else if (change.path.endsWith("/")) {
            realParent(store.full, change.path);
            restored += 1;
          } else {
            const parent = realParent(store.full, rel),
              stat = fs.lstatSync(target, { throwIfNoEntry: false });
            if (stat?.isSymbolicLink()) fs.unlinkSync(target);
            // 此刻成了夹：底下新出的已在上面删去，空了才让位；还剩东西（忽略的、读不了的）就不动它
            else if (stat?.isDirectory()) fs.rmdirSync(target);
            temp = path.join(parent, `.${path.basename(target)}.yan-${process.pid}.tmp`);
            fs.copyFileSync(objectPath(store, change.hash), temp);
            fs.renameSync(temp, target);
            temp = "";
            restored += 1;
          }
        } catch (error) {
          if (temp) fs.rmSync(temp, { force: true });
          failed.push(`${change.path}：${errorText(error, 80)}`);
        }
      }
      return { restored, removed, failed };
    });
  }
  // ---------- 清理：对话删了，它的几张册跟着删，没有册再用的对象删去 ----------
  function collect(store) {
    const keep = new Set(),
      mark = hash => {
        if (keep.has(hash)) return;
        keep.add(hash);
        for (const item of readJsonFile(objectPath(store, hash), []))
          if (item[0] === "d") mark(item[2]);
          else if (item[0] === "f") keep.add(item[2]);
      };
    for (const name of fs.existsSync(store.book) ? fs.readdirSync(store.book) : []) {
      const page = readJsonFile(path.join(store.book, name), null);
      if (page?.tree) mark(page.tree);
    }
    for (const prefix of fs.existsSync(store.objects) ? fs.readdirSync(store.objects) : []) {
      const dir = path.join(store.objects, prefix);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const rest of fs.readdirSync(dir)) if (!keep.has(prefix + rest)) fs.rmSync(path.join(dir, rest), { force: true });
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
    }
  }
  /** @param {string} conversation */
  async function dropConversation(conversation) {
    const prefix = `${String(conversation).replace(/[^\w-]/g, "")}~`;
    if (prefix === "~" || !fs.existsSync(home())) return;
    for (const code of fs.readdirSync(home())) {
      const store = storeAt(path.join(home(), code)),
        pages = fs.existsSync(store.book) ? fs.readdirSync(store.book).filter(name => name.startsWith(prefix)) : [];
      if (!pages.length) continue;
      await serial(store, async () => {
        for (const name of pages) fs.rmSync(path.join(store.book, name), { force: true });
        collect(store);
      });
    }
  }

  const keyOf = body => {
    const key = `${String(body.conversation || "").replace(/[^\w-]/g, "")}~${String(body.answer || "").replace(/[^\w-]/g, "")}`;
    if (!KEY.test(key)) throw Error("缺少对话或答的 id");
    return key;
  };
  const rootOf = body => {
    const root = String(body.root || "");
    if (!path.isAbsolute(root) || !fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw Error("目录不在");
    return root;
  };
  return {
    dropConversation,
    routes: {
      "POST /api/checkpoint/take": jsonRoute(
        body => take(rootOf(body), keyOf(body)),
        error => `检查点未能记下：${errorText(error, 200)}`
      ),
      "POST /api/checkpoint/diff": jsonRoute(
        async body => {
          const { changes } = await changesOf(storeOf(rootOf(body)), keyOf(body));
          return { changes: changes.map(({ path: file, kind }) => ({ path: file, kind })) };
        },
        error => errorText(error, 200)
      ),
      "POST /api/checkpoint/restore": jsonRoute(
        body => restore(rootOf(body), keyOf(body)),
        error => `未能退回：${errorText(error, 200)}`
      )
    }
  };
};
module.exports.ignoreRule = ignoreRule;
module.exports.ignored = ignored;
