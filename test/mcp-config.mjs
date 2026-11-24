// mcp_config：模型自己看和改设置里的 MCP 服务。问而后行里写这份配置要先请示（写明服务与命令），准了接上；
// 下一问的工具表里就有这个服务的工具，设置里也留着这份配置（配置.json 的 mcpServers 那一节）
import { connect, check, sleep, PAGE } from "./lib.mjs";

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
    mcpServers: {}
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
const ask = async (selector, text, sendSel) => {
  await evalJs(
    `document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(text)}; document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event("input")); document.querySelector(${JSON.stringify(sendSel)}).click(); true`
  );
};
const replyText = `([...document.querySelectorAll('#messages .message.assistant')].at(-1)?.textContent || '')`;
await ask("#welcomeInput", "MCPCONF 接一个本机服务", "#welcome .send-trigger");
// 问而后行：写这份配置要起本机进程，先请示；请示条上写明要添的服务与命令
await waitFor(`!!document.querySelector('#approvalBar:not(.hidden) [data-approve="run"]')`, 60000);
const bar = await evalJs(`document.querySelector("#approvalBar").textContent`);
check("writing MCP config asks first under 问而后行, naming the server", /cfg/.test(bar) && /fake-mcp/.test(bar), bar.slice(0, 300));
await evalJs(`document.querySelector('#approvalBar [data-approve="run"]').click(); true`);
await waitFor(`${replyText}.includes("MCPCONF|")`, 90000);
const first = await evalJs(replyText);
check("the tool result lists the new server as connected", /【cfg】本机 · 已连接/.test(first), first.slice(-400));
check(
  "the config is stored in settings",
  await evalJs(`(s => !!s && s.command && s.args.some(a => /fake-mcp\\.mjs$/.test(a)))(__yanState().settings.mcpServers.cfg)`)
);
// 下一问：这一答开工时算的工具表里已有这个服务的 echo
const count = await evalJs(`document.querySelectorAll("#messages .message.assistant").length`);
await ask("#chatInput", "MCPCONF2 报一下", "#chatSend");
await waitFor(
  `document.querySelectorAll("#messages .message.assistant").length > ${count} && ${replyText}.includes("MCPCONF|tools:")`,
  60000
);
const second = await evalJs(replyText);
check("the next question's tool list carries the server's tools", /tools:[^|]*mcp__cfg__echo/.test(second), second.slice(-300));
await close();
