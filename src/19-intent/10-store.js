// 言 · 意 · 读写与附着。每一答开工时读一回，连同已成立、已假定各项凭据此刻的指纹（取法见 05-anchors.js），附在这一问之后——与账本同一个位置、同一个道理
// （见 15-tools/21-files.js 的 ledgerNote）：附在问上而不进系统提示，意改了也不冲掉前面的缓存；这一答里再改，改完的那份由工具结果交回。
// 写只经桥接（/api/work/intent），带上读到的版本：别处刚写过就照新的那份重算再写
const INTENT_FILE = ".yan/意.json";
/** @type {Map<string, { intent: Intent, now: IntentPrints, closed?: Set<string> }>} 按对话：这一答开工时读到的意与指纹、那时已了结的 */
const intents = new Map();
/** 这一答眼里了结的：开工时已了结、此刻也还了结的。这一答才立住的留到它收尾：标完成立还要拿原问对照、进度也不至于一下归零 @param {Conversation} conversation @param {Intent} intent */
const answerClosed = (conversation, intent) => intentClosed(intent, intents.get(conversation.id)?.closed);
/** @param {Conversation} conversation @param {AbortSignal} [signal] */
async function readIntent(conversation, signal) {
  const data = await bridge("/api/work/intent", workScope(conversation), signal);
  return { intent: asIntent(data.data), version: String(data.version || "") };
}
/** 这几条凭据此刻的指纹；取不到就当这回不知道，不据它判 @param {Conversation} conversation @param {string[]} keys @param {AbortSignal} [signal] @param {"round"|"answer"} [cadence] */
async function intentPrints(conversation, keys, signal, cadence = "answer") {
  if (!keys.length) return {};
  try {
    return await anchorPrints(conversation, keys, signal, cadence);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return {};
  }
}
/** 这一答开工时读一回；读不到（没绑目录、桥接不在、文件坏了）就不附 @param {Conversation} conversation @param {AbortSignal} [signal] */
async function loadIntent(conversation, signal) {
  if (!isWork(conversation)) return void intents.delete(conversation.id);
  try {
    const { intent } = await readIntent(conversation, signal),
      closed = intentClosed(intent),
      now = await intentPrints(conversation, intentSealedAnchors(intent, closed), signal);
    intents.set(conversation.id, { intent, now, closed });
    noteIntentGlance(conversation, intent, now);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    intents.delete(conversation.id);
  }
}
/** 一答之内的回归簿记：上一回看到的待复核几项、各项被打回几回 @param {Conversation} conversation */
function intentWatch(conversation) {
  const held = intents.get(conversation.id);
  return {
    stale: new Set(held ? intentStaleIds(held.intent, held.now, answerClosed(conversation, held.intent)) : []),
    bounces: new Map(),
    gated: false,
    kept: false
  };
}
/**
 * 一轮工具做完：重取便宜的那几种凭据（文件、目录；探针只在每答开工与标成立时跑）的指纹，新转待复核的写成一段接在这一轮的工具结果后
 * （见 runRounds 的 afterRound）。谁改的都算——这一轮的指令、后台的帮手、用户在别处手改；取不到指纹就这回不说
 * @param {Conversation} conversation @param {ReturnType<typeof intentWatch>} watch @param {AbortSignal} [signal]
 */
