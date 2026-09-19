// 假的 OpenAI 兼容接口：第一轮回 run_command 工具调用，收到 tool 结果后回正文；可通过 X-Mode 切换行为
import http from "node:http";
const sse = (res, chunks) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let i = 0;
  const tick = () => {
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`);
      setTimeout(tick, 30);
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  };
  tick();
};
const delta = (d, extra = {}) => ({
  id: "x",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta: d, finish_reason: null }],
  ...extra
});
let calls = 0,
  titleFailed = false;
// 流的末尾不带换行就结束：最后一段 data: 与 usage 都没有跟换行，页面在 EOF 时也得把它们处理掉
const sseNoEol = (res, chunks) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const body = chunks.map(c => `data: ${JSON.stringify(c)}`).join("\n\n");
  res.write(body.slice(0, Math.floor(body.length / 2)));
  setTimeout(() => res.end(body.slice(Math.floor(body.length / 2))), 40);
};
// 假的 Anthropic Messages API：事件流的写法与真接口一致（event: 行 + data: 行）。第一轮：思考块（带签名）+ 一句话 + list_files 的 tool_use；
// 第二轮（带 tool_result）：把收到的东西原样报回去——system 有没有、上一轮的思考块（带签名）有没有回传、工具几件、工具结果是什么
const anthropicSse = (res, events) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let i = 0;
  const tick = () => {
    if (i < events.length) {
      const [name, data] = events[i++];
      res.write(`event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`);
      setTimeout(tick, 20);
    } else res.end();
  };
  tick();
};
const anthropicMessages = (payload, res) => {
  const msgs = payload.messages || [];
  const results = msgs.flatMap(m => (Array.isArray(m.content) ? m.content.filter(b => b.type === "tool_result") : []));
  const text = (name, id) => [
    ["content_block_start", { index: 1, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { index: 1, delta: { type: "text_delta", text: name } }],
    ["content_block_stop", { index: 1 }]
  ];
  if (!results.length)
    return anthropicSse(res, [
      ["message_start", { message: { id: "msg_1", model: payload.model, usage: { input_tokens: 12 } } }],
      ["content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } }],
      ["content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "想一想先看目录。" } }],
      ["content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig-1" } }],
      ["content_block_stop", { index: 0 }],
      ...text("先看目录。"),
      ["content_block_start", { index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "list_files", input: {} } }],
      ["content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: '{"path":' } }],
      ["content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: '"."}' } }],
      ["content_block_stop", { index: 2 }],
      ["message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 9 } }],
      ["message_stop", {}]
    ]);
  const prev = [...msgs].reverse().find(m => m.role === "assistant"),
    thought = Array.isArray(prev?.content) ? prev.content.find(b => b.type === "thinking") : null;
  return anthropicSse(res, [
    ["message_start", { message: { id: "msg_2", model: payload.model, usage: { input_tokens: 30 } } }],
    ...text(
      `ANTHROPIC|sys:${String(payload.system || "").includes("今天") ? "yes" : "no"}|think:${thought?.signature === "sig-1" ? "yes" : "no"}|tools:${(payload.tools || []).length}|schema:${payload.tools?.[0]?.input_schema ? "yes" : "no"}|result:${String(results.at(-1).content).replace(/\s+/g, " ").slice(0, 30)}`
    ),
    ["message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 11 } }],
    ["message_stop", {}]
  ]);
};
http
  .createServer((req, res) => {
    if (req.url.endsWith("/v1/models") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "claude-test", type: "model" }] }));
    }
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body || "{}");
      calls += 1;
      if (req.url.endsWith("/v1/messages")) return anthropicMessages(payload, res);
      const msgs = payload.messages || [],
        toolResults = msgs.filter(m => m.role === "tool");
      const lastUser = [...msgs].reverse().find(m => m.role === "user")?.content || "";
      if (typeof lastUser === "string" && lastUser.startsWith("请为下面这段对话拟")) {
        // TITLEFAIL：头一次拟题时装作网络出错，页面不该就此把这段对话标成「已拟题」
        if (lastUser.includes("TITLEFAIL") && !titleFailed) {
          titleFailed = true;
          res.writeHead(502, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "bad gateway" } }));
        }
        return sse(res, [delta({ content: "测试标题" }), delta({}, { usage: { total_tokens: 10 } })]);
      }
      if (typeof lastUser === "string" && lastUser.includes("SLOWHTML")) {
        // 一块 html 一行一行慢慢流：闭合之前页面上是占位框，框里报着写到第几行
        const lines = [
          "先说一句。\n\n```html\n",
          "<!doctype html>\n",
          "<p>1</p>\n",
          "<p>2</p>\n",
          "<p>3</p>\n",
          "<p>4</p>\n",
          "<p>5</p>\n",
          "<p>6</p>\n",
          "<p>7</p>\n",
          "<p>8</p>\n",
          "```\n"
        ];
        return sse(res, [...lines.map(content => delta({ content })), delta({}, { usage: { total_tokens: 11 } })]);
      }
      if (typeof lastUser === "string" && lastUser.includes("NOEOL"))
        return sseNoEol(res, [delta({ content: "开头，" }), delta({ content: "结尾在此" }), delta({}, { usage: { total_tokens: 77 } })]);
      if (typeof lastUser === "string" && lastUser.includes("TRUNC")) {
        // 参数被截断：写文件的 content 只有一半、JSON 没闭合——不能救成 {"path"} 去把文件写空；只读的 list_files 截断了照样能跑
        const n = toolResults.length;
        if (n === 0)
          return sse(res, [
            delta({ content: "写一份。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_t0",
                  type: "function",
                  function: { name: "write_file", arguments: '{"path":"截断.txt","content":"这一段很长很长，写到一半就被最大输出长度截' }
                },
                { index: 1, id: "call_t1", type: "function", function: { name: "write_file", arguments: '{"path":"缺内容.txt"}' } },
                { index: 2, id: "call_t2", type: "function", function: { name: "list_files", arguments: '{"path":".","depth":' } }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          delta({ content: `TRUNC|${toolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 60)).join(" ▸ ")}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.startsWith("请把下面这段对话压成一份摘要"))
        return sse(res, [
          delta({ content: `- 用户在测试压缩，此前 ${(lastUser.match(/\n用户：/g) || []).length} 问\n- 结论：术语 X 需留意` }),
          delta({}, { usage: { total_tokens: 12 } })
        ]);
      if (typeof lastUser === "string" && lastUser.includes("SAMEWORD"))
        return sse(res, [delta({ content: "甲说 StructRAG 好；乙说 StructRAG 更好。" }), delta({}, { usage: { total_tokens: 4 } })]);
      if (typeof lastUser === "string" && lastUser.includes("PLAIN")) {
        const leaked =
          msgs.some(m => typeof m.content === "string" && /SIDE|旁注追问/.test(m.content)) ||
          /旁注追问/.test(String(msgs[0]?.content || ""));
        return sse(res, [
          delta({ content: `正文回答：这里有一个术语 X 需要留意。${lastUser.includes("check") ? `｜leak:${leaked ? "yes" : "no"}` : ""}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("SIDETHINK")) {
        // 旁注里先想一阵再答：用来测思绪块在写时用户亲手收起不会被再打开
        return sse(res, [
          ...Array.from({ length: 30 }, (_, i) => delta({ reasoning_content: `旁注里想 ${i + 1}。` })),
          delta({ content: "SIDETHINK|done" }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("SIDELOOK")) {
        // 旁注里去查：先要一次 recall（浏览器内完成、不需桥接），拿到结果再答——旁注不该说完「我去查」就断掉
        if (!toolResults.length)
          return sse(res, [
            delta({ content: "我去翻一下记忆。" }),
            delta({
              tool_calls: [
                { index: 0, id: "call_sl", type: "function", function: { name: "recall", arguments: JSON.stringify({ query: "术语" }) } }
              ]
            }),
            delta({}, { usage: { total_tokens: 7 } })
          ]);
        return sse(res, [
          delta({ content: `SIDELOOK|${toolResults.map(t => t.tool_call_id).join(",")}` }),
          delta({}, { usage: { total_tokens: 9 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("SIDE")) {
        const sys = String(msgs[0]?.role === "system" ? msgs[0].content : ""),
          firstSide = msgs.find(m => m.role === "user" && typeof m.content === "string" && m.content.includes("SIDE"));
        const secret = msgs.some(m => typeof m.content === "string" && m.content.includes("MAINSECRET"));
        return sse(res, [
          delta({
            content: `SIDE|sys:${sys.includes("旁注追问") ? "yes" : "no"}|quote:${firstSide && firstSide.content.startsWith("> ") ? "yes" : "no"}|secret:${secret ? "yes" : "no"}|tools:${(payload.tools || []).map(t => t.function.name).join("+") || 0}|n:${msgs.length}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("DIGEST")) {
        // 行迹摘要冠在下一问的开头，不在助手自己的话里（模型会照着学）；用户消息带附件时是分段数组，取首段文本
        const textOf = m => (typeof m.content === "string" ? m.content : m.content?.[0]?.text || "");
        const trailMsg = msgs.find(m => m.role === "user" && textOf(m).includes("［上一答的行迹］")),
          inAssistant = msgs.some(m => m.role === "assistant" && typeof m.content === "string" && m.content.includes("［行迹］")),
          trailLine = trailMsg && !inAssistant ? textOf(trailMsg).slice(textOf(trailMsg).indexOf("［上一答的行迹］")).split("\n\n")[0] : "";
        return sse(res, [
          delta({
            content: trailMsg && !inAssistant ? `有行迹${lastUser.includes("DIGEST-ECHO") ? `｜${trailLine.slice(0, 300)}` : ""}` : "无行迹"
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("ARCHIVE")) {
        // 言里做文件：写一份表到卷宗，再把系统提示里的线索回出来（该是卷宗那段，不是执事那段）
        const sys = String(msgs[0]?.role === "system" ? msgs[0].content : ""),
          names = (payload.tools || []).map(t => t.function.name);
        if (!toolResults.length)
          return sse(res, [
            delta({ content: "写一份表。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_ar",
                  type: "function",
                  function: { name: "write_file", arguments: JSON.stringify({ path: "报表.csv", content: "a,b\n1,2\n" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          delta({
            content: `ARCHIVE done｜archive:${sys.includes("卷宗") ? "yes" : "no"}|work:${sys.includes("「行」（执事）") ? "yes" : "no"}|run:${names.includes("run_command") ? "yes" : "no"}|result:${String(toolResults.at(-1).content).slice(0, 40)}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("DOC")) {
        // 翻卷宗里的文档：read_document 读磁盘上的报表，再把读到的回出来
        if (!toolResults.length)
          return sse(res, [
            delta({ content: "翻卷宗。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_doc",
                  type: "function",
                  function: { name: "read_document", arguments: JSON.stringify({ name: "报表.csv" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          delta({ content: `DOC|${String(toolResults.at(-1).content).replace(/\s+/g, " ").slice(0, 60)}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("BIND")) {
        // 中途绑了目录之后的一问：提示词该换成执事那段，历史仍在
        const sys = String(msgs[0]?.role === "system" ? msgs[0].content : "");
        return sse(res, [
          delta({
            content: `BIND｜work:${sys.includes("「行」（执事）") ? "yes" : "no"}|archive:${sys.includes("卷宗") ? "yes" : "no"}|n:${msgs.length}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("EFFORT")) {
        // 思考档位：这家只认 low / medium / xhigh，别的档位按 OpenAI 的样子报 400；接受时把收到的档位回进正文
        const effort = payload.reasoning_effort;
        if (effort !== undefined && !["low", "medium", "xhigh"].includes(effort)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              // 故意倒着列：页面该按由低到高排，不照抄报错里的顺序
              error: {
                message: `Invalid value: '${effort}'. Supported values are: 'xhigh', 'medium', and 'low'.`,
                type: "invalid_request_error",
                param: "reasoning_effort"
              }
            })
          );
        }
        return sse(res, [delta({ content: `EFFORT|${effort ?? "none"}` }), delta({}, { usage: { total_tokens: 5 } })]);
      }
      if (typeof lastUser === "string" && lastUser.includes("SUBTASK-B")) {
        // 第二名帮手（与第一名并行）：先想一会儿，再写一个新文件，回报
        const n = toolResults.length;
        if (n === 0)
          return sse(res, [
            ...Array.from({ length: 6 }, (_, i) => delta({ reasoning_content: `帮手乙想第 ${i + 1} 步。` })),
            delta({ content: "帮手乙动手。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_b0",
                  type: "function",
                  function: { name: "write_file", arguments: JSON.stringify({ path: "src/b.js", content: "export const b = 2;\n" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 7 } })
          ]);
        return sse(res, [delta({ content: "回报乙：已新建 src/b.js。" }), delta({}, { usage: { total_tokens: 7 } })]);
      }
      if (typeof lastUser === "string" && lastUser.includes("SUBTASK")) {
        // 帮手那一侧：读 → 改 → 回报。系统提示里须带着帮手的那段话，且不该再有 delegate / ask_user 可用
        const n = toolResults.length,
          sys = String(msgs[0]?.role === "system" ? msgs[0].content : ""),
          names = (payload.tools || []).map(t => t.function.name),
          call = (name, args) => [
            delta({ content: `帮手第 ${n + 1} 步。` }),
            delta({ tool_calls: [{ index: 0, id: `call_s${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }),
            delta({}, { usage: { total_tokens: 7 } })
          ];
        if (n === 0) return sse(res, call("read_file", { path: "src/a.js" }));
        if (n === 1) return sse(res, call("edit_file", { path: "src/a.js", old: "return 1;", new: "return 2;" }));
        return sse(res, [
          delta({
            content: `回报：已把 return 1 改为 return 2。｜sys:${sys.includes("被差遣") ? "yes" : "no"}|delegate:${names.includes("delegate") ? "yes" : "no"}|ask:${names.includes("ask_user") ? "yes" : "no"}|memw:${names.filter(x => ["remember", "forget"].includes(x)).length}|memr:${names.filter(x => ["recall", "search_conversations"].includes(x)).length}|n:${msgs.length}`
          }),
          delta({}, { usage: { total_tokens: 7 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("DELEGATE")) {
        // 主模型：差遣 → 没读就想改（该被拒）→ 收尾把工具结果带回正文
        const n = toolResults.length,
          call = (name, args) => [
            delta({ content: `主 ${n + 1}。` }),
            delta({ tool_calls: [{ index: 0, id: `call_p${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }),
            delta({}, { usage: { total_tokens: 5 } })
          ];
        if (n === 0)
          return sse(res, [
            delta({ content: "主 1：派两名帮手。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_p0",
                  type: "function",
                  function: {
                    name: "delegate",
                    arguments: JSON.stringify({ title: "改 a.js", task: "SUBTASK：把 src/a.js 里的 return 1 改成 return 2，然后回报。" })
                  }
                },
                {
                  index: 1,
                  id: "call_p0b",
                  type: "function",
                  function: { name: "delegate", arguments: JSON.stringify({ title: "建 b.js", task: "SUBTASK-B：新建 src/b.js。" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (n === 2) return sse(res, call("edit_file", { path: "src/a.js", old: "return 2;", new: "return 3;" }));
        return sse(res, [
          delta({ content: `DELEGATE done｜${toolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 120)).join(" ▸ ")}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("DUP")) {
        // 时间线复现：第一轮多段正文（段落间带空行）后调用 read_file，第二轮慢慢流一段思绪再说话；用于确认第一轮的话只在分组里出现一次
        const n = toolResults.length;
        if (n === 0)
          return sse(res, [
            delta({ reasoning_content: "先想一想。" }),
            delta({ content: "两个都做。计划：\n\n" }),
            delta({ content: "1. 给 `index.html` 加触屏适配\n2. 新建 `stars.html`\n\n" }),
            delta({ content: "先读现有文件：\n\n" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_d0",
                  type: "function",
                  function: { name: "read_file", arguments: JSON.stringify({ path: "src/a.js" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          ...Array.from({ length: 30 }, (_, i) => delta({ reasoning_content: `- 星 ${i}: 1.${i}, +2.${i}\n` })),
          delta({ content: "DUP done" }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("EDIT")) {
        const n = toolResults.length,
          call = (name, args) => [
            delta({ reasoning_content: `想一想 ${n + 1}` }),
            delta({ reasoning_content: "，再想想。" }),
            delta({ content: `步骤 ${n + 1}。` }),
            delta({ tool_calls: [{ index: 0, id: `call_e${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }),
            delta({}, { usage: { total_tokens: 5 } })
          ];
        if (n === 0) return sse(res, call("edit_file", { path: "src/a.js", old: "return 1;", new: "return 2;" }));
        if (n === 1) return sse(res, call("read_file", { path: "src/a.js" }));
        if (n === 2) return sse(res, call("edit_file", { path: "src/a.js", old: "return 1;", new: "return 2;" }));
        if (n === 3) return sse(res, call("run_command", { command: "Get-Content src/a.js" }));
        if (n === 4) return sse(res, call("search_files", { query: "return", glob: "*.js" }));
        if (n === 5) return sse(res, call("list_files", { pattern: "**/*.js" }));
        return sse(res, [
          delta({ reasoning_content: "最后想一想。" }),
          delta({ content: `EDIT done｜${toolResults.map(t => String(t.content).slice(0, 40)).join(" ▸ ")}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("MEMORY")) {
        // 记忆：记入 → 再记（合并）→ 翻记忆 → 查旧谈 → 翻旧谈 → 收尾（把每步结果带回正文供检查）
        const n = toolResults.length,
          sys = String(msgs[0]?.role === "system" ? msgs[0].content : ""),
          names = (payload.tools || []).map(t => t.function.name);
        const call = (name, args) => [
          delta({ content: `记 ${n + 1}。` }),
          delta({ tool_calls: [{ index: 0, id: `call_m${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }),
          delta({}, { usage: { total_tokens: 5 } })
        ];
        if (lastUser.includes("MEMORY-TWICE")) {
          // 同一轮里：翻记忆 → 记入 → 再翻同样的关键词；第二次必须拿到新结果而不是复用
          if (n === 0) return sse(res, call("recall", { query: "twice" }));
          if (n === 1) return sse(res, call("remember", { text: "twice 关键词的记忆" }));
          if (n === 2) return sse(res, call("recall", { query: "twice" }));
          return sse(res, [
            delta({ content: `TWICE|${toolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 40)).join(" ▸ ")}` }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        }
        if (lastUser.includes("MEMORY-OFF"))
          return sse(res, [
            delta({
              content: `OFF|hint:${sys.includes("跨对话的记忆") ? "yes" : "no"}|tools:${names.filter(x => ["remember", "recall", "forget"].includes(x)).length}`
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (n === 0) return sse(res, call("remember", { text: "用户偏好 PowerShell 而非 bash" }));
        if (n === 1) {
          const id = String(toolResults[0].content).match(/\[(m[a-z0-9]+)\]/)?.[1];
          return sse(res, call("remember", { text: "用户偏好 PowerShell 而非 bash，且要求中文交流", replaces: id }));
        }
        if (n === 2) return sse(res, call("recall", { query: "powershell" }));
        if (n === 3) return sse(res, call("search_conversations", { query: "术语" }));
        if (n === 4) {
          const id = String(toolResults[3].content).match(/\[([0-9a-f-]{20,})\]/)?.[1];
          return sse(res, call("read_conversation", { id: id || "none" }));
        }
        return sse(res, [
          delta({
            content: `MEM|hint:${sys.includes("跨对话的记忆") ? "yes" : "no"}|${toolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 70)).join(" ▸ ")}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("SLOPPY")) {
        // 参数写得潦草：裹了围栏、结尾多一个逗号。页面该救回来，而不是白费一轮
        if (!toolResults.length)
          return sse(res, [
            delta({ content: "问一下。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_sloppy",
                  type: "function",
                  function: {
                    name: "ask_user",
                    arguments:
                      '```json\n{"questions":[{"question":"要哪几样？","header":"范围","multi":true,"options":["甲 — 头一样","乙 — 第二样","丙"],}],}\n```'
                  }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          delta({ content: `SLOPPY|${String(toolResults.at(-1).content).replace(/\s+/g, " ").slice(0, 80)}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("BROKEN")) {
        // 彻底不是 JSON：页面该把该收的参数一并回给模型，模型下一轮就能改对
        if (!toolResults.length)
          return sse(res, [
            delta({ content: "试一下。" }),
            delta({
              tool_calls: [{ index: 0, id: "call_broken", type: "function", function: { name: "search_web", arguments: "查一下天气吧" } }]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          delta({ content: `BROKEN|${String(toolResults.at(-1).content).replace(/\s+/g, " ").slice(0, 260)}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("ASK")) {
        // 请示表单：先问两题（单选 + 多选），拿到答复后把内容原样带回正文
        const n = toolResults.length,
          sys = String(msgs[0]?.role === "system" ? msgs[0].content : ""),
          names = (payload.tools || []).map(t => t.function.name);
        // 两轮都先想再说：请示前的思绪应在正文起笔时打勾；答复回来后又想一阵，这时块上不能还顶着第一轮的勾
        if (n === 0)
          return sse(res, [
            delta({ reasoning_content: "先想想问什么。" }),
            delta({ content: "先问一下。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_ask",
                  type: "function",
                  function: {
                    name: "ask_user",
                    arguments: JSON.stringify({
                      questions: [
                        {
                          question: "用哪种风格？",
                          header: "风格",
                          options: [
                            { label: "清简", description: "留白多" },
                            { label: "浓墨", description: "对比强" }
                          ]
                        },
                        {
                          question: "要哪些部分？",
                          header: "范围",
                          multi: true,
                          options: [{ label: "首页" }, { label: "设置" }, { label: "关于" }]
                        }
                      ]
                    })
                  }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        // 作答途中用户补的话接在工具结果之后（role 仍是 user）：原样带回，测试里看得见它到没到
        const note = msgs.at(-1)?.role === "user" && msgs.at(-2)?.role === "tool" ? String(msgs.at(-1).content) : "";
        return sse(res, [
          ...Array.from({ length: 20 }, (_, i) => delta({ reasoning_content: `答复来了，再想 ${i + 1}。` })),
          delta({
            content: `ASK|hint:${sys.includes("ask_user") ? "yes" : "no"}|tool:${names.includes("ask_user") ? "yes" : "no"}|${String(toolResults.at(-1).content).replace(/\s+/g, " ")}${note ? `|note:${note.replace(/\s+/g, " ")}` : ""}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("PAR")) {
        // 一轮里同时要三个只读调用：应并行执行，结果仍按原顺序回传
        const n = toolResults.length;
        if (n === 0)
          return sse(res, [
            delta({ content: "一起查。" }),
            delta({
              tool_calls: [0, 1, 2].map(i => ({
                index: i,
                id: `call_p${i}`,
                type: "function",
                function: {
                  name: ["list_files", "search_files", "read_file"][i],
                  arguments: JSON.stringify([{ pattern: "**/*.js" }, { query: "return" }, { path: "src/a.js" }][i])
                }
              }))
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          delta({ content: `PAR|${toolResults.map(t => t.tool_call_id).join(",")}` }),
          delta({}, { usage: { total_tokens: 1234 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("LOOP")) {
        // 无限工具调用：每轮都再要一次 list_files
        return sse(res, [
          delta({ content: `第 ${toolResults.length + 1} 轮。` }),
          delta({ tool_calls: [{ index: 0, id: `call_${calls}`, type: "function", function: { name: "list_files", arguments: "{}" } }] }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (!toolResults.length)
        return sse(res, [
          delta({ content: "我先执行一条指令。" }),
          delta({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "run_command", arguments: "" } }] }),
          delta({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command: "Write-Output '你好，世界'" }) } }] }),
          delta({}, { usage: { total_tokens: 20 } })
        ]);
      const result = String(toolResults.at(-1).content);
      return sse(res, [
        delta({ content: `指令结果：${result.includes("你好，世界") ? "成功" : result.includes("跳过") ? "被跳过" : "其他"}` }),
        delta({ content: `｜工具数 ${payload.tools ? payload.tools.length : 0}` }),
        delta({}, { usage: { total_tokens: 30 } })
      ]);
    });
  })
  .listen(8798, "127.0.0.1", () => console.log("fake llm on 8798"));
