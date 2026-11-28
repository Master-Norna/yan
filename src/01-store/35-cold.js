// 言 · 本地存储 · 行迹另存：收了尾的一答，思绪与帮手的经过另存进对话目录的 行迹/<短码>/，对话文件里只留记号
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 长活的对话一段十几二十 MB，九成是收了尾的帮手经过（sub.steps、sub.reasoning）与思绪（reasoning）。整份存、整份读，
// 开页要把它们全读进来，作答中三秒一存要在主线程上序列化、算指纹、传一遍。收了尾的一答此后不再变（续写只认停了、断了、出错的，
// 断着的帮手也不算收尾），挪出去写一次就够：对话文件里那一答记 cold：key 指向另存内容，files 记挪走的步骤所带的附件，确知只另存思绪时另记 reasoningOnly。
// 开着看的那段先接回行迹，只有确知是纯思绪、又收着的一答等摊开才取；跑工具、续派帮手和导出备份前仍取整段。
// 没取回的那几答在内存里就缺着那几样；存的时候只看记号，照样写记号（chatJson），不会把缺着的当成删了
const COLD_MIN_CHARS = 16 * 1024; // 挪走的部分不到这么长就不挪：一答一个小文件不划算
const warmMessages = new WeakSet(), // 带记号、挪走的那几样已接回（或本就在手上）的
  slightMessages = new WeakSet(), // 收了尾、量过不够长的：不再量
  lostTrails = new Set(), // 目录里取不到的：不再一回回去问
  warming = new Map();
