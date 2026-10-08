// 言 · 一条回复的画法：给它此刻的样子，就画出它该有的样子
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 整页重画、流式逐帧、步骤变动、收尾，还有差遣面板里帮手的时间线，都走这一支笔：同一个状态画出来一定是同一个样子，
// 不必事后去擦另一支笔多画的东西。一条回复拆成若干部件（思绪、行迹、正文、改动条……），各带键与签名：
// 签名没变的一律不碰（展开状态、图表、沙箱都留着），变了的就地更新，页上多出来的撤掉。正文里已收尾的段落画一次就缓存，流式时每帧只重画最后一段

// 落墨节奏：readSse 每帧记下这一答已写出多少字、最近几帧各写出几个（新字渐显用）；画的时候照它截。
// 没有记的（别处在写、动效关着、已写完）整段都画
/** @type {Map<string, { shown: number, fresh: Array<{ count: number, age: number }> }>} */
const inkReveal = new Map();
const partTemplate = document.createElement("template");
function elementFrom(html) {
  partTemplate.innerHTML = html;
  return /** @type {HTMLElement} */ (partTemplate.content.firstElementChild);
}
/**
 * @typedef {Object} Part 一个部件
 * @property {string} key 同一处的键不变，节点就留着
 * @property {string} [sig] 签名：没变就不碰
 * @property {() => string} html 造出这个部件的外壳（或整个部件）
 * @property {(el: HTMLElement, created: boolean) => void} [paint] 就地画；没有的部件签名一变整个换
 * @property {boolean} [always] 不看签名，每回都画（里面自有分寸）
 * @property {boolean} [enter] 已在页上的回复里新出时带入场动效
 */
// 按键对齐 host 的子节点：缺的造、多的撤、次序不对的挪
/** @param {Element} host @param {Part[]} parts @param {boolean} animate */
function syncParts(host, parts, animate = false) {
  const existing = new Map();
  for (const el of host.children) if (el._part) existing.set(el._part, el);
  let cursor = host.firstElementChild;
  for (const part of parts) {
    const old = existing.get(part.key);
    existing.delete(part.key);
    let el = old;
    if (!old || (!part.paint && old._sig !== part.sig)) {
      el = elementFrom(part.html());
      el._part = part.key;
      if (animate && part.enter) el.classList.add("is-new");
    }
    if (old && el !== old) {
      if (old === cursor) cursor = cursor.nextElementSibling;
      old.remove();
    }
    if (el === cursor) cursor = cursor.nextElementSibling;
    else host.insertBefore(el, cursor);
    if (part.paint && (el !== old || part.always || el._sig !== part.sig)) part.paint(el, el !== old);
    el._sig = part.sig;
  }
  // 游标之后全是没被点到名的（撤掉的部件、旧的画法留下的）
  while (cursor) {
    const stale = cursor;
    cursor = cursor.nextElementSibling;
    stale.remove();
  }
}

// 页上这条回复（正文或旁注里）照它此刻的样子重画；不在页上就不画。返回画到的那一条
/** @param {Message} message @param {{ steps?: boolean }} [options] */
function paintMessage(message, options = {}) {
  const article = document.querySelector(`[data-message="${CSS.escape(message.id)}"]`);
  if (article?.classList.contains("assistant")) paintAssistant(/** @type {HTMLElement} */ (article), message, options);
  return article;
}
/** @param {Message} message */
function assistantShellHtml(message) {
  return `<article class="message assistant" data-message="${escapeHtml(message.id)}" data-status="${escapeHtml(message.status || "complete")}"></article>`;
}
/** @param {Message} message 当前对话里这一答的分支位置（翻版本的 ‹ n/m ›） */
function branchFor(message) {
  const c = currentConversation(),
    index = c ? c.messages.indexOf(message) : -1;
  return index >= 0 ? branchAt(c, index) : null;
}
/**
 * @param {HTMLElement} article
 * @param {Message} message
 * @param {{ steps?: boolean, side?: boolean, branch?: any }} [options]
 *   steps 为假：只是正文、思绪多写了几个字（流式逐帧），步骤没动，不必逐步核对；side：旁注里的答，动作不同、不标旁注数
 */
