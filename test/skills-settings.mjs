// 设置 → 技能：只一处（存储根/技能），就地写一份；点行摊开看（不成框），「改」才成输入框、改名（目录跟着走）、删去
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, check, sleep, PAGE, HOME } from "./lib.mjs";
const { send, evalJs, waitFor, shot, close } = await connect();
const SKILLS = `${HOME}/技能`;
await send("Page.navigate", { url: PAGE });
await waitFor(`!!document.querySelector("#openSettings")`);
await sleep(400);
await evalJs(`document.querySelector("#openSettings").click(); document.querySelector('.tab-btn[data-tab="skills"]').click(); true`);
await waitFor(`!!document.querySelector("#settingsContent #addSkill")`);
check(
  "one list, no sources or toggles; the head shows the skills folder",
  await evalJs(
    `!document.querySelector("[data-skill-source]") && !document.querySelector(".plan-svg") && document.querySelector(".skill-head .skill-dir").textContent.endsWith("技能")`
  )
);

// 新建：名字、何时用、正文，焦点离开即存成 技能/<名字>/SKILL.md
await evalJs(`document.querySelector("#addSkill").click(); true`);
await waitFor(`!!document.querySelector("[data-skill-editor]")`);
check("the new skill opens with the name field focused", await evalJs(`document.activeElement?.dataset.skillField === "name"`));
const fill = (field, value) =>
  evalJs(
    `(f => { f.focus(); f.value = ${JSON.stringify(value)}; f.dispatchEvent(new Event("input")); return true; })(document.querySelector('[data-skill-field="${field}"]'))`
  );
await fill("name", "回信");
await fill("description", "替人回信时：先谢来信，再答所问");
await fill("body", "一、谢来信。\n二、逐条答。\n三、落款。");
await sleep(800);
await shot("skills-editor.png");
await evalJs(`document.activeElement.blur(); true`);
const row = name => `[...document.querySelectorAll(".skill-row")].find(r => r.querySelector(".skill-name").textContent === "${name}")`;
const view = name => `(document.querySelector("[data-skill-view] .skill-view-name")?.textContent === "${name}")`;
await waitFor(`!document.querySelector("[data-skill-editor]") && ${view("回信")}`, 8000);
check(
  "after saving it stays open to read, with no field to put a caret in",
  await evalJs(
    `!document.querySelector("[data-skill-view] input, [data-skill-view] textarea") && document.querySelector("[data-skill-view]").textContent.includes("逐条答")`
  )
);
await evalJs(`document.querySelector("[data-skill-collapse]").click(); true`);
await waitFor(`!document.querySelector("[data-skill-view]") && !!${row("回信")}`);
check("clicking the text folds it back to one line", true);
const made = existsSync(`${SKILLS}/回信/SKILL.md`) ? readFileSync(`${SKILLS}/回信/SKILL.md`, "utf8") : "";
check(
  "leaving the editor writes 技能/回信/SKILL.md with name, description and body",
  /name: "回信"/.test(made) && /description: "替人回信时：先谢来信，再答所问"/.test(made) && /二、逐条答。/.test(made),
  made
);

// 看：点那一行，正文现取摊开，只读；「改」才换成输入框。改名后目录跟着改
await evalJs(`${row("回信")}.click(); true`);
await waitFor(`${view("回信")} && document.querySelector("[data-skill-view]").textContent.includes("逐条答")`, 8000);
check("clicking a row opens it to read, not to edit", await evalJs(`!document.querySelector("[data-skill-editor]")`));
check(
  "the skill name, description and body use an arrow cursor while reading",
  await evalJs(
    `[...document.querySelectorAll("[data-skill-view] .skill-view-name, [data-skill-view] .memory-body")].every(n => getComputedStyle(n).cursor === "default")`
  )
);
await shot("skills-reading.png");
await evalJs(`document.querySelector("[data-skill-modify]").click(); true`);
await waitFor(
  `!!document.querySelector('[data-skill-field="body"]') && document.querySelector('[data-skill-field="body"]').value.includes("逐条答")`,
  8000
);
check(
  "editing loads the body without its front matter",
  await evalJs(`!document.querySelector('[data-skill-field="body"]').value.includes("name:")`)
);
await fill("name", "复信");
await evalJs(`document.querySelector("[data-skill-done]").click(); true`);
await waitFor(`!document.querySelector("[data-skill-editor]") && ${view("复信")}`, 8000);
check("renaming moves the folder", existsSync(`${SKILLS}/复信/SKILL.md`) && !existsSync(`${SKILLS}/回信`));

