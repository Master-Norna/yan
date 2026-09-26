// 言 · 桥接的执事接口：工作目录、指令执行、文件读写与检索、目录选择对话框；卷宗目录的接口见 archive.js
// 由 server.js 装配：require("./server/work/index.js")({ archiveHome, workHome, toolEnv })
"use strict";
const { sendJson, readJson, jsonRoute, errorText } = require("../http.js");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sandbox = require("../sandbox.js");
const { fetchPublicResponse, readLimitedBytes } = require("../web.js");
const paths = require("./paths.js");
const { SCRATCH_DIR, WORK_SKIP, describeFsError, clampNumber, pathIsInside, resolveTarget, assertReachable, relPath } = paths;
const { decodeText, encodeText, countLines } = require("./text.js");
const { pickFolder } = require("./folder-picker.js");
const createShell = require("./shell.js");
const createLocks = require("./locks.js");
const createArchive = require("./archive.js");
const writeTextAtomic = require("./atomic.js");

module.exports = function createWork({ archiveHome, workHome, toolEnv }) {
  // ---- 执事模式：给模型一个工作目录，能跑指令、读写文件 ----
  // 只做四件事：跑一条指令、写文件、读文件、列目录。路径默认限定在工作目录之内（页面放开后绝对路径可指向目录之外）；指令在工作目录里用本机 shell 执行。
  // 不做进程隔离——这是用户自己的机器，页面上每条指令都看得见，并按问而后行 / 审而后行 / 径行三档处理。
  // 请求带 sandbox: true 时再加一道沙箱（server/sandbox.js）：路径不出目录、机密文件不碰、指令先筛、环境变量去掉机密——在桥接这头守，页面与模型都绕不过
  // 执事没给目录时的退路：存储根里的 工作/（workHome()，见 server/store.js），与卷宗、对话同在一处
  // 卷宗：对话没绑工作目录时，模型的工具就落在这里——写出的表格、文档都收在卷宗里；页面上的卷宗即这个目录的视图。
  // 位置在存储根里（archiveHome()，见 server/store.js），随每个请求的 root 传来的也认。
  // 各接口出错时回给页面的那句话：截到 300 字
  const failed = error => errorText(error, 300);
  const WORK_FILE_LIMIT = 200000,
    WORK_LIST_LIMIT = 300;
  const resolveWorkdir = raw => paths.resolveWorkdir(raw, workHome);
  const { WORK_SHELL, runShell, startBackground, backgroundReport, checkBackground } = createShell({ toolEnv }),
    { lockFile, lockWorkdir } = createLocks();
  // 沙箱分两档：问而后行（或没说档位的请求）用严的；审而后行、径行用宽的——文件工具在宽档里不设防，指令只守系统本身（见 server/sandbox.js）
  const looseTier = body => body.permission === "review" || body.permission === "auto";
  const strictBox = body => body.sandbox === true && !looseTier(body);
  // 各文件接口的落点：严的沙箱里不认「全盘」，目录内的机密文件、.git 内部（写）也拦下；宽档与没开沙箱时，可及范围只由「全盘 / 目录内」定
  async function targetOf(workdir, body, { write = false } = {}) {
    const boxed = strictBox(body),
      target = resolveTarget(workdir, body.path, body.roam === true && !boxed);
    await assertReachable(workdir, target);
    if (boxed) {
      const why = sandbox.screenPath(relPath(workdir, target), { write });
      if (why) throw Error(why);
    }
    return target;
  }
  // 给页面与模型看的路径：目录之内给相对路径，目录之外给完整路径
  function shownPath(workdir, file) {
    return pathIsInside(workdir, file) ? relPath(workdir, file) : file;
  }
  const handleWorkPick = jsonRoute(async body => {
    const result = await pickFolder(String(body.current || "").trim());
    if (result.error) throw Error(result.error);
    return { path: result.path };
  }, failed);
  const handleWorkPrepare = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir);
    const existing = await fs.promises.stat(workdir).catch(() => null);
    if (existing && !existing.isDirectory()) throw Error(`路径已被文件占用，不是目录：${workdir}`);
    if (!existing)
      await fs.promises.mkdir(workdir, { recursive: true }).catch(error => {
        throw Error(describeFsError(error, workdir));
      });
    const entries = await fs.promises.readdir(workdir).catch(() => []);
    return {
      workdir,
      platform: process.platform,
      shell: WORK_SHELL,
      home: workHome(),
      entries: entries.length,
      created: !existing
    };
  }, failed);
  async function handleWorkRun(req, res) {
    try {
      const body = await readJson(req),
        workdir = resolveWorkdir(body.workdir),
        command = String(body.command || "").trim();
      if (!command) throw Error("指令不能为空");
      if (!fs.existsSync(workdir)) throw Error("工作目录已不存在，请重新发送以重建，或另起对话");
      const boxed = body.sandbox === true;
      if (boxed) {
        const why = looseTier(body) ? sandbox.screenLoose(command) : sandbox.screenCommand(command, workdir);
        if (why) throw Error(why);
      }
      if (body.permission === "review") {
        const why = sandbox.screenAutoReview(command);
        if (why) throw Error(why);
      }
      if (body.background === true) {
        console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} $ （后台）${command.slice(0, 120)}`);
        return sendJson(res, 200, await backgroundReport(startBackground(command, workdir, boxed), 5000));
      }
      // 超时只有默认值没有上限：长测试、大装包、跑数据都可能超过十分钟，页面上本就有「停止」。
      // 封顶在 2³¹−1 毫秒（约 24 天）只因 setTimeout 超过它会溢出、当作 1 毫秒——模型给个大数，指令就被当场杀掉
      const timeoutMs = clampNumber(Number(body.timeout) * 1000, 120000, 1000, 2147483647);
      console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} $ ${command.slice(0, 120)}`);
      // 页面那头停止生成会中止这个请求：响应还没写就断开，即是中止，把指令连同它起的子进程一并杀掉
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const started = Date.now(),
        release = await lockWorkdir(workdir);
      let result;
      try {
        result = await runShell(command, workdir, timeoutMs, abort.signal, { boxed });
      } finally {
        release();
      }
      if (result.aborted) console.log(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })}   已中止：${command.slice(0, 80)}`);
      if (!res.writableEnded && !res.destroyed) sendJson(res, 200, { ...result, durationMs: Date.now() - started });
    } catch (error) {
      sendJson(res, 400, { error: failed(error) });
    }
  }
  const handleWorkCheck = jsonRoute(
    async body => await checkBackground(body.id, body.stop === true, clampNumber(Number(body.wait) * 1000, 0, 0, 120000)),
    failed
  );
  // 问而后行：发指令前先问一声严的沙箱会不会拦——会拦的照样请示，请示条上写明原因，用户批了这一条就出沙箱跑
  const handleWorkScreen = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir);
    return { why: sandbox.screenCommand(String(body.command || ""), workdir) };
  }, failed);
  const handleWorkWrite = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      file = await targetOf(workdir, body, { write: true });
    if (file === workdir) throw Error("请给出文件名");
    const content = String(body.content ?? "");
    if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw Error("单个文件不超过 32 MB");
    const release = await lockFile(workdir, file);
    try {
      const existing = await fs.promises.stat(file).catch(() => null);
      if (existing?.isDirectory()) throw Error(`${body.path} 是目录，不能作为文件写入`);
      await fs.promises.mkdir(path.dirname(file), { recursive: true }).catch(error => {
        throw Error(describeFsError(error, path.dirname(String(body.path))));
      });
      const existed = !!existing,
        previous = existed ? await fs.promises.readFile(file).catch(() => null) : null;
      const previousText = previous ? decodeText(previous)?.text : "",
        previousLines = previousText ? countLines(previousText) : 0;
      await writeTextAtomic(file, content).catch(error => {
        throw Error(describeFsError(error, String(body.path)));
      });
      return {
        path: shownPath(workdir, file),
        bytes: Buffer.byteLength(content),
        lines: countLines(content),
        existed,
        previousLines
      };
    } finally {
      release();
    }
  }, failed);
  const handleWorkRead = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      file = await targetOf(workdir, body);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat) throw Error(`文件不存在：${body.path}`);
    if (stat.isDirectory()) throw Error(`${body.path} 是目录，请改用 list_files`);
    if (stat.size > 8 * 1024 * 1024) throw Error("文件超过 8 MB，不予读取");
    const buffer = await fs.promises.readFile(file).catch(error => {
      throw Error(describeFsError(error, String(body.path)));
    });
    const decoded = decodeText(buffer);
    if (!decoded) throw Error("二进制文件，不予读取");
    const lines = decoded.text.split(/\r?\n/),
      offset = Math.floor(clampNumber(body.offset, 1, 1, Math.max(1, lines.length))),
      limit = Math.floor(clampNumber(body.limit, 400, 1, 2000));
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    let text = slice.map((line, i) => `${String(offset + i).padStart(4)}| ${line}`).join("\n");
    if (text.length > WORK_FILE_LIMIT) text = `${text.slice(0, WORK_FILE_LIMIT)}\n…（内容过长已截断，请缩小 limit）`;
    return {
      path: shownPath(workdir, file),
      totalLines: lines.length,
      offset,
      shown: slice.length,
      text,
      encoding: decoded.encoding
    };
  }, failed);
  // 极简 glob：** 跨目录、* 不跨目录、? 单字符；没有 / 的模式只匹配文件名
  function globToRegExp(pattern) {
    const text = String(pattern || "")
      .trim()
      .replace(/\\/g, "/");
    if (!text) return null;
    const body = text
      .replace(/[.+^${}()|[\]]/g, "\\$&")
      .replace(/\*\*\/?/g, "\0")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\0/g, "(?:.*/)?");
    return new RegExp(`^${text.includes("/") ? "" : "(?:.*/)?"}${body}$`, "i");
  }
  async function listTree(dir, base, depth, out, filter = null) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= WORK_LIST_LIMIT) return;
      const rel = path.relative(base, path.join(dir, entry.name)).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        if (!filter) out.push(`${rel}@`);
        continue;
      } // 符号链接 / junction 只标出，不跟进：目标可能在工作目录之外
      if (entry.isDirectory()) {
        if (!filter) out.push(`${rel}/`);
        if (depth > 1 && !WORK_SKIP.has(entry.name)) await listTree(path.join(dir, entry.name), base, depth - 1, out, filter);
      } else if (!filter || filter.test(rel)) {
        const size = await fs.promises
          .stat(path.join(dir, entry.name))
          .then(s => s.size)
          .catch(() => 0);
        out.push(`${rel}\t${size}`);
      }
    }
  }
  const handleWorkList = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      dir = await targetOf(workdir, body);
    const stat = await fs.promises.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) throw Error(`目录不存在：${body.path || "."}`);
    const filter = globToRegExp(body.pattern),
      out = [];
    await listTree(dir, dir, Math.floor(clampNumber(body.depth, filter ? 8 : 2, 1, 8)), out, filter);
    return { path: shownPath(workdir, dir) || ".", entries: out, truncated: out.length >= WORK_LIST_LIMIT };
  }, failed);
  // ---- edit_file：精确文本替换。old 必须在文件里唯一出现（或显式 replace_all）；文件是 CRLF 时把片段的换行也换成 CRLF 再匹配
  const handleWorkEdit = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      file = await targetOf(workdir, body, { write: true });
    const oldText = String(body.old ?? ""),
      newText = String(body.new ?? ""),
      replaceAll = body.replaceAll === true;
    if (file === workdir) throw Error("请给出文件名");
    if (!oldText) throw Error("old 不能为空；新建文件请用 write_file");
    if (oldText === newText) throw Error("old 与 new 相同，无需修改");
    const release = await lockFile(workdir, file);
    try {
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) throw Error(`文件不存在：${body.path}`);
      if (stat.isDirectory()) throw Error(`${body.path} 是目录`);
      if (stat.size > 8 * 1024 * 1024) throw Error("文件超过 8 MB，不予编辑");
      const decoded = decodeText(await fs.promises.readFile(file));
      if (!decoded) throw Error("二进制文件，不予编辑");
      if (decoded.encoding === "gbk")
        throw Error("文件是 GBK 编码，edit_file 只改 UTF-8 / UTF-16 的文件；请用 write_file 整体重写（会存成 UTF-8），或用指令转码后再改");
      const source = decoded.text,
        crlf = source.includes("\r\n") && !oldText.includes("\r\n");
      const needle = crlf ? oldText.replace(/\r?\n/g, "\r\n") : oldText,
        replacement = crlf ? newText.replace(/\r?\n/g, "\r\n") : newText;
      let count = 0;
      for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + needle.length)) count += 1;
      if (!count) throw Error("未找到要替换的文本：old 必须与文件内容逐字一致（含缩进与空格），请先 read_file 核对");
      if (count > 1 && !replaceAll) throw Error(`要替换的文本出现了 ${count} 处，请提供更长的唯一片段，或设置 replace_all`);
      const result = replaceAll ? source.split(needle).join(replacement) : source.replace(needle, () => replacement);
      // 按原来的编码写回：UTF-16 的还是 UTF-16，带 BOM 的还带 BOM
      const output = encodeText(result, decoded.encoding);
      await writeTextAtomic(file, output).catch(error => {
        throw Error(describeFsError(error, String(body.path)));
      });
      const line = source.slice(0, source.indexOf(needle)).split(/\r?\n/).length;
      return {
        path: shownPath(workdir, file),
        replaced: replaceAll ? count : 1,
        line,
        lines: countLines(result),
        bytes: output.length
      };
    } finally {
      release();
    }
  }, failed);
  // ---- search_files：在工作目录里按正则或原文逐行检索；跳过 node_modules 等目录与二进制、超大文件
  // 正则是模型写的：写成 (a+)+$ 这类会灾难性回溯的，一行就能把桥接卡死（单线程，所有对话一起停）。
  // 每个文件的逐行匹配放进 vm 跑、限两秒，超时即中止这次检索，把原因回给模型
  const SEARCH_REGEX_MS = 2000,
    searchScript = new vm.Script("hits = []; for (let i = 0; i < lines.length; i++) if (regex.test(lines[i])) hits.push(i);"),
    searchContext = vm.createContext({ regex: null, lines: null, hits: null });
  function matchLines(regex, lines, rel) {
    searchContext.regex = regex;
    searchContext.lines = lines;
    try {
      searchScript.runInContext(searchContext, { timeout: SEARCH_REGEX_MS });
      return searchContext.hits;
    } catch (error) {
      if (error?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT")
        throw Error(
          `正则在 ${rel} 上回溯过久（超过 ${SEARCH_REGEX_MS / 1000} 秒），已中止：请改写得更具体（避免 (a+)+ 这类嵌套的重复），或用 literal 按原文找`
        );
      throw error;
    } finally {
      searchContext.regex = searchContext.lines = searchContext.hits = null;
    }
  }
  const SEARCH_MATCH_LIMIT = 200,
    SEARCH_FILE_LIMIT = 4000,
    SEARCH_FILE_BYTES = 2 * 1024 * 1024;
  const handleWorkSearch = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      dir = await targetOf(workdir, body),
      boxed = strictBox(body);
    const query = String(body.query || "");
    if (!query.trim()) throw Error("query 不能为空");
    let regex;
    try {
      regex = new RegExp(
        body.literal === true ? query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : query,
        body.caseSensitive === true ? "" : "i"
      );
    } catch (error) {
      throw Error(`正则无效：${error.message}`);
    }
    const filter = globToRegExp(body.glob),
      limit = Math.floor(clampNumber(body.limit, 60, 1, SEARCH_MATCH_LIMIT));
    const stat = await fs.promises.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) throw Error(`目录不存在：${body.path || "."}`);
    const matches = [];
    let scanned = 0,
      filesHit = new Set(),
      truncated = false;
    const walk = async current => {
      if (truncated) return;
      const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (truncated) return;
        const full = path.join(current, entry.name),
          rel = relPath(dir, full);
        if (entry.isSymbolicLink()) continue; // 不顺着链接读：链接指向目录外时，检索会把外面的内容带进来
        if (entry.isDirectory()) {
          if (!WORK_SKIP.has(entry.name)) await walk(full);
          continue;
        }
        if (filter && !filter.test(rel)) continue;
        if (boxed && sandbox.screenPath(rel)) continue; // 沙箱不借检索带出机密文件
        if (++scanned > SEARCH_FILE_LIMIT) {
          truncated = true;
          return;
        }
        const size = await fs.promises
          .stat(full)
          .then(s => s.size)
          .catch(() => 0);
        if (!size || size > SEARCH_FILE_BYTES) continue;
        const buffer = await fs.promises.readFile(full).catch(() => null),
          decoded = buffer && decodeText(buffer);
        if (!decoded) continue;
        const lines = decoded.text.split(/\r?\n/);
        for (const i of matchLines(regex, lines, rel)) {
          filesHit.add(rel);
          matches.push({ file: shownPath(workdir, full), line: i + 1, text: lines[i].trim().slice(0, 240) });
          if (matches.length >= limit) {
            truncated = true;
            return;
          }
        }
      }
    };
    await walk(dir);
    return { path: shownPath(workdir, dir) || ".", matches, files: filesHit.size, scanned, truncated };
  }, failed);
  // ---- download_file：把网上的文件存进工作目录。地址门禁与 fetch_page 同一套（不许本机与内网）；path 给目录或省略时按网址里的文件名存，
  // 已有同名文件就加 (2)；最多 64 MB
  const DOWNLOAD_LIMIT = 64 * 1024 * 1024;
  const handleWorkDownload = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir);
    let url;
    try {
      url = new URL(String(body.url || "").trim());
    } catch {
      throw Error("网址无效");
    }
    const given = String(body.path || "").trim(),
      fromUrl =
        (() => {
          try {
            return decodeURIComponent(path.posix.basename(url.pathname));
          } catch {
            return path.posix.basename(url.pathname);
          }
        })() || "下载文件";
    let target = await targetOf(workdir, { ...body, path: given || "." }, { write: true });
    const stat = await fs.promises.stat(target).catch(() => null);
    if (!given || /[\\/]$/.test(given) || stat?.isDirectory()) {
      // 网址末段解码后可能是「../」「..」或带 Windows 不许的字符：取最后一段、去掉怪字符，. 与 .. 一律换成默认名，不能借它落到目录外
      const base = path
        .basename(fromUrl)
        .replace(/[<>:"|?*\u0000-\u001f]/g, "_")
        .trim();
      target = path.join(target, base && base !== "." && base !== ".." ? base : "下载文件");
      if (strictBox(body)) {
        const why = sandbox.screenPath(relPath(workdir, target), { write: true });
        if (why) throw Error(why);
      }
    }
    const started = Date.now(),
      { response } = await fetchPublicResponse(url.href, { timeout: 120000, allowLoopback: true });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw Error(`对方返回 ${response.status}`);
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > DOWNLOAD_LIMIT) {
      await response.body?.cancel().catch(() => {});
      throw Error(`文件超过 ${DOWNLOAD_LIMIT / 1048576} MB`);
    }
    const { buffer, truncated } = await readLimitedBytes(response, DOWNLOAD_LIMIT);
    if (truncated) throw Error(`文件超过 ${DOWNLOAD_LIMIT / 1048576} MB`);
    const release = await lockFile(workdir, target);
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const extension = path.extname(target),
        stem = target.slice(0, target.length - extension.length);
      let file = target;
      for (let n = 2; fs.existsSync(file); n++) file = `${stem} (${n})${extension}`;
      await fs.promises.writeFile(file, buffer).catch(error => {
        throw Error(describeFsError(error, shownPath(workdir, file)));
      });
      return {
        path: shownPath(workdir, file),
        bytes: buffer.length,
        type: (response.headers.get("content-type") || "").split(";")[0].trim(),
        durationMs: Date.now() - started
      };
    } finally {
      release();
    }
  }, failed);

  return {
    workHome,
    SCRATCH_DIR,
    WORK_SHELL,
    // 都碰本机磁盘或本机进程：只受理本站页面与 VS Code Webview（见 server.js 的接口表）
    routes: {
      "POST /api/work/prepare": handleWorkPrepare,
      "POST /api/work/pick": handleWorkPick,
      "POST /api/work/run": handleWorkRun,
      "POST /api/work/screen": handleWorkScreen,
      "POST /api/work/check": handleWorkCheck,
      "POST /api/work/write": handleWorkWrite,
      "POST /api/work/read": handleWorkRead,
      "POST /api/work/list": handleWorkList,
      "POST /api/work/edit": handleWorkEdit,
      "POST /api/work/search": handleWorkSearch,
      "POST /api/work/download": handleWorkDownload,
      ...createArchive({ archiveHome })
    }
  };
};
