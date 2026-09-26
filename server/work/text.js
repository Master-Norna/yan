// 言 · 桥接 · 执事的文字：文本文件的编码认读与写回、PowerShell 的编码指令与 CLIXML 报错还原、截尾、数行。纯函数
"use strict";
const { decodeEntities } = require("../web.js");

function tail(text, limit) {
  return text.length > limit ? `…（前面 ${text.length - limit} 字已省略）\n${text.slice(-limit)}` : text;
}
// PowerShell 脚本一律走 -EncodedCommand（UTF-16LE base64）：引号、换行、$ 符号都不经过命令行解析
function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}
// stderr 被重定向时，PowerShell 会把错误记录序列化成 CLIXML（#< CLIXML <Objs>…）；还原成纯文字，模型与步骤卡看到的都是可读的报错
function decodeClixml(text) {
  if (!text.includes("#< CLIXML") && !text.includes('<S S="Error">')) return text;
  const unescape = value => decodeEntities(value).replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const errorsOf = block => [...block.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map(match => unescape(match[1])).join("");
  return text
    .replace(/#< CLIXML\r?\n?<Objs[\s\S]*?<\/Objs>/g, errorsOf)
    .replace(/<Obj S="progress"[\s\S]*?<\/Obj>/g, "")
    .replace(/<S S="Error">([\s\S]*?)<\/S>/g, (_, body) => unescape(body))
    .replace(/#< CLIXML\r?\n?|<\/?Objs[^>]*>/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}
// 文本文件的编码：UTF-8（可带 BOM）为常；Windows PowerShell 5.1 的 > 与 Out-File 写出的是带 BOM 的 UTF-16LE，老的中文文件多是 GBK。
// 认得出的都解成文字，真是二进制（没有 BOM 却有 NUL）才回 null。UTF-8 里夹着零星几个坏字节的仍按 UTF-8 读，不整篇改按 GBK 读成乱码
function decodeText(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8-bom" };
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf-16le" };
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const body = Buffer.from(buffer.subarray(2, 2 + ((buffer.length - 2) & ~1)));
    return { text: body.swap16().toString("utf16le"), encoding: "utf-16be" };
  }
  if (buffer.subarray(0, 4096).includes(0)) return null;
  const text = buffer.toString("utf8"),
    bad = (text.match(/�/g) || []).length;
  if (!bad || bad < text.length / 100) return { text, encoding: "utf-8" };
  return { text: new TextDecoder("gb18030").decode(buffer), encoding: "gbk" };
}
// 按原来的编码写回；GBK 编不回去（Node 只会编 UTF-8 / UTF-16），给 null，由调用者拒绝
function encodeText(text, encoding) {
  if (encoding === "utf-8") return Buffer.from(text, "utf8");
  if (encoding === "utf-8-bom") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
  if (encoding === "utf-16le") return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  if (encoding === "utf-16be") return Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]);
  return null;
}
// 行数按惯例：末尾的换行不算多一行（"a\nb\n" 是 2 行），空文件 0 行
function countLines(text) {
  const value = String(text || "");
  if (!value) return 0;
  return value.split(/\r?\n/).length - (/\r?\n$/.test(value) ? 1 : 0);
}

module.exports = { tail, encodePowerShell, decodeClixml, decodeText, encodeText, countLines };
