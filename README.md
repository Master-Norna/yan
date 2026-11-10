# 言

<p align="center">
  <img src="web/icon.svg" alt="言" width="96" height="96">
</p>

**中文** · [English](README.en.md)

> 清简为骨，纸墨为意。长问慢答，尽付纸墨；言毕，即行。

言把与模型的往来当作纸上的书写：问答落墨成文，动手的每一步记作行迹，岔出去的追问写在页边。同一张纸，不绑目录是对谈；绑上一个目录，模型便在其中读写文件、执行指令，把事办完。在本机运行，模型由你自己接。

<p align="center">
  <img src="assets/yan-home.png" alt="言 · 本地聊天与轻量执事界面" width="100%">
</p>

## 合作伙伴

<a href="https://siliconflow.cn" title="硅基流动 SiliconFlow"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/powered-by-siliconflow-dark.png"><img src="assets/powered-by-siliconflow-light.png" alt="Powered by SiliconFlow" height="44"></picture></a>

言与 [硅基流动 SiliconFlow](https://siliconflow.cn) 合作：在「设置 → 模型」的接口里选「硅基流动」，填上自己的 API Key 即可。图文步骤见硅基流动官方文档里的[《在言中使用硅基流动》](https://docs.siliconflow.cn/docs/usercases/use-siliconcloud-in-yan)。

## 特色

### 言与行，以目录为界

别处多把聊天与 Agent 分作两个程序，言只看这段对话绑没绑目录。先把一个想法聊透，中途绑上目录，模型带着前面的来龙去脉动手；那一路聊下来的取舍，不必再讲一遍。[详见](docs/work.md)

### 旁注：写在页边的追问

读到一处不明白，划选它，右侧展开一段附在那里的小对话。旁注读得到正文，正文永远读不到它：岔出去问的，不会搅进主线的上下文。切到另一版答复，旁注随之隐去，切回又在。[详见](docs/chat.md#会话与输入)

### 意：长活知道什么算做成

跨几答的长活，模型在目录里立一份「意」：这件事要成立哪几条结论，各以什么为前提，凭哪些文件、哪条指令的输出算数。凭据一变，不论是这一答改的、别的对话改的，还是你亲手改的，那一项即转待复核，牵连的几项一并亮出来。模型想收尾时先被拦一下，对照你最初那一问自判做成没有。换一段对话接着做，看到的仍是同一份；做法与踩过的坑另记在目录的记忆里。[详见](docs/work.md#意)

### 候：挂上就走，到时叫醒

训练、构建、等一个 PR 的回复，执事挂到后台或约个时刻，便收尾歇下，不醒着干等；指令跑完、时刻到了，自会叫醒它接着做。帮手也一样，可以自己开训练、睡下、醒来评估，再回来交差。[详见](docs/work.md#候)

### 补言：说到一半也能插一句

模型正答着，想起什么就补一句。不硬掐，也不排队：等它想完这一段、跑完这一步、写到句尾，才把话递上，它读了可以就此改道。急的话，点那一步上的 ↵ 当场递上。[详见](docs/chat.md#生成与版本)

### 游目：看得见它上网

模型用的浏览器收在右侧一栏，它点了哪里、键入什么，都落一笔朱；随时接得过手。拿笔在网页上圈一处、划一道，就是指给它看。[详见](docs/stage.md)

### 纸墨，一支笔到底

不是换了一层皮。用量是余墨，随用随减；一年的用量是一页墨点，用得越多点越浓；寄出是盖一方印，放一首曲子是画一笔圆相，明暗之间是天光流转。界面与动效同出一套笔墨。

## 此外

卷宗与成品（PPT、Excel、PDF 做好就地预览）、答复里可交互的图表、差遣帮手分头做事、一答之内动过的文件可整个退回、预设与分组、MCP 与 Skill、跨对话的记忆。指令分三档权限，另有一层沙箱，规则拿不准的一步可交审查模型照你的原话再判。接口认硅基流动、OpenAI 兼容、Anthropic 与 ChatGPT 订阅；言没有自己的服务器，数据只落在本机，只需 Node.js 22，不装依赖。界面可切中英。

## 开始

**Windows**：到 [Releases](https://github.com/Master-Norna/yan/releases/latest) 下载 `yan-<版本>-win-x64.zip`，解开后双击 `言.exe`。头一回若提示「已保护你的电脑」，点「更多信息 → 仍要运行」（`言.exe` 未签名）。

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
