// 言 · 行迹 · 步骤：一步的卡片与就地更新、输出的露出、思绪的状态、出处；行迹里的开合
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
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
    if (out.clipped) more = t`展开全部 · ${out.total} 行`;
    else if (step.full && out.total > STEP_SHOW_LINES) more = t`只看前 ${STEP_SHOW_LINES} 行`;
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
          ? `<div class="tool-note">${escapeHtml(stepText(step.note))}</div>`
          : "");
  const status = step.status || "done",
    foldable = !!body,
    folded = foldable && (step.expanded === undefined ? true : !step.expanded);
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? t("展开") : t("收起")}"` : ""}><span class="tool-label">${escapeHtml(step.label ? t(step.label) : toolLabel(step.name))}</span><span class="tool-title">${escapeHtml(title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(stepText(step.result) || t("工具执行失败")) : ""}">${status === "running" ? t("查阅中") : status === "error" ? escapeHtml(stepText(step.result) || t("失败")) : escapeHtml(stepText(step.result) || "")}</span>${stepStateHtml(status)}</div>${stepShotsHtml(step)}${body}</div>`;
}
// 工具交回的画面（游目截图之类）：折起时也露着——画面就是这一步的结果；点开进图片查看器
/** @param {Step} step */
function stepShotsHtml(step) {
  const shots = (step.attachments || []).filter(file => file.kind === "image" && file.id);
  return shots.length
    ? `<div class="tool-shots">${shots.map(file => `<span class="fi fi-thumb tool-shot" role="button" tabindex="0" data-open-image="${escapeHtml(file.id)}" title="${t`查看 ${escapeHtml(file.name)}`}"><img data-thumb="${escapeHtml(file.id)}" alt=""></span>`).join("")}</div>`
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
            // 还没动手：开了口就不再是「领命中」，只记用时
            steps.length ? t`${steps.length} 步` : sub?.content || sub?.reasoning ? "" : t("领命中"),
            (sub?.startedAt && spentText(Date.now() - sub.startedAt)) || (steps.length ? t("进行中") : ""),
            sub?.waiting ? t("等后台") : ""
          ]
        : status === "interrupted"
          ? [t("中辍"), stepText(step.result), steps.length ? t`${steps.length} 步` : ""]
          : [stepText(step.result)]),
      sub?.effort ? t`思考 ${reasoningLabel(sub.effort)}` : ""
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
    return `${current.status === "pending" ? t(AWAITING) : t("正在")} ${toolLabel(current.name)} ${String(current.gist || current.title || "").slice(0, 60)}`.trim();
  // 睡着等自己挂的后台指令
  if (sub?.waiting)
    return t`等后台 ${helperWaits(sub)
      .map(s => s.bg?.id)
      .join("、")}`;
  const base = Math.max(0, ...steps.map(s => Number(s.at) || 0)),
    said = String(sub?.content || "")
      .slice(base)
      .trim()
      .split("\n")
      .find(Boolean);
  return said ? said.slice(0, 80) : sub?.reasoning ? t("正在凝神") : t("领命中");
}
// interrupted 只有差遣：帮手断着，状态位换成续写那一笔（与消息上的「续写」同一笔，设计稿/97 甲），点了续上（见 resumeHelpers）
function stepStateHtml(status) {
  if (status === "interrupted")
    return `<button type="button" class="tool-state goon" data-helper-resume title="${t(`续上`)}" aria-label="${t(`续上`)}">${brushIcon("forward")}</button>`;
  return status === "running"
    ? `<span class="tool-state spinning" aria-label="${t(`进行中`)}"></span>`
    : status === "pending"
      ? `<span class="tool-state pending" aria-label="${t(AWAITING)}">?</span>`
      : status === "skipped"
        ? `<span class="tool-state skipped" aria-label="${t(`已跳过`)}">–</span>`
        : status === "error"
          ? `<span class="tool-state failed" aria-label="${t(`失败`)}">×</span>`
          : `<span class="tool-state done" aria-label="${t(`完成`)}">✓</span>`;
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
    command = step.name === "run_command",
    // 模型说了要做什么的：题头写那一句，指令原文退到展开后的头一段（悬停也看得到）
    gist = command && step.gist;
  const meta = status === "running" ? "" : status === "pending" ? t(AWAITING) : escapeHtml(stepText(step.result || step.note));
  let body = "",
    more = "";
  // 等待确认时把整条指令完整摊开，不能只靠单行省略号让用户猜着点头；已摆在请示条上的不再摊第二份
  if (status === "pending" && inApprovalBar(step)) body = "";
  else if (status === "pending" && step.gate) body = keepGateHtml(step, !gist);
  else if (status === "pending")
    body = `<pre class="tool-output tool-cmd-preview">${escapeHtml(title)}</pre>${sandboxWhyHtml(step)}<div class="tool-approve"><button type="button" data-approve="run">${t(`运行`)}</button><button type="button" data-approve="skip">${t(`跳过`)}</button><button type="button" data-approve="auto" title="${t(`径行：此对话中后续指令不再询问`)}">${t(`径行`)}</button></div>`;
  else if (step.diff) {
    const diff = splitDiffHtml(step.diff.old, step.diff.new, { limit: step.full ? Infinity : DIFF_SHOW_ROWS, wrap: !!step.full });
    body = `<div class="tool-diff">${diff.html}</div>`;
    if (diff.clipped) more = t`展开全部 · −${diff.removed} +${diff.added} 行`;
    else if (step.full && diff.rows > DIFF_SHOW_ROWS) more = t`只看前 ${DIFF_SHOW_ROWS} 行`;
  } else if (step.output) {
    const out = clampLines(step.output, step.full);
    body = `<pre class="tool-output">${escapeHtml(out.text)}</pre>`;
    if (out.clipped) more = t`展开全部 · ${out.total} 行`;
    else if (step.full && out.total > STEP_SHOW_LINES) more = t`只看前 ${STEP_SHOW_LINES} 行`;
  } else if (step.note && !command) body = `<div class="tool-note">${escapeHtml(stepText(step.note))}</div>`;
  if (gist && title && status !== "pending") body = `<pre class="tool-output tool-code">${escapeHtml(title)}</pre>${body}`;
  if (more) body += `<button type="button" class="tool-more" data-step-more>${more}</button>`;
  const foldable = !!body && status !== "pending",
    openByDefault = status !== "error" && (!!step.diff || step.name === "list_files"),
    folded = foldable && (step.expanded === undefined ? !openByDefault : !step.expanded);
  return `<div class="tool-step${folded ? " folded" : ""}${foldable ? " foldable" : ""}${step.readOnly ? " is-read-only" : ""}" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"${foldable ? ` title="${folded ? t("展开输出") : t("收起输出")}"` : ""}><span class="tool-label">${escapeHtml(toolLabel(step.name))}</span><span class="tool-title${command && !gist ? " tool-cmd" : ""}" title="${escapeHtml(title)}">${escapeHtml(gist || title)}</span><span class="tool-meta" title="${status === "error" ? escapeHtml(step.result || t("执行失败")) : ""}">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
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
      ? `<button type="button" class="source-card source-local" data-open-memory="${escapeHtml(source.memoryId)}" title="${t(`查看这条记忆`)}"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.text)}</strong><small>${t(`记忆`)}</small></span></button>`
      : source.id
        ? `<button type="button" class="source-card source-local" data-open-talk="${escapeHtml(source.id)}" title="${t(`打开这段对话`)}"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.title)}</strong><small>${t`旧谈${source.date ? ` · ${escapeHtml(formatDay(source.date))}` : ""}`}</small></span>${source.read ? `<span class="source-read">${t(`已读`)}</span>` : ""}</button>`
        : `<a class="source-card" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer"><span class="source-index">${index + 1}</span><span class="source-copy"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(safeHost(source.url))}</small></span>${source.read ? `<span class="source-read">${t(`已读`)}</span>` : ""}</a>`;
  const all = [...list, ...local];
  return `<details class="source-stack"><summary><span>${t(`出处`)}</span><small>${t`${all.length} 条`}</small></summary><div class="source-grid">${all.map(card).join("")}</div></details>`;
}
// 这段对话里编号为 id 的一步：主线、版本、旁注里的，连同帮手各自的步骤
function stepInView(id) {
  const c = currentConversation();
  return (
    (c &&
      everyMessage(c)
        .flatMap(m => allSteps(m))
        .find(s => s.id === id)) ||
    null
  );
}
// 行迹：步骤的开合与看全、思绪跟随滚动、改动摘要、思绪与行迹的开合——正文、旁注、差遣面板三处画的是同一种卡，点法也同一套
function bindTrailEvents() {
  const panes = ["#messages", "#sideMessages", "#helperPanelBody"].map(selector => $(selector));
  const onStepClick = event => {
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
    // 断着的帮手：签上状态位、面板末尾的那一笔续写
    const goon = event.target.closest("[data-helper-resume]");
    if (goon) {
      event.preventDefault();
      event.stopPropagation();
      return resumeHelperStep(goon.dataset.helperResume || goon.closest(".tool-step")?.dataset.stepId || "");
    }
    const more = event.target.closest("[data-step-more]");
    if (more) return showStepInFull(more.closest(".tool-step"));
    // 出处也是一块可开合的，与思绪、行迹同一种开合
    const sources = event.target.closest(".source-stack > summary");
    if (sources) {
      event.preventDefault();
      const details = sources.parentElement;
      return setProcessDetails(details, details._motionAnimation ? !details._motionTarget : !details.open);
    }
    // 差遣的签不在此列：点它是去右侧开面板，不是折叠（见 openHelperPanel）
    const head = event.target.closest(".tool-step.foldable > .tool-step-head");
    if (!head || event.target.closest("a, button")) return;
    const el = head.parentElement,
      step = stepInView(el.dataset.stepId);
    // 指令输出默认折起，开合记在步骤上，重画不丢
    const wasFolded = el.classList.contains("folded");
    if (step) step.expanded = wasFolded;
    morphHeight(el, () => el.classList.toggle("folded", !wasFolded));
    head.title = wasFolded ? t("收起输出") : t("展开输出");
    saveStoreSoon();
  };
  const showStepInFull = el => {
    const step = stepInView(el?.dataset.stepId);
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
  };
  for (const pane of panes) {
    pane.addEventListener("click", onStepClick);
    pane.addEventListener(
      "scroll",
      event => {
        const body = event.target;
        if (body?.classList?.contains("reasoning-body")) body._follow = body.scrollTop + body.clientHeight >= body.scrollHeight - 24;
      },
      true
    );
  }
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
  for (const pane of panes) pane.addEventListener("click", onProcessToggle);
}
