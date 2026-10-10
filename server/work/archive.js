// 言 · 桥接 · 卷宗目录的接口：列、收、取、挪（兼改名）、删、新建夹、以本机程序打开，清草稿
// 由 server/work/index.js 装配；接口随执事一并登记
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const createLocks = require("./locks.js");
const { sendJson, readJson, jsonRoute, errorText, sendFile, openWithSystem } = require("../http.js");
const {
  SCRATCH_DIR,
  WORK_SKIP,
  resolveWorkdir,
  describeFsError,
  resolveInside,
  pathIsInside,
  relPath,
  assertNoEscapingLink
} = require("./paths.js");

module.exports = function createArchive({ archiveHome, playable, lockFile = createLocks().lockFile }) {
  const failed = error => errorText(error, 300);
  // ---- 卷宗目录：页面上的卷宗即这一目录的视图。列出全部文件与子目录（页面逐层看、查找时平铺），收入 / 取出 / 挪动 / 移出都限定在目录内 ----
  const ARCHIVE_LIST_LIMIT = 3000,
    ARCHIVE_FILE_LIMIT = 256 * 1024 * 1024;
  // 卷宗根：请求里带 root 就用它（须是完整限定的绝对路径，与工作目录同一套规矩），否则默认位置
  async function archiveRoot(raw) {
    const root = String(raw || "").trim() ? resolveWorkdir(raw) : archiveHome();
    const existing = await fs.promises.stat(root).catch(() => null);
    if (existing && !existing.isDirectory()) throw Error(`卷宗路径已被文件占用：${root}`);
    if (!existing)
      await fs.promises.mkdir(root, { recursive: true }).catch(error => {
        throw Error(describeFsError(error, root));
      });
    return root;
  }
  function archivePath(root, raw) {
    const rel = String(raw || "").trim();
    if (!rel) throw Error("请给出文件路径");
    return resolveInside(root, rel);
  }
  // 子目录也要列：空的夹同样是一层，页面上要能看见、能把文件拖进去
  async function walkArchive(root, dir, out, dirs) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= ARCHIVE_LIST_LIMIT) return;
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (WORK_SKIP.has(entry.name)) continue;
        dirs.push({ path: relPath(root, full), name: entry.name });
        await walkArchive(root, full, out, dirs);
        continue;
      }
      const stat = await fs.promises.stat(full).catch(() => null);
      if (!stat) continue;
      out.push({ path: relPath(root, full), name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  // 草稿占了多少：目录数与字节数，卷宗页上给用户一个数
  async function measureScratch(root) {
    const base = path.join(root, SCRATCH_DIR),
      dirs = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => []);
    let bytes = 0,
      files = 0;
    const walk = async dir => {
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isSymbolicLink() || files > 5000) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else {
          files += 1;
          bytes += await fs.promises
            .stat(full)
            .then(s => s.size)
            .catch(() => 0);
        }
      }
    };
    await walk(base);
    return { count: dirs.filter(d => d.isDirectory()).length, files, bytes };
  }
  const handleArchiveList = jsonRoute(async body => {
    const root = await archiveRoot(body.root);
    const out = [],
      dirs = [];
    await walkArchive(root, root, out, dirs);
    out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return {
      archive: root,
      entries: out,
      dirs,
      truncated: out.length >= ARCHIVE_LIST_LIMIT,
      scratch: await measureScratch(root)
    };
  }, failed);
  // 清草稿：给了 id 只清那段对话的，否则整个 .草稿 目录
  const handleArchiveClean = jsonRoute(async body => {
    const root = await archiveRoot(body.root),
      id = String(body.id || "").replace(/[^A-Za-z0-9_-]/g, "");
    const target = id ? path.join(root, SCRATCH_DIR, id) : path.join(root, SCRATCH_DIR);
    await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 2 }).catch(error => {
      throw Error(describeFsError(error, SCRATCH_DIR));
    });
    return { cleaned: id || SCRATCH_DIR };
  }, failed);
  // 落在卷宗里的哪一层：dir 为空即根；给了就须在目录之内，不经链接出界
  async function archiveDirOf(root, raw) {
    const rel = String(raw || "").trim();
    if (!rel) return root;
    const dir = resolveInside(root, rel);
    await assertNoEscapingLink(root, dir);
    const stat = await fs.promises.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) throw Error(`卷宗里没有这一层：${rel}`);
    return dir;
  }
  // 同名不覆盖，另取「名 (2).扩展名」。每个候选名在写锁内检查与落笔，rename 也不会因同时挪入而互盖。
  // 明着改名（exact）遇同名就报错，不替用户另取名。
  async function placeFree(dir, name, make, exact = false) {
    const extension = path.extname(name),
      stem = name.slice(0, name.length - extension.length);
    for (let n = 1; ; n++) {
      const target = path.join(dir, n === 1 ? name : `${stem} (${n})${extension}`);
      const release = await lockFile(target);
      try {
        await make(target);
        return target;
      } catch (error) {
        if (error.code !== "EEXIST" || exact) throw error;
      } finally {
        release();
      }
    }
  }
  async function describeItem(root, target) {
    const stat = await fs.promises.stat(target);
    return {
      path: relPath(root, target),
      name: path.basename(target),
      ...(stat.isDirectory() ? { dir: true } : { size: stat.size }),
      modifiedAt: stat.mtime.toISOString()
    };
  }
  // 收入：页面拖进来的文件以 data: URL 送来，落进页面此刻所在的那一层（dir）
  async function handleArchivePut(req, res) {
    try {
      const body = await readJson(req, 400 * 1024 * 1024),
        root = await archiveRoot(body.root),
        // 点开头的（.gitignore、标题是「.NET 8」的导出）列卷宗时当隐藏项跳过，收进来就再也看不见、删不掉：去掉首尾的点与空格，与改名同一个规矩
        name = path.basename(String(body.name || "").trim()).replace(/^[. ]+|[. ]+$/g, "") || "未命名文件";
      const data = String(body.data || ""),
        comma = data.indexOf(",");
      if (!data.startsWith("data:") || comma < 0) throw Error("文件内容格式无效");
      const bytes = Buffer.from(data.slice(comma + 1), /;base64/i.test(data.slice(0, comma)) ? "base64" : "utf8");
      if (bytes.length > ARCHIVE_FILE_LIMIT) throw Error(`单个文件不超过 ${ARCHIVE_FILE_LIMIT / 1048576} MB`);
      const target = await placeFree(await archiveDirOf(root, body.dir), name, to =>
        fs.promises.writeFile(to, bytes, { flag: "wx" })
      ).catch(error => {
        throw Error(describeFsError(error, name));
      });
      sendJson(res, 200, await describeItem(root, target));
    } catch (error) {
      sendJson(res, 400, { error: failed(error) });
    }
  }
  // 取出：GET /api/archive/file?path=…（&root=… 指定卷宗根），页面用它做缩略图、置于案上与下载；?download=1 时让浏览器另存
  async function handleArchiveFile(req, res) {
    try {
      const query = new URL(req.url, "http://127.0.0.1").searchParams;
      const root = await archiveRoot(query.get("root")),
        file = archivePath(root, query.get("path"));
      await assertNoEscapingLink(root, file);
      const name = path.basename(file),
        download = !!query.get("download");
      await sendFile(req, res, download ? file : await playable(req, file, name), { name, download });
    } catch (error) {
      sendJson(res, 404, { error: failed(error) });
    }
  }
  // 卷宗里的一项（文件或夹）：须在目录之内、不是根本身、不经链接出界
  async function archiveItem(root, raw) {
    const target = archivePath(root, raw);
    if (target === root) throw Error("不能动卷宗根本身");
    await assertNoEscapingLink(root, target);
    const stat = await fs.promises.stat(target).catch(() => null);
    if (!stat) throw Error(`卷宗里没有这一项：${raw}`);
    return { target, stat };
  }
  // 名字只取一段：斜杠与 Windows 不认的字符去掉；首尾的点与空格也去掉（点起头的卷宗页不列，建了也看不见）
  function cleanName(raw) {
    const name = String(raw || "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
      .trim()
      .replace(/^[. ]+|[. ]+$/g, "");
    if (!name) throw Error("名字无效");
    return name;
  }
  // 挪与改名是一回事：path 挪进 dir 那一层（缺省即原层），name 给了就换名。文件与夹一样挪。
  // 拖着挪（只给 dir）遇同名另取名；明着改名（给了 name）遇同名则报错，不悄悄换成别的名字
  const handleArchiveMove = jsonRoute(async body => {
    const root = await archiveRoot(body.root),
      { target: from, stat } = await archiveItem(root, body.path);
    const dir = body.dir === undefined ? path.dirname(from) : await archiveDirOf(root, body.dir);
    if (stat.isDirectory() && pathIsInside(from, dir)) throw Error("夹不能挪进它自己里头");
    const renaming = body.name !== undefined,
      name = renaming ? cleanName(body.name) : path.basename(from);
    const wanted = path.join(dir, name);
    if (wanted === from) return describeItem(root, from);
    // Windows 上只改大小写仍是同一个文件；其他系统的大小写不同可以是两件文件。
    const sameFile = process.platform === "win32" && wanted.toLowerCase() === from.toLowerCase();
    const to = await placeFree(
      dir,
      name,
      async to => {
        if (!sameFile && fs.existsSync(to)) throw Object.assign(Error(), { code: "EEXIST" });
        await fs.promises.rename(from, to);
      },
      renaming
    ).catch(error => {
      if (renaming && error.code === "EEXIST") throw Error(`这一层已有「${name}」`);
      throw Error(describeFsError(error, String(body.path)));
    });
    return describeItem(root, to);
  }, failed);
  // 删：文件直接删，夹连同里头的一并删
  const handleArchiveRemove = jsonRoute(async body => {
    const root = await archiveRoot(body.root),
      { target, stat } = await archiveItem(root, body.path);
    await (stat.isDirectory() ? fs.promises.rm(target, { recursive: true, maxRetries: 2 }) : fs.promises.unlink(target)).catch(error => {
      throw Error(describeFsError(error, String(body.path)));
    });
    return { removed: relPath(root, target) };
  }, failed);
  // 新建夹：落在 dir 那一层；同名已有就另取「新建夹 (2)」
  const handleArchiveMkdir = jsonRoute(async body => {
    const root = await archiveRoot(body.root),
      target = await placeFree(await archiveDirOf(root, body.dir), cleanName(body.name || "新建夹"), to => fs.promises.mkdir(to)).catch(
        error => {
          throw Error(describeFsError(error, String(body.name || "")));
        }
      );
    return describeItem(root, target);
  }, failed);
  // 以本机程序打开：预览认不得的、或只看得到结构的，交给系统的默认程序看原样
  const handleArchiveOpen = jsonRoute(async body => {
    const root = await archiveRoot(body.root),
      { target } = await archiveItem(root, body.path);
    openWithSystem(target);
    return { opened: relPath(root, target) };
  }, failed);
  return {
    "POST /api/archive/list": handleArchiveList,
    "POST /api/archive/open": handleArchiveOpen,
    "POST /api/archive/put": handleArchivePut,
    "POST /api/archive/move": handleArchiveMove,
    "POST /api/archive/remove": handleArchiveRemove,
    "POST /api/archive/mkdir": handleArchiveMkdir,
    "POST /api/archive/clean": handleArchiveClean,
    "GET /api/archive/file": handleArchiveFile
  };
};
