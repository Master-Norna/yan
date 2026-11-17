// 模型卡与专司卡走同一份列表/连接流程；用真实按钮入口，桥接与 DOM 换成桩，不访问网络。
import test from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

function setup(kind, request = async () => ({ models: ["z", "a", "z"] })) {
  const endpoint = {
    id: "p1",
    name: "测试",
    on: true,
    api: "openai",
    baseUrl: "https://example.com/v1",
    apiKey: "key",
    model: "z",
    modelList: ["old"]
  };
  const selector = kind === "profile" ? '[data-profile-card="p1"]' : `[data-duty="${kind}"]`;
  const calls = [],
    events = [],
    probes = [];
  function makeCard() {
    const status = { textContent: "" };
    const buttons = (kind === "image" ? ["models"] : ["models", "test"]).map(action => ({ dataset: { dutyAction: action } }));
    const apis = ["openai", "chatgpt", "siliconflow"].map(api => ({ dataset: { dutyApi: api } }));
    const fields = ["baseUrl", "model", "apiKey"].map(field => ({
      dataset: { dutyField: field },
      addEventListener(event, listener) {
        this[event] = listener;
      }
    }));
    const head = { innerHTML: "" };
    return {
      dataset: kind === "profile" ? { profileCard: "p1" } : { duty: kind },
      status,
      buttons,
      apis,
      fields,
      addEventListener() {},
      querySelector: query => (query === ".profile-status" ? status : query === ".profile-head" ? head : null),
      querySelectorAll: query =>
        query === "[data-duty-action]" ? buttons : query === "[data-duty-api]" ? apis : query === "[data-duty-field]" ? fields : []
    };
  }
  let current = makeCard();
  const original = current;
  const replace = () => (current = makeCard());
  const f = load([
    "handleProfileAction",
    "handleEndpointAction",
    "bindDutySettings",
    "dutyFormHtml",
    `setup: (endpoint, dom, request, save, render, header, probe) => {
      store = { settings: { dutyReview: endpoint, dutyImage: endpoint }, profiles: [endpoint] };
      document = dom;
      bridge = request;
      saveStore = save;
      renderSettings = render;
      renderHeader = header;
      reportReasoningProbe = probe;
      friendlyError = text => '友好：' + text;
      saveStoreSoon = save;
    }`,
    `replaceEndpoint: (kind, endpoint) => {
      if (kind === 'profile') store.profiles = [endpoint];
      else store.settings[DUTIES[kind].key] = endpoint;
    }`
  ]);
  f.setup(
    endpoint,
    {
      querySelector: query => (query === selector ? current : null),
      querySelectorAll: query => (query === "[data-duty]" && kind !== "profile" && current ? [current] : [])
    },
    async (url, body) => {
      calls.push({ url, body });
      return request(url, body);
    },
    () => events.push("save"),
    () => {
      events.push("render");
      // 切到其他设置栏后，重画当前栏不会重新生成模型/专司卡。
      if (current) replace();
    },
    () => events.push("header"),
    (...args) => probes.push(args)
  );
  return {
    endpoint,
    calls,
    events,
    probes,
    original,
    replace,
    current: () => current,
    remove: () => (current = null),
    form: () => f.dutyFormHtml("image"),
    replaceEndpoint() {
      const fresh = { ...endpoint, modelList: [...endpoint.modelList] };
      f.replaceEndpoint(kind, fresh);
      replace();
      return fresh;
    },
    switchApi(api) {
      f.bindDutySettings();
      current.apis.find(button => button.dataset.dutyApi === api).onclick();
    },
    edit(field, value) {
      if (kind === "profile") endpoint[field] = value;
      else {
        f.bindDutySettings();
        const input = current.fields.find(input => input.dataset.dutyField === field);
        input.value = value;
        input.input({ target: input });
      }
    },
    start(action) {
      if (kind === "profile") return f.handleProfileAction(endpoint, action, current);
      f.bindDutySettings();
      return current.buttons.find(button => button.dataset.dutyAction === action).onclick();
    }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

for (const kind of ["profile", "review"]) {
  test(`${kind}：modelFound:false 解释模型不在，不再报可用或探思考档位`, async () => {
    const f = setup(kind, async () => ({ modelFound: false }));
    await f.start("test");
    assert.equal(f.current().status.textContent, "已接通，但接口的模型列表里没有 z");
    assert.deepEqual(f.calls, [
      { url: "/api/test", body: { profile: { api: "openai", baseUrl: f.endpoint.baseUrl, apiKey: "key", model: "z" } } }
    ]);
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.probes, []);
  });

  for (const result of [{ modelFound: true }, {}]) {
    test(`${kind}：连接可用（modelFound=${result.modelFound}），只有模型卡强制重探`, async () => {
      const f = setup(kind, async () => result);
      await f.start("test");
      assert.match(f.current().status.textContent, /^可用 · \d+ ms$/);
      assert.deepEqual(f.events, []);
      assert.deepEqual(f.probes, kind === "profile" ? [[f.endpoint, f.current(), true]] : []);
    });
  }

  for (const currentModel of ["z", "missing"]) {
    test(`${kind}：列表去重排序，${currentModel === "z" ? "保留当前模型" : "缺席时选首项"}，重画后回填新节点`, async () => {
      const f = setup(kind);
      f.endpoint.model = currentModel;
      await f.start("models");
      assert.deepEqual(f.endpoint.modelList, ["a", "z"]);
      assert.equal(f.endpoint.model, currentModel === "z" ? "z" : "a");
      assert.equal(f.calls[0].url, "/api/models");
      assert.equal("kind" in f.calls[0].body, false);
      assert.equal(f.original.status.textContent, "取列表中…");
      assert.notEqual(f.current(), f.original);
      assert.equal(f.current().status.textContent, "已取回 2 个模型");
      assert.deepEqual(f.events, kind === "profile" ? ["save", "render", "header"] : ["save", "render"]);
      assert.deepEqual(f.probes, kind === "profile" ? [[f.endpoint, f.current(), false]] : []);
    });
  }

  test(`${kind}：空列表报错，不覆盖原列表/模型或存盘重画`, async () => {
    const f = setup(kind, async () => ({ models: [] }));
    await f.start("models");
    assert.equal(f.current().status.textContent, "友好：接口未返回模型列表，请手动输入模型 ID");
    assert.deepEqual(f.endpoint.modelList, ["old"]);
    assert.equal(f.endpoint.model, "z");
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.probes, []);
  });

  test(`${kind}：未填地址不发列表请求，ChatGPT 仍可无地址取列表`, async () => {
    const f = setup(kind);
    f.endpoint.baseUrl = "  ";
    await f.start("models");
    assert.equal(f.current().status.textContent, "友好：请先填写 Base URL");
    assert.equal(f.calls.length, 0);
    f.endpoint.api = "chatgpt";
    await f.start("models");
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.endpoint.modelList, ["a", "z"]);
  });

  for (const action of ["models", "test"]) {
    test(`${kind}/${action}：失败经友好错误解释，写回等待期间换过的新节点`, async () => {
      const d = deferred();
      const f = setup(kind, () => d.promise);
      const pending = f.start(action);
      const fresh = f.replace();
      d.reject(Error("接口失败"));
      await pending;
      assert.equal(fresh.status.textContent, "友好：接口失败");
      assert.equal(f.original.status.textContent, action === "models" ? "取列表中…" : "接通中…");
      assert.deepEqual(f.events, []);
      assert.deepEqual(f.probes, []);
    });
  }

  test(`${kind}：测试成功也重取节点，模型卡探测拿新卡`, async () => {
    const d = deferred();
    const f = setup(kind, () => d.promise);
    const pending = f.start("test");
    const fresh = f.replace();
    d.resolve({ modelFound: true });
    await pending;
    assert.match(fresh.status.textContent, /^可用 · \d+ ms$/);
    assert.equal(f.original.status.textContent, "接通中…");
    assert.deepEqual(f.probes, kind === "profile" ? [[f.endpoint, fresh, true]] : []);
  });

  for (const fails of [false, true]) {
    test(`${kind}：请求${fails ? "失败" : "成功"}前卡片消失，不再写旧节点或探测`, async () => {
      const d = deferred();
      const f = setup(kind, () => d.promise);
      const pending = f.start("test");
      f.remove();
      if (fails) d.reject(Error("接口失败"));
      else d.resolve({ modelFound: false });
      await pending;
      assert.equal(f.original.status.textContent, "接通中…");
      assert.deepEqual(f.probes, []);
    });
  }
}

