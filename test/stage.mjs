// 看台：言的页面直连浏览器调试口（这里借测试用的这个 Edge 充当模型所用的浏览器）——
// 调试口从服务的 --config 文件里读、找到浏览器挂出入口、标签照抄、画面送到、点按与打字（含输入法那一路）递进网页、
// 模型换页跟过去、网页的提示框画在画面上、前后按历史走、旁注开着时让位且停收画面、收起后入口回来、拖宽窄有界
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connect, check, sleep, PAGE, TMP, MODEL_DEBUG } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
const bail = () => {
  close();
  try {
    browser.close();
  } catch {}
  process.exit(1);
};
// 浏览器的配置目录与收藏：配置里一个停用的「浏览器」服务只为带出 --user-data-dir（真的 playwright 这里不起）
const PROFILE = `${TMP}/stage-profile`;
const markPage = "data:text/html;charset=utf-8," + encodeURIComponent("<title>收藏页</title>");
mkdirSync(`${PROFILE}/Default`, { recursive: true });
writeFileSync(
  `${PROFILE}/Default/Bookmarks`,
  JSON.stringify({
    roots: {
      bookmark_bar: { children: [{ type: "folder", name: "学术", children: [{ type: "url", name: "测试收藏", url: markPage }] }] },
      other: { children: [] }
    }
  })
);
// 调试口写在 --config 那份文件里：先写一个没人听的口，开页时找不到浏览器；之后改成测试 Edge 的口再去找
const CONFIG = `${TMP}/stage.json`;
const writeConfig = port =>
  writeFileSync(CONFIG, JSON.stringify({ browser: { launchOptions: { args: [`--remote-debugging-port=${port}`] } } }));
writeConfig(1);
const mcpServers = { 浏览器: { command: "node", args: ["cli.js", "--config", CONFIG, "--user-data-dir", PROFILE], disabled: true } };
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, mcpServers: ${JSON.stringify(mcpServers)} }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, quota: "", usedTokens: 0 }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await evalJs(
  `window.__yanExceptions = []; window.addEventListener("error", e => window.__yanExceptions.push(String(e.error || e.message))); window.addEventListener("unhandledrejection", e => window.__yanExceptions.push(String(e.reason))); true`
);

// 「模型的页」：在另一个浏览器实例的同一个窗口里新开一个标签（言的页面留在测试浏览器，不会被切到后台）。
// 左上一块大按钮，右边一个输入框，标题随之变
const html = `<title>看台测试</title><body style="margin:0"><button style="position:fixed;left:0;top:0;width:50vw;height:50vh" onclick="document.title='点中了'">点我</button><input id="i" style="position:fixed;left:60vw;top:10vh;width:30vw;height:10vh" oninput="document.title='输入:'+this.value"></body>`;
let version;
try {
  version = await (await fetch(MODEL_DEBUG + "/json/version")).json();
} catch {
  throw Error(`模型浏览器（${MODEL_DEBUG}）未就绪：stage.mjs 需由 test/run.mjs 启动`);
}
const browser = new WebSocket(version.webSocketDebuggerUrl);
await new Promise(r => (browser.onopen = r));
let seq = 0;
const browserSend = (method, params = {}, sessionId) =>
  new Promise(resolve => {
    const id = ++seq;
    const listener = e => {
      const m = JSON.parse(e.data);
      if (m.id === id) {
        browser.removeEventListener("message", listener);
        resolve(m.result);
      }
    };
    browser.addEventListener("message", listener);
    browser.send(JSON.stringify({ id, method, params, sessionId }));
  });
const { targetId } = await browserSend("Target.createTarget", {
  url: "data:text/html;charset=utf-8," + encodeURIComponent(html)
});
// 像 playwright 交给模型的那个浏览器一样，一个窗口里只留这一张签：关掉实例自带的空白页和浏览器自己的对话框，
// 否则它们会与模型页抢前台，无头下后台页又不重绘，画面尺寸的断言就时灵时不灵
for (const { targetId: id, type } of (await browserSend("Target.getTargets")).targetInfos)
  if (type === "page" && id !== targetId) await browserSend("Target.closeTarget", { targetId: id });
await sleep(800);

check("no pin before the browser is found", await evalJs(`document.querySelector("#stagePin").classList.contains("hidden")`));
writeConfig(new URL(MODEL_DEBUG).port);
await evalJs(`__yanStage.locate().then(() => true)`);
await waitFor(`!document.querySelector("#stagePin").classList.contains("hidden")`, 8000);
check("pin appears once the browser is found", true);
check("tabs mirror the browser", await evalJs(`[...__yanStage.state.tabs.values()].some(t => t.title === "看台测试")`));

