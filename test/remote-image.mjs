// 正文里的外链图：页面不直连外站，画成一张待取的素纸（图名与来处）；点了经桥接取，取不到的写明缘由、再点交系统浏览器。
// 本例只验取图被拒后的字样和再次点击的系统浏览器提示；不测试公网取图成功，也不真打开系统浏览器。
import { connect, check, sleep, PAGE } from "./lib.mjs";

const { send, evalJs, waitFor, shot, close } = await connect();
const at = "2026-10-28T00:00:00.000Z";
const seed = {
  version: 4,
  settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false },
  profiles: [
    {
      id: "p1",
      source: "custom",
      name: "假模型",
      model: "fake",
      baseUrl: "http://127.0.0.1:8798/v1",
      apiKey: "k",
      quota: "",
      usedTokens: 0
    }
  ],
  conversations: [
    {
      id: "r1",
      title: "外链图",
      forks: [],
      threads: [],
      createdAt: at,
      updatedAt: at,
      profileId: "p1",
      messages: [
        { id: "u1", role: "user", content: "画张图", timestamp: at },
        {
          id: "a1",
          role: "assistant",
          content: "图在这里：\n\n![疏开间距后的机制图](http://127.0.0.1:9/fig1.png)\n\n完。",
          timestamp: at,
          status: "complete"
        }
      ]
    }
  ],
  library: [],
  drafts: {}
};
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(seed))}); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
await evalJs(`document.querySelector('#history [data-conversation="r1"]')?.click(); true`);
await waitFor(`!!document.querySelector(".message.assistant .markdown .remote-shot")`, 5000).catch(() => {});
const chip = `document.querySelector(".message.assistant .markdown .remote-shot")`;
check(
  "a linked image shows as a paper slip with its name and host, not a broken image",
  await evalJs(
    `(c => !!c && c.textContent.includes("疏开间距后的机制图") && c.textContent.includes("127.0.0.1:9") && !document.querySelector(".message.assistant .markdown img"))(${chip})`
  )
);
await shot("remote-image.png");
await evalJs(`${chip}.click(); true`);
await waitFor(`${chip}?.classList.contains("failed")`, 8000).catch(() => {});
check(
  "a fetch the address gate refuses says why and offers the browser",
  await evalJs(`(c => c.classList.contains("failed") && c.textContent.includes("未能取来") && c.textContent.includes("浏览器"))(${chip})`),
  await evalJs(`${chip}?.textContent`)
);
await shot("remote-image-failed.png");
await evalJs(`${chip}.click(); true`);
await waitFor(`document.querySelector("#toast")?.textContent.includes("系统浏览器")`, 5000).catch(() => {});
check(
  "clicking again hands it to the system browser",
  await evalJs(`!!document.querySelector("#toast")?.textContent.includes("系统浏览器")`)
);
await close();
