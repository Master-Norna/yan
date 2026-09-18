// 端到端测试运行器（零依赖）：起一个假模型接口、一个测试桥接、一个无头 Edge / Chrome，逐个跑 test/ 下的用例，按 PASS / FAIL 行统计
// 用法：node test/run.mjs [用例名…]      例：node test/run.mjs memory side-notes
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url)),
  ROOT = path.join(HERE, ".."),
  TMP = path.join(HERE, ".tmp");
const BRIDGE_PORT = 8799,
  SECURITY_PORT = 8797,
  DEBUG_PORT = 9333;
const only = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browsers =
  process.platform === "win32"
    ? [
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
      ]
    : process.platform === "darwin"
      ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const browser = process.env.YAN_TEST_BROWSER || browsers.find(existsSync);
if (!browser) {
  console.error("找不到 Edge / Chrome，可用 YAN_TEST_BROWSER 指定可执行文件路径");
  process.exit(2);
}

// 语法先过一遍
const jsFiles = [
  "server.js",
  "support.js",
  "theme-boot.js",
  "preview-runtime.js",
  "build.js",
  ...readdirSync(path.join(ROOT, "prompts"))
    .filter(f => f.endsWith(".js"))
    .map(f => `prompts/${f}`),
  ...["src", "server"].flatMap(dir =>
    existsSync(path.join(ROOT, dir))
      ? readdirSync(path.join(ROOT, dir))
          .filter(f => f.endsWith(".js"))
          .map(f => `${dir}/${f}`)
      : []
  )
].filter(f => existsSync(path.join(ROOT, f)));
for (const file of jsFiles) {
  const r = spawnSync(process.execPath, ["--check", file], { cwd: ROOT, encoding: "utf8" });
  if (r.status) {
    console.error(`语法错误：${file}\n${r.stderr}`);
    process.exit(2);
  }
}
console.log(`语法检查通过：${jsFiles.length} 个文件`);

// 上一次的浏览器可能还没完全退出（crashpad 会多活一会儿），清理失败不算错，换个新的配置目录即可
const tryRm = target => {
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 2 });
  } catch {}
};
tryRm(TMP);
mkdirSync(TMP, { recursive: true });
const children = [];
const start = (cmd, args, extra = {}) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...extra });
  children.push(child);
  return child;
};
const waitPort = async (port, timeout = 8000) => {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await sleep(150);
    }
  }
  throw Error(`端口 ${port} 未就绪`);
};
const stopAll = () => {
  for (const child of children) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
      else child.kill("SIGKILL");
    } catch {}
  }
};
process.on("exit", stopAll);
process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

let failed = 0,
  passed = 0;
const runSpec = (file, env = {}) =>
  new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(HERE, file)], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "",
      err = "";
    child.stdout.on("data", d => {
      out += d;
    });
    child.stderr.on("data", d => {
      err += d;
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
    }, 180000);
    child.on("close", code => {
      clearTimeout(timer);
      const lines = out.split(/\r?\n/),
        p = lines.filter(l => l.startsWith("PASS")).length,
        f = lines.filter(l => l.startsWith("FAIL")).length;
      passed += p;
      failed += f + (code && !f ? 1 : 0);
      console.log(`\n== ${file}: ${p} 过 / ${f} 败${code ? `（退出码 ${code}）` : ""}`);
      for (const l of lines) if (l.startsWith("FAIL") || l.startsWith("  [")) console.log("   " + l.slice(0, 400));
      if (code && err.trim()) console.log("   " + err.trim().split(/\r?\n/).slice(0, 12).join("\n   "));
      resolve();
    });
  });

// 端口若已被别的进程占着（上次没退干净的假模型、手动起的桥接），用例会悄悄连到那个旧进程上，结果不可信：先查一遍
for (const port of [BRIDGE_PORT, SECURITY_PORT, 8798, DEBUG_PORT]) {
  const busy = await fetch(`http://127.0.0.1:${port}/`).then(
    () => true,
    () => false
  );
  if (busy) {
    console.error(`端口 ${port} 已被占用，请先关掉占着它的进程（上次的假模型 / 桥接 / 浏览器）再跑测试`);
    process.exit(2);
  }
}
try {
  const wants = name => !only.length || only.some(o => name.includes(o));
  // 桥接安全检查：单独一个桥接实例，不需要浏览器
  if (wants("bridge-security")) {
    start(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, YAN_PORT: String(SECURITY_PORT), YAN_ARCHIVE: path.join(TMP, "archive-security") }
    });
    await waitPort(SECURITY_PORT);
    await runSpec("bridge-security.mjs", { YAN_PORT: String(SECURITY_PORT) });
  }
  const specs = readdirSync(HERE)
    .filter(f => f.endsWith(".mjs") && !["run.mjs", "lib.mjs", "fake-llm.mjs", "bridge-security.mjs"].includes(f))
    .filter(wants)
    .sort();
  if (specs.length) {
    // 卷宗目录指到临时目录，别把测试文件写进用户的 ~/言/卷宗
    start(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, YAN_PORT: String(BRIDGE_PORT), YAN_ARCHIVE: path.join(TMP, "archive") }
    });
    start(process.execPath, [path.join(HERE, "fake-llm.mjs")], { cwd: ROOT });
    await waitPort(BRIDGE_PORT);
    await waitPort(8798);
    const profile = path.join(TMP, `browser-profile-${Date.now().toString(36)}`);
    start(browser, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      "about:blank"
    ]);
    await waitPort(DEBUG_PORT, 15000);
    for (const spec of specs) {
      tryRm(path.join(TMP, "work"));
      tryRm(path.join(TMP, "archive"));
      await runSpec(spec);
    }
  }
} finally {
  stopAll();
  await sleep(300);
  tryRm(path.join(TMP, "work"));
}
console.log(`\n共 ${passed} 过 / ${failed} 败`);
process.exit(failed ? 1 : 0);