// 点入口开看台
await evalJs(`document.querySelector("#stagePin").click(); true`);
await waitFor(`!document.querySelector("#stagePanel").classList.contains("hidden")`);
check("pin hides while the stage is open", await evalJs(`document.querySelector("#stagePin").classList.contains("hidden")`));
// 换到那一页：点它的签
await evalJs(`[...document.querySelectorAll("[data-stage-tab]")].find(t => t.textContent.includes("看台测试")).click(); true`);
await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)} && __yanStage.state.session !== ""`);
await waitFor(`document.querySelector("#stageFrame").naturalWidth > 0`, 8000);
check("frame arrives for the chosen tab", true);
check("chosen tab is marked", await evalJs(`document.querySelector(".stage-tab.on")?.textContent.includes("看台测试")`));
// 浏览器的窗口跟上看台的大小（有下限）：网页按原大显示。等它调完再量，不然点按的位置对不上
const want = await evalJs(
  `(r => ({ w: Math.max(960, Math.round(r.width - 24)), h: Math.max(600, Math.round(r.height - 24)) }))(document.querySelector("#stageView").getBoundingClientRect())`
);
const tFollow = Date.now();
let followOk = false;
try {
  await waitFor(`Math.abs(__yanStage.state.meta.width - ${want.w}) < 4 && Math.abs(__yanStage.state.meta.height - ${want.h}) < 4`, 8000);
  followOk = true;
} catch {}
const metaFollow = await evalJs(`__yanStage.state.meta`).catch(() => null);
check(
  "the browser window follows the stage size",
  followOk,
  JSON.stringify({ want, meta: metaFollow, elapsed: `${Date.now() - tFollow}ms` })
);
if (!followOk) bail();
// 宽够时（阔开着）画面一比一：画幅正是网页的原大、落在整像素上，静下来换成一张 PNG
await evalJs(`document.querySelector("#stageWide").click(); true`);
const sharp = `(() => { const img = document.querySelector("#stageFrame"), r = img.getBoundingClientRect(), m = __yanStage.state.meta; return r.width === m.width && r.height === m.height && img.naturalWidth === Math.round(m.width * devicePixelRatio) && Number.isInteger(r.left * devicePixelRatio) && Number.isInteger(r.top * devicePixelRatio); })()`;
await waitFor(sharp, 8000).catch(() => {});
check(
  "with room to spare the frame shows one to one on whole pixels",
  await evalJs(sharp),
  JSON.stringify(
    await evalJs(
      `(img => ({ rect: img.getBoundingClientRect(), natural: [img.naturalWidth, img.naturalHeight], meta: __yanStage.state.meta }))(document.querySelector("#stageFrame"))`
    )
  )
);
await waitFor(`document.querySelector("#stageFrame").src.startsWith("data:image/png")`, 5000).catch(() => {});
check("a still page settles into a lossless frame", await evalJs(`document.querySelector("#stageFrame").src.startsWith("data:image/png")`));
await evalJs(`document.querySelector("#stageWide").click(); true`);
const tRestore = Date.now();
let restoreOk = false;
try {
  await waitFor(`Math.abs(__yanStage.state.meta.width - ${want.w}) < 4 && Math.abs(__yanStage.state.meta.height - ${want.h}) < 4`, 8000);
  restoreOk = true;
} catch {}
const metaRestore = await evalJs(`__yanStage.state.meta`).catch(() => null);
check(
  "the browser window follows the stage size after wide toggled off",
  restoreOk,
  JSON.stringify({ want, meta: metaRestore, elapsed: `${Date.now() - tRestore}ms` })
);
if (!restoreOk) bail();
const tFrame = Date.now();
let frameOk = false;
try {
  await waitFor(
    `(() => {
      const img = document.querySelector("#stageFrame"), m = __yanStage.state.meta;
      return img && img.naturalWidth > 0 && Math.abs(img.naturalWidth - Math.round(m.width * devicePixelRatio)) <= 2;
    })()`,
    8000
  );
  frameOk = true;
} catch {}
const frameSize = await evalJs(`(() => {
  const img = document.querySelector("#stageFrame"), m = __yanStage.state.meta;
  return { naturalWidth: img?.naturalWidth || 0, expectedWidth: Math.round(m.width * devicePixelRatio), meta: m, dpr: devicePixelRatio };
})()`).catch(() => null);
check("frame size matches meta after wide toggled off", frameOk, JSON.stringify({ frameSize, elapsed: `${Date.now() - tFrame}ms` }));
if (!frameOk) bail();
const geometry = await evalJs(
  `(r => ({ x: r.left, y: r.top, w: r.width, h: r.height, ratio: r.width / r.height }))(document.querySelector("#stageFrame").getBoundingClientRect())`
);
const meta = await evalJs(`__yanStage.state.meta`);
check(
  "frame keeps the page's aspect ratio",
  Math.abs(geometry.ratio - meta.width / meta.height) < 0.02,
  JSON.stringify({ geometry, meta })
);

// 在看台画面上点：落在网页左上那块按钮上
const mouse = async (type, x, y) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const at = (fx, fy) => [geometry.x + geometry.w * fx, geometry.y + geometry.h * fy];
await mouse("mousePressed", ...at(0.2, 0.2));
await mouse("mouseReleased", ...at(0.2, 0.2));
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "点中了"`, 8000).catch(() => {});
check("a click on the stage reaches the page", await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "点中了"`));

// 点输入框，再打字：按键一路、输入法（不经按键的文字）一路
await mouse("mousePressed", ...at(0.75, 0.15));
await mouse("mouseReleased", ...at(0.75, 0.15));
await sleep(200);
check("typing focuses the hidden key catcher", await evalJs(`document.activeElement === document.querySelector("#stageKeys")`));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, text: "a" });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
await send("Input.insertText", { text: "你好" });
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "输入:a你好"`, 8000).catch(() => {});
check(
  "keys and IME text reach the page",
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "输入:a你好"`),
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title`)
);
check("keys typed into the stage stay out of 言's own inputs", await evalJs(`!document.querySelector("#welcomeInput").value`));
// 输入法组字：拼音随打随现在网页里，选定后换成汉字；隐藏输入框已挪到网页里光标所在的输入框上（候选框跟着光标）
const title = () => evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title`);
await send("Input.imeSetComposition", { text: "ni", selectionStart: 2, selectionEnd: 2 });
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "输入:a你好ni"`, 8000).catch(() => {});
check("composing text shows up in the page as it is typed", (await title()) === "输入:a你好ni", await title());
await send("Input.insertText", { text: "呢" });
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "输入:a你好呢"`, 8000).catch(() => {});
check("committing replaces the composing text", (await title()) === "输入:a你好呢", await title());
await sleep(400);
const keysAt = await evalJs(`(r => ({ x: r.left, y: r.top }))(document.querySelector("#stageKeys").getBoundingClientRect())`);
check(
  "the hidden key catcher follows the page's caret",
  Math.abs(keysAt.x - (geometry.x + geometry.w * 0.6)) < geometry.w * 0.03 &&
    Math.abs(keysAt.y - (geometry.y + geometry.h * 0.1)) < geometry.h * 0.04,
  JSON.stringify({ keysAt, geometry })
);
await shot("stage.png");

// 网页弹的提示框：画在画面上，作答递回网页
await evalJs(`document.querySelector("#stageKeys").blur(); true`);
check("back is greyed out with no history", await evalJs(`document.querySelector("[data-stage-nav=back]").disabled`));
const ask =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<title>问</title><script>setTimeout(() => (document.title = "答:" + prompt("名字", "言")), 50)</script>`);
await evalJs(`__yanStage.go(${JSON.stringify(ask)}); true`);
await waitFor(`!document.querySelector("#stageDialog").classList.contains("hidden")`, 8000).catch(() => {});
check(
  "a page's prompt shows on the stage",
  await evalJs(
    `(d => !d.classList.contains("hidden") && d.textContent.includes("名字") && d.querySelector("input")?.value === "言")(document.querySelector("#stageDialog"))`
  )
);
await shot("stage-dialog.png");
await evalJs(
  `document.querySelector("#stageDialog input").value = "游目"; document.querySelector("[data-stage-answer=yes]").click(); true`
);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "答:游目"`, 8000).catch(() => {});
check(
  "the answer reaches the page",
  await evalJs(
    `__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "答:游目" && document.querySelector("#stageDialog").classList.contains("hidden")`
  ),
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title`)
);
// 前后：有了历史，后退亮起；退回去之后前进亮起
await waitFor(`!document.querySelector("[data-stage-nav=back]").disabled`, 5000).catch(() => {});
check("back lights up once there is history", await evalJs(`!document.querySelector("[data-stage-nav=back]").disabled`));
await evalJs(`document.querySelector("[data-stage-nav=back]").click(); true`);
await waitFor(`!document.querySelector("[data-stage-nav=forward]").disabled`, 5000).catch(() => {});
check(
  "back walks the history and forward lights up",
  await evalJs(
    `!document.querySelector("[data-stage-nav=forward]").disabled && __yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title !== "答:游目"`
  )
);

