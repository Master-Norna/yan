// 意：任务的结论图——结构约束、传播、回归标记由数据算出；成立与否由模型自己标
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const f = load([
  "asIntent",
  "intentPath",
  "normalizeIntentOps",
  "intentRetryBatch",
  "applyIntentOps",
  "intentSealing",
  "intentState",
  "intentStaleWhy",
  "intentEstablished",
  "intentBorrowed",
  "intentRoots",
  "intentSealedAnchors",
  "parseAnchor",
  "intentUnowned",
  "intentTally",
  "intentText",
  "intentStaleIds",
  "intentRoundText",
  "intentDependents",
  "intentTops",
  "intentStrays",
  "intentLevelEdges",
  "intentClosed",
  "intentPast",
  "intentKeeps"
]);

// 照工具里的次序：理顺、取指纹、折上去。「一项不成图」另有专测，各测从一项立起只为验自己那一条
const LONE = /只有一项不必立/;
function change(intent, nodes, { prints = {}, ask = "", workdir = "" } = {}) {
  const { ops, problems } = f.normalizeIntentOps(intent, nodes, workdir);
  assert.deepEqual(
    problems.filter(p => !LONE.test(p)),
    []
  );
  const keys = f.intentSealing(intent, ops);
  const sealed = Object.fromEntries(keys.map(key => [key, prints[key] ?? `h:${key}`]));
  return f.applyIntentOps(intent, ops, { at: "t", conversation: "c1", ask, prints: sealed });
}
const problems = (intent, nodes, workdir = "") => f.normalizeIntentOps(intent, nodes, workdir).problems;
const empty = () => f.asIntent(null);
// 作答途中的眼光：这一答才立住的还不算了结（见 answerClosed）。验传播、回归的各测都从这里看
const OPEN = new Set();

test("when 从工具参数进入结论，修改条件使旧封印待复核，空串可撤去", () => {
  let intent = change(empty(), [{ id: "条件", claim: "可用", check: "验证", when: "仅生产环境" }]);
  assert.equal(intent.nodes["条件"].when, "仅生产环境");
  intent = change(intent, [{ id: "条件", state: "done" }]);
  const changed = change(intent, [{ id: "条件", when: "仅测试环境" }]);
  assert.equal(f.intentState(changed, "条件"), "stale");
  assert.match(f.intentText(changed), /情形：仅测试环境/);
  assert.equal(change(changed, [{ id: "条件", when: "" }]).nodes["条件"].when, "");
});

test("结构：新的一项要写全，前提要在、不成环；有错整批不收", () => {
  let intent = empty();
  assert.match(problems(intent, [{ id: "甲", claim: "能登录" }])[0], /claim 与 check 都要写/);
  assert.match(problems(intent, [{ id: "@ ：", claim: "x", check: "y" }])[0], /须有字母、数字或汉字/);
  assert.match(problems(intent, [{ id: "很".repeat(25), claim: "x", check: "y" }])[0], /至多 24 个汉字/);
  assert.match(problems(intent, [{ id: "甲", claim: "x", check: "y", needs: ["乙"] }])[0], /前提 乙 不存在/);
  intent = change(intent, [
    { id: "甲", claim: "能登录", check: "带对的密码登得进", needs: ["乙"] },
    { id: "乙", claim: "会话可存", check: "重启后会话还在" }
  ]);
  assert.match(problems(intent, [{ id: "乙", needs: ["甲"] }]).join(), /前提成了环：/);
  assert.match(problems(intent, [{ id: "甲", state: "finished" }])[0], /不认得/);
  // 别名照收：模型照计划卡的习惯写 complete
  assert.equal(f.normalizeIntentOps(intent, [{ id: "乙", state: "complete" }]).ops[0].state, "done");
  // 写法宽认：带空格、连字符的进度，单数的 anchor，别家正则的 (?i)
  assert.equal(f.normalizeIntentOps(intent, [{ id: "乙", state: "In Progress" }]).ops[0].state, "doing");
  assert.equal(f.normalizeIntentOps(intent, [{ id: "乙", state: "not-started" }]).ops[0].state, "open");
  assert.deepEqual(f.normalizeIntentOps(intent, [{ id: "乙", anchor: "file:a.md" }]).ops[0].anchors, ["file:a.md"]);
  const gate = f.normalizeIntentOps(intent, [
    { id: "守发布", claim: "批准前不发布", check: "发布前问过", keep: true, on: "(?i)git\\s+push" }
  ]);
  assert.deepEqual(
    gate.problems.filter(p => /正则/.test(p)),
    []
  );
  assert.equal(gate.ops[0].on, "git\\s+push");
});

test("改正：整批没收后只重给改了的项，按 id 叠到上一批上；只在上一批里的给 removed 即拿掉", () => {
  const intent = empty(),
    prior = [
      { id: "总", claim: "做完", check: "能跑", root: true },
      { id: "甲", claim: "一半", check: "半边能跑" },
      { id: "乙", claim: "另一半", check: "另半边能跑", needs: ["丙"] }
    ];
  // 上一批「甲」孤悬、「乙」的前提丙不存在；改正只给两项
  assert.ok(problems(intent, prior).length);
  const merged = f.intentRetryBatch(intent, prior, [
    { id: "总", needs: ["甲"] },
    { id: "乙", state: "removed" }
  ]);
  assert.deepEqual(
    merged.map(item => item.id),
    ["总", "甲"]
  );
  assert.equal(merged[0].claim, "做完");
  assert.deepEqual(merged[0].needs, ["甲"]);
  assert.deepEqual(problems(intent, merged), []);
  // 一项都不沾上一批的：丢下那批另改别处，原样交回
  const other = [{ id: "丁", claim: "别处", check: "别处能跑" }];
  assert.equal(f.intentRetryBatch(intent, prior, other), other);
  // 已在意里的项给 removed 是撤它，照常叠上去交给后面判
  const held = change(intent, merged);
  assert.equal(f.intentRetryBatch(held, [{ id: "甲", note: "x" }], [{ id: "甲", state: "removed" }])[0].state, "removed");
});

