// 行迹随时收得起、帮手的行迹也能收、改动条是一道线：翻到摊开的行迹中间，书眉换成它的题头，一点即收；
// 帮手面板里时间线上方有题头可收，翻过题头后顶栏浮出同一枚；面板里的思绪限高；回复之下的改动条注明帮手所改
import { connect, check, sleep, PAGE, WORK } from "./lib.mjs";
const part1 = "先看一眼目录结构，再动手。\n\n",
  part2 = "配置改好了。接着派两名帮手分头核查两个模块。\n\n",
  part3 = "## 小结\n\n- 配置已补上缓存目录\n- 两名帮手都核查完毕\n\n下一步可以修那处越界。";
const content = part1 + part2 + part3;
const longThought = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 步想法：先读渲染模块的入口，确认缓冲区的长度从哪里来。`).join("\n");
const sub = (id, title) => ({
  id: `sub-${id}`,
  task: `${title}：通读模块并跑测试，回报问题。`,
  content: `我先读入口文件。\n\n读完了，跑一遍测试。\n\n回报：${title}已毕。`,
  reasoning: longThought + "\n" + longThought + "\n" + longThought,
  status: "complete",
  rounds: 3,
  durationMs: 64000,
  report: `回报：${title}已毕。`,
  steps: [
    {
      id: `${id}-1`,
      name: "read_file",
      arguments: '{"path":"src/render.js"}',
      status: "done",
      at: 9,
      rat: longThought.length,
      title: "src/render.js",
      result: "320 行",
      scope: `sub-${id}`
    },
    {
      id: `${id}-2`,
      name: "run_command",
      arguments: '{"command":"npm test"}',
      status: "done",
      at: 19,
      rat: longThought.length * 2,
      title: "npm test",
      result: "完成 · 3.2s",
      scope: `sub-${id}`
    },
    {
      id: `${id}-3`,
      name: "write_file",
      arguments: '{"path":"notes.md"}',
      status: "done",
      at: 19,
      rat: longThought.length * 2,
      title: `notes-${id}.md`,
      result: "已写入",
      scope: `sub-${id}`,
      change: { path: `notes-${id}.md`, added: 24, removed: 0, created: true }
    }
  ]
});
// 行迹要够长：翻到它中间时题头已在屏外、身子还占着眼前
const reads = Array.from({ length: 24 }, (_, i) => ({
  id: `r${i}`,
  name: "read_file",
  arguments: `{"path":"src/m${i}.js"}`,
  status: "done",
  at: 0,
  rat: 0,
  title: `src/m${i}.js`,
  result: "40 行"
}));
const steps = [
  ...reads,
  {
    id: "s3",
    name: "edit_file",
    arguments: '{"path":"config.json"}',
    status: "done",
    at: part1.length,
    rat: 0,
    title: "config.json",
    result: "已修改",
    change: { path: "config.json", added: 6, removed: 2 }
  },
  {
    id: "s4",
    name: "write_file",
    arguments: '{"path":"src/cache.js"}',
    status: "done",
    at: part1.length,
    rat: 0,
    title: "src/cache.js",
    result: "已写入",
    change: { path: "src/cache.js", added: 48, removed: 0, created: true }
  },
  {
    id: "d1",
    name: "delegate",
    arguments: '{"title":"核查渲染模块"}',
    status: "done",
    at: part1.length + part2.length,
    rat: 0,
    title: "核查渲染模块",
    result: "3 步 · 改 1 个文件 · 1 分",
    sub: sub("a", "核查渲染模块")
  },
  {
    id: "d2",
    name: "delegate",
    arguments: '{"title":"核查存储模块"}',
    status: "done",
    at: part1.length + part2.length,
    rat: 0,
    title: "核查存储模块",
    result: "3 步 · 改 1 个文件 · 1 分",
    sub: sub("b", "核查存储模块")
  }
];
await fetch(PAGE + "api/chats/save", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    savedAt: Date.now(),
    conversation: {
      id: "trail-fold",
      title: "行迹收起",
      createdAt: "2026-09-28",
      updatedAt: new Date().toISOString(),
      workdir: WORK,
      forks: [],
      threads: [],
      messages: [
        { id: "u", role: "user", content: "给项目加一层缓存，再核查两个模块。", timestamp: "2026-09-28" },
        {
          id: "a",
          role: "assistant",
          content,
          status: "complete",
          work: true,
          durationMs: 185000,
          timestamp: "2026-09-28",
          toolsTouched: true,
          toolsOpen: true,
          steps
        }
      ]
    }
  })
});
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="trail-fold"]')`, 10000);
await evalJs(`document.querySelector('[data-conversation="trail-fold"] .history-open').click(); true`);
await waitFor(`!!document.querySelector(".message.assistant .tool-stack[open]")`, 8000);
await sleep(600);