// 保存请求还在路上时回到正文接着写，失焦也不能丢掉后改的这一版。
await evalJs(`document.querySelector("[data-skill-modify]").click(); true`);
await waitFor(`!!document.querySelector('[data-skill-field="body"]')`);
await fill("body", "保存的第一版");
await evalJs(`(() => {
  const original = window.fetch.bind(window);
  let release;
  const gate = new Promise(resolve => release = resolve);
  window.__skillSave = { calls:0, release, original };
  window.fetch = (...args) => {
    const save = String(args[0]).includes("/api/skills/save") || String(args[1]?.body || "").includes('"path":"/api/skills/save"');
    if (save && ++window.__skillSave.calls === 1) return gate.then(() => original(...args));
    return original(...args);
  };
  document.querySelector("[data-skill-done]").click();
})(); true`);
await waitFor(`window.__skillSave.calls === 1`);
await fill("body", "保存期间补充的第二版");
await evalJs(`document.activeElement.blur(); window.__skillSave.release(); true`);
await waitFor(`!document.querySelector("[data-skill-editor]") && window.__skillSave.calls === 2`, 8000);
check(
  "edits made while the save waits are saved next before the editor closes",
  readFileSync(`${SKILLS}/复信/SKILL.md`, "utf8").includes("保存期间补充的第二版")
);
await evalJs(`window.fetch = window.__skillSave.original; true`);

// 删去：看着的那份底下那枚「删」，先问，连同目录一并删
await waitFor(`${view("复信")}`);
await evalJs(`document.querySelector("[data-skill-view] [data-skill-remove]").click(); true`);
await waitFor(`!document.querySelector("#confirmModal").classList.contains("hidden")`);
check("deleting asks first and names the folder", /复信/.test(await evalJs(`document.querySelector("#confirmModal").textContent`)));
await evalJs(`document.querySelector("#confirmOk").click(); true`);
await waitFor(`!${row("复信")} && !${view("复信")}`, 8000);
check("the skill folder is gone from disk", !existsSync(`${SKILLS}/复信`));

