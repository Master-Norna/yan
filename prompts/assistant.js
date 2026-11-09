// 言 · 内置提示词 · 通用
// 系统提示怎么拼，看文末的 order 表：一段一行，写明取哪句、何时带上。预设的提示词排在所有段落之前。
// 言的提示以轻为要：每多一句都是每一问的开销，也在稀释模型对问题本身的注意。文白相杂、能省则省——今日能接工具的模型读这种句子不费力。
// 原则：工具本身做什么、何时用，写在 tools.js 的工具说明里，这里不再复述；这里只放环境事实、跨工具的做法与页面的呈现约定。{{…}} 为运行时填入的值。
(window.YAN_PROMPTS ||= {}).assistant = {
  // 言的 GitHub 账号。不写「你是言」：预设排在最前、可以自有角色，行与帮手也各有一句「你是」，这里只交代身在何处、账号是谁。
  // 署名写成「要署时」而不是规矩：周围人不喜欢强制署名，署不署由模型或用户的记忆、预设定；本机 git 的作者不因此变
  identity:
    "此处是言（Yan）。你在 GitHub 上的账号是 Agent-Yan，要署共创时写 Co-Authored-By: Agent-Yan <352840372+Agent-Yan@users.noreply.github.com>。",

  // 星期给定时用：「下周一九点」模型自己推算常错
  today: "今日{{iso}}，周{{week}}。",

  // 模型不看这句便不知道能查新近的事；引用附链接是页面的约定
  search: "涉时效或超出所知的事可先联网搜，引用时附上链接。",

  // 画在正文里：页面就地渲染成可交互的一块，不是文件，不该落到目录
  drawing:
    '需要图、图表、示意、演示时可画在正文里：写一个自足的 ```html（样式脚本内联，不引外部资源），页面就地渲染成可交互的一块，不是文件，不必写进目录。底透明、高随内容，配色用 var(--ink) var(--ink-2) var(--paper-2) var(--line) var(--accent)，常用元素已有样式，另备 .card .row .grid .tag。数据图表先 <script src="yan:echarts"></script> 再 echarts.init（已配色、随宽自适应）；流程、时序、结构图写 <pre class="mermaid">…</pre>。',

  // 答法：模型默认满篇标题列表，页面要的是纸上的几段话。言与行都给：行里也常是问答，11-01 用 flash 对照，
  // 去掉这句的回答长两三倍、标题四到九个、多了「问得好」，还会为概念题去联网；行的收尾那句管交代改动，不管行文
  manner: "可先给结论，答得短些；标题、列表留给真有结构的内容。",

  // 压缩前文：把上次压缩以来的往来压成摘要，单独发起的一次请求；摘要此后代替前文进入每一问
  compact:
    "把下面这段对话压成一份摘要，供同一位助手在后续对话里接着用。只写对后续有用的：用户的目标与偏好、已确认的事实与结论、已做的决定与理由、已改动的文件与现状、未解之事与下一步。分点，保留关键的名称、路径、数字与代码标识，不复述过程，不超过 600 字。直接输出摘要本身。\n\n{{transcript}}",

  // 轮内压缩：一答（或一名帮手）之内工具往来快撑满窗口时，把较早的往来压成工作笔记，单独发起的一次请求；
  // 笔记作为一条 assistant 消息代替原文，folded 紧随其后请它接着做（模型自己调 fold 工具撮的也接这一句）
  fold: "你在做下面这件事，途中的工具往来快占满上下文了。把这些往来压成一份工作笔记，代替原文供你接着做：已查明的事实与结论（留关键的路径、行号、命令、数字）、改过的文件与现状、验证过与没验证的、走不通的路、下一步。分点，不复述过程，不超过 1500 字。直接输出笔记本身。\n\n任务：\n{{task}}\n\n往来：\n{{transcript}}",
  folded: "［此前的工具往来已压成上面的笔记，原文不再保留。据此接着做，细节需要时重新查看。］",

  // 前文压成摘要后，摘要以一问一答的样子排在历史最前（各家接口都认这种交替）；之后的往来照旧接在后面
  summary: "［前文摘要］此前的对话压缩如下：\n\n{{summary}}",
  summaryAck: "已了解前文。",

  // 以下几句是作答途中系统插进对话的话，不是系统提示：
  // resume 断线、停下后请模型从断处接着写（手点「继续生成」与自动续写共用）；roundLimit 工具轮次到顶（主答、旁注、帮手共用，「收尾」对帮手即回报）；
  // declined 是用户没批这一步（指令、外部服务的调用）时回给模型的工具结果；
  // supplement / steer 是用户补言的前缀——前者接在工具结果之后递上，后者是把正在写的一轮停在句尾、插进这句话再请它接着写
  resume: "上一条回复在此中断，从断处接着写即可，已写的不必重复。",
  roundLimit: "工具调用已到轮次上限：不再调用工具，就手头所得收尾，交代未尽之处。",
  declined: "用户没有同意这一步。可换个做法，或先说明为何需要它。",
  // 工具交回的图（截图之类）另起一条附在工具结果之后；一答里只留最新一批，先前的换成 stale；模型看不了图时换成 blind
  toolImages: "［上一步工具交回的画面］",
  toolImagesStale: "［此处原有工具交回的画面，已由后来的取代］",
  toolImagesBlind: "［此处原有工具交回的画面，当前模型不收图片，未附上］",
  // 用户发的图同理：模型看不了图时换成这一句
  imageBlind: "［此处原有一张图片，当前模型不收图片，未附上］",
  // 图被接口拒收（太大、格式不认），只这一回不附
  imageRejected: "［此处原有图片，被接口拒收（多半是太大或格式不认），未附上］",
  // 「仍是这一答」：补言在历史里是一条新的用户消息，不点明，模型会把它当新一问，收尾只交代补言之后的那一截
  supplement: "［作答途中用户补充的话，仍是这一答］",
  steer: "［作答途中用户插了一句，你写到此处暂停。读后接着这一答写，可据此改变方向，已写的不必重复］",

  // 自动拟题：头一问发出时单独发起的一次请求（与作答并行），不带系统提示，也不进对话；没拟成的在那一答收尾时再试，那时带上答。
  // 题是用户日后在侧栏里认这段对话的把手：只据当前问答，保留主题关键词。
  // 问「叫它什么」而非「拟个标题」：后者让模型进了标题的文体，出来的是「关于某某的探讨」「某某详解」一类
  title:
    "用户：{{user}}{{assistant}}\n\n——用户往后在侧栏里靠一个称呼认出这段对话。只据这段问答的实际内容，保留项目、任务或主题关键词，简短直白，是个名目而不是一句话（十字上下），用这段对话所用的语言。只答那几个字。"
};

