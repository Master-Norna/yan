// 言 · 文件 · 种类：一种文件一份登记——卷宗的件图与筛选、预览器怎么看、附件当不当文字读、文档的正文怎么抽，都照这张表认
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 一份登记：
//   exts     认哪些扩展名
//   group    大类：image / audio / video / text / file——卷宗页按它筛，image 点开进看图，text 的当文字读（附件原样带给模型）
//   figure   卷宗里的件图（见 10-archive.js 的 FIGURE_MARKS）
//   view     预览器怎么看：image / pdf / audio / video / html / table / markdown / doc / text；不给即预览不了（见 20-viewer.js）
//   extract  正文怎么抽：pdf 交给 pdf.js，zip 是 Office / ODF 一类压缩包里的 XML，ipynb 是笔记本那份 JSON（见 30-extract.js）
// 加一种文件只需一份登记；某一面要一种新的看法（如新的 view），在那一面添上，再在登记里点名
/** @typedef {{ name: string, exts: string[], group: "image"|"audio"|"video"|"text"|"file", figure: string, view?: string, extract?: "pdf"|"zip"|"ipynb" }} FileKind */
/** @type {FileKind[]} */
const FILE_KINDS = [
  {
    name: "image",
    exts: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "ico", "svg"],
    group: "image",
    figure: "image",
    view: "image"
  },
  {
    name: "audio",
    exts: ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba"],
    group: "audio",
    figure: "audio",
    view: "audio"
  },
  { name: "video", exts: ["mp4", "m4v", "webm", "ogv", "mov", "mkv"], group: "video", figure: "video", view: "video" },
  { name: "pdf", exts: ["pdf"], group: "file", figure: "doc", view: "pdf", extract: "pdf" },
  { name: "document", exts: ["docx", "odt"], group: "file", figure: "doc", view: "doc", extract: "zip" },
  { name: "sheet", exts: ["xlsx", "ods"], group: "file", figure: "table", view: "doc", extract: "zip" },
  { name: "slides", exts: ["pptx", "odp"], group: "file", figure: "slides", view: "doc", extract: "zip" },
  // 笔记本：一格一节，Markdown 与代码照原样、代码的输出跟在下面；不当文字读，不然模型收到的是一段几万字的 JSON
  { name: "notebook", exts: ["ipynb"], group: "file", figure: "code", view: "doc", extract: "ipynb" },
  // 认得出、抽不出正文的旧格式与压缩包：只画件图
  { name: "legacy-document", exts: ["doc", "rtf", "epub"], group: "file", figure: "doc" },
  { name: "legacy-sheet", exts: ["xls"], group: "file", figure: "table" },
  { name: "legacy-slides", exts: ["ppt", "key"], group: "file", figure: "slides" },
  { name: "archive", exts: ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"], group: "file", figure: "zip" },
  { name: "html", exts: ["html", "htm", "xhtml"], group: "text", figure: "html", view: "html" },
  { name: "table", exts: ["csv", "tsv"], group: "text", figure: "table", view: "table" },
  { name: "markdown", exts: ["md", "markdown", "mdx"], group: "text", figure: "text", view: "markdown" },
  { name: "plain", exts: ["txt", "log", "rst", "srt", "vtt", "diff", "patch"], group: "text", figure: "text", view: "text" },
  // 代码与配置：认得出就当文字看（预览给源码、附件原样带进上下文），不必为每种语言单开一栏
  {
    name: "code",
    exts: [
      // 通用与配置
      "json",
      "jsonl",
      "xml",
      "yaml",
      "yml",
      "toml",
      "ini",
      "cfg",
      "conf",
      "properties",
      "env",
      "lock"
    ].concat([
      // 前端
      "js",
      "mjs",
      "cjs",
      "ts",
      "tsx",
      "jsx",
      "css",
      "scss",
      "less",
      "vue",
      "svelte",
      "astro",
      "hbs",
      "ejs",
      "pug",
      // 脚本与系统
      "py",
      "rb",
      "php",
      "pl",
      "lua",
      "r",
      "jl",
      "go",
      "rs",
      "zig",
      "nim",
      "c",
      "h",
      "cpp",
      "hpp",
      "cc",
      "cs",
      "java",
      "kt",
      "kts",
      "scala",
      "groovy",
      "gradle",
      "swift",
      "dart",
      "m",
      "mm",
      "fs",
      "fsx",
      "hs",
      "ml",
      "clj",
      "ex",
      "exs",
      "erl",
      "sol",
      "asm",
      "s",
      "v",
      // 命令行
      "sh",
      "bash",
      "zsh",
      "fish",
      "bat",
      "cmd",
      "ps1",
      "psm1",
      "psd1",
      // 构建、查询与文档源
      "cmake",
      "mk",
      "bazel",
      "sql",
      "graphql",
      "gql",
      "proto",
      "tex",
      "bib",
      "sty",
      "cls"
    ]),
    group: "text",
    figure: "code",
    view: "text"
  }
];
/** @type {FileKind} 认不出的 */
const OTHER_FILE = { name: "other", exts: [], group: "file", figure: "other" };
const FILE_KIND_BY_EXT = new Map(FILE_KINDS.flatMap(kind => kind.exts.map(ext => /** @type {[string, FileKind]} */ ([ext, kind]))));
function fileExtension(name) {
  return String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
}
/** @returns {FileKind} */
function fileKind(name) {
  return FILE_KIND_BY_EXT.get(fileExtension(name)) || OTHER_FILE;
}
// 当不当文字读：浏览器报的类型（拖进来、选进来的文件带着）认得出的，或扩展名在表里属文字一类的
const TEXT_MIMES = [
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/typescript",
  "application/yaml",
  "application/x-yaml",
  "application/csv"
];
function isTextFile(file) {
  const mime = String(file.type || "").toLowerCase();
  // 要抽正文的种类（docx / xlsx / ipynb 之类）即便 MIME 报成 application/json 也不当文字读：
  // 那样进上下文的是整份原始的包或 JSON（ipynb 里还有 base64 的图），抽出来的才是能读的正文
  if (fileKind(file.name).extract) return false;
  return (
    mime.startsWith("text/") ||
    TEXT_MIMES.includes(mime) ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml") ||
    fileKind(file.name).group === "text"
  );
}
