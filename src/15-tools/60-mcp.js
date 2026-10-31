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
/** @type {{ key: string, loading: Promise<void>|null, servers: Record<string, McpServerState>, lazy: string[], retryAt: number, waitWarned: boolean }} */
const mcp = { key: "", loading: null, servers: {}, lazy: [], retryAt: 0, waitWarned: false };

/** 设置里的全部配置：{ 名字: { command, args, cwd, env } 或 { url, headers, type }，另可带 disabled / autoApprove / timeout / load / note } */
// 游目自己的浏览器在 MCP 里的名字（设置 → 游目里开着才有，见 src/26-stage/40-settings.js）
const STAGE_SERVER = "游目";
// 人在设置 → MCP 里接的
function mcpUserConfigs() {
  return store.settings.mcpServers;
}
// 运行时认的：人接的，加上游目自己的浏览器（设置 → 游目里开着时，名叫「游目」，见 src/26-stage/40-settings.js）
function mcpConfigs() {
  const builtin = stageBuiltinConfig();
  return builtin ? { ...store.settings.mcpServers, [STAGE_SERVER]: builtin } : store.settings.mcpServers;
}
function mcpActiveConfigs() {
  return Object.fromEntries(Object.entries(mcpConfigs()).filter(([, config]) => !config.disabled));
}
// 配置变了（或还没拉过）就去桥接那头拉一遍；发请求前先等它，头一问就带得上。restart 里的服务断开重连
function mcpReady(restart = []) {
  const servers = mcpActiveConfigs(),
    key = JSON.stringify(servers);
  if (key === mcp.key && !restart.length && (mcp.loading || !mcp.retryAt || Date.now() < mcp.retryAt))
    return mcp.loading || Promise.resolve();
  if (key !== mcp.key) {
    mcp.loading = null;
    mcp.servers = {};
    registerMcpTools();
    renderMcpStatus();
  }
  mcp.key = key;
  mcp.retryAt = 0;
  mcp.waitWarned = false;
  if (!Object.keys(servers).length) return Promise.resolve();
  const loading = bridge("/api/mcp/list", { servers, restart }, AbortSignal.timeout(90000))
    .then(
      data => {
        if (mcp.loading !== loading) return;
        mcp.servers = data.servers || {};
        if (Object.values(mcp.servers).some(state => !state.ok)) mcp.retryAt = Date.now() + 30000;
      },
      error => {
        if (mcp.loading !== loading) return;
        // 桥接本身不认或没回话：记下原因，下一问到期再试
        mcp.retryAt = Date.now() + 30000;
        mcp.servers = Object.fromEntries(Object.keys(servers).map(name => [name, { ok: false, error: String(error.message || error) }]));
      }
    )
    .then(() => {
      if (mcp.loading !== loading) return;
      mcp.loading = null;
      registerMcpTools();
      renderMcpStatus();
    });
  mcp.loading = loading;
  return loading;
}
// 首问等一个短窗口；慢或坏掉的外部服务不应挡住内置工具与正文。
async function mcpForTurn() {
  const loading = mcpReady();
  if (!mcp.loading) return loading;
  let timer;
  const ready = await Promise.race([loading.then(() => true), new Promise(resolve => (timer = setTimeout(() => resolve(false), 10000)))]);
  clearTimeout(timer);
  if (!ready && !mcp.waitWarned) {
    mcp.waitWarned = true;
    toast(t("外部服务仍在连接，本问先使用已就绪的工具"));
  }
}
function registerMcpTools() {
  for (const [name, tool] of TOOLS) if (tool.mcp) TOOLS.delete(name);
  mcp.lazy = [];
  for (const [server, state] of Object.entries(mcp.servers)) {
    if (!state.ok) continue;
    const load = mcpConfigs()[server]?.load;
    if (load === "lazy" || (load !== "inline" && JSON.stringify(state.tools).length > MCP_INLINE_LIMIT)) mcp.lazy.push(server);
    else
      for (const spec of uniqueBy(state.tools, spec => spec.name)) {
        const tool = mcpInlineTool(server, spec);
        // 名字只留得下字母数字：read.file 与 readfile 会撞成同一个，后来的添个尾巴，不把先来的盖掉（不撞的名字照旧，旧行迹认得出）
        if (TOOLS.has(tool.name)) tool.name = `${tool.name.slice(0, 57)}_${nameHash(`${server}:${spec.name}`)}`;
        defineTool(tool);
      }
  }
  if (mcp.lazy.length) MCP_LAZY_TOOLS.forEach(defineTool);
  // 接没接浏览器类的服务，定顶栏那枚看台小屏挂不挂
  stageSync();
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
  const name = `mcp__${clean(server) || `s${nameHash(server)}`}__${clean(tool) || `t${nameHash(tool)}`}`;
  return name.length <= 64 ? name : `${name.slice(0, 57)}_${nameHash(name)}`;
}
// 名字里用的短指纹：接口只认字母数字与 _-，hashText 带着「长度:」的前缀，只取后面的十六进制
function nameHash(text) {
  return hashText(text).split(":")[1].slice(0, 6);
}
// 服务把同一件工具列了两回（分页拉取重了之类）：只登记一回
function uniqueBy(list, key) {
  const seen = new Set();
  return list.filter(item => !seen.has(key(item)) && !!seen.add(key(item)));
}