async function intentRound(conversation, watch, signal) {
  const held = intents.get(conversation.id),
    closed = held ? answerClosed(conversation, held.intent) : undefined,
    keys = held ? intentSealedAnchors(held.intent, closed) : [];
  if (!held || !keys.length) return "";
  held.now = { ...held.now, ...(await intentPrints(conversation, keys, signal, "round")) };
  const stale = new Set(intentStaleIds(held.intent, held.now, closed)),
    fresh = [...stale].filter(id => !watch.stale.has(id));
  watch.stale = stale;
  for (const id of fresh) watch.bounces.set(id, (watch.bounces.get(id) || 0) + 1);
  return intentRoundText(held.intent, held.now, fresh, watch.bounces);
}
// 收尾前对照：这一答动过意（改过它，或它所挂的凭据在这一答里变过），模型说完要收尾时拦一次——只一次，拦完即放。
// 守（一直要守的条件，见 00-core.js）写不出触发条件的，挂的探针、测试作答途中不跑：这一答动过手，收尾前先重取一回，有条因此转待复核也算动过。
// 没变就照常收尾，不多费一轮；因守而拦的那一步右侧写出事的那几条与事由（设计稿/80 行迹乙）。写了触发条件的走钩子（见 keepHook），收尾时不再跑。
// 摆出此刻的意（重读一回，探针也跑）、这一答里转待复核过的、改了而无凭据罩着的文件，请它对照各根的原话自己判：能收就收，未尽的接着做。
// 不替它验、不复验、不再拦：要不要派帮手核对由它定。递的话记作行迹里的一步，往后重装这一答照原处插回（replay）
const INTENT_UNOWNED_SHOWN = 8;
/** @param {Message} assistant 这一答改过的文件（帮手改的也算） */
function changedPaths(assistant) {
  return (assistant.steps || [])
    .flatMap(step => [step, ...(step.sub?.steps || [])])
    .filter(step => step.change && step.status === "done")
    .map(step => step.change.path);
}
/**
 * @param {Conversation} conversation @param {Message} assistant @param {ReturnType<typeof intentWatch>} watch @param {AbortSignal} [signal]
 * @returns {Promise<Record<string, any>|null>} 递给模型的那一条；null 即放它收尾
 */
async function intentGate(conversation, assistant, watch, signal) {
  if (watch.gated) return null;
  if (!intents.has(conversation.id)) return null;
  const touched = (assistant.steps || []).some(step => step.name === "update_intent" && step.status === "done") || watch.bounces.size > 0;
  const rechecked = touched ? null : await intentRecheck(conversation, assistant, watch, signal);
  if (!touched && !rechecked) return null;
  watch.gated = true;
  // 别的对话这一答期间也可能改过：重读一回，以文件为准
  let intent = intents.get(conversation.id).intent;
  try {
    intent = (await readIntent(conversation, signal)).intent;
  } catch (error) {
    if (error.name === "AbortError") throw error;
  }
  if (!Object.keys(intent.nodes).length) return null;
  const closed = answerClosed(conversation, intent),
    // 刚重跑过的（测试可能跑上几分钟）不再跑一遍
    now = {
      ...(await intentPrints(
        conversation,
        intentSealedAnchors(intent, closed).filter(key => !rechecked || !(key in rechecked.prints)),
        signal
      )),
      ...rechecked?.prints
    };
  keepIntent(conversation, intent, now);
  // 已动过意时走上面的整体验证，也要据最终指纹记下守的失败；先重查过的那几条不重复算一回。
  const broken = intentKeeps(intent, closed).filter(id => intentState(intent, id, now) === "stale");
  for (const id of broken)
    if (!watch.stale.has(id) && !rechecked?.fresh.includes(id)) watch.bounces.set(id, (watch.bounces.get(id) || 0) + 1);
  watch.kept = broken.length > 0;
  watch.stale = new Set(intentStaleIds(intent, now, closed));
  const unowned = intentUnowned(intent, changedPaths(assistant), closed),
    report = [
      prompt("work.intentGate", { intent: intentText(intent, now, { path: INTENT_FILE, asks: true, closed }) }),
      watch.bounces.size && prompt("work.intentGateBounced", { list: [...watch.bounces].map(([id, n]) => t`${id} ${n} 回`).join("、") }),
      unowned.length &&
        prompt("work.intentGateUnowned", {
          list: `${unowned.slice(0, INTENT_UNOWNED_SHOWN).join("、")}${unowned.length > INTENT_UNOWNED_SHOWN ? t` 等 ${unowned.length} 个` : ""}`
        }),
      prompt("work.intentGateAsk")
    ]
      .filter(Boolean)
      .join("\n\n"),
    { live, standing } = intentTally(intent, now, closed);
  /** @type {Step} */
  const step = {
    id: `gate_${uid().slice(0, 8)}`,
    name: "intent_gate",
    arguments: "{}",
    status: "done",
    // 存中文原文，画出来时照语言换
    title: "收尾前对照意",
    result: broken.length ? `${broken.join("、")} · ${keepWhy(intent, now, broken)}` : `已立 ${standing} / ${live}`,
    ...(broken.length ? { keep: true } : {}),
    at: String(assistant.content || "").length,
    rat: String(assistant.reasoning || "").length,
    report
  };
  (assistant.steps ||= []).push(step);
  refreshSteps(assistant);
  saveStoreSoon();
  return { role: "user", content: report };
}
/**
 * 动过手的那一答（写过、改过文件，或跑过指令——帮手做的也算），收尾前重取守挂的探针与测试；有条新转待复核就记进 bounces（收尾对照里列出），
 * 交回重取到的指纹与转待复核的几条，否则 null
 * @param {Conversation} conversation @param {Message} assistant @param {ReturnType<typeof intentWatch>} watch @param {AbortSignal} [signal]
 * @returns {Promise<{ prints: IntentPrints, fresh: string[] }|null>}
 */
