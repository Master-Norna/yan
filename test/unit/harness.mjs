// 页面代码的单元测试夹具：按桥接清单拼接源码（不执行自动启动），在 Node 里导出测试指定的函数与常量。
// window / document / localStorage 等由桩代替，可测页面逻辑和事件入口；真实浏览器的排版与交互另见 test/run.mjs。
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// 与页面同一份清单（server/build.js 的 scriptParts，含子目录），只去掉启动那段
const { scriptParts } = createRequire(import.meta.url)("../../server/build.js");
const body = scriptParts()
  .filter(file => path.basename(file) !== "99-start.js")
  .map(file => readFileSync(file, "utf8"))
  .join("\n");
// 工具说明（prompts/tools.js）里带着各工具的参数表：toolSpec 从这里取 schema，不加载的话
// 别名归位（contents → content、old_string → old）与类型理顺都不发生，断言的就不是页面真会做的事
const required = createRequire(import.meta.url);
const promptTools = readFileSync(required.resolve("../../prompts/tools.js"), "utf8");

const noop = () => {};
const media = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
const element = () => ({
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  dataset: {},
  style: { setProperty: noop, removeProperty: noop },
  addEventListener: noop,
  setAttribute: noop,
  removeAttribute: noop,
  getAttribute: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  textContent: "",
  innerHTML: ""
});
const stubs = {
  window: { YAN_PROMPTS: { tools: {} } },
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
  location: { protocol: "http:", hostname: "127.0.0.1" },
  innerWidth: 1200,
  innerHeight: 800,
  requestAnimationFrame: noop,
  cancelAnimationFrame: noop,
  indexedDB: { open: () => ({}) },
  performance: globalThis.performance,
  crypto: globalThis.crypto,
  CSS: { escape: value => String(value) },
  // 页面代码自己排的定时器（存盘的退避重试之类）不拖住测试进程：测完就退
  setTimeout: (...args) => setTimeout(...args).unref(),
  clearTimeout,
  setInterval: (...args) => setInterval(...args).unref(),
  clearInterval,
  console
};

/**
 * 取出指定名字的函数（与顶层常量）。每次调用都是一份新的闭包，测试之间互不串状态
 * @param {string[]} names
 * @returns {Record<string, any>}
 */
export function load(names) {
  const factory = new Function(...Object.keys(stubs), `"use strict";\n${promptTools}\n${body}\nreturn { ${names.join(", ")} };`);
  return factory(...Object.values(stubs));
}
