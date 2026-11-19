// 言 · 下载源自适应：国内镜像与官方各请求开头 2 MiB 比速度。环境（server/env/）、游目（server/stage.js）与 Windows 打包共用，页面不再让人选。
// 哪边快因人而异：没开代理时官方常慢；开着代理时国内镜像也被绕出去，反倒慢（实测几十 KB/s 对几百 KB/s）；
// 镜像对冷门或刚出的文件还要现去源站拉。测速用 Windows 的 curl.exe，走 curl 自己的代理设置，不一定与实际下载器一致
"use strict";
const { execFile } = require("node:child_process");

/** 请求 url 开头 2 MiB，取 curl 在 6 秒内量出的速度（字节/秒）；没读数算 0 @param {string} url @returns {Promise<number>} */
function speedOf(url) {
  return new Promise(resolve =>
    execFile(
      "curl.exe",
      ["-sL", "-o", "NUL", "-r", "0-2097151", "-m", "6", "-w", "%{speed_download}", url],
      { windowsHide: true, timeout: 15000 },
      // 到了时限 curl 退出码不为 0，量出的速度照样写在输出里
      (_error, stdout) => resolve(Number(stdout) || 0)
    )
  );
}
/**
 * 同一个文件两边各取一截比：官方快出一截才用官方，否则镜像；两边都取不到（没网、刚连上卡了一下）也留在镜像，但不算数
 * @param {string} mirrorUrl @param {string} officialUrl @returns {Promise<{ side: "china" | "official", sure: boolean }>}
 */
async function fasterSide(mirrorUrl, officialUrl) {
  const [near, far] = await Promise.all([speedOf(mirrorUrl), speedOf(officialUrl)]);
  return { side: far > near * 1.5 ? "official" : "china", sure: near + far > 0 };
}
// 一般的包（环境里的 Python / Node 包与工具链、游目的驱动）：拿同一个常用的 npm 包（typescript，四兆来大）两边比。
// 十分钟内比过的不再比；没比出来的不记
const PROBE = "/typescript/-/typescript-5.6.3.tgz";
let last = { at: 0, side: /** @type {"china" | "official"} */ ("china") };
async function pickSource() {
  if (Date.now() - last.at < 10 * 60000) return last.side;
  const { side, sure } = await fasterSide(`https://registry.npmmirror.com${PROBE}`, `https://registry.npmjs.org${PROBE}`);
  if (sure) last = { at: Date.now(), side };
  return side;
}

module.exports = { fasterSide, pickSource };
