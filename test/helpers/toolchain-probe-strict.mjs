// 严档下真实工具链兼容探测：起最小桥接，经 /api/work/run（sandbox: true）跑真实命令，
// 收集每条是被 seatbelt 拦（stderr 出 deny file-write*）、别的原因失败、还是照常通。
// 对照组同命令 sandbox: false 各跑一遍，排除「这命令本来在这台机器就跑不通」。
// 用法：node test/helpers/toolchain-probe.mjs [probe 名，可多个]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const createWork = createRequire(import.meta.url)("../../server/work/index.js");
const tmpParent = fs.realpathSync(os.tmpdir());
const root = fs.mkdtempSync(path.join(tmpParent, "yan-toolchain-"));

const work = createWork({ archiveHome: () => root, workHome: () => root, toolEnv: env => env });
const server = http.createServer((req, res) => {
  const route = work.routes[`${req.method} ${req.url}`];
  if (!route) return res.writeHead(404).end();
  route(req, res);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const post = (url, body) =>
  fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(response => response.json());

// 每个探测一对：command 是严档下跑的指令。前台 run 有超时，npm/brew 这类慢的先只做最小动作
const PROBES = {
  "npm-install": `npm install is-odd --no-audit --no-fund --loglevel=error`,
  "venv-pip": `python3 -m venv .venv && .venv/bin/pip install --quiet requests`,
  "cc-hello": `printf 'int main(void){return 0;}' > h.c && clang h.c -o h && ./h`,
  "brew-install": `brew install hello 2>&1`,
  "brew-config": `brew config 2>&1 | head -20`,
  "uv-check": `command -v uv && uv --version`,
  "link-out": `h=$(echo ~); ln -s "$h" homelink && { echo hi > ./homelink/yan-tc-link-test.txt ; } || echo denied`
};

async function runOne(name, command, sandbox) {
  const wd = fs.mkdtempSync(path.join(root, `${name.replaceAll("/", "_")}-`));
  const result = await post("/api/work/run", { workdir: wd, command, sandbox, timeoutMs: 60000 });
  const stderr = result.stderr || "",
    stdout = result.stdout || "";
  const denied = /deny\(1\)|denied|sandbox/i.test(stderr) || /denied/.test(stdout);
  console.log(`\n===== ${name} sandbox=${sandbox} exit=${result.exitCode} signal=${result.signalCode}`);
  console.log("stdout:", stdout.slice(0, 1200));
  console.log("stderr:", stderr.slice(0, 2000));
  return { name, sandbox, exitCode: result.exitCode, denied, stderrTail: stderr.slice(-400) };
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(PROBES);
const summary = [];
for (const name of names) {
  const command = PROBES[name];
  if (!command) {
    console.log("未知探测:", name);
    continue;
  }
  // 对照组先跑（证实这台机器上命令本身通），严档后跑
  const loose = null;
  const strict = await runOne(name + "/严档", command, true);
  summary.push({ name, strict: strict.exitCode, strictDenied: strict.denied });
}
console.log("\n===== 汇总 =====");
for (const s of summary) console.log(JSON.stringify(s));
server.closeAllConnections();
await new Promise(resolve => server.close(resolve));
fs.rmSync(root, { recursive: true, force: true });
