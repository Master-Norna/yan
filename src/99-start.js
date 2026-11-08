// 言 · 启动
// index.html 里写死的字先照译文表换过（中文界面不动），再起页面
translateStatic();
// 标签页图标换成衬纸的一笔言（见 03-brush.js 的 BRAND_ICON）；index.html 里写的 icon.svg 只在脚本起来之前顶一下
document.querySelector('link[rel="icon"]')?.setAttribute("href", BRAND_ICON);
// 画好（或半路出错）就撤掉开页时的遮挡，免得整页一直藏着
boot().finally(() => delete document.documentElement.dataset.booting);
