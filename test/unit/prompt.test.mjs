import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { load } from "./harness.mjs";

const prompts = {};
const dir = new URL("../../prompts/", import.meta.url);
for (const name of readdirSync(dir).filter(file => file.endsWith(".js")))
  new Function("window", readFileSync(new URL(name, dir), "utf8"))({ YAN_PROMPTS: prompts });

const f = load([
  "systemPrompt",
  "toolDefinitions",
  `setup: prompts => {
    Object.assign(PROMPTS, prompts);
    bootstrap = { work: { archive: "C:/卷宗", platform: "win32", shell: "PowerShell 7", scratch: ".草稿" } };
  }`
]);
f.setup(prompts);

const work = { id: "w", messages: [], workdir: "E:/demo" },
  chat = { id: "c", messages: [] },
  system = (conversation, role) => f.systemPrompt(conversation, f.toolDefinitions(conversation, { sub: role === "sub" }), { role });

test("言的账号与署共创的写法，言、行、帮手、旁注都读得到", () => {
  const trailer = "Co-Authored-By: Agent-Yan <352840372+Agent-Yan@users.noreply.github.com>";
  for (const text of [system(chat, "main"), system(work, "main"), system(work, "sub"), system(work, "side")])
    assert.ok(text.includes(trailer));
});

test("收尾交代只给主答：帮手的末条是回报，长短由任务说明定", () => {
  const closing = "收尾时用几句话";
  assert.ok(system(work, "main").includes(closing));
  assert.ok(!system(work, "sub").includes(closing));
  assert.ok(!system(chat, "main").includes(closing));
});

test("日期写本地的年月日与星期", () => {
  const date = new Date(),
    pad = n => String(n).padStart(2, "0"),
    day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  assert.ok(system(chat, "main").includes(`今日${day}，周${"日一二三四五六"[date.getDay()]}。`));
});
