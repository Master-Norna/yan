// 言 · 环境的工具包：设置里一张卡片一件，勾上的在「准备环境」时装进 <存储根>/环境/。
// pip 装进环境里的 Python（uv 管的 3.12），npm 装进环境里的 Node 全局目录；links 给装在包里、名字不规整的可执行文件在 环境/bin 立个同名的入口。
// 要加一组，照样子添一条即可
"use strict";
module.exports = [
  {
    id: "python",
    name: "Python 3.12",
    note: "独立的 Python 与 pip、uv；不依赖也不改动系统里的 Python。其余 Python 工具包都以它为底",
    base: true
  },
  {
    id: "data",
    name: "数据处理",
    note: "表格、统计、画图",
    pip: ["numpy", "pandas", "matplotlib", "openpyxl", "xlrd"]
  },
  {
    id: "office",
    name: "办公文档",
    note: "读写 Word、PowerPoint、Excel、PDF；pandoc 转换文档格式",
    pip: ["python-docx", "python-pptx", "openpyxl", "pypdf", "pdfplumber", "reportlab", "markdown", "pypandoc-binary"],
    links: { pandoc: "py/Lib/site-packages/pypandoc/files/pandoc.exe" }
  },
  {
    id: "web",
    name: "网页抓取",
    note: "发请求、解析网页",
    pip: ["requests", "httpx", "beautifulsoup4", "lxml"]
  },
  {
    id: "image",
    name: "图像",
    note: "图片处理、二维码、OpenCV",
    pip: ["pillow", "qrcode", "opencv-python-headless"]
  },
  {
    id: "media",
    name: "音视频",
    note: "ffmpeg 与音频处理",
    pip: ["imageio-ffmpeg", "pydub"],
    links: { ffmpeg: "py/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-*.exe" }
  },
  {
    id: "node",
    name: "前端工具",
    note: "TypeScript、tsx 直接跑 TS、Prettier、本地静态服务；Node 用桥接自己的那一份",
    npm: ["typescript", "tsx", "prettier", "http-server"]
  }
];
