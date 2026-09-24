// 言 · 文件：读、写、改、列、搜、下载。绑了目录落在工作目录（执事的六件），没绑落在卷宗（言只带产出所需的读、写、列与指令）。
// 路径与沙箱在桥接那头管（server/work.js）；这里只管呈现与「改之前先读过」这条规矩
defineTool({
  name: "write_file",
  group: "work",
  label: "写入",
  offer: ctx => ctx.files,
  sideEffect: true,
  writes: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    const data = await bridge("/api/work/write", { ...workScope(conversation), path: args.path, content: args.content }, signal);
    step.title = data.path;
    markSeen(conversation, data.path, step);
    step.note = `${data.lines} 行 · ${formatFileSize(data.bytes)}${data.existed ? " · 覆盖" : ""}`;
    step.change = { path: data.path, added: data.lines, removed: data.existed ? data.previousLines : 0, created: !data.existed };
    return {
      ok: true,
      content: `已写入 ${data.path}（${data.bytes} 字节，${data.lines} 行${data.existed ? "，覆盖了原文件" : ""}）`,
      display: data.existed ? "已覆盖" : "已写入"
    };
  }
});

defineTool({
  name: "edit_file",
  group: "work",
  label: "修改",
  offer: ctx => ctx.files && ctx.work,
  sideEffect: true,
  writes: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    step.title = args.path;
    if (!workSeen.get(seenKey(conversation, step))?.has(seenPath(conversation, args.path)))
      return { ok: false, content: prompt("work.unread", { path: args.path }), display: "需先读取" };
    const data = await bridge(
      "/api/work/edit",
      { ...workScope(conversation), path: args.path, old: args.old, new: args.new, replaceAll: args.replace_all === true },
      signal
    );
    step.title = data.path;
    step.diff = { old: args.old.slice(0, 1500), new: args.new.slice(0, 1500) };
    const counts = diffCounts(args.old, args.new);
    step.change = { path: data.path, added: counts.added * data.replaced, removed: counts.removed * data.replaced };
    return {
      ok: true,
      content: `已修改 ${data.path}：第 ${data.line} 行起替换 ${data.replaced} 处，文件现为 ${data.lines} 行`,
      display: `第 ${data.line} 行 · ${data.replaced} 处`
    };
  }
});

defineTool({
  name: "read_file",
  group: "work",
  label: "读取",
  offer: ctx => ctx.files,
  parallel: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    step.title = args.path;
    const data = await bridge(
      "/api/work/read",
      { ...workScope(conversation), path: args.path, offset: args.offset, limit: args.limit },
      signal
    );
    step.title = data.path;
    markSeen(conversation, data.path, step);
    const encoding =
      data.encoding === "utf-8"
        ? ""
        : `；文件是 ${data.encoding === "gbk" ? "GBK" : data.encoding.toUpperCase()} 编码${data.encoding === "gbk" ? "，edit_file 改不了它" : ""}`;
    return {
      ok: true,
      content: `${data.path}（共 ${data.totalLines} 行，此处第 ${data.offset}–${data.offset + data.shown - 1} 行${encoding}）\n${data.text}`,
      display: `${data.shown}/${data.totalLines} 行`
    };
  }
});

defineTool({
  name: "list_files",
  group: "work",
  label: "列目录",
  offer: ctx => ctx.files,
  parallel: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    const pattern = args.pattern ? ` · ${args.pattern}` : "";
    step.title = `${args.path || "."}${pattern}`;
    const data = await bridge(
      "/api/work/list",
      { ...workScope(conversation), path: args.path, depth: args.depth, pattern: args.pattern },
      signal
    );
    step.title = `${data.path}${pattern}`;
    step.output = trimOutput(data.entries.join("\n"));
    return {
      ok: true,
      content: data.entries.length
        ? `${data.entries.join("\n")}${data.truncated ? "\n…（条目过多已截断，请指定子目录）" : ""}`
        : "（空目录）",
      display: `${data.entries.length} 项`
    };
  }
});

