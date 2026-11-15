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
  /** @returns {Record<string, Record<string, number>>} */
  function read() {
    try {
      const days = parseJsonText(fs.readFileSync(file(), "utf8"))?.days;
      return days && typeof days === "object" ? days : {};
    } catch {
      return {};
    }
  }
  // 读、加、写在同一拍里做完（中间没有 await），两页同时报也不会互相盖掉
  const handleAdd = jsonRoute(
    async body => {
      const days = read();
      let changed = false;
      for (const { day, kind, amount } of Array.isArray(body.items) ? body.items : []) {
        const n = Math.round(Number(amount));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day)) || !KINDS.includes(kind) || !(n > 0) || n > 1e10) continue;
        const row = (days[day] ||= {});
        row[kind] = (Number(row[kind]) || 0) + n;
        changed = true;
      }
      if (changed) {
        fs.mkdirSync(path.dirname(file()), { recursive: true });
        writeAtomic(file(), JSON.stringify({ 言: "用量", days }, null, 1));
      }
      return { ok: true };
    },
    error => `用量未能记下：${errorText(error, 200)}`
  );
  const handleRead = jsonRoute(async () => ({ days: read() }));
  return {
    routes: {
      "POST /api/usage/add": handleAdd,
      "POST /api/usage/read": handleRead
    }
  };
};
