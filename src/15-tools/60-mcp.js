// 言 · MCP：把设置里接入的 MCP 服务的工具登记进注册表。连接、握手与协议细节都在桥接那头（server/mcp/），这里只管三件事：
// 拉来各服务的工具、按体量决定怎么交给模型、调用时照三档权限请示。
// 小服务逐件摊开，与内置工具无异；工具多、定义重的按需给——模型只见一张目录，外加 mcp_describe（查参数）与 mcp_call（调用）两件，
// 每一问只多背一张目录。接一个没见过的服务只需在设置里添一条配置，这里不用改
/**
 * @typedef {{ name: string, title?: string, description?: string, inputSchema: Record<string, any>, annotations?: Record<string, any> }} McpToolSpec
 * @typedef {{ ok: boolean, error?: string, tools?: McpToolSpec[], instructions?: string, server?: Record<string, any> }} McpServerState
 */
// 一个服务的工具定义超过这么多字就按需给（配置里写 load: "inline" 或 "lazy" 可以指定）
const MCP_INLINE_LIMIT = 12000;
/** @type {{ key: string, loading: Promise<void>|null, servers: Record<string, McpServerState>, lazy: string[] }} */
const mcp = { key: "", loading: null, servers: {}, lazy: [] };

/** 设置里的全部配置：{ 名字: { command, args, cwd, env } 或 { url, headers, type }，另可带 disabled / autoApprove / timeout / load } */
function mcpConfigs() {
  return store.settings.mcpServers;
}
function mcpActiveConfigs() {
  return Object.fromEntries(Object.entries(mcpConfigs()).filter(([, config]) => !config.disabled));
}
// 配置变了（或还没拉过）就去桥接那头拉一遍；发请求前先等它，头一问就带得上。restart 里的服务断开重连
function mcpReady(restart = []) {
  if (apiBase === null) return Promise.resolve();
  const servers = mcpActiveConfigs(),
    key = JSON.stringify(servers);
  if (key === mcp.key && !restart.length) return mcp.loading || Promise.resolve();
  mcp.key = key;
  const loading = bridge("/api/mcp/list", { servers, restart }, AbortSignal.timeout(90000))
    .then(
      data => (mcp.servers = data.servers),
      error => {
        // 桥接本身不认（旧桥接没有这个接口）或没回话：记下原因，下次再试
        mcp.key = "";
        mcp.servers = Object.fromEntries(Object.keys(servers).map(name => [name, { ok: false, error: String(error.message || error) }]));
      }
    )
    .then(() => {
      if (mcp.loading !== loading) return;
      registerMcpTools();
      renderMcpStatus();
    });
  mcp.loading = loading;
  return loading;
}
function registerMcpTools() {
  for (const [name, tool] of TOOLS) if (tool.mcp) TOOLS.delete(name);
  mcp.lazy = [];
  for (const [server, state] of Object.entries(mcp.servers)) {
    if (!state.ok) continue;
    const load = mcpConfigs()[server]?.load;
    if (load === "lazy" || (load !== "inline" && JSON.stringify(state.tools).length > MCP_INLINE_LIMIT)) mcp.lazy.push(server);
    else for (const spec of state.tools) defineTool(mcpInlineTool(server, spec));
  }
  if (mcp.lazy.length) MCP_LAZY_TOOLS.forEach(defineTool);
}
/** @param {McpToolSpec} spec */
function mcpReadOnly(spec) {
  return spec.annotations?.readOnlyHint === true;
}
// 逐件摊开的：名字写成 mcp__服务__工具（接口只认字母数字与 _-，最长 64），说明与参数用服务端自带的
/**
 * @param {McpToolSpec} spec
 * @returns {Tool}
 */
