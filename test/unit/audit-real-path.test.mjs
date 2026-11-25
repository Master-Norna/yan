import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import createWork from "../../server/work/index.js";

test("文件工具不经目录链接触及机密文件或存储配置", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-real-"));
  const store = path.join(root, "store"), hidden = path.join(root, ".hidden");
  fs.mkdirSync(store); fs.mkdirSync(hidden);
  fs.writeFileSync(path.join(hidden, ".env"), "dummy");
  fs.writeFileSync(path.join(hidden, "public.txt"), "public");
  fs.writeFileSync(path.join(store, "配置.json"), "{}");
  const server = http.createServer((req, res) => work.routes[`POST ${req.url}`](req, res));
  const work = createWork({ archiveHome: () => root, workHome: () => root, storeRoot: () => store, toolEnv: env => env });
  try {
    fs.symlinkSync(hidden, path.join(root, "alias"), "junction");
    fs.symlinkSync(store, path.join(root, "storage-alias"), "junction");
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const read = (p, sandbox) => fetch(`http://127.0.0.1:${server.address().port}/api/work/read`, {method:"POST",body:JSON.stringify({workdir:root,path:p,sandbox})});
    assert.notEqual((await read("alias/.env", true)).status, 200);
    assert.notEqual((await read("storage-alias/配置.json", false)).status, 200);
    assert.equal((await read("alias/public.txt", true)).status, 200);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