// 收了尾、此后不再动的一答：答完了，每一步都了结，帮手都收了工，后台指令都停了
/** @param {Message} m */
function settledMessage(m) {
  return (
    m?.role === "assistant" &&
    m.status === "complete" &&
    allSteps(m).every(
      step =>
        ["done", "error", "skipped"].includes(step.status) &&
        step.bg?.state !== "running" &&
        (!step.sub || ["complete", "stopped", "error"].includes(step.sub.status))
    )
  );
}
// 挪走的那一份：这一答的思绪，各帮手（按 sub.id 认）的思绪与步骤
/** @param {Message} m */
function coldPiece(m) {
  /** @type {Record<string, { steps: Step[], reasoning: string }>} */
  const subs = {};
  for (const step of m.steps || [])
    if (step.sub?.id) subs[step.sub.id] = { steps: step.sub.steps || [], reasoning: step.sub.reasoning || "" };
  return { reasoning: m.reasoning || "", subs };
}
// 取回的接上：手上已有的（并进来的新份）不盖
/** @param {Message} m */
function applyColdPiece(m, piece) {
  if (m.reasoning === undefined && piece.reasoning) m.reasoning = piece.reasoning;
  for (const step of m.steps || []) {
    const part = step.sub?.id && piece.subs?.[step.sub.id];
    if (!part) continue;
    if (step.sub.steps === undefined) step.sub.steps = part.steps || [];
    if (step.sub.reasoning === undefined) step.sub.reasoning = part.reasoning || "";
  }
}
// 落盘的样子：带记号的一答去掉挪走的那几样。记号在、却又动了起来（不该有，留个出路）：接回了的照常整份写、去掉记号，
// 没接回的仍只写记号——手上缺的那几样不能当成空的写下去
/** @param {Message} m */
function coldMessageView(m) {
  if (!m?.cold) return m;
  if (!settledMessage(m) && warmMessages.has(m)) {
    const { cold, ...rest } = m;
    return rest;
  }
  const { reasoning, ...rest } = m;
  if (!rest.steps) return rest;
  return {
    ...rest,
    steps: rest.steps.map(step => {
      if (!step.sub?.id) return step;
      const { steps, reasoning, ...sub } = step.sub;
      return { ...step, sub };
    })
  };
}
/** @param {Conversation} c */
function coldView(c) {
  const list = (/** @type {Message[]} */ messages) => (messages.some(m => m?.cold) ? messages.map(coldMessageView) : messages),
    nested = (/** @type {any[]} */ items) =>
      items.map(item => (Array.isArray(item?.messages) ? { ...item, messages: list(item.messages) } : item));
  return { ...c, messages: list(c.messages), forks: nested(c.forks || []), threads: nested(c.threads || []) };
}
// 一段对话落盘、算指纹、作并合的共同起点，都用这一份
/** @param {Conversation} c */
function chatJson(c) {
  return JSON.stringify(coldView(c));
}
// 浏览器的兜底不依赖本次另存的磁盘行迹；未知正文仍留原指针，不把它当成空答。
/** @param {Conversation} c */
function chatSpillJson(c) {
  return JSON.stringify(c, function (key, value) {
    return key === "cold" && warmMessages.has(this) ? undefined : value;
  });
}
// 落盘前：新收了尾、够长的几答把那几样另存出去，记上记号；又动起来且另存内容已接回的，才拿掉旧记号（见 coldMessageView）
/** @param {Conversation} c */
async function coldify(c) {
  if (!chatsOnline()) return;
  const scope = bootstrap.store,
    root = chatsDir();
  for (const m of everyMessage(c)) {
    if (m.cold) {
      if (!settledMessage(m) && warmMessages.has(m)) delete m.cold;
      continue;
    }
    if (slightMessages.has(m) || !settledMessage(m)) continue;
    const piece = coldPiece(m),
      reasoningOnly = !m.steps?.length && !!piece.reasoning.trim(),
      json = JSON.stringify(piece);
    if (json.length < COLD_MIN_CHARS) {
      slightMessages.add(m);
      continue;
    }
    const key = `${String(m.id)
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 80)}-${hashText(json).replace(":", "-")}`,
      files = Object.values(piece.subs)
        .flatMap(sub => sub.steps.flatMap(step => step.attachments || []))
        .map(file => ({ id: file.id, size: Number(file.size) || 0 }));
    try {
      const done = await bridgeJson(
        "/api/chats/trail/put",
        `{"root":${JSON.stringify(root)},"storeRoot":${JSON.stringify(scope?.root || "")},"id":${JSON.stringify(c.id)},"key":"${key}","piece":${json}}`,
        AbortSignal.timeout(60000)
      );
      if (done.skipped || bootstrap.store !== scope || chatsDir() !== root) return;
    } catch {
      return;
    }
    m.cold = { key, ...(files.length ? { files } : {}), ...(reasoningOnly ? { reasoningOnly: true } : {}) };
    warmMessages.add(m);
  }
}
// 旧记号不能证明只另存了思绪，照旧取回；有步骤或又动起来的一答也不能延后。
/** @param {Message} m */
function unreadThought(m) {
  return (
    m.cold?.reasoningOnly === true &&
    m.role === "assistant" &&
    m.status === "complete" &&
    !m.steps?.length &&
    m.reasoning === undefined &&
    !warmMessages.has(m)
  );
}
// 工具、续派与备份仍取整段（连同换下的版本与旁注）。
/** @param {Conversation|null|undefined} c */
function warmConversation(c) {
  return c ? warmTrails(c, everyMessage(c)) : Promise.resolve(0);
}
// 批量与单答共用一个读口；并发只共用交集里的 key，不漏掉后来另要的，也能接到读期间换上的消息对象。
/** @param {Conversation} c @param {Message[]} messages */
async function warmTrails(c, messages) {
  const root = chatsDir(),
    scope = bootstrap.store;
  if (!root) return 0;
  const address = key => JSON.stringify([root, c.id, key]),
    cold = messages.flatMap(m => {
      const key = m.cold?.key;
      return key && !warmMessages.has(m) && !lostTrails.has(address(key)) ? [{ m, key }] : [];
    }),
    keys = [...new Set(cold.map(({ key }) => key))],
    missing = keys.filter(key => !warming.has(address(key)));
  if (!keys.length) return 0;
  if (missing.length) {
    const read = bridge("/api/chats/trail/get", { root, storeRoot: scope?.root, id: c.id, keys: missing }, AbortSignal.timeout(60000));
    for (const key of missing) {
      const slot = address(key);
      warming.set(
        slot,
        read
          .then(({ pieces }) => {
            const piece = pieces?.[key];
            if (!piece && bootstrap.store === scope) lostTrails.add(slot);
            return piece;
          })
          .catch(() => undefined)
          .finally(() => {
            if (bootstrap.store === scope) warming.delete(slot);
          })
      );
    }
  }
  const pieces = await Promise.all(keys.map(key => warming.get(address(key)))),
    byKey = new Map(keys.map((key, index) => [key, pieces[index]]));
  if (bootstrap.store !== scope || chatsDir() !== root) return 0;
  let ready = 0;
  for (const { m, key } of cold) {
    const piece = byKey.get(key);
    if (!piece || m.cold?.key !== key) continue;
    // 共用读取的另一方可能已接上；只写一次，但这次等待也已就绪。
    if (!warmMessages.has(m)) {
      applyColdPiece(m, piece);
      warmMessages.add(m);
    }
    ready += 1;
  }
  return ready;
}
// 目录里的新份换下了手上这段（见 catchUpConversation）：同一份另存的几答，手上已接回的那几样搬过去，不必再取
/** @param {Conversation} prev @param {Conversation} next */
function carryWarm(prev, next) {
  if (prev === next) return;
  const had = new Map(
    everyMessage(prev)
      .filter(m => m.cold && warmMessages.has(m))
      .map(m => [m.cold.key, m])
  );
  if (!had.size) return;
  for (const m of everyMessage(next)) {
    const old = m.cold && !warmMessages.has(m) && had.get(m.cold.key);
    if (!old) continue;
    applyColdPiece(m, coldPiece(old));
    warmMessages.add(m);
  }
}
// 开着看的这段按批接回另存内容；收起的纯思绪等手动摊开时单独取。两路共用思绪的展示收口。
/** @param {Conversation} c @param {Message|null} [thought] 手动展开的一答 */
async function warmInView(c, thought = null) {
  const scope = bootstrap.store,
    root = chatsDir(),
    messages = thought ? [thought] : everyMessage(c).filter(m => !unreadThought(m) || (m.firstThoughtOpen ?? m.reasoningOpen)),
    thoughts = (thought ? [thought] : messages.filter(unreadThought)).map(m => ({ m, key: m.cold?.key }));
  for (const { m } of thoughts) coldThoughtDetails(c, m)?.setAttribute("aria-busy", "true");
  const ready = await warmTrails(c, messages);
  if (bootstrap.store !== scope || chatsDir() !== root || !store.conversations.includes(c)) return;
  let failed = false,
    warn = false,
    shown = false;
  const stillHere = thoughts.length ? new Set(everyMessage(c)) : null;
  for (const { m, key } of thoughts) {
    // 可能已换根、跟读到新对象或收起；可以把旧答接回内存，不能改另一份答复的开合。
    if (m.cold?.key !== key || !stillHere.has(m)) continue;
    const details = coldThoughtDetails(c, m);
    details?.removeAttribute("aria-busy");
    if (!unreadThought(m)) shown ||= !!details;
    else if (m.firstThoughtOpen ?? m.reasoningOpen) {
      if (m.firstThoughtOpen !== undefined) m.firstThoughtOpen = false;
      else m.reasoningOpen = false;
      failed = true;
      if (details) {
        setProcessDetails(details, false, false);
        warn = true;
      }
    }
  }
  if (failed) saveStoreSoon();
  if (warn) toast(t`${t("思绪")} 读取失败`);
  if (!thought && ready) {
    // 旧版可能把帮手仍在执行的后台指令另存了：接回后补上入口与监听。
    rewatchBackground();
    renderClepsydra();
  }
  // 备份可能早已把正文接回，但画面仍是冷思绪壳；手动展开也要重画。
  if (!(thought ? shown : ready) || currentConversation() !== c || view !== "chat") return;
  if (!thought || c.messages.includes(thought)) renderConversation(false);
  if (!thought) renderHelperPanel();
  if (sidePanelOpen() && (!thought || currentThread()?.messages.includes(thought))) renderSidePanel();
}
// 帮手步骤的开合记在挪走的那一份里：动了就拿掉记号，下回存时这一答整份写回、再另存一份
/** @param {Step} step */
function thawStep(step) {
  const c = currentConversation(),
    m = c && everyMessage(c).find(item => item.cold && (item.steps || []).some(own => own.sub?.steps?.includes(step)));
  if (m && warmMessages.has(m)) delete m.cold;
}
// 挪走的步骤里带的附件（帮手交回的画面之类）：清原件、算用量时照样算在用
/** @param {Message} m */
function coldFiles(m) {
  return m.cold?.files || [];
}