test("传播：标成立要前提先立住（同一批也算），事后前提退回去，上面的就不算立住；any 的一项立住即可", () => {
  let intent = change(empty(), [
    { id: "上线", claim: "可在公网访问", check: "外网打得开", needs: ["甲", "乙"], root: true },
    { id: "甲", claim: "A", check: "a" },
    { id: "乙", claim: "B", check: "b" }
  ]);
  assert.deepEqual(
    problems(intent, [
      { id: "上线", state: "done" },
      { id: "甲", state: "done" }
    ]),
    ["上线 还不能标成立：乙 没立住。前提先立住（同一批一起标即可）；这一项自己做完而前提未立的，先标 doing"]
  );
  intent = change(intent, [
    { id: "上线", state: "done" },
    { id: "甲", state: "done" },
    { id: "乙", state: "done" }
  ]);
  assert.ok(f.intentEstablished(intent, "上线"));
  assert.deepEqual(f.intentTally(intent, {}, OPEN), { live: 3, standing: 3 });
  intent = change(intent, [{ id: "乙", state: "doing" }]);
  assert.ok(!f.intentEstablished(intent, "上线"));
  assert.match(f.intentText(intent), /\[成立·前提未立\] 上线（根）/);
  intent = change(intent, [{ id: "上线", any: true }]);
  assert.ok(f.intentEstablished(intent, "上线"), "任一即可：甲立住就够");
  assert.deepEqual(problems(intent, [{ id: "上线", state: "done" }]), [], "任一即可的，重标成立也只要一项立住");
});

test("回归：标成立后凭据变了，转待复核；没变的、不知道的不算；再标成立即换一份凭据", () => {
  let intent = change(empty(), [{ id: "解析", claim: "配置写错时报错带行号", check: "跑测试", anchors: ["./src\\a.js"] }], {
    workdir: "E:\\proj"
  });
  assert.deepEqual(intent.nodes["解析"].anchors, ["file:src/a.js"]);
  intent = change(intent, [{ id: "解析", state: "done" }], { prints: { "file:src/a.js": "v1" } });
  assert.deepEqual(f.intentSealedAnchors(intent, OPEN), ["file:src/a.js"]);
  assert.equal(f.intentState(intent, "解析", { "file:src/a.js": "v1" }), "done");
  assert.equal(f.intentState(intent, "解析", {}), "done", "没取到此刻的指纹：不据它判");
  assert.equal(f.intentState(intent, "解析", { "file:src/a.js": "v2" }), "stale");
  assert.equal(f.intentState(intent, "解析", { "file:src/a.js": null }), "stale", "文件没了也算改了");
  assert.match(f.intentText(intent, { "file:src/a.js": "v2" }, { closed: OPEN }), /\[待复核\] 解析[\s\S]*缘由：凭据已变：src\/a\.js/);
  intent = change(intent, [{ id: "解析", state: "done" }], { prints: { "file:src/a.js": "v2" } });
  assert.equal(f.intentState(intent, "解析", { "file:src/a.js": "v2" }), "done");
});

test("回归：前提改了说法、后加了前提、自己改了说法，已成立的都转待复核", () => {
  let intent = change(empty(), [
    { id: "根", claim: "R", check: "r", needs: ["甲"], root: true },
    { id: "甲", claim: "A", check: "a" },
    { id: "乙", claim: "B", check: "b", root: true }
  ]);
  intent = change(intent, [
    { id: "甲", state: "done" },
    { id: "根", state: "done" }
  ]);
  assert.ok(f.intentEstablished(intent, "根"));
  const revised = change(intent, [{ id: "甲", claim: "A（改）" }]);
  assert.equal(f.intentStaleWhy(revised, "根"), "前提「甲」说法已改");
  assert.equal(f.intentStaleWhy(revised, "甲"), "说法已改");
  assert.match(revised.log.at(-1).text, /^改意 甲：A（改）/);
  const added = change(intent, [{ id: "根", needs: ["甲", "乙"] }]);
  assert.equal(f.intentStaleWhy(added, "根"), "前提「乙」为后添");
  // 弃了的前提不算在内
  const dropped = change(added, [{ id: "乙", state: "dropped" }]);
  assert.equal(f.intentStaleWhy(dropped, "根"), "");
  assert.match(dropped.log.at(-1).text, /^弃 乙/);
});

test("根：立时记下用户的原话；改说法时记下那一问、留痕，原问不动；可以在底下标假定", () => {
  let intent = change(
    empty(),
    [
      { id: "费马", claim: "证出费马大定理", check: "Lean 编过", root: true, needs: ["模性"] },
      { id: "模性", claim: "M", check: "m" }
    ],
    {
      ask: "帮我证明费马大定理"
    }
  );
  assert.equal(intent.nodes["费马"].root.ask, "帮我证明费马大定理");
  assert.deepEqual(f.intentRoots(intent), ["费马"]);
  assert.deepEqual(problems(intent, [{ id: "费马", claim: "证出 n=3 的情形" }]), [], "根的说法照用户的话改");
  const revised = change(intent, [{ id: "费马", claim: "证出 n=3 的情形" }], { ask: "先只证 n=3" });
  assert.equal(revised.nodes["费马"].root.ask, "帮我证明费马大定理", "原问不动");
  assert.equal(revised.nodes["费马"].root.later, "先只证 n=3");
  assert.equal(revised.log.at(-1).text, "改根 费马：证出 n=3 的情形");
  assert.match(f.intentText(revised), /原问：帮我证明费马大定理\n  改根时：先只证 n=3/);
  assert.equal(
    change(intent, [{ id: "费马", claim: "证出费马大定理" }], { ask: "再看" }).nodes["费马"].root.later,
    undefined,
    "照原样再报一遍不算改"
  );
  assert.match(problems(intent, [{ id: "模性", state: "assumed" }])[0], /note 里写明/);
  intent = change(intent, [
    { id: "模性", state: "assumed", note: "借 Wiles 1995 的模性定理" },
    { id: "费马", state: "done" }
  ]);
  assert.ok(f.intentEstablished(intent, "费马"));
  assert.deepEqual(f.intentBorrowed(intent, "费马"), ["模性"]);
  const text = f.intentText(intent, {}, { closed: OPEN });
  assert.match(text, /\[成立\] 费马（根）：证出费马大定理（前提：模性）（借假定：模性）/);
  assert.match(text, /\[假定\] 模性：M\n {2}出处：借 Wiles 1995 的模性定理/);
  assert.match(intent.log.at(-1).text, /^假定 模性：借 Wiles/);
});

