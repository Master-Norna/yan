// 在样式解析前把主题、印色、字体与阅读宽度写到 <html> 上，避免暗色用户开页先看到一屏米白；正式逻辑仍在 support.js 的 applyAppearance
(() => {
  try {
    const settings = JSON.parse(localStorage.getItem("yan-chat-v1") || "{}").settings || {},
      html = document.documentElement;
    const theme = settings.theme || "light",
      dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const inkMotion = settings.inkMotion || "on",
      motionOff = inkMotion === "off" || (inkMotion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    html.dataset.theme = dark ? "dark" : "light";
    html.dataset.inkMotion = motionOff ? "off" : "on";
    if (settings.accent) html.style.setProperty("--accent", settings.accent);
    if (settings.width) html.style.setProperty("--read", `${Number(settings.width) || 760}px`);
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
