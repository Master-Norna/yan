import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function fixture() {
  return load([
    "stage",
    "work",
    "workOpenPath",
    "workEnterDir",
    "workLeave",
    "stageLaunch",
    "stageSync",
    "bindWork",
    `setup: ({ server = "", locate = async () => {}, call = async () => ({}), opened = async () => ({}) } = {}) => {
      const calls = [], navigation = [], notices = [];
      const nodes = new Map();
      document.querySelector = selector => {
        if (!nodes.has(selector)) {
          const hidden = new Set(["#stagePanel", "#stagePin"]).has(selector) ? new Set(["hidden"]) : new Set();
          const listeners = {};
          nodes.set(selector, { dataset: {}, listeners, classList: { contains: key => hidden.has(key), toggle: (key, set) => set ? hidden.add(key) : hidden.delete(key) }, addEventListener: (name, fn) => listeners[name] = fn });
        }
        return nodes.get(selector);
      };
      archiveDir = () => "C:/archive";
      stageLocate = locate;
      stageServer = () => server;
      mcpConfigs = () => ({ [server]: {} });
      stageRender = stageSync = workPaint = () => {};
      stageGo = path => { navigation.push(path); ++stage.emptyNav; };
      toast = text => notices.push(text);
      bridge = async (route, payload) => {
        calls.push([route, payload]);
        if (route === "/api/mcp/call") return call();
        if (route === "/api/archive/open") return opened();
        return { entries: [], dirs: [] };
      };
      work.open = true;
      work.root = "C:/one";
      return { calls, navigation, notices, node: document.querySelector };
    }`
  ]);
}

const first = "C:/one/A.md",
  second = "C:/one/B.md";
const pending = () => {
  let resolve;
  const promise = new Promise(r => (resolve = r));
  return { promise, resolve };
};

test("未配置浏览器仍可从立轴进工作区，点文件走本机接口", async () => {
  const f = fixture(),
    opened = pending();
  const { calls, navigation, notices, node } = f.setup({ opened: opened.resolve });
  f.stageSync();
  assert.equal(node("#stagePin").classList.contains("hidden"), false, "有卷宗时，无浏览器也显示立轴");
  f.bindWork();
  node("#stageWork").listeners.click({
    target: { closest: selector => (selector === "[data-work-file]" ? { dataset: { workFile: first } } : null) }
  });
  await opened.promise;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [["/api/archive/open", { file: first }]]);
  assert.deepEqual(navigation, []);
  assert.deepEqual(notices, ["已在本机程序中打开"]);
});

test("本机程序打开原件被拒绝时明确报错，不当作打开成功", async () => {
  const f = fixture(),
    { calls, navigation, notices } = f.setup({
      opened: () => {
        throw Error("denied");
      }
    });
  await f.workOpenPath(first);
  assert.deepEqual(calls, [["/api/archive/open", { file: first }]]);
  assert.deepEqual(navigation, []);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /打开失败.*denied/);
});

test("调试口找到已经开的浏览器时，不走本机程序", async () => {
  const f = fixture(),
    { calls, navigation } = f.setup({
      locate: async () => {
        f.stage.ws = {};
      }
    });
  await f.workOpenPath(first);
  assert.deepEqual(calls, []);
  assert.deepEqual(navigation, [first]);
});

test("浏览器冷启动中再点一件：同等一次启动，只开最后点的那件", async () => {
  const f = fixture(),
    launched = pending(),
    starting = pending();
  let ready = false;
  const { calls, navigation } = f.setup({
    server: "test-browser",
    locate: async () => {
      if (ready) f.stage.ws = {};
    },
    call: () => {
      starting.resolve();
      return launched.promise;
    }
  });
  const a = f.workOpenPath(first);
  await starting.promise;
  const launch = f.stage.launching;
  const joined = f.stageLaunch();
  const b = f.workOpenPath(second);
  // 第二次查找同样要等连接；此处模拟 MCP 回复后才出现调试口。
  await Promise.resolve();
  assert.equal(navigation.length, 0);
  ready = true;
  launched.resolve({});
  await Promise.all([a, b]);
  assert.deepEqual(
    calls.map(([route]) => route),
    ["/api/mcp/call"]
  );
  assert.deepEqual(navigation, [second]);
  assert.equal(joined, launch);
  assert.equal(f.stage.launching, null);
});

for (const [label, invalidate] of [
  [
    "换层",
    f => {
      f.workEnterDir("C:/two");
      f.workEnterDir("C:/one");
    }
  ],
  [
    "收起重开",
    f => {
      f.workLeave();
      f.work.open = true;
    }
  ],
  [
    "另起浏览器导航",
    f => {
      ++f.stage.emptyNav;
    }
  ]
]) {
  test(`等浏览器时${label}，过时的点击既不导航也不打开本机程序`, async () => {
    const f = fixture(),
      located = pending();
    const { calls, navigation } = f.setup({ locate: () => located.promise });
    const opening = f.workOpenPath(first);
    invalidate(f);
    f.stage.ws = {};
    located.resolve();
    await opening;
    assert.deepEqual(navigation, []);
    assert.ok(!calls.some(([route]) => route === "/api/archive/open" || route === "/api/mcp/call"));
  });
}

test("改动列表和文件状态使用同一趟快照，显式刷新才整批换上", async () => {
  const f = load([
    "work",
    "workRefresh",
    "workChangeRows",
    `setup: () => {
      const files = [{path:"C:/one/A.md"}];
      currentConversation = () => ({workdir:"C:/one", messages: [{}]});
      changeStats = () => ({files});
      workPaint = () => {};
      bridge = async () => ({kind:"file"});
      work.mode = "changes";
      return files;
    }`
  ]);
  const files = f.setup();
  await f.workRefresh();
  files.push({ path: second, created: true });
  assert.deepEqual(
    f.workChangeRows().map(r => [r.path, r.state]),
    [[first, "mod"]]
  );
  await f.workRefresh();
  assert.deepEqual(
    f.workChangeRows().map(r => [r.path, r.state]),
    [
      [first, "mod"],
      [second, "add"]
    ]
  );
});