function mcpInlineTool(server, spec) {
  const readOnly = mcpReadOnly(spec);
  return {
    name: mcpFunctionName(server, spec.name),
    label: server,
    mcp: true,
    server,
    schema: { description: spec.description || spec.title || spec.name, parameters: spec.inputSchema },
    offer: ctx => ctx.bridge,
    lookup: readOnly,
    parallel: readOnly,
    sideEffect: !readOnly,
    approval: mcpApprovalHtml,
    digest: /** @type {true} */ (true),
    run: (step, args, ctx) => runMcpTool(step, server, spec.name, args, ctx)
  };
}
function mcpFunctionName(server, tool) {
  const clean = text => text.replace(/[^A-Za-z0-9_-]/g, "");
  const name = `mcp__${clean(server) || `s${hashText(server).slice(0, 6)}`}__${clean(tool) || hashText(tool).slice(0, 6)}`;
  return name.length <= 64 ? name : `${name.slice(0, 57)}_${hashText(name).slice(0, 6)}`;
}

/** @type {Tool[]} 按需给的两件：目录写在 mcp_describe 的说明里 */
const MCP_LAZY_TOOLS = [
  {
    name: "mcp_describe",
    label: "MCP",
    mcp: true,
    offer: ctx => ctx.bridge && mcpLazyServers(ctx.preset).length > 0,
    vars: ctx => ({ directory: mcpDirectory(ctx.preset) }),
    parallel: true,
    cache: true,
    run(step, args, ctx) {
      const state = mcpLazyServers(presetOf(ctx.conversation)).includes(args.server) ? mcp.servers[args.server] : null;
      step.title = `${args.server} · ${args.tools.join("、")}`;
      if (!state?.ok) return mcpUnknown(args.server, "");
      const found = args.tools.map(name => state.tools.find(tool => tool.name === name)).filter(Boolean);
      if (!found.length) return mcpUnknown(args.server, args.tools.join("、"));
      const text = found
        .map(
          tool =>
            `## ${tool.name}${mcpReadOnly(tool) ? "（只读）" : ""}\n${tool.description || tool.title || ""}\n参数：${JSON.stringify(tool.inputSchema)}`
        )
        .join("\n\n");
      step.output = trimOutput(text);
      return { ok: true, content: text, display: `${found.length} 件` };
    }
  },
  {
    name: "mcp_call",
    label: "MCP",
    mcp: true,
    offer: ctx => ctx.bridge && mcpLazyServers(ctx.preset).length > 0,
    sideEffect: true,
    approval: mcpApprovalHtml,
    digest: true,
    run(step, args, ctx) {
      const spec = mcp.servers[args.server]?.tools?.find(tool => tool.name === args.tool);
      step.title = `${args.server} · ${args.tool}`;
      if (!spec) return mcpUnknown(args.server, args.tool);
      // 外层只核了 server / tool；params 对着目标工具自己的参数表再理一遍
      const { args: inner, problems } = normalizeArguments(spec.inputSchema, args.params);
      if (problems.length)
        return {
          ok: false,
          content: prompt("mcp.badArgs", {
            server: args.server,
            tool: args.tool,
            problems: problems.join("；"),
            hint: schemaHint(spec.inputSchema)
          }),
          display: "参数不合要求"
        };
      return runMcpTool(step, args.server, args.tool, inner, ctx);
    }
  }
];
// 按需给的服务里，预设挑中的那几个
/** @param {Preset|null} preset */
function mcpLazyServers(preset) {
  return mcp.lazy.filter(server => !preset?.mcp || preset.mcp.includes(server));
}
// 目录：一服务一段，一件一行（名字与说明的头一句）；只读的标出来
/** @param {Preset|null} preset */
function mcpDirectory(preset) {
  return mcpLazyServers(preset)
    .map(server => {
      const state = mcp.servers[server],
        head = [state.server?.title || state.server?.name, state.server?.description].filter(Boolean).join("：");
      const lines = state.tools.map(tool => {
        const first = String(tool.description || tool.title || "")
          .split("\n")[0]
          .trim()
          .slice(0, 60);
        return `- ${tool.name}${mcpReadOnly(tool) ? "（只读）" : ""}${first ? `：${first}` : ""}`;
      });
      return `【${server}】${head}\n${lines.join("\n")}`;
    })
    .join("\n");
}
function mcpUnknown(server, tool) {
  const state = mcp.servers[server];
  const known = state?.ok
    ? `${server} 有：${state.tools.map(t => t.name).join("、")}`
    : `已接入的服务：${
        Object.keys(mcp.servers)
          .filter(name => mcp.servers[name].ok)
          .join("、") || "无"
      }`;
  return { ok: false, content: prompt("mcp.unknown", { server, tool, known }), display: "未找到" };
}
// 调一件：服务标了只读的径直跑；其余在「问而后行」里请示一声（配置 autoApprove 里列了的免问），另两档照跑
/**
 * @param {Step} step
 * @param {ToolContext} ctx
 */
