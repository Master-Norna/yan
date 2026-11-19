# 沙箱环境

[← 文档目录](README.md) · [English](en/env.md)

在 Windows 的「设置 → 环境」里给模型备一套自带的开发环境：独立的 Python 3.12（uv 管）与常用工具，装在存储位置的 `环境/` 里，不依赖、也不改动系统里的 Python 与 PATH。桥接起的进程——模型的指令、MCP 服务——都接着它：`python`、`pip`、`uv`、`uvx` 指向环境，`npm i -g` 装进环境，模型缺什么库自己装进来即可。

macOS 上，「系统工具」卡列出探到的 Python、Node 与 ffmpeg 的版本与路径，没探到的标「未找到」。桥接首次需要时自动探测，也可点「重新探测」。每个程序名先查 Homebrew 常用的两个目录（`/opt/homebrew/bin` 与 `/usr/local/bin`），再查桥接的 PATH；Python 优先找 `python3`，其次才找 `python`。只认能报版本的程序。存在的那两处 bin 目录接到桥接所起进程的 PATH 前面，探到工具的目录优先；需要用到状态卡上的那一份时，按卡上路径调用。视频预览换壳也可借用探到的系统 ffmpeg。工具包、「另装」和「清空」不在 macOS 的环境页上显示。系统提示也照实说：Windows 备好环境时告诉模型里头有哪些、缺的往环境里装；macOS 上没有另备的环境，只说系统里现成的是哪几件（给探到的路径——PATH 里的未必就是它们），一件都没探到就不提。

- 一组工具一张卡，名称在左、状态在右：空框是没选，朱色实心是选了待装，一笔勾是已装；装了又取消勾选的标「待卸」。「准备环境」把环境对齐到勾选——勾上的装，取消的卸（别组或「另装」还用着的包留着）。可选：数据处理（numpy、pandas、matplotlib…）、办公文档（Word、PowerPoint、Excel、PDF 读写，pandoc）、网页抓取、图像（Pillow、OpenCV）、音视频（ffmpeg；桥接预览视频时也借它：扩展名是 mp4、里头却是 MPEG-TS 这类浏览器认不得的封装，原样换进 MP4 的壳再放，不重新编码，换好的在 `环境/cache/视频/` 留最近三件，见 `server/video.js`）、前端工具（TypeScript、tsx、Prettier），以及几套编译工具链：C / C++（zig 带的 clang，`cc`、`gcc`、`c++`、`g++` 都指到它，另有 cmake、ninja，不依赖 Visual Studio）、Go、Rust（rustup 管的 GNU 工具链，同样不依赖 Visual Studio）、Java（Temurin JDK 21）。清单之外的包名可另填。清单在 `server/env/packs.js`，要加一组照样子添一条：PyPI / npm 上有的只写包名，不在上面的写一段 `fetch` 自己下载解压，再写明目录、PATH 与环境变量（如 `GOROOT`、`CARGO_HOME`、`JAVA_HOME`）。
- 下载源：国内镜像走清华（PyPI）、中科大（Python 本体）、npmmirror、南大（Go、Rust、JDK）、goproxy.cn 与 rsproxy（crates），官方各走各家。走哪一路不必选：准备时比较镜像与官方源下载同一个常用包开头 2 MB 的速度，默认走镜像，官方明显更快才用官方（见 `server/mirror.js`），记在「已备.json」里；模型往后自己装包（pip、npm、go get、cargo）也走这一路。只装 Python 那几组约一两分钟；编译工具链大（C / C++ 约 500 MB、Go 约 250 MB、Rust 约 850 MB、Java 约 330 MB），卡上写着。
- uv 装 Python 时不往 `~\.local\bin` 放入口、不往注册表里登记，入口都在 `环境/bin`。
- 装在包里、名字不规整的可执行文件（如 imageio-ffmpeg 带的 ffmpeg）在 `环境/bin` 立一个同名入口。
- 「清空」会删去整个环境目录。准备和清空不能同时进行；任一作业未结束时，都不能换存储位置。环境不随存储位置拷走（虚拟环境里记着绝对路径），旧处的进度与日志也不带过去。