// 指针跟着网页、网页要选文件、浏览器自己的快捷键
const upload =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<title>传</title><body style="margin:0"><a href="#a" style="position:fixed;left:0;top:0;width:40vw;height:40vh;display:block">链接</a><input type="file" style="position:fixed;left:50vw;top:50vh;width:40vw;height:40vh" onchange="document.title='传:'+this.files[0].name"></body>`
  );
await evalJs(`__yanStage.go(${JSON.stringify(upload)}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传"`, 8000).catch(() => {});
await sleep(400);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at(0.2, 0.2)[0], y: at(0.2, 0.2)[1] });
await waitFor(`document.querySelector("#stageFrame").style.cursor === "pointer"`, 3000).catch(() => {});
check("the pointer turns into a hand over a link", await evalJs(`document.querySelector("#stageFrame").style.cursor === "pointer"`));
// 换了一页、指针落在寻常的字上：手不该留着（新页的耳目头一回也得报）
const plainPage =
  "data:text/html;charset=utf-8," + encodeURIComponent(`<title>平</title><body style="margin:0;font-size:40px">寻常的字</body>`);
await evalJs(`__yanStage.go(${JSON.stringify(plainPage)}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "平"`, 8000).catch(() => {});
await sleep(300);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at(0.21, 0.21)[0], y: at(0.21, 0.21)[1] });
await waitFor(`document.querySelector("#stageFrame").style.cursor === ""`, 3000).catch(() => {});
check(
  "the hand goes away on a new page over plain text",
  await evalJs(`document.querySelector("#stageFrame").style.cursor === ""`),
  await evalJs(`document.querySelector("#stageFrame").style.cursor`)
);
await evalJs(`__yanStage.go(${JSON.stringify(upload)}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传"`, 8000).catch(() => {});
await sleep(400);
// 人在游目里点的：径直交给系统的选文件窗（测试的桥接不真弹），不浮纸签
await mouse("mousePressed", ...at(0.7, 0.7));
await mouse("mouseReleased", ...at(0.7, 0.7));
await sleep(1600);
check("a person's click goes to the system file dialog, not a card", await evalJs(`!__yanStage.state.dialog`));
// 执事点的（不经游目）：浮纸签，不往人眼前弹窗
const { sessionId: agent } = await browserSend("Target.attachToTarget", { targetId, flatten: true });
await browserSend("Runtime.evaluate", { expression: `document.querySelector("input[type=file]").click()`, userGesture: true }, agent);
await browserSend("Target.detachFromTarget", { sessionId: agent });
await waitFor(`__yanStage.state.dialog?.type === "file"`, 5000).catch(() => {});
check(
  "a file chooser the agent opens shows as a card on the stage",
  await evalJs(`__yanStage.state.dialog?.type === "file" && document.querySelector("#stageDialog").textContent.includes("选文件")`)
);
await shot("stage-file.png");
// 系统的选文件窗点不了：照它选好的样子，把一个真文件的路径交下去
const picked = path.resolve(TMP, "测.txt");
writeFileSync(picked, "hi");
await evalJs(
  `(node => { document.querySelector("[data-stage-answer=no]").click(); return __yanStage.sendFiles([${JSON.stringify(picked)}], node).then(() => true); })(__yanStage.state.dialog.node)`
);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传:测.txt"`, 8000).catch(() => {});
check(
  "picked paths reach the page's file input",
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传:测.txt"`),
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title`)
);
check("typing focus is on the page", await evalJs(`document.activeElement === document.querySelector("#stageKeys")`));
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "l", code: "KeyL", windowsVirtualKeyCode: 76, modifiers: 2 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "l", code: "KeyL", windowsVirtualKeyCode: 76, modifiers: 2 });
check("Ctrl+L goes to the address bar", await evalJs(`document.activeElement === document.querySelector("#stageUrl")`));
await evalJs(`document.querySelector("#stageUrl").blur(); true`);
// 人开的本机文件浏览器显示不了（Office 文档）：不当下载，交给本机程序（测试的桥接不真开）
const office = path.resolve(TMP, "测.docx");
writeFileSync(office, "PK");
await evalJs(`__yanStage.go(${JSON.stringify(office)}); true`);
await waitFor(`document.querySelector("#toast").textContent.includes("本机程序")`, 5000).catch(() => {});
check(
  "a local file the stage can't show goes to its app, not downloads",
  await evalJs(
    `document.querySelector("#toast").textContent.includes("本机程序") && !__yanStage.state.downloads.some(d => d.url.startsWith("file:"))`
  ),
  await evalJs(`document.querySelector("#toast").textContent`)
);

// 圈点：开「圈」在画面上拖一圈，引文与带朱笔的图随即落进输入框；移除引文，画面上的圈随之清去
await evalJs(`document.querySelector("#stagePen").click(); true`);
check("the pen is on", await evalJs(`document.querySelector("#stagePen").getAttribute("aria-pressed") === "true"`));
// 链接的字在那一块的左上角：圈从左上缘起
const ring = [
  [0.004, 0.2],
  [0.2, 0.004],
  [0.37, 0.2],
  [0.2, 0.37],
  [0.005, 0.22]
];
await mouse("mousePressed", ...at(...ring[0]));
for (const p of ring.slice(1)) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at(...p)[0], y: at(...p)[1], button: "left", buttons: 1 });
  await sleep(30);
}
await mouse("mouseReleased", ...at(...ring.at(-1)));
await waitFor(`!document.querySelector("#welcomeQuote").classList.contains("hidden")`, 5000).catch(() => {});
check(
  "a circle on the stage drops a quote into the input box",
  await evalJs(`document.querySelector("#welcomeQuote .composer-quote-text").textContent.includes("圈「链接」")`),
  await evalJs(`document.querySelector("#welcomeQuote .composer-quote-text").textContent`)
);
await waitFor(`!!document.querySelector("#welcomeQuote .quote-shot img[src^='data:image']")`, 8000).catch(() => {});
check(
  "the picture with the circle rides inside the quote, not in the attachment list",
  await evalJs(
    `!!document.querySelector("#welcomeQuote .quote-shot img[src^='data:image']") && !document.querySelector("#welcomeAttachments .attachment-card")`
  )
);
check(
  "the page did not take the circling as a click",
  await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "传:测.txt"`)
);
check("the circle stays on the stage", await evalJs(`document.querySelectorAll("#stageInk > path").length === 1`));
await shot("stage-ink.png");
await evalJs(`document.querySelector("#welcomeQuote [data-quote-close]").click(); true`);
check("removing the quote clears the circle", await evalJs(`document.querySelectorAll("#stageInk > path").length === 0`));
check(
  "removing the quote takes its picture along (no hidden attachment left behind)",
  await evalJs(`!document.querySelector("#welcomeQuote .quote-shot") && !(__yanState().drafts.__new__?.attachments || []).length`)
);
// 不合拢的一道（划在字下）是「划」：读得到线上方的字，给模型的话记起止、不说是圈
const metaNow = await evalJs(`__yanStage.state.meta`),
  under = [
    [2 / metaNow.width, 21 / metaNow.height],
    [40 / metaNow.width, 22 / metaNow.height]
  ];
