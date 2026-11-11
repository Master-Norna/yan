// 言 · 对话引擎 · 信：帮手的回报、后台指令结束的消息，寄给该醒的那一个——正作答就进它的收件口、在回合边界递上，
// 没在作答就另起一答，帮手睡着就叫醒它，主答断着就先记在对话上、续上时递。帮手与后台指令都只管寄（mailReport）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 帮手的回报（后台指令结束也走这里，见 20-command.js）：这段对话正在作答（模型布置完还在干别的），就进那一答的收件口，
// 在回合边界递上，行迹里它到达的那一刻落一小步「回报」（与补言同样大小，递到打勾）；
// 没在作答（主答只剩等待时已收尾），同一刻到的几份攒成一问另起一答——回报作这一问，两答之间是一道细线（见 relayHtml），不是用户的话。
// relay 是那一项的画法（谁回来了），不给就按帮手画
/** @type {Map<string, Array<{ report: string, step: Step, profile: Profile|null, relay?: any }>>} */
const mailbags = new Map();
/** @param {Conversation} conversation */
function mailReport(conversation, item) {
  // 对象会换：别处写过这段，catchUpConversation 把 store 里的换成了新对象，而帮手、后台指令的闭包还攥着旧的那一个。
  // 按 id 取当前的那一份；真删了（找不到）就照手里这份往下走，写下的没人再读，也就到头了
  conversation = store.conversations.find(c => c.id === conversation.id) || conversation;
  // 帮手开的后台指令，结束时叫醒的是帮手自己（见 mailHelper），不是主对话
  if (item.step?.scope) return void mailHelper(conversation, item.step.scope, item);
  const job = requestJob(conversation.id);
  if (job) return void deliverInline(conversation, job, item);
  const bag = mailbags.get(conversation.id);
  if (bag) return void bag.push(item);
  mailbags.set(conversation.id, [item]);
  setTimeout(() => {
    const items = mailbags.get(conversation.id) || [];
    mailbags.delete(conversation.id);
    wakeWithReports(conversation, items);
  }, 0);
}
/** @returns {Relay} */
function relayOf({ step, relay }) {
  return relay || { step: step.id, title: String(step.title || ""), ok: step.status === "done" };
}
// 回来的是谁：细线、行迹里的那一小步、导出都照它写。seal 是那一方印；gist 是名后淡墨的一句（候迟了多久）
/** @param {Relay} relay @returns {{ seal: string, name: string, gist: string }} */
function relayLabel(relay) {
  if (relay.kind === "timer")
    return { seal: t("候"), name: t`候「${relay.title}」到点`, gist: relay.late ? t`迟 ${spanText(relay.late)}` : "" };
  if (relay.kind === "bg")
    return { seal: t("候"), name: bgEndedText(relay) + (relay.ok || relay.lost ? "" : t` · 退出码 ${relay.exitCode ?? "?"}`), gist: "" };
  return { seal: t("遣"), name: t`帮手「${relay.title}」${relay.ok ? t("回报") : t("未完成")}`, gist: "" };
}
// 收信的那一个（主答的消息，或帮手的 sub）在自己的时间线末落一小步「回报」，递上后打勾；回这一步
/** @param {{ content: string, reasoning?: string, steps?: Step[] }} owner @returns {Step} */
function postRelayNote(owner, item) {
  const relay = relayOf(item);
  /** @type {Step} */
  const note = {
    id: `relay_${uid().slice(0, 8)}`,
    name: "relay_note",
    arguments: "{}",
    status: "running",
    title: relay.title,
    relay,
    at: owner.content.length,
    rat: String(owner.reasoning || "").length
  };
  (owner.steps ||= []).push(note);
  return note;
}
// 作答途中到的：行迹里落一步「回报」，递上后打勾（deliverSupplements 按 note 打勾）；这一答没来得及递就收尾了，
// settleSupplements 把这一步撤下、回报另起一答
/** @param {Conversation} conversation */
function deliverInline(conversation, job, item) {
  const host = conversation.messages.find(message => message.id === job.assistantId);
  if (host) {
    item = { ...item, note: postRelayNote(host, item) };
    refreshSteps(host);
  }
  job.queue.push(item);
}
// 寄给帮手的（它自己开的后台指令结束了）：与寄给主答同一个样子——它自己的时间线里落一小步「回报」，信进它的收件口，
// 正做着就在回合边界递上，睡着就叫醒它。它已收工（做完、叫停、页面刷新过），信就不送了，那一步的签照旧改成已结束
/** @param {Conversation} conversation @param {string} scope 帮手的 sub.id */
function mailHelper(conversation, scope, item) {
  const box = (crews.get(conversation.id) || []).find(entry => entry.sub.id === scope);
  if (!box) return;
  box.queue.push({ ...item, note: postRelayNote(box.sub, item) });
  box.wake?.();
  refreshSteps(box.host);
}
// 睡到有信来（或等的后台都了结了）：不发请求、没有谁醒着；叫停、停止照样打断
function sleepUntilMail(box) {
  const signal = box.controller.signal;
  return new Promise((resolve, reject) => {
    const stop = () => {
      box.wake = null;
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    box.wake = () => {
      box.wake = null;
      signal.removeEventListener("abort", stop);
      resolve(null);
    };
  });
}
/** @param {Conversation} conversation */
async function wakeWithReports(conversation, items) {
  if (!items.length || !store.conversations.some(c => c.id === conversation.id)) return;
  // 几处页面同开：照发送的规矩先认领，别处正在这段里作答就等它松手（报到每几秒一回，见 syncLeases）再来。
  // 等过之后按 id 重找：别处写过的，这边读回来已换了一个对象。这段或相交的目录正退回的也等它退完（认领之后再看，等的工夫里可能点了退回）
  if (!requestJob(conversation.id) && (remoteBusy.has(conversation.id) || !(await claimTurn(conversation, { quiet: true }))))
    return void setTimeout(() => {
      const fresh = store.conversations.find(c => c.id === conversation.id);
      if (fresh) void wakeWithReports(fresh, items);
    }, 5000);
  // 认领的工夫里对象也可能被换过：往下都写当前这一份
  const live = store.conversations.find(c => c.id === conversation.id);
  if (!live) return;
  conversation = live;
  // 攒着的这一会儿里有人开了一答（用户发了话、上一答收尾时补言另起了一问）：交给它
  const job = requestJob(conversation.id);
  if (job) return void items.forEach(item => deliverInline(conversation, job, item));
  const profile = profiles().find(p => p.id === items[0].profile?.id) || activeProfile(conversation),
    ready = profile && !quotaBlocked(profile);
  // 上一答断着（断网中断、报错）：另起一答会在断处底下留一截，续上那一答时它就成了残留，主线也从此分成两头。
  // 回报先记在这段对话上，下一答开工时递上（见 takeHeldReports）；中断的那一答就此续上，还断着就原样记着，等下一回
  const last = conversation.messages.at(-1);
  if (last?.role === "assistant" && (last.status === "interrupted" || last.status === "error")) {
    (conversation.heldReports ||= []).push(...items.map(item => ({ report: item.report, relay: relayOf(item) })));
    markDirty(conversation.id);
    saveStore();
    if (last.status === "interrupted" && ready) void resumeAnswer(conversation, last, profile);
    return;
  }
  /** @type {Message} */
  const user = {
    id: uid(),
    role: "user",
    content: items
      .map(item => item.report)
      .filter(Boolean)
      .join("\n\n"),
    timestamp: now(),
    relay: items.map(relayOf)
  };
  if (ready) return void startTurn(conversation, user, profile, { follow: false });
  // 没有可用的模型或余墨已尽：回报先记下，等用户换了模型再问
  conversation.messages.push(user);
  conversation.updatedAt = now();
  markDirty(conversation.id);
  saveStore();
  if (currentId === conversation.id && view === "chat") renderConversation();
  else renderHistory();
  toast(profile ? t("余墨已尽，帮手的回报先记下了") : t("没有可用的模型，帮手的回报先记下了"));
}
// 断着时记下的回报交给开工的这一答：行迹里落一步「回报」，随后当即递上。派它的那一步已不在眼前这条路上的（重答把那一答收成了版本）不递，
// 免得张冠李戴。返回交出去的几项，这一答一个字没等到就又断了，原样还回去
/** @param {Conversation} conversation @returns {Array<{ report: string, relay: any, note?: Step }>} */
function takeHeldReports(conversation, job) {
  const held = conversation.heldReports || [];
  delete conversation.heldReports;
  const onPath = new Set(conversation.messages.flatMap(message => (message.steps || []).map(step => step.id)));
  return held
    .filter(item => onPath.has(item.relay.step))
    .map(item => {
      deliverInline(conversation, job, item);
      return job.queue.at(-1);
    });
}
/** @param {Conversation} conversation @param {Message} host */
function returnHeldReports(conversation, host, taken) {
  if (!taken.length) return;
  const notes = new Set(taken.map(item => item.note?.id));
  host.steps = (host.steps || []).filter(step => !notes.has(step.id));
  if (!host.steps.length) delete host.steps;
  conversation.heldReports = [...taken.map(({ report, relay }) => ({ report, relay })), ...(conversation.heldReports || [])];
}
// 续写一答时，它底下只有回报另起、又没写出东西就断了或停了的几答（断网时帮手回报的常见残留）：收回来，回报交给续上的这一答
/** @param {Conversation} conversation @param {Message} message */
function foldRelayTail(conversation, message) {
  const at = conversation.messages.indexOf(message),
    tail = conversation.messages.slice(at + 1),
    ids = new Set([message.id, ...tail.map(m => m.id)]);
  const empty = m =>
    m.role === "user" ? !!m.relay?.length : m.role === "assistant" && m.status !== "streaming" && !m.content.trim() && !m.steps?.length;
  if (at < 0 || !tail.length || !tail.every(empty) || (conversation.forks || []).some(fork => ids.has(fork.parentId))) return;
  conversation.messages = conversation.messages.slice(0, at + 1);
  const folded = tail
    .filter(m => m.role === "user")
    .flatMap(m => (m.relay || []).map((relay, i) => ({ report: i ? "" : m.content, relay })));
  conversation.heldReports = [...folded, ...(conversation.heldReports || [])];
}
