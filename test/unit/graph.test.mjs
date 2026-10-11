// 纲：从行迹折出的结论图——成立由判词定、失效由前提与文件定、收尾的闸只对这一答动过的根负责
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { load } from "./harness.mjs";

const f = load([
  "graphOf",
  "nodeState",
  "nodeEstablished",
  "nodeVersion",
  "graphRoots",
  "rootsAbove",
  "normalizeGraphOps",
  "quietGraphOps",
  "graphText",
  "graphNote",
  "graphGate",
  "GRAPH_GATES",
  "answerParts",
  "toolDefinitions",
  "PROMPTS"
]);
{
  const win = { YAN_PROMPTS: {} };
  const req = createRequire(import.meta.url);
  for (const file of ["assistant.js", "tools.js", "graph.js", "work.js", "delegate.js"])
    new Function("window", readFileSync(req.resolve(`../../prompts/${file}`), "utf8"))(win);
  Object.assign(f.PROMPTS, win.YAN_PROMPTS);
}

let seq = 0;
const ops = (...graph) => ({ id: `g${++seq}`, name: "update_graph", arguments: "{}", status: "done", graph });
const edit = path => ({ id: `e${++seq}`, name: "edit_file", arguments: "{}", status: "done", change: { path, added: 1, removed: 0 } });
const answer = (id, steps) => ({ id, role: "assistant", content: "", timestamp: "", steps });
// 验：照此刻的图写一份判词（与 runCheck 记的同一个样子）
function check(messages, id, holds, gap = "") {
  const graph = f.graphOf(messages),
    node = graph.nodes.get(id),
    files = node.files;
  return {
    id: `c${++seq}`,
    name: "graph_check",
    arguments: "{}",
    status: "done",
    verdict: {
      node: id,
      holds,
      gap,
      version: f.nodeVersion(node),
      premises: Object.fromEntries(node.needs.map(n => [n, f.nodeVersion(graph.nodes.get(n))])),
      seen: Object.fromEntries(files.map(p => [p, graph.changes.get(p) || 0])),
      files: []
    }
  };
}
const state = (messages, id) => {
  const graph = f.graphOf(messages);
  return f.nodeState(graph, graph.nodes.get(id));
};
const established = (messages, id) => {
  const graph = f.graphOf(messages);
  return f.nodeEstablished(graph, graph.nodes.get(id));
};

test("成立只由判词定：自称成立是待验，判过成立才算；根要前提也立住", () => {
  const steps = [
    ops(
      { id: "parse", claim: "配置写错时报错带行号", check: "跑 npm test" },
      { id: "ship", claim: "可以发版", check: "测试全过", needs: ["parse"] }
    )
  ];
  const messages = [answer("a1", steps)];
  assert.equal(state(messages, "parse"), "open");
  steps.push(ops({ id: "parse", mark: "claimed" }));
  assert.equal(state(messages, "parse"), "claimed");
  steps.push(check(messages, "parse", false, "第 3 行没报"));
  assert.equal(state(messages, "parse"), "fails");
  steps.push(ops({ id: "parse", mark: "claimed" }), ops({ id: "ship", mark: "claimed" }));
  steps.push(check(messages, "parse", true));
  steps.push(check(messages, "ship", true));
  assert.equal(state(messages, "ship"), "holds");
  assert.ok(established(messages, "ship"));
});

test("前提的说法改了：前提回到未做，以它为前提的已成立转待复验，根不再立住", () => {
  const steps = [ops({ id: "a", claim: "甲", check: "看甲" }, { id: "b", claim: "乙", check: "看乙", needs: ["a"] })];
  const messages = [answer("a1", steps)];
  steps.push(ops({ id: "a", mark: "claimed" }), check(messages, "a", true));
  steps.push(ops({ id: "b", mark: "claimed" }), check(messages, "b", true));
  assert.ok(established(messages, "b"));
  steps.push(ops({ id: "a", claim: "甲（改）" }));
  assert.equal(state(messages, "a"), "open");
  assert.equal(state(messages, "b"), "stale");
  assert.ok(!established(messages, "b"));
  const graph = f.graphOf(messages);
  assert.match(f.graphText(graph), /\[待复验\] b：乙[\s\S]*前提 a 的说法改了/);
});

