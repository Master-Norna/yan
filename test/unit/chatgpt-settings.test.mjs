// 走真实登录、换接口与取列表流程；授权与轮询由测试推进，不打开浏览器、不联网。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const authUrl = "https://example.com/authorize";
const loggedIn = { signedIn: true, email: "account@example.com", pending: false, error: "" };
const failed = { signedIn: false, email: "", pending: false, error: "授权被拒" };

function setup(kind) {
  const profile = kind === "profile",
    selector = profile ? '[data-profile-card="p1"]' : '[data-duty="review"]',
    endpoint = {
      ...(profile ? { id: "p1", name: "测试" } : { on: true }),
      api: "chatgpt",
      baseUrl: "",
      apiKey: "",
      model: "mine",
      modelList: ["old"]
    },
    opening = Promise.withResolvers(),
    poll = Promise.withResolvers(),
    listed = [];
  let live = endpoint,
    account = { signedIn: false, email: "", pending: false, error: "" },
    card,
    listing;

  function accountRow(card) {
    const row = { outerHTML: "" };
    return {
      row,
      marker: { closest: () => row },
      button: { dataset: { chatgptAction: "login" }, closest: () => card }
    };
  }
  // 另一张 ChatGPT 卡的账号行也应刷新，即使发起授权的卡已经换了配置。
  const other = accountRow(null);
  const rows = () => (card?.account ? [card.account, other] : [other]);
  const f = load([
    "bindModelSettings",
    "bindDutySettings",
    "bindChatgptButtons",
    `setup: (endpoint, dom, request, render, timer) => {
      store = { settings: { dutyReview: endpoint }, profiles: [endpoint] };
      bootstrap = { store: { root: 'original' } };
      document = dom;
      bridge = request;
      renderSettings = render;
      setTimeout = timer;
      bindUsageCard = saveStore = saveStoreSoon = renderHeader = reportReasoningProbe = () => {};
    }`,
    `replace: (profile, endpoint) => {
      if (profile) store.profiles = [endpoint];
      else store.settings.dutyReview = endpoint;
    }`,
    `move: () => { bootstrap.store = { root: 'other' }; }`
  ]);
  f.setup(
    endpoint,
    {
      querySelector: key => (key === selector ? card : null),
      querySelectorAll: key => {
        if (key === "[data-chatgpt-account]") return rows().map(item => item.marker);
        if (key === "[data-chatgpt-action]") return rows().map(item => item.button);
        return key === (profile ? "[data-profile-card]" : "[data-duty]") ? [card] : [];
      }
    },
    async (url, body) => {
      if (url === "/api/chatgpt/login") {
        account = { ...account, pending: true };
        return opening.promise;
      }
      if (url === "/api/chatgpt/status") return account;
      assert.equal(url, "/api/models");
      listed.push(body.profile);
      return { models: ["fetched"] };
    },
    redraw,
    run => poll.resolve(run)
  );

  function redraw() {
    const status = { innerHTML: "", textContent: "" },
      list = {
        dataset: profile ? { profileAction: "models" } : { dutyAction: "models" },
        click() {
          listing = this.onclick();
        }
      },
      fields = ["model", "baseUrl"].map(field => ({
        dataset: profile ? { field } : { dutyField: field },
        addEventListener(key, listener) {
          if (key === "input") this.input = listener;
        }
      })),
      toOpenai = { dataset: profile ? { choiceField: "api", value: "openai" } : { dutyApi: "openai" } },
      queries = {
        ".profile-status": status,
        ".profile-gist": {},
        ".profile-head": {},
        "[data-quota-amount]": { addEventListener() {} },
        "[data-quota-unit]": { addEventListener() {} }
      };
    card = {
      dataset: profile ? { profileCard: "p1" } : { duty: "review" },
      status,
      fields,
      toOpenai,
      addEventListener() {},
      querySelector: key => (key === '[data-profile-action="models"], [data-duty-action="models"]' ? list : (queries[key] ?? null)),
      querySelectorAll: key =>
        ({
          "[data-field]": fields,
          "[data-duty-field]": fields,
          "[data-profile-action]": [list],
          "[data-duty-action]": [list],
          "[data-choice-field]": [toOpenai],
          "[data-duty-api]": [toOpenai]
        })[key] ?? []
    };
    if (live.api === "chatgpt") card.account = accountRow(card);
    (profile ? f.bindModelSettings : f.bindDutySettings)();
    f.bindChatgptButtons();
    return card;
  }
  redraw();
  // 定向测试由账号状态刷新绑按钮，不另发开栏时那次探活。
  // 实际点击、切换接口、编辑模型和取列表仍走生产监听。
  return {
    listed,
    endpoint,
    other,
    opening,
    redraw,
    current: () => card,
    start: () => card.account.button.onclick(),
    edit(field, value) {
      const input = card.fields.find(input => (input.dataset.field || input.dataset.dutyField) === field);
      input.value = value;
      input.input({ target: input });
    },
    replace(fields, repaint = true) {
      live = { ...live, ...fields };
      f.replace(profile, live);
      if (repaint) redraw();
      return live;
    },
    move: f.move,
    async open() {
      opening.resolve({ url: authUrl });
      await poll.promise;
    },
    async finish(pending, result = loggedIn) {
      account = result;
      (await poll.promise)();
      await pending;
      await listing;
    }
  };
}

