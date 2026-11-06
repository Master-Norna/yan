// 言 · 文件 · 本地引用：页面里一件本机文件怎么认，文字里写的一条路（图、链接）指向哪一件
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 一件文件就是一条绝对路（斜杠一律 /），页面里各处传的都是它，取用见 localFileUrl。原先是「根 + 根下的路」两样：漏传根不报错，
// 悄悄到卷宗里找、落成破图，修了几回都是这一个病。只有两处还说相对的路：卷宗页（卷宗的视图，出了页就 archiveFile 拼成绝对路）、存下的成品（见 deliverableFile）。
// 引用只问三件事，各一处答，正文、旁注、预览里的 Markdown 同走这一条：
//   写在哪      refAnchor(el)：落脚。相对路从哪算、原路不在了到哪些根里认，都由落脚定；要多一种写字的地方，这里多认一种
//   指向哪      refTarget(raw, anchor)：只算路，不碰磁盘
//   原路不在了  relocateRef(name, anchor)：路是写死的，文档或图一挪就对不上；怎么挪的都接得住（卷宗里拖、资源管理器、模型的指令），文件本身不改
// 图见 drawRefImage，链接见 locateRef。答复记成品也经 refTarget（见 22-changes.js），只是不认搬走的：成品是那一答当时写下的
/**
 * @typedef {object} RefAnchor
 * @property {boolean} [document] 写在一份文档里：/ 起头的从根算，图摊在字里；否则是一答的正文，图画成小样
 * @property {string} [root] / 起头的路从哪算
 * @property {string} [skillDir] 落在技能目录（走技能的取法，不去别处认）
 * @property {string} dir 这段字所在的那一层：绝对路；落在技能目录的是目录下的路
 * @property {string[]} scopes 原路不在了，依次到这些根里认
 * @property {Deliverable[]} [kept] 那一答记下的成品：答完才绑目录（或换了目录），落脚处已挪走，那一答写的路仍指当时的落脚处
 */
/** @typedef {{ file?: string, skillDir?: string, skillPath?: string }} RefTarget 与预览器的来源（viewerSource）同一个样子：本机一件是 file，技能带的一件是后两项 */

/** @param {string} path 去掉结尾的斜杠，反斜杠换成 / */
function slashed(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}
/** @param {string} root @param {string} path 根下的路 */
function joinFile(root, path) {
  return `${slashed(root)}/${path}`;
}
/** @param {string} root @param {string} file @returns {string|null} 根下的路（"" 即根本身），不在根下的是 null */
function relInside(root, file) {
  const base = slashed(root).toLowerCase(),
    lower = slashed(file).toLowerCase();
  if (!base) return null;
  if (lower === base) return "";
  return lower.startsWith(`${base}/`) ? slashed(file).slice(base.length + 1) : null;
}
/** 卷宗页说的路（相对卷宗）拼成一件文件 @param {string} path */
function archiveFile(path) {
  return joinFile(archiveDir(), path);
}
/** @param {string} file @returns {string|null} 在卷宗里的路，不在卷宗里的是 null */
function archiveRel(file) {
  return relInside(archiveDir(), file);
}
/** 取一件文件的地址 @param {string} file @param {boolean} [download] */
function localFileUrl(file, download = false) {
  return `${apiBase}/api/archive/file?file=${encodeURIComponent(file)}${download ? "&download=1" : ""}`;
}
/** @param {string} file */
function downloadFile(file) {
  const anchor = document.createElement("a");
  anchor.href = localFileUrl(file, true);
  anchor.download = file.split("/").pop() || t("卷宗");
  anchor.click();
}

/** 一答的正文：落脚是这段对话的落脚处（绑了目录是它，没绑是卷宗）；搬走的件在它与卷宗里认
 * @param {Conversation|null|undefined} conversation @param {Message|null} [message] @returns {RefAnchor} */
