// 收入卷宗取的是落盘的原件，不是换壳后的预览副本：视频只留第一条视频与音轨（见 server/files.js 的 handleRaw 与 video.js），
// 预览继续走播放地址（不带 download）。这里用「缓存里已有预览」的路径验证取到的是哪一份字节
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const createFiles = createRequire(import.meta.url)("../../server/files.js");
const createVideo = createRequire(import.meta.url)("../../server/video.js");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

test("attachmentBody 取原件：视频有预览缓存时，交给卷宗的仍是上传的那一份", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-attachment-raw-")),
    filesHome = path.join(base, "files"),
    cacheHome = path.join(base, "video-cache");
  fs.mkdirSync(filesHome, { recursive: true });
  fs.mkdirSync(cacheHome, { recursive: true });
  const original = Buffer.from("original-transport-stream-with-extra-tracks"),
    preview = Buffer.from("preview-mp4-only-first-video-and-audio"),
    file = path.join(filesHome, "video.mp4");
  fs.writeFileSync(file, original);
  fs.writeFileSync(
    path.join(filesHome, "video.json"),
    JSON.stringify({ id: "video", kind: "file", name: "recording.mp4", file: "video.mp4", mime: "video/mp4" })
  );
  // 预览缓存按 video.js 的键命名：路径 + 大小 + 修改时间
  const stat = fs.statSync(file),
    key = crypto
      .createHash("sha1")
      .update(`${path.resolve(file).toLowerCase()}|${stat.size}|${stat.mtimeMs}`)
      .digest("hex")
      .slice(0, 20);
  fs.writeFileSync(path.join(cacheHome, `${key}.mp4`), preview);
  const video = createVideo({ cacheHome: () => cacheHome, ffmpeg: () => "cache-already-exists" });
  const server = http
    .createServer((req, res) =>
      createFiles({ filesHome: () => filesHome, playable: video.playable }).routes[
        `GET ${new URL(req.url, "http://127.0.0.1").pathname}`
      ]?.(req, res)
    )
    .listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const api = load(["attachmentBody", "setBase: value => { apiBase = value; }"]);
    api.setBase(`http://127.0.0.1:${server.address().port}`);
    const saved = Buffer.from(await (await api.attachmentBody("video")).arrayBuffer());
    assert.equal(sha(saved), sha(original), "卷宗里的字节要与上传的原件一致");
    assert.notEqual(sha(saved), sha(preview), "不能是换壳后的预览副本");
    // 预览照旧走不带 download 的那一路
    const shown = Buffer.from(await (await fetch(`http://127.0.0.1:${server.address().port}/api/files/raw?id=video`)).arrayBuffer());
    assert.equal(sha(shown), sha(preview));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  }
});
