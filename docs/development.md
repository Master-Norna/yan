# 代码结构与开发

[← 文档目录](README.md)

零依赖、无转译：源码分成多段，桥接在请求 `/support.js`（`prompts/` 在前、`src/` 在后）与 `/app.css` 时按路径顺序即时拼接（子目录就地展开）（ETag 取各段的大小与修改时间），改一段刷新即生效；不落成文件，仓库里没有拼好的产物。

| 目录 / 文件 | 内容 |
| --- | --- |
| `src/` | 页面脚本，按领域分段，拼进同一个闭包：`00-state` 数据模型（Store / Conversation / Message / Step / Profile… 以 JSDoc typedef 写在顶部）与跨领域的页面状态，`01-bridge` 与桥接说话的唯一口子（接上、总线、`bridge()`），`01-store/` 存储（各段自带自己的常量与簿记，`90-open` 在它们立起之后读出 `store`），其后是对话数据、笔意图标与小工具、Markdown、启动、欢迎页、渲染与画法（`07-render/`）、行迹（`08-trail/`）、附件、旁注、记忆、外观、输入区、文件与卷宗（`13-files/`）、对话引擎（`14-chat-engine/`：历史、进行中的活、发送、读流、轮次、拟题、系统提示、上下文压缩，以及信——帮手回报与后台指令结束的消息寄给该醒的那一个）、工具（`15-tools/`）、接口与余墨（`16-api`）、设置（`17-settings/`）、计数与导航、导出、分组、听音、游目（`26-stage/`）。一块写大了就拆成同序号的子目录，里面各段照名字顺序就地展开，拼出来与一个文件无异。各领域自己的状态写在自己那一段开头，不往 `00-state` 堆。`types.d.ts` 是给类型检查用的全局声明，运行时不加载 |
| 登记表 | 扩展言的几处口子都是一张表，加一样东西只加一份登记：**工具**（`src/15-tools/`，一件一份：给谁用、可否并发、有无副作用、怎么执行、行迹怎么画、带给下一问的摘要；交给模型的定义、执行、行迹卡片、出处都从这张表派生，另在 `prompts/tools.js` 写一段说明）、**模型接口**（`server/model/` 的 `PROVIDERS`：往哪发、带什么头、请求体与事件流怎么换、怎么列模型、档位有无定表；页面只说 OpenAI chat.completions 的话）、**设置栏**（`src/17-settings/00-panel.js` 的 `SETTINGS_TABS`：画法与接事件一对，面板可写在自己的领域里）、**系统提示**（`prompts/assistant.js` 末的 `order` 表）、**正文嵌件**（`src/04-markdown/00-markdown.js` 的 `EMBEDS`：认哪种围栏、写到一半的占位、写完的样子、画进页面后起来的一步；交互网页是其中一份）、**文件种类**（`src/13-files/00-kinds.js` 的 `FILE_KINDS`：扩展名、大类、件图、预览器怎么看、正文怎么抽）、**浮层**（`src/03-ui-utils.js` 的 `LAYERS`：Esc 收最上面开着的一层，各层登记在自己那一段）、**菜单**（`openMenu`：一列项，按钮与点了做什么出自同一份）、**消息动作**（`src/07-message-actions.js` 的 `MESSAGE_ACTIONS`）。新功能先看它是哪张表的一份登记；哪张都不是，先立表再落第一份 |
| `styles/` | 样式，按层次分段（基础与主题、布局、欢迎页、对话、正文内容、文件、输入区、设置、行迹、组件、动效与响应式、纸墨皮肤）；顺序即层叠顺序 |
| `prompts/` | 内置提示词与工具说明，拼 `/support.js` 时排在最前（闭包之外），见其 README |
| `server.js` · `server/model/` · `server/web.js` · `server/http.js` · `server/work/` · `server/chats.js` · `server/store.js` · `server/files.js` · `server/video.js` · `server/sandbox.js` · `server/mcp/` · `server/env/` | 本机桥接：`server.js` 管门禁、接口表、静态与拼接，`server/model/` 管模型转发（测试连接、列模型、对话；OpenAI 兼容、Anthropic、ChatGPT 订阅各一份登记），`server/web.js` 管联网（地址门禁、翻网页、检索、调接口），`server/http.js` 是各接口共用的读写 JSON、出错回 400 与原子写盘；`server/work/` 是执事接口（`index.js` 各接口，`paths.js` 目录内外与越界链接，`text.js` 编码认读，`shell.js` 起指令、收进程树与后台指令，`locks.js` 同一文件的写锁，`folder-picker.js` 目录选择框）与卷宗目录接口（`archive.js`：列、收、取、删）；对话目录接口（整读、存、删）、附件目录接口（存、取、删、清）与存储目录（配置的读写、旧数据迁入、换位置）；MCP 服务池（起、连外部服务，列工具、调工具）；沙箱环境（装、查、清，给桥接起的进程接上）；视频换壳（浏览器认不得的封装借环境里的 ffmpeg 换进 MP4）；沙箱的三道筛（指令、路径、环境变量）是纯函数，单独一段 |
| `test/` | `npm test` 先跑 `test/unit/`（Node 自带的 `node --test`，把 `src/` 拼起来在 Node 里测纯函数：工具参数救治、流式分段、diff 计数、余墨、思考档位、只读指令、输出裁行、沙箱筛查……几百毫秒跑完），再跑端到端：起假模型接口、测试桥接与无头 Edge / Chrome，逐个跑用例（对谈、执事、言行合一与卷宗、差遣、旁注、记忆、分组、余墨与历史、表单、健壮性、桥接安全）；面向 Windows，其他平台未做适配 |
| `build.js` | 拼接规则（桥接与单元测试共用）；`npm run format` 用 Prettier 统一格式，`npm run check` 用 `tsc --checkJs`（按 `jsconfig.json`）做类型检查——两者都经 npx 临时取用，只在开发时，不进运行时、不进依赖 |

内置提示词的写法、拼接次序与轻重之分，见 [`prompts/README.md`](../prompts/README.md)。