await mouse("mousePressed", ...at(...under[0]));
for (const step of [0.25, 0.5, 0.75, 1]) {
  const p = [under[0][0] + (under[1][0] - under[0][0]) * step, under[0][1] + (under[1][1] - under[0][1]) * step];
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at(...p)[0], y: at(...p)[1], button: "left", buttons: 1 });
  await sleep(30);
}
await mouse("mouseReleased", ...at(...under[1]));
await waitFor(`!document.querySelector("#welcomeQuote").classList.contains("hidden")`, 5000).catch(() => {});
await sleep(300);
const lined = await evalJs(`__yanState().drafts.__new__?.quote || null`);
check(
  "a stroke under a word quotes it as a line, and the model's copy doesn't call it a circle",
  !!lined && lined.text.includes("划「链接」") && /划：自网页左/.test(lined.model) && !/圈/.test(lined.model),
  JSON.stringify(lined)
);
await evalJs(`document.querySelector("#welcomeQuote [data-quote-close]").click(); true`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
check("Esc puts the pen down", await evalJs(`document.querySelector("#stagePen").getAttribute("aria-pressed") === "false"`));
await evalJs(`document.querySelector("#welcomeAttachments [data-remove-attachment]")?.click(); true`);

// 执事落笔：执事在调浏览器时网页里有了真按下，那一处一圈朱、贴「点击」
const { sessionId: modelSession } = await browserSend("Target.attachToTarget", { targetId, flatten: true });
const modelClick = (x, y) =>
  Promise.all(
    ["mousePressed", "mouseReleased"].map((type, i) =>
      browser.send(
        JSON.stringify({
          id: 9000 + i,
          sessionId: modelSession,
          method: "Input.dispatchMouseEvent",
          params: { type, x, y, button: "left", clickCount: 1 }
        })
      )
    )
  );
await evalJs(`__yanStage.state.busy = 1; true`);
await modelClick(40, 40);
await waitFor(`document.querySelector("#stageLabels").textContent.includes("点击")`, 5000).catch(() => {});
check(
  "where the model clicks gets a red ring and a slip",
  await evalJs(
    `document.querySelector("#stageLabels").textContent.includes("点击") && !!document.querySelector("#stageInk .stage-acts path")`
  )
);
await evalJs(`__yanStage.state.busy = 0; true`);
await sleep(300);
await evalJs(`__yanStage.state.userAt = Date.now(); true`);
await modelClick(40, 40);
await sleep(2200);
check("clicks while the model is idle leave no mark", await evalJs(`!document.querySelector("#stageLabels").textContent`));

// 收藏：读浏览器配置目录里的那份，按夹列出；点一条在当前页打开
check(
  "收藏 shows when the browser's profile is known",
  await evalJs(`!document.querySelector("#stageMarks").classList.contains("hidden")`)
);
await evalJs(`document.querySelector("#stageMarks").click(); true`);
await waitFor(`!!document.querySelector(".chip-pop.stage-marks [data-stage-mark]")`, 5000).catch(() => {});
check(
  "bookmarks list folders and entries",
  await evalJs(
    `(p => !!p && p.querySelector(".stage-mark-fold span")?.textContent === "学术" && p.querySelector("[data-stage-mark]")?.textContent === "测试收藏")(document.querySelector(".chip-pop.stage-marks"))`
  )
);
// 夹可开合：点题头收起，条数还在、条目不见；再点展开（记在本机）
await evalJs(`document.querySelector(".chip-pop.stage-marks [data-mark-fold]").click(); true`);
check(
  "a folder folds up, keeping its count",
  await evalJs(
    `(p => p.querySelector(".stage-mark-dir").classList.contains("shut") && p.querySelector(".stage-mark-fold small").textContent === "1" && !p.querySelector("[data-stage-mark]"))(document.querySelector(".chip-pop.stage-marks"))`
  )
);
await evalJs(`document.querySelector(".chip-pop.stage-marks [data-mark-fold]").click(); true`);
await evalJs(`document.querySelector(".chip-pop.stage-marks [data-stage-mark]").click(); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "收藏页"`, 8000).catch(() => {});
check("a bookmark opens in the current tab", await evalJs(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "收藏页"`));

// 收藏此页、改名、移除：借浏览器自己的收藏页（开在另起的上下文里，不列进标签），书签带随之着朱、褪朱
const unmarked = "data:text/html;charset=utf-8," + encodeURIComponent("<title>待收</title>");
await evalJs(`__yanStage.go(${JSON.stringify(unmarked)}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "待收"`, 8000).catch(() => {});
const tabsBefore = await evalJs(`__yanStage.state.tabs.size`);
await evalJs(`document.querySelector("#stageMarks").click(); true`);
await waitFor(`!!document.querySelector(".chip-pop.stage-marks .stage-mark-this")`, 5000).catch(() => {});
await evalJs(`document.querySelector(".chip-pop.stage-marks [data-mark-add]").click(); true`);
await waitFor(`document.querySelector("#stageMarks").classList.contains("on")`, 10000).catch(() => {});
check(
  "收藏此页 goes through the browser's own bookmarks and the ribbon turns red",
  await evalJs(`document.querySelector("#stageMarks").classList.contains("on") && !!document.querySelector(".stage-mark-this.on")`)
);
check("the borrowed bookmarks page never shows as a tab", (await evalJs(`__yanStage.state.tabs.size`)) === tabsBefore);
await evalJs(`document.querySelector(".stage-mark-this [data-mark-edit]").click(); true`);
await evalJs(
  `(f => { f.querySelector("input").value = "改过的名"; f.querySelector("[data-mark-save]").click(); return true; })(document.querySelector(".stage-mark-form"))`
);
const renamed = `[...document.querySelectorAll(".chip-pop.stage-marks [data-stage-mark]")].some(b => b.textContent === "改过的名")`;
await waitFor(renamed, 10000).catch(() => {});
check("a bookmark can be renamed in place", await evalJs(renamed));
await sleep(250);
await shot("stage-marks.png");
await evalJs(`document.querySelector(".stage-mark-this [data-mark-del]").click(); true`);
await waitFor(`!document.querySelector("#stageMarks").classList.contains("on")`, 10000).catch(() => {});
check("removing it takes the red off the ribbon", await evalJs(`!document.querySelector("#stageMarks").classList.contains("on")`));
await evalJs(`document.querySelector("#stageMarks").click(); true`);

// 页内查找：Ctrl+F 换出查找栏，数出几处、Enter 下一处并滚到眼前，Esc 收起
const findPage =
  "data:text/html;charset=utf-8," + encodeURIComponent(`<title>找</title><p>甲言</p><p style="margin-top:1500px">乙言</p><p>丙言</p>`);
await evalJs(`__yanStage.go(${JSON.stringify(findPage)}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "找"`, 8000).catch(() => {});
await sleep(300);
await mouse("mousePressed", ...at(0.5, 0.05));
await mouse("mouseReleased", ...at(0.5, 0.05));
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "f", code: "KeyF", windowsVirtualKeyCode: 70, modifiers: 2 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "f", code: "KeyF", windowsVirtualKeyCode: 70, modifiers: 2 });
check("Ctrl+F swaps the address row for a find bar", await evalJs(`document.activeElement === document.querySelector("#stageFindInput")`));
await send("Input.insertText", { text: "言" });
const findCount = () => evalJs(`document.querySelector("#stageFindCount").textContent`);
await waitFor(`document.querySelector("#stageFindCount").textContent === "1 / 3"`, 5000).catch(() => {});
check("the find bar counts the hits", (await findCount()) === "1 / 3", await findCount());
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await waitFor(`document.querySelector("#stageFindCount").textContent === "2 / 3" && __yanStage.state.scroll.y > 500`, 5000).catch(() => {});
check(
  "Enter moves to the next hit and scrolls it into view",
  await evalJs(`document.querySelector("#stageFindCount").textContent === "2 / 3" && __yanStage.state.scroll.y > 500`),
  JSON.stringify(await evalJs(`[document.querySelector("#stageFindCount").textContent, __yanStage.state.scroll]`))
);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
check(
  "Esc folds the find bar",
  await evalJs(
    `document.querySelector("#stageFind").classList.contains("hidden") && !document.querySelector("#stageNav").classList.contains("finding")`
  )
);

// 下拉框：浏览器那扇小窗收不到，游目贴着那一框浮纸签；选了一项网页收到 change。指针移出画面，网页收到离开。
// 中键点链接开的是后台的一页，游目不跟过去
const pickPage =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<title>选</title><body style="margin:0"><select id="s" style="position:fixed;left:5vw;top:5vh;width:30vw;height:8vh" onchange="document.title='选:'+this.value"><option>甲</option><optgroup label="组"><option>乙</option><option disabled>丙</option></optgroup></select><div style="position:fixed;left:50vw;top:5vh;width:40vw;height:30vh" onmouseenter="document.title='进'" onmouseleave="document.title='离'"></div><a href="${PAGE}icon.svg" style="position:fixed;left:5vw;top:60vh;width:30vw;height:20vh;display:block">链</a><p id="t" style="position:fixed;left:50vw;top:60vh;margin:0;font-size:30px">一段要引的话</p></body>`
  );
await evalJs(`__yanStage.go(${JSON.stringify(pickPage)}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "选"`, 8000).catch(() => {});
await sleep(400);
await mouse("mousePressed", ...at(0.15, 0.09));
await mouse("mouseReleased", ...at(0.15, 0.09));
await waitFor(`!!document.querySelector(".chip-pop.stage-pick")`, 5000).catch(() => {});
check(
  "a select on the page opens as a card on the stage",
  await evalJs(
    `(p => !!p && [...p.querySelectorAll("[data-pick]")].map(b => b.textContent).join() === "甲,乙,丙" && p.textContent.includes("组") && p.querySelector("[data-pick='2']").disabled && p.querySelector("[data-pick='0']").classList.contains("active"))(document.querySelector(".chip-pop.stage-pick"))`
  )
);
const pickAt = await evalJs(
  `(() => {
    const el = document.querySelector(".chip-pop.stage-pick [data-pick='1']");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`
);
if (!pickAt) {
  check("picking an option reaches the page", false, "element .chip-pop.stage-pick [data-pick='1'] not found");
} else {
  await shot("stage-pick.png");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pickAt.x, y: pickAt.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pickAt.x, y: pickAt.y, button: "left", clickCount: 1 });
  const tPick = Date.now();
  let pickOk = false;
  try {
    await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "选:乙"`, 5000);
    pickOk = true;
  } catch {}
  check(
    "picking an option reaches the page",
    pickOk &&
      (await evalJs(
        `__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "选:乙" && !document.querySelector(".chip-pop.stage-pick")`
      )),
    `${await title()} (elapsed: ${Date.now() - tPick}ms)`
  );
}
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at(0.7, 0.2)[0], y: at(0.7, 0.2)[1] });
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "进"`, 5000).catch(() => {});
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: geometry.x + geometry.w * 0.7, y: geometry.y - 30 });
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "离"`, 5000).catch(() => {});
check("moving off the stage lets the page know the pointer left", (await title()) === "离", await title());
const tabsBeforeMiddle = await evalJs(`__yanStage.state.tabs.size`);
await send("Input.dispatchMouseEvent", {
  type: "mousePressed",
  x: at(0.2, 0.7)[0],
  y: at(0.2, 0.7)[1],
  button: "middle",
  buttons: 4,
  clickCount: 1
});
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at(0.2, 0.7)[0], y: at(0.2, 0.7)[1], button: "middle", clickCount: 1 });
await waitFor(`__yanStage.state.tabs.size > ${tabsBeforeMiddle}`, 5000).catch(() => {});
await sleep(300);
check(
  "a middle-clicked link opens behind without pulling the stage over",
  await evalJs(`__yanStage.state.tabs.size > ${tabsBeforeMiddle} && __yanStage.state.current === ${JSON.stringify(targetId)}`),
  JSON.stringify(await evalJs(`[__yanStage.state.tabs.size, __yanStage.state.current]`))
);
for (const id of await evalJs(
  `[...__yanStage.state.tabs.keys()].filter(id => id !== ${JSON.stringify(targetId)} && /icon\.svg$/.test(__yanStage.state.tabs.get(id).url))`
))
  await browserSend("Target.closeTarget", { targetId: id });

// 右键：浏览器的菜单在画面外，游目在指针处浮一张纸签——链接上能后台新开，选中的字能引给执事，空白处是前后与重载
const rightClick = async (fx, fy) => {
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", {
      type,
      x: at(fx, fy)[0],
      y: at(fx, fy)[1],
      button: "right",
      buttons: type === "mousePressed" ? 2 : 0,
      clickCount: 1
    });
  await waitFor(`!!document.querySelector(".chip-pop.stage-ctx")`, 5000).catch(() => {});
  return evalJs(`[...document.querySelectorAll(".chip-pop.stage-ctx [data-menu]")].map(b => b.dataset.menu).join()`);
};
const ctxItem = id => evalJs(`document.querySelector(".chip-pop.stage-ctx [data-menu=${id}]").click(); true`);
check("right-clicking a link offers to open or copy it", (await rightClick(0.2, 0.7)) === "link-open,link-copy");
await shot("stage-ctx.png");
const tabsBeforeCtx = await evalJs(`__yanStage.state.tabs.size`);
await ctxItem("link-open");
await waitFor(`__yanStage.state.tabs.size > ${tabsBeforeCtx}`, 5000).catch(() => {});
await sleep(300);
check(
  "opening a link from the menu leaves the stage on this page",
  await evalJs(`__yanStage.state.tabs.size > ${tabsBeforeCtx} && __yanStage.state.current === ${JSON.stringify(targetId)}`)
);
for (const id of await evalJs(
  `[...__yanStage.state.tabs.keys()].filter(id => id !== ${JSON.stringify(targetId)} && /icon\.svg$/.test(__yanStage.state.tabs.get(id).url))`
))
  await browserSend("Target.closeTarget", { targetId: id });
await browserSend("Runtime.evaluate", { expression: `getSelection().selectAllChildren(document.getElementById("t"))` }, modelSession);
check("right-clicking selected text offers copy and quoting", (await rightClick(0.55, 0.63)) === "copy,quote");
await ctxItem("quote");
check(
  "quoting hands the selection to the composer with the page's address",
  await evalJs(
    `(q => !!q && q.text.includes("一段要引的话") && q.model.includes("一段要引的话") && q.url.startsWith("data:"))(__yanState().drafts.__new__?.quote)`
  ),
  JSON.stringify(await evalJs(`__yanState().drafts.__new__?.quote`))
);
await evalJs(`document.querySelector("#welcomeQuote [data-quote-close]").click(); true`);
check("right-clicking blank space offers back, forward and reload", (await rightClick(0.7, 0.9)) === "back,forward,reload");
await evalJs(`document.body.click(); true`);

// 纸签：缩放一档，窗按倍数收窄；复原。量窗口本身——静着的页不重绘就不出新帧，画面的尺寸会停在旧值
await evalJs(`document.querySelector("#stageKeys").blur(); document.querySelector("#stageMenuBtn").click(); true`);
check("the menu opens from the tune icon", await evalJs(`!!document.querySelector(".chip-pop.stage-menu [data-menu=find]")`));
await sleep(250);
await shot("stage-menu.png");
const windowWidth = async () => (await browserSend("Browser.getWindowForTarget", { targetId })).bounds.width;
const plain = await windowWidth();
await evalJs(`document.querySelector(".chip-pop.stage-menu [data-stage-zoom='1']").click(); true`);
await sleep(800);
const zoomed = await windowWidth();
check(
  "zooming in narrows the window by the factor",
  (await evalJs(`__yanStage.state.zoom === 1.1 && document.querySelector(".stage-zoom-pct").textContent === "110%"`)) &&
    plain - zoomed > 60,
  JSON.stringify({ plain, zoomed })
);
await evalJs(`document.querySelector(".chip-pop.stage-menu [data-stage-zoom='0']").click(); true`);
await sleep(800);
// 复原后的窗按此刻网页的滚动条重算，可能比放大前宽一条滚动条
check("zoom resets", (await evalJs(`__yanStage.state.zoom === 1`)) && (await windowWidth()) >= plain - 3);
await evalJs(`document.querySelector("#stageMenuBtn").click(); true`);

// 下载：网页里一开始下载，纸签上「下载」后记着数，下载签里列出来
await browserSend("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: TMP.replace(/\//g, "\\") });
const dlPage =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<title>下</title><a id="d" download="下载测.txt" href="data:text/plain,hi">下载</a>`);
await evalJs(`__yanStage.go(${JSON.stringify(dlPage)}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.title === "下"`, 8000).catch(() => {});
await browserSend("Runtime.evaluate", { expression: `document.getElementById("d").click()` }, modelSession);
await waitFor(`__yanStage.state.downloads.some(d => d.name === "下载测.txt")`, 8000).catch(() => {});
check("a download in the page is noted", await evalJs(`__yanStage.state.downloads.some(d => d.name === "下载测.txt")`));
check(
  "Edge's own download bubble does not become a tab",
  await evalJs(`![...__yanStage.state.tabs.values()].some(t => t.url.includes("downloads-hub"))`)
);
await evalJs(`document.querySelector(".chip-pop.stage-menu") || document.querySelector("#stageMenuBtn").click(); true`);
check(
  "the menu shows the new download count",
  await evalJs(`document.querySelector(".chip-pop.stage-menu [data-menu=downloads] .fresh")?.textContent === "1"`)
);
await evalJs(`document.querySelector(".chip-pop.stage-menu [data-menu=downloads]").click(); true`);
check(
  "the downloads slip lists it",
  await evalJs(`document.querySelector(".chip-pop.stage-downloads .stage-dl-name")?.textContent === "下载测.txt"`)
);
await sleep(250);
await shot("stage-downloads.png");
await evalJs(`document.querySelector("#stageMenuBtn").click(); true`);

