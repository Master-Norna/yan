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
      openFileViewer = async (source, name, trigger, host) => opened.push({ file: source.file, name, trigger, host });
      work.open = true;
      work.root = "C:/one";
      return { opened, node: document.querySelector };
    }`
  ]);
}

for (const connected of [false, true]) {
  test(`工作区点件落在游目这一栏里（浏览器连接：${connected}）`, () => {
    const f = fixture(),
      { opened, node } = f.setup();
    if (connected) f.stage.ws = {};
    f.bindWork();
    const row = { dataset: { workFile: first } };
    node("#stageWork").listeners.click({
      target: { closest: selector => (selector === "[data-work-file]" ? row : null) }
    });
    assert.deepEqual(opened, [{ file: first, name: "", trigger: row, host: "stage" }]);
    assert.equal(f.work.open, true);
    assert.equal(f.work.root, "C:/one");
    f.workOpenPath(second);
    assert.equal(opened[1].file, second);
    f.work.open = false;
    f.workOpenPath(first);
    assert.equal(opened.length, 2);
  });
}

test("改动面点件看本段对话的改动，不打开原件", () => {
  const f = load([
    "work",
    "workOpenPath",
    `setup: () => {
      const shown = [];
      showInFileViewer = (title, html, trigger, seal, host) => shown.push({ title, html, trigger, seal, host });
      openFileViewer = async source => shown.push({ file: source.file, host: "file" });
      currentConversation = () => ({ id: "c", workdir: "C:/one", messages: [] });
      workDiffHtml = () => '<div class="file-viewer-text change-diff">DIFF</div>';
      work.open = true;
      work.mode = "changes";
      return shown;
    }`
  ]);
  const shown = f.setup(),
    row = { dataset: { workFile: first } };
  f.workOpenPath(first, row);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].host, "stage");
  assert.match(shown[0].title, /本段改动/);
  assert.equal(shown[0].seal, "览");
  assert.match(shown[0].html, /tool-diff|change-diff/);
  assert.equal(shown[0].trigger, row);
});

test("本段改动按条按步的先后排，相对路与绝对路按对话目录配对", () => {
  const f = load(["workDiffHtml"]),
    conversation = {
      workdir: "C:/one",
      messages: [
        {
          steps: [
            {
              name: "write_file",
              status: "done",
              arguments: "{}",
              result: "已写入",
              written: "# 一\n",
              change: { path: "A.md", created: true }
            }
          ]
        },
        {
          steps: [
            {
              name: "edit_file",
              status: "done",
              arguments: "{}",
              result: "已修改",
              previous: "# 一\n",
              written: "# 二\n",
              change: { path: `${first}` }
            },
            {
              name: "edit_file",
              status: "done",
              arguments: "{}",
              result: "别处",
              previous: "a\n",
              written: "b\n",
              change: { path: "D:/else/other.md" }
            }
          ]
        }
      ]
    },
    html = f.workDiffHtml(conversation, first);
  assert.equal((html.match(/tool-diff/g) || []).length, 2);
  assert.match(html, /已写入/);
  assert.match(html, /已修改/);
  assert.doesNotMatch(html, /别处/);
  assert.match(f.workDiffHtml(conversation, "C:/one/none.md"), /此件没有记下改动/);
});

test("改动相对路按对话目录落地，与当前簿录所处目录无关，文件名不经网址解析", async () => {
  const f = load([
    "work",
    "workRefresh",
    "workChangeRows",
    `setup: () => {
      const paths = [];
      currentConversation = () => ({workdir:"C:/one", messages: [{}]});
      changeStats = () => ({files: [
        {path:".yan/报告 #1%.md", created:true},
        {path:"C:/one/.yan/报告 #1%.md"},
        {path:"D:/else/other.txt"},
        {path:"sandbox:/not-local.md"}
      ]});
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
