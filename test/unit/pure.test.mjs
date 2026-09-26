// 纯函数：工具参数救治、流式分段、diff 计数、汉字数字、余墨、思考档位、只读指令、输出裁行……
// 用法：node --test test/unit/    （npm test 会先跑这里，再跑 e2e）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

// 图表 option 的修补跑在交互预览的 iframe 里（preview-runtime.js），那一段是纯函数：单独取出来测
const runtime = readFileSync(new URL("../../preview-runtime.js", import.meta.url), "utf8");
const repairEchartsOption = new Function(
  `${runtime.match(/ {2}function repairEchartsOption[\s\S]*?\r?\n {2}\}\r?\n/)[0]}; return repairEchartsOption;`
)();

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
  "reasoningChoices",
  "reasoningFields",
  "parseReasoningLevels",
  "reasoningProbed",
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
  "anthropicRequest",
  "anthropicToOpenAiStream",
  "anthropicEndpoint",
  "anthropicLike",
  "PROMPTS",
  "mergeConfig3",
  "looksLikeMermaid",
  "liftBareMermaid"
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
  assert.equal(f.nearestReasoning({}, "xhigh"), "max");
  assert.equal(f.nearestReasoning({}, "high"), "high");
  // 旧版菜单上的「关」：按「默认」看
  assert.equal(f.nearestReasoning(p, "off"), "");
  assert.equal(f.reasoningChoices({}).join(), ",low,medium,high,max");
  assert.deepEqual(f.reasoningFields({ baseUrl: "https://example.com/v1" }, "off"), {});
  // 探过是 none：不认思考档位，菜单只剩「默认」，选了什么都不带字段
  const none = { reasoningLevels: "none", baseUrl: "https://example.com/v1" };
  assert.equal(f.reasoningChoices(none).join(), "");
  assert.equal(f.nearestReasoning(none, "high"), "");
  assert.deepEqual(f.reasoningFields(none, "high"), {});
});
test("parseReasoningLevels：报错里列的几档由低到高排；不提档位的报错、只提一档的都给空", () => {
  assert.deepEqual(f.parseReasoningLevels("Invalid value: 'probe'. Supported values are: 'high', 'low', and 'medium'.", "probe"), [
    "low",
    "medium",
    "high"
  ]);
  assert.deepEqual(f.parseReasoningLevels("Unrecognized request argument supplied: reasoning_effort", "probe"), []);
  assert.deepEqual(f.parseReasoningLevels("Invalid value: 'probe'. Supported values are: 'high'.", "probe"), []);
  assert.deepEqual(f.parseReasoningLevels("rate limited", "probe"), []);
});
test("learnReasoningLevels：从报错里认出接口支持的几档，被拒的那档不算", () => {
  const p = { id: "p", model: "m", baseUrl: "https://x/v1", reasoningLevels: "" };
  assert.equal(f.learnReasoningLevels(p, "Invalid value: 'high'. Supported values are: 'low', 'medium', and 'xhigh'.", "high"), true);
  assert.equal(p.reasoningLevels, "low, medium, xhigh");
  assert.equal(f.learnReasoningLevels(p, "rate limited", "high"), false);
  // 从报错里学到的就是这个身份的定论，之后不再探
  assert.equal(f.reasoningProbed(p), true);
  // 旧版只有档位没有标记的：当手填的，绑在当前身份上
  const old = { model: "m", baseUrl: "https://x/v1", reasoningLevels: "low, high" };
  assert.equal(f.reasoningProbed(old), true);
  assert.equal(old.reasoningProbed, "manual|openai|https://x/v1|m");
});
test("isReadOnlyCommand：开发与系统检查免确认，只放行纯展示管道", () => {
  assert.equal(f.isReadOnlyCommand("git status"), true);
  assert.equal(f.isReadOnlyCommand("Get-ChildItem src"), true);
  assert.equal(f.isReadOnlyCommand("node --version"), true);
  assert.equal(f.isReadOnlyCommand("Get-Process | Sort-Object WorkingSet64 | Select-Object -First 10"), true);
  assert.equal(f.isReadOnlyCommand("Get-CimInstance Win32_OperatingSystem | ConvertTo-Json"), true);
  assert.equal(f.isReadOnlyCommand("git status | grep x"), true);
  assert.equal(f.isReadOnlyCommand("Get-Process -ComputerName elsewhere"), false);
  assert.equal(f.isReadOnlyCommand("Get-Process | Remove-Item"), false);
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
test("parseVizJson：旧对话里 echarts 围栏的 JSON——注释、尾逗号、单引号、裸键名逐层修补", () => {
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
  // 同一轮里后来的步骤把思绪边界推到 8：下一组从 8 起，不从 2 起（否则 2..8 那段会显示两次）
  const pushed = f.trailGroups({
    steps: [
      { at: 3, rat: 2 },
      { at: 3, rat: 8 },
      { at: 9, rat: 12 }
    ]
  });
  assert.deepEqual([pushed[0].rfrom, pushed[0].rat], [0, 8]);
  assert.deepEqual([pushed[1].rfrom, pushed[1].rat], [8, 12]);
});
test("repairEchartsOption：系列指到不存在的轴、轴指到不存在的格子都收回来，漏了 type 按数据补", () => {
  const fixed = repairEchartsOption({
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
  const pie = repairEchartsOption({ series: { data: [{ name: "a", value: 1 }] } });
  assert.equal(pie.series[0].type, "pie");
  assert.equal(pie.series[0].xAxisIndex, undefined);
  assert.equal(pie.grid, undefined);
});
test("repairEchartsOption：直角坐标的标签算进格子，没写格子的头一回收紧四边，增量更新不动边距", () => {
  const bare = repairEchartsOption({ xAxis: { data: ["a"] }, yAxis: {}, series: [{ type: "line", data: [1] }] });
  assert.deepEqual(bare.grid, { containLabel: true, top: 16, bottom: 12, left: 12, right: 16 });
  const dressed = repairEchartsOption({
    title: { text: "t" },
    legend: { bottom: 0 },
    xAxis: { name: "n" },
    yAxis: { name: "次数" },
    series: [{ type: "line", data: [1] }]
  });
  assert.deepEqual(dressed.grid, { containLabel: true, top: 60, bottom: 40, left: 12, right: 48 });
  const own = repairEchartsOption({ grid: [{ left: 80 }, { containLabel: false }], xAxis: {}, yAxis: {}, series: [] });
  assert.deepEqual(own.grid, [{ left: 80, containLabel: true }, { containLabel: false }]);
  const busy = repairEchartsOption({ dataZoom: [{ type: "slider" }], xAxis: {}, yAxis: {}, series: [] });
  assert.deepEqual(busy.grid, { containLabel: true });
  assert.equal(repairEchartsOption({ xAxis: { data: ["b"] } }, false).grid, undefined);
});
test("anthropicRequest：system 单列、工具结果并进 user、思考块回传、工具定义与思考预算换算", () => {
  const body = f.anthropicRequest({
    model: "claude",
    max_tokens: 4096,
    temperature: 0.7,
    reasoning_effort: "medium",
    tools: [
      {
        type: "function",
        function: { name: "read_file", description: "读", parameters: { type: "object", properties: { path: { type: "string" } } } }
      }
    ],
    messages: [
      { role: "system", content: "你是言" },
      {
        role: "user",
        content: [
          { type: "text", text: "看看" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
        ]
      },
      {
        role: "assistant",
        content: "我读一下",
        tool_calls: [{ id: "t1", type: "function", function: { name: "read_file", arguments: '{"path":"a.js"}' } }],
        thinking_blocks: [{ thinking: "想", signature: "sig" }]
      },
      { role: "tool", tool_call_id: "t1", content: "const a = 1" },
      { role: "user", content: "补一句" }
    ]
  });
  // 提示缓存：系统提示末尾一处，整段对话最后一块一处
  assert.deepEqual(body.system, [{ type: "text", text: "你是言", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(body.messages.at(-1).content.at(-1), { type: "text", text: "补一句", cache_control: { type: "ephemeral" } });
  assert.equal(body.thinking.budget_tokens, 8192);
  assert.equal(body.max_tokens, 8192 + 4096);
  assert.equal(body.temperature, undefined);
  assert.deepEqual(body.tools[0], {
    name: "read_file",
    description: "读",
    input_schema: { type: "object", properties: { path: { type: "string" } } }
  });
  assert.equal(body.messages.length, 3);
  assert.deepEqual(body.messages[0].content[1], { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
  assert.deepEqual(
    body.messages[1].content.map(b => b.type),
    ["thinking", "text", "tool_use"]
  );
  assert.deepEqual(body.messages[1].content[2].input, { path: "a.js" });
  assert.deepEqual(
    body.messages[2].content.map(b => b.type),
    ["tool_result", "text"]
  );
  assert.equal(
    f.anthropicRequest({ model: "m", messages: [{ role: "assistant", content: "先" }], temperature: 1.7 }).messages[0].role,
    "user"
  );
  assert.equal(f.anthropicRequest({ model: "m", messages: [{ role: "user", content: "x" }], temperature: 1.7 }).temperature, 1);
  // 新模型：思考是 adaptive、深浅走 effort；4.7 起不带 temperature、要回思考摘要；5 起不选档位也在想
  const opus5 = f.anthropicRequest({
    model: "claude-opus-5",
    messages: [{ role: "user", content: "x" }],
    temperature: 0.7,
    reasoning_effort: "high"
  });
  assert.deepEqual(opus5.thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(opus5.output_config, { effort: "high" });
  assert.equal(opus5.temperature, undefined);
  assert.equal(opus5.max_tokens, 32000);
  const opus5Default = f.anthropicRequest({ model: "claude-opus-5", messages: [{ role: "user", content: "x" }], temperature: 0.7 });
  assert.deepEqual(opus5Default.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(opus5Default.output_config, undefined);
  const opus48 = f.anthropicRequest({ model: "claude-opus-4-8", messages: [{ role: "user", content: "x" }], temperature: 0.7 });
  assert.equal(opus48.thinking, undefined);
  assert.equal(opus48.temperature, undefined);
  const sonnet46 = f.anthropicRequest({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "x" }],
    reasoning_effort: "xhigh"
  });
  assert.deepEqual(sonnet46.thinking, { type: "adaptive" });
  assert.deepEqual(sonnet46.output_config, { effort: "high" });
  const sonnet46Plain = f.anthropicRequest({ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "x" }], temperature: 0.4 });
  assert.equal(sonnet46Plain.temperature, 0.4);
  const haiku = f.anthropicRequest({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "x" }], reasoning_effort: "low" });
  assert.equal(haiku.thinking.budget_tokens, 2048);
  assert.equal(f.anthropicEndpoint("https://api.anthropic.com/v1/"), "https://api.anthropic.com/v1/messages");
  assert.equal(f.anthropicLike({ baseUrl: "https://api.anthropic.com" }), true);
  assert.equal(f.anthropicLike({ baseUrl: "https://api.anthropic.com", api: "openai" }), false);
});
test("anthropicToOpenAiStream：事件流换成 OpenAI 风格分块——文字、思考、工具调用、签名、用量、[DONE]", async () => {
  const events = [
    ["message_start", { type: "message_start", message: { model: "claude-x", usage: { input_tokens: 10 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "想一想" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig1" } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "先读" } }],
    ["content_block_stop", { type: "content_block_stop", index: 1 }],
    [
      "content_block_start",
      { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "read_file", input: {} } }
    ],
    ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path":' } }],
    ["content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"a.js"}' } }],
    ["content_block_stop", { type: "content_block_stop", index: 2 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }],
    ["message_stop", { type: "message_stop" }]
  ];
  const raw = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const stream = new Blob([raw]).stream().pipeThrough(f.anthropicToOpenAiStream("claude"));
  const text = await new Response(stream).text();
  const chunks = text
    .split("\n\n")
    .filter(Boolean)
    .map(line => line.replace(/^data: /, ""));
  assert.equal(chunks.at(-1), "[DONE]");
  const deltas = chunks.slice(0, -1).map(c => JSON.parse(c));
  assert.equal(deltas[0].choices[0].delta.reasoning_content, "想一想");
  assert.deepEqual(deltas[1].choices[0].delta.thinking_block, { thinking: "想一想", signature: "sig1" });
  assert.equal(deltas[2].choices[0].delta.content, "先读");
  const calls = deltas.flatMap(d => d.choices[0].delta.tool_calls || []);
  assert.equal(calls[0].id, "toolu_1");
  assert.equal(calls[0].function.name, "read_file");
  assert.equal(calls.map(c => c.function.arguments).join(""), '{"path":"a.js"}');
  const last = deltas.at(-1);
  assert.equal(last.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(last.usage, { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 });
  assert.equal(last.model, "claude-x");
});
test("anthropicToOpenAiStream：流到半途的 error 事件按流里的报错交出，不写进正文", async () => {
  const raw = [
    ["message_start", { type: "message_start", message: { model: "claude-x", usage: { input_tokens: 3 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "写到一半" } }],
    ["error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]
  ]
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  const text = await new Response(new Blob([raw]).stream().pipeThrough(f.anthropicToOpenAiStream("claude"))).text();
  const chunks = text
    .split("\n\n")
    .filter(Boolean)
    .map(line => line.replace(/^data: /, ""));
  const last = JSON.parse(chunks.at(-1));
  assert.match(last.error.message, /overloaded_error/);
  assert.equal(last.choices, undefined);
  assert.ok(!chunks.some(c => c.includes("接口错误")));
});
test("isReadOnlyCommand：git 带 --output / --ext-diff 不算只读", () => {
  assert.equal(f.isReadOnlyCommand("git log --oneline"), true);
  assert.equal(f.isReadOnlyCommand("git log --output=out.txt"), false);
  assert.equal(f.isReadOnlyCommand("git diff --ext-diff"), false);
});
test("mergeConfig3：自己改过的取自己的，没改的取对方的；按 id 并增删，用量相加", () => {
  const base = {
    version: 5,
    settings: { name: "甲", theme: "light", width: 760 },
    profiles: [
      { id: "a", name: "A", quota: "", usedTokens: 100 },
      { id: "b", name: "B", quota: "", usedTokens: 0 },
      { id: "c", name: "C", quota: "", usedTokens: 0 }
    ],
    library: [],
    memory: { enabled: true, items: [{ id: "m1", text: "旧" }] },
    drafts: { x: { text: "草" } }
  };
  const mine = {
    ...base,
    settings: { name: "乙", theme: "light", width: 760 },
    profiles: [
      { id: "a", name: "A", quota: "", usedTokens: 130 },
      { id: "c", name: "C", quota: "", usedTokens: 0 },
      { id: "d", name: "D" }
    ],
    memory: {
      enabled: true,
      items: [
        { id: "m1", text: "旧" },
        { id: "m2", text: "我记的" }
      ]
    },
    drafts: {}
  };
  const theirs = {
    ...base,
    settings: { name: "甲", theme: "dark", width: 760 },
    profiles: [
      { id: "a", name: "A 改名", quota: "", usedTokens: 150 },
      { id: "b", name: "B", quota: "", usedTokens: 0 },
      { id: "c", name: "C", quota: "", usedTokens: 0 },
      { id: "e", name: "E" }
    ],
    memory: {
      enabled: true,
      items: [
        { id: "m1", text: "旧" },
        { id: "m3", text: "它记的" }
      ]
    },
    drafts: { x: { text: "草" }, y: { text: "它的草稿" } }
  };
  const merged = f.mergeConfig3(base, mine, theirs);
  assert.deepEqual(merged.settings, { name: "乙", theme: "dark", width: 760 });
  // b 我删了、它没动：删；d 我新加、e 它新加：都留；a 两边都改：名字取它的，用量两边相加
  assert.deepEqual(
    merged.profiles.map(p => p.id),
    ["a", "c", "e", "d"]
  );
  assert.equal(merged.profiles[0].name, "A 改名");
  assert.equal(merged.profiles[0].usedTokens, 180);
  assert.deepEqual(
    merged.memory.items.map(item => item.id),
    ["m1", "m3", "m2"]
  );
  // 草稿 x 我发出去了（删了）、它没动：删；y 它新写的：留
  assert.deepEqual(Object.keys(merged.drafts), ["y"]);
});
test("mergeConfig3：两处各添预设、分组、MCP 与环境工具时都留下", () => {
  const base = {
    version: 5,
    settings: {
      presets: [{ id: "p0", name: "原有" }],
      groups: [{ id: "g0", name: "原有" }],
      mcpServers: { original: { command: "old" } },
      env: { packs: ["data", "office", "web"], pip: "", npm: "", mirror: "china" }
    },
    profiles: [],
    library: [],
    memory: { enabled: true, items: [] },
    drafts: {}
  };
  const mine = structuredClone(base),
    theirs = structuredClone(base);
  mine.settings.presets.push({ id: "p1", name: "这边" });
  mine.settings.groups.push({ id: "g1", name: "这边" });
  mine.settings.mcpServers.alpha = { command: "a" };
  mine.settings.env.packs.push("image");
  mine.settings.env.pip = "sympy";
  theirs.settings.presets.push({ id: "p2", name: "那边" });
  theirs.settings.groups.push({ id: "g2", name: "那边" });
  theirs.settings.mcpServers.beta = { command: "b" };
  theirs.settings.env.packs.push("media");
  theirs.settings.env.mirror = "official";
  const merged = f.mergeConfig3(base, mine, theirs).settings;
  assert.deepEqual(
    merged.presets.map(p => p.id),
    ["p0", "p2", "p1"]
  );
  assert.deepEqual(
    merged.groups.map(g => g.id),
    ["g0", "g2", "g1"]
  );
  assert.deepEqual(Object.keys(merged.mcpServers), ["original", "beta", "alpha"]);
  assert.deepEqual(merged.env.packs, ["data", "office", "web", "media", "image"]);
  assert.equal(merged.env.pip, "sympy");
  assert.equal(merged.env.mirror, "official");
});
test("looksLikeMermaid / liftBareMermaid：写岔了的流程图照样认得，普通代码与别的 pre 不误伤", () => {
  assert.equal(f.looksLikeMermaid("flowchart TD\n  A --> B"), true);
  assert.equal(f.looksLikeMermaid("%% 注\ngraph LR;\n  A --> B"), true);
  assert.equal(f.looksLikeMermaid("sequenceDiagram\n  A->>B: hi"), true);
  assert.equal(f.looksLikeMermaid("graph = build()\nprint(graph)"), false);
  assert.equal(f.looksLikeMermaid("pie = 3.14"), false);
  const lifted = f.liftBareMermaid('前文\n<pre class="mermaid">\nflowchart TD\n  A --> B\n</pre>\n后文 <pre>别的</pre>');
  assert.match(lifted, /```mermaid\n+flowchart TD\n {2}A --> B\n+```/);
  assert.match(lifted, /后文 <pre>别的<\/pre>/);
  const fenced = '```html\n<pre class="mermaid">graph TD\nA-->B</pre>\n```';
  assert.equal(f.liftBareMermaid(fenced), fenced);
});
