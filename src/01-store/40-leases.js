// 言 · 本地存储 · 租约：几处页面同开时谁在作答
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 几处页面同开：谁在作答 ----------
// 两个浏览器、VS Code 与浏览器同开同一个存储时，各页只知道自己在跑什么：那边正作答的一段，这边刷新后读到的是磁盘上「生成中」的快照，
// 从前会当成页面刷新而中断、写回磁盘，两边轮流互盖，这边再点「继续生成」就成了两处同写一条回复。
// 现在每隔几秒向桥接报到一次：报的是这边正作答的（以及作答完、最后一次存盘还没落地的）对话，回来的是别处正作答的。
// 别处正作答的那几段，这边只看不动：不当成中断、不存盘、不让发问与改动，每次报到顺带从磁盘读回最新进度；
// 别处松了手（写完，或页面关了、崩了，十五秒没来报到），再读一回：还停在「生成中」的，才按中断处理
let leasing = null;
function syncLeases() {
  if (apiBase === null || !chatsOnline()) return Promise.resolve();
  if (leasing) return leasing;
  // 正作答的都算上（旁注的作业按它所在的对话记）；作答完了、最后一次存盘也落了地的松手
  const running = new Set([...requestJobs].map(([key, job]) => job.conversationId || key));
  for (const id of running) leaseHold.add(id);
  for (const id of [...leaseHold]) if (!running.has(id) && !chatWritePromises.has(id) && !pendingChatWrites.has(id)) leaseHold.delete(id);
  leasing = bridge("/api/chats/lease", { owner: PAGE_ID, ids: [...leaseHold] }, AbortSignal.timeout(5000))
    .then(async ({ busy = [] }) => {
      const released = [...remoteBusy].filter(id => !busy.includes(id));
      remoteBusy.clear();
      for (const id of busy) remoteBusy.add(id);
      const follow = [...remoteBusy, ...released].filter(id => store.conversations.some(c => c.id === id));
      if (follow.length) await followConversations(follow, released);
      if (currentId && (remoteBusy.has(currentId) || released.includes(currentId))) {
        renderSendButtons();
        refreshConnection();
      }
    })
    .catch(() => {})
    .finally(() => (leasing = null));
  return leasing;
}
// 页面要关或刷新：先松手。不然刷新后的自己会把刷新前的自己当成「别处在作答」，停在半途的那一答就不收束了
function releaseLeases() {
  if (apiBase === null || !leaseHold.size) return;
  leaseHold.clear();
  fetch(`${apiBase}/api/chats/lease`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner: PAGE_ID, ids: [] }),
    keepalive: true
  }).catch(() => {});
}
/** 别处正作答（或刚松手）的几段：磁盘上的更新就换进来；刚松手的若仍停在「生成中」，那边是没写完就走了，按中断收束 */
async function followConversations(ids, released) {
  const data = await bridge("/api/chats/load", { root: chatsDir(), ids }, AbortSignal.timeout(20000));
  let current = false;
  for (const item of data.items || []) {
    if (!store.conversations.some(c => c.id === item.id) || item.savedAt <= (chatStamps.get(item.id) || 0) || conversationRunning(item.id))
      continue;
    catchUpConversation(item, { quiet: true });
    if (item.id === currentId) current = true;
  }
  for (const id of released) {
    const c = store.conversations.find(item => item.id === id);
    if (c && !conversationRunning(id) && recoverConversation(c)) {
      markDirty(id);
      saveStoreSoon();
      if (id === currentId) current = true;
    }
  }
  renderHistory();
  if (current && view === "chat") renderConversation(false);
}
/** 这边跟着看、别处正作答：只看不动 */
function runningElsewhere(id = currentId) {
  return !!id && remoteBusy.has(id) && !conversationRunning(id);
}
