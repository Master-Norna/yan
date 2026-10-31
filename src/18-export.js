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
// 问话与引文在页上是纯文本（不当 Markdown 画），导出照样：转义行内记号、行首的块记号与缩进，换行写成硬换行，空行照留
function exportPlainText(value) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
  const lines = String(value || "")
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/[\\`*_{}\[\]<>&|~]/g, ch => escapes[ch] || `\\${ch}`)
        .replace(/^[ \t]+/, space => "&nbsp;".repeat(space.replace(/\t/g, "    ").length))
        .replace(/^([#+=-])/, "\\$1")
        .replace(/^(\d+)([.)])/, "$1\\$2")
    );
  return lines.map((line, i) => (line && lines[i + 1] ? `${line}\\` : line)).join("\n");
}
function exportToolTrail(message) {
  const steps = message.steps || [];
  if (!steps.length) return "";
  // 模型上下文的 stepsDigest 会截短、步数多了只留头尾；导出单独排成纯文本，不把命令当 Markdown 解析。
  const text = steps
    .map(
      (step, index) =>
        `${index + 1}. ${TOOLS.get(step.name)?.label || step.name} · ${step.name === "fold" ? foldTitle(step) : step.name === "update_intent" || step.name === "intent_gate" ? stepText(step.title) : step.title || stepText(step.note)} → ${stepText(step.result) || step.status || ""}`
    )
    .join("\n");
  const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
  return t`行迹：\n\n${fence}text\n${text}\n${fence}`;
}
/** @param {Conversation} c */
function conversationMarkdown(c) {
  const lines = [
    `# ${exportMarkdownLabel(c.title)}`,
    "",
    `${formatDay(c.createdAt)}${isWork(c) ? t` · 工作目录 ${exportMarkdownLabel(c.workdir)}` : ""}`,
    ""
  ];
  for (const m of c.messages) {
    if (m.role === "context") {
      lines.push(
        "---",
        "",
        m.summary ? t`> **前文撮要**\n>\n> ${String(m.summary).replace(/\n/g, "\n> ")}` : t("*（上下文由此重新开始）*"),
        ""
      );
      continue;
    }
    if (m.role === "user" && m.relay) {
      lines.push(
        `*${m.relay.map(item => (item.kind ? exportMarkdownLabel(relayLabel(item).name) : t`帮手「${exportMarkdownLabel(item.title)}」${item.ok ? t("回报") : t("未完成")}`)).join(" · ")}*`,
        ""
      );
      continue;
    }
    if (m.role === "user") {
      lines.push(t("## 问"), "");
      if (m.quote?.text)
        lines.push(
          ...exportPlainText(m.quote.text)
            .split("\n")
            .map(line => `> ${line}`),
          ""
        );
      if (m.attachments?.length) lines.push(t`*附件：${m.attachments.map(f => exportMarkdownLabel(f.name)).join("、")}*`, "");
      lines.push(exportPlainText(m.content), "");
    } else if (m.role === "assistant" && m.status !== "error") {
      lines.push(t`## 答${m.modelName ? ` · ${exportMarkdownLabel(m.modelName)}` : ""}`, "");
      const trail = exportToolTrail(m);
      if (trail) lines.push(trail, "");
      lines.push(String(m.content || ""), "");
      if (m.deliverables?.length) lines.push(t`*成品：${m.deliverables.map(f => exportMarkdownLabel(f.name)).join("、")}*`, "");
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
        .trim() || t("对话")
    }.md`,
    original = conversationMarkdown(c);
  try {
    const sources = markdownVisuals(original),
      files = [];
    if (sources.length) toast(t("正在打包交互可视化…"));
    for (const [index, source] of sources.entries())
      files.push({ name: t`${name.slice(0, -3)}-可视化-${index + 1}.html`, text: await standaloneHtmlApp(source) });
    const savedFiles = [];
    for (const file of files) savedFiles.push(await putArchiveFile(file.name, new Blob([file.text], { type: "text/html;charset=utf-8" })));
    const text = original + markdownAssetLinks(savedFiles);
    const saved = await putArchiveFile(name, new Blob([text], { type: "text/markdown" }));
    void refreshArchive();
    toast(t`已存入卷宗：${saved.name}${files.length ? t`（附 ${files.length} 个交互作品）` : ""}`);
  } catch (error) {
    toast(t`导出失败：${String(error.message || error).slice(0, 160)}`);
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
  return t`\n## 交互可视化\n\n源码保留在正文中；下列 HTML 文件可离线打开并交互，请与本文一起保留。\n\n${files
    .map((file, index) => `${t`- [可视化 ${index + 1}](`}<${encodeURIComponent(file.name)}>)`)
    .join("\n")}\n`;
}
