<div align="center">

<img src="web/icon.svg" alt="一笔言" width="96" height="96">

<h1>言 · Yan</h1>

<strong>面向长程协作的个人智能体</strong>

<p>清简为骨，纸墨为意。</p>

<a href="LICENSE"><img src="assets/readme/license.svg" alt="Apache-2.0"></a>
<a href="https://github.com/Master-Norna/yan/releases/latest"><img src="assets/readme/platform.svg" alt="Windows · macOS"></a>
<a href="docs/models.md"><img src="assets/readme/local.svg" alt="自选模型"></a>
<a href="https://github.com/topics/javascript"><img src="assets/readme/tag-language.svg" alt="language: JavaScript"></a>
<a href="https://github.com/topics/nodejs"><img src="assets/readme/tag-runtime.svg" alt="runtime: Node.js 22+"></a><br>
<a href="https://github.com/topics/ai-agent"><img src="assets/readme/tag-agent.svg" alt="agent: AI Agent · Agentic"></a>
<a href="https://github.com/topics/local-first"><img src="assets/readme/tag-architecture.svg" alt="architecture: Local-first"></a>
<a href="https://github.com/topics/browser-automation"><img src="assets/readme/tag-browser.svg" alt="browser: Automation"></a>
<a href="https://github.com/topics/chat-ui"><img src="assets/readme/tag-chat-ui.svg" alt="interface: Chat UI"></a><br>
<a href="https://github.com/topics/mcp"><img src="assets/readme/tag-tools.svg" alt="tools: MCP · Skills"></a>
<a href="https://github.com/topics/openai-compatible"><img src="assets/readme/tag-api.svg" alt="API: OpenAI-compatible"></a>
<a href="https://github.com/topics/rsi"><img src="assets/readme/tag-rsi.svg" alt="research: RSI"></a>

