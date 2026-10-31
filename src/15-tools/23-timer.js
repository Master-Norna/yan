// 言 · 候 · 等时刻：模型约好几点叫醒自己（隔一阵再叫亦可）。与后台指令同是「候」，只是叫醒的条件是时刻到、不是进程结束：
// 时刻记在桥接（存储根/候/约.json，见 server/timers.js），不占进程，桥接重启后照旧、错过的补叫；到点时交给页面（见 14-chat-engine/75-timers.js），
// 照回报的路子叫醒它。看与取消同后台指令，走 check_command。「止」不碰它；重答、删对话时挂它的那一步没了，才一并取消（见 releaseBackground）
defineTool({
  name: "set_timer",
  group: "work",
  label: t("定时"),
  offer: ctx => ctx.files,
  mainOnly: true,
  async run(step, args, { conversation, signal }) {
    const note = String(args.note || "").trim(),
      every = Math.round(Number(args.every) * 1000) || 0,
      when = timerDue(args);
    if (!note) return { ok: false, content: t("note 为空：写上到时给自己的话"), display: "缺 note" };
    if ("error" in when) return { ok: false, content: when.error, display: "时刻无效" };
    step.title = step.gist = note;
    const timer = await bridge("/api/timer/set", { to: conversation.id, step: step.id, note, due: when.due, every }, signal);
    step.timer = { id: timer.id, due: timer.due, ...(every ? { every } : {}), state: "waiting", created: timer.created };
    renderClepsydra();
    return {
      ok: true,
      content: prompt("work.timerSet", {
        id: timer.id,
        due: clockText(timer.due),
        left: spanText(timer.due - Date.now()),
        every: every ? prompt("work.timerEvery", { every: spanText(every) }) : ""
      }),
      display: `${timer.id} · ${dueLabel(timer.due)}`
    };
  }
});
// at（本地时刻：2026-10-31 09:00，或只写 09:00 即下一个这个钟点）与 after（秒）给一个
/** @returns {{ due: number } | { error: string }} */
function timerDue(args) {
  const after = Number(args.after);
  if (after > 0) return { due: Date.now() + Math.round(after * 1000) };
  const text = String(args.at || "").trim();
  if (!text) return { error: t("at 与 after 给一个：at 是本地时刻（2026-10-31 09:00，或 09:00 即下一个这个钟点），after 是秒数") };
  const full = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/),
    clock = text.match(/^(\d{1,2}):(\d{2})$/);
  let due = NaN;
  if (full) due = new Date(+full[1], +full[2] - 1, +full[3], +full[4], +full[5], +(full[6] || 0)).getTime();
  else if (clock) {
    const day = new Date();
    day.setHours(+clock[1], +clock[2], 0, 0);
    if (day.getTime() <= Date.now()) day.setDate(day.getDate() + 1);
    due = day.getTime();
  } else due = Date.parse(text);
  if (!Number.isFinite(due)) return { error: t`读不懂这个时刻：${text}（写成 2026-10-31 09:00 或 09:00）` };
  if (due <= Date.now()) return { error: t`${clockText(due)} 已经过了（现在是 ${clockText(Date.now())}）` };
  return { due };
}
const pad2 = n => String(n).padStart(2, "0");
/** 给模型看的时刻：2026-10-31 09:00 */
function clockText(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/** 给人看的几时到：今天写钟点，明天写「明」，再远写月日 */
function dueLabel(ms) {
  const d = new Date(ms),
    hm = `${d.getHours()}:${pad2(d.getMinutes())}`,
    days = Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? hm : days === 1 ? t`明 ${hm}` : t`${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
// 这段对话里编号为 id 的那条等时刻的候
/** @param {Conversation} conversation */
function timerStepOf(conversation, id) {
  return (
    conversation.messages
      .flatMap(message => message.steps || [])
      .filter(step => step.timer?.id === id)
      .at(-1) || null
  );
}
// 签上写它此刻的样子：叫过了（不再叫）、取消了、桥接那头已没有它
/** @param {Step} step @param {"done"|"stopped"} state */
function settleTimer(step, state, assistant = null) {
  if (!step.timer || step.timer.state !== "waiting") return;
  step.timer.state = state;
  step.result = `${step.timer.id} · ${state === "done" ? "已叫过" : "已取消"}`;
  const owner = assistant || store.conversations.flatMap(c => c.messages).find(m => (m.steps || []).includes(step));
  const conversation = owner && store.conversations.find(c => c.messages.includes(owner));
  if (conversation) markDirty(conversation.id);
  saveStore();
  if (owner) refreshSteps(owner);
  renderClepsydra();
}
// check_command 认到 t 开头的编号：看几时到，或 stop 取消它
async function checkTimer(step, id, stop, conversation, signal) {
  const started = timerStepOf(conversation, id);
  step.title = `${id}${stop ? t(" · 取消") : ""}`;
  if (stop) {
    const data = await bridge("/api/timer/cancel", { id, to: conversation.id }, signal);
    if (started) settleTimer(started, data.found ? "stopped" : "done");
    return {
      ok: true,
      content: data.found ? t`${id} 已取消` : t`没有在等的 ${id}（已叫过或已取消）`,
      display: data.found ? "已取消" : "不在等"
    };
  }
  const { timers } = await bridge("/api/timer/list", {}, signal),
    timer = timers.find(item => item.id === id && item.to === conversation.id);
  if (!timer) return { ok: true, content: t`没有在等的 ${id}（已叫过或已取消）`, display: "不在等" };
  return {
    ok: true,
    content: t`${id}「${timer.note}」定于 ${clockText(timer.due)}（还有 ${spanText(timer.due - Date.now())}）${timer.every ? t`，此后每 ${spanText(timer.every)} 再叫` : ""}`,
    display: dueLabel(timer.due)
  };
}
// 开页时对一遍桥接那头的候：隔一阵再叫的取它眼下的下一回；桥接那头已没有的，是叫过了（信若还没递，稍后照常送到）或取消了
async function reconcileTimers() {
  const steps = store.conversations.flatMap(c => c.messages.flatMap(m => (m.steps || []).filter(step => step.timer?.state === "waiting")));
  if (!steps.length) return;
  const { timers } = await bridge("/api/timer/list", {}).catch(() => ({ timers: null }));
  if (!timers) return;
  const live = new Map(timers.map(timer => [timer.id, timer]));
  for (const step of steps) {
    const timer = live.get(step.timer.id);
    if (!timer) settleTimer(step, "done");
    else if (timer.due !== step.timer.due) step.timer.due = timer.due;
  }
  renderClepsydra();
}
