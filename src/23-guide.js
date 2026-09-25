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
    lead: "接入模型，落笔初问",
    summary: "接入一个模型，便可落笔。顶栏右侧三件，标示言此刻的情形。",
    steps: [
      {
        h: "接入模型",
        body: "设置 → 模型 → 新增：填显示名称、Base URL 与 API Key，点「获取列表」择定模型，亦可手填模型 ID。接口分 **OpenAI 兼容**（多数服务与中转站）与 **Anthropic** 两种。填毕以「测试连接」验一遍。",
        noteLabel: "留意",
        note: "API Key 只存于本机的 配置.json，导出的备份不含它。"
      },
      {
        h: "落笔",
        body: "输入框里写下所问，Enter 寄出，Shift + Enter 换行；图片可径直粘贴。作答途中亦可补上一句，待模型说到落点时递上，不打断其思路。"
      },
      {
        h: "识顶栏",
        body: "右上三件：一点印泥是连接——静时空心，作答时朱色呼吸，断开则转赤；中间一方砚台，点之明暗互换；右侧一笔墨是用量，未设上限记所耗，设了便是余墨，随用随减。",
        note: "印泥转赤，多是 start.cmd 的窗口已关。重新打开，下一回寄出时页面自会接上。"
      }
    ]
  },
  {
    id: "modes",
    title: "言与行",
    lead: "对谈与执事，以目录为界",
    summary: "同一段对话，不绑目录是「言」，照常对谈；绑定目录是「行」，在其中读写文件、执行指令。",
    steps: [
      {
        h: "言 · 对谈",
        body: "未绑目录即为对谈。需要表格、文档、PDF 一类成品时，模型将其落入卷宗，答末列出「成品 n 件」，可预览，可下载。"
      },
      {
        h: "行 · 执事",
        body: "欢迎页点「目录」签，择一工作目录，此段对话便是执事：检索、读懂、修改、运行、验证，每一步皆记于行迹。",
        note: "执事只在此目录内动手。若需触及目录之外，先于设置 → 工具看清沙箱与可及范围。"
      },
      {
        h: "依目录归组",
        body: "侧栏里绑定同一目录的对话归为一组，组首一方「工」印，左侧一道朱线标出范围；组首的「＋」在此目录另起一段。"
      }
    ]
  },
  {
    id: "safety",
    title: "权限沙箱",
    lead: "三档权限与沙箱之界",
    summary: "指令逐条可见。何时须经你首肯，由三档权限而定；沙箱在桥接一侧守护系统。",
    steps: [
      {
        h: "三档权限",
        body: "**问而后行**：凡会改动的指令逐条请示，只读者径行。**审而后行**：由桥接代审，寻常改动放行，只拦伤及系统、难以恢复者。**径行**：不再审查。输入框旁随时可换。"
      },
      {
        h: "沙箱",
        body: "问而后行下从严：改动不出工作目录，机密文件不碰，动系统或直接外联的指令拦下，转请你定夺。审而后行与径行只守系统本身。总开关在设置 → 工具。",
        noteLabel: "留意",
        note: "沙箱是静态筛查，并非进程隔离；MCP 服务以你的权限运行，不受其约束。"
      },
      {
        h: "止",
        body: "作答时寄出键化为「止」，按下即停；正在执行的指令连同其子进程一并收束。"
      }
    ]
  },
  {
    id: "files",
    title: "卷宗附件",
    lead: "附件的来路，成品的归处",
    summary: "附件随一问送出；卷宗是跨对话的书架，常用文件收存于此。",
    steps: [
      {
        h: "附件",
        body: "点「＋」、拖入或粘贴皆可：图片、文本、代码、PDF 与 Office 文档。文档先在本机抽出正文；单件不过 32 MB，一次至多 10 件。"
      },
      {
        h: "卷宗",
        body: "侧栏的「卷宗」即存储位置里的 `卷宗/` 目录。拖入，或在附件上按「藏」收存；需随消息送出时，从「＋」中选「卷宗」。",
        note: "卷宗里的文档对每段对话皆可读，模型用到时方才取回；设置 → 工具中可关闭。"
      },
      {
        h: "成品",
        body: "模型所作的文件列于答末的「成品」卡：就地预览，Word、Excel、PPT 亦可抽出正文查看；日后在卷宗中删去的，此处标为「已移出」。"
      }
    ]
  },
  {
    id: "notes",
    title: "旁注引用",
    lead: "就地追问，不入正文",
    summary: "读至一处有疑，不必打断主线：或引而问之，或于旁另起一段小对话。",
    steps: [
      {
        h: "引用",
        body: "在回复中划选一段，浮出「引用」，所选即作为引文置入输入框，随下一问送出。"
      },
      {
        h: "旁注",
        body: "划选后择「旁注」，右侧展开一段附于此处的小对话。它读得到正文，正文读不到它；只查不改，不动文件。",
        note: "同一条回复上可起数条旁注；「旁注 n」打开目录，‹ › 于各条间切换，「阔」铺满整页。"
      },
      {
        h: "随分支而行",
        body: "旁注随所注的一问一答而行：切换至另一版本，注于旧版的旁注暂隐，切回即现。"
      }
    ]
  },
  {
    id: "delegate",
    title: "差遣",
    lead: "遣帮手分担一事",
    summary: "量大而独立的事，模型会差遣帮手另起一段去做，事毕回报。",
    steps: [
      {
        h: "何时差遣",
        body: "通读一批资料并归纳、多路检索比对、在陌生模块中排查——此类事由模型自行分出，互不相干者可数件并行。"
      },
      {
        h: "观其所为",
        body: "行迹中的差遣卡片可以展开：帮手所领之命、所行每一步、最后的回报，皆在其中。输入框上方的帮手条亦可直达。",
        noteLabel: "留意",
        note: "帮手看不到这段对话，只凭任务说明行事；它不向你请示，也不改动记忆。"
      }
    ]
  },
  {
    id: "presets",
    title: "预设",
    lead: "为专事定一套做法",
    summary: "将提示词、工具、MCP 服务、模型与权限合为一套，选用即全部换上。",
    steps: [
      {
        h: "新添",
        body: "设置 → 预设 → 新添：命名，再写一段提示词——所任何职、所司何事、答以何种风格。提示词列于系统提示之首。"
      },
      {
        h: "择工具",
        body: "工具按组勾选：联网、计算、指令与文件、翻文档、请示、记忆与旧谈、差遣；已接入 MCP 的，再择定所用服务。全数勾选即为「全给」，日后新添者亦随之给出。",
        note: "工具愈少，每一问所负的定义愈轻；只作对谈的预设，工具可一概不选。"
      },
      {
        h: "选用",
        body: "输入框旁的模型菜单中多出「预设」一段，点选即换上，模型按钮上标其名。预设若带模型或权限，一并换上。不选即为本色。"
      }
    ]
  },
  {
    id: "groups",
    title: "分组",
    lead: "聚相关之谈为一组",
    summary: "相关的对话聚为一组，不至散落；组可带一个预设与一个默认目录。",
    steps: [
      {
        h: "立组",
        body: "侧栏「分组」进入分组页，点「＋ 新建分组」；或在对话「⋯」里择「移入分组」→「新建分组…」，就地立一组并移入。已有的组，把对话拖到组上即移入，拖出组外即移出。"
      },
      {
        h: "定其所依",
        body: "侧栏组首的「⋯」→「设置」，或分组页中点开一组：可改组名，择一个预设，定一个默认目录。组里新起的对话皆依此——预设的提示词、工具与模型一并换上，绑定目录即为行。",
        note: "这两样只管新起的对话；已在组中的对话照旧。"
      },
      {
        h: "在组中行文",
        body: "侧栏组首的「＋」或分组页的「在此组新建」另起一段，输入框「＋」旁标着所归之组。侧栏里的组与「工」组一样按时间排，组里一有新言，整组便靠前。组里的对话置顶，只在组内居前，右上角折一小角为记。解散只拆组，对话退回散列。"
      }
    ]
  },
  {
    id: "mcp",
    title: "MCP",
    lead: "接入外部服务",
    summary: "借 MCP，言可调用别处的能力，如 GitHub 的仓库与议题，或其他项目自带的工具。接入只需配置，无需改动代码。",
    steps: [
      {
        h: "觅其接法",
        body: "服务的说明中通常附一段 JSON：本机程序写明 `command` 与 `args`，远端服务写明 `url`。",
        note: "项目中已有的 `.mcp.json` 可整段粘入「以 JSON 编辑」，写法与 Claude、Cursor 通用。"
      },
      {
        h: "于设置中添入",
        body: "设置 → MCP → 新增服务，填入命令或地址；令牌置于环境变量或请求头中，页面上遮蔽显示。"
      },
      {
        h: "交予模型",
        body: "接通后卡上显出工具件数。对话中说明所求，模型自会择用相宜的工具，行迹里记下所调何件；工具繁多的服务只给模型一张目录，按需取用。",
        noteLabel: "留意",
        note: "标为只读的工具径直调用，其余在问而后行下逐次请示。"
      }
    ]
  },
  {
    id: "env",
    title: "环境",
    lead: "为模型备一套开发环境",
    summary: "独立的 Python 与常用工具链，装于存储位置的 `环境/`，不改动系统。",
    steps: [
      {
        h: "勾选",
        body: "设置 → 环境：一组工具一张卡，名称居左、状态居右——空框未选，朱色实心待装，一笔勾已装。可选数据处理、办公文档、图像、音视频，以及 C / C++、Go、Rust、Java 数套工具链。"
      },
      {
        h: "准备",
        body: "点「准备环境」，环境即与勾选对齐：勾上者装，取消者卸。国内镜像下载较快；工具链体量较大，卡上注明约数。",
        note: "模型的指令与 MCP 服务皆接此环境；所缺之库，模型自行装入即可。"
      }
    ]
  },
  {
    id: "memory",
    title: "记忆",
    lead: "何者当记，何时可忘",
    summary: "录是一份跨对话的记忆：你的偏好、身份与约定，此后不必重述。",
    steps: [
      {
        h: "记与翻",
        body: "模型认为值得留存的，以一句记入；新话题中用得着时再行翻检。行迹里「记入」「翻记忆」以一抹冷色标示。"
      },
      {
        h: "改与忘",
        body: "设置 → 记忆中每条皆可修改、删除，亦可手记一条；整份记忆可以关闭。",
        noteLabel: "留意",
        note: "记忆的内容不入系统提示，只告知模型现有几条；用到时方才翻阅。"
      }
    ]
  },
  {
    id: "storage",
    title: "存储备份",
    lead: "存储所在，迁移与备份",
    summary: "对话、卷宗、附件与配置同在一个存储目录，复制即是备份。",
    steps: [
      {
        h: "所在",
        body: "默认为 `~/.yan/`：`对话/` 一段一个文件，`卷宗/` 收成品与存入的文件，`附件/` 存附件原件，`配置.json` 记设置与模型。数个浏览器共用这一份。"
      },
      {
        h: "迁移",
        body: "设置 → 通用 → 存储位置，填一目录，整份拷至其下，旧处原样保留。",
        note: "环境不随之迁移，至新处重新准备一遍即可。"
      },
      {
        h: "备份",
        body: "设置 → 通用中导出备份（可含附件原件）；导入时按 id 合并，已有者略过。备份不含 API Key。"
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
