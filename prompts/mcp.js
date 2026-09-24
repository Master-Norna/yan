// 言 · 内置提示词 · MCP
// hint：已接入的 MCP 服务自带的用法（握手时给的 instructions），有它的工具交给模型时接在系统提示末尾，一服务一行（{{servers}}）。
// 其余是工具结果里回给模型的话，不是系统提示。mcp_describe / mcp_call 两件的说明在 tools.js。
(window.YAN_PROMPTS ||= {}).mcp = {
  hint: "已接入的 MCP 服务附有用法，照办：\n{{servers}}",

  skipped: "用户没有同意这次调用。请换做法，或先向用户说明为何需要它。",

  unknown: "没有这件工具：{{server}} / {{tool}}。{{known}}",

  badArgs: "调用 {{server}} / {{tool}} 的参数不合要求：{{problems}}。它收的参数：{{hint}}"
};
