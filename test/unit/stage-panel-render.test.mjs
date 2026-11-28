import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const page = { type: "page", targetId: "main", url: "https://example.com/one", title: '甲 & "乙"' };
function stageFixture(ctx) {
  const f = load(["document", "stage", "stageRender", "stageEditUrl", "stageMessage", "work"]),
    { document } = f,
    query = document.querySelector,
    active = document.activeElement,
    nodes = new Map();
  document.querySelector = selector => {
    if (!nodes.has(selector)) {
      const classes = new Set(),
        attributes = new Map();
      nodes.set(selector, {
        writes: [],
        title: null,
        getAttribute: key => (key === "title" ? nodes.get(selector).title : (attributes.get(key) ?? null)),
        setAttribute: (key, value) => attributes.set(key, String(value)),
        classList: {
          contains: name => classes.has(name),
          add: name => classes.add(name),
          remove: name => classes.delete(name),
          toggle: (name, on) => (on ? classes.add(name) : classes.delete(name))
        },
        focus() {
          document.activeElement = this;
        },
        select() {
          this.selection = [0, this.value.length];
        },
        querySelectorAll: () => [],
        get innerHTML() {
          assert.fail("不能用浏览器重序列化的 HTML 作判据");
        },
        set innerHTML(html) {
          this.writes.push(html);
          this.child = html ? {} : null;
        }
      });
    }
    return nodes.get(selector);
  };
  ctx.after(() => {
    document.querySelector = query;
    document.activeElement = active;
  });
  f.stage.ws = {};
  f.stage.current = page.targetId;
  return {
    ...f,
    node: document.querySelector,
    update: info => f.stageMessage({ method: "Target.targetInfoChanged", params: { targetInfo: { ...page, ...info } } })
  };
}

test("游目相同标签和地址不换节点；目标地址或标签状态真变仍更新", ctx => {
  const { document, stage, stageRender, node, update } = stageFixture(ctx),
    tabs = node("#stageTabs"),
    addr = node("#stageAddr");
  update();
  assert.equal(node("#stageWorkBtn").getAttribute("aria-pressed"), "false");
  const closeButton = tabs.child,
    addrChild = addr.child;
  document.activeElement = closeButton;
  stageRender();
  update();
  assert.equal(tabs.writes.length, 1);
  assert.equal(addr.writes.length, 1);
  assert.equal(tabs.child, document.activeElement);
  assert.equal(addr.child, addrChild);

  const url = "https://example.com/two";
  stage.markTree = [{ id: "1", url }];
  node("#stageFrame").src = "frame";
  update({ url });
  assert.equal(addr.title, url);
  assert.equal(addr.child, addrChild); // 域名和可见页题未变，只有悬停的完整网址变了
  assert.equal(tabs.child, closeButton);
  assert.equal(node("#stageMarks").classList.contains("on"), true);
  assert.equal(node("#stageFrame").src, "frame");

  stage.front = page.targetId;
  stage.busy = 1;
  stageRender();
  assert.match(tabs.writes.at(-1), /stage-tab-live/);
  update({ url, title: "新题" });
  assert.match(tabs.writes.at(-1), /新题/);
  assert.match(addr.writes.at(-1), /新题/);
});

test("游目地址编辑保留输入与焦点；退出编辑、收起重开后能画最新内容", ctx => {
  const { stage, document, stageEditUrl, stageRender, node, update } = stageFixture(ctx),
    panel = node("#stagePanel"),
    tabs = node("#stageTabs"),
    addr = node("#stageAddr"),
    url = node("#stageUrl");
  update();
  stageEditUrl();
  assert.deepEqual(url.selection, [0, page.url.length]);
  url.value = "正在编辑";
  update({ title: "编辑时改题" });
  assert.equal(url.value, "正在编辑");
  assert.equal(document.activeElement, url);
  assert.equal(addr.writes.length, 1);
  assert.match(tabs.writes.at(-1), /编辑时改题/);

  document.activeElement = null;
  stageRender();
  assert.match(addr.writes.at(-1), /编辑时改题/);
  const child = tabs.child;
  panel.classList.add("hidden");
  stageRender();
  panel.classList.remove("hidden");
  stageRender();
  assert.equal(tabs.child, child);

  panel.classList.add("leaving");
  update({ title: "收起时改题" });
  assert.equal(tabs.child, child);
  panel.classList.remove("leaving");
  stageRender();
  assert.match(tabs.writes.at(-1), /收起时改题/);
  assert.match(addr.writes.at(-1), /收起时改题/);

  stage.current = "";
  stage.tabs.clear();
  stageRender();
  assert.equal(tabs.writes.at(-1), "");
  assert.equal(addr.writes.at(-1), "");
  assert.equal(addr.title, "");
  const empty = node("#stageEmpty"),
    button = empty.child;
  assert.match(empty.writes.at(-1), /data-stage-new/);
  stageRender();
  assert.equal(empty.child, button);
  stage.current = page.targetId;
  update();
  assert.equal(empty.writes.at(-1), "");
  assert.equal(empty.classList.contains("hidden"), true);
});

test("工作区与浏览器互斥，后台开页不抢工作区，切回保留页签", ctx => {
  const { stage, work, stageRender, node, update } = stageFixture(ctx);
  update();
  const addr = node("#stageAddr"),
    child = addr.child,
    tabs = node("#stageTabs");
  work.open = true;
  stageRender();
  assert.equal(node("#stageWorkBtn").getAttribute("aria-pressed"), "true");
  assert.equal(node("#stageBrowser").classList.contains("hidden"), true);
  assert.equal(node("#stageWork").classList.contains("hidden"), false);
  assert.match(tabs.writes.at(-1), /aria-selected="false"/);
  assert.equal(addr.child, child);
  update({ targetId: "new", url: "https://example.com/new" });
  assert.equal(stage.current, "new");
  assert.equal(work.open, true);
  assert.equal(node("#stageBrowser").classList.contains("hidden"), true);
  assert.equal(stage.tabs.size, 2);
  stage.ws = null;
  stageRender();
  assert.equal(node("#stageBrowser").classList.contains("hidden"), true);
  work.open = false;
  stageRender();
  assert.equal(node("#stageWorkBtn").getAttribute("aria-pressed"), "false");
  assert.equal(node("#stageBrowser").classList.contains("hidden"), false);
  assert.equal(node("#stageWork").classList.contains("hidden"), true);
  assert.match(tabs.writes.at(-1), /aria-selected="true" data-stage-tab="new"/);
});

test("工作区只展示部分目录时明示截断", ctx => {
  const { work, stageRender, node } = stageFixture(ctx);
  work.open = true;
  work.root = "/project";
  work.full = true;
  work.truncated = true;
  stageRender();
  assert.match(node("#workStrips").writes.at(-1), /目录列表已截断/);
  work.truncated = false;
  stageRender();
  assert.doesNotMatch(node("#workStrips").writes.at(-1), /目录列表已截断/);
});