test("模型卡：列表等待期间切走设置栏，成功仍更新模型与页头，不写旧节点或探测", async () => {
  const d = deferred();
  const f = setup("profile", () => d.promise);
  f.endpoint.model = "missing";
  const pending = f.start("models");
  f.remove();
  assert.deepEqual(f.events, []);
  d.resolve({ models: ["z", "a", "z"] });
  await pending;
  assert.deepEqual(f.endpoint.modelList, ["a", "z"]);
  assert.equal(f.endpoint.model, "a");
  assert.equal(f.current(), null, "重画其他设置栏不应重新生成模型卡");
  assert.deepEqual(f.events, ["save", "render", "header"]);
  assert.equal(f.original.status.textContent, "取列表中…");
  assert.deepEqual(f.probes, []);
});

test("生图：列表仍传 kind:image，不显示测试连接，也不走文本清单的模型判定", async () => {
  const f = setup("image", async () => ({ models: ["image-z", "image-a"], modelFound: false }));
  assert.doesNotMatch(f.form(), /data-duty-action="test"/);
  await f.start("models");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/models");
  assert.equal(f.calls[0].body.kind, "image");
  assert.deepEqual(f.endpoint.modelList, ["image-a", "image-z"]);
  assert.equal(f.endpoint.model, "image-a");
  assert.equal(f.current().status.textContent, "已取回 2 个模型");
  assert.deepEqual(f.probes, []);
  assert.deepEqual(f.events, ["save", "render"]);
});

