// 导出的文件离开言后仍能读：工具文字、Markdown 关联作品、离线图表与交互、中文编码。
import { connect, check, sleep, PAGE, ARCHIVE, TMP, DEBUG } from "./lib.mjs";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { load } from "./unit/harness.mjs";

const html = `<title>中文交互🌏</title><div class="card"><button id="add">计数</button><span id="count">0</span><pre id="lines"></pre></div>
<script>
let n = 0; document.getElementById('add').onclick = () => document.getElementById('count').textContent = ++n;
document.getElementById('lines').textContent = '第一行\\n\\n\\n第四行';
try { parent.document.body; document.body.dataset.parentAccess = 'allowed'; } catch { document.body.dataset.parentAccess = 'blocked'; }
localStorage.setItem('theme', 'dark'); document.body.dataset.stored = localStorage.getItem('theme');
</script>`;
const content = `工具之后的正文。\n\n\`\`\`html\n${html}\n\`\`\`\n\n\`\`\`echarts\n{"xAxis":{"data":["甲","乙"]},"yAxis":{},"series":[{"type":"bar","data":[2,5]}]}\n\`\`\`\n\n\`\`\`mermaid\ngraph LR\nA[中文起点] --> B[结束]\n\`\`\`\n\n**最后总结**`;
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "export-probe",
      title: "导出回归",
      createdAt: "2026-09-28",
      updatedAt: new Date().toISOString(),
      forks: [],
      threads: [],
      messages: [
        { id: "u", role: "user", content: "画图", timestamp: "2026-09-28" },
        {
          id: "a",
          role: "assistant",
          content,
          status: "complete",
          timestamp: "2026-09-28",
          steps: [
            {
              id: "s",
              name: "run_command",
              title: "读 C:\\项目\\a_b\\*.py\n```\n<img src=x>\n# 假标题",
              status: "done",
              result: "完成",
              at: 0
            }
          ]
        }
      ]
    }
  })
});
const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE });
// 侧栏可能先于事件绑定画出来（开页从磁盘换进配置时），早点的那一下会落空：点到它真开了为止
await waitFor(
  `(document.querySelector('[data-conversation="export-probe"] .history-open')?.click(), !!document.querySelector('[data-conversation="export-probe"].active'))`,
  10000
);
await waitFor(`document.querySelectorAll('.html-app[data-app-state="ready"]').length === 3`, 20000);
await evalJs(
  `document.querySelector('[data-conversation="export-probe"] [data-history-action="menu"]').click(); document.querySelector('.chip-pop [data-menu="export"]').click(); true`
);
for (let i = 0; i < 100 && !readdirSync(ARCHIVE).includes("导出回归.md"); i++) await sleep(150);
const md = readFileSync(`${ARCHIVE}/导出回归.md`, "utf8");
const files = [...md.matchAll(/\[可视化 \d+\]\(<([^>]+)>\)/g)].map(match => decodeURIComponent(match[1]));
check("Markdown preserves the original body, Unicode and final summary", md.includes(content) && md.includes("**最后总结**"));
check("Markdown links to all three standalone files", files.length === 3 && files.every(name => readdirSync(ARCHIVE).includes(name)));

// 单块下载也经过同一打包路径；拦截最后的下载点击，不干涉生成文件。
await evalJs(
  `window.__download = null; window.__exportBlobs = new Map(); const createUrl = URL.createObjectURL; URL.createObjectURL = blob => { const url = createUrl(blob); window.__exportBlobs.set(url, blob); return url; }; HTMLAnchorElement.prototype.click = function() { if (this.download) { window.__download = {name:this.download, url:this.href}; } }; document.querySelector('[data-app-download]').click(); true`
);
await waitFor(`!!window.__download`, 15000);
const downloaded = await evalJs(`window.__exportBlobs.get(window.__download.url).text()`);
check(
  "single visualization download includes charset, sandbox and runtime",
  downloaded.includes('charset="utf-8"') && downloaded.includes('sandbox="allow-scripts"') && downloaded.includes("yan-preview-export")
);
writeFileSync(`${TMP}/single-export.html`, downloaded);

