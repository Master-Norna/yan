// xlsx 的数字格式与 ipynb 的围栏：格子只存数值，看起来的样子全在 styles.xml 里；
// 笔记本的围栏要比内容里最长的一串反引号还长，不然会从代码中间闭合
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./harness.mjs";

const { xlsxNumber, ipynbMarkdown, isTextFile } = load(["xlsxNumber", "ipynbMarkdown", "isTextFile"]);

test("日期、时刻、经过时长各是各的", () => {
  // 18 号是内置的 h:mm AM/PM，纯时刻：0.5 天就是 12:00，不该带出一个 1899-12-31
  assert.equal(xlsxNumber("0.5", 18, undefined, false), "12:00");
  // 21 号带秒
  assert.equal(xlsxNumber("0.5", 21, undefined, false), "12:00:00");
  // 45 号是 mm:ss，格式里没有小时，就从分钟起
  assert.equal(xlsxNumber("0.5", 45, undefined, false), "00:00");
  // 46 号是经过时长：[h]:mm:ss 的 36 小时写 36:00:00，不绕回 12:00、也不进位成 1900-01-01
  assert.equal(xlsxNumber("1.5", 46, undefined, false), "36:00:00");
  // 14 号是日期
  assert.equal(xlsxNumber("45306", 14, undefined, false), "2024-01-15");
  // 22 号日期带时刻
  assert.equal(xlsxNumber("45306.5", 22, undefined, false), "2024-01-15 12:00");
  // 自定义的中文日期格式（引号里的字是字面量，不当作指示符）
  assert.equal(xlsxNumber("45306", 164, `yyyy"年"m"月"d"日"`, false), "2024-01-15");
});

test("百分比与千分位都照格式写小数位", () => {
  assert.equal(xlsxNumber("0.5", 9, undefined, false), "50%");
  assert.equal(xlsxNumber("0.235", 10, undefined, false), "23.50%");
  // 五位小数的格式：0.0000123 是 0.00123%，一律压到两位就成了 0%
  assert.equal(xlsxNumber("0.0000123", 164, "0.00000%", false), "0.00123%");
  // 千分位同理：#,##0 没有小数位（Excel 显示 12,346），#,##0.00 有两位
  assert.equal(xlsxNumber("12345.6", 3, undefined, false), "12,346");
  assert.equal(xlsxNumber("12345.6", 4, undefined, false), "12,345.60");
  assert.equal(xlsxNumber("12345.678", 164, "#,##0.0", false), "12,345.7");
  // 不带千分位的纯数字格式也照小数位写
  assert.equal(xlsxNumber("48.9", 164, "0.00", false), "48.90");
  assert.equal(xlsxNumber("48.9", 2, undefined, false), "48.90");
});

test("不擅加分组、不误判带缩放的逗号，正半负半都向外取整", () => {
  assert.equal(xlsxNumber("12345.6", 2, undefined, false), "12345.60");
  assert.equal(xlsxNumber("1234567", 164, "0,", false), "1234567");
  assert.equal(xlsxNumber("-2.5", 1, undefined, false), "-3");
  assert.equal(xlsxNumber("0.5", 164, "h:mm;[m]:ss", false), "12:00");
});

test("含条件的数字格式保留原值，不把颜色、累计单位或引号内的文字当条件", () => {
  assert.equal(xlsxNumber("0.25", 164, "[>=100]0.0%;0.00", false), "0.25");
  assert.equal(xlsxNumber("0.25", 164, "0.0%;[<0]0.00", false), "0.25");
  assert.equal(xlsxNumber("45306", 164, "[=1]yyyy-mm-dd;0", false), "45306");
  assert.equal(xlsxNumber("12345.6", 164, "[Red]#,##0.00", false), "12,345.60");
  assert.equal(xlsxNumber("1.5", 164, "[h]:mm:ss", false), "36:00:00");
  assert.equal(xlsxNumber("0.25", 164, `"[>=100]"0.0%`, false), "25.0%");
});

test("格式里的 # 是「有才写」的可选小数位，末尾的 0 收掉、非零留着", () => {
  // 0.##% 的 0.235 是 23.5%，不是 24%——只数 0 会把它当没有小数位
  assert.equal(xlsxNumber("0.235", 164, "0.##%", false), "23.5%");
  // 五位可选位：0.0000123 是 0.00123%
  assert.equal(xlsxNumber("0.0000123", 164, "0.#####%", false), "0.00123%");
  // 必写位（0）留着、可选位（#）收掉：0.00# 的 23.5 是 23.50
  assert.equal(xlsxNumber("0.235", 164, "0.00#%", false), "23.50%");
  // 纯数字格式同理：0.## 的 48.90 是 48.9、48.95 是 48.95
  assert.equal(xlsxNumber("48.9", 164, "0.##", false), "48.9");
  assert.equal(xlsxNumber("48.95", 164, "0.##", false), "48.95");
});

test("经过时长认得出 [h]、[m]、[s] 三种累计单位，都不绕回 24 小时", () => {
  // 1.5 天是 36 小时：按总分钟数是 2160 分、按总秒数是 129600 秒
  assert.equal(xlsxNumber("1.5", 164, "[m]:ss", false), "2160:00");
  assert.equal(xlsxNumber("1.5", 164, "[s]", false), "129600");
  // [h] 仍是总小时，带秒的写法照写秒
  assert.equal(xlsxNumber("1.5", 164, "[h]:mm:ss", false), "36:00:00");
  assert.equal(xlsxNumber("1.5", 164, "[h]", false), "36");
});

test("ipynb 的围栏比内容里最长的一串反引号还长", () => {
  const book = {
    metadata: { language_info: { name: "python" } },
    cells: [
      {
        cell_type: "code",
        source: ['doc = """', "\n", "````markdown", "\n", "# 标题", "\n", "````", "\n", '"""'],
        outputs: [{ output_type: "stream", text: "````\n# 输出里的标题\n````" }]
      }
    ]
  };
  const md = ipynbMarkdown(JSON.stringify(book));
  // 代码与输出里都有四连反引号，围栏得是五连，才不会在中间提前闭合
  assert.match(md, /^`````python\n/);
  assert.match(md, /\*\*输出\*\*\n\n`````\n````\n# 输出里的标题\n/);
  assert.match(md, /\n`````$/);
});

test("ipynb 即便报成 JSON 的类型也不当文字读", () => {
  // 上传时浏览器常把它报成这两种；当真文字读，进上下文的是整份 JSON（含 base64 的图）
  assert.equal(isTextFile({ name: "a.ipynb", type: "application/x-ipynb+json" }), false);
  assert.equal(isTextFile({ name: "a.ipynb", type: "application/json" }), false);
  // 普通 JSON 仍是文字
  assert.equal(isTextFile({ name: "a.json", type: "application/json" }), true);
});
