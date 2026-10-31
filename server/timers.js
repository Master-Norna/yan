// 言 · 桥接的候 · 等时刻：模型约好几点叫醒自己（set_timer），桥接记着，到点把那一回落进 存储根/候/到点/ 再交给页面——
// 页面关着、桥接重启都不丢。由 server.js 装配：require("./server/timers.js")({ home, known })
//   约.json         约好的时刻：几点叫、叫哪段对话的哪一步、附什么话、隔多久再叫。启动时读回，错过的当场补叫并记下迟了多久
//   到点/<编号>.json 到了点、还没被页面取走的那一回；页面经 /api/timer/wait 等着、/api/timer/take 认领（改名即认领，几页同等也只一页拿到）
// 定时放在桥接而不交系统的计划任务：到点的那一回本就要经桥接送进页面，桥接不在，到点也送不到
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { jsonRoute, readJson, requestSignal, sendJson, writeAtomic } = require("./http.js");

// setTimeout 至多等这么久（约 24.8 天），再远的到时候再排一回
const MAX_DELAY = 2 ** 31 - 1;
// 页面的长等：这么久没有新的就空手回，页面随即再等——顺带让它重新看一眼先前跳过的（那时那段对话别处正在答）
const WAIT_MS = 60000;

/** @param {{ home: () => string, known: (id: string) => boolean }} options */
module.exports = function createTimers({ home, known }) {
  const firedDir = () => path.join(home(), "到点"),
    bookFile = () => path.join(home(), "约.json");
  /** @type {Set<() => void>} 正等着的页面 */
  const waiters = new Set();

  // ---------- 到点的那一回：落盘、等、认领 ----------
  /** @param {Record<string, any>} fired */
  function post(fired) {
    const full = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...fired };
    fs.mkdirSync(firedDir(), { recursive: true });
    writeAtomic(path.join(firedDir(), `${full.id}.json`), JSON.stringify(full));
    for (const wake of [...waiters]) wake();
  }
  function pending() {
    let names = [];
    try {
      names = fs.readdirSync(firedDir()).filter(name => name.endsWith(".json"));
    } catch {}
    const list = [];
    for (const name of names)
      try {
        list.push(JSON.parse(fs.readFileSync(path.join(firedDir(), name), "utf8")));
      } catch {}
    return list.sort((a, b) => a.at - b.at);
  }
  // 认领：改名成功的才算拿到，再删；几页同时认领同一回，只有一页改名得手
  function take(ids) {
    const taken = [];
    for (const id of ids) {
      if (!/^[\w-]{1,40}$/.test(id)) continue;
      const file = path.join(firedDir(), `${id}.json`),
        claimed = `${file}.${process.pid}.taken`;
      try {
        fs.renameSync(file, claimed);
        taken.push(JSON.parse(fs.readFileSync(claimed, "utf8")));
      } catch {}
      fs.rmSync(claimed, { force: true });
    }
    return taken;
  }
  // 页面等着：有没被跳过的就当场回，没有就挂着，有新的到点或等满一分钟再回
  async function handleWait(req, res) {
    const body = await readJson(req).catch(() => ({})),
      skip = new Set(Array.isArray(body.skip) ? body.skip.map(String) : []),
      fresh = () => pending().filter(item => !skip.has(item.id)),
      signal = requestSignal(res);
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
    fired = fired.length ? fired : fresh();
    sendJson(res, 200, { fired });
  }
  const handleTake = jsonRoute(body => ({ fired: take(Array.isArray(body.ids) ? body.ids.map(String) : []) }));

  // ---------- 约好的时刻 ----------
  /** @type {{ seq: number, timers: Array<{ id: string, to: string, step: string, note: string, due: number, every?: number, created: number }> }} */
  let book = { seq: 0, timers: [] },
    bookAt = "";
  // 约.json 随存储根：换了存储位置，读那边的一份重排，不把这边的带过去盖掉它
  function sync() {
    if (bookAt === bookFile()) return;
    bookAt = bookFile();
    book = { seq: 0, timers: [] };
    try {
      const saved = JSON.parse(fs.readFileSync(bookAt, "utf8"));
      if (saved && Array.isArray(saved.timers)) book = { seq: Number(saved.seq) || 0, timers: saved.timers };
    } catch {}
    arm();
  }
  let armed = null;
  function save() {
    fs.mkdirSync(home(), { recursive: true });
    writeAtomic(bookFile(), JSON.stringify({ 言: "候 · 约好的时刻", ...book }, null, 1));
  }
  function arm() {
    clearTimeout(armed);
    if (!book.timers.length) return;
    const next = Math.min(...book.timers.map(timer => timer.due));
    armed = setTimeout(fire, Math.min(MAX_DELAY, Math.max(0, next - Date.now())));
    armed.unref?.();
  }
  // 到点的各落一回给那段对话；隔一阵再叫的排到此后头一个时刻（睡过去的几回不补，只记迟了多久）
  function fire() {
    sync();
    const now = Date.now();
    let changed = false;
    for (const timer of [...book.timers]) {
      if (timer.due > now) continue;
      changed = true;
      // 那段对话已删了（别处删的，这边没来得及取消）：不叫，也不再排
      if (!known(timer.to)) {
        book.timers = book.timers.filter(item => item !== timer);
        continue;
      }
      const due = timer.due;
      if (timer.every) timer.due += timer.every * Math.max(1, Math.ceil((now - timer.due + 1) / timer.every));
      else book.timers = book.timers.filter(item => item !== timer);
      // next：隔一阵再叫的下一回（页面据它改签上的时刻）
      post({
        to: timer.to,
        timer: {
          id: timer.id,
          step: timer.step,
          note: timer.note,
          due,
          late: now - due,
          ...(timer.every ? { every: timer.every, next: timer.due } : {})
        }
      });
    }
    if (changed) save();
    arm();
  }
  const handleSet = jsonRoute(body => {
    sync();
    const to = String(body.to || ""),
      due = Number(body.due),
      every = Number(body.every) || 0;
    if (!to) throw Error("缺少对话");
    if (!Number.isFinite(due)) throw Error("时刻无效");
    if (every && every < 1000) throw Error("every 至少 1 秒");
    const timer = {
      id: `t${++book.seq}`,
      to,
      step: String(body.step || ""),
      note: String(body.note || "").slice(0, 2000),
      due,
      ...(every ? { every } : {}),
      created: Date.now()
    };
    book.timers.push(timer);
    save();
    arm();
    return timer;
  });
  // 取消：到点前叫停；没有的（已叫过、已取消）回 found: false
  const handleCancel = jsonRoute(body => {
    sync();
    const id = String(body.id || ""),
      timer = book.timers.find(item => item.id === id && (!body.to || item.to === body.to));
    if (!timer) return { found: false };
    book.timers = book.timers.filter(item => item !== timer);
    save();
    arm();
    return { found: true, timer };
  });
  const handleList = jsonRoute(() => {
    sync();
    return { timers: book.timers };
  });
  sync();

  return {
    routes: {
      "POST /api/timer/set": handleSet,
      "POST /api/timer/cancel": handleCancel,
      "POST /api/timer/list": handleList,
      "POST /api/timer/wait": handleWait,
      "POST /api/timer/take": handleTake
    }
  };
};
