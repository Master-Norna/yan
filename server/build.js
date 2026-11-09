#!/usr/bin/env node
// 拼接规则：prompts/ 与 src/ 下的 .js 拼成页面请求的 /support.js、styles/ 下的 .css 拼成 /app.css（零依赖，没有转译；子目录就地展开）。
// 内置提示词排在最前、闭包之外：各自往 window.YAN_PROMPTS 上挂一份，src/ 开头取用；加一份提示词只需放进目录。
// 桥接按请求即时拼（../server.js），改完刷新即生效；不落成文件——言离不开桥接，没有谁读一份落盘的产物，留着只会与源码对不上。
// 单元测试（test/unit/harness.mjs）照同一份清单拼
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src"),
  PROMPTS = path.join(ROOT, "prompts"),
  STYLES = path.join(ROOT, "styles");
const SCRIPT_HEAD = '(() => {\n  "use strict";\n',
  SCRIPT_TAIL = "})();\n";

// 按名字排序逐段拼；子目录就地展开（如 src/15-tools/），目录名的序号定它在整体里的位置
function partsOf(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith("."))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(entry => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return partsOf(file, extension);
      return entry.name.endsWith(extension) ? [file] : [];
    });
}
// 段名写相对于仓库的路径：src/15-tools/10-web.js
const partName = file => path.relative(ROOT, file).replace(/\\/g, "/");
// 版本戳：文件名、大小、修改时间一起算，任何一段改了都会变
function stampOf(files) {
  return files
    .map(file => {
      const stat = fs.statSync(file);
      return `${partName(file)}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    })
    .join("|");
}
// 逐段接起，每段前一行注释标出段名（open / close 是注释的两头）
const joinParts = (files, open, close = "") =>
  files
    .map(file => {
      const text = fs.readFileSync(file, "utf8");
      return `${open} ---- ${partName(file)} ----${close}\n${text.endsWith("\n") ? text : text + "\n"}`;
    })
    .join("\n");
function bundleScript() {
  const prompts = partsOf(PROMPTS, ".js"),
    sources = partsOf(SRC, ".js"),
    files = [...prompts, ...sources];
  return { text: `${joinParts(prompts, "//")}\n${SCRIPT_HEAD}${joinParts(sources, "  //")}${SCRIPT_TAIL}`, stamp: stampOf(files), files };
}
function bundleStyles() {
  const files = partsOf(STYLES, ".css");
  return { text: joinParts(files, "/*", " */"), stamp: stampOf(files), files };
}
module.exports = {
  bundleScript,
  bundleStyles,
  scriptParts: () => partsOf(SRC, ".js"),
  promptParts: () => partsOf(PROMPTS, ".js"),
  SCRIPT_HEAD,
  SCRIPT_TAIL
};
