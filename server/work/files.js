// 言 · 桥接 · 执事的文件接口：写（覆盖时照原文件的编码与换行）、读、精确替换、下载进目录
// 由 server/work/index.js 装配，落点、沙箱、锁与报错的写法都从那里传进来（work）
"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { jsonRoute, requestSignal } = require("../http.js");
const { fetchPublicResponse, readLimitedBytes } = require("../web.js");
const sandbox = require("../sandbox.js");
const { describeFsError, clampNumber, relPath } = require("./paths.js");
const { decodeText, encodeText, countLines, lineDiffCounts, changeExcerpts, nearestPassage } = require("./text.js");
const writeTextAtomic = require("./atomic.js");
// 读一回最多交出多少字；覆盖写时捎回原文的长度，与页面留存写入内容的长度（src/15-tools/21-files.js 的 WRITTEN_KEEP_CHARS）一致
const WORK_FILE_LIMIT = 200000,
  PREVIOUS_KEEP_CHARS = 4000;
// 文件指纹：读、写、改都捎回一枚，页面记在那一步上；再写、再改时带上自己最后见到的那枚（seen），在锁里与现状比——
// 对不上就是读过之后被别人（别的帮手、主模型、编辑器、指令）改过。按内容算，改了又改回去的不算
const fingerprint = buffer => crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 16);

