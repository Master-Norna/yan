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
import { resolveObjectURL } from "node:buffer";
import { load } from "./harness.mjs";

const require = createRequire(import.meta.url);
const createFiles = require("../../server/files.js");

async function serveAttachments(t, playable = (_req, file) => file) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-attachment-raw-")),
    filesHome = path.join(base, "files");
  fs.mkdirSync(filesHome);
  const { routes } = createFiles({ filesHome: () => filesHome, playable });
  const server = http.createServer((req, res) => routes[`${req.method} ${req.url.split("?")[0]}`](req, res)).listen(0, "127.0.0.1");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  });
  await new Promise(resolve => server.once("listening", resolve));
  const nativeFetch = globalThis.fetch,
    request = (url, options) => nativeFetch(new URL(url, `http://127.0.0.1:${server.address().port}`), options);
  const bridge = async (url, body) => {
    const res = await request(url, { method: "POST", body: JSON.stringify(body) }),
      data = await res.json();
    if (!res.ok) throw Error(data.error);
    return data;
  };
  const bridgeUpload = async (url, head, blob) => {
    const text = Buffer.from(JSON.stringify(head)),
      res = await request(`${url}?head=${text.length}`, { method: "POST", body: new Blob([text, blob]) }),
      data = await res.json();
    if (!res.ok) throw Error(data.error);
    return data;
  };
  const raw = id => request(`/api/files/raw?id=${id}&download=1`);
  const disk = {
    file: (name, bytes) => fs.writeFileSync(path.join(filesHome, name), bytes),
    directory: name => fs.mkdirSync(path.join(filesHome, name)),
    meta: (id, file) => disk.file(`${id}.json`, JSON.stringify({ id, kind: "text", name: `${id}.txt`, file }))
  };
  return { base, filesHome, request, bridge, bridgeUpload, raw, disk };
}

test("attachmentBody 取原件：视频有预览缓存时，交给卷宗的仍是上传的那一份", async t => {
  const { base, filesHome, request, disk } = await serveAttachments(t, (...args) => video.playable(...args)),
    cacheHome = path.join(base, "video-cache");
  fs.mkdirSync(cacheHome);
  const original = Buffer.from("original-transport-stream-with-extra-tracks"),
    preview = Buffer.from("preview-mp4-only-first-video-and-audio"),
    file = path.join(filesHome, "video.mp4");
  disk.file("video.mp4", original);
  disk.file("video.json", JSON.stringify({ id: "video", kind: "file", name: "recording.mp4", file: "video.mp4", mime: "video/mp4" }));
  // 让真实预览流程先填一次缓存，不在测试里另写一份缓存键算法。
  const convert = t.mock.method(childProcess, "execFile", (_exe, args, _options, done) => {
    fs.writeFileSync(args.at(-1), preview);
    queueMicrotask(() => done(null));
  });
  const video = require("../../server/video.js")({ cacheHome: () => cacheHome, ffmpeg: () => "ffmpeg" });
  assert.notEqual(await video.playable({ method: "GET" }, file, "recording.mp4"), file);
  // 浏览器 fetch 按页面同源解析根路径；Node 用本次测试的桥接地址补齐。
  t.mock.method(globalThis, "fetch", request);
  const api = load(["attachmentBody"]);
  const saved = Buffer.from(await (await api.attachmentBody("video")).arrayBuffer());
  assert.deepEqual(saved, original, "卷宗里的字节要与上传的原件一致");
  // 预览照旧走不带 download 的那一路，并复用已换壳的副本。
  const shown = Buffer.from(await (await request("/api/files/raw?id=video")).arrayBuffer());
  assert.deepEqual(shown, preview);
  assert.equal(convert.mock.callCount(), 1);
});

test("磁盘原件确认与真实下载一致，只查文件状态，不读原件", async t => {
  const { filesHome, bridge, raw, disk } = await serveAttachments(t);
  disk.meta("missing", "missing.txt");
  disk.meta("partial", "partial.txt");
  disk.file("partial.txt.42.run.tmp", "半截");
  disk.meta("badPointer", "badPointer.txt.42.run.tmp");
  disk.file("badPointer.txt.42.run.tmp", "半截");
  disk.meta("directory", "directory.txt");
  disk.directory("directory.txt");
  disk.meta("self", "self.JSON");
  disk.meta("busy", "busy.txt");
  disk.file("busy.txt", "存在，但暂不可读");
  const openSync = fs.openSync;
  t.mock.method(fs, "openSync", (file, ...args) => {
    if (file === path.join(filesHome, "busy.txt")) throw Object.assign(Error("模拟独占或权限不足"), { code: "EACCES" });
    return openSync(file, ...args);
  });
  disk.meta("fallback", "fallback.txt");
  disk.directory("fallback.aa");
  disk.file("fallback.aa.42.run.tmp", "半截");
  disk.file("fallback.zz", "旧原件");
  disk.meta("extensionless");
  disk.file("extensionless", "无扩展名");
  disk.meta("empty", "empty.tmp");
  disk.file("empty.tmp", "");
  disk.meta("json", "json.raw.json");
  disk.file("json.raw.json", "{}\n");
  disk.file("noMeta.txt", "只有原件");
  const available = { fallback: "旧原件", extensionless: "无扩展名", empty: "", json: "{}\n" },
    missing = ["missing", "partial", "badPointer", "directory", "self", "busy", "noMeta"],
    ids = [...missing, ...Object.keys(available)],
    metaPaths = new Set(ids.map(id => path.join(filesHome, `${id}.json`)));
  const readFileSync = fs.readFileSync;
  let originalReads = 0;
  const read = t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (typeof file === "string" && path.dirname(file) === filesHome && !metaPaths.has(file)) originalReads++;
    return readFileSync(file, ...args);
  });
  const stream = t.mock.method(fs, "createReadStream");
  const { has } = await bridge("/api/files/has", { ids });
  assert.equal(originalReads, 0);
  assert.equal(stream.mock.callCount(), 0);
  read.mock.restore();
  stream.mock.restore();
  assert.deepEqual(has, Object.keys(available));
  for (const id of ids) {
    const res = await raw(id),
      text = await res.text();
    assert.equal(res.status, id in available ? 200 : 404, id);
    if (res.ok) assert.equal(text, available[id], id);
  }
});

