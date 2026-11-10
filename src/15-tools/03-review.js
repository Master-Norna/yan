// 言 · 审查：审而后行里，规则标疑的那一步交「专司」里另配的审查模型照用户的原话再判（学 Claude Code 的 auto 模式）。
// 没开审查、或档位不是审而后行，一切照旧（规则拦的回绝，没拦的照做）；审查出错也退回这样，最坏不比没开差。
// 标疑的几类：指令被宽的沙箱或审查规则拦下的；往外发、网址里带着一长串用户没给过的参数，或带着内容 POST 出去的；
// 往技能目录里写的（会进往后每段对话的上下文）；调 MCP 服务的写操作（见 60-mcp.js）——游目的浏览器另按 stageReviewWhy 收窄。
// 写记忆不审：记偏好、约定、做出来的结论本是模型自己拿主意的事，照「用户授权了没有」判几乎都驳（实测 7 回驳 3，
// 改写成「用户说明：…」就准）；而审查看不到工具输出，分不出哪条是网页里埋来的，审了也挡不住它要挡的。条目在行迹与设置页里可改可删
// 审查只看用户的原话、意里的目标与守、将要做的那一步；准了照做（指令带 reviewed 交桥接，规则那一道不再拦），
// 驳了原因作工具结果回给主模型、叫它换条路，不向用户请示。一答里连驳三回、或共驳二十回，叫它停手向用户说明
const REVIEW_STREAK = 3,
  REVIEW_TOTAL = 20;
// 一答（帮手各算各的）驳了几回：键是那一答的 id 加帮手的 scope
const reviewTally = new Map();

/** @param {Step} step @param {Record<string, any>} args @param {ToolContext} ctx @returns {Promise<ToolOutcome|null>} 驳了即交回这一步的结果 */
async function reviewHook(step, args, ctx) {
  if (!reviewOn(ctx.conversation)) return null;
  const why = await reviewFlag(step, args, ctx);
  return why ? reviewGate(step, args, ctx, why) : null;
}
/** @param {Conversation} conversation */
function reviewOn(conversation) {
  return commandPolicyOf(conversation) === "review" && dutyReady(store.settings.dutyReview);
}
/** 这一步该不该交审查：该的给一句缘由 @param {Step} step @param {Record<string, any>} args @param {ToolContext} ctx */
async function reviewFlag(step, args, ctx) {
  const { conversation, signal } = ctx;
  if (step.name === "run_command") {
    const { workdir, sandbox } = workScope(conversation);
    const screened = await bridge(
      "/api/work/screen",
      { workdir, sandbox, permission: "review", command: String(args.command || "") },
      signal
    ).catch(() => null);
    // 审查也不放行的（调桥接、藏字）不去问，照规则回绝
    return screened?.why && !screened.hard ? String(screened.why).replace(/^(审查|沙箱)拒绝：/, "") : "";
  }
  if (["fetch_page", "http_request", "download_file"].includes(step.name)) return egressWhy(step.name, args, conversation);
  if (["write_file", "edit_file"].includes(step.name) && insideSkills(String(args.path || ""), conversation))
    return "往技能目录里写，往后的对话都会照着做";
  return "";
}
/** 往外发的：带着内容 POST 出去，或网址里有一长串用户没给过、也不是检索与网页交回的参数 */
function egressWhy(name, args, conversation) {
  const method = String(args.method || "GET").toUpperCase();
  if (name === "http_request" && !["GET", "HEAD"].includes(method) && args.body) return `带着内容向外发送（${method}）`;
  let url;
  try {
    url = new URL(String(args.url || ""));
  } catch {
    return "";
  }
  const said = userSaid(conversation);
  if (said.includes(url.href)) return "";
  const seen = conversation.messages.some(m =>
    allSteps(m).some(s => s.results?.some(r => r.url === url.href) || (s.url === url.href && s.status === "done"))
  );
  if (seen) return "";
  const long = [...url.searchParams.values(), url.hash.slice(1)]
    .map(decodeURIComponentSafe)
    .find(v => /[A-Za-z0-9_\-+/=.%]{32,}/.test(v) && !said.includes(v));
  return long ? "网址里带着一长串用户没给过的参数" : "";
}
/** 用户亲口说的，连成一段好查某串字说没说过 @param {Conversation} conversation */
function userSaid(conversation) {
  return userWords(conversation).join("\n");
}
/**
 * 用户亲口说的，一句一项、按先后：原话与作答途中寄来的补言（带上附件名），帮手回报、后台指令结束另起的那一问（带 relay）也是 user 消息，可那是工具输出，不算。
 * 用户在请示上的定夺也是亲口说的，按先后插在其间：表单的作答、守的关口上的准许（step 即将要做的那一步）
 * @param {Conversation} conversation @param {Step} [step]
 */
