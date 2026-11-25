import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("执行时只认这一轮交给模型的工具：旁注只给了查的，模型照名字调写文件也不执行", async () => {
  const { runTool, TOOLS } = load(["runTool", "TOOLS"]);
  assert.ok(TOOLS.get("write_file")?.run);
  const step = { id: "s1", name: "write_file", arguments: JSON.stringify({ path: "a.txt", content: "x" }) };
  const outcome = await runTool(step, { offered: new Set(["web_search", "fetch_url"]) });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.display, "此处未提供");
  // 帮手照名字调只给主模型的：仍说清是无权
  const delegate = [...TOOLS.values()].find(tool => tool.mainOnly && tool.run);
  const sub = await runTool({ id: "s2", name: delegate.name, arguments: "{}", scope: "sub-1" }, { offered: new Set(["web_search"]) });
  assert.equal(sub.display, "帮手无权");
});

test("合并：一页展开了较早的回复，另一页重答了后面的一答，收进分支的旧答不再接回来", () => {
  const { mergeConversation } = load(["mergeConversation"]);
  const base = {
    id: "c",
    title: "题",
    unread: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [
      { id: "u1", role: "user", content: "一问" },
      { id: "a1", role: "assistant", content: "一答" },
      { id: "u2", role: "user", content: "二问" },
      { id: "a2", role: "assistant", content: "旧二答" }
    ],
    forks: [],
    threads: []
  };
  const ours = structuredClone(base);
  ours.messages[1].reasoningOpen = true;
  const theirs = structuredClone(base);
  theirs.forks = [{ id: "f1", messages: [theirs.messages.pop()] }];
  theirs.messages.push({ id: "a3", role: "assistant", content: "新二答" });
  const merged = mergeConversation(ours, theirs, base);
  assert.deepEqual(
    merged.messages.map(m => m.id),
    ["u1", "a1", "u2", "a3"]
  );
  assert.equal(merged.messages[1].reasoningOpen, true);
  assert.equal(merged.forks.length, 1);
});

test("旁注与后台帮手也算这边正在写：同步不把它们手上的对象换掉，且帮手那一段按节流落盘", () => {
  const { busyHere, conversationsToSave, requestJobs, crews } = load(["busyHere", "conversationsToSave", "requestJobs", "crews"]);
  assert.equal(busyHere("c"), false);
  requestJobs.set("side:t1", { conversationId: "c" });
  assert.equal(busyHere("c"), true);
  requestJobs.clear();
  crews.set("c", [{}]);
  assert.equal(busyHere("c"), true);
  assert.ok(conversationsToSave().has("c"), "帮手在后台做的那一段也要进待存名单");
});

test("用量记在此刻表里的那份模型上：作答途中配置同步换过模型列表也不漏", () => {
  const { spendTokens, setProfiles } = load(["spendTokens", "setProfiles: list => { store.profiles = list; }"]);
  const old = { id: "p", usedTokens: 5 },
    fresh = { id: "p", usedTokens: 5 };
  setProfiles([fresh]);
  assert.equal(spendTokens(old, 30), fresh);
  assert.equal(fresh.usedTokens, 35);
  assert.equal(old.usedTokens, 5);
});

test("附件读到一半换了对话：读好的归点选时那一段的草稿，不落进眼前这段", () => {
  const f = load([
    "placeAttachment",
    "pending: () => pendingAttachments",
    "drafts: () => store.drafts",
    "open: (id, list = []) => { currentId = id; pendingAttachments = list; }"
  ]);
  f.open("A");
  f.placeAttachment("A", { id: "x1" });
  assert.deepEqual(
    f.pending().map(file => file.id),
    ["x1"]
  );
  f.open("B");
  f.placeAttachment("A", { id: "x2" });
  assert.deepEqual(f.pending(), []);
  // 读好一件随即记进草稿（读着后面的时候页面重画也不丢），所以 A 的草稿里先前那件也在
  assert.deepEqual(
    f.drafts().A.attachments.map(file => file.id),
    ["x1", "x2"]
  );
});

