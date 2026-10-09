// 言 · 导出：对话存成 Markdown 落到卷宗；正文里的交互作品另附离线 HTML
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// ---------- 对话存成 Markdown：落到卷宗 ----------
// 元信息不是 Markdown 正文：路径、命令与文件名里的符号不能变成标题、链接或 HTML。
function exportMarkdownLabel(value) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, "\\$&");
}
function exportToolTrail(message) {
  const steps = message.steps || [];
  if (!steps.length) return "";
  // 模型上下文的 stepsDigest 会截短、只取前 16 步；导出单独排成纯文本，不把命令当 Markdown 解析。
  const text = steps
    .map(
      (step, index) =>
        `${index + 1}. ${TOOLS.get(step.name)?.label || step.name} · ${step.name === "fold" ? foldTitle(step) : step.title || step.note || ""} → ${step.result || step.status || ""}`
    )
    .join("\n");
  const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
  return `行迹：\n\n${fence}text\n${text}\n${fence}`;
}
/** @param {Conversation} c */
function conversationMarkdown(c) {
  const lines = [
    `# ${exportMarkdownLabel(c.title)}`,
    "",
    `${formatDay(c.createdAt)}${isWork(c) ? ` · 工作目录 ${exportMarkdownLabel(c.workdir)}` : ""}`,
    ""
  ];
  for (const m of c.messages) {
    if (m.role === "context") {
      lines.push(
        "---",
        "",
        m.summary ? `> **前文摘要**\n>\n> ${String(m.summary).replace(/\n/g, "\n> ")}` : "*（上下文由此重新开始）*",
        ""
      );
      continue;
    }
    if (m.role === "user" && m.relay) {
      lines.push(
        `*${m.relay.map(item => (item.kind === "bg" ? `后台 ${item.title} 已结束 · 退出码 ${item.exitCode ?? "?"}` : `帮手「${exportMarkdownLabel(item.title)}」${item.ok ? "回报" : "未完成"}`)).join(" · ")}*`,
        ""
      );
      continue;
    }
    if (m.role === "user") {
      lines.push("## 问", "");
      if (m.quote?.text)
        lines.push(
          ...String(m.quote.text)
            .split(/\r?\n/)
            .map(line => `> ${line}`),
          ""
        );
      if (m.attachments?.length) lines.push(`*附件：${m.attachments.map(f => exportMarkdownLabel(f.name)).join("、")}*`, "");
      lines.push(String(m.content || ""), "");
    } else if (m.role === "assistant" && m.status !== "error") {
      lines.push(`## 答${m.modelName ? ` · ${exportMarkdownLabel(m.modelName)}` : ""}`, "");
      const trail = exportToolTrail(m);
      if (trail) lines.push(trail, "");
      lines.push(String(m.content || ""), "");
      if (m.deliverables?.length) lines.push(`*成品：${m.deliverables.map(f => exportMarkdownLabel(f.name)).join("、")}*`, "");
    }
  }
  // 不能全局合并空行：代码、HTML 与模板字符串里的换行本身就是内容。
  return lines.join("\n").trim() + "\n";
}
/** @param {Conversation} c */
async function exportConversationMarkdown(c) {
  if (!c) return;
  // 去掉首尾的点：点开头的文件在卷宗里当隐藏项不列；标题全是非法字符的落成「对话」
  const name = `${
      [
        ...String(c.title || "")
          .replace(/[\\/:*?"<>|]/g, " ")
          .replace(/^[. ]+|[. ]+$/g, "")
      ]
        .slice(0, 60)
        .join("")
        .trim() || "对话"
    }.md`,
    original = conversationMarkdown(c);
  try {
    const sources = markdownVisuals(original),
      files = [];
    if (sources.length) toast("正在打包交互可视化…");
    for (const [index, source] of sources.entries())
      files.push({ name: `${name.slice(0, -3)}-可视化-${index + 1}.html`, text: await standaloneHtmlApp(source) });
    const savedFiles = [];
    for (const file of files) savedFiles.push(await putArchiveFile(file.name, dataUrlFromText(file.text, "text/html;charset=utf-8")));
    const text = original + markdownAssetLinks(savedFiles);
    const saved = await putArchiveFile(name, dataUrlFromText(text, "text/markdown"));
    void refreshArchive();
    toast(`已存入卷宗：${saved.name}${files.length ? `（附 ${files.length} 个交互作品）` : ""}`);
  } catch (error) {
    toast(`导出失败：${String(error.message || error).slice(0, 160)}`);
  }
}
// Markdown 保留可编辑源码，交互作品另附离线 HTML，一并存进卷宗
function markdownVisuals(text) {
  if (!window.marked) return [];
  const sources = [];
  window.marked.walkTokens(window.marked.lexer(liftBareMermaid(text)), token => {
    if (token.type !== "code") return;
    const lang = String(token.lang || "")
      .trim()
      .split(/\s+/)[0]
      .toLowerCase();
    let source = null;
    if (["html", "interactive", "app"].includes(lang)) source = token.text;
    else if (["mermaid", "echarts"].includes(lang) || ((!lang || lang === "pre") && looksLikeMermaid(token.text)))
      source = legacyVizHtml(lang, token.text);
    if (source !== null) sources.push(source);
  });
  return sources;
}
function markdownAssetLinks(files) {
  if (!files.length) return "";
  return `\n## 交互可视化\n\n源码保留在正文中；下列 HTML 文件可离线打开并交互，请与本文一起保留。\n\n${files
    .map((file, index) => `- [可视化 ${index + 1}](<${encodeURIComponent(file.name)}>)`)
    .join("\n")}\n`;
}
