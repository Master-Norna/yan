// 言 · 文件：读、写、改、列、搜、下载。绑了目录落在工作目录（执事的六件），没绑落在卷宗（言只带产出所需的读、写、列与指令）。
// 路径与沙箱在桥接那头管（server/work/）；这里只管呈现与「改之前先读过」这条规矩
const WRITTEN_KEEP_CHARS = 4000;
defineTool({
  name: "write_file",
  group: "work",
  label: t("写入"),
  offer: ctx => ctx.files,
  sideEffect: true,
  writes: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    // 没读过的：已有的文件桥接那头拦下（新建的照写），与 edit_file 同一条「改之前先读过」
    const unseen = !seenBefore(conversation, step, args.path),
      seen = seenSig(conversation, step, args.path),
      data = await bridge(
        "/api/work/write",
        { ...workScope(conversation), path: args.path, content: args.content, unseen, ...(seen ? { seen } : {}) },
        signal
      );
    step.title = data.path;
    if (data.stale)
      return {
        ok: false,
        content: prompt("work.stale", { path: data.path, who: changedBy(conversation, step, data.sig) }),
        display: "读后已被改过"
      };
    step.sig = data.sig;
    step.root = workRoot(conversation);
    noteToolWrite(conversation, data.path);
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
        ? t`${text.slice(0, WRITTEN_KEEP_CHARS)}\n…（其后 ${text.length - WRITTEN_KEEP_CHARS} 字未留存）`
        : text;
    step.written = keep(String(args.content));
    if (data.previous) step.previous = String(data.previous);
    return {
      ok: true,
      content: t`已写入 ${data.path}（${data.bytes} 字节，${data.lines} 行${data.existed ? t`，覆盖了原${data.binary ? t("有的二进制") : ""}文件` : ""}${data.converted ? t("；原文件是 GBK，已存成 UTF-8") : ""}）`,
      display: ""
    };
  }
});

defineTool({
  name: "edit_file",
  group: "work",
  label: t("修改"),
  offer: ctx => ctx.files && ctx.work,
  sideEffect: true,
  writes: true,
  html: workStepHtml,
  digest: true,
  async run(step, args, { conversation, signal }) {
    step.title = args.path;
    if (!seenBefore(conversation, step, args.path))
      return { ok: false, content: prompt("work.unread", { path: args.path }), display: "需先读取" };
    const seen = seenSig(conversation, step, args.path),
      data = await bridge(
        "/api/work/edit",
        {
          ...workScope(conversation),
          path: args.path,
          old: args.old,
          new: args.new,
          replaceAll: args.replace_all === true,
          ...(seen ? { seen } : {})
        },
        signal
      );
    step.title = data.path;
    step.root = workRoot(conversation);
    noteToolWrite(conversation, data.path);
    step.diff = { old: args.old.slice(0, 1500), new: args.new.slice(0, 1500) };
    step.sig = data.sig;
    // 读后被别人改过：这一处照改了，可文件别处的现状它没看过——这一步不算「看清了」，整份覆盖前还得重读
    if (data.drift) step.drifted = changedBy(conversation, step, data.drift);
    const counts = diffCounts(args.old, args.new);
    step.change = { path: data.path, added: counts.added * data.replaced, removed: counts.removed * data.replaced, lines: data.lines };
    return {
      ok: true,
      content: t`已修改 ${data.path}：第 ${data.line} 行起替换 ${data.replaced} 处，文件现为 ${data.lines} 行${step.drifted ? prompt("work.drift", { who: step.drifted }) : ""}`,
      display: `第 ${data.line} 行 · ${data.replaced} 处`
    };
  }
});

defineTool({
  name: "read_file",
  group: "work",
  label: t("读取"),
  offer: ctx => ctx.files,
  lookup: true,
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
    step.sig = data.sig;
    const encoding =
      data.encoding === "utf-8"
        ? ""
        : t`；文件是 ${data.encoding === "gbk" ? "GBK" : data.encoding.toUpperCase()} 编码${data.encoding === "gbk" ? t("，edit_file 改不了它") : ""}`;
    return {
      ok: true,
      content: t`${data.path}（共 ${data.totalLines} 行，此处第 ${data.offset}–${data.offset + data.shown - 1} 行${encoding}）\n${data.text}`,
      display: `${data.shown}/${data.totalLines} 行`
    };
  }
});

