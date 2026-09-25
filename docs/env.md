# 沙箱环境

[← 文档目录](README.md)

在设置 → 环境里给模型备一套自带的开发环境：独立的 Python 3.12（uv 管）与常用工具，装在存储位置的 `环境/` 里，不依赖、也不改动系统里的 Python 与 PATH。桥接起的进程——模型的指令、MCP 服务——都接着它：`python`、`pip`、`uv`、`uvx` 指向环境，`npm i -g` 装进环境，模型缺什么库自己装进来即可。

- 一组工具一张卡，名称在左、状态在右：空框是没选，朱色实心是选了待装，一笔勾是已装；装了又取消勾选的标「待卸」。「准备环境」把环境对齐到勾选——勾上的装，取消的卸（别组或「另装」还用着的包留着）。可选：数据处理（numpy、pandas、matplotlib…）、办公文档（Word、PowerPoint、Excel、PDF 读写，pandoc）、网页抓取、图像（Pillow、OpenCV）、音视频（ffmpeg）、前端工具（TypeScript、tsx、Prettier），以及几套编译工具链：C / C++（zig 带的 clang，`cc`、`gcc`、`c++`、`g++` 都指到它，另有 cmake、ninja，不依赖 Visual Studio）、Go、Rust（rustup 管的 GNU 工具链，同样不依赖 Visual Studio）、Java（Temurin JDK 21）。清单之外的包名可另填。清单在 `server/env/packs.js`，要加一组照样子添一条：PyPI / npm 上有的只写包名，不在上面的写一段 `fetch` 自己下载解压，再写明目录、PATH 与环境变量（如 `GOROOT`、`CARGO_HOME`、`JAVA_HOME`）。
- 下载源：国内镜像走清华（PyPI）、中科大（Python 本体）、npmmirror、南大（Go、Rust、JDK）、goproxy.cn 与 rsproxy（crates），官方各走各家；模型往后自己装包（pip、npm、go get、cargo）也走这一路。只装 Python 那几组约一两分钟；编译工具链大（C / C++ 约 500 MB、Go 约 250 MB、Rust 约 850 MB、Java 约 330 MB），卡上写着。
- uv 装 Python 时不往 `~.localin` 放入口、不往注册表里登记，入口都在 `环境/bin`。
- 装在包里、名字不规整的可执行文件（如 imageio-ffmpeg 带的 ffmpeg）在 `环境/bin` 立一个同名入口。
- 换存储位置时环境不随之拷走（虚拟环境里记着绝对路径），到新处重新准备一遍即可；「清空」整个删去。
