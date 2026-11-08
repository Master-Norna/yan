// 游目：地址栏的话怎么换成网址、执事的一步怎么写成人话；桥接怎么从 MCP 服务的参数里读出调试口、配置目录与存下载的目录
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const { stageUrlOf } = load(["stageUrlOf"]);
const { browserOf, prepareBrowser, prepareMcp, builtinConfig, sweepOutputs, savedName } = createRequire(import.meta.url)(
  "../../server/stage.js"
);

test("地址栏：网址补 https，本机的照走，不像网址的交给搜索", () => {
  assert.equal(stageUrlOf("  example.com "), "https://example.com");
  assert.equal(stageUrlOf("example.com:8080/a"), "https://example.com:8080/a");
  assert.equal(stageUrlOf("http://a.b/c"), "http://a.b/c");
  assert.equal(stageUrlOf("about:blank"), "about:blank");
  assert.equal(stageUrlOf("localhost:5173"), "http://localhost:5173");
  assert.equal(stageUrlOf("E:\\项目\\index.html"), "file:///E:/项目/index.html");
  assert.equal(stageUrlOf("/Users/a/第 #1?.html"), "file:///Users/a/第 %231%3F.html");
  assert.equal(stageUrlOf("言 浏览器"), `https://www.bing.com/search?q=${encodeURIComponent("言 浏览器")}`);
  assert.equal(stageUrlOf("playwright"), "https://www.bing.com/search?q=playwright");
  assert.equal(stageUrlOf("   "), "");
});

test("调试口与配置目录：参数里直写的、--config 文件里的，都没有按 9288", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yan-stage-"));
  const file = path.join(dir, "stage.json");
  writeFileSync(
    file,
    JSON.stringify({ browser: { userDataDir: "D:/profile", launchOptions: { args: ["--remote-debugging-port=9300"] } } })
  );
  assert.deepEqual(browserOf(["cli.js", "--config", file]), { port: 9300, dir: "D:/profile", output: "" });
  assert.deepEqual(browserOf(["cli.js", `--config=${file}`, "--user-data-dir", "E:/p"]), { port: 9300, dir: "E:/p", output: "" });
  assert.deepEqual(browserOf(["--cdp-endpoint", "http://localhost:9411"]), { port: 9411, dir: "", output: "" });
  assert.deepEqual(browserOf(["--config", path.join(dir, "无此文件.json")]), { port: 9288, dir: "", output: "" });
  assert.deepEqual(browserOf(undefined), { port: 9288, dir: "", output: "" });
});

test("--config 写相对路径时按服务的工作目录解析，与起服务时同一个基准", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "yan-stage-"));
  writeFileSync(
    path.join(cwd, "playwright-1a2b3c4d.json"),
    JSON.stringify({
      browser: { userDataDir: "下载/配置", outputDir: "下载", launchOptions: { args: ["--remote-debugging-port=9333"] } }
    })
  );
  // 页面问调试口时递的是原配置：工作目录设成 cwd、--config 写相对路径（很自然的写法）
  // 改动前读不到那份文件，端口回落 9288、下载目录回落 .playwright-mcp——游目整个连不上
  assert.deepEqual(browserOf(["cli.js", "--config", "playwright-1a2b3c4d.json"], cwd), {
    port: 9333,
    dir: "下载/配置",
    output: path.join(cwd, "下载")
  });
});

test("存下载的目录：参数里的 --output-dir，没写的是服务工作目录下的 .playwright-mcp", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "yan-stage-"));
  assert.equal(browserOf(["cli.js"], cwd).output, path.join(cwd, ".playwright-mcp"));
  assert.equal(browserOf(["cli.js", "--output-dir", "out"], cwd).output, path.join(cwd, "out"));
  assert.equal(browserOf(["cli.js"]).output, "");
});

test("执事的一步写成一句两字动词：照 playwright 的参数，认不得的只写工具名", () => {
  const { stageActionText } = load(["stageActionText"]);
  assert.equal(stageActionText("browser_navigate", { url: "https://github.com/pulls" }), "前往 github.com");
  assert.equal(stageActionText("browser_click", { element: "Pull requests link", ref: "e12" }), "点击「Pull requests link」");
  assert.equal(stageActionText("browser_click", { element: "行", doubleClick: true }), "双击「行」");
  assert.equal(stageActionText("browser_type", { element: "搜索框", text: "is:open\nis:pr" }), "键入「is:open is:pr」");
  assert.equal(stageActionText("browser_tabs", { action: "new" }), "新开一页");
  assert.equal(stageActionText("browser_wait_for", { time: 2 }), "等候 2 秒");
  assert.equal(stageActionText("browser_mouse_move_xy", { x: 1, y: 2 }), "mouse_move_xy");
});

