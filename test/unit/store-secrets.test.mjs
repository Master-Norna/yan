// 存储根里的配置与登录文件（内有 API Key 与令牌）：文件工具、检索、指令一律不碰，不论档位与沙箱；
// 只认桥接此刻的存储根——开发言自己时仓库里写到「配置.json」字样的指令照常
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createWork = require("../../server/work/index.js");
const { screenStorePath, screenStoreCommand } = require("../../server/sandbox.js");

const R = "E:\\聊天记录\\.yan",
  J = (...p) => [R, ...p].join("\\"),
  onlyWindows = { skip: process.platform !== "win32" && "用例写的是 Windows 路径" };

test("screenStoreCommand：点名配置、备份、登录文件且靠近存储根的拦下，别处的同名字样放行", onlyWindows, () => {
  for (const [command, workdir] of [
    [`Get-Content "${J("配置.json")}"`, "D:\\x"],
    ["type ..\\配置.json", J("卷宗")],
    ["Get-Content $HOME\\.yan\\配置备份\\a.json", "E:\\项目\\言"],
    ["cat E:/聊天记录/.yan/*", "E:\\项目\\言"],
    [`Get-Content "${J("ChatGPT 登录.json")}"`, "D:\\x"]
  ])
    assert.ok(screenStoreCommand(command, R, workdir), command);
  for (const [command, workdir] of [
    ['rg "配置.json" server', "E:\\项目\\言"],
    [`Get-ChildItem ${J("卷宗")}`, "E:\\项目\\言"],
    [`Get-Content ${J("卷宗", "报告.md")}`, J("卷宗")]
  ])
    assert.equal(screenStoreCommand(command, R, workdir), null, command);
  assert.equal(screenStoreCommand(`Get-Content "${J("配置.json")}"`, "", "D:\\x"), null, "没给存储根不判");
});

test("screenStorePath：根下这几样（含备份目录里的）拦下，卷宗里同名的放行，大小写不论", onlyWindows, () => {
  for (const p of [J("配置.json"), J("配置备份", "2026.json"), J("ChatGPT 登录.json"), "e:\\聊天记录\\.YAN\\配置.JSON"])
    assert.ok(screenStorePath(p, R), p);
  for (const p of [J("卷宗", "a.md"), J("卷宗", "配置.json"), J("对话")]) assert.equal(screenStorePath(p, R), null, p);
});

const root = path.resolve("test/.tmp/store-secrets"),
  archive = path.join(root, "卷宗");
rmSync(root, { recursive: true, force: true });
mkdirSync(path.join(root, "配置备份"), { recursive: true });
mkdirSync(archive, { recursive: true });
writeFileSync(path.join(root, "配置.json"), '{"apiKey":"sk-canary"}');
writeFileSync(path.join(root, "配置备份", "a.json"), '{"apiKey":"sk-canary"}');
writeFileSync(path.join(archive, "笔记.md"), "sk-canary 是测试用的字样\n");
after(() => rmSync(root, { recursive: true, force: true }));
const work = createWork({ archiveHome: () => archive, workHome: () => archive, storeRoot: () => root, toolEnv: env => env });
async function call(route, body) {
  const req = Readable.from([Buffer.from(JSON.stringify({ workdir: archive, ...body }))]);
  let status = 0,
    text = "";
  const res = {
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    on() {},
    once() {},
    setHeader() {},
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

test("宽档、没开沙箱也拦：读、写配置，读备份", async () => {
  for (const [route, body] of [
    ["read", { path: path.join(root, "配置.json"), roam: true, permission: "auto" }],
    ["read", { path: path.join(root, "配置备份", "a.json"), roam: true, permission: "review" }],
    ["write", { path: path.join(root, "配置.json"), content: "{}", roam: true, permission: "auto" }]
  ]) {
    const { status, data } = await call(route, body);
    assert.notEqual(status, 200, `${route} ${body.path}`);
    assert.match(data.error, /配置与登录文件/);
  }
});

test("检索从存储根搜起：卷宗里的命中照给，配置与备份里的不带出来", async () => {
  const { status, data } = await call("search", { path: root, query: "sk-canary", roam: true, permission: "auto" });
  assert.equal(status, 200);
  assert.deepEqual(
    data.matches.map(m => path.basename(m.file)),
    ["笔记.md"]
  );
});

test("指令点名存储根的配置：径行、不开沙箱也不跑", async () => {
  const command = process.platform === "win32" ? "Get-Content ..\\配置.json" : "cat ../配置.json",
    { status, data } = await call("run", { command, permission: "auto", sandbox: false });
  assert.notEqual(status, 200);
  assert.match(data.error, /配置与登录文件/);
});