test("修一处坏一处：验时看过的文件后来又被改了，已成立的转待复验；验之前的改动不算", () => {
  const steps = [ops({ id: "x", claim: "解析对", check: "跑测试", files: ["src/a.js"] })];
  const messages = [answer("a1", steps)];
  steps.push(edit("src/a.js"));
  steps.push(ops({ id: "x", mark: "claimed" }), check(messages, "x", true));
  assert.equal(state(messages, "x"), "holds");
  steps.push(edit("src/b.js"));
  assert.equal(state(messages, "x"), "holds");
  steps.push(edit("src/a.js"));
  assert.equal(state(messages, "x"), "stale");
  assert.match(f.graphText(f.graphOf(messages)), /验后又改了 src\/a\.js/);
});

test("在做时改过的文件记在它名下；帮手在后台改的也算", () => {
  const steps = [ops({ id: "x", claim: "解析对", check: "跑测试", mark: "doing" })];
  const messages = [answer("a1", steps)];
  steps.push(edit("src/a.js"));
  steps.push({ id: "d1", name: "delegate", arguments: "{}", status: "done", sub: { steps: [edit("src/c.js")] } });
  steps.push(ops({ id: "x", mark: "claimed" }));
  steps.push(edit("src/z.js"));
  assert.deepEqual(f.graphOf(messages).nodes.get("x").files, ["src/a.js", "src/c.js"]);
});

test("几条路线择一（any）：一条立住即可；弃了的前提不算在内", () => {
  const steps = [
    ops(
      { id: "r1", claim: "路线一", check: "c" },
      { id: "r2", claim: "路线二", check: "c" },
      { id: "goal", claim: "目标", check: "c", needs: ["r1", "r2"], any: true }
    )
  ];
  const messages = [answer("a1", steps)];
  steps.push(ops({ id: "r1", mark: "claimed" }), check(messages, "r1", false, "走不通"));
  steps.push(ops({ id: "r1", mark: "dropped" }));
  steps.push(ops({ id: "r2", mark: "claimed" }), check(messages, "r2", true));
  steps.push(ops({ id: "goal", mark: "claimed" }), check(messages, "goal", true));
  assert.ok(established(messages, "goal"));
  assert.match(f.graphText(f.graphOf(messages)), /另有 1 项已弃/);
});

test("判词验的是旧的一版说法：不作数", () => {
  const steps = [ops({ id: "x", claim: "甲", check: "c", mark: "claimed" })];
  const messages = [answer("a1", steps)];
  const stale = check(messages, "x", true);
  steps.push(ops({ id: "x", claim: "甲二", mark: "claimed" }), stale);
  assert.equal(state(messages, "x"), "claimed");
});

test("模型交来的改动：新的一项要写全，前提要在、不成环；done 认作自称成立；有错整批不收", () => {
  const graph = f.graphOf([answer("a1", [ops({ id: "a", claim: "甲", check: "c" })])]);
  let r = f.normalizeGraphOps(graph, [{ id: "b", claim: "乙" }]);
  assert.match(r.problems.join(), /b 是新的一项/);
  r = f.normalizeGraphOps(graph, [{ id: "b", claim: "乙", check: "c", needs: ["nope"] }]);
  assert.match(r.problems.join(), /前提 nope 不存在/);
  r = f.normalizeGraphOps(graph, [
    { id: "b", claim: "乙", check: "c", needs: ["a"] },
    { id: "a", needs: ["b"] }
  ]);
  assert.match(r.problems.join(), /环/);
  r = f.normalizeGraphOps(graph, [
    { id: "a", status: "done" },
    { id: "has space", claim: "x", check: "y" }
  ]);
  assert.equal(r.ops[0].mark, "claimed");
  assert.match(r.problems.join(), /has space/);
  r = f.normalizeGraphOps(graph, [{ id: "a", status: "frobbed" }]);
  assert.match(r.problems.join(), /不认得/);
  r = f.normalizeGraphOps(graph, [
    { id: "c", claim: "丙", check: "c", needs: ["d"] },
    { id: "d", claim: "丁", check: "c" }
  ]);
  assert.deepEqual(r.problems, []);
});

