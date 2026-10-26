# Getting started

[← Docs](README.md) · [中文](../start.md)

Zero dependencies: Yan needs only Node.js 18 or later. No npm packages to install; every front-end library ships with the project and nothing loads from the web.

## Quick start

Double-click `start.cmd`, or run in the project folder:

```powershell
npm start
```

Your browser opens `http://127.0.0.1:8787`. The first time, fill in a display name, model ID, Base URL and API key in **Settings → Model** to start; the project never reads or bundles any configuration from the developer's machine. You can add several APIs and switch the default model. Each model chooses its **API**: OpenAI compatible (chat/completions) or Anthropic (Messages API); a Base URL containing anthropic.com is recognized even if you don't choose.

Switch the interface language in **Settings → General → Language** (中文 / English); the page reloads after switching. If you never chose, it follows the browser language: Chinese for Chinese locales, English otherwise. The English interface only changes the words on screen; the prompts sent to the model stay the same. **Settings → Docs** is Chinese only for now.

The CMD window opened by `start.cmd` is the local bridge process and must stay open. If you close it, pages already loaded stay for a while, but reloading, model forwarding, web access and the agent all stop. If the browser is open but the page says the local bridge has stopped, look at that window first: when the bridge exits it stays open and prints the reason (port in use, node missing and so on) instead of flashing away.

## Windows portable package

If you'd rather not install Node first, use the portable package: it unzips to a `言` folder; double-click `言.exe` inside it and everything else is as above (the window is the bridge and must stay open). The package bundles the official Node (`node\`, including npm), and Yan's own files are identical to the repository. `start.cmd` also uses this `node\`, so the two are equivalent. The bundled Node is appended to the end of PATH: the model's `node` and `npx`, and front-end tools installed through **Environment**, can find it, while a system that already has Node keeps using its own. Chats, Files and settings stay in `~/.yan/`, so switching between the portable package and source works seamlessly.

`言.exe` is not code-signed. The first time you double-click it, Windows may say "Windows protected your PC"; click **More info → Run anyway**.

Packaging: run `npm run pack` in the repository to get `dist/yan-<version>-win-x64.zip`. It uses the system's `curl.exe`, `tar.exe` and the .NET Framework 4 `csc.exe` (all present on Windows 10 / 11). The Node version is set at the top of `pack/pack.mjs`; the archive is used only after it matches the nodejs.org checksum. After changing the version, run the whole test suite with the bundled Node (`dist\言\node\node.exe test/run.mjs`). The launcher's source is `pack/launcher.cs`; the icon `pack/icon.ico` is drawn from `icon.svg`.

## Use inside VS Code

1. Run the task "言：启动模型桥接" (start the model bridge) via **Terminal → Run Task**, and keep its terminal open.
2. Open `http://127.0.0.1:8787` in your system browser. Simple Browser embeds the page in an iframe from a different origin, which Yan's `frame-ancestors 'self'` policy still blocks (`'self'` only allows the same-origin right panes); the bridge also doesn't open the agent API to extension webview origins.
3. Fill in your settings in **Settings → Model**; you can click **Fetch list** and then **Test connection**. Web search is tested in **Settings → Tools**.

## Opening index.html directly

Yan must be opened through the local bridge: run `start.cmd` (or `npm start`) and visit `http://127.0.0.1:8787` in your system browser. Double-clicking `index.html` (`file://`) can't reach the bridge: the bridge refuses pages whose origin is `null` (a `file://` page is one, and so is a sandboxed iframe embedded by another site; they can't be told apart). After editing `src/` or `styles/`, just reload (the bridge concatenates on each request and writes no build output).

## Environment variables

- `YAN_PORT`: change the bridge port; default `8787`
- `YAN_HOME`: set the storage folder directly (chats, Files and settings all live in it); default `~/.yan/`. When set, the file that remembers the storage location, `%APPDATA%\言\位置.json`, is neither read nor written (used by tests)
- `YAN_DEBUG=1`: print every request and every abnormally closed connection to the console. Use it when the page reports "Failed to fetch" or that the local bridge has stopped, to see whether the request reached the bridge at all

## The local bridge

`server.js` and `server/` are the local bridge (see [Code structure and development](development.md) for what each part does). It serves the page, forwards model requests, runs web search and page reading on the model's behalf (refusing local and private addresses, with IPv6 literals and IPv4-mapped addresses judged the same way; bodies are truncated while reading, at most 3 MB), and performs the agent's commands and file operations. Static files carry `ETag` validation, so changes take effect on reload; the console never shows API keys.

A single request carries at most 128 tool definitions; going over is an explicit error rather than silently dropping the rest.
