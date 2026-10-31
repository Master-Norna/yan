// 言 · 对话引擎 · 检查点：一答头一回动手改文件（写、改、跑指令、下载、作画）之前，请桥接把它的目录此刻的样子记下
// （见 server/checkpoints.js），这一答上记 checkpoint；回复动作里多一枚「退回」，把目录退回到这一答开工前。
// 只管目录里的文件：指令写到目录之外的、MCP 改的远端退不了——这不是后悔药，是本地文件的一道底。
// 退过之后接着问，下一问的开头注明退过（见 rewindNotes）：不然模型以为它先前写下的还在
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
/** @type {Map<string, Promise<void>>} */
const checkpointing = new Map();
const REWIND_SHOWN = 12;
/** 动手前：这一答还没记过就记一回，帮手与主答同时动手也只记一回。记不下（目录不在、桥接是旧的）不拦着干活 @param {ToolContext} ctx */
function checkpointBefore({ conversation, assistant }) {
  const root = conversation && workRoot(conversation);
  if (!root || assistant.checkpoint) return Promise.resolve();
  if (!checkpointing.has(assistant.id))
    checkpointing.set(
      assistant.id,
      bridge("/api/checkpoint/take", { root, conversation: conversation.id, answer: assistant.id }, AbortSignal.timeout(600000))
        .then(done => {
          assistant.checkpoint = { root, at: now(), files: done.files };
          markDirty(conversation.id);
        })
        .catch(() => {})
        .finally(() => checkpointing.delete(assistant.id))
    );
  return checkpointing.get(assistant.id) || Promise.resolve();
}
// 「退回」：先问桥接要动哪几件，摆给人看，点了才动。此后的改动（别的几答的、人手改的）一并退掉，都列在里头
/** @param {Conversation} c @param {Message} message */
async function rewindAnswer(c, message) {
  const point = message.checkpoint;
  if (!point) return;
  if (workdirLocked(c)) return toast(t("作答中，稍后再退"));
  const key = { root: point.root, conversation: c.id, answer: message.id };
  /** @type {{ path: string, kind: "changed"|"removed"|"added" }[]} */
  let changes;
  try {
    ({ changes } = await bridge("/api/checkpoint/diff", key, AbortSignal.timeout(300000)));
  } catch (error) {
    return toast(t`检查点读不出：${bridgeErrorText(String(error.message || error)).slice(0, 80)}`);
  }
  if (!changes.length) return toast(t("目录与这一答开工前一样，无须退回"));
  const word = { changed: t("改回"), removed: t("补回"), added: t("删去") },
    lines = changes.slice(0, REWIND_SHOWN).map(change => `${word[change.kind]}　${change.path}`),
    more = changes.length > REWIND_SHOWN ? `\n${t`…另有 ${changes.length - REWIND_SHOWN} 件`}` : "";
  const ok = await askConfirm({
    title: t("退回到这一答开工前？"),
    body: t`${point.root} 里 ${changes.length} 件回到那一刻的样子，此后的改动（连同手改的）一并退掉：\n${lines.join("\n")}${more}`,
    ok: t("退回")
  });
  if (!ok) return;
  if (workdirLocked(c)) return toast(t("作答中，稍后再退"));
  try {
    const done = await bridge("/api/checkpoint/restore", key, AbortSignal.timeout(600000));
    message.rewound = [...(message.rewound || []), { at: now(), restored: done.restored, removed: done.removed }];
    markDirty(c.id);
    saveStore();
    if (currentId === c.id && view === "chat") renderConversation(false);
    void refreshArchive();
    toast(
      done.failed.length
        ? t`退回了 ${done.restored + done.removed} 件，${done.failed.length} 件没能动：${done.failed[0]}`
        : t`已退回：改回、补回 ${done.restored} 件，删去 ${done.removed} 件`
    );
  } catch (error) {
    toast(t`未能退回：${bridgeErrorText(String(error.message || error)).slice(0, 80)}`);
  }
}
// 退过的几回，按时刻排：退回之后的头一问冠上一句（与上一答的行迹同一个放法，见 historyForApi）。时刻定了句子就定了，前文不会因此改写
/** @param {Message[]} source @returns {{ at: string, text: string }[]} */
function rewindNotes(source) {
  return source
    .flatMap((m, index) => {
      if (m.role !== "assistant" || !m.rewound?.length) return [];
      const asked = String(source.slice(0, index).findLast(item => item.role === "user")?.content || "")
        .replace(/\s+/g, " ")
        .slice(0, 40);
      return m.rewound.map(r => ({
        at: r.at,
        text: t`［用户已把目录里的文件退回到回答「${asked}」那一答开工前（改回、补回 ${r.restored} 件，删去 ${r.removed} 件）：那一答及其后写下的改动都已不在］`
      }));
    })
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}
