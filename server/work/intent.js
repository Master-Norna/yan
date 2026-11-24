// 言 · 桥接 · 图的读写与内容指纹：.yan/图.json 带版本写，一组文件、目录此刻的指纹
// 由 server/work/index.js 装配
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { jsonRoute, requestSignal, fileHash } = require("../http.js");
const { WORK_SKIP, SCRATCH_DIR, INTENT_PATH, INTENT_LEGACY_PATH, describeFsError, relPath } = require("./paths.js");
const writeTextAtomic = require("./atomic.js");

module.exports = function createIntent(work) {
  const { failed, resolveWorkdir, targetOf, lockFile } = work;
  // ---- 图：一件工程要成立的结论图，存在目录的 .yan/图.json（INTENT_PATH），跨对话沿用（页面怎么折、怎么判见 src/19-intent/）。
  // 桥接是唯一的写者：几段对话、几个页面同时改，写时带上读到的版本，对不上就把此刻的那份交回、由页面重算再写，不会互相覆盖。
  // 旧名 .yan/意.json（2026-11-23 之前）读时兼容：新名还没有就读它，写下第一笔时迁到新名、旧文件删去
  const textVersion = text => (text ? createHash("sha1").update(text).digest("hex") : "");
  async function readIntent(file, label = INTENT_PATH) {
    const text = await fs.promises.readFile(file, "utf8").catch(error => {
      if (error.code === "ENOENT") return "";
      throw Error(describeFsError(error, label));
    });
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw Error(`${label} 不是合法的 JSON，请先修好它`);
    }
    return { data, version: textVersion(text) };
  }
  const handleWorkIntent = jsonRoute(async (body, req, res) => {
    const signal = requestSignal(res),
      workdir = resolveWorkdir(body.workdir),
      write = body.data !== undefined,
      file = await targetOf(workdir, { ...body, path: INTENT_PATH }, { write }),
      legacy = await targetOf(workdir, { ...body, path: INTENT_LEGACY_PATH }, { write });
    if (!write) {
      const current = await readIntent(file);
      return current.data === null ? readIntent(legacy, INTENT_LEGACY_PATH) : current;
    }
    const release = await lockFile(file, signal);
    try {
      const current = await readIntent(file),
        from = current.data === null ? { ...(await readIntent(legacy, INTENT_LEGACY_PATH)), legacy: true } : current;
      if (from.version !== String(body.base || "")) return { conflict: true, data: from.data, version: from.version };
      const text = `${JSON.stringify(body.data, null, 2)}\n`;
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await writeTextAtomic(file, text, signal).catch(error => {
        throw Error(describeFsError(error, INTENT_PATH));
      });
      if (from.legacy) await fs.promises.rm(legacy, { force: true }).catch(() => {});
      return { data: body.data, version: textVersion(text) };
    } finally {
      release();
    }
  }, failed);
  // 为图的凭据算指纹：文件按内容，目录计入空夹及各文件，跳过依赖目录、言的簿记、临时稿与链接。
  // 文件数或累计字节数超过阈值时，相关文件只记大小和修改时刻，仍遍历目录。
  // 明确不存在才记 null；暂时读不到则不报指纹（不把 I/O 错误当文件消失）。
  // 同一批文件与重叠目录共享读取，保留原指纹格式，不能跨批缓存外部改动。
  const PRINT_DIR_FILES = 2000,
    PRINT_DIR_BYTES = 32 * 1024 * 1024;
  const missing = error => error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "EISDIR";
  async function dirHash(dir, readDir, readStat, hashFile) {
    const files = [],
      directories = [];
    const walk = async at => {
      const entries = await readDir(at).catch(error => {
        // 根不存在才是整个目录消失；遍历途中某个子目录消失视为本次快照不完整。
        if (at === dir) throw error;
        throw Error(describeFsError(error, at));
      });
      for (const entry of entries) {
        const full = path.join(at, entry.name);
        if (
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          !WORK_SKIP.has(entry.name) &&
          entry.name !== ".yan" &&
          entry.name !== SCRATCH_DIR
        ) {
          directories.push(relPath(dir, full));
          await walk(full);
        } else if (entry.isFile()) files.push(full);
      }
    };
    await walk(dir);
    files.sort();
    const hash = createHash("sha1");
    for (const directory of directories.sort()) hash.update(`dir:${directory}\u0000\n`);
    let bytes = 0;
    for (const file of files) {
      const stat = await readStat(file).catch(error => {
        throw Error(describeFsError(error, file));
      });
      bytes += stat.size;
      const content =
        bytes <= PRINT_DIR_BYTES && files.length <= PRINT_DIR_FILES
          ? await hashFile(file).catch(error => {
              throw Error(describeFsError(error, file));
            })
          : `${stat.size}:${stat.mtimeMs}`;
      hash.update(`${relPath(dir, file)}\u0000${content}\n`);
    }
    return hash.digest("hex");
  }
  // 缓存 Promise 而不只缓存结果，并行的目录也不会重复读取同一份。
  function oncePerPath(read) {
    const cache = new Map();
    return file => {
      if (!cache.has(file)) cache.set(file, read(file));
      return cache.get(file);
    };
  }
  const handleWorkPrints = jsonRoute(async (body, req, res) => {
    const signal = requestSignal(res),
      workdir = resolveWorkdir(body.workdir),
      list = key => [...new Set((Array.isArray(body[key]) ? body[key] : []).map(String).filter(Boolean))].slice(0, 400),
      prints = Object.create(null),
      dirs = Object.create(null),
      readDir = oncePerPath(at => fs.promises.readdir(at, { withFileTypes: true })),
      readStat = oncePerPath(file => fs.promises.stat(file)),
      hashFile = oncePerPath(fileHash),
      take = async (given, into, read) => {
        try {
          const target = await targetOf(workdir, { ...body, path: given });
          into[given] = await read(target);
        } catch (error) {
          if (missing(error)) into[given] = null;
        }
      },
      jobs = [
        ...list("paths").map(given => () => take(given, prints, hashFile)),
        ...list("dirs").map(given => () => take(given, dirs, dir => dirHash(dir, readDir, readStat, hashFile)))
      ];
    // 限并发，避免 400 条凭据同时打开文件；目录内部仍顺序读取。
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, jobs.length) }, async () => {
        while (cursor < jobs.length) {
          signal.throwIfAborted();
          await jobs[cursor++]();
        }
      })
    );
    return { prints, dirs };
  }, failed);
  return {
    "POST /api/work/intent": handleWorkIntent,
    "POST /api/work/prints": handleWorkPrints
  };
};
