// 言 · 环境的工具包：设置里一张卡片一件，勾上的在「准备环境」时装进 <存储根>/环境/，取消勾选的下回准备时卸掉。
// 一件工具包可以有这几样（都可省）：
//   pip / npm   装进环境里的 Python（uv 管的 3.12）与 Node 全局目录的包
//   links       在 环境/bin 立的入口：{ 名字: 路径 } 或 { 名字: [路径, 固定参数…] }，路径相对环境根、末段可带 *
//   fetch       自己下载解压的（不在 PyPI / npm 上的工具链）：async ({ home, mirror, download, unpack, run, say }) => {}
//   dir         fetch 装在环境根下的哪个目录，卸载时整个删掉
//   path / vars 环境备好后给桥接起的进程接上：PATH 前面加的几处（相对环境根），与另设的环境变量
//   hint        写进系统提示的一句「装了什么」，省略时列包名
// 要加一组，照样子添一条即可
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ZIG = "py/Lib/site-packages/ziglang/zig.exe";
const rustVars = (home, mirror) => ({
  RUSTUP_HOME: path.join(home, "rust", "rustup"),
  CARGO_HOME: path.join(home, "rust", "cargo"),
  ...(mirror.rustup ? { RUSTUP_DIST_SERVER: mirror.rustup, RUSTUP_UPDATE_ROOT: `${mirror.rustup}/rustup` } : {})
});

