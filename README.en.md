# Yan (言)

<p align="center">
  <img src="assets/yan-logo.png" alt="Yan" width="96" height="96">
</p>

[中文](README.md) · **English**

A local, zero-dependency chat front end for OpenAI-compatible APIs and Anthropic's Messages API, styled after plain paper and ink. A chat bound to a working folder becomes **Agent** mode (行 · 执事): a lightweight coding agent that searches, reads, edits files and runs commands in that folder. Unbound, it is **Chat** mode (言 · 对谈): talk as usual, and when you need a spreadsheet, document or PDF, the same tools write into a local folder called **Files** (卷宗).

> Plainness for bones, paper and ink for spirit. Ask at length, answer at leisure; when the words are done, act.

<p align="center">
  <img src="assets/yan-home.png" alt="Yan: a local chat and lightweight agent interface" width="100%">
</p>

## Partner

<a href="https://siliconflow.cn" title="SiliconFlow"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/powered-by-siliconflow-dark.png"><img src="assets/powered-by-siliconflow-light.png" alt="Powered by SiliconFlow" height="44"></picture></a>

Yan partners with [SiliconFlow](https://siliconflow.cn). In **Settings → Model**, choose **SiliconFlow** as the API and paste your own API key. SiliconFlow's official guide [Using SiliconFlow in Yan](https://docs.siliconflow.cn/docs/usercases/use-siliconcloud-in-yan) (in Chinese) has step-by-step screenshots.

## Highlights

- **Chat and Agent, divided by a folder**: not two entry points, just whether a chat is bound to a working folder. Talk an idea through first, then bind a folder midway and act with the whole context. [More](docs/en/work.md)
- **Side threads**: select a passage in a reply and a small conversation opens on the right, attached to that spot. It can read the main thread; the main thread never reads it. Ask about what's unclear without disturbing the main line. [More](docs/en/chat.md#sessions-and-input)
- **In-page visuals**: the model writes a self-contained HTML page that renders in place inside an isolated sandbox, on the same sheet of paper as the text. ECharts and Mermaid ship with the project and load on demand. [More](docs/en/chat.md#rendering)
- **Long jobs keep themselves going**: the folder holds a ledger (constraints and trade-offs) and an **Intent** (a graph of conclusions to establish, with premises, checks and evidence; when evidence changes, the item goes back to "needs recheck"), carried across chats. A finished background command wakes the model; a subagent can start a training run, sleep, wake up to evaluate and report back. When the context is nearly full, the model compacts its work into notes and carries on. [More](docs/en/work.md#intent)
- **Browser panel**: the browser the model drives sits in a panel on the right. You can see where it clicks and what it types, take over at any time, and circle things on screen to point them out. [More](docs/en/stage.md)
- **Many models**: add several APIs and switch the default: SiliconFlow, OpenAI compatible, Anthropic, and ChatGPT subscription (official sign-in). SiliconFlow works as soon as you paste a key ([setup](docs/en/siliconflow.md)). Thinking levels are probed automatically for each provider, and **Settings → Roles** can add a separate review model and image model. [More](docs/en/models.md)
- **Paper and ink throughout**: seals, the inkstone, tokens left, ink drops and daylight; the interface and its motion share one brush.
- **Local, zero-dependency, under your control**: data stays in a local storage folder (`~/.yan/` by default). Yan has no server of its own; chats go only to the model APIs you connect. It needs only Node.js 22+ (bundled in the Windows portable package) and installs no npm packages. Commands have three permission levels, asking before each one by default, with a sandbox on top; in Auto-review, steps the rules aren't sure about can go to a review model that judges them against what you actually said. [Storage](docs/en/storage.md) · [Permissions and sandbox](docs/en/sandbox.md)

There is also Files, subagents, presets, groups, MCP, the sandbox environment, memory and the audio player; see the [docs](docs/en/README.md).

## Quick start

**Windows, without installing Node**: download `yan-<version>-win-x64.zip` from [Releases](https://github.com/Master-Norna/yan/releases/latest), unzip it and double-click `言.exe` in the `言` folder. The package bundles the official Node; everything else is the same as below. `言.exe` is unsigned, so the first time Windows may say "Windows protected your PC"; click **More info → Run anyway**. [More](docs/en/start.md#windows-portable-package)

**From source**: install Node.js 22 or later, then double-click `start.cmd`, or run in the project folder:

```powershell
npm start
```

Your browser opens `http://127.0.0.1:8787`. In **Settings → Model**, fill in a display name, model ID, Base URL and API key to start. Switch the interface language in **Settings → General → Language**. The window opened by `start.cmd` is the local bridge and must stay open. In-app usage notes are under **Settings → Docs** (Chinese only for now). For use inside VS Code, opening `index.html` directly, and environment variables, see [Getting started](docs/en/start.md).

On macOS, double-click `start.command` (if it's blocked the first time, right-click it in Finder and choose **Open**). The **Environment** toolkit is Windows-only, and the sandbox rules are written for PowerShell, so they are looser on macOS.

## Contributing

Issues and PRs are welcome. Before you start, please read [Contributing to Yan](CONTRIBUTING.en.md): workflow, running locally, and the project's trade-offs.

## License and credits

Released under Apache-2.0; see `LICENSE`. Open-source libraries shipped with the project: marked (MIT), DOMPurify (Apache-2.0), highlight.js (BSD-3-Clause), KaTeX (MIT), Mermaid (MIT), Apache ECharts (Apache-2.0), PDF.js (Apache-2.0). Full license texts are in `vendor/`.
