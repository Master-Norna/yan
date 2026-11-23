import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import dns from "node:dns";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { fetchPublicResponse, readLimitedBytes, assertPublicUrl } = require("../../server/web.js");
const { jsonRoute } = require("../../server/http.js");
const createPublicProxy = require("../../server/headless-proxy.js");
const listen = async server => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = server =>
  new Promise(resolve => {
    server.closeAllConnections?.();
    server.close(resolve);
  });

test("HTTP 重定向：同源保留认证，跨源不交出 Authorization 或自定义令牌", async () => {
  let received = 0;
  const other = http.createServer((req, res) => {
    received++;
    res.end("other");
  });
  const otherUrl = await listen(other);
  const first = http.createServer((req, res) => {
    if (req.url === "/same") res.end(req.headers.authorization || "none");
    else {
      res.writeHead(302, { Location: req.url === "/local" ? "/same" : otherUrl });
      res.end();
    }
  });
  const url = await listen(first);
  try {
    const { response } = await fetchPublicResponse(url + "/local", { headers: { Authorization: "Bearer own-test" }, allowLoopback: true });
    assert.equal(await response.text(), "Bearer own-test");
    for (const headers of [{ Authorization: "Bearer own-test" }, { "X-Custom-Token": "own-test" }])
      await assert.rejects(fetchPublicResponse(url + "/away", { headers, allowLoopback: true }), /跨来源跳转/);
    assert.equal(received, 0);
  } finally {
    await close(first);
    await close(other);
  }
});

test("DNS 只解析一次，真实连接保留原 Host，压缩响应与 HEAD 正常", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "text/plain" });
    res.end(gzipSync(Buffer.from(req.headers.host)));
  });
  const base = await listen(server),
    port = new URL(base).port;
  const original = dns.promises.lookup;
  let lookups = 0;
  dns.promises.lookup = async () => {
    lookups++;
    return [{ address: lookups === 1 ? "127.0.0.1" : "127.0.0.2", family: 4 }];
  };
  try {
    const { response } = await fetchPublicResponse(`http://own-test.invalid:${port}`, { allowLoopback: true });
    assert.equal(await response.text(), `own-test.invalid:${port}`);
    assert.equal(lookups, 1);
    const head = await fetchPublicResponse(base, { method: "HEAD", allowLoopback: true });
    assert.equal(await head.response.text(), "");
  } finally {
    dns.promises.lookup = original;
    await close(server);
  }
});

test("超量的响应及时取消，DNS 指向内网时在连接前拒绝", async () => {
  const server = http.createServer((req, res) => res.end("0123456789"));
  const base = await listen(server),
    original = dns.promises.lookup;
  try {
    const { response } = await fetchPublicResponse(base, { allowLoopback: true });
    const result = await readLimitedBytes(response, 4);
    assert.equal(result.buffer.toString(), "0123");
    assert.equal(result.truncated, true);
    dns.promises.lookup = async () => [{ address: "10.0.0.1", family: 4 }];
    await assert.rejects(fetchPublicResponse("http://own-test.invalid"), /内网/);
  } finally {
    dns.promises.lookup = original;
    await close(server);
  }
});

test("本机与内网按档位：不给 allowPrivate 照拒，给了才连；拒时带 private 记号", async () => {
  const server = http.createServer((req, res) => res.end("lan"));
  const base = await listen(server);
  try {
    // 私网地址字面量：不给许可照旧拒，且带着记号——页面据此交审查、准了再带 allowPrivate 重发
    await assert.rejects(
      assertPublicUrl(new URL("http://10.1.2.3/")),
      error => error.detail?.private === true && /内网/.test(error.message)
    );
    // http_request 那一路放行本机回环，但局域网仍拒
    await assert.rejects(fetchPublicResponse("http://10.1.2.3:1/", { allowLoopback: true }), error => error.detail?.private === true);
    // 回环：不给 allowPrivate（也不给 allowLoopback）时照旧拒
    await assert.rejects(fetchPublicResponse(base), /本机或内网/);
    const { response } = await fetchPublicResponse(base, { allowPrivate: true });
    assert.equal(await response.text(), "lan");
    assert.deepEqual(await assertPublicUrl(new URL(base), { allowPrivate: true }), [{ address: "127.0.0.1", family: 4 }]);
  } finally {
    await close(server);
  }
});

