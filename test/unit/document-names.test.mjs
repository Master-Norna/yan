// 同名的文档：附件按 id、卷宗按路径各算一件。以前按名字去重，附件里三个 README.md 只留一个，
// 卷宗里同名的也进不了这张表——模型拿着路径也找不到
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

test("卷宗里两份 README.md、附件里两份同名：都在表里，列出来时标上大小", () => {
  const f = load([
    "availableDocuments",
    "documentList",
    "setup: state => { store = { settings: {} }; archiveEntries = state.entries; skillDocuments = () => []; }"
  ]);
  f.setup({
    entries: [
      { name: "README.md", path: "a/README.md", size: 11, modifiedAt: "2026-01-01T00:00:00Z" },
      { name: "README.md", path: "b/README.md", size: 22, modifiedAt: "2026-01-02T00:00:00Z" },
      { name: "x.py", path: "x.py", size: 3, modifiedAt: "2026-01-03T00:00:00Z" }
    ]
  });
  const conversation = {
    messages: [
      { attachments: [{ id: "a1", name: "README.md", kind: "text", size: 1 }] },
      { attachments: [{ id: "a2", name: "README.md", kind: "text", size: 2 }] }
    ]
  };
  const docs = f.availableDocuments(conversation);
  assert.deepEqual(
    docs
      .filter(d => d.name === "README.md")
      .map(d => d.id || d.archive)
      .sort(),
    ["a/README.md", "a1", "a2", "b/README.md"]
  );
  const listed = f.documentList({}, docs);
  assert.match(listed.content, /附件 README\.md（1 B）/);
  assert.match(listed.content, /附件 README\.md（2 B）/);
  assert.match(listed.content, /卷宗 a\/README\.md（11 B）/);
  assert.match(listed.content, /卷宗 b\/README\.md（22 B）/);
});
