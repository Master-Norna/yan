// 位置条子（系统数据目录里的 位置.json）：搬家的提交点与旧版 %APPDATA% 残留条子的回归（见 server/store.js 的 writePointer）。
// 从前新条子写成之后才删旧条子，旧条子删不掉会让搬家报失败、运行中的根退回旧处，可条子已经指向新处——重启后根对不上。
// store.js 与本测试共享 node:fs / node:os 模块对象：临时劫持方法注入文件系统异常（不靠 chmod——测试可能以 root 跑），
// 也不碰真在用的 ~/.yan 与 %APPDATA%：os.homedir 指到临时家目录，YAN_HOME 全程不设（设了就不写条子，见 writePointer 的调用处）
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url),
  STORE_PATH = require.resolve("../../server/store.js");

// 条子落位与 server/store.js 同源：非 Windows 在系统配置目录（macOS 为 ~/Library/Application Support），
// 早前版本误写在 ~/AppData/Roaming；Windows 只认 %APPDATA%
function pointerPaths(home, platform) {
  const POINTER_DIR =
    platform === "win32"
      ? process.env.APPDATA || path.join(home, "AppData", "Roaming")
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return {
    HOME_ROOT: path.join(home, ".yan"),
    POINTER: path.join(POINTER_DIR, "言", "位置.json"),
    LEGACY_POINTER: platform === "win32" ? "" : path.join(home, "AppData", "Roaming", "言", "位置.json")
  };
}

function writeConfig(root, name) {
  fs.writeFileSync(path.join(root, "配置.json"), JSON.stringify({ 言: "配置", name, savedAt: 1 }, null, 1));
}
function writePointerFile(file, root) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ 言: "位置", root }, null, 1));
}
const pointerRoot = file => JSON.parse(fs.readFileSync(file, "utf8")).root;

