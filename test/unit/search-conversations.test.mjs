// 查旧谈：由「拼成一整段再匹配」改成逐条扫之后，语义照旧——词可以分散在不同的消息里，都出现过才算命中。
// 这条守着那次改动别把跨消息命中弄丢（那段代码只为了少拼一份几 MB 的全文）。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup() {
  const f = load([
    "TOOLS",
    `setup: () => {
      store = {
        memory: { items: [] },
        conversations: [
          { id: "c1", title: "训练这摊", workdir: "", updatedAt: "2026-01-02", createdAt: "2026-01-01", messages: [
            { role: "user", content: "先说训练的数据从哪来" },
            { role: "assistant", content: "再讲评测怎么打分" }
          ] },
          { id: "c2", title: "另一段", workdir: "", updatedAt: "2026-01-01", createdAt: "2026-01-01", messages: [
            { role: "user", content: "只说训练" }
          ] }
        ]
      };
    }`
  ]);
  f.setup();
  const search = query => {
    const step = {};
    const result = f.TOOLS.get("search_conversations").run(
      step,
      { query },
      {
        conversation: { id: "self", messages: [], workdir: "" }
      }
    );
    return { result, step };
  };
  return { ...f, search };
}

test("词分散在不同消息里也算命中，只有一部分的不算", () => {
  const { search } = setup();
  const { result, step } = search("训练 评测");
  assert.match(result.content, /c1/);
  assert.doesNotMatch(result.content, /c2/);
  assert.deepEqual(
    step.results.map(hit => hit.conversationId),
    ["c1"]
  );
});

test("有一个词没出现过就整段不命中", () => {
  const { search } = setup();
  const { result } = search("训练 分词器");
  assert.equal(result.display, "0 段");
});
