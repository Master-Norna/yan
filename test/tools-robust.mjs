// 工具调用的健壮性：参数写得潦草（围栏、多余逗号）能救回来；救不回来时把该收的参数一并回给模型；多选的表单看得出可多选
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", temperature: .7, maxTokens: 8192, quota: "100k", usedTokens: 0, systemPrompt: "" }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);

// ---- 潦草的参数：```json 围栏 + 结尾多一个逗号
await evalJs(
  `document.querySelector("#welcomeInput").value = "SLOPPY 问我"; document.querySelector("#welcomeInput").dispatchEvent(new Event("input")); document.querySelector("#welcome .send-trigger").click(); true`
);
await waitFor(`!!document.querySelector("#approvalBar .ask-q")`, 15000);
check("fenced + trailing-comma arguments still produce the form", true);
const form = await evalJs(
  `(q => ({ multi: q.dataset.multi, tag: q.querySelector(".ask-multi")?.textContent || "", role: q.querySelector(".ask-opt").getAttribute("role"), opts: [...q.querySelectorAll(".ask-opt strong")].map(n => n.textContent).join(","), desc: q.querySelector(".ask-opt small")?.textContent || "", tick: !!q.querySelector(".ask-tick"), placeholder: q.querySelector(".ask-other").placeholder }))(document.querySelector("#approvalBar .ask-q"))`
);
check(
  "multi question is marked, uses checkboxes and split 选项 — 说明",
  form.multi === "true" &&
    form.tag === "可多选" &&
    form.role === "checkbox" &&
    form.opts === "甲,乙,丙" &&
    form.desc === "头一样" &&
    form.tick,
  JSON.stringify(form)
);
check("multi question invites extra text", form.placeholder === "还可自行补充", form.placeholder);
// 多选：点两个都留着；单选才互斥
await evalJs(
  `document.querySelectorAll("#approvalBar .ask-opt")[0].click(); document.querySelectorAll("#approvalBar .ask-opt")[2].click(); true`
);
check(
  "two options stay picked in a multi question",
  (await evalJs(
    `[...document.querySelectorAll('#approvalBar .ask-opt[aria-checked="true"] strong')].map(n => n.textContent).join(",")`
  )) === "甲,丙"
);
await shot("ask-multi.png");
await evalJs(`document.querySelector('#approvalBar [data-form="submit"]').click(); true`);
await waitFor(`document.querySelector(".message.assistant")?.dataset.status === "complete"`);
check(
  "both answers go back to the model",
  (await evalJs(`document.querySelector(".message.assistant .assistant-block > .markdown").textContent`)).includes("甲、丙"),
  await evalJs(`document.querySelector(".message.assistant .assistant-block > .markdown").textContent`)
);

// ---- 救不回来的参数：回给模型的话里要有原因、该收的参数与原文。接着上一问问，末一答即这一问的
await evalJs(
  `document.querySelector("#chatInput").value = "BROKEN 查一下"; document.querySelector("#chatInput").dispatchEvent(new Event("input")); document.querySelector("#chatSend").click(); true`
);
const lastAssistant = `[...document.querySelectorAll(".message.assistant")].at(-1)`;
await waitFor(`document.querySelectorAll(".message.assistant").length === 2 && ${lastAssistant}.dataset.status === "complete"`, 15000);
// 工具调用后模型分了两段说话，正文不止一个 .markdown 块，整块取
const broken = await evalJs(`${lastAssistant}.querySelector(".assistant-block").textContent`);
check(
  "bad arguments are reported with the schema and the raw text",
  /query（string，必填）/.test(broken) && /查一下天气吧/.test(broken),
  broken.slice(0, 200)
);
check(
  "the step is marked failed, not silently dropped",
  await evalJs(
    `(s => s?.dataset.status === "error" && s.querySelector(".tool-meta")?.textContent === "参数解析失败")(${lastAssistant}.querySelector(".tool-step"))`
  ),
  await evalJs(`(s => s?.dataset.status + "|" + s?.querySelector(".tool-meta")?.textContent)(${lastAssistant}.querySelector(".tool-step"))`)
);
close();
