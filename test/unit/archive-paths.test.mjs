import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("目录拖入期间导航和更换卷宗根：整批目录和文件仍落在原处", async () => {
  const requests = [];
  let root = "original-root",
    release;
  const paused = new Promise(resolve => (release = resolve));
  const f = load([
    "addLibraryEntries",
    "navigate: dir => { libraryDir = dir; }",
    `setup: (request, getRoot) => {
      bridge = request; bridgeUpload = (route, head) => request(route, head); archiveDir = getRoot; libraryDir = 'original';
      readFile = async file => file.data;
      refreshArchive = async () => {}; toast = () => {};
    }`
  ]);
  f.setup(
    async (route, body) => {
      requests.push({ route, ...body });
      if (requests.length === 1) await paused;
      return { path: `${body.dir}/${body.name}` };
    },
    () => root
  );
  const file = name => ({ name, isFile: true, file: ok => ok({ name, size: 1, data: "data:text/plain;base64,QQ==" }) });
  const folder = name => ({
    name,
    isFile: false,
    createReader: () => {
      let read = false;
      return {
        readEntries: ok => {
          ok(read ? [] : [file("child.txt")]);
          read = true;
        }
      };
    }
  });
  const importing = f.addLibraryEntries([folder("one"), folder("two")]);
  f.navigate("elsewhere");
  root = "new-root";
  release();
  await importing;
  assert.deepEqual(
    requests.map(({ route, root, dir, name }) => ({ route, root, dir, name })),
    [
      { route: "/api/archive/mkdir", root: "original-root", dir: "original", name: "one" },
      { route: "/api/archive/mkdir", root: "original-root", dir: "original", name: "two" },
      { route: "/api/archive/put", root: "original-root", dir: "original/one", name: "child.txt" },
      { route: "/api/archive/put", root: "original-root", dir: "original/two", name: "child.txt" }
    ]
  );
});

test("Markdown 的图原路取不到：同名的认最近一件，一样近的不猜", () => {
  const { nearestSameName } = load(["nearestSameName"]);
  const doc = "生涯";
  assert.equal(nearestSameName("fig1.png", doc, ["旧/fig1.png", "生涯/fig1.png"]), "生涯/fig1.png");
  assert.equal(nearestSameName("fig1.png", doc, ["生涯/图表/深/fig1.png", "生涯/图表/FIG1.PNG"]), "生涯/图表/FIG1.PNG");
  assert.equal(nearestSameName("fig1.png", "", ["图表/fig1.png"]), "图表/fig1.png");
  assert.equal(nearestSameName("fig1.png", doc, ["生涯/甲/fig1.png", "生涯/乙/fig1.png"]), "");
  assert.equal(nearestSameName("fig1.png", doc, ["生涯/甲/fig1.png", "生涯/乙/fig1.png", "别处/深/fig1.png"]), "");
  assert.equal(nearestSameName("fig1.png", doc, ["生涯/甲/fig1.png", "生涯/乙/fig1.png", "生涯/fig1.png"]), "生涯/fig1.png");
  assert.equal(nearestSameName("fig1.png", doc, ["生涯/fig1.png", "生涯/甲/fig1.png", "生涯/乙/fig1.png"]), "生涯/fig1.png");
  assert.equal(nearestSameName("fig1.png", doc, ["生涯/fig2.png"]), "");
});

test("写在文档里的引用：从文档那一层算，/ 从根算，退出根的照样算到，盘符是顶", () => {
  const f = load(["refTarget", "setup: () => { bootstrap = { work: { platform: 'win32' } }; }"]);
  f.setup();
  const anchor = { document: true, root: "E:/卷宗", dir: "E:/卷宗/生涯/报告", scopes: [] };
  assert.deepEqual(f.refTarget("图/a%201.png", anchor), { file: "E:/卷宗/生涯/报告/图/a 1.png" });
  assert.deepEqual(f.refTarget("../图/a.png", anchor), { file: "E:/卷宗/生涯/图/a.png" });
  assert.deepEqual(f.refTarget("/图/a.png", anchor), { file: "E:/卷宗/图/a.png" });
  assert.deepEqual(f.refTarget("../../../别处/a.png", anchor), { file: "E:/别处/a.png" });
  assert.deepEqual(f.refTarget("../../../../../a.png", anchor), { file: "E:/a.png" });
  assert.deepEqual(f.refTarget("E:\\别处\\.\\甲\\..\\a.png", anchor), { file: "E:/别处/a.png" });
  assert.deepEqual(f.refTarget("../a.md", { document: true, skillDir: "某技能", dir: "refs", scopes: [] }), {
    skillDir: "某技能",
    skillPath: "a.md"
  });
  assert.equal(f.refTarget("sandbox:/mnt/a.png", anchor), null);
  assert.equal(f.refTarget("//host/a.png", anchor), null, "两个正斜杠起头的是协议相对的网址，不当共享路径");
  // Windows 的共享路径与盘符一样是绝对路：\\nas\share\… 与 file://nas/share/…
  assert.deepEqual(f.refTarget("\\\\nas\\share\\report.pdf", anchor), { file: "//nas/share/report.pdf" });
  assert.deepEqual(f.refTarget("file://nas/share/report.pdf", anchor), { file: "//nas/share/report.pdf" });
});

test("一件文件在不在某个根下：不分大小写，夹名只是前缀的不算", () => {
  const { relInside, joinFile } = load(["relInside", "joinFile"]);
  assert.equal(relInside("E:\\卷宗\\", "e:/卷宗/夹/A.png"), "夹/A.png");
  assert.equal(relInside("E:/卷宗", "E:/卷宗"), "");
  assert.equal(relInside("E:/卷宗", "E:/卷宗二/a.png"), null);
  assert.equal(relInside("", "E:/a.png"), null);
  assert.equal(joinFile("E:\\卷宗\\", "a.png"), "E:/卷宗/a.png");
  assert.equal(joinFile("E:/", "a.png"), "E:/a.png");
});

test("搬走的件：按落脚的次序认，第一个根认不出才看下一个，件表只问一回", async () => {
  const asked = [];
  const f = load(["relocateRef", "setup: request => { bridge = request; }"]);
  f.setup(async (route, { root }) => {
    asked.push(root);
    return { entries: root === "E:/工作" ? [{ path: "a/图.png" }] : [{ path: "图.png" }, { path: "表.png" }] };
  });
  const anchor = { root: "E:/工作", dir: "E:/工作/a/b", scopes: ["E:/工作", "E:/卷宗"] };
  assert.deepEqual(await f.relocateRef("图.png", anchor), { file: "E:/工作/a/图.png" });
  assert.deepEqual(await f.relocateRef("表.png", anchor), { file: "E:/卷宗/表.png" });
  assert.equal(await f.relocateRef("无.png", anchor), null);
  assert.equal(await f.relocateRef("图.png", { dir: "", scopes: [] }), null);
  assert.deepEqual(asked, ["E:/工作", "E:/卷宗"]);
});

test("Markdown 相对图片先去查询片段，再解码文件名中的保留字符", () => {
  const { archiveRelative } = load(["archiveRelative"]);
  assert.equal(archiveRelative("notes", "./images/a%23b%2520.png?size=2#view"), "notes/images/a#b%20.png");
  assert.equal(archiveRelative("notes", "../images/%E4%B8%AD%20%E6%96%87.png"), "images/中 文.png");
  assert.equal(archiveRelative("notes", "images/bad%name.png"), "notes/images/bad%name.png");
});
