// 言 · 对话引擎 · 历史：每一问送给模型的历史怎么装（附件、引文、上一答的行迹、补言）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
const HISTORY_TEXT_CHARS = 3000;
// 旧版无摘要的分隔也截断发给模型的历史；页面只折叠确有摘要的前文。
/** @param {Message[]} messages */
function lastContextIndex(messages, { withSummary = false } = {}) {
  return messages.findLastIndex(m => m.role === "context" && (!withSummary || !!m.summary));
}
function attachmentExcerpt(text, name, label, place = "") {
  const value = String(text || ""),
    at = place ? t`；本机原件：${place}` : "";
  return value.length > HISTORY_TEXT_CHARS
    ? t`\n\n--- 附件：${name}（${label}${at}，开头）---\n${value.slice(0, HISTORY_TEXT_CHARS)}\n[全文共 ${value.length} 字，此处只留开头 ${HISTORY_TEXT_CHARS} 字；其余要用时以 read_document 读取]`
    : t`\n\n--- 附件：${name}（${label}${at}）---\n${value}`;
}
/** @param {Message} message */
function quotedText(message) {
  // 游目圈点的引文另有一份写给模型的（带网址、各处的位置与字），界面上只显示短的那句
  const quote = message.quote?.model || message.quote?.text;
  if (!quote) return message.content;
  return `${quote
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join("\n")}\n\n${message.content || t("请就所引用的内容作答。")}`;
}
// 上一答动过文件、请示过、差遣过、检索翻阅过的，压成一行带给下一问：模型才记得自己读过、改过哪些文件、查到过哪几条，不必从头再探。
// 哪些步骤带、怎么写，由各工具登记的 digest 定。label 是方括号里的标头：进历史时写「上一答的行迹」（见 historyForApi），存卷宗与压缩转写里写「行迹」
// 送出过的前文不再改写：一答的行迹头一回随下一问送出时定格、记在这一答上，此后照抄。帮手、后台指令收工后签上的字会变
// （「后台进行中」→ 几步几秒、改了哪些文件），照现写的话前文中间改了一处，那里往后的提示缓存全断；它们的结果另有回报送到。
// 步数变了（续写又做了几步）才重写
/** @param {Message|SubAgent} message */
// 帮手、后台指令后来被停、中断了也重写：不会再有回报送到，不改的话此后每问都告诉模型「后台进行中」
function settledDigest(message) {
  const steps = (message.steps || []).length,
    // 「断」也算：holdHelper 收成 interrupted 的那一步，此后不会再有回报送到，
    // 不重写就永远写着「后台进行中」（见上面那两句注释）
    broken = (message.steps || []).filter(
      step => step.status === "error" || step.status === "skipped" || step.status === "interrupted"
    ).length,
    // 不会再有回报送到的终态也算：随桥接重启而止（lost）、结束得久没能留住（evicted，见 20-command.js 的 settleBackground）。
    // 摘要留着「进行中」的话，模型会照着旧编号再开一条同号的
    gone = (message.steps || []).filter(step => step.bg?.state === "lost" || step.bg?.state === "evicted").length;
  if (message.trailDigest?.steps !== steps || (message.trailDigest.broken || 0) !== broken || (message.trailDigest.gone || 0) !== gone)
    message.trailDigest = { steps, broken, gone, text: stepsDigest(message, t("上一答的行迹")) };
  return message.trailDigest.text;
}
/** @param {{ steps?: Step[] }} message 一答；帮手的一趟也一样：续派时它上一趟的行迹冠在新的活前面 */
function stepsDigest(message, label = t("行迹")) {
  // 函数式 digest 按这一答的实际情形给行（如 check_command 只有真的结束、取消才算动过手）；
  // 给空串即这一回不值得留痕，不能写成空的一行混进摘要
  const steps = (message.steps || [])
    .map(step => {
      const digest = TOOLS.get(step.name)?.digest;
      if (!digest) return "";
      return digest === true
        ? `${step.name} ${String(step.title || "").slice(0, 80)} → ${step.status === "skipped" ? t("用户跳过") : step.result || step.status}`
        : digest(step);
    })
    .filter(Boolean);
  if (!steps.length) return "";
  const items =
    steps.length > DIGEST_HEAD + DIGEST_TAIL
      ? [...steps.slice(0, DIGEST_HEAD), t`…中间 ${steps.length - DIGEST_HEAD - DIGEST_TAIL} 步从略…`, ...steps.slice(-DIGEST_TAIL)]
      : steps;
  return `［${label}］${items.join("；")}`;
}
const DIGEST_HEAD = 4,
  DIGEST_TAIL = 12;
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
// 一答怎么交给模型：正文按途中递进来的话（补言、回报、传话）到达的位置拆开，那句话由它那一步登记的 replay 写成、插回原处——
// 与作答当时递上的同一个写法（见 deliverSupplements），模型往后读到的先后与字句都与当时一样。下一问装历史、续写、压缩转写、
// 上下文计数都经这里，不各写一份：当时递得进去的，往后就重装得出来，加一种递进来的话只需在登记表里给它一个 replay。
// 若把补言折成一行冠在下一问头上，它读不出先后，会把上一答里的一句「不用了，我来」当成这一问的吩咐
/** @typedef {{ role: "assistant", content: string } | { role: "user", step: Step, entry: Promise<Record<string, any>>|Record<string, any> }} AnswerPart */
/** @param {{ content?: string, steps?: Step[] }} message 一答、帮手的一趟，或续写时那一答开工前的样子 @returns {AnswerPart[]} */
function answerParts(message, budget = inlineTextBudget()) {
  const content = String(message.content || "");
  /** @type {AnswerPart[]} */
  const parts = [];
  let from = 0;
  for (const step of message.steps || []) {
    const replay = step.status === "done" && TOOLS.get(step.name)?.replay,
      entry = replay && replay(step, { latest: false, budget });
    if (!entry) continue;
    const at = Math.min(Math.max(from, Number(step.at) || 0), content.length);
    if (content.slice(from, at).trim()) parts.push({ role: "assistant", content: content.slice(from, at).trimEnd() });
    parts.push({ role: "user", step, entry });
    from = at;
  }
  if (!parts.length) return [{ role: "assistant", content }];
  if (content.slice(from).trim()) parts.push({ role: "assistant", content: content.slice(from).trimStart() });
  return parts;
}
/** 一答装成送给接口的几条消息 @param {{ content?: string, steps?: Step[] }} message */
function answerForApi(message, budget = inlineTextBudget()) {
  return Promise.all(answerParts(message, budget).map(part => (part.role === "assistant" ? part : part.entry)));
}
// 续写只重放这一答已写的部分：途中递来的话照原位排，做过的步骤随「继续」附上。
/** @param {{ content?: string, steps?: Step[] }} message */
async function resumeForApi(message, budget = inlineTextBudget()) {
  const parts = (await answerForApi(message, budget)).filter(part => part.role !== "assistant" || part.content),
    trail = stepsDigest(message);
  if (parts.length || trail) parts.push({ role: "user", content: `${trail ? `${trail}\n\n` : ""}${prompt("assistant.resume")}` });
  return parts;
}
/** 一条消息里给模型读的字（压缩转写、计数用） */
function entryText(entry) {
  return typeof entry?.content === "string"
    ? entry.content
    : (entry?.content || [])
        .filter(part => part?.type === "text")
        .map(part => part.text)
        .join("\n\n");
}
// 补言进历史：与作答途中递给模型时同一个样子（前缀注明是途中补的）。latest：正递着的这一句，附件整份带上；往后重装历史时只带摘要
/** @param {Message} user */
async function supplementForApi(user, budget, { latest = false, steer = false } = {}) {
  const places = await attachmentPlaces(user.attachments?.length ? [user] : []),
    entry = await messageForApi(user, latest, budget, latest, places),
    prefix = prompt(steer ? "assistant.steer" : "assistant.supplement");
  if (typeof entry.content === "string") entry.content = `${prefix}${entry.content}`;
  else entry.content[0].text = `${prefix}${entry.content[0].text}`;
  return entry;
}
// 附件原件在哪：用户随问发来的文件落在存储目录的 附件/ 里，不在工作目录。只说「附件」，模型会到工作目录里去找同名文件，
// 找不到就以为没有；要拿原件（脚本处理、复制进目录）时得有个真实路径。按 id 记着，同一页同一件不必每问重问；
// 取不到的（原件还只在浏览器里）不记，桥接恢复后再问一回。
// 记的路径只对当时的存储根成立（换了位置，同一个 id 的原件搬到新根下、路径全变），换过就不算数、重新问
const attachmentPlaceCache = new Map();
/** @param {{ attachments?: Attachment[] }[]} messages @returns {Promise<Record<string, string>>} id → 本机原件的绝对路径 */
async function attachmentPlaces(messages) {
  const root = bootstrap.store?.root || "",
    ids = [...new Set(messages.flatMap(message => (message.attachments || []).map(file => file?.id).filter(Boolean)))],
    known = id => {
      const entry = attachmentPlaceCache.get(id);
      return entry && entry.root === root ? entry.path : "";
    },
    missing = ids.filter(id => !known(id));
  if (missing.length)
    try {
      // 换根途中发出的这一问作废（storeBridge 会拒），下一问按新根重问，不把旧路径留给模型
      const data = await storeBridge("/api/files/paths", { ids: missing }, AbortSignal.timeout(8000));
      for (const id of missing) if (data?.paths?.[id]) attachmentPlaceCache.set(id, { root, path: String(data.paths[id]) });
    } catch {}
  /** @type {Record<string, string>} */
  const places = {};
  for (const id of ids) {
    const at = known(id);
    if (at) places[id] = at;
  }
  return places;
}
// 一件附件写在说明里的后缀：本机原件在哪
/** @param {Record<string, string>} places @param {{ id?: string }} file */
function placeSuffix(places, file) {
  return places[file.id] ? t`；本机原件：${places[file.id]}` : "";
}
// 用户发的图只留最新的一批：这一问带着的整份送出，此前最近一回带图的那一问也还带着（「刚才那张图的左下角」才答得上），
// 再早的换成一行字。与工具交回的图同一条规矩（见 attachToolImages）；新的一批来了才换，前文不会每问都变，缓存只在那时断一回
/** @param {Message[]} source @param {string|null|undefined} current 这一问（它的附件本就整份送） */
function keptImageQuestion(source, current) {
  return source.findLast(m => m.role === "user" && m.id !== current && m.attachments?.some(file => file.kind === "image"))?.id || "";
}
// 上次压缩以来的往来装成送给接口的历史。每一答的行迹摘要不接在助手自己的话后面——那样模型会把「［行迹］…」学成自己回复的
// 格式，答末照样写一行出来；而是冠在下一问的开头，当作系统附上的记录。末尾的一答后面没有下一问时（旁注锚在一答上）才退回接在它话后
// 人把目录退回过（见 80-checkpoint.js）：退回之后的头一问同样冠一句
async function historyForApi(source, lastUserId, budget = inlineTextBudget()) {
  const history = [],
    pictured = keptImageQuestion(source, lastUserId),
    rewinds = rewindNotes(source),
    places = await attachmentPlaces(source);
  let trail = "",
    asked = "";
  for (const m of source) {
    if (m.role === "assistant") {
      history.push(...(await answerForApi(m, budget)));
      trail = settledDigest(m);
      continue;
    }
    const entry = await messageForApi(m, m.id === lastUserId, budget, m.id === lastUserId || m.id === pictured, places);
    if (m.role === "user") {
      const head = [trail, ...rewinds.filter(r => r.at > asked && r.at <= m.timestamp).map(r => r.text)].filter(Boolean).join("\n\n");
      asked = m.timestamp || asked;
      if (head) {
        if (typeof entry.content === "string") entry.content = `${head}\n\n${entry.content}`;
        else entry.content[0].text = `${head}\n\n${entry.content[0].text}`;
      }
      trail = "";
    }
    history.push(entry);
  }
  const last = history.at(-1);
  if (trail && typeof last?.content === "string") last.content = `${last.content}\n\n${trail}`.trim();
  return history;
}
/** @param {Message} message @param {boolean} [images] 图片整份送（这一问、或最近带图的那一问，见 keptImageQuestion） */
async function messageForApi(message, latest, budget = inlineTextBudget(), images = latest, places = {}) {
  if (message.role === "assistant") return { role: "assistant", content: message.content };
  if (message.role !== "user" || !message.attachments?.length)
    return { role: message.role, content: message.role === "user" ? quotedText(message) : message.content };
  // 多段内容：首段只是用户的话，附件的文字（最新一问是全文，往后是摘要与占位）另起一段，其后图片与文件原件。
  // 首段在这一问与往后各问里一字不差，缓存才接得过这一问（见 streamReply 标的缓存点）
  /** @type {Array<Record<string, any>>} */
  const content = [{ type: "text", text: quotedText(message) || t("请查看附件。") }];
  let notes = "";
  for (const metadata of message.attachments) {
    const place = places[metadata.id] || "";
    // 模型接口通常不收压缩包；原件已经落在本机，给出可用的路径，让本机工具解包。
    // 历史里的包也保留这条索引。先复制到工作目录再解压，来源在目录外时也不必放宽沙箱。
    // 没抽出正文、又大得不该整份送的文件同此：给路径，由模型用工具读
    if (fileKind(metadata.name).name === "archive") {
      if (place)
        notes += t`\n\n[压缩包：${metadata.name}；本机原件路径：${place}。用 run_command 将原件复制到工作目录，再解压到独立的临时子目录并读取；不要修改原件。]`;
      else
        try {
          const local = await bridge("/api/files/path", { id: metadata.id }, AbortSignal.timeout(8000));
          notes += t`\n\n[压缩包：${metadata.name}；本机原件路径：${local.path}。用 run_command 将原件复制到工作目录，再解压到独立的临时子目录并读取；不要修改原件。]`;
        } catch (error) {
          notes += t`\n\n[压缩包 ${metadata.name} 的本机原件暂不可用：${String(error.message || error)}]`;
        }
      continue;
    }
    // 早先消息里的图片只留一行占位，用不着原件：不必每问都把它从存储目录整份取回来。
    // 占位照实说图已不在：写「已在此前发送」，模型会当自己还看得见，问起图里的细节便凭空作答
    if (!images && metadata.kind === "image") {
      notes += t`\n\n[图片：${metadata.name}，${formatFileSize(metadata.size)}，先前发过，原图已不在上下文中${placeSuffix(places, metadata)}]`;
      continue;
    }
    // 没抽出正文的文件：往后各问只留一行，用不着原件
    const raw = metadata.kind === "file" && !metadata.extracted;
    if (raw && !latest) {
      notes += t`\n\n[${t("文件")}：${metadata.name}，${formatFileSize(metadata.size)}，先前发过，原件已不在上下文中${placeSuffix(places, metadata)}]`;
      continue;
    }
    if (raw && metadata.size > INLINE_FILE_BYTES) {
      const why = metadata.extractionError ? t`；本机没抽出正文：${metadata.extractionError}` : "";
      if (place)
        notes += t`\n\n[文件：${metadata.name}，${formatFileSize(metadata.size)}，过大未随消息附上；本机原件路径：${place}。需要时用工具读取，不要修改原件${why}]`;
      else
        try {
          const local = await bridge("/api/files/path", { id: metadata.id }, AbortSignal.timeout(8000));
          notes += t`\n\n[文件：${metadata.name}，${formatFileSize(metadata.size)}，过大未随消息附上；本机原件路径：${local.path}。需要时用工具读取，不要修改原件${why}]`;
        } catch (error) {
          notes += t`\n\n[文件 ${metadata.name} 的本机原件暂不可用：${String(error.message || error)}${why}]`;
        }
      continue;
    }
    // 图片与要整份送的文件取原件；文本、抽出正文的只取正文
    const file =
      metadata.data !== undefined
        ? metadata
        : metadata.kind === "image" || raw
          ? await getAttachment(metadata.id)
          : await getAttachmentMeta(metadata.id);
    if (!file) {
      notes += t`\n\n[附件 ${metadata.name} 的原件已找不到${placeSuffix(places, metadata)}]`;
      continue;
    }
    if (file.kind === "text") {
      notes += latest
        ? tooLongToInline(file.data, budget)
          ? t`\n\n[附件 ${file.name}：文本 ${String(file.data).length} 字，过长未随消息附上${placeSuffix(places, metadata)}；需要时用 read_document 按页或关键词读取]`
          : t`\n\n--- 附件：${file.name}${place ? t`（本机原件：${place}）` : ""} ---\n${file.data}`
        : attachmentExcerpt(file.data, file.name, t("文本"), place);
      continue;
    }
    if (file.kind !== "image" && file.extractedText) {
      notes += latest
        ? tooLongToInline(file.extractedText, budget)
          ? t`\n\n[附件 ${file.name}：本机提取文本 ${String(file.extractedText).length} 字，过长未随消息附上${placeSuffix(places, metadata)}；需要时用 read_document 按页或关键词读取]`
          : t`\n\n--- 附件：${file.name}（本机提取${place ? t`；本机原件：${place}` : ""}）---\n${file.extractedText}`
        : attachmentExcerpt(file.extractedText, file.name, t("本机提取"), place);
      continue;
    }
    if (file.kind === "image" ? !images : !latest) {
      notes += t`\n\n[${file.kind === "image" ? t("图片") : t("文件")}：${file.name}，${formatFileSize(file.size)}，先前发过，原件已不在上下文中${placeSuffix(places, metadata)}]`;
      continue;
    }
    if (file.kind === "image") {
      // 图也得写出原件路径：模型看得见图，却不知道它在哪，要把它放进生成的文档、或交给本机工具就无从下手
      if (place) notes += t`\n\n[图片：${file.name}；本机原件：${place}]`;
      content.push({ type: "image_url", image_url: { url: file.data, detail: "auto" } });
    } else {
      // 本机没抽出正文的（扫描件、解不开的图、抽取库没载入）：照实说缘何附上的是原件，模型读不出来时不会瞎猜；
      // 抽出来了也照样给它原件路径——要原样嵌进别处时，光有内容同样找不到文件
      const why = metadata.extractionError ? t`本机没抽出正文（${metadata.extractionError}），` : "";
      if (metadata.extractionError || place)
        notes += t`\n\n[附件 ${file.name}：${why}原件照发${place ? t`（本机原件：${place}）` : ""}${metadata.extractionError ? t`；读不出来就照实告诉用户` : ""}]`;
      content.push({ type: "file", file: { filename: file.name, file_data: String(file.data).replace(/^data:[^,]*,/, "") } });
    }
  }
  // 用户随问发来的文件在对话附件里，不在工作目录：说明白了，模型才不会到工作目录里找同名文件、找不到就说没有。
  // 只带图的一问也要说：图同样能当文件用（取原件、放进文档），模型不知道它在哪就只能干瞪眼
  if (latest)
    notes = t`\n\n[这一问的附件是随消息发来的（在对话附件里，不在工作目录）；要用原件就按各项的「本机原件」路径取，别改动原件]${notes}`;
  if (notes) content.splice(1, 0, { type: "text", text: notes.trimStart() });
  return { role: "user", content };
}