test("给模型读的字：根在前；立住的一行，没立住的带验收，没立住的根附原话", () => {
  const intent = change(
    empty(),
    [
      { id: "上线", claim: "可在公网访问", check: "外网打得开", needs: ["部署"], root: true },
      { id: "部署", claim: "服务起在云上", check: "进程在跑" }
    ],
    { ask: "把这个项目上线" }
  );
  const text = f.intentText(intent, {}, { path: ".yan/意.json" });
  assert.equal(
    text,
    [
      "［意 .yan/意.json］已立 0 / 2",
      "- [未做] 上线（根）：可在公网访问（前提：部署）",
      "  验收：外网打得开",
      "  原问：把这个项目上线",
      "- [未做] 部署：服务起在云上",
      "  验收：进程在跑"
    ].join("\n")
  );
  assert.equal(f.intentText(empty()), "");
});

test("读到的 JSON 坏了几处：认得的照收，认不得的丢掉", () => {
  const intent = f.asIntent({
    nodes: { 好: { claim: "x", check: "y", state: "done", rev: 2 }, "坏 id": { claim: "z" }, 空: null },
    log: "x"
  });
  assert.deepEqual(Object.keys(intent.nodes), ["好"]);
  assert.deepEqual(intent.log, []);
  assert.equal(intent.nodes["好"].rev, 2);
});

test("读到空节点表、残缺凭据或坏留痕：仍能画卡片和给模型读", () => {
  assert.deepEqual(f.asIntent({ nodes: null }).nodes, {});
  const intent = f.asIntent({
    nodes: { 甲: { claim: "A", check: "a", state: "done", seal: { rev: 1 }, needs: ["constructor"] } },
    log: [null, 1, { at: "t", text: "改意" }]
  });
  assert.doesNotThrow(() => f.intentText(intent));
  assert.deepEqual(intent.nodes["甲"].needs, []);
  assert.equal(intent.log.length, 1);
});

test("节点和前提不把内置对象名当作已有的一项", () => {
  const raw = JSON.parse('{"nodes":{"__proto__":{"claim":"x","check":"y"},"constructor":{"claim":"x","check":"y"}}}');
  assert.deepEqual(Object.keys(f.asIntent(raw).nodes), []);
  for (const id of ["__proto__", "constructor", "toString"]) assert.match(problems(empty(), [{ id, claim: "x", check: "y" }]).join(), /id/);
  assert.match(problems(empty(), [{ id: "甲", claim: "x", check: "y", state: "constructor" }]).join(), /不认得/);
  assert.match(problems(empty(), [{ id: "甲", claim: "x", check: "y", needs: ["constructor"] }]).join(), /前提 constructor 不存在/);
});

test("更换、添加或撤下凭据后须复核；同一批重新标成立才用新凭据", () => {
  for (const state of ["done", "assumed"]) {
    const original = change(empty(), [{ id: "甲", claim: "A", check: "a", anchors: ["a.js"], state, note: "借外部验收" }]);
    for (const anchors of [["b.js"], ["a.js", "b.js"], []]) {
      const revised = change(original, [{ id: "甲", anchors }]);
      assert.equal(f.intentState(revised, "甲"), "stale");
      assert.equal(f.intentEstablished(revised, "甲"), false);
      assert.match(f.intentStaleWhy(revised, "甲"), /凭据已改/);
      const sealed = change(revised, [{ id: "甲", state }]);
      assert.equal(f.intentState(sealed, "甲"), state);
    }
    // 旧文件尚未记录凭据清单的也能在改动时补上旧清单。
    delete original.nodes["甲"].seal.anchors;
    assert.equal(f.intentState(change(original, [{ id: "甲", anchors: ["b.js"] }]), "甲"), "stale");
  }
  const original = change(empty(), [{ id: "甲", claim: "A", check: "a", anchors: ["a.js", "b.js"], state: "done" }]);
  assert.equal(f.intentState(change(original, [{ id: "甲", anchors: ["b.js", "a.js"] }]), "甲"), "done");
});

test("一答之内：新转待复核的接在这一轮后；同一项第 3 回才说相持，并摆出同依托一个文件、也被打回的那一项", () => {
  let intent = change(empty(), [
    { id: "登录", claim: "登录返回用户信息", check: "c", anchors: ["api/user.js"], root: true },
    { id: "隐私", claim: "不泄露手机号", check: "c", files: ["api/user.js", "api/mask.js"], root: true }
  ]);
  intent = change(
    intent,
    [
      { id: "登录", state: "done" },
      { id: "隐私", state: "done" }
    ],
    { prints: { "file:api/user.js": "v1", "file:api/mask.js": "m1" } }
  );
  const now = { "file:api/user.js": "v2", "file:api/mask.js": "m1" };
  assert.deepEqual(f.intentStaleIds(intent, now, OPEN), ["登录", "隐私"]);
  const bounces = new Map([
    ["登录", 1],
    ["隐私", 1]
  ]);
  assert.equal(
    f.intentRoundText(intent, now, ["登录", "隐私"], bounces),
    "［意］此轮之后转待复核：登录（凭据已变：api/user.js）、隐私（凭据已变：api/user.js）"
  );
  assert.equal(f.intentRoundText(intent, now, [], bounces), "");
  bounces.set("登录", 3).set("隐私", 2);
  assert.match(
    f.intentRoundText(intent, now, ["登录"], bounces),
    /\n相持：登录 本答内第 3 回转待复核；同依托 api\/user\.js 的 隐私 被打回 2 回$/
  );
});

test("凭据：裸写是文件，dir: 是目录，cmd: 是探针；盘符不算前缀，认不得的前缀当文件名；写不对的整批不收", () => {
  const key = raw => f.parseAnchor(raw, "E:\\proj");
  assert.deepEqual(key("src\\a.js"), { key: "file:src/a.js" });
  assert.deepEqual(key("E:\\proj\\src\\a.js"), { key: "file:src/a.js" });
  assert.deepEqual(key("D:\\别处\\b.js"), { key: "file:D:/别处/b.js" });
  assert.deepEqual(key("dir:src/api/"), { key: "dir:src/api" });
  assert.deepEqual(key("cmd: git rev-parse HEAD "), { key: "cmd:git rev-parse HEAD" });
  assert.deepEqual(key("foo:bar.js"), { key: "file:foo:bar.js" });
  assert.match(key("cmd:a\nb").problem, /指令只能一行/);
  assert.match(problems(empty(), [{ id: "甲", claim: "x", check: "y", anchors: ["cmd:a\nb"] }])[0], /^甲 的凭据「cmd:a/);
});

