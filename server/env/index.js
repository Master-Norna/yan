// 言 · 沙箱环境：在 <存储根>/环境/ 里备一套自带的开发环境，只给桥接起的进程（模型的指令、MCP 服务）用，不动系统。
//   bin/     uv、uvx，与各工具包立的入口（pandoc、ffmpeg、cc……）
//   python/  uv 管的 Python 本体
//   py/      虚拟环境：pip 装进这里
//   node/    npm 的全局目录：npm i -g 装进这里（Node 用桥接自己的那一份）
//   go/ rust/ java/ …  自己下载解压的工具链，一组一个目录（见 packs.js 的 fetch）
//   cache/   uv 与 npm 的下载缓存、下载到一半的压缩包
//   已备.json 装了什么、用哪路下载源（准备时自己比出来的，模型往后自装的包也走这一路）
// 接口：POST /api/env/status；/api/env/prepare { packs, pip, npm } 在后台装，页面轮询 status 看进度；/api/env/clear 整个删掉
// 准备环境就是把环境对齐到勾选：勾上的装，上回装了、这回没勾的卸掉
"use strict";
const { jsonRoute, errorText, readJsonFile } = require("../http.js");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { spawn, execFileSync } = require("node:child_process");
const PACKS = require("./packs.js");
const { pickSource } = require("../mirror.js");

const PYTHON = "3.12",
  STATE_FILE = "已备.json",
  LOG_KEEP = 400;
// 下载源：国内走清华（PyPI）、中科大（Python 本体）、npmmirror、南大（Go、Rust、JDK，实测最快）、goproxy.cn、rsproxy（crates）；官方各走各家。
// 走哪一路不让人选，准备时两边比一比挑快的（见 ../mirror.js）
const MIRRORS = {
  china: {
    pypi: "https://pypi.tuna.tsinghua.edu.cn/simple",
    python: "https://mirrors.ustc.edu.cn/github-release/astral-sh/python-build-standalone",
    npm: "https://registry.npmmirror.com",
    go: "https://mirrors.nju.edu.cn/golang/",
    goproxy: "https://goproxy.cn,direct",
    rustup: "https://mirrors.nju.edu.cn/rustup",
    crates: "sparse+https://rsproxy.cn/index/",
    jdk: "https://mirrors.nju.edu.cn/adoptium/21/jdk/x64/windows/"
  },
  official: {
    pypi: "https://pypi.org/simple",
    python: "",
    npm: "https://registry.npmjs.org",
    go: "",
    goproxy: "",
    rustup: "",
    crates: "",
    jdk: ""
  }
};

// macOS 没有环境包可装：改为探测系统里现成的 Python、Node 与 ffmpeg。brew 的两个 prefix 先看——
// 从 Finder 或 start.command 起的桥接 PATH 往往很窄，只靠 PATH 会探漏；再看 PATH 里的
const SYSTEM_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
const SYSTEM_TOOLS = [
  { id: "python", bins: ["python3", "python"], args: ["--version"] },
  { id: "node", bins: ["node"], args: ["--version"] },
  { id: "ffmpeg", bins: ["ffmpeg"], args: ["-version"] }
];