async function runMcpTool(step, server, tool, args, ctx) {
  const config = mcpConfigs()[server],
    spec = mcp.servers[server]?.tools?.find(item => item.name === tool);
  // 预设没挑这个服务：照着名字调来的也不跑
  if (!config || !spec || !presetAllows(presetOf(ctx.conversation), /** @type {Tool} */ ({ server }))) return mcpUnknown(server, tool);
  step.title ||= spec.title || tool;
  step.code = JSON.stringify(args, null, 2);
  const ask = !mcpReadOnly(spec) && commandPolicyOf(ctx.conversation) === "ask" && !(config.autoApprove || []).includes(tool);
  if (ask && !(await askApproval(step, ctx, "执行中"))) {
    step.skipped = true;
    return { ok: false, content: prompt("mcp.skipped"), display: "已跳过" };
  }
  const data = await bridge("/api/mcp/call", { server, config, tool, arguments: args, timeout: config.timeout }, ctx.signal);
  // 服务说工具变了：下一问前重拉
  if (data.toolsChanged) mcp.key = "";
  const text = mcpResultText(data.result);
  step.output = trimOutput(text);
  return { ok: !data.result.isError, content: text, display: data.result.isError ? "出错" : `${text.length} 字` };
}
// 请示条：哪个服务的哪件工具、带什么参数；按钮与指令的请示同一套（径行即此对话此后不再问）
/** @param {Step} step */
function mcpApprovalHtml(step) {
  const where = step.name === "mcp_call" ? step.title : `${toolLabel(step.name)} · ${step.title}`;
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">问</span><span class="approval-title">MCP 请示 · ${escapeHtml(where)}</span><span class="approval-hint" title="输入框留空时，Enter 即运行">Enter 运行</span></div><pre class="approval-cmd">${escapeHtml(step.code || "{}")}</pre><div class="approval-actions"><button type="button" data-approve="run">运行</button><button type="button" data-approve="skip">跳过</button><button type="button" data-approve="auto" title="径行：此对话中后续调用不再询问">径行</button></div>`;
}
// 结果的几种内容合成一段文字：文本照录；图片、音频、资源只写一行说明（不把 base64 塞给模型）；只有结构化结果的给 JSON
function mcpResultText(result) {
  const parts = (result.content || []).map(item =>
    item.type === "text"
      ? item.text
      : item.type === "image" || item.type === "audio"
        ? `[${item.type === "image" ? "图片" : "音频"} ${item.mimeType}，约 ${formatFileSize(Math.round(item.data.length * 0.75))}，未随结果转交]`
        : item.type === "resource_link"
          ? `[资源 ${item.name || ""} ${item.uri}]`
          : item.type === "resource"
            ? (item.resource.text ?? `[资源 ${item.resource.uri}（${item.resource.mimeType || "二进制"}）]`)
            : JSON.stringify(item)
  );
  if (!parts.length && result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
  return parts.join("\n\n") || "（无输出）";
}
// 系统提示里 mcp.hint 那一段的值：交给模型的工具里有哪几个服务的，就附上那几个服务自带的用法；一个都没有就不带这段
/** @param {Set<string>} names @param {Preset|null} preset */
function mcpHintVars(names, preset) {
  const lazy = names.has("mcp_call") ? mcpLazyServers(preset) : [];
  const servers = Object.entries(mcp.servers).filter(
    ([server, state]) =>
      state.ok &&
      state.instructions &&
      (mcp.lazy.includes(server) ? lazy.includes(server) : state.tools.some(tool => names.has(mcpFunctionName(server, tool.name))))
  );
  return servers.length
    ? { servers: servers.map(([server, state]) => `【${server}】${state.instructions.trim().slice(0, 1500)}`).join("\n") }
    : null;
}