// 回复之下的改动条：一道线，合计与各件，帮手所改的注一个「帮手」
check(
  "the change bar under the reply sums every file, helpers' included",
  (await evalJs(
    `(b => b.querySelector(".change-title").textContent + "|" + b.querySelector(".change-count").textContent.replace(/\\s+/g, " ").trim() + "|" + b.querySelectorAll(".change-spark i").length)(document.querySelector(".message.assistant .change-bar"))`
  )) === "改动 4 个文件|+102 −2|5"
);
await evalJs(`document.querySelector(".message.assistant .change-summary").click(); true`);
check(
  "its list marks files a helper wrote",
  (await evalJs(`[...document.querySelectorAll(".message.assistant .change-files em")].map(n => n.textContent).join("|")`)) ===
    "新建|新建 · 帮手|新建 · 帮手"
);
await shot("trail-change-bar.png");

// 连着的 24 步读取并成一行（设计稿/85 甲）：「读取 · src/m0.js 等 24 件」，点开列出各步
check(
  "two dozen reads in a row fold into one line that opens to list them",
  (await evalJs(
    `(r => r && r.querySelector(".tool-meta").textContent + "|" + r.querySelector(".tool-title").textContent + "|" + r.querySelectorAll(":scope > .tool-steps > .tool-step").length + "|" + r.open)(document.querySelector(".message.assistant .tool-run"))`
  )) === "24 件|src/m0.js 等 24 件|24|false"
);
await evalJs(`document.querySelector(".message.assistant .tool-run > summary").click(); true`);
check("clicking the folded line opens it", await evalJs(`document.querySelector(".message.assistant .tool-run").open`));
await evalJs(`document.querySelector(".message.assistant .tool-run").scrollIntoView({ block: "start" }); true`);
await sleep(300);
await shot("trail-run.png");
await evalJs(`document.querySelector(".message.assistant .tool-run > summary").click(); true`);

// 翻到行迹中间：顶栏右侧、对话列右缘处浮出「收起行迹」；左边的书眉照旧是题名
const foldShown = () => evalJs(`document.querySelector("#trailFold").classList.contains("shown")`);
await evalJs(`(h => { h.scrollTop = 0; h.dispatchEvent(new Event("scroll")); })(document.querySelector("#chatScroll")); true`);
await sleep(200);
check("while the trail head is on screen no fold button floats", !(await foldShown()));
await evalJs(
  `(() => { const host = document.querySelector("#chatScroll"), summary = document.querySelector(".message.assistant .tool-stack > summary"); host.scrollTop += summary.getBoundingClientRect().top - host.getBoundingClientRect().top + 160; host.dispatchEvent(new Event("scroll")); })(); true`
);
await sleep(300);
const place = await evalJs(
  `(() => { const f = document.querySelector("#trailFold").getBoundingClientRect(), col = document.querySelector("#messages").getBoundingClientRect(), head = document.querySelector("#runningHead").getBoundingClientRect(); return { mid: Math.round((f.left + f.right) / 2), col: Math.round((col.left + col.right) / 2), left: Math.round(f.left), head: Math.round(head.right), title: document.querySelector("#runningHead .running-head-title").textContent }; })()`
);
check(
  "inside a long open trail a fold button floats at the middle of the column, the title left as is but kept clear of it",
  // 对着对话列的中线；左边的书眉让到它左边，长题名不压到它底下
  (await foldShown()) && Math.abs(place.mid - place.col) <= 30 && place.head <= place.left && place.title === "行迹收起",
  JSON.stringify(place)
);
await shot("trail-running-head.png");
await evalJs(`document.querySelector("#trailFold").click(); true`);
await sleep(700);
check(
  "clicking it folds the trail and remembers the choice",
  await evalJs(
    `!document.querySelector(".message.assistant .tool-stack").open && __yanState().conversations.find(c => c.id === "trail-fold").messages[1].toolsOpen === false`
  )
);
await evalJs(`document.querySelector("#chatScroll").dispatchEvent(new Event("scroll")); true`);
await sleep(200);
check("once folded the button goes away", !(await foldShown()));

