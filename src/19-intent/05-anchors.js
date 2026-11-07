// 言 · 意 · 凭据：一项成立凭的是什么。一种凭据一份登记：怎么规整写法、多久取一回指纹、怎么取、怎么说给人听、罩不罩得住某个改过的文件。
// 程序只比指纹变没变，不判对错——变了，凭它成立（或凭它假定）的那项就转待复核，由模型再判。先例：需求追溯的「可疑链接」
// （记下链接时上游的哈希，上游一变即可疑，复核后清除）、构建系统 Shake 的 oracle（外部状态每回问一遍，答案没变就不往上传）。
// 现有四种，由弱到强：文件（模型本就知道哪些文件要紧）、目录（整片，新增删除也算）、探针（一条指令的输出——部署、服务、依赖版本这类
// 外部状态与事件也罩得住）、测试（一条指令过没过）。往后可加符号、时效……加一种只加一份登记，写法随之出现在 anchors 的参数说明里（见 15-tools/32-intent.js）
/**
 * @typedef {Object} AnchorKind
 * @property {string} hint 写法，列在 anchors 的参数说明里；文件是裸写的，不带前缀
 * @property {(value: string, workdir: string) => string} normalize 规整后的值；给空即写不对
 * @property {string} problem 写不对时回给模型的话
 * @property {(value: string) => string} label 说给人、给模型听的名字
 * @property {"round"|"answer"} cadence 多久取一回指纹：round 每轮工具做完也取（本机读文件，便宜）；answer 只在每答开工与标成立时取（要跑指令的）
 * @property {(conversation: Conversation, values: string[], signal?: AbortSignal) => Promise<Record<string, string|null>>} read
 *   此刻的指纹；取不到（不知道）的不给，不据它判；给 null 即「没了」
 * @property {(value: string, path: string) => boolean} [covers] 罩不罩得住某个改过的文件（目录内相对路径）：一答改了而无一项罩着的即无主改动
 */
/** @type {Map<string, AnchorKind>} */
const ANCHOR_KINDS = new Map();
/** @param {string} name 前缀 @param {AnchorKind} kind */
function defineAnchor(name, kind) {
  ANCHOR_KINDS.set(name, kind);
}
/** 「种类:值」拆开 @param {string} key @returns {[string, string]} */
function anchorParts(key) {
  const at = key.indexOf(":");
  return [key.slice(0, at), key.slice(at + 1)];
}
/** @param {string} key */
function anchorLabel(key) {
  const [kind, value] = anchorParts(key);
  return ANCHOR_KINDS.get(kind)?.label(value) || key;
}
/**
 * 模型写的一条凭据 → 「种类:值」。带登记过的前缀即那一种，裸的是文件路径（盘符只一个字母，不会被认作前缀）
 * @param {any} raw @param {string|null} [workdir] @returns {{ key: string } | { problem: string }}
 */
function parseAnchor(raw, workdir = "") {
  const text = String(raw ?? "").trim(),
    match = /^([a-z]{2,8}):([\s\S]*)$/.exec(text),
    [kind, given] = match && ANCHOR_KINDS.has(match[1]) ? [match[1], match[2]] : ["file", text],
    value = ANCHOR_KINDS.get(kind).normalize(given, workdir || "");
  return value ? { key: `${kind}:${value}` } : { problem: t`凭据「${text.slice(0, 80)}」写不对：${ANCHOR_KINDS.get(kind).problem}` };
}
/**
 * 无主改动：改过的文件里，没有哪一项（没弃、没了结的）的凭据罩着的——回归罩不到的盲区，也是副作用常藏的地方。.yan/ 下是言自己的簿记，不算
 * @param {Intent} intent @param {string[]} paths 改过的文件（目录内相对，或目录外的完整路径）@param {Set<string>} [closed]
 */
function intentUnowned(intent, paths, closed = intentClosed(intent)) {
  const anchors = Object.keys(intent.nodes)
    .filter(id => !intentGone(intent, id) && !closed.has(id))
    .flatMap(id => intent.nodes[id].anchors)
    .map(anchorParts);
  return [...new Set(paths.map(path => intentPath(path)))].filter(
    path => path && !path.startsWith(".yan/") && !anchors.some(([kind, value]) => ANCHOR_KINDS.get(kind)?.covers?.(value, path))
  );
}
/** 依种类分派，取一组凭据此刻的指纹 @param {Conversation} conversation @param {string[]} keys @param {AbortSignal} [signal] @param {"round"|"answer"} [cadence] 只取每轮都取的那几种 */
async function anchorPrints(conversation, keys, signal, cadence = "answer") {
  const groups = new Map();
  for (const key of keys) {
    const [kind, value] = anchorParts(key),
      entry = ANCHOR_KINDS.get(kind);
    if (!entry || (cadence === "round" && entry.cadence !== "round")) continue;
    groups.set(kind, [...(groups.get(kind) || []), value]);
  }
  /** @type {Record<string, string|null>} */
  const prints = {};
  await Promise.all(
    [...groups].map(async ([kind, values]) => {
      const got = await ANCHOR_KINDS.get(kind).read(conversation, values, signal);
      for (const [value, print] of Object.entries(got)) prints[`${kind}:${value}`] = print;
    })
  );
  return prints;
}