test("接法由言补齐：在人写的 --config 上合并，人写了的照人的；别的服务原样起", () => {
  const root = mkdtempSync(path.join(tmpdir(), "yan-root-")),
    cwd = mkdtempSync(path.join(tmpdir(), "yan-mcp-")),
    moved = [],
    where = { root, bridgePort: 8787, offscreen: port => moved.push(port) };
  // 不是 Playwright 的：原样递回
  const other = { command: "node", args: ["server.js"] };
  assert.equal(prepareBrowser(other, where), other);
  // 没有 --config：补一份
  const bare = prepareBrowser({ command: "npx", args: ["-y", "@playwright/mcp@latest", "--browser", "msedge"] }, where),
    launched = config => JSON.parse(readFileSync(config.args.at(-1), "utf8")).browser;
  // 合并好的那份按内容取名，落在「游目」里
  assert.equal(bare.args.at(-2), "--config");
  assert.equal(path.dirname(bare.args.at(-1)), path.join(root, "游目"));
  assert.match(path.basename(bare.args.at(-1)), /^playwright-[0-9a-f]{8}[.]json$/);
  assert.deepEqual(launched(bare).launchOptions.args, [
    "--remote-debugging-port=9288",
    "--remote-allow-origins=http://127.0.0.1:8787,http://127.0.0.1:9288",
    "--window-position=-32000,-32000"
  ]);
  // 结果里的文件写全路径
  assert.equal(JSON.parse(readFileSync(bare.args.at(-1), "utf8")).filePaths, "absolute");
  // 人写的 stage.json 只放行了言：补上调试口自己，端口与别的设定照人的，--config 换成合并好的那份
  writeFileSync(
    path.join(cwd, "stage.json"),
    JSON.stringify({
      browser: {
        userDataDir: "D:/p",
        launchOptions: { args: ["--remote-debugging-port=9300", "--remote-allow-origins=http://127.0.0.1:8787", "--window-position=0,0"] }
      }
    })
  );
  const merged = prepareBrowser(
    { command: "node", args: ["E:/MCP/playwright/node_modules/@playwright/mcp/cli.js", "--config", "stage.json", "--x"], cwd },
    where
  );
  assert.deepEqual(merged.args, ["E:/MCP/playwright/node_modules/@playwright/mcp/cli.js", "--x", "--config", merged.args.at(-1)]);
  // 两个服务的接法不同：各写各的，后起的不盖掉先起的
  assert.notEqual(merged.args.at(-1), bare.args.at(-1));
  assert.equal(launched(bare).launchOptions.args[0], "--remote-debugging-port=9288");
  const browser = launched(merged);
  assert.equal(browser.userDataDir, "D:/p");
  assert.deepEqual(browser.launchOptions.args, [
    "--remote-debugging-port=9300",
    "--remote-allow-origins=http://127.0.0.1:8787,http://127.0.0.1:9300",
    "--window-position=0,0"
  ]);
  // 接别处起好的浏览器（--cdp-endpoint）：它的启动参数言管不着，不补
  assert.deepEqual(
    launched(prepareBrowser({ command: "npx", args: ["@playwright/mcp", "--cdp-endpoint", "http://127.0.0.1:9333"] }, where)).launchOptions
      .args,
    []
  );
  // 无头的不挪窗口
  assert.ok(
    !launched(prepareBrowser({ command: "npx", args: ["@playwright/mcp", "--headless"] }, where)).launchOptions.args.some(a =>
      a.startsWith("--window-position")
    )
  );
  // 只有言挪到屏幕外的那个报出调试口（桥接据此让它不占任务栏）：人自己定了位置的、接别处的、无头的都不报
  assert.deepEqual(moved, [9288]);
  // 模型的浏览器开不了言：端口随桥接实际所用，接别处起好的浏览器也算，人自己列的照留
  const blocked = config => JSON.parse(readFileSync(config.args.at(-1), "utf8")).network.blockedOrigins,
    own = ["http://127.0.0.1:8787", "http://localhost:8787"];
  assert.deepEqual(blocked(bare), own);
  assert.deepEqual(blocked(prepareBrowser({ command: "npx", args: ["@playwright/mcp"] }, { root, bridgePort: 8801 })), [
    "http://127.0.0.1:8801",
    "http://localhost:8801"
  ]);
  assert.deepEqual(
    blocked(prepareBrowser({ command: "npx", args: ["@playwright/mcp", "--cdp-endpoint", "http://127.0.0.1:9333"] }, where)),
    own
  );
  writeFileSync(path.join(cwd, "blocked.json"), JSON.stringify({ network: { blockedOrigins: ["https://ads.example.com", own[0]] } }));
  assert.deepEqual(blocked(prepareBrowser({ command: "npx", args: ["@playwright/mcp", "--config", "blocked.json"], cwd }, where)), [
    "https://ads.example.com",
    ...own
  ]);
});

