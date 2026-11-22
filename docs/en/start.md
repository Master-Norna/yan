# Getting started

[← Docs](README.md) · [中文](../start.md)

Running from source requires only Node.js 22 or later; portable packages bundle Node. No npm packages to install; every front-end library ships with the project and nothing loads from the web.

## Quick start

Double-click `start.cmd`, or run in the project folder:

```powershell
npm start
```

Your browser opens `http://127.0.0.1:8787`. The first time, fill in a display name, model ID, Base URL and API key in **Settings → Model** to start; the project never reads or bundles any configuration from the developer's machine. You can add several APIs and switch the default model. Each model chooses its **API**: OpenAI compatible (chat/completions) or Anthropic (Messages API); a Base URL containing anthropic.com is recognized even if you don't choose.

Switch the interface language in **Settings → General → Language** (中文 / English); the page reloads after switching. If you never chose, it follows the browser language: Chinese for Chinese locales, English otherwise. The English interface only changes the words on screen; the prompts sent to the model stay the same.

**Settings → General → Desktop notifications** is off by default. When on and the page isn't in front of you (another window or app), a system notification pops up when an answer finishes, something awaits your decision (the approval bar, a form), or a subagent breaks off; a newer one for the same chat replaces the older, and clicking it takes you back to that chat. If a follow-up started another turn or subagents are still working, the chat isn't idle yet, so nothing pops up; nor when you pressed stop. Permission is kept per browser and asked the first time you click On; settings sync through the storage folder, so a browser that hasn't allowed it stays quiet until you click On there again.

The CMD window opened by `start.cmd` is the local bridge process and must stay open. If you close it, pages already loaded stay for a while, but reloading, model forwarding, web access and the agent all stop. If the browser is open but the page says the local bridge has stopped, look at that window first: when the bridge exits it stays open and prints the reason (port in use, node missing and so on) instead of flashing away.

On macOS, double-click `start.command` and keep its Terminal window open while you use Yan. When running from source, the script must first find Node 22 or later on the PATH it inherits. **Settings → Environment** checks Homebrew and other locations only after the bridge starts, so it cannot help the source launcher find Node. On macOS, **Environment** detects installed tools; it does not install tool packs. Under **Ask first**, macOS `sandbox-exec` restricts writes to the working folder, temp folders, and caches. `brew install` and `brew reinstall` need to write outside those folders, so the approval prompt explains why. Clicking **Run** lets only that command run outside the sandbox. **Auto-review** and **Full auto** still rely on rule screening only.

## Windows portable package

If you'd rather not install Node first, use the portable package: it unzips to a `言` folder; double-click `言.exe` inside it and everything else is as above. `言.exe` opens no window: the bridge runs in the background, and the commands it starts don't pop up console windows either. Close Yan's page and the bridge exits on its own once nobody has reconnected for 30 seconds and no background command is running (enough for a reload or reopening the browser; background commands keep running and the bridge exits after they finish); double-clicking while the same version is already running just opens the page. When writable, `桥接.log` in the `言` folder records bridge output and is rewritten on each start. A log write failure does not stop startup; if the bridge exits unexpectedly, a dialog still shows its last lines. To debug with a terminal in view, use `start.cmd` instead. The package bundles the official Node (`node\`, including npm), and Yan's own files are identical to the repository. `start.cmd` also uses this `node\`, but runs in a terminal and does not exit automatically when the last page closes. The bundled Node is appended to the end of PATH: the model's `node` and `npx`, and front-end tools installed through **Environment**, can find it, while a system that already has Node keeps using its own. Chats, Files and settings stay in the current [storage location](storage.md) (`~/.yan/` by default), whether you run the portable package or the source.

`言.exe` is not code-signed. The first time you double-click it, Windows may say "Windows protected your PC"; click **More info → Run anyway**.

## macOS portable package

Download `yan-<version>-mac-arm64.zip` from [Releases](https://github.com/Master-Norna/yan/releases/latest), unzip it and double-click `start.command` inside the `言` folder. The bridge uses the bundled official Node (including npm). The bundled Node's directory is appended to PATH for commands, so existing system tools still take precedence. Python and ffmpeg aren't bundled; install them separately if needed and **Settings → Environment** can detect them. There is no Intel portable package. Chats, Files and settings still use the current storage location.

Yan does not add signing or notarization to this package. If a recent macOS version blocks the first launch, and you're sure the file came from the official Releases page and hasn't been tampered with, go to **System Settings → Privacy & Security → Open Anyway**, then confirm. This makes an exception for this file; leave system protections on. See [Apple's instructions](https://support.apple.com/en-us/102445).

If an older bridge is still running on the same port after you update the portable package, the new version asks you to quit it and retry. It does not open the old page or interrupt running tasks.

## Packaging

The working tree must be clean, including untracked files; commit or stash your changes first so uncommitted content cannot enter a release package. Run `npm run pack` in the repository. It builds `dist/yan-<version>-win-x64.zip` or `dist/yan-<version>-mac-arm64.zip` for the host automatically. Windows uses the system's `curl.exe`, `tar.exe` and .NET Framework 4 `csc.exe`; the launcher source is `pack/launcher.cs` and its icon `pack/icon.ico` is drawn from `web/icon.svg`. macOS uses the system's `ditto` to make the ZIP and preserve executable permissions and symlinks.

The Node version is set in `pack/pack.mjs`; the Node archive is used only after it matches the nodejs.org checksum. After changing Node versions, run the whole test suite with the bundled Node. See [Additional validation](development.md#additional-validation) for the smoke tests and the separate Finder launch check.

## Use inside VS Code

1. Run the task "言：启动模型桥接" (start the model bridge) via **Terminal → Run Task**, and keep its terminal open.
2. Open `http://127.0.0.1:8787` in your system browser. Simple Browser embeds the page in an iframe, which Yan's `frame-ancestors 'none'` policy blocks; the bridge also doesn't open the agent API to extension webview origins.
3. Fill in your settings in **Settings → Model**; you can click **Fetch list** and then **Test connection**. Web search is tested in **Settings → Tools**.

## Opening web/index.html directly

Yan must be opened through the local bridge: run `start.cmd` (or `npm start`) and visit `http://127.0.0.1:8787` in your system browser. Double-clicking `web/index.html` (`file://`) can't reach the bridge: the bridge refuses pages whose origin is `null` (a `file://` page is one, and so is a sandboxed iframe embedded by another site; they can't be told apart). After editing `src/` or `styles/`, just reload (the bridge concatenates on each request and writes no build output).

## Environment variables

- `YAN_PORT`: change the bridge port; default `8787`
- `YAN_HOME`: set the storage folder directly (chats, Files and settings all live in it); default `~/.yan/`. When set, the file that remembers the storage location in the system data directory is neither read nor written (used by tests)
- `YAN_DEBUG=1`: print every request and every abnormally closed connection to the console. Use it when the page reports "Failed to fetch" or that the local bridge has stopped, to see whether the request reached the bridge at all

## The local bridge

`server.js` and `server/` are the local bridge (see [Code structure and development](development.md) for what each part does). It serves the page, forwards model requests, runs web search and page reading on the model's behalf (refusing local and private addresses, with IPv6 literals and IPv4-mapped addresses judged the same way; bodies are truncated while reading, at most 3 MB), and performs the agent's commands and file operations. Static files carry `ETag` validation, so changes take effect on reload; the console never shows API keys.

A single request carries at most 128 tool definitions; going over is an explicit error rather than silently dropping the rest.
