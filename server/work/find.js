// 言 · 桥接 · 执事的列与搜：列目录（一层层往下、glob）、按正则或原文逐行检索
// 由 server/work/index.js 装配；两样都照实说没列全、没搜全的地方，模型才不至于据此断言「没有」
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { jsonRoute } = require("../http.js");
const sandbox = require("../sandbox.js");
const { WORK_SKIP, clampNumber, relPath } = require("./paths.js");
const { decodeText } = require("./text.js");
const WORK_LIST_LIMIT = 300;

module.exports = function createFind(work) {
  const { failed, resolveWorkdir, targetOf, missingHint, shownPath, strictBox, storeRoot } = work;
  // 极简 glob：**/ 跨目录（末尾的 ** 是其下一切）、* 不跨目录、? 单字符、{a,b} 任一；没有 / 的模式只匹配文件名
  function globToRegExp(pattern) {
    const text = String(pattern || "")
      .trim()
      .replace(/\\/g, "/");
    if (!text) return null;
    let body = "",
      braces = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "*" && text[i + 1] === "*") {
        i += 1;
        if (text[i + 1] === "/") {
          i += 1;
          body += "(?:.*/)?";
        } else body += ".*";
      } else if (ch === "*") body += "[^/]*";
      else if (ch === "?") body += "[^/]";
      else if (ch === "{") {
        braces += 1;
        body += "(?:";
      } else if (ch === "}" && braces) {
        braces -= 1;
        body += ")";
      } else if (ch === "," && braces) body += "|";
      else body += ch.replace(/[.+^${}()|[\]]/g, "\\$&");
    }
    if (braces) return null;
    return new RegExp(`^${text.includes("/") ? "" : "(?:.*/)?"}${body}$`, "i");
  }
  // 一层一层往下列（先列完浅的一层再往深处去）：条目到上限时丢的是最深处，不会因为头一个子目录很大，根目录下的文件全没列出来。
  // 列完按路径排好，同一目录的挨在一起。进不去的大目录（node_modules、dist……）照列它自己，标上「未展开」
  async function listTree(base, depth, filter = null) {
    const out = [];
    let level = [base];
    for (let d = 1; d <= depth && level.length && out.length < WORK_LIST_LIMIT; d++) {
      const next = [];
      for (const dir of level) {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (out.length >= WORK_LIST_LIMIT) break;
          const full = path.join(dir, entry.name),
            rel = path.relative(base, full).split(path.sep).join("/");
          if (entry.isSymbolicLink()) {
            if (!filter) out.push({ rel, line: `${rel}@` });
            continue;
          } // 符号链接 / junction 只标出，不跟进：目标可能在工作目录之外
          if (entry.isDirectory()) {
            const skipped = WORK_SKIP.has(entry.name);
            if (!filter) out.push({ rel: `${rel}/`, line: `${rel}/${skipped && d < depth ? "\t未展开" : ""}` });
            if (!skipped) next.push(full);
          } else if (!filter || filter.test(rel)) {
            const size = await fs.promises
              .stat(full)
              .then(s => s.size)
              .catch(() => 0);
            out.push({ rel, line: `${rel}\t${size}` });
          }
        }
      }
      level = next;
    }
    return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)).map(item => item.line);
  }
  const handleWorkList = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      dir = await targetOf(workdir, body);
    const stat = await fs.promises.stat(dir).catch(() => null);
    if (!stat?.isDirectory())
      throw Error(
        stat ? `${body.path} 是文件，不是目录` : `目录不存在：${body.path || "."}${await missingHint(workdir, dir, strictBox(body))}`
      );
    const filter = globToRegExp(body.pattern);
    if (body.pattern && !filter) throw Error(`pattern 写得不完整（花括号没配对）：${body.pattern}`);
    const out = await listTree(dir, Math.floor(clampNumber(body.depth, filter ? 8 : 2, 1, 8)), filter);
    return { path: shownPath(workdir, dir) || ".", entries: out, truncated: out.length >= WORK_LIST_LIMIT };
  }, failed);
  // ---- search_files：在工作目录里按正则或原文逐行检索；跳过 node_modules 等目录与二进制、超大文件
  // 正则是模型写的：写成 (a+)+$ 这类会灾难性回溯的，一行就能把桥接卡死（单线程，所有对话一起停）。
  // 每个文件的逐行匹配放进 vm 跑、限两秒，超时即中止这次检索，把原因回给模型
  const SEARCH_REGEX_MS = 2000,
    searchScript = new vm.Script("hits = []; for (let i = 0; i < lines.length; i++) if (regex.test(lines[i])) hits.push(i);"),
    searchContext = vm.createContext({ regex: null, lines: null, hits: null });
  function matchLines(regex, lines, rel) {
    searchContext.regex = regex;
    searchContext.lines = lines;
    try {
      searchScript.runInContext(searchContext, { timeout: SEARCH_REGEX_MS });
      return searchContext.hits;
    } catch (error) {
      if (error?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT")
        throw Error(
          `正则在 ${rel} 上回溯过久（超过 ${SEARCH_REGEX_MS / 1000} 秒），已中止：请改写得更具体（避免 (a+)+ 这类嵌套的重复），或用 literal 按原文找`
        );
      throw error;
    } finally {
      searchContext.regex = searchContext.lines = searchContext.hits = null;
    }
  }
  const SEARCH_MATCH_LIMIT = 200,
    SEARCH_FILE_LIMIT = 4000,
    SEARCH_FILE_BYTES = 2 * 1024 * 1024,
    // 模型点名要搜的那一件（把它的路径当 path 给）：目录里顺手扫过的按上面那道，点名的放开到与写文件齐——
    // 只读这一件，且模型是照着结果的提示来点名的，卡住它就等于把那条提示写成死路
    SEARCH_ONE_BYTES = 32 * 1024 * 1024;
  const handleWorkSearch = jsonRoute(async body => {
    const workdir = resolveWorkdir(body.workdir),
      dir = await targetOf(workdir, body),
      boxed = strictBox(body);
    const query = String(body.query || "");
    if (!query.trim()) throw Error("query 不能为空");
    // 写不成正则的（url( 这类没转义的括号）按字面搜，并说一声
    const flags = body.caseSensitive === true ? "" : "i",
      literal = text => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    let regex,
      note = "";
    if (body.literal === true) regex = literal(query);
    else
      try {
        regex = new RegExp(query, flags);
      } catch (error) {
        regex = literal(query);
        note = `正则无效（${error.message}），已按字面搜`;
      }
    const filter = globToRegExp(body.glob);
    if (body.glob && !filter) throw Error(`glob 写得不完整（花括号没配对）：${body.glob}`);
    const limit = Math.floor(clampNumber(body.limit, 60, 1, SEARCH_MATCH_LIMIT));
    const stat = await fs.promises.stat(dir).catch(() => null);
    if (!stat) throw Error(`目录不存在：${body.path || "."}${await missingHint(workdir, dir, boxed)}`);
    const matches = [],
      // 没进去的大目录：结果里说一声，零命中时模型才不至于断言「没有」
      skipped = new Set();
    let scanned = 0,
      filesHit = new Set(),
      truncated = false,
      limited = false,
      // 跳过的也记个数：超大、看着是二进制的、读不出来的。零命中时一并说，
      // 不然模型会当整片目录都找过了（以前超过 2 MB 的直接跳过，一声不吭）
      large = 0,
      binary = 0,
      unread = 0;
    // 搜一件：rel 是它相对于搜索起点的路径（glob 与沙箱筛查按它认）；explicit＝模型点名只搜这一件
    const scanFile = async (full, rel, explicit = false) => {
      if (boxed && sandbox.screenPath(rel)) return; // 沙箱不借检索带出机密文件
      if (sandbox.screenStorePath(full, storeRoot())) return; // 存储根的配置与登录文件，不论档位
      if (++scanned > SEARCH_FILE_LIMIT) {
        truncated = limited = true;
        return;
      }
      const size = await fs.promises
        .stat(full)
        .then(s => s.size)
        .catch(() => 0);
      if (!size) return;
      if (size > (explicit ? SEARCH_ONE_BYTES : SEARCH_FILE_BYTES)) {
        large += 1;
        return;
      }
      const buffer = await fs.promises.readFile(full).catch(() => null),
        decoded = buffer && decodeText(buffer);
      if (!decoded) {
        if (buffer) binary += 1;
        else unread += 1;
        return;
      }
      const lines = decoded.text.split(/\r?\n/);
      for (const i of matchLines(regex, lines, rel)) {
        filesHit.add(rel);
        matches.push({ file: shownPath(workdir, full), line: i + 1, text: lines[i].trim().slice(0, 240) });
        if (matches.length >= limit) {
          truncated = true;
          return;
        }
      }
    };
    const walk = async current => {
      if (truncated) return;
      const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (truncated) return;
        const full = path.join(current, entry.name),
          rel = relPath(dir, full);
        if (entry.isSymbolicLink()) continue; // 不顺着链接读：链接指向目录外时，检索会把外面的内容带进来
        if (entry.isDirectory()) {
          if (!WORK_SKIP.has(entry.name)) await walk(full);
          else skipped.add(entry.name);
          continue;
        }
        if (filter && !filter.test(rel)) continue;
        await scanFile(full, rel);
      }
    };
    // 给的是一件文件：就搜这一件（模型常把要查的那个文件当 path 给），不受目录里那道上限的约束
    if (stat.isDirectory()) await walk(dir);
    else await scanFile(dir, path.basename(dir), true);
    return {
      path: shownPath(workdir, dir) || ".",
      matches,
      files: filesHit.size,
      scanned: Math.min(scanned, SEARCH_FILE_LIMIT),
      truncated,
      ...(limited ? { limited: SEARCH_FILE_LIMIT } : {}),
      ...(skipped.size ? { skipped: [...skipped].sort() } : {}),
      ...(large ? { large } : {}),
      ...(binary ? { binary } : {}),
      ...(unread ? { unread } : {}),
      ...(note ? { note } : {})
    };
  }, failed);
  return {
    "POST /api/work/list": handleWorkList,
    "POST /api/work/search": handleWorkSearch
  };
};
