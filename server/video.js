// 言 · 视频换壳：扩展名是 mp4、里头却是 MPEG-TS 这类封装的视频（录屏、下载器常这样存），资源管理器里的播放器照放，
// 浏览器的播放器却只认 MP4 / WebM 的壳。预览时用环境里的 ffmpeg 原样换进 MP4 的壳（-c copy，不重新编码，大文件也只要十几秒），
// 换好的放在 环境/cache/视频/，只留最近几件；没装「音视频」工具包、或换不成的，照原样送，由页面给出以本机程序打开
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const KEEP = 3;
// 浏览器认得的壳：MP4 / MOV（ISO 盒子，第 4–8 字节是盒名）、WebM / MKV（EBML 头）
const BOXES = new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"]);
function browserReadable(head) {
  if (head.length < 8) return true;
  if (BOXES.has(head.toString("latin1", 4, 8))) return true;
  return head.readUInt32BE(0) === 0x1a45dfa3;
}

/** @param {{ cacheHome: () => string, ffmpeg: () => string }} options */
module.exports = function createVideo({ cacheHome, ffmpeg }) {
  // 同一件正在换的：播放器一连发几个 Range 请求，跟着同一趟等，不另起
  const running = new Map();
  async function convert(file, out, exe) {
    const part = `${out}.part`;
    await new Promise((resolve, reject) =>
      execFile(
        exe,
        ["-v", "error", "-y", "-i", file, "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-f", "mp4", part],
        { windowsHide: true, timeout: 20 * 60 * 1000 },
        error => (error ? reject(error) : resolve(undefined))
      )
    ).catch(error => {
      fs.rmSync(part, { force: true });
      throw error;
    });
    fs.renameSync(part, out);
    // 只留最近几件；正被播放器读着的删不掉（Windows 上开着的文件），留到下回
    const kept = fs
      .readdirSync(path.dirname(out))
      .filter(name => name.endsWith(".mp4"))
      .map(name => path.join(path.dirname(out), name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    for (const stale of kept.slice(KEEP))
      try {
        fs.rmSync(stale, { force: true });
      } catch {}
  }
  /** 播放器来取（GET、非下载）的视频：浏览器认得的壳原样给；认不得的换好壳给换好的那份，换不成仍给原件。
   * name 是显示的文件名（附件在盘上的名字不带扩展名）
   * @param {{ method?: string }} req @param {string} file @param {string} name @returns {Promise<string>} */
  async function playable(req, file, name) {
    if (req.method !== "GET" || !/\.(mp4|m4v|mov)$/i.test(name)) return file;
    try {
      const head = Buffer.alloc(8),
        fd = fs.openSync(file, "r");
      try {
        fs.readSync(fd, head, 0, 8, 0);
      } finally {
        fs.closeSync(fd);
      }
      const exe = browserReadable(head) ? "" : ffmpeg();
      if (!exe) return file;
      const stat = fs.statSync(file),
        key = crypto
          .createHash("sha1")
          // 大小写可能区分两件原件。换一版键，免得全小写路径仍命中修复前串件的缓存。
          .update(`2|${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`)
          .digest("hex")
          .slice(0, 20),
        out = path.join(cacheHome(), `${key}.mp4`);
      if (fs.existsSync(out)) {
        const now = new Date();
        fs.utimesSync(out, now, now);
        return out;
      }
      if (!running.has(key)) {
        fs.mkdirSync(cacheHome(), { recursive: true });
        running.set(
          key,
          convert(file, out, exe).finally(() => running.delete(key))
        );
      }
      await running.get(key);
      return out;
    } catch {
      return file;
    }
  }
  return { playable };
};