test("假定也挂凭据：所借的变了，同样转待复核，不再算立住", () => {
  let intent = change(empty(), [
    { id: "上线", claim: "可访问", check: "c", needs: ["接口"], root: true },
    { id: "接口", claim: "第三方接口 v2 可用", check: "c", anchors: ["cmd:curl -s api/version"] }
  ]);
  intent = change(
    intent,
    [
      { id: "接口", state: "assumed", note: "借第三方 v2" },
      { id: "上线", state: "done" }
    ],
    { prints: { "cmd:curl -s api/version": "v2" } }
  );
  assert.ok(f.intentEstablished(intent, "上线", { "cmd:curl -s api/version": "v2" }));
  const now = { "cmd:curl -s api/version": "v3" };
  assert.equal(f.intentState(intent, "接口", now), "stale");
  assert.equal(f.intentStaleWhy(intent, "接口", now), "凭据已变：探针「curl -s api/version」");
  assert.ok(!f.intentEstablished(intent, "上线", now));
});

test("照旧写 files 的也认作文件凭据；这一回取不到指纹的凭据不记，日后不据它判", () => {
  const { ops } = f.normalizeIntentOps(empty(), [{ id: "甲", claim: "x", check: "y", files: ["a.js"] }]);
  assert.deepEqual(ops[0].anchors, ["file:a.js"]);
  let intent = f.applyIntentOps(empty(), [{ id: "甲", claim: "x", check: "y", anchors: ["file:a.js", "cmd:npm ls"] }]);
  intent = f.applyIntentOps(intent, [{ id: "甲", state: "done" }], { prints: { "file:a.js": "1" } });
  assert.deepEqual(Object.keys(intent.nodes["甲"].seal.prints), ["file:a.js"]);
  assert.equal(f.intentState(intent, "甲", { "cmd:npm ls": "whatever" }), "done");
});

test("无主改动：改过而没有哪一项的凭据罩着的；文件、目录各自罩得住，弃了的不算，.yan 下不算", () => {
  const intent = change(empty(), [
    { id: "甲", claim: "x", check: "y", anchors: ["src/a.js", "dir:lib"] },
    { id: "乙", claim: "x", check: "y", anchors: ["docs/old.md"], state: "dropped" }
  ]);
  assert.deepEqual(f.intentUnowned(intent, ["src/a.js", "lib/deep/b.js", "libx/c.js", "docs/old.md", ".yan/账本.md", "src/a.js"]), [
    "libx/c.js",
    "docs/old.md"
  ]);
});

test("收尾前对照用的写法：立住了的根也附原话", () => {
  let intent = change(empty(), [{ id: "根", claim: "R", check: "r", root: true }], { ask: "做完这件事" });
  intent = change(intent, [{ id: "根", state: "done" }]);
  assert.ok(!f.intentText(intent, {}, { closed: OPEN }).includes("原问"));
  assert.ok(f.intentText(intent, {}, { asks: true, closed: OPEN }).endsWith("- [成立] 根（根）：R\n  原问：做完这件事"));
});

// 一个目录先后做几件事：实例见 GitHub维护，模型改写旧根、整批撤、一句「发吧」单立一根，都是因为做完的事没处放
const finished = (id, extra = {}) => [
  { id, claim: `${id}的结论`, check: "c", root: true, needs: [`${id}细项`], state: "done", ...extra },
  { id: `${id}细项`, claim: "细", check: "c", state: "done", anchors: [`${id}.txt`] }
];

test("了结：根立住那件收起——不附着，不计进度，不取指纹，改了文件也不翻回来", () => {
  const intent = change(empty(), finished("甲"), { prints: { "file:甲.txt": "v1" } });
  assert.deepEqual([...f.intentClosed(intent)].sort(), ["甲", "甲细项"]);
  assert.deepEqual(f.intentTally(intent), { live: 0, standing: 0 });
  assert.deepEqual(f.intentSealedAnchors(intent), []);
  assert.deepEqual(f.intentStaleIds(intent, { "file:甲.txt": "v2" }), []);
  assert.equal(f.intentText(intent, { "file:甲.txt": null }), "", "没有开着的事、也没有守：什么都不附");
  const guarded = change(intent, [{ id: "界限", claim: "只用本机", check: "c", keep: true }]);
  assert.equal(f.intentText(guarded), "［意 .yan/意.json］\n守（常驻的约束）：\n- 界限：只用本机", "只有守：不写 0 / 0，也不提了结的");
  assert.ok(f.intentClosed(intent).has("甲"), "了结不看指纹：与此刻的文件无关");
});

test("了结：新立的撞了了结的名字退回，免得看不见就盖了旧事；只给要改的字段的是明知而改", () => {
  const intent = change(empty(), finished("甲"));
  assert.match(problems(intent, [{ id: "甲", claim: "另一件", check: "c", root: true }]).join(), /甲 已有，是了结的一件（甲的结论）/);
  assert.deepEqual(
    problems(intent, [{ id: "甲", claim: "甲的结论", check: "c" }]).filter(p => p.includes("已有")),
    [],
    "照原样再报一遍不算撞名"
  );
  assert.deepEqual(problems(intent, [{ id: "甲", claim: "甲的结论（改）" }]), []);
});

test("了结：只数开着的——旧事不撑上限、不算「另有根」，新的在前", () => {
  let intent = empty();
  for (let i = 0; i < 20; i++)
    intent = f.applyIntentOps(intent, f.normalizeIntentOps(intent, finished(`旧${i}`)).ops, {
      at: `2026-11-${String(i + 1).padStart(2, "0")}`,
      ask: "问"
    });
  assert.equal(Object.keys(intent.nodes).length, 40);
  assert.deepEqual(
    problems(intent, [
      { id: "新事", claim: "N", check: "c", needs: ["新细项"] },
      { id: "新细项", claim: "n", check: "c" }
    ]),
    [],
    "不标根也不算孤悬；全局早过了 15 项也不拦"
  );
  assert.equal(f.intentText(intent), "");
  assert.deepEqual(f.intentPast(intent).slice(0, 2), ["旧19", "旧18"], "新的在前");
});

test("了结：旧事都了结时再单立一项退回；接着做的把它写进 needs 或根改回 doing，旧的跟着开、又比凭据", () => {
  const intent = change(empty(), finished("甲"), { prints: { "file:甲.txt": "v1" } });
  assert.match(problems(intent, [{ id: "发布", claim: "发吧", check: "c", root: true }]).join(), /只有一项不必立/);
  const next = change(intent, [{ id: "发布", claim: "发吧", check: "c", root: true, needs: ["甲"] }]);
  assert.deepEqual([...f.intentClosed(next)], [], "连着新事，整条又开了");
  assert.deepEqual(f.intentTally(next, {}), { live: 3, standing: 2 });
  assert.deepEqual(f.intentStaleIds(next, { "file:甲.txt": "v2" }), ["甲细项"], "用到才复核：文件已变的这时才报");
  assert.deepEqual(problems(intent, [{ id: "甲", state: "doing" }]), [], "根改回 doing 不算新立");
  const reopened = change(intent, [{ id: "甲", state: "doing" }]);
  assert.deepEqual([...f.intentClosed(reopened)], []);
  const single = change(empty(), [{ id: "乙", claim: "B", check: "c", state: "done", root: true }]);
  assert.deepEqual(problems(single, [{ id: "乙", state: "doing" }]), [], "只一项的旧事也改得回来");
});

