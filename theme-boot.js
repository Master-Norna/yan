// 在样式解析前把主题、印色、字体与阅读宽度写到 <html> 上，避免暗色用户开页先看到一屏米白；正式逻辑仍在 support.js 的 applyAppearance
(() => {
  try {
    const settings = JSON.parse(localStorage.getItem("yan-chat-v1") || "{}").settings || {},
      html = document.documentElement;
    const theme = settings.theme || "system",
      dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const inkMotion = settings.inkMotion || "on",
      motionOff = inkMotion === "off" || (inkMotion === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    html.dataset.theme = dark ? "dark" : "light";
    html.dataset.inkMotion = motionOff ? "off" : "on";
    if (settings.accent) html.style.setProperty("--accent", settings.accent);
    if (settings.width) html.style.setProperty("--read", `${Number(settings.width) || 760}px`);
    if (settings.font === "serif") html.style.setProperty("--body", '"Noto Serif SC","Songti SC","STSong",serif');
  } catch {}
})();