function messageAnchor(conversation, message = null) {
  const root = slashed(workRoot(conversation));
  return { root, dir: root, kept: message?.deliverables, scopes: [...new Set([root, slashed(archiveDir())])].filter(Boolean) };
}
// 一件文件归哪个根：这段对话的落脚处、卷宗，都不是就是它所在的那层
/** @param {string} file */
function fileHome(file) {
  return [workRoot(currentConversation()), archiveDir()].map(slashed).find(root => relInside(root, file) !== null) || parentDir(file);
}
/** 这段字写在哪：预览器里的一份文档落在它自己所在的那一层（与 VS Code 一样），附件里的 Markdown 没有这一层，与别的字一样算这段对话的
 * @param {Element} el @returns {RefAnchor} */
function refAnchor(el) {
  const source = el.closest("#fileViewerStage") ? viewerSource : null;
  if (source?.file) {
    const root = fileHome(source.file);
    return { document: true, root, dir: parentDir(source.file), scopes: [root] };
  }
  if (source?.skillDir) return { document: true, skillDir: source.skillDir, dir: parentDir(source.skillPath), scopes: [] };
  const conversation = currentConversation(),
    id = el.closest("[data-message]")?.getAttribute("data-message");
  return messageAnchor(conversation, (conversation && everyMessage(conversation).find(m => m.id === id)) || null);
}
// 相对的路走一遍：./ 跳过，../ 退一层，到顶为止
/** @param {string} base @param {string} ref 已解过转义的路 @returns {string} */
function walkRelative(base, ref) {
  const parts = base ? base.split("/") : [];
  for (const part of ref.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
/** @param {string} base 一层（"" 即根） @param {string} ref 相对的路，可带 ./ ../ 与 %20 一类转义 */
function archiveRelative(base, ref) {
  let clean = ref.replace(/[?#].*$/, "");
  try {
    clean = decodeURIComponent(clean);
  } catch {}
  return walkRelative(base, clean);
}
// 从一条绝对路再走一段：盘符、共享名、/ 是顶，退不过去
/** @param {string} dir @param {string} ref */
function absJoin(dir, ref) {
  const clean = slashed(dir),
    top = clean.match(/^(?:[a-z]:|\/\/[^/]+\/[^/]+)/i)?.[0] || "";
  return `${top}/${walkRelative("", `${clean.slice(top.length)}/${ref}`)}`;
}
// sandbox:/ 这类不是本机的路返回 null；Windows 上 /mnt/… 这样以 / 起头的也不是，Mac 上它就是绝对路。
// Windows 的共享路径（\\nas\share\… 与 file://nas/share/…）与盘符一样是绝对路；两个正斜杠起头的是协议相对的网址，不认
/** @param {string} raw @param {RefAnchor} anchor @returns {RefTarget | null} */
function refTarget(raw, anchor) {
  let text = String(raw || "")
    .trim()
    .replace(/[?#].*$/, "");
  // 要在换成 / 之前认出来：\\nas\share\… 与 file://nas/share/…
  const shared = /^\\\\[^\\]/.test(text) || /^file:\/\/[^/]/i.test(text);
  try {
    text = decodeURIComponent(text);
  } catch {}
  const fromRoot = !!anchor.document && /^\/(?!\/)/.test(text);
  text = text
    .replace(/^file:\/\/([^/])/i, "//$1")
    .replace(/^file:\/+/i, "/")
    .replace(/\\/g, "/")
    .replace(/^\/([a-z]:\/)/i, "$1");
  if (!fromRoot) {
    const win = (bootstrap.work?.platform || "win32") === "win32";
    if (win && shared) return { file: absJoin(text, "") };
    if (win ? /^[a-z]:\//i.test(text) : /^\/(?!\/)/.test(text)) return { file: absJoin(text, "") };
    if (/^[a-z][\w+.-]*:|^\//i.test(text)) return null;
  }
  if (anchor.skillDir) return { skillDir: anchor.skillDir, skillPath: walkRelative(fromRoot ? "" : anchor.dir, text) };
  const path = walkRelative("", text),
    kept = anchor.kept?.find(file => file.path === path);
  return { file: kept ? deliverableFile(kept) : absJoin((fromRoot ? anchor.root : anchor.dir) || "", text) };
}
/** @param {RefTarget} target */
function refUrl(target) {
  return target.skillDir ? skillFileUrl(target) : localFileUrl(target.file);
}
// 同名的取离这一层最近的（少走几层）；一样近的有几件就不猜，认不出比认错好
/** @param {string} name @param {string} dir @param {string[]} paths @returns {string} */
function nearestSameName(name, dir, paths) {
  const from = dir.toLowerCase().split("/").filter(Boolean),
    want = name.toLowerCase();
  let best = "",
    least = Infinity,
    tied = false;
  for (const path of paths) {
    const parts = path.toLowerCase().split("/");
    if (parts.pop() !== want) continue;
    let shared = 0;
    while (shared < from.length && from[shared] === parts[shared]) shared++;
    const steps = from.length + parts.length - 2 * shared;
    if (steps === least) tied = true;
    if (steps < least) {
      best = path;
      least = steps;
      tied = false;
    }
  }
  return tied ? "" : best;
}
// 一个根的件表留 5 秒：一页里几幅图同时认不出、流式尾段每帧重画，都只问一回
/** @type {Map<string, Promise<string[]>>} */
const refListings = new Map();
/** @param {string} root */
function refListing(root) {
  let listing = refListings.get(root);
  if (!listing) {
    listing = bridge("/api/archive/list", { root }, AbortSignal.timeout(20000)).then(
      data => (data.entries || []).map(entry => entry.path),
      () => []
    );
    refListings.set(root, listing);
    setTimeout(() => refListings.delete(root), 5000);
  }
  return listing;
}
/** @param {string} name @param {RefAnchor} anchor @returns {Promise<RefTarget | null>} */
async function relocateRef(name, anchor) {
  for (const root of anchor.scopes) {
    const path = nearestSameName(name, relInside(root, anchor.dir) || "", await refListing(root));
    if (path) return { file: joinFile(root, path) };
  }
  return null;
}
// 点开一条链接：先按原路，取不到（sandbox:/ 之类、路写错了层、挪走了）再认搬走的
/** @param {string} raw @param {string} name @param {RefAnchor} anchor @returns {Promise<RefTarget | null>} */
async function locateRef(raw, name, anchor) {
  const target = refTarget(raw, anchor);
  if (target) {
    const control = new AbortController(),
      response = await fetch(refUrl(target), { signal: control.signal }).catch(() => null);
    control.abort();
    if (response?.ok) return target;
  }
  return relocateRef(name, anchor);
}
// 画一幅目录里的图：文档里摊在字里，正文里画成小样（点开进看图框）。原路取不到认搬走的，再取不到留下说明文字，不画破图
/** @param {Element} ref 带 data-path / data-file 的 img @param {RefAnchor} anchor @param {string} words 说明文字 @returns {Element} 画好的那一件 */
function drawRefImage(ref, anchor, words) {
  const name = ref.getAttribute("data-file") || "",
    target = refTarget(ref.getAttribute("data-path"), anchor) || refTarget(name, anchor);
  let frame, img;
  if (anchor.document) {
    frame = img = /** @type {HTMLImageElement} */ (ref);
    img.removeAttribute("data-path");
    img.removeAttribute("data-file");
  } else {
    frame = replyShotNode(name);
    frame.innerHTML = `<img alt="${escapeHtml(words)}">`;
    img = frame.querySelector("img");
    shotShape(frame);
    ref.replaceWith(frame);
  }
  /** @param {RefTarget} found */
  const show = found => {
    if (frame !== img) frame.dataset.openFile = found.file;
    img.src = refUrl(found);
  };
  const lost = () => frame.replaceWith(words);
  img.addEventListener(
    "error",
    async () => {
      const found = await relocateRef(name, anchor);
      if (!found) return lost();
      img.addEventListener("error", lost, { once: true });
      show(found);
    },
    { once: true }
  );
  show(target);
  return frame;
}
