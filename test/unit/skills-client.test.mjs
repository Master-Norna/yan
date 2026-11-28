import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

const win = { YAN_PROMPTS: {} };
for (const name of ["tools", "assistant", "skills"])
  new Function("window", readFileSync(new URL(`../../prompts/${name}.js`, import.meta.url), "utf8"))(win);

test("技能只把名字和说明带进系统提示，参考按需翻；对话附件照常列在工具说明里", async () => {
  const f = load([
    "toolDefinitions",
    "systemPrompt",
    "TOOLS",
    `setup: prompts => {
      Object.assign(PROMPTS, prompts); archiveEntries = [];
      skillSet = { home: 'E:/skills', skills: [{ name: 'demo', description: '照格式写信', dir: 'E:/skills/demo', files:
        ['SKILL.md', ...Array.from({length:80}, (_, i) => 'references/ref-' + i + '.md')].map(path => ({path}))
      }] };
      bridge = async () => ({ text: '参考正文' });
    }`
  ]);
  f.setup(win.YAN_PROMPTS);
  const conversation = { messages: [{ attachments: [{ id: "a1", name: "需求.txt", kind: "text" }] }] };
  const tools = f.toolDefinitions(conversation),
    description = tools.find(tool => tool.function.name === "read_document").function.description,
    system = f.systemPrompt(conversation, tools);
  assert.match(description, /本段附件：需求\.txt。/);
  assert.ok(!description.includes("demo"), "技能目录不在工具说明里");
  assert.match(system, /demo：照格式写信/);
  assert.ok(!system.includes("references/ref-"), "附属文件清单不随每一问发送");
  assert.ok(!system.includes("demo/SKILL.md"));
  const outcome = await f.TOOLS.get("read_document").run({}, { name: "demo/references/ref-79.md" }, { conversation });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.content, "参考正文");
});

test("点名置入的那件附件带着技能名，仍照附件列、照附件读——不当技能目录里的文件去桥接取", async () => {
  const f = load([
    "toolDefinitions",
    "TOOLS",
    `setup: prompts => {
      Object.assign(PROMPTS, prompts); archiveEntries = [];
      skillSet = { home: 'E:/skills', skills: [{ name: 'demo', description: '照格式写信', dir: 'E:/skills/demo', files: [{ path: 'SKILL.md' }] }] };
      bridge = async () => { throw Error('没有这份技能：undefined'); };
      getAttachmentMeta = async () => ({ kind: 'text', data: '点名用技能「demo」，照它做。' });
    }`
  ]);
  f.setup(win.YAN_PROMPTS);
  const conversation = { messages: [{ attachments: [{ id: "a1", name: "demo.md", kind: "text", skill: "demo" }] }] };
  const description = f.toolDefinitions(conversation).find(tool => tool.function.name === "read_document").function.description;
  assert.match(description, /本段附件：demo\.md。/);
  const outcome = await f.TOOLS.get("read_document").run({}, { name: "demo.md" }, { conversation });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.content, "点名用技能「demo」，照它做。");
});

test("「＋」里点一份技能：说明作附件放上案，开头写明点名用它；只凭点名的不进系统提示", async () => {
  const f = load([
    "placeSkill",
    "skillCatalog",
    "pending: () => pendingAttachments",
    `setup: () => {
      store.conversations = []; store.drafts = {}; currentId = null;
      pendingAttachments = []; renderAttachments = () => {}; saveStoreSoon = () => {};
      skillSet = { home: 'E:/skills', skills: [
        { name: 'Demo', description: '写信', dir: 'E:/skills/demo', files: [{ path: 'SKILL.md' }] },
        { name: 'weekly', description: '写周报', dir: 'E:/skills/weekly', files: [{ path: 'SKILL.md' }], manual: true }
      ] };
      bridge = async () => ({ text: '照格式写信' });
      ingestFile = async file => ({ id: 'a', name: file.name, kind: 'text', size: file.size, text: await file.text() });
    }`
  ]);
  f.setup();
  await f.placeSkill({ name: "Demo", dir: "E:/skills/demo" });
  const [placed] = f.pending();
  assert.equal(placed.name, "Demo.md");
  assert.match(placed.text, /^点名用技能「Demo」，照它做。\n技能目录：E:\/skills\/demo\n\n照格式写信$/);
  const catalog = f.skillCatalog().list;
  assert.match(catalog, /- Demo：写信/);
  assert.ok(!catalog.includes("weekly"), "manual 的不列给模型");
});