test("游目自己的浏览器：几项选择拼成整条，家当都在存储根的「游目」里，再补接法", () => {
  const root = mkdtempSync(path.join(tmpdir(), "yan-root-")),
    home = path.join(root, "游目");
  const edge = builtinConfig({ browser: "msedge" }, root);
  assert.equal(edge.command, process.execPath);
  assert.deepEqual(edge.args, [
    path.join(home, "依赖", "node_modules", "@playwright", "mcp", "cli.js"),
    "--browser",
    "msedge",
    "--user-data-dir",
    path.join(home, "浏览器"),
    "--output-dir",
    path.join(home, "下载"),
    "--allow-unrestricted-file-access"
  ]);
  // 工作目录另开一层：模型给了名字的截图不与依赖、浏览器配置混着
  assert.equal(edge.cwd, path.join(home, "工作"));
  // 自带内核：指到「内核」目录
  const own = builtinConfig({ browser: "chromium" }, root);
  assert.equal(own.env.PLAYWRIGHT_BROWSERS_PATH, path.join(home, "内核"));
  // 起的时候：拼成整条、带上接法那份 --config，note 之类照留
  const ready = prepareMcp({ stage: { browser: "msedge" }, note: "说明" }, { root, bridgePort: 8787 });
  assert.equal(ready.note, "说明");
  assert.ok(!("stage" in ready));
  assert.equal(ready.args.at(-2), "--config");
  assert.equal(path.dirname(ready.args.at(-1)), home);
  // 页面问调试口、收藏时递几项选择，认得出配置目录
  assert.equal(browserOf(builtinConfig({}, root).args, home).dir, path.join(home, "浏览器"));
});

test("下载目录里 Playwright 自己起名的过程文件放过一天就清，下载来的不动", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yan-out-")),
    old = new Date(Date.now() - 2 * 86400000),
    names = {
      "console-2026-11-04T08-04-31-979Z.log": false,
      "page-2026-11-05T13-04-31-207Z.yml": false,
      "network-request-2026-11-05T13-04-31-207Z.log": false,
      "download-2026-11-05T13-04-31-207Z.bin": true,
      "github-recovery-codes.txt": true,
      "报告 console-2026-11-04T08-04-31-979Z.log": true
    };
  for (const name of Object.keys(names)) {
    writeFileSync(path.join(dir, name), "x");
    utimesSync(path.join(dir, name), old, old);
  }
  writeFileSync(path.join(dir, "page-2026-11-07T13-04-31-207Z.yml"), "新的");
  mkdirSync(path.join(dir, "page-2026-11-04T08-04-31-979Z.d"));
  sweepOutputs(dir);
  for (const [name, kept] of Object.entries(names)) assert.equal(existsSync(path.join(dir, name)), kept, name);
  assert.ok(existsSync(path.join(dir, "page-2026-11-07T13-04-31-207Z.yml")));
  sweepOutputs(path.join(dir, "无此目录"));
});

test("下载存成的名字照 Playwright 的规矩：ASCII 符号与空格换成 -，中文与扩展名的点留着", () => {
  assert.equal(savedName("下载测.txt"), "下载测.txt");
  assert.equal(savedName("my report (1).tar.gz"), "my-report-1-tar.gz");
  assert.equal(savedName("README"), "README");
});
