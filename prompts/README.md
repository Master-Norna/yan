# 内置提示词

模型能看到、而用户在界面上看不到的文字，都收在这一目录里，改完刷新页面即生效（无需重启桥接）。

| 文件 | 内容 | 何时进入请求 |
| --- | --- | --- |
| `assistant.js` | 通用系统提示：日期、联网分寸、拿不准就问、画图约定、言的克制答法（manner）；自动拟题；压缩前文的摘要请求 | 每次请求；各段按条件拼接（manner 只给言；拟题与压缩是单独的请求） |
| `work.js` | `hint`：「行 · 执事」的工作方法与指令约束；`archive`：言里工具落在卷宗时的一段轻提示（草稿目录、成品放根）；跳过 / 未读时回给模型的话 | 桥接在线时：绑了目录用 hint，没绑用 archive |
| `side.js` | 旁注追问的聚焦句 | 仅旁注面板里的请求 |
| `memory.js` | 录（记忆）：有多少条、两条分寸 | 记忆启用时；条目内容本身不进提示 |
| `delegate.js` | 差遣（子 Agent）：帮手自己的系统提示；回报的格式 | 帮手的请求另拼一段 |
| `tools.js` | 各工具的 description 与参数说明；带 `brief` 的在言里用 brief（短说明） | 随工具一并交给模型；言不带 edit_file / search_files / update_plan；旁注不带 http_request；run_js 谁都有 |

拼接顺序（系统提示）：用户在模型设置里填的 system prompt → `assistant.today` → `assistant.judgement` → `work.hint`（行）/ `work.archive`（言，桥接在线）→ `assistant.search`（桥接在线）→ `assistant.asking`（ask_user 可用）→ `assistant.delegating`（行且 delegate 可用；只是一句提醒，何时差遣写在工具说明里）→ `memory.hint`（记忆启用）→ `assistant.drawing` → `assistant.manner`（言）→ `side.*`（旁注）/ `delegate.system`（帮手）。

轻重之分：行（执事）的提示可以重一些——它在干活，规矩多是应该的；言（对谈）的每一问都背着系统提示与工具定义，多一句都是开销、也在稀释模型对问题本身的注意，所以言只留三件事：主动问（asking）、画在正文里（drawing）、克制的答法（manner），文件工具只带产出所需的四件并用短说明。行文文白相杂、能省则省：今日能接工具的模型读「便」「亦」「者」不费力，省下的字都是每一问的开销，顺带让它答得也雅一点；但不用生僻的文言，读不懂或读歪了就得不偿失。改提示词后跑 `node test/prompt-size.cjs` 看言那一行有没有涨回去。

分工原则：模型是把系统提示和工具定义一起读的，同一件事只说一遍——每件工具做什么、何时用、有什么不能猜的规矩，写在 `tools.js` 的 description 里；系统提示只放环境事实（日期、目录、平台、shell）、跨工具的做法（先读再改、改后验证、确认规则）和页面的呈现约定（画图）。改提示词后跑 `node test/prompt-size.cjs` 看各模式的总量（`--dump` 打印模型读到的全文），再跑 `npm test` 过一遍用例。

写法：每个文件往 `window.YAN_PROMPTS` 挂一个对象，值是字符串或按行拼接的字符串数组；`{{名字}}` 是运行时填入的值，名字见各文件注释。系统提示的装配在 `src/14-chat-engine.js` 的 `assistantHint` / `workHint`；哪件工具在何处给出、帮手与旁注能不能用，登记在 `src/15-tools/` 的注册表里（`toolDefinitions` 据此挑出并填好说明）。两处都只做拼接，不含文案。

未收入此处、但模型同样会看到的：历史消息的改写（引用以 `>` 引出、执事的「［上一答的行迹］」摘要（冠在下一问开头）、附件超长时的摘要标头，见 `src/14-chat-engine.js` 与 `src/13-files.js` 的 `quotedText` / `stepsDigest` / `summarize`），以及桥接抛出的工具错误（`server/work.js`，如「未找到要替换的文本」）——它们是数据格式与运行时反馈，随代码走。