module.exports = function createEnv({ envHome, route = jsonRoute }) {
  /** @type {{ running: boolean, step: string, log: string[], error: string } | null} */
  let job = null,
    clearing = false,
    probed = null; // darwin 的系统工具探测结果：每进程懒探一次，prepare（重新探测）时刷新
  function systemTools() {
    if (process.platform !== "darwin") return null;
    if (!probed) probed = probeSystemTools();
    return probed;
  }
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
  const readState = () => readJsonFile(path.join(envHome(), STATE_FILE));
  function uvVars(mirror) {
    const d = dirs();
    return {
      UV_PYTHON_INSTALL_DIR: d.python,
      UV_PYTHON_PREFERENCE: "only-managed",
      // uv 装 Python 时默认往 ~/.local/bin 放 python3.12.exe、往注册表里登记：都不要，入口放环境自己的 bin
      UV_PYTHON_BIN_DIR: d.bin,
      UV_PYTHON_INSTALL_REGISTRY: "0",
      UV_CACHE_DIR: path.join(d.cache, "uv"),
      UV_DEFAULT_INDEX: mirror.pypi,
      UV_TOOL_DIR: path.join(d.home, "tools"),
      UV_TOOL_BIN_DIR: d.bin,
      ...(mirror.python ? { UV_PYTHON_INSTALL_MIRROR: mirror.python } : {})
    };
  }
  // 给桥接起的进程接上环境：PATH 前面加上环境的几处，pip、uv、npm 与各工具链都指向环境里；环境没备好就原样返回。
  // Windows 上环境变量名不分大小写，PATH 常写作 Path：照原来的键名接，不另起一个
  function apply(base) {
    // macOS 不备环境包：把 brew 的 bin 目录接进 PATH，指令里直接用 ffmpeg、python3 也能找着
    // （与探测同序：探测认下来的那处先，其余 brew 目录殿后，原 PATH 最后）
    if (process.platform === "darwin") {
      const extra = systemDirs(systemTools()),
        key = Object.keys(base).find(name => name.toUpperCase() === "PATH") || "PATH";
      return extra.length ? { ...base, [key]: [...extra, base[key]].filter(Boolean).join(path.delimiter) } : base;
    }
    const state = readState();
    if (!state) return base;
    const d = dirs(),
      mirror = MIRRORS[state.mirror] || MIRRORS.china,
      installed = PACKS.filter(pack => state.packs.includes(pack.id)),
      key = Object.keys(base).find(name => name.toUpperCase() === "PATH") || "PATH";
    return {
      ...base,
      [key]: [
        d.bin,
        path.join(d.py, "Scripts"),
        d.node,
        ...installed.flatMap(pack => (pack.path || []).map(p => path.join(d.home, p))),
        base[key]
      ]
        .filter(Boolean)
        .join(path.delimiter),
      VIRTUAL_ENV: d.py,
      PIP_INDEX_URL: mirror.pypi,
      NODE_PATH: path.join(d.node, "node_modules"),
      npm_config_prefix: d.node,
      npm_config_registry: mirror.npm,
      npm_config_cache: path.join(d.cache, "npm"),
      ...uvVars(mirror),
      ...Object.assign({}, ...installed.map(pack => pack.vars?.(d.home, mirror) || {}))
    };
  }

  function status() {
    return {
      home: envHome(),
      supported: process.platform === "win32",
      system: systemTools(),
      state: readState(),
      packs: PACKS.map(({ id, name, tag, note, hint = "", base = false, pip = [], npm = [] }) => ({
        id,
        name,
        tag,
        note,
        hint,
        base,
        pip,
        npm
      })),
      job: job && { running: job.running, step: job.step, error: job.error, log: job.log.slice(-60) }
    };
  }
  async function prepare({ packs = [], pip = [], npm = [] }, say, step) {
    const chosen = PACKS.filter(pack => pack.base || packs.includes(pack.id)),
      before = readState(),
      dropped = PACKS.filter(pack => before?.packs.includes(pack.id) && !chosen.includes(pack)),
      d = dirs();
    let mirror = "china",
      m = MIRRORS.china;
    fs.mkdirSync(d.bin, { recursive: true });
    step("挑下载源");
    mirror = await pickSource();
    m = MIRRORS[mirror];
    say(mirror === "china" ? "国内镜像快些，走镜像" : "官方源快些，走官方");
    const pipPackages = unique([...chosen.flatMap(pack => pack.pip || []), ...pip]),
      npmPackages = unique([...chosen.flatMap(pack => pack.npm || []), ...npm]),
      // 上回装了、这回不要的：去掉仍被别组或「另装」用着的
      pipDrop = unique([...dropped.flatMap(pack => pack.pip || []), ...(before?.pip || [])]).filter(name => !pipPackages.includes(name)),
      npmDrop = unique([...dropped.flatMap(pack => pack.npm || []), ...(before?.npm || [])]).filter(name => !npmPackages.includes(name)),
      env = { ...process.env, ...uvVars(m) },
      npmEnv = { ...process.env, npm_config_prefix: d.node, npm_config_registry: m.npm, npm_config_cache: path.join(d.cache, "npm") },
      python = path.join(d.py, "Scripts", "python.exe");
    step("取 uv");
    const uv = await ensureUv(m, say);
    step(`装 Python ${PYTHON}`);
    await run(uv, ["python", "install", PYTHON], env, say);
    if (!fs.existsSync(python)) {
      step("建虚拟环境");
      await run(uv, ["venv", "--seed", "--python", PYTHON, d.py], env, say);
    }
    if (pipDrop.length) {
      step(`卸 Python 包 ${pipDrop.length} 个`);
      await run(uv, ["pip", "uninstall", "--python", python, ...pipDrop], env, say);
    }
    if (npmDrop.length) {
      step(`卸 Node 工具 ${npmDrop.length} 个`);
      await run(process.execPath, [npmCli(), "uninstall", "-g", ...npmDrop], npmEnv, say);
    }
    for (const pack of dropped) {
      for (const name of Object.keys(pack.links || {}))
        if (!chosen.some(other => other.links?.[name])) {
          fs.rmSync(path.join(d.bin, `${name}.cmd`), { force: true });
          if (pack.exe) unlinkExe(name, say);
        }
      if (pack.dir) {
        step(`卸 ${pack.name}`);
        fs.rmSync(path.join(d.home, pack.dir), { recursive: true, force: true });
      }
    }
    if (pipPackages.length) {
      step(`装 Python 包 ${pipPackages.length} 个`);
      await run(uv, ["pip", "install", "--python", python, ...pipPackages], env, say);
    }
    if (npmPackages.length) {
      step(`装 Node 工具 ${npmPackages.length} 个`);
      await run(process.execPath, [npmCli(), "install", "-g", "--no-fund", "--no-audit", ...npmPackages], npmEnv, say);
    }
    // 自己下载的工具链：已有就不重下；装到一半出错的整个删掉，免得下回当成已装
    for (const pack of chosen.filter(pack => pack.fetch && !fs.existsSync(path.join(d.home, pack.dir)))) {
      step(`装 ${pack.name}`);
      try {
        await pack.fetch({
          home: d.home,
          mirror: m,
          say,
          download: (url, name) => download(url, path.join(d.cache, name), say),
          unpack: (file, to) => unpack(file, to),
          run: (command, args, runEnv) => run(command, args, runEnv, say)
        });
      } catch (error) {
        fs.rmSync(path.join(d.home, pack.dir), { recursive: true, force: true });
        throw error;
      }
    }
    for (const pack of chosen) for (const [name, target] of Object.entries(pack.links || {})) link(name, target, say, pack.exe);
    const version = execFileSync(python, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
    const state = { 言: "环境", python: version, packs: chosen.map(pack => pack.id), pip, npm, mirror, at: new Date().toISOString() };
    fs.writeFileSync(path.join(d.home, STATE_FILE), JSON.stringify(state, null, 1));
    step("已备好");
  }
  // uv 本身：PyPI 上 uv 的 wheel 里带着 uv.exe 与 uvx.exe，取最新的一个，用系统自带的 tar 解出来
  async function ensureUv(mirror, say) {
    const { bin, cache } = dirs(),
      uv = path.join(bin, "uv.exe");
    if (fs.existsSync(uv)) return uv;
    const index = `${mirror.pypi}/uv/`;
    const list = /** @type {any} */ (
      await (await fetch(index, { headers: { Accept: "application/vnd.pypi.simple.v1+json" }, signal: AbortSignal.timeout(60000) })).json()
    );
    const wheel = list.files
      .filter(file => /^uv-[\d.]+-py3-none-win_amd64\.whl$/.test(file.filename) && !file.yanked)
      .map(file => ({ ...file, version: file.filename.split("-")[1].split(".").map(Number) }))
      .sort((a, b) => a.version.reduce((order, n, i) => order || n - (b.version[i] || 0), 0))
      .at(-1);
    if (!wheel) throw Error("下载源里没找到 uv");
    say(`uv ${wheel.version.join(".")}`);
    const unpacked = path.join(cache, "uv-wheel");
    await unpack(await download(new URL(wheel.url, index).href, path.join(cache, "uv.whl"), say), unpacked);
    for (const name of ["uv.exe", "uvx.exe"]) {
      const found = findFile(unpacked, name);
      if (found) fs.copyFileSync(found, path.join(bin, name));
    }
    fs.rmSync(unpacked, { recursive: true, force: true });
    return uv;
  }
  // 在 bin 里立一个同名的 .cmd 入口：装在包里、名字不规整的可执行文件（如 ffmpeg-win-x86_64-v7.1.exe），
  // 或带固定参数的（cc → zig cc）。target 是路径，或 [路径, 固定参数…]；路径末段可带 *
  function link(name, target, say, exe = false) {
    const [pattern, ...fixed] = [].concat(target),
      { home, bin } = dirs(),
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
    fs.writeFileSync(path.join(bin, `${name}.cmd`), `@"${path.join(dir, found)}"${fixed.map(arg => ` ${arg}`).join("")} %*\r\n`);
    say(`${name} → ${[found, ...fixed].join(" ")}`);
    // 包升级后原件换了，旧的硬链接还指着旧的：每回先拆再立；不同盘立不了硬链接就整份拷
    if (exe && !fixed.length && unlinkExe(name, say))
      try {
        fs.linkSync(path.join(dir, found), path.join(bin, `${name}.exe`));
      } catch {
        fs.copyFileSync(path.join(dir, found), path.join(bin, `${name}.exe`));
      }
  }
  // 正在跑的 exe 拆不掉（如预览视频时的 ffmpeg）：留着旧的，下回准备再换
  function unlinkExe(name, say) {
    try {
      fs.rmSync(path.join(dirs().bin, `${name}.exe`), { force: true });
      return true;
    } catch (error) {
      say(`（${name}.exe 正被占用，未换：${error.code || error.message}）`);
      return false;
    }
  }

  // 环境里某件工具的程序本身（照 link 立的入口读回路径）；没装、或入口不是这种形状的返回 ""。
  // 桥接自己要调它时用：.cmd 入口得经 cmd 才起得来，直接起 exe 省一层。
  // macOS 没有 .cmd 入口：退回系统里探到的那一份（如 Homebrew 的 ffmpeg）
  function toolPath(name) {
    try {
      const found = /^@"([^"]+)"/.exec(fs.readFileSync(path.join(dirs().bin, `${name}.cmd`), "utf8"))?.[1] || "";
      if (found && fs.existsSync(found)) return found;
    } catch {}
    return systemTools()?.[name]?.path || "";
  }

  // macOS 的「准备」：不做安装，把系统里现成的 Python、Node、ffmpeg 重探一遍记进状态
  function prepareSystem(current, say) {
    current.step = "探测系统工具";
    probed = probeSystemTools();
    for (const tool of SYSTEM_TOOLS) {
      const hit = probed[tool.id];
      say(hit ? `${tool.id} → ${hit.version || hit.path}` : `（没找到 ${tool.id}，跳过）`);
    }
    const home = envHome();
    fs.mkdirSync(home, { recursive: true });
    const state = { 言: "系统环境", system: probed, at: new Date().toISOString() };
    fs.writeFileSync(path.join(home, STATE_FILE), JSON.stringify(state, null, 1));
    current.step = "已探好";
  }

  // 先同步占位，再碰环境目录；连读旧状态或初始化失败也由这一处收口。
  async function startPrepare(body) {
    job = { running: true, step: "", log: [], error: "" };
    const current = job;
    const say = line => {
      current.log.push(line);
      if (current.log.length > LOG_KEEP) current.log.splice(0, current.log.length - LOG_KEEP);
    };
    const step = text => {
      current.step = text;
      say(`— ${text}`);
    };
    try {
      if (process.platform === "darwin") prepareSystem(current, say);
      else await prepare(body, say, step);
    } catch (error) {
      current.error = errorText(error, Infinity);
      say(`✗ ${current.error}`);
    } finally {
      current.running = false;
    }
  }

  const handlePrepare = route(
    body => {
      if (clearing) throw Error("环境正在清空，稍候再试");
      // 各件工具包下的都是 Windows 的发行版（python.exe、windows-amd64 的 zip……），别处装不上；
      // macOS 不装包，「准备」就是重探一遍系统工具
      if (process.platform !== "win32" && process.platform !== "darwin")
        throw Error("环境工具包只备了 Windows 版；在这套系统上请用系统里的 Python 与 Node");
      if (!job?.running) void startPrepare(body);
      return status();
    },
    error => errorText(error, Infinity)
  );
  const handleClear = route(async () => {
    if (job?.running) throw Error("环境正在准备，稍候再清");
    if (clearing) throw Error("环境正在清空，稍候再试");
    clearing = true;
    try {
      await fs.promises.rm(envHome(), { recursive: true, force: true });
      job = null;
    } catch (error) {
      throw Error(`没能删干净（可能有进程正用着环境里的程序）：${errorText(error, 200)}`);
    } finally {
      clearing = false;
    }
    return status();
  });
  return {
    apply,
    toolPath,
    busy: () => clearing || !!job?.running,
    // 只在换根成功后调用；系统工具探测缓存是全机的，不随根变。
    resetJob: () => (job = null),
    routes: { "POST /api/env/status": route(status), "POST /api/env/prepare": handlePrepare, "POST /api/env/clear": handleClear }
  };
};

