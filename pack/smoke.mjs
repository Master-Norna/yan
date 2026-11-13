// 便携包冒烟：解开 dist 里这一版的 zip，用包里自带的那份 Node 起一次桥接，问一句 /api/bootstrap 与首页。
// 验的是「发出去的包真能启动」——解压、Node 在、启动器在、桥接起得来、报的版本是这一版。源码测试全绿也证明不了这些。
// 用法：npm run pack:smoke（打包 + 冒烟），或先 npm run pack 再 node pack/smoke.mjs。
// 不碰真实存储根（YAN_HOME 指临时目录）、不开页面、不装任何东西；跑完把临时目录与进程一起收掉。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SYSTEM = process.env.SystemRoot || "C:\\Windows";
const TAR = path.join(SYSTEM, "System32", "tar.exe");
const TASKKILL = path.join(SYSTEM, "System32", "taskkill.exe");
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
// 抽查这几件：启动器、桥接、包清单、页面源码、随包 Node——任何一件缺了，用户双击都起不来
const NEED = ["言.exe", "server.js", "package.json", "src/00-state.js", "web/index.html", "node/node.exe"];

const say = text => console.log(`· ${text}`);
let temp = "",
  child = null;

function cleanup() {
  if (child && child.exitCode === null) {
    try {
      spawnSync(TASKKILL, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* 已经退了 */
    }
  }
  if (temp) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const fail = text => {
  console.error(`\n✗ ${text}`);
  cleanup();
  process.exit(1);
};

// 向系统要一个当下空闲的端口再让它走：和 8787 上的言、和测试用的几个口都不撞
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const zip = path.join(DIST, `yan-${version}-win-x64.zip`);
if (!fs.existsSync(zip)) fail(`没有 ${path.relative(ROOT, zip)}：先跑 npm run pack`);
if (!fs.existsSync(TAR)) fail(`找不到 ${TAR}（解压用系统自带的 tar）`);

temp = fs.mkdtempSync(path.join(os.tmpdir(), "yan-pack-smoke-"));
const unzip = spawnSync(TAR, ["-xf", zip, "-C", temp], { encoding: "utf8" });
if (unzip.status !== 0) fail(`解压失败：${(unzip.stderr || unzip.stdout || "").trim()}`);
const home = path.join(temp, "言");
say(`已解开 ${path.basename(zip)}`);

for (const file of NEED) if (!fs.existsSync(path.join(home, file))) fail(`包里缺 ${file}`);
say(`抽查的 ${NEED.length} 件都在`);

const packed = JSON.parse(fs.readFileSync(path.join(home, "package.json"), "utf8"));
if (packed.version !== version) fail(`包里是 ${packed.version}，仓库已是 ${version}：重新 npm run pack`);

const port = await freePort();
let log = "";
child = spawn(path.join(home, "node", "node.exe"), ["server.js"], {
  cwd: home,
  env: { ...process.env, YAN_HOME: path.join(temp, ".yan"), YAN_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", data => (log += data));
child.stderr.on("data", data => (log += data));
child.on("error", error => fail(`起不来：${error.message}`));

const base = `http://127.0.0.1:${port}`;
let info = null;
for (let i = 0; i < 60 && !info; i++) {
  if (child.exitCode !== null) fail(`桥接退了（退出码 ${child.exitCode}）\n${log.trim()}`);
  try {
    const res = await fetch(`${base}/api/bootstrap`);
    if (res.ok) info = await res.json();
  } catch {
    /* 还没听上 */
  }
  if (!info) await new Promise(resolve => setTimeout(resolve, 500));
}
if (!info) fail(`30 秒内 /api/bootstrap 没有应答\n${log.trim()}`);
if (info.version !== version) fail(`桥接报的版本是 ${info.version}，包是 ${version}：APP_VERSION 与 package.json 不同步`);
say(`桥接起得来：/api/bootstrap 报 ${info.version}`);

const page = await fetch(`${base}/`);
if (!page.ok) fail(`首页回 ${page.status}`);
const html = await page.text();
if (!html.includes("support.js")) fail("首页没引 support.js：页面源码没随包走对");
say("首页也送得出来");

cleanup();
child = null;
say("冒烟通过");