test("了结：作答途中才立住的留到这一答收尾，收尾对照还要拿原问比；此刻重开的立即算开", () => {
  const before = change(empty(), [
    { id: "甲", claim: "A", check: "c", root: true, needs: ["甲细项"] },
    { id: "甲细项", claim: "a", check: "c" }
  ]);
  const marked = change(
    before,
    [
      { id: "甲细项", state: "done" },
      { id: "甲", state: "done" }
    ],
    { ask: "做甲" }
  );
  const start = f.intentClosed(before);
  assert.deepEqual([...f.intentClosed(marked, start)], [], "开工时没了结的，这一答里不收");
  assert.deepEqual(f.intentTally(marked, {}, f.intentClosed(marked, start)), { live: 2, standing: 2 });
  assert.equal(f.intentClosed(marked).size, 2, "答完再看即了结");
  const closedAtStart = f.intentClosed(marked);
  const reopened = change(marked, [{ id: "甲", state: "doing" }]);
  assert.deepEqual([...f.intentClosed(reopened, closedAtStart)], []);
});

test("了结：开着的一项落在了结的模块里，提到全局写，不漏；手编出的环不算了结", () => {
  let intent = change(empty(), [
    { id: "旧事", claim: "O", check: "c", root: true, needs: ["旧模块"] },
    { id: "旧模块", claim: "M", check: "c" },
    { id: "旧细项", claim: "k", check: "c", in: "旧模块" }
  ]);
  intent = change(intent, [
    { id: "旧细项", state: "done" },
    { id: "旧模块", state: "done" },
    { id: "旧事", state: "done" }
  ]);
  const next = change(intent, [
    { id: "新事", claim: "N", check: "c", root: true, needs: ["新一步", "旧细项"] },
    { id: "新一步", claim: "s", check: "c" }
  ]);
  const closed = f.intentClosed(next);
  assert.ok(closed.has("旧事") && closed.has("旧模块") && !closed.has("旧细项"));
  assert.match(f.intentText(next), /^- \[成立\] 旧细项：k$/m);
  const hand = f.asIntent({
    nodes: { 甲: { claim: "a", check: "c", needs: ["乙"], state: "done" }, 乙: { claim: "b", check: "c", needs: ["甲"], state: "done" } }
  });
  assert.deepEqual([...f.intentClosed(hand)], []);
});

test("了结：守写 in 就随那一件了结，不算它的细项；全局的守不了结", () => {
  let intent = change(empty(), [
    { id: "甲", claim: "A", check: "c", root: true, needs: ["甲细项"] },
    { id: "甲细项", claim: "a", check: "c" },
    { id: "这回门禁", claim: "发前先过测试", check: "c", keep: true, in: "甲" },
    { id: "总界限", claim: "只用本机", check: "c", keep: true }
  ]);
  assert.deepEqual(f.intentTops(intent, "甲"), [], "守不是甲的细项");
  assert.deepEqual(f.intentKeeps(intent), ["这回门禁", "总界限"]);
  intent = change(intent, [
    { id: "甲细项", state: "done" },
    { id: "甲", state: "done" }
  ]);
  assert.deepEqual(f.intentKeeps(intent), ["总界限"]);
  assert.ok(!f.intentText(intent).includes("发前先过测试"));
  assert.match(f.intentText(intent), /守（常驻的约束）：\n- 总界限：只用本机$/);
});

test("写入记下更新时刻；读回来照样在", () => {
  let intent = f.applyIntentOps(empty(), [{ id: "甲", claim: "x", check: "y" }], { at: "2026-10-11T08:00:00Z" });
  assert.equal(intent.updated, "2026-10-11T08:00:00Z");
  intent = f.applyIntentOps(intent, [{ id: "甲", claim: "x2" }], { at: "2026-10-11T09:00:00Z" });
  assert.equal(intent.updated, "2026-10-11T09:00:00Z");
  assert.equal(f.asIntent(JSON.parse(JSON.stringify(intent))).updated, "2026-10-11T09:00:00Z");
});

test("嵌套：模块以里面收口的几项为前提——里面立住它才算立住，里面改了说法它转待复核；根只在全局", () => {
  let intent = change(empty(), [
    { id: "成品", claim: "模型训成", check: "评测过", root: true, needs: ["训练"] },
    { id: "训练", claim: "两轮实验跑完", check: "读数入账" },
    { id: "一号", claim: "一号跑完", check: "c", in: "训练" },
    { id: "二号", claim: "二号跑完", check: "c", in: "训练", needs: ["一号"] }
  ]);
  assert.deepEqual(f.intentRoots(intent), ["成品"]);
  assert.deepEqual(f.intentTops(intent, "训练"), ["二号"]);
  assert.deepEqual(f.intentDependents(intent, "二号"), ["训练"], "收口的一项撑起所属模块");
  assert.match(problems(intent, [{ id: "训练", state: "done" }])[0], /训练 还不能标成立：二号 没立住/, "里面没立住，模块标不了成立");
  intent = change(intent, [
    { id: "一号", state: "done" },
    { id: "二号", state: "done" },
    { id: "训练", state: "done" }
  ]);
  assert.ok(f.intentEstablished(intent, "训练"));
  assert.equal(f.intentStaleWhy(change(intent, [{ id: "二号", claim: "二号改跑" }]), "训练"), "前提「二号」说法已改");
  assert.equal(
    f.intentStaleWhy(change(intent, [{ id: "三号", claim: "补一轮", check: "c", in: "训练", needs: ["二号"] }]), "训练"),
    "前提「三号」为后添"
  );
  // 模块弃了，里面的一并不算
  const gone = change(intent, [{ id: "训练", state: "dropped" }]);
  assert.equal(f.intentTally(gone).live, 1);
});

