// 卷宗根不存在时：只有确实要往里放东西的（新建夹、收入）才建它，查看、下载这类读的请求不留下任何东西
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createArchive = createRequire(import.meta.url)("../../server/work/archive.js");

test("读的请求不建卷宗根，新建夹才建", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-archive-root-")),
    routes = createArchive({ archiveHome: () => path.join(base, "默认"), playable: async (_req, file) => file }),
    server = http
      .createServer((req, res) => routes[`${req.method} ${new URL(req.url, "http://x").pathname}`](req, res))
      .listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const at = `http://127.0.0.1:${server.address().port}`,
    post = (route, body) =>
      fetch(`${at}${route}`, { method: "POST", body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
  try {
    const root = path.join(base, "没有", "卷宗");
    const got = await fetch(`${at}/api/archive/file?root=${encodeURIComponent(root)}&path=x.docx`);
    assert.equal(got.status, 404);
    assert.equal(fs.existsSync(path.join(base, "没有")), false, "问一声在不在，不建目录");

    const listed = await post("/api/archive/list", { root });
    assert.equal(listed.status, 200);
    assert.deepEqual([listed.entries, listed.dirs], [[], []], "没有的根列出来是空的");

    await post("/api/archive/clean", { root });
    for (const route of ["open", "remove", "move"]) {
      const refused = await post(`/api/archive/${route}`, { root, path: "x.docx", name: "y.docx" });
      assert.equal(refused.status, 400, route);
    }
    assert.equal(fs.existsSync(path.join(base, "没有")), false, "清、开、删、挪都不建");
    assert.equal(fs.existsSync(path.join(base, "默认")), false, "没给根时的默认处也一样");

    const made = await post("/api/archive/mkdir", { root, name: "新夹" });
    assert.equal(made.status, 200, JSON.stringify(made));
    assert.equal(fs.statSync(path.join(root, "新夹")).isDirectory(), true, "新建夹时根连带建好");

    // 根的位置被文件占了：读的请求照样报明白
    fs.writeFileSync(path.join(base, "占位"), "");
    assert.match((await post("/api/archive/list", { root: path.join(base, "占位") })).error, /被文件占用/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  }
});
