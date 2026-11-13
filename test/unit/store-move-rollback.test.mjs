// 换存储根：建新处的目录、或写位置条子失败时，根要退回旧处（见 server/store.js 的 handleMove）。
// 从前 root = next 之后才 ensureRoot()，一失败根就停在新处，而这段会话里配置、对话、卷宗一个在新处一个在旧处
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const createStore = createRequire(import.meta.url)("../../server/store.js");

function writeConfig(root, name) {
  fs.writeFileSync(path.join(root, "配置.json"), JSON.stringify({ 言: "配置", name, savedAt: 1 }, null, 1));
}

async function serve(store) {
  const server = http
    .createServer((req, res) => {
      const route = store.routes[`POST ${new URL(req.url, "http://127.0.0.1").pathname}`];
      if (route) route(req, res);
      else {
        res.writeHead(404);
        res.end();
      }
    })
    .listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const post = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: "POST", body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { post, close: () => new Promise(resolve => server.close(resolve)) };
}

// 用 YAN_HOME 指定旧根：既不碰真在用的 ~/.yan，也不写位置条子（见 server/store.js 的 initialRoot 与 writePointer）
// options 透传给 createStore：换位置的另一道门槛（后台指令在跑）要能单独演出来
async function withStore(run, options = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-store-move-")),
    home = path.join(base, "旧处"),
    saved = process.env.YAN_HOME;
  process.env.YAN_HOME = home;
  fs.mkdirSync(home, { recursive: true });
  let close = async () => {};
  try {
    const store = createStore({ working: () => 0, ...options });
    store.ensureRoot();
    writeConfig(home, "旧处那份");
    const served = await serve(store);
    close = served.close;
    await run({ store, base, home, post: served.post });
  } finally {
    await close();
    if (saved === undefined) delete process.env.YAN_HOME;
    else process.env.YAN_HOME = saved;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test("新处建不出目录时：抛错之后根还是旧根，接着写的东西落回旧处", async () => {
  await withStore(async ({ store, base, home, post }) => {
    const before = store.describe();
    assert.equal(before.root, home);
    // 新处：已经有一份言的数据（走「那里已有，直接沿用」那一路，不拷），但「卷宗」这个名字被一个文件占着，
    // 于是回到旧代码里 root = next 之后才做的 ensureRoot() 一准失败
    const parent = path.join(base, "新处"),
      next = path.join(parent, ".yan");
    fs.mkdirSync(next, { recursive: true });
    writeConfig(next, "新处那份");
    fs.writeFileSync(path.join(next, "卷宗"), "占着这个名字的文件");
    const moved = await post("/api/store/move", { parent });
    assert.equal(moved.status, 400);
    assert.match(moved.data.error, /存储位置未能更换/);
    const after = store.describe();
    assert.equal(after.root, before.root, "失败之后根退回旧处");
    assert.equal(after.config, before.config, "配置仍在旧处");
    assert.equal(after.chats, before.chats, "对话仍在旧处");
    assert.equal(after.archive, before.archive, "卷宗仍在旧处");
    // 后续照常读写：配置写进旧处，新处那份原样没动
    const saved = await post("/api/store/config/save", { config: { name: "搬失败之后写的" } });
    assert.equal(saved.status, 200);
    assert.match(fs.readFileSync(path.join(home, "配置.json"), "utf8"), /搬失败之后写的/);
    assert.match(fs.readFileSync(path.join(next, "配置.json"), "utf8"), /新处那份/);
    // 退回之后还能照常换到别处
    const other = path.join(base, "另一处"),
      second = await post("/api/store/move", { parent: other });
    assert.equal(second.status, 200);
    assert.equal(second.data.moved, true);
    assert.equal(store.describe().root, path.join(other, ".yan"));
  });
});

test("后台指令在跑时不换位置，结束了照常换", async () => {
  // 复现过的样子：主答已收尾（没有作答租约）、后台指令照跑，迁移被放行；拷过去 5 行，之后它继续往旧处写，新处永远停在 5 行
  let running = true;
  await withStore(
    async ({ store, base, home, post }) => {
      const parent = path.join(base, "新处"),
        blocked = await post("/api/store/move", { parent });
      assert.equal(blocked.status, 400);
      assert.match(blocked.data.error, /后台指令还在跑/);
      assert.equal(store.describe().root, home, "根没有换");
      assert.equal(fs.existsSync(path.join(parent, ".yan")), false, "新处没有建出来");
      running = false; // 后台结束了，这一道门放开
      const moved = await post("/api/store/move", { parent });
      assert.equal(moved.status, 200);
      assert.equal(moved.data.moved, true);
      assert.equal(store.describe().root, path.join(parent, ".yan"));
    },
    { background: () => running }
  );
});

test("换根成功：根换到新处，旧处那份拷过去，新处建起对话与卷宗", async () => {
  await withStore(async ({ store, base, home, post }) => {
    const parent = path.join(base, "新处"),
      next = path.join(parent, ".yan"),
      moved = await post("/api/store/move", { parent });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.moved, true);
    assert.equal(moved.data.adopted, false, "那里还没有言的数据，是拷过去的");
    assert.equal(moved.data.previous, home);
    assert.equal(moved.data.root, next);
    assert.equal(store.describe().root, next);
    assert.ok(fs.existsSync(path.join(next, "对话")), "新处的对话目录建起来了");
    assert.ok(fs.existsSync(path.join(next, "卷宗")), "新处的卷宗目录建起来了");
    assert.match(fs.readFileSync(path.join(next, "配置.json"), "utf8"), /旧处那份/, "旧处那份拷了过去");
    // 旧处原样留着（可自行删去）
    assert.match(fs.readFileSync(path.join(home, "配置.json"), "utf8"), /旧处那份/);
  });
});
