// 言 · Markdown：marked 解析、DOMPurify 净化、代码高亮、公式；正文嵌件的登记表
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 正文嵌件：正文里的一种写法认作一种嵌件，由它自己画、自己起 ----------
// 正文本是 Markdown；要在里头放一块别的东西（交互网页、公式……），不在渲染里逐个加分支，而是登记一种嵌件：
//   fence(language, text)   认围栏代码块：这一块归它就回 true
//   pending(text, language) 流式尾段里这块还没写完时的占位（外框用 .viz-pending，尾段重画时它留在原处不闪，见 paintTail）；不给就照常显示代码
//   html(text, language)    写完了的样子
//   mount(root)             画进页面之后再起来的一步（沙箱载入、库到了补画……）；正文、旁注、预览每回画完都走一遍
//   bind()                  开页时接一次的事件（工具条的点按、沙箱报来的消息……）
// 只给 mount 的是借别的写法落进正文的（公式由 marked 的扩展画占位、引用的画面是带 data-file 的链接），画完了在这里补。
// 加一种嵌件只需一份登记；交互网页见 10-html-app.js。链接也可照此认作入口（在 marked 的 link 上查一遍登记），眼下没有要的，便没接
/** @typedef {{ name: string, fence?: (language: string, text: string) => boolean, pending?: (text: string, language: string) => string, html?: (text: string, language: string) => string, mount?: (root: Element) => void, bind?: () => void }} Embed */
/** @type {Embed[]} */
const EMBEDS = [];
/** @param {Embed} embed */
function defineEmbed(embed) {
  EMBEDS.push(embed);
}
// ---------- Markdown：marked 解析、DOMPurify 净化、highlight.js 代码高亮、KaTeX 公式 ----------
const PURIFY_OPTIONS = { ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form", "iframe", "object", "embed"] };
function setupMarkdown() {
  if (!window.marked) return;
  const inlineMath = {
    name: "mathInline",
    level: "inline",
    start(src) {
      const m = src.match(/\$(?!\s)|\\\(/);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const m = src.match(/^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/) || src.match(/^\\\(([\s\S]+?)\\\)/);
      return m ? { type: "mathInline", raw: m[0], text: m[1] } : undefined;
    },
    renderer(token) {
      return renderMath(token.text, false);
    }
  };
  const blockMath = {
    name: "mathBlock",
    level: "block",
    start(src) {
      const m = src.match(/\$\$|\\\[/);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const m = src.match(/^\$\$([\s\S]+?)\$\$(?:\n+|$)/) || src.match(/^\\\[([\s\S]+?)\\\](?:\n+|$)/);
      return m ? { type: "mathBlock", raw: m[0], text: m[1].trim() } : undefined;
    },
    renderer(token) {
      return `<div class="math-block">${renderMath(token.text, true)}</div>\n`;
    }
  };
  // Windows 绝对路径里的反斜杠是分隔符，不是 Markdown 的转义：\. \_ \- 被吃掉，E:\聊天记录\.yan 就成了 E:\聊天记录.yan，链接打不开、复制下来也是错的。
  // 正文里的整段路径认作一件，原样显示（路径里的 _ 也不当强调）；相对路径、网址里的反斜杠仍按转义算（模型常写 a\_b.md）
  const windowsPath = {
    name: "windowsPath",
    level: "inline",
    start(src) {
      const m = src.match(/(?<![A-Za-z0-9_])[a-z]:\\|\\\\[\w.-]+\\/i);
      return m ? m.index : -1;
    },
    tokenizer(src) {
      const m = src.match(/^(?:[a-z]:\\|\\\\[\w.-]+\\)[^\s"'`<>|*?()[\]（）「」《》，。；：！？、]*/i);
      return m ? { type: "windowsPath", raw: m[0] } : undefined;
    },
    renderer(token) {
      return escapeHtml(token.raw);
    }
  };
  marked.use({
    gfm: true,
    breaks: true,
    tokenizer: {
      // 删除线只认 ~~两道~~：marked 的 GFM 连单个 ~ 也认，中文正文常拿 ~ 写区间（0.13~0.24x、0.1~2 秒），一行有两处便被划掉。
      // 交回 false 由 marked 原样处理双道的；单道的交回空，不算删除线，落回正文
      del(src) {
        return src.startsWith("~~") ? false : undefined;
      },
      // 链接与图片的目标从原文取回：放在分词这一层，渲染和记成品（只分词，见 22-changes.js）拿到的是同一条路。\( \) 仍算转义，那是配平括号的写法
      link(src) {
        const token = marked.Tokenizer.prototype.link.call(this, src),
          target = token && /^[\s\S]*\]\(\s*(?:<([^>\n]+)>|(\S+?))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)$/.exec(token.raw);
        const path = target && (target[1] || target[2]);
        if (path && /^(?:[a-z]:\\|\\\\[\w.-]+\\)/i.test(path)) token.href = path.replace(/\\([()])/g, "$1");
        return token;
      }
    },
    renderer: {
      code({ text, lang }) {
        return codeBlockHtml(text, lang);
      }
    },
    extensions: [blockMath, inlineMath, windowsPath]
  });
  if (window.DOMPurify) {
    // 模型写「下载《x.docx》」时常把链接指向 sandbox:/、file:/// 或一个裸文件名——页面上没有这样的路。
    // 把文件名记在 data-file、原路记在 data-path 上，去掉 href；点击时按原路在这段对话的落脚处取那件来下载，取不到再到卷宗里找同名的（见 10-archive.js）。
    // 图片同理：![截图](page-1.png) 的 src 也记成 data-file，是这一答工具交回的画面就画成那幅（见 renderReplyShots）
    DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
      if (!((node.tagName === "A" && data.attrName === "href") || (node.tagName === "IMG" && data.attrName === "src"))) return;
      // 外链图不让页面自己去取，记下图址，画成一张待取的素纸（见 renderRemoteShots）
      if (node.tagName === "IMG" && /^https?:\/\//i.test(String(data.attrValue).trim())) {
        node.setAttribute("data-remote", String(data.attrValue).trim());
        data.keepAttr = false;
        return;
      }
      const name = localFileName(data.attrValue);
      if (!name) return;
      node.setAttribute("data-file", name);
      node.setAttribute("data-path", data.attrValue);
      data.keepAttr = false;
    });
    DOMPurify.addHook("afterSanitizeAttributes", node => {
      if (node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (node.tagName === "INPUT") node.setAttribute("disabled", "");
    });
  }
}
// 不是网址、末段像个文件名的链接：取出文件名。网址、邮件、页内锚点都不算
function localFileName(href) {
  const raw = String(href || "").trim();
  if (!raw || /^(?:https?|mailto|tel|data|blob):/i.test(raw) || raw.startsWith("#")) return "";
  let name = raw
    .replace(/[?#].*$/, "")
    .split(/[\\/]/)
    .pop();
  try {
    name = decodeURIComponent(name);
  } catch {}
  return /^[^<>:"|?*\u0000-\u001f]+\.[a-z0-9]{1,8}$/i.test(name) ? name : "";
}
function renderMath(tex, display) {
  // KaTeX 未加载时先放一个占位，库到位后由 renderPendingMath 就地替换；流式尾段每帧重绘，加载完成后自然变成正式渲染
  if (!window.katex) {
    void ensureLib("katex");
    return `<span class="math-pending" data-tex="${escapeHtml(tex)}" data-display="${display ? "1" : "0"}"><code>${escapeHtml(tex)}</code></span>`;
  }
  try {
    return window.katex
      ? katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" })
      : `<code>${escapeHtml(tex)}</code>`;
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}
// 尾段每帧整段重画，占位框若跟着重建，虚痕的呼吸每帧都从头来一遍：这里把已在页上的那个占位框留在原处不动，
// 只换它周围的内容；行数变了就让虚痕吸一口墨
function paintTail(tail, html) {
  const live = [...tail.querySelectorAll(".viz-pending")].at(-1);
  if (!live || live.parentNode !== tail) {
    tail.innerHTML = html;
    return;
  }
  const fresh = document.createElement("div");
  fresh.innerHTML = html;
  const next = [...fresh.querySelectorAll(".viz-pending")].at(-1);
  if (!next || next.parentNode !== fresh || next.dataset.vizPending !== live.dataset.vizPending) {
    tail.innerHTML = html;
    return;
  }
  const grew = live.dataset.lines !== next.dataset.lines;
  live.dataset.lines = next.dataset.lines;
  if (grew) pulseInkStroke(live);
  live.setAttribute("aria-label", next.getAttribute("aria-label"));
  for (const node of [...tail.childNodes]) if (node !== live) node.remove();
  const before = [],
    after = [];
  let seen = false;
  for (const node of [...fresh.childNodes]) {
    if (node === next) seen = true;
    else (seen ? after : before).push(node);
  }
  live.before(...before);
  live.after(...after);
}
function codeBlockHtml(text, lang) {
  const language = String(lang || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase(),
    known = !!(window.hljs && language && hljs.getLanguage(language));
  // 归哪种嵌件就由它画：流式尾段还没写完时画占位（不给占位的照常显示代码）
  const embed = EMBEDS.find(item => item.fence?.(language, text));
  if (embed && !suppressViz) return embed.html(text, language);
  if (embed?.pending) return embed.pending(text, language);
  let html;
  try {
    html = known ? hljs.highlight(text, { language, ignoreIllegals: true }).value : escapeHtml(text);
  } catch {
    html = escapeHtml(text);
  }
  return `<div class="code-block"><div class="code-head"><span class="code-lang">${escapeHtml(language || "text")}</span>${vizTool("data-copy-code", t("复制"), "copy")}</div><pre><code class="hljs${known ? ` language-${escapeHtml(language)}` : ""}">${html}</code></pre></div>\n`;
}
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
async function renderPendingMath(root) {
  if (!root.querySelector(".math-pending") || !(await ensureLib("katex"))) return;
  for (const el of root.querySelectorAll(".math-pending")) {
    el.insertAdjacentHTML(
      "afterend",
      window.DOMPurify ? DOMPurify.sanitize(renderMath(el.dataset.tex || "", el.dataset.display === "1"), PURIFY_OPTIONS) : ""
    );
    el.remove();
  }
}
// 画进页面之后：各种嵌件起来（见上 EMBEDS 的 mount）
function renderEnhancements(root) {
  for (const embed of EMBEDS) embed.mount?.(root);
}
defineEmbed({ name: "math", mount: root => void renderPendingMath(root) });
// 正文里引了工具交回的画面（模型写「![截图](page-1.png)」或「[查看截图](page-1.png)」）：就地画出那幅，点开进图片查看器。
// 原件本就作附件挂在那一步上（见 mcpResultImages、generate_image），不另存；先认这一答的，再认前几答的（「把刚才那幅再放出来」）。
// 都不是的：链接照旧当目录里的文件，图到落脚处按路取（模型自己存的图表、前几回收进卷宗的图），取不到留下说明文字，不画破图
/** @param {Element} root */
function renderReplyShots(root) {
  const remote = renderRemoteShots(root),
    refs = root.querySelectorAll?.(":is(.markdown, .trail-note, .sub-report) [data-file]") || [];
  if (!refs.length && !remote) return;
  const c = currentConversation(),
    messages = c ? everyMessage(c) : [];
  for (const ref of refs) {
    const id = ref.closest("[data-message]")?.getAttribute("data-message"),
      name = ref.getAttribute("data-file"),
      upTo = messages.findIndex(item => item.id === id),
      file = (upTo < 0 ? [] : [messages[upTo], ...messages.slice(0, upTo).reverse()])
        .map(message =>
          allSteps(message)
            .flatMap(step => step.attachments || [])
            .findLast(item => item.kind === "image" && item.name === name)
        )
        .find(Boolean),
      target = !file && ref.tagName === "IMG" ? localLinkTarget(ref.getAttribute("data-path"), c, messages[upTo] || null) : null,
      words = ref.getAttribute("alt") || name || "";
    if (!file && !target) {
      if (ref.tagName === "IMG") ref.replaceWith(words);
      continue;
    }
    const shot = document.createElement("span"),
      alt = escapeHtml(words);
    shot.className = "fi fi-thumb reply-shot";
    shot.setAttribute("role", "button");
    shot.tabIndex = 0;
    shot.title = t`查看 ${file?.name || name}`;
    if (file) {
      shot.dataset.openImage = file.id;
      shot.innerHTML = `<img data-thumb="${escapeHtml(file.id)}" alt="${alt}">`;
    } else {
      shot.dataset.openArchive = target.path;
      shot.dataset.root = target.root;
      shot.innerHTML = `<img src="${escapeHtml(archiveFileUrl(target.path, false, target.root))}" alt="${alt}">`;
      shot.querySelector("img").onerror = () => shot.replaceWith(words);
    }
    shotShape(shot);
    // 图换成那幅；链接留着字（点了也是看图），画面接在后面
    if (ref.tagName === "IMG") ref.replaceWith(shot);
    else {
      ref.removeAttribute("data-file");
      ref.setAttribute("data-open-image", file.id);
      ref.after(shot);
    }
  }
  groupReplyShots(root);
  void loadThumbnails(root);
}
// 整页长截图（高过宽的两倍）从顶上取景，点开看全幅；别的整幅见。横幅在一叠里斜开得少（见 40-markdown.css）
/** @param {HTMLElement} shot */
function shotShape(shot) {
  shot.querySelector("img")?.addEventListener("load", e => {
    const img = /** @type {HTMLImageElement} */ (e.target);
    shot.classList.toggle("long", img.naturalHeight > img.naturalWidth * 2);
    shot.classList.toggle("wide", img.naturalWidth > img.naturalHeight * 1.2);
  });
}
// 正文里的外链图（![图](https://…)）：页面不直连外站（CSP 的 img-src 只许本机）——不然一张图就能把对话里的字带出去
// （网页里的话诱着模型写出带参数的图址，页面一画就发了）。所以先画一张素纸，写图名与来处，人点了才经桥接取来
// （POST /api/remote-image：地址门禁同翻网页、只收图），就地画成与别的图一样的一幅；这一回开着页取过的都记着，重画不再问。
// 取不到的写明缘由，再点交系统浏览器去开
/** @type {Map<string, { data: string, size: number }>} */
const remoteShots = new Map();
/** @type {Map<string, string>} 正取着的（空串）与没取到的缘由 */
const remoteShotTrouble = new Map();
/** @param {Element} root @returns {number} 换了几处 */
function renderRemoteShots(root) {
  const imgs = root.querySelectorAll?.(":is(.markdown, .trail-note, .sub-report) img[data-remote]") || [];
  for (const img of imgs) img.replaceWith(remoteShotNode(img.getAttribute("data-remote") || "", img.getAttribute("alt") || ""));
  return imgs.length;
}
/** @param {string} url @param {string} words 图名（alt） */
function remoteShotNode(url, words) {
  const got = remoteShots.get(url),
    shot = document.createElement("span");
  shot.className = "fi fi-thumb";
  shot.setAttribute("role", "button");
  shot.tabIndex = 0;
  if (got) {
    shot.classList.add("reply-shot");
    shot.dataset.openRemote = url;
    shot.dataset.name = words;
    shot.title = t`查看 ${words || stageHost(url)}`;
    shot.innerHTML = `<img src="${escapeHtml(got.data)}" alt="${escapeHtml(words)}">`;
    shotShape(shot);
    return shot;
  }
  // 与取来后那幅同一张折角纸（设计稿/129 丁）：当中一枚淡远山，下方图名与来处作落款；
  // 要做的事（取来、改在浏览器里开）只在指着时换上来，平时不写一句说明
  const trouble = remoteShotTrouble.get(url),
    host = stageHost(url),
    [rest, act] =
      trouble === undefined ? [host, t("取来一看")] : trouble ? [t`未能取来：${trouble}`, t("改在浏览器里打开")] : [t("正在取来…"), ""];
  shot.classList.add("remote-shot");
  shot.classList.toggle("failed", !!trouble);
  shot.classList.toggle("loading", trouble === "");
  shot.dataset.remoteImage = url;
  shot.dataset.alt = words;
  shot.title = url;
  shot.setAttribute("aria-label", `${words || t("外链图")} · ${host} · ${act || rest}`);
  shot.innerHTML = `${brushIcon("stage", "remote-shot-hills")}<span class="remote-shot-foot"><b>${escapeHtml(words || t("外链图"))}</b><small class="rest">${escapeHtml(rest)}</small>${act ? `<small class="act">${escapeHtml(act)}</small>` : ""}</span>`;
  shot.addEventListener("click", () => void fetchRemoteShot(url));
  shot.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    void fetchRemoteShot(url);
  });
  return shot;
}
/** @param {string} url */
async function fetchRemoteShot(url) {
  const trouble = remoteShotTrouble.get(url);
  if (trouble === "") return;
  if (trouble)
    return void bridge("/api/stage/open", { url }).then(
      () => toast(t("已交给系统浏览器")),
      error => toast(t`打开失败：${String(error.message || error).slice(0, 80)}`)
    );
  remoteShotTrouble.set(url, "");
  refreshRemoteShots(url);
  try {
    remoteShots.set(url, await bridge("/api/remote-image", { url }));
    remoteShotTrouble.delete(url);
  } catch (error) {
    remoteShotTrouble.set(url, tr(String(/** @type {any} */ (error).message || error).slice(0, 28)) || t("未知缘由"));
  }
  refreshRemoteShots(url);
}
// 同一图址在页上的各处一并换（流式重画过的、别的答里引了同一幅的）；取到的接进前后的一叠
/** @param {string} url */
function refreshRemoteShots(url) {
  const roots = new Set();
  for (const chip of document.querySelectorAll(`[data-remote-image="${CSS.escape(url)}"]`)) {
    const next = remoteShotNode(url, /** @type {HTMLElement} */ (chip).dataset.alt || "");
    chip.replaceWith(next);
    const root = next.closest(".markdown, .trail-note, .sub-report");
    if (root) roots.add(root);
  }
  if (remoteShots.has(url)) for (const root of roots) groupReplyShots(root);
}
// 接连几幅（一轮画的几稿）收成一叠，不一路往下堆：同段里只隔着换行的，或这段以图收尾、下一段只有图的。
// 流式时已收尾的段落一段段补进来，这里每回把新到的接进前面那一叠；只在同一个容器里挪，尾段重画时不会多出一份
/** @param {Element} root */
function groupReplyShots(root) {
  const isGap = node => (node.nodeType === Node.TEXT_NODE ? !node.textContent.trim() : node.nodeName === "BR"),
    isShot = node => node?.nodeType === Node.ELEMENT_NODE && node.matches(".reply-shot, .reply-shots"),
    onlyShots = node => node?.nodeName === "P" && [...node.childNodes].every(child => isGap(child) || isShot(child)),
    after = node => {
      for (let next = node.nextSibling; next; next = next.nextSibling) if (!isGap(next)) return isShot(next) ? next : null;
      const following = node.parentElement?.nodeName === "P" ? node.parentElement.nextElementSibling : null;
      return onlyShots(following) ? [...following.childNodes].find(isShot) : null;
    },
    trimAround = node => {
      while (node.previousSibling && isGap(node.previousSibling) && node.previousSibling.nodeName === "BR") node.previousSibling.remove();
      while (node.nextSibling && isGap(node.nextSibling)) node.nextSibling.remove();
    };
  for (const first of root.querySelectorAll(".reply-shots, .reply-shot")) {
    if (!first.isConnected || first.parentElement.classList.contains("reply-shots") || !after(first)) continue;
    let row = first;
    if (!first.classList.contains("reply-shots")) {
      row = document.createElement("span");
      row.className = "reply-shots";
      first.before(row);
      row.append(first);
    }
    for (let next = after(row); next; next = after(row)) {
      const from = next.parentElement;
      row.append(...(next.classList.contains("reply-shots") ? next.children : [next]));
      if (next.classList.contains("reply-shots")) next.remove();
      if (from !== row.parentElement && [...from.childNodes].every(isGap)) from.remove();
      trimAround(row);
    }
  }
  // 叠上只露最上一幅，叠下写共几幅（见 40-markdown.css）；各幅都在答末成品条与卷宗里
  for (const row of root.querySelectorAll(".reply-shots")) row.dataset.count = t`共 ${row.children.length} 幅`;
}
defineEmbed({ name: "shot", mount: renderReplyShots });
function downloadHref(href, name, revoke = false) {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  if (revoke) setTimeout(() => URL.revokeObjectURL(href), 1000);
}
function downloadText(text, type, name) {
  downloadHref(URL.createObjectURL(new Blob([text], { type })), name, true);
}
function renderMarkdown(source = "") {
  const text = String(source).replace(/^\n+|\n+$/g, "");
  if (!text) return "";
  const plain = () => `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
  if (!window.marked || !window.DOMPurify) return plain();
  try {
    return DOMPurify.sanitize(marked.parse(liftBareHtml(text), { async: false }), PURIFY_OPTIONS);
  } catch {
    return plain();
  }
}
// 这段文字末尾是否还在代码围栏里：按 CommonMark 记开围栏的字符与长度，同字符、不短于它、后面没别的字的一行才算合上。
// 只数围栏行的奇偶不行：````markdown 里嵌着 ```bash 时，内层那两行会把里外颠倒
function inOpenFence(text) {
  let open = null;
  for (const line of text.split("\n")) open = fenceAfter(open, line);
  return !!open;
}
/** 过了这一行，围栏开着的是哪一道（null 即不在围栏里） @param {{ mark: string, length: number }|null} open @param {string} line */
function fenceAfter(open, line) {
  const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!fence) return open;
  if (!open) return { mark: fence[1][0], length: fence[1].length };
  return fence[1][0] === open.mark && fence[1].length >= open.length && !fence[2].trim() ? null : open;
}
// 流式渲染的分段点：最后一个空行，且它前面没有未闭合的代码围栏（裸写的交互内容提进围栏后算，见 liftBareHtml）、后面不是列表 / 缩进 / 表格的延续；
// 以标签收尾的一段要等下一段起头不是标签才分（一段裸 HTML 被分开，提进围栏的就只剩半截）
function stableCut(content) {
  const listy = line => /^\s*(?:[-*+]|\d+[.)])\s/.test(line) || /^\s+\S/.test(line);
  let cut = content.lastIndexOf("\n\n");
  while (cut > 0) {
    const before = content.slice(0, cut),
      prevLine = before.slice(before.lastIndexOf("\n") + 1),
      nextLine = content.slice(cut + 2).split("\n")[0];
    const inFence = inOpenFence(liftBareHtml(before));
    const continues =
      /^\s+\S/.test(nextLine) ||
      (listy(nextLine) && listy(prevLine)) ||
      (/^\s*\|/.test(nextLine) && prevLine.includes("|")) ||
      (/>\s*$/.test(prevLine) && (!nextLine || HTML_LINE.test(nextLine)));
    if (!inFence && !continues) break;
    cut = content.lastIndexOf("\n\n", cut - 1);
  }
  return Math.max(0, cut);
}

// 正文里的代码块：复制；各种嵌件自己的事件由它们各自接上（见 EMBEDS 的 bind）
function bindContentEvents() {
  document.addEventListener("click", e => {
    const copy = e.target.closest("[data-copy-code]");
    if (copy) {
      void copyText(copy.closest(".code-block")?.querySelector("code")?.textContent || "");
      // 小画钮不换字（换了画就没了），说一声；代码块上的字钮照旧换成「已复制」
      if (copy.classList.contains("code-icon")) return toast(t("已复制"));
      copy.textContent = t("已复制");
      setTimeout(() => (copy.textContent = t("复制")), 1200);
    }
  });
  for (const embed of EMBEDS) embed.bind?.();
}
