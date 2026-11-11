// 开工的同一条规矩要覆盖新对话、续帮手与旁注；检查未通过时不先改记录。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => (resolve = done));
  return { promise, resolve };
};

for (const near of [true, false])
  test(`新对话：${near ? "父目录正退回时不开工、不收走输入" : "别的目录正退回仍可开工"}`, async () => {
    const started = [],
      field = { value: "继续做", style: {} };
    const f = load([
      "sendOrStop",
      "store",
      "doc: () => document",
      `setup: (field, started, near) => {
        currentId = null; store.settings.pendingWorkdir = near ? 'E:/work/sub' : 'E:/elsewhere';
        store.conversations = [{id:'A', workdir:'E:/work', messages:[], forks:[], threads:[]}]; rewinding.add('A');
        document.querySelector = () => field;
        renderSendButtons = renderAttachments = renderQuote = closeChipPop = toast = () => {};
        activeProfile = () => ({id:'p'}); quotaBlocked = () => false;
        ensureWorkReady = claimConversation = async () => true;
        startTurn = async (c, user) => started.push(user.content);
      }`
    ]);
    const query = f.doc().querySelector;
    try {
      f.setup(field, started, near);
      await f.sendOrStop();
      assert.deepEqual(started, near ? [] : ["继续做"]);
      assert.equal(field.value, near ? "继续做" : "");
      assert.equal(f.store.conversations.length, near ? 1 : 2);
    } finally {
      f.doc().querySelector = query;
    }
  });

test("续帮手认领期间开始退回：不启动，不改变中断状态", async () => {
  const gate = deferred(),
    started = [];
  const f = load([
    "resumeHelpers",
    "rewinding",
    `setup: (gate, started) => {
      const step = {id:'h',name:'delegate',status:'interrupted',sub:{id:'sub',task:'接着做',status:'interrupted',steps:[]}};
      const c = {id:'B',workdir:'E:/work/sub',messages:[{id:'a',role:'assistant',content:'',steps:[step]}],forks:[],threads:[]};
      store.conversations = [{id:'A',workdir:'E:/work',messages:[],forks:[],threads:[]},c];
      claimConversation = async () => { await gate; return true; };
      activeProfile = () => ({id:'p'}); quotaBlocked = () => false;
      launchHelper = () => started.push(true); toast = () => {};
      return {c,step};
    }`
  ]);
  const { c, step } = f.setup(gate.promise, started);
  const resuming = f.resumeHelpers(c, [step]);
  f.rewinding.add("A");
  gate.resolve();
  await resuming;
  assert.deepEqual(started, []);
  assert.equal(step.status, "interrupted");
});

test("旁注保存被认领拒绝：原问原答与编辑态都保留", async () => {
  const handlers = new Map(),
    notices = [];
  const f = load([
    "setupSidePanel",
    "store",
    "doc: () => document",
    "editing: () => editingMessageId",
    `setup: (handlers, notices) => {
      const thread = {id:'t',messages:[{id:'u',role:'user',content:'原问'},{id:'a',role:'assistant',content:'原答'}]};
      const c = {id:'c',messages:[],threads:[thread]}; store.conversations=[c]; currentId='c'; editingMessageId='u';
      const nodes = new Map();
      document.querySelector = selector => {
        if (!nodes.has(selector)) nodes.set(selector,{dataset:{},classList:{contains:()=>false},addEventListener:(event,fn)=>handlers.set(selector+':'+event,fn)});
        return nodes.get(selector);
      };
      currentThread = () => thread; sideJob = () => null;
      activeProfile = () => ({id:'p'}); quotaBlocked = () => false;
      claimConversation = async () => false; toast = text => notices.push(text);
    }`
  ]);
  const query = f.doc().querySelector;
  try {
    f.setup(handlers, notices);
    f.setupSidePanel();
    const bubble = { dataset: { message: "u" }, querySelector: () => ({ value: "改后的问" }) },
      button = { dataset: { action: "save-edit" }, closest: () => bubble };
    await handlers.get("#sideMessages:click")({ target: { closest: () => button } });
    assert.deepEqual(
      f.store.conversations[0].threads[0].messages.map(m => m.content),
      ["原问", "原答"]
    );
    assert.equal(f.editing(), "u");
    assert.match(notices[0], /另一页面/);
  } finally {
    f.doc().querySelector = query;
  }
});

test("两次旁注认领同时回来：只开一答，另一份看到刚注册的作业", async () => {
  const gate = deferred();
  const f = load([
    "withSideTurn",
    `setup: gate => {
      const thread={id:'t',messages:[]}, c={id:'c',messages:[],threads:[thread]}; store.conversations=[c];
      currentThread=()=>thread; claimConversation=async()=>{await gate;return true;};
      holdAwake=syncLeases=()=>{};
      return {c,thread};
    }`,
    "begin: () => requestJobs.set('side:t', {threadId:'t',conversationId:'c'})"
  ]);
  const { c, thread } = f.setup(gate.promise);
  let started = 0;
  const begin = () => {
    started++;
    f.begin();
  };
  const a = f.withSideTurn(c, thread, begin),
    b = f.withSideTurn(c, thread, begin);
  gate.resolve();
  await Promise.all([a, b]);
  assert.equal(started, 1);
});
