// 言 · 翻阅文档：对话附件，以及磁盘卷宗里的文本与 Office / PDF——后者用到时才取回并抽正文；技能的说明与附属文件也从这里翻（见 42-skills.js）。
// 长文档按页码或关键词只取片段。说明里（{{docs}}）只列这段对话的附件：卷宗会越攒越多，整份目录写进说明，每一问都得背着；
// 卷宗里的按文件名或路径找，不知道有什么就 name 留空，列给它看。技能的目录在系统提示里（skills.hint）：不知道有它，模型想不到去翻。
// 对话里有附件、卷宗里有可读的文档、或认得技能时才给
defineTool({
  name: "read_document",
  group: "docs",
  label: t("翻阅文档"),
  offer: ctx => ctx.docs.length > 0,
  vars: ctx => {
    const attached = ctx.docs.filter(d => !d.archive && d.kind !== "skill").map(d => d.name);
    return { docs: attached.length ? t`本段附件：${attached.join("、")}。` : "" };
  },
  lookup: true,
  parallel: true,
  cache: args => ({
    ...args,
    name: String(args.name || "")
      .trim()
      .toLowerCase(),
    query: args.query?.trim().toLowerCase()
  }),
  async run(step, args, { conversation }) {
    const docs = availableDocuments(conversation),
      wanted = String(args.name || "")
        .trim()
        .replace(/\\/g, "/")
        .toLowerCase();
    if (!wanted) return documentList(step, docs);
    // 技能的 SKILL.md 凭技能名即可找到
    const keys = d => [d.name, d.archive, d.main && d.skill].filter(Boolean).map(key => String(key).toLowerCase());
    // 同名有几件（附件里三个 README.md、卷宗两层各一份 config.json）：给了卷宗路径的照路径取；没给的取最近发来的那件，
    // 并在步骤上写明读的是哪一件——以前按名字去重，同名的后一件根本进不了这张表，给路径也找不到
    const exact = docs.filter(d => keys(d).includes(wanted)),
      byPath = exact.find(d => d.archive && String(d.archive).toLowerCase() === wanted),
      doc =
        byPath ||
        exact.filter(d => d.id).at(-1) ||
        exact.at(-1) ||
        docs.find(d => keys(d).some(key => key.includes(wanted))) ||
        (docs.length === 1 ? docs[0] : null);
    if (!doc) {
      const listed = documentList(step, docs);
      return { ok: false, content: t`未找到文档「${args.name}」。${listed.content}`, display: "未找到" };
    }
    // 翻技能的一步标作「Skill」，题写技能名（附属文件写全名）
    if (doc.skill) step.label = "Skill";
    step.title = doc.main ? doc.skill : doc.name;
    const sameNote =
      exact.length > 1 && !byPath
        ? t`同名 ${exact.length} 件，读的是${doc.archive ? t`卷宗里的 ${doc.archive}` : doc.skill ? t`技能「${doc.skill}」` : t("最近发来的那件附件")}`
        : "";
    // 同名的说明跟着这一次的结果走（页码、命中数照样写在后面）
    const noted = value => (sameNote ? `${sameNote}\n\n${value}` : value),
      noteOf = value => [sameNote, value].filter(Boolean).join(" · ");
    let text = "",
      headNote = "";
    if (doc.archive) {
      try {
        // 没问页码、也没检索，就只取开头（纯文本按 Range 取一段，Office/PDF 仍整份抽）
        const got = await archiveDocumentText(doc, !args.page && !args.query);
        text = got.text;
        headNote = got.head;
      } catch (error) {
        return { ok: false, content: t`卷宗文档读取失败：${String(error.message || error).slice(0, 120)}`, display: "读取失败" };
      }
    } else if (doc.kind === "skill") {
      // 认 kind 不认 skill：点名置入的那件附件也带 skill（附件条画锦囊用），它的字在浏览器里，不在技能目录
      try {
        text = await skillDocumentText(doc);
      } catch (error) {
        return { ok: false, content: t`技能文件读取失败：${String(error.message || error).slice(0, 120)}`, display: "读取失败" };
      }
    } else {
      const record = await getAttachmentMeta(doc.id);
      text = record ? (record.kind === "text" ? record.data : record.extractedText) || "" : "";
    }
    if (!text) return { ok: false, content: t("该文档无可读取的文本"), display: "无文本" };
    const kind = fileKind(doc.name),
      pages = splitPages(text, kind.extract === "pdf" ? "pdf" : kind.name === "slides" ? "slide" : "plain"),
      pageCount = pages.length;
    if (args.page) {
      const page = pages.find(p => p.page === Number(args.page));
      if (!page) return { ok: false, content: t`没有第 ${args.page} 页，共 ${pageCount || 1} 页`, display: "页码超出" };
      step.note = noteOf(`第 ${args.page} 页`);
      return { ok: true, content: noted(page.text.slice(0, 20000)), display: `第 ${args.page} 页 · ${page.text.length} 字` };
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
      step.note = noteOf(`关键词「${args.query}」`);
      return hits.length
        ? { ok: true, content: noted(hits.map((hit, i) => t`片段 ${i + 1}：…${hit}…`).join("\n\n")), display: `${hits.length} 处匹配` }
        : { ok: true, content: noted(t`全文未出现「${args.query}」`), display: "无匹配" };
    }
    // 技能的说明与参考是写给模型照做的，截了后半便照不全（长的有三万来字）；按页码翻对 md 也无从说起
    const limit = doc.skill ? 60000 : 12000;
    step.note = noteOf(`${text.length} 字${pageCount ? ` · ${pageCount} 页` : ""}`);
    return {
      ok: true,
      content: noted(
        // 只取了开头的那份：字数只算开头这一截，别报成全文；「要其余部分」也只说 query——
        // 纯文本没有「第 n 页」，让它去翻页是条走不通的路
        headNote
          ? t`${text.slice(0, limit)}\n\n[这里只是开头：${headNote}；要其余部分，用 query 检索某个词即可]`
          : text.length > limit
            ? t`${text.slice(0, limit)}\n\n[文档共 ${text.length} 字${pageCount ? t`、${pageCount} 页` : ""}，此处只给出开头；可用 page 或 query 参数读取其余部分]`
            : text
      ),
      display: `${Math.min(text.length, limit)} 字`
    };
  }
});
// name 留空（或没找到）时列给模型：附件在前，技能的文件其次，卷宗里的按新近排，带路径与大小；太多只列最近的。
// 只凭点名的技能不列（同系统提示里的目录）：人点了名，说明已作附件附上，里头提到的件凭「技能名/路径」照样翻得到
const DOCUMENT_LIST_LIMIT = 60;
/** @param {Step} step */
function documentList(step, docs) {
  const attached = docs.filter(d => !d.archive && d.kind !== "skill"),
    skills = docs.filter(d => d.kind === "skill" && !d.manual),
    archived = docs.filter(d => d.archive).sort((a, b) => new Date(b.modifiedAt || 0).getTime() - new Date(a.modifiedAt || 0).getTime());
  step.title ||= t("可读文档");
  // 同名的标上大小，模型与人都分得清是哪一件（名字一样的两件，光看名字没法指）
  const count = new Map();
  for (const d of attached) count.set(d.name, (count.get(d.name) || 0) + 1);
  const lines = [
    ...attached.map(d => t`附件 ${d.name}${count.get(d.name) > 1 ? `（${formatFileSize(d.size || 0)}）` : ""}`),
    ...skills.slice(0, DOCUMENT_LIST_LIMIT).map(d => t`技能 ${d.name}`),
    ...archived.slice(0, DOCUMENT_LIST_LIMIT).map(d => t`卷宗 ${d.archive}（${formatFileSize(d.size || 0)}）`)
  ];
  const more =
    archived.length > DOCUMENT_LIST_LIMIT ? t`\n…卷宗里另有 ${archived.length - DOCUMENT_LIST_LIMIT} 件较早的，按文件名找即可` : "";
  return {
    ok: true,
    content: lines.length ? t`可读文档（name 给文件名或卷宗路径）：\n${lines.join("\n")}${more}` : t("没有可读的文档"),
    display: `${docs.length} 件`
  };
}
/** @param {Conversation} conversation */
function availableDocuments(conversation) {
  // 按 id、按卷宗路径去重：按名字去重会把同名的后一件整个吞掉（附件里三个 README.md 只留一个，卷宗里同名的也进不来），
  // 模型拿到路径也搜不着
  /** @type {any[]} */
  const docs = [],
    seen = new Set();
  for (const file of (conversation?.messages || []).flatMap(m => m.attachments || []))
    if (file.id && !seen.has(`att:${file.id}`) && (file.kind === "text" || (file.kind === "file" && file.extracted))) {
      seen.add(`att:${file.id}`);
      docs.push(file);
    }
  for (const entry of archiveEntries || []) {
    if (seen.has(`arc:${entry.path}`) || !(fileKind(entry.name).extract || isTextFile({ name: entry.name, type: "" }))) continue;
    seen.add(`arc:${entry.path}`);
    docs.push({ name: entry.name, archive: entry.path, size: entry.size, modifiedAt: entry.modifiedAt, kind: "archive" });
  }
  for (const doc of skillDocuments())
    if (!seen.has(`skill:${doc.name}`)) {
      seen.add(`skill:${doc.name}`);
      docs.push(doc);
    }
  return docs;
}
// 磁盘卷宗里的文档：取回原件，文本直接用，PDF / Office 在本机抽正文；按路径与修改时间缓存几份。
// 只读开头（没给页码、也没检索）时，纯文本只取前 256 KB——几百 MB 的日志不必整份拉回来；要翻页或检索才取全。
// 回的是 { text, head }：head 记「原件多大、这里只取了开头」，由调用方放在截字说明里——
// 贴在正文末尾没用，几百 KB 的正文本来就要截到一万二千字，末尾那句永远到不了模型眼前
const ARCHIVE_HEAD_BYTES = 256 * 1024,
  archiveDocCache = new Map();
