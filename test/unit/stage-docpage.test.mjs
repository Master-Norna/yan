// 本机文档摊在游目里看：哪些本机文件该摊成文档页、摊出来的页长什么样。
// 页面那头一句分流（stageGo → stageDocName），桥接这头一个壳（docPageHtml）；抽取与渲染整段复用预览器，不在这里重测
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { load } from "./harness.mjs";

const { stageDocName, stageDocPage } = load(["stageDocName", "stageDocPage"]);
const { docPageHtml, DOC_VIEWABLE, DOCPAGE_FILE, sweepOutputs } = createRequire(import.meta.url)("../../server/stage.js");

test("能摊开的本机文档：抽得出正文的六种才认，旧格式与压缩包仍交本机程序", () => {
  const url = name => `file:///E:/%E6%A1%88/${encodeURIComponent(name)}`;
  for (const name of ["报告.docx", "数据.xlsx", "讲义.pptx", "写作.odt", "账.ods", "简.odp"])
    assert.equal(stageDocName(url(name)), name, name);
  // 抽不出正文的一律不认：旧版 Office、压缩包、认得的别的格式
  for (const name of ["老稿.doc", "旧表.xls", "旧讲.ppt", "包.zip", "说明.txt", "图.png", "没扩展名"])
    assert.equal(stageDocName(url(name)), "", name);
  // 只认本机文件
  assert.equal(stageDocName("https://a.b/x.docx"), "");
  assert.equal(stageDocName("about:blank"), "");
  assert.equal(stageDocName(""), "");
});

test("文件名里的转义照解：中文与空格、以及解不开的那种", () => {
  assert.equal(stageDocName("file:///E:/a/%E5%B9%B4%E6%8A%A5.docx"), "年报.docx");
  assert.equal(stageDocName("file:///E:/a/%E6%8A%A5%20%E5%91%8A.docx"), "报 告.docx");
  // 地址里落单的 % 解不开：当没这回事，别把整个打开流程带倒
  assert.equal(stageDocName("file:///E:/a/%zz.docx"), "");
});

test("原件直取放行六种 Office/ODF 与 ipynb：旧格式与其他本机文件仍不许读", () => {
  // ipynb 在 #169 登记为 view=doc；此处先让桥接接受，避免两个 PR 合并后前端摊开却被服务端拒绝
  assert.deepEqual([...DOC_VIEWABLE].sort(), [".docx", ".ipynb", ".odp", ".ods", ".odt", ".pptx", ".xlsx"]);
  for (const ext of [".env", ".json", ".txt", ".pdf", ".doc", ".zip"]) assert.equal(DOC_VIEWABLE.has(ext), false, ext);
});

test("文档页的壳：一张素纸，样式取言自己的，正文原样进来", () => {
  const inner = '<div class="file-viewer-text markdown"><h1>一、结论</h1></div>',
    html = docPageHtml("报告.docx", inner);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>报告.docx<\/title>/);
  assert.match(html, /<body class="docpage">/);
  assert.ok(html.includes(inner), "正文原样进来");
  const nonce = html.match(/script-src 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.match(html, /default-src 'none'/);
  assert.match(html, /img-src data:/);
  // 样式来自 styles/：变量、正文与预览器那几节都在（少了它们，表格页签与幻灯片的排法会散）
  assert.match(html, /--paper:/);
  assert.match(html, /\.file-viewer-text/);
  assert.match(html, /\.viewer-tabs/);
  assert.match(html, /\.viewer-slide/);
  // 文档排法：16px / 1.8，不沿用浮层那份 14px / 1.85
  assert.match(html, /font-size: 16px; line-height: 1\.8;/);
  // 纸纹是浮层那张小纸的，整屏读时嫌花：文档页要把它压掉
  assert.match(html, /\.docpage \.file-viewer-text \{[^}]*background: none/);
  // 工作表页签：.hidden 那条规则在设置页那一片，文档页没带它，得自带一条，否则几张表会一起摊着
  assert.match(html, /\.docpage \.hidden \{ display: none !important; \}/);
});