// 换平台要重新 require：WIN/MAC 是 store.js 的模块级常量，require 时定死
async function withSandbox(platform, run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "yan-store-pointer-")),
    home = path.join(base, "home"),
    savedPlatform = Object.getOwnPropertyDescriptor(process, "platform"),
    savedHomedir = os.homedir,
    savedEnv = {
      YAN_HOME: process.env.YAN_HOME,
      APPDATA: process.env.APPDATA,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME
    };
  delete process.env.YAN_HOME;
  delete process.env.XDG_CONFIG_HOME;
  if (platform === "win32") process.env.APPDATA = path.join(base, "appdata");
  else delete process.env.APPDATA;
  Object.defineProperty(process, "platform", { ...savedPlatform, value: platform });
  os.homedir = () => home;
  fs.mkdirSync(home, { recursive: true });
  // 重新初始化 = 清缓存重新 require 再建 store，initialRoot 重读条子
  const loadStore = () => {
    delete require.cache[STORE_PATH];
    return require(STORE_PATH);
  };
  try {
    await run({ base, home, loadStore });
  } finally {
    Object.defineProperty(process, "platform", savedPlatform);
    os.homedir = savedHomedir;
    for (const key of ["YAN_HOME", "APPDATA", "XDG_CONFIG_HOME"]) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
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

// 临时劫持 fs 的一个方法：fn 收到原方法、返回替身；返回值是还原函数
function patchFs(name, fn) {
  const original = fs[name];
  fs[name] = fn(original);
  return () => {
    fs[name] = original;
  };
}

// 旧条子（可读但删不掉，比如父目录只读）：清理是兼容性收尾，失败不翻搬家的结果；
// 新条子已提交，重启后 POINTER 优先于残留的旧条子，根与运行中一致
for (const platform of ["darwin", "linux"])
  test(`旧条子删不掉：搬家照样成功，重启后根与运行中一致（${platform}）`, async () => {
    await withSandbox(platform, async ({ base, home, loadStore }) => {
      const p = pointerPaths(home, platform),
        oldRoot = path.join(base, "旧根"),
        next = path.join(base, "新处", ".yan");
      fs.mkdirSync(oldRoot, { recursive: true });
      writeConfig(oldRoot, "旧根那份");
      // 只有早前版本误写的旧条子：initialRoot 落到它指的地方
      writePointerFile(p.LEGACY_POINTER, oldRoot);
      const store = loadStore()();
      store.ensureRoot();
      assert.equal(store.paths().root, oldRoot);
      const { post, close } = await serve(store);
      try {
        const restore = patchFs("rmSync", real => (file, ...args) => {
          if (String(file) === p.LEGACY_POINTER) throw Object.assign(Error("旧条子删不掉"), { code: "EPERM" });
          return real(file, ...args);
        });
        let moved;
        try {
          moved = await post("/api/store/move", { parent: path.join(base, "新处") });
        } finally {
          restore();
        }
        assert.equal(moved.status, 200, JSON.stringify(moved.data));
        assert.equal(moved.data.moved, true);
        assert.equal(moved.data.root, next);
        assert.equal(store.paths().root, next, "运行中的根换到新处");
        assert.ok(fs.existsSync(p.LEGACY_POINTER), "删不掉的旧条子留着");
        assert.equal(pointerRoot(p.POINTER), next, "新条子已写入");
        assert.equal(loadStore()().paths().root, next, "重启后根与运行中一致");
      } finally {
        await close();
      }
    });
  });

// 新条子写不进（提交点失败）：搬家报错、根退回旧处；旧条子在提交之后才清理，写失败时两份条子都原样还在，
// 不会出现「旧条子已删、新条子没写成」把原存储位置丢掉的情况
for (const platform of ["darwin", "linux"])
  test(`新条子写不进：搬家失败，旧位置的条子原样保留（${platform}）`, async () => {
    await withSandbox(platform, async ({ base, home, loadStore }) => {
      const p = pointerPaths(home, platform),
        oldRoot = path.join(base, "旧根"),
        legacyRoot = path.join(base, "更早的根"),
        next = path.join(base, "新处", ".yan");
      fs.mkdirSync(oldRoot, { recursive: true });
      writeConfig(oldRoot, "旧根那份");
      writePointerFile(p.LEGACY_POINTER, legacyRoot);
      writePointerFile(p.POINTER, oldRoot);
      const store = loadStore()();
      store.ensureRoot();
      assert.equal(store.paths().root, oldRoot);
      const { post, close } = await serve(store);
      try {
        const restore = patchFs("writeFileSync", real => (file, ...args) => {
          // writeAtomic 先写 POINTER.<戳>.tmp 再改名，临时文件名以条子路径开头，一并拦下
          if (String(file).startsWith(p.POINTER)) throw Object.assign(Error("条子写不进"), { code: "EACCES" });
          return real(file, ...args);
        });
        let moved;
        try {
          moved = await post("/api/store/move", { parent: path.join(base, "新处") });
        } finally {
          restore();
        }
        assert.equal(moved.status, 400);
        assert.match(moved.data.error, /存储位置未能更换/);
        assert.equal(store.paths().root, oldRoot, "根退回旧处");
        assert.equal(pointerRoot(p.POINTER), oldRoot, "条子没被动过");
        assert.equal(pointerRoot(p.LEGACY_POINTER), legacyRoot, "兼容性残留也原样还在");
        assert.equal(loadStore()().paths().root, oldRoot, "重启后仍是旧根");
      } finally {
        await close();
      }
    });
  });

// 回默认处在非 Windows 上也显式写条子（root=HOME_ROOT）：旧条子删不掉时重启后 POINTER 优先，
// 残留的旧条子不会把根拉回旧目录
for (const platform of ["darwin", "linux"])
  test(`回默认处：旧条子删不掉也不复活，重启仍落默认根（${platform}）`, async () => {
    await withSandbox(platform, async ({ base, home, loadStore }) => {
      const p = pointerPaths(home, platform),
        customRoot = path.join(base, "自定义", ".yan"),
        legacyRoot = path.join(base, "更早的根");
      fs.mkdirSync(customRoot, { recursive: true });
      writeConfig(customRoot, "自定义那份");
      writePointerFile(p.POINTER, customRoot);
      writePointerFile(p.LEGACY_POINTER, legacyRoot);
      const store = loadStore()();
      store.ensureRoot();
      assert.equal(store.paths().root, customRoot, "POINTER 优先于旧条子");
      const { post, close } = await serve(store);
      try {
        const restore = patchFs("rmSync", real => (file, ...args) => {
          if (String(file) === p.LEGACY_POINTER) throw Object.assign(Error("旧条子删不掉"), { code: "EPERM" });
          return real(file, ...args);
        });
        let moved;
        try {
          moved = await post("/api/store/move", { parent: home });
        } finally {
          restore();
        }
        assert.equal(moved.status, 200, JSON.stringify(moved.data));
        assert.equal(moved.data.moved, true);
        assert.equal(moved.data.root, p.HOME_ROOT);
        assert.equal(store.paths().root, p.HOME_ROOT);
        assert.equal(pointerRoot(p.POINTER), p.HOME_ROOT, "默认处也显式写了条子");
        assert.ok(fs.existsSync(p.LEGACY_POINTER), "删不掉的旧条子留着");
        assert.equal(loadStore()().paths().root, p.HOME_ROOT, "重启不复活旧目录");
      } finally {
        await close();
      }
    });
  });

// Windows 不回归：条子只认 %APPDATA%（LEGACY_POINTER 为空，同名旧文件既不读也不删），
// 回默认处照旧删条子而不是写条子
test("Windows：条子只认 %APPDATA%，回默认处仍是删条子不写条子", async () => {
  await withSandbox("win32", async ({ base, home, loadStore }) => {
    const p = pointerPaths(home, "win32"),
      strayLegacy = path.join(home, "AppData", "Roaming", "言", "位置.json"),
      legacyRoot = path.join(base, "更早的根"),
      customRoot = path.join(base, "自定义", ".yan"),
      next = path.join(base, "新处", ".yan");
    assert.equal(p.LEGACY_POINTER, "", "Windows 没有兼容旧条子");
    fs.mkdirSync(customRoot, { recursive: true });
    writeConfig(customRoot, "自定义那份");
    writePointerFile(strayLegacy, legacyRoot);
    // 没有 POINTER：%APPDATA% 之外躺着同名旧条子也不作数，根回默认处
    const store = loadStore()();
    store.ensureRoot();
    assert.equal(store.paths().root, p.HOME_ROOT);
    const { post, close } = await serve(store);
    try {
      let moved = await post("/api/store/move", { parent: path.join(base, "新处") });
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
      assert.equal(moved.data.root, next);
      assert.equal(pointerRoot(p.POINTER), next, "条子写进 %APPDATA%");
      assert.equal(pointerRoot(strayLegacy), legacyRoot, "那份旧条子碰都不碰");
      assert.equal(loadStore()().paths().root, next);
      moved = await post("/api/store/move", { parent: home });
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
      assert.equal(moved.data.root, p.HOME_ROOT);
      assert.equal(store.paths().root, p.HOME_ROOT);
      assert.ok(!fs.existsSync(p.POINTER), "回默认处照旧删掉条子");
      assert.ok(fs.existsSync(strayLegacy), "旧条子仍不被碰");
      assert.equal(loadStore()().paths().root, p.HOME_ROOT);
    } finally {
      await close();
    }
  });
});
