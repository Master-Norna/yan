// 言 · 行迹与时间线：步骤卡、思绪、出处
// 本文件是 support.js 的一段，由桥接（或 node build.js）按文件名顺序拼进同一个闭包；无需模块系统
const TOOL_LABELS = {
  search_web: "检索",
  fetch_page: "翻阅网页",
  read_document: "翻阅文档",
  run_command: "运行",
  write_file: "写入",
  edit_file: "修改",
  read_file: "读取",
  list_files: "列目录",
  search_files: "搜索",
  ask_user: "请示",
  delegate: "差遣",
  remember: "记入",
  forget: "忘却",
  recall: "翻记忆",
  search_conversations: "查旧谈",
  read_conversation: "翻旧谈",
  user_note: "补言"
};
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
    if (last && last.at === at) {
      last.steps.push(step);
      last.rat = Math.max(last.rat, rat);
    } else {
      groups.push({ at, from: prev, rat, rfrom: rprev, steps: [step] });
      prev = at;
      rprev = Math.max(rprev, rat);
    }
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
      return `${TOOL_LABELS[call.name] || call.name}${path ? ` ${path}` : ""}`;
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
/** @param {Message|SubAgent} message */
function trailGroupHtml(message, group) {
  return `<div class="trail-group" data-at="${group.at}">${trailReasoningHtml(message, group)}${trailNoteHtml(message, group)}<div class="tool-steps">${group.steps.map(stepHtml).join("")}</div></div>`;
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
/** @param {Step} step */
function stepHtml(step) {
  let title = step.title;
  if (!title) {
    try {
      const args = JSON.parse(step.arguments || "{}");
      title = args.query || args.url || args.name || "";
    } catch {
      title = "";
    }
  }
  const resultLink = result => {
    const url = safeWebUrl(result.url),
      label = escapeHtml(result.title || result.url);
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span>${label}</span>`;
  };
  const stepUrl = safeWebUrl(step.url);
  if (WORK_TOOLS.has(step.name)) return workStepHtml(step, title);
  if (step.name === "ask_user") return askStepHtml(step);
  if (step.name === "delegate") return delegateStepHtml(step);
  if (step.name === "user_note") return noteStepHtml(step);
  const body = step.results?.length
    ? `<ul class="tool-results">${step.results
        .slice(0, 8)
        .map(r => `<li>${resultLink(r)}${r.snippet ? `<span>${escapeHtml(r.snippet)}</span>` : ""}</li>`)
        .join("")}</ul>`
    : step.url
      ? `<div class="tool-note">${stepUrl ? `<a href="${escapeHtml(stepUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(stepUrl)}</a>` : escapeHtml(step.url)}</div>`
      : step.note
        ? `<div class="tool-note">${escapeHtml(step.note)}</div>`
        : "";
  const status = step.status || "done",
    state =
      status === "running"
        ? `<span class="tool-state spinning" aria-label="进行中"></span>`
        : status === "error"
          ? `<span class="tool-state failed" aria-label="失败">×</span>`
          : `<span class="tool-state done" aria-label="完成">✓</span>`;
  return `<div class="tool-step" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">${escapeHtml(TOOL_LABELS[step.name] || step.name)}</span><span class="tool-title">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "工具执行失败") : ""}">${status === "running" ? "查阅中" : status === "error" ? escapeHtml(step.result || "失败") : escapeHtml(step.result || "")}</span>${state}</div>${body}</div>`;
}
// 差遣卡片：帮手自己的一条小时间线——每轮的思绪、说的话、各步，与主行迹同一套画法；进行中时最新的思绪与话跟着流，
// 做完折成一行「帮手 · n 步」，只留回报在外。首次画整张；此后由 syncDelegateCard 就地更新
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
    .map(group => trailGroupHtml(sub, group))
    .join("");
  // 最后一轮：进行中时思绪跟着流（有话了就收起）、话按最新文本画；做完后这轮思绪收进折叠区，话即回报，留在外面
  const tail = `<div class="sub-tail">${delegateTailThoughtHtml(thought, live && !said ? "live" : "done")}${
    live && said
      ? `<div class="trail-note sub-said" data-text="${escapeHtml(said)}">${renderMarkdown(said)}</div>`
      : live && !thought && !steps.length
        ? `<div class="sub-idle">帮手正在凝神</div>`
        : ""
  }</div>`;
  const inner = groups || thought || said || live;
  return `<div class="sub-trail"${live ? ' data-live="true"' : ""}>${
    inner
      ? `<details class="sub-steps"${step.subOpen ? " open" : ""}><summary><span>帮手 · ${steps.length} 步</span></summary><div class="sub-timeline">${groups}${tail}</div></details>`
      : ""
  }${report ? `<div class="sub-report">${renderMarkdown(report)}</div>` : ""}</div>`;
}
/** @param {Step} step */
function delegateStepHtml(step) {
  const { sub, status, meta } = delegateSubState(step);
  return `<div class="tool-step tool-step-delegate${step.folded ? " folded" : ""}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label"><span class="seal sub-seal" aria-hidden="true">帮</span>差遣</span><span class="tool-title" title="${escapeHtml(sub?.task || step.title || "")}">${escapeHtml(step.title || "")}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "未完成") : ""}">${escapeHtml(meta)}</span>${stepStateHtml(status)}</div>${delegateTrailHtml(step)}</div>`;
}
// 差遣卡片就地更新。帮手每隔一会儿刷一次，若整张换新：已画出的步骤输出会重新起入场动画（列目录的结果闪一下又空一片）、
// 用户收起的思绪又被摊开。这里只动变了的部分：头部的状态、时间线里新出的分组与步骤、最后一轮的思绪与话、做完后的回报
/** @param {Step} step */
function syncDelegateCard(el, step, prev, seen) {
  const { sub, status, steps, live, thought, said, report, meta } = delegateSubState(step);
  el.dataset.status = status;
  el.classList.toggle("folded", !!step.folded);
  const head = el.querySelector(":scope > .tool-step-head");
  rollText(head.querySelector(".tool-meta"), meta);
  if (!prev || prev.status !== status) head.querySelector(".tool-state").outerHTML = stepStateHtml(status);
  // 标题在领命时才定下来，卡片却在那之前就画出来了
  const title = head.querySelector(".tool-title");
  if (title.textContent !== String(step.title || "")) {
    title.textContent = step.title || "";
    title.title = sub?.task || step.title || "";
  }
  if (!sub) return;
  let trail = el.querySelector(":scope > .sub-trail");
  if (!trail) {
    el.insertAdjacentHTML("beforeend", delegateTrailHtml(step));
    trail = el.querySelector(":scope > .sub-trail");
    trail?.querySelectorAll(".trail-note, .sub-report").forEach(node => renderEnhancements(node));
    return;
  }
  if (live) trail.dataset.live = "true";
  else delete trail.dataset.live;
  let details = trail.querySelector(":scope > .sub-steps");
  if (!details && (steps.length || thought || said || live)) {
    trail.insertAdjacentHTML(
      "afterbegin",
      `<details class="sub-steps"${step.subOpen ? " open" : ""}><summary><span>帮手 · ${steps.length} 步</span></summary><div class="sub-timeline"><div class="sub-tail"></div></div></details>`
    );
    details = trail.firstElementChild;
  }
  if (details) {
    rollText(details.querySelector("summary span"), `帮手 · ${steps.length} 步`);
    // 做完那一刻按步骤上记的开合收起来；用户自己开合过的不动
    if (prev && prev.status !== status && !live) settleDetails(details, false, () => (step.subOpen = false), true);
    const timeline = details.querySelector(".sub-timeline");
    let tail = timeline.querySelector(":scope > .sub-tail");
    if (!tail) {
      timeline.insertAdjacentHTML("beforeend", `<div class="sub-tail"></div>`);
      tail = timeline.lastElementChild;
    }
    for (const group of trailGroups(sub)) {
      let host = timeline.querySelector(`:scope > .trail-group[data-at="${group.at}"]`);
      if (!host) {
        tail.insertAdjacentHTML("beforebegin", trailGroupHtml(sub, group));
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
      for (const s of group.steps) syncStep(host.querySelector(":scope > .tool-steps"), s, seen);
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
  }
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
    if (step.name === "delegate") el.querySelectorAll(".trail-note, .sub-report").forEach(node => renderEnhancements(node));
  } else if (step.name === "delegate") syncDelegateCard(el, step, prev, seen);
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
    return `${current.status === "pending" ? "等待确认" : "正在"} ${TOOL_LABELS[current.name] || current.name} ${String(current.title || "").slice(0, 60)}`.trim();
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
          `<span class="helper-row" data-helper="${escapeHtml(h.id)}"><span class="seal helper-seal" aria-hidden="true">帮</span><span class="helper-title">差遣「${escapeHtml(h.title || "")}」</span><span class="helper-doing"></span><span class="helper-count"></span></span>`
      )
      .join("");
  }
  for (const h of helpers) {
    const row = bar.querySelector(`.helper-row[data-helper="${CSS.escape(h.id)}"]`);
    if (!row) continue;
    row.querySelector(".helper-doing").textContent = delegateDoing(h);
    rollText(row.querySelector(".helper-count"), `${h.sub?.steps.length || 0} 步`);
  }
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}
// 补言：作答途中用户寄来的话，落在行迹里它到达的那一刻；待寄时转着圈，递给模型后打勾。话不止一行、或带着附件时摊开在下面
/** @param {Step} step */
function noteStepHtml(step) {
  const status = step.status || "done",
    text = String(step.note || "").trim(),
    first = text.split("\n").find(Boolean)?.slice(0, 80) || "",
    files = (step.attachments || []).map(file => file.name);
  const meta = status === "running" ? "待寄" : status === "error" ? escapeHtml(step.result || "未送达") : escapeHtml(step.result || "已递");
  const body =
    text.length > first.length || files.length
      ? `<div class="tool-note">${escapeHtml(text)}${files.length ? `<div class="tool-note-files">${files.map(name => escapeHtml(name)).join("、")}</div>` : ""}</div>`
      : "";
  return `<div class="tool-step tool-step-note" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label"><span class="seal note-seal" aria-hidden="true">补</span>补言</span><span class="tool-title" title="${escapeHtml(text)}">${escapeHtml(first)}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
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
// 步骤输出的露出规矩：默认只露前 10 行（diff 两侧各 10 行），底下一行「展开全部」；报错的默认折起，点标题行才看；
// 步骤上记两位：expanded（折起 / 摊开，未记则按状态定）与 full（全部 / 前 10 行），重画不丢
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
    body = `<pre class="tool-output tool-cmd-preview">${escapeHtml(title)}</pre><div class="tool-approve"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="径行：此对话中后续指令不再询问">径行</button></div>`;
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
    folded = foldable && (step.expanded === undefined ? status === "error" : !step.expanded);
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? "展开输出" : "收起输出"}"` : ""}><span class="tool-label">${escapeHtml(TOOL_LABELS[step.name] || step.name)}</span><span class="tool-title${command ? " tool-cmd" : ""}" title="${escapeHtml(title)}">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "执行失败") : ""}">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
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
      bodyHost = stack.querySelector(".tool-stack-body");
    if (work)
      for (const group of trailGroups(assistant)) {
        if (bodyHost.querySelector(`.trail-group[data-at="${group.at}"]`)) continue;
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
  for (const step of message.steps || []) if (step.name === "fetch_page" && step.status === "done") add(step.url, step.title, true);
  for (const step of message.steps || [])
    if (step.name === "search_web" && step.status === "done") for (const result of step.results || []) add(result.url, result.title, false);
  // 记忆与旧谈：翻过的条目、查到并读过的对话，与网页并列列出，点开各归其处
  const talks = new Map(),
    memories = new Map();
  for (const step of message.steps || []) {
    if (step.status !== "done") continue;
    if (step.name === "search_conversations")
      for (const hit of step.results || [])
        if (hit.conversationId && !talks.has(hit.conversationId))
          talks.set(hit.conversationId, { id: hit.conversationId, title: hit.title, date: hit.date, read: false });
    if (step.name === "read_conversation" && step.conversationId)
      talks.set(step.conversationId, { id: step.conversationId, title: step.title, date: step.date, read: true });
    if (step.name === "recall") for (const hit of step.results || []) if (hit.memoryId) memories.set(hit.memoryId, hit.title);
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
