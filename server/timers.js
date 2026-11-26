// 言 · 桥接的候 · 等时刻：模型约好几点叫醒自己（set_timer），桥接记着，到点把那一回落进 存储根/候/到点/ 再交给页面——
// 无人领取的到点记录和未到点的约定都写盘，供关页后读回及桥接重启后续排。由 server.js 装配：require("./server/timers.js")({ home, known })
//   约.json         约好的时刻：几点叫、叫哪段对话的哪一步、附什么话、隔多久再叫。启动时读回，错过的当场补叫并记下迟了多久
//   到点/<编号>.json 到了点、还没被页面取走的那一回；页面经 /api/timer/wait 等着、/api/timer/take 认领（响应在途先保留正本，写完即改名认领，几页同等也只一页拿到）
// 定时放在桥接而不交系统的计划任务：到点的那一回本就要经桥接送进页面，桥接不在，到点也送不到
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { jsonRoute, requestSignal, onResponseSettled, writeAtomic, readJsonFile, stamp } = require("./http.js");

// setTimeout 至多等这么久（约 24.8 天），再远的到时候再排一回
const MAX_DELAY = 2 ** 31 - 1;
// 页面的长等：这么久没有新的就空手回，页面随即再等——顺带让它重新看一眼先前跳过的（那时那段对话别处正在答）
const WAIT_MS = 60000;
const RETRY_MS = 5000;

/** @typedef {{ id: string, to: string, step: string, note: string, due: number, every?: number, created: number }} Timer */
/** @typedef {{ seq: number, timers: Timer[] }} Book */
// JSON 能读不等于约簿完整：坏条目不得进入排程（null 会在算投递号时抛错，非法 due 会让 setTimeout 反复立即触发）。
function validBook(saved) {
  return (
    Array.isArray(saved?.timers) &&
    (typeof saved.seq === "number" || typeof saved.seq === "string") &&
    Number.isSafeInteger(Number(saved.seq)) &&
    Number(saved.seq) >= 0 &&
    saved.timers.every(
      timer =>
        timer &&
        typeof timer.id === "string" &&
        timer.id &&
        typeof timer.to === "string" &&
        timer.to &&
        (timer.created === undefined || Number.isFinite(timer.created)) &&
        Number.isFinite(timer.due) &&
        (timer.every === undefined || (Number.isFinite(timer.every) && timer.every >= 1000))
    )
  );
}
// 一约一时刻只有一个投递号；前缀与旧版的随机号区分，周期的不同次不会相撞。
/** @param {Timer} timer */
const firedId = ({ id, to, created, due }) =>
  `f-${createHash("sha256")
    .update(JSON.stringify([id, to, created, due]))
    .digest("base64url")
    .slice(0, 36)}`;

