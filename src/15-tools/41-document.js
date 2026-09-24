// 言 · 翻阅文档：对话附件、浏览器内的旧卷宗，以及（设置允许时）磁盘卷宗里的文本与 Office / PDF——后者用到时才取回并抽正文。
// 长文档按页码或关键词只取片段；可读的文档名写进说明里（{{docs}}），对话里有可读文档时才给
defineTool({
  name: "read_document",
  group: "docs",
  label: "翻阅文档",
  offer: ctx => ctx.docs.length > 0,
  vars: ctx => ({ docs: ctx.docs.map(d => d.name).join("、") }),
  lookup: true,
  parallel: true,
  cache: args => ({ ...args, name: args.name.trim().toLowerCase(), query: args.query?.trim().toLowerCase() }),
  async run(step, args, { conversation }) {
    const docs = availableDocuments(conversation),
      wanted = args.name.toLowerCase();
    const doc =
      docs.find(d => d.name.toLowerCase() === wanted) ||
      docs.find(d => d.name.toLowerCase().includes(wanted)) ||
      (docs.length === 1 ? docs[0] : null);
    if (!doc)
      return { ok: false, content: `未找到文档「${args.name}」。可读文档：${docs.map(d => d.name).join("、") || "无"}`, display: "未找到" };
    step.title = doc.name;
    let text = "";
    if (doc.archive) {
      try {
        text = await archiveDocumentText(doc);
      } catch (error) {
        return { ok: false, content: `卷宗文档读取失败：${String(error.message || error).slice(0, 120)}`, display: "读取失败" };
      }
    } else {
      const record = await getAttachment(doc.id);
      text = record ? (record.kind === "text" ? record.data : record.extractedText) || "" : "";
    }
    if (!text) return { ok: false, content: "该文档无可读取的文本", display: "无文本" };
    const pages = text.split(/^(?=第 \d+ 页$)/m),
      pageCount = pages.filter(p => /^第 \d+ 页$/m.test(p)).length;
    if (args.page) {
      const page = pages.find(p => p.startsWith(`第 ${args.page} 页`));
      if (!page) return { ok: false, content: `没有第 ${args.page} 页，共 ${pageCount || 1} 页`, display: "页码超出" };
      step.note = `第 ${args.page} 页`;
      return { ok: true, content: page.slice(0, 20000), display: `第 ${args.page} 页 · ${page.length} 字` };
    }
    if (args.query) {
      const needle = args.query.toLowerCase(),
        lower = text.toLowerCase(),
        hits = [];
      let index = lower.indexOf(needle);
      while (index >= 0 && hits.length < 8) {
        hits.push(text.slice(Math.max(0, index - 300), index + needle.length + 300).trim());
        index = lower.indexOf(needle, index + needle.length + 300);
      }
      step.note = `关键词「${args.query}」`;
      return hits.length
        ? { ok: true, content: hits.map((hit, i) => `片段 ${i + 1}：…${hit}…`).join("\n\n"), display: `${hits.length} 处匹配` }
        : { ok: true, content: `全文未出现「${args.query}」`, display: "无匹配" };
    }
    const limit = 12000;
    step.note = `${text.length} 字${pageCount ? ` · ${pageCount} 页` : ""}`;
    return {
      ok: true,
      content:
        text.length > limit
          ? `${text.slice(0, limit)}\n\n[文档共 ${text.length} 字${pageCount ? `、${pageCount} 页` : ""}，此处只给出开头；可用 page 或 query 参数读取其余部分]`
          : text,
      display: `${Math.min(text.length, limit)} 字`
    };
  }
});
const ARCHIVE_DOC_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp"]);
/** @param {Conversation} conversation */
function availableDocuments(conversation) {
  const seen = new Map();
  for (const file of [...(conversation?.messages || []).flatMap(m => m.attachments || []), ...store.library])
    if (file.id && !seen.has(file.name) && (file.kind === "text" || (file.kind === "file" && file.extracted))) seen.set(file.name, file);
  if (store.settings.archiveRead !== false && archiveOnline())
    for (const entry of archiveEntries || []) {
      const extension = String(entry.name).split(".").pop().toLowerCase();
      if (seen.has(entry.name) || !(ARCHIVE_DOC_EXTENSIONS.has(extension) || isTextFile({ name: entry.name, type: "" }))) continue;
      seen.set(entry.name, { name: entry.name, archive: entry.path, size: entry.size, modifiedAt: entry.modifiedAt, kind: "archive" });
    }
  return [...seen.values()];
}
// 磁盘卷宗里的文档：取回原件，文本直接用，PDF / Office 在本机抽正文；按路径与修改时间缓存几份
const archiveDocCache = new Map();
async function archiveDocumentText(doc) {
  const key = `${doc.archive}|${doc.modifiedAt}`;
  if (archiveDocCache.has(key)) return archiveDocCache.get(key);
  const response = await fetch(archiveFileUrl(doc.archive), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error("取回失败");
  const blob = await response.blob();
  const text = isTextFile({ name: doc.name, type: "" })
    ? await blob.text()
    : await extractDocumentText(doc.name, await readFile(blob, "data"));
  archiveDocCache.set(key, text);
  if (archiveDocCache.size > 12) archiveDocCache.delete(archiveDocCache.keys().next().value);
  return text;
}
