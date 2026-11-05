// 言 · 文件 · 本地引用：文字里写的一条本机的路（图、链接）指向哪一件
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 引用只问三件事，各一处答，正文、旁注、预览里的 Markdown 同走这一条：
//   写在哪      refAnchor(el)：落脚。相对路从哪算、原路不在了到哪些根里认，都由落脚定；要多一种写字的地方，这里多认一种
//   指向哪      refTarget(raw, anchor)：只算路，不碰磁盘
//   原路不在了  relocateRef(name, anchor)：路是写死的，文档或图一挪就对不上；怎么挪的都接得住（卷宗里拖、资源管理器、模型的指令），文件本身不改
// 图见 drawRefImage，链接见 locateRef。答复记成品也经 refTarget（见 22-changes.js），只是不认搬走的：成品是那一答当时写下的
/**
 * @typedef {object} RefAnchor
 * @property {boolean} [document] 写在一份文档里：/ 起头的从根算，图摊在字里；否则是一答的正文，图画成小样
 * @property {string} [root] 相对路落在哪个根
 * @property {string} [skillDir] 落在技能目录（走技能的取法，不去别处认）
 * @property {string} dir 这段字在根下的哪一层（"" 即根）
 * @property {string[]} scopes 原路不在了，依次到这些根里认
 * @property {Deliverable[]} [kept] 那一答记下的成品：答完才绑目录（或换了目录），落脚处已挪走，那一答写的路仍指当时的落脚处
 */
/** @typedef {{ root?: string, path?: string, skillDir?: string, skillPath?: string }} RefTarget 与预览器的来源（viewerSource）同一个样子，落在技能目录的只有后两项 */

/** 一答的正文：落脚是这段对话的落脚处（绑了目录是它，没绑是卷宗）；搬走的件在它与卷宗里认
 * @param {Conversation|null|undefined} conversation @param {Message|null} [message] @returns {RefAnchor} */
function messageAnchor(conversation, message = null) {
  const root = workRoot(conversation);
  return { root, dir: "", kept: message?.deliverables, scopes: [...new Set([root, archiveDir()])].filter(Boolean) };
}
/** 这段字写在哪：预览器里的一份文档落在它自己所在的那一层（与 VS Code 一样），附件里的 Markdown 没有这一层，与别的字一样算这段对话的
 * @param {Element} el @returns {RefAnchor} */
function refAnchor(el) {
  const source = el.closest("#fileViewerStage") ? viewerSource : null;
  if (source?.path) {
    const root = source.root || archiveDir();
    return { document: true, root, dir: parentDir(source.path), scopes: [root] };
  }
  if (source?.skillDir) return { document: true, skillDir: source.skillDir, dir: parentDir(source.skillPath), scopes: [] };
  const conversation = currentConversation(),
    id = el.closest("[data-message]")?.getAttribute("data-message");
  return messageAnchor(conversation, (conversation && everyMessage(conversation).find(m => m.id === id)) || null);
}
// 相对的路走一遍：./ 跳过，../ 退一层，退出 base 的记在 up 里（归调用的定：卷宗之外的根照样取得到，原件包里的就到顶为止）
/** @param {string} base @param {string} ref 已解过转义的路 @returns {{ parts: string[], up: number }} */
function walkRelative(base, ref) {
  const parts = base ? base.split("/") : [];
  let up = 0;
  for (const part of ref.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length) parts.pop();
    else up += 1;
  }
  return { parts, up };
}
/** @param {string} base 一层（"" 即根） @param {string} ref 相对的路，可带 ./ ../ 与 %20 一类转义 */
function archiveRelative(base, ref) {
  let clean = ref.replace(/[?#].*$/, "");
  try {
    clean = decodeURIComponent(clean);
  } catch {}
  return walkRelative(base, clean).parts.join("/");
}
// 根往上退几层，到盘符或 / 为止
/** @param {string} root @param {number} up */
function climbRoot(root, up) {
  if (!up) return root;
  const parts = root.replace(/\\/g, "/").replace(/\/+$/, "").split("/"),
    left = parts.slice(0, Math.max(1, parts.length - up)).join("/");
  return /^[a-z]:$/i.test(left) ? `${left}/` : left || "/";
}
// 绝对路在根之内的折成相对，之外的以它所在那层为根。sandbox:/ 这类不是本机的路返回 null；Windows 上 /mnt/… 这样以 / 起头的也不是，Mac 上它就是绝对路
/** @param {string} raw @param {RefAnchor} anchor @returns {RefTarget | null} */
function refTarget(raw, anchor) {
  let text = String(raw || "")
    .trim()
    .replace(/[?#].*$/, "");
  try {
    text = decodeURIComponent(text);
  } catch {}
  const fromRoot = !!anchor.document && /^\/(?!\/)/.test(text);
  text = text
    .replace(/^file:\/+/i, "/")
    .replace(/\\/g, "/")
    .replace(/^\/([a-z]:\/)/i, "$1");
  if (!fromRoot) {
    const win = (bootstrap.work?.platform || "win32") === "win32";
    if (win ? /^[a-z]:\//i.test(text) : /^\/(?!\/)/.test(text)) {
      const root = anchor.root || "",
        base = root.replace(/\\/g, "/").replace(/\/+$/, "");
      if (base && text.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return { root, path: text.slice(base.length + 1) };
      const cut = text.lastIndexOf("/");
      return { root: text.slice(0, cut) || "/", path: text.slice(cut + 1) };
    }
    if (/^[a-z][\w+.-]*:|^\//i.test(text)) return null;
  }
  const { parts, up } = walkRelative(fromRoot ? "" : anchor.dir, text),
    path = parts.join("/");
  if (anchor.skillDir) return { skillDir: anchor.skillDir, skillPath: path };
  const kept = anchor.kept?.find(file => file.path === path);
  return { root: kept ? kept.root || archiveDir() : climbRoot(anchor.root || "", up), path };
}
/** @param {RefTarget} target */
function refUrl(target) {
  return target.skillDir ? skillFileUrl(target) : archiveFileUrl(target.path, false, target.root);
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
    const path = nearestSameName(name, root === anchor.root ? anchor.dir : "", await refListing(root));
    if (path) return { root, path };
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
    if (frame !== img) {
      frame.dataset.openArchive = found.path;
      frame.dataset.root = found.root;
    }
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
