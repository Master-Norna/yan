// 言 · 文件：读、写、改、列、搜、下载。绑了目录落在工作目录（执事的六件），没绑落在卷宗（言只带产出所需的读、写、列与指令）。
// 路径与沙箱在桥接那头管（server/work/）；这里只管呈现与「改之前先读过」这条规矩
const WRITTEN_KEEP_CHARS = 4000;
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
    step.root = workRoot(conversation);
    step.note = `${data.lines} 行 · ${formatFileSize(data.bytes)}${data.existed ? " · 覆盖" : ""}`;
    // 覆盖时的增删由桥接按前后两版逐行比出（旧桥接只给原有行数，退回整删整增）；lines 是写后这件的行数，新建的件按它算净增
    step.change = {
      path: data.path,
      added: data.added ?? data.lines,
      removed: data.removed ?? (data.existed ? data.previousLines : 0),
      created: !data.existed,
      lines: data.lines
    };
    // 写下的内容与覆盖掉的原文各留一份给改动清单点开看（见 changeDiffHtml）；太长只留开头，免得对话记录跟着胖
    const keep = text =>
      text.length > WRITTEN_KEEP_CHARS
        ? `${text.slice(0, WRITTEN_KEEP_CHARS)}\n…（其后 ${text.length - WRITTEN_KEEP_CHARS} 字未留存）`
        : text;
    step.written = keep(String(args.content));
    if (data.previous) step.previous = String(data.previous);
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
    if (!seenBefore(conversation, step, args.path))
      return { ok: false, content: prompt("work.unread", { path: args.path }), display: "需先读取" };
    const data = await bridge(
      "/api/work/edit",
      { ...workScope(conversation), path: args.path, old: args.old, new: args.new, replaceAll: args.replace_all === true },
      signal
    );
    step.title = data.path;
    step.root = workRoot(conversation);
    step.diff = { old: args.old.slice(0, 1500), new: args.new.slice(0, 1500) };
    const counts = diffCounts(args.old, args.new);
    step.change = { path: data.path, added: counts.added * data.replaced, removed: counts.removed * data.replaced, lines: data.lines };
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
    step.root = workRoot(conversation);
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
    // 桥接替模型圆过的（正则写不成，按字面搜了）：说在结果前头
    step.note = data.note || (lines.length ? "" : "无匹配");
    const found = lines.length
      ? `${lines.join("\n")}${data.truncated ? "\n…（结果已截断，请缩小范围或加 glob）" : ""}`
      : `未找到匹配「${args.query}」的内容（扫描了 ${data.scanned} 个文件）`;
    return {
      ok: true,
      content: data.note ? `（${data.note}）\n${found}` : found,
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
// 「读过」不另记一张表，就看这段对话里做完的读、写、改：刷新页面也不丢，与模型自己的历史一致。
// 帮手各算各的（按步骤上的 scope 分开）：主模型没亲眼读过帮手改过的文件，要改就得再读一遍，帮手亦然；
// 对话中途换了目录，之前那个目录里读过的不算数（步骤记着它落在哪个目录，早先没记的照算）
const SEEING_TOOLS = new Set(["read_file", "write_file", "edit_file"]);
/**
 * @param {Conversation} conversation
 * @param {Step} step 正要改的这一步
 */
function seenBefore(conversation, step, file) {
  const root = workRoot(conversation),
    wanted = seenPath(conversation, file);
  // 账本每一问都附着（见 ledgerNote）：附的是全文，主模型不必再读一遍才能改；截过的不算，没看到的后半截不能被一笔覆盖掉
  if (!step.scope && ledgers.get(conversation.id) && !ledgersCut.has(conversation.id) && wanted === seenPath(conversation, LEDGER_PATH))
    return true;
  return conversation.messages.some(message =>
    allSteps(message).some(
      seen =>
        seen !== step &&
        SEEING_TOOLS.has(seen.name) &&
        seen.status === "done" &&
        (seen.scope || "") === (step.scope || "") &&
        (!seen.root || seen.root === root) &&
        seenPath(conversation, seen.title) === wanted
    )
  );
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
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: conversation.workdir }, AbortSignal.timeout(8000));
    if (prepared.created) toast("工作目录不存在，已新建");
    conversation.workdir = prepared.workdir;
  } catch (error) {
    toast(bridgeTimedOut(error) ? "本机桥接响应超时，消息未发送，文字仍在输入框" : `工作目录不可用：${String(error.message || error)}`);
    return false;
  }
  return true;
}
// 账本：跨多答的长活，任务活在目录里、不活在哪一段对话里——目录下 .yan/账本.md 由主模型自己立、自己维护，
// 只记对这件工程持续有约束的（目标与达标标准、约束与取舍、计划与进展、走不通的路），旧的随手淘汰。
// 每一答开工时读一回，附在这一问之后（见 ledgerNote 与 streamReply）：压缩了、被回报叫醒另起一答、换一段对话接着做，看到的都是同一份。
// 附在问上而不进系统提示：账本改了也不冲掉前面的缓存。没有这个文件就什么都不附。
// 账本记多少不设上限——有的活真要记很多；限的只是每一问附多少：随模型窗口走，取附件那把尺子的一半（它每一问都附）。
// 超出就附开头一段并写明其余用 read_file 看——所以账本是索引：常看的写在前面，细的记录（实验数据、长清单）另立 .yan/ 下的文件、账本里留一行指向它
const LEDGER_PATH = ".yan/账本.md";
/** @type {Map<string, { text: string, lines: number, partial: boolean }>} 最近读到的账本，按对话：每一答开工时读，差遣帮手时再现读一回。
 * text 是读到的那截，lines 是整份的行数；partial：读接口一回给得有限，长账本只拿到了前面 */