/** @type {Tool[]} 按需给的两件：目录写在 mcp_describe 的说明里 */
const MCP_LAZY_TOOLS = [
  {
    name: "mcp_describe",
    label: "MCP",
    mcp: true,
    // 旁注也给：目录只列只读的几件，mcp_call 也只放这几件（逐件摊开的同此，见 mcpInlineTool 的 lookup）
    lookup: true,
    offer: ctx => mcpLazyServers(ctx.preset).some(server => mcpServerTools(server, ctx.lookup).length),
    vars: ctx => ({ directory: mcpDirectory(ctx.preset, ctx.lookup) }),
    parallel: true,
    cache: true,
    run(step, args, ctx) {
      const state = mcpLazyServers(presetOf(ctx.conversation)).includes(args.server) ? mcp.servers[args.server] : null;
      step.title = `${args.server} · ${args.tools.join("、")}`;
      if (!state?.ok) return mcpUnknown(args.server, "");
      const found = args.tools.map(name => mcpServerTools(args.server, ctx.lookup).find(tool => tool.name === name)).filter(Boolean);
      if (!found.length) return mcpUnknown(args.server, args.tools.join("、"));
      const text = found
        .map(
          tool =>
            t`## ${tool.name}${mcpReadOnly(tool) ? t("（只读）") : ""}\n${tool.description || tool.title || ""}\n参数：${JSON.stringify(tool.inputSchema)}`
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
    lookup: true,
    offer: ctx => mcpLazyServers(ctx.preset).some(server => mcpServerTools(server, ctx.lookup).length),
    sideEffect: true,
    approval: mcpApprovalHtml,
    digest: true,
    run(step, args, ctx) {
      const spec = mcp.servers[args.server]?.tools?.find(tool => tool.name === args.tool);
      step.title = `${args.server} · ${args.tool}`;
      if (!spec) return mcpUnknown(args.server, args.tool);
      if (ctx.lookup && !mcpReadOnly(spec))
        return { ok: false, content: t`旁注只查不改：${args.server} 的 ${args.tool} 不是只读的工具，此处不调`, display: "非只读" };
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
/** 一个按需给的服务此处可用的几件：旁注（lookup）只要只读的 @param {string} server @param {boolean} [lookup] */
function mcpServerTools(server, lookup = false) {
  const tools = mcp.servers[server]?.tools || [];
  return lookup ? tools.filter(mcpReadOnly) : tools;
}
// 目录：一服务一段，一件一行（名字与说明的头一句）；只读的标出来
/** @param {Preset|null} preset @param {boolean} [lookup] */
function mcpDirectory(preset, lookup = false) {
  return mcpLazyServers(preset)
    .filter(server => mcpServerTools(server, lookup).length)
    .map(server => {
      const state = mcp.servers[server],
        head = [state.server?.title || state.server?.name, state.server?.description].filter(Boolean).join("：");
      const lines = mcpServerTools(server, lookup).map(tool => {
        const first = String(tool.description || tool.title || "")
          .split("\n")[0]
          .trim()
          .slice(0, 60);
        return `- ${tool.name}${mcpReadOnly(tool) ? t("（只读）") : ""}${first ? `：${first}` : ""}`;
      });
      return `【${server}】${head}\n${lines.join("\n")}`;
    })
    .join("\n");
}
function mcpUnknown(server, tool) {
  const state = mcp.servers[server];
  const known = state?.ok
    ? t`${server} 有：${state.tools.map(t => t.name).join("、")}`
    : t`已接入的服务：${
        Object.keys(mcp.servers)
          .filter(name => mcp.servers[name].ok)
          .join("、") || t("无")
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
  // 守的关口刚批过这一步（见 keepHook）：不再另问
  const ask =
    !step.granted && !mcpReadOnly(spec) && commandPolicyOf(ctx.conversation) === "ask" && !(config.autoApprove || []).includes(tool);
  if (ask && !(await askApproval(step, ctx))) {
    step.skipped = true;
    return { ok: false, content: prompt("assistant.declined"), display: "" };
  }
  // 审而后行里的写操作：开了审查就交它判（见 03-review.js）；游目的浏览器只审可能把东西带出去的那几样
  if (reviewOn(ctx.conversation)) {
    const why =
      server === STAGE_SERVER
        ? stageReviewWhy(tool, args, ctx.conversation)
        : !mcpReadOnly(spec) && !(config.autoApprove || []).includes(tool)
          ? `调外部服务 ${server} 的写操作 ${tool}`
          : "";
    const denied = why && (await reviewGate(step, args, ctx, why));
    if (denied) return denied;
  }
  const data = await bridge("/api/mcp/call", { server, config, tool, arguments: args, timeout: config.timeout }, ctx.signal).finally(
    stageWatch(tool, args)
  );
  // 服务说工具变了：下一问前重拉
  if (data.toolsChanged) mcp.key = "";
  const { names, images } = await mcpResultImages(step, data.result),
    text = mcpResultText(data.result, names) + stageResultNote(tool, args, data.result);
  step.output = trimOutput(text);
  return {
    ok: !data.result.isError,
    content: text,
    display: data.result.isError ? "出错" : images.length ? `${images.length} 幅画面` : `${text.length} 字`,
    ...(images.length ? { images } : {})
  };
}
// 浏览器类的结果：下载存到了哪，记进游目的下载签；执事若把视口定死了，补一句——不然它下回测完照样拿 setViewportSize「还原」，游目上下留白
/** @param {string} tool @param {Record<string, any>} args */
function stageResultNote(tool, args, result) {
  if (!/^browser_/.test(tool)) return "";
  const said = (result.content || []).map((/** @type {any} */ item) => (item.type === "text" ? item.text : "")).join("\n");
  for (const [, name, path] of said.matchAll(/- Downloaded file (.+?) to "(.+?)"/g)) stageNoteDownload(name, path);
  const pins = tool === "browser_resize" || (tool === "browser_run_code_unsafe" && /setViewportSize\s*\(/.test(String(args.code || "")));
  if (!pins || result.isError) return "";
  stageMarkExecutorPinned();
  return `\n\n${prompt("mcp.stagePinned")}`;
}
// 结果里的图（游目截的画面之类）：原件照附件存，挂在这一步上，步骤卡里画缩略、点开即看；data: 地址交回轮次循环，随工具结果给模型看（见 attachToolImages）。
// 名字取服务自己报的文件名（Playwright 截图会说存成了 page-….png，模型多半照它写）；回复里引这个名字，正文就画出这幅（见 renderReplyShots）
/** @param {Step} step */
async function mcpResultImages(step, result) {
  const images = (result.content || []).filter(item => item.type === "image" && item.data),
    said = (result.content || [])
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n")
      .match(/[^\\/\s'"`(]+\.(?:png|jpe?g|webp|gif)\b/i)?.[0];
  const stored = await Promise.all(
    images.map(async (item, i) => {
      const mime = String(item.mimeType || "image/png"),
        data = `data:${mime};base64,${item.data}`,
        meta = {
          id: uid(),
          kind: /** @type {const} */ ("image"),
          name:
            images.length === 1 && said
              ? said
              : t`画面-${step.id.slice(-6)}${images.length > 1 ? `-${i + 1}` : ""}.${mime.split("/")[1]?.replace("jpeg", "jpg") || "png"}`,
          mime,
          size: Math.round(item.data.length * 0.75),
          modifiedAt: Date.now()
        };
      await putAttachment({ ...meta, data }).catch(() => {});
      return { meta, data };
    })
  );
  if (stored.length) step.attachments = stored.map(item => item.meta);
  return { names: stored.map(item => item.meta.name), images: stored.map(item => item.data) };
}
// 请示条：哪个服务的哪件工具、带什么参数；按钮与指令的请示同一套（径行即此对话此后不再问）
/** @param {Step} step */
function mcpApprovalHtml(step) {
  const where = step.name === "mcp_call" ? step.title : `${toolLabel(step.name)} · ${step.title}`;
  return `<div class="approval-head"><span class="seal approval-seal" aria-hidden="true">${t(`问`)}</span><span class="approval-title">${t`MCP 请示 · ${escapeHtml(where)}`}</span><span class="approval-hint" title="${t(`输入框留空时，Enter 即运行`)}">${t(`Enter 运行`)}</span></div><pre class="approval-cmd">${escapeHtml(step.code || "{}")}</pre><div class="approval-actions"><button type="button" data-approve="run">${t(`运行`)}</button><button type="button" data-approve="skip">${t(`跳过`)}</button><button type="button" data-approve="auto" title="${t(`径行：此对话中后续调用不再询问`)}">${t(`径行`)}</button></div>`;
}
// 结果的几种内容合成一段文字：文本照录；图片、音频、资源只写一行说明（不把 base64 塞给模型）；只有结构化结果的给 JSON
function mcpResultText(result, names = []) {
  let shot = 0;
  const parts = (result.content || []).map(item =>
    item.type === "text"
      ? item.text
      : item.type === "image"
        ? t`[图片「${names[shot++] || item.mimeType}」，附在工具结果之后；回复里写 ![](${names[shot - 1] || t("文件名")}) 即给用户看]`
        : item.type === "audio"
          ? t`[音频 ${item.mimeType}，约 ${formatFileSize(Math.round(item.data.length * 0.75))}，未随结果转交]`
          : item.type === "resource_link"
            ? t`[资源 ${item.name || ""} ${item.uri}]`
            : item.type === "resource"
              ? (item.resource.text ?? t`[资源 ${item.resource.uri}（${item.resource.mimeType || t("二进制")}）]`)
              : JSON.stringify(item)
  );
  if (!parts.length && result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
  return parts.join("\n\n") || t("（无输出）");
}
// 系统提示里 mcp.hint 那一段的值：交给模型的工具里有哪几个服务的，就附上那几个服务的用法——用户在配置里写的 note 在前
//（模型无从自知的约定，如「我说打开浏览器即指这个」），服务握手时自带的 instructions 在后；一个都没有就不带这段
/** @param {Set<string>} names @param {Preset|null} preset */
function mcpHintVars(names, preset) {
  const lazy = names.has("mcp_call") ? mcpLazyServers(preset) : [],
    configs = mcpConfigs(),
    usage = (server, state) =>
      [
        String(configs[server]?.note || "").trim(),
        String(state.instructions || "")
          .trim()
          .slice(0, 1500)
      ]
        .filter(Boolean)
        .join("\n");
  const servers = Object.entries(mcp.servers).filter(
    ([server, state]) =>
      state.ok &&
      usage(server, state) &&
      (mcp.lazy.includes(server) ? lazy.includes(server) : [...TOOLS.values()].some(tool => tool.server === server && names.has(tool.name)))
  );
  return servers.length ? { servers: servers.map(([server, state]) => `【${server}】${usage(server, state)}`).join("\n") } : null;
}