test("嵌套的规矩：所属要在、不过两层、根不归模块；前提可跨模块，以所属的模块为前提即成环；旧毛病不拦别的改动", () => {
  const intent = change(empty(), [
    { id: "甲", claim: "a", check: "c" },
    { id: "乙", claim: "b", check: "c", in: "甲" },
    { id: "丙", claim: "c", check: "c", in: "乙" }
  ]);
  assert.match(problems(intent, [{ id: "丁", claim: "d", check: "c", in: "无此" }])[0], /in「无此」不存在/);
  assert.match(problems(intent, [{ id: "丁", claim: "d", check: "c", in: "丙" }])[0], /嵌得太深/);
  assert.deepEqual(problems(intent, [{ id: "丁", claim: "d", check: "c", in: "甲", needs: ["丙"] }]), [], "前提可跨模块");
  assert.equal(
    problems(intent, [{ id: "丙", needs: ["甲"] }]).find(p => p.startsWith("前提成了环")),
    "前提成了环：甲 → 乙 → 丙 → 甲（模块以里面收口的项为前提）"
  );
  assert.match(problems(intent, [{ id: "丁", claim: "d", check: "c", in: "甲", root: true }])[0], /根在全局/);
  assert.match(problems(intent, [{ id: "甲", in: "丙" }]).join(), /所属成了环/);
  assert.deepEqual(
    problems(intent, [
      { id: "乙", in: "" },
      { id: "甲", needs: ["乙"] }
    ]),
    [],
    "挪回全局"
  );
  const many = Array.from({ length: 16 }, (_, i) => ({ id: `项${i}`, claim: "x", check: "c" }));
  assert.match(problems(empty(), many).join(), /「全局」一层多于 15 项/);
  const hand = f.asIntent({
    nodes: { 甲: { claim: "a", check: "c", needs: ["乙"] }, 乙: { claim: "b", check: "c", in: "丙" }, 丙: { claim: "c", check: "c" } }
  });
  assert.deepEqual(problems(hand, [{ id: "丙", state: "doing" }]), [], "手编出的跨层前提不拦这一批");
});

test("跨模块的前提：传播照常；画一层时提到这一层的两头（提上来的画淡），这一层之外的画作淡影", () => {
  let intent = change(empty(), [
    { id: "终局", claim: "交付", check: "c", root: true, needs: ["增算", "质量"] },
    { id: "增算", claim: "增算可用", check: "c" },
    { id: "结构候选", claim: "候选可信", check: "c", in: "增算" },
    { id: "推理对照", claim: "有基线", check: "c", in: "增算" },
    { id: "质量", claim: "质量更好", check: "c" },
    { id: "锁定收益", claim: "独立测试保有收益", check: "c", in: "质量", needs: ["结构候选"] }
  ]);
  assert.match(problems(intent, [{ id: "锁定收益", state: "done" }])[0], /锁定收益 还不能标成立：结构候选 没立住/);
  intent = change(intent, [
    { id: "结构候选", state: "done" },
    { id: "锁定收益", state: "done" }
  ]);
  assert.ok(f.intentEstablished(intent, "锁定收益"), "只依那一项，不必等整个模块");
  assert.ok(!f.intentEstablished(intent, "增算"));
  assert.deepEqual(f.intentDependents(intent, "结构候选").sort(), ["增算", "锁定收益"].sort());
  const top = f.intentLevelEdges(intent, "");
  assert.deepEqual(top.needs["质量"], ["增算"]);
  assert.deepEqual(top.soft["质量"], ["增算"]);
  assert.deepEqual(top.soft["终局"], []);
  assert.deepEqual(top.ghosts, []);
  const inside = f.intentLevelEdges(intent, "质量");
  assert.deepEqual(inside.needs["锁定收益"], ["结构候选"]);
  assert.deepEqual(inside.soft["锁定收益"], []);
  assert.deepEqual(inside.ghosts, ["结构候选"]);
  assert.deepEqual(f.intentLevelEdges(intent, "增算").ghosts, []);
});

test("给模型读的字：模块的细项缩进在它底下；里面都立住了的模块折成一行", () => {
  let intent = change(empty(), [
    { id: "成品", claim: "模型训成", check: "评测过", root: true, needs: ["训练", "数据"] },
    { id: "数据", claim: "数据备好", check: "过闸" },
    { id: "清洗", claim: "去重", check: "c", in: "数据" },
    { id: "训练", claim: "两轮跑完", check: "读数入账", needs: ["数据"] },
    { id: "一号", claim: "一号跑完", check: "看日志", in: "训练" }
  ]);
  intent = change(intent, [
    { id: "清洗", state: "done" },
    { id: "数据", state: "done" }
  ]);
  const text = f.intentText(intent);
  assert.match(text, /^- \[成立\] 数据（模块，内 1 项都已立）：数据备好$/m);
  assert.ok(!text.includes("清洗"), "立住的模块不展开");
  assert.ok(
    text.includes(
      "- [未做] 训练（模块，内已立 0 / 1）：两轮跑完（前提：数据）\n  验收：读数入账\n  - [未做] 一号：一号跑完\n    验收：看日志"
    ),
    text
  );
});

test("撤与弃：撤即整项删去、抹掉指向它的前提、留一笔痕；里面还有项的模块先撤里面的；弃的留作记号，读给模型时点到名", () => {
  let intent = change(empty(), [
    { id: "终局", claim: "交付", check: "c", root: true, needs: ["旧路", "新路"] },
    { id: "旧路", claim: "老方案", check: "c" },
    { id: "新路", claim: "新方案", check: "c" },
    { id: "细项", claim: "x", check: "c", in: "新路" }
  ]);
  assert.match(problems(intent, [{ id: "无此", state: "removed" }])[0], /无此 不存在，无可撤/);
  assert.match(problems(intent, [{ id: "新路", state: "removed" }]).join(), /撤 新路 前，里面的 细项 先撤或挪出/);
  const removed = change(intent, [{ id: "旧路", state: "removed" }]);
  assert.ok(!removed.nodes["旧路"]);
  assert.deepEqual(removed.nodes["终局"].needs, ["新路"]);
  assert.equal(removed.log.at(-1).text, "撤 旧路：老方案");
  const both = change(intent, [
    { id: "细项", state: "delete" },
    { id: "新路", state: "removed" }
  ]);
  assert.ok(!both.nodes["新路"] && !both.nodes["细项"], "同一批先撤里面的即可");
  const dropped = change(intent, [{ id: "旧路", state: "dropped", note: "算力不够" }]);
  assert.ok(dropped.nodes["旧路"], "弃的留在文件里");
  assert.match(f.intentText(dropped), /^［意 .*］已立 0 \/ 3，已弃（走过不通的）：旧路$/m);
});

