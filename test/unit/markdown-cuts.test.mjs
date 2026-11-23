import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { load } from "./harness.mjs";

const { stableCut } = load(["stableCut"]);

test("stableCut：回找空行仍按原文的围栏字符、长度和偏移判定", () => {
  const stable = "开头\n\n````md\n```js\n例\n```\n````\n\n小结";
  // 末尾三连换行里的两处候选都在 ~~~~ 内；异种、太短或仍带文字的围栏行均不合拢。
  const open = `${stable}\n\n~~~~js\n<p>\n\n\`\`\`\n\n~~~\n\n~~~~text\n\n\n尾`;
  assert.equal(stableCut(open), stable.length);
  assert.equal(stableCut(`${open}\n~~~~\n\n下一段`), open.length + "\n~~~~".length);
  // 提升标记只在显式围栏里，也不影响它外面的断点。
  assert.equal(stableCut("开头\n\n```html\n<script>\n\n\n字\n\n"), "开头".length);
  assert.equal(stableCut("开头\n\n```\n字\n\n\n\n末"), "开头".length);
});

test("stableCut：提升过的候选要重按各自前缀判，不拿更长的 HTML 段替它", () => {
  const head = "前文";
  const open = `${head}\n\n<div></div>\n\n<script>\n甲\n\n乙\n\n丙`;
  assert.equal(stableCut(open), head.length);
  const closed = `${open}\n</script>`;
  assert.equal(stableCut(`${closed}\n\n<div>续</div>`), head.length);
  assert.equal(stableCut(`${closed}\n\n后文`), closed.length);
  assert.equal(stableCut(`${head}\n\n<pre class="mermaid">\ngraph TD\n\nA --> B`), head.length);
  // 普通原始 HTML 没有提升；标记只在最后一个候选之后也不能提前改变它。
  assert.equal(stableCut(`${head}\n\n<x>甲</x>\n\n<x>乙</x>\n\n后文`), `${head}\n\n<x>甲</x>\n\n<x>乙</x>`.length);
  assert.equal(stableCut(`${head}\n\n段内文字\n\n<script>`), `${head}\n\n段内文字`.length);
});

test("stableCut：回找时仍保留相邻列表、缩进和表格", () => {
  const head = "引子";
  for (const tail of ["- 甲\n\n- 乙\n\n- 丙", "甲\n\n    乙\n\n\t丙", "| 甲 |\n| -- |\n\n| 乙 |\n\n| 丙 |"])
    assert.equal(stableCut(`${head}\n\n${tail}`), head.length);
});

test("stableCut：围栏里空行再多，也不把每个前缀都送去扫描", () => {
  // 在测试闭包里数实际交给两道判据的字符，不用机器快慢当判据，也不给产品加测试钩子。
  const sources = ["00-markdown.js", "10-html-app.js"].map(file =>
    readFileSync(new URL(`../../src/04-markdown/${file}`, import.meta.url), "utf8")
  );
  const measure = new Function(`
    function defineLayer() {}
    ${sources.join("\n")}
    let liftUnits, fenceUnits;
    const lift = liftBareHtml, fence = fenceAfter;
    liftBareHtml = text => { liftUnits += text.length; return lift(text); };
    fenceAfter = (open, line) => { fenceUnits += line.length + 1; return fence(open, line); };
    return text => {
      liftUnits = fenceUnits = 0;
      const cut = stableCut(text);
      return { cut, liftUnits, fenceUnits };
    };
  `)();
  const open = `头\n\n\`\`\`txt\n${"x".repeat(110).concat("\n\n").repeat(192)}尾`;
  for (const [text, maxFencePasses] of [
    [open, 2],
    [open.replace("txt\n", "txt\n<script>\n"), 3]
  ]) {
    const { cut, liftUnits, fenceUnits } = measure(text);
    assert.equal(cut, 1);
    assert.ok(liftUnits <= text.length, `送去提升判定 ${liftUnits} 字符，输入只有 ${text.length} 字符`);
    assert.ok(fenceUnits <= maxFencePasses * text.length, `送去围栏判定 ${fenceUnits} 字符，输入只有 ${text.length} 字符`);
  }
});
