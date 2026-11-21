// 言 · 请示：步骤挂起、等用户定夺——运行一条指令（run_command），或答一张小表单（ask_user）。
// 请示条从输入框上方浮出，不必去行迹里找那一行；条上画什么由那件工具的 approval 定。输入框留空时按 Enter 即运行或翻到下一题
const pendingApprovals = new Map();
// 挂起时作业条、行迹题头与那一步上写的字；侧栏、帮手面板据它认出「在等人」，别处只引这一个
const AWAITING = "待你定夺";
/**
 * 挂起这一步，等用户在请示条上定夺，返回定夺的结果
 * @param {Step} step
 * @param {ToolContext} ctx
 */
async function askApproval(step, { conversation, assistant, signal }) {
  signal.throwIfAborted();
  const job = requestJob(conversation.id);
  step.status = "pending";
  if (job) setJobLabel(conversation, job, AWAITING);
  const answer = await new Promise((resolve, reject) => {
    const done = value => {
      pendingApprovals.delete(step.id);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      pendingApprovals.delete(step.id);
      reject(Object.assign(Error(t("已停止")), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pendingApprovals.set(step.id, { conversationId: conversation.id, resolve: done, step });
    notifyDesktop(conversation, t`待你定夺：${step.gist || step.title || toolLabel(step.name)}`);
    // 先入册再画行迹：行迹据它认出哪一步已在请示条上（见 inApprovalBar）
    renderApprovalBar();
    refreshSteps(assistant);
    saveStore();
    renderHistory();
  }).finally(renderApprovalBar);
  step.status = "running";
  if (job) setJobLabel(conversation, job);
  refreshSteps(assistant);
  renderHistory();
  return answer;
}
function settleApproval(stepId, value) {
  const entry = pendingApprovals.get(stepId);
  // Enter、旧按钮和切宽档位都走这里；工具不在时，只有跳过还能结清请示。
  if (!entry || (value !== false && !approvalRenderer(entry.step))) return false;
  entry.resolve(value);
  return true;
}
function pendingApprovalHere() {
  const c = currentConversation();
  if (!c) return null;
  for (const entry of pendingApprovals.values()) if (entry.conversationId === c.id) return entry;
  return null;
}
// 请示条上正摆着这一步：行迹里那一行只标「待你定夺」，不再摊开第二份；同时等着的其余几步，请示条一次只摆一件，仍在行迹里各自摊开
/** @param {Step} step */
function inApprovalBar(step) {
  return pendingApprovalHere()?.step.id === step.id;
}
function renderApprovalBar() {
  const bar = $("#approvalBar");
  const entry = view === "chat" ? pendingApprovalHere() : null;
  if (!entry) {
    bar.dataset.stepId = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  const available = String(Boolean(approvalRenderer(entry.step)));
  if (bar.dataset.stepId !== entry.step.id || bar.dataset.available !== available) {
    bar.dataset.stepId = entry.step.id;
    bar.dataset.available = available;
    bar.dataset.page = "0";
    bar.innerHTML = approvalBarHtml(entry.step);
    formPage(bar);
  }
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}
// 条上画什么：守的关口，或那件工具自己的请示表。这件工具已不在表里（接了 MCP 服务、后来在设置里停用或改了配置，
// 带 mcp 标记的工具整批摘掉）时给一张只剩「跳过」的条——原来这里直接取 TOOLS.get(…).approval，
// 取不到就抛 TypeError，整页 render 停在那一句上，请示条与它后面的几处一并画不出来，那一步还顶着等
/** @param {Step} step */
function approvalRenderer(step) {
  return step.gate ? keepApprovalHtml : TOOLS.get(step.name)?.approval;
}
/** @param {Step} step */
function approvalBarHtml(step) {
  const render = approvalRenderer(step);
  return render ? render(step) : missingToolApprovalHtml(step);
}
/** @param {Step} step */
function missingToolApprovalHtml(step) {
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">${t(`失`)}</span><span class="approval-title">${t(`这件工具已不在了`)} · ${escapeHtml(toolLabel(step.name))}</span></div><div class="approval-sandbox">${escapeHtml(t("服务可能刚被停用，这一步无从执行；跳过它，把结果交回模型。"))}</div><div class="approval-actions"><button type="button" data-approve="skip">${t(`跳过`)}</button></div>`;
}
// 守的关口（意里标了 ask 的守，见 19-intent/10-store.js 的 keepHook）：不论哪件工具都是这一张——守的原话领起，下面是将要做的；
// 只有准许与跳过，没有「径行」：关口不随档位放宽
/** @param {Step} step */
function keepApprovalHtml(step) {
  const gate = /** @type {{ id: string, claim: string, target: string }} */ (step.gate);
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">${t(`守`)}</span><span class="approval-title">${t`守请示 · ${escapeHtml(gate.id)}`}</span><span class="approval-hint" title="${t(`输入框留空时，Enter 即准许`)}">${t(`Enter 准许`)}</span></div>${keepGateHtml(step)}`;
}
/** 请示条与行迹里共用：守的原话、将要做的、准许与跳过；行迹的题头已写着白话那一句，不再重复 @param {Step} step */
function keepGateHtml(step, withGist = true) {
  const gate = /** @type {{ id: string, claim: string, target: string }} */ (step.gate);
  return `<div class="approval-sandbox">${escapeHtml(gate.claim)}</div>${withGist ? gistHtml(step) : ""}<pre class="approval-cmd">${escapeHtml(`${toolLabel(step.name)} · ${gate.target}`)}</pre><div class="approval-actions"><button type="button" data-approve="run">${t(`准许`)}</button><button type="button" data-approve="skip">${t(`跳过`)}</button></div>`;
}
// 模型用白话说的这一步要做什么：多数人不读指令，请示时先看这一句，原文在下面供核对
/** @param {Step} step */
function gistHtml(step) {
  return step.gist ? `<div class="approval-gist">${escapeHtml(step.gist)}</div>` : "";
}
// 请示条或行迹里的「运行 / 跳过 / 径行」
function approveFrom(button) {
  const stepId = button.closest("[data-step-id]")?.dataset.stepId,
    c = currentConversation();
  if (!stepId || !c || !settleApproval(stepId, button.dataset.approve !== "skip")) return;
  if (button.dataset.approve === "auto") {
    c.commandPolicy = "auto";
    saveStore();
    renderWorkAuto();
  }
}
// 输入框留空时按 Enter：指令即运行；表单翻到下一题，末题即提交
function approveByEnter(entry) {
  if (!entry.step.form) return settleApproval(entry.step.id, true);
  if (!formEnter($("#approvalBar"))) toast(t("请先在上方作答"));
}
// 表单里按 Enter：翻到下一题，末题即提交；一题都没答的不交，回 false
function formEnter(bar) {
  const page = Number(bar.dataset.page || 0),
    total = bar.querySelectorAll(".ask-q").length;
  if (page < total - 1) {
    formPage(bar, page + 1);
    return true;
  }
  const answers = collectForm(bar);
  if (!answers?.some(Boolean)) return false;
  settleApproval(bar.dataset.stepId, answers);
  return true;
}

// 请示条：批与不批、ask_user 的表单；输入框旁的权限档位切换（切宽了，这段对话里等着的请示一并放行）
function bindApprovalEvents() {
  $("#approvalBar").addEventListener("click", event => {
    const bar = $("#approvalBar"),
      button = event.target.closest("[data-approve]");
    if (button) {
      event.preventDefault();
      return approveFrom(button);
    }
    const opt = event.target.closest(".ask-opt");
    if (opt) {
      const block = opt.closest(".ask-q"),
        on = opt.getAttribute("aria-checked") === "true",
        single = block.dataset.multi !== "true";
      if (single) {
        // 单选：选项与「自行填写」二选一——点了选项就清掉填的字，反之亦然（见下面的 input 监听）
        block.querySelectorAll(".ask-opt").forEach(b => b.setAttribute("aria-checked", "false"));
        const other = block.querySelector(".ask-other");
        if (other && !on) other.value = "";
      }
      opt.setAttribute("aria-checked", on ? "false" : "true");
      return;
    }
    const form = event.target.closest("[data-form]");
    if (!form || !bar.dataset.stepId) return;
    event.preventDefault();
    if (form.dataset.form === "prev" || form.dataset.form === "next")
      return formPage(bar, Number(bar.dataset.page || 0) + (form.dataset.form === "next" ? 1 : -1));
    const answers = form.dataset.form === "submit" ? collectForm(bar) : false;
    settleApproval(bar.dataset.stepId, answers && answers.some(Boolean) ? answers : false);
  });
  $("#approvalBar").addEventListener("input", event => {
    if (!event.target.classList.contains("ask-other")) return;
    const block = event.target.closest(".ask-q");
    if (block?.dataset.multi !== "true" && event.target.value.trim())
      block.querySelectorAll(".ask-opt").forEach(b => b.setAttribute("aria-checked", "false"));
  });
  // 表单里按 Enter 一律是下一题 / 提交：点过选项焦点就停在那个钮上，Enter 照浏览器默认是再点它一下——刚选的那项反被取消；勾选留给点与空格
  $("#approvalBar").addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || !event.target.closest(".ask-other, .ask-opt")) return;
    event.preventDefault();
    if (event.repeat) return;
    if (!formEnter($("#approvalBar"))) toast(t("请先在上方作答"));
  });
  $("#workAuto").onclick = () => {
    const c = currentConversation();
    if (!c) return;
    c.commandPolicy = nextCommandPolicy(commandPolicyOf(c));
    saveStore();
    renderWorkAuto();
    // 只放行指令与外部服务的请示；等着作答的表单不是「批不批」，不能拿 true 打发掉；守的关口不随档位放宽
    if (c.commandPolicy !== "ask")
      for (const [stepId, entry] of pendingApprovals)
        if (entry.conversationId === c.id && !entry.step.form && !entry.step.gate) settleApproval(stepId, true);
  };
}
