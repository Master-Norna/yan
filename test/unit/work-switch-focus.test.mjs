import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

// 页面代码在载入时会取元素；用例间换过的 document.querySelector 先还原成默认的桩。
const documentStub = load(["document"]).document,
  defaultQuery = documentStub.querySelector;
const stub = () => {
  documentStub.querySelector = defaultQuery;
};

test("搜索面折叠后再展开：未提交的输入还在，不拿旧查询重跑", () => {
  stub();
  const f = load([
    "work",
    "workSwitch",
    `setup: () => {
      const calls = [];
      work.mode = "search";
      work.collapsed = false;
      work.search = "alpha";
      const input = { value: "beta", focus: () => calls.push("focus") };
      workPaint = () => calls.push("paint");
      workResetRows = () => calls.push("reset");
      workSearch = query => calls.push("search:" + query);
      workRefresh = async () => calls.push("refresh");
      document.querySelector = selector => (selector === "#workFind input" ? input : null);
      return { calls, input };
    }`
  ]);
  const { calls, input } = f.setup();
  f.workSwitch("search");
  assert.deepEqual(calls, ["paint"]);
  f.workSwitch("search");
  assert.equal(input.value, "beta");
  assert.deepEqual(
    calls.filter(call => call.startsWith("search:")),
    []
  );
  assert.ok(calls.includes("focus"));
});

test("目录树整树重画后焦点回到原来那一行；已移到工作区之外就不抢", () => {
  stub();
  const f = load([
    "workFocusKey",
    "workRestoreFocus",
    `setup: () => {
      const row = { dataset: { workFile: "C:/w/a.md" }, focus: options => (row.focused = options) };
      const origin = document.activeElement;
      document.querySelector = () => row;
      return { row, origin };
    }`
  ]);
  const { row, origin } = f.setup();
  documentStub.activeElement = { closest: () => row };
  const key = f.workFocusKey();
  assert.deepEqual(key, { file: "C:/w/a.md" });
  documentStub.activeElement = documentStub.body;
  f.workRestoreFocus(key);
  assert.equal(row.focused.preventScroll, true);
  // 焦点已在别的按钮上（连着的元素），不抢回来
  row.focused = undefined;
  documentStub.activeElement = { isConnected: true, closest: () => null };
  f.workRestoreFocus(key);
  assert.equal(row.focused, undefined);
  documentStub.activeElement = origin;
});