function paintAssistant(article, message, { steps = true, side = !!article.closest("#sideMessages"), branch = undefined } = {}) {
  if (branch === undefined) branch = side ? null : branchFor(message);
  const status = message.status || "complete",
    meta = `<div class="message-meta"><span class="meta-seal" aria-hidden="true">言</span><span>${escapeHtml(message.modelName || "模型")} · ${formatTime(message.timestamp)}</span>${side ? "" : noteMarkHtml(message)}</div>`,
    // 旁注里的答：复制、重新生成（不分叉，直接换掉）；出错或停止了也能重来
    actions = side
      ? status === "streaming"
        ? ""
        : `${message.content ? actionIcon("copy", "复制回复") : ""}${actionIcon("regenerate", status === "complete" ? "重新生成" : "重试")}`
      : assistantActionsHtml(message) + branchNavHtml(branch),
    bar = actions ? `<div class="message-actions${branch ? " has-branch" : ""}">${actions}</div>` : "";
  /** @type {Part[]} */
  const parts = [
    { key: "meta", sig: meta, html: () => meta },
    { key: "block", sig: "", html: () => `<div class="assistant-block"></div>` }
  ];
  if (bar) parts.push({ key: "actions", sig: bar, html: () => bar });
  syncParts(article, parts);
  paintBlock(article.querySelector(":scope > .assistant-block"), message, { steps, animate: !!article._painted });
  const was = article.dataset.status;
  article.dataset.status = status;
  // 写完落印：只在眼看着它写完时盖一下，重画出来的旧答不再盖
  if (was === "streaming" && status === "complete") article.querySelector(".meta-seal")?.classList.add("stamped");
  article._painted = true;
  if (status !== "streaming" && !side && article.isConnected) decorateNoteAnchors(article);
}
/**
 * 回复的身子：思绪、行迹、正文、成品、改动、出处
 * @param {Element} block
 * @param {Message} message
 * @param {{ steps: boolean, animate: boolean }} o
 */
