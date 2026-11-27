// 言 · 行迹 · 时间线：用了工具的答画成一条时间线——分组、题头与用时，帮手各轮的折叠
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function compactTrail() {
  return store.settings.compactTrail === true;
}
// 重画可见回复，沿用原有就地更新，不重建正文或覆盖手动开合状态。
function refreshTrailAppearance() {
  renderConversation();
  if (isShown("#sidePanel")) renderSidePanel();
  if (helperPanelOpen()) renderHelperPanel();
}
function toolStackLabel() {
  return t("行迹");
}
// 撮要不算一步：它是言替模型删繁就简，另记「撮要 n 回」
const isFold = step => step.name === "fold";
function toolStackMeta(all = []) {
  if (all.some(step => step.status === "pending")) return t(AWAITING);
  const steps = all.filter(step => !isFold(step)),
    folds = all.filter(step => isFold(step) && step.status === "done").length,
    running = all.some(step => step.status === "running"),
    failed = steps.filter(step => step.status === "error").length,
    skipped = steps.filter(step => step.status === "skipped").length,
    reused = steps.filter(step => step.cached).length;
  return running
    ? t`进行中${reused ? t` · ${reused} 复用` : ""}`
    : t`${steps.length} 步${reused ? t` · ${reused} 复用` : ""}${skipped ? t` · ${skipped} 跳过` : ""}${failed ? t` · ${failed} 失败` : ""}${folds ? t` · 撮要 ${folds} 回` : ""}`;
}
// 等待确认是阻塞式的提问，无论用户之前有没有收起，都把折叠区展开，别让生成静静停在看不见的地方
// 用了工具的答（行与言都是）画成一条时间线：模型边做边说的话与各步穿插排列，做的时候摊开看过程，做完整条收起，只留最后的总结在外——
// 过程话不再以正文的样子混在结论里。只有旁注那一栏地方窄，仍是折起的注脚
/** @param {Message} message */
function trailWork(message) {
  return !!message.steps?.length && !(currentConversation()?.threads || []).some(thread => thread.messages?.includes(message));
}
/** @param {Message} message */
function trailBase(message) {
  return trailWork(message) ? trailGroups(message).at(-1)?.at || 0 : 0;
}
// 收尾前递的话（coda，如收尾前对照结论图）放了行、其后没再动手：走向没变，之前那段话仍是答复。这一步不进行迹，照实际的先后画在答复之后、
// 它引出的那几句之前（见 07-paint.js 的正文）；还在写时照常进行迹
/** @param {Message|SubAgent} message @returns {Step|null} */
function trailCoda(message) {
  const last = message.steps?.at(-1);
  return last && message.status !== "streaming" && TOOLS.get(last.name)?.coda ? last : null;
}
/** @param {Message|SubAgent} message 主消息或帮手：两者都有 content / reasoning / steps */
function trailGroups(message) {
  const groups = [],
    coda = trailCoda(message);
  let prev = 0,
    rprev = 0;
  for (const step of message.steps || []) {
    if (step === coda) continue;
    const at = Number(step.at) || 0,
      rat = Number(step.rat) || 0,
      last = groups.at(-1);
    // 同一轮后来的步骤把这组思绪的边界往后推，下一组的起点也得跟着走，不然推过去的那段会在下一组再显示一次
    if (last && last.at === at) {
      last.steps.push(step);
      last.rat = Math.max(last.rat, rat);
    } else {
      groups.push({ at, from: prev, rat, rfrom: rprev, steps: [step] });
      prev = at;
    }
    rprev = Math.max(rprev, rat);
  }
  return groups;
}
/** @param {Message} message */
function trailReasoningBase(message) {
  return trailWork(message) ? Math.max(0, ...trailGroups(message).map(group => group.rat)) : 0;
}
function rollText(el, text) {
  const prev = el.dataset.rollText ?? el.textContent;
  if (prev === text) return;
  el.dataset.rollText = text;
  if (inkMotionOff() || prev.length !== text.length || ![...text].some((ch, i) => ch !== prev[i] && /\d/.test(ch) && /\d/.test(prev[i]))) {
    el.textContent = text;
    return;
  }
  el.innerHTML = [...text]
    .map((ch, i) => {
      const old = prev[i];
      if (ch === old || !/\d/.test(ch) || !/\d/.test(old)) return escapeHtml(ch);
      const up = Number(ch) > Number(old);
      return `<span class="roll-digit"><span class="roll-stack ${up ? "up" : "down"}"><span>${up ? old : ch}</span><span>${up ? ch : old}</span></span></span>`;
    })
    .join("");
  setTimeout(() => {
    if (el.dataset.rollText === text) el.textContent = text;
  }, 380);
}
// 帮手时间线里一轮的各步折成一行：一轮里几十次检索摊开要占几屏，帮手说的话与回报就被顶得看不见了。
// 与主行迹同一套开合：一趟只开一次、收一次——帮手做着时各轮都摊着，交了差（或断了）才一并收起；若每跑完一轮就收一回，
// 整条行迹一路开合、高度上下跳。用户亲手开合过的不动。标题行是各工具的计数，点开才看各步
/** @param {SubAgent} sub 帮手停了（中止、出错）的话，没跑完的步骤也不算还在跑 */
function subStepsRunning(sub, steps) {
  return sub.status === "streaming" && steps.some(step => step.status === "running" || step.status === "pending");
}
function subStepsLabel(steps) {
  const counts = new Map();
  for (const step of steps) {
    const label = toolLabel(step.name);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ${n}` : label)).join(" · ");
}
function subStepsMeta(sub, steps) {
  if (subStepsRunning(sub, steps)) return t("进行中");
  steps = steps.filter(step => !isFold(step));
  const failed = steps.filter(step => step.status === "error").length,
    skipped = steps.filter(step => step.status === "skipped").length;
  return t`${steps.length} 步${skipped ? t` · ${skipped} 跳过` : ""}${failed ? t` · ${failed} 失败` : ""}`;
}
// 折叠行的外壳：标题、计数与各步由 syncSubSteps 与 syncStepList 填
/** @param {SubAgent} sub */
function subStepsShell(sub, steps) {
  const running = subStepsRunning(sub, steps),
    open = sub.status === "streaming" && (!compactTrail() || steps.some(step => step.status === "pending"));
  return `<details class="tool-stack sub-steps"${open ? " open" : ""} data-state="${running ? "streaming" : "complete"}"><summary><span class="tool-stack-label"></span><span class="tool-stack-meta"></span></summary><div class="tool-stack-body"><div class="tool-steps"></div></div></details>`;
}
// 一轮的折叠行就地更新：标题与计数跟着这一轮的步骤走；开合跟着整趟（见上）
/** @param {SubAgent} sub */
function syncSubSteps(details, sub, steps) {
  if (!details) return;
  const running = subStepsRunning(sub, steps);
  details.dataset.state = running ? "streaming" : "complete";
  const label = details.querySelector(":scope > summary > .tool-stack-label");
  if (label.textContent !== subStepsLabel(steps)) label.textContent = subStepsLabel(steps);
  rollText(details.querySelector(":scope > summary > .tool-stack-meta"), subStepsMeta(sub, steps));
  if (compactTrail() && sub.status === "streaming" && steps.some(step => step.status === "pending")) return settleDetails(details, true);
  if (details.dataset.touched) return;
  if (compactTrail()) setProcessDetails(details, false);
  else if (sub.status === "streaming") settleDetails(details, true);
  else settleDetails(details, false, null, true);
}
// 用时：不足一秒不写
function spentText(ms) {
  return Math.round((Number(ms) || 0) / 1000) ? spanText(ms) : "";
}
/** @param {Message} message */
function trailLabel(message) {
  if (!trailWork(message)) return toolStackLabel();
  if (message.status === "streaming") {
    const live = message.startedAt ? spentText(Date.now() - message.startedAt) : "";
    return live ? t`行进中 · ${live}` : t("行进中");
  }
  const spent = spentText(message.durationMs);
  if (message.status === "complete") return spent ? t`行迹 · ${spent}` : t("行迹");
  // 停下、断了的也记着做了多久：续写时接着这个数走
  return `${message.status === "stopped" ? t("已搁笔") : t("已中断")}${spent ? ` · ${spent}` : ""}`;
}
// 作答途中每秒一跳：只换行迹题头那一行字，不重画整答
/** @param {Message} message */
function tickTrailClock(message) {
  const label = document.querySelector(`[data-message="${CSS.escape(message.id)}"] .tool-stack.is-work > summary > .tool-stack-label`);
  if (label) label.textContent = trailLabel(message);
}
/** @param {Message} message */
function trailMeta(message) {
  const coda = trailCoda(message),
    base = toolStackMeta(coda ? message.steps.filter(step => step !== coda) : message.steps);
  if (!trailWork(message)) return base;
  // 帮手不随这一答收尾：这一答写完了、它还在后台做，收起的行迹题头上也看得见
  const helpers = runningDelegates(message);
  if (helpers.length > 1)
    return t`${helpers.length} 名帮手 · ${helpers.reduce((sum, h) => sum + (h.sub?.steps.length || 0), 0)} 步 · 进行中`;
  if (helpers.length) return t`帮手「${String(helpers[0].title || "").slice(0, 20)}」· ${helpers[0].sub?.steps.length || 0} 步 · 进行中`;
  const changed = new Set(
    allSteps(message)
      .filter(step => step.change && step.status === "done")
      .map(step => step.change.path)
  ).size;
  return changed ? t`${base} · 改 ${changed} 个文件` : base;
}
