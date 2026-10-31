// 大附件置入：单件上限 256 MB，原件经页面落进存储根。量三件事——落没落成整份、页面途中答不答话、JS 堆比置入前多涨了多少
// （按原件大小的倍数记）。先前原件读成 data: URL（多三成）、再拼进 JSON 请求体：20、60 MB 堆峰值都是原件的 2.67 倍，
// 120 MB 起页面在读完 data: URL 之后卡住、一分半钟不答话，什么也没落成。改成直传（bridgeUpload）后 200 MB 四百多毫秒落成、堆不涨。
// BIG_MB 可改原件大小（默认 200 MB）
import fs from "node:fs";
import { connect, check, sleep, PAGE, TMP, HOME } from "./lib.mjs";
const { send, evalJs, close } = await connect();
const MB = 1024 * 1024,
  SIZE = (Number(process.env.BIG_MB) || 200) * MB,
  FILE = `${TMP}/大附件.bin`;

// 原件：认不成文本、也抽不出正文的字节，整份照原件存
const block = Buffer.alloc(MB);
for (let i = 0; i < MB; i++) block[i] = (i * 2654435761) >>> 24;
const out = fs.openSync(FILE, "w");
for (let i = 0; i < SIZE / MB; i++) fs.writeSync(out, block);
fs.closeSync(out);

await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);

// 页面卡住时求值不再回话：每一回都限时，到时照「没答」算
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => "stuck")]);
await send("Performance.enable");
const heap = async () => (await send("Performance.getMetrics")).metrics.find(m => m.name === "JSHeapUsedSize").value;
await send("HeapProfiler.collectGarbage");
const base = await heap();
let peak = base,
  sampling = true;
const sampler = (async () => {
  while (sampling) {
    peak = Math.max(peak, Number(await within(heap(), 3000).catch(() => 0)) || 0);
    await sleep(25);
  }
})();

const started = Date.now();
const { root } = await send("DOM.getDocument");
const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#fileInput" });
await send("DOM.setFileInputFiles", { nodeId, files: [FILE.split("/").join("\\")] });
let landed = false,
  longest = 0,
  heard = started;
while (Date.now() - started < 60000) {
  const ok = await within(evalJs(`document.querySelectorAll("#welcomeAttachments .attachment-card").length === 1`), 3000).catch(
    () => "stuck"
  );
  if (ok !== "stuck") {
    longest = Math.max(longest, Date.now() - heard);
    heard = Date.now();
  }
  if (ok === true) {
    landed = true;
    break;
  }
  await sleep(100);
}
longest = Math.max(longest, Date.now() - heard);
const ms = Date.now() - started;
sampling = false;
await sampler;

const dir = `${HOME}/附件`,
  stored = fs.existsSync(dir) && fs.readdirSync(dir).some(name => fs.statSync(`${dir}/${name}`).size === SIZE);
const times = (peak - base) / SIZE;
console.log(
  `  [量] ${SIZE / MB} MB 原件：${landed ? `置入 ${ms} ms` : "一分钟没置入"}，页面最长 ${longest} ms 不答话，JS 堆峰值比置入前多 ${Math.round((peak - base) / MB)} MB（${times.toFixed(2)} 倍）`
);
check(`a ${SIZE / MB} MB file is placed and lands whole in the store`, landed && stored);
check("the page keeps answering while it is placed", longest < 3000, `${longest} ms`);
// 原件不经页面的字符串（直传字节）时，堆里不该托着整份原件
check("placing it does not hold the file in the JS heap", landed && times < 0.5, `${times.toFixed(2)}×`);
fs.rmSync(FILE, { force: true });
await close();
// 页面卡住了：关掉这一页换一张空页，后面的用例接的是新页
if (!landed) {
  const { DEBUG } = await import("./lib.mjs");
  for (const target of await (await fetch(DEBUG + "/json")).json())
    if (target.type === "page") await fetch(`${DEBUG}/json/close/${target.id}`).catch(() => {});
  await fetch(DEBUG + "/json/new?about:blank", { method: "PUT" }).catch(() => {});
}
