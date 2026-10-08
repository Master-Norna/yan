// 言 · 对话引擎 · 拟题：首次问答后请模型拟一个短标题
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 首次问答完成后请模型拟一个短标题；用户手动改过题（titleAuto === false）就不再动。
// titled 只在标题真正写入后才置真：临时的网络错误不该让这段对话从此再也拟不上题，之后几答收尾时会再试（最多三次）
const titlingIds = new Set(),
  titleRetries = new Set();
/** @param {Conversation} conversation 用户亲手改过题（拟题期间也可能改，收尾前得再看一眼） */
const renamedByHand = conversation => conversation.titleAuto === false;
// 用户亲手改过的题（连同那段的头一问）：口味就在这里，拿最近的几个作参照
/** @param {Conversation} conversation */
function handNamed(conversation) {
  const list = store.conversations
    .filter(c => c !== conversation && renamedByHand(c) && c.title)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 5)
    .map(c => `「${String(c.messages.find(m => m.role === "user")?.content || "").replace(/\s+/g, " ").slice(0, 40)}」→ ${c.title}`);
  return list.length ? `${prompt("assistant.titleNamed", { list: list.join("\n") })}\n\n` : "";
}
/**
 * @param {Conversation} conversation
 * @param {Profile} profile
 */
async function maybeAutoTitle(conversation, profile) {
  if (!store.settings.autoTitle || conversation.titleAuto === false || conversation.titled) return;
  // 首问发出时拟题与正文并行；若正文先写完，收尾处会再来一次。此时不能另发一份重复请求，
  // 但要把「原请求若失败，随后再试」记下来，否则原请求稍后超时便再也没人触发重试。
  if (titlingIds.has(conversation.id)) {
    if (conversation.messages.some(message => message.role === "assistant" && message.status === "complete"))
      titleRetries.add(conversation.id);
    return;
  }
  if (quotaExhausted(profile) || (conversation.titleTries || 0) >= 3) return;
  const first = conversation.messages.find(m => m.role === "user"),
    reply = conversation.messages.find(m => m.role === "assistant" && m.status === "complete");
  if (!first) return;
  titlingIds.add(conversation.id);
  conversation.titleTries = (conversation.titleTries || 0) + 1;
  try {
    const ask = prompt("assistant.title", {
      named: handNamed(conversation),
      user: String(first.content || (first.attachments || []).map(a => a.name).join("、") || "（附件）").slice(0, 1200),
      assistant: reply ? `\n\n助手：${String(reply.content).slice(0, 1200)}` : ""
    });
    // 题目只有几个字，可它是与一答并行发出的：接口忙、模型慢起（会思考的先想再写）时三十秒常常不够，三次都超时就再也拟不上题。
    // 超时给到两分钟；输出上限不能只按题目本身算——会思考的模型把思考也计在 max_tokens 里；开了思考档位的降到最低一档，拟题用不着深想
    const response = await requestChat(profile, [{ role: "user", content: ask }], AbortSignal.timeout(120000), {
      maxTokens: 4000,
      systemPrompt: "",
      reasoning: conversation.reasoning ? "low" : ""
    });
    if (!response.ok) return;
    /** @type {Message} */
    const temp = { id: `title-${uid()}`, role: "assistant", content: "", timestamp: now() };
    if ((response.headers.get("content-type") || "").includes("text/event-stream")) await readSse(response, temp);
    else {
      const data = await response.json();
      temp.content = extractContent(data);
      temp.usage = data.usage;
    }
    const spent = Number(temp.usage?.total_tokens || 0) || estimateTokens([{ content: ask }, { content: temp.content }]);
    spendTokens(profile, spent);
    renderQuota();
    const line =
      temp.content
        .split("\n")
        .map(line => line.trim())
        .find(Boolean)
        ?.replace(/^[\s"'“”‘’《》「」【】#*]+|[\s"'“”‘’《》「」【】。！？!?.、,，]+$/g, "") || "";
    const title = [...line].slice(0, 24).join("");
    if (!title || renamedByHand(conversation)) return;
    // 拟题的这一会儿里第一问改过了：拟的是旧问题的题，不写；收尾处按新的再拟
    if (conversation.messages.find(m => m.role === "user")?.id !== first.id) return void titleRetries.add(conversation.id);
    conversation.title = title;
    conversation.titleAuto = true;
    conversation.titled = true;
    delete conversation.titleTries;
    markDirty(conversation.id);
    saveStore();
    renderHistory();
    // 用户正在页面上方改着标题：不把拟好的题写进去盖掉他的字，他落笔（blur）时以他写的为准
    if (currentId === conversation.id) {
      if (document.activeElement !== $("#chatTitle")) $("#chatTitle").textContent = title;
      syncDocumentTitle();
    }
  } catch {
  } finally {
    titlingIds.delete(conversation.id);
    const retry = titleRetries.delete(conversation.id);
    if (retry && !conversation.titled && !renamedByHand(conversation) && store.settings.autoTitle)
      setTimeout(() => void maybeAutoTitle(conversation, profile), 0);
  }
}
