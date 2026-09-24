// 言 · 沙箱环境：在 <存储根>/环境/ 里备一套自带的开发环境，只给桥接起的进程（模型的指令、MCP 服务）用，不动系统。
//   bin/     uv、uvx，与各工具包立的入口（pandoc、ffmpeg……）
//   python/  uv 管的 Python 本体
//   py/      虚拟环境：pip 装进这里
//   node/    npm 的全局目录：npm i -g 装进这里（Node 用桥接自己的那一份）
//   cache/   uv 与 npm 的下载缓存
//   已备.json 装了什么、用哪路下载源
// 接口：POST /api/env/status；/api/env/prepare { packs, pip, npm, mirror } 在后台装，页面轮询 status 看进度；/api/env/clear 整个删掉
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const PACKS = require("./packs.js");

const PYTHON = "3.12",
  STATE_FILE = "已备.json",
  LOG_KEEP = 400;
// 下载源：国内走清华（PyPI）、中科大（Python 本体）、npmmirror；官方走 PyPI、GitHub、npmjs
const MIRRORS = {
  china: {
    pypi: "https://pypi.tuna.tsinghua.edu.cn/simple",
    python: "https://mirrors.ustc.edu.cn/github-release/astral-sh/python-build-standalone",
    npm: "https://registry.npmmirror.com"
  },
  official: { pypi: "https://pypi.org/simple", python: "", npm: "https://registry.npmjs.org" }
};

