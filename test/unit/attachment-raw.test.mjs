// 收入卷宗取的是落盘的原件，不是换壳后的预览副本：视频只留第一条视频与音轨（见 server/files.js 的 handleRaw 与 video.js），
// 预览继续走播放地址（不带 download）。这里用「缓存里已有预览」的路径验证取到的是哪一份字节
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import childProcess from "node:child_process";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const require = createRequire(import.meta.url);
const createFiles = require("../../server/files.js");

test("attachmentBody 取原件：视频有预览缓存时，交给卷宗的仍是上传的那一份", async t => {
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
  // 让真实预览流程先填一次缓存，不在测试里另写一份缓存键算法。
  const convert = t.mock.method(childProcess, "execFile", (_exe, args, _options, done) => {
    fs.writeFileSync(args.at(-1), preview);
    queueMicrotask(() => done(null));
  });
  const video = require("../../server/video.js")({ cacheHome: () => cacheHome, ffmpeg: () => "ffmpeg" });
  assert.notEqual(await video.playable({ method: "GET" }, file, "recording.mp4"), file);
  const server = http
    .createServer((req, res) =>
      createFiles({ filesHome: () => filesHome, playable: video.playable }).routes[
        `GET ${new URL(req.url, "http://127.0.0.1").pathname}`
      ]?.(req, res)
    )
    .listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const nativeFetch = globalThis.fetch;
  try {
    // 浏览器 fetch 按页面同源解析根路径；Node 用本次测试的桥接地址补齐。
    globalThis.fetch = (url, options) => nativeFetch(new URL(url, `http://127.0.0.1:${server.address().port}`), options);
    const api = load(["attachmentBody"]);
    const saved = Buffer.from(await (await api.attachmentBody("video")).arrayBuffer());
    assert.deepEqual(saved, original, "卷宗里的字节要与上传的原件一致");
    // 预览照旧走不带 download 的那一路，并复用已换壳的副本
    const shown = Buffer.from(await (await fetch(`http://127.0.0.1:${server.address().port}/api/files/raw?id=video`)).arrayBuffer());
    assert.deepEqual(shown, preview);
    assert.equal(convert.mock.callCount(), 1);
  } finally {
    globalThis.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  }
});
