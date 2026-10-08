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
// 长活（LONGSUB 帮手、LONGMAIN 主答）：每轮读一个大文件，请求超过 limit 字就回「放不下」；轮数记在这里，压掉的往来不影响它
const long = { rounds: {}, folds: {}, overflows: {}, limit: { LONGSUB: 60000, LONGMAIN: 200000 } };
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
// ChatGPT 订阅：假的授权端（/chatgpt-auth）与公开接口（/chatgpt/v1）。授权页直接 302 回回调口；头一回登记发下 oaiapp_test
const jwt = claims => `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const chatgptLog = { tokens: [], revoked: 0, authorize: [] };
function chatgpt(req, res) {
  const url = new URL(req.url, "http://127.0.0.1:8798"),
    json = (data, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  if (url.pathname === "/chatgpt-log") return json(chatgptLog);
  if (url.pathname === "/chatgpt-auth/api/accounts/authorize") {
    const q = url.searchParams;
    chatgptLog.authorize.push(Object.fromEntries(q));
    // 本机标识须是 urn:uuid:…（真授权端对裸 UUID 回 invalid ext_agent_host_id）
    if (!/^urn:uuid:[0-9a-f-]{36}$/.test(q.get("ext_agent_host_id") || ""))
      return json({ error: { message: "Invalid authorize request", param: "ext_agent_host_id", code: "invalid_authorize_request" } }, 400);
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("code", "code-1");
    back.searchParams.set("state", q.get("state"));
    if (q.get("client_id") === "dynamic_agent_client") back.searchParams.set("client_id", "oaiapp_test");
    return res.writeHead(302, { Location: back.href }).end();
  }
  if (url.pathname === "/chatgpt-auth/.well-known/openid-configuration")
    return json({ revocation_endpoint: "http://127.0.0.1:8798/chatgpt-auth/revoke" });
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    if (url.pathname === "/chatgpt-auth/revoke") {
      chatgptLog.revoked += 1;
      return res.writeHead(200).end();
    }
    if (url.pathname === "/chatgpt-auth/api/accounts/oauth/token") {
      const form = Object.fromEntries(new URLSearchParams(body));
      chatgptLog.tokens.push(form);
      return json({
        access_token: jwt({ aud: form.resource }),
        refresh_token: "refresh-1",
        id_token: jwt({ email: "me@example.com" }),
        expires_in: 3600
      });
    }
    const bearer = String(req.headers.authorization || "").startsWith("Bearer e30.");
    // 模型表按 client_version 筛：不带版本号时新模型（gpt-new）不列
    if (url.pathname === "/chatgpt/v1/models")
      return json({
        data: [
          { slug: "gpt-sub", visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }] },
          ...(url.searchParams.get("client_version") ? [{ slug: "gpt-new", visibility: "list" }] : []),
          { slug: "gpt-hidden", visibility: "hide" }
        ]
      });
    if (url.pathname === "/chatgpt/v1/responses") {
      const payload = JSON.parse(body || "{}");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
      send({
        type: "response.output_text.delta",
        delta: `CHATGPT|bearer:${bearer}|store:${payload.store}|instr:${!!payload.instructions}|effort:${payload.reasoning?.effort || ""}`
      });
      send({ type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } });
      return res.end();
    }
    json({ error: { message: "not found" } }, 404);
  });
}
http
  .createServer((req, res) => {
    if (req.url.startsWith("/chatgpt")) return chatgpt(req, res);
    if (req.url.endsWith("/v1/models") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "claude-test", type: "model" }] }));
    }
    // 长活用例读一下：各自压过几回、撞过几回「放不下」
    if (req.url.endsWith("/long-stats") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(long));
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
      // 这一问总是分段送来（首段标着缓存点、账本另起一段）：只有文字的并回一串，各分支照旧当字符串读；带图带件的仍是分段
      const raw = payload.messages || [],
        msgs = raw.map(m =>
          m.role === "user" && Array.isArray(m.content) && m.content.every(part => part.type === "text")
            ? { ...m, content: m.content.map(part => part.text).join("\n\n") }
            : m
        ),
        toolResults = msgs.filter(m => m.role === "tool");
      const lastUser = [...msgs].reverse().find(m => m.role === "user")?.content || "";
      // MCPSHOT：连截两幅（两轮各一次 snap），第三轮报回请求里看到的图——几条带图、最新那条是不是紧跟工具结果、旧的是否换成了字
      if (msgs.some(m => m.role === "user" && typeof m.content === "string" && m.content.includes("MCPSHOT"))) {
        const n = toolResults.length,
          snapCall = i =>
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: `call_snap${i}`,
                  type: "function",
                  function: {
                    name: "mcp__cam__snap",
                    arguments: JSON.stringify(i === 2 ? { n: i, file: "test/.tmp/shots/shot-2.png" } : { n: i })
                  }
                }
              ]
            });
        if (n < 2) return sse(res, [delta({ content: `截第 ${n + 1} 幅。` }), snapCall(n + 1), delta({}, { usage: { total_tokens: 5 } })]);
        const withImages = msgs.filter(m => Array.isArray(m.content) && m.content.some(part => part.type === "image_url")),
          last = msgs.at(-1),
          stale = msgs.some(m => m.role === "user" && typeof m.content === "string" && m.content.includes("已由后来的取代"));
        return sse(res, [
          delta({
            content: `![画面](shot-2.png)\n\nMCPSHOT|named:${String(toolResults.at(-1)?.content).includes("![](shot-2.png)")}|images:${withImages.length}|tail:${msgs.at(-2)?.role === "tool" && withImages[0] === last}|stale:${stale}|png:${String(last?.content?.[1]?.image_url?.url || "").startsWith("data:image/png;base64,")}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // 断着时回来的回报（relay-hold）：报回请求里有没有那几份回报原文、各在第几条 user 里
      if (msgs.some(m => m.role === "user" && typeof m.content === "string" && m.content.includes("RELAYHOLD"))) {
        const users = msgs.filter(m => m.role === "user").map(m => String(typeof m.content === "string" ? m.content : ""));
        return sse(res, [
          delta({
            content: `RELAYHOLD|kept:${users.some(u => u.includes("REPORT-KEPT"))}|dropped:${users.some(u => u.includes("REPORT-GONE"))}|empty:${users.some(u => !u.trim())}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // 多任务压力用例：占着流连接，直到测试结束或请求取消。
      if (typeof lastUser === "string" && lastUser.includes("HOLDSTREAM")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify(delta({ content: "已接通" }))}\n\n`);
        const timer = setTimeout(() => res.end("data: [DONE]\n\n"), 8000);
        res.on("close", () => clearTimeout(timer));
        return;
      }
      // 学有的中转：回传的工具调用参数逐个当 JSON 解析，有一个坏的整个请求就报错（页面得回传合法的 JSON 对象）
      for (const call of msgs.flatMap(m => m.tool_calls || []))
        try {
          const value = JSON.parse(call.function.arguments);
          if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("not an object");
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: { message: `Expecting value: ${error.message}` } }));
        }
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
      // 长活：轮内压缩的请求（开头是 fold 提示）回一份笔记；其余按任务里的记号分派
      const firstUser = String(msgs.find(m => m.role === "user")?.content || ""),
        longKey = ["LONGSUB", "LONGMAIN"].find(k => firstUser.includes(k) && !firstUser.includes("LONGRUN"));
      // LEDGER：账本只接在这一问之后另起一段（首段是问本身；缓存标记桥接只给 Claude 留着，这里看不到，由单元测试管）、系统提示里有立账本那句；第一问不读就改账本（附着全文即算读过），第二问看到的是改后的那份
      if (firstUser.includes("LEDGER")) {
        const sys = String(msgs[0]?.role === "system" ? msgs[0].content : ""),
          users = msgs.filter(m => m.role === "user").map(m => String(m.content)),
          last = users.at(-1),
          ask = raw.findLast(m => m.role === "user")?.content,
          after = Array.isArray(ask) && !ask[0].text.includes("［账本") && ask.at(-1).text.startsWith("［账本 .yan/账本.md］"),
          marks = `tail:${after ? "yes" : "no"}|once:${users.slice(0, -1).some(u => u.includes("［账本")) ? "no" : "yes"}|sys:${sys.includes(".yan/账本.md") ? "yes" : "no"}`;
        if (users.length === 1 && !toolResults.length)
          return sse(res, [
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_l0",
                  type: "function",
                  function: {
                    name: "edit_file",
                    arguments: JSON.stringify({ path: ".yan/账本.md", old: "达标线 0.9", new: "达标线 0.95" })
                  }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        const edited = String(toolResults.at(-1)?.content || "").startsWith("已修改") ? "yes" : "no",
          now = last.includes("达标线 0.95") ? "0.95" : last.includes("达标线 0.9") ? "0.9" : "none";
        return sse(res, [delta({ content: `LEDGER|${marks}|edit:${edited}|now:${now}` }), delta({}, { usage: { total_tokens: 5 } })]);
      }
      if (typeof lastUser === "string" && lastUser.startsWith("你在做下面这件事")) {
        const key = ["LONGSUB", "LONGMAIN"].find(k => lastUser.includes(k)) || "?";
        long.folds[key] = (long.folds[key] || 0) + 1;
        const read = [...new Set(lastUser.match(/big\d+\.txt/g) || [])];
        return sse(res, [
          delta({ content: `- 已读 ${read.join("、")}，各有 8000 字\n- 下一步：接着读` }),
          delta({}, { usage: { total_tokens: 9 } })
        ]);
      }
      if (longKey) {
        const size = JSON.stringify(msgs).length;
        if (size > long.limit[longKey]) {
          long.overflows[longKey] = (long.overflows[longKey] || 0) + 1;
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              error: {
                message: `This model's maximum context length is 16000 tokens. However, your messages resulted in ${Math.ceil(size / 4)} tokens.`,
                code: "context_length_exceeded"
              }
            })
          );
        }
        const n = (long.rounds[longKey] = (long.rounds[longKey] || 0) + 1) - 1,
          usage = {
            prompt_tokens: Math.ceil((size + JSON.stringify(payload.tools || []).length) / 4),
            completion_tokens: 20,
            total_tokens: 0
          };
        usage.total_tokens = usage.prompt_tokens + 20;
        if (n < 12)
          return sse(res, [
            delta({ content: `读第 ${n + 1} 个。` }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: `call_long${n}`,
                  type: "function",
                  function: { name: "read_file", arguments: JSON.stringify({ path: `big${n}.txt` }) }
                }
              ]
            }),
            delta({}, { usage })
          ]);
        const note = msgs.find(m => m.role === "assistant" && String(m.content || "").startsWith("［工作笔记］"));
        return sse(res, [
          delta({
            content: `${longKey} done|note:${note ? "yes" : "no"}|folded:${msgs.some(m => m.role === "user" && String(m.content).includes("原文不再保留")) ? "yes" : "no"}|task:${firstUser.includes(longKey) ? "yes" : "no"}|n:${msgs.length}`
          }),
          delta({}, { usage })
        ]);
      }
      // 前文放不下（LONGHEAD 没填窗口、LHWIN 填了窗口）：请求超过 30000 字回「放不下」；答里写明见没见到前文摘要
      const headKey =
        typeof lastUser === "string" &&
        !lastUser.startsWith("把下面这段对话") &&
        ["LONGHEAD", "LHWIN", "LH-SEED"].find(k => lastUser.includes(k));
      if (headKey) {
        const size = JSON.stringify(msgs).length;
        if (size > 30000) {
          long.overflows[headKey] = (long.overflows[headKey] || 0) + 1;
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              error: {
                message: `This model's maximum context length is 8000 tokens. However, your messages resulted in ${Math.ceil(size / 4)} tokens.`
              }
            })
          );
        }
        const summary = msgs.some(m => m.role === "user" && String(m.content || "").startsWith("［前文摘要］"));
        return sse(res, [
          delta({ content: `${headKey} ok|summary:${summary ? "yes" : "no"}|size:${size}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // 帮手在后台做，回报作为一条用户消息送到（「帮手「」起头的一段）：正作答时进这一答，没在作答时另起一答（前面还冠着上一答的行迹），
      // 场景按第一问认。另起的那一答里，上一答的工具结果不重放——头一答（firstTurn）才派活，之后的几答只看回报
      // 同一刻到的几份并成一问，按「帮手「」起头的段逐份认
      const helperReports = msgs
          .filter(m => m.role === "user")
          .flatMap(m =>
            String(m.content)
              .split(/\n\n(?=帮手「)/)
              .filter(part => part.startsWith("帮手「"))
              .map(content => ({ content }))
          ),
        firstTurn = msgs.filter(m => m.role === "user").length === 1;
      if (firstUser.includes("LONGRUN-SUB")) {
        if (firstTurn && !toolResults.length)
          return sse(res, [
            delta({ content: "派一名帮手。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_lr0",
                  type: "function",
                  function: {
                    name: "delegate",
                    arguments: JSON.stringify({ title: "读十二个大文件", task: "LONGSUB：依次读 big0.txt 到 big11.txt，然后回报。" })
                  }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (!helperReports.length) return sse(res, [delta({ content: "等回报。" }), delta({}, { usage: { total_tokens: 0 } })]);
        return sse(res, [
          delta({ content: `LONGRUN-SUB done｜${String(helperReports.at(-1).content).replace(/\s+/g, " ").slice(0, 200)}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // SLOWSUB2：慢帮手（约 3 秒）；途中主对话经 helper 递来话（「主对话递来的话」起头），它就此改口回报
      if (firstUser.includes("SLOWSUB2")) {
        const note = msgs.find(m => m.role === "user" && String(m.content).startsWith("主对话递来的话"));
        if (note)
          return sse(res, [
            delta({ content: `收到改向｜${String(note.content).includes("TALK-TEXT") ? "乙" : "?"}` }),
            delta({}, { usage: { total_tokens: 3 } })
          ]);
        return sse(
          res,
          [
            ...Array.from({ length: 12 }, (_, i) => delta({ content: `慢活第${i + 1}句。` })),
            delta({ content: "慢活回报。" }),
            delta({}, { usage: { total_tokens: 3 } })
          ],
          250
        );
      }
      // BOOKMID：开工时还没有账本，主模型中途立账本、再差遣；帮手领命时拿到的须是刚立的那份
      if (firstUser.includes("BOOKHELPER"))
        return sse(res, [
          delta({ content: `回报：ledger:${firstUser.includes("只用 CPU") ? "yes" : "no"}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      if (firstUser.includes("BOOKMID")) {
        const call = (id, name, args) =>
          delta({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
        if (firstTurn && !toolResults.length)
          return sse(res, [
            call("call_bm0", "write_file", { path: ".yan/账本.md", content: "# 约束\n- 只用 CPU\n" }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (firstTurn && toolResults.length === 1)
          return sse(res, [
            call("call_bm1", "delegate", { title: "看账本", task: "BOOKHELPER：照账本办，回报看到的约束。" }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (!helperReports.length) return sse(res, [delta({ content: "等回报。" }), delta({}, { usage: { total_tokens: 5 } })]);
        return sse(res, [
          delta({ content: `BOOKMID|${String(helperReports.at(-1).content).replace(/\s+/g, " ").slice(0, 200)}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // HELPERTALK / HELPERSTOP：主模型差一名慢帮手，接着给它递话或叫停，再等回报
      const helperKey = ["HELPERTALK", "HELPERSTOP"].find(k => firstUser.includes(k));
      if (helperKey) {
        const call = (id, name, args) =>
          delta({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
        if (firstTurn && !toolResults.length)
          return sse(res, [
            call("call_hp0", "delegate", { title: "慢活", task: "SLOWSUB2：慢慢做完回报。" }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (firstTurn && toolResults.length === 1)
          return sse(res, [
            call(
              "call_hp1",
              "helper",
              helperKey === "HELPERTALK" ? { helper: "慢活", message: "TALK-TEXT：改做乙" } : { helper: "慢活", stop: true }
            ),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (!helperReports.length) return sse(res, [delta({ content: "等回报。" }), delta({}, { usage: { total_tokens: 5 } })]);
        return sse(res, [
          delta({
            content: `${helperKey} done｜${String(helperReports.at(-1).content).replace(/\s+/g, " ").slice(0, 200)}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // SLOWLONG：更慢的帮手，约 12 秒说完再回报（给呼吸、切换对话这类要在帮手做着时看的用例）
      if (typeof lastUser === "string" && lastUser.includes("SLOWLONG"))
        return sse(
          res,
          [
            ...Array.from({ length: 48 }, (_, i) => delta({ content: `长活第${i + 1}句。` })),
            delta({ content: "长活回报。" }),
            delta({}, { usage: { total_tokens: 3 } })
          ],
          250
        );
      // SLOWSUB：慢帮手，约 3 秒说完再回报
      if (typeof lastUser === "string" && lastUser.includes("SLOWSUB"))
        return sse(
          res,
          [
            ...Array.from({ length: 12 }, (_, i) => delta({ content: `慢活第${i + 1}句。` })),
            delta({ content: "慢活回报。" }),
            delta({}, { usage: { total_tokens: 3 } })
          ],
          250
        );
      // BGWAKE / BGRELOAD：挂一条先睡一会儿的后台指令就收尾；它结束时另起一答（前面冠着上一答的行迹），据结果收尾。
      // BGBUSY：挂上后自己接着干四轮（每轮约一秒），后台指令在这期间结束，回报就递进这一答里
      const bgKey = ["BGWAKE", "BGRELOAD", "BGBUSY"].find(k => firstUser.includes(k));
      if (bgKey) {
        const sleepFor = bgKey === "BGRELOAD" ? 6 : 3,
          heard = msgs.find(m => m.role === "user" && String(m.content).includes("后台指令 bg") && String(m.content).includes("已结束"));
        if (firstTurn && !toolResults.length)
          return sse(res, [
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_bgw0",
                  type: "function",
                  function: {
                    name: "run_command",
                    arguments: JSON.stringify({ command: `Start-Sleep -Seconds ${sleepFor}; Write-Output wake-ok`, background: true })
                  }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (heard)
          return sse(res, [
            delta({
              content: `${bgKey} done｜${toolResults.length ? "inline" : "woke"}｜${String(heard.content).replace(/\s+/g, " ").slice(0, 240)}`
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (bgKey === "BGBUSY" && toolResults.length < 6)
          return sse(
            res,
            [
              delta({ content: `自看第${toolResults.length}轮。` }),
              delta({
                tool_calls: [
                  {
                    index: 0,
                    id: `call_bgw${toolResults.length}`,
                    type: "function",
                    function: { name: "list_files", arguments: JSON.stringify({ path: "." }) }
                  }
                ]
              }),
              delta({}, { usage: { total_tokens: 5 } })
            ],
            400
          );
        return sse(res, [delta({ content: "挂上了，等它。" }), delta({}, { usage: { total_tokens: 5 } })]);
      }
      // HELPERAGAIN：主模型差一名慢帮手，等它回报后续派它再做一回（它该记得上一回），两份回报都到了收尾
      if (firstUser.includes("HELPERAGAIN")) {
        const call = (id, name, args) =>
          delta({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
        if (firstTurn && !toolResults.length)
          return sse(res, [
            call("call_ag0", "delegate", { title: "慢活", task: "SLOWSUB：慢慢做完回报。" }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (helperReports.length === 1 && !toolResults.length)
          return sse(res, [
            delta({ content: "再派一回。" }),
            call("call_ag1", "helper", { helper: "慢活", message: "AGAIN-TEXT：再做一遍" }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (helperReports.length < 2) return sse(res, [delta({ content: "等回报。" }), delta({}, { usage: { total_tokens: 5 } })]);
        return sse(res, [
          delta({ content: `HELPERAGAIN done｜${String(helperReports.at(-1).content).replace(/\s+/g, " ").slice(0, 200)}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // 续派的那一趟（帮手那一侧）：它的历史里该有上一趟的命与回报
      if (typeof lastUser === "string" && lastUser.includes("AGAIN-TEXT"))
        return sse(res, [
          delta({
            content: `再做回报｜seen:${msgs.some(m => m.role === "assistant" && String(m.content).includes("慢活回报")) ? "yes" : "no"}|first:${firstUser.includes("SLOWSUB") ? "yes" : "no"}`
          }),
          delta({}, { usage: { total_tokens: 3 } })
        ]);
      // BGWORK：主模型差一名长活帮手后自己接着干——慢慢说一段、读一回文件，共五轮，再等回报（真模型常这样：派出去的同时自己不闲着）
      if (firstUser.includes("BGWORK")) {
        if (firstTurn && !toolResults.length)
          return sse(res, [
            delta({ reasoning_content: "想想怎么分。" }),
            delta({ content: "派一名帮手，我自己先看看。" }),
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_bw0",
                  type: "function",
                  function: { name: "delegate", arguments: JSON.stringify({ title: "长活", task: "SLOWLONG：慢慢做完回报。" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        const n = toolResults.length;
        if (firstTurn && n < 6)
          return sse(
            res,
            [
              delta({ reasoning_content: `第 ${n} 轮想一想。` }),
              ...Array.from({ length: 6 }, (_, i) => delta({ content: `自看第${n}轮第${i + 1}句。` })),
              delta({
                tool_calls: [
                  {
                    index: 0,
                    id: `call_bw${n}`,
                    type: "function",
                    function: { name: "list_files", arguments: JSON.stringify({ path: "." }) }
                  }
                ]
              }),
              delta({}, { usage: { total_tokens: 5 } })
            ],
            150
          );
        if (!helperReports.length) return sse(res, [delta({ content: "等回报。" }), delta({}, { usage: { total_tokens: 5 } })]);
        return sse(res, [delta({ content: `BGWORK done｜reports:${helperReports.length}` }), delta({}, { usage: { total_tokens: 5 } })]);
      }
      // RELAYWAKE：派一名慢帮手（约 3 秒）后这一答断了（接口报错）；回报到了，断着的那一答自己续上、回报递进去，据此收尾
      if (firstUser.includes("RELAYWAKE")) {
        if (helperReports.length)
          return sse(res, [
            delta({ content: `RELAYWAKE done｜reports:${helperReports.length}｜resumed:${msgs.some(m => m.role === "assistant" && String(m.content).includes("派一名慢帮手"))}` }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (!toolResults.length)
          return sse(res, [
            delta({ content: "派一名慢帮手。" }),
            delta({
              tool_calls: [
                { index: 0, id: "call_rw0", type: "function", function: { name: "delegate", arguments: JSON.stringify({ title: "慢活", task: "SLOWSUB：慢慢做完回报。" }) } }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "bad request (fake)" } }));
      }
      // BGLONG：主模型差一名长活帮手（约 12 秒），说「等回报」；回报到了收尾
      if (firstUser.includes("BGLONG")) {
        if (firstTurn && !toolResults.length)
          return sse(res, [
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_bl0",
                  type: "function",
                  function: { name: "delegate", arguments: JSON.stringify({ title: "长活", task: "SLOWLONG：慢慢做完回报。" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (!helperReports.length) return sse(res, [delta({ content: "等回报。" }), delta({}, { usage: { total_tokens: 5 } })]);
        return sse(res, [delta({ content: `BGLONG done｜reports:${helperReports.length}` }), delta({}, { usage: { total_tokens: 5 } })]);
      }
      // BGNOTE：主模型差一名慢帮手后说「等回报」；等的时候寄来的补言当场递到，回一句「收到补言」；回报到了才收尾
      if (firstUser.includes("BGNOTE")) {
        if (firstTurn && !toolResults.length)
          return sse(res, [
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_bg0",
                  type: "function",
                  function: { name: "delegate", arguments: JSON.stringify({ title: "慢活", task: "SLOWSUB：慢慢做完回报。" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (String(lastUser).includes("BG-NOTE-TEXT"))
          return sse(res, [delta({ content: `收到补言｜reports:${helperReports.length}` }), delta({}, { usage: { total_tokens: 5 } })]);
        if (!helperReports.length) return sse(res, [delta({ content: "等回报。" }), delta({}, { usage: { total_tokens: 5 } })]);
        return sse(res, [delta({ content: `BGNOTE done｜reports:${helperReports.length}` }), delta({}, { usage: { total_tokens: 5 } })]);
      }
      // SLOWTHINK：想得很久（约 9 秒）才开口，给补言的折箭头试「不等落点」
      if (typeof lastUser === "string" && lastUser.includes("SLOWTHINK"))
        return sse(
          res,
          [
            ...Array.from({ length: 60 }, (_, i) => delta({ reasoning_content: `第 ${i + 1} 行思绪。\n` })),
            delta({ content: "SLOWTHINK done" }),
            delta({}, { usage: { total_tokens: 5 } })
          ],
          150
        );
      // 带附件的一问是分段内容：正文在第一段
      const lastText = Array.isArray(lastUser) ? String(lastUser.find(part => part.type === "text")?.text || "") : lastUser;
      if (typeof lastUser === "string" && lastUser.includes("这件事用几个字称呼")) {
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
                tool(2, "mcp_call", { server: "big", tool: "tool_07", params: { n: "7" } }),
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
            content: `MCPTEST|hint:${system.includes("FAKE-MCP-HINT")}|note:${system.includes("【web】USER-NOTE-WEB")}|inline:${names.filter(x => x.startsWith("mcp__")).join(",")}|lazy:${names.includes("mcp_call")}|dir:${/tool_39/.test(describe)}|${toolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 80)).join(" ▸ ")}`
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
      if (typeof lastUser === "string" && lastUser.includes("上一条回复在此处中断")) {
        const asked = [...msgs]
          .reverse()
          .find(m => m.role === "user" && typeof m.content === "string" && !m.content.includes("上一条回复在此处中断"));
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
        return sseNoEol(res, [
          delta({ content: "开头，" }),
          delta({ content: "结尾在此" }),
          delta({}, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { total_tokens: 77 } })
        ]);
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
      // 末一问带了几张图：测改问时摘掉附件后，新问确实不再送图
      if (typeof lastText === "string" && lastText.includes("IMGCOUNT"))
        return sse(res, [
          delta({ content: `IMGCOUNT|${Array.isArray(lastUser) ? lastUser.filter(part => part.type === "image_url").length : 0}` }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
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
          return sse(
            res,
            [
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
            ],
            120
          );
        // 回报里带上帮手这一趟收到的思考档位（主模型派它时给了 low），与上一轮的思绪有没有随工具调用送回
        return sse(
          res,
          [
            delta({
              content: `回报乙：已新建 src/b.js。｜echo:${String(msgs.find(m => m.role === "assistant" && m.tool_calls)?.reasoning_content || "").startsWith("帮手乙想第 1 步。") ? "yes" : "no"}｜effort:${payload.reasoning_effort ?? "none"}`
            }),
            delta({}, { usage: { total_tokens: 7 } })
          ],
          300
        );
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
        if (n === 0) return sse(res, [delta({ content: "\n\n\n\n\n" }), ...call("read_file", { path: "src/a.js" })], 150);
        if (n === 1) return sse(res, call("edit_file", { path: "src/a.js", old: "return 1;", new: "return 2;" }), 150);
        return sse(res, [
          delta({
            content: `回报：已把 return 1 改为 return 2。｜sys:${sys.includes("子任务的帮手") ? "yes" : "no"}|delegate:${names.includes("delegate") ? "yes" : "no"}|ask:${names.includes("ask_user") ? "yes" : "no"}|memw:${names.filter(x => ["remember", "forget"].includes(x)).length}|memr:${names.filter(x => ["recall", "search_conversations"].includes(x)).length}|n:${msgs.length}`
          }),
          delta({}, { usage: { total_tokens: 7 } })
        ]);
      }
      if (firstUser.includes("DELEGATE") && (lastUser === firstUser || /(^|\n)帮手「/.test(String(lastUser)))) {
        // 主模型：差遣 → 没读就想改（该被拒）→ 收尾把工具结果带回正文
        const n = toolResults.length,
          call = (name, args) => [
            delta({ content: `主 ${n + 1}。` }),
            delta({ tool_calls: [{ index: 0, id: `call_p${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }),
            delta({}, { usage: { total_tokens: 5 } })
          ];
        if (firstTurn && n === 0)
          return sse(res, [
            // 主模型也先吐几个空行：收尾裁掉后所有步骤的 at 都会前移，分组的键随之变。
            // 页面若不撤掉落单的旧分组，同一次差遣就会画两遍
            delta({ content: "\n\n\n" }),
            // 差遣的思考档位只列这台模型认的几档（测试里配的是 low, medium, xhigh）
            delta({
              content: `主 1：派两名帮手（档位 ${(payload.tools || []).find(t => t.function.name === "delegate")?.function.parameters.properties.effort?.enum?.join(",")}）。`
            }),
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
                  function: {
                    name: "delegate",
                    arguments: JSON.stringify({ title: "建 b.js", task: "SUBTASK-B：新建 src/b.js。", effort: "low" })
                  }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        if (n === 2) return sse(res, call("edit_file", { path: "src/a.js", old: "return 2;", new: "return 3;" }));
        // 两名帮手在后台：没回齐就先说一句等着（不记用量，耗墨数不随先后浮动）
        // 另起的那一答里，先到的回报可能已在上一答里递过（不重放）：看冠在前面的行迹里还有没有后台进行中的
        if (firstTurn ? helperReports.length < 2 : /差遣「[^」]+」→ 后台进行中/.test(String(lastUser)))
          return sse(res, [delta({ content: "等回报。" }), delta({}, { usage: { total_tokens: 0 } })]);
        return sse(res, [
          delta({
            // 回报另起的那一问前面冠着上一答的行迹（差遣了谁、做到哪）：trail 记它到没到
            content: `DELEGATE done｜trail:${msgs.some(m => m.role === "user" && String(m.content).includes("［上一答的行迹］差遣「改 a.js」")) ? "yes" : "no"}｜${[...toolResults, ...helperReports].map(t => String(t.content).replace(/\s+/g, " ").slice(0, 120)).join(" ▸ ")}`
          }),
          delta({}, { usage: { total_tokens: 5 } })
        ]);
      }
      // DUPTAIL：第一轮调 read_file，第二轮慢慢说一段话（约 3 秒）；用于确认生成中切走再回来，最后一步之后的话不被画两份
      if (typeof lastUser === "string" && lastUser.includes("DUPTAIL")) {
        if (!toolResults.length)
          return sse(res, [
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: "call_t0",
                  type: "function",
                  function: { name: "read_file", arguments: JSON.stringify({ path: "src/a.js" }) }
                }
              ]
            }),
            delta({}, { usage: { total_tokens: 5 } })
          ]);
        return sse(
          res,
          [...Array.from({ length: 12 }, (_, i) => delta({ content: `尾段第${i + 1}句。` })), delta({}, { usage: { total_tokens: 5 } })],
          250
        );
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
      // LONGTHINK：一长串思绪慢慢写（思绪框装不下、自己会滚），随后一句很短的正文就收尾
      if (typeof lastUser === "string" && lastUser.includes("LONGTHINK"))
        return sse(
          res,
          [
            ...Array.from({ length: 40 }, (_, i) => delta({ reasoning_content: `第 ${i + 1} 行思绪，慢慢想。\n` })),
            delta({ content: "LONGTHINK done" }),
            delta({}, { usage: { total_tokens: 5 } })
          ],
          60
        );
      if (typeof lastUser === "string" && lastUser.includes("覆写")) {
        // 覆盖写：先整份重写一件原有的文件（只改一行、添一行），再新建一件又重写一遍
        const n = toolResults.length,
          call = (name, args) => [
            delta({ tool_calls: [{ index: 0, id: `call_w${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }),
            delta({}, { usage: { total_tokens: 5 } })
          ];
        if (n === 0) return sse(res, call("write_file", { path: "src/a.js", content: "function f() {\n  return 3;\n}\nf();\n" }));
        if (n === 1) return sse(res, call("write_file", { path: "src/c.js", content: "草稿\n草稿\n" }));
        if (n === 2) return sse(res, call("write_file", { path: "src/c.js", content: "定稿一\n定稿二\n定稿三\n" }));
        return sse(res, [delta({ content: "写好了。" }), delta({}, { usage: { total_tokens: 5 } })]);
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
          if (n === 1) return sse(res, call("remember", { category: "杂记", text: "twice 关键词的记忆" }));
          if (n === 2) return sse(res, call("recall", { query: "twice" }));
          return sse(res, [
            delta({
              content: `TWICE|cats:${sys.includes("「工作」") ? "yes" : "no"}|${toolResults.map(t => String(t.content).replace(/\s+/g, " ").slice(0, 40)).join(" ▸ ")}`
            }),
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
        if (n === 0) return sse(res, call("remember", { category: "偏好", text: "用户偏好 PowerShell 而非 bash" }));
        if (n === 1) {
          const id = String(toolResults[0].content).match(/\[(m[a-z0-9]+)\]/)?.[1];
          return sse(res, call("remember", { category: "偏好", text: "用户偏好 PowerShell 而非 bash，且要求中文交流", replaces: id }));
        }
        if (n === 2) return sse(res, call("recall", { query: "powershell" }));
        if (n === 3) return sse(res, call("search_conversations", { query: "术语" }));
        if (n === 4) {
          const id = String(toolResults[3].content).match(/\[([0-9a-f-]{20,})\]/)?.[1];
          return sse(res, call("read_conversation", { id: id || "none" }));
        }
        // 过长的一条不截断，退回去；不给参数的 recall 只列分类
        if (n === 5) return sse(res, call("remember", { category: "偏好", text: "长".repeat(2100) }));
        if (n === 6) return sse(res, call("recall", {}));
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
            // 「拿不准就问」写在 ask_user 自己的说明里，不在系统提示里另说一遍
            content: `ASK|hint:${/拿不准/.test((payload.tools || []).find(t => t.function.name === "ask_user")?.function.description || "") ? "yes" : "no"}|tool:${names.includes("ask_user") ? "yes" : "no"}|${String(toolResults.at(-1).content).replace(/\s+/g, " ")}${note ? `|note:${note.replace(/\s+/g, " ")}` : ""}`
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
        delta({ content: `指令结果：${result.includes("你好，世界") ? "成功" : result.includes("没有同意") ? "被跳过" : "其他"}` }),
        delta({ content: `｜工具数 ${payload.tools ? payload.tools.length : 0}${payload.tool_choice === "none" ? "｜禁调" : ""}` }),
        delta({}, { usage: { total_tokens: 30 } })
      ]);
    });
  })
  .listen(8798, "127.0.0.1", () => console.log("fake llm on 8798"));