defineAnchor("file", {
  hint: t("文件路径"),
  normalize: (value, workdir) => intentPath(value, workdir),
  problem: t("要一个文件路径"),
  label: value => value,
  cadence: "round",
  read: async (conversation, values, signal) =>
    (await bridge("/api/work/prints", { ...workScope(conversation), paths: values }, signal)).prints || {},
  // 路不分大小写（intentPath 剥目录前缀时就是这么比的）：Windows 上模型写 README.md、盘上是 readme.md，不能算白报
  covers: (value, path) => value.toLowerCase() === path.toLowerCase()
});
defineAnchor("dir", {
  hint: t("dir:目录（底下整片，新增删除也算）"),
  // 空值别收成「.」：那等于罩住整个工作目录，收尾前对照的「改了而无凭据罩着」就从此静默失效；显式的「.」「./」照旧
  normalize: (value, workdir) => {
    const raw = String(value ?? "").trim();
    return raw ? intentPath(raw, workdir).replace(/\/+$/, "") || "." : "";
  },
  problem: t("要一个目录"),
  label: value => `${value}/`,
  cadence: "round",
  read: async (conversation, values, signal) =>
    (await bridge("/api/work/prints", { ...workScope(conversation), dirs: values }, signal)).dirs || {},
  covers: (value, path) => value === "." || path.toLowerCase().startsWith(`${value.toLowerCase()}/`)
});
// 探针：比的是一条指令的输出（连同退出码）。跟着这段对话的档位走：问而后行里只自动跑明确只读的，别的这回不跑、不据它判；
// 审而后行、径行照跑。超时给得短——每答开工都要跑，一条卡住的探针不该拖住整答
defineAnchor("cmd", {
  hint: t("cmd:指令（比它的输出，宜选只读、输出稳定的）"),
  normalize: value => (/\n/.test(value) ? "" : value.trim().slice(0, 300)),
  problem: t("指令只能一行"),
  label: value => `探针「${value}」`,
  cadence: "answer",
  read: (conversation, values, signal) =>
    readAnchorCommands(conversation, values, signal, 15, data =>
      hashText(`${data.exitCode}\u0000${data.stdout || ""}\u0000${data.stderr || ""}`)
    )
});
// 测试：只比过没过（退出码是否为 0），输出里的耗时、行号变了不算——「收尾前跑一遍测试、不过接着改」这类常驻的条件挂在它上面。
// 跟探针一样随档位：问而后行里只自动跑明确只读的。超时给得宽；改过文件的那一答收尾前会重跑（见 10-store.js 的 intentGate）
defineAnchor("test", {
  hint: t("test:指令（只比过没过：退出码为 0 即过）"),
  normalize: value => (/\n/.test(value) ? "" : value.trim().slice(0, 300)),
  problem: t("指令只能一行"),
  label: value => `测试「${value}」`,
  cadence: "answer",
  read: (conversation, values, signal) =>
    readAnchorCommands(conversation, values, signal, 300, data => (data.exitCode === 0 ? "过" : "不过"))
});
// 探针与测试都是跑一条指令取个指纹：随档位，问而后行里只自动跑明确只读的；没跑、跑不成的这回不记、不据它判，停止照常抛出。
// 不带 ticket，到时即掐（转入后台只给模型自己的 run_command）
/** @param {number} timeout 秒 @param {(data: any) => string} digest */
async function readAnchorCommands(conversation, values, signal, timeout, digest) {
  const policy = commandPolicyOf(conversation),
    /** @type {Record<string, string|null>} */
    prints = {};
  await Promise.all(
    values.map(async command => {
      if (policy === "ask" && !isReadOnlyCommand(command)) return;
      try {
        prints[command] = digest(await bridge("/api/work/run", { ...workScope(conversation), command, timeout }, signal));
      } catch (error) {
        if (error.name === "AbortError") throw error;
      }
    })
  );
  return prints;
}