// 点看台上的某个签
const clickTab = id =>
  evalJs(`[...document.querySelectorAll("[data-stage-tab]")].find(t => t.dataset.stageTab === ${JSON.stringify(id)})?.click(); true`);

// 纸签里的一项：纸签没开着先开
const menuPick = act =>
  evalJs(
    `(document.querySelector(".chip-pop.stage-menu") || document.querySelector("#stageMenuBtn").click(), document.querySelector(".chip-pop.stage-menu [data-menu=${act}]").click(), true)`
  );
// 浏览器自己的页（历史、设置）开成一张新签；设置页在新版 Edge 里报成 browser_ui，也得列出来
for (const [act, word] of [
  ["history", "history"],
  ["settings", "settings"]
]) {
  await menuPick(act);
  const opened = `[...__yanStage.state.tabs.values()].some(t => /^(edge|chrome):/.test(t.url) && t.url.includes("${word}"))`;
  await waitFor(opened, 8000).catch(() => {});
  check(
    `${act} opens the browser's own page as a tab`,
    await evalJs(opened),
    JSON.stringify(await evalJs(`[...__yanStage.state.tabs.values()].map(t => t.url)`)) +
      JSON.stringify((await browserSend("Target.getTargets")).targetInfos.map(t => t.type + " " + t.url.slice(0, 40)))
  );
  const id = await evalJs(`[...__yanStage.state.tabs].find(([, t]) => /^(edge|chrome):/.test(t.url) && t.url.includes("${word}"))?.[0]`);
  if (id) await browserSend("Target.closeTarget", { targetId: id });
  await clickTab(targetId);
  await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)} && __yanStage.state.session !== ""`, 5000).catch(() => {});
}
check(
  "Edge's own dialogs (sync confirmation and the like) never become tabs",
  await evalJs(`![...__yanStage.state.tabs.values()].some(t => /-(dialog|hub)\b/.test(t.url))`)
);
// 用系统浏览器打开：交给桥接（测试里不真去开）；只收 http 页
await evalJs(`__yanStage.go(${JSON.stringify(PAGE + "icon.svg")}); true`);
await waitFor(`__yanStage.state.tabs.get(${JSON.stringify(targetId)})?.url.endsWith("icon.svg")`, 8000).catch(() => {});
await menuPick("system");
await waitFor(`document.querySelector("#toast")?.textContent === "已交给系统浏览器"`, 5000).catch(() => {});
check("用系统浏览器打开 goes through the bridge", await evalJs(`document.querySelector("#toast")?.textContent === "已交给系统浏览器"`));
await clickTab(targetId);
await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)}`, 5000).catch(() => {});