defineTool({
  name: "list_files",
  group: "work",
  label: t("览目录"),
  offer: ctx => ctx.files,
  lookup: true,
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
        ? `${data.entries.join("\n")}${data.truncated ? t("\n…（条目过多已截断，深处的没列全；请指定子目录）") : ""}`
        : args.pattern
          ? t`（没有匹配 ${args.pattern} 的文件）`
          : t("（空目录）"),
      display: `${data.entries.length} 项`
    };
  }
});

defineTool({
  name: "search_files",
  group: "work",
  label: t("搜索"),
  // 绑了工作目录的对话才给（旁注也给：ctx.work 在旁注里为假，看对话本身）
  offer: ctx => ctx.files && isWork(ctx.conversation),
  lookup: true,
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
    // 搜得不全的照实说：扫到文件上限、没进去的大目录。零命中时模型最容易据此断言「没有」
    const partial = [
        data.limited && t`只扫了前 ${data.limited} 个文件，其余未搜；请缩小 path 或加 glob`,
        data.skipped?.length && t`未进入 ${data.skipped.join("、")}；要搜其中的，把 path 指进去`
      ]
        .filter(Boolean)
        .join("；"),
      found = lines.length
        ? `${lines.join("\n")}${data.truncated && !data.limited ? t("\n…（结果已截断，请缩小范围或加 glob）") : ""}${partial ? `\n（${partial}）` : ""}`
        : t`扫描的 ${data.scanned} 个文件里未找到匹配「${args.query}」的内容${partial ? `（${partial}）` : ""}`;
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
  label: t("下载"),
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
    noteToolWrite(conversation, data.path);
    step.change = { path: data.path, added: 0, removed: 0, created: true }; // 计入这一答的改动摘要
    return {
      ok: true,
      content: t`已存为 ${data.path}（${formatFileSize(data.bytes)}${data.type ? `，${data.type}` : ""}）`,
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
  // 账本每一问都附着（见 ledgerNote）：附的是全文，主模型不必再读一遍才能改；截过的不算，没看到的后半截不能被一笔覆盖掉
  if (
    !step.scope &&
    ledgers.get(conversation.id) &&
    !ledgersCut.has(conversation.id) &&
    seenPath(conversation, file) === seenPath(conversation, LEDGER_PATH)
  )
    return true;
  return !!lastSeen(conversation, step, file);
}
// 同一人（主模型，或某名帮手）最后一回读、写、改这个文件的那一步：各人的步骤在对话里本就按先后排
/** @param {Conversation} conversation @param {Step} step */
function lastSeen(conversation, step, file) {
  const root = workRoot(conversation),
    wanted = seenPath(conversation, file);
  return (
    conversation.messages
      .flatMap(message => allSteps(message))
      .findLast(
        seen =>
          seen !== step &&
          SEEING_TOOLS.has(seen.name) &&
          seen.status === "done" &&
          (seen.scope || "") === (step.scope || "") &&
          (!seen.root || seen.root === root) &&
          seenPath(conversation, seen.title) === wanted
      ) || null
  );
}
// 主模型写、改账本时带的指纹：这一答里亲手读写过的以那一步为准，没有的以开工时附上的那份为准——
// 附上的就算它读过（见 seenBefore），读后别的对话又改了账本，整份写回前得认得出来。不是账本的回 null
/** @param {Conversation} conversation @param {Step} step @returns {string | null} */
function ledgerSig(conversation, step, file) {
  const ledger = ledgers.get(conversation.id);
  if (step.scope || !ledger || seenPath(conversation, file) !== seenPath(conversation, LEDGER_PATH)) return null;
  const answer = conversation.messages.find(message => allSteps(message).includes(step)),
    here = lastSeen(conversation, step, file);
  if (here && answer && allSteps(answer).includes(here)) return here.drifted ? "stale" : here.sig || "";
  return ledger.sig;
}
// 那一步见到的文件指纹，写、改时带给桥接比对：读后被别人改过就知道。读后被改、只照原文改了一处的，别处它没看过，记作对不上的一枚；
// 早先没记指纹的步骤不比
/** @param {Conversation} conversation @param {Step} step */
function seenSig(conversation, step, file) {
  const ledger = ledgerSig(conversation, step, file);
  if (ledger !== null) return ledger;
  const last = lastSeen(conversation, step, file);
  return last?.drifted ? "stale" : last?.sig || "";
}
// 读后改了这个文件的是谁：按改后的指纹在各人的写、改里找；自己读后被改、只照原文改了一处的，记着当时是谁
/** @param {Conversation} conversation @param {Step} step @param {string} sig 文件现在（或被改后）的指纹 */
function changedBy(conversation, step, sig) {
  const mine = step.scope || "",
    steps = conversation.messages.flatMap(message => allSteps(message)),
    by = steps.findLast(s => s.sig === sig && (s.name === "write_file" || s.name === "edit_file") && (s.scope || "") !== mine);
  if (!by) return lastSeen(conversation, step, step.title)?.drifted || t("别处（指令、编辑器或别的对话）");
  if (!by.scope) return t("主对话");
  const helper = steps.find(s => s.sub?.id === by.scope);
  return t`帮手「${helper?.title || "?"}」`;
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
      ).catch(error => toast(t`卷宗目录不可用：${String(error.message || error)}`));
    return true;
  }
  if (activeProfile()?.tools === false) {
    toast(t("当前模型已关闭本机工具，请在模型高级配置中开启"));
    return false;
  }
  try {
    const prepared = await bridge("/api/work/prepare", { workdir: conversation.workdir }, AbortSignal.timeout(8000));
    if (prepared.created) toast(t("工作目录不存在，已新建"));
    conversation.workdir = prepared.workdir;
  } catch (error) {
    toast(bridgeTimedOut(error) ? t("本机桥接响应超时，未能寄出，文字仍在输入框") : t`工作目录不可用：${String(error.message || error)}`);
    return false;
  }
  return true;
}
// 账本：跨多答的长活，任务活在目录里、不活在哪一段对话里——目录下 .yan/账本.md 由主模型自己立、自己维护，
// 只记对这件工程持续有约束、又不是一条结论的（约束与取舍、做法与环境上的要点），旧的随手淘汰；结论、进展与走不通的路归意（见 src/19-intent/）。
// 每一答开工时读一回，附在这一问之后（见 ledgerNote 与 streamReply）：压缩了、被回报叫醒另起一答、换一段对话接着做，看到的都是同一份。
// 附在问上而不进系统提示：账本改了也不冲掉前面的缓存。没有这个文件就什么都不附。
// 账本记多少不设上限——有的活真要记很多；限的只是每一问附多少：随模型窗口走，取附件那把尺子的一半（它每一问都附）。
// 超出就附开头一段并写明其余用 read_file 看——所以账本是索引：常看的写在前面，细的记录（实验数据、长清单）另立 .yan/ 下的文件、账本里留一行指向它
const LEDGER_PATH = ".yan/账本.md";
/** @type {Map<string, { text: string, lines: number, partial: boolean, sig: string }>} 主答附上的账本，按对话：每一答开工时读（帮手领命时现读的那份不进这里）。
 * text 是读到的那截，lines 是整份的行数；partial：读接口一回给得有限，长账本只拿到了前面；sig 是读时的指纹 */
