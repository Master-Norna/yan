// 言 · 多语言：中文原文即键。选了英文时 theme-boot 先载入 i18n/en.js（全局 YAN_EN），这里照表换；表里没有的照原文。
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 两种写法：t("测试连接") 换整句；t`已写入 ${n} 行` 是带变量的句子，键里变量记作 {0}、{1}……译文可以换序。
// 印章、给模型看的话（工具结果、提示词）不进表，照原文
/** @type {Record<string, string> | null} */
const I18N = typeof YAN_EN === "object" && YAN_EN ? YAN_EN : null;
const LANG = I18N ? "en" : "zh";
// 译文里填变量：{0} 照填；{0|question|questions} 按 {0} 是不是 1 挑单复数
/** @param {string} template @param {(i: string) => string} get */
const fillIn = (template, get) =>
  template.replace(/\{(\d+)(?:\|([^|}]*)\|([^}]*))?\}/g, (_, i, one, many) =>
    one === undefined ? get(i) : Number(get(i)) === 1 ? one : many
  );
/**
 * @param {string | TemplateStringsArray} text
 * @param {...any} values
 * @returns {string}
 */
function t(text, ...values) {
  if (typeof text === "string") return (I18N && I18N[text]) || text;
  const cooked = () => text.reduce((out, part, i) => out + String(values[i - 1]) + part);
  if (!I18N) return cooked();
  const hit = I18N[text.reduce((key, part, i) => `${key}{${i - 1}}${part}`)];
  return hit ? fillIn(hit, i => String(values[Number(i)])) : cooked();
}
// 现成的一句话（多是桥接回的报错，在桥接那头已拼好）：整句查表，查不到再按带 {0} 的句式认。
// 报错原文在逻辑里照旧是中文（有的比对靠它），只在显示的出口换：提示条、对话里的报错、设置里的状态行
// 存进数据的字（步骤上的摘要、消息上的报错）一律存中文原文，画出来时过 tr：换了语言，旧记录跟着换
/** @type {{ re: RegExp, en: string, han: number, literal: Set<string>, count: boolean }[] | null} */
let patterns = null;
/**
 * @param {string} text
 * @param {boolean} [loose] 来路明确的短句（步骤摘要）：句式里只有一两个汉字的也认；平常只认至少三个汉字的——
 *   「{0}问{1}」这种几乎全是变量的，拿去套来路不明的话，什么都对得上
 */
function tr(text, loose = false) {
  text = String(text ?? "");
  if (!I18N || !text) return text;
  if (I18N[text]) return I18N[text];
  // 字面长的句式在前：几条都对得上时取最具体的那条
  patterns ||= Object.keys(I18N)
    .filter(key => /\{\d+\}/.test(key))
    .map(key => ({
      re: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{(\d+)\\\}/g, (_, i) => `(?<g${i}>[\\s\\S]*?)`)}$`),
      en: I18N[key],
      // 引号里的名字、关键词是数据，不是待翻译的状态；图的节点名也是如此。
      literal: new Set([...Array.from(key.matchAll(/「\{(\d+)\}」/g), m => m[1]), ...(key === "已立 {0} / {1} · {2}" ? ["2"] : [])]),
      count: /^\{0\}\s*(?:问|秒|件|字|步|条|轮|行|项|处|段|页|类|夹|分|小时|天)(?=\{|\s|$)/.test(key),
      han: (key.replace(/\{\d+\}/g, "").match(/[一-鿿]/g) || []).length
    }))
    .filter(p => p.han)
    .sort((a, b) => b.han - a.han);
  // 宽认时换出来还带汉字的先放着、接着找更贴的一条：可能是套错了句式，也可能变量本就是中文（查的关键词、文件名）——都找不到更好的就用它
  let partial = "";
  for (const { re, en, han, literal, count } of patterns) {
    if (han < 3 && !loose) break;
    const m = text.match(re);
    if (count && !/^\d+(?:\.\d+)?$/.test(m?.groups?.g0 || "")) continue;
    if (m && !/[一-鿿]/.test(en)) {
      const out = fillIn(en, i => {
        const value = m.groups?.[`g${i}`] ?? "";
        return literal.has(i) ? value : tr(value, loose);
      });
      if (!loose || literal.size || !/[一-鿿]/.test(out)) return out;
      partial ||= out;
    }
  }
  // 步骤摘要多是「 · 」串起来的几段（行数 · 大小 · 覆盖）：整句对不上就逐段换，单段也认表里带「 · 」头的那条
  const pieces = [];
  let quoted = 0,
    start = 0;
  if (loose)
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "「") quoted++;
      else if (text[i] === "」") quoted = Math.max(0, quoted - 1);
      else if (!quoted && text.startsWith(" · ", i)) {
        pieces.push(text.slice(start, i));
        start = i + 3;
        i += 2;
      }
    }
  if (pieces.length) {
    pieces.push(text.slice(start));
    const parts = pieces.map(part => {
      const hit = I18N[part] || I18N[` · ${part}`]?.replace(/^ · /, "");
      return hit || tr(part, true);
    });
    const joined = parts.join(" · ");
    if (!partial || !/[一-鿿]/.test(joined)) return joined;
  }
  return partial || text;
}
// 步骤上存的摘要（程序自己拼的短句，存的是中文原文）画出来时用它；模型、用户写的自由文字不过这个
/** @param {string | undefined} text */
const stepText = text => tr(text, true);
// index.html 里写死的字：开页时照表换一遍（文字与 title、placeholder、aria-label 几样属性）
function translateStatic(root = document.body) {
  if (!I18N) return;
  document.documentElement.lang = "en";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue || "",
      text = raw.trim();
    // 印章保留原字，不随界面语言变化
    if (text && I18N[text] && !node.parentElement?.closest(".seal")) node.nodeValue = raw.replace(text, I18N[text]);
  }
  for (const el of root.querySelectorAll("[title],[placeholder],[aria-label],[data-tip]"))
    for (const name of ["title", "placeholder", "aria-label", "data-tip"]) {
      const value = el.getAttribute(name);
      if (value && I18N[value]) el.setAttribute(name, I18N[value]);
    }
  const title = document.title;
  if (I18N[title]) document.title = I18N[title];
}
