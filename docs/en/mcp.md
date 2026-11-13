# MCP

[← Docs](README.md) · [中文](../mcp.md)

Connect external MCP servers in **Settings → MCP** and their tools become available to the model. One card per server: add, edit in place (a local program takes a command, arguments, working directory and environment variables; a remote server takes a URL and headers), disable, reconnect, delete, and expand to see its tools. You can also **Edit as JSON** for the whole configuration. The format is the same as Claude, Cursor and others, so a snippet from a server's README or an existing `.mcp.json` in a project can be pasted in whole:

```json
{
  "mcpServers": {
    "local-server": { "command": "npx", "args": ["-y", "@someone/mcp-server"], "env": { "API_KEY": "…" } },
    "remote-server": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

- A local program takes `command` / `args` (optionally `cwd`, `env`); the bridge starts the process and speaks stdio. A remote server takes `url` / `headers` and uses streamable HTTP; servers on the old HTTP+SSE transport add `"type": "sse"` (if omitted and the handshake is refused, it falls back and retries automatically). On Windows, `.cmd` launchers such as `npx` and `uvx` start fine.
- Optional fields: `disabled` disables it; `autoApprove` lists tool names that skip approval; `timeout` is how many seconds a single call may wait (default 600; progress reports from the server extend it); `load` sets how it's handed to the model; `note` (**Note to the model** on the card) is a sentence or two you write for the model, placed in the system prompt before the server's own instructions — for conventions the model can't know on its own, like "when I say open the browser, I mean this one" or "this is my composition project".
- How it's handed to the model: servers with few tools are laid out tool by tool, no different from built-in tools (named `mcp__server__tool`); servers with many or heavy tools (definitions over twelve thousand characters in total) get only a directory, plus two tools `mcp_describe` (look up parameters) and `mcp_call` (call), so each question carries just one directory more. `load: "inline"` / `"lazy"` forces either. Instructions the server provides at handshake go into the system prompt, ahead of the skills directory and the drawing and writing notes.
- Approval: tools the server marks read-only (`readOnlyHint`) are called directly, can run in parallel with adjacent read-only calls, and are available in side threads. Others ask for approval each time under **Ask first** (the request shows the server, tool and arguments) and just run at the other two levels.
- Text in results is passed through; images, audio and resources get a one-line note instead of base64 stuffed into the model; results with only structured content are given as JSON.
- When a server reports that its tools changed (`notifications/tools/list_changed`), the bridge refetches them and the page takes the new list at its next turn, so the catalogue and parameter schemas handed to the model move with it. An internal refetch doesn't count as delivered: the flag is cleared only when the page fetches, or new tools and schemas would never arrive. When a server saves an image to a file and returns only a link (a screenshot taken with an explicit filename, say), the bridge reads it back as an image result, so it reaches the step thumbnail and the model just like an inline image.
- Secrets: environment variables and headers whose names look like secrets (key, token, secret, auth, pat…) are masked as `******（已隐藏）` (hidden) in both the card form and the JSON. On save, the placeholder keeps the original value; only a changed value replaces it. **Show secrets** reveals the originals. Exported backups drop `env` and `headers` entirely.
- MCP servers run locally with your permissions and aren't constrained by the sandbox. If the sandbox environment is set up, local servers use it too (the environment's Python and `uvx` are found).
- Layers: `server/mcp/transports.js` only sends and receives (stdio, streamable HTTP and old SSE look the same), `server/mcp/client.js` handles the protocol (handshake, pagination, timeouts, cancellation, server notifications and requests), and `server/mcp/index.js` reuses connections by name. On the page side, `src/15-tools/60-mcp.js` registers the tools in the registry. Connecting a new kind of server only changes configuration, not code.
