// 言 · 本地存储 · 租约：几处页面同开时谁在作答
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
const remoteBusy = new Set(),
  leaseHold = new Set(),
  leaseClaims = new Map(),
  leaseScopes = new Map();
// ---------- 几处页面同开：谁在作答 ----------
// 两个浏览器、VS Code 与浏览器同开同一个存储时，各页只知道自己在跑什么：那边正作答的一段，这边刷新后读到的是磁盘上「生成中」的快照，
// 从前会当成页面刷新而中断、写回磁盘，两边轮流互盖，这边再点「继续生成」就成了两处同写一条回复。
// 现在每隔几秒向桥接报到一次：报的是这边正作答的（以及作答完、最后一次存盘还没落地的）对话，回来的是别处正作答的。
// 别处正作答的那几段，这边只看不动：不当成中断、不存盘、不让发问与改动，报到成功后另行跟读磁盘进度，不占下一次心跳；
// 别处松了手（写完，或页面关了、崩了，十五秒没来报到），再读一回：还停在「生成中」的，才按中断处理
// 别处松手后，终稿未读回的仍算 remoteBusy。凭每次松手的标记认这次读回，免得旧读回盖过新的领还。
const leaseReleased = new Map();
let leasePosting = null,
  leaseFollowing = null;
function noteRemoteLeases(busy) {
  for (const id of busy) {
    remoteBusy.add(id);
    leaseReleased.delete(id);
  }
  if (currentId && remoteBusy.has(currentId)) renderSendButtons();
}
function resetChatLeases() {
  remoteBusy.clear();
  leaseHold.clear();
  leaseClaims.clear();
  leaseScopes.clear();
  leaseReleased.clear();
  leasePosting = leaseFollowing = null;
}
function syncLeases() {
  if (!chatsOnline()) return Promise.resolve();
  // 认领本身会报上全部持有的对话；它回话前还没有生成任务，不能以「没在跑」把这段报没了。
  if (leaseClaims.size) return Promise.all([...leaseClaims.values()]);
  if (leasePosting) return leasePosting;
  // 正作答的都算上（旁注的作业按它所在的对话记），后台还有帮手在做的也算；作答完了、最后一次存盘也落了地的松手
  const running = new Set([...[...requestJobs].map(([key, job]) => job.conversationId || key), ...crews.keys(), ...rewinding].filter(Boolean));
  for (const id of running) leaseHold.add(id);
  for (const id of [...leaseHold])
    if (!running.has(id) && !chatWritePromises.has(id) && !pendingChatWrites.has(id)) {
      leaseHold.delete(id);
      leaseScopes.delete(id);
    }
  const scope = bootstrap.store;
  leasePosting = bridge(
    "/api/chats/lease",
    { storeRoot: scope?.root, owner: PAGE_ID, ids: [...leaseHold], scopes: Object.fromEntries(leaseScopes) },
    AbortSignal.timeout(5000)
  )
    .then(({ busy } = {}) => {
      if (bootstrap.store !== scope || !Array.isArray(busy)) return false;
      const held = new Set(busy),
        known = new Set(store.conversations.map(c => c.id));
      for (const id of remoteBusy)
        if (!held.has(id)) {
          if (!known.has(id)) {
            remoteBusy.delete(id);
            leaseReleased.delete(id);
          } else if (!leaseReleased.has(id)) leaseReleased.set(id, {});
        }
      noteRemoteLeases(busy);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (bootstrap.store === scope) leasePosting = null;
    });
  return leasePosting.then(posted => {
    if (bootstrap.store !== scope) return;
    if (!posted || leaseFollowing) return leaseFollowing;
    // 跟读可以比租约还慢；不占住下一次报到。期间松手的对话，留给下一次成功的报到续读。
    const follow = [...remoteBusy].filter(id => store.conversations.some(c => c.id === id)),
      released = new Map([...leaseReleased].filter(([id]) => follow.includes(id)));
    if (!follow.length) return;
    leaseFollowing = followConversations(follow, [...released.keys()], id => {
      if (leaseReleased.get(id) !== released.get(id)) return false;
      leaseReleased.delete(id);
      remoteBusy.delete(id);
      if (id === currentId) renderSendButtons();
      return true;
    })
      .catch(() => {})
      .finally(() => {
        if (bootstrap.store === scope) leaseFollowing = null;
      });
    return leaseFollowing;
  });
}
// 开工前认领：报到每隔几秒才一次，两页几乎同时点发送时都以为没人在写。认领就是一次带上这段的报到，
// 桥接一次只办一件，先到的那页记上了，后到的一页看见它已有主就让开。无共享目录时照旧放行；共享目录已接通但认领失败不放行
function claimConversation(id, root = "", rewind = false) {
  if (leaseReleased.has(id)) return Promise.resolve(false);
  if (!chatsOnline()) return Promise.resolve(true);
  if (leaseClaims.has(id)) return leaseClaims.get(id);
  // 旧报到先落定，再认领；不同对话的认领也依次送出，避免迟到的旧清单撤回后来的持有项。
  // 只等租约回话，不等随后读回别处的对话；若要认领的是刚松手的那一段，仍须等终稿。
  const scope = bootstrap.store,
    before = [...leaseClaims.values(), leasePosting];
  const claiming = (async () => {
    await Promise.all(before);
    if (bootstrap.store !== scope || leaseReleased.has(id)) return false;
    const held = leaseHold.has(id),
      previousScope = leaseScopes.get(id);
    leaseHold.add(id);
    leaseScopes.set(id, { root, rewind });
    const abandon = () => {
      if (!held) leaseHold.delete(id);
      if (previousScope) leaseScopes.set(id, previousScope);
      else leaseScopes.delete(id);
    };
    try {
      const { busy, blocked } = await bridge(
        "/api/chats/lease",
        { storeRoot: scope?.root, owner: PAGE_ID, ids: [...leaseHold], claim: id, scopes: Object.fromEntries(leaseScopes) },
        AbortSignal.timeout(3000)
      );
      if (bootstrap.store !== scope) return false;
      // 认领别段时也会收到远端持有的正项：作废那些段尚在途的松手跟读。不从这里推断谁已松手。
      if (!Array.isArray(busy)) {
        abandon();
        return false;
      }
      noteRemoteLeases(busy);
      if (!blocked && !busy.includes(id)) return true;
      abandon();
      return false;
    } catch {
      // 已连接的共享目录中，超时不是「没有别页」。不能凭未收到认领回执放行。
      if (bootstrap.store === scope) abandon();
      return false;
    }
  })().finally(() => {
    if (bootstrap.store === scope) leaseClaims.delete(id);
  });
  leaseClaims.set(id, claiming);
  return claiming;
}
// 页面要关或刷新：先松手。不然刷新后的自己会把刷新前的自己当成「别处在作答」，停在半途的那一答就不收束了
function releaseLeases() {
  if (!leaseHold.size) return;
  leaseHold.clear();
  leaseScopes.clear();
  fetch(`/api/chats/lease`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ storeRoot: bootstrap.store?.root, owner: PAGE_ID, ids: [] }),
    keepalive: true
  }).catch(() => {});
}
/** 别处正作答（或刚松手）的几段：磁盘上的更新就换进来；刚松手的若仍停在「生成中」，那边是没写完就走了，按中断收束 */
async function followConversations(ids, released, finishRelease = _id => true) {
  const root = chatsDir(),
    scope = bootstrap.store,
    // 领终稿不带已知版本；到点补读的对话没有别页持有，也不带已知版本。只有在途跟读可按版本略过正文。
    query = released.length
      ? { root, storeRoot: scope?.root, ids }
      : chatLoadQuery(
          root,
          ids,
          ids.filter(id => remoteBusy.has(id))
        ),
    data = await bridge("/api/chats/load", query, AbortSignal.timeout(20000));
  if (bootstrap.store !== scope || chatsDir() !== root || !Array.isArray(data?.items)) return;
  let accepted = false,
    current = false;
  for (const item of data.items) {
    if (
      !store.conversations.some(c => c.id === item.id) ||
      item.savedAt <= (chatDiskStamps.get(item.id) || 0) ||
      conversationRunning(item.id)
    )
      continue;
    catchUpConversation(item, { quiet: true });
    accepted = true;
    if (item.id === currentId) current = true;
  }
  for (const id of released) {
    const c = store.conversations.find(item => item.id === id);
    if (data.skipped && !(data.items || []).some(item => item.id === id)) continue;
    if (!finishRelease(id)) continue;
    if (c && !remoteBusy.has(id) && !conversationRunning(id) && recoverConversation(c)) {
      markDirty(id);
      saveStoreSoon();
      if (id === currentId) current = true;
    }
  }
  renderHistory();
  // 在途跟读没有接纳新版时，不随心跳重画漏壶；有松手待处理仍照常刷新。
  if (accepted || released.length) renderClepsydra();
  if (current && view === "chat") renderConversation(false);
  // 别处松了手（写完、关页、崩了）：刚接手过来的这些对话里还记着「在等」的后台指令由这边重新等上，
  // 结束时会叫醒、寄回报。只在开页时挂一次的话，多页接手后长任务做完就没人叫醒了（见 rewatchBackground）
  rewatchBackground();
}
/** 这边跟着看、别处正作答：只看不动 */
function runningElsewhere(id = currentId) {
  return !!id && remoteBusy.has(id) && !conversationRunning(id);
}
