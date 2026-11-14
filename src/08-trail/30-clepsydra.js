// 言 · 书眉的漏：哪段对话挂着候（后台指令还在跑、约好的时刻还没到，到了要叫醒它），右上角就有一只漏壶；一条都没有就不画（见 设计稿/73–75）。
// 形是古漏：上壶滴水进受水壶，壶里一支箭随水浮起——箭的高低说挂得最久的那条已跑多久。两条起右下写条数。
// 点开分「进行中 / 约定」两节列出各条：那句白话（没写的才是编号），后台指令写已跑多久、等时刻的写几时到（设计稿/132 丙）；
// 悬停浮出编号与整条指令（或定的时刻）；点一行去到那段对话、回到起它的那一步。
// 数据取自各段存着的步骤（step.bg.state 为 running、step.timer.state 为 waiting），别处页面挂的也在。
// 落选的：工作条添一格（只是一行状态字）、流末一道虚线（翻远了看不见）、一炷香（设计稿/73）；直壶正滴读作高脚杯、侧嘴壶、一滴落水（设计稿/74）
let clepsydraOpen = false,
  clepsydraTimer = 0;
/** 还在等的候：跑着的后台指令（帮手开的也算）与没到点的时刻，各带所在对话与挂上的时刻；没记时刻的旧步骤按那一答开头算 */
function runningBackground() {
  const list = [];
  for (const conversation of store.conversations)
    for (const message of conversation.messages)
      for (const step of allSteps(message)) {
        const since = new Date(message.timestamp).getTime() || Date.now();
        if (step.bg?.state === "running") list.push({ conversation, step, started: Number(step.bg.started) || since });
        else if (step.timer?.state === "waiting") list.push({ conversation, step, started: Number(step.timer.created) || since });
      }
  return list;
}
// 箭的高低：已跑的分钟取对数，四小时齐顶（至多出壶口一截）
const clepsydraAge = ms => Math.min(1, Math.log1p(Math.max(0, ms) / 60000) / Math.log1p(240));
/** @param {number} age 0–1 */
function clepsydraInk(age) {
  const top = 11 - age * 7,
    drop = (x, y, r) =>
      `<path class="gold" d="M${x} ${y}Q${x + r} ${y + r * 1.6} ${x + r} ${y + r * 2.15}A${r} ${r} 0 0 1 ${x - r} ${y + r * 2.15}Q${x - r} ${y + r * 1.6} ${x} ${y}Z"/>`;
  // 上壶：沿、两壁、底、嘴
  const pot =
      brushStroke([1.6, 2.2, 4.8, 1.8, 8, 2.2], 1.4, { tail: 0.6 }) +
      brushStroke([2.1, 2.5, 2, 5.6, 2.3, 8.2], 1.1, { head: 1, tail: 0.8 }) +
      brushStroke([7.5, 2.5, 7.6, 5.6, 7.3, 8.2], 1.1, { head: 1, tail: 0.8 }) +
      brushStroke([2.2, 8.1, 4.8, 8.8, 7.4, 8.1], 1.1, { tail: 0.6 }) +
      brushStroke([7.3, 6.8, 9, 6.8, 9.6, 8.2], 0.9, { tail: 0.4 }),
    // 受水壶
    basin =
      brushStroke([9, 12.2, 13.6, 11.7, 18.4, 12.2], 1.3, { tail: 0.6 }) +
      brushStroke([9.6, 12.5, 9.5, 16, 9.8, 19], 1.2, { head: 1, tail: 0.8 }) +
      brushStroke([17.8, 12.5, 18, 16, 17.7, 19], 1.2, { head: 1, tail: 0.8 }) +
      brushStroke([9.8, 18.9, 13.8, 19.6, 17.7, 18.9], 1.2, { tail: 0.6 }),
    // 浮箭：一竿、箭头、两道刻
    arrow =
      brushStroke([14.4, 18, 14.5, (18 + top) / 2, 14.4, top], 0.85, { head: 1, tail: 1, tone: "ink2" }) +
      brushStroke([13.2, top + 1.3, 14.4, top - 0.3, 15.6, top + 1.3], 0.85, { head: 1, tail: 0.5, tone: "ink2" }) +
      [3.2, 5].map(d => brushStroke([14.4, top + d, 15.1, top + d, 15.8, top + d], 0.6, { head: 1, tail: 0.6, tone: "ink2" })).join("");
  return `${pot}${basin}<g class="clepsydra-drop">${drop(9.7, 9.4, 0.85)}</g><g class="clepsydra-arrow">${arrow}</g>`;
}
// 一分钟才重画一回：取整到分，秒不写
const clepsydraSpan = ms => (ms < 60000 ? t("不到 1 分钟") : spanText(Math.floor(ms / 60000) * 60000));
/** 簿录：按种类分两节——进行中（后台指令，写已跑多久）、约定（定时，写几时到），各节里当前对话的排前（设计稿/132 丙）。
 * 对话名退到每行下一行的小字，当前这段朱字；只牵涉一段对话时不写 @param {ReturnType<typeof runningBackground>} list */
