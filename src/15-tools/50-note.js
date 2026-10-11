// 言 · 补言：不是工具，是作答途中用户寄来的话，也记作行迹里的一步（见 14-chat-engine/10-send.js 的 sendSupplement）；从不作为工具交给模型。
// 递上时与往后重装历史时都由 replay 写成同一句用户的话，按到达的位置插回这一答（见 answerParts），不进行迹摘要
defineTool({
  name: "user_note",
  label: "补言",
  offer: false,
  html: step => noteStepHtml(step),
  replay: (step, { latest, budget }) =>
    supplementForApi({ id: step.id, role: "user", content: step.note || "", timestamp: "", attachments: step.attachments }, budget, {
      latest,
      steer: !!step.steer
    })
});
// 补言：作答途中用户寄来的话，落在行迹里它到达的那一刻；待寄时转着圈，递给模型后打勾。话不止一行、或带着附件时摊开在下面。
// 主模型递给帮手的话（传话）在帮手的时间线里也是这个样子，只是印与标签不同、没有「即刻递上」
/** @param {Step} step */
function noteStepHtml(step, { seal = "补", label = "补言" } = {}) {
  const status = step.status || "done",
    text = String(step.note || "").trim(),
    first = text.split("\n").find(Boolean)?.slice(0, 80) || "",
    files = (step.attachments || []).map(file => file.name);
  const meta = status === "running" ? "待寄" : status === "error" ? escapeHtml(step.result || "未送达") : escapeHtml(step.result || "已递");
  // 一句短话只占题头一行；摊开了全文（多行、过长、带附件）题头就不再重复第一行
  const body =
    text.length > first.length || files.length
      ? `<div class="tool-note">${escapeHtml(text)}${files.length ? `<div class="tool-note-files">${files.map(name => escapeHtml(name)).join("、")}</div>` : ""}</div>`
      : "";
  return `<div class="tool-step tool-step-note" data-tool="${escapeHtml(step.name)}" data-step-id="${escapeHtml(step.id)}" data-status="${escapeHtml(status)}"><div class="tool-step-head"><span class="tool-label"><span class="seal note-seal" aria-hidden="true">${seal}</span>${label}</span><span class="tool-title" title="${escapeHtml(text)}">${body ? "" : escapeHtml(first)}</span><span class="tool-meta">${meta}</span>${status === "running" && step.name === "user_note" ? `<button type="button" class="note-now" data-note-now title="不等落点，即刻递上" aria-label="即刻递上">↵</button>` : ""}${stepStateHtml(status)}</div>${body}</div>`;
}