// 再导出同名对话，链接必须用实际保存的 (2) 文件名。
await evalJs(
  `document.querySelector('[data-conversation="export-probe"] [data-history-action="menu"]').click(); document.querySelector('.chip-pop [data-menu="export"]').click(); true`
);
for (let i = 0; i < 100 && !readdirSync(ARCHIVE).includes("导出回归 (2).md"); i++) await sleep(150);
const second = readFileSync(`${ARCHIVE}/导出回归 (2).md`, "utf8");
check("duplicate export links to its own renamed assets", second.includes(encodeURIComponent("导出回归-可视化-1 (2).html")));

// 卷宗里的导出作品也能重新预览。
await evalJs(`document.querySelector('#openLibrary').click(); true`);
await waitFor(`!!document.querySelector('[data-path="${files[0]}"]')`, 5000).catch(() => {});
const opened = await evalJs(
  `(() => { const card = [...document.querySelectorAll('#libraryGrid .strip')].find(c=>c.textContent.includes(${JSON.stringify(files[0])})); const b=card?.querySelector('[data-library-action="view"]'); b?.click(); return !!b; })()`
);
check("exported HTML has an archive preview action", opened);
await sleep(800);

// file:// 打开并断网：文件内只读 DOM 取证，不依赖本机服务或外部 CDN。
await send("Network.enable");
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
let frameSocket, frameTarget, frameSend;
async function frameEval(expression) {
  const tree = await send("Page.getFrameTree");
  const child = tree.frameTree.childFrames?.[0];
  let result;
  if (child) {
    const { executionContextId } = await send("Page.createIsolatedWorld", { frameId: child.frame.id, worldName: "export-inspect" });
    result = await send("Runtime.evaluate", { expression, contextId: executionContextId, returnByValue: true });
  } else {
    // file:// 的不透明源沙箱会独立成浏览器进程，单独连它的调试目标。
    const { targetInfos } = await send("Target.getTargets");
    const target = targetInfos.find(t => t.type === "iframe" && t.url === "about:srcdoc");
    if (!target) throw Error("no preview target");
    if (frameTarget !== target.targetId) {
      frameSocket?.close();
      frameTarget = target.targetId;
      frameSocket = new WebSocket(DEBUG.replace("http:", "ws:") + "/devtools/page/" + frameTarget);
      await new Promise((resolve, reject) => {
        frameSocket.onopen = resolve;
        frameSocket.onerror = reject;
      });
      const pending = new Map();
      let seq = 0;
      frameSocket.onmessage = e => {
        const m = JSON.parse(e.data);
        if (pending.has(m.id)) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
        }
      };
      frameSend = (method, params) =>
        new Promise((resolve, reject) => {
          const id = ++seq;
          pending.set(id, { resolve, reject });
          frameSocket.send(JSON.stringify({ id, method, params }));
        });
    }
    result = await frameSend("Runtime.evaluate", { expression, returnByValue: true });
  }
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
}
for (const [index, name] of files.entries()) {
  await send("Page.navigate", { url: pathToFileURL(`${ARCHIVE}/${name}`).href });
  let state = "";
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    state = await frameEval(`document.documentElement.dataset.previewState`).catch(() => "");
    if (["ready", "error"].includes(state)) break;
  }
  check(
    `offline visualization ${index + 1} starts`,
    state === "ready",
    state ||
      JSON.stringify(
        await evalJs(
          `({url:location.href, title:document.title, text:document.body?.innerText.slice(0,500), frames:document.querySelectorAll('iframe').length})`
        )
      )
  );
  if (index === 0) {
    const result = await frameEval(
      `(() => { document.getElementById('add').click(); return { count:document.getElementById('count').textContent, title:document.title, lines:document.getElementById('lines').textContent, isolation:document.body.dataset.parentAccess, stored:document.body.dataset.stored, color:getComputedStyle(document.body).color }; })()`
    );
    check(
      "offline HTML preserves Unicode, whitespace, interaction and sandbox; page storage works within the page",
      result.count === "1" &&
        result.title === "中文交互🌏" &&
        result.lines === "第一行\n\n\n第四行" &&
        result.isolation === "blocked" &&
        result.stored === "dark",
      JSON.stringify(result)
    );
  } else
    check(
      `offline ${index === 1 ? "ECharts" : "Mermaid"} draws`,
      await frameEval(index === 1 ? `!!document.querySelector('canvas')` : `!!document.querySelector('.mermaid svg')`)
    );
}
frameSocket?.close();
await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
close();