// 等待期间改配置不能把旧接口的结果写进同 selector 的新卡；整份对象被同步替换也算换了配置。
for (const kind of ["profile", "review"]) {
  for (const action of ["models", "test"]) {
    for (const change of ["api", "baseUrl", "model", "apiKey", "object"]) {
      for (const outcome of action === "models" ? ["list", "empty", "error"] : ["ok", "missing", "error"]) {
        test(`${kind}/${action}：等待期间改 ${change}，忽略迟到的 ${outcome}`, async () => {
          const d = deferred();
          const f = setup(kind, () => d.promise);
          const pending = f.start(action);
          let live = f.endpoint;
          if (change === "object") live = f.replaceEndpoint();
          else if (change === "api") {
            // 专司必须走真实 bindDutySettings 挂上的换接口按钮，不在测试里代写 api。
            if (kind === "review") f.switchApi("chatgpt");
            else {
              f.endpoint.api = "chatgpt";
              f.replace();
            }
          } else f.edit(change, "changed");
          const card = f.current();
          card.status.textContent = "当前配置";
          const oldStatus = f.original.status.textContent;
          const oldData = structuredClone(f.endpoint);
          const liveData = structuredClone(live);
          const before = [...f.events];
          assert.equal(f.calls[0].body.profile.api, "openai");
          if (outcome === "error") d.reject(Error("旧接口失败"));
          else d.resolve(action === "models" ? { models: outcome === "empty" ? [] : ["new"] } : { modelFound: outcome === "ok" });
          await pending;
          assert.deepEqual(f.endpoint, oldData, "不得修改原对象的列表或模型");
          assert.deepEqual(live, liveData, "不得修改替换后的活对象");
          assert.equal(f.current(), card, "不得被旧请求重画");
          assert.equal(card.status.textContent, "当前配置", "不得显示旧配置的成功、缺席或错误");
          assert.equal(f.original.status.textContent, oldStatus, "不得回填旧节点");
          assert.deepEqual(f.events, before, "不得额外存盘、重画或更新页头");
          assert.deepEqual(f.probes, []);
        });
      }
    }
  }
}

for (const kind of ["review", "image"]) {
  for (const sameApi of [false, true]) {
    test(`${kind}：列表等待期间点击${sameApi ? "同" : "其他"}接口按钮，${sameApi ? "仍接回结果" : "不覆盖新接口列表"}`, async () => {
      const d = deferred();
      const f = setup(kind, () => d.promise);
      f.endpoint.model = "missing";
      const pending = f.start("models");
      // 生图也走真实按钮；换到硅基流动同时改变地址。
      f.switchApi(sameApi ? "openai" : "siliconflow");
      const card = f.current();
      assert.notEqual(card, f.original);
      const before = [...f.events];
      d.resolve({ models: ["z", "a"] });
      await pending;
      assert.equal(f.endpoint.api, sameApi ? "openai" : "siliconflow");
      assert.deepEqual(f.endpoint.modelList, sameApi ? ["a", "z"] : ["old"]);
      assert.equal(f.endpoint.model, sameApi ? "a" : "missing");
      assert.equal(f.current().status.textContent, sameApi ? "已取回 2 个模型" : "");
      assert.equal(f.original.status.textContent, "取列表中…");
      assert.deepEqual(f.events, sameApi ? [...before, "save", "render"] : before);
      assert.deepEqual(f.probes, []);
      if (kind === "image") assert.equal(f.calls[0].body.kind, "image");
    });
  }
}

test("审查：测试等待期间点击同接口按钮重画，仍将缺席警告写入新卡", async () => {
  const d = deferred();
  const f = setup("review", () => d.promise);
  const pending = f.start("test");
  f.switchApi("openai");
  const card = f.current();
  d.resolve({ modelFound: false });
  await pending;
  assert.notEqual(card, f.original);
  assert.equal(card.status.textContent, "已接通，但接口的模型列表里没有 z");
  assert.equal(f.original.status.textContent, "接通中…");
  assert.deepEqual(f.events, ["save", "render"]);
  assert.deepEqual(f.probes, []);
});
