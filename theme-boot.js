// 在样式解析前把主题、印色与字体写到 <html> 上，避免暗色用户开页先看到一屏米白；正式逻辑仍在 support.js 的 applyAppearance
// 直接双击 index.html（file://）打开的：页面脚本与样式都由桥接现拼，这里拿不到，也接不上桥接（它不认来源为 null 的页面）。
// 只挂「等候本机桥接」一页，自带几行样式，指明去哪儿打开
if (location.protocol === "file:") {
  document.documentElement.dataset.bridge = "waiting";
  const style = document.createElement("style");
  style.textContent =
    'body>:not(#bridgeGate){display:none!important}body{margin:0}#bridgeGate{position:fixed;inset:0;display:grid;place-content:center;justify-items:center;gap:10px;background:#fbfaf6;color:#292724;font-family:"Noto Serif SC","Songti SC","STSong",serif;letter-spacing:.06em;text-align:center}#bridgeGate .seal{display:inline-grid;place-items:center;width:34px;height:34px;border:1px solid #9b5540;color:#9b5540;font-size:18px;transform:rotate(-3deg)}#bridgeGate h1{margin:8px 0 0;font-weight:500;font-size:22px}#bridgeGate p{margin:0;opacity:.6;font-size:13px}@media(prefers-color-scheme:dark){#bridgeGate{background:#201f1c;color:#e6e1d6}}';
  document.head.append(style);
}
(() => {
  // 头一回画好之前不露 index.html 里写死的初稿（见 styles/00-base.css 与 src/99-start.js）
  if (location.protocol !== "file:") document.documentElement.dataset.booting = "";
  // 右栏（同源页面并排，最多四栏）：先挂上，侧栏与游目在样式里就不露面（见 src/27-split.js）
  const paneQuery = new URLSearchParams(location.search);
  if (paneQuery.get("pane") === "side") {
    document.documentElement.dataset.pane = "side";
    const slot = Number(paneQuery.get("slot"));
    // 4 即 src/00-state.js 的 MAX_SPLIT_PANES：这份脚本先于主脚本跑、拿不到那个常量，改栏数时两处一起改
    document.documentElement.dataset.paneSlot = String(Number.isInteger(slot) && slot >= 0 && slot < 4 ? slot : 0);
  }
  try {
    const settings = JSON.parse(localStorage.getItem("yan-chat-v1") || "{}").settings || {},
      html = document.documentElement;
    const theme = settings.theme || "light",
      dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const inkMotion = settings.inkMotion || "on",
      motionOff = inkMotion === "off" || (inkMotion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    html.dataset.theme = dark ? "dark" : "light";
    // 时令：四季以四立为界（立春 2-4、立夏 5-5、立秋 8-7、立冬 11-7），纸色随季偏一丝；节气名与角上那一件见 src/12-season.js
    const now = new Date(),
      md = (now.getMonth() + 1) * 100 + now.getDate();
    html.dataset.season = md >= 1107 || md < 204 ? "winter" : md < 505 ? "spring" : md < 807 ? "summer" : "autumn";
    html.dataset.inkMotion = motionOff ? "off" : "on";
    if (settings.accent) html.style.setProperty("--accent", settings.accent);
    // 与 support.js 里的 FONT_STACKS 同一份表：--title 是读的字，--body 是界面的字
    const sans = '"Noto Sans SC","Microsoft YaHei UI",system-ui,sans-serif',
      serif = '"Noto Serif SC","Songti SC","STSong",serif',
      title = {
        sans,
        kai: '"Kaiti SC","KaiTi","STKaiti","楷体","AR PL UKai CN",serif',
        fangsong: '"Fangsong SC","FangSong","STFangsong","仿宋","AR PL UMing CN",serif'
      }[settings.font];
    if (title) html.style.setProperty("--title", title);
    if (settings.font === "serif") html.style.setProperty("--body", serif);
    if (title || settings.font === "serif") html.dataset.font = settings.font;
    // 侧栏上次是收着的就先收着（宽屏才记；见 toggleSidebar），免得开页先展开再缩回去
    if (localStorage.getItem("yan-sidebar") === "collapsed" && innerWidth > 760) html.dataset.sidebar = "collapsed";
  } catch {}
})();
// 界面语言：设置里选的为准，没选过的随浏览器（中文系的用中文）。英文表只在要用时载入，赶在 support.js 之前（见 src/00-i18n.js）
(() => {
  let language = "";
  try {
    language = JSON.parse(localStorage.getItem("yan-chat-v1") || "{}").settings?.language || "";
  } catch {}
  if ((language || (/^zh/i.test(navigator.language || "") ? "zh" : "en")) !== "en" || location.protocol === "file:") return;
  document.documentElement.lang = "en";
  document.write('<script src="./i18n/en.js"></script>');
})();
