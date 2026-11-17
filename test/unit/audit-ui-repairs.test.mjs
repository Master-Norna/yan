import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";
const EN = createRequire(import.meta.url)("../../i18n/en.js");

test("摘要只翻界面句式，中文关键词、文件名、节点名与其中的分隔符原样保留", () => {
  globalThis.YAN_EN = EN;
  try {
    const { stepText, tr } = load(["stepText", "tr"]);
    for (const query of ["问题", "完成", "文件", "中文", "中文 · 完成", "「文件」的问题"])
      assert.equal(stepText(`关键词「${query}」`), `Query "${query}"`);
    assert.equal(stepText("关键词「问题 · 完成」 · 已写入"), 'Query "问题 · 完成" · Written');
    assert.equal(stepText("已立 1 / 2 · 文件"), "Settled 1 / 2 · 文件");
    assert.equal(tr("这一层已有「完成」"), '"完成" already exists here');
    assert.equal(stepText("https://example.com/问题.txt"), "https://example.com/问题.txt");
    assert.equal(stepText("后台 b1 · 已结束 · 退出码 0 · 出沙箱"), "Background b1 · finished · exit code 0 · outside sandbox");
  } finally {
    delete globalThis.YAN_EN;
  }
});

test("英文的导出与改动详情也翻译存下的中文状态，命令与正文不改", () => {
  globalThis.YAN_EN = EN;
  try {
    const { conversationMarkdown, changeDiffHtml } = load(["conversationMarkdown", "changeDiffHtml"]);
    const step = {
      id: "w",
      name: "write_file",
      status: "done",
      title: "问题.txt",
      result: "已写入",
      written: "原文",
      change: { path: "问题.txt", created: true, added: 1, removed: 0 }
    };
    const message = { role: "assistant", status: "complete", content: "完成", steps: [step] };
    assert.match(conversationMarkdown({ title: "导出", createdAt: "2026-10-15", messages: [message] }), /Write · 问题\.txt → Written/);
    assert.match(changeDiffHtml(message, "问题.txt"), /Write · Written/);
    assert.equal(message.content, "完成");
    assert.equal(step.result, "已写入");
  } finally {
    delete globalThis.YAN_EN;
  }
});

test("CSV / TSV 引号里的换行、分隔符、空行和转义引号不拆成新记录", () => {
  const { parseDelimited } = load(["parseDelimited"]);
  assert.deepEqual(parseDelimited('name,note\r\nAlice,"first\n\nsecond, with ""quotes"""\r\nBob,ok\r\n', ","), [
    ["name", "note"],
    ["Alice", 'first\n\nsecond, with "quotes"'],
    ["Bob", "ok"]
  ]);
  assert.deepEqual(parseDelimited('a\tb\n"x\ty"\t"one\r\ntwo"\n', "\t"), [
    ["a", "b"],
    ["x\ty", "one\r\ntwo"]
  ]);
  assert.deepEqual(parseDelimited('\n\n"",\nlast,\n', ",", 1), [["", ""]]);
  assert.deepEqual(parseDelimited('a,"b,c","d""e",', ","), [["a", "b,c", 'd"e', ""]]);
});

test("切曲或停止会取消尚在等元数据的跳转，新的跳转仍可完成", async () => {
  const el = Object.assign(new EventTarget(), {
    duration: NaN,
    currentTime: 0,
    paused: true,
    src: "",
    removeAttribute() {},
    load() {},
    pause() {},
    playCalls: 0,
    play() {
      this.playCalls++;
      return Promise.resolve();
    }
  });
  const f = load([
    "listenSeek",
    "listenLoad",
    "listenRelease",
    "setup:(track,el)=>{listenTrack=track;document.querySelector=()=>el;listenInit=()=>{};listenSync=()=>{};listenRenderPage=()=>{};listenPageLive=()=>false;}"
  ]);
  const a = { key: "a", url: "http://local/a.wav" },
    b = { key: "b", url: "http://local/b.wav" };
  f.setup(a, el);
  await f.listenSeek(0.8, a);
  await f.listenLoad(b);
  el.duration = 100;
  el.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(el.currentTime, 0);
  assert.equal(el.playCalls, 0);
  el.duration = NaN;
  await f.listenSeek(0.3, b);
  await f.listenSeek(0.6, b);
  el.duration = 100;
  el.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(el.currentTime, 60);
  assert.equal(el.playCalls, 1);
  el.duration = NaN;
  await f.listenSeek(0.1, b);
  f.listenRelease();
  el.duration = 100;
  el.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(el.playCalls, 1);
});

test("大请求直连原接口，不再装进总线 JSON", async () => {
  const native = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: options.body });
    return new Response("{}", { status: 200 });
  };
  try {
    const f = load(["bridgeFetch", "setup:()=>{busOpen=true;busTried=true;busSource={close(){}};}"]);
    f.setup();
    const body = "x".repeat(4 * 1024 * 1024 + 1);
    await f.bridgeFetch("/api/archive/put", body);
    assert.deepEqual(
      calls.map(call => call.url),
      ["/api/archive/put"]
    );
    assert.equal(calls[0].body, body);
  } finally {
    globalThis.fetch = native;
  }
});