async function intentRecheck(conversation, assistant, watch, signal) {
  const held = intents.get(conversation.id),
    closed = answerClosed(conversation, held.intent),
    keeps = intentKeeps(held.intent, closed),
    keys = keepAnchors(held.intent, closed),
    acted = allSteps(assistant).some(
      step => step.status === "done" && TOOLS.get(step.name)?.group === "work" && TOOLS.get(step.name)?.sideEffect
    );
  if (!keys.length || !acted) return null;
  const prints = await intentPrints(conversation, keys, signal);
  held.now = { ...held.now, ...prints };
  const fresh = keeps.filter(id => intentState(held.intent, id, held.now) === "stale" && !watch.stale.has(id));
  for (const id of fresh) watch.bounces.set(id, (watch.bounces.get(id) || 0) + 1);
  return fresh.length ? { prints, fresh } : null;
}
/** 守挂的、要跑指令的凭据（探针、测试）；钩子挂的测试不在其中 @param {Intent} intent @param {Set<string>} [closed] */
function keepAnchors(intent, closed) {
  return [
    ...new Set(
      intentKeeps(intent, closed).flatMap(id => {
        const node = intent.nodes[id];
        return Object.keys(node.seal?.prints || {}).filter(key => !keepHookAnchor(node, key));
      })
    )
  ].filter(key => ANCHOR_KINDS.get(anchorParts(key)[0])?.cadence === "answer");
}
// 守的钩子：写了 on 的守，有副作用的一步（指令、写文件、调接口……帮手做的也算）对得上它，动手前（请示之前）先跑它挂的测试，
// 将要做的经环境变量交给测试：YAN_TOOL 是工具名，YAN_TARGET 是指令原文、路径或网址（别的工具即整份参数）。不过即不做这一步，测试的输出作这一步的结果回给模型。
// 跟探针一样随档位：问而后行里只自动跑明确只读的，别的不跑——那一步本就要人批。跑不成的这回不拦。改意不过钩子：写宽了的 on 不能连撤它的那一步也拦下。
// 没挂测试的即禁令，对上就不做；标了 ask 的是关口：测试过了（或没挂）还要请用户批，不论档位——径行也问，批了这一步不再另问
/** @param {Step} step @param {Record<string, any>} args @param {ToolContext} ctx @returns {Promise<ToolOutcome|null>} 拦下即交回这一步的结果 */
async function keepHook(step, args, ctx) {
  const held = intents.get(ctx.conversation.id);
  if (!held || step.name === "update_intent" || !TOOLS.get(step.name)?.sideEffect) return null;
  const target = String(args.command ?? args.path ?? args.url ?? JSON.stringify(args)),
    policy = commandPolicyOf(ctx.conversation);
  for (const id of intentKeeps(held.intent, answerClosed(ctx.conversation, held.intent))) {
    const node = held.intent.nodes[id],
      on = keepTrigger(node);
    if (!on || !(on.test(target) || on.test(step.name))) continue;
    const tests = node.anchors.filter(key => keepHookAnchor(node, key));
    if (!tests.length && !node.ask)
      return { ok: false, content: prompt("work.keepBan", { id, claim: node.claim }).trim(), display: `守拦下 · ${id}` };
    for (const key of tests) {
      const command = anchorParts(key)[1];
      if (policy === "ask" && !isReadOnlyCommand(command)) continue;
      let data;
      try {
        data = await bridge(
          "/api/work/run",
          { ...workScope(ctx.conversation), command, timeout: 300, hook: { tool: step.name, target } },
          ctx.signal
        );
      } catch (error) {
        if (error.name === "AbortError") throw error;
        continue;
      }
      if (data.exitCode === 0) continue;
      const output = [data.stdout, data.stderr].filter(text => String(text || "").trim()).join("\n");
      return {
        ok: false,
        content: prompt("work.keepHook", {
          id,
          test: anchorLabel(key),
          code: data.timedOut ? "超时" : String(data.exitCode),
          output: clipForModel(output, 4000, { tail: true })
        }).trim(),
        display: `守拦下 · ${id}`
      };
    }
    if (!node.ask) continue;
    step.gate = { id, claim: node.claim, target };
    const granted = await askApproval(step, ctx).finally(() => delete step.gate);
    if (!granted) {
      step.skipped = true;
      return { ok: false, content: prompt("work.keepDeclined", { id }).trim(), display: `守未准 · ${id}` };
    }
    step.granted = [...(Array.isArray(step.granted) ? step.granted : []), id];
  }
  return null;
}
/**
 * 因守拦过的那一答收了尾：再取一回守的探针与测试，书眉与卡片照实画——模型多半已改好，不必挂着「守 ○」等到下一问开工
 * @param {Conversation} conversation
 */