module.exports = function createFiles(work) {
  const { failed, resolveWorkdir, targetOf, missingHint, shownPath, strictBox, lockFile } = work;
  const handleWorkWrite = jsonRoute(async (body, req, res) => {
    // 页面停了就别再动文件：排队等锁时停下，锁到手也不写（见 locks.js）
    const signal = requestSignal(res);
    const workdir = resolveWorkdir(body.workdir),
      file = await targetOf(workdir, body, { write: true });
    if (file === workdir) throw Error("请给出文件名");
    const content = String(body.content ?? "");
    if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw Error("单个文件不超过 32 MB");
    const release = await lockFile(file, signal);
    try {
      const existing = await fs.promises.stat(file).catch(() => null);
      if (existing?.isDirectory()) throw Error(`${body.path} 是目录，不能作为文件写入`);
      await fs.promises.mkdir(path.dirname(file), { recursive: true }).catch(error => {
        throw Error(describeFsError(error, path.dirname(String(body.path))));
      });
      const existed = !!existing,
        previous = existed ? await fs.promises.readFile(file).catch(() => null) : null;
      // 这一答（或这名帮手）没读过它就整份覆盖：先拦下，请它读了再写——最危险的整份覆盖不该比 edit_file 更不设防。空文件不拦
      if (body.unseen === true && previous?.length)
        throw Error(`${body.path} 已存在（${previous.length} 字节），整份覆盖前请先 read_file 看过；只改几处用 edit_file`);
      // 读过之后被别人改过：拿旧印象整份写回，别人的改动就悄悄没了。不写，回现状的指纹，页面据此查是谁改的、请它重读
      // 读后被清空也算被改过（空的也有指纹）：不比长度
      if (typeof body.seen === "string" && previous && fingerprint(previous) !== body.seen)
        return { stale: true, path: shownPath(workdir, file), sig: fingerprint(previous) };
      const prior = previous ? decodeText(previous) : null,
        previousText = prior?.text ?? "",
        previousLines = previousText ? countLines(previousText) : 0;
      // 覆盖时照原文件的样子写：带 BOM 的还带、UTF-16 的还是 UTF-16，原文多半是 CRLF 而写来的只有 LF 的换成 CRLF。
      // GBK 编不回去，存成 UTF-8（读的那头会说）
      const crlf = (previousText.match(/\r\n/g) || []).length,
        lf = (previousText.match(/\n/g) || []).length,
        text = crlf && crlf * 2 >= lf && !content.includes("\r\n") ? content.replace(/\n/g, "\r\n") : content,
        output = (prior && encodeText(text, prior.encoding)) || Buffer.from(text, "utf8");
      await writeTextAtomic(file, output, signal).catch(error => {
        throw Error(describeFsError(error, String(body.path)));
      });
      // 覆盖时按行比出真增删，并捎回原文一段供页面并排看，删去的那些才有红可看。
      // 整份太长时按改动摘出两侧同一批窗口，不再只留开头：改在文件后头时两侧的开头一模一样，并排一比成了「什么都没改」，
      // 末尾那句「其后 N 字未留存」的字数反倒成了唯一的改动（见 text.js 的 changeExcerpts）
      const counts = existed ? lineDiffCounts(previousText, content) : { added: countLines(content), removed: 0 },
        long = previousText.length > PREVIOUS_KEEP_CHARS || content.length > PREVIOUS_KEEP_CHARS,
        excerpt = existed && previousText && long ? changeExcerpts(previousText, content) : null;
      return {
        path: shownPath(workdir, file),
        bytes: output.length,
        lines: countLines(content),
        existed,
        ...(previous?.length && !prior ? { binary: true } : {}),
        ...(prior?.encoding === "gbk" ? { converted: "gbk" } : {}),
        previousLines,
        ...counts,
        sig: fingerprint(output),
        ...(excerpt?.hunks
          ? { diff: { old: excerpt.old, new: excerpt.new } }
          : {
              previous:
                previousText.length > PREVIOUS_KEEP_CHARS
                  ? `${previousText.slice(0, PREVIOUS_KEEP_CHARS)}\n…（其后 ${previousText.length - PREVIOUS_KEEP_CHARS} 字未留存）`
                  : previousText || ""
            })
      };
    } finally {
      release();
    }
  }, failed);
  const handleWorkRead = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      file = await targetOf(workdir, body);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat) throw Error(`文件不存在：${body.path}${await missingHint(workdir, file, strictBox(body))}`);
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
      encoding: decoded.encoding,
      sig: fingerprint(buffer)
    };
  }, failed);
  // ---- edit_file：精确文本替换。old 必须在文件里唯一出现（或显式 replace_all）；文件是 CRLF 时把片段的换行也换成 CRLF 再匹配
  const handleWorkEdit = jsonRoute(async (body, req, res) => {
    // 页面停了就别再动文件：排队等锁时停下，锁到手也不写（见 locks.js）
    const signal = requestSignal(res);
    const workdir = resolveWorkdir(body.workdir),
      file = await targetOf(workdir, body, { write: true });
    const oldText = String(body.old ?? ""),
      newText = String(body.new ?? ""),
      replaceAll = body.replaceAll === true;
    if (file === workdir) throw Error("请给出文件名");
    if (!oldText) throw Error("old 不能为空；新建文件请用 write_file");
    if (oldText === newText) throw Error("old 与 new 相同，无需修改");
    const release = await lockFile(file, signal);
    try {
      const stat = await fs.promises.stat(file).catch(() => null);
      if (!stat) throw Error(`文件不存在：${body.path}${await missingHint(workdir, file, strictBox(body))}`);
      if (stat.isDirectory()) throw Error(`${body.path} 是目录`);
      if (stat.size > 8 * 1024 * 1024) throw Error("文件超过 8 MB，不予编辑");
      const raw = await fs.promises.readFile(file),
        decoded = decodeText(raw);
      if (!decoded) throw Error("二进制文件，不予编辑");
      if (decoded.encoding === "gbk")
        throw Error("文件是 GBK 编码，edit_file 只改 UTF-8 / UTF-16 的文件；请用 write_file 整体重写（会存成 UTF-8），或用指令转码后再改");
      // 大半是 UTF-8、夹着几行 GBK 的（中文 Windows 上的老脚本、老源码）读时也认作 UTF-8；整份写回会把没改的那几行毁掉
      if (!encodeText(decoded.text, decoded.encoding).equals(raw))
        throw Error("文件里夹着不是 UTF-8 的字节（多半是几行 GBK），整份写回会把它们毁掉；请用指令转码后再改，或用 write_file 整体重写");
      // 文件里有 CRLF、片段只有 LF：先照原样找（混着两种换行的文件，要改的那段可能本就是 LF），找不到再按 CRLF 找
      const source = decoded.text,
        crlf = source.includes("\r\n") && !oldText.includes("\r\n") && (!oldText.includes("\n") || !source.includes(oldText));
      const needle = crlf ? oldText.replace(/\r?\n/g, "\r\n") : oldText,
        replacement = crlf ? newText.replace(/\r?\n/g, "\r\n") : newText;
      let count = 0;
      for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + needle.length)) count += 1;
      if (!count) {
        // 多半是手里的原文旧了（指令或别处改过这个文件）：把文件里最像的那一段照现在的样子附上，下一回照着改即可，不必先 read_file
        const near = nearestPassage(source, oldText);
        throw Error(
          near
            ? `未找到要替换的文本：old 须与文件内容逐字一致。文件里最像的一段，现在是这样（行号仅供对照，不属于内容）：\n${near}`
            : "未找到要替换的文本：old 必须与文件内容逐字一致（含缩进与空格），请先 read_file 核对"
        );
      }
      if (count > 1 && !replaceAll) throw Error(`要替换的文本出现了 ${count} 处，请提供更长的唯一片段，或设置 replace_all`);
      const result = replaceAll ? source.split(needle).join(replacement) : source.replace(needle, () => replacement);
      // 按原来的编码写回：UTF-16 的还是 UTF-16，带 BOM 的还带 BOM
      const output = encodeText(result, decoded.encoding);
      await writeTextAtomic(file, output, signal).catch(error => {
        throw Error(describeFsError(error, String(body.path)));
      });
      const line = source.slice(0, source.indexOf(needle)).split(/\r?\n/).length,
        before = fingerprint(raw);
      // 读过之后被别人改过、要改的这段原文却还对得上：照改（原文比对已兜住这一处），捎回改前的指纹，页面据此说是谁动过、别处的现状它没看过
      return {
        path: shownPath(workdir, file),
        replaced: replaceAll ? count : 1,
        line,
        lines: countLines(result),
        bytes: output.length,
        sig: fingerprint(output),
        ...(typeof body.seen === "string" && before !== body.seen ? { drift: before } : {})
      };
    } finally {
      release();
    }
  }, failed);
  // ---- download_file：把网上的文件存进工作目录。地址门禁与 fetch_page 同一套（不许本机与内网）；path 给目录或省略时按网址里的文件名存，
  // 已有同名文件就加 (2)；最多 64 MB
  const DOWNLOAD_LIMIT = 64 * 1024 * 1024;
  const handleWorkDownload = jsonRoute(async (body, req, res) => {
    // 页面停了就别再动文件：排队等锁时停下，锁到手也不写（见 locks.js）
    const signal = requestSignal(res);
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
    const release = await lockFile(target, signal);
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const extension = path.extname(target),
        stem = target.slice(0, target.length - extension.length);
      // 挑名与落盘是一步：独占创建（wx），名字被占了（别的下载、别处刚写的）就顺延到下一个序号，不会两份落进同一个名字
      let file = target;
      for (let n = 2; ; n++)
        try {
          await fs.promises.writeFile(file, buffer, { flag: "wx" });
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw Error(describeFsError(error, shownPath(workdir, file)));
          file = `${stem} (${n})${extension}`;
        }
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
    "POST /api/work/write": handleWorkWrite,
    "POST /api/work/read": handleWorkRead,
    "POST /api/work/edit": handleWorkEdit,
    "POST /api/work/download": handleWorkDownload
  };
};