const ledgers = new Map();
/** @type {Set<string>} 上回附上去的账本被截过的对话：截过就不算读过全文，改它得先读 */
const ledgersCut = new Set();
/** 每一问附多少账本（token） @param {Profile|null} profile */
function ledgerBudget(profile) {
  return Math.floor(inlineTextBudget(profile || activeProfile()) / 2);
}
/** @param {Conversation} conversation */
async function loadLedger(conversation, signal) {
  if (!isWork(conversation)) return void ledgers.delete(conversation.id);
  const data = await bridge("/api/work/read", { ...workScope(conversation), path: LEDGER_PATH, limit: 2000 }, signal).catch(() => null);
  const raw = String(data?.text || ""),
    clip = /\n…（内容过长已截断[^\n]*$/,
    text = raw
      .replace(clip, "")
      .replace(/^ *\d+\| /gm, "")
      .trimEnd();
  if (text.trim())
    ledgers.set(conversation.id, {
      text,
      lines: Number(data.totalLines) || text.split("\n").length,
      partial: clip.test(raw) || Number(data.shown) < Number(data.totalLines)
    });
  else ledgers.delete(conversation.id);
}
// 附在这一问之后的一段；帮手的是只读的一份（账本只由主对话写，星形）
/** @param {Conversation} conversation @param {"main"|"sub"} role @param {Profile|null} [profile] */
function ledgerNote(conversation, role = "main", profile = null) {
  const ledger = ledgers.get(conversation.id);
  if (!ledger) return "";
  const { text, lines, partial } = ledger,
    tokens = estimateText(text),
    budget = ledgerBudget(profile);
  let shown = text;
  if (tokens > budget) {
    // 按 token 比例截到预算内，落在行尾
    const at = Math.floor((text.length * budget) / tokens),
      end = text.lastIndexOf("\n", at);
    shown = text.slice(0, end > 0 ? end : at);
  }
  const shownLines = shown.split("\n").length,
    cut = partial || shown.length < text.length;
  if (role === "main") cut ? ledgersCut.add(conversation.id) : ledgersCut.delete(conversation.id);
  return `${prompt(role === "main" ? "work.ledgerHead" : "work.ledgerSub", { path: LEDGER_PATH, text: shown })}${cut ? `\n${prompt("work.ledgerCut", { lines, shown: shownLines })}` : ""}\n\n`;
}
