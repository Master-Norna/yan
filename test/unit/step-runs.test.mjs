// 行迹里连着的同类只读步骤并成一行（设计稿/85 甲）：三步起才并；改、写、运行不并；没做完、失败、带改动的不并，也把一串隔开
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { stepRuns } = load(["stepRuns"]);
const step = (id, name, extra = {}) => ({ id, name, status: "done", ...extra });
const shape = items => items.map(item => (Array.isArray(item) ? item.map(s => s.id).join("+") : item.id)).join(" ");

test("连着三步起的同类只读并成一串，不到三步的照旧一行一件", () => {
  const steps = [
    step("l", "list_files"),
    step("r1", "read_file"),
    step("r2", "read_file"),
    step("r3", "read_file"),
    step("g1", "search_files"),
    step("g2", "search_files"),
    step("r4", "read_file"),
    step("e", "edit_file", { change: { path: "a" } })
  ];
  assert.equal(shape(stepRuns(steps)), "l r1+r2+r3 g1 g2 r4 e");
});

test("正在做、失败的那一步不并，把一串截开；改、写、运行再多也一行一件", () => {
  const steps = [
    step("r1", "read_file"),
    step("r2", "read_file"),
    step("r3", "read_file", { status: "error" }),
    step("r4", "read_file"),
    step("r5", "read_file"),
    step("r6", "read_file"),
    step("r7", "read_file", { status: "running" }),
    step("c1", "run_command"),
    step("c2", "run_command"),
    step("c3", "run_command")
  ];
  assert.equal(shape(stepRuns(steps)), "r1 r2 r3 r4+r5+r6 r7 c1 c2 c3");
});

test("同一件工具标作别的（翻技能与翻文档）不混在一串里", () => {
  const steps = [
    step("d1", "read_document"),
    step("d2", "read_document"),
    step("d3", "read_document"),
    step("k1", "read_document", { label: "技能" }),
    step("k2", "read_document", { label: "技能" }),
    step("k3", "read_document", { label: "技能" })
  ];
  assert.equal(shape(stepRuns(steps)), "d1+d2+d3 k1+k2+k3");
});

// 常见操作即使同色也有不同的小画；未知工具保留安全的文字回退。
test("行迹动作图标按工具名区分，标签保留并转义", () => {
  const { trailLabelHtml } = load(["trailLabelHtml"]);
  const run = trailLabelHtml("run_command", "运行");
  const write = trailLabelHtml("write_file", "写入");
  const edit = trailLabelHtml("edit_file", "修改");
  const icon = html => html.match(/<svg[^>]*>.*?<\/svg>/)?.[0];
  for (const html of [run, write, edit]) {
    assert.match(html, /trail-kind-icon/);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /trail-kind-text/);
    assert.ok(icon(html));
  }
  assert.equal(new Set([run, write, edit].map(icon)).size, 3);
  const unknown = trailLabelHtml("unknown", "<外部>");
  assert.doesNotMatch(unknown, /<svg/);
  assert.match(unknown, /&lt;外部&gt;/);
});

test("请示、撮要、图、MCP、计划各有一枚不同的小画，专用卡片实际使用它们", () => {
  const { trailLabelHtml, askStepHtml, foldStepHtml, intentStepHtml, planStepHtml } = load([
    "trailLabelHtml",
    "askStepHtml",
    "foldStepHtml",
    "intentStepHtml",
    "planStepHtml"
  ]);
  const icon = html => html.match(/<svg[^>]*class="brush trail-kind-icon"[^>]*>.+?<\/svg>/)?.[0];
  const example = { id: "s", title: "检查", status: "done" };
  const symbols = [
    icon(askStepHtml(example)),
    icon(foldStepHtml(example)),
    icon(intentStepHtml(example, "update_intent")),
    icon(trailLabelHtml("mcp_call", "MCP")),
    icon(planStepHtml(example))
  ];
  assert.ok(symbols.every(Boolean));
  assert.equal(new Set(symbols).size, 5);
  for (const name of ["mcp_describe", "mcp_config", "mcp__github__search"]) {
    assert.equal(icon(trailLabelHtml(name, "GitHub")), symbols[3]);
  }
  assert.equal(icon(intentStepHtml(example, "intent_gate")), symbols[2]);
});
