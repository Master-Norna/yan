// 纯函数：工具参数救治、流式分段、diff 计数、汉字数字、余墨、思考档位、只读指令、输出裁行……
// 用法：node --test test/unit/    （npm test 会先跑这里，再跑 e2e）
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load([
  "parseToolArguments",
  "normalizeToolArguments",
  "repairTruncatedJson",
  "stableCut",
  "diffCounts",
  "chineseNumber",
  "parseTokenLimit",
  "formatTokens",
  "nearestReasoning",
  "learnReasoningLevels",
  "isReadOnlyCommand",
  "clampLines",
  "normalizeDraft",
  "reasoningLive",
  "estimateText",
  "splitDelimited",
  "parseVizJson",
  "titleFrom",
  "quotedText",
  "limitLabel",
  "fileTypeLabel",
  "trailGroups",
  "repairEchartsOption",
  "PROMPTS"
]);
// 工具的 schema 在 prompts/tools.js 里（挂在 window.YAN_PROMPTS 上）；这里把它接进来，参数归位才有 schema 可查
const { createRequire } = await import("node:module");
const req = createRequire(import.meta.url);
{
  const src = (await import("node:fs")).readFileSync(req.resolve("../../prompts/tools.js"), "utf8");
  const win = { YAN_PROMPTS: {} };
  new Function("window", src)(win);
  Object.assign(f.PROMPTS, win.YAN_PROMPTS);
}

