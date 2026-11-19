// 言 · 视频换壳：扩展名是 mp4、里头却是 MPEG-TS 这类封装的视频（录屏、下载器常这样存），资源管理器里的播放器照放，
// 预览时，指定扩展名的视频若未识别出常见封装，就用环境入口或 macOS 探到的 ffmpeg 尝试换成 MP4。
// 只复制第一条视频流和第一条音频流，不重新编码。换好的放在 环境/cache/视频/；缺工具或换不成则仍送原件。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const KEEP = 3;
// 只看文件头识别 ISO 盒子或 EBML，避免不必要的换壳；这不是对编解码器能否播放的判断
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
    // 每次换壳成功后按缓存文件修改时间清旧件；命中会更新时间，删不掉的留到下次尝试
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
  /** 调用方只把非下载请求交来。GET 且显示名为 .mp4、.m4v 或 .mov 时才检查是否需要换壳。
   * name 是显示名，不按盘上的附件名判断。
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