/** @returns {Promise<{ text: string, head: string }>} */
async function archiveDocumentText(doc, head = false) {
  const isText = isTextFile({ name: doc.name, type: "" }),
    key = `${doc.archive}|${doc.modifiedAt}${head && isText ? "|head" : ""}`;
  if (archiveDocCache.has(key)) return archiveDocCache.get(key);
  const response = await fetch(localFileUrl(archiveFile(doc.archive)), {
    headers: head && isText ? { Range: `bytes=0-${ARCHIVE_HEAD_BYTES - 1}` } : {},
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw Error(t("取回失败"));
  const blob = await response.blob(),
    keep = value => {
      archiveDocCache.set(key, value);
      if (archiveDocCache.size > 12) archiveDocCache.delete(archiveDocCache.keys().next().value);
      return value;
    };
  if (isText) {
    const bytes = new Uint8Array(await blob.arrayBuffer()),
      // Content-Range 报的整份有多大；没这道头（服务器不认 Range）就是取全了
      total = Number(/\/(\d+)\s*$/.exec(response.headers.get("content-range") || "")?.[1] || 0),
      cut = total > bytes.length,
      // 只取了一截、又截在半个字上：末尾那半个字不算。先按 UTF-8 退掉没写完的几个字节，再收掉解不出的替换字符
      // （GB18030 的半个字落在末尾会解成 U+FFFD）。不退这一步，fatal 的 UTF-8 整体解不开，一落就是满屏乱码
      body = cut ? decodeTextBytes(trimIncomplete(bytes)).replace(/\uFFFD+$/, "") : decodeTextBytes(bytes);
    return keep({ text: body, head: cut ? t`原件 ${formatFileSize(total)}，这里只取了开头 ${formatFileSize(bytes.length)}` : "" });
  }
  return keep({ text: await extractDocumentText(doc.name, blob), head: "" });
}
