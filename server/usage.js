// 言 · 用量簿：存储根下的 用量.json，按日记各类花了多少——主答（拟题、整理前文随它）、帮手、旁注、审查记墨（token），生图记张数。
// 页面只报增量，桥接一人往上加：几页同开也不必合并（配置里的余墨靠三方合并，认错基准就翻倍，见 src/01-store/20-config.js）。
// 余墨照旧记在模型上；这本只给 设置 → 模型 顶上的用量卡看，丢一两笔无妨
// 由 server.js 装配：require("./server/usage.js")({ file })——file 随存储根走
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { jsonRoute, writeAtomic, parseJsonText, errorText } = require("./http.js");

const KINDS = ["main", "helper", "side", "review", "image"];

/** @param {{ file: () => string }} options */
module.exports = function createUsage({ file }) {
  // 把批次回执和日用量写进同一次原子替换：桥接已记账、页面没收到 ACK 时，
  // 页面重试同一个 batchId 不再重复入账。旧的只有 days 的文件仍能读。
  function read(target) {
    try {
      const saved = parseJsonText(fs.readFileSync(target, "utf8")) || {};
      return {
        days: saved.days && typeof saved.days === "object" ? saved.days : {},
        batches: Array.isArray(saved.batches) ? saved.batches : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { days: {}, batches: [] };
    }
  }
  // 同一存储根短时间到达的批次一起记账；写盘成功才确认，仍是原来的原子提交语义。
  const pending = new Map();
  function flush(target) {
    const group = pending.get(target);
    if (!group) return;
    pending.delete(target);
    clearTimeout(group.timer);
    try {
      const state = read(target),
        results = [];
      let dirty = false;
      for (const item of group.items) {
        const result = apply(state, item.body);
        dirty ||= result.changed;
        results.push(result.duplicate ? { ok: true, duplicate: true } : { ok: true });
      }
      if (dirty) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        writeAtomic(target, JSON.stringify({ 言: "用量", ...state }, null, 1));
      }
      group.items.forEach((item, i) => item.resolve(results[i]));
    } catch (error) {
      for (const item of group.items) item.reject(error);
    }
  }
  function apply(state, body) {
    const days = state.days;
    const batchId = typeof body.batchId === "string" && /^[\w-]{1,100}$/.test(body.batchId) ? body.batchId : "";
    if (batchId && state.batches.includes(batchId)) return { changed: false, duplicate: true };
    let changed = false;
    for (const { day, kind, amount } of Array.isArray(body.items) ? body.items : []) {
      const n = Math.round(Number(amount));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !KINDS.includes(kind) || !(n > 0) || n > 1e10) continue;
      const row = (days[day] ||= {});
      row[kind] = (Number(row[kind]) || 0) + n;
      changed = true;
    }
    // 只记最近的批次回执，防止长期运行下用量簿无限增长。
    if (changed && batchId) state.batches = [...state.batches.slice(-9999), batchId];
    return { changed, duplicate: false };
  }
  const handleAdd = jsonRoute(
    body =>
      new Promise((resolve, reject) => {
        const target = file();
        let group = pending.get(target);
        if (!group) {
          group = { items: [], timer: setTimeout(() => flush(target), 25) };
          pending.set(target, group);
        }
        group.items.push({ body, resolve, reject });
        if (group.items.length >= 64) flush(target);
      }),
    error => `用量未能记下：${errorText(error, 200)}`
  );
  const handleRead = jsonRoute(async () => {
    const target = file();
    flush(target);
    return { days: read(target).days };
  });
  return {
    routes: {
      "POST /api/usage/add": handleAdd,
      "POST /api/usage/read": handleRead
    }
  };
};
