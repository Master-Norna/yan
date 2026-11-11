import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const cases = [
  { type: "browser_ui", title: "下载", url: "edge://downloads-hub/" },
  { type: "page", title: "登录", url: "edge://sync-confirmation-dialog/" },
  { type: "worker", title: "worker", url: "https://example.com/worker.js" }
];
function fixture(info) {
  const f = load([
    "stageMessage",
    "stageRefreshTabs",
    "stage",
    `setup: info => {
      stage.tabs.clear(); stage.current = 'main'; stage.listing = true;
      stageShow = id => { stage.current = id; };
      stageRender = () => {};
      stageSend = async () => ({ targetInfos: [info] });
      stage.tabs.set('main', { title: '原页', url: 'https://example.com/' });
    }`
  ]);
  f.setup({ targetId: "bubble", ...info });
  // Edge 气泡刚出现时是普通空页，随后才补类型与地址。
  f.stageMessage({ method: "Target.targetCreated", params: { targetInfo: { targetId: "bubble", type: "page", url: "", title: "" } } });
  assert.ok(f.stage.tabs.has("bubble"));
  f.stage.current = "bubble";
  return f;
}

for (const info of cases)
  for (const via of ["event", "poll"])
    test(`游目 ${via}：空页后来识别为 ${info.type} ${info.url}，旧标签移除并选回原页`, async () => {
      const f = fixture(info);
      if (via === "event") f.stageMessage({ method: "Target.targetInfoChanged", params: { targetInfo: { targetId: "bubble", ...info } } });
      else await f.stageRefreshTabs();
      assert.equal(f.stage.tabs.has("bubble"), false);
      assert.equal(f.stage.current, "main");
    });

test("游目仍保留 browser_ui 类型的浏览器设置页", () => {
  const info = { type: "browser_ui", title: "设置", url: "edge://settings/" },
    f = fixture(info);
  f.stageMessage({ method: "Target.targetInfoChanged", params: { targetInfo: { targetId: "bubble", ...info } } });
  assert.equal(f.stage.tabs.get("bubble").url, info.url);
  assert.equal(f.stage.current, "bubble");
});
