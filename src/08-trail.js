// 言 · 行迹与时间线：步骤卡、思绪、出处
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
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
// 用了工具的答（行与言都是）画成一条时间线：模型边做边说的话与各步穿插排列，做的时候摊开看过程，做完整条收起，只留最后的总结在外——
// 过程话不再以正文的样子混在结论里。只有旁注那一栏地方窄，仍是折起的注脚
/** @param {Message} message */
function trailWork(message) {
  return !!message.steps?.length && !(currentConversation()?.threads || []).some(thread => thread.messages?.includes(message));
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
// 折叠行的外壳：标题、计数与各步由 syncSubSteps 与 syncStepList 填
/** @param {SubAgent} sub */
function subStepsShell(sub, steps) {
  const running = subStepsRunning(sub, steps);
  return `<details class="tool-stack sub-steps"${running ? " open" : ""} data-state="${running ? "streaming" : "complete"}"><summary><span class="tool-stack-label"></span><span class="tool-stack-meta"></span></summary><div class="tool-stack-body"><div class="tool-steps"></div></div></details>`;
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
// 用时：不足一秒不写，一分以上带分
function spentText(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  return !seconds ? "" : seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分${seconds % 60 ? ` ${seconds % 60} 秒` : ""}`;
}
/** @param {Message} message */
function trailLabel(message) {
  if (!trailWork(message)) return toolStackLabel();
  if (message.status === "streaming") {
    const live = message.startedAt ? spentText(Date.now() - message.startedAt) : "";
    return live ? `工作中 · ${live}` : "工作中";
  }
  const spent = spentText(message.durationMs);
  if (message.status === "complete") return spent ? `工作了 ${spent}` : "工作记录";
  // 停下、断了的也记着做了多久：续写时接着这个数走
  return `${message.status === "stopped" ? "已搁笔" : "已中断"}${spent ? ` · ${spent}` : ""}`;
}
// 作答途中每秒一跳：只换行迹题头那一行字，不重画整答
/** @param {Message} message */
function tickTrailClock(message) {
  const label = document.querySelector(`[data-message="${CSS.escape(message.id)}"] .tool-stack.is-work > summary > .tool-stack-label`);
  if (label) label.textContent = trailLabel(message);
}
/** @param {Message} message */
function trailMeta(message) {
  const base = toolStackMeta(message.steps);
  if (!trailWork(message)) return base;
  // 帮手不随这一答收尾：这一答写完了、它还在后台做，收起的行迹题头上也看得见
  const helpers = runningDelegates(message);
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
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? "展开" : "收起"}"` : ""}><span class="tool-label">${escapeHtml(toolLabel(step.name))}</span><span class="tool-title">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || "工具执行失败") : ""}">${status === "running" ? "查阅中" : status === "error" ? escapeHtml(step.result || "失败") : escapeHtml(step.result || "")}</span>${stepStateHtml(status)}</div>${stepShotsHtml(step)}${body}</div>`;
}
// 工具交回的画面（游目截图之类）：折起时也露着——画面就是这一步的结果；点开进图片查看器
/** @param {Step} step */
function stepShotsHtml(step) {
  const shots = (step.attachments || []).filter(file => file.kind === "image" && file.id);
  return shots.length
    ? `<div class="tool-shots">${shots.map(file => `<span class="fi fi-thumb tool-shot" role="button" tabindex="0" data-open-image="${escapeHtml(file.id)}" title="查看 ${escapeHtml(file.name)}"><img data-thumb="${escapeHtml(file.id)}" alt=""></span>`).join("")}</div>`
    : "";
}
// 一次差遣此刻的样子：帮手（它自己的一条时间线画在右侧的差遣面板里，见 paintHelperTrail——差遣是并行的活，线性的行迹盛不下）、
// 在不在做、回报、签上那一句计数
/** @param {Step} step */
function delegateSubState(step) {
  const sub = step.sub,
    status = step.status || "done",
    steps = sub?.steps || [],
    live = status === "running";
  return {
    sub,
    status,
    steps,
    live,
    report: live ? "" : String(sub?.report || "").trim(),
    meta: [
      ...(live
        ? [
            steps.length ? `${steps.length} 步` : "领命中",
            (sub?.startedAt && spentText(Date.now() - sub.startedAt)) || (steps.length ? "进行中" : ""),
            sub?.waiting ? "等后台" : ""
          ]
        : [String(step.result || "")]),
      sub?.effort ? `思考${reasoningLabel(sub.effort)}` : ""
    ]
      .filter(Boolean)
      .join(" · ")
  };
}
// 步骤按 id 就地更新：没变的节点一律不动（转圈不重启、已展开的结果不跳）；新步骤淡入上移，结果首次出现或状态翻转时只让那一条轻浮。
// 主行迹与帮手的时间线都走这里；差遣卡片本身不整张换，交给 syncDelegateCard。animate 为假（整条刚画出来）时只记台账，不起动效
/** @param {Step} step */
function syncStep(list, step, seen, animate = true) {
  if (!list) return;
  const html = stepHtml(step),
    hasBody = /class="tool-(results|note|output|approve)"/.test(html),
    prev = seen.get(step.id);
  let el = list.querySelector(`:scope > [data-step-id="${CSS.escape(step.id)}"]`);
  const added = !el;
  if (added) {
    list.insertAdjacentHTML("beforeend", html);
    el = list.lastElementChild;
  } else if (!TOOLS.get(step.name)?.sync?.(el, step, prev) && prev?.html !== html) {
    el.insertAdjacentHTML("afterend", html);
    const next = el.nextElementSibling;
    el.remove();
    el = next;
  }
  if (el.querySelector("img[data-thumb]:not([src])")) void loadThumbnails(el);
  if (animate && added) el.classList.add("is-new");
  else if (animate && prev) {
    if (hasBody && !prev.hasBody) el.classList.add("body-new");
    if (prev.status !== step.status) el.classList.add("status-new");
  }
  seen.set(step.id, { html, hasBody, status: step.status });
}
// 这一答里还在做的帮手（差遣与续派的那几趟，可能同时有几名）
/** @param {Message} message */
function runningDelegates(message) {
  return (message?.steps || []).filter(step => step.sub && step.status === "running");
}
// 帮手正在做的一句话：最新一步，或最新说的话的第一行
/** @param {Step} step */
function delegateDoing(step) {
  const sub = step.sub,
    steps = sub?.steps || [],
    current = [...steps].reverse().find(s => s.status === "running" || s.status === "pending") || steps.at(-1);
  if (current && (current.status === "running" || current.status === "pending"))
    return `${current.status === "pending" ? "等待确认" : "正在"} ${toolLabel(current.name)} ${String(current.title || "").slice(0, 60)}`.trim();
  // 睡着等自己挂的后台指令
  if (sub?.waiting)
    return `等后台 ${helperWaits(sub)
      .map(s => s.bg?.id)
      .join("、")}`;
  const base = Math.max(0, ...steps.map(s => Number(s.at) || 0)),
    said = String(sub?.content || "")
      .slice(base)
      .trim()
      .split("\n")
      .find(Boolean);
  return said ? said.slice(0, 80) : sub?.reasoning ? "正在凝神" : "领命中";
}
// 工作条：附在输入框上方——左边正在写的这一答的改动合计（帮手改的也算进来，点开浮出清单），右边这段对话后台在做的帮手（点开差遣面板）。
// 帮手不随一答收尾，答写完了它还在做，条子就还挂着它。两样都没有就不挂；写完了改动落到回复之下（见 设计稿/12-改动条与行迹 二·乙）
let workFilesOpen = false;
function renderHelperBar() {
  const bar = $("#helperBar");
  if (!bar) return;
  const c = currentConversation(),
    message = c && view === "chat" ? [...c.messages].reverse().find(m => m.role === "assistant" && m.status === "streaming") : null,
    helpers = c && view === "chat" ? (crews.get(c.id) || []).map(box => box.step) : [],
    stats = message ? changeStats(message) : { files: [], added: 0, removed: 0 },
    // 等待确认有请示条，不在这里重说
    label = c && requestJob(c.id)?.label,
    notice = label && label !== "等待确认" ? label : "";
  if (!helpers.length && !stats.files.length && !notice) {
    workFilesOpen = false;
    bar.dataset.sig = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  const changes = stats.files.length
      ? `<button type="button" class="work-changes" aria-expanded="${workFilesOpen}" title="这一答改过的文件"><span class="seal change-seal" aria-hidden="true">改</span><span>改 ${stats.files.length} 件</span><span class="change-count">${changeCountHtml(stats)}</span></button>`
      : "",
    // 题目逐次取：条子常在步骤刚入册、runDelegate 还没把题目填上时就搭好了
    who =
      helpers.length > 1
        ? `${helpers.length} 名帮手 · 进行中`
        : helpers.length
          ? `帮手「${String(helpers[0].title || "").slice(0, 24)}」· ${delegateDoing(helpers[0])}`
          : "",
    helper = helpers.length
      ? `<button type="button" class="work-helpers" data-helper="${escapeHtml(helpers[0].id)}" title="打开差遣面板"><span class="seal helper-seal" aria-hidden="true">帮</span><span class="work-helpers-text">${escapeHtml(who)}</span><span class="work-helpers-go" aria-hidden="true">›</span></button>`
      : "",
    html = `${changes}${notice ? `<span class="work-notice" role="status">${escapeHtml(notice)}</span>` : ""}${helper}${stats.files.length ? changeFilesHtml(stats, workFilesOpen, " work-files") : ""}`;
  // 帮手每 350ms 刷一次，没变就不动，免得清单里的滚动位置被重画冲掉
  if (bar.dataset.sig !== html) {
    bar.dataset.sig = html;
    bar.innerHTML = html;
  }
  bar.classList.toggle("only-helpers", !changes);
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}

// ---------- 差遣面板：帮手的活开在一扇全屏的窗里 ----------
// 行迹里只留一枚签（带回报，做事时呼吸），要看帮手具体做了什么才点开——细看是另一种动作，值得整个屏幕：
// 那条时间线里有 diff、有命令输出、有嵌套步骤，挤在窄栏里必然难看。
// 瞥一眼不必开窗：签自己在呼吸，输入框上方还有帮手条。几名帮手用 ‹ n/m › 翻，翻不动了就点中间的计数出列表
let helperStepId = null; // 窗里正看着的那一趟差遣（或续派）
const helperSeen = new Map(); // 窗里步骤的就地更新台账（与行迹各记各的，互不干扰）
/** 当前对话里帮手的每一趟，按发生先后 */
function allDelegateSteps() {
  return helperRuns(currentConversation());
}
function helperStepById(id) {
  return allDelegateSteps().find(step => step.id === id) || null;
}
function helperPanelOpen() {
  const panel = $("#helperModal");
  return !!panel && !panel.classList.contains("hidden") && !panel.classList.contains("leaving");
}
// noteId：传话的签点开时，直接翻到递去的那句话（它所在那一轮的步骤摊开）
function openHelperPanel(stepId, noteId = "") {
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
  const note = noteId && $("#helperPanelBody").querySelector(`[data-step-id="${CSS.escape(noteId)}"]`);
  if (!note) return;
  const stack = note.closest("details.sub-steps");
  if (stack) {
    stack.dataset.touched = "1";
    setProcessDetails(stack, true);
  }
  helperFolded.delete(step.id);
  syncSubFold($("#helperPanelBody > .sub-trail"), step);
  requestAnimationFrame(() => note.scrollIntoView({ block: "center" }));
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
// 帮手行迹的收起：时间线上方一行题头（折角 · 行迹 · 几轮 · 几步，与主行迹题头同一枚折角，点它开合），收起的记在这里，翻到别的帮手再翻回来仍是收着的。
// 题头滚出面板顶上时，面板顶栏右侧浮出同一枚「收起行迹」，与主对话的书眉一个意思
const helperFolded = new Set();
/** @param {Step} step */
function syncSubFold(trail, step) {
  const { sub, steps, live } = delegateSubState(step);
  const head = trail?.querySelector(":scope > .sub-fold");
  if (!head || !sub) return;
  const folded = helperFolded.has(step.id),
    rounds = trailGroups(sub).length,
    meta = live ? `${steps.length} 步 · 进行中` : `${rounds} 轮 · ${steps.length} 步`;
  trail.classList.toggle("folded", folded);
  head.setAttribute("aria-expanded", String(!folded));
  rollText(head.querySelector(".sub-fold-meta"), meta);
  head.title = folded ? "展开帮手的行迹" : "收起帮手的行迹，只看回报";
  syncHelperFoldHead();
}
function toggleSubFold(fold) {
  if (!helperStepId) return;
  if (fold ?? !helperFolded.has(helperStepId)) helperFolded.add(helperStepId);
  else helperFolded.delete(helperStepId);
  const trail = $("#helperPanelBody > .sub-trail"),
    step = helperStepById(helperStepId);
  syncSubFold(trail, step);
  // 从顶栏收起时，停回题头处
  const head = trail?.querySelector(":scope > .sub-fold"),
    scroll = $("#helperScroll");
  if (head && head.getBoundingClientRect().top < scroll.getBoundingClientRect().top)
    scroll.scrollTo({
      top: scroll.scrollTop + head.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12,
      behavior: "smooth"
    });
}
function syncHelperFoldHead() {
  const button = $("#helperFoldHead"),
    trail = $("#helperPanelBody > .sub-trail"),
    head = trail?.querySelector(":scope > .sub-fold"),
    timeline = trail?.querySelector(":scope > .sub-timeline");
  if (!button) return;
  const top = $("#helperScroll").getBoundingClientRect().top,
    show =
      !!head &&
      !trail.classList.contains("folded") &&
      head.getBoundingClientRect().bottom < top &&
      timeline.getBoundingClientRect().bottom > top + 60;
  button.classList.toggle("shown", show);
}
/** @param {boolean} fresh 首次打开或换了一次差遣：从空白画起；否则就地更新 */
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
  // 帮手就是一条回复：与主答的行迹同一支笔（见 paintTimeline）。帮手每 350ms 刷一次，只动变了的部分——
  // 已画出的步骤输出不重起入场动画、用户收起的思绪不被摊开
  let trail = host.querySelector(":scope > .sub-trail");
  const blank = fresh || !trail;
  if (blank) {
    helperSeen.clear();
    host.innerHTML = `<div class="sub-trail"></div>`;
    trail = host.firstElementChild;
  }
  paintHelperTrail(trail, step, !blank);
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
const STEP_SHOW_LINES = 10,
  // 并排的红绿一行抵原先上下两行，先看的行数翻倍
  DIFF_SHOW_ROWS = 20;
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
    const diff = splitDiffHtml(step.diff.old, step.diff.new, { limit: step.full ? Infinity : DIFF_SHOW_ROWS, wrap: !!step.full });
    body = `<div class="tool-diff">${diff.html}</div>`;
    if (diff.clipped) more = `展开全部 · −${diff.removed} +${diff.added} 行`;
    else if (step.full && diff.rows > DIFF_SHOW_ROWS) more = `只看前 ${DIFF_SHOW_ROWS} 行`;
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
// 步骤有了变动（入册、跑完、请示、帮手有进展）：照这一答此刻的样子重画，工作条与差遣面板跟着更新
/** @param {Message} assistant */
function refreshSteps(assistant) {
  paintMessage(assistant);
  renderHelperBar();
  renderHelperPanel();
}
// 思绪块带状态：进行中一点呼吸的朱色，写完打一个勾；时间线消息只画最后一轮的思绪，前几轮的各在自己的分组里
// 思绪是否还在写：按「轮」看而不是按整答看——最后一次工具调用之后又来了新思绪、而这一轮的正文尚未起笔，就是在写。
// 言里整答的思绪合在一块里，请示之后模型接着想，块上的勾不能因为第一轮已经有正文就先打上
/** @param {Message} message */
function reasoningLive(message) {
  if (message.status !== "streaming") return false;
  // 补言不是一轮：它落下时模型可能正想到一半，块上的勾不能因它先打上
  const last = (message.steps || []).filter(step => step.name !== "user_note" && step.name !== "relay_note").at(-1),
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
    if (event.target.closest("[data-note-now]")) {
      event.preventDefault();
      event.stopPropagation();
      return sendSupplementNow();
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
    void loadThumbnails(el);
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
    // 改动清单里点一件：看它在这一答里的改动
    const file = event.target.closest("[data-change-path]");
    if (file) {
      const id = file.closest("[data-message]")?.dataset.message,
        message = allMessages(currentConversation()).find(m => m.id === id);
      return message && openChangeDiff(message, file.dataset.changePath, file);
    }
    const summary = event.target.closest(".change-summary");
    if (!summary) return;
    const files = summary.parentElement.querySelector(".change-files"),
      closed = files.classList.toggle("hidden");
    files.classList.toggle("opening", !closed);
    summary.setAttribute("aria-expanded", String(!closed));
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
  // 帮手行迹的收起：时间线上方的题头，与翻过题头后顶栏右侧浮出的那一枚
  $("#helperPanelBody").addEventListener("click", event => {
    if (event.target.closest(".sub-fold")) toggleSubFold();
  });
  $("#helperFoldHead").addEventListener("click", () => toggleSubFold(true));
  $("#helperScroll").addEventListener("scroll", syncHelperFoldHead, { passive: true });
  // 工作条：左边的改动点开浮出清单，右边的帮手点开差遣面板
  $("#helperBar").addEventListener("click", event => {
    if (event.target.closest(".work-changes")) {
      workFilesOpen = !workFilesOpen;
      renderHelperBar();
      if (workFilesOpen) $("#helperBar .work-files")?.classList.add("opening");
      return;
    }
    const file = event.target.closest("[data-change-path]"),
      message =
        file && [...(currentConversation()?.messages || [])].reverse().find(m => m.role === "assistant" && m.status === "streaming");
    if (message) return openChangeDiff(message, file.dataset.changePath, file);
    const id = event.target.closest(".work-helpers")?.dataset.helper;
    if (id) openHelperPanel(id);
  });
  // 行迹里的那枚签：点它（或敲回车 / 空格）同样开面板。传话、叫停的签开的是它说到的那名帮手；回报那道细线上点名字也开
  const openFromCard = card => openHelperPanel(card.dataset.ref || card.dataset.stepId || "", card.dataset.note || "");
  $("#messages").addEventListener("click", event => {
    const relay = event.target.closest("[data-relay-step]");
    if (relay) return openHelperPanel(relay.dataset.relayStep || "");
    // 后台指令结束的那一项：回到行迹里挂它的那一步（行迹折着就摊开）
    const reveal = event.target.closest("[data-relay-reveal]");
    if (reveal) {
      const card = document.querySelector(`#messages .tool-step[data-step-id="${CSS.escape(reveal.dataset.relayReveal || "")}"]`),
        stack = card?.closest(".tool-stack");
      if (stack && !stack.open) setProcessDetails(stack, true);
      if (card) scrollChatTo(card, "center");
      return;
    }
    const head = event.target.closest(".tool-step-delegate > .tool-step-head");
    if (head) openFromCard(head.parentElement);
  });
  $("#messages").addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const head = event.target.closest?.(".tool-step-delegate > .tool-step-head");
    if (!head) return;
    event.preventDefault();
    openFromCard(head.parentElement);
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
// 差遣那扇窗盖在正文上，Esc 先收它；窗里摊开的帮手清单又在窗上
defineLayer({
  name: "helper-list",
  rank: 105,
  open: () => helperPanelOpen() && isShown("#helperList"),
  close: () => $("#helperList").classList.add("hidden")
});
defineLayer({ name: "helper", rank: 100, open: helperPanelOpen, close: closeHelperPanel });
