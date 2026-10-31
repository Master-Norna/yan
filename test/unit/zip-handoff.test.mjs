import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { crc32 } from "node:zlib";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";
const require = createRequire(import.meta.url),
  createFiles = require("../../server/files.js"),
  createWork = require("../../server/work/index.js");

test("压缩包在最新一问和历史中都交付本机路径，不再向模型接口发送整包", async () => {
  const calls = [],
    f = load(["messageForApi", "setup:fn=>{bridge=fn;getAttachment=()=>{throw Error('不该读取整包');};}"]);
  f.setup(async (route, body) => {
    calls.push([route, body.id]);
    if (body.id === "missing") throw Error("原件不存在");
    return { path: "C:\\言存储\\附件\\zip1.zip" };
  });
  const message = { role: "user", content: "读一下", attachments: [{ id: "zip1", name: "项目.zip", kind: "file", size: 256 }] };
  for (const latest of [true, false]) {
    const entry = await f.messageForApi(message, latest),
      text = entry.content.map(part => part.text).join("\n");
    assert.ok(entry.content.every(part => part.type === "text"));
    assert.match(text, /C:\\言存储\\附件\\zip1\.zip/);
    assert.match(text, /run_command/);
    assert.doesNotMatch(text, /原件已不在上下文/);
  }
  message.attachments[0].id = "missing";
  assert.match(JSON.stringify(await f.messageForApi(message, true)), /暂不可用.*原件不存在/);
  assert.deepEqual(calls, [
    ["/api/files/path", "zip1"],
    ["/api/files/path", "zip1"],
    ["/api/files/path", "missing"]
  ]);
});

// 一件可由系统解包的 ZIP：本地头、内容、中央目录、目录结束。
function zipSample() {
  const label = Buffer.from("hello.txt"),
    data = Buffer.from("zip-local-ok"),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22),
    crc = crc32(data);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(label.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(label.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + label.length, 12);
  end.writeUInt32LE(local.length + label.length + data.length, 16);
  return Buffer.concat([local, label, data, central, label, end]);
}

test("真实上传 ZIP 后可定位原件，并在严格沙箱中复制、解压、读取", { timeout: 20000 }, async () => {
  const parent = fs.realpathSync(os.tmpdir()),
    root = fs.mkdtempSync(path.join(parent, "yan-zip-handoff-")),
    originals = path.join(root, "附件"),
    workdir = path.join(root, "work");
  fs.mkdirSync(workdir);
  const files = createFiles({ filesHome: () => originals }),
    work = createWork({ archiveHome: () => workdir, workHome: () => workdir, toolEnv: env => env }),
    routes = { ...files.routes, ...work.routes },
    server = http.createServer((req, res) => routes[`${req.method} ${req.url.split("?")[0]}`](req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const post = async (route, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    assert.equal(res.status, 200, JSON.stringify(result));
    return result;
  };
  try {
    const bytes = zipSample();
    const head = Buffer.from(JSON.stringify({ record: { id: "zip-local", kind: "file", name: "项目.zip" } }));
    const put = await fetch(`http://127.0.0.1:${server.address().port}/api/files/put?head=${head.length}`, {
      method: "POST",
      body: Buffer.concat([head, bytes])
    });
    assert.equal(put.status, 200, await put.text());
    const original = await post("/api/files/path", { id: "zip-local" });
    assert.deepEqual(fs.readFileSync(original.path), bytes);
    const quoted = `'${original.path.replaceAll("'", "'\\''")}'`,
      command =
        process.platform === "win32"
          ? `Copy-Item -LiteralPath '${original.path.replaceAll("'", "''")}' -Destination input.zip; Expand-Archive -LiteralPath input.zip -DestinationPath extracted; Get-Content extracted/hello.txt`
          : `cp ${quoted} input.zip; unzip -q input.zip -d extracted; cat extracted/hello.txt`;
    const result = await post("/api/work/run", { workdir, command, sandbox: true, permission: "ask" });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
    assert.match(result.stdout, /zip-local-ok/);
    assert.deepEqual(fs.readFileSync(original.path), bytes);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (path.dirname(fs.realpathSync(root)) !== parent || !path.basename(root).startsWith("yan-zip-handoff-")) throw Error("测试清理越界");
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
});
