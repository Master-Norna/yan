// 言 · 请示：步骤挂起、等用户定夺——运行一条指令（run_command），或答一张小表单（ask_user）。
// 请示条从输入框上方浮出，不必去行迹里找那一行；条上画什么由那件工具的 approval 定。输入框留空时按 Enter 即运行或翻到下一题
const pendingApprovals = new Map();
/**
 * 挂起这一步，等用户在请示条上定夺，返回定夺的结果；定了之后任务条上写 label
 * @param {Step} step
 * @param {ToolContext} ctx
 */
async function askApproval(step, { conversation, assistant, signal }, label) {
  const job = requestJob(conversation.id);
  step.status = "pending";
  if (job) setJobLabel(conversation, job, "等待确认");
  refreshSteps(assistant);
  saveStore();
  renderHistory();
  const answer = await new Promise((resolve, reject) => {
    const done = value => {
      pendingApprovals.delete(step.id);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => {
      pendingApprovals.delete(step.id);
      reject(Object.assign(Error("已停止"), { name: "AbortError" }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    pendingApprovals.set(step.id, { conversationId: conversation.id, resolve: done, step });
    renderApprovalBar();
  }).finally(renderApprovalBar);
  step.status = "running";
  if (job) setJobLabel(conversation, job, label);
  refreshSteps(assistant);
  renderHistory();
  return answer;
}
function settleApproval(stepId, value) {
  pendingApprovals.get(stepId)?.resolve(value);
}
function pendingApprovalHere() {
  const c = currentConversation();
  if (!c) return null;
  for (const entry of pendingApprovals.values()) if (entry.conversationId === c.id) return entry;
  return null;
}
function renderApprovalBar() {
  const bar = $("#approvalBar");
  const entry = view === "chat" ? pendingApprovalHere() : null;
  if (!entry) {
    bar.dataset.stepId = "";
    if (!bar.classList.contains("hidden")) hideWithFade(bar);
    return;
  }
  if (bar.dataset.stepId !== entry.step.id) {
    bar.dataset.stepId = entry.step.id;
    bar.dataset.page = "0";
    bar.innerHTML = TOOLS.get(entry.step.name).approval(entry.step);
    formPage(bar);
  }
  if (bar.classList.contains("hidden") || bar.classList.contains("leaving")) showNow(bar);
}
// 请示条或行迹里的「运行 / 跳过 / 径行」
function approveFrom(button) {
  const stepId = button.closest("[data-step-id]")?.dataset.stepId,
    c = currentConversation();
  if (!stepId || !c) return;
  if (button.dataset.approve === "auto") {
    c.commandPolicy = "auto";
    saveStore();
    renderWorkAuto();
  }
  settleApproval(stepId, button.dataset.approve !== "skip");
}
// 输入框留空时按 Enter：指令即运行；表单翻到下一题，末题即提交
function approveByEnter(entry) {
  if (!entry.step.form) return settleApproval(entry.step.id, true);
  const bar = $("#approvalBar"),
    page = Number(bar.dataset.page || 0),
    total = bar.querySelectorAll(".ask-q").length;
  if (page < total - 1) return formPage(bar, page + 1);
  const answers = collectForm(bar);
  if (answers?.some(Boolean)) return settleApproval(entry.step.id, answers);
  toast("请先在上方作答");
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
  $("#approvalBar").addEventListener("keydown", event => {
    if (event.key !== "Enter" || !event.target.classList.contains("ask-other")) return;
    event.preventDefault();
    const bar = $("#approvalBar"),
      page = Number(bar.dataset.page || 0),
      total = bar.querySelectorAll(".ask-q").length;
    if (page < total - 1) return formPage(bar, page + 1);
    const answers = collectForm(bar);
    if (answers && answers.some(Boolean)) settleApproval(bar.dataset.stepId, answers);
  });
  $("#workAuto").onclick = () => {
    const c = currentConversation();
    if (!c) return;
    c.commandPolicy = nextCommandPolicy(commandPolicyOf(c));
    saveStore();
    renderWorkAuto();
    if (c.commandPolicy !== "ask")
      for (const [stepId, entry] of pendingApprovals) if (entry.conversationId === c.id) settleApproval(stepId, true);
  };
}
