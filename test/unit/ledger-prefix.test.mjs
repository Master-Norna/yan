import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const profile = { id: "p", contextWindow: 10000 },
  conversation = { id: "c" },
  ledger = (text, { lines = text.split("\n").length, partial = false } = {}) => ({ text, lines, partial, sig: "sig" });

function fixture() {
  const f = load([
    "ledgerNote",
    "ledgerBudget",
    "ledgersCut",
    "estimateText",
    `install: () => {
      PROMPTS.work = { ledgerHead: '主答\\n{{text}}', ledgerSub: '帮手\\n{{text}}', ledgerCut: '共 {{lines}} 行，附 {{shown}} 行' };
    }`
  ]);
  f.install();
  return f;
}

for (const role of ["main", "sub"])
  test(`目录记忆${role}：不拿全文的平均密度推前缀截点`, () => {
    const f = fixture(),
      chinese = Array(6).fill("字".repeat(499)),
      english = Array(12).fill("a".repeat(599)),
      show = lines => {
        const note = f.ledgerNote(conversation, role, profile, ledger(lines.join("\n"))).trimEnd();
        return { prefix: note.split("\n").slice(1, -1).join("\n"), tail: note.split("\n").at(-1) };
      };
    const budget = f.ledgerBudget(profile);
    assert.equal(budget, 2000);
    assert.deepEqual(show([...chinese, ...english]), { prefix: chinese.slice(0, 4).join("\n"), tail: "共 18 行，附 4 行" });
    assert.deepEqual(show([...english, ...chinese]), { prefix: english.join("\n"), tail: "共 18 行，附 12 行" });
    assert.ok(f.estimateText(show([...chinese, ...english]).prefix) <= budget);
    assert.equal(f.ledgersCut.has(conversation.id), role === "main", "帮手的那份不能代替主答记已读状态");
  });

test("过长首行可行内截取，保全字符；重读到全文才解除截断标记", () => {
  const f = fixture(),
    left = "a".repeat(7999),
    text = `${left}😀仍有后续`,
    show = input => f.ledgerNote(conversation, "main", profile, input).trimEnd();
  assert.equal(show(ledger(text)), `主答\n${left}\n共 1 行，附 1 行`);
  assert.ok(f.ledgersCut.has(conversation.id));
  assert.equal(show(ledger("很短", { partial: true, lines: 4000 })), "主答\n很短\n共 4000 行，附 1 行");
  assert.ok(f.ledgersCut.has(conversation.id), "桥接只给了开头也不算读过全文");
  assert.equal(show(ledger("全文")), "主答\n全文");
  assert.equal(f.ledgersCut.has(conversation.id), false);
});
