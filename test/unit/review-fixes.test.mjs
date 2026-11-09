// 2026-10-01 全面检查修的几处：草稿里游目引文的两份、言里的 check_command、「读过才能改」从步骤推出、温度留空不传
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

// 工具说明照页面那样挂在 YAN_PROMPTS 上
const prompts = {};
new Function("window", readFileSync(new URL("../../prompts/tools.js", import.meta.url), "utf8"))({ YAN_PROMPTS: prompts });

test("草稿：游目圈点的引文留着给模型的那份与网址", () => {
  const f = load(["normalizeDraft"]);
  const draft = f.normalizeDraft({
    text: "看这里",
    attachments: [],
    quote: { text: "游目 · 例", model: "圈：网页左 1、上 2", url: "https://example.com/" }
  });
  assert.deepEqual(draft.quote, { text: "游目 · 例", messageId: "", model: "圈：网页左 1、上 2", url: "https://example.com/" });
  // 正文划选的引文照旧只有两样
  assert.deepEqual(f.normalizeDraft({ text: "", attachments: [], quote: { text: "一段", messageId: "m1" } }).quote, {
    text: "一段",
    messageId: "m1"
  });
});

test("言里给了 run_command 就也给 check_command（后台指令开了要看得了）", () => {
  const f = load([
    "toolDefinitions",
    `setup: tools => {
      PROMPTS.tools = tools;
      bootstrap = { work: { archive: "C:\\\\卷宗", platform: "win32" } };
    }`
  ]);
  f.setup(prompts.tools);
  const names = conversation => (f.toolDefinitions(conversation) || []).map(tool => tool.function.name);
  const chat = names({ id: "c", messages: [] }),
    work = names({ id: "w", messages: [], workdir: "E:\\demo" });
  assert.ok(chat.includes("run_command") && chat.includes("check_command"), chat.join(","));
  assert.ok(work.includes("check_command"));
  // 言里仍不给只属于行的几件
  assert.ok(!chat.includes("edit_file") && !chat.includes("search_files"));
});

test("读过才能改：看这段对话里做完的读写，分帮手、分目录，刷新也不丢", () => {
  const f = load(["seenBefore", `setup: () => { bootstrap = { work: { platform: "win32" } }; }`]);
  f.setup();
  const read = (title, extra = {}) => ({
    id: Math.random().toString(),
    name: "read_file",
    status: "done",
    title,
    root: "E:\\demo",
    ...extra
  });
  const editing = (scope = undefined) => ({
    id: "e",
    name: "edit_file",
    status: "running",
    title: "src/a.js",
    ...(scope ? { scope } : {})
  });
  const conversation = steps => ({ id: "c", workdir: "E:\\demo", messages: [{ id: "m", role: "assistant", content: "", steps }] });

  assert.equal(f.seenBefore(conversation([]), editing(), "src/a.js"), false);
  // 读时写相对路径、改时写绝对路径，大小写不同：是同一件
  assert.equal(f.seenBefore(conversation([read("src/a.js")]), editing(), "E:\\demo\\SRC\\a.js"), true);
  // 没读成的不算
  assert.equal(f.seenBefore(conversation([read("src/a.js", { status: "error" })]), editing(), "src/a.js"), false);
  // 主模型读过的，帮手不算读过；帮手自己的步骤挂在差遣那一步上
  const helper = { id: "d", name: "delegate", status: "running", sub: { id: "sub1", steps: [read("src/a.js", { scope: "sub1" })] } };
  assert.equal(f.seenBefore(conversation([read("src/a.js")]), editing("sub1"), "src/a.js"), false);
  assert.equal(f.seenBefore(conversation([helper]), editing("sub1"), "src/a.js"), true);
  assert.equal(f.seenBefore(conversation([helper]), editing(), "src/a.js"), false);
  // 中途换了目录：先前目录里读的不算；早先没记目录的照算
  assert.equal(f.seenBefore(conversation([read("src/a.js", { root: "E:\\old" })]), editing(), "src/a.js"), false);
  assert.equal(f.seenBefore(conversation([read("src/a.js", { root: undefined })]), editing(), "src/a.js"), true);
});

test("温度：模型设置里留空就不传，填了才传", async () => {
  const f = load([
    "requestChat",
    `setup: capture => { bridgeFetch = async (path, body) => { capture(JSON.parse(body)); return new Response("{}"); }; }`
  ]);
  const bodies = [];
  f.setup(body => bodies.push(body));
  const profile = { id: "p", name: "m", model: "m", baseUrl: "https://example.com/v1", apiKey: "" };
  await f.requestChat(profile, [{ role: "user", content: "x" }], undefined);
  await f.requestChat({ ...profile, temperature: 0.4 }, [{ role: "user", content: "x" }], undefined);
  await f.requestChat({ ...profile, temperature: 0 }, [{ role: "user", content: "x" }], undefined);
  assert.equal("temperature" in bodies[0], false);
  assert.equal(bodies[1].temperature, 0.4);
  assert.equal(bodies[2].temperature, 0);
});

test("迁移 v6：旧默认的 0.7 清掉、亲手填的留下；断旧的几样读到即去", () => {
  const f = load(["normalizeStoreData", "STORE_VERSION"]);
  const old = f.normalizeStoreData({
    version: 5,
    settings: { chatsDir: "C:\\旧", archiveDir: "C:\\旧卷宗", reasoning: "high", workAutoDefault: true },
    profiles: [
      { id: "a", name: "A", temperature: 0.7, source: "custom", systemPrompt: "" },
      { id: "b", name: "B", temperature: 0.3 }
    ],
    conversations: [{ id: "c", messages: [], ended: true, workAuto: true, commandPolicy: "review" }],
    library: [{ id: "x" }]
  });
  assert.equal(old.version, f.STORE_VERSION);
  assert.equal("temperature" in old.profiles[0], false);
  assert.equal(old.profiles[1].temperature, 0.3);
  assert.ok(!("source" in old.profiles[0]) && !("systemPrompt" in old.profiles[0]));
  assert.ok(!("library" in old));
  for (const key of ["chatsDir", "archiveDir", "reasoning", "workAutoDefault"]) assert.ok(!(key in old.settings), key);
  assert.ok(!("ended" in old.conversations[0]) && !("workAuto" in old.conversations[0]));
  assert.equal(old.conversations[0].commandPolicy, "review");
  // 迁过之后亲手再填 0.7：不再被当成旧默认清掉
  assert.equal(f.normalizeStoreData({ version: 6, profiles: [{ id: "a", temperature: 0.7 }] }).profiles[0].temperature, 0.7);
});
