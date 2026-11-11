// 言 · 对话引擎 · 到点叫醒：约好的时刻到了，桥接先把那一回落在 存储根/候/到点/（见 server/timers.js），这里等着、认领，
// 照回报的路子寄给那段对话（mailReport）：正作答就递进这一答，没在作答就另起一答。页面关着时在桥接那头攒着，开页即递；
// 几页同开，谁认领到谁递。那段对话别处正在答的先跳过、留给别处，桥接一分钟后空手回，那时再看一眼
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
async function listenTimers() {
  /** @type {string[]} */
  let skip = [];
  for (;;) {
    const scope = bootstrap.store;
    try {
      const { fired } = await storeBridge("/api/timer/wait", { skip });
      if (bootstrap.store !== scope) continue;
      const mine = fired.filter(item => !remoteBusy.has(item.to));
      skip = fired.length ? fired.filter(item => remoteBusy.has(item.to)).map(item => item.id) : [];
      if (!mine.length) continue;
      // 这页还认不出挂它的那一步（别处刚约的、这页的副本旧了，或整段对话是别处新开的）：先从目录读回再认领，
      // 不然认领了却递不出去，这一回就丢了。读回来仍没有的（那一答已换下）才照旧认领了作罢
      const unseen = mine.filter(item => !timerVisible(item));
      if (unseen.length) {
        const ids = [...new Set(unseen.map(item => item.to))];
        if (ids.every(id => store.conversations.some(c => c.id === id))) await followConversations(ids, []);
        else await syncChatsWithDisk();
      }
      if (bootstrap.store !== scope) continue;
      const { fired: taken } = await storeBridge("/api/timer/take", { ids: mine.map(item => item.id) });
      if (bootstrap.store !== scope) continue;
      for (const item of taken) deliverTimer(item);
    } catch {
      // 桥接断了一下（重启、睡眠醒来）：稍候再等
      await new Promise(resolve => setTimeout(resolve, 5000));
    } finally {
      if (bootstrap.store !== scope) skip = [];
    }
  }
}
/** @param {{ to: string, timer: { id: string } }} fired */
function timerVisible({ to, timer }) {
  const conversation = store.conversations.find(c => c.id === to);
  return !!conversation && !!timerStepOf(conversation, timer.id);
}
/** @param {{ to: string, timer: { id: string, step: string, note: string, due: number, late: number, every?: number, next?: number } }} fired */
function deliverTimer({ to, timer }) {
  const conversation = store.conversations.find(c => c.id === to),
    step = conversation && timerStepOf(conversation, timer.id);
  // 对话已删、挂它的那一答已换下、或已取消：不叫
  if (!step || step.timer?.state === "stopped") return;
  if (timer.next) {
    step.timer.due = timer.next;
    markDirty(conversation.id);
    renderClepsydra();
  } else settleTimer(step, "done");
  // 迟了一分钟以上才说（桥接那时没开、电脑睡着）：差几秒是计时的常态
  const late = timer.late >= 60000 ? timer.late : 0;
  mailReport(conversation, {
    report: prompt("work.timerDue", {
      id: timer.id,
      note: timer.note,
      due: clockText(timer.due),
      late: late ? prompt("work.timerLate", { late: spanText(late) }) : "",
      next: timer.next ? prompt("work.timerNext", { next: clockText(timer.next) }) : ""
    }),
    step,
    profile: requestJob(conversation.id)?.profile || activeProfile(conversation),
    relay: { step: step.id, title: timer.note, ok: true, kind: "timer", ...(late ? { late } : {}) }
  });
}
