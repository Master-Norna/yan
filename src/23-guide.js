// 言 · 设置 → 文档：言的用法，一事一篇。目录像古籍的目录页（卷次、题名、引线、提要），点开一篇是一页版心：
// 顶上卷次与书口的鱼尾，步骤是小朱印，提醒写成右侧的眉批，底下翻前后篇。
// 正文只认两样记号：`代码` 与 **加重**；要加一篇，往 GUIDE 里添一条
/**
 * @typedef {{ h: string, body: string, note?: string, noteLabel?: string }} GuideStep
 * @typedef {{ id: string, title: string, lead: string, summary: string, steps: GuideStep[] }} GuideTopic
 */
/** @type {GuideTopic[]} */
const GUIDE = [
  {
    id: "start",
    title: "起步",
    lead: "接模型、问第一句",
    summary: "接上一个模型，便能落笔；顶栏右侧三件，看一眼就知道言此刻的样子。",
    steps: [
      {
        h: "接一个模型",
        body: "设置 → 模型 → 新增：填显示名称、Base URL、API Key，再点「获取列表」挑模型，或手填模型 ID。接口选 **OpenAI 兼容**（大多数服务与中转站）或 **Anthropic**。填完点「测试连接」。",
        noteLabel: "留意",
        note: "API Key 只存在本机的 配置.json 里，导出的备份不带它。"
      },
      {
        h: "落笔",
        body: "在输入框写下问题，Enter 寄出，Shift + Enter 换行；图片可直接粘贴。作答途中还能再写一句，它会等模型说到一个落点再递上。"
      },
      {
        h: "认顶栏",
        body: "右上三件：一点印泥是连接——静时空心，作答时朱色呼吸，断了转赤；中间一方砚台，点它明暗互换；右边一笔墨是用量，没设上限时记已耗，设了便是余墨，随用随减。",
        note: "印泥转赤，多半是 start.cmd 的窗口被关了：重新打开它，下一回寄出时页面自会接上。"
      }
    ]
  },
  {
    id: "modes",
    title: "言与行",
    lead: "对谈与执事，绑一个目录",
    summary: "同一段对话，不绑目录是「言」，照常聊；绑上一个目录是「行」，在那里读写文件、跑指令。",
    steps: [
      {
        h: "言 · 对谈",
        body: "不绑目录即对谈。要一份表格、文档、PDF 时，模型把成品落进卷宗，答末列出「成品 n 件」，可预览、可下载。"
      },
      {
        h: "行 · 执事",
        body: "欢迎页点「目录」签，选一个工作目录，这段对话就是执事：检索、读懂、修改、运行、验证，一步步记在行迹里。",
        note: "执事只在这个目录里动手；要它碰目录外的东西，先在设置 → 工具里看清沙箱与可及范围。"
      },
      {
        h: "按目录归组",
        body: "侧栏里绑了同一目录的对话归成一组，头上一方「工」印；组头的「＋」在此目录另起一段。"
      }
    ]
  },
  {
    id: "safety",
    title: "权限沙箱",
    lead: "三档权限与沙箱的边界",
    summary: "指令逐条可见。做到哪一步问你一声，由三档权限定；沙箱在桥接那头守着系统。",
    steps: [
      {
        h: "三档权限",
        body: "**问而后行**：会改动东西的指令逐条请示，只读的径直跑。**审而后行**：由桥接代审，常规改动放行，只拦伤及系统与难以恢复的。**径行**：不再审查。输入框旁可随时换。"
      },
      {
        h: "沙箱",
        body: "问而后行里从严：改动不出工作目录，机密文件不碰，动系统与直接外联的指令拦下、转请你定夺。审而后行与径行只守系统本身。总开关在设置 → 工具。",
        noteLabel: "留意",
        note: "沙箱是静态筛查，不是进程隔离；MCP 服务以你的权限运行，不受它约束。"
      },
      {
        h: "停下",
        body: "寄出键在作答时变成「止」，按下即停；正在跑的指令连同它起的子进程一起收掉。"
      }
    ]
  },
  {
    id: "files",
    title: "卷宗附件",
    lead: "文件怎么进来、成品落在哪",
    summary: "附件随一问送出；卷宗是跨对话的书架，常用的文件收在这里。",
    steps: [
      {
        h: "附件",
        body: "点「＋」、拖进来或粘贴：图片、文本、代码、PDF、Office 都行。文档先在本机抽出正文；单件 32 MB，一次最多 10 件。"
      },
      {
        h: "卷宗",
        body: "侧栏的「卷宗」即存储位置里的 `卷宗/` 目录。拖进去、或在附件上按「藏」收入；要随消息送出，从「＋」里选「卷宗」。",
        note: "卷宗里的文档对每段对话都可读，模型用到时才取回；设置 → 工具里可关。"
      },
      {
        h: "成品",
        body: "模型做出的文件挂在答末的「成品」卡上：预览就地看，Word、Excel、PPT 也能抽出正文来看；之后在卷宗里删了的，那一行标「已移出」。"
      }
    ]
  },
  {
    id: "notes",
    title: "旁注引用",
    lead: "就地追问，不入正文",
    summary: "读到一处有疑问，不必把主线打断：引它追问，或在旁边另开一条小对话。",
    steps: [
      {
        h: "引用",
        body: "在回复里划选一段，浮出「引用」，那段便作为引文带进输入框，随下一问送出。"
      },
      {
        h: "旁注",
        body: "划选后选「旁注」，右侧开一条附在这一处的小对话。它读得到正文，正文读不到它；只查不改，不会动文件。",
        note: "同一条回复上可起几条旁注；「旁注 n」打开目录，‹ › 在各条间切换，「阔」铺满整页。"
      },
      {
        h: "跟着分支走",
        body: "旁注跟着它所注的那一问一答走：换到另一个版本，注在旧版上的旁注暂不在眼前，换回来就回来。"
      }
    ]
  },
  {
    id: "delegate",
    title: "差遣",
    lead: "帮手：分出去的活",
    summary: "量大、独立的活，模型会差遣帮手另起一段去做，做完回报。",
    steps: [
      {
        h: "何时差遣",
        body: "通读一批资料并归纳、多路检索比对、在不熟的模块里排查——这类活由模型自己决定分出去，几件互不相干的还能并行。"
      },
      {
        h: "看它做什么",
        body: "行迹里的差遣卡片可以点开：帮手领的任务、走的每一步、最后的回报都在里面。输入框上方的帮手条也能直达。",
        noteLabel: "留意",
        note: "帮手看不到这段对话，只凭任务说明做事；它不向你请示，也不改记忆。"
      }
    ]
  },
  {
    id: "presets",
    title: "预设",
    lead: "做一个自己的 Agent",
    summary: "把提示词、工具、MCP 服务、模型与权限打包成一套，选用即换上。",
    steps: [
      {
        h: "新添",
        body: "设置 → 预设 → 新添：起个名字，写一段提示词——它是谁、做什么、怎么答。提示词排在系统提示的最前面。"
      },
      {
        h: "挑工具",
        body: "工具按组勾选：联网、计算、指令与文件、翻文档、请示、记忆与旧谈、差遣；接了 MCP 的，再勾用哪几个服务。全勾上即「全给」，往后新添的也跟着给。",
        note: "工具越少，每一问背的定义越轻；只聊天的预设，工具可以全不勾。"
      },
      {
        h: "选用",
        body: "输入框旁的模型菜单里多了「预设」一段，点一个即换上；模型按钮上标着它的名字。带了模型或权限的，一并换上。不选即本色。"
      }
    ]
  },
  {
    id: "mcp",
    title: "MCP",
    lead: "接外部服务：GitHub、自家项目",
    summary: "MCP 让言调用别处的能力：GitHub 的仓库与议题、你自己项目里的工具。只改配置，不动代码。",
    steps: [
      {
        h: "找到服务的接法",
        body: "服务的说明里通常给出一段 JSON：本机程序写 `command` 与 `args`，远端服务写一个 `url`。",
        note: "项目里现成的 `.mcp.json`，整段粘进「以 JSON 编辑」即可，写法与 Claude、Cursor 通用。"
      },
      {
        h: "在设置里添上",
        body: "设置 → MCP → 新增服务，填命令或地址；令牌放在环境变量或请求头里，页面上遮着。"
      },
      {
        h: "让模型用起来",
        body: "接通后卡上亮出工具件数。对话里直说要做的事，模型会挑合用的工具，行迹里记着它调了哪件；工具多的服务只给模型一张目录，按需取用。",
        noteLabel: "留意",
        note: "标了只读的工具径直调用，其余在问而后行下逐次请示。"
      }
    ]
  },
  {
    id: "env",
    title: "环境",
    lead: "Python、C、Go 装在哪、怎么用",
    summary: "给模型备一套自带的开发环境，装在存储位置的 `环境/` 里，不改动系统。",
    steps: [
      {
        h: "勾选",
        body: "设置 → 环境：一组工具一张卡，名称在左、状态在右——空框没选，朱色实心待装，一笔勾已装。有数据处理、办公文档、图像、音视频，也有 C / C++、Go、Rust、Java 几套工具链。"
      },
      {
        h: "准备",
        body: "点「准备环境」，环境便对齐到勾选：勾上的装，取消的卸。国内镜像下得快，工具链大些，卡上写着约多少。",
        note: "模型的指令与 MCP 服务都接着这套环境；它缺什么库，自己装进来即可。"
      }
    ]
  },
  {
    id: "memory",
    title: "记忆",
    lead: "录下什么、怎么忘",
    summary: "录是一份跨对话的记忆：你的偏好、身份、约定，下回不必再说。",
    steps: [
      {
        h: "记与翻",
        body: "模型觉得值得记的，一句话记入；新话题里用得上时再翻。行迹里「记入」「翻记忆」用一点冷色标着。"
      },
      {
        h: "改与忘",
        body: "设置 → 记忆里每条都可改可删，也可手记一条；整份记忆可以关掉。",
        noteLabel: "留意",
        note: "记忆的内容不进系统提示，只告诉模型有几条；用到时它才去翻。"
      }
    ]
  },
  {
    id: "storage",
    title: "存储备份",
    lead: "~/.yan、换位置、导入导出",
    summary: "对话、卷宗、附件与配置都在一个存储目录里，复制即备份。",
    steps: [
      {
        h: "在哪",
        body: "默认 `~/.yan/`：`对话/` 一段一个文件，`卷宗/` 是成品与收进来的文件，`附件/` 是附件原件，`配置.json` 是设置与模型。几个浏览器共用这一份。"
      },
      {
        h: "换位置",
        body: "设置 → 通用 → 存储位置，填一个目录，整份拷过去，旧处原样留着。",
        note: "环境不随之拷走，到新处重新准备一遍即可。"
      },
      {
        h: "备份",
        body: "设置 → 通用里导出备份（可含附件原件），导入时按 id 合并，已有的跳过。备份不含 API Key。"
      }
    ]
  }
];
/** @type {string|null} 正看的那一篇；空即目录 */
let guideTopic = null;
const guideText = text =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
function guideSettingsHtml() {
  const index = GUIDE.findIndex(topic => topic.id === guideTopic);
  if (index < 0)
    return `<div id="guidePage"><h2>文档</h2><p class="settings-lead">言的用法，一事一篇。</p><div class="guide-toc">${GUIDE.map(
      (topic, i) =>
        `<button type="button" class="guide-row" data-guide="${topic.id}"><span class="guide-juan">卷${chineseNumber(i + 1)}</span><span class="guide-title">${escapeHtml(topic.title)}</span><span class="guide-lead-line" aria-hidden="true"></span><span class="guide-gist">${escapeHtml(topic.lead)}</span></button>`
    ).join("")}</div></div>`;
  const topic = GUIDE[index],
    prev = GUIDE[index - 1],
    next = GUIDE[index + 1];
  return `<div id="guidePage" class="guide-doc"><div class="guide-top"><button type="button" class="guide-back" data-guide="">‹ 目录</button><span>·</span><span>卷${chineseNumber(index + 1)} · ${escapeHtml(topic.title)}</span><span class="guide-fish" aria-hidden="true">◆ 言 · 文档</span></div><h2>${escapeHtml(topic.lead)}</h2><p class="guide-summary">${guideText(topic.summary)}</p><div class="guide-steps">${topic.steps
    .map(
      (step, i) =>
        `<section class="guide-step"><div class="guide-main"><h4><span class="guide-no" aria-hidden="true">${chineseNumber(i + 1)}</span>${escapeHtml(step.h)}</h4><p>${guideText(step.body)}</p></div>${
          step.note ? `<aside class="guide-note"><b>${escapeHtml(step.noteLabel || "眉批")}</b>${guideText(step.note)}</aside>` : ""
        }</section>`
    )
    .join(
      ""
    )}</div><div class="guide-pager">${prev ? `<button type="button" data-guide="${prev.id}">‹ 卷${chineseNumber(index)} · ${escapeHtml(prev.title)}</button>` : "<span></span>"}${next ? `<button type="button" data-guide="${next.id}">卷${chineseNumber(index + 2)} · ${escapeHtml(next.title)} ›</button>` : "<span></span>"}</div></div>`;
}
function bindGuideEvents() {
  if (settingsTab !== "guide") return;
  $("#guidePage").addEventListener("click", event => {
    const target = /** @type {HTMLElement} */ (event.target).closest("[data-guide]");
    if (!target) return;
    guideTopic = target.dataset.guide || null;
    renderSettings();
    $("#settingsContent").scrollTop = 0;
  });
}
