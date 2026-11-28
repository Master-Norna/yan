// 工作区刷新：切版本换改动列表、冷读接回补文件、同答再改更新已开的 diff。
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { connect, check, sleep, PAGE, ARCHIVE, CHATS } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
// 工作区的实情（闭包里的变量读不到，只好看 DOM）
const workState = () =>
  evalJs(
    `JSON.stringify({ crumbs: document.querySelector("#workCrumbs")?.textContent || "", rows: [...document.querySelectorAll("#workStrips .work-row strong")].map(el => el.textContent), said: document.querySelector("#workStrips").textContent.trim().slice(0, 120) })`
  );

// 每一步在 diff 里留一条抬头提示；没记下原文的那一步另加一句说明，数步骤时把那句滤掉。
const stepNotes = `[...document.querySelectorAll("#fileViewerStage .file-viewer-note")].filter(el => !el.textContent.includes("未记录此操作的文本差异")).length`;

const ROOT = `${ARCHIVE}/刷新`;
mkdirSync(ROOT, { recursive: true });
writeFileSync(`${ROOT}/a.md`, "# A\n");
writeFileSync(`${ROOT}/b.md`, "# B\n");
writeFileSync(`${ROOT}/helper.txt`, "帮手改的\n");

const step = (id, name, path, added = 1, removed = 0) => ({
  id,
  name,
  status: "done",
  arguments: "{}",
  title: path,
  root: ROOT,
  result: "已写入",
  change: { path, added, removed }
});
const save = conversation =>
  fetch(PAGE + "api/chats/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ savedAt: Date.now(), conversation })
  });

// 两个版本各改一件：切过去，工作区的改动列表要换到那一版
await save({
  id: "refresh-branch",
  title: "刷新切版",
  createdAt: "2026-11-28",
  updatedAt: new Date().toISOString(),
  workdir: ROOT,
  threads: [],
  forks: [
    {
      id: "f1",
      parentId: "u1",
      createdAt: "2026-11-28",
      messages: [
        {
          id: "a2",
          role: "assistant",
          content: "另一版改好了。",
          status: "complete",
          timestamp: "2026-11-28 10:05",
          work: true,
          steps: [step("s2", "write_file", "b.md")]
        }
      ]
    }
  ],
  messages: [
    { id: "u1", role: "user", content: "改一件。", timestamp: "2026-11-28 10:00" },
    {
      id: "a1",
      role: "assistant",
      content: "这一版改好了。",
      status: "complete",
      timestamp: "2026-11-28 10:01",
      work: true,
      steps: [step("s1", "write_file", "a.md")]
    }
  ]
});

// 帮手改的件在另存的行迹里：热读前工作区是空的，接回后要补上
const coldId = "refresh-cold",
  code = createHash("sha1").update(coldId).digest("hex").slice(0, 10),
  trailDir = `${CHATS}/行迹/${code}`;
mkdirSync(trailDir, { recursive: true });
writeFileSync(
  `${trailDir}/helper.json`,
  JSON.stringify({
    reasoning: "",
    subs: {
      "sub-d1": { reasoning: "", steps: [step("h1", "write_file", "helper.txt")] }
    }
  })
);
await save({
  id: coldId,
  title: "刷新冷读",
  createdAt: "2026-11-28",
  updatedAt: new Date().toISOString(),
  workdir: ROOT,
  forks: [],
  threads: [],
  messages: [
    { id: "cu1", role: "user", content: "让帮手改一件。", timestamp: "2026-11-28 11:00" },
    {
      id: "c1",
      role: "assistant",
      content: "帮手改好了。",
      status: "complete",
      timestamp: "2026-11-28 11:01",
      work: true,
      cold: { key: "helper" },
      steps: [
        {
          id: "d1",
          name: "delegate",
          status: "done",
          arguments: "{}",
          title: "帮手改件",
          result: "回报",
          sub: { id: "sub-d1", status: "complete" }
        }
      ]
    }
  ]
});

await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector('[data-conversation="refresh-branch"]')`, 10000);
await evalJs(`document.querySelector('[data-conversation="refresh-branch"] .history-open').click(); true`);
await waitFor(`!!document.querySelector('.message[data-message="a1"]')`, 8000);
await evalJs(`document.querySelector("#stagePin").click(); true`);
await sleep(300);
await evalJs(`document.querySelector("#stageWorkBtn").click(); true`);
await waitFor(`document.querySelector("#workCrumbs .here")?.title === ${JSON.stringify(ROOT)}`, 8000).catch(() => {});
await evalJs(`document.querySelector('#stageWork [data-work-mode="changes"]').click(); true`);
await waitFor(`document.querySelector("#workStrips").textContent.includes("a.md")`, 8000).catch(() => {});
check("改动面先列出当前这一版的件", await evalJs(`document.querySelector("#workStrips").textContent.includes("a.md")`), await workState());

// 切版本：正文换答，改动列表跟着换
await evalJs(
  `(() => { const b = document.querySelector('#messages [data-action="branch-next"]:not([disabled]), #messages [data-action="branch-prev"]:not([disabled])'); if (b) b.click(); return !!b; })()`
);
await waitFor(`document.querySelector("#workStrips").textContent.includes("b.md")`, 8000).catch(() => {});
check(
  "切版本后工作区改列新一版的件，不留在旧答",
  await evalJs(
    `document.querySelector("#workStrips").textContent.includes("b.md") && !document.querySelector("#workStrips").textContent.includes("a.md")`
  ),
  await workState()
);

// 同答再改同一件：开着的 diff 要换到新的一笔
await evalJs(
  `[...document.querySelectorAll("#workStrips [data-work-file]")].find(el => el.dataset.workFile.endsWith("/b.md")).click(); true`
);
await waitFor(
  `/这一答的改动/.test(document.querySelector("#fileViewerName")?.textContent || "") && !!document.querySelector("#fileViewerStage .change-diff")`,
  8000
);
check("diff 先显示这一答的第一笔", await evalJs(`${stepNotes} === 1`));
await evalJs(
  `(() => {
    const c = __yanState().conversations.find(c => c.id === "refresh-branch");
    c.messages[1].steps.push(${JSON.stringify(step("s3", "edit_file", "b.md", 2, 1))});
    document.querySelector('#stageWork [data-work-mode="search"]').click();
    document.querySelector('#stageWork [data-work-mode="changes"]').click();
    return true;
  })()`
);
await waitFor(`${stepNotes} === 2`, 8000).catch(() => {});
check(
  "同答再次改同一件时，开着的 diff 跟着换新",
  await evalJs(`${stepNotes} === 2`),
  await evalJs(`document.querySelector("#fileViewerStage").textContent.slice(0, 160)`)
);

// 冷读接回：另存的帮手行迹取回来之后，工作区要补上帮手改的件
await evalJs(`document.querySelector('[data-conversation="refresh-cold"] .history-open').click(); true`);
await waitFor(`!!document.querySelector('.message[data-message="c1"]')`, 8000);
await evalJs(`document.querySelector('#stageWork [data-work-mode="changes"]').click(); true`);
await waitFor(`document.querySelector("#workStrips").textContent.includes("helper.txt")`, 8000).catch(() => {});
check(
  "另存的帮手行迹接回后，工作区补上帮手改的件",
  await evalJs(`document.querySelector("#workStrips").textContent.includes("helper.txt")`),
  await workState()
);

await close();
