import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("视频换壳：只在同一原件间共用缓存，不混淆大小写不同的文件", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-video-")),
    upper = path.join(root, "Clip.mp4"),
    lower = path.join(root, "clip.mp4"),
    cache = path.join(root, "cache");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 换壳本身不是这个用例的对象。以读取原件代替启动 ffmpeg，仍走真实缓存与落盘。
  const convert = t.mock.method(childProcess, "execFile", (_exe, args, _options, done) => {
    fs.copyFileSync(args[args.indexOf("-i") + 1], args.at(-1));
    queueMicrotask(() => done(null));
  });
  const video = require("../../server/video.js")({ cacheHome: () => cache, ffmpeg: () => "ffmpeg" });
  fs.writeFileSync(upper, "source-A");
  // 默认的 Windows / macOS 临时卷不区分大小写。在这种卷上只将第二个原件映射到另一个实际文件。
  const lowerSource = fs.existsSync(lower) ? path.join(root, "other.mp4") : lower;
  if (lowerSource !== lower)
    for (const method of ["openSync", "statSync", "copyFileSync"]) {
      const original = fs[method];
      t.mock.method(fs, method, (file, ...args) => original(file === lower ? lowerSource : file, ...args));
    }
  fs.writeFileSync(lowerSource, "source-B");
  const stamp = new Date("2026-01-01T00:00:00Z");
  for (const file of [upper, lowerSource]) fs.utimesSync(file, stamp, stamp);
  const get = file => video.playable({ method: "GET" }, file, path.basename(file));
  const a = await get(upper);
  assert.notEqual(a, upper);
  assert.equal(await get(upper), a);
  const b = await get(lower);
  assert.notEqual(b, lower);
  assert.notEqual(a, b);
  assert.equal(fs.readFileSync(a, "utf8"), "source-A");
  assert.equal(fs.readFileSync(b, "utf8"), "source-B");
  assert.equal(convert.mock.callCount(), 2);
});