// 阔：栏顶那枚，铺满；Esc（焦点不在看台里时）退回
await evalJs(`document.activeElement?.blur(); document.querySelector("#stageWide").click(); true`);
check("wide covers the page", await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).position === "fixed"`));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(150);
check("Esc leaves wide", await evalJs(`!document.querySelector("#stagePanel").classList.contains("wide")`));

// 模型定死了视口（browser_resize）：窗口管不着网页，看台变宽窄时别去调窗口——不然一回小一圈
const { sessionId: pinned } = await browserSend("Target.attachToTarget", { targetId, flatten: true });
await browserSend("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 0, mobile: false }, pinned);
const framed = (await browserSend("Browser.getWindowForTarget", { targetId })).bounds;
// 拖左缘：宽度有下限，也给对话留出地方
const grip = await evalJs(
  `(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(document.querySelector("#stageGrip").getBoundingClientRect())`
);
await mouse("mousePressed", grip.x, grip.y);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1370, y: grip.y, button: "left", buttons: 1 });
await mouse("mouseReleased", 1370, grip.y);
check("drag narrows to the floor", (await evalJs(`document.querySelector("#stagePanel").getBoundingClientRect().width`)) === 320);
check("width is remembered", (await evalJs(`localStorage.getItem("yan-stage-width")`)) === "320");
await sleep(800);
const later = (await browserSend("Browser.getWindowForTarget", { targetId })).bounds;
check(
  "a pinned viewport keeps the window as it is",
  later.width === framed.width && later.height === framed.height,
  JSON.stringify({ framed, later })
);
// 留白处写明谁定的、多大：光凭量出来的尺寸只挂「放开」（自动放开要新开一页，会冲掉网页里的脚本）；
// 执事亲手定的（browser_resize）且适应页面开着（默认）才说它歇手后铺满；关掉适应页面又挂回「放开」
await waitFor(`!document.querySelector("#stageLetter").classList.contains("hidden")`, 5000).catch(() => {});
check(
  "a viewport that only measures as pinned offers 放开, no auto-release",
  await evalJs(
    `(l => l.textContent.includes("1600×1200") && !!l.querySelector("[data-stage-release]") && !l.textContent.includes("歇手后铺满"))(document.querySelector("#stageLetter"))`
  ),
  await evalJs(`document.querySelector("#stageLetter").textContent`)
);
await evalJs(`__yanStage.markPinned(); true`);
check(
  "the blank strip says who pinned the viewport and how big",
  await evalJs(
    `(l => !l.classList.contains("hidden") && l.textContent.includes("1600×1200") && l.textContent.includes("歇手后铺满"))(document.querySelector("#stageLetter"))`
  ),
  await evalJs(`document.querySelector("#stageLetter").textContent`)
);
// 纸签里关掉适应页面：留白处挂「放开」；搜索用哪家点一下换一家，都记进配置
await menuPick("fit");
check(
  "with 适应页面 off (in the menu) the strip offers 放开",
  (await evalJs(
    `__yanState().settings.stageFit === false && document.querySelector(".chip-pop.stage-menu [data-menu=fit] small")?.textContent === "关"`
  )) && (await evalJs(`!!document.querySelector("#stageLetter [data-stage-release]")`))
);
await menuPick("search");
check("the search engine is kept in the config", await evalJs(`__yanState().settings.stageSearch === "baidu"`));
await menuPick("search");
await menuPick("search");
await menuPick("fit");
await evalJs(`document.querySelector("#stageMenuBtn").click(); true`);

// 设置 → 游目：只管游目自己的浏览器怎么配（开没开、用哪个、驱动、存储），排在技能之后、记忆之前
await evalJs(`document.querySelector("#openSettings").click(); document.querySelector('[data-tab="stage"]').click(); true`);
await waitFor(
  `!!document.querySelector('#settingsContent [data-stage-opt="browser"]') && !document.querySelector("#settingsContent").textContent.includes("……")`,
  8000
).catch(() => {});
check(
  "the 游目 tab sits between 技能 and 记忆, with the line it is named after",
  await evalJs(
    `(t => t.nextElementSibling?.dataset.tab === "memory" && t.previousElementSibling?.dataset.tab === "skills")(document.querySelector('[data-tab="stage"]')) && document.querySelector("#settingsContent .settings-lead")?.textContent === "游目骋怀，足以极视听之娱。" && !!document.querySelector("#settingsContent .settings-mark")`
  )
);
check(
  "it shows where its things live and whether the dependency is in",
  await evalJs(
    `(t => t.includes("存储") && t.includes("游目") && t.includes("驱动") && (t.includes("未安装") || t.includes(" 版")))(document.querySelector("#settingsContent").textContent)`
  )
);
await evalJs(`document.querySelector('[data-stage-opt="browser"][data-value="chrome"]').click(); true`);
check("picking a browser is kept in the config", await evalJs(`__yanState().settings.stage?.browser === "chrome"`));
await evalJs(`document.querySelector('[data-stage-opt="browser"][data-value="msedge"]').click(); true`);
check(
  "游目's own browser stays out of the MCP list while it is off",
  await evalJs(`!Object.keys(__yanState().settings.mcpServers).includes("游目")`)
);
await shot("stage-settings.png");
await evalJs(`document.querySelector("#closeSettings").click(); true`);
await browserSend("Emulation.clearDeviceMetricsOverride", {}, pinned);
await browserSend("Target.detachFromTarget", { sessionId: pinned });
await evalJs(`document.querySelector("#stagePanel").style.width = "600px"; true`);
await waitFor(`document.querySelector("#stageLetter").classList.contains("hidden")`, 5000).catch(() => {});
check(
  "the strip goes once the viewport follows the window again",
  await evalJs(`document.querySelector("#stageLetter").classList.contains("hidden")`)
);

// 旁注开着时看台让位（旁注是在右侧同一处）：让位时不收画面、入口回来；旁注收起，画面接上
await evalJs(`document.querySelector("#sidePanel").classList.remove("hidden"); true`);
check("side notes take the right side", await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).display === "none"`));
await waitFor(`__yanStage.state.session === ""`, 3000).catch(() => {});
check(
  "screencast pauses while pushed aside, and the entry comes back",
  await evalJs(`__yanStage.state.session === "" && !document.querySelector("#stagePin").classList.contains("hidden")`)
);
await evalJs(`document.querySelector("#sidePanel").classList.add("hidden"); true`);
check(
  "stage comes back after side notes close",
  await evalJs(`getComputedStyle(document.querySelector("#stagePanel")).display !== "none"`)
);
await waitFor(`__yanStage.state.session !== ""`, 5000).catch(() => {});
check(
  "screencast resumes",
  await evalJs(`__yanStage.state.session !== "" && document.querySelector("#stagePin").classList.contains("hidden")`)
);

