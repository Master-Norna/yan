# 代码结构与开发

[← 文档目录](README.md)

零依赖、无转译：源码分成多段，桥接在请求 `/support.js` 与 `/app.css` 时按路径顺序即时拼接（子目录就地展开）（ETag 取各段的大小与修改时间），改一段刷新即生效；`node build.js` 产出仓库里的 `support.js` 与 `app.css` 供 `file://` 直接打开。

| 目录 / 文件 | 内容 |
| --- | --- |
| `src/` | 页面脚本，按领域分段（状态与存储、对话数据、Markdown 与图表、渲染、行迹时间线、旁注、记忆、文件与卷宗、对话引擎、接口、设置、预设、文档），拼进同一个闭包；系统提示照 `prompts/assistant.js` 末的 order 表拼。`src/15-tools/` 是工具注册表：一件工具一份登记（给谁用、可否并发、有无副作用、怎么执行、行迹怎么画、带给下一问的摘要），交给模型的定义、执行、行迹卡片、出处都从这张表派生；每件记着属哪一组，预设按组挑，加一件工具只需加一份登记与 `prompts/tools.js` 里的一段说明。数据模型（Store / Conversation / Message / Step / Profile…）以 JSDoc typedef 写在 `00-state.js` 顶部，`types.d.ts` 是给类型检查用的全局声明（随项目分发的库、宽松的 DOM），运行时不加载 |
| `styles/` | 样式，按层次分段（基础与主题、布局、欢迎页、对话、正文内容、文件、输入区、设置、行迹、组件、动效与响应式、纸墨皮肤）；顺序即层叠顺序 |
| `prompts/` | 内置提示词与工具说明，见其 README |
| `server.js` · `server/web.js` · `server/http.js` · `server/work.js` · `server/chats.js` · `server/store.js` · `server/files.js` · `server/sandbox.js` · `server/mcp/` · `server/env/` | 本机桥接：`server.js` 管转发、静态与拼接，`server/web.js` 管联网（地址门禁、翻网页、检索、调接口），`server/http.js` 是各接口共用的读写 JSON、出错回 400 与原子写盘；执事接口（目录、指令、文件、检索、目录选择框、后台指令）、卷宗目录接口（列、收、取、删）、对话目录接口（整读、存、删）、附件目录接口（存、取、删、清）与存储目录（配置的读写、旧数据迁入、换位置）；MCP 服务池（起、连外部服务，列工具、调工具）；沙箱环境（装、查、清，给桥接起的进程接上）；沙箱的三道筛（指令、路径、环境变量）是纯函数，单独一段 |
| `test/` | `npm test` 先跑 `test/unit/`（Node 自带的 `node --test`，把 `src/` 拼起来在 Node 里测纯函数：工具参数救治、流式分段、diff 计数、余墨、思考档位、只读指令、输出裁行、沙箱筛查……几百毫秒跑完），再跑端到端：起假模型接口、测试桥接与无头 Edge / Chrome，逐个跑用例（对谈、执事、言行合一与卷宗、差遣、旁注、记忆、分组、余墨与历史、表单、健壮性、桥接安全）；面向 Windows，其他平台未做适配 |
| `build.js` | 拼接产出；`npm run format` 用 Prettier 统一格式，`npm run check` 用 `tsc --checkJs`（按 `jsconfig.json`）做类型检查——两者都经 npx 临时取用，只在开发时，不进运行时、不进依赖 |

内置提示词的写法、拼接次序与轻重之分，见 [`prompts/README.md`](../prompts/README.md)。
