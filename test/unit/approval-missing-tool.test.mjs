// 请示条上画什么，由那件工具的 approval 定。这件工具可能已经不在表里：接了 MCP 服务、它正等请示，
// 这时在设置里停用或改了配置，带 mcp 标记的工具整批摘掉（见 15-tools/60-mcp.js 的 registerMcpTools）。
// 原来这里直接取 TOOLS.get(…).approval，取不到就抛 TypeError——整页 render 停在那一句上，请示条与它后面的几处一并画不出来。
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function fixture() {
  const f = load(["approvalBarHtml", "TOOLS"]);
  f.TOOLS.clear();
  return f;
}

test("工具已不在表里：给一张只剩「跳过」的条，不抛错", () => {
  const f = fixture(),
    html = f.approvalBarHtml({ id: "s1", name: "mcp__demo__write", status: "pending" });
  assert.match(html, /data-approve="skip"/, "留着一条出路：跳过这一步");
  assert.doesNotMatch(html, /data-approve="run"/, "工具都没了，没有「运行」可批");
  assert.match(html, /mcp__demo__write/, "写清是哪一件");
});

test("工具在：照它自己的请示表画", () => {
  const f = fixture();
  f.TOOLS.set("demo", { approval: step => `<div data-step="${step.id}">demo 的请示</div>` });
  assert.match(f.approvalBarHtml({ id: "s2", name: "demo" }), /demo 的请示/);
});

test("守的关口不管工具在不在，都照关口那一张画", () => {
  const f = fixture(),
    html = f.approvalBarHtml({ id: "s3", name: "run_command", gate: { id: "守一", claim: "不许发布", target: "npm publish" } });
  assert.match(html, /守一/);
  assert.match(html, /data-approve="run"/);
});
