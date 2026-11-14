// 言 · 本地存储 · 行迹另存：收了尾的一答，思绪与帮手的经过另存进对话目录的 行迹/<短码>/，对话文件里只留记号
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 长活的对话一段十几二十 MB，九成是收了尾的帮手经过（sub.steps、sub.reasoning）与思绪（reasoning）。整份存、整份读，
// 开页要把它们全读进来，作答中三秒一存要在主线程上序列化、算指纹、传一遍。收了尾的一答此后不再变（续写只认停了、断了、出错的，
// 断着的帮手也不算收尾），挪出去写一次就够：对话文件里那一答记 cold: { key, files }，files 是挪走的步骤里带的附件，清原件时照样算在用。
// 页面里那几样只在要用时取回来接上（warmConversation）：开着看的那段、跑工具前、续派帮手前、导出备份前。
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
// 落盘前：新收了尾、够长的几答把那几样另存出去，记上记号；记号在却又动起来了的（见 coldMessageView），记号拿掉
/** @param {Conversation} c */
async function coldify(c) {
  if (!chatsOnline()) return;
  for (const m of everyMessage(c)) {
    if (m.cold) {
      if (!settledMessage(m) && warmMessages.has(m)) delete m.cold;
      continue;
    }
    if (slightMessages.has(m) || !settledMessage(m)) continue;
    const piece = coldPiece(m),
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
        `{"root":${JSON.stringify(chatsDir())},"id":${JSON.stringify(c.id)},"key":"${key}","piece":${json}}`,
        AbortSignal.timeout(60000)
      );
      if (done.skipped) return;
    } catch {
      return;
    }
    m.cold = { key, ...(files.length ? { files } : {}) };
    warmMessages.add(m);
  }
}
// 把这段对话里没接回的几答取回来接上；返回接上了几答。几处同时要时只取一回
/** @param {Conversation|null|undefined} c @returns {Promise<number>} */
function warmConversation(c) {
  const cold = c ? everyMessage(c).filter(m => m.cold && !warmMessages.has(m) && !lostTrails.has(m.cold.key)) : [];
  if (!cold.length || !chatsDir()) return Promise.resolve(0);
  if (warming.has(c.id)) return warming.get(c.id);
  const task = (async () => {
    try {
      const { pieces = {} } = await bridge(
        "/api/chats/trail/get",
        { root: chatsDir(), id: c.id, keys: [...new Set(cold.map(m => m.cold.key))] },
        AbortSignal.timeout(60000)
      );
      let applied = 0;
      for (const m of cold) {
        const piece = pieces[m.cold.key];
        if (!piece) {
          lostTrails.add(m.cold.key);
          continue;
        }
        applyColdPiece(m, piece);
        warmMessages.add(m);
        applied += 1;
      }
      return applied;
    } catch {
      return 0;
    } finally {
      warming.delete(c.id);
    }
  })();
  warming.set(c.id, task);
  return task;
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
// 开着看的这段：没接回的取回来，接上了就重画（正文、开着的差遣面板与旁注）
/** @param {Conversation} c */
function warmInView(c) {
  void warmConversation(c).then(applied => {
    if (!applied) return;
    // 旧版可能把帮手仍在执行的后台指令另存了：接回后补上入口与监听。
    rewatchBackground();
    renderClepsydra();
    if (currentId !== c.id || view !== "chat") return;
    renderConversation(false);
    renderHelperPanel();
    if (sidePanelOpen()) renderSidePanel();
  });
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