test("清扫只删过期临时文件，仍在用的 .tmp 原件和目录不动", async t => {
  const { filesHome, bridge, bridgeUpload, raw, disk } = await serveAttachments(t);
  await bridgeUpload("/api/files/put", { record: { id: "keep", kind: "text", name: "真正的附件.tmp" } }, new Blob(["正本"]));
  disk.file("keep.tmp.42.run.tmp", "半截");
  disk.directory("fake.txt.42.run.tmp");
  disk.directory("orphan.txt");
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  for (const name of fs.readdirSync(filesHome)) fs.utimesSync(path.join(filesHome, name), old, old);
  assert.deepEqual(await bridge("/api/files/clean", { keep: ["keep"] }), { removed: 0, bytes: 0 });
  assert.deepEqual(fs.readdirSync(filesHome).sort(), ["fake.txt.42.run.tmp", "keep.json", "keep.tmp", "orphan.txt"]);
  assert.equal(await (await raw("keep")).text(), "正本");
});

test("只有元数据时下载浏览器暂存；对齐补传成功才清，失败则保留", async t => {
  const { filesHome, bridge, bridgeUpload, raw, disk } = await serveAttachments(t);
  for (const id of ["repair", "blocked", "complete"]) disk.meta(id, `${id}.txt`);
  disk.file("repair.txt.42.run.tmp", "未收全");
  disk.directory("blocked.txt");
  disk.file("complete.txt", "磁盘正本");
  const staged = new Map(
      ["repair", "blocked", "complete"].map(id => [id, { id, kind: "text", name: `${id}.txt`, data: `浏览器暂存 ${id}` }])
    ),
    uploads = [],
    clicks = [],
    f = load([
      "downloadAttachment",
      "settleAttachmentStore",
      `setup: (post, upload, browser, click, files) => {
        bridge = post;
        bridgeUpload = upload;
        fileStoreRequest = browser;
        downloadHref = click;
        bootstrap.store = { root: 'test' };
        bootstrap.work = { files };
        chatsLoaded = true;
      }`
    ]);
  f.setup(
    bridge,
    async (url, head, blob) => {
      uploads.push(head.record.id);
      return bridgeUpload(url, head, blob);
    },
    async (_mode, operation) =>
      operation({ getAllKeys: () => [...staged.keys()], get: id => staged.get(id), delete: id => staged.delete(id) }),
    (href, name) => clicks.push({ href, name }),
    filesHome
  );
  await f.downloadAttachment("repair");
  assert.equal(clicks.length, 1);
  const [{ href, name }] = clicks;
  try {
    assert.equal(name, "repair.txt");
    assert.equal(await resolveObjectURL(href).text(), "浏览器暂存 repair");
  } finally {
    URL.revokeObjectURL(href);
  }
  await f.settleAttachmentStore(Promise.resolve(false));
  assert.deepEqual(uploads, ["repair", "blocked"]);
  assert.deepEqual([...staged.keys()], ["blocked"]);
  assert.equal(await (await raw("repair")).text(), "浏览器暂存 repair");
  assert.equal(await (await raw("complete")).text(), "磁盘正本");
  assert.equal((await raw("blocked")).status, 404);
});

for (const at of ["回执", "打开 IndexedDB"]) {
  test(`附件确认期间换根（${at}），不按旧根结果清暂存`, async () => {
    const requests = [],
      removed = [],
      f = load([
        "settleAttachmentStore",
        `setup: (post, browser) => {
          bridge = post;
          fileStoreRequest = browser;
          bootstrap.store = { root: 'old' };
          bootstrap.work = { files: 'old/files' };
          chatsLoaded = true;
        }`,
        `move: () => { bootstrap.store = { root: 'new' }; bootstrap.work = { files: 'new/files' }; }`
      ]);
    f.setup(
      async (url, body) => {
        requests.push([url, body]);
        if (at === "回执") f.move();
        return { has: ["old-raw"] };
      },
      async (mode, action) => {
        await Promise.resolve();
        if (mode === "readwrite" && at === "打开 IndexedDB") f.move();
        return action({ getAllKeys: () => ["old-raw"], delete: id => removed.push(id) });
      }
    );
    await f.settleAttachmentStore(Promise.resolve(false));
    assert.deepEqual(requests, [["/api/files/has", { ids: ["old-raw"], root: "old" }]]);
    assert.deepEqual(removed, []);
  });
}
