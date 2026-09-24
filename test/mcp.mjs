// MCP：设置里接三个假服务——local（stdio，两件，逐件给）、big（stdio，四十二件，按需给）、web（可流式 HTTP，write_note 会写、要请示）。
// 一问里全用上，看工具怎么交给模型、调用结果、请示、出错；再看设置页的状态、停用与配置校验
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, check, sleep, PAGE } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url)),
  FAKE = path.join(HERE, "fake-mcp.mjs"),
  HTTP_PORT = 8795,
  SSE_PORT = 8794;
const web = spawn(process.execPath, [FAKE, "--http", String(HTTP_PORT)], { stdio: "ignore" }),
  old = spawn(process.execPath, [FAKE, "--sse", String(SSE_PORT)], { stdio: "ignore" });
process.on("exit", () => (web.kill(), old.kill()));

const { send, evalJs, waitFor, close } = await connect();
const seed = {
  version: 4,
  settings: {
    name: "测",
    theme: "light",
    inkMotion: "off",
    activeProfileId: "p1",
    autoTitle: false,
    commandPolicyDefault: "ask",
    mcpServers: {
      local: { command: process.execPath, args: [FAKE] },
      big: { command: process.execPath, args: [FAKE, "--many"] },
      web: { url: `http://127.0.0.1:${HTTP_PORT}/mcp` }
    }
  },
  profiles: [
    {
      id: "p1",
      source: "custom",
      name: "假模型",
      model: "fake",
      baseUrl: "http://127.0.0.1:8798/v1",
      apiKey: "k",
      temperature: 0.7,
      maxTokens: 8192,
      quota: "",
      usedTokens: 0,
      systemPrompt: ""
    }
  ],
  conversations: [],
  library: [],
  drafts: {}
};
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(seed))}); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1500);
const lastAssistant = `[...document.querySelectorAll('#messages .message.assistant')].at(-1)`;
await evalJs(
  `document.querySelector("#welcomeInput").value = "MCPTEST 试试"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
// 会写的那件在「问而后行」下请示：请示条浮出，写明服务与工具
await waitFor(`!!document.querySelector('#approvalBar:not(.hidden) [data-approve="run"]')`, 60000);
const bar = await evalJs(`document.querySelector("#approvalBar").textContent`);
check("a writing MCP tool asks first under 问而后行, naming server and tool", /web/.test(bar) && /write_note/.test(bar), bar.slice(0, 200));
await evalJs(`document.querySelector('#approvalBar [data-approve="run"]').click(); true`);
await waitFor(`${lastAssistant}?.dataset.status === "complete"`, 60000);

const reply = await evalJs(`${lastAssistant}.textContent`);
check("the server's own instructions ride along in the system prompt", /hint:true/.test(reply), reply.slice(0, 300));
check(
  "small servers are handed over tool by tool; the big one only as a directory",
  /inline:mcp__local__echo,mcp__local__write_note,mcp__web__echo,mcp__web__write_note\|/.test(reply) &&
    /lazy:true/.test(reply) &&
    /dir:true/.test(reply),
  reply.slice(0, 300)
);
check("an inline stdio tool runs and its text comes back", /回声：你好/.test(reply), reply);
const described = await evalJs(`__yanState().conversations[0].messages.at(-1).steps[1].output`);
check("mcp_describe returns the schema of the asked tool", /## tool_07（只读）[\s\S]*参数：\{/.test(described), described.slice(0, 200));
check('mcp_call checks arguments against the target\'s schema ("7" → 7) and returns structured content', /"n": ?7/.test(reply), reply);
check("mcp_call on an unknown tool lists what the server has", /没有这件工具：big \/ nope.*tool_00/.test(reply), reply);
check("the HTTP server's writing tool runs after approval (reply read from an event stream)", /已记：记下/.test(reply), reply);

const steps = await evalJs(`JSON.stringify(__yanState().conversations[0].messages.at(-1).steps.map(s => [s.name, s.status, s.title]))`);
const trail = await evalJs(`[...${lastAssistant}.querySelectorAll(".tool-label")].map(n => n.textContent.trim()).join(",")`);
check(
  "trail: inline tools are labelled by server, the lazy pair as MCP; the unknown call failed",
  /local,MCP,MCP,MCP,web/.test(trail) && /"mcp_call","error","big · nope"/.test(steps),
  `${trail} ${steps}`
);

// 设置 → MCP：三个服务的状态、停用一个、粘错了的配置不收
await evalJs(`document.querySelector("#openSettings").click(); true`);
await waitFor(`!document.querySelector("#settingsModal").classList.contains("hidden")`);
await evalJs(`document.querySelector('.tab-btn[data-tab="mcp"]').click(); true`);
await waitFor(`document.querySelectorAll("#mcpStatus .mcp-row").length === 3`);
const rows = await evalJs(`[...document.querySelectorAll("#mcpStatus .mcp-row")].map(r => r.textContent).join(" | ")`);
check(
  "settings list each server with its tool count and how it is handed over",
  /local2 件工具 · 逐件/.test(rows) && /big42 件工具 · 按需/.test(rows) && /web2 件工具 · 逐件/.test(rows),
  rows
);
await evalJs(`document.querySelector('[data-mcp="local"] [data-mcp-action="toggle"]').click(); true`);
await waitFor(`/已停用/.test(document.querySelector('[data-mcp="local"]').textContent)`);
const disabled = await evalJs(
  `__yanState().settings.mcpServers.local.disabled === true && /"disabled": true/.test(document.querySelector("#mcpConfig").value)`
);
check("disabling a server is written into its config and shown in the editor", disabled);
await evalJs(
  `document.querySelector("#mcpConfig").value = '{"mcpServers": {"bad": {"args": []}}}'; document.querySelector("#mcpSave").click(); true`
);
const error = await evalJs(`document.querySelector("#mcpError").textContent`);
check("a config without command or url is refused with a reason", /bad.*command.*url/.test(error), error);
// 粘进来的若只是里面那一层（不带 mcpServers 外壳）也收
await evalJs(
  `document.querySelector("#mcpConfig").value = JSON.stringify({ solo: { command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(FAKE)}] } }); document.querySelector("#mcpSave").click(); true`
);
await waitFor(`/2 件工具/.test(document.querySelector('[data-mcp="solo"]')?.textContent || "")`, 30000);
check("a bare server map (no mcpServers wrapper) is accepted and connected", true);
// 只写了 url 的旧式 SSE 服务：新式握手被拒（405），自动退回 SSE 再连
await evalJs(
  `document.querySelector("#mcpConfig").value = JSON.stringify({ legacy: { url: "http://127.0.0.1:${SSE_PORT}/sse" } }); document.querySelector("#mcpSave").click(); true`
);
await waitFor(`/2 件工具|连不上/.test(document.querySelector('[data-mcp="legacy"]')?.textContent || "")`, 30000);
const legacy = await evalJs(`document.querySelector('[data-mcp="legacy"]').textContent`);
check("a url-only legacy SSE server is reached by falling back from streamable HTTP", /2 件工具/.test(legacy), legacy);
await close();
process.exit(0);