test("公网地址跳到内网：拦下时带 sent 与要跟的地址，首跳只发一次", async () => {
  let received = 0;
  const server = http.createServer((req, res) => {
    received++;
    res.writeHead(302, { Location: "http://u:p@192.168.7.7/next?a=1" });
    res.end();
  });
  const base = await listen(server);
  try {
    // 首跳是本机回环（allowLoopback 放行），它把请求转到局域网：第二跳在发出之前被拦
    let caught = null;
    try {
      await fetchPublicResponse(base + "/start", { method: "POST", body: "x", allowLoopback: true });
    } catch (error) {
      caught = error;
    }
    assert.equal(received, 1, "只发出首跳那一次");
    assert.equal(caught?.detail?.private, true);
    assert.equal(caught?.detail?.sent, true, "告诉页面：此前已经发出过请求，不能重放");
    assert.equal(caught?.detail?.at, "http://192.168.7.7/next?a=1", "交回要跟的地址，且剥掉 userinfo");
    // 首跳即内网：一个字节都没发出去，没有 sent——页面照旧可以送审后重发
    await assert.rejects(
      fetchPublicResponse("http://192.168.7.7/next"),
      error => error.detail?.private === true && !error.detail.sent && !error.detail.at
    );
  } finally {
    await close(server);
  }
});

test("撞上内网门禁时，接口回的 400 带 private 记号", async () => {
  const server = http.createServer((req, res) =>
    jsonRoute(async () => {
      throw Object.assign(Error("不允许访问本机或内网地址"), { detail: { private: true } });
    })(req, res)
  );
  const base = await listen(server);
  try {
    const answer = await fetch(base, { method: "POST", body: "{}" });
    assert.equal(answer.status, 400);
    assert.deepEqual(await answer.json(), { error: "不允许访问本机或内网地址", private: true });
  } finally {
    await close(server);
  }
});

test("抓取浏览器代理：HTTP 与 CONNECT 只用已验的地址；默认拒绝回环", async () => {
  const target = http.createServer((req, res) => res.end(req.headers.host));
  const targetUrl = await listen(target),
    port = new URL(targetUrl).port;
  let resolved = 0;
  const proxy = await createPublicProxy(async () => {
    resolved++;
    return [{ address: "127.0.0.1", family: 4 }];
  });
  const blocked = await createPublicProxy();
  try {
    const get = (via, url) =>
      new Promise((resolve, reject) => {
        const req = http.get(via, { path: url, headers: { Host: `own-test.invalid:${port}` } }, res => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", x => (text += x));
          res.on("end", () => resolve({ status: res.statusCode, text }));
        });
        req.on("error", reject);
      });
    assert.deepEqual(await get(proxy.url, `http://own-test.invalid:${port}/`), { status: 200, text: `own-test.invalid:${port}` });
    assert.equal((await get(blocked.url, targetUrl)).status, 403);
    const tunneled = await new Promise((resolve, reject) => {
      const socket = net.connect(Number(new URL(proxy.url).port), "127.0.0.1");
      let buffer = "",
        connected = false;
      socket.on("connect", () => socket.write(`CONNECT own-test.invalid:${port} HTTP/1.1\r\nHost: own-test.invalid:${port}\r\n\r\n`));
      socket.on("data", chunk => {
        buffer += chunk;
        if (!connected && buffer.includes("\r\n\r\n")) {
          assert.match(buffer, /200 Connection Established/);
          connected = true;
          buffer = "";
          socket.write(`GET / HTTP/1.1\r\nHost: tunnel-test\r\nConnection: close\r\n\r\n`);
        }
      });
      socket.on("error", reject);
      socket.on("close", () => resolve(buffer));
    });
    assert.match(tunneled, /tunnel-test/);
    assert.equal(resolved, 2);
  } finally {
    proxy.close();
    blocked.close();
    await close(target);
  }
});