/** @param {{ home: () => string, known: (id: string) => boolean, route?: typeof jsonRoute }} options */
module.exports = function createTimers({ home, known, route = jsonRoute }) {
  const firedDir = () => path.join(home(), "到点"),
    bookFile = () => path.join(home(), "约.json");
  /** @type {Set<() => void>} 正等着的页面 */
  const waiters = new Set(),
    reserved = new Set(), // 响应在途或已写完但凭据尚未落盘；按完整路径认，换根也不串
    completed = new Map(); // 只重试持久化凭据，不再把同一回递给页面
  let claimRetry = null;

  // ---------- 到点的那一回：落盘、等、认领 ----------
  const firedFile = id => path.join(firedDir(), `${id}.json`);
  function firedNames() {
    try {
      return fs.readdirSync(firedDir());
    } catch {
      return [];
    }
  }
  function forgetClaim(file) {
    try {
      fs.rmSync(file, { force: true });
    } catch {} // 清理不影响已认领的回报；下回读到有效约簿时可再清
  }
  // 约簿还排着这一回时，正本和认领凭据都能证明已投递。不能把读盘错误当成没投过。
  /** @param {string} file @returns {{ next?: number } | null} */
  function receipt(file) {
    for (const saved of [file, `${file}.taken`]) {
      try {
        return JSON.parse(fs.readFileSync(saved, "utf8")).timer;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return null;
  }
  /** @param {Timer} timer @param {number} now */
  function post(timer, now) {
    const id = firedId(timer),
      file = firedFile(id),
      posted = receipt(file);
    // 周期的下一回沿用已发出的时刻，不能在补写约簿时悄悄改掉页面收到的 next。
    if (posted) return posted.next;
    const { due, every, step, note } = timer,
      next = every ? due + every * (1 + Math.floor((now - due) / every)) : undefined;
    fs.mkdirSync(firedDir(), { recursive: true });
    writeAtomic(
      file,
      JSON.stringify({
        id,
        at: now,
        to: timer.to,
        timer: { id: timer.id, step, note, due, late: now - due, ...(every ? { every, next } : {}) }
      })
    );
    for (const wake of [...waiters]) wake();
    return next;
  }
  function pending() {
    return firedNames()
      .filter(name => name.endsWith(".json") && !reserved.has(path.join(firedDir(), name)))
      .map(name => readJsonFile(path.join(firedDir(), name)))
      .filter(Boolean)
      .sort((a, b) => a.at - b.at);
  }
  // 回报已写完才落认领凭据。失败时保留内存中的认领，只有凭据落稳或正本确已不在才释放。
  function persistClaims() {
    clearTimeout(claimRetry);
    claimRetry = null;
    for (const [file, { scope, id }] of completed) {
      try {
        const saved = readJsonFile(path.join(scope, "约.json")),
          open = validBook(saved) ? new Set(saved.timers.map(firedId)) : null,
          claimed = `${file}.taken`;
        fs.renameSync(file, claimed);
        if (open && !open.has(id)) forgetClaim(claimed);
      } catch (error) {
        // 不可访问不等于不存在；尤其不能把 EACCES/EPERM 当成已清理。
        if (error.code !== "ENOENT") continue;
      }
      completed.delete(file);
      reserved.delete(file);
    }
    if (completed.size) {
      claimRetry = setTimeout(persistClaims, RETRY_MS);
      claimRetry.unref?.();
    }
  }
  // 页面等着：有没被跳过的就当场回，没有就挂着，有新的到点或等满一分钟再回
  const handleWait = route(async (body, req, res) => {
    // 只读到点收件箱无需依赖约簿可写，损坏时照常交付已投递消息。
    sync();
    const at = home(),
      skip = new Set(Array.isArray(body.skip) ? body.skip.map(String) : []),
      fresh = () => pending().filter(item => !skip.has(item.id)),
      signal = requestSignal(res);
    if (signal.aborted) return;
    let fired = fresh();
    if (!fired.length)
      await new Promise(resolve => {
        const done = () => {
          waiters.delete(done);
          clearTimeout(timer);
          resolve(null);
        };
        const timer = setTimeout(done, WAIT_MS);
        waiters.add(done);
        signal.addEventListener("abort", done, { once: true });
      });
    if (signal.aborted || res.writableEnded || res.destroyed) return;
    // 等待归发起时的根；换根唤回旧等待时交空手，不把新根的信递给尚未换过来的旧页面。
    return { fired: home() === at ? (fired.length ? fired : fresh()) : [] };
  });
  const handleTake = route((body, req, res) => {
    if (!bookCorrupt && fs.existsSync(bookFile()) && !validBook(readJsonFile(bookFile()))) bookCorrupt = true;
    sync();
    const scope = home(),
      ids = Array.isArray(body.ids) ? body.ids.map(String) : [],
      fired = [];
    for (const id of ids) {
      if (!/^[\w-]{1,40}$/.test(id)) continue;
      const file = firedFile(id);
      if (reserved.has(file)) continue;
      const item = readJsonFile(file);
      if (!item) continue;
      reserved.add(file);
      fired.push(item);
    }
    if (fired.length)
      onResponseSettled(res, finished => {
        for (const { id } of fired) {
          const file = path.join(scope, "到点", `${id}.json`);
          if (finished) completed.set(file, { scope, id });
          else reserved.delete(file);
        }
        if (finished) persistClaims();
        for (const wake of [...waiters]) wake();
      });
    return { fired };
  });

  // ---------- 约好的时刻 ----------
  /** @type {Book} */
  let book = { seq: 0, timers: [] },
    bookAt = "",
    bookCorrupt = false;
  const bookError = () => Error("约簿损坏或不可读：拒绝覆写约.json，请先修复或从备份恢复");
  /** @type {Map<string, number>} 只挪重试时刻，不改原约的 due */
  const retryAt = new Map();
  // 约.json 随存储根：换了存储位置，读那边的一份重排，不把这边的带过去盖掉它
  function sync() {
    const file = bookFile(),
      moved = bookAt !== file;
    // 已知损坏时允许下一回重读，以便用户修好文件后无需重启桥接。
    if (!moved && !bookCorrupt) return;
    bookAt = file;
    retryAt.clear();
    const saved = readJsonFile(bookAt);
    bookCorrupt = fs.existsSync(bookAt) && !validBook(saved);
    if (bookCorrupt) {
      book = { seq: 0, timers: [] };
      clearTimeout(armed);
      // 同根坏簿不影响已投递的回报，重读时不叫醒别页；换根仍须结束旧等待。
      if (moved) for (const wake of [...waiters]) wake();
      return;
    }
    book = validBook(saved) ? { seq: Number(saved.seq) || 0, timers: saved.timers } : { seq: 0, timers: [] };
    if (validBook(saved)) {
      // 桥接也可能恰好退在约簿已写、旧凭据还没清的时候。只在确实读到了约簿时裁定。
      const open = new Set(book.timers.map(timer => `${firedId(timer)}.json.taken`));
      for (const name of firedNames())
        if (/^f-[\w-]{36}\.json\.taken$/.test(name) && !open.has(name)) forgetClaim(path.join(firedDir(), name));
    }
    arm();
    for (const wake of [...waiters]) wake();
  }
  let armed = null;
  function requireBook() {
    sync();
    if (bookCorrupt) throw bookError();
  }
  /** @param {Book} next @param {Timer[]} retired */
  function save(next, retired = []) {
    // 即使读入后有人在磁盘上改坏约簿，也不能静默把错误当作一份空簿覆盖。
    if (bookCorrupt || (fs.existsSync(bookFile()) && !validBook(readJsonFile(bookFile())))) {
      bookCorrupt = true; // 修复原件后下一次必须重新读取，不得继续沿用旧内存簿。
      throw bookError();
    }
    fs.mkdirSync(home(), { recursive: true });
    writeAtomic(bookFile(), JSON.stringify({ 言: "候 · 约好的时刻", ...next }, null, 1));
    book = next;
    for (const timer of retired) {
      retryAt.delete(timer.id);
      forgetClaim(`${firedFile(firedId(timer))}.taken`);
    }
  }
  /** @param {Timer} timer */
  const readyAt = timer => Math.max(timer.due, retryAt.get(timer.id) ?? timer.due);
  function arm() {
    clearTimeout(armed);
    if (!book.timers.length) return;
    const next = book.timers.reduce((at, timer) => Math.min(at, readyAt(timer)), Infinity);
    armed = setTimeout(fire, Math.min(MAX_DELAY, Math.max(0, next - Date.now())));
    armed.unref?.();
  }
  /** @param {Timer[]} timers @param {string} reason @param {unknown} error */
  function retry(timers, reason, error) {
    if (timers.some(timer => !retryAt.has(timer.id))) console.warn(`[${stamp()}] 候 · ${reason}，稍后重试`, error);
    const at = Date.now() + RETRY_MS;
    for (const timer of timers) retryAt.set(timer.id, at);
  }
  // 逐约投递：一回没写成不耽误别的。周期落一回，下一次排在实际投递后（睡过去的几回不补）。
  function fire() {
    try {
      sync();
      const now = Date.now(),
        /** @type {Timer[]} */
        timers = [],
        /** @type {Timer[]} */
        retired = [];
      for (const timer of book.timers) {
        if (readyAt(timer) > now) {
          timers.push(timer);
          continue;
        }
        try {
          // 对话已删的不叫，也不再排。
          const next = known(timer.to) ? post(timer, now) : undefined;
          if (next !== undefined) timers.push({ ...timer, due: next });
          retired.push(timer);
        } catch (error) {
          retry([timer], `${timer.id} 到点记录未能写成`, error);
          timers.push(timer);
        }
      }
      if (retired.length)
        try {
          save({ ...book, timers }, retired);
        } catch (error) {
          retry(retired, "约簿未能保存", error);
        }
    } finally {
      arm();
    }
  }
  /** @param {Timer} timer */
  function liveTimer(timer) {
    // 簿上仍可能是旧一回，但页面已经认领并显示了 next。查询沿用已投递的凭据，不把签拨回过去。
    if (timer.due <= Date.now() || retryAt.has(timer.id))
      try {
        const posted = receipt(firedFile(firedId(timer)));
        if (posted) return posted.next === undefined ? null : { ...timer, due: posted.next };
      } catch {} // 读不到凭据，不因此把仍在簿上的约说成已了结
    return timer;
  }
  const handleSet = route(body => {
    requireBook();
    const to = String(body.to || ""),
      due = Number(body.due),
      every = Number(body.every) || 0;
    if (!to) throw Error("缺少对话");
    if (!Number.isFinite(due)) throw Error("时刻无效");
    if (!Number.isFinite(every) || (every && every < 1000)) throw Error("every 至少 1 秒且须为有限数值");
    const seq = book.seq + 1,
      timer = {
        id: `t${seq}`,
        to,
        step: String(body.step || ""),
        note: String(body.note || "").slice(0, 2000),
        due,
        ...(every ? { every } : {}),
        created: Date.now()
      };
    save({ seq, timers: [...book.timers, timer] });
    arm();
    return timer;
  });
  // 取消簿上还排着的约定（包括周期约的下一回），不撤已经落盘的到点记录
  const handleCancel = route(body => {
    requireBook();
    const id = String(body.id || ""),
      timer = book.timers.find(item => item.id === id && (!body.to || item.to === body.to));
    const live = timer && liveTimer(timer);
    if (!live) return { found: false };
    save({ ...book, timers: book.timers.filter(item => item !== timer) }, [timer]);
    arm();
    return { found: true, timer: live };
  });
  const handleList = route(() => {
    requireBook();
    return { timers: book.timers.map(liveTimer).filter(Boolean) };
  });
  sync();

  return {
    sync,
    routes: {
      "POST /api/timer/set": handleSet,
      "POST /api/timer/cancel": handleCancel,
      "POST /api/timer/list": handleList,
      "POST /api/timer/wait": handleWait,
      "POST /api/timer/take": handleTake
    }
  };
};
