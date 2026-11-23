// 工作区检索：字面搜索不进 VM；达到全局上限后不再碰文件后面的昂贵正则。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createFind = createRequire(import.meta.url)("../../server/work/find.js");

test("检索字面、无效正则回退与命中上限；正则不再扫描达到上限后的行", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-find-fast-"));
  const routes = createFind({
    failed: error => String(error?.message || error),
    resolveWorkdir: raw => path.resolve(raw || root),
    targetOf: async (workdir, body) => path.resolve(workdir, String(body.path || ".")),
    missingHint: () => "",
    shownPath: (base, full) => path.relative(base, full) || ".",
    strictBox: () => false,
    storeRoot: () => path.join(os.tmpdir(), "yan-no-such-store")
  });
  const server = http.createServer((req, res) => routes["POST " + req.url](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = body =>
    fetch("http://127.0.0.1:" + server.address().port + "/api/work/search", {
      method: "POST",
      body: JSON.stringify({ workdir: root, ...body })
    }).then(r => r.json());
  try {
    fs.writeFileSync(path.join(root, "source.txt"), ["Needle.(", "a".repeat(12000) + "!", "NEEDLE.("].join("\n"));
    const literal = await post({ query: "needle.(", literal: true, limit: 1 });
    assert.deepEqual(literal.matches.map(hit => hit.line), [1]);
    assert.equal(literal.truncated, true);

    // 原实现会在已经命中首行后，对第二行运行灾难性回溯的分支直至 2 秒超时。
    const regex = await post({ query: "needle|(?:a+)+$", limit: 1 });
    assert.deepEqual(regex.matches.map(hit => hit.line), [1]);
    assert.equal(regex.truncated, true);

    const fallback = await post({ query: "needle.(", limit: 2 });
    assert.deepEqual(fallback.matches.map(hit => hit.line), [1, 3]);
    assert.match(fallback.note, /正则无效/);

    const sensitive = await post({ query: "needle.(", literal: true, caseSensitive: true });
    assert.deepEqual(sensitive.matches.map(hit => hit.line), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
