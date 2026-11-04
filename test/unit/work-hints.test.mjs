// 文件工具出错时给的线索与替模型圆过的几处：路径不对时同名的在哪、old 对不上时文件里最像的一段、
// 搜索的 path 给的是文件就搜这一件、正则写不成按字面搜
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");
const { nearestPassage } = require("../../server/work/text.js");

const root = path.resolve("test/.tmp/work-hints");
rmSync(root, { recursive: true, force: true });
mkdirSync(path.join(root, "src/pkg"), { recursive: true });
writeFileSync(
  path.join(root, "src/pkg/raft.py"),
  "def a():\n    x = 1\n    return x\n\ndef on_vote(self, term):\n    self.bump(term)\n    if self.term != term:\n        return -1\n    return 0\n"
);
writeFileSync(path.join(root, "src/app.js"), "fetch(url(base));\nconst y = 2;\n");
after(() => rmSync(root, { recursive: true, force: true }));
const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
async function call(route, body) {
  const req = Readable.from([Buffer.from(JSON.stringify({ workdir: root, ...body }))]);
  let status = 0,
    text = "";
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    on() {},
    writeHead(code) {
      status = code;
      this.headersSent = true;
    },
    end(chunk) {
      text = String(chunk || "");
      this.writableEnded = true;
    }
  };
  await work.routes[`POST /api/work/${route}`](req, res);
  return { status, data: JSON.parse(text || "{}") };
}

test("读一件不存在的：说同名的在哪", async () => {
  const { status, data } = await call("read", { path: "pkg/raft.py" });
  assert.equal(status, 400);
  assert.match(data.error, /文件不存在：pkg\/raft\.py；同名的在：src[\/]pkg[\/]raft\.py/);
});
test("没有同名的：列出还在的最近一层", async () => {
  const { data } = await call("read", { path: "src/nope/x.py" });
  assert.match(data.error, /src\/ 下有：app\.js、pkg\//);
});
test("搜索的 path 给的是文件：就搜这一件", async () => {
  const { status, data } = await call("search", { path: "src/pkg/raft.py", query: "return" });
  assert.equal(status, 200);
  assert.equal(data.matches.length, 3);
});
test("正则写不成：按字面搜，并说一声", async () => {
  const { data } = await call("search", { query: "url(" });
  assert.match(data.note, /正则无效/);
  assert.equal(data.matches.length, 1);
});
test("edit 的 old 对不上：附上文件里最像的那一段", async () => {
  const { status, data } = await call("edit", {
    path: "src/pkg/raft.py",
    old: "def on_vote(self, term):\n    self.bump(term)\n    if self.term != term:\n        return\n",
    new: "x"
  });
  assert.equal(status, 400);
  assert.match(data.error, /最像的一段/);
  assert.match(data.error, /8│        return -1/);
});
test("nearestPassage：只对上一行短行的不算像", () => {
  assert.equal(nearestPassage("a\nelse:\nb\n", "if x:\n    y\nelse:\n    z"), "");
  assert.match(nearestPassage("one\ntwo three four\nfive\n", "two three four"), /2│two three four/);
});
test("nearestPassage：满文件重复行也不退化（同步运算，慢了卡住整个桥接）", () => {
  const source = Array(200000).fill("  },").join("\n"),
    started = Date.now();
  assert.equal(nearestPassage(source, "nothing here to match\nanother line here\n"), "");
  // 逐次复制数组时这一档要一分多钟；线性只要几十毫秒，这里留足余量
  assert.ok(Date.now() - started < 5000, `${Date.now() - started} ms`);
});