module.exports = function createEnv({ sendJson, readJson, envHome }) {
  /** @type {{ running: boolean, step: string, log: string[], error: string } | null} */
  let job = null;
  const dirs = () => {
    const home = envHome();
    return {
      home,
      bin: path.join(home, "bin"),
      python: path.join(home, "python"),
      py: path.join(home, "py"),
      node: path.join(home, "node"),
      cache: path.join(home, "cache")
    };
  };
  function readState() {
    try {
      return JSON.parse(fs.readFileSync(path.join(envHome(), STATE_FILE), "utf8"));
    } catch {
      return null;
    }
  }
  function uvVars(mirror) {
    const d = dirs();
    return {
      UV_PYTHON_INSTALL_DIR: d.python,
      UV_PYTHON_PREFERENCE: "only-managed",
      UV_CACHE_DIR: path.join(d.cache, "uv"),
      UV_DEFAULT_INDEX: mirror.pypi,
      UV_TOOL_DIR: path.join(d.home, "tools"),
      UV_TOOL_BIN_DIR: d.bin,
      ...(mirror.python ? { UV_PYTHON_INSTALL_MIRROR: mirror.python } : {})
    };
  }
  // 给桥接起的进程接上环境：PATH 前面加上环境的几处，pip、uv、npm 都指向环境里；环境没备好就原样返回。
  // Windows 上环境变量名不分大小写，PATH 常写作 Path：照原来的键名接，不另起一个
  function apply(base) {
    const state = readState();
    if (!state) return base;
    const d = dirs(),
      mirror = MIRRORS[state.mirror] || MIRRORS.china,
      key = Object.keys(base).find(name => name.toUpperCase() === "PATH") || "PATH";
    return {
      ...base,
      [key]: [d.bin, path.join(d.py, "Scripts"), d.node, base[key]].filter(Boolean).join(path.delimiter),
      VIRTUAL_ENV: d.py,
      PIP_INDEX_URL: mirror.pypi,
      NODE_PATH: path.join(d.node, "node_modules"),
      npm_config_prefix: d.node,
      npm_config_registry: mirror.npm,
      npm_config_cache: path.join(d.cache, "npm"),
      ...uvVars(mirror)
    };
  }

  function status() {
    return {
      home: envHome(),
      state: readState(),
      packs: PACKS.map(({ id, name, note, base = false, pip = [], npm = [] }) => ({ id, name, note, base, pip, npm })),
      job: job && { running: job.running, step: job.step, error: job.error, log: job.log.slice(-60) }
    };
  }
  async function prepare({ packs = [], pip = [], npm = [], mirror = "china" }) {
    const chosen = PACKS.filter(pack => pack.base || packs.includes(pack.id)),
      m = MIRRORS[mirror] || MIRRORS.china,
      d = dirs();
    const say = line => {
      job.log.push(line);
      if (job.log.length > LOG_KEEP) job.log.splice(0, job.log.length - LOG_KEEP);
    };
    const step = text => {
      job.step = text;
      say(`— ${text}`);
    };
    try {
      fs.mkdirSync(d.bin, { recursive: true });
      const pipPackages = [...new Set([...chosen.flatMap(pack => pack.pip || []), ...pip])],
        npmPackages = [...new Set([...chosen.flatMap(pack => pack.npm || []), ...npm])],
        env = { ...process.env, ...uvVars(m) },
        python = path.join(d.py, "Scripts", "python.exe");
      step("取 uv");
      const uv = await ensureUv(m, say);
      step(`装 Python ${PYTHON}`);
      await run(uv, ["python", "install", PYTHON], env, say);
      if (!fs.existsSync(python)) {
        step("建虚拟环境");
        await run(uv, ["venv", "--seed", "--python", PYTHON, d.py], env, say);
      }
      if (pipPackages.length) {
        step(`装 Python 包 ${pipPackages.length} 个`);
        await run(uv, ["pip", "install", "--python", python, ...pipPackages], env, say);
      }
      if (npmPackages.length) {
        step(`装 Node 工具 ${npmPackages.length} 个`);
        const npmEnv = {
          ...process.env,
          npm_config_prefix: d.node,
          npm_config_registry: m.npm,
          npm_config_cache: path.join(d.cache, "npm")
        };
        await run(process.execPath, [npmCli(), "install", "-g", "--no-fund", "--no-audit", ...npmPackages], npmEnv, say);
      }
      for (const pack of chosen) for (const [name, pattern] of Object.entries(pack.links || {})) link(name, pattern, say);
      const version = execFileSync(python, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
      const state = { 言: "环境", python: version, packs: chosen.map(pack => pack.id), pip, npm, mirror, at: new Date().toISOString() };
      fs.writeFileSync(path.join(d.home, STATE_FILE), JSON.stringify(state, null, 1));
      step("已备好");
    } catch (error) {
      job.error = String(error.message || error);
      say(`✗ ${job.error}`);
    } finally {
      job.running = false;
    }
  }
  // uv 本身：PyPI 上 uv 的 wheel 里带着 uv.exe 与 uvx.exe，取最新的一个，用系统自带的 tar 解出来
  async function ensureUv(mirror, say) {
    const { bin, cache } = dirs(),
      uv = path.join(bin, "uv.exe");
    if (fs.existsSync(uv)) return uv;
    const index = `${mirror.pypi}/uv/`;
    const list = await (
      await fetch(index, { headers: { Accept: "application/vnd.pypi.simple.v1+json" }, signal: AbortSignal.timeout(60000) })
    ).json();
    const wheel = list.files
      .filter(file => /^uv-[\d.]+-py3-none-win_amd64\.whl$/.test(file.filename) && !file.yanked)
      .map(file => ({ ...file, version: file.filename.split("-")[1].split(".").map(Number) }))
      .sort((a, b) => a.version.reduce((order, n, i) => order || n - (b.version[i] || 0), 0))
      .at(-1);
    if (!wheel) throw Error("下载源里没找到 uv");
    say(`uv ${wheel.version.join(".")}`);
    const response = await fetch(new URL(wheel.url, index), { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw Error(`uv 下载失败（HTTP ${response.status}）`);
    const unpack = path.join(cache, "uv-wheel"),
      file = path.join(cache, "uv.whl");
    fs.mkdirSync(unpack, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    // PATH 里的 tar 可能是 Git 带的 GNU tar，认不得盘符：用系统自带的那个，它也解 zip
    execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", file, "-C", unpack], {
      windowsHide: true
    });
    for (const name of ["uv.exe", "uvx.exe"]) {
      const found = findFile(unpack, name);
      if (found) fs.copyFileSync(found, path.join(bin, name));
    }
    fs.rmSync(unpack, { recursive: true, force: true });
    fs.rmSync(file, { force: true });
    return uv;
  }
  // 装在包里、名字不规整的可执行文件（如 ffmpeg-win-x86_64-v7.1.exe）：在 bin 里立一个同名的 .cmd 入口
  function link(name, pattern, say) {
    const { home, bin } = dirs(),
      dir = path.join(home, path.dirname(pattern)),
      match = new RegExp(
        `^${path
          .basename(pattern)
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")}$`,
        "i"
      ),
      found = fs.existsSync(dir) && fs.readdirSync(dir).find(file => match.test(file));
    if (!found) return say(`（没找到 ${name}，跳过）`);
    fs.writeFileSync(path.join(bin, `${name}.cmd`), `@"${path.join(dir, found)}" %*\r\n`);
    say(`${name} → ${found}`);
  }

  async function handleStatus(req, res) {
    await readJson(req).catch(() => ({}));
    sendJson(res, 200, status());
  }
  async function handlePrepare(req, res) {
    try {
      const body = await readJson(req);
      if (!job?.running) {
        job = { running: true, step: "", log: [], error: "" };
        void prepare(body);
      }
      sendJson(res, 200, status());
    } catch (error) {
      sendJson(res, 400, { error: String(error.message || error) });
    }
  }
  async function handleClear(req, res) {
    await readJson(req).catch(() => ({}));
    if (job?.running) return sendJson(res, 400, { error: "环境正在准备，稍候再清" });
    try {
      await fs.promises.rm(envHome(), { recursive: true, force: true });
      job = null;
      sendJson(res, 200, status());
    } catch (error) {
      sendJson(res, 400, { error: `没能删干净（可能有进程正用着环境里的程序）：${String(error.message || error).slice(0, 200)}` });
    }
  }
  return {
    apply,
    routes: { "POST /api/env/status": handleStatus, "POST /api/env/prepare": handlePrepare, "POST /api/env/clear": handleClear }
  };
};

// 逐行转述子进程的输出（去掉颜色控制符），退出码不为 0 即失败，带上最后几行
function run(command, args, env, say) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const tail = [];
    const take = chunk => {
      for (const line of chunk.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n|\r/)) {
        if (!line.trim()) continue;
        say(line);
        tail.push(line);
        if (tail.length > 6) tail.shift();
      }
    };
    child.stdout.setEncoding("utf8").on("data", take);
    child.stderr.setEncoding("utf8").on("data", take);
    child.on("error", reject);
    child.on("close", code => (code === 0 ? resolve() : reject(Error(`${path.basename(command)} 退出码 ${code}：${tail.join(" / ")}`))));
  });
}
function npmCli() {
  return path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
}
function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(file, name);
      if (found) return found;
    } else if (entry.name.toLowerCase() === name) return file;
  }
  return null;
}