function clepsydraListHtml(list, now) {
  const several = new Set(list.map(item => item.conversation)).size > 1,
    here = item => Number(item.conversation.id === currentId),
    row = ({ conversation, step, started }) => {
      const timer = step.timer?.state === "waiting" ? step.timer : null,
        detail = timer ? `${timer.id} · ${clockText(timer.due)}` : [step.bg?.id, step.title].filter(Boolean).join(" · "),
        when = timer
          ? [dueLabel(timer.due), timer.every ? t`每 ${spanText(timer.every)}` : ""].filter(Boolean).join(" · ")
          : clepsydraSpan(now - started),
        from = several
          ? `<span class="clepsydra-from${conversation.id === currentId ? " here" : ""}">${escapeHtml(conversation.title || t("新对话"))}</span>`
          : "";
      return `<button class="clepsydra-row" type="button" data-conversation="${escapeHtml(conversation.id)}" data-step="${escapeHtml(step.id)}" title="${escapeHtml([step.gist, detail].filter(Boolean).join("\n"))}"><span class="clepsydra-id${step.gist ? " gist" : ""}">${escapeHtml(bgName(step))}</span><span class="clepsydra-age">${escapeHtml(when)}</span><span class="clepsydra-go" aria-hidden="true">›</span>${from}</button>`;
    },
    section = (label, items) =>
      items.length
        ? `<div class="clepsydra-sec">${label}</div>${[...items]
            .sort((a, b) => here(b) - here(a))
            .map(row)
            .join("")}`
        : "",
    running = list.filter(item => item.step.bg?.state === "running"),
    timed = list.filter(item => item.step.timer?.state === "waiting");
  return section(t`进行中 · ${running.length}`, running) + section(t`约定 · ${timed.length}`, timed);
}
function renderClepsydra() {
  const host = $("#clepsydra");
  if (!host) return;
  const list = runningBackground(),
    now = Date.now();
  host.classList.toggle("hidden", !list.length);
  if (!list.length) {
    clepsydraOpen = false;
    clearInterval(clepsydraTimer);
    clepsydraTimer = 0;
  } else if (!clepsydraTimer) clepsydraTimer = setInterval(renderClepsydra, 60000);
  const button = host.querySelector(".clepsydra-btn"),
    panel = host.querySelector(".clepsydra-list"),
    oldest = Math.min(...list.map(item => item.started), now);
  host.querySelector("svg").innerHTML = list.length ? clepsydraInk(clepsydraAge(now - oldest)) : "";
  host.querySelector(".clepsydra-n").textContent = list.length > 1 ? String(list.length) : "";
  host.classList.toggle("counted", list.length > 1);
  button.setAttribute("aria-label", t`候 ${list.length} 条`);
  button.setAttribute("aria-expanded", String(clepsydraOpen));
  panel.classList.toggle("hidden", !clepsydraOpen);
  if (clepsydraOpen) panel.innerHTML = clepsydraListHtml(list, now);
}
function setClepsydraOpen(open) {
  clepsydraOpen = open;
  renderClepsydra();
}
function bindClepsydraEvents() {
  const host = $("#clepsydra");
  host.querySelector(".clepsydra-btn").addEventListener("click", () => setClepsydraOpen(!clepsydraOpen));
  host.querySelector(".clepsydra-list").addEventListener("click", event => {
    const row = event.target.closest(".clepsydra-row");
    if (!row) return;
    setClepsydraOpen(false);
    const { conversation, step } = row.dataset;
    if (conversation !== currentId || view !== "chat") openConversation(conversation);
    requestAnimationFrame(() => revealStep(step || ""));
  });
  document.addEventListener("pointerdown", event => {
    if (clepsydraOpen && !host.contains(/** @type {Node} */ (event.target))) setClepsydraOpen(false);
  });
}
defineLayer({ name: "clepsydra", rank: 92, open: () => clepsydraOpen, close: () => setClepsydraOpen(false) });
