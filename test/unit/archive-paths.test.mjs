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

test("Markdown 相对图片先去查询片段，再解码文件名中的保留字符", () => {
  const { archiveRelative } = load(["archiveRelative"]);
  assert.equal(archiveRelative("notes", "./images/a%23b%2520.png?size=2#view"), "notes/images/a#b%20.png");
  assert.equal(archiveRelative("notes", "../images/%E4%B8%AD%20%E6%96%87.png"), "images/中 文.png");
  assert.equal(archiveRelative("notes", "images/bad%name.png"), "notes/images/bad%name.png");
});