[下载](https://github.com/Master-Norna/yan/releases/latest) · [文档](docs/README.md) · [English](README.en.md)

</div>

言将对话、研究、开发与任务执行置于同一环境。模型由用户选择，任务在本地目录中持续推进，执行过程与交付成果可查。对谈中绑定目录，即可带着已有上下文进入执行。

<p align="center">
  <img src="assets/yan-home.png" alt="言的实际界面" width="100%">
</p>

## <img src="assets/readme/seal-core.svg" width="38" height="38" alt=""> 核心体验

<table>
<tr>
<td width="45%" valign="middle"><h3>长程任务</h3><p>以「图」组织目标、依赖与验收凭据，以「差遣」并行推进子任务，以「候」响应时间与事件。执行、等待、唤醒与复核相接，让复杂任务不受单次对话限制。</p><a href="docs/work.md">了解更多</a></td>
<td width="55%" valign="middle"><img src="assets/readme/01-long-task.svg" alt="长程任务" width="100%"></td>
</tr>
<tr>
<td width="55%" valign="middle"><img src="assets/readme/02-browser.svg" alt="浏览器自动化" width="100%"></td>
<td width="45%" valign="middle"><h3>浏览器自动化</h3><p>「游目」将 Agent 操作的浏览器置于用户眼前。网页检索、交互与操作贯通，用户可随时接管，也可通过圈点与引用直接参与任务。</p><a href="docs/stage.md">了解更多</a></td>
</tr>
<tr>
<td width="45%" valign="middle"><h3>多模态智能体</h3><p>对话内联呈现交互图表与可视化内容，并以文件成品承载交付。借助本机执行环境与相应工具，可生成图像、音频、视频等数字内容。</p><a href="docs/chat.md">了解更多</a></td>
<td width="55%" valign="middle"><img src="assets/readme/03-multimodal.svg" alt="多模态智能体" width="100%"></td>
</tr>
<tr>
<td width="55%" valign="middle"><img src="assets/readme/04-personalized.svg" alt="个性化智能体" width="100%"></td>
<td width="45%" valign="middle"><h3>个性化智能体</h3><p>记忆沉淀长期上下文，MCP 接入外部服务，Skill 复用工作方法；结合模型、工具与权限预设，构建适合不同领域与任务的专属 Agent。</p><a href="docs/memory.md">了解更多</a></td>
</tr>
</table>

## <img src="assets/readme/seal-capabilities.svg" width="38" height="38" alt=""> 产品能力

| 对话与创作 | 检索与研究 |
| --- | --- |
| 多轮对话、分支与版本、旁注、补言、附件阅读、交互图表。 | 网络检索、网页阅读、浏览器操作及圈点引用。 |
| **代码与文件** | **文档与交付** |
| 文件读写、目录检索、终端执行、差异查看与回退。 | 卷宗管理，文档、表格、演示文稿及 PDF 预览。 |
| **记忆与个性化** | **模型与工具** |
| 跨会话记忆、目录记忆、预设与会话分组。 | 自主选择模型，接入 MCP、Skills 与本机工具。 |

## <img src="assets/readme/seal-safety.svg" width="38" height="38" alt=""> 安全与控制

按场景选择问而后行、审而后行或径行。权限档位、沙箱规则、独立审查与任务守则形成不同层次的控制。

- **规则与沙箱**：按权限档位限制指令与文件操作，对明确风险拦截或转为请示。
- **独立模型审查**：可配置专司审查模型，结合用户原始指令判断规则标疑的操作。
- **任务守则（Hook）**：在副作用发生前匹配指令、文件、网址或工具，进行测试、拦截或请示。
- **追溯与回退**：操作与变更留下行迹，可审阅差异与回退一答的文件改动。

实际保护范围取决于权限档位与配置。[权限与沙箱](docs/sandbox.md)。

## <img src="assets/readme/seal-design.svg" width="38" height="38" alt=""> 纸墨设计

<div align="center">
<img src="assets/readme/ink-appearance.svg" alt="" width="52" height="52">　<img src="assets/readme/ink-presets.svg" alt="" width="52" height="52">　<img src="assets/readme/ink-scroll.svg" alt="" width="52" height="52">　<img src="assets/readme/ink-theme.svg" alt="" width="52" height="52">
</div>

清简纸墨贯穿界面与交互：以笔意作图标，以朱印示反馈，以墨历记使用，明暗随天光流转。

## <img src="assets/readme/seal-ecosystem.svg" width="38" height="38" alt=""> 模型自主与开放生态

自主选择模型接口，按需配置审查等专司；通过 MCP 与 Skills 扩展工作能力。对话与配置保存在本机，发给模型或外部工具的内容由相应服务处理。接口支持硅基流动、OpenAI 兼容、Anthropic 与 ChatGPT 订阅。

### 合作伙伴

<a href="https://siliconflow.cn" title="硅基流动 SiliconFlow"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/powered-by-siliconflow-dark.png"><img src="assets/powered-by-siliconflow-light.png" alt="Powered by SiliconFlow" height="44"></picture></a>

言与 [硅基流动 SiliconFlow](https://siliconflow.cn) 合作：在「设置 → 模型」的接口里选「硅基流动」，填上自己的 API Key 即可。图文步骤见硅基流动官方文档里的[《在言中使用硅基流动》](https://docs.siliconflow.cn/docs/usercases/use-siliconcloud-in-yan)。

## <img src="assets/readme/seal-start.svg" width="38" height="38" alt=""> 开始使用

**Windows**：到 [Releases](https://github.com/Master-Norna/yan/releases/latest) 下载 `yan-<版本>-win-x64.zip`，解开后双击 `言.exe`。头一回若提示「已保护你的电脑」，点「更多信息 → 仍要运行」（`言.exe` 未签名）。

**macOS（Apple 芯片）**：到 [Releases](https://github.com/Master-Norna/yan/releases/latest) 下载 `yan-<版本>-mac-arm64.zip`，解压后双击「言」文件夹里的 `start.command`。包里自带 Node；若首次打开被系统拦下，见[启动与运行](docs/start.md#macos-便携包)。

**从源码**：装好 Node.js 22 或更高版本，双击 `start.cmd`（macOS 用 `start.command`），或运行：

```powershell
npm start
```

浏览器打开 `http://127.0.0.1:8787`，在「设置 → 模型」接入一个模型，即可落笔。`start.cmd` 打开的窗口是本机桥接，用时须开着。VS Code 内使用、环境变量、macOS 上的差别，见 [启动与运行](docs/start.md)。

## 文档

界面里的用法在「设置 → 文档」；各处的细节与做法见 [docs](docs/README.md)。

## 参与开发

欢迎提 issue 与 PR。动手前请读 [参与言的开发](CONTRIBUTING.md)：流程、本地怎么跑、项目的几条取舍。

## 许可与致谢

本项目以 Apache-2.0 发布，全文见 `LICENSE`。随项目本地分发的开源库：marked（MIT）、DOMPurify（Apache-2.0）、highlight.js（BSD-3-Clause）、KaTeX（MIT）、Mermaid（MIT）、Apache ECharts（Apache-2.0）、PDF.js（Apache-2.0），许可全文见 `vendor/`。

## <img src="assets/readme/seal-contributions.svg" width="38" height="38" alt=""> 开源贡献

言在真实的开源协作中持续成长。以下为言参与的上游贡献。

<p align="center">
  <img src="https://raw.githubusercontent.com/Master-Norna/yan/readme-contributions/assets/readme/contributions.svg" alt="开源贡献" width="100%">
</p>
