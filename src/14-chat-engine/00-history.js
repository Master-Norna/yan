// 言 · 对话引擎 · 历史：每一问送给模型的历史怎么装（附件、引文、上一答的行迹、补言）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
const HISTORY_TEXT_CHARS = 3000;
function attachmentExcerpt(text, name, label) {
  const value = String(text || "");
  return value.length > HISTORY_TEXT_CHARS
    ? `\n\n--- 附件：${name}（${label}，摘要）---\n${value.slice(0, HISTORY_TEXT_CHARS)}\n[全文共 ${value.length} 字，此前已完整发送]`
    : `\n\n--- 附件：${name}（${label}）---\n${value}`;
}
/** @param {Message} message */
function quotedText(message) {
  // 游目圈点的引文另有一份写给模型的（带网址、各处的位置与字），界面上只显示短的那句
  const quote = message.quote?.model || message.quote?.text;
  if (!quote) return message.content;
  return `${quote
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join("\n")}\n\n${message.content || "请就所引用的内容作答。"}`;
}
// 上一答动过文件、请示过、差遣过、检索翻阅过的，压成一行带给下一问：模型才记得自己读过、改过哪些文件、查到过哪几条，不必从头再探。
// 哪些步骤带、怎么写，由各工具登记的 digest 定。label 是方括号里的标头：进历史时写「上一答的行迹」（见 historyForApi），存卷宗与压缩转写里写「行迹」
// 送出过的前文不再改写：一答的行迹头一回随下一问送出时定格、记在这一答上，此后照抄。帮手、后台指令收工后签上的字会变
// （「后台进行中」→ 几步几秒、改了哪些文件），照现写的话前文中间改了一处，那里往后的提示缓存全断；它们的结果另有回报送到。
// 步数变了（续写又做了几步）才重写
/** @param {Message|SubAgent} message */
function settledDigest(message) {
  const steps = (message.steps || []).length;
  if (message.trailDigest?.steps !== steps) message.trailDigest = { steps, text: stepsDigest(message, "上一答的行迹") };
  return message.trailDigest.text;
}
/** @param {Message|SubAgent} message 帮手的一趟也一样：续派时它上一趟的行迹冠在新的活前面 */
function stepsDigest(message, label = "行迹") {
  const steps = (message.steps || []).filter(step => TOOLS.get(step.name)?.digest);
  if (!steps.length) return "";
  const items = steps.slice(0, 16).map(step => {
    const digest = TOOLS.get(step.name).digest;
    return digest === true
      ? `${step.name} ${String(step.title || "").slice(0, 80)} → ${step.status === "skipped" ? "用户跳过" : step.result || step.status}`
      : digest(step);
  });
  return `［${label}］${items.join("；")}${steps.length > 16 ? `；…共 ${steps.length} 步` : ""}`;
}
// 最新一问的文本附件能整份随消息送出的上限：按模型窗口的一成半算（没填窗口按 24k token）。超过的只给一行元数据，
// 模型要看就用 read_document 按页、按关键词取——有 read_document 在，没必要把一整本硬塞进提示把窗口撑爆
/** @param {Profile} profile */
function inlineTextBudget(profile = activeProfile()) {
  const window = Number(profile?.contextWindow) || 0;
  return window ? Math.max(4000, Math.floor(window * 0.15)) : 24000;
}
// 一件文本附件（或文档的提取文本）在这一问里占多少 token：最新一问按预算内联、超预算只剩一行；早先的只带 HISTORY_TEXT_CHARS 字的摘要
function attachmentTokens(file, latest, budget) {
  const tokens = Number(file.tokens) || Math.ceil(Number(file.size || 0) / 3);
  if (!latest) return Math.min(tokens, HISTORY_TEXT_CHARS);
  return tokens > budget ? 40 : tokens;
}
function tooLongToInline(text, budget) {
  return estimateText(text) > budget;
}
// 一答途中递到的补言，按它到达的位置把这一答拆开：答的前半 → 补言 → 接着答。往后每一问装历史、压缩时转写都照这个次序，
// 模型看到的与当时一样。若把补言折成一行冠在下一问头上，它读不出先后，会把上一答里的一句「不用了，我来」当成这一问的吩咐
/** @typedef {{ role: "assistant", content: string } | { role: "user", note: Step }} ReplyPart */
/** @param {Message} message @returns {ReplyPart[]} */
function replyParts(message) {
  const content = String(message.content || "");
  /** @type {ReplyPart[]} */
  const parts = [];
  let from = 0;
  for (const note of deliveredNotes(message)) {
    const at = Math.min(Math.max(from, Number(note.at) || 0), content.length);
    if (content.slice(from, at).trim()) parts.push({ role: "assistant", content: content.slice(from, at).trimEnd() });
    parts.push({ role: "user", note });
    from = at;
  }
  if (!parts.length) return [{ role: "assistant", content: message.content }];
  if (content.slice(from).trim()) parts.push({ role: "assistant", content: content.slice(from).trimStart() });
  return parts;
}
/** @param {Message} message */
function deliveredNotes(message) {
  return (message.steps || []).filter(step => step.name === "user_note" && step.status === "done");
}
// 补言进历史：与作答途中递给模型时同一个样子（前缀注明是途中补的）。latest：正递着的这一句，附件整份带上；往后重装历史时只带摘要
/** @param {Message} user */
async function supplementForApi(user, budget, { latest = false, steer = false } = {}) {
  const entry = await messageForApi(user, latest, budget),
    prefix = prompt(steer ? "assistant.steer" : "assistant.supplement");
  if (typeof entry.content === "string") entry.content = `${prefix}${entry.content}`;
  else entry.content[0].text = `${prefix}${entry.content[0].text}`;
  return entry;
}
// 上次压缩以来的往来装成送给接口的历史。每一答的行迹摘要不接在助手自己的话后面——那样模型会把「［行迹］…」学成自己回复的
// 格式，答末照样写一行出来；而是冠在下一问的开头，当作系统附上的记录。末尾的一答后面没有下一问时（旁注锚在一答上）才退回接在它话后
async function historyForApi(source, lastUserId, budget = inlineTextBudget()) {
  const history = [];
  let trail = "";
  for (const m of source) {
    if (m.role === "assistant") {
      for (const part of replyParts(m))
        history.push(
          part.role === "assistant"
            ? part
            : await supplementForApi(
                { id: part.note.id, role: "user", content: part.note.note || "", timestamp: "", attachments: part.note.attachments },
                budget
              )
        );
      trail = settledDigest(m);
      continue;
    }
    const entry = await messageForApi(m, m.id === lastUserId, budget);
    if (trail && m.role === "user") {
      if (typeof entry.content === "string") entry.content = `${trail}\n\n${entry.content}`;
      else entry.content[0].text = `${trail}\n\n${entry.content[0].text}`;
      trail = "";
    }
    history.push(entry);
  }
  const last = history.at(-1);
  if (trail && typeof last?.content === "string") last.content = `${last.content}\n\n${trail}`.trim();
  return history;
}
/** @param {Message} message */
async function messageForApi(message, latest, budget = inlineTextBudget()) {
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  if (message.role !== "user" || !message.attachments?.length)
    return { role: message.role, content: message.role === "user" ? quotedText(message) : message.content };
  // 多段内容：首段只是用户的话，附件的文字（最新一问是全文，往后是摘要与占位）另起一段，其后图片与文件原件。
  // 首段在这一问与往后各问里一字不差，缓存才接得过这一问（见 streamReply 标的缓存点）
  /** @type {Array<Record<string, any>>} */
  const content = [{ type: "text", text: quotedText(message) || "请查看附件。" }];
  let notes = "";
  for (const metadata of message.attachments) {
    // 早先消息里的图片只留一行占位，用不着原件：不必每问都把它从存储目录整份取回来
    if (!latest && metadata.kind === "image") {
      notes += `\n\n[图片：${metadata.name}，${formatFileSize(metadata.size)}，已在此前发送]`;
      continue;
    }
    const file = metadata.data !== undefined ? metadata : await getAttachment(metadata.id);
    if (!file) {
      notes += `\n\n[附件 ${metadata.name} 的原件已找不到]`;
      continue;
    }
    if (file.kind === "text") {
      notes += latest
        ? tooLongToInline(file.data, budget)
          ? `\n\n[附件 ${file.name}：文本 ${String(file.data).length} 字，过长未随消息附上；需要时用 read_document 按页或关键词读取]`
          : `\n\n--- 附件：${file.name} ---\n${file.data}`
        : attachmentExcerpt(file.data, file.name, "文本");
      continue;
    }
    if (file.kind !== "image" && file.extractedText) {
      notes += latest
        ? tooLongToInline(file.extractedText, budget)
          ? `\n\n[附件 ${file.name}：本机提取文本 ${String(file.extractedText).length} 字，过长未随消息附上；需要时用 read_document 按页或关键词读取]`
          : `\n\n--- 附件：${file.name}（本机提取）---\n${file.extractedText}`
        : attachmentExcerpt(file.extractedText, file.name, "本机提取");
      continue;
    }
    if (!latest) {
      notes += `\n\n[${file.kind === "image" ? "图片" : "文件"}：${file.name}，${formatFileSize(file.size)}，已在此前发送]`;
      continue;
    }
    if (file.kind === "image") content.push({ type: "image_url", image_url: { url: file.data, detail: "auto" } });
    else content.push({ type: "file", file: { filename: file.name, file_data: String(file.data).replace(/^data:[^,]*,/, "") } });
  }
  if (notes) content.splice(1, 0, { type: "text", text: notes.trimStart() });
  return { role: "user", content };
}