// ＋：新开一页，看台跟过去，地址栏等着输网址。
// 这段放在最后：它要在同一窗口里切换标签，切完不再让后续检查依赖看台的会话
const before = await evalJs(`__yanStage.state.tabs.size`);
await evalJs(`document.querySelector("#stageNewTab").click(); true`);
await waitFor(`__yanStage.state.tabs.size === ${before + 1}`, 5000).catch(() => {});
const fresh = await evalJs(`__yanStage.state.current`);
check(
  "＋ opens a new tab and the stage follows it",
  (await evalJs(`__yanStage.state.tabs.size === ${before + 1} && __yanStage.state.current !== ${JSON.stringify(targetId)}`)) &&
    (await evalJs(`document.activeElement === document.querySelector("#stageUrl")`))
);
// 前提：模型页与 fresh 同窗。跨窗口时浏览器对「前台」的排序在无头 macOS 上不可靠，断言也就无从谈起
const windowOf = async id => (await browserSend("Browser.getWindowForTarget", { targetId: id })).windowId;
const modelWindow = await windowOf(targetId),
  freshWindow = await windowOf(fresh);
check("the model page and the new tab share one window", modelWindow === freshWindow, JSON.stringify({ modelWindow, freshWindow }));
const viewState = () =>
  evalJs(
    `JSON.stringify({ current: __yanStage.state.current, front: __yanStage.state.front, activating: !!__yanStage.state.activating })`
  ).catch(e => String(e));