const unique = names => [...new Set(names.map(name => String(name).trim()).filter(Boolean))];
// PATH 前缀该放哪几处：探测认下来的那处（只在 brew 两处之内）先，其余 brew 目录殿后，各去重、只留真有的。
// 探测按「跑得通」选（坏的那份跳过），PATH 却按目录先后找——选定的是 /usr/local/bin 那份而不提前，
// 指令里敲 python3 照样先撞上 /opt/homebrew/bin 里坏的那份，状态卡报的版本与实际跑的不是同一件。
// 边界：坏副本在 brew 之外（如 /usr/bin 那份坏了、探测退到 PATH 更后面）时这里排不过来——那种情形
// 原 PATH 里的先后本就是探测的顺序，敲名字也会撞上坏的同一个；brew 之外的顺序一律不动（别把 /usr/bin 提到 brew 前）
function systemDirs(found) {
  const hit = unique(SYSTEM_TOOLS.map(tool => path.dirname(found?.[tool.id]?.path || "")).filter(dir => SYSTEM_DIRS.includes(dir)));
  return unique([...hit, ...SYSTEM_DIRS]).filter(dir => fs.existsSync(dir));
}
// 按 SYSTEM_TOOLS 逐个探：brew 两处 prefix → PATH，逐处试着跑一下，认第一个跑得通的那一份。
// 只「存在且可执行」不算——brew 里那份可能缺库、架构不对，跑起来就错；停在坏的上面，
// 别处好的就用不上了（ffmpeg 尤其：预览视频换壳据此取壳），所以探不通就跳过、接着往下试
function probeSystemTools() {
  const candidates = [
      ...SYSTEM_DIRS,
      ...String(process.env.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)
    ],
    found = {};
  for (const tool of SYSTEM_TOOLS) {
    for (const bin of tool.bins) {
      for (const dir of candidates) {
        const file = path.join(dir, bin),
          version = probeVersion(file, tool.args);
        if (version === null) continue;
        found[tool.id] = { path: file, version };
        break;
      }
      if (found[tool.id]) break;
    }
  }
  return found;
}
// 跑一下 --version 拿版本：不是可执行文件、或跑不起来（缺库、架构不对）回 null，这个候选就不算。
// 首行往往还带着整句版权（ffmpeg 是「ffmpeg version 7.1-… Copyright (c) 2000-2024 the FFmpeg developers」），
// 只留前半句——它要进状态卡与系统提示，别把整行版权也带进去
function probeVersion(file, args) {
  try {
    if (!fs.statSync(file).isFile()) return null;
    fs.accessSync(file, fs.constants.X_OK);
  } catch {
    return null;
  }
  try {
    const line = String(
      execFileSync(file, args, { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
    )
      .split("\n")[0]
      .split(/\s+Copyright\b/i)[0]
      .trim();
    return line.length > 60 ? `${line.slice(0, 59)}…` : line;
  } catch {
    return null;
  }
}
// 下载到文件，大的每过一成报一次进度；先写到 .part，下完才改名
async function download(url, file, say) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw Error(`${path.basename(file)} 下载失败（HTTP ${response.status}）`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const total = Number(response.headers.get("content-length")) || 0;
  let got = 0,
    shown = 0;
  const body = Readable.fromWeb(/** @type {any} */ (response.body));
  if (total > 20 * 1048576)
    body.on("data", chunk => {
      got += chunk.length;
      if (got / total >= shown + 0.1) {
        shown = Math.floor((got / total) * 10) / 10;
        say(`已下 ${Math.round(got / 1048576)} / ${Math.round(total / 1048576)} MB`);
      }
    });
  await pipeline(body, fs.createWriteStream(`${file}.part`));
  fs.renameSync(`${file}.part`, file);
  return file;
}
// PATH 里的 tar 可能是 Git 带的 GNU tar，认不得盘符：用系统自带的那个，它也解 zip；解完删掉压缩包
async function unpack(file, to) {
  fs.mkdirSync(to, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-xf", file, "-C", to], {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let error = "";
    child.stderr.setEncoding("utf8").on("data", chunk => (error += chunk));
    child.on("error", reject);
    child.on("close", code =>
      code === 0 ? resolve(undefined) : reject(Error(`解压 ${path.basename(file)} 失败：${error.trim().slice(-200)}`))
    );
  });
  fs.rmSync(file, { force: true });
}
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
    child.on("close", code =>
      code === 0 ? resolve(undefined) : reject(Error(`${path.basename(command)} 退出码 ${code}：${tail.join(" / ")}`))
    );
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