async function intentSettleKeeps(conversation) {
  const held = intents.get(conversation.id),
    key = glanceKey(conversation),
    shown = intentGlances.get(key),
    keys = held ? keepAnchors(held.intent) : [];
  if (!keys.length || (shown && shown.intent !== held.intent)) return;
  try {
    const prints = await intentPrints(conversation, keys);
    // 测试可能跑很久：下一答、同目录的另一段对话或改绑目录后，旧结果不能盖回新的记录。
    if (intents.get(conversation.id) !== held || glanceKey(conversation) !== key || intentGlances.get(key) !== shown) return;
    held.now = { ...held.now, ...prints };
    noteIntentGlance(conversation, held.intent, held.now);
  } catch {
    // 桥接不在、指令跑不成：照旧挂着，下一问开工再取
  }
}
/** 拦下那一步右侧的事由：测试没过写「测试不过」，余者「凭据已变」 @param {Intent} intent @param {IntentPrints} now @param {string[]} ids */
function keepWhy(intent, now, ids) {
  const failed = ids.some(id => intent.nodes[id]?.anchors.some(key => anchorParts(key)[0] === "test" && now[key] === "不过"));
  return failed ? "测试不过" : "凭据已变";
}
/** 这一答里改过意：记下改完的那份，往后几轮据它比（作答途中压了前文要重装时，附的也是它）；题下与书眉跟着换 @param {Conversation} conversation @param {Intent} intent @param {IntentPrints} now */
function keepIntent(conversation, intent, now) {
  intents.set(conversation.id, { intent, now, closed: intents.get(conversation.id)?.closed });
  noteIntentGlance(conversation, intent, now);
}
/** 附在这一问之后的一段；意里一项都没有就不附 @param {Conversation} conversation */
function intentNote(conversation) {
  const held = intents.get(conversation.id),
    text = held ? intentText(held.intent, held.now, { path: INTENT_FILE, closed: answerClosed(conversation, held.intent) }) : "";
  return text ? `${text}\n\n` : "";
}
/**
 * 改意：读、算、写。版本对不上（别的对话、别的页面刚写过）就照新的那份重算再写
 * @template T
 * @param {Conversation} conversation
 * @param {AbortSignal} signal
 * @param {(intent: Intent) => Promise<{ next?: Intent } & T>} change 给出 next 即写；不给即不写，原样交回
 * @returns {Promise<{ next?: Intent } & T>}
 */
async function changeIntent(conversation, signal, change) {
  for (let tries = 0; tries < 5; tries++) {
    const { intent, version } = await readIntent(conversation, signal),
      result = await change(intent);
    if (!result.next) return result;
    const data = await bridge("/api/work/intent", { ...workScope(conversation), data: result.next, base: version }, signal);
    if (!data.conflict) return result;
  }
  throw Error(t("意被别处接连改动，没写成，稍后再试"));
}
