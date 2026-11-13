// 言 · MCP 服务池：按设置里的配置起、连各个 MCP 服务，接口只有两个——
//   POST /api/mcp/list  { servers: { 名字: 配置 }, restart?: [名字] }  → 各服务的工具、说明，或连不上的原因
//   POST /api/mcp/call  { server, config, tool, arguments, timeout? }   → 那件工具的结果
// 配置照通行的 mcpServers 写法：本机进程给 command / args / cwd / env，远端给 url / headers（旧式 SSE 另写 type: "sse"）。
// 连接按名字复用，连接相关的几项变了就重连；进程随桥接退出一并结束
"use strict";
const { sendJson, readJson, jsonRoute, requestSignal, errorText } = require("../http.js");
const fs = require("node:fs");
const path = require("node:path");
const { McpClient } = require("./client.js");

// stage：游目自己的浏览器只递几项选择，由桥接拼成整条（见 server/stage.js 的 prepareMcp）
const CONNECTION_KEYS = ["command", "args", "cwd", "env", "url", "headers", "type", "transport", "stage"];
// 服务把图存进了文件、只回一条链接（Playwright 截图时模型给了 filename 就是这样：图落盘，回一行「- [Screenshot](./x.png)」）：
// 读出来补进结果，页面照有图处理。只认本机进程的服务（路径按它的工作目录解析，言不给 roots，它也以此为准）、
// 链到确实存在的图片文件、不过 8MB、至多四张；结果里本就有图的不补
const LINKED_IMAGES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
async function attachLinkedImages(result, config) {
  const content = result?.content;
  if (!config?.command || !Array.isArray(content) || content.some(item => item?.type === "image")) return;
  const text = content
    .filter(item => item?.type === "text")
    .map(item => item.text)
    .join("\n");
  const files = new Set();
  for (const [, target] of text.matchAll(/\]\(([^)\n]+?\.(?:png|jpe?g|webp|gif))\)/gi)) {
    if (files.size >= 4) break;
    files.add(path.resolve(config.cwd || process.cwd(), target.trim()));
  }
  for (const file of files)
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
      content.push({
        type: "image",
        mimeType: LINKED_IMAGES[path.extname(file).toLowerCase()],
        data: (await fs.promises.readFile(file)).toString("base64")
      });
    } catch {}
}

module.exports = function createMcp({ version, toolEnv, prepare = config => config }) {
  /** @type {Map<string, { key: string, client: McpClient, ready: Promise<McpClient> }>} */
  const clients = new Map();
  const keyOf = config => JSON.stringify(CONNECTION_KEYS.map(key => config[key]));

  function ensure(name, config) {
    const key = keyOf(config);
    let entry = clients.get(name);
    if (entry && (entry.key !== key || entry.client.closed)) {
      entry.client.close();
      entry = null;
    }
    if (!entry) {
      // 起之前可再补几项（游目要的浏览器接法，见 server/stage.js 的 prepareBrowser）；缓存仍按人写的配置认
      const client = new McpClient({ name, config: prepare(config), version, toolEnv });
      entry = { key, client, ready: client.connect() };
      // 连不上的收掉，下次用到时重来
      entry.ready.catch(() => client.close());
      clients.set(name, entry);
    }
    return entry;
  }
  function drop(name) {
    clients.get(name)?.client.close();
    clients.delete(name);
  }

  const handleList = jsonRoute(
    async ({ servers = {}, restart = [] }) => {
      for (const name of [...clients.keys()]) if (!servers[name] || restart.includes(name)) drop(name);
      const names = Object.keys(servers);
      const settled = await Promise.allSettled(names.map(name => ensure(name, servers[name]).ready));
      const out = {};
      for (const [i, result] of settled.entries()) {
        const name = names[i];
        if (result.status === "rejected") {
          out[name] = { ok: false, error: String(result.reason?.message || result.reason) };
          continue;
        }
        const client = result.value;
        // 服务报过工具变了：交回页面的必须是变后的那一份。调用时内部重拉的那一份页面还没拿到，不算交接完，
        // 所以这里把标记兑现成一次重拉（拉的时候又变了就再来一回，至多两回）
        for (let round = 0; round < 2 && client.toolsChanged; round++) {
          client.toolsChanged = false;
          try {
            client.tools = await client.listTools();
          } catch {
            client.toolsChanged = true; // 拉不到：留着旧表与标记，下一回再试
            break;
          }
        }
        out[name] = {
          ok: true,
          server: client.server,
          instructions: client.instructions,
          tools: client.tools.map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations
          }))
        };
      }
      return { servers: out };
    },
    error => errorText(error, Infinity)
  );

  async function handleCall(req, res) {
    // 页面那头停了（用户按了停止）：连接一断，就告诉服务端取消这次调用；还在等连接、等工具清单时停的，就不发了
    const signal = requestSignal(res);
    try {
      const body = await readJson(req);
      const client = await ensure(body.server, body.config).ready;
      const result = await client.call(body.tool, body.arguments || {}, {
        // setTimeout 超过 2^31-1 毫秒会溢出成立刻到时：封顶
        timeout: Number(body.timeout) > 0 ? Math.min(Number(body.timeout) * 1000, 2 ** 31 - 1) : undefined,
        signal
      });
      // 补图用实际起连接的那一份配置：游目只递几项选择，command / cwd 是 prepareMcp 展开后挂进 client.config 的，
      // 拿原始选择项（没有 command）会直接跳过，命名截图就只剩一行链接
      await attachLinkedImages(result, client.config);
      sendJson(res, 200, { result, toolsChanged: client.toolsChanged });
    } catch (error) {
      if (!res.destroyed) sendJson(res, 400, { error: String(error.message || error) });
    }
  }

  process.on("exit", () => {
    for (const { client } of clients.values()) client.close();
  });

  return { routes: { "POST /api/mcp/list": handleList, "POST /api/mcp/call": handleCall } };
};
