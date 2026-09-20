// 思考档位：接口只认 low / medium / xhigh 时，选「高」不该失败——从报错里学到它认的档位、换成最接近的一档重发，并记到模型上
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false, reasoning: "high" }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
// 档位未知时菜单是通用三档，「高」点亮
await evalJs(`document.querySelector("#welcome .model-trigger").click(); true`);
await sleep(200);
const before = await evalJs(
  `[...document.querySelectorAll("#modelMenu [data-reasoning]")].map(b => b.textContent + (b.classList.contains("active") ? "*" : "")).join(",")`
);
check("menu shows generic levels with 高 active", before === "默认,低,中,高*,最高", before);
await evalJs(`document.body.click(); true`);
await evalJs(
  `document.querySelector("#welcomeInput").value = "EFFORT"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
try {
  await waitFor(`document.querySelector('.message.assistant')?.dataset.status === "complete"`, 20000);
} catch (e) {
  check(
    "DEBUG",
    false,
    JSON.stringify(
      await evalJs(
        `(a => a ? { status: a.dataset.status, err: a.querySelector(".message-error")?.textContent, text: a.textContent.slice(0, 200) } : "no assistant")(document.querySelector('.message.assistant'))`
      )
    )
  );
  throw e;
}
const text = await evalJs(`document.querySelector(".message.assistant .markdown").textContent.trim()`);
check("request retried with the nearest accepted level (high → xhigh)", text === "EFFORT|xhigh", text);
check("no error shown on the reply", await evalJs(`!document.querySelector(".message.assistant .message-error")`));
const stored = await evalJs(`JSON.parse(localStorage.getItem("yan-chat-v1")).profiles[0].reasoningLevels`);
check("levels learned onto the model", stored === "low, medium, xhigh", String(stored));
check(
  "trigger label shows the level actually used",
  (await evalJs(`document.querySelector("#composerArea .model-trigger .model-extra")?.textContent`)) === "· 思考 极高",
  await evalJs(`document.querySelector("#composerArea .model-trigger .model-extra")?.textContent`)
);
await evalJs(`document.querySelector("#composerArea .model-trigger").click(); true`);
await sleep(200);
const after = await evalJs(
  `[...document.querySelectorAll("#modelMenu [data-reasoning]")].map(b => b.textContent + (b.classList.contains("active") ? "*" : "")).join(",")`
);
check("menu now shows the model's own levels with 极高 active", after === "默认,低,中,极高*", after);
// 再问一次：直接按学到的档位发，不再撞错
await evalJs(`document.querySelector('#modelMenu [data-reasoning="medium"]').click(); true`);
await evalJs(`document.body.click(); true`);
await evalJs(
  `document.querySelector("#chatInput").value = "EFFORT again"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
await waitFor(
  `document.querySelectorAll('.message.assistant').length === 2 && [...document.querySelectorAll('.message.assistant')].at(-1)?.dataset.status === "complete"`,
  20000
);
const second = await evalJs(`[...document.querySelectorAll(".message.assistant .markdown")].at(-1).textContent.trim()`);
check("chosen level sent as-is once known", second === "EFFORT|medium", second);
// 设置页里能看到并手改档位
await evalJs(`document.querySelector("#openSettings")?.click() || document.querySelector('[data-open-settings]')?.click(); true`);
await sleep(300);
await evalJs(`document.querySelector('.tab-btn[data-tab="models"]')?.click(); true`);
await sleep(300);
const field = await evalJs(`document.querySelector('[data-profile-card="p1"] [data-field="reasoningLevels"]')?.value`);
check("advanced settings show the learned levels", field === "low, medium, xhigh", String(field));
close();