// 系统提示的拼接次序。一段一行，写明何时带上，不写即处处都带：
//   tool  交给模型的工具里有这一件才带（工具不在，讲它的话就是白占地方）
//   mode  work 只给行（绑了目录），chat 只给言
//   roles 只给这几种请求：main 主答、side 旁注、sub 帮手；不写即三种都带
// 要填值、或视情形不带的（环境没备好、没有 MCP 服务附用法……），由 src/14-chat-engine/50-prompt.js 的 PROMPT_VARS 给出，给 null 即这回不带。
// test/prompt-size.mjs 用页面同一份代码拼，量出来的数与页面一致
window.YAN_PROMPTS.order = [
  { key: "assistant.identity" },
  { key: "assistant.today" },
  { key: "work.role", tool: "run_command", mode: "work", roles: ["main"] },
  // 帮手的身份与主答的执事身份同一个位置：先知道自己是谁，再读环境
  { key: "delegate.system", roles: ["sub"] },
  { key: "work.hint", tool: "run_command", mode: "work" },
  { key: "work.closing", tool: "run_command", mode: "work", roles: ["main"] },
  { key: "work.ledger", tool: "write_file", mode: "work", roles: ["main"] },
  { key: "work.archive", tool: "run_command", mode: "chat" },
  { key: "work.deliver", tool: "run_command", roles: ["main"] },
  { key: "work.env", tool: "run_command" },
  { key: "assistant.search", tool: "search_web" },
  { key: "memory.body", roles: ["main", "side"] },
  { key: "mcp.hint" },
  { key: "skills.hint", tool: "read_document" },
  { key: "skills.home", tool: "run_command" },
  { key: "assistant.drawing", roles: ["main", "side"] },
  { key: "assistant.manner", roles: ["main", "side"] },
  { key: "side.passage", roles: ["side"] },
  { key: "side.whole", roles: ["side"] },
  { key: "side.noTools", roles: ["side"] }
];
