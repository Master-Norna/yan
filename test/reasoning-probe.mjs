// 探思考档位：选定模型时故意送一个不存在的档位，从报错里记下它认的几档——只认三档的记三档、不认识字段的记 none、照单全收的按四档
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(800);
const profile = (id, model) =>
  `{ id: ${JSON.stringify(id)}, source: "custom", name: ${JSON.stringify(id)}, model: ${JSON.stringify(model)}, baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }`;
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false, reasoning: "max" }, profiles: [${profile("p1", "fake")}, ${profile("p2", "fake-three")}, ${profile("p3", "fake-plain")}, ${profile("p4", "fake-mute")}], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const stored = id =>
  evalJs(
    `(p => p.reasoningLevels + "|" + (p.reasoningProbed || ""))(JSON.parse(localStorage.getItem("yan-chat-v1")).profiles.find(p => p.id === ${JSON.stringify(id)}))`
  );
const menu = () =>
  evalJs(
    `[...document.querySelectorAll("#modelMenu [data-reasoning]")].map(b => b.textContent + (b.classList.contains("active") ? "*" : "")).join(",") || document.querySelector("#modelMenu .menu-section-note")?.textContent`
  );
const pick = async id => {
  await evalJs(`document.querySelector("#welcome .model-trigger").click(); true`);
  await sleep(200);
  await evalJs(`document.querySelector('#modelMenu .model-option[data-profile="${id}"]').click(); true`);
};
// 不点不探：开页时的默认模型没探过
check("nothing is probed until a model is picked", (await stored("p1")) === "undefined|", await stored("p1"));
// 只认三档的：记三档，菜单只列三档，「最高」落到「高」
await pick("p2");
await waitFor(`JSON.parse(localStorage.getItem("yan-chat-v1")).profiles[1].reasoningProbed === "fake-three"`, 8000);
check("a three-level model is learned as three", (await stored("p2")) === "low, medium, high|fake-three", await stored("p2"));
await evalJs(`document.querySelector("#welcome .model-trigger").click(); true`);
await sleep(200);
check("menu lists the three and lights the nearest to 最高", (await menu()) === "默认,低,中,高*", await menu());
check(
  "trigger label shows the level actually used",
  (await evalJs(`document.querySelector("#welcome .model-trigger .model-extra")?.textContent`)) === "· 思考 高",
  await evalJs(`document.querySelector("#welcome .model-trigger .model-extra")?.textContent`)
);
await evalJs(`document.body.click(); true`);
// 不认识 reasoning_effort 的：记 none，菜单上只剩一句话，请求里不带字段
await pick("p3");
await waitFor(`JSON.parse(localStorage.getItem("yan-chat-v1")).profiles[2].reasoningProbed === "fake-plain"`, 8000);
check("a model without the field is learned as none", (await stored("p3")) === "none|fake-plain", await stored("p3"));
await evalJs(`document.querySelector("#welcome .model-trigger").click(); true`);
await sleep(200);
check("menu says the model has no levels", (await menu()) === "此模型不认思考档位", await menu());
check(
  "trigger label drops the level",
  (await evalJs(`document.querySelector("#welcome .model-trigger .model-extra")?.textContent`)) === "",
  await evalJs(`document.querySelector("#welcome .model-trigger .model-extra")?.textContent`)
);
await evalJs(`document.body.click(); true`);
// 照单全收的：按通用四档
await pick("p4");
await waitFor(`JSON.parse(localStorage.getItem("yan-chat-v1")).profiles[3].reasoningProbed === "fake-mute"`, 8000);
check(
  "a model that accepts anything keeps the four defaults",
  (await stored("p4")) === "low, medium, high, max|fake-mute",
  await stored("p4")
);
// 再选一次不再探（探过的模型记在 reasoningProbed 上）
const calls = await fetch("http://127.0.0.1:8798/calls")
  .then(r => r.text())
  .catch(() => "");
await pick("p2");
await sleep(600);
const callsAfter = await fetch("http://127.0.0.1:8798/calls")
  .then(r => r.text())
  .catch(() => "");
check("a probed model is not probed again", calls === callsAfter, `${calls} → ${callsAfter}`);
// 设置里：测试连接顺带重探，状态行报档位；高级配置里的「思考档位」跟着填
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
await evalJs(`document.querySelector('.tab-btn[data-tab="models"]').click(); true`);
await sleep(300);
await evalJs(`document.querySelector('[data-profile-card="p2"] [data-profile-action="test"]').click(); true`);
await waitFor(`/思考档位/.test(document.querySelector('[data-profile-card="p2"] .profile-status')?.textContent || "")`, 8000);
const status = await evalJs(`document.querySelector('[data-profile-card="p2"] .profile-status').textContent`);
check("test connection reports the levels", /可用 · \d+ ms · 思考档位 低 \/ 中 \/ 高/.test(status), status);
check(
  "advanced config shows the learned levels",
  (await evalJs(`document.querySelector('[data-profile-card="p2"] [data-field="reasoningLevels"]').value`)) === "low, medium, high"
);
close();
