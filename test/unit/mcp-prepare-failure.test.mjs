// 补不上接法的那个服务（游目，见 server/stage.js 的 prepareBrowser）只该让那一张卡报错：
// 从前 prepare 是同步抛的，一抛就把整个 /api/mcp/list 带塌，别的服务也一并不见
import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const createMcp = require("../../server/mcp/index.js");

/** 走一遍桥接路由：真的 http 请求体、假的 res @param {(req: any, res: any) => any} handler */
function post(handler, body) {
  const req = new PassThrough(),
    res = {
      destroyed: false,
      writableEnded: false,
      headersSent: false,
      status: 0,
      payload: "",
      writeHead(status) {
        this.status = status;
        this.headersSent = true;
      },
      setHeader() {},
      end(text) {
        this.payload += text ?? "";
        this.writableEnded = true;
        this.onDone?.();
      },
      once() {},
      on() {},
      write() {}
    },
    done = new Promise(resolve => (res.onDone = resolve));
  void handler(req, res);
  req.end(JSON.stringify(body));
  return done.then(() => ({ status: res.status, json: JSON.parse(res.payload || "null") }));
}

test("补不上接法的服务只让那一张卡报错，整张服务列表照常交回", async () => {
  const { routes } = createMcp({
    version: "test",
    toolEnv: {},
    prepare: config => {
      if (config?.boom) throw Error("游目的浏览器接法写不进 D:\\x（磁盘已满）");
      return config;
    }
  });
  const { status, json } = await post(routes["POST /api/mcp/list"], { servers: { 游目: { command: "x", boom: true } } });
  assert.equal(status, 200, "整表不该跟着失败");
  assert.equal(json.servers.游目.ok, false);
  assert.match(json.servers.游目.error, /接法写不进/);
});
