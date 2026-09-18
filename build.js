#!/usr/bin/env node
// 把 src/*.js 拼成 support.js、styles/*.css 拼成 app.css（零依赖，没有转译）。
// 桥接在线时页面直接从 src/ 与 styles/ 即时拼接，改完刷新即生效；这里产出的文件供 file:// 直接打开与不带桥接的场景使用。
// 用法：node build.js            也可 require 后调用 bundleScript() / bundleStyles()
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src"),
  STYLES = path.join(ROOT, "styles");
const SCRIPT_HEAD = '(() => {\n  "use strict";\n',
  SCRIPT_TAIL = "})();\n";

function partsOf(dir, extension) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(name => name.endsWith(extension) && !name.startsWith("."))
    .sort()
    .map(name => path.join(dir, name));
}
// 版本戳：文件名、大小、修改时间一起算，任何一段改了都会变
function stampOf(files) {
  return files
    .map(file => {
      const stat = fs.statSync(file);
      return `${path.basename(file)}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    })
    .join("|");
}
function bundleScript() {
  const files = partsOf(SRC, ".js");
  const body = files
    .map(file => {
      const text = fs.readFileSync(file, "utf8");
      return `  // ---- ${path.basename(file)} ----\n${text.endsWith("\n") ? text : text + "\n"}`;
    })
    .join("\n");
  return { text: SCRIPT_HEAD + body + SCRIPT_TAIL, stamp: stampOf(files), files };
}
function bundleStyles() {
  const files = partsOf(STYLES, ".css");
  const body = files
    .map(file => {
      const text = fs.readFileSync(file, "utf8");
      return `/* ---- ${path.basename(file)} ---- */\n${text.endsWith("\n") ? text : text + "\n"}`;
    })
    .join("\n");
  return { text: body, stamp: stampOf(files), files };
}
function writeIfChanged(file, text) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (current === text) return false;
  fs.writeFileSync(file, text, "utf8");
  return true;
}
function build({ quiet = false } = {}) {
  const script = bundleScript(),
    styles = bundleStyles();
  const written = [];
  if (script.files.length && writeIfChanged(path.join(ROOT, "support.js"), script.text)) written.push("support.js");
  if (styles.files.length && writeIfChanged(path.join(ROOT, "app.css"), styles.text)) written.push("app.css");
  if (!quiet)
    console.log(
      written.length
        ? `已产出 ${written.join("、")}（${script.files.length} 段脚本，${styles.files.length} 段样式）`
        : "support.js 与 app.css 已是最新"
    );
  return written;
}

module.exports = { bundleScript, bundleStyles, build, SCRIPT_HEAD, SCRIPT_TAIL };
if (require.main === module) build();
