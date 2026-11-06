// 言 · 桥接 · 与操作系统打交道的几件事：用默认浏览器开网页、用默认程序开文件、在文件管理器里显出、收掉整棵进程树、找本机浏览器。
// 碰系统的都走这里，别处不再各写一遍 rundll32、explorer、taskkill。以 Windows 为准；macOS 只求能用、不另配沙箱规则与工具包，不做 Linux
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const WIN = process.platform === "win32",
  MAC = process.platform === "darwin";

// 交给系统、不等它回：找不到程序（ENOENT）也只当没开成，不能让未接的 error 事件把桥接带崩
function launch(file, args) {
  try {
    // 交出去的都是要露面的（资源管理器、浏览器）：不加 windowsHide——加了 explorer 照这个显示方式开窗，窗是藏着的，点了「打开」什么也看不见
    const child = spawn(file, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
// 网页交给默认浏览器。Windows 交给 url.dll：不经 cmd（网址里的 & 会被当成命令分隔）；explorer.exe 认不全长网址，会打开「文档」
function openUrl(url) {
  if (WIN) launch("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
  else launch(MAC ? "open" : "xdg-open", [url]);
}
// 文件或目录交给默认程序打开
function openPath(target) {
  launch(WIN ? "explorer.exe" : MAC ? "open" : "xdg-open", [path.resolve(target)]);
}
// 在文件管理器里显出：目录直接打开，文件在它所在的目录里选中
function reveal(target) {
  const full = path.resolve(target);
  if (fs.statSync(full, { throwIfNoEntry: false })?.isDirectory()) return openPath(full);
  if (WIN) launch("explorer.exe", [`/select,${full}`]);
  else if (MAC) launch("open", ["-R", full]);
  else openPath(path.dirname(full));
}

// 起子进程时并进 spawn 选项：Windows 之外让它自成一个进程组，killTree 才能连它起的孙进程一起收掉
// （Windows 上不能这样起——detached 会另开一个控制台窗口；那边靠 taskkill /T 认整棵树）
const OWN_GROUP = WIN ? {} : { detached: true };
const alive = child => !!child?.pid && child.exitCode === null && !child.signalCode;
function killShell(child) {
  if (!alive(child)) return;
  try {
    child.kill("SIGKILL");
  } catch {}
}
// 杀整棵进程树：子进程起的 node、python、下载器不能只杀它本身，否则点了停止，脚本还在后台改文件、占端口。
// taskkill 能把孙进程一起收掉，但受限环境里可能被系统拒绝；那时至少要终止直属的那个。
// signal 只在 Windows 之外用：要让它自己收尾的（Playwright 另起进程组的浏览器，SIGKILL 了就成孤儿）传 SIGTERM
function killTree(child, signal = "SIGKILL") {
  if (!alive(child)) return;
  if (!WIN) return killGroup(child, signal);
  const killer = spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" }),
    fallback = setTimeout(() => killShell(child), 750);
  // 不攥着桥接：退出时收 MCP 服务也走这里，不能让它等 taskkill
  killer.unref?.();
  killer.once("error", () => killShell(child));
  killer.once("close", code => {
    clearTimeout(fallback);
    if (code) killShell(child);
  });
}
// 同步的一版：桥接退出时（exit 里起不了异步的 taskkill）
function killTreeSync(child) {
  if (!alive(child)) return;
  if (!WIN) return killGroup(child);
  try {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true, stdio: "ignore" });
  } catch {}
  killShell(child);
}
// 按 OWN_GROUP 起的，它的 pid 就是进程组号；不是这样起的，组不存在，退回只杀它本身
function killGroup(child, signal = "SIGKILL") {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

// 本机装的 Edge、Chrome 在哪（各列常见的几处，有一处在就算装了）
function browserFiles() {
  if (MAC) {
    const apps = ["/Applications", path.join(os.homedir(), "Applications")];
    return {
      msedge: apps.map(dir => path.join(dir, "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge")),
      chrome: apps.map(dir => path.join(dir, "Google Chrome.app", "Contents", "MacOS", "Google Chrome"))
    };
  }
  const env = process.env,
    pf = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean).map(String);
  return {
    msedge: pf.map(dir => path.join(dir, "Microsoft", "Edge", "Application", "msedge.exe")),
    chrome: pf.map(dir => path.join(dir, "Google", "Chrome", "Application", "chrome.exe"))
  };
}

// 系统代理（Windows「设置 → 网络 → 代理」，Clash、v2rayN 开「系统代理」写的就是这里）：浏览器跟它走，Node 的 fetch 不认。
// 不跟的话，授权页在浏览器里开得了，桥接去换令牌、调接口却是直连，国内连不上。只认手填的那种，PAC 脚本与仅 SOCKS 的不管。
// 返回 setGlobalProxyFromEnv 认的样子；没开代理是 null
function systemProxy() {
  if (!WIN) return null;
  let text = "";
  try {
    text = spawnSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 3000
    }).stdout;
  } catch {}
  const value = name => (text?.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.*)$`, "m"))?.[1] || "").trim();
  if (!/^0x0*1$/i.test(value("ProxyEnable"))) return null;
  // 「127.0.0.1:7890」或分协议的「http=…;https=…;socks=…」
  const server = value("ProxyServer"),
    parts = Object.fromEntries(server.split(";").map(part => (part.includes("=") ? part.split("=") : ["", part]).map(s => s.trim())));
  const address = parts.https || parts[""] || parts.http;
  if (!address) return null;
  const proxy = /^\w+:\/\//.test(address) ? address : `http://${address}`;
  // 例外：照写的主机名与「*.域名」留下；「192.168.*」这类网段、<local> Node 的 NO_PROXY 认不了，交给代理软件自己的直连规则
  const bypass = value("ProxyOverride")
    .split(";")
    .map(entry => entry.trim().replace(/^\*\./, "."))
    .filter(entry => entry && !entry.includes("*") && !entry.includes("<"));
  return { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: [...new Set(["localhost", "127.0.0.1", "::1", ...bypass])].join(",") };
}

module.exports = { openUrl, openPath, reveal, OWN_GROUP, killTree, killTreeSync, browserFiles, systemProxy };
