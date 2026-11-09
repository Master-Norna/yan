// 接不上本机桥接的页面（直接双击 web/index.html 打开的 file://）：只挂一页「等候本机桥接」，界面不开张
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, check, sleep } from "./lib.mjs";

const { send, evalJs, waitFor, shot, close } = await connect();
const page = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "index.html")).href;
await send("Page.navigate", { url: page });
await waitFor(`document.documentElement.dataset.bridge === "waiting"`, 10000).catch(() => {});
await sleep(300);
const gate = await evalJs(
  `(g => ({ waiting: document.documentElement.dataset.bridge, shown: getComputedStyle(g).display !== "none", text: g.textContent }))(document.querySelector("#bridgeGate"))`
);
check(
  "a page that cannot reach the bridge waits on the gate and says how to start it",
  gate.waiting === "waiting" && gate.shown && gate.text.includes("start.cmd") && gate.text.includes("127.0.0.1:8787"),
  JSON.stringify(gate)
);
await shot("bridge-gate.png");
close();
