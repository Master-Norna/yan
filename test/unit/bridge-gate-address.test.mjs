// 等候桥接那一页写的地址：桥接开的页面就在桥接自己的地址上，换了 YAN_PORT 也写得对；别处打开的不知道端口，留 index.html 里的默认地址
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const DEFAULT = "index.html 里写的默认地址";

async function gateText(where) {
  const f = load(["awaitBridge", "location", "document"]);
  Object.assign(f.location, where);
  const el = { textContent: DEFAULT };
  // 桩是各次 load 共用的，下一次 load 的顶层代码还要用原来那只
  const query = f.document.querySelector,
    fetched = globalThis.fetch;
  f.document.querySelector = () => el;
  globalThis.fetch = async () => {
    throw Error("桥接没开");
  };
  try {
    // 接不上就一直等下去（定时器不拖住测试进程），这里只看头一回写了什么
    void f.awaitBridge();
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    globalThis.fetch = fetched;
    f.document.querySelector = query;
  }
  return el.textContent;
}

test("桥接开的页面：等候页写它自己的地址，端口跟着 YAN_PORT", async () => {
  assert.equal(await gateText({ protocol: "http:", hostname: "127.0.0.1", origin: "http://127.0.0.1:8801" }), "http://127.0.0.1:8801");
});

test("文件打开的页面：不知道端口，留默认地址", async () => {
  assert.equal(await gateText({ protocol: "file:", hostname: "", origin: "null" }), DEFAULT);
});
