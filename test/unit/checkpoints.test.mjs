// 桥接的检查点（server/checkpoints.js）：记下目录此刻的样子、对照、退回；不进 .gitignore、.git/info/exclude 与 node_modules；第二回只读变了的；
// 对话删了册跟着删、没人用的对象清掉
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createCheckpoints = createRequire(import.meta.url)("../../server/checkpoints.js");
const { ignoreRule, ignored } = createCheckpoints;

async function serve(home) {
  const points = createCheckpoints({ home: () => home });
  const server = http.createServer((req, res) => points.routes[`POST ${req.url}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(async r => ({
      status: r.status,
      ...(await r.json())
    }));
  return { post, points, close: () => new Promise(resolve => server.close(resolve)) };
}
function tree(dir, rel = "") {
  const out = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const sub = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, tree(path.join(dir, entry.name), sub), { [`${sub}/`]: true });
    else out[sub] = fs.readFileSync(path.join(dir, entry.name), "utf8");
  }
  return out;
}
const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

test("记下、对照、退回：改了的改回、删了的补回、新出的删去（连同新出的空夹），忽略的不动", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-")),
    root = path.join(base, "work"),
    { post, close } = await serve(path.join(base, "检查点"));
  try {
    write(root, "a.txt", "一");
    write(root, "src/b.js", "二");
    write(root, "src/keep/c.md", "三");
    write(root, ".gitignore", "*.log\ndata/\n");
    write(root, ".git/info/exclude", "drafts/\n");
    write(root, "drafts/sketch.png", "草图旧");
    write(root, "run.log", "日志旧");
    write(root, "data/big.bin", "数据旧");
    write(root, "node_modules/x/index.js", "依赖旧");
    const before = tree(root);
    const took = await post("/api/checkpoint/take", { root, conversation: "c1", answer: "m1" });
    assert.equal(took.status, 200, JSON.stringify(took));
    assert.equal(took.files, 4); // a.txt、.gitignore、src/b.js、src/keep/c.md
    // 这一答之后：改、删、新建（带新夹），忽略的几处也动了
    write(root, "a.txt", "改过");
    fs.rmSync(path.join(root, "src/b.js"));
    write(root, "new/deep/d.txt", "新");
    write(root, "src/keep/e.txt", "新件");
    write(root, "run.log", "日志新");
    write(root, "data/big.bin", "数据新");
    write(root, "node_modules/x/index.js", "依赖新");
    write(root, "drafts/sketch.png", "草图新");
    const { changes } = await post("/api/checkpoint/diff", { root, conversation: "c1", answer: "m1" });
    assert.deepEqual(
      changes.map(c => `${c.kind} ${c.path}`),
      ["changed a.txt", "added new/deep/d.txt", "removed src/b.js", "added src/keep/e.txt"]
    );
    const done = await post("/api/checkpoint/restore", { root, conversation: "c1", answer: "m1" });
    assert.deepEqual([done.restored, done.removed, done.failed], [2, 2, []]);
    const after = tree(root);
    assert.equal(after["a.txt"], "一");
    assert.equal(after["src/b.js"], "二");
    assert.equal(after["new/"], undefined, "新出的空夹删去");
    assert.equal(after["src/keep/"], true, "那一刻就有的夹留着");
    // 忽略的照此刻的样子留着
    assert.equal(after["run.log"], "日志新");
    assert.equal(after["data/big.bin"], "数据新");
    assert.equal(after["node_modules/x/index.js"], "依赖新");
    assert.equal(after["drafts/sketch.png"], "草图新", ".git/info/exclude 里写的同 .gitignore");
    for (const rel of Object.keys(before)) if (!/log|data|node_modules|drafts/.test(rel)) assert.equal(after[rel], before[rel], rel);
    assert.deepEqual((await post("/api/checkpoint/diff", { root, conversation: "c1", answer: "m1" })).changes, []);
  } finally {
    await close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("第二回只读变了的；没变的子目录与内容共用对象；对话删了册与独有的对象跟着清", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-")),
    root = path.join(base, "work"),
    home = path.join(base, "检查点"),
    { post, points, close } = await serve(home);
  try {
    for (let i = 0; i < 20; i++) write(root, `lib/${i}.txt`, `件 ${i}`);
    write(root, "main.txt", "第一版");
    assert.equal((await post("/api/checkpoint/take", { root, conversation: "c1", answer: "m1" })).read, 21);
    const objects = () => fs.readdirSync(home, { recursive: true }).filter(name => /对象[\\/][0-9a-f]{2}[\\/]/.test(name)).length;
    const first = objects();
    write(root, "main.txt", "第二版");
    const second = await post("/api/checkpoint/take", { root, conversation: "c2", answer: "m2" });
    assert.equal(second.read, 1, "只读了改过的那一件");
    assert.equal(objects(), first + 2, "多出新内容与新的根目录对象，lib 的子树共用");
    // 退回到 c1 那一刻：main.txt 回到第一版
    await post("/api/checkpoint/restore", { root, conversation: "c1", answer: "m1" });
    assert.equal(fs.readFileSync(path.join(root, "main.txt"), "utf8"), "第一版");
    // 删 c2：它独有的「第二版」与它的根目录对象清掉，c1 的照旧退得回
    await points.dropConversation("c2");
    assert.equal(objects(), first);
    write(root, "main.txt", "乱改");
    await post("/api/checkpoint/restore", { root, conversation: "c1", answer: "m1" });
    assert.equal(fs.readFileSync(path.join(root, "main.txt"), "utf8"), "第一版");
    const gone = await post("/api/checkpoint/diff", { root, conversation: "c2", answer: "m2" });
    assert.equal(gone.status, 400);
  } finally {
    await close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("存储根在目录里头时不记它；目录不在、id 不对的报错", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-")),
    points = createCheckpoints({ home: () => path.join(base, ".yan", "检查点"), skip: () => [path.join(base, ".yan")] });
  const server = http.createServer((req, res) => points.routes[`POST ${req.url}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(async r => ({
      status: r.status,
      ...(await r.json())
    }));
  try {
    write(base, "a.txt", "一");
    write(base, ".yan/对话/x.json", "{}");
    assert.equal((await post("/api/checkpoint/take", { root: base, conversation: "c1", answer: "m1" })).files, 1);
    write(base, ".yan/对话/y.json", "{}");
    assert.deepEqual((await post("/api/checkpoint/diff", { root: base, conversation: "c1", answer: "m1" })).changes, []);
    assert.equal((await post("/api/checkpoint/take", { root: path.join(base, "没有"), conversation: "c1", answer: "m1" })).status, 400);
    assert.equal((await post("/api/checkpoint/take", { root: base, conversation: "../x", answer: "" })).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test(".gitignore：取反、只管目录、带 / 的从所在层算起、**", () => {
  const rules = ["*.log", "!keep.log", "build/", "/top.txt", "docs/**/*.tmp", "a?c"].map(line => ignoreRule(line, ""));
  assert.equal(ignored(rules, "x/y.log", false), true);
  assert.equal(ignored(rules, "x/keep.log", false), false);
  assert.equal(ignored(rules, "pkg/build", true), true);
  assert.equal(ignored(rules, "pkg/build", false), false, "末尾 / 只管目录");
  assert.equal(ignored(rules, "top.txt", false), true);
  assert.equal(ignored(rules, "sub/top.txt", false), false, "开头 / 只认这一层");
  assert.equal(ignored(rules, "docs/a/b/c.tmp", false), true);
  assert.equal(ignored(rules, "abc", false), true);
  // 下层 .gitignore 的规则从它所在的那一层算起
  const nested = [ignoreRule("/only.txt", "sub")];
  assert.equal(ignored(nested, "sub/only.txt", false), true);
  assert.equal(ignored(nested, "only.txt", false), false);
});