function paintBlock(block, message, o) {
  // 正文开头带 <think> 的旧消息按思绪 + 正文拆开看（不改存下的原文）；开合、步骤这些仍记在消息本身
  const source = inlineThinkView(message),
    streaming = message.status === "streaming",
    reveal = streaming ? inkReveal.get(message.id) : null,
    content = String(source.content || ""),
    reasoning = String(source.reasoning || ""),
    visible = reveal ? content.slice(0, reveal.shown) : content,
    fresh = reveal?.fresh || [],
    work = trailWork(message);
  /** @type {Part[]} */
  const parts = [];
  const stack = message.steps?.length
    ? stackPart(message, source, { streaming, visible, fresh, work, steps: o.steps, animate: o.animate })
    : null;
  // 执事的行迹在前：思绪各归各轮；做完后最后一轮的思绪落在行迹之后。对谈里思绪在前、行迹是折起的注脚
  if (work) {
    parts.push(stack);
    const tail = reasoning.slice(trailReasoningBase(message));
    if (!streaming && tail.trim()) parts.push(thoughtPart("tail-thought", tail, false, message));
  } else {
    if (reasoning.trim()) parts.push(thoughtPart("reasoning", reasoning, reasoningLive({ ...source, content: visible }), message));
    if (stack) parts.push(stack);
  }
  // 正文：执事生成中，最后一步之后的话还在行迹里「进行中」那组（见 paintTimeline），写完才落到这里
  if (streaming && !visible) parts.push(placeholderPart("正在凝神"));
  else if (!content && message.status === "stopped") parts.push(placeholderPart("搁笔于此"));
  else {
    const text = work ? (streaming ? "" : content.slice(trailBase(message)).trim()) : visible;
    if (text)
      parts.push({
        key: "main",
        sig: `${streaming}|${text}`,
        html: () => `<div class="markdown"></div>`,
        paint: el => paintMarkdown(el, text, { streaming, fresh })
      });
  }
  const drafting = !work && streaming ? draftingLabel(message) : "";
  if (drafting) parts.push(draftingPart(drafting));
  const note = assistantNoteHtml(message);
  if (note) parts.push({ key: "note", sig: note, enter: true, html: () => note });
  const deliver = deliverablesHtml(message);
  if (deliver) parts.push({ key: "deliver", sig: deliver, html: () => deliver });
  // 改动条：生成中不画（那时在输入框上方的工作条里），写完落下来时轻浮一下；数字就地更新，展开状态保留
  const changes = streaming ? "" : changeSummaryInner(message, false);
  if (changes)
    parts.push({
      key: "change",
      sig: changes,
      enter: true,
      html: () => `<div class="change-bar">${changes}</div>`,
      paint: (el, created) => {
        if (!created)
          el.innerHTML = changeSummaryInner(message, el.querySelector(".change-summary")?.getAttribute("aria-expanded") === "true");
      }
    });
  const sources = sourceCardsHtml(message);
  if (sources) parts.push({ key: "sources", sig: sources, enter: true, html: () => sources });
  syncParts(block, parts, o.animate);
}
function placeholderPart(text) {
  return { key: "thinking", sig: text, html: () => `<div class="thinking">${text}</div>` };
}
/** @param {string} label */
function draftingPart(label) {
  return {
    key: "drafting",
    sig: label,
    html: () =>
      `<div class="trail-drafting"><span class="tool-state spinning" aria-hidden="true"></span><span class="trail-drafting-text"></span></div>`,
    paint: el => rollText(el.querySelector(".trail-drafting-text"), label)
  };
}
// 模型正拟着工具调用（参数还在流）：一行「正在拟 …」，参数长了带上字数
/** @param {Message|SubAgent} source */
function draftingLabel(source) {
  const drafting = (source.toolCalls || []).filter(call => call.name);
  if (!drafting.length) return "";
  const label = drafting
    .map(call => {
      const path = call.arguments.match(/"(?:path|command|query|url|title)"\s*:\s*"((?:[^"\\]|\\.){1,80})/)?.[1];
      return `${toolLabel(call.name)}${path ? ` ${path}` : ""}`;
    })
    .join("、");
  const chars = drafting.reduce((sum, call) => sum + call.arguments.length, 0);
  return `正在拟 ${label}${chars > 200 ? ` · ${chars} 字` : ""}`;
}
// 思绪块（正文区里的那一块）：开合记在消息上——用户亲手开合过的就不替他动；写完了收起（收尾时不看读者在不在看）
/** @param {Message} message */
function thoughtPart(key, text, live, message) {
  const streaming = message.status === "streaming";
  return {
    key,
    sig: `${streaming}|${live}|${text}`,
    enter: true,
    html: () =>
      `<details class="reasoning"${(message.reasoningTouched ? message.reasoningOpen : live) ? " open" : ""} data-state="${live ? "live" : "done"}"><summary>思绪</summary><div class="reasoning-body"></div></details>`,
    paint: el => paintThought(el, text, live, { touched: !!message.reasoningTouched, force: !streaming })
  };
}
// 思绪写进块里：接着上回画到的地方追加（思绪可能已有几十万字，每帧整块替换会卡住输入）；进行中摊开，写完就收
function paintThought(details, text, live, { touched = false, force = false } = {}) {
  const body = details.querySelector(":scope > .reasoning-body"),
    painted = body._paintedThought ?? body.textContent;
  if (painted !== text) {
    const last = body.lastChild;
    if (painted && text.startsWith(painted) && last?.nodeType === 3) last.appendData(text.slice(painted.length));
    else body.textContent = text;
    body._paintedThought = text;
    // 软跟踪：没往上翻就跟着最新一行走
    if (details.open && body._follow !== false) body.scrollTop = body.scrollHeight;
  }
  details.dataset.state = live ? "live" : "done";
  if (touched) return;
  if (live) {
    if (!details.open) settleDetails(details, true);
  } else if (details.open) settleDetails(details, false, null, force);
}
/**
 * 一段正文画进 el：已收尾的段落（空行分开、不在代码围栏里）画一次存进 md-stable，每回只重画最后一段 md-tail，长回复不会越写越卡；
 * 写完时若页上正是这段话流出来的样子，只把尾段按定稿重画一次（交互内容此时才挂上），否则整段画
 * @param {Element} el
 * @param {string} text
 * @param {{ streaming?: boolean, fresh?: Array<{ count: number, age: number }> }} [options]
 */
