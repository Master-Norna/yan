# MCP

[← 文档目录](README.md)

在设置 → MCP 里接入外部的 MCP 服务，它们的工具便归模型所用。一个服务一张卡：可新增、就地改（本机程序填命令、参数、工作目录与环境变量，远端服务填地址与请求头）、停用、重连、删去，展开可看它有哪几件工具。也可「以 JSON 编辑」整份配置——写法与 Claude、Cursor 等通用，服务说明里给的片段、项目里现成的 `.mcp.json` 整段粘进来即可：

```json
{
  "mcpServers": {
    "本机服务": { "command": "npx", "args": ["-y", "@某某/mcp-server"], "env": { "API_KEY": "…" } },
    "远端服务": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

- 本机程序填 `command` / `args`（可带 `cwd`、`env`），由桥接起进程、走 stdio；远端服务填 `url` / `headers`，走可流式 HTTP，旧式 HTTP+SSE 的服务另写 `"type": "sse"`（没写时握手被拒也会自动退回再试）。Windows 上 `npx`、`uvx` 这类 .cmd 也起得来。
- 可选字段：`disabled` 停用；`autoApprove` 列出免请示的工具名；`timeout` 单次调用最多等几秒（默认 600，服务报进度就续命）；`load` 指定怎么交给模型。
- 怎么交给模型：工具少的逐件摊开，与内置工具无异（名字是 `mcp__服务__工具`）；工具多、定义重的（整份定义过万字）只给一张目录，外加 `mcp_describe`（查参数）与 `mcp_call`（调用）两件，每一问只多背一张目录。`load: "inline"` / `"lazy"` 可强定。服务握手时自带的用法（instructions）接在系统提示末尾。
- 请示：服务标为只读（`readOnlyHint`）的工具径直调用、可与相邻的只读调用并发、旁注里也能用；其余在「问而后行」下逐次请示（请示条写明服务、工具与参数），另两档照跑。
- 结果里的文本照录；图片、音频、资源只写一行说明，不把 base64 塞给模型；只有结构化结果的给 JSON。
- 密钥：环境变量与请求头里名字像密钥的（key、token、secret、auth、pat……）在卡片表单与 JSON 里都遮成 `******（已隐藏）`；保存时仍是这个占位的沿用原值，改了才换。「显示密钥」才露出原文。导出备份时 `env` 与 `headers` 一并去掉。
- MCP 服务以你的权限运行在本机，不受沙箱约束；备好了沙箱环境的，本机服务也接着它（环境里的 Python、`uvx` 都找得到）。
- 分层：`server/mcp/transports.js` 只管收发（stdio、可流式 HTTP、旧式 SSE 同一个样子），`server/mcp/client.js` 管协议（握手、分页、超时、取消、服务端的通知与请求），`server/mcp/index.js` 按名字复用连接；页面这头 `src/15-tools/60-mcp.js` 把工具登记进注册表。接一个没见过的服务只改配置，不动代码。