test("一项不成图：新立意时只有一项要立的退回；守不算，已有的意里添一项不拦", () => {
  assert.ok(problems(empty(), [{ id: "独一", claim: "x", check: "c", root: true }]).some(p => LONE.test(p)));
  assert.deepEqual(
    problems(empty(), [
      { id: "根", claim: "R", check: "r", root: true, needs: ["甲"] },
      { id: "甲", claim: "A", check: "a" }
    ]),
    []
  );
  assert.deepEqual(problems(empty(), [{ id: "界限", claim: "只用本机", check: "c", keep: true }]), [], "只立守不算");
  const kept = change(empty(), [{ id: "界限", claim: "只用本机", check: "c", keep: true }]);
  assert.ok(
    problems(kept, [{ id: "独一", claim: "x", check: "c", root: true }]).some(p => LONE.test(p)),
    "只有守时添一项仍是一项"
  );
  const two = change(empty(), [
    { id: "根", claim: "R", check: "r", root: true, needs: ["甲"] },
    { id: "甲", claim: "A", check: "a" }
  ]);
  assert.deepEqual(problems(change(two, [{ id: "甲", state: "removed" }]), [{ id: "根", state: "doing" }]), [], "已有的意撤剩一项不拦");
});

test("补标根：当初没标的可补标，记下补标那一问、留一笔痕；已是别项前提的不能标根", () => {
  let intent = change(empty(), [
    { id: "终局", claim: "交付", check: "c", needs: ["保留"] },
    { id: "保留", claim: "能力不退", check: "c" }
  ]);
  assert.equal(intent.nodes["终局"].root, undefined);
  assert.match(problems(intent, [{ id: "保留", root: true }])[0], /保留 是 终局 的前提，不是根/);
  intent = change(intent, [{ id: "终局", root: true }], { ask: "这个才是要交的" });
  assert.equal(intent.nodes["终局"].root.ask, "这个才是要交的");
  assert.equal(intent.log.at(-1).text, "立根 终局：交付");
  assert.deepEqual(problems(intent, [{ id: "另一根", claim: "另立", check: "c" }]).length, 1, "标过根后，再添没标的仍算孤悬");
  const again = change(intent, [{ id: "终局", root: true }], { ask: "又说一遍" });
  assert.equal(again.nodes["终局"].root.ask, "这个才是要交的", "已标过的不重记");
});

test("孤悬：没声明为根、又没人以它为前提的一项（有无前提都算），这一批写到的即退回；旧有的不拦别的改动，读给模型时标出", () => {
  let intent = change(empty(), [
    { id: "终局", claim: "交付", check: "c", root: true, needs: ["保留"] },
    { id: "保留", claim: "能力不退", check: "c" }
  ]);
  assert.match(problems(intent, [{ id: "补测", claim: "跑一轮读数", check: "c" }])[0], /补测 孤悬：.*needs（可跨模块）.*keep/);
  assert.match(
    problems(intent, [{ id: "补测", claim: "跑一轮读数", check: "c", needs: ["保留"] }])[0],
    /补测 孤悬/,
    "有前提而没人依的也是又一个根"
  );
  assert.deepEqual(
    problems(intent, [
      { id: "补测", claim: "跑一轮读数", check: "c" },
      { id: "终局", needs: ["保留", "补测"] }
    ]),
    []
  );
  assert.deepEqual(problems(intent, [{ id: "补测", claim: "跑一轮读数", check: "c", in: "保留" }]), [], "挂进模块即可");
  assert.deepEqual(problems(intent, [{ id: "另一根", claim: "另立的结论", check: "c", root: true }]), [], "声明为根的不算");
  assert.deepEqual(f.intentStrays(empty()), []);
  assert.deepEqual(f.intentStrays(change(empty(), [{ id: "独一", claim: "x", check: "c" }])), [], "只它一项不算");
  // 手编、或旧版写下的孤悬：不拦别的改动，读给模型时不当根
  const hand = f.asIntent({
    nodes: { ...intent.nodes, 补测: { claim: "跑一轮读数", check: "c", state: "doing" } }
  });
  assert.deepEqual(f.intentStrays(hand), ["补测"]);
  assert.deepEqual(problems(hand, [{ id: "保留", state: "doing" }]), []);
  assert.match(f.intentText(hand), /^- \[进行中\] 补测（孤悬）：跑一轮读数$/m);
});

test("名字：空格、@ 之类照规矩改写，同一批的前提与所属一并改，回给模型时说一声；英文名可比汉字长一倍", () => {
  const {
    ops,
    problems: found,
    tidied
  } = f.normalizeIntentOps(empty(), [
    { id: "north star", claim: "R", check: "r", root: true, needs: ["A_i50@512 run"] },
    { id: "A_i50@512 run", claim: "跑一轮", check: "读数落卷" }
  ]);
  assert.deepEqual(found, []);
  assert.deepEqual(
    ops.map(op => [op.id, op.needs]),
    [
      ["north_star", ["A_i50_512_run"]],
      ["A_i50_512_run", undefined]
    ]
  );
  assert.deepEqual(tidied, [
    ["north star", "north_star"],
    ["A_i50@512 run", "A_i50_512_run"]
  ]);
  assert.deepEqual(
    problems(empty(), [{ id: "48G decoding speed-up reservation", claim: "x", check: "y", root: true }]).filter(p => !LONE.test(p)),
    []
  );
});