function paintMarkdown(el, text, { streaming = false, fresh = [] } = {}) {
  const src = String(text || "").replace(/^\n+/, "");
  if (el._mdText === src && el._mdFinal === !streaming) return;
  let stable = el._mdStable,
    tail = el.querySelector(":scope > .md-tail");
  const cached = stable !== undefined && !!tail && src.startsWith(stable);
  el._mdText = src;
  el._mdFinal = !streaming;
  if (!streaming) {
    if (cached) {
      tail.innerHTML = renderMarkdown(src.slice(stable.length));
      if (el.isConnected) renderEnhancements(tail);
    } else {
      el.innerHTML = renderMarkdown(src);
      delete el._mdStable;
      if (el.isConnected) renderEnhancements(el);
    }
    return;
  }
  if (!cached) {
    el.innerHTML = `<div class="md-stable"></div><div class="md-tail"></div>`;
    stable = "";
    tail = el.querySelector(":scope > .md-tail");
  }
  const cut = stableCut(src);
  if (cut > stable.length) {
    const part = el.querySelector(":scope > .md-stable");
    part.insertAdjacentHTML("beforeend", renderMarkdown(src.slice(stable.length, cut)));
    stable = src.slice(0, cut);
    renderEnhancements(part);
  }
  el._mdStable = stable;
  // 生成中不起可视化：尾段里没闭合的交互内容先画成占位框
  suppressViz = true;
  try {
    paintTail(tail, renderMarkdown(src.slice(stable.length)));
  } finally {
    suppressViz = false;
  }
  decorateTail(tail, fresh);
}

// ---------- 行迹 ----------
/**
 * @param {Message} message
 * @param {Message} source 拆过 <think> 的样子
 * @param {{ streaming: boolean, visible: string, fresh: any[], work: boolean, steps: boolean, animate: boolean }} view
 */
function stackPart(message, source, view) {
  return {
    key: view.work ? "trail" : "stack",
    always: true,
    enter: true,
    html: () => {
      const open = message.steps.some(step => step.status === "pending") || (message.toolsTouched ? !!message.toolsOpen : view.streaming);
      return `<details class="tool-stack${view.work ? " is-work" : ""}"${open ? " open" : ""} data-state="${escapeHtml(message.status || "complete")}"><summary><span class="tool-stack-label"></span><span class="tool-stack-meta"></span></summary><div class="tool-stack-body"></div></details>`;
    },
    paint: (el, created) => paintStack(el, message, source, view, created)
  };
}
/** @param {Message} message @param {Message} source */
function paintStack(stack, message, source, view, created) {
  const label = stack.querySelector(":scope > summary > .tool-stack-label"),
    text = trailLabel(message);
  if (label.textContent !== text) label.textContent = text;
  rollText(stack.querySelector(":scope > summary > .tool-stack-meta"), trailMeta(message));
  stack.dataset.state = message.status || "complete";
  const body = stack.querySelector(":scope > .tool-stack-body"),
    seen = stepSeen(message.id),
    steps = view.steps || created;
  // 执事的行迹是一条时间线：模型边做边说的话与各步穿插排列；对谈里仍是一列步骤
  if (view.work)
    paintTimeline(body, source, {
      live: view.streaming,
      visible: view.visible,
      fresh: view.fresh,
      merge: true,
      steps,
      animate: view.animate,
      seen
    });
  else {
    if (body.childElementCount !== 1 || !body.firstElementChild.classList.contains("tool-steps"))
      body.innerHTML = `<div class="tool-steps"></div>`;
    if (steps) syncStepList(body.firstElementChild, message.steps, seen, view.animate);
  }
  markStalePlans(body);
  // 一答只开一次、收一次：第一步起就摊开，整答写完才收（言里模型说话的间隙也不收）；请示时必开。
  // 收是在眼看着它写完的那一刻（不看读者是否正停在这块、是否亲手开过），此后用户再开合就随他
  const was = stack._status;
  stack._status = message.status;
  if (view.streaming) {
    if (message.steps.some(step => step.status === "pending") || !message.toolsTouched) settleDetails(stack, true);
  } else if (was === "streaming")
    settleDetails(
      stack,
      false,
      () => {
        message.toolsOpen = false;
        message.toolsTouched = false;
      },
      true
    );
}
// 各条消息的步骤台账（syncStep 据此判断哪一步是新来的、哪一步变了）；只留最近的几十条
function stepSeen(id) {
  let seen = knownStepIds.get(id);
  if (!seen) {
    seen = new Map();
    knownStepIds.set(id, seen);
    if (knownStepIds.size > 32) knownStepIds.delete(knownStepIds.keys().next().value);
  }
  return seen;
}
const knownStepIds = new Map();
// 一列步骤按 id 对齐：新的接在后头，变了的就地换，撤下的（没递出去的补言）拿掉
/** @param {Step[]} steps */
function syncStepList(list, steps, seen, animate) {
  const ids = new Set();
  for (const step of steps) {
    syncStep(list, step, seen, animate);
    ids.add(step.id);
  }
  for (const el of [...list.children]) if (!ids.has(el.dataset.stepId)) el.remove();
}
/**
 * 一条时间线：一轮一组（这一轮的思绪 · 说的话 · 各步），末尾是还在进行的那一轮（思绪、正写着的话、正拟的调用）。
 * 组按先后编号，不按正文偏移：收尾裁掉开头空行时偏移会整体前移，编号不变，节点就还是那一个；进行中的那一轮有了步骤，就地转成下一组。
 * 主答的行迹与差遣面板里帮手的时间线都画在这里（helper：各轮的步骤折成一行，末尾那一轮的思绪写完也留在原处）
 * @param {Element} body
 * @param {Message|SubAgent} source
 * @param {{ live: boolean, visible: string, fresh?: any[], merge?: boolean, helper?: boolean, steps: boolean, animate: boolean, seen: Map<string, any> }} o
 *   merge：进行中那一轮还没开口、只是接着想时，思绪续进上一组那一块（「想一阵 → 调工具 → 再想」是同一段思路，不另起一枚签）
 */