function userWords(conversation, step) {
  const words = (text, attachments = []) =>
    [String(text || "").trim(), ...attachments.map(a => `［附件 ${a.name}］`)].filter(Boolean).join(" ");
  return conversation.messages
    .flatMap(m =>
      m.role === "user"
        ? m.relay
          ? []
          : [words(m.content, m.attachments)]
        : allSteps(m).flatMap(s =>
            s.name === "user_note"
              ? [words(s.note, s.attachments)]
              : s.name === "ask_user" && s.answers
                ? // 问句里写着问的是哪件事，单看答案「授权上述操作」不知所指
                  [
                    `［请示作答］${s.form?.questions?.map((q, i) => `${q.question} → ${s.answers?.[i] || "（未答）"}`).join("；") || s.note || ""}`
                  ]
                : s.granted
                  ? // 守常写着「先给用户看、批了再做」：关口上那张请示就是给人看过这一步，写明了审查才对得上
                    [
                      s === step
                        ? "［守请示］用户在关口上看过下面将要做的这一步，准许了"
                        : `［守请示］准许了 ${s.name}${s.title ? `：${s.title}` : ""}`
                    ]
                  : []
          )
    )
    .filter(Boolean);
}
// 游目的浏览器：点击、按键、翻页、等待都是在用户托付的事里走动，一概送审只是每步多等一回、审查也多半照准。
// 只审可能把东西带出去的：跳到带长串参数的网址（与翻网页同一把尺）、往页面里填进一段用户没说过的字、上传本机文件、在页面里跑代码
const STAGE_CODE = ["browser_evaluate", "browser_run_code_unsafe", "browser_webmcp_call"],
  STAGE_TYPING = ["browser_type", "browser_press_sequentially"];