// 激活是异步的：等浏览器自己把要请到前台的页排到 /json/list 首位，再让看台去问，别用固定等待赌它已经生效
const pageIds = async () => (await (await fetch(MODEL_DEBUG + "/json/list")).json()).filter(t => t.type === "page").map(t => t.id);
const waitForFront = async (id, timeout = 8000) => {
  const started = Date.now();
  for (;;) {
    try {
      if ((await pageIds())[0] === id) return true;
    } catch {}
    if (Date.now() - started > timeout) return false;
    await sleep(120);
  }
};
// 模型换页：自己点回原来那页后，模型的调用（这里直接去找一回）不把人拽走；模型把那一页请到前台（选签即如此），看台跟过去
await clickTab(targetId);
const tabActivated = await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)} && !__yanStage.state.activating`, 5000).then(
  () => true,
  () => false
);
check("stage switches to picked tab and settles activation", tabActivated, await viewState());
const userFront = await waitForFront(targetId);
check("browser put the picked tab first", userFront);
await evalJs(`__yanStage.locate().then(() => true)`);
check(
  "a call after the user picked a tab leaves the view alone",
  await evalJs(`__yanStage.state.current === ${JSON.stringify(targetId)}`),
  await viewState()
);
const { sessionId: freshSession } = await browserSend("Target.attachToTarget", { targetId: fresh, flatten: true });
await browserSend("Page.bringToFront", {}, freshSession);
const freshFront = await waitForFront(fresh);
check("browser put the new tab first", freshFront);
await evalJs(`__yanStage.locate().then(() => true)`);
check(
  "the stage follows the page the model brings to front",
  await evalJs(`__yanStage.state.current === ${JSON.stringify(fresh)}`),
  await viewState()
);
await browserSend("Target.closeTarget", { targetId: fresh });
await waitFor(`__yanStage.state.current === ${JSON.stringify(targetId)}`, 5000).catch(() => {});
check("stage falls back to the remaining tab", await evalJs(`__yanStage.state.current === ${JSON.stringify(targetId)}`), await viewState());
await waitFor(`__yanStage.state.session !== ""`, 5000).catch(() => {});
check("stage session is active on the remaining tab", await evalJs(`__yanStage.state.session !== ""`), await viewState());
check(
  "page has no uncaught exceptions after closing tab",
  await evalJs(`window.__yanExceptions.length === 0`),
  await evalJs(`JSON.stringify(window.__yanExceptions)`)
);

// 收起：小屏回来；那一页关了，签跟着没了
await evalJs(`document.querySelector("#stageClose").click(); true`);
await waitFor(`!document.querySelector("#stagePin").classList.contains("hidden")`);
check("closing the stage brings the pin back", true);
// 入口平时只是一笔朱竖，指针靠近才浮出「游目」两字
const nameShown = () => evalJs(`Number(getComputedStyle(document.querySelector(".stage-pin-text")).opacity)`);
check("only the stroke shows at rest", (await nameShown()) === 0);
// 面板刚收起时那一笔还在往右缘归位：等它站定再量，不然指针移到的是它半路上的位置
await waitFor(`document.querySelector("#stagePin").getBoundingClientRect().right > innerWidth - 60`, 3000).catch(() => {});
const pin = await evalJs(
  `(r => ({ x: r.right - 6, y: r.top + r.height / 2 }))(document.querySelector("#stagePin").getBoundingClientRect())`
);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pin.x, y: pin.y });
await waitFor(`Number(getComputedStyle(document.querySelector(".stage-pin-text")).opacity) === 1`, 3000).catch(() => {});
check("the name shows when the pointer comes near", (await nameShown()) === 1);
await shot("stage-pin.png");
// 长对话里右缘铺着滚动条的命中层：入口的最右一列仍点得到，而不是被它吃掉
check(
  "the entry's right edge is not swallowed by the scrollbar's hit strip",
  await evalJs(
    `(() => { const g = document.querySelector("#chatScrollGrabber"), was = g.className; g.className = "chat-scroll-grabber active"; g.style.display = "block"; const r = document.querySelector("#stagePin").getBoundingClientRect(), hit = document.elementFromPoint(r.right - 2, r.top + r.height / 2); g.className = was; g.style.display = ""; return !!hit?.closest("#stagePin"); })()`
  )
);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 400 });
check("screencast stops when closed", await evalJs(`__yanStage.state.session === ""`));
await browserSend("Target.closeTarget", { targetId });
await waitFor(`!__yanStage.state.tabs.has(${JSON.stringify(targetId)})`);
check("closed page leaves the tabs", true);

browser.close();
close();