test("「以本机程序打开」换成指向原件的链接：独立页里没人接那颗按钮", () => {
  const note = open =>
      `<div class="file-viewer-text markdown"><p class="file-viewer-note">本机按结构抽出，不含原排版 · <button type="button" class="viewer-open-link" data-viewer-open${open}>以本机程序打开</button></p></div>`,
    href = "file:///E:/%E6%A1%88/%E6%8A%A5%E5%91%8A.docx";
  // 两种写法都认：页面里写的是不带值的，过了 innerHTML 会补成 =""
  for (const open of ["", '=""']) {
    const html = docPageHtml("报告.docx", note(open), href);
    assert.ok(html.includes(`<a href="${href}">以本机程序打开</a>`), `成了链接（写法 ${open || "不带值"}）`);
    assert.ok(!html.includes("data-viewer-open"), "按钮不再留着");
    // 别的地方的按钮（如工具条）不该被顺手改掉：只认预览器那一颗的完整写法
    const other = '<div class="file-viewer-text"><button type="button" class="outline-btn" data-viewer-open>别的</button></div>';
    assert.ok(docPageHtml("x.docx", other, href).includes('class="outline-btn"'), "别的按钮不动");
  }
  // 没给原件地址（不该有，但给了也别乱写）：原样留着
  assert.ok(docPageHtml("x.docx", note('=""')).includes("data-viewer-open"));
  // 地址里的引号要逃掉，不然能捅出标签
  assert.ok(!docPageHtml("x.docx", note('=""'), 'file:///a"onmouseover="x.docx').includes('"onmouseover="'));
});

test("文件名的 HTML 记号要逃掉：它进的是 <title>", () => {
  const html = docPageHtml('<a&b>"c".docx', '<div class="file-viewer-text"></div>');
  assert.match(html, /<title>&lt;a&amp;b&gt;&quot;c&quot;\.docx<\/title>/);
});

test("页签元数据变更保留版本；真实导航让在途文档请求失效", () => {
  const { stage, stageNavMark, stageTabInfo } = load(["stage", "stageNavMark", "stageTabInfo"]);
  stage.tabs.set("t1", { title: "旧题", url: "https://example.com/a", ctx: "c1" });
  assert.equal(stageNavMark("t1"), 1, "头一回占码");
  const update = (title, url) => stage.tabs.set("t1", stageTabInfo(stage.tabs.get("t1"), { title, url, browserContextId: "c1" }));
  // 仅修改标题不应白白取消正在抽取的文档
  update("新题", "https://example.com/a");
  assert.equal(stage.tabs.get("t1").nav, 1);
  // 普通链接、执事直接调用 MCP 时不经过 stageGo；靠 targetInfoChanged 的 URL 更新取消旧任务
  update("第二页", "https://example.com/b");
  assert.equal(stage.tabs.get("t1").nav, 2);
  // 同页锚点也是用户主动跳转；浏览器初始化的空 URL 则不能误判
  update("第二页", "https://example.com/b#section");
  assert.equal(stage.tabs.get("t1").nav, 3);
  update("载入中", "");
  assert.equal(stage.tabs.get("t1").nav, 3);
  assert.equal(stage.tabs.get("t1").url, "https://example.com/b#section");
  update("真正下一页", "https://example.com/c");
  assert.equal(stage.tabs.get("t1").nav, 4, "空 URL 之后的真实导航也须取消旧请求");
  // 版本号不因重建对象归零
  assert.equal(stageNavMark("t1"), 5);
  assert.deepEqual([stage.tabs.get("t1").title, stage.tabs.get("t1").ctx], ["真正下一页", "c1"]);
});

test("摊开的文档页认得出来：从它里头点原件链接，是「以本机程序打开」而不是再摊一回", () => {
  const page = "file:///E:/%E8%81%8A%E5%A4%A9/.yan/%E6%B8%B8%E7%9B%AE/%E5%B7%A5%E4%BD%9C/view-2026-11-23T05-47-12-345Z.html";
  assert.equal(stageDocPage(page), true);
  // 带查询、带锚点的仍是同一页
  assert.equal(stageDocPage(`${page}?x=1#top`), true);
  // 别的本机页、网页、名字不像的都不算：那些地方点文档仍该摊开看
  for (const url of [
    "file:///E:/a/report.docx",
    "file:///E:/a/view.html",
    "file:///E:/a/view-2026-11-23.html",
    "file:///E:/a/x-view-2026-11-23T05-47-12-345Z.html.bak",
    "https://a.b/view-2026-11-23T05-47-12-345Z.html",
    "about:blank",
    ""
  ])
    assert.equal(stageDocPage(url), false, url);
});

