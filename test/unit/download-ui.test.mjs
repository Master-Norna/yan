import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = file => readFileSync(new URL(`../../src/${file}`, import.meta.url), "utf8");
// 只载入这几条入口及真实下载助手，DOM 和计时器在边界记录，不另写一份下载逻辑。
function section(file, from, to) {
  const text = source(file),
    start = text.indexOf(from),
    end = to ? text.indexOf(to, start) : text.length;
  assert.ok(start >= 0 && end > start, `找不到源码片段：${file} ${from}`);
  return text.slice(start, end);
}
const downloads = [
  section("03-ui-utils.js", "function downloadHref(", "// 把正文里的某条消息滚到视口"),
  section("13-files/00-ingest.js", "async function downloadAttachment("),
  section("13-files/15-refs.js", "function localFileUrl(", "/** 一答的正文"),
  section("13-files/20-viewer.js", "function skillFileUrl(", "async function viewerReader("),
  section("13-files/20-viewer.js", "function downloadViewerFile(", "async function fileViewerBody("),
  section("17-settings/20-backup.js", "async function exportData(", "// 附件 id 对应的名字")
].join("\n");

function setup(overrides = {}) {
  const clicks = [],
    timers = [],
    revoked = [],
    blobs = [],
    blobParts = [],
    notices = [];
  const context = vm.createContext({
    document: {
      createElement(tag) {
        assert.equal(tag, "a");
        return {
          click() {
            clicks.push({ href: this.href, name: this.download });
          }
        };
      }
    },
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return `blob:download-${blobs.length}`;
      },
      revokeObjectURL: href => revoked.push(href)
    },
    Blob: class extends Blob {
      constructor(parts, options) {
        super(parts, options);
        blobParts.push({ blob: this, parts, options });
      }
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
    },
    Date: class extends Date {
      constructor(...args) {
        super(...(args.length ? args : ["2026-11-17T12:00:00Z"]));
      }
    },
    AbortSignal,
    t: (text, ...values) => (typeof text === "string" ? text : text.reduce((s, part, i) => s + part + (values[i] ?? ""), "")),
    toast: message => notices.push(message),
    bridge: async () => ({ has: [] }),
    getAttachment: async () => null,
    attachmentBlob: file => new Blob([file.data]),
    viewerSource: null,
    ...overrides
  });
  vm.runInContext(downloads, context);
  return {
    context,
    clicks,
    timers,
    revoked,
    blobs,
    blobParts,
    notices,
    recycle() {
      assert.equal(timers.length, 1);
      assert.equal(timers[0].delay, 1000);
      assert.deepEqual(revoked, []);
      timers[0].callback();
      assert.deepEqual(revoked, [clicks[0].href]);
    },
    noRecycle() {
      assert.deepEqual(timers, []);
      assert.deepEqual(revoked, []);
      assert.deepEqual(blobs, []);
    }
  };
}

test("磁盘附件留空 download，由服务端给原名，不回收同源 URL", async () => {
  const run = setup({
    bridge: async (path, body) => {
      assert.equal(path, "/api/files/has");
      assert.equal(body.ids[0], "附件 &1");
      return { has: ["附件 &1"] };
    },
    getAttachment: () => assert.fail("磁盘原件不读进页面")
  });
  await run.context.downloadAttachment("附件 &1");
  assert.deepEqual(run.clicks, [{ href: `/api/files/raw?id=${encodeURIComponent("附件 &1")}&download=1`, name: "" }]);
  run.noRecycle();
});

test("浏览器暂存附件保留原名或兜底名，Blob URL 一秒后回收", async () => {
  for (const [name, expected] of [
    ["报告.bin", "报告.bin"],
    ["", "附件"]
  ]) {
    const run = setup({
      bridge: async () => {
        throw Error("offline");
      },
      getAttachment: async () => ({ name, data: "original bytes" })
    });
    await run.context.downloadAttachment("local");
    assert.deepEqual(run.clicks, [{ href: "blob:download-1", name: expected }]);
    assert.equal(await run.blobs[0].text(), "original bytes");
    run.recycle();
  }
});

