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

function pendingFixture(t, extra = {}) {
  const f = load([
    "TOOLS",
    "document",
    "pendingApprovals",
    "renderApprovalBar",
    "registerMcpTools",
    "approveByEnter",
    "approveFrom",
    "bindApprovalEvents",
    "setup: c => { currentConversation = () => c; saveStore = () => {}; renderWorkAuto = () => {}; stageSync = () => {}; }"
  ]);
  const bar = f.document.querySelector("#approvalBar"),
    policyButton = f.document.querySelector("#workAuto"),
    conversation = { id: "c1", commandPolicy: "ask" },
    step = { id: "s1", name: "mcp__demo__write", status: "pending", ...extra },
    answers = [],
    entry = {
      conversationId: conversation.id,
      step,
      resolve(value) {
        answers.push(value);
        f.pendingApprovals.delete(step.id);
      }
    },
    tool = { mcp: true, approval: () => '<button data-approve="run">运行</button><button data-approve="auto">径行</button>' };
  t.mock.method(f.document, "querySelector", selector => (selector === "#approvalBar" ? bar : policyButton));
  f.setup(conversation);
  if (!step.gate) f.TOOLS.set(step.name, tool);
  f.pendingApprovals.set(step.id, entry);
  f.bindApprovalEvents();
  const click = approve => f.approveFrom({ dataset: { approve }, closest: () => ({ dataset: { stepId: step.id } }) });
  return { f, bar, policyButton, conversation, step, entry, answers, tool, click };
}

test("已显示的请示随注册表变化重画，同一步仍可在工具回来后批准", t => {
  const { f, bar, step, entry, answers, tool } = pendingFixture(t);
  f.renderApprovalBar();
  assert.match(bar.innerHTML, /data-approve="run"/);
  f.registerMcpTools();
  assert.equal(bar.dataset.stepId, step.id);
  assert.match(bar.innerHTML, /data-approve="skip"/);
  assert.doesNotMatch(bar.innerHTML, /data-approve="(?:run|auto)"|Enter/);
  assert.deepEqual(answers, []);

  f.TOOLS.set(step.name, tool);
  f.renderApprovalBar();
  assert.match(bar.innerHTML, /data-approve="run"/);
  f.approveByEnter(entry);
  assert.deepEqual(answers, [true]);
});

test("工具已摘掉：Enter、旧按钮和切宽档位都不批准，显式跳过才结清", t => {
  const { f, step, entry, conversation, policyButton, answers, click } = pendingFixture(t);
  f.TOOLS.delete(step.name);
  f.approveByEnter(entry);
  assert.deepEqual(answers, [], "Enter 不批准");
  click("run");
  assert.deepEqual(answers, [], "旧运行按钮不批准");
  click("auto");
  assert.deepEqual(answers, [], "旧径行按钮不批准");
  assert.equal(conversation.commandPolicy, "ask", "失效按钮也不改档位");

  policyButton.onclick();
  assert.equal(conversation.commandPolicy, "review", "档位按钮仍正常切档");
  assert.deepEqual(answers, [], "切档不批准失效工具");
  assert.equal(f.pendingApprovals.get(step.id), entry);
  click("skip");
  assert.deepEqual(answers, [false]);
  assert.equal(f.pendingApprovals.size, 0);
});

test("守的关口不随切档放行，仍可用 Enter 明批准许", t => {
  const { f, step, entry, policyButton, answers } = pendingFixture(t, { gate: { id: "守一", claim: "先问", target: "demo" } });
  assert.equal(f.TOOLS.has(step.name), false);
  policyButton.onclick();
  assert.deepEqual(answers, []);
  f.approveByEnter(entry);
  assert.deepEqual(answers, [true]);
});