for (const kind of ["profile", "review"]) {
  test(`${kind}：登录等候期间换接口并填写新模型，不替新接口取列表，其他卡照样更新账号`, async () => {
    const f = setup(kind);
    const pending = f.start();
    await f.open();
    f.current().toOpenai.onclick();
    f.edit("baseUrl", "https://example.com/v1");
    f.edit("model", "user-model");
    await f.finish(pending);
    assert.equal(f.endpoint.api, "openai");
    assert.deepEqual(
      { requests: f.listed, model: f.endpoint.model, list: f.endpoint.modelList },
      { requests: [], model: "user-model", list: ["old"] }
    );
    assert.equal(f.current().status.textContent, "");
    assert.match(f.other.row.outerHTML, /已登录 · account@example\.com/);
  });

  test(`${kind}：同一配置只重画，授权链接和取列表交给当前卡`, async () => {
    const f = setup(kind);
    const old = f.current();
    const pending = f.start();
    const fresh = f.redraw();
    await f.open();
    assert.match(fresh.status.innerHTML, /https:\/\/example\.com\/authorize/);
    assert.equal(old.status.innerHTML, "");
    f.redraw();
    await f.finish(pending);
    assert.deepEqual(f.listed, [{ api: "chatgpt", baseUrl: "", apiKey: "", model: "mine" }]);
    assert.equal(f.endpoint.model, "fetched");
    assert.equal(f.current().status.textContent, "已取回 1 个模型");
    assert.match(f.other.row.outerHTML, /已登录 · account@example\.com/);
  });

  test(`${kind}：同 ID、同字段值但活对象已换，授权成功不接续取列表`, async () => {
    const f = setup(kind);
    const pending = f.start();
    await f.open();
    const live = f.replace();
    await f.finish(pending);
    assert.deepEqual(f.listed, []);
    assert.equal(live.model, "mine");
    assert.equal(f.endpoint.model, "mine");
    assert.match(f.current().account.row.outerHTML, /已登录 · account@example\.com/);
  });
}

test("点登录前活对象已换但卡还没重画，续取列表只用发起时的活对象", async () => {
  const f = setup("profile");
  const live = f.replace({ model: "live-model" }, false);
  const pending = f.start();
  await f.open();
  await f.finish(pending);
  assert.deepEqual(
    f.listed.map(profile => profile.model),
    ["live-model"]
  );
  assert.equal(live.model, "fetched");
  assert.equal(f.endpoint.model, "mine");
});

test("授权等待期间原地修改 ChatGPT 模型 ID，成功登录不覆盖手填值", async () => {
  const f = setup("profile");
  const pending = f.start();
  await f.open();
  f.edit("model", "handwritten");
  await f.finish(pending);
  assert.deepEqual(f.listed, []);
  assert.equal(f.endpoint.model, "handwritten");
});

test("配置未换对象但存储根已换，旧授权不触发新处取列表", async () => {
  const f = setup("profile");
  const pending = f.start();
  await f.open();
  f.move();
  await f.finish(pending);
  assert.deepEqual(f.listed, []);
});

test("尚未返回手动授权链接就换了接口，链接和迟到的授权错误都不写到卡上", async () => {
  const f = setup("review");
  const old = f.current();
  const pending = f.start();
  f.current().toOpenai.onclick();
  await f.open();
  await f.finish(pending, failed);
  assert.equal(old.status.innerHTML, "");
  assert.equal(f.current().status.innerHTML, "");
  assert.equal(f.current().status.textContent, "");
  assert.match(f.other.row.outerHTML, /未登录/);
});

test("配置未变、只重画，授权失败原因仍回填到现卡", async () => {
  const f = setup("review");
  const pending = f.start();
  await f.open();
  const fresh = f.redraw();
  await f.finish(pending, failed);
  assert.equal(fresh.status.textContent, "授权被拒");
  assert.deepEqual(f.listed, []);
});
