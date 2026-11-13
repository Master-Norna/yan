// 桥接的检查点（server/checkpoints.js）：记下目录此刻的样子、对照、退回；不进 .gitignore、.git/info/exclude 与 node_modules，改了忽略规则也不删它们；第二回只读变了的；
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

test(".gitignore 写着 .yan/ 时，意仍进快照、跟着退回；同目录的日志与探针不搬进去", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-")),
    root = path.join(base, "work"),
    { post, close } = await serve(path.join(base, "检查点")),
    key = { root, conversation: "c1", answer: "m1" };
  try {
    write(root, ".gitignore", ".yan/\n");
    write(root, "src/a.js", "代码");
    write(root, ".yan/意.json", '{"root":"第一版"}');
    write(root, ".yan/记忆.md", "目录记忆");
    write(root, ".yan/检查探针/run-all.ps1", "探针");
    write(root, ".yan/全面检查.log", "日志");
    const took = await post("/api/checkpoint/take", key);
    assert.equal(took.status, 200, JSON.stringify(took));
    assert.equal(took.files, 3, "只收 .gitignore、src/a.js 与 .yan/意.json");
    // 这一答改了意；.yan 下没进快照的几件也跟着变了、还多出一件
    write(root, ".yan/意.json", '{"root":"第二版"}');
    write(root, ".yan/记忆.md", "改过的记忆");
    write(root, ".yan/检查探针/run-all.ps1", "改过的探针");
    write(root, ".yan/新日志.log", "新");
    const { changes } = await post("/api/checkpoint/diff", key);
    assert.deepEqual(
      changes.map(c => `${c.kind} ${c.path}`),
      ["changed .yan/意.json"],
      "确认窗只列意这一件"
    );
    const done = await post("/api/checkpoint/restore", key);
    assert.deepEqual([done.restored, done.removed, done.failed], [1, 0, []]);
    assert.equal(fs.readFileSync(path.join(root, ".yan/意.json"), "utf8"), '{"root":"第一版"}', "意跟着退回");
    // .yan 下没进快照的照此刻的样子留着：改了的不改回、新出的不删
    assert.equal(fs.readFileSync(path.join(root, ".yan/记忆.md"), "utf8"), "改过的记忆");
    assert.equal(fs.readFileSync(path.join(root, ".yan/检查探针/run-all.ps1"), "utf8"), "改过的探针");
    assert.equal(fs.readFileSync(path.join(root, ".yan/新日志.log"), "utf8"), "新");
    assert.equal(fs.readFileSync(path.join(root, "src/a.js"), "utf8"), "代码");
    assert.deepEqual((await post("/api/checkpoint/diff", key)).changes, []);
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

test("夹换成链接、文件换成夹、空夹建删：退回不越出目录、不留临时文件", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-")),
    root = path.join(base, "work"),
    outside = path.join(base, "outside"),
    { post, close } = await serve(path.join(base, "检查点"));
  const key = { root, conversation: "c1", answer: "m1" };
  try {
    write(root, "sub/f.txt", "原件");
    write(root, "file", "原文件");
    fs.mkdirSync(path.join(root, "empty"));
    write(outside, "f.txt", "外头的");
    await post("/api/checkpoint/take", key);
    // sub 换成指向目录之外的联接；file 换成夹；empty 删了，另建一个空夹
    fs.rmSync(path.join(root, "sub"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, "sub"), "junction");
    fs.rmSync(path.join(root, "file"));
    write(root, "file/inner.txt", "夹里的");
    fs.rmdirSync(path.join(root, "empty"));
    fs.mkdirSync(path.join(root, "fresh"));
    const { changes } = await post("/api/checkpoint/diff", key);
    assert.deepEqual(
      changes.map(c => `${c.kind} ${c.path}`),
      ["removed empty/", "removed file", "added file/inner.txt", "added fresh/", "removed sub/f.txt"]
    );
    const done = await post("/api/checkpoint/restore", key);
    assert.deepEqual(done.failed, []);
    assert.equal(fs.readFileSync(path.join(outside, "f.txt"), "utf8"), "外头的", "没顺着联接写到目录之外");
    assert.equal(fs.lstatSync(path.join(root, "sub")).isSymbolicLink(), false);
    const after = tree(root);
    assert.equal(after["sub/f.txt"], "原件");
    assert.equal(after["file"], "原文件");
    assert.equal(after["empty/"], true);
    assert.equal(after["fresh/"], undefined);
    assert.deepEqual(
      Object.keys(after).filter(name => name.includes(".tmp")),
      []
    );
    assert.deepEqual((await post("/api/checkpoint/diff", key)).changes, []);
  } finally {
    await close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("这一答动了忽略规则：那一刻忽略的文件露出来也不算新加的，退回不删", async () => {
  const cases = {
    "改了 .gitignore": root => write(root, ".gitignore", "*.log\n"),
    "删了 .gitignore": root => fs.rmSync(path.join(root, ".gitignore")),
    "清了 .git/info/exclude": root => write(root, ".git/info/exclude", ""),
    "删了子目录的 .gitignore": root => fs.rmSync(path.join(root, "sub/.gitignore"))
  };
  for (const [name, change] of Object.entries(cases)) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-")),
      root = path.join(base, "work"),
      { post, close } = await serve(path.join(base, "检查点")),
      key = { root, conversation: "c1", answer: "m1" };
    try {
      write(root, ".gitignore", ".env\ndata/\n");
      write(root, ".git/info/exclude", "local.db\n");
      write(root, "sub/.gitignore", "*.bin\n");
      write(root, ".env", "KEY=1");
      write(root, "data/deep/train.csv", "1,2");
      write(root, "local.db", "库");
      write(root, "sub/w.bin", "权重");
      await post("/api/checkpoint/take", key);
      change(root);
      write(root, "new.txt", "真新加的");
      const { changes } = await post("/api/checkpoint/diff", key);
      assert.deepEqual(
        changes.map(c => c.path).filter(rel => /\.env|train\.csv|local\.db|w\.bin/.test(rel)),
        [],
        `${name}：确认窗不列它们`
      );
      const done = await post("/api/checkpoint/restore", key);
      assert.deepEqual(done.failed, [], name);
      const after = tree(root);
      assert.equal(after[".env"], "KEY=1", name);
      assert.equal(after["data/deep/train.csv"], "1,2", name);
      assert.equal(after["local.db"], "库", name);
      assert.equal(after["sub/w.bin"], "权重", name);
      assert.equal(after["new.txt"], undefined, `${name}：真新加的照删`);
      assert.equal(after[".gitignore"], ".env\ndata/\n", `${name}：规则本身退回`);
    } finally {
      await close();
      fs.rmSync(base, { recursive: true, force: true });
    }
  }
});

// 不变量：随机改一通（增删改、改名、夹换文件、动忽略规则）再退回，
// 那一刻记下的字节不差；这一答没碰过的（连同被忽略的）原样还在；新加的（不算那一刻起就被忽略的）删去。
// 这一答新加、又被它新写的规则盖住的文件看不见，退回时留着（占了记下那件的路就报一笔「没能动」）：不伤数据，这里不造这种情形，
// 所以 docs/ 下不把文件换成夹——规则可能换成 docs/
test("不变量：随机改动后退回，记下的回原样、没碰的不动、新加的删去", async () => {
  const random = seed => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-")),
    { post, close } = await serve(path.join(base, "检查点"));
  try {
    for (let seed = 1; seed <= 40; seed++) {
      const roll = random(seed),
        pick = list => list[Math.floor(roll() * list.length)],
        chance = rate => roll() < rate,
        root = path.join(base, `work-${seed}`),
        key = { root, conversation: `c${seed}`, answer: "m1" },
        tag = `种子 ${seed}`;
      write(root, ".gitignore", "*.log\n.env\ndata/\n");
      write(root, ".git/info/exclude", "local.db\ndrafts/\n");
      write(root, "sub/.gitignore", "*.bin\n");
      const kept = [".env", "local.db", "run.log", "data/train.csv", "data/deep/a.csv", "drafts/d.md", "sub/w.bin", "sub/x.log"],
        tracked = ["a.txt", "b.txt", "src/c.js", "src/deep/d.js", "docs/e.md", "docs/f.md", "sub/g.txt"];
      for (const rel of [...kept, ...tracked]) write(root, rel, `原 ${rel} ${seed}`);
      const before = tree(root);
      await post("/api/checkpoint/take", key);
      // 被忽略的挑几件也动一动：动过的不再要求原样
      const touched = new Set(),
        added = [];
      for (const rel of kept)
        if (chance(0.2)) {
          touched.add(rel);
          if (chance(0.5)) write(root, rel, `改 ${rel}`);
          else fs.rmSync(path.join(root, rel));
        }
      const alive = new Set(tracked);
      const rounds = 3 + Math.floor(roll() * 12);
      for (let i = 0; i < rounds; i++) {
        const rel = alive.size ? pick([...alive]) : "",
          fresh = `new-${i}${pick(["", "/x", "/y/z"])}.txt`;
        switch (rel ? Math.floor(roll() * 5) : 0) {
          case 0:
            write(root, fresh, "新");
            added.push(fresh);
            break;
          case 1:
            write(root, rel, "改过");
            break;
          case 2:
            fs.rmSync(path.join(root, rel));
            alive.delete(rel);
            break;
          case 3:
            fs.renameSync(path.join(root, rel), path.join(root, `moved-${i}.txt`));
            alive.delete(rel);
            added.push(`moved-${i}.txt`);
            break;
          case 4:
            if (rel.startsWith("docs/")) break;
            fs.rmSync(path.join(root, rel));
            alive.delete(rel);
            write(root, `${rel}/inner.txt`, "文件换成了夹");
            added.push(`${rel}/inner.txt`);
            break;
        }
      }
      // 动忽略规则：放开、换掉、删去，也有把记下的文件盖住的（docs/ 退回时仍要回原样）
      const rules = pick([
        () => {},
        () => fs.rmSync(path.join(root, ".gitignore")),
        () => write(root, ".gitignore", "*.tmpx\n"),
        () => write(root, ".gitignore", "docs/\n"),
        () => write(root, ".git/info/exclude", ""),
        () => fs.rmSync(path.join(root, "sub/.gitignore"), { force: true })
      ]);
      rules();
      const done = await post("/api/checkpoint/restore", key);
      assert.deepEqual(done.failed, [], tag);
      const after = tree(root);
      for (const rel of tracked) assert.equal(after[rel], before[rel], `${tag}：记下的 ${rel} 回原样`);
      for (const rel of [".gitignore", "sub/.gitignore"]) assert.equal(after[rel], before[rel], `${tag}：规则 ${rel} 回原样`);
      for (const rel of kept) if (!touched.has(rel)) assert.equal(after[rel], before[rel], `${tag}：没碰的 ${rel} 不动`);
      for (const rel of added) assert.equal(after[rel], undefined, `${tag}：新加的 ${rel} 删去`);
      fs.rmSync(root, { recursive: true, force: true });
    }
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

test("工作目录就是存储根时：整棵都不记，不把检查点自己照进快照", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-point-self-")),
    root = path.join(base, "root"),
    points = createCheckpoints({ home: () => path.join(root, "检查点"), skip: () => [root] });
  const server = http.createServer((req, res) => points.routes[`POST ${req.url}`](req, res)).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = (route, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) }).then(async r => ({
      status: r.status,
      ...(await r.json())
    }));
  try {
    write(root, "配置.json", '{"apiKey":"sk"}');
    write(root, "对话/a.json", "{}");
    const took = await post("/api/checkpoint/take", { root, conversation: "c1", answer: "m1" });
    assert.equal(took.status, 200, JSON.stringify(took));
    assert.equal(took.files, 0, "存储根本身在跳过之列：浏览的起点就是它，整棵都不记");
    assert.deepEqual((await post("/api/checkpoint/diff", { root, conversation: "c1", answer: "m1" })).changes, []);
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
