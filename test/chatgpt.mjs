// ChatGPT 订阅：旧的「Codex 订阅」配置换过来；设置里点登录 → 浏览器授权（这里由用例代浏览器走一趟）→ 登上后自动取模型列表；
// 对话直发 Responses 接口、带令牌、store 为 false；退出时吊销，再登录沿用头一回发下的 client_id
import { rmSync } from "node:fs";
import { connect, check, sleep, PAGE, HOME } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
rmSync(`${HOME}/ChatGPT 登录.json`, { force: true });
const log = async () => (await fetch("http://127.0.0.1:8798/chatgpt-log")).json();
const before = await log();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
const profile = { id: "p1", name: "订阅", api: "codex", model: "gpt-sub", quota: "", usedTokens: 0 };
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [${JSON.stringify(profile)}], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
check("an old Codex profile becomes a ChatGPT one", (await evalJs(`__yanState().profiles[0].api`)) === "chatgpt");
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
await evalJs(`document.querySelector('.tab-btn[data-tab="models"]').click(); true`);
await evalJs(`document.querySelector('[data-profile-card="p1"]').open = true; true`);
const card = `document.querySelector('[data-profile-card="p1"]')`;
await waitFor(`${card}.querySelector("[data-chatgpt-account]")?.textContent === "未登录"`, 5000);
check("the card shows the account row instead of Base URL and key", !(await evalJs(`!!${card}.querySelector('[data-field="baseUrl"]')`)));

// 登录：桥接回一个授权网址（测试里不开系统浏览器），用例代浏览器打开它，假授权端 302 回桥接的回调口
await evalJs(`${card}.querySelector('[data-profile-action="login"]').click(); true`);
await waitFor(`!!${card}.querySelector(".profile-status a")`, 5000);
const url = await evalJs(`${card}.querySelector(".profile-status a").href`);
const landing = await (await fetch(url)).text();
check("the callback page says signed in", landing.includes("已登录"), landing.slice(0, 80));
await waitFor(`${card}.querySelector("[data-chatgpt-account]")?.textContent.includes("me@example.com")`, 8000);
await waitFor(`${card}.querySelector(".profile-status").textContent.includes("已获取 2 个模型")`, 8000);
check("after signing in the model list comes in, newest included, hidden ones left out", true);
const first = (await log()).authorize.slice(before.authorize.length)[0] || {};
check(
  "first sign-in registers through the dynamic client with PKCE, host id and the app name",
  first.client_id === "dynamic_agent_client" &&
    first.code_challenge_method === "S256" &&
    !!first.ext_agent_host_id &&
    first.agent_name_hint === "言" &&
    first.scope?.includes("chatgpt.tokens.use.direct") &&
    first.redirect_uri?.startsWith("http://127.0.0.1:"),
  JSON.stringify(first)
);
const exchange = (await log()).tokens.at(-1) || {};
check(
  "the code is exchanged with the issued client id and the verifier",
  exchange.client_id === "oaiapp_test" && !!exchange.code_verifier && exchange.resource === "https://api.openai.com/v1",
  JSON.stringify(exchange)
);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(200);

// 对话：直发 Responses，带令牌、store 为 false、系统提示进 instructions
await evalJs(
  `document.querySelector("#welcomeInput").value = "你好"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`(__yanState().conversations[0]?.messages || []).some(m => m.role === "assistant" && m.status === "complete")`, 15000);
const reply = await evalJs(`__yanState().conversations[0].messages.find(m => m.role === "assistant").content`);
check("chat goes straight to the Responses API with the token", /CHATGPT\|bearer:true\|store:false\|instr:true/.test(reply), reply);
// 缓存键要同时放进请求头的 session_id：后端照它找存着前文的那一处，只放请求体里一回也不中
check("the cache key also rides in the session_id header", reply.includes("|session:true"), reply);

// 退出：吊销刷新令牌；再登录沿用发下的 client_id，不再报名字
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
await evalJs(`document.querySelector('.tab-btn[data-tab="models"]').click(); true`);
await evalJs(`${card}.open = true; true`);
await waitFor(`!!${card}.querySelector('[data-profile-action="logout"]')`, 5000);
await evalJs(`${card}.querySelector('[data-profile-action="logout"]').click(); true`);
await waitFor(`${card}.querySelector("[data-chatgpt-account]")?.textContent === "未登录"`, 5000);
check("signing out revokes the refresh token", (await log()).revoked === before.revoked + 1);
await evalJs(`${card}.querySelector('[data-profile-action="login"]').click(); true`);
await waitFor(`!!${card}.querySelector(".profile-status a")`, 5000);
await fetch(await evalJs(`${card}.querySelector(".profile-status a").href`));
await waitFor(`${card}.querySelector("[data-chatgpt-account]")?.textContent.includes("me@example.com")`, 8000);
const again = (await log()).authorize.at(-1) || {};
check(
  "signing in again reuses the issued client id and the same host id",
  again.client_id === "oaiapp_test" && !again.agent_name_hint && again.ext_agent_host_id === first.ext_agent_host_id,
  JSON.stringify(again)
);
close();