function paintTimeline(body, source, o) {
  const groups = trailGroups(source),
    last = groups.at(-1),
    reasoning = String(source.reasoning || ""),
    base = last ? last.at : 0,
    thinking = reasoningLive({ .../** @type {Message} */ (source), content: o.visible }),
    // 画上去的字会挂在节点上久留：都另抄一份，免得每组钉住一份当时的整串（见 ownCopy）
    thought = ownCopy(reasoning.slice(groups.reduce((max, group) => Math.max(max, group.rat), 0)).trim()),
    said = ownCopy(o.visible.slice(base));
  const merged = !!(o.merge && o.live && last && thought && reasoning.slice(last.rfrom, last.rat).trim());
  /** @type {Part[]} */
  const parts = groups.map((group, i) => {
    const tip = i === groups.length - 1;
    return {
      key: `g${i}`,
      // 流式逐帧只动最后一组（它的思绪可能还在续）；更早的组此时不会变
      always: o.steps || tip,
      html: () => `<div class="trail-group"></div>`,
      paint: (el, created) =>
        paintTrailGroup(
          el,
          {
            at: group.at,
            thought: ownCopy(reasoning.slice(group.rfrom, tip && merged ? undefined : group.rat).trim()),
            thinking: tip && merged && thinking,
            note: ownCopy(
              String(source.content || "")
                .slice(group.from, group.at)
                .trim()
            ),
            steps: group.steps
          },
          source,
          { ...o, steps: o.steps || created }
        )
    };
  });
  const tail = {
    tail: true,
    thought: merged ? "" : thought,
    thinking,
    note: o.helper ? (o.live ? said.trim() : "") : o.live ? said : "",
    drafting: !o.helper && o.live ? draftingLabel(source) : "",
    idle: !!(o.helper && o.live && !thought && !said.trim() && !groups.length)
  };
  if (o.helper ? tail.thought || tail.note || tail.idle : o.live && (tail.thought || tail.note.trim() || tail.drafting))
    parts.push({
      key: `g${groups.length}`,
      always: true,
      html: () => `<div class="trail-group"></div>`,
      paint: el => paintTrailGroup(el, tail, source, o)
    });
  syncParts(body, parts, o.animate);
}
/**
 * 一组：思绪、说的话、各步；末尾进行中的那一组另有正拟的调用、帮手的「正在凝神」
 * @param {Element} el
 * @param {{ tail?: boolean, at?: number, thought: string, thinking: boolean, note: string, steps?: Step[], drafting?: string, idle?: boolean }} g
 * @param {Message|SubAgent} source
 */
