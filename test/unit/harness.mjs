// 纯函数的单元测试用：把 src/*.js（除启动那段）拼进一个函数里，在 Node 里跑起来，把要测的函数交出来。
// 页面的源码是无模块的普通脚本，靠拼接共享一个闭包，所以这里也照原样拼——只是把 window / document / localStorage
// 这些顶层会碰到的东西换成够用的桩。DOM 相关的函数不在这里测，那是 e2e 的事（见 test/run.mjs）
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// 与页面同一份清单（build.js 的 scriptParts，含子目录），只去掉启动那段
const { scriptParts } = createRequire(import.meta.url)("../../build.js");
const body = scriptParts()
  .filter(file => path.basename(file) !== "99-start.js")
  .map(file => readFileSync(file, "utf8"))
  .join("\n");

const noop = () => {};
const media = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
const element = () => ({
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  dataset: {},
  style: { setProperty: noop, removeProperty: noop },
  addEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  textContent: "",
  innerHTML: ""
});
const stubs = {
  window: { YAN_PROMPTS: {} },
  document: {
    documentElement: element(),
    body: element(),
    querySelector: () => element(),
    querySelectorAll: () => [],
    addEventListener: noop,
    createElement: element,
    hidden: false
  },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  matchMedia: media,
  navigator: { onLine: true },
  innerWidth: 1200,
  innerHeight: 800,
  requestAnimationFrame: noop,
  cancelAnimationFrame: noop,
  indexedDB: { open: () => ({}) },
  performance: globalThis.performance,
  crypto: globalThis.crypto,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  console
};

/**
 * 取出指定名字的函数（与顶层常量）。每次调用都是一份新的闭包，测试之间互不串状态
 * @param {string[]} names
 * @returns {Record<string, any>}
 */
export function load(names) {
  const factory = new Function(...Object.keys(stubs), `"use strict";\n${body}\nreturn { ${names.join(", ")} };`);
  return factory(...Object.values(stubs));
}