test("整张重报：已成立的再标自称成立不必再验；不成立的改完再标要验", () => {
  const steps = [ops({ id: "a", claim: "甲", check: "c" }, { id: "b", claim: "乙", check: "c" })];
  const messages = [answer("a1", steps)];
  steps.push(ops({ id: "a", mark: "claimed" }, { id: "b", mark: "claimed" }));
  steps.push(check(messages, "a", true), check(messages, "b", false, "差一点"));
  const graph = f.graphOf(messages);
  const quiet = f.quietGraphOps(graph, [
    { id: "a", mark: "claimed", evidence: "同前" },
    { id: "b", mark: "claimed" }
  ]);
  assert.equal(quiet[0].mark, undefined);
  assert.equal(quiet[0].evidence, "同前");
  assert.equal(quiet[1].mark, "claimed");
});

test("每一问附着的纲：只附近几答动过、还没立住的根", () => {
  const old = answer("a1", [ops({ id: "old", claim: "旧活", check: "c" })]);
  const filler = n => [{ id: `u${n}`, role: "user", content: "别的", timestamp: "" }, answer(`f${n}`, [])];
  assert.match(f.graphNote([old]), /旧活/);
  assert.equal(f.graphNote([old, ...filler(1), ...filler(2), ...filler(3)]), "");
  const done = answer("a2", [ops({ id: "y", claim: "已了", check: "c", mark: "claimed" })]);
  done.steps.push(check([done], "y", true));
  assert.equal(f.graphNote([done]), "");
});

test("收尾的闸：没动纲的答不拦；根没立住就递缺口接着做；两回之间没新立住就放行；拦满了请它交代收尾", async () => {
  const conversation = { id: "c1", messages: [] };
  const plain = answer("a0", []);
  conversation.messages.push(plain);
  const run = assistant => f.graphGate({ conversation, assistant, signal: new AbortController().signal, profile: { id: "p" } });
  assert.equal(await run(plain), null);

  const a = answer("a1", [ops({ id: "x", claim: "解析对", check: "跑测试" }, { id: "y", claim: "文档写了", check: "看 README" })]);
  conversation.messages.push(a);
  const first = await run(a);
  assert.ok(first && !first.final);
  assert.match(first.entry.content, /收尾前查纲[\s\S]*\[未做\] x：解析对[\s\S]*验收：跑测试/);
  const gateStep = a.steps.at(-1);
  assert.equal(gateStep.name, "graph_gate");
  // 递的话记在那一步上，往后重装这一答照原处插回
  const parts = await Promise.all(f.answerParts(a).map(p => p.entry || p));
  assert.ok(parts.some(p => p.role === "user" && p.content === first.entry.content));
  // 没新立住一项：放行
  assert.equal(await run(a), null);
  // 每回都立住一项、拦满了：最后一回请它交代收尾，此后不再拦
  const b = answer("a2", [
    ops(
      { id: "p1", claim: "一", check: "c" },
      { id: "p2", claim: "二", check: "c" },
      { id: "p3", claim: "三", check: "c" },
      { id: "p4", claim: "四", check: "c" },
      { id: "top", claim: "顶", check: "c", needs: ["p1", "p2", "p3", "p4"] }
    )
  ]);
  conversation.messages.push(b);
  for (let i = 0; i < f.GRAPH_GATES; i++) {
    const g = await run(b);
    assert.ok(g && !g.final, `第 ${i + 1} 回`);
    const id = `p${i + 1}`;
    b.steps.push(ops({ id, mark: "claimed" }), check(conversation.messages, id, true));
  }
  const last = await run(b);
  assert.ok(last?.final);
  assert.match(last.entry.content, /不再调用工具/);
  assert.equal(await run(b), null);
});

test("验的人的一套工具：只读的几件、跑检验的指令与 verdict；写文件、改图、差遣都不给", () => {
  const conversation = { id: "c1", messages: [], workdir: "/tmp/x", forks: [], threads: [] };
  const names = (f.toolDefinitions(conversation, { sub: true, audit: true }) || []).map(t => t.function.name);
  for (const name of ["read_file", "run_command", "verdict"]) assert.ok(names.includes(name), name);
  for (const name of ["write_file", "edit_file", "update_graph", "delegate", "download_file"]) assert.ok(!names.includes(name), name);
  const main = (f.toolDefinitions(conversation) || []).map(t => t.function.name);
  assert.ok(main.includes("update_graph") && !main.includes("verdict") && !main.includes("update_plan"));
});