test("等待开工时接着写的、又置入的留在案上，只发点发送那一刻的", () => {
  const f = load([
    "takeComposer",
    "composerSnapshot",
    "setPending: list => { pendingAttachments = list; currentId = 'A'; store.drafts = {}; renderAttachments = renderQuote = () => {}; }"
  ]);
  const first = { id: "f1" },
    later = { id: "f2" },
    input = { value: "第一句", style: {}, scrollHeight: 40 };
  f.setPending([first]);
  const snapshot = f.composerSnapshot(input);
  input.value = "第一句 又补一句";
  f.setPending([first, later]);
  const user = f.takeComposer(input, "A", snapshot);
  assert.equal(user.content, "第一句");
  assert.deepEqual(
    user.attachments.map(file => file.id),
    ["f1"]
  );
  assert.equal(input.value, "又补一句");
});

test("工具交回的图随工具结果附上：一答里只留最新一批，看不了图的模型去掉图后此后不再附", () => {
  const { attachToolImages, dropToolImages } = load(["attachToolImages", "dropToolImages"]);
  const profile = { id: "p" },
    history = [{ role: "tool", tool_call_id: "a", content: "截好了" }];
  attachToolImages(history, ["data:image/png;base64,AAA"], profile);
  const first = history.at(-1);
  assert.equal(first.content.filter(part => part.type === "image_url").length, 1);
  attachToolImages(history, ["data:image/png;base64,BBB"], profile);
  assert.equal(typeof first.content, "string");
  assert.equal(history.at(-1).content[1].image_url.url, "data:image/png;base64,BBB");
  // 别的 4xx（思考签名之类）不算看不了图
  assert.equal(dropToolImages(history, profile, "messages.3: invalid thinking signature"), false);
  assert.equal(dropToolImages(history, profile, "This model does not support image input"), true);
  assert.equal(typeof history.at(-1).content, "string");
  assert.equal(dropToolImages(history, profile, "image input not supported"), false);
  const before = history.length;
  attachToolImages(history, ["data:image/png;base64,CCC"], profile);
  assert.equal(history.length, before);
});

test("MCP 结果里的图存成附件挂在这一步上，交回 data: 地址", async () => {
  const f = load(["mcpResultImages", "mcpResultText", "stubPut: fn => { putAttachment = fn; }"]);
  const saved = [];
  f.stubPut(async record => saved.push(record));
  const step = { id: "s", title: "截取画面" };
  const result = {
    content: [
      { type: "text", text: "已截" },
      { type: "image", mimeType: "image/jpeg", data: "QUJD" }
    ]
  };
  const { names, images } = await f.mcpResultImages(step, result);
  assert.deepEqual(images, ["data:image/jpeg;base64,QUJD"]);
  assert.equal(step.attachments.length, 1);
  assert.equal(step.attachments[0].name, "画面-s.jpg");
  assert.equal(step.attachments[0].data, undefined);
  assert.equal(saved[0].data, "data:image/jpeg;base64,QUJD");
  assert.match(f.mcpResultText(result, names), /「画面-s\.jpg」，附在工具结果之后；回复里写 !\[\]\(画面-s\.jpg\)/);
  // 服务自己报了存成什么文件（Playwright 截图）：用那个名字，模型照它写也对得上
  const step2 = { id: "s2" };
  await f.mcpResultImages(step2, {
    content: [
      { type: "text", text: "Took the viewport screenshot and saved it as E:\\out\\page-2026-10-02T01-33-26-201Z.png" },
      { type: "image", mimeType: "image/png", data: "QUJD" }
    ]
  });
  assert.equal(step2.attachments[0].name, "page-2026-10-02T01-33-26-201Z.png");
});

test("MCP 工具名只含字母数字与 _-：中文服务名、超长名、撞名的尾巴都不带冒号", () => {
  const { mcpFunctionName, nameHash } = load(["mcpFunctionName", "nameHash"]);
  const valid = /^[a-zA-Z0-9_-]{1,64}$/;
  for (const name of [
    mcpFunctionName("天籁", "synthesize"),
    mcpFunctionName("景语", "渲染"),
    mcpFunctionName("浏览器", "browser_navigate"),
    mcpFunctionName("server", "x".repeat(80)),
    `mcp__a__b_${nameHash("a:b")}`
  ])
    assert.match(name, valid);
  assert.notEqual(mcpFunctionName("天籁", "t"), mcpFunctionName("景语", "t"));
});