// 附带：SKILL.md 之外的件按夹归拢，不过 12 件夹全开着，多了先收起、一夹至多列 12 件；点一件进预览器看
const bundle = (name, files) => {
  mkdirSync(`${SKILLS}/${name}`, { recursive: true });
  writeFileSync(
    `${SKILLS}/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: 查多方来源时用。\n---\n\n照 references/researcher.md 做。\n`
  );
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(`${SKILLS}/${name}/${file}`.replace(/\/[^/]*$/, ""), { recursive: true });
    writeFileSync(`${SKILLS}/${name}/${file}`, text);
  }
};
bundle("研究", {
  "references/researcher.md": "# 研究员\n先列子题。",
  "references/report-writer.md": "成稿。",
  "scripts/merge.py": "print(1)\n"
});
bundle("大包", Object.fromEntries([["ooxml.md", "规范"], ...Array.from({ length: 20 }, (_, i) => [`schemas/s${i}.xsd`, "<x/>"])]));
await evalJs(
  `document.querySelector('.tab-btn[data-tab="general"]').click(); document.querySelector('.tab-btn[data-tab="skills"]').click(); true`
);
await waitFor(`!!${row("研究")}`, 8000);
await evalJs(`${row("研究")}.click(); true`);
await waitFor(`!!document.querySelector("[data-skill-files]")`, 8000);
check(
  "an opened skill lists its bundled files by folder, all open when few",
  await evalJs(
    `document.querySelector(".skill-files-head").textContent === "附带 3 件" && [...document.querySelectorAll(".skill-fold")].map(b => b.textContent).join() === "references2 件,scripts1 件" && document.querySelectorAll(".skill-file").length === 3`
  )
);
check(
  "the pouch of the opened skill sits in the same column as the rows' pouches",
  await evalJs(`(() => {
    const row = document.querySelector(".skill-item .skill-mark").getBoundingClientRect(), open = document.querySelector("[data-skill-view] .skill-mark").getBoundingClientRect();
    const name = document.querySelector(".skill-row .skill-name").getBoundingClientRect(), title = document.querySelector("[data-skill-view] .skill-view-name").getBoundingClientRect();
    return Math.abs(row.left - open.left) < 1 && Math.abs(name.left - title.left) < 3;
  })()`)
);
check(
  "a row shows how many files it carries, without sorting them into kinds",
  await evalJs(`${row("大包")}.querySelector(".skill-count")?.textContent === "21" && !document.querySelector(".skill-extra")`)
);
await shot("skills-files.png");
// 点锦囊：切只凭点名，写进 SKILL.md 头上那一行，锦囊淡下；再点改回。摊开着也照样点得，不收起
await evalJs(`document.querySelector('[data-skill-view] [data-skill-manual]').click(); true`);
await waitFor(`!!document.querySelector("[data-skill-view] .skill-mark.quiet")`, 8000);
check(
  "clicking the pouch makes the skill only-when-picked and keeps it open",
  /disable-model-invocation: true/.test(readFileSync(`${SKILLS}/研究/SKILL.md`, "utf8")) &&
    (await evalJs(`document.querySelector("[data-skill-view] [data-skill-manual]").getAttribute("aria-pressed") === "true"`))
);
await shot("skills-manual.png");
await evalJs(`document.querySelector('[data-skill-view] [data-skill-manual]').click(); true`);
await waitFor(`!document.querySelector("[data-skill-view] .skill-mark.quiet")`, 8000);
check("clicking it again hands it back to the model", !/disable-model-invocation/.test(readFileSync(`${SKILLS}/研究/SKILL.md`, "utf8")));
await evalJs(`document.querySelector('[data-skill-fold="references"]').click(); true`);
await waitFor(`document.querySelectorAll(".skill-file").length === 1`);
check("clicking a folder folds it", await evalJs(`document.querySelector('[data-skill-fold="references"]').classList.contains("shut")`));
await evalJs(`document.querySelector('[data-skill-file="scripts/merge.py"]').click(); true`);
await waitFor(
  `!document.querySelector("#fileViewer").classList.contains("hidden") && document.querySelector("#fileViewerStage").textContent.includes("print(1)")`,
  8000
);
check("clicking a file opens it in the viewer", await evalJs(`document.querySelector("#fileViewerName").textContent === "merge.py"`));
await sleep(600);
await shot("skills-file-viewer.png");
await evalJs(`document.querySelector("#fileViewerClose").click(); true`);
await waitFor(`document.querySelector("#fileViewer").classList.contains("hidden")`);
check("closing the viewer leaves settings open", await evalJs(`!document.querySelector("#settingsModal").classList.contains("hidden")`));
await evalJs(`document.querySelector("[data-skill-collapse]").click(); true`);
await waitFor(`!document.querySelector("[data-skill-view]")`);
await evalJs(`${row("大包")}.click(); true`);
await waitFor(`!!document.querySelector("[data-skill-files]")`, 8000);
check(
  "with many files folders start folded",
  await evalJs(
    `document.querySelector('[data-skill-fold="schemas"]').classList.contains("shut") && document.querySelectorAll(".skill-file").length === 1`
  )
);
await evalJs(`document.querySelector('[data-skill-fold="schemas"]').click(); true`);
await waitFor(`document.querySelectorAll(".skill-file").length === 13`);
check(
  "an opened folder lists 12 and counts the rest",
  await evalJs(`document.querySelector("[data-skill-reveal]")?.textContent === "余下 8 件 · 打开"`)
);
await shot("skills-files-many.png");
// 改一份长正文：框要随字长高、末尾不被吞（只在打开那刻量一回高，此后宽度或字形一变，多折出的行就藏进 overflow: hidden）
await evalJs(`document.querySelector("[data-skill-collapse]").click(); true`);
await waitFor(`!document.querySelector("[data-skill-view]")`);
// 正文借 skill-creator 那份：有代码块、长短行混排，合成的整齐长句复现不出被吞
bundle("长文", {});
writeFileSync(
  `${SKILLS}/长文/SKILL.md`,
  readFileSync("skills/skill-creator/SKILL.md", "utf8").replace(/^---[\s\S]*?\n---/, "---\nname: 长文\ndescription: 长正文\n---")
);
await evalJs(
  `document.querySelector('.tab-btn[data-tab="general"]').click(); document.querySelector('.tab-btn[data-tab="skills"]').click(); true`
);
await waitFor(`!!${row("长文")}`, 8000);
await evalJs(`${row("长文")}.click(); true`);
await waitFor(`${view("长文")}`, 8000);
await evalJs(`document.querySelector("[data-skill-modify]").click(); true`);
await waitFor(`!!document.querySelector('[data-skill-field="body"]')`);
await sleep(300);
check(
  "editing a long body shows all of it, the tail not clipped",
  await evalJs(
    `[...document.querySelectorAll("[data-skill-editor] textarea")].every(a => a.scrollHeight <= a.clientHeight + 1) && document.querySelector('[data-skill-field="body"]').value.trim().endsWith("里挑它，再写需求。")`
  )
);
await evalJs(`document.querySelector("[data-skill-done]").click(); true`);
await waitFor(`!document.querySelector("[data-skill-editor]")`, 8000);
for (const name of ["研究", "大包", "长文"]) rmSync(`${SKILLS}/${name}`, { recursive: true, force: true });