test("本机文件保留末段文件名或卷宗兜底名，不回收服务端 URL", () => {
  for (const [file, name] of [
    ["E:/文档/图 #1.png", "图 #1.png"],
    ["E:/文档/", "卷宗"]
  ]) {
    const run = setup();
    run.context.downloadFile(file);
    assert.deepEqual(run.clicks, [{ href: `/api/archive/file?file=${encodeURIComponent(file)}&download=1`, name }]);
    run.noRecycle();
  }
});

test("技能文件保留末段文件名或空名，不回收服务端 URL", () => {
  for (const [skillPath, name] of [
    ["assets/图 #1.png", "图 #1.png"],
    ["assets/", ""]
  ]) {
    const run = setup({ viewerSource: { skillDir: "design", skillPath } });
    run.context.downloadViewerFile();
    assert.deepEqual(run.clicks, [{ href: `/api/skills/raw?dir=design&path=${encodeURIComponent(skillPath)}&download=1`, name }]);
    run.noRecycle();
  }
});

for (const includeFiles of [false, true])
  test(`备份${includeFiles ? "含原件时逐件拼 Blob" : "不含原件时保持缩进 JSON"}，命名与一秒回收不变`, async () => {
    const store = {
      conversations: [{ id: "chat", messages: [{ role: "user", content: "hello" }] }],
      settings: {
        mcpServers: { tool: { command: "tool", env: { TOKEN: "secret" }, headers: { Authorization: "secret" } } },
        dutyReview: { apiKey: "secret", model: "review" },
        dutyImage: { apiKey: "secret", model: "image" }
      },
      profiles: [{ id: "profile", apiKey: "secret" }]
    };
    const original = JSON.stringify(store),
      records = [
        { id: "a", name: "原件.bin", data: "abc" },
        { id: "b", name: "图.png", data: "xyz" }
      ],
      warmed = [],
      uncached = [];
    const run = setup({
      store,
      warmConversation: async c => warmed.push(c.id),
      everyMessage: c => c.messages,
      warmMessages: new Set(),
      now: () => "export-time",
      attachmentKeepIds: () => records.map(record => record.id),
      getAttachment: async id => records.find(record => record.id === id),
      uncacheAttachment: id => uncached.push(id)
    });
    await run.context.exportData(includeFiles);
    assert.deepEqual(warmed, ["chat"]);
    assert.deepEqual(run.clicks, [{ href: "blob:download-1", name: "言-备份-2026-11-17.json" }]);
    assert.equal(run.blobs.length, 1);
    assert.equal(run.blobs[0].type, "application/json");
    const expected = JSON.parse(original);
    delete expected.settings.mcpServers.tool.env;
    delete expected.settings.mcpServers.tool.headers;
    expected.settings.dutyReview.apiKey = "";
    expected.settings.dutyImage.apiKey = "";
    expected.profiles[0].apiKey = "";
    expected.exportedAt = "export-time";
    if (includeFiles) expected.attachments = records;
    assert.equal(await run.blobs[0].text(), JSON.stringify(expected, null, includeFiles ? 0 : 2));
    assert.equal(JSON.stringify(store), original, "导出不改活对象");
    assert.deepEqual(uncached, includeFiles ? ["a", "b"] : []);
    assert.equal(run.blobParts.length, includeFiles ? 4 : 1);
    if (includeFiles) {
      for (let i = 1; i < run.blobParts.length; i++) assert.equal(run.blobParts[i].parts[0], run.blobParts[i - 1].blob);
      assert.equal(run.blobs[0], run.blobParts.at(-1).blob, "交出拼好的 Blob，不转大字符串再重建");
      for (let i = 0; i < records.length; i++) assert.equal(run.blobParts[i + 1].parts[2], JSON.stringify(records[i]));
    }
    run.recycle();
  });

test("downloadText 原有 MIME、命名和回收保持不变", async () => {
  const run = setup();
  run.context.downloadText("一段文字", "text/plain", "文字.txt");
  assert.deepEqual(run.clicks, [{ href: "blob:download-1", name: "文字.txt" }]);
  assert.equal(await run.blobs[0].text(), "一段文字");
  assert.equal(run.blobs[0].type, "text/plain");
  run.recycle();
});
