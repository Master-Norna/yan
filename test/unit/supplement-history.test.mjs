// 补言进历史：往后每一问里，上一答途中寄来的话按到达的位置还原成一句用户的话，不再折成一行冠在下一问头上
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const f = load(["historyForApi", "replyParts", "PROMPTS"]);
{
  const win = { YAN_PROMPTS: {} };
  const req = createRequire(import.meta.url);
  for (const file of ["assistant.js", "tools.js"]) new Function("window", readFileSync(req.resolve(`../../prompts/${file}`), "utf8"))(win);
  Object.assign(f.PROMPTS, win.YAN_PROMPTS);
}
const text = content => (typeof content === "string" ? content : content[0].text);

test("上一答里的「不用了我来」留在上一答里，不冠到下一问头上", async () => {
  const before = "先改了 a.js。";
  const source = [
    { id: "u1", role: "user", content: "把三处都改了", timestamp: "" },
    {
      id: "a1",
      role: "assistant",
      content: `${before}\n\n好的，剩下的交给你。`,
      timestamp: "",
      steps: [
        { id: "s1", name: "edit_file", arguments: "{}", status: "done", title: "a.js", result: "已改", at: 0 },
        { id: "n1", name: "user_note", arguments: "{}", status: "done", note: "不需要了我来吧", at: before.length }
      ]
    },
    { id: "u2", role: "user", content: "那你去继续推进下一个", timestamp: "" }
  ];
  const history = await f.historyForApi(source, "u2", 24000);
  assert.deepEqual(
    history.map(m => m.role),
    ["user", "assistant", "user", "assistant", "user"]
  );
  assert.equal(history[1].content, before);
  assert.match(text(history[2].content), /作答途中用户补充.*不需要了我来吧/s);
  assert.equal(history[3].content, "好的，剩下的交给你。");
  // 下一问只冠上一答的行迹，补言不在里面
  assert.ok(text(history[4].content).endsWith("那你去继续推进下一个"));
  assert.ok(!text(history[4].content).includes("不需要了我来吧"));
});

test("没递出去的补言不进历史；没有补言的一答原样", () => {
  const plain = { id: "a", role: "assistant", content: "答", timestamp: "" };
  assert.deepEqual(f.replyParts(plain), [{ role: "assistant", content: "答" }]);
  const pending = { ...plain, steps: [{ id: "n", name: "user_note", arguments: "{}", status: "running", note: "等等", at: 0 }] };
  assert.deepEqual(f.replyParts(pending), [{ role: "assistant", content: "答" }]);
});

test("补言落在答的开头：前面不留空的助手消息", () => {
  const message = {
    id: "a",
    role: "assistant",
    content: "改道后的答",
    timestamp: "",
    steps: [{ id: "n", name: "user_note", arguments: "{}", status: "done", note: "换个思路", at: 0 }]
  };
  assert.deepEqual(
    f.replyParts(message).map(part => part.role),
    ["user", "assistant"]
  );
});

test("补言摊开全文时题头不再重复第一行；一句短话只占题头", () => {
  const { noteStepHtml } = load(["noteStepHtml"]);
  const count = (html, text) => html.split(text).length - 1;
  const long = noteStepHtml({ id: "n", name: "user_note", arguments: "{}", status: "done", note: "先停一下\n换成另一种做法，理由如下" });
  assert.equal(count(long.replace(/title="[^"]*"/g, ""), "先停一下"), 1);
  const withFile = noteStepHtml({
    id: "n",
    name: "user_note",
    arguments: "{}",
    status: "done",
    note: "看这张图",
    attachments: [{ name: "a.png" }]
  });
  assert.equal(count(withFile.replace(/title="[^"]*"/g, ""), "看这张图"), 1);
  const short = noteStepHtml({ id: "n", name: "user_note", arguments: "{}", status: "done", note: "换个思路" });
  assert.match(short, /class="tool-title"[^>]*>换个思路</);
  assert.ok(!short.includes("tool-note"));
});
