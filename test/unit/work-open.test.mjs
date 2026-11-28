import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const first = "C:/one/A.md",
  second = "C:/one/B.md";

function fixture() {
  return load([
    "stage",
    "work",
    "workOpenPath",
    "bindWork",
    `setup: () => {
      const opened = [], nodes = new Map();
      document.querySelector = selector => {
        if (!nodes.has(selector)) {
          const listeners = {};
          nodes.set(selector, { listeners, addEventListener: (name, fn) => listeners[name] = fn });
        }
        return nodes.get(selector);
      };
      stageLocate = () => { throw Error("unexpected browser lookup"); };
      stageGo = () => { throw Error("unexpected browser navigation"); };
      bridge = () => { throw Error("unexpected bridge call"); };
      openFileViewer = async (source, name, trigger) => opened.push({ file: source.file, name, trigger });
      work.open = true;
      work.root = "C:/one";
      return { opened, node: document.querySelector };
    }`
  ]);
}

for (const connected of [false, true]) {
  test(`工作区点件直接进全屏预览（浏览器连接：${connected}）`, () => {
    const f = fixture(),
      { opened, node } = f.setup();
    if (connected) f.stage.ws = {};
    f.bindWork();
    const row = { dataset: { workFile: first } };
    node("#stageWork").listeners.click({
      target: { closest: selector => (selector === "[data-work-file]" ? row : null) }
    });
    assert.deepEqual(opened, [{ file: first, name: "", trigger: row }]);
    assert.equal(f.work.open, true);
    assert.equal(f.work.root, "C:/one");
    f.workOpenPath(second);
    assert.equal(opened[1].file, second);
    f.work.open = false;
    f.workOpenPath(first);
    assert.equal(opened.length, 2);
  });
}

test("改动相对路按原步骤目录落地，与当前簿录所处目录无关，文件名不经网址解析", async () => {
  const f = load([
    "work",
    "workRefresh",
    "workChangeRows",
    `setup: () => {
      const paths = [];
      const files = [
        {path:".yan/报告 #1%.md", created:true},
        {path:"C:/one/.yan/报告 #1%.md"},
        {path:"D:/else/other.txt"},
        {path:"sandbox:/not-local.md"}
      ];
      currentConversation = () => ({workdir:"C:/one", messages: [{steps: files.map(change => ({status:"done", root:"C:/one", change}))}]});
      work.root = "C:/one/sub";
      work.mode = "changes";
      workPaint = () => {};
      bridge = async (route, body) => { paths.push(body.path); return {kind:"file", size:42}; };
      return paths;
    }`
  ]);
  const paths = f.setup();
  await f.workRefresh();
  assert.deepEqual(paths, ["C:/one/.yan/报告 #1%.md", "D:/else/other.txt"]);
  assert.deepEqual(
    f.workChangeRows().map(r => [r.path, r.state, r.size]),
    [
      ["C:/one/.yan/报告 #1%.md", "add", 42],
      ["D:/else/other.txt", "mod", 42]
    ]
  );
});

test("改动列表和文件状态使用同一趟快照，显式刷新才整批换上", async () => {
  const f = load([
    "work",
    "workRefresh",
    "workChangeRows",
    `setup: () => {
      const files = [{path:"C:/one/A.md"}];
      currentConversation = () => ({workdir:"C:/one", messages: [{steps: files.map(change => ({status:"done", root:"C:/one", change}))}]});
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
