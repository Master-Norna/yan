// 检索里那道大文件上限：目录里顺手扫过的按 2 MB 跳过（免得一个目录把桥接拖住），
// 但模型点名把 path 指到某一件时要读得到——结果的提示就是叫它这么做，卡住它等于把那条提示写成死路
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const createFind = createRequire(import.meta.url)("../../server/work/find.js");

function routesFor(root) {
  return createFind({
    failed: error => String(error?.message || error),
    resolveWorkdir: raw => path.resolve(raw || root),
    targetOf: async (workdir, body) => path.resolve(workdir, String(body.path || ".")),
    missingHint: () => "",
    shownPath: (base, full) => path.relative(base, full) || ".",
    strictBox: () => false,
    storeRoot: () => path.join(os.tmpdir(), "yan-no-such-store")
  });
}

test("搜索：目录里跳过的大件，点名把 path 指到它就能搜到", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-find-")),
    routes = routesFor(root),
    server = http.createServer((req, res) => routes[`POST ${req.url.split("?")[0]}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  try {
    // 三 MB：目录里顺手扫时按 2 MB 跳过，点名搜这一件时要读得到
    fs.writeFileSync(path.join(root, "big.log"), `${"x".repeat(1023)}\n`.repeat(3000) + "NEEDLE\n");
    const all = await post("/api/work/search", { workdir: root, query: "NEEDLE" });
    assert.equal(all.matches.length, 0);
    assert.equal(all.large, 1);
    const one = await post("/api/work/search", { workdir: root, path: "big.log", query: "NEEDLE" });
    assert.equal(one.matches.length, 1);
    assert.equal(one.matches[0].line, 3001);
    assert.equal(one.large, undefined);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("搜索：字面快路与命中上限早停，不扫描后面的高耗时正则", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yan-find-")),
    routes = routesFor(root),
    server = http.createServer((req, res) => routes[`POST ${req.url.split("?")[0]}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(r => r.json());
  try {
    fs.writeFileSync(path.join(root, "source.txt"), ["Needle.(", "a".repeat(12000) + "!", "NEEDLE.("].join("\n"));
    const literal = await post("/api/work/search", { workdir: root, query: "needle.(", literal: true, limit: 1 });
    assert.deepEqual(literal.matches.map(hit => hit.line), [1]);
    assert.equal(literal.truncated, true);

    // 已经命中首行时，不能再对第二行运行灾难性回溯的正则分支。
    const regex = await post("/api/work/search", { workdir: root, query: "needle|(?:a+)+$", limit: 1 });
    assert.deepEqual(regex.matches.map(hit => hit.line), [1]);
    assert.equal(regex.truncated, true);

    const fallback = await post("/api/work/search", { workdir: root, query: "needle.(", limit: 2 });
    assert.deepEqual(fallback.matches.map(hit => hit.line), [1, 3]);
    assert.match(fallback.note, /正则无效/);

    const sensitive = await post("/api/work/search", { workdir: root, query: "needle.(", literal: true, caseSensitive: true });
    assert.deepEqual(sensitive.matches.map(hit => hit.line), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
