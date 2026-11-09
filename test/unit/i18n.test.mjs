// 多语言：中文界面 t 原样返回；英文表的译文与原文的变量对得上；带变量的句子、单复数、桥接回的整句报错照表换
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "./harness.mjs";
const EN = createRequire(import.meta.url)("../../i18n/en.js");

test("中文界面：t 与 tr 原样返回", () => {
  const { t, tr, LANG } = load(["t", "tr", "LANG"]);
  assert.equal(LANG, "zh");
  assert.equal(t("测试连接"), "测试连接");
  const n = 3;
  assert.equal(t`已取回 ${n} 个模型`, "已取回 3 个模型");
  assert.equal(tr("连不上上游接口：ECONNREFUSED"), "连不上上游接口：ECONNREFUSED");
});

test("文字解码：空文件、单字节、UTF-16 都解得开", () => {
  const { decodeTextBytes } = load(["decodeTextBytes"]);
  assert.equal(decodeTextBytes(new Uint8Array(0)), "");
  assert.equal(decodeTextBytes(new Uint8Array([0x61])), "a");
  assert.equal(decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x61, 0x00])), "a");
  assert.equal(decodeTextBytes(new Uint8Array([0x61, 0x62, 0x63]).subarray(2)), "c");
});

test("英文表：译文里的变量都出自原文，原文的变量译文都用上了", () => {
  const indices = text => new Set([...text.matchAll(/\{(\d+)(?:\|[^}]*)?\}/g)].map(m => m[1]));
  for (const [key, value] of Object.entries(EN)) {
    assert.equal(typeof value, "string", key);
    assert.ok(value.length > 0, `空译文：${key}`);
    const from = indices(key),
      to = indices(value);
    for (const i of to) assert.ok(from.has(i), `译文多出 {${i}}：${key}`);
    for (const i of from) assert.ok(to.has(i), `译文漏了 {${i}}：${key}`);
  }
});

// 源码里 t("…")、t`…${x}…` 的键（变量记作 {0}、{1}……，同 t 的拼法）；嵌着的模板与字符串跳过，注释行不算
function sourceKeys(src) {
  src = src.replace(/^\s*(?:\/\/|\/?\*).*$/gm, "");
  const keys = [],
    cook = text => text.replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t" })[c] ?? c);
  for (const m of src.matchAll(/\bt\(\s*(["'`])((?:(?!\1)[^\\$]|\\.)*)\1\s*\)/g)) keys.push(cook(m[2]));
  for (let at = src.indexOf("t`"); at >= 0; at = src.indexOf("t`", at + 2))
    if (!/[\w$.]/.test(src[at - 1] || "")) keys.push(cook(readTemplate(src, at + 2)[0]));
  return keys;
}
function readTemplate(src, i) {
  let key = "",
    n = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      key += src.slice(i, i + 2);
      i += 2;
    } else if (c === "`") return [key, i + 1];
    else if (c === "$" && src[i + 1] === "{") {
      i = skipExpr(src, i + 2);
      key += `{${n++}}`;
    } else {
      key += c;
      i++;
    }
  }
  return [key, i];
}
function skipExpr(src, i) {
  let depth = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "`") i = readTemplate(src, i + 1)[1];
    else if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i += src[i] === "\\" ? 2 : 1);
      i++;
    } else {
      if (c === "{") depth++;
      else if (c === "}" && !--depth) return i + 1;
      i++;
    }
  }
  return i;
}
// 给模型看的话（工具结果、对话引擎拼的上下文、意的校验）不进表，这几处整片不查；界面上的零星几句另记
const MODEL_FACING = ["14-chat-engine/", "15-tools/", "19-intent/00-core.js", "13-files/30-extract.js"];
const MODEL_KEYS = new Set([
  "我说「打开浏览器」即指这个",
  "点：网页左 {0}、上 {1}{2}",
  "圈：网页左 {0}、上 {1}，宽 {2}、高 {3}{4}",
  "划：自网页左 {0}、上 {1} 至左 {2}、上 {3}{4}",
  "游目 · {0}{1}",
  "附图「{0}」上的朱笔是用户画上去的；位置是网页视口里的 CSS 像素，与附图同一取景",
  "网页里选中的一段：{0}",
  "音{0}" // 音量那一排点前的字，同印章
]);

test("英文表：界面上用到的话都有译文（印章即单个汉字，不译）", () => {
  const root = fileURLToPath(new URL("../../src/", import.meta.url)),
    missing = [];
  for (const rel of readdirSync(root, { recursive: true })) {
    const file = String(rel).replace(/\\/g, "/");
    if (!file.endsWith(".js") || MODEL_FACING.some(prefix => file.startsWith(prefix))) continue;
    for (const key of sourceKeys(readFileSync(root + file, "utf8"))) {
      const han = key.replace(/\{\d+\}/g, "").match(/[一-鿿]/g) || [];
      if (han.length > 1 && !EN[key] && !MODEL_KEYS.has(key)) missing.push(`${file}：${key}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test("英文界面：整句、带变量的句子、单复数、桥接的报错", () => {
  globalThis.YAN_EN = EN;
  try {
    const { t, tr, LANG } = load(["t", "tr", "LANG"]);
    assert.equal(LANG, "en");
    assert.equal(t("测试连接"), "Test connection");
    assert.equal(t("表里没有的话"), "表里没有的话");
    const one = 1,
      many = 3;
    assert.equal(t`已取回 ${many} 个模型`, "Fetched 3 models");
    assert.equal(t`${one}问`, "1 question");
    assert.equal(t`${many}问`, "3 questions");
    // 桥接回的整句：变量里的中文也照表换
    assert.equal(tr("连不上上游接口：ECONNREFUSED"), "Can't reach the API: ECONNREFUSED");
    assert.equal(tr("搜索引擎暂时不可用：连接超时"), "Search engine unavailable: Connection timed out");
    // 几乎全是变量的句式不拿来套别的话
    assert.equal(tr("这一问没有结果"), "这一问没有结果");
    // 步骤上存的是中文原文，画出来时照语言换；嵌着的几段也各自换
    const { stepText } = load(["stepText"]);
    assert.equal(stepText("已写入"), "Written");
    assert.equal(stepText("12 行 · 3 KB · 覆盖"), "12 lines · 3 KB · overwrite");
    assert.equal(stepText("后台 b1 · 已结束 · 退出码 0 · 出沙箱"), "Background b1 · finished · exit code 0 · outside sandbox");
    assert.equal(stepText(undefined), "");
    // 变量本就是中文（查的关键词）：句式照换，关键词原样留着
    assert.equal(stepText("关键词「中文」"), 'Query "中文"');
    assert.equal(stepText("关键词「中文」 · 已写入"), 'Query "中文" · Written');
  } finally {
    delete globalThis.YAN_EN;
  }
});