// 帮手面板：时间线上方的题头可收；思绪限高
await evalJs(`document.querySelector(".message.assistant .tool-stack > summary").click(); true`);
await sleep(500);
await evalJs(`document.querySelector('.tool-step-delegate[data-step-id="d1"] .tool-step-head').click(); true`);
await waitFor(`!!document.querySelector("#helperPanelBody .sub-fold")`, 5000);
check(
  "the helper panel heads its trail with rounds and steps",
  (await evalJs(`document.querySelector("#helperPanelBody .sub-fold").textContent`)) === "行迹2 轮 · 3 步"
);
await evalJs(`document.querySelectorAll("#helperPanelBody .reasoning").forEach(d => (d.open = true)); true`);
await sleep(300);
check(
  "a helper's thoughts are capped in the panel instead of running on",
  await evalJs(
    `[...document.querySelectorAll("#helperPanelBody .reasoning-body")].every(b => getComputedStyle(b).maxHeight === "320px" && b.clientHeight <= 320)`
  )
);
await evalJs(`(s => { s.scrollTop = 260; s.dispatchEvent(new Event("scroll")); })(document.querySelector("#helperScroll")); true`);
await sleep(300);
check(
  "scrolled past its head, the panel's top bar offers to fold",
  await evalJs(`document.querySelector("#helperFoldHead").classList.contains("shown")`)
);
await shot("trail-helper-panel.png");
await evalJs(`document.querySelector("#helperFoldHead").click(); true`);
// 收起的动效 380ms，放完才记 folded：机器慢时固定等 500ms 不够，等它落定再查
await waitFor(`document.querySelector("#helperPanelBody .sub-trail").classList.contains("folded")`, 5000).catch(() => {});
check(
  "folding leaves the report in view",
  await evalJs(
    `document.querySelector("#helperPanelBody .sub-trail").classList.contains("folded") && getComputedStyle(document.querySelector("#helperPanelBody .sub-timeline")).display === "none" && !!document.querySelector("#helperPanelBody .sub-report") && !document.querySelector("#helperFoldHead").classList.contains("shown")`
  )
);
await evalJs(`document.querySelector('#helperNav [data-helper-step="1"]').click(); true`);
await sleep(300);
check(
  "another helper opens unfolded",
  !(await evalJs(`document.querySelector("#helperPanelBody .sub-trail").classList.contains("folded")`))
);
await evalJs(`document.querySelector('#helperNav [data-helper-step="-1"]').click(); true`);
await sleep(300);
check(
  "coming back, the folded one stays folded",
  await evalJs(`document.querySelector("#helperPanelBody .sub-trail").classList.contains("folded")`)
);
await evalJs(`document.querySelector("#helperPanelBody .sub-fold").click(); true`);
check("its head unfolds it again", !(await evalJs(`document.querySelector("#helperPanelBody .sub-trail").classList.contains("folded")`)));
close();