module.exports = [
  {
    id: "python",
    name: "Python 3.12",
    tag: "Python",
    note: "独立的 Python 与 pip、uv；不依赖也不改动系统里的 Python。其余 Python 工具包都以它为底",
    base: true
  },
  {
    id: "data",
    name: "数据处理",
    tag: "Python",
    note: "表格、统计、画图",
    pip: ["numpy", "pandas", "matplotlib", "openpyxl", "xlrd"]
  },
  {
    id: "office",
    name: "办公文档",
    tag: "Python",
    note: "读写 Word、PowerPoint、Excel、PDF；pandoc 转换文档格式",
    pip: ["python-docx", "python-pptx", "openpyxl", "pypdf", "pdfplumber", "reportlab", "markdown", "pypandoc-binary"],
    links: { pandoc: "py/Lib/site-packages/pypandoc/files/pandoc.exe" }
  },
  {
    id: "web",
    name: "网页抓取",
    tag: "Python",
    note: "发请求、解析网页",
    pip: ["requests", "httpx", "beautifulsoup4", "lxml"]
  },
  {
    id: "image",
    name: "图像",
    tag: "Python",
    note: "图片处理、二维码、OpenCV",
    pip: ["pillow", "qrcode", "opencv-python-headless"]
  },
  {
    id: "media",
    name: "音视频",
    tag: "Python",
    note: "ffmpeg 与音频处理",
    pip: ["imageio-ffmpeg", "pydub"],
    links: { ffmpeg: "py/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-*.exe" }
  },
  {
    id: "node",
    name: "前端工具",
    tag: "Node",
    note: "TypeScript、tsx 直接跑 TS、Prettier、本地静态服务；Node 用桥接自己的那一份",
    npm: ["typescript", "tsx", "prettier", "http-server"]
  },
  {
    // zig 自带一整套 clang 与 MinGW 的库：cc、gcc、c++、g++ 都指到它，不必装 Visual Studio
    id: "c",
    name: "C / C++",
    tag: "编译",
    note: "zig 带的 clang：cc、gcc、c++、g++ 直接编，不依赖 Visual Studio；另有 cmake、ninja。约 500 MB",
    pip: ["ziglang", "cmake", "ninja"],
    links: { zig: ZIG, cc: [ZIG, "cc"], gcc: [ZIG, "cc"], "c++": [ZIG, "c++"], "g++": [ZIG, "c++"] },
    hint: "cc / gcc / c++ / g++（zig 的 clang）、cmake、ninja"
  },
  {
    id: "go",
    name: "Go",
    tag: "编译",
    note: "Go 的最新稳定版；go run、go build 即用，下依赖走 goproxy。约 250 MB",
    dir: "go",
    path: ["go/bin", "gopath/bin"],
    vars: (home, mirror) => ({
      GOROOT: path.join(home, "go"),
      GOPATH: path.join(home, "gopath"),
      GOTOOLCHAIN: "local",
      ...(mirror.goproxy ? { GOPROXY: mirror.goproxy } : {})
    }),
    hint: "go",
    async fetch({ home, mirror, download, unpack, say }) {
      let file;
      if (mirror.go) {
        const list = await (await fetch(mirror.go, { signal: AbortSignal.timeout(60000) })).text();
        file = newest([...list.matchAll(/go(\d+)\.(\d+)(?:\.(\d+))?\.windows-amd64\.zip/g)]);
      } else {
        const releases = await (await fetch("https://go.dev/dl/?mode=json", { signal: AbortSignal.timeout(60000) })).json();
        file = releases
          .find(release => release.stable)
          ?.files.find(f => f.os === "windows" && f.arch === "amd64" && f.kind === "archive")?.filename;
      }
      if (!file) throw Error("下载源里没找到 Go");
      say(file);
      // 压缩包里是一层 go/，解到环境根正好是 环境/go
      await unpack(await download(`${mirror.go || "https://go.dev/dl/"}${file}`, file), home);
    }
  },
  {
    // GNU 工具链自带链接器，不依赖 Visual Studio；rustup 与 cargo 都放在环境里，下载源另写在 cargo 的配置里
    id: "rust",
    name: "Rust",
    tag: "编译",
    note: "rustup 管的稳定版，GNU 工具链，不依赖 Visual Studio；cargo 下依赖走同一路下载源。约 850 MB",
    dir: "rust",
    path: ["rust/cargo/bin"],
    vars: rustVars,
    hint: "rustc、cargo",
    async fetch({ home, mirror, download, run, say }) {
      const root = mirror.rustup || "https://static.rust-lang.org",
        init = await download(`${root}/rustup/dist/x86_64-pc-windows-gnu/rustup-init.exe`, "rustup-init.exe"),
        cargo = path.join(home, "rust", "cargo");
      await run(
        init,
        ["-y", "--no-modify-path", "--profile", "minimal", "--default-host", "x86_64-pc-windows-gnu", "--default-toolchain", "stable"],
        { ...process.env, ...rustVars(home, mirror) }
      );
      fs.rmSync(init, { force: true });
      if (mirror.crates) {
        fs.writeFileSync(
          path.join(cargo, "config.toml"),
          `[source.crates-io]\nreplace-with = "mirror"\n\n[source.mirror]\nregistry = "${mirror.crates}"\n`
        );
        say(`cargo 下载源 → ${mirror.crates}`);
      }
    }
  },
  {
    id: "java",
    name: "Java",
    tag: "编译",
    note: "Temurin JDK 21：javac、java、jar。约 330 MB",
    dir: "java",
    path: ["java/bin"],
    vars: home => ({ JAVA_HOME: path.join(home, "java") }),
    hint: "javac、java（JDK 21）",
    async fetch({ home, mirror, download, unpack, say }) {
      let url;
      if (mirror.jdk) {
        const list = await (await fetch(mirror.jdk, { signal: AbortSignal.timeout(60000) })).text();
        const files = [...new Set(list.match(/OpenJDK21U-jdk_x64_windows_hotspot_[\w.+-]+?\.zip/g) || [])].sort((a, b) =>
          versionOf(a).reduce((order, n, i) => order || n - (versionOf(b)[i] || 0), 0)
        );
        if (!files.length) throw Error("下载源里没找到 JDK 21");
        url = mirror.jdk + files.at(-1);
      } else url = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse";
      say(path.basename(url));
      // 压缩包里是一层 jdk-21.x.y+z/：解到临时处再挪成 环境/java
      const temp = path.join(home, "cache", "jdk");
      await unpack(await download(url, "jdk.zip"), temp);
      const inner = fs.readdirSync(temp).find(name => /^jdk/i.test(name));
      if (!inner) throw Error("JDK 压缩包里没有 jdk 目录");
      fs.renameSync(path.join(temp, inner), path.join(home, "java"));
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
];

// 文件名里的版本号取出来比大小（1.23.10 大过 1.23.9）
function versionOf(name) {
  return (name.match(/\d+/g) || []).map(Number);
}
function newest(matches) {
  return matches
    .map(m => m[0])
    .sort((a, b) => versionOf(a).reduce((order, n, i) => order || n - (versionOf(b)[i] || 0), 0))
    .at(-1);
}
