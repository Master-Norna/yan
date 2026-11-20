// 右下角的上下文计数与自动压缩的门槛共用一个估算：它得跟真正送出去的那份一致。
// 一答开工时把目录记忆与意接在这一问的末条 user 消息之后（见 14-chat-engine/20-stream.js 的 buildHead），
// 估的时候漏掉它们，读数就偏小、压前文也就压晚一拍。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./harness.mjs";

const win = { YAN_PROMPTS: {} };
new Function("window", readFileSync(new URL("../../prompts/work.js", import.meta.url), "utf8"))(win);

function fixture() {
  const f = load([
    "contextEstimate",
    "estimateText",
    "ledgerNoteText",
    "intentNote",
    "asIntent",
    "applyIntentOps",
    "ledgers",
    "intents",
    `setup: prompts => {
      Object.assign(PROMPTS, prompts);
      // 系统提示与工具表另有用例守着，这里只看往来与这一问之后附的两段
      systemPrompt = () => "";
      toolDefinitions = () => null;
    }`
  ]);
  f.setup(win.YAN_PROMPTS);
  return f;
}

const profile = { id: "p", contextWindow: 32000 },
  conversation = () => ({ id: "c", messages: [{ id: "u1", role: "user", content: "帮我看一眼这个目录", attachments: [] }] });

test("目录记忆算在下一问的估算里，算的正是真附上去的那段", () => {
  const f = fixture(),
    c = conversation(),
    before = f.contextEstimate(c, "", null, profile);
  assert.equal(f.ledgers.size, 0);
  f.ledgers.set("c", { text: "记".repeat(2000), lines: 2000, partial: false, sig: "s" });
  const shown = f.ledgerNoteText(c, "main", profile);
  assert.ok(shown, "有目录记忆时这一问确实要附一段");
  assert.equal(f.contextEstimate(c, "", null, profile) - before, f.estimateText(shown.text));
});

test("意算在下一问的估算里", () => {
  const f = fixture(),
    c = conversation(),
    intent = f.applyIntentOps(
      f.asIntent(null),
      [{ id: "读一遍", claim: "知道这份目录在做什么", check: "说得出三件事", root: true, anchors: ["file:a.txt"] }],
      { prints: {}, ask: "读一遍这个目录" }
    ),
    before = f.contextEstimate(c, "", null, profile);
  f.intents.set("c", { intent, now: {} });
  const note = f.intentNote(c);
  assert.ok(note.trim(), "有意时这一问确实要附一段");
  assert.equal(f.contextEstimate(c, "", null, profile) - before, f.estimateText(note));
});

test("两样都没有时不凭白多算", () => {
  const f = fixture(),
    c = conversation();
  assert.equal(f.contextEstimate(c, "", null, profile), f.contextEstimate(c, "", null, profile));
  assert.equal(f.ledgerNoteText(c, "main", profile), null);
  assert.equal(f.intentNote(c), "");
});