/** @param {string} tool @param {Record<string, any>} args @param {Conversation} conversation */
function stageReviewWhy(tool, args, conversation) {
  if (tool === "browser_navigate") return egressWhy("fetch_page", args, conversation);
  if (tool === "browser_file_upload") return "往网页上传本机文件";
  if (STAGE_CODE.includes(tool)) return "在网页里跑代码";
  const typed =
    tool === "browser_fill_form"
      ? (Array.isArray(args.fields) ? args.fields : []).map(field => field?.value)
      : STAGE_TYPING.includes(tool)
        ? [args.text]
        : [];
  // 短的（搜索词、选项）带不出什么；长的且不是用户自己说过的才审
  const said = userSaid(conversation);
  return typed.some(value => (text => text.length >= 20 && !said.includes(text))(String(value ?? "").trim()))
    ? "往网页里填进一段用户没说过的字"
    : "";
}
function decodeURIComponentSafe(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
/** 写的路径落在存储根的技能目录里没有（相对的按这段对话的目录接上；卷宗就在存储根下，../技能/… 即到，. 与 .. 先消掉再比） @param {string} raw @param {Conversation} conversation */
function insideSkills(raw, conversation) {
  const skills = String(bootstrap.store?.skills || "");
  if (!skills || !raw) return false;
  const full = /^([a-z]:)?[\\/]/i.test(raw) ? raw : `${workRoot(conversation) || ""}/${raw}`;
  return `${normalizeWorkPath(full).toLowerCase()}/`.startsWith(`${normalizeWorkPath(skills).toLowerCase()}/`);
}

/** 交审查模型判：准即返回 null 照做（step.reviewed 记下），驳即交回结果。出错退回没开审查时的样子 @param {Step} step @param {Record<string, any>} args @param {ToolContext} ctx @param {string} why */
async function reviewGate(step, args, ctx, why) {
  const key = `${ctx.assistant.id}|${step.scope || ""}`,
    tally = reviewTally.get(key) || { streak: 0, total: 0 };
  // 已叫它停手还在动手：不再请审查，照样驳
  if (tally.streak >= REVIEW_STREAK || tally.total >= REVIEW_TOTAL)
    return { ok: false, content: prompt("review.halt", { count: tally.total }), display: "审查未准" };
  let verdict;
  try {
    verdict = await askReviewer(step, args, ctx, why);
  } catch (error) {
    if (error.name === "AbortError" && ctx.signal.aborted) throw error;
    // 审查实际没在把关：弹一句，人才知道这一步是照规则过的
    dutyFailed("review", error);
    return null;
  }
  dutyOk("review");
  if (verdict.ok) {
    tally.streak = 0;
    reviewTally.set(key, tally);
    step.reviewed = { ok: true, why: verdict.why };
    return null;
  }
  tally.streak += 1;
  tally.total += 1;
  reviewTally.set(key, tally);
  if (reviewTally.size > 200) reviewTally.delete(reviewTally.keys().next().value);
  step.reviewed = { ok: false, why: verdict.why };
  const halt = tally.streak >= REVIEW_STREAK || tally.total >= REVIEW_TOTAL;
  return {
    ok: false,
    content: `${prompt("review.denied", { why: verdict.why || "没说理由" })}${halt ? `\n${prompt("review.halt", { count: tally.total })}` : ""}`,
    display: "审查未准"
  };
}
/** 两步判：先只要一个字；疑了再同一段话换个末句要理由（前头一字不差，走缓存） @returns {Promise<{ ok: boolean, why: string }>} */
async function askReviewer(step, args, ctx, why) {
  const base = reviewCase(step, args, ctx.conversation, why),
    ask = async (tail, maxTokens) =>
      (
        await askDuty("review", `${base}\n\n${tail}`, {
          systemPrompt: prompt("review.system"),
          maxTokens,
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(60000)])
        })
      ).trim();
  if (reviewWord(await ask(prompt("review.quick"), 1500)).startsWith("准")) return { ok: true, why: "" };
  const said = reviewWord(await ask(prompt("review.reason"), 3000));
  // 首字既不是准也不是驳（写空了、答非所问）：当审查出错，退回照规则，不拿它当驳
  if (!/^[准驳]/.test(said)) throw Error("审查模型没给出准或驳");
  return { ok: said.startsWith("准"), why: said.replace(/^[准驳][\s*_`"'：:，,。.、」』”’】\])）]*/, "").slice(0, 120) };
}
/** 审查的答复去掉开头的 Markdown 记号与引号（**准**、「驳」），首字才是定夺 @param {string} text */
function reviewWord(text) {
  return text.replace(/^[\s*_`#>"'「『“‘【\[(（-]+/, "");
}
/**
 * 交给审查的那段话：用户亲口说的（见 userWords；新的在后、过长截去旧的）、意里的目标与守、将要做的、规则的缘由。
 * 请示上的定夺只让审查知道人选了什么，照样由它判：人批的是要做这件事，审查还看模型这一步有没有写歪。
 * 将要做的整段交上、不截：截了的尾巴审查看不到却照样发出去，审查也会把截断当成内容残缺而驳（10-29 开 PR 连驳三回，正文 3.9k 字截在 3000）
 * @param {Conversation} conversation
 */
function reviewCase(step, args, conversation, why) {
  const said = userWords(conversation, step),
    lines = [];
  let room = 6000;
  for (let i = said.length - 1; i >= 0 && room > 0; i--) {
    const text = said[i].slice(0, room);
    lines.unshift(`${i + 1}. ${text}`);
    room -= text.length;
  }
  // 这一步过了哪条守的关口，那条守在这一步上已由人照过：写明了，审查不再拿它看不见的「给人看过没有」去对
  const held = intents.get(conversation.id)?.intent,
    gated = Array.isArray(step.granted) ? step.granted : [],
    closed = held ? answerClosed(conversation, held) : undefined,
    goals = held
      ? intentRoots(held)
          .filter(id => !closed.has(id))
          .map(id => held.nodes[id].claim)
      : [],
    keeps = held
      ? intentKeeps(held, closed).map(
          id => `${held.nodes[id].claim}${gated.includes(id) ? "（这一步已过此守的关口：用户看过、准许了）" : ""}`
        )
      : [],
    intentText = [goals.length ? `目标：${goals.join("；")}` : "", keeps.length ? `守：${keeps.join("；")}` : ""]
      .filter(Boolean)
      .join("\n");
  return prompt("review.case", {
    user: lines.join("\n") || "（无）",
    intent: intentText ? `\n\n${prompt("review.intent", { text: intentText })}` : "",
    action: `${step.name}\n${JSON.stringify(args, null, 1)}`,
    why
  });
}