test("工作目录里只清摊开的文档页：模型起了名字的件一件不动", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "yan-docpage-sweep-")),
    old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    aged = name => {
      const file = path.join(dir, name);
      writeFileSync(file, "x");
      utimesSync(file, old, old);
      return file;
    };
  try {
    // 与 docpage 写出来的名字同形（ISO 时刻里的 : 与 . 换成 -）
    assert.equal(DOCPAGE_FILE.test("view-2026-11-23T05-47-12-345Z.html"), true);
    assert.equal(DOCPAGE_FILE.test("view-2026-11-23T05-47-12-345Z.xlsx"), false);
    const page = aged("view-2026-11-01T12-00-00-000Z.html"),
      report = aged("report-2026-11-01T12-00-00-000Z.xlsx"),
      shot = aged("shot-2026-11-01T12-00-00-000Z.png"),
      fresh = path.join(dir, "view-2026-11-23T12-00-00-000Z.html");
    writeFileSync(fresh, "x");
    sweepOutputs(dir, DOCPAGE_FILE);
    assert.equal(existsSync(page), false, "一天前的文档页清掉");
    assert.equal(existsSync(report), true, "模型给人起的名字：表不动");
    assert.equal(existsSync(shot), true, "截图不动");
    assert.equal(existsSync(fresh), true, "还没到一天的留着");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function docStage(body) {
  const f = load([
      "stage",
      "stageGo",
      "stageShowDoc",
      `setup: (preview, request, send) => {
        fileViewerBody = preview;
        bridge = request;
        stageSend = send;
      }`
    ]),
    requests = [],
    commands = [];
  f.stage.ws = {};
  f.setup(
    () => body,
    async (route, payload) => {
      requests.push([route, payload.url]);
      return { url: "file:///a/view.html" };
    },
    async (method, { url }) => void commands.push([method, url])
  );
  return { ...f, requests, commands };
}

const DOC_ORIGINAL = "file:///a/报告.pptx",
  DOC_BODY = '<div class="file-viewer-slides">正文</div>',
  DOC_EMPTY = '<div class="file-viewer-empty">未能抽出正文</div>';

test("浏览器已连接但起初没有页签：文档另开一页，不占后来出现的页签", async () => {
  const f = docStage(DOC_BODY);
  const viewing = f.stageShowDoc(DOC_ORIGINAL);
  f.stage.tabs.set("later", { nav: 1 });
  f.stage.current = "later";
  f.stage.session = "later-session";
  await viewing;
  assert.deepEqual(f.requests, [["/api/stage/docpage", DOC_ORIGINAL]]);
  assert.deepEqual(f.commands, [["Target.createTarget", "file:///a/view.html"]]);
});

test("起初没有页签而抽不到正文：仍交本机程序打开", async () => {
  const f = docStage(DOC_EMPTY);
  await f.stageShowDoc(DOC_ORIGINAL);
  assert.deepEqual(f.requests, [["/api/stage/open", DOC_ORIGINAL]]);
  assert.deepEqual(f.commands, []);
});

test("发起页后来被关，或起初没有页签却已开了别的地址：不再摊页或弹本机程序", async () => {
  for (const body of [DOC_BODY, DOC_EMPTY]) {
    const closed = docStage(body);
    closed.stage.tabs.set("old", { nav: 1 });
    closed.stage.current = "old";
    const viewing = closed.stageShowDoc(DOC_ORIGINAL);
    closed.stage.tabs.delete("old");
    await viewing;
    assert.deepEqual(closed.requests, []);
    assert.deepEqual(closed.commands, []);

    const replaced = docStage(body);
    const opening = replaced.stageShowDoc(DOC_ORIGINAL);
    replaced.stageGo("about:blank");
    await opening;
    assert.deepEqual(replaced.requests, []);
    assert.deepEqual(replaced.commands, [["Target.createTarget", "about:blank"]]);
  }
});

test("等待临时接入期间页签已经导航：不覆盖新地址，但仍断开这次临时接入", async () => {
  const { stage, stageNavigateIn, stageMessage } = load(["stage", "stageNavigateIn", "stageMessage"]);
  const sent = [];
  stage.ws = { readyState: WebSocket.OPEN, send: value => sent.push(JSON.parse(value)) };
  stage.current = "b";
  stage.tabs.set("a", { nav: 3 });
  const going = stageNavigateIn("a", "file:///a/old.html", 3);
  assert.equal(sent[0].method, "Target.attachToTarget");
  stage.tabs.set("a", { nav: 4 });
  stageMessage({ id: sent[0].id, result: { sessionId: "temporary" } });
  await going;
  assert.deepEqual(
    sent.map(command => command.method),
    ["Target.attachToTarget", "Target.detachFromTarget"]
  );
  stageMessage({ id: sent[1].id, result: {} });
});
