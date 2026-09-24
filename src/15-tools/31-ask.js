// 言 · 请示用户：下一步取决于用户的选择时弹一张小表单，从输入框上方浮出，一页一题；对谈与执事都有，帮手没有
defineTool({
  name: "ask_user",
  group: "ask",
  label: "请示",
  mainOnly: true,
  // 同一答里同样的一问不再打扰用户第二回
  cache: true,
  html: askStepHtml,
  approval: askFormHtml,
  digest: step => `请示 → ${step.answers ? String(step.note || "").slice(0, 200) : "用户未作答"}`,
  async run(step, args, ctx) {
    const questions = args.questions
      .slice(0, 8)
      .map(q => ({
        question: String(q?.question || "")
          .trim()
          .slice(0, 200),
        header: String(q?.header || "")
          .trim()
          .slice(0, 12),
        multi: q?.multi === true,
        options: (Array.isArray(q?.options) ? q.options : [])
          .slice(0, 4)
          .map(askOption)
          .filter(o => o.label)
      }))
      .filter(q => q.question);
    if (!questions.length)
      return {
        ok: false,
        content: `没能从参数里读出问题。questions 是一个数组，每项至少要有 question（完整的问句）与 options（2–4 个字符串选项），要多选就给 multi: true。例如：{"questions":[{"question":"用哪种风格？","header":"风格","options":["清简 — 留白多","繁复 — 信息密"],"multi":false}]}\n收到了 ${args.questions.length} 项，但没有一项带得出 question。`,
        display: "表单为空"
      };
    // 一个选项都没有的题只能靠自填，多半是模型漏了 options：补一句提醒，但表单照出，不白费这一轮
    const missing = questions.filter(q => q.options.length < 2).length;
    step.form = { questions };
    step.title = questions
      .map(q => q.header || q.question)
      .join(" · ")
      .slice(0, 80);
    const answers = await askApproval(step, ctx, "生成中");
    if (!Array.isArray(answers)) {
      step.skipped = true;
      return { ok: false, content: "用户没有作答。请按你的最佳判断继续，并在正文里说明你做了什么假设。", display: "未作答" };
    }
    step.answers = answers;
    step.note = questions.map((q, i) => `${q.header || q.question}：${answers[i] || "（未答）"}`).join("；");
    return {
      ok: true,
      content: `${questions.map((q, i) => `${q.question}\n→ ${answers[i] || "（未答）"}`).join("\n\n")}${missing ? `\n\n（有 ${missing} 题没给够选项，只能由用户自填；下次每题给 2–4 个选项。）` : ""}`,
      display: "已作答"
    };
  }
});
// 选项按字符串给：「选项 — 一句说明」；旧的 { label, description } 对象也照收
function askOption(o) {
  if (typeof o === "string") {
    const [label, ...rest] = o.split(/\s+[—–-]{1,2}\s+|—/);
    return { label: label.trim().slice(0, 60), description: rest.join("—").trim().slice(0, 120) };
  }
  return {
    label: String(o?.label || "")
      .trim()
      .slice(0, 60),
    description: String(o?.description || "")
      .trim()
      .slice(0, 120)
  };
}
/** @param {Step} step */
function askStepHtml(step) {
  const status = step.status || "done",
    meta =
      status === "pending"
        ? "待作答"
        : status === "skipped"
          ? escapeHtml(step.result || "未作答")
          : status === "error"
            ? escapeHtml(step.result || "失败")
            : escapeHtml(step.result || "已作答");
  const body =
    status === "done" && step.answers
      ? `<div class="tool-note">${escapeHtml(step.note || "")}</div>`
      : status === "pending"
        ? `<div class="tool-note">请于输入框上方作答</div>`
        : "";
  return `<div class="tool-step" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label">请示</span><span class="tool-title" title="${escapeHtml(step.title)}">${escapeHtml(step.title)}</span><span class="tool-meta">${meta}</span>${stepStateHtml(status)}</div>${body}</div>`;
}
// 请示条上的表单：右上角只写一个快捷键，这一页按 Enter 是下一题还是提交（输入框留空时），随翻页改，见 formPage；题数与第几问在标题里
/** @param {Step} step */
function askFormHtml(step) {
  const block = (q, i) =>
    `<div class="ask-q" data-q="${i}" data-multi="${q.multi ? "true" : "false"}"><div class="ask-question">${q.header ? `<span class="ask-header">${escapeHtml(q.header)}</span>` : ""}${escapeHtml(q.question)}${q.multi ? `<span class="ask-multi">可多选</span>` : ""}</div><div class="ask-options" role="${q.multi ? "group" : "radiogroup"}">${q.options.map((o, j) => `<button type="button" class="ask-opt" role="${q.multi ? "checkbox" : "radio"}" aria-checked="false" data-opt="${j}"><span class="ask-tick" aria-hidden="true"></span><span class="ask-opt-copy"><strong>${escapeHtml(o.label)}</strong>${o.description ? `<small>${escapeHtml(o.description)}</small>` : ""}</span></button>`).join("")}</div><input class="ask-other" type="text" maxlength="200" placeholder="${q.options.length ? (q.multi ? "还可自行补充" : "或自行填写") : "请填写"}" aria-label="自行填写"></div>`;
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title"></span><span class="approval-hint" title="输入框留空时，Enter 即作答"></span></div><div class="ask-form">${step.form.questions.map(block).join("")}</div><div class="approval-actions ask-nav"><span class="ask-spacer"></span><button type="button" class="ask-arrow" data-form="prev" title="上一题" aria-label="上一题">‹</button><button type="button" class="ask-arrow" data-form="next" title="下一题（未答即跳过）" aria-label="下一题">›</button><button type="button" class="ask-arrow ask-done" data-form="submit" title="提交" aria-label="提交">✓</button></div>`;
}
function formPage(bar, page = null) {
  const blocks = [...bar.querySelectorAll(".ask-q")];
  if (!blocks.length) return;
  const total = blocks.length,
    current = Math.max(0, Math.min(total - 1, page ?? Number(bar.dataset.page || 0)));
  bar.dataset.page = String(current);
  blocks.forEach((block, index) => block.classList.toggle("hidden", index !== current));
  bar.querySelector(".approval-title").textContent = total === 1 ? "有一问" : `第${chineseNumber(current + 1)}问 · 共 ${total} 问`;
  bar.querySelector(".approval-hint").textContent = current === total - 1 ? "Enter 提交" : "Enter 下一题";
  bar.querySelector('[data-form="prev"]').disabled = current === 0;
  bar.querySelector('[data-form="next"]').classList.toggle("hidden", current === total - 1);
  bar.querySelector('[data-form="submit"]').classList.toggle("hidden", current !== total - 1);
  if (page !== null) setTimeout(() => blocks[current].querySelector(".ask-opt, .ask-other")?.focus(), 0);
}
function collectForm(bar) {
  const step = pendingApprovalHere()?.step;
  if (!step?.form) return null;
  return step.form.questions.map((q, i) => {
    const block = bar.querySelector(`.ask-q[data-q="${i}"]`);
    const picked = [...block.querySelectorAll('.ask-opt[aria-checked="true"]')].map(b => b.querySelector("strong").textContent),
      other = block.querySelector(".ask-other").value.trim();
    return [...picked, ...(other ? [other] : [])].join("、");
  });
}
