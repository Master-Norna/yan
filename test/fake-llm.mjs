// 假的 OpenAI 兼容接口：第一轮回 run_command 工具调用，收到 tool 结果后回正文；可通过 X-Mode 切换行为
import http from "node:http";
const sse = (res, chunks, gap = 30) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let i = 0;
  const tick = () => {
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`);
      setTimeout(tick, gap);
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
  flaky503 = 0,
  titleFailed = false,
  slowTitleFailed = false;
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
      `ANTHROPIC|sys:${(Array.isArray(payload.system) ? payload.system.map(b => b.text).join("") : String(payload.system || "")).includes("今日") ? "yes" : "no"}|think:${thought?.signature === "sig-1" ? "yes" : "no"}|tools:${(payload.tools || []).length}|schema:${payload.tools?.[0]?.input_schema ? "yes" : "no"}|result:${String(results.at(-1).content).replace(/\s+/g, " ").slice(0, 30)}`
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
    // 用例读一下到目前为止收到过几次请求（探档位只探一次之类的断言）
    if (req.url.endsWith("/calls") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end(String(calls));
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
      // 探思考档位：页面故意送 reasoning_effort: "probe"。按模型 ID 装几种接口：
      // fake-three 只认三档；fake-plain 压根不认识这个字段；fake-mute 照单全收（中转站的样子）；其余按 OpenAI 的样子列四档
      // fake-slow 认四档，但要一秒半才回——探着它的时候换了模型，这份迟到的结果不能写到新模型上
      if (payload.reasoning_effort === "probe") {
        const model = String(payload.model || "");
        if (model.includes("mute")) return sse(res, [delta({ content: "。" }), delta({}, { usage: { total_tokens: 1 } })]);
        const message = model.includes("plain")
          ? "Unrecognized request argument supplied: reasoning_effort"
          : model.includes("vague")
            ? "Invalid reasoning_effort value: probe"
            : `Invalid value: 'probe'. Supported values are: ${model.includes("three") ? "'low', 'medium', and 'high'" : "'low', 'medium', 'high', and 'max'"}.`;
        const reply = () => {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message, type: "invalid_request_error", param: "reasoning_effort" } }));
        };
        return model.includes("slow") ? setTimeout(reply, 1500) : reply();
      }
      // 带附件的一问是分段内容：正文在第一段
      const lastText = Array.isArray(lastUser) ? String(lastUser.find(part => part.type === "text")?.text || "") : lastUser;
      if (typeof lastUser === "string" && lastUser.startsWith("为下面这段对话拟")) {
        // TITLEFAIL：头一次拟题时装作网络出错，页面不该就此把这段对话标成「已拟题」
        if (lastUser.includes("TITLEFAIL") && !titleFailed) {
          titleFailed = true;
          res.writeHead(502, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "bad gateway" } }));
        }
        // TITLESLOWFAIL：正文已经写完、收尾重试撞上仍在途的拟题请求后，旧请求才失败；页面应记住补试一次
        if (lastUser.includes("TITLESLOWFAIL") && !slowTitleFailed) {
          slowTitleFailed = true;
          return setTimeout(() => {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "slow bad gateway" } }));
          }, 800);
        }
        // TITLEEDITRACE：给用户留出正在标题框里编辑的窗口，检查迟到的自动拟题不会被 blur / Esc 用旧字反盖。
        if (lastUser.includes("TITLEEDITRACE"))
          return setTimeout(() => sse(res, [delta({ content: "测试标题" }), delta({}, { usage: { total_tokens: 10 } })]), 1500);
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
      if (typeof lastUser === "string" && lastUser.includes("SLOWTEXT")) {
        // 一段一段慢慢说的纯文本（每段两句，段尾空行），给补言找落点用：约 8 秒说完
        const paragraphs = Array.from({ length: 20 }, (_, i) => `第${i + 1}段，先说一句。再说一句。\n\n`);
        return sse(res, [...paragraphs.map(content => delta({ content })), delta({}, { usage: { total_tokens: 20 } })], 400);
      }
      // MCPTEST：接入的 MCP 服务一轮全用上——逐件给的 echo（stdio）、按需给的先查再调（stdio，工具多）、HTTP 服务上会写的 write_note（要请示）；
      // 第二轮把看到的报回去：系统提示里有没有服务自带的用法、拿到了哪几件、各结果是什么
      if (typeof lastUser === "string" && lastUser.includes("MCPTEST")) {
        const n = toolResults.length,
          names = (payload.tools || []).map(t => t.function.name);
        const tool = (index, name, args) => ({
          index,
          id: `call_mcp${index}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) }
        });
        if (n === 0)
          return sse(res, [
            delta({ content: "用一下 MCP。" }),
            delta({
              tool_calls: [
                tool(0, "mcp__local__echo", { text: "你好" }),
                tool(1, "mcp_describe", { server: "big", tools: ["tool_07"] }),
                tool(2, "mcp_call", { server: "big", tool: "tool_07", arguments: { n: "7" } }),
                tool(3, "mcp_call", { server: "big", tool: "nope", arguments: {} }),
                tool(4, "mcp__web__write_note", { text: "记下" })
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        const system = String(msgs.find(m => m.role === "system")?.content || "");
        const describe = payload.tools.find(t => t.function.name === "mcp_describe")?.function.description || "";
        return sse(res, [
          delta({
            content: `MCPTEST|hint:${system.includes("FAKE-MCP-HINT")}|inline:${names.filter(x => x.startsWith("mcp__")).join(",")}|lazy:${names.includes("mcp_call")}|dir:${/tool_39/.test(describe)}|${toolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 80)).join(" ▸ ")}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("NEWTOOLS")) {
        // 新工具一轮全用上：算一段 JS、调本机服务（放行）与内网地址（该拒）、下载本机文件与内网地址、列一份计划；第二轮把各结果回显
        const n = toolResults.length;
        const tool = (index, name, args) => ({
          index,
          id: `call_n${index}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) }
        });
        if (n === 0)
          return sse(res, [
            delta({ content: "先算一下。" }),
            delta({
              tool_calls: [
                tool(0, "run_js", {
                  code: 'const xs = [1, 2, 3];\nconsole.log("sum", xs.reduce((a, b) => a + b));\nreturn xs.map(x => x * x);'
                }),
                tool(1, "run_js", { code: "while (true) {}", timeout: 1 }),
                tool(2, "http_request", { url: "http://127.0.0.1:8798/v1/models" }),
                tool(3, "http_request", { url: "http://192.168.0.1/x" }),
                tool(4, "download_file", { url: "http://127.0.0.1:8798/v1/models", path: "下载/models.json" }),
                tool(5, "download_file", { url: "http://10.0.0.1/a.txt" }),
                tool(6, "update_plan", {
                  items: [
                    { text: "算平方", status: "done" },
                    { text: "调接口", status: "doing" },
                    { text: "收尾", status: "pending" },
                    { text: "不做的", status: "skipped" }
                  ]
                })
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          delta({ content: `NEWTOOLS|${toolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 90)).join(" ▸ ")}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // 断线后页面自动请它接着写：STREAMERR 那段每回都断（接满两回仍断，才算中断），别的接上一句收尾
      if (typeof lastUser === "string" && lastUser.startsWith("上一条回复在此处因连接中断")) {
        const asked = [...msgs]
          .reverse()
          .find(m => m.role === "user" && typeof m.content === "string" && !m.content.startsWith("上一条回复在此处因连接中断"));
        if (String(asked?.content || "").includes("STREAMERR"))
          return sse(res, [{ error: { message: "rate limited again (fake)", type: "rate_limit_error" } }]);
        return sse(res, [delta({ content: "接着写完。" }), delta({}, { usage: { total_tokens: 5 } })]);
      }
      // FLAKY503：前两回装作上游忙（503），页面该等一等再试，第三回接通
      if (typeof lastUser === "string" && lastUser.includes("FLAKY503")) {
        if (flaky503 < 2) {
          flaky503 += 1;
          res.writeHead(503, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: { message: "overloaded (fake)" } }));
        }
        return sse(res, [delta({ content: "重试后接通。" }), delta({}, { usage: { total_tokens: 6 } })]);
      }
      // VIZDEMO：页内可视化只剩 HTML 一条路——新写法的 yan:echarts 与 <pre class="mermaid">，旧对话里的 mermaid / echarts 围栏照样成图
      if (typeof lastUser === "string" && lastUser.includes("VIZDEMO"))
        return sse(res, [
          delta({
            content: [
              "四种画法：",
              "",
              "```html",
              '<div class="card"><h3>季度营收</h3><div id="c" style="height:240px"></div><p class="muted">单位：万元</p></div>',
              '<script src="yan:echarts"></script>',
              '<script>echarts.init(document.getElementById("c")).setOption({ xAxis: { data: ["一", "二", "三", "四"] }, yAxis: {}, series: [{ data: [5, 8, 6, 9] }] });</script>',
              "```",
              "",
              "```html",
              '<pre class="mermaid">graph LR; A[落墨] --> B[成图] --> C[可交互]</pre>',
              "```",
              "",
              "```mermaid",
              "graph TD; 甲-->乙; 甲-->丙",
              "```",
              "",
              "```echarts",
              '{ "xAxis": { "data": ["a", "b", "c"] }, "yAxis": {}, "series": [{ "type": "line", "data": [1, 3, 2] }], }',
              "```"
            ].join("\n")
          }),
          delta({}, { usage: { total_tokens: 9 } })
        ]);
      if (typeof lastUser === "string" && lastUser.includes("STREAMERR"))
        // 写了半截后流里夹一条报错（限流之类）就收：页面该按「连接中断」处理、已写的留着，而不是当写完了
        return sse(res, [
          delta({ content: "先写半句，" }),
          delta({ content: "再写半句。" }),
          { error: { message: "rate limited (fake)", type: "rate_limit_error" } }
        ]);
      if (typeof lastUser === "string" && lastUser.includes("STREAMCUT")) {
        // 写了半截上游就掐线：桥接得补一条报错事件给页面，页面按中断处理，而不是把半截当写完
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify(delta({ content: "写到一半" }))}

`);
        setTimeout(() => res.destroy(), 60);
        return;
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
      if (typeof lastUser === "string" && lastUser.startsWith("把下面这段对话压成一份摘要"))
        return sse(res, [
          delta({ content: `- 用户在测试压缩，此前 ${(lastUser.match(/\n用户：/g) || []).length} 问\n- 结论：术语 X 需留意` }),
          delta({}, { usage: { total_tokens: 12 } })
        ]);
      if (typeof lastUser === "string" && lastUser.includes("SAMEWORD"))
        return sse(res, [delta({ content: "甲说 StructRAG 好；乙说 StructRAG 更好。" }), delta({}, { usage: { total_tokens: 4 } })]);
      if (typeof lastText === "string" && lastText.includes("PLAIN")) {
        const leaked =
          msgs.some(m => typeof m.content === "string" && /SIDE|旁注追问/.test(m.content)) ||
          /旁注追问/.test(String(msgs[0]?.content || ""));
        return sse(res, [
          delta({ content: `正文回答：这里有一个术语 X 需要留意。${lastText.includes("check") ? `｜leak:${leaked ? "yes" : "no"}` : ""}` }),
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
        // 头一轮先吐几个空行再说话：真模型常这样。正文最后会被裁掉开头的空行，
        // 步骤记的偏移若不跟着前移，这条时间线上每段话都会错位、被切在字中间
        if (n === 0) return sse(res, [delta({ content: "\n\n\n\n\n" }), ...call("read_file", { path: "src/a.js" })]);
        if (n === 1) return sse(res, call("edit_file", { path: "src/a.js", old: "return 1;", new: "return 2;" }));
        return sse(res, [
          delta({
            content: `回报：已把 return 1 改为 return 2。｜sys:${sys.includes("子任务的帮手") ? "yes" : "no"}|delegate:${names.includes("delegate") ? "yes" : "no"}|ask:${names.includes("ask_user") ? "yes" : "no"}|memw:${names.filter(x => ["remember", "forget"].includes(x)).length}|memr:${names.filter(x => ["recall", "search_conversations"].includes(x)).length}|n:${msgs.length}`
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
            // 主模型也先吐几个空行：收尾裁掉后所有步骤的 at 都会前移，分组的键随之变。
            // 页面若不撤掉落单的旧分组，同一次差遣就会画两遍
            delta({ content: "\n\n\n" }),
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
      if (typeof lastUser === "string" && lastUser.includes("CHAT-AUTO")) {
        const lastUserIndex = msgs.findLastIndex(m => m.role === "user"),
          turnToolResults = msgs.slice(lastUserIndex + 1).filter(m => m.role === "tool");
        if (turnToolResults.length < 2)
          return sse(res, [
            delta({ content: turnToolResults.length ? "再跑一条。" : "先跑一条。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: `call_chat_${turnToolResults.length}`,
                  type: "function",
                  function: {
                    name: "run_command",
                    arguments: JSON.stringify({ command: `Write-Output 'chat-${turnToolResults.length + 1}'` })
                  }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [delta({ content: "CHAT-AUTO done" }), delta({}, { usage: { total_tokens: 5 } })]);
      }
      // ESCALATE：问而后行里发一条严的沙箱会拦的指令（.. 上溯写），用户批了便出沙箱跑；收尾把结果报回去
      if (typeof lastUser === "string" && lastUser.includes("ESCALATE")) {
        const lastUserIndex = msgs.findLastIndex(m => m.role === "user"),
          results = msgs.slice(lastUserIndex + 1).filter(m => m.role === "tool");
        if (!results.length)
          return sse(res, [
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_escalate",
                  type: "function",
                  function: {
                    name: "run_command",
                    arguments: JSON.stringify({ command: "Set-Content ../escalate-probe.txt ok; Write-Output wrote" })
                  }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(res, [
          delta({ content: `ESCALATE done｜${String(results[0].content).replace(/\s+/g, " ").slice(0, 80)}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      if (typeof lastUser === "string" && lastUser.includes("POLICY-REVIEW")) {
        const lastUserIndex = msgs.findLastIndex(m => m.role === "user"),
          turnToolResults = msgs.slice(lastUserIndex + 1).filter(m => m.role === "tool"),
          n = turnToolResults.length,
          call = (name, args) =>
            sse(res, [
              delta({
                tool_calls: [{ index: 0, id: `call_review_${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }]
              }),
              delta({}, { usage: { total_tokens: 5 } })
            ]);
        if (n === 0) return call("run_command", { command: "Set-Content review-ok.txt ok" });
        if (n === 1) return call("run_command", { command: "Set-ExecutionPolicy Unrestricted" });
        return sse(res, [
          delta({
            content: `POLICY-REVIEW done｜${turnToolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 100)).join(" ▸ ")}`
          }),
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
