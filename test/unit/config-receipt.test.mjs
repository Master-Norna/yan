// 桥接写完回执、正文却是半截 JSON 时，界面该给人看中文，而不是把 JSON.parse 的英文原文端上来。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const tick = () => new Promise(resolve => setImmediate(resolve));

// toast 是在页面闭包里调用的，测试用全局接住它说了什么
const setupToast = `setup:()=>{
  bootstrap.store={root:'A'};store.settings.name='A';store.conversations=[];
  configSyncedAt=100;configBase=JSON.stringify(metaOf());
  writeMeta=applyAppearance=renderHeader=renderHistory=renderQuota=()=>{};
  globalThis.__yanSaid=[];
  toast=text=>{globalThis.__yanSaid.push(text);};
}`;

test("配置存盘收到 200 的坏回执：提示是中文，不冒英文原文", async () => {
  const realFetch = globalThis.fetch;
  const f = load(["saveConfigNow", setupToast, "failures:()=>configSaveFailures"]);
  globalThis.fetch = async () => new Response("{", { status: 200 });
  try {
    f.setup();
    f.saveConfigNow();
    for (let i = 0; i < 6; i++) await tick();
    const said = globalThis.__yanSaid.join(" ");
    assert.match(said, /回执读不出/);
    assert.doesNotMatch(said, /Unexpected|JSON/);
    assert.equal(f.failures(), 1, "仍按失败计、照常退避重试");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("配置存盘 200 且回执照常读得出时不报错", async () => {
  const realFetch = globalThis.fetch;
  const f = load(["saveConfigNow", setupToast, "failures:()=>configSaveFailures"]);
  globalThis.fetch = async () => new Response(JSON.stringify({ savedAt: 200 }), { status: 200 });
  try {
    f.setup();
    f.saveConfigNow();
    for (let i = 0; i < 6; i++) await tick();
    assert.deepEqual(globalThis.__yanSaid, []);
    assert.equal(f.failures(), 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