function paintTrailGroup(el, g, source, o) {
  const tail = !!g.tail;
  el.classList.toggle("trail-live", tail && !o.helper);
  el.classList.toggle("sub-tail", tail && !!o.helper);
  if (tail) delete el.dataset.at;
  else el.dataset.at = String(g.at);
  /** @type {Part[]} */
  const parts = [];
  if (g.thought)
    parts.push({
      key: "thought",
      sig: `${o.live}|${g.thinking}|${g.thought}`,
      enter: tail,
      html: () =>
        `<details class="reasoning trail-reasoning"${g.thinking ? " open" : ""} data-state="${g.thinking ? "live" : "done"}"><summary>思绪</summary><div class="reasoning-body"></div></details>`,
      // 写着的时候读者停在这块上就先不收；整段写完了不再等
      paint: node => paintThought(node, g.thought, g.thinking, { touched: !!node.dataset.touched, force: !o.live })
    });
  // 说的话：进行中那一轮的按流式画（已收尾的段落缓存）；各组的与帮手正说着的整段画
  const streamingNote = tail && !o.helper;
  if (g.note.trim())
    parts.push({
      key: "note",
      sig: `${streamingNote}|${g.note}`,
      html: () => `<div class="trail-note"></div>`,
      paint: node => {
        node.classList.toggle("sub-said", tail && !!o.helper);
        if (!streamingNote) return paintMarkdown(node, g.note);
        if (node.childElementCount !== 1 || !node.firstElementChild.classList.contains("markdown")) {
          node.innerHTML = `<div class="markdown"></div>`;
          delete node._mdText;
          delete node._mdStable;
        }
        paintMarkdown(node.firstElementChild, g.note, { streaming: true, fresh: o.fresh || [] });
      }
    });
  if (!tail)
    parts.push(
      o.helper
        ? {
            // 帮手一轮里的各步折成一行：几十次检索摊开要占几屏，帮手说的话与回报就被顶得看不见了
            key: "steps",
            always: true,
            html: () => subStepsShell(/** @type {SubAgent} */ (source), g.steps),
            paint: (node, created) => {
              if (o.steps || created) syncStepList(node.querySelector(".tool-steps"), g.steps, o.seen, o.animate);
              syncSubSteps(node, /** @type {SubAgent} */ (source), g.steps);
            }
          }
        : {
            key: "steps",
            always: true,
            html: () => `<div class="tool-steps"></div>`,
            paint: (node, created) => {
              if (o.steps || created) syncStepList(node, g.steps, o.seen, o.animate);
            }
          }
    );
  if (g.drafting) parts.push(draftingPart(g.drafting));
  if (g.idle) parts.push({ key: "idle", sig: "", html: () => `<div class="sub-idle">帮手正在凝神</div>` });
  syncParts(el, parts, o.animate);
}

// ---------- 差遣面板里帮手的那一条：题头（可收起）、时间线、回报 ----------
/** @param {Element} trail @param {Step} step @param {boolean} animate */
function paintHelperTrail(trail, step, animate) {
  const { sub, live, report } = delegateSubState(step);
  if (live) trail.dataset.live = "true";
  else delete trail.dataset.live;
  /** @type {Part[]} */
  const parts = [];
  if (sub)
    parts.push({
      key: "fold",
      sig: "",
      html: () =>
        `<button type="button" class="sub-fold"><span class="sub-fold-label">行迹</span><span class="sub-fold-meta"></span></button>`
    });
  parts.push({
    key: "timeline",
    always: true,
    html: () => `<div class="sub-timeline"></div>`,
    paint: (el, created) => {
      if (sub)
        paintTimeline(el, sub, {
          live,
          visible: String(sub.content || ""),
          helper: true,
          steps: true,
          animate: animate && !created,
          seen: helperSeen
        });
    }
  });
  if (report)
    parts.push({ key: "report", sig: report, html: () => `<div class="sub-report"></div>`, paint: el => paintMarkdown(el, report) });
  syncParts(trail, parts, animate);
  if (sub) syncSubFold(trail, step);
}
// 把尾段末尾最近写出的字按帧分组包进 .ink-fresh（用负 animation-delay 对齐各自的年龄，重绘也不会重放），并在最后一个字后放一支光标
function decorateTail(tail, groups) {
  if (tail.querySelector(".viz-pending")) return;
  const nodes = [];
  const walker = document.createTreeWalker(tail, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (walker.currentNode.data.trim()) nodes.push(walker.currentNode);
  let node = nodes.pop();
  if (!node) return;
  const cursor = document.createElement("span");
  cursor.className = "ink-cursor";
  node.after(cursor);
  for (const group of groups) {
    let need = group.count;
    while (need > 0 && node) {
      const text = node.data,
        take = Math.min(need, text.length),
        span = document.createElement("span");
      span.className = "ink-fresh";
      span.style.animationDelay = `-${Math.round(group.age)}ms`;
      span.textContent = text.slice(text.length - take);
      node.data = text.slice(0, text.length - take);
      node.after(span);
      need -= take;
      if (!node.data) {
        node.remove();
        node = nodes.pop();
      }
    }
    if (!node) break;
  }
}
