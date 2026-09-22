// 言 · 小工具：转义、时间、提示、确认框、按需加载、动效开合
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function formatTime(value) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
// 汉字数字：一、十二、二十三；2 单独出现时用「两」（如「两问」）
const DIGITS = "〇一二三四五六七八九";
function chineseNumber(n, twoAsLiang = false) {
  n = Math.max(0, Math.floor(Number(n) || 0));
  if (n === 2 && twoAsLiang) return "两";
  if (n < 10) return DIGITS[n];
  if (n < 100) {
    const tens = Math.floor(n / 10),
      ones = n % 10;
    return `${tens > 1 ? DIGITS[tens] : ""}十${ones ? DIGITS[ones] : ""}`;
  }
  return String(n);
}
function formatDay(value) {
  const date = new Date(value),
    year = date.getFullYear();
  return `${year !== new Date().getFullYear() ? `${[...String(year)].map(d => DIGITS[Number(d)]).join("")}年` : ""}${chineseNumber(date.getMonth() + 1)}月${chineseNumber(date.getDate())}日`;
}
function dayBucket(value) {
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(value).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? "今天" : days < 7 ? "过去七天" : "更早";
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  showNow(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideWithFade(el), 2200);
}
function setConnection(state, text) {
  $("#connection").dataset.state = state;
  $("#connectionText").textContent = text;
}
// 把正文里的某条消息滚到视口：只滚 #chatScroll 自己，不用 scrollIntoView——它会连带滚动外层容器（页面整体跟着偏一截，尤其在 VS Code 预览与移动端）
function scrollChatTo(article, block = "start", margin = 12) {
  const host = $("#chatScroll");
  if (!host || !article) return;
  const offset = article.getBoundingClientRect().top - host.getBoundingClientRect().top,
    target =
      block === "center"
        ? host.scrollTop + offset - Math.max(0, (host.clientHeight - article.offsetHeight) / 2)
        : host.scrollTop + offset - margin;
  host.scrollTo({ top: Math.max(0, target), behavior: reducedMotion.matches ? "instant" : "smooth" });
}
function requestJob(id = currentId) {
  return id ? requestJobs.get(id) || null : null;
}
function conversationRunning(id = currentId) {
  return !!requestJob(id);
}
/** @param {Conversation} conversation */
function setJobLabel(conversation, job, label) {
  job.label = label;
  if (requestJobs.get(conversation.id) === job && currentId === conversation.id && view === "chat") setConnection("busy", label);
}
function refreshConnection() {
  const job = requestJob();
  if (job) return setConnection("busy", job.label || "生成中");
  if (navigator.onLine === false) return setConnection("error", "连接中断");
  const conversation = currentConversation(),
    last = [...(conversation?.messages || [])].reverse().find(message => message.role === "assistant");
  if (last?.status === "error") return setConnection("error", "请求失败");
  if (last?.status === "interrupted") return setConnection("error", "连接中断");
  if (last?.status === "stopped") return setConnection("idle", "已停止");
  setConnection("idle", conversation?.ended ? "额度已尽" : "就绪");
}
function grow(el) {
  el.style.height = "auto";
  el.style.height = `${Math.min(190, Math.max(44, el.scrollHeight))}px`;
}
// 编辑消息的文本框：随内容长高（浏览器不认 field-sizing 时的兜底），到七成屏高才内滚
function growEditor(el) {
  if (!el) return;
  const fit = () => {
    el.style.height = "auto";
    el.style.height = `${Math.min(innerHeight * 0.7, el.scrollHeight + 2)}px`;
  };
  fit();
  if (!el.dataset.grow) {
    el.dataset.grow = "1";
    el.addEventListener("input", fit);
  }
}
function isMobile() {
  return innerWidth <= 760;
}
// 同风格的确认弹层，替代浏览器自带的 confirm()
let confirmResolve = null;
function askConfirm({ title, body = "", ok = "确定", danger = true }) {
  return new Promise(resolve => {
    settleConfirm(false);
    confirmResolve = resolve;
    $("#confirmTitle").textContent = title;
    $("#confirmBody").textContent = body;
    const button = $("#confirmOk");
    button.textContent = ok;
    button.className = danger ? "danger-btn solid" : "outline-btn";
    showNow($("#confirmModal"));
    setTimeout(() => button.focus(), 0);
  });
}
function settleConfirm(value) {
  if (!confirmResolve) return;
  hideWithFade($("#confirmModal"));
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve(value);
}

