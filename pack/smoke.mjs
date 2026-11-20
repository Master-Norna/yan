// 便携包冒烟：解开 dist 里这一版的 zip，经解出的启动器用包内 Node 起桥接，问一句 /api/bootstrap 与首页。
// Windows 真跑言.exe，并以只读文件验可选日志的降级；Mac 走 start.command，不代替下载后从访达打开的手工验收。
// 用法：npm run pack:smoke（打包 + 冒烟），或先 npm run pack 再 node pack/smoke.mjs。
// 不碰真实存储根（YAN_HOME 指临时目录）、不开页面、不装任何东西；跑完把临时目录与进程一起收掉。
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const MAC = process.platform === "darwin" && process.arch === "arm64";
const WIN = process.platform === "win32" && process.arch === "x64";
if (!MAC && !WIN) throw Error("便携包冒烟须在 Windows x64 或 Apple 芯片 Mac 上运行");
const TARGET = MAC ? "mac-arm64" : "win-x64";
const LAUNCHER = MAC ? "start.command" : "言.exe";
const NODE_BIN = MAC ? "node/bin/node" : "node/node.exe";
const MAC_SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SYSTEM = process.env.SystemRoot || "C:\\Windows";
const TASKKILL = path.join(SYSTEM, "System32", "taskkill.exe");
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
// 抽查这几件：启动器、桥接、包清单、页面源码、随包 Node——任何一件缺了，用户双击都起不来
const NEED = [LAUNCHER, "server.js", "package.json", "src/00-state.js", "web/index.html", NODE_BIN];

// Windows 自己解 zip，不借系统 tar。macOS 走系统 ditto，以保留权限与软链。
// （CI 的 tar 在我们写的中文条目名上报「filename 读不出」，同一个包本机却能解——各版本宽严不一，索性不用它；
//   顺带按中央目录的 CRC 与大小核对每一件，比 tar 走一遍更严。）
function unzip(zipFile, dest) {
  const buffer = fs.readFileSync(zipFile);
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 65557); at--)
    if (buffer.readUInt32LE(at) === 0x06054b50) {
      end = at;
      break;
    }
  if (end < 0) throw Error("找不到中央目录尾，不是 zip");
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw Error("中央目录坏了");
    const method = buffer.readUInt16LE(at + 10),
      crc = buffer.readUInt32LE(at + 16),
      packed = buffer.readUInt32LE(at + 20),
      size = buffer.readUInt32LE(at + 24),
      nameLength = buffer.readUInt16LE(at + 28),
      extraLength = buffer.readUInt16LE(at + 30),
      commentLength = buffer.readUInt16LE(at + 32),
      offset = buffer.readUInt32LE(at + 42),
      name = buffer.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (name.split("/").includes("..")) throw Error(`条目名越界：${name}`);
    const from = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28),
      body = buffer.subarray(from, from + packed),
      data = method === 0 ? body : zlib.inflateRawSync(body);
    if (data.length !== size || zlib.crc32(data) !== crc) throw Error(`条目解出来对不上：${name}`);
    const target = path.join(dest, ...name.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    at += 46 + nameLength + extraLength + commentLength;
  }
}

const say = text => console.log(`· ${text}`);
let temp = "",
  child = null;

function cleanup() {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    try {
      if (MAC) child.kill();
      else spawnSync(TASKKILL, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
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

const zip = path.join(DIST, `yan-${version}-${TARGET}.zip`);
if (!fs.existsSync(zip)) fail(`没有 ${path.relative(ROOT, zip)}：先跑 npm run pack`);

temp = fs.mkdtempSync(path.join(os.tmpdir(), "yan-pack-smoke-"));
try {
  if (MAC) execFileSync("/usr/bin/ditto", ["-x", "-k", zip, temp], { stdio: "inherit" });
  else unzip(zip, temp);
} catch (error) {
  fail(`解不开 ${path.basename(zip)}：${error.message}`);
}
const home = path.join(temp, "言");
say(`已解开 ${path.basename(zip)}`);

for (const file of NEED) if (!fs.existsSync(path.join(home, file))) fail(`包里缺 ${file}`);
say(`抽查的 ${NEED.length} 件都在`);

const packed = JSON.parse(fs.readFileSync(path.join(home, "package.json"), "utf8"));
if (packed.version !== version) fail(`包里是 ${packed.version}，仓库已是 ${version}：重新 npm run pack`);

if (MAC) {
  try {
    for (const relative of [LAUNCHER, NODE_BIN, "node/bin/npm", "node/bin/npx"])
      fs.accessSync(path.join(home, relative), fs.constants.X_OK);
    // npm/npx 是官方 Node tar 里的相对软链；让解出来的 npm 以包内 Node 实际跑一次。
    execFileSync(path.join(home, "node/bin/npm"), ["--version"], {
      env: { ...process.env, PATH: `${path.join(home, "node/bin")}:${MAC_SYSTEM_PATH}`, HOME: temp },
      stdio: "pipe"
    });
  } catch (error) {
    fail(`解压后启动文件或包内 npm 不能执行：${error.message}`);
  }
}

const logFile = path.join(home, "桥接.log");
const logMarker = "冒烟：原有的只读日志\n";
if (WIN) {
  fs.writeFileSync(logFile, logMarker);
  fs.chmodSync(logFile, 0o444);
}
const port = await freePort();
const store = path.join(temp, ".yan");
let log = "";
child = spawn(path.join(home, LAUNCHER), ["--no-open"], {
  cwd: MAC ? temp : home,
  env: {
    ...process.env,
    ...(MAC && { PATH: MAC_SYSTEM_PATH }), // 模拟访达只给系统 PATH，不能靠 runner 的 Node 起桥接
    YAN_HOME: store,
    YAN_PORT: String(port)
  },
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
const deadline = Date.now() + 30000;
while (!info && Date.now() < deadline) {
  if (child.exitCode !== null) fail(`桥接退了（退出码 ${child.exitCode}）\n${log.trim()}`);
  try {
    const res = await fetch(`${base}/api/bootstrap`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) info = await res.json();
  } catch {
    /* 还没听上 */
  }
  if (!info) await new Promise(resolve => setTimeout(resolve, 500));
}
if (!info) fail(`30 秒内 /api/bootstrap 没有应答\n${log.trim()}`);
if (info.version !== version) fail(`桥接报的版本是 ${info.version}，包是 ${version}：APP_VERSION 与 package.json 不同步`);
if (info.store?.root !== store) fail("应答的桥接没有使用冒烟的临时存储根");
say(`经 ${LAUNCHER} 启动：/api/bootstrap 报 ${info.version}`);
if (WIN) {
  if (fs.readFileSync(logFile, "utf8") !== logMarker || fs.statSync(logFile).mode & 0o222) fail("原有的只读日志被改动");
  say("已有只读日志未改动，桥接照常启动");
}

const page = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) }).catch(error => fail(`首页取不到：${error.message}`));
if (!page.ok) fail(`首页回 ${page.status}`);
const html = await page.text();
if (!html.includes("support.js")) fail("首页没引 support.js：页面源码没随包走对");
say("首页也送得出来");

cleanup();
child = null;
say("冒烟通过");
