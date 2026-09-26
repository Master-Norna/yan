// 言 · 行迹与时间线：步骤卡、思绪、出处
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
function toolStackLabel() {
  return "行迹";
}
function toolStackMeta(steps = []) {
  if (steps.some(step => step.status === "pending")) return "等待确认";
  const running = steps.some(step => step.status === "running"),
    failed = steps.filter(step => step.status === "error").length,
    skipped = steps.filter(step => step.status === "skipped").length,
    reused = steps.filter(step => step.cached).length;
  return running
    ? `进行中${reused ? ` · ${reused} 复用` : ""}`
    : `${steps.length} 步${reused ? ` · ${reused} 复用` : ""}${skipped ? ` · ${skipped} 跳过` : ""}${failed ? ` · ${failed} 失败` : ""}`;
}
// 等待确认是阻塞式的提问，无论用户之前有没有收起，都把折叠区展开，别让生成静静停在看不见的地方
// 执事对话里的行迹是一条时间线：模型边做边说的话与各步穿插排列，做的时候摊开看过程，做完自动收起，只留最后的总结在外；对谈里仍是折起的注脚
// 看的是消息自己记的执事标记；更早的数据没记这一位，退回按当前对话的模式判断
/** @param {Message} message */
function trailWork(message) {
  return !!message.steps?.length && (message.work ?? isWork(currentConversation()));
}
/** @param {Message} message */
function trailBase(message) {
  return trailWork(message) ? Math.max(0, ...message.steps.map(step => Number(step.at) || 0)) : 0;
}
/** @param {Message|SubAgent} message 主消息或帮手：两者都有 content / reasoning / steps */
function trailGroups(message) {
  const groups = [];
  let prev = 0,
    rprev = 0;
  for (const step of message.steps || []) {
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
  return trailWork(message) ? Math.max(0, ...message.steps.map(step => Number(step.rat) || 0)) : 0;
}
/** @param {Message|SubAgent} message */
function trailReasoningHtml(message, group) {
  const text = String(message.reasoning || "")
    .slice(group.rfrom, group.rat)
    .trim();
  return text
    ? `<details class="reasoning trail-reasoning" data-state="done"><summary>思绪</summary><div class="reasoning-body">${escapeHtml(text)}</div></details>`
    : "";
}
// 一组没有夹着正文、只是「想一阵 → 调工具 → 再想」时，后半段思绪仍属于同一组。
// 沿用组里原来的那枚签，重新切回 live；否则旧签一直打勾，下面又短暂冒出一枚新签，看起来像没有继续思考。
/** @param {Element} block @param {Message} message @param {string} visible */
function reusableTrailReasoning(block, message, visible) {
  if (!trailWork(message) || message.status !== "streaming") return null;
  const groups = trailGroups(message),
    active = block.querySelector('.tool-stack.is-work .trail-group > .reasoning[data-round-live="true"]');
  const group = active ? groups.find(item => active.parentElement?.dataset.at === String(item.at)) : groups.at(-1);
  if (!group) return null;
  const details =
    active ||
    [...block.querySelectorAll(".tool-stack.is-work .tool-stack-body > .trail-group")]
      .find(host => host.dataset.at === String(group.at))
      ?.querySelector(":scope > .reasoning");
  if (!details) return null;
  if (!active) {
    if (
      String(visible || "")
        .slice(group.at)
        .trim()
    )
      return null;
    if (
      !String(message.reasoning || "")
        .slice(group.rat)
        .trim()
    )
      return null;
    details.dataset.roundLive = "true";
    // 生成中切去别处再回来时，整页渲染会先把尾段思绪画在行迹之后；既然能归回上一组，就撤掉那份临时副本。
    block.querySelector(":scope > .reasoning")?.remove();
  }
  return {
    details,
    text: String(message.reasoning || "")
      .slice(group.rfrom)
      .trim()
  };
}
/** @param {Element} host @param {Message} message @param {ReturnType<typeof trailGroups>[number]} group */
function syncTrailGroupReasoning(host, message, group) {
  const text = String(message.reasoning || "")
      .slice(group.rfrom, group.rat)
      .trim(),
    details = host.querySelector(":scope > .reasoning");
  if (!text) return details?.remove();
  if (!details) return host.insertAdjacentHTML("afterbegin", trailReasoningHtml(message, group));
  const body = details.querySelector(".reasoning-body");
  if (body.textContent !== text) body.textContent = text;
  details.dataset.state = "done";
  delete details.dataset.roundLive;
  if (details.open && !details.dataset.touched) settleDetails(details, false);
}
/** @param {Message|SubAgent} message */
function trailNoteHtml(message, group) {
  const text = String(message.content || "")
    .slice(group.from, group.at)
    .trim();
  return text ? `<div class="trail-note">${renderMarkdown(text)}</div>` : "";
}
/** @param {Message} assistant */
function paintDrafting(host, assistant) {
  const drafting = (assistant.toolCalls || []).filter(call => call.name);
  let line = host.querySelector(":scope > .trail-drafting");
  if (!drafting.length) {
    line?.remove();
    return;
  }
  const label = drafting
    .map(call => {
      const path = call.arguments.match(/"(?:path|command|query|url|title)"\s*:\s*"((?:[^"\\]|\\.){1,80})/)?.[1];
      return `${toolLabel(call.name)}${path ? ` ${path}` : ""}`;
    })
    .join("、");
  const chars = drafting.reduce((sum, call) => sum + call.arguments.length, 0);
  if (!line) {
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="trail-drafting"><span class="tool-state spinning" aria-hidden="true"></span><span class="trail-drafting-text"></span></div>`
    );
    line = host.querySelector(":scope > .trail-drafting");
  }
  rollText(line.querySelector(".trail-drafting-text"), `正在拟 ${label}${chars > 200 ? ` · ${chars} 字` : ""}`);
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
/** @param {Message} message */
function trailLiveHost(block, message) {
  if (!trailWork(message) || message.status !== "streaming") return null;
  const body = block.querySelector(".tool-stack.is-work .tool-stack-body");
  if (!body) return null;
  let live = body.querySelector(":scope > .trail-group.trail-live");
  if (!live) {
    body.insertAdjacentHTML("beforeend", `<div class="trail-group trail-live"><div class="trail-note"></div></div>`);
    live = body.lastElementChild;
  }
  return live.querySelector(".trail-note");
}
/**
 * @param {Message|SubAgent} message
 * @param {boolean} [fold] 帮手时间线：这一轮的各步折进一个「n 步」里，只留思绪与说的话在外
 */
function trailGroupHtml(message, group, fold = false) {
  const steps = fold
    ? subStepsHtml(/** @type {SubAgent} */ (message), group)
    : `<div class="tool-steps">${group.steps.map(stepHtml).join("")}</div>`;
  return `<div class="trail-group" data-at="${group.at}">${trailReasoningHtml(message, group)}${trailNoteHtml(message, group)}${steps}</div>`;
}
// 帮手时间线里一轮的各步折成一行：一轮里几十次检索摊开要占几屏，帮手说的话与回报就被顶得看不见了。
// 与主行迹同一套开合：这一轮还在跑时摊开，跑完收起，用户亲手开合过的不动。标题行是各工具的计数，点开才看各步
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
  if (subStepsRunning(sub, steps)) return "进行中";
  const failed = steps.filter(step => step.status === "error").length,
    skipped = steps.filter(step => step.status === "skipped").length;
  return `${steps.length} 步${skipped ? ` · ${skipped} 跳过` : ""}${failed ? ` · ${failed} 失败` : ""}`;
}
/** @param {SubAgent} sub */
function subStepsHtml(sub, group) {
  const running = subStepsRunning(sub, group.steps);
  return `<details class="tool-stack sub-steps"${running ? " open" : ""} data-state="${running ? "streaming" : "complete"}"><summary><span class="tool-stack-label">${escapeHtml(subStepsLabel(group.steps))}</span><span class="tool-stack-meta">${escapeHtml(subStepsMeta(sub, group.steps))}</span></summary><div class="tool-stack-body"><div class="tool-steps">${group.steps.map(stepHtml).join("")}</div></div></details>`;
}
// 一轮的折叠行就地更新：标题与计数跟着步骤走；这一轮跑完就收起（用户亲手开合过的不动）
/** @param {SubAgent} sub */
function syncSubSteps(details, sub, steps) {
  if (!details) return;
  const running = subStepsRunning(sub, steps);
  details.dataset.state = running ? "streaming" : "complete";
  const label = details.querySelector(":scope > summary > .tool-stack-label");
  if (label.textContent !== subStepsLabel(steps)) label.textContent = subStepsLabel(steps);
  rollText(details.querySelector(":scope > summary > .tool-stack-meta"), subStepsMeta(sub, steps));
  if (details.dataset.touched) return;
  if (running) settleDetails(details, true);
  else settleDetails(details, false, null, true);
}
/** @param {Message} message */
function trailLabel(message) {
  if (!trailWork(message)) return toolStackLabel();
  if (message.status === "streaming") return "工作中";
  const ms = Number(message.durationMs) || 0,
    seconds = Math.round(ms / 1000);
  const spent = !seconds
    ? ""
    : seconds < 60
      ? `${seconds} 秒`
      : `${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ""}`;
  return message.status === "complete" ? (spent ? `工作了 ${spent}` : "工作记录") : message.status === "stopped" ? "已搁笔" : "已中断";
}
/** @param {Message} message */
function trailMeta(message) {
  const base = toolStackMeta(message.steps);
  if (!trailWork(message)) return base;
  const helpers = message.status === "streaming" ? runningDelegates(message) : [];
  if (helpers.length > 1)
    return `${helpers.length} 名帮手 · ${helpers.reduce((sum, h) => sum + (h.sub?.steps.length || 0), 0)} 步 · 进行中`;
  if (helpers.length) return `帮手「${String(helpers[0].title || "").slice(0, 20)}」· ${helpers[0].sub?.steps.length || 0} 步 · 进行中`;
  const changed = new Set(
    allSteps(message)
      .filter(step => step.change && step.status === "done")
      .map(step => step.change.path)
  ).size;
  return changed ? `${base} · 改 ${changed} 个文件` : base;
}
/** @param {Message} message */
function stepsHtml(message) {
  if (!message.steps?.length) return "";
  const work = trailWork(message),
    pending = message.steps.some(step => step.status === "pending"),
    running = message.status === "streaming" && message.steps.some(step => step.status === "running" || pending);
  const open =
    pending ||
    (message.toolsTouched ? !!message.toolsOpen : message.status === "streaming" && (work || running || message.steps.length > 0));
  const body = work
    ? trailGroups(message)
        .map(group => trailGroupHtml(message, group))
        .join("")
    : `<div class="tool-steps">${message.steps.map(stepHtml).join("")}</div>`;
  return `<details class="tool-stack${work ? " is-work" : ""}"${open ? " open" : ""} data-state="${escapeHtml(message.status || "complete")}"><summary><span class="tool-stack-label">${escapeHtml(trailLabel(message))}</span><span class="tool-stack-meta">${escapeHtml(trailMeta(message))}</span></summary><div class="tool-stack-body">${body}</div></details>`;
}
// 一步的卡片：工具自己登记了画法（指令、文件、请示、差遣、计划、补言）就照它画，其余（检索、翻阅、计算、调接口、翻记忆）用下面通用的一种
/** @param {Step} step */
function stepHtml(step) {
  const title = step.title || stepArgsTitle(step),
    own = TOOLS.get(step.name)?.html;
  return own ? own(step, title) : plainStepHtml(step, title);
}
// 标题还没定下来（步骤刚入册、工具还没跑）时，先从参数里取一个
/** @param {Step} step */
function stepArgsTitle(step) {
  const parsed = parseToolArguments(step.arguments);
  return parsed.ok ? String(parsed.args.query || parsed.args.url || parsed.args.name || "") : "";
}
// 代码（或请求）在上、输出在下，与指令输出同一套折叠与「展开全部」；没有输出的列命中、网址或一句备注。
// 默认折起：一答里几十次检索，命中全摊开要占一整屏；标题行有关键词与结果数，点开才看
/** @param {Step} step */
function plainStepHtml(step, title) {
  let more = "";
  const clamp = text => {
    const out = clampLines(text, step.full);
    if (out.clipped) more = `展开全部 · ${out.total} 行`;
    else if (step.full && out.total > STEP_SHOW_LINES) more = `只看前 ${STEP_SHOW_LINES} 行`;
    return escapeHtml(out.text);
  };
  const link = (url, label) => {
    const href = safeWebUrl(url);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`;
  };
  const outputBody =
    step.code || step.output
      ? `${step.code ? `<pre class="tool-output tool-code">${clamp(step.code)}</pre>` : ""}${step.output ? `<pre class="tool-output">${clamp(step.output)}</pre>` : ""}${more ? `<button type="button" class="tool-more" data-step-more>${more}</button>` : ""}`
      : "";
  const body =
    outputBody ||
    (step.results?.length
      ? `<ul class="tool-results">${step.results
          .slice(0, 8)
          .map(r => `<li>${link(r.url, escapeHtml(r.title || r.url))}${r.snippet ? `<span>${escapeHtml(r.snippet)}</span>` : ""}</li>`)
          .join("")}</ul>`
      : step.url
        ? `<div class="tool-note">${link(step.url, escapeHtml(safeWebUrl(step.url) || step.url))}</div>`
        : step.note
          ? `<div class="tool-note">${escapeHtml(step.note)}</div>`
          : "");
  const status = step.status || "done",
    foldable = !!body,
    folded = foldable && (step.expanded === undefined ? true : !step.expanded);
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? "展开" : "收起"}"` : ""}><span class="tool-label">${escapeHtml(toolLabel(step.name))}</span><span class="tool-title">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "工具执行失败") : ""}">${status === "running" ? "查阅中" : status === "error" ? escapeHtml(step.result || "失败") : escapeHtml(step.result || "")}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
// 帮手自己的一条小时间线——每轮的思绪、说的话、各步，与主行迹同一套画法；进行中时最新的思绪与话跟着流。
// 它画在右侧的差遣面板里（不在行迹里：差遣是并行的活，线性的时间线盛不下）；首次画整段，此后由 syncDelegateTrail 就地更新
/** @param {Step} step */
function delegateSubState(step) {
  const sub = step.sub,
    status = step.status || "done",
    steps = sub?.steps || [],
    live = status === "running";
  const base = Math.max(0, ...steps.map(s => Number(s.at) || 0)),
    rbase = Math.max(0, ...steps.map(s => Number(s.rat) || 0));
  return {
    sub,
    status,
    steps,
    live,
    thought: String(sub?.reasoning || "")
      .slice(rbase)
      .trim(),
    said: (live ? String(sub?.content || "").slice(base) : "").trim(),
    report: live ? "" : String(sub?.report || "").trim(),
    meta: live ? (steps.length ? `${steps.length} 步 · 进行中` : "领命中") : String(step.result || "")
  };
}
function delegateTailThoughtHtml(thought, state) {
  return thought
    ? `<details class="reasoning trail-reasoning" data-state="${state}"${state === "live" ? " open" : ""}><summary>思绪</summary><div class="reasoning-body">${escapeHtml(thought)}</div></details>`
    : "";
}
/** @param {Step} step */
function delegateTrailHtml(step) {
  const { sub, steps, live, thought, said, report } = delegateSubState(step);
  if (!sub) return "";
  const groups = trailGroups(sub)
    .map(group => trailGroupHtml(sub, group, true))
    .join("");
  // 最后一轮：进行中时思绪跟着流（有话了就收起）、话按最新文本画；做完后这轮思绪收进折叠区，话即回报，留在外面
  const tail = `<div class="sub-tail">${delegateTailThoughtHtml(thought, live && !said ? "live" : "done")}${
    live && said
      ? `<div class="trail-note sub-said" data-text="${escapeHtml(said)}">${renderMarkdown(said)}</div>`
      : live && !thought && !steps.length
        ? `<div class="sub-idle">帮手正在凝神</div>`
        : ""
  }</div>`;
  // 面板里整条时间线不再折起来：这一栏就是为了看过程而开的，开了还要再点一下才见内容没有道理；折的是各轮的步骤
  return `<div class="sub-trail"${live ? ' data-live="true"' : ""}><div class="sub-timeline">${groups}${tail}</div>${report ? `<div class="sub-report">${renderMarkdown(report)}</div>` : ""}</div>`;
}
// 帮手时间线就地更新（面板里那一条）。帮手每 350ms 刷一次，若整段换新：已画出的步骤输出会重新起入场动画
// （列目录的结果闪一下又空一片）、用户收起的思绪又被摊开。这里只动变了的部分：新出的分组与步骤、最后一轮的思绪与话、回报
/** @param {Step} step */
function syncDelegateTrail(trail, step, seen) {
  const { sub, steps, live, thought, said, report } = delegateSubState(step);
  if (!trail || !sub) return;
  if (live) trail.dataset.live = "true";
  else delete trail.dataset.live;
  let timeline = trail.querySelector(":scope > .sub-timeline");
  if (!timeline) {
    trail.insertAdjacentHTML("afterbegin", `<div class="sub-timeline"><div class="sub-tail"></div></div>`);
    timeline = trail.firstElementChild;
  }
  let tail = timeline.querySelector(":scope > .sub-tail");
  if (!tail) {
    timeline.insertAdjacentHTML("beforeend", `<div class="sub-tail"></div>`);
    tail = timeline.lastElementChild;
  }
  for (const group of trailGroups(sub)) {
    let host = timeline.querySelector(`:scope > .trail-group[data-at="${group.at}"]`);
    if (!host) {
      tail.insertAdjacentHTML("beforebegin", trailGroupHtml(sub, group, true));
      host = tail.previousElementSibling;
      const note = host.querySelector(".trail-note");
      if (note) renderEnhancements(note);
    } else {
      // 同一轮后来的步骤会把分组的思绪边界再往后推一点
      const body = host.querySelector(":scope > .reasoning .reasoning-body"),
        text = String(sub.reasoning || "")
          .slice(group.rfrom, group.rat)
          .trim();
      if (body && body.textContent !== text) body.textContent = text;
      else if (!body && text) host.insertAdjacentHTML("afterbegin", trailReasoningHtml(sub, group));
    }
    const fold = host.querySelector(":scope > .sub-steps");
    for (const s of group.steps) syncStep(fold.querySelector(".tool-steps"), s, seen);
    syncSubSteps(fold, sub, group.steps);
  }
  const state = live && !said ? "live" : "done";
  let thoughtEl = tail.querySelector(":scope > .reasoning");
  if (!thought) thoughtEl?.remove();
  else if (!thoughtEl) tail.insertAdjacentHTML("afterbegin", delegateTailThoughtHtml(thought, state));
  else {
    const body = thoughtEl.querySelector(".reasoning-body");
    if (body.textContent !== thought) {
      body.textContent = thought;
      if (thoughtEl.dataset.state === "live") body.scrollTop = body.scrollHeight;
    }
    if (thoughtEl.dataset.state !== state) {
      thoughtEl.dataset.state = state;
      if (state === "done" && thoughtEl.open && !thoughtEl.dataset.touched) settleDetails(thoughtEl, false);
    }
  }
  let saidEl = tail.querySelector(":scope > .sub-said");
  if (!(live && said)) saidEl?.remove();
  else {
    if (!saidEl) {
      tail.insertAdjacentHTML("beforeend", `<div class="trail-note sub-said"></div>`);
      saidEl = tail.lastElementChild;
    }
    if (saidEl.dataset.text !== said) {
      saidEl.dataset.text = said;
      saidEl.innerHTML = renderMarkdown(said);
      renderEnhancements(saidEl);
    }
  }
  const idle = live && !thought && !said && !steps.length,
    idleEl = tail.querySelector(":scope > .sub-idle");
  if (!idle) idleEl?.remove();
  else if (!idleEl) tail.insertAdjacentHTML("beforeend", `<div class="sub-idle">帮手正在凝神</div>`);
  const reportEl = trail.querySelector(":scope > .sub-report");
  if (!report) reportEl?.remove();
  else if (!reportEl) {
    trail.insertAdjacentHTML("beforeend", `<div class="sub-report">${renderMarkdown(report)}</div>`);
    renderEnhancements(trail.lastElementChild);
  }
}
// 步骤按 id 就地更新：没变的节点一律不动（转圈不重启、已展开的结果不跳）；新步骤淡入上移，结果首次出现或状态翻转时只让那一条轻浮。
// 主行迹与帮手的时间线都走这里；差遣卡片本身不整张换，交给 syncDelegateCard
/** @param {Step} step */
function syncStep(list, step, seen) {
  if (!list) return;
  const html = stepHtml(step),
    hasBody = /class="tool-(results|note|output|approve)"/.test(html),
    prev = seen.get(step.id);
  let el = list.querySelector(`:scope > [data-step-id="${CSS.escape(step.id)}"]`);
  if (!el) {
    list.insertAdjacentHTML("beforeend", html);
    el = list.lastElementChild;
  } else if (TOOLS.get(step.name)?.sync) TOOLS.get(step.name).sync(el, step, prev);
  else if (prev && prev.html !== html) {
    el.insertAdjacentHTML("afterend", html);
    const next = el.nextElementSibling;
    el.remove();
    el = next;
  }
  if (!prev) el.classList.add("is-new");
  else {
    if (hasBody && !prev.hasBody) el.classList.add("body-new");
    if (prev.status !== step.status) el.classList.add("status-new");
  }
  seen.set(step.id, { html, hasBody, status: step.status });
}
// 正在工作的帮手（当前对话里进行中的差遣步骤，可能同时有几名）
/** @param {Message} message */
function runningDelegates(message) {
  return (message?.steps || []).filter(step => step.name === "delegate" && step.status === "running");
}
/** @param {Message} message */
function runningDelegate(message) {
  return runningDelegates(message)[0] || null;
}
// 帮手正在做的一句话：最新一步，或最新说的话的第一行
/** @param {Step} step */
function delegateDoing(step) {
  const sub = step.sub,
    steps = sub?.steps || [],
    current = [...steps].reverse().find(s => s.status === "running" || s.status === "pending") || steps.at(-1);
  if (current && (current.status === "running" || current.status === "pending"))
    return `${current.status === "pending" ? "等待确认" : "正在"} ${toolLabel(current.name)} ${String(current.title || "").slice(0, 60)}`.trim();
  const base = Math.max(0, ...steps.map(s => Number(s.at) || 0)),
    said = String(sub?.content || "")
      .slice(base)
      .trim()
      .split("\n")
      .find(Boolean);
  return said ? said.slice(0, 80) : sub?.reasoning ? "正在凝神" : "领命中";
}
// 帮手条：帮手工作期间常驻输入框上方，不必翻回行迹里找那张卡片；点一下滚到卡片
function renderHelperBar() {
  const bar = $("#helperBar");
  if (!bar) return;
  const c = currentConversation(),
    message = c && view === "chat" ? [...c.messages].reverse().find(m => m.role === "assistant" && m.status === "streaming") : null,
    helpers = message ? runningDelegates(message) : [];
  if (!helpers.length) {
    bar.dataset.stepId = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  // 几名帮手同时在做时一人一行；条上记着第一名的步骤 id，点一下滚到它
  const key = helpers.map(h => h.id).join(",");
  if (bar.dataset.key !== key) {
    bar.dataset.key = key;
    bar.dataset.stepId = helpers[0].id;
    bar.innerHTML = helpers
      .map(
        h =>
          `<span class="helper-row" data-helper="${escapeHtml(h.id)}"><span class="seal helper-seal" aria-hidden="true">帮</span><span class="helper-title"></span><span class="helper-doing"></span><span class="helper-count"></span></span>`
      )
      .join("");
  }
  for (const h of helpers) {
    const row = bar.querySelector(`.helper-row[data-helper="${CSS.escape(h.id)}"]`);
    if (!row) continue;
    // 题目逐次写：条子常在步骤刚入册、runDelegate 还没把题目填上时就搭好了，只在搭时写一次会一直是空的「」
    const title = `差遣「${String(h.title || "").slice(0, 40)}」`;
    if (row.querySelector(".helper-title").textContent !== title) row.querySelector(".helper-title").textContent = title;
    row.querySelector(".helper-doing").textContent = delegateDoing(h);
    rollText(row.querySelector(".helper-count"), `${h.sub?.steps.length || 0} 步`);
  }
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}

// ---------- 差遣面板：帮手的活开在一扇全屏的窗里 ----------
// 行迹里只留一枚签（带回报，做事时呼吸），要看帮手具体做了什么才点开——细看是另一种动作，值得整个屏幕：
// 那条时间线里有 diff、有命令输出、有嵌套步骤，挤在窄栏里必然难看。
// 瞥一眼不必开窗：签自己在呼吸，输入框上方还有帮手条。几名帮手用 ‹ n/m › 翻，翻不动了就点中间的计数出列表
let helperStepId = null; // 窗里正看着的那次差遣
const helperSeen = new Map(); // 窗里步骤的就地更新台账（与行迹各记各的，互不干扰）
/** 当前对话里所有的差遣，按发生先后 */
function allDelegateSteps() {
  const out = [];
  for (const message of currentConversation()?.messages || [])
    for (const step of message.steps || []) if (step.name === "delegate") out.push(step);
  return out;
}
function helperStepById(id) {
  return allDelegateSteps().find(step => step.id === id) || null;
}
function helperPanelOpen() {
  const panel = $("#helperModal");
  return !!panel && !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
function openHelperPanel(stepId) {
  const step = helperStepById(stepId);
  if (!step) return;
  if (helperStepId !== step.id) helperSeen.clear();
  helperStepId = step.id;
  $("#helperList").classList.add("hidden");
  showNow($("#helperModal"));
  renderHelperPanel(true);
  // 换一名帮手是换一张纸，从头看起；不然上一张滚到多深，这张就从多深打开
  const stage = $("#helperScroll");
  if (stage) stage.scrollTop = 0;
}
function closeHelperPanel() {
  helperStepId = null;
  helperSeen.clear();
  const panel = $("#helperModal");
  if (panel && !panel.classList.contains("hidden")) hideWithFade(panel);
}
// ‹ › 翻到前一次 / 后一次差遣
function stepHelperPanel(delta) {
  const all = allDelegateSteps(),
    at = all.findIndex(step => step.id === helperStepId),
    next = all[at + delta];
  if (next) openHelperPanel(next.id);
}
// 计数点开的那张列表：帮手多了，一个个翻就难受
function renderHelperList() {
  const host = $("#helperList"),
    all = allDelegateSteps();
  if (!host) return;
  host.innerHTML = all
    .map((step, i) => {
      const { status, meta } = delegateSubState(step);
      return `<button type="button" class="helper-list-item${step.id === helperStepId ? " here" : ""}" data-helper-pick="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><span class="helper-list-no">${i + 1}</span><span class="helper-list-title">${escapeHtml(step.title || "领命中")}</span><span class="helper-list-meta">${escapeHtml(meta)}</span></button>`;
    })
    .join("");
}
/** @param {boolean} fresh 首次打开或换了一次差遣：整段重画；否则就地更新 */
function renderHelperPanel(fresh = false) {
  if (!helperPanelOpen()) return;
  const step = helperStepById(helperStepId);
  // 那次差遣不在眼前了（换了对话、切了分支）：窗合上，不留一扇空的
  if (!step) return closeHelperPanel();
  const { sub, status, meta } = delegateSubState(step),
    all = allDelegateSteps(),
    at = all.findIndex(s => s.id === helperStepId);
  $("#helperModal").dataset.status = status;
  const title = $("#helperTitle");
  if (title && title.textContent !== (step.title || "领命中")) title.textContent = step.title || "领命中";
  rollText($("#helperPanelSub"), meta);
  // ‹ n/m ›：只有一次差遣时不画
  const nav = $("#helperNav"),
    navKey = `${at + 1}/${all.length}`;
  if (nav && nav.dataset.key !== navKey) {
    nav.dataset.key = navKey;
    nav.innerHTML =
      all.length > 1
        ? `<button class="message-action" data-helper-step="-1" title="上一次差遣" aria-label="上一次差遣"${at <= 0 ? " disabled" : ""}>‹</button><button type="button" class="helper-nav-count" data-helper-list title="所有差遣">${navKey}</button><button class="message-action" data-helper-step="1" title="下一次差遣" aria-label="下一次差遣"${at >= all.length - 1 ? " disabled" : ""}>›</button>`
        : "";
  }
  if (!$("#helperList").classList.contains("hidden")) renderHelperList();
  // 所领之命：主模型交给帮手的原话，默认收着，点开看全
  const task = String(sub?.task || "");
  const brief = $("#helperTaskBrief");
  if (brief && brief.dataset.task !== task) {
    brief.dataset.task = task;
    brief.textContent = task.replace(/\s+/g, " ").slice(0, 60);
    $("#helperTaskText").textContent = task;
    $("#helperTask").classList.toggle("hidden", !task);
  }
  const host = $("#helperPanelBody");
  if (!host) return;
  let trail = host.querySelector(":scope > .sub-trail");
  if (fresh || !trail) {
    helperSeen.clear();
    host.innerHTML = delegateTrailHtml(step) || `<div class="sub-trail"><div class="sub-timeline"></div></div>`;
    trail = host.querySelector(":scope > .sub-trail");
    trail?.querySelectorAll(".trail-note, .sub-report").forEach(node => renderEnhancements(node));
    // 首次画完把台账补齐，免得下一轮把已画出的步骤当新的又闪一次
    if (sub)
      for (const group of trailGroups(sub))
        for (const s of group.steps) helperSeen.set(s.id, { html: stepHtml(s), hasBody: false, status: s.status });
    return;
  }
  syncDelegateTrail(trail, step, helperSeen);
}

function stepStateHtml(status) {
  return status === "running"
    ? `<span class="tool-state spinning" aria-label="进行中"></span>`
    : status === "pending"
      ? `<span class="tool-state pending" aria-label="等待确认">?</span>`
      : status === "skipped"
        ? `<span class="tool-state skipped" aria-label="已跳过">–</span>`
        : status === "error"
          ? `<span class="tool-state failed" aria-label="失败">×</span>`
          : `<span class="tool-state done" aria-label="完成">✓</span>`;
}
// 步骤输出的露出规矩：默认摊开的只有两种——目录清单（露前 10 行）与红绿对比（两侧各 10 行），底下一行「展开全部」；
// 指令输出、读取、搜索这些有明确的行数、往往又长，默认折起，标题行上有结果与行数，点标题行才看；报错的也折起。
// 步骤上记两位：expanded（折起 / 摊开，未记则按上面的定）与 full（全部 / 前 10 行），重画不丢
const STEP_SHOW_LINES = 10;
function clampLines(text, full) {
  const lines = String(text || "").split("\n"),
    clipped = !full && lines.length > STEP_SHOW_LINES;
  return { text: clipped ? lines.slice(0, STEP_SHOW_LINES).join("\n") : lines.join("\n"), total: lines.length, clipped };
}
/** @param {Step} step */
function workStepHtml(step, title) {
  const status = step.status || "done",
    command = step.name === "run_command";
  const meta = status === "running" ? "执行中" : status === "pending" ? "等待确认" : escapeHtml(step.result || step.note || "");
  let body = "",
    more = "";
  // 等待确认时把整条指令完整摊开，不能只靠单行省略号让用户猜着点头
  if (status === "pending")
    body = `<pre class="tool-output tool-cmd-preview">${escapeHtml(title)}</pre>${sandboxWhyHtml(step)}<div class="tool-approve"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="径行：此对话中后续指令不再询问">径行</button></div>`;
  else if (step.diff) {
    const del = clampLines(step.diff.old, step.full),
      ins = clampLines(step.diff.new, step.full);
    body = `<div class="tool-diff"><pre class="tool-output diff-del">${escapeHtml(del.text)}</pre><pre class="tool-output diff-ins">${escapeHtml(ins.text)}</pre></div>`;
    if (del.clipped || ins.clipped) more = `展开全部 · −${del.total} +${ins.total} 行`;
    else if (step.full && Math.max(del.total, ins.total) > STEP_SHOW_LINES) more = `只看前 ${STEP_SHOW_LINES} 行`;
  } else if (step.output) {
    const out = clampLines(step.output, step.full);
    body = `<pre class="tool-output">${escapeHtml(out.text)}</pre>`;
    if (out.clipped) more = `展开全部 · ${out.total} 行`;
    else if (step.full && out.total > STEP_SHOW_LINES) more = `只看前 ${STEP_SHOW_LINES} 行`;
  } else if (step.note && !command) body = `<div class="tool-note">${escapeHtml(step.note)}</div>`;
  if (more) body += `<button type="button" class="tool-more" data-step-more>${more}</button>`;
  const foldable = !!body && status !== "pending",
    openByDefault = status !== "error" && (!!step.diff || step.name === "list_files"),
    folded = foldable && (step.expanded === undefined ? !openByDefault : !step.expanded);
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}${step.readOnly ? " is-read-only" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? "展开输出" : "收起输出"}"` : ""}><span class="tool-label">${escapeHtml(toolLabel(step.name))}</span><span class="tool-title${command ? " tool-cmd" : ""}" title="${escapeHtml(title)}">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "执行失败") : ""}">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
/** @param {Message} assistant */
function refreshSteps(assistant) {
  const block = document.querySelector(`[data-message="${assistant.id}"] .assistant-block`);
  if (!block) return;
  block.querySelectorAll(".trail-drafting").forEach(node => node.remove());
  let stack = block.querySelector(".tool-stack");
  if (!stack) {
    const anchor = block.querySelector(".reasoning");
    if (anchor) anchor.insertAdjacentHTML("afterend", stepsHtml(assistant));
    else block.insertAdjacentHTML("afterbegin", stepsHtml(assistant));
    stack = block.querySelector(".tool-stack");
    stack?.classList.add("is-new");
  }
  if (stack) {
    stack.querySelector(".tool-stack-label").textContent = trailLabel(assistant);
    rollText(stack.querySelector(".tool-stack-meta"), trailMeta(assistant));
    stack.dataset.state = assistant.status || "complete";
    const work = trailWork(assistant),
      bodyHost = stack.querySelector(".tool-stack-body"),
      groups = work ? trailGroups(assistant) : [];
    if (work)
      for (const group of groups) {
        const existing = [...bodyHost.querySelectorAll(":scope > .trail-group")].find(
          host => !host.classList.contains("trail-live") && host.dataset.at === String(group.at)
        );
        if (existing) {
          syncTrailGroupReasoning(existing, assistant, group);
          continue;
        }
        // 正在承接这一轮话的「进行中」分组就地转正：话按最终文本重画一遍（流式可能还差几个字），再挂上步骤容器
        const live = bodyHost.querySelector(":scope > .trail-group.trail-live");
        if (live) {
          live.classList.remove("trail-live");
          live.dataset.at = String(group.at);
          live.innerHTML = `${trailReasoningHtml(assistant, group)}${trailNoteHtml(assistant, group)}<div class="tool-steps"></div>`;
        } else
          bodyHost.insertAdjacentHTML(
            "beforeend",
            `<div class="trail-group" data-at="${group.at}">${trailReasoningHtml(assistant, group)}${trailNoteHtml(assistant, group)}<div class="tool-steps"></div></div>`
          );
        const note = (live || bodyHost.lastElementChild).querySelector(".trail-note");
        if (note) renderEnhancements(note);
      }
    // 分组是按 at 定位的，而 at 会变：一答收尾时裁掉正文开头的空行，所有步骤的 at 都往前挪一截（见 streamReply 的 leadTrim）。
    // 键一变就当成新分组重画一份，旧的那份连同里面画好的步骤还留在页上——同一次差遣便出现两遍。落单的分组撤掉
    if (work) {
      const alive = new Set(groups.map(group => String(group.at)));
      for (const el of bodyHost.querySelectorAll(":scope > .trail-group"))
        if (!el.classList.contains("trail-live") && !alive.has(el.dataset.at)) el.remove();
    }
    if (work && assistant.status !== "streaming") bodyHost.querySelector(":scope > .trail-group.trail-live")?.remove();
    // 时间线消息里，行迹之前的顶层思绪是第一轮留下的旧块（那段思绪已收进第一个分组），撤掉；最后一轮的思绪收尾时画在行迹之后
    if (work) {
      const stale = block.querySelector(":scope > .reasoning");
      if (stale && stale.compareDocumentPosition(stack) & Node.DOCUMENT_POSITION_FOLLOWING) stale.remove();
    }
    // 这一轮说的话已收进分组，正文区从下一轮起笔：还画着旧起点的正文块撤掉，下一帧从新的起点重画
    if (work) {
      const main = block.querySelector(":scope > .markdown");
      if (main && Number(main.dataset.base ?? main.dataset.cut ?? 0) < trailBase(assistant)) {
        main.remove();
        block.querySelector(":scope > .thinking")?.remove();
      }
    }
    let seen = knownStepIds.get(assistant.id);
    if (!seen) {
      seen = new Map();
      knownStepIds.set(assistant.id, seen);
      if (knownStepIds.size > 32) {
        for (const key of knownStepIds.keys())
          if (key !== assistant.id) {
            knownStepIds.delete(key);
            break;
          }
      }
    }
    for (const step of assistant.steps || [])
      syncStep(
        work ? bodyHost.querySelector(`.trail-group[data-at="${Number(step.at) || 0}"] > .tool-steps`) : stack.querySelector(".tool-steps"),
        step,
        seen
      );
    // 没递出去就撤下的补言（收尾时另作新一问、或停了放回案上）：页上那一步也撤
    const ids = new Set((assistant.steps || []).map(step => step.id));
    for (const el of stack.querySelectorAll(".tool-step-note[data-step-id]")) if (!ids.has(el.dataset.stepId)) el.remove();
    renderHelperBar();
    renderHelperPanel();
    // 一答只开一次、收一次：第一步起就摊开，整答写完才收（言里模型说话的间隙也不收）；请示时必开
    const pending = assistant.steps.some(step => step.status === "pending");
    if (assistant.status === "streaming") {
      if (pending || !assistant.toolsTouched) settleDetails(stack, true);
    } else
      settleDetails(
        stack,
        false,
        () => {
          assistant.toolsOpen = false;
          assistant.toolsTouched = false;
        },
        true
      );
  }
  syncChangeBar(block, assistant);
  if (!assistant.content && assistant.status === "streaming" && !block.querySelector(".thinking"))
    insertAboveChangeBar(block, `<div class="thinking">正在凝神</div>`);
}
// 回复末尾挂着改动条时，新起笔的正文 / 凝神占位都插到它上面，改动条始终压底
function insertAboveChangeBar(block, html) {
  const bar = block.querySelector(":scope > .change-bar");
  if (bar) bar.insertAdjacentHTML("beforebegin", html);
  else block.insertAdjacentHTML("beforeend", html);
}
// 思绪块带状态：进行中一点呼吸的朱色，写完打一个勾；时间线消息只画最后一轮的思绪，前几轮的各在自己的分组里
// 思绪是否还在写：按「轮」看而不是按整答看——最后一次工具调用之后又来了新思绪、而这一轮的正文尚未起笔，就是在写。
// 言里整答的思绪合在一块里，请示之后模型接着想，块上的勾不能因为第一轮已经有正文就先打上
/** @param {Message} message */
function reasoningLive(message) {
  if (message.status !== "streaming") return false;
  // 补言不是一轮：它落下时模型可能正想到一半，块上的勾不能因它先打上
  const last = (message.steps || []).filter(step => step.name !== "user_note").at(-1),
    at = Number(last?.at) || 0,
    rat = Number(last?.rat) || 0;
  return (
    !!String(message.reasoning || "")
      .slice(rat)
      .trim() &&
    !String(message.content || "")
      .slice(at)
      .trim()
  );
}
/** @param {Message} message */
function reasoningHtml(message, text = null) {
  text = text ?? (trailWork(message) ? String(message.reasoning || "").slice(trailReasoningBase(message)) : message.reasoning);
  if (!text?.trim()) return "";
  const live = reasoningLive(message),
    open = message.reasoningTouched ? !!message.reasoningOpen : live;
  return `<details class="reasoning"${open ? " open" : ""} data-state="${live ? "live" : "done"}"><summary>思绪</summary><div class="reasoning-body">${escapeHtml(text)}</div></details>`;
}
/** @param {Message} message */
function sourceCardsHtml(message) {
  if (message.status === "streaming" || !(message.steps || []).some(step => step.status !== "running")) return "";
  const sources = new Map(),
    add = (url, title, read = false) => {
      const href = safeWebUrl(url);
      if (!href) return;
      const key = href.replace(/#.*$/, "");
      const old = sources.get(key);
      if (!old || read) sources.set(key, { url: key, title: title || old?.title || safeHost(key), read: read || !!old?.read });
    };
  // 出处由各工具登记的 sources 给出；网页里读过全文的排在只见于检索结果的前面
  const found = (message.steps || []).filter(step => step.status === "done").flatMap(step => TOOLS.get(step.name)?.sources?.(step) || []);
  for (const entry of found) if (entry.url && entry.read) add(entry.url, entry.title, true);
  for (const entry of found) if (entry.url && !entry.read) add(entry.url, entry.title, false);
  // 记忆与旧谈：翻过的条目、查到并读过的对话，与网页并列列出，点开各归其处
  const talks = new Map(),
    memories = new Map();
  for (const entry of found) {
    if (entry.talk && (entry.read || !talks.has(entry.talk)))
      talks.set(entry.talk, { id: entry.talk, title: entry.title, date: entry.date, read: !!entry.read });
    if (entry.memory) memories.set(entry.memory, entry.title);
  }
  const list = [...sources.values()],
    local = [...talks.values(), ...[...memories].map(([id, text]) => ({ memoryId: id, text }))];
  if (!list.length && !local.length) return "";
  const card = (source, index) =>
    source.memoryId
      ? `<button type="button" class="source-card source-local" data-open-memory="${escapeHtml(source.memoryId)}" title="查看这条记忆"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.text)}</strong><small>记忆</small></span></button>`
      : source.id
        ? `<button type="button" class="source-card source-local" data-open-talk="${escapeHtml(source.id)}" title="打开这段对话"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.title)}</strong><small>旧谈${source.date ? ` · ${escapeHtml(formatDay(source.date))}` : ""}</small></span>${source.read ? `<span class="source-read">已读</span>` : ""}</button>`
        : `<a class="source-card" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(safeHost(source.url))}</small></span>${source.read ? `<span class="source-read">已读</span>` : ""}</a>`;
  const all = [...list, ...local];
  return `<details class="source-stack"><summary><span>出处</span><small>${all.length} 条</small></summary><div class="source-grid">${all.map(card).join("")}</div></details>`;
}

// 行迹：步骤的开合与看全、思绪跟随滚动、改动摘要、思绪与行迹的开合（正文、旁注、差遣三处同一套）
function bindTrailEvents() {
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-approve]");
    if (button) {
      event.preventDefault();
      event.stopPropagation();
      return approveFrom(button);
    }
    // 差遣的签不在此列：点它是去右侧开面板，不是折叠（见下面的 openHelperPanel）
    const head = event.target.closest(".tool-step.foldable > .tool-step-head");
    if (!head || event.target.closest("a, button")) return;
    const el = head.parentElement,
      c = currentConversation(),
      step =
        c &&
        allMessages(c)
          .flatMap(m => allSteps(m))
          .find(s => s.id === el.dataset.stepId);
    // 指令输出默认折起，开合记在步骤上，重画不丢
    const wasFolded = el.classList.contains("folded");
    if (step) step.expanded = wasFolded;
    morphHeight(el, () => el.classList.toggle("folded", !wasFolded));
    head.title = wasFolded ? "收起输出" : "展开输出";
    saveStoreSoon();
  });
  $("#messages").addEventListener("click", event => {
    const button = event.target.closest("[data-step-more]");
    if (!button) return;
    const el = button.closest(".tool-step"),
      c = currentConversation(),
      step =
        c &&
        allMessages(c)
          .flatMap(m => allSteps(m))
          .find(s => s.id === el?.dataset.stepId);
    if (!step) return;
    step.full = !step.full;
    step.expanded = true;
    saveStoreSoon();
    // 节点留在原处只换内容，高度才好从旧高动到新高
    const fresh = document.createElement("div");
    fresh.innerHTML = stepHtml(step);
    const next = fresh.firstElementChild;
    morphHeight(el, () => {
      el.className = next.className;
      el.innerHTML = next.innerHTML;
    });
  });
  // 出处也是一块可开合的，与思绪、行迹同一种开合
  $("#messages").addEventListener("click", event => {
    const summary = event.target.closest(".source-stack > summary");
    if (!summary) return;
    event.preventDefault();
    const details = summary.parentElement;
    setProcessDetails(details, details._motionAnimation ? !details._motionTarget : !details.open);
  });
  $("#messages").addEventListener(
    "scroll",
    event => {
      const body = event.target;
      if (body?.classList?.contains("reasoning-body")) body._follow = body.scrollTop + body.clientHeight >= body.scrollHeight - 24;
    },
    true
  );
  $("#messages").addEventListener("click", event => {
    const summary = event.target.closest(".change-summary");
    if (!summary) return;
    const files = summary.parentElement.querySelector(".change-files"),
      open = files.classList.toggle("hidden");
    summary.setAttribute("aria-expanded", String(!open));
  });
  // 思绪与行迹的开合：正文、旁注面板与差遣面板同一套——用户亲手开合的记在消息上，流式期间的自动开合就不再替他动
  const onProcessToggle = event => {
    const summary = event.target.closest(".reasoning > summary, .tool-stack > summary");
    if (!summary) return;
    event.preventDefault();
    const details = summary.parentElement;
    const nextOpen = details._motionAnimation ? !details._motionTarget : !details.open;
    // 用户亲手动了，程序排着的那次自动收起作废
    clearTimeout(details._settleTimer);
    details._settleTimer = null;
    // 时间线里各轮的思绪与帮手各轮的步骤不记在消息上；用户开合过的记一笔，就地更新时不再替它开合
    if (details.classList.contains("trail-reasoning") || details.classList.contains("sub-steps")) {
      details.dataset.touched = "1";
      return setProcessDetails(details, nextOpen);
    }
    const id = details.closest("[data-message]")?.dataset.message,
      side = !!details.closest("#sideMessages");
    const message = (side ? currentThread()?.messages : currentConversation()?.messages)?.find(item => item.id === id);
    if (!message) return setProcessDetails(details, nextOpen);
    const reasoning = details.classList.contains("reasoning");
    message[reasoning ? "reasoningTouched" : "toolsTouched"] = true;
    message[reasoning ? "reasoningOpen" : "toolsOpen"] = nextOpen;
    saveStoreSoon();
    setProcessDetails(details, nextOpen);
  };
  $("#messages").addEventListener("click", onProcessToggle);
  $("#sideMessages").addEventListener("click", onProcessToggle);
  $("#helperPanelBody").addEventListener("click", onProcessToggle);
}