// ---------- 大体积库按需加载：mermaid / echarts / KaTeX / pdf.js 只在真正用到时才拉，首屏只带 marked + purify + hljs ----------
const VENDOR = {
  pdf: { src: "./vendor/pdf.min.js", ready: () => window.pdfjsLib },
  katex: { src: "./vendor/katex/katex.min.js", ready: () => window.katex },
  mermaid: { src: "./vendor/mermaid.min.js", ready: () => window.mermaid },
  echarts: { src: "./vendor/echarts.min.js", ready: () => window.echarts }
};
const vendorLoads = new Map();
function ensureLib(name) {
  const lib = VENDOR[name];
  if (!lib) return Promise.resolve(false);
  if (lib.ready()) return Promise.resolve(true);
  if (!vendorLoads.has(name))
    vendorLoads.set(
      name,
      new Promise(resolve => {
        const script = document.createElement("script");
        script.src = lib.src;
        script.onload = () => {
          if (name === "mermaid") setupMermaid();
          resolve(!!lib.ready());
        };
        script.onerror = () => {
          vendorLoads.delete(name);
          script.remove();
          resolve(false);
        };
        document.head.append(script);
      })
    );
  return vendorLoads.get(name);
}
// 弹层与提示的收场：先淡出再 hidden，别硬切
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const inkMotionOff = () => document.documentElement.dataset.inkMotion === "off";
function showNow(el) {
  clearTimeout(el._leaveTimer);
  el.classList.remove("hidden", "leaving");
}
function hideWithFade(el, duration = 170) {
  if (!el || el.classList.contains("hidden")) return;
  clearTimeout(el._leaveTimer);
  if (reducedMotion.matches) {
    el.classList.add("hidden");
    return;
  }
  el.classList.add("leaving");
  el._leaveTimer = setTimeout(() => {
    el.classList.remove("leaving");
    el.classList.add("hidden");
  }, duration);
}
// 自动开合的规矩：程序只在两处动手——开始时打开、做完时收起，中间不来回翻。收起前先停一拍，让勾打上、让人看清结果；
// 且只在读者没停在这一块上看时才收：正在往上翻着读的人，内容不能从眼皮底下抽走，留给他自己收。用户亲手开合过的一律不动
const SETTLE_DELAY = 700;
function detailsInView(details) {
  const host = $("#chatScroll") || document.documentElement,
    rect = details.getBoundingClientRect(),
    frame = host.getBoundingClientRect();
  return rect.bottom > frame.top && rect.top < frame.bottom;
}
// force：做完就收，不看读者是否正停在这块、用户是否亲手开过——运行中摊开、运行完收起，是行迹与帮手时间线的定例
function settleDetails(details, open, onClose = null, force = false) {
  if (!details) return;
  if (open) {
    clearTimeout(details._settleTimer);
    details._settleTimer = null;
    return setProcessDetails(details, true);
  }
  if (details._settleTimer || !details.open) return;
  details._settleTimer = setTimeout(() => {
    details._settleTimer = null;
    if (!details.isConnected) return;
    if (!force && (details.dataset.touched || (!followBottom && detailsInView(details)))) return;
    delete details.dataset.touched;
    setProcessDetails(details, false);
    onClose?.();
  }, SETTLE_DELAY);
}
function setProcessDetails(details, open, animate = true) {
  if (!details) return;
  if (details._motionAnimation && details._motionTarget === open) return;
  details._motionAnimation?.cancel();
  details._motionAnimation = null;
  details._motionTarget = open;
  // 只认自己直接的那层正文：帮手卡片的「帮手 · n 步」里还套着各轮的思绪，不能抓到里头那个去动
  const body = details.querySelector(":scope > .reasoning-body, :scope > .tool-stack-body, :scope > .sub-timeline, :scope > .source-grid");
  details.classList.remove("is-closing");
  if (body) {
    body.style.removeProperty("overflow");
    body.style.removeProperty("will-change");
  }
  if (!body || !animate || inkMotionOff() || typeof body.animate !== "function") {
    details.open = open;
    details._motionTarget = undefined;
    return;
  }
  if (open && details.open) {
    details._motionTarget = undefined;
    return;
  }
  if (!open && !details.open) {
    details._motionTarget = undefined;
    return;
  }
  if (open) details.open = true;
  else details.classList.add("is-closing");
  const height = Math.max(1, body.getBoundingClientRect().height);
  body.style.overflow = "hidden";
  body.style.willChange = "height, opacity, transform";
  const frames = open
    ? [
        { height: "0px", opacity: 0, transform: "translateY(-5px)" },
        { height: `${height}px`, opacity: 1, transform: "translateY(0)" }
      ]
    : [
        { height: `${height}px`, opacity: 1, transform: "translateY(0)" },
        { height: "0px", opacity: 0, transform: "translateY(-5px)" }
      ];
  const animation = body.animate(frames, { duration: open ? 420 : 380, easing: "cubic-bezier(.22,.72,.2,1)", fill: "both" });
  details._motionAnimation = animation;
  animation.onfinish = () => {
    if (details._motionAnimation !== animation) return;
    if (!open) details.open = false;
    details.classList.remove("is-closing");
    body.style.removeProperty("overflow");
    body.style.removeProperty("will-change");
    animation.cancel();
    details._motionAnimation = null;
    details._motionTarget = undefined;
  };
}
// 就地改内容时高度平滑过渡（先量旧高，改完量新高，再从旧高动到新高）：步骤输出的折起摊开、「展开全部」都走这里，
// 别让一块内容凭空出现又凭空消失。动效关掉时直接改
function morphHeight(el, mutate, duration = 360) {
  if (!el || inkMotionOff() || typeof el.animate !== "function") return mutate();
  const from = el.getBoundingClientRect().height;
  mutate();
  const to = el.getBoundingClientRect().height;
  if (Math.abs(to - from) < 2) return;
  el._morph?.cancel();
  el.style.overflow = "hidden";
  const animation = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration, easing: "cubic-bezier(.22,.72,.2,1)" });
  el._morph = animation;
  animation.onfinish = animation.oncancel = () => {
    if (el._morph !== animation) return;
    el._morph = null;
    el.style.removeProperty("overflow");
  };
}