defineTool({
  name: "search_files",
  group: "work",
  label: "搜索",
  offer: ctx => ctx.files && ctx.work,
  parallel: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    step.title = args.query;
    const data = await bridge(
      "/api/work/search",
      {
        ...workScope(conversation),
        query: args.query,
        path: args.path,
        glob: args.glob,
        literal: args.literal === true,
        limit: args.limit
      },
      signal
    );
    const lines = data.matches.map(match => `${match.file}:${match.line}: ${match.text}`);
    step.output = trimOutput(lines.join("\n"));
    step.note = lines.length ? "" : "无匹配";
    return {
      ok: true,
      content: lines.length
        ? `${lines.join("\n")}${data.truncated ? "\n…（结果已截断，请缩小范围或加 glob）" : ""}`
        : `未找到匹配「${args.query}」的内容（扫描了 ${data.scanned} 个文件）`,
      display: `${lines.length} 处 · ${data.files} 文件`
    };
  }
});

// 下载：桥接把网上的文件存进工作目录或卷宗，沙箱照常管路径
defineTool({
  name: "download_file",
  group: "web",
  label: "下载",
  offer: ctx => ctx.files,
  sideEffect: true,
  writes: true,
  digest: true,
  async run(step, args, { conversation, signal }) {
    const url = args.url.trim();
    step.url = url;
    step.title = args.path?.trim() || url.split("/").pop() || url;
    const data = await bridge("/api/work/download", { ...workScope(conversation), url, path: args.path }, signal);
    step.title = data.path;
    step.note = url;
    step.change = { path: data.path, added: 0, removed: 0, created: true }; // 计入这一答的改动摘要
    return {
      ok: true,
      content: `已存为 ${data.path}（${formatFileSize(data.bytes)}${data.type ? `，${data.type}` : ""}）`,
      display: formatFileSize(data.bytes)
    };
  }
});

// 本段对话里读过或写过的文件才允许 edit_file：模型必须对着真实内容改，而不是凭记忆猜。
// 帮手另记一份（按步骤上的 scope 分开）：主模型没亲眼读过帮手改过的文件，要改就得再读一遍，帮手亦然
const workSeen = new Map();
// 键里带上目录：对话中途换了目录，之前读过的文件不算数
/**
 * @param {Conversation} conversation
 * @param {Step} step
 */
function seenKey(conversation, step) {
  const base = `${conversation.id}@${workRoot(conversation)}`;
  return step?.scope ? `${base}/${step.scope}` : base;
}
/**
 * @param {Conversation} conversation
 * @param {Step} step
 */
function markSeen(conversation, file, step = null) {
  const key = seenKey(conversation, step);
  if (!workSeen.has(key)) workSeen.set(key, new Set());
  workSeen.get(key).add(seenPath(conversation, file));
}
// 「读过没有」按同一个文件认：读时写相对路径、改时写完整路径，或 Windows 上大小写不同，都是同一个文件
/** @param {Conversation} conversation */
function seenPath(conversation, file) {
  const win = (bootstrap.work?.platform || "win32") === "win32",
    fold = text => (win ? text.toLowerCase() : text),
    value = normalizeWorkPath(file),
    root = normalizeWorkPath(workRoot(conversation));
  return fold(root && fold(value).startsWith(`${fold(root)}/`) ? value.slice(root.length + 1) : value);
}
function normalizeWorkPath(file) {
  const parts = [];
  for (const part of String(file || "")
    .replace(/\\/g, "/")
    .split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
// 每次发送前把工具的落脚目录备好。行：桥接必须在线、工作目录仍在（被删了就重建），否则不发；
// 言：桥接在线就顺手把卷宗目录备好，备不好也照常聊（工具用到时自会报错）
/** @param {Conversation} conversation */
async function ensureWorkReady(conversation) {
  if (!isWork(conversation)) {
    const archive = workRoot(conversation);
    // 备的是草稿目录，卷宗根随之建好
    if (archive && activeProfile()?.tools !== false)
      await bridge(
        "/api/work/prepare",
        { workdir: `${archive}${archive.includes("/") && !archive.includes("\\") ? "/" : "\\"}${scratchRel(conversation)}` },
        AbortSignal.timeout(8000)
      ).catch(error => toast(`卷宗目录不可用：${String(error.message || error)}`));
    return true;
  }
  if (activeProfile()?.tools === false) {
    toast("当前模型已关闭本机工具，请在模型高级配置中开启");
    return false;
  }
  if (apiBase === null && !(await ensureLocalBridge())) {
    toast("执事需要本机桥接，请先运行 start.cmd");
    return false;
  }
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: conversation.workdir }, AbortSignal.timeout(8000));
    if (prepared.created) toast("工作目录不存在，已新建");
    conversation.workdir = prepared.workdir;
  } catch (error) {
    toast(`工作目录不可用：${String(error.message || error)}`);
    return false;
  }
  return true;
}
