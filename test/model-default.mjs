// 默认模型只在设置里「设为默认」时改：打开旧对话、在菜单里换模型都只动眼前这段；新对话起手照默认。设置里的模型平时收成一行
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
const t = new Date().toISOString(),
  profile = (id, name) => ({
    id,
    source: "custom",
    name,
    model: "fake",
    baseUrl: "http://127.0.0.1:8798/v1",
    apiKey: "k",
    temperature: 0.7,
    quota: "",
    usedTokens: 0
  }),
  old = {
    id: "b",
    title: "乙谈",
    createdAt: t,
    updatedAt: t,
    profileId: "p2",
    titled: true,
    messages: [
      { id: "u1", role: "user", content: "旧问", timestamp: t },
      { id: "a1", role: "assistant", content: "旧答", timestamp: t, status: "complete" }
    ],
    forks: [],
    threads: []
  };
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [${JSON.stringify(profile("p1", "甲"))}, ${JSON.stringify(profile("p2", "乙"))}], conversations: [${JSON.stringify(old)}], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
const trigger = scope => evalJs(`document.querySelector("${scope} .model-trigger .model-name").textContent`),
  defaultId = () => evalJs(`__yanState().settings.activeProfileId`);
const offered = await trigger("#welcome");
check("a new chat starts with the default model", offered === "甲", offered);

// 打开一段用乙的旧对话：眼前是乙，默认仍是甲
await evalJs(`document.querySelector('[data-conversation="b"]').click(); true`);
await sleep(300);
check(
  "an old chat shows its own model without moving the default",
  (await trigger("#composerArea")) === "乙" && (await defaultId()) === "p1"
);
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(200);
check("back on a new chat, the default is still the one offered", (await trigger("#welcome")) === "甲");

// 欢迎页上换成乙：只归这段新对话，发出后记在它身上；再起新对话又是甲
await evalJs(`document.querySelector("#welcome .model-trigger").click(); true`);
await sleep(150);
await evalJs(`document.querySelector('#modelMenu [data-profile="p2"]').click(); true`);
await sleep(150);
check(
  "picking a model on the welcome page applies to that chat only",
  (await trigger("#welcome")) === "乙" && (await defaultId()) === "p1"
);
await evalJs(
  `document.querySelector("#welcomeInput").value = "你好"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
// 发出即成一段对话（假模型接着要跑指令、等确认，不必等它答完）
await waitFor(`__yanState().conversations.length === 2`, 20000);
const started = await evalJs(
  `JSON.stringify(__yanState().conversations.map(c => [c.id, c.profileId]).concat([__yanState().settings.activeProfileId]))`
);
check(
  "the new chat keeps the model it was started with",
  JSON.parse(started).some(([id, p]) => id !== "b" && p === "p2") && JSON.parse(started).at(-1) === "p1",
  started
);
await evalJs(`document.querySelector("#newChat").click(); true`);
await sleep(200);
check("the next new chat is back to the default", (await trigger("#welcome")) === "甲");

// 设置 → 模型：平时一行一个，点开才是整张表；「设为默认」才改默认
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(200);
await evalJs(`document.querySelector('.tab-btn[data-tab="models"]').click(); true`);
await sleep(200);
await shot("model-rows.png");
check(
  "each model is one collapsed row with its model id and interface",
  await evalJs(
    `(cards => cards.length === 2 && cards.every(c => !c.open) && cards[0].querySelector(".profile-gist").textContent === "fake · OpenAI 兼容" && !!cards[0].querySelector(".profile-badge"))([...document.querySelectorAll("#profileList .profile-card")])`
  )
);
await evalJs(`document.querySelector('[data-profile-card="p2"] .profile-head').click(); true`);
await sleep(150);
check("clicking a row opens its form", await evalJs(`document.querySelector('[data-profile-card="p2"]').open`));
await evalJs(`document.querySelector('[data-profile-card="p2"] [data-profile-action="default"]').click(); true`);
await sleep(200);
check(
  "设为默认 moves the default and the row stays open",
  (await defaultId()) === "p2" &&
    (await evalJs(
      `document.querySelector('[data-profile-card="p2"]').open && !!document.querySelector('[data-profile-card="p2"] .profile-badge')`
    ))
);
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await sleep(300);
check("new chats now start with the new default", (await trigger("#welcome")) === "乙");
close();