test("parseToolArguments：正常 JSON、空串、围栏、尾逗号、二次编码", () => {
  assert.deepEqual(f.parseToolArguments('{"path":"a.js"}'), { ok: true, args: { path: "a.js" } });
  assert.deepEqual(f.parseToolArguments(""), { ok: true, args: {} });
  assert.deepEqual(f.parseToolArguments('```json\n{"path":"a.js"}\n```').args, { path: "a.js" });
  assert.deepEqual(f.parseToolArguments('{"path":"a.js",}').args, { path: "a.js" });
  assert.deepEqual(f.parseToolArguments(JSON.stringify('{"path":"a.js"}')).args, { path: "a.js" });
  assert.deepEqual(f.parseToolArguments("[1,2]").args, { questions: [1, 2] });
});
test("parseToolArguments：截断的 JSON 能救则救，并打上 truncated", () => {
  const r = f.parseToolArguments('{"path":"a.js","content":"abc');
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.args.path, "a.js");
  const bad = f.parseToolArguments("not json at all");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /JSON/);
});
test("repairTruncatedJson：先补括号，再退到最后一个安全逗号", () => {
  assert.deepEqual(f.repairTruncatedJson('{"a":1,"b":[1,2'), ['{"a":1,"b":[1,2]}', '{"a":1,"b":[1]}']);
  assert.deepEqual(f.repairTruncatedJson('{"a":1}'), []);
});
test("normalizeToolArguments：别名归位、类型理顺、缺必填才报", () => {
  const { args, problems } = f.normalizeToolArguments("edit_file", {
    file_path: "a.js",
    old_string: "x",
    new_string: "y",
    replace_all: "true"
  });
  assert.deepEqual(problems, []);
  assert.equal(args.path, "a.js");
  assert.equal(args.old, "x");
  assert.equal(args.new, "y");
  assert.equal(args.replace_all, true);
  assert.deepEqual(f.normalizeToolArguments("write_file", { content: "x" }).problems, ["缺少必填参数 path"]);
  // ask_user 把单题摊在顶层：包成一项
  const ask = f.normalizeToolArguments("ask_user", { question: "哪种？", options: ["甲", "乙"] }).args;
  assert.equal(ask.questions.length, 1);
  assert.equal(ask.questions[0].question, "哪种？");
});
test("stableCut：在最后一个空行切，不切进未闭合的代码围栏或列表中间", () => {
  assert.equal(f.stableCut("a\n\nb\n\nc"), 4);
  assert.equal(f.stableCut("a\n\n```js\nx\n\ny"), 1);
  assert.equal(f.stableCut("- a\n\n- b"), 0);
  assert.equal(f.stableCut("abc"), 0);
});
test("diffCounts：新建全算增、删除全算减、其余按最长公共子序列", () => {
  assert.deepEqual(f.diffCounts("", "a\nb"), { added: 2, removed: 0 });
  assert.deepEqual(f.diffCounts("a\nb", ""), { added: 0, removed: 2 });
  assert.deepEqual(f.diffCounts("a\nb\nc", "a\nx\nc"), { added: 1, removed: 1 });
  assert.deepEqual(f.diffCounts("a", "a"), { added: 0, removed: 0 });
});
test("chineseNumber：一、两问、十二、二十三，过百回退阿拉伯数字", () => {
  assert.equal(f.chineseNumber(1), "一");
  assert.equal(f.chineseNumber(2, true), "两");
  assert.equal(f.chineseNumber(10), "十");
  assert.equal(f.chineseNumber(12), "十二");
  assert.equal(f.chineseNumber(23), "二十三");
  assert.equal(f.chineseNumber(100), "100");
});
test("parseTokenLimit / formatTokens：k、m、e 三档，非法为 null", () => {
  assert.equal(f.parseTokenLimit("100"), 100000);
  assert.equal(f.parseTokenLimit("1.5m"), 1500000);
  assert.equal(f.parseTokenLimit("2e"), 200000000);
  assert.equal(f.parseTokenLimit("abc"), null);
  assert.equal(f.parseTokenLimit("0"), null);
  assert.equal(f.formatTokens(999), "999");
  assert.equal(f.formatTokens(1234), "1.2k");
  assert.equal(f.formatTokens(123456), "123k");
  assert.equal(f.formatTokens(2500000), "2.5m");
});
test("nearestReasoning：认的原样用，不认取最近的一档，同样近取高的", () => {
  const p = { reasoningLevels: "low, medium, xhigh" };
  assert.equal(f.nearestReasoning(p, "medium"), "medium");
  assert.equal(f.nearestReasoning(p, "high"), "xhigh");
  assert.equal(f.nearestReasoning(p, "minimal"), "low");
  assert.equal(f.nearestReasoning({}, "xhigh"), "high");
  assert.equal(f.nearestReasoning(p, "off"), "off");
});
test("learnReasoningLevels：从报错里认出接口支持的几档，被拒的那档不算", () => {
  const p = { id: "p", reasoningLevels: "" };
  assert.equal(f.learnReasoningLevels(p, "Invalid value: 'high'. Supported values are: 'low', 'medium', and 'xhigh'.", "high"), true);
  assert.equal(p.reasoningLevels, "low, medium, xhigh");
  assert.equal(f.learnReasoningLevels(p, "rate limited", "high"), false);
});
test("isReadOnlyCommand：只读命令免确认，带管道 / 重定向 / 串联的不算", () => {
  assert.equal(f.isReadOnlyCommand("git status"), true);
  assert.equal(f.isReadOnlyCommand("Get-ChildItem src"), true);
  assert.equal(f.isReadOnlyCommand("node --version"), true);
  assert.equal(f.isReadOnlyCommand("git status | grep x"), false);
  assert.equal(f.isReadOnlyCommand("rm -rf ."), false);
  assert.equal(f.isReadOnlyCommand("cat a > b"), false);
});
test("clampLines：默认只露前 10 行，full 时全给", () => {
  const text = Array.from({ length: 14 }, (_, i) => `l${i}`).join("\n");
  const c = f.clampLines(text, false);
  assert.equal(c.clipped, true);
  assert.equal(c.total, 14);
  assert.equal(c.text.split("\n").length, 10);
  assert.equal(f.clampLines(text, true).clipped, false);
  assert.equal(f.clampLines("a\nb", false).clipped, false);
});
test("normalizeDraft：旧版字符串、残缺对象都归一成 { text, attachments, quote }", () => {
  assert.deepEqual(f.normalizeDraft("hi"), { text: "hi", attachments: [], quote: null });
  assert.deepEqual(f.normalizeDraft(null), { text: "", attachments: [], quote: null });
  assert.deepEqual(f.normalizeDraft({ text: "a", quote: { text: "q", messageId: "m" }, attachments: "x" }), {
    text: "a",
    attachments: [],
    quote: { text: "q", messageId: "m" }
  });
});
test("reasoningLive：按轮看——上次工具调用之后有新思绪、正文未起笔才算在写", () => {
  const base = { status: "streaming", reasoning: "想一想", content: "" };
  assert.equal(f.reasoningLive(base), true);
  assert.equal(f.reasoningLive({ ...base, content: "正文" }), false);
  // 第一轮已有正文、请示之后又想：steps 记着第一轮结束时的位置
  const round2 = { status: "streaming", reasoning: "想一想再想", content: "先问一下。", steps: [{ at: 5, rat: 3 }] };
  assert.equal(f.reasoningLive(round2), true);
  assert.equal(f.reasoningLive({ ...round2, content: "先问一下。答：" }), false);
  assert.equal(f.reasoningLive({ ...round2, status: "complete" }), false);
});
test("estimateText：汉字一字一 token，其余四字一 token", () => {
  assert.equal(f.estimateText("你好"), 2);
  assert.equal(f.estimateText("abcdefgh"), 2);
  assert.equal(f.estimateText("你好ab"), 3);
});
test("splitDelimited：引号里的分隔符与转义引号", () => {
  assert.deepEqual(f.splitDelimited('a,"b,c","d""e"', ","), ["a", "b,c", 'd"e']);
  assert.deepEqual(f.splitDelimited("a\tb", "\t"), ["a", "b"]);
});
test("parseVizJson：注释、尾逗号、单引号、裸键名逐层修补", () => {
  assert.deepEqual(f.parseVizJson('{"a":1}'), { a: 1 });
  assert.deepEqual(f.parseVizJson('{ /* c */ "a": 1, // x\n "b": [1,2,], }'), { a: 1, b: [1, 2] });
  assert.deepEqual(f.parseVizJson("{ title: { text: 'T' } }"), { title: { text: "T" } });
  assert.throws(() => f.parseVizJson("{ nope"));
});
test("titleFrom / quotedText：标题截 28 字，引文按 > 逐行前缀", () => {
  assert.equal(f.titleFrom("  a   b  ", []), "a b");
  assert.equal(f.titleFrom("", [{ name: "x.pdf" }]), "关于 x.pdf");
  assert.equal(f.titleFrom("一".repeat(40), []).length, 29);
  assert.equal(f.quotedText({ content: "为何", quote: { text: "甲\n乙" } }), "> 甲\n> 乙\n\n为何");
  assert.equal(f.quotedText({ content: "x" }), "x");
});
test("limitLabel / fileTypeLabel：上限的标签与文件类型角标", () => {
  assert.equal(f.limitLabel(32 * 1048576), "32 MB");
  assert.equal(f.limitLabel(2048 * 1048576), "2 GB");
  assert.equal(f.fileTypeLabel({ name: "a.tar.gz" }), "GZ");
  assert.equal(f.fileTypeLabel({ name: "noext", mime: "image/png" }), "PNG");
  assert.equal(f.fileTypeLabel({ name: "x.markdownfile" }), "MARKDOW");
});
test("trailGroups：同一轮的步骤归一组，记下这轮的话与思绪的起止", () => {
  const groups = f.trailGroups({
    steps: [
      { at: 3, rat: 2 },
      { at: 3, rat: 2 },
      { at: 9, rat: 5 }
    ]
  });
  assert.equal(groups.length, 2);
  assert.deepEqual([groups[0].from, groups[0].at, groups[0].steps.length], [0, 3, 2]);
  assert.deepEqual([groups[1].from, groups[1].at, groups[1].rfrom, groups[1].rat], [3, 9, 2, 5]);
});
test("repairEchartsOption：系列指到不存在的轴、轴指到不存在的格子都收回来，漏了 type 按数据补", () => {
  const fixed = f.repairEchartsOption({
    grid: [{}, {}],
    xAxis: [{ gridIndex: 0 }, { gridIndex: 3 }],
    yAxis: [{ gridIndex: 0 }, { gridIndex: 1 }],
    series: [
      { data: [1, 2], xAxisIndex: 5, yAxisIndex: 1 },
      { data: [{ name: "a", value: 1 }], xAxisIndex: 0, yAxisIndex: 0 }
    ]
  });
  assert.equal(fixed.xAxis[1].gridIndex, 1);
  assert.equal(fixed.series[0].xAxisIndex, 1);
  assert.equal(fixed.series[0].type, "bar");
  const pie = f.repairEchartsOption({ series: { data: [{ name: "a", value: 1 }] } });
  assert.equal(pie.series[0].type, "pie");
  assert.equal(pie.series[0].xAxisIndex, undefined);
});