// 差遣面板：帮手条与行迹里的签打开它，遮罩与合起关上它，‹ › 与列表翻帮手
function bindHelperEvents() {
  // 帮手条点一下开差遣面板：帮手的活在右边看，行迹里只留一枚签
  $("#helperBar").addEventListener("click", event => {
    const id = event.target.closest(".helper-row")?.dataset.helper || $("#helperBar").dataset.stepId || "";
    if (id) openHelperPanel(id);
  });
  // 行迹里的那枚签：点它（或敲回车 / 空格）同样开面板
  $("#messages").addEventListener("click", event => {
    const head = event.target.closest(".tool-step-delegate > .tool-step-head");
    if (head) openHelperPanel(head.parentElement.dataset.stepId || "");
  });
  $("#messages").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const head = event.target.closest?.(".tool-step-delegate > .tool-step-head");
    if (!head) return;
    event.preventDefault();
    openHelperPanel(head.parentElement.dataset.stepId || "");
  });
  // 合起即回到行迹里那一步——原先「合」与「行迹」两个按钮做的本是同一件事
  $("#helperClose").onclick = () => {
    const id = helperStepId;
    closeHelperPanel();
    const card = document.querySelector(`#messages .tool-step-delegate[data-step-id="${CSS.escape(id || "")}"]`);
    if (!card) return;
    const stack = card.closest(".tool-stack");
    if (stack && !stack.open) setProcessDetails(stack, true);
    scrollChatTo(card, "center");
  };
  // 点遮罩、按 Esc 都关得掉，与设置、文件查看器一个脾气。纸张之外的空白由 .helper-stage 铺满，点在它上面也算点了遮罩；
  // 按下与松开都得落在空白处——在纸上选字、拖到纸外松手，click 会落到两者的共同祖先上，那不是要关窗
  const helperBackdrop = target => target === $("#helperModal") || target === $("#helperScroll");
  let helperPressedBackdrop = false;
  $("#helperModal").addEventListener("pointerdown", event => {
    helperPressedBackdrop = helperBackdrop(event.target);
  });
  $("#helperModal").addEventListener("click", event => {
    if (helperPressedBackdrop && helperBackdrop(event.target)) closeHelperPanel();
    helperPressedBackdrop = false;
  });
  // ‹ › 翻帮手；中间的计数点开是一张列表——帮手多了一个个翻就难受
  $("#helperNav").addEventListener("click", event => {
    const move = event.target.closest("[data-helper-step]")?.dataset.helperStep;
    if (move) return stepHelperPanel(Number(move));
    if (event.target.closest("[data-helper-list]")) {
      const list = $("#helperList");
      list.classList.toggle("hidden");
      if (!list.classList.contains("hidden")) renderHelperList();
    }
  });
  $("#helperList").addEventListener("click", event => {
    const id = event.target.closest("[data-helper-pick]")?.dataset.helperPick;
    if (id) openHelperPanel(id);
  });
}
