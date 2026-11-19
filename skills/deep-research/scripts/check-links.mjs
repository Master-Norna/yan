// 查一份报告里的链接打不打得开：node check-links.mjs <文件…>
// 零依赖（用运行言的 Node 即可跑）。只读文件、只发请求，不改什么。打不开的未必是死链——线路、反爬、要登录都会这样，用浏览器核一眼再定
import fs from "node:fs";

const files = process.argv.slice(2);
if (!files.length) {
  console.log("用法：node check-links.mjs <报告文件…>");
  process.exit(2);
}
const cited = new Map();
for (const file of files)
  for (const [url] of fs.readFileSync(file, "utf8").matchAll(/https?:\/\/[^\s<>"'`（）【】「」，。；：！？、]+/g)) {
    // 收掉句末的标点；右括号只在没有配对的左括号时才是 Markdown 链接的收尾（维基一类的网址里本就带括号）
    let clean = url.replace(/[.,;:!?]+$/, "");
    while (clean.endsWith(")") && (clean.match(/\(/g) || []).length < (clean.match(/\)/g) || []).length) clean = clean.slice(0, -1);
    cited.set(clean, (cited.get(clean) || 0) + 1);
  }
if (!cited.size) {
  console.log("没有找到链接");
  process.exit(0);
}

// 先 HEAD，不认 HEAD 的站再 GET；15 秒为限，同时 6 条
async function probe(url) {
  for (const method of ["HEAD", "GET"])
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        }
      });
      response.body?.cancel().catch(() => {});
      if (method === "HEAD" && [403, 405, 501].includes(response.status)) continue;
      return { status: response.status, final: response.url };
    } catch (error) {
      if (method === "GET") return { error: error.name === "TimeoutError" ? "超时" : String(error.cause?.code || error.message) };
    }
}
const urls = [...cited.keys()],
  results = new Map();
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(6, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++];
      results.set(url, await probe(url));
    }
  })
);

let bad = 0;
for (const url of urls) {
  const { status, final, error } = results.get(url),
    times = cited.get(url) > 1 ? ` · 引了 ${cited.get(url)} 回` : "";
  if (error || status >= 400) {
    bad++;
    console.log(`✗ ${error || status} ${url}${times}`);
  } else if (final && final.replace(/\/$/, "") !== url.replace(/\/$/, "")) console.log(`→ ${status} ${url}\n    跳到 ${final}${times}`);
  else console.log(`✓ ${status} ${url}${times}`);
}
console.log(`共 ${urls.length} 条链接，${bad} 条打不开`);
process.exit(bad ? 1 : 0);