test("改名：前提、所属、所记的前提版本一并换，立住的照旧立住；同一批里写旧名的照新名认；新名不能撞", () => {
  let intent = change(empty(), [
    { id: "竞赛做成", claim: "R", check: "r", root: true, needs: ["卖点落地"] },
    { id: "卖点落地", claim: "S", check: "s", needs: ["三谱LDA"] },
    { id: "三谱LDA", claim: "三个语料各跑 LDA", check: "主题词表在", anchors: ["out/lda.json"] },
    { id: "细项", claim: "D", check: "d", in: "三谱LDA" }
  ]);
  intent = change(intent, [
    { id: "细项", state: "done" },
    { id: "三谱LDA", state: "done" },
    { id: "卖点落地", state: "done" }
  ]);
  assert.match(problems(intent, [{ id: "三谱LDA", rename: "卖点落地" }])[0], /这个名字已有/);
  assert.match(problems(intent, [{ id: "没有", rename: "新" }])[0], /无可改名/);
  const next = change(intent, [
    { id: "三谱LDA", rename: "两谱LDA", claim: "两个语料各跑 LDA" },
    { id: "卖点落地", needs: ["三谱LDA"] }
  ]);
  assert.deepEqual(Object.keys(next.nodes), ["竞赛做成", "卖点落地", "两谱LDA", "细项"], "次序不动");
  assert.deepEqual(next.nodes["卖点落地"].needs, ["两谱LDA"]);
  assert.equal(next.nodes["细项"].in, "两谱LDA");
  assert.deepEqual(Object.keys(next.nodes["卖点落地"].seal.premises), ["两谱LDA"]);
  assert.ok(next.log.some(entry => entry.text === "改名 三谱LDA → 两谱LDA"));
  // 只改名不改说法：立住的照旧
  const plain = change(intent, [{ id: "三谱LDA", rename: "两谱LDA" }]);
  assert.ok(f.intentEstablished(plain, "卖点落地") && f.intentEstablished(plain, "两谱LDA"));
  // 同时改了说法：它自己转待复核，上面的跟着不算立住
  assert.equal(f.intentState(next, "两谱LDA"), "stale");
  assert.ok(!f.intentEstablished(next, "卖点落地"));
});

test("降下来的根：成了别项的前提就不再算根，原问不再附；改说法记作改意", () => {
  let intent = change(empty(), [{ id: "建模达标", claim: "M", check: "m", root: true }], { ask: "把当前任务的意建立起来" });
  intent = change(intent, [{ id: "竞赛做成", claim: "R", check: "r", root: true, needs: ["建模达标"] }], { ask: "竞赛整体做成" });
  const text = f.intentText(intent, {}, { asks: true });
  assert.match(text, /原问：竞赛整体做成/);
  assert.ok(!text.includes("把当前任务的意建立起来"));
  const revised = change(intent, [{ id: "建模达标", claim: "M2" }], { ask: "改一下" });
  assert.equal(revised.log.at(-1).text, "改意 建模达标：M2");
  assert.equal(revised.nodes["建模达标"].root.later, undefined);
});

test("待定：等人拍板的一项，note 写等谁、定什么；不算立住，读给模型时写出来，墨痕记一笔", () => {
  let intent = change(empty(), [
    { id: "竞赛做成", claim: "R", check: "r", root: true, needs: ["提交规范"] },
    { id: "提交规范", claim: "合官方规范", check: "逐条对照通知" }
  ]);
  assert.match(problems(intent, [{ id: "提交规范", state: "waiting" }])[0], /标了待定，note 里写明等谁、定什么/);
  assert.equal(f.normalizeIntentOps(intent, [{ id: "提交规范", state: "blocked", note: "x" }]).ops[0].state, "waiting");
  intent = change(intent, [{ id: "提交规范", state: "waiting", note: "等官方通知：篇幅与提交渠道" }]);
  assert.equal(f.intentState(intent, "提交规范"), "waiting");
  assert.ok(!f.intentEstablished(intent, "提交规范"));
  assert.match(f.intentText(intent), /- \[待定\] 提交规范：合官方规范\n {2}待定：等官方通知：篇幅与提交渠道\n {2}验收：逐条对照通知/);
  assert.equal(intent.log.at(-1).text, "待定 提交规范：等官方通知：篇幅与提交渠道");
  assert.equal(f.asIntent(JSON.parse(JSON.stringify(intent))).nodes["提交规范"].state, "waiting", "存盘读回仍是待定");
});

test("守：一直要守的条件——不算根、不孤悬、不计进度；不挂前提、不作前提；立时记下原话，读给模型时另列一节", () => {
  let intent = change(
    empty(),
    [
      { id: "上线", claim: "博客打得开", check: "首页 200", root: true },
      { id: "测过", claim: "改完测试要过", check: "npm test 退出码 0", anchors: ["test:npm test"], keep: true, state: "done" }
    ],
    { ask: "往后收尾前都跑测试", prints: { "test:npm test": "过" } }
  );
  assert.equal(intent.nodes["测过"].keep, true);
  assert.equal(intent.nodes["测过"].root.ask, "往后收尾前都跑测试");
  assert.deepEqual(f.intentRoots(intent), ["上线"]);
  assert.deepEqual(f.intentStrays(intent), []);
  assert.deepEqual(f.intentTally(intent, {}), { live: 1, standing: 0 });
  assert.equal(f.intentState(intent, "测过", { "test:npm test": "不过" }), "stale");
  const text = f.intentText(intent, { "test:npm test": "不过" });
  assert.match(text, /已立 0 \/ 1/);
  assert.match(text, /守（常驻的约束）：\n- \[待复核\] 测过：改完测试要过\n  验收：npm test 退出码 0\n  缘由：测试「npm test」不过/);
  assert.ok(!/- \[[^\]]+\] 测过（/.test(text), "守不当根或孤悬写进目标那几行");
  // 守着时没有态：只一行说法
  assert.match(f.intentText(intent, { "test:npm test": "过" }), /守（常驻的约束）：\n- 测过：改完测试要过$/);
  assert.ok(
    problems(intent, [{ id: "部署", claim: "推上去", check: "跑起来", needs: ["测过"] }]).some(p => p.includes("是守：守不作前提"))
  );
  assert.ok(problems(intent, [{ id: "测过", needs: ["上线"] }]).some(p => p.includes("是守，不挂前提")));
  // 守没有进度可标：不给 state 也即作数、记下凭据；顺手带的别的态照作数，只有弃说清该撤
  const kept = change(empty(), [{ id: "界限", claim: "只用本机", check: "无外部算力", keep: true, state: "open" }]);
  assert.equal(kept.nodes["界限"].state, "done");
  assert.ok(kept.nodes["界限"].seal);
  assert.equal(change(kept, [{ id: "界限", state: "doing" }]).nodes["界限"].state, "done");
  assert.ok(problems(kept, [{ id: "界限", state: "dropped" }]).some(p => p.includes("是守，不守了 state 给 removed")));
  // 记下时测试就不过的照样算不过：重写一回守抹不平
  const failing = change(empty(), [{ id: "测", claim: "测试要过", check: "退出码 0", anchors: ["test:npm test"], keep: true }], {
    prints: { "test:npm test": "不过" }
  });
  assert.equal(f.intentState(failing, "测", { "test:npm test": "不过" }), "stale");
  // 撤去守的身份即回到目标那一套
  intent = change(intent, [{ id: "测过", keep: false, needs: [] }]);
  assert.equal(intent.nodes["测过"].keep, undefined);
});