await evalJs(`document.querySelector("#closeSettings")?.click(); true`);

// 「＋」→「技能」：挑一份，说明作附件置于案上。user-invocable: false 的不列；查找也认何时用
const put = (name, head) => {
  mkdirSync(`${SKILLS}/${name}`, { recursive: true });
  writeFileSync(`${SKILLS}/${name}/SKILL.md`, `---\nname: ${name}\n${head}---\n\n照格式写。\n`);
};
put("周报", "description: 写周报时用。其余略\ndisable-model-invocation: true\n");
put("周记", "description: 记一周的事\n");
put("暗记", "description: 背景知识\nuser-invocable: false\n");
// 点看得见的那枚：先跑了别的用例时停在对话页，欢迎页藏着；停在卷宗（重载照旧开着）的，先收起
await evalJs(`!document.querySelector("#library").classList.contains("hidden") && document.querySelector("#openLibrary").click(); true`);
await waitFor(`document.querySelector("#library").classList.contains("hidden")`);
const plus = `[...document.querySelectorAll(".attach-trigger")].find(b => b.offsetParent)`;
// 头一回点开时现取技能，再开一回才见新放进来的
await evalJs(`${plus}.click(); true`);
await waitFor(`!!document.querySelector('[data-menu="skill"]')`);
await evalJs(`document.body.click(); true`);
await sleep(300);
await evalJs(`${plus}.click(); true`);
await waitFor(`document.querySelector('[data-menu="skill"] small')?.textContent === "2 份"`, 8000);
await evalJs(`document.querySelector('[data-menu="skill"]').click(); true`);
await waitFor(`!!document.querySelector(".attach-picker [data-pick]")`);
const names = await evalJs(`[...document.querySelectorAll(".attach-picker [data-pick] span")].map(s => s.textContent)`);
check("the + menu lists skills, hiding user-invocable: false", names.join() === "周报,周记", names);
await evalJs(
  `(i => { i.value = "一周的事"; i.dispatchEvent(new Event("input")); return true; })(document.querySelector(".attach-picker input"))`
);
await shot("skills-picker.png");
check(
  "searching matches the when-to-use line too",
  (await evalJs(`[...document.querySelectorAll(".attach-picker [data-pick] span")].map(s => s.textContent).join()`)) === "周记"
);
await evalJs(`document.querySelector(".attach-picker [data-pick]").click(); true`);
await waitFor(`[...document.querySelectorAll(".attachment-list")].some(l => l.offsetParent && l.textContent.includes("周记"))`, 8000);
check("picking a skill puts its instructions on the desk as an attachment", !(await evalJs(`!!document.querySelector(".attach-picker")`)));
check(
  "the desk shows it as a skill: a pouch and the skill's name",
  await evalJs(
    `(c => !!c.querySelector(".skill-fi") && c.querySelector(".attachment-name").textContent === "周记")([...document.querySelectorAll(".attachment-list")].find(l => l.offsetParent).querySelector(".attachment-card"))`
  )
);
await shot("skills-desk.png");
await evalJs(
  `[...document.querySelectorAll(".attachment-list")].find(l => l.offsetParent)?.querySelector("[data-remove-attachment]")?.click(); true`
);
for (const name of ["周报", "周记", "暗记"]) rmSync(`${SKILLS}/${name}`, { recursive: true, force: true });
close();