const ledgers = new Map();
/** @type {Set<string>} 上回附上去的账本被截过的对话：截过就不算读过全文，改它得先读 */
const ledgersCut = new Set();
/** 每一问附多少账本（token） @param {Profile|null} profile */
function ledgerBudget(profile) {
  return Math.floor(inlineTextBudget(profile || activeProfile()) / 2);
}
// 帮手领命时现读的那份只交给帮手（role 为 sub）：主答没看过它，记进 ledgers 就等于替主答认了新版的指纹，读后被改也写得回去
/** @param {Conversation} conversation @param {AbortSignal} [signal] @param {"main"|"sub"} [role] */
async function loadLedger(conversation, signal, role = "main") {
  if (!isWork(conversation)) {
    if (role === "main") ledgers.delete(conversation.id);
    return null;
  }
  const data = await bridge("/api/work/read", { ...workScope(conversation), path: LEDGER_PATH, limit: 2000 }, signal).catch(() => null);
  const raw = String(data?.text || ""),
    clip = /\n…（内容过长已截断[^\n]*$/,
    text = raw
      .replace(clip, "")
      .replace(/^ *\d+\| /gm, "")
      .trimEnd();
  const ledger = text.trim()
    ? {
        text,
        lines: Number(data.totalLines) || text.split("\n").length,
        partial: clip.test(raw) || Number(data.shown) < Number(data.totalLines),
        sig: String(data.sig || "")
      }
    : null;
  if (role === "main") ledger ? ledgers.set(conversation.id, ledger) : ledgers.delete(conversation.id);
  return ledger;
}
// 附在这一问之后的一段；帮手的是只读的一份（账本只由主对话写，星形）
/**
 * @param {Conversation} conversation @param {"main"|"sub"} role @param {Profile|null} [profile]
 * @param {{ text: string, lines: number, partial: boolean, sig: string } | null} [ledger] 帮手的那份由领命时现读传进来
 */
function ledgerNote(conversation, role = "main", profile = null, ledger = ledgers.get(conversation.id)) {
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
