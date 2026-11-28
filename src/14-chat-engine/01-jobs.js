// 言 · 对话引擎 · 进行中的活：作答、帮手、等着的后台指令，与防冻的锁
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 进行中的请求（主答、旁注）。有活在跑就攥着一把 Web Lock：熄屏、窗口被挡住时页面算「藏起来」，
// 浏览器的睡眠标签页 / 节能模式会把藏久了的页面冻住——流不读、工具不跑，亮屏才接着动；持锁的页面不在冻结之列。
// 用共享锁：开着几个言的标签页也各自攥得住
class JobMap extends Map {
  set(key, value) {
    super.set(key, value);
    holdAwake();
    // 开工即报到，别处立刻知道这段在作答
    void syncLeases();
    return this;
  }
  delete(key) {
    const had = super.delete(key);
    holdAwake();
    return had;
  }
  clear() {
    super.clear();
    holdAwake();
  }
}
const requestJobs = new JobMap();
// 主答与帮手共用轮次循环的收件口；每趟持有独立的队列和中止器。
function createRoundInbox() {
  return {
    controller: new AbortController(),
    queue: [],
    /** @type {AbortController|null} */
    round: null,
    reading: false,
    roundStart: 0,
    steerTimer: 0
  };
}
// 各段对话在后台做着的帮手（对话 id → 一名一个收件口，见 90-delegate.js）。帮手不随派它的那一答收尾：主答只剩等待就收尾，
// 回报到了另起一答。所以它与作答一样要攥锁防冻、要报到（别处不该把这段当成没人管）
const crews = new JobMap();
// 正等着结束的后台指令（步骤 id → 那个挂着的请求，见 20-command.js 的 watchBackground）：结束了要叫醒模型，页面不能被冻住
/** @type {Map<string, AbortController>} */
const bgWatches = new Map();
/** @type {{ release: () => void }|null} */
let awakeHold = null;
function holdAwake() {
  const busy = requestJobs.size || crews.size || bgWatches.size;
  if (busy && !awakeHold && navigator.locks) {
    const hold = { release: () => {} },
      done = new Promise(resolve => (hold.release = () => resolve(null)));
    awakeHold = hold;
    navigator.locks.request("yan-at-work", { mode: "shared" }, () => done).catch(() => {});
  } else if (!busy && awakeHold) {
    awakeHold.release();
    awakeHold = null;
  }
}
function requestJob(id = currentId) {
  return id ? requestJobs.get(id) || null : null;
}
function conversationRunning(id = currentId) {
  return !!requestJob(id);
}
// 后台还有帮手在做（这一段此刻未必在作答）
function crewRunning(id = currentId) {
  return !!id && crews.has(id);
}
// 作答途中不寻常的状态：等待确认、网络重试、整理上下文。平常写着、跑着不必说，label 为空；
// 等待确认由请示条与侧栏的「问」示意，其余挂在输入框上方的工作条里（见 renderHelperBar）
/** @param {Conversation} conversation */
function setJobLabel(conversation, job, label = "") {
  job.label = label;
  if (currentId === conversation.id) renderHelperBar();
}
