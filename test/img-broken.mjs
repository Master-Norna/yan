// 正文里的图：模型写得再歪（空、./、#、以 / 收尾、sandbox:/、认不出名字、srcset），页面也不留破图——
// 由页面按这段对话的落脚处认，取不到就留下它想说的那句话。正常的路照样画得出来，Windows 反斜杠的也能。
import { mkdirSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, HOME } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
// 卷宗里放一张真图：1×1 透明 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
mkdirSync(`${HOME}/卷宗`, { recursive: true });
writeFileSync(`${HOME}/卷宗/probe.png`, PNG);
// 文件名里带 # 的一件：转义写法 plot%231.png 要认得出它
writeFileSync(`${HOME}/卷宗/plot#1.png`, PNG);
const winPath = `${HOME}/卷宗/probe.png`.replace(/\//g, "\\");
const body = [
  "正路 ![正路](probe.png)",
  `反斜杠 ![反斜杠](${winPath})`,
  "转义 ![转义](plot%231.png)",
  "甲 ![空](./)",
  "乙 ![井](#)",
  "丙 ![目录](nope.png/)",
  "丁 ![沙盒](sandbox:/mnt/data/x.png)",
  "戊 ![裸名](chart)",
  "己 ![坏数据](data:image/png;base64,AAA)",
  "庚 ![外站](https://example.com/x.png)",
  '辛 ![照源](probe.png) <img srcset="probe.png 2x" alt="照源">',
  '壬 <input type="image" src="probe.png" alt="坏表单">'
].join("\n\n");
const conv = {
  id: "c1",
  title: "图的写法",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  profileId: "p1",
  messages: [
    { id: "u1", role: "user", content: "看看", timestamp: new Date().toISOString() },
    { id: "a1", role: "assistant", content: body, timestamp: new Date().toISOString(), status: "complete", modelName: "假模型", steps: [] }
  ]
};
const state = {
  version: 5,
  settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, mode: "chat" },
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
  conversations: [conv],
  library: [],
  drafts: {}
};
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(`localStorage.setItem("yan-chat-v1", ${JSON.stringify(JSON.stringify(state))}); true`);
await send("Page.navigate", { url: PAGE });
await sleep(1800);
await evalJs(`document.querySelector('[data-conversation="c1"] .history-open')?.click(); true`);
// 反斜杠那一幅要等原路取不到再按同名找回，慢机器上 2.5 秒未必够：等五幅都画出来再量，等不到就照现状量、由下面的断言说清少了哪一幅
await waitFor(
  `document.querySelectorAll(".reply-shot img").length === 5 && [...document.querySelectorAll(".reply-shot img")].every(img => img.naturalWidth > 0)`,
  8000
).catch(() => {});
await sleep(120);
const view = JSON.parse(
  await evalJs(
    `JSON.stringify({
      imgs: [...document.querySelectorAll(".markdown img")].map(img => ({ src: img.getAttribute("src"), nw: img.naturalWidth, complete: img.complete, alt: img.getAttribute("alt") })),
      shots: [...document.querySelectorAll(".reply-shot img")].map(img => ({ alt: img.getAttribute("alt"), nw: img.naturalWidth })),
      shotFiles: [...document.querySelectorAll(".reply-shot")].map(s => s.dataset.openFile || s.dataset.openImage || s.dataset.openRemote || ""),
      remote: document.querySelectorAll(".markdown .remote-shot").length,
      formSrc: document.querySelector(".markdown input[type=image]")?.getAttribute("src") || null,
      text: document.querySelector(".markdown")?.textContent || ""
    })`
  )
);
check(
  "正文里没有加载失败的图",
  view.imgs.every(img => !img.src || !img.complete || img.nw > 0),
  JSON.stringify(view.imgs)
);
check(
  "没有图把 src 留成页内相对路径（空、./、#、以 / 收尾都不行）",
  view.imgs.every(img => !img.src || /^(?:data:|\/api\/)/.test(img.src)),
  JSON.stringify(view.imgs.map(img => img.src))
);
check(
  "认不出的图留下它想说的那句话",
  ["空", "井", "目录", "沙盒", "裸名"].every(word => view.text.includes(word)),
  view.text.slice(0, 200)
);
check("坏掉的数据图也不留破图", !view.imgs.some(img => img.alt === "坏数据"));
check(
  "相对路径与 Windows 反斜杠的图都画得出来",
  view.shots.every(shot => shot.nw > 0),
  JSON.stringify(view.shots)
);
check(
  "文件名里的转义（plot%231.png）认得出",
  view.shotFiles.some(file => file.includes("plot#1.png")),
  JSON.stringify(view.shotFiles)
);
// 按画出来的先后认：正路、绝对路径（Windows 写成反斜杠）、转义名、照源两幅。名字对了才知道少的是哪一幅
check(
  "只画出该画的五幅（正路、绝对路径、转义名、照源两幅）",
  JSON.stringify(view.shots.map(shot => shot.alt)) === JSON.stringify(["正路", "反斜杠", "转义", "照源", "照源"]) &&
    view.shotFiles.length === 5,
  JSON.stringify(view.shots)
);
check("外链图仍是待取的素纸，页面不去取", view.remote >= 1 && view.imgs.every(img => !/^https?:/.test(img.src || "")));
check("input[type=image] 也不让浏览器去取", !view.formSrc, JSON.stringify(view.formSrc));
close();
