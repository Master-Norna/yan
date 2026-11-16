// 测试用的最小桥接：把执事接口原样挂到一个 http 服务上，端口从 stdout 第一行报出来（PORT <n>）。
// YAN_TEST_NO_SEATBELT=1 时先让 fs.existsSync 对 /usr/bin/sandbox-exec 报「不在」，再加载 work——
// 模拟机器上没有 sandbox-exec 的环境，验问而后行按约定退回普通 shell（见 server/work/shell.js 的 MAC_SEATBELT）
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";

if (process.env.YAN_TEST_NO_SEATBELT) {
  const real = fs.existsSync;
  fs.existsSync = target => (String(target) === "/usr/bin/sandbox-exec" ? false : real(target));
}
const root = process.env.YAN_TEST_ROOT;
if (!root) throw Error("缺 YAN_TEST_ROOT");
// 宿主侧的观察点：exit 钩子到底跑没跑（信号终止不走 exit 事件时才看得出）；
// YAN_TEST_HOST_LISTENS=1 时宿主自带一个不立即退出的 SIGTERM 常驻监听，每被叫到就往 host-hits 记一笔
process.on("exit", () => {
  try {
    fs.writeFileSync(`${root}/bridge-exit-mark`, "1");
  } catch {}
});
if (process.env.YAN_TEST_HOST_LISTENS)
  process.on("SIGTERM", () => {
    try {
      fs.appendFileSync(`${root}/host-hits`, "x\n");
    } catch {}
  });
const createWork = createRequire(import.meta.url)("../../server/work/index.js");
const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
const server = http.createServer((req, res) => {
  const route = work.routes[`${req.method} ${req.url}`];
  if (!route) return res.writeHead(404).end();
  route(req, res);
});
server.listen(0, "127.0.0.1", () => console.log(`PORT ${server.address().port}`));
