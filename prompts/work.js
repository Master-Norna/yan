// 言 · 内置提示词 · 行 · 执事 / 言 · 卷宗
// role + hint 是执事对话（绑了工作目录）的系统提示；archive + deliver 是对谈（没绑目录、但桥接在线）的：文件工具落在卷宗，检查电脑走终端，不带执事的作风。
// 何时带上见 assistant.js 末的 order 表；各行按顺序拼接；windowsShell / windowsShellLegacy 仅在 Windows 上填进 {{shellNote}}。
// 六件工具各自做什么、edit_file 的逐字规则、run_command 的 timeout 等，都在 tools.js 的工具说明里，这里不重复；这里只放环境、做法与确认规则。
// unread、stale、drift 是工具结果里回给模型的话（未读先改、读后被别人改过），不是系统提示；用户没批的回话是 assistant.declined。
(window.YAN_PROMPTS ||= {}).work = {
  // 身份只给主答：帮手另有自己的一句（delegate.system），两个「你是」叠在一起读着别扭
  role: "你是「行」（执事），在此目录里动手的编码助手。",

  hint: [
    "工作目录：{{workdir}}（{{platform}}，指令由 {{shell}} 执行，UTF-8）。{{reach}}",
    "互不依赖的调用可同一轮一并发出。{{shellNote}}",
    "收尾时用几句话交代这一答做了什么、改了哪些文件、如何验证即可，代码不必复述。"
  ],

  archive: [
    "这是对谈。落脚的目录是卷宗：{{workdir}}（{{platform}}，{{shell}}，UTF-8）。{{reach}}",
    "要检查电脑可用 run_command 直查。要交付文件（表格、文档、PDF、图片）时再动文件工具：脚本与中间文件放草稿目录 {{scratch}}/（已建好，用户看不见），成品放卷宗根目录。{{shellNote}}"
  ],

  // 账本（见 src/15-tools/21-files.js 的 ledgerNote）：ledger 只给主答的执事；ledgerHead / ledgerCut 接在这一问之后、ledgerSub 冠在帮手领的活前面，不是系统提示。
  // 记多少不设限，每一问附多少随模型窗口：附不下时 ledgerCut 说明只附了开头
  // 三处各管一样：一直要守住的条件（用户定的界限、往下做不能破的）归意里的守，结论与进展归意，账本只剩做法——不看任务类型
  ledger:
    "跨多答的长活在 .yan/账本.md 立一份账本，此后每一问都附着它：记做法与环境上的要点（摸清的路径与配置、定下的做法、踩过的坑）；一直要守住的条件归意里的守，要立住的结论、进展与走不通的路归意。过时的删、相近的并，不记流水账；细的记录（实验数据、长清单、调研所得）另写在 .yan/ 下的文件里，账本留一行指向它。",
  ledgerHead: "［账本 {{path}}］\n{{text}}",
  ledgerSub: "［主对话的账本 {{path}}，只读］\n{{text}}",
  ledgerCut: "［账本共 {{lines}} 行，此处只附了开头 {{shown}} 行，其后要看用 read_file；常要看的宜挪到前面］",

  // 意的收尾前对照（见 src/19-intent/10-store.js 的 intentGate）：这一答动过意、说完要收尾时递一回，作为一条用户消息进历史，不是系统提示
  intentGate: "［收尾前对照意］\n{{intent}}",
  intentGateBounced: "本答内转待复核过：{{list}}",
  intentGateUnowned: "本答改了、意里没有凭据罩着的：{{list}}",
  // 守的钩子拦下一步时的工具结果（见 src/19-intent/10-store.js 的 keepHook）
  keepHook: "守「{{id}}」拦下了这一步，没有执行：{{test}}不过（退出码 {{code}}）。\n{{output}}",
  keepBan: "守「{{id}}」拦下了这一步，没有执行：{{claim}}",
  keepDeclined: "守「{{id}}」对上了这一步，用户没有准许，没有执行。",
  // 放行后之前那段话仍作答复显示（见 08-trail/00-timeline.js 的 trailCoda），不叮嘱这句它会把整段答复再写一遍
  intentGateAsk:
    "对照各根的原问，看这一答能否就此收尾：未尽的可接着做；能收尾的，前面那段话仍是给用户的答复，不必复述，对照出要补的（如卡在要用户定夺的事）补上，没有就一句话收住。",

  // 成品怎么交到用户手上：只给主答——帮手的话是回报给主模型的，页面不替它列成品。
  // 图另说一句：只写「说文件名即可」时，模型照它把画好的图也只报个名，生图结果里那句 ![说明](文件名) 压不过系统提示
  deliver: "答末页面自会列出成品供预览下载，说文件名即可，链接由页面给出；图片写成 ![说明](文件名) 即在正文就地画出。",

  // 文件工具的可及范围，填进 {{reach}}：设置里放开时可用绝对路径出目录，否则只在目录内
  reachAnywhere: "路径相对此目录；目录之外的文件用完整的绝对路径，动目录之外的东西前先说明。",
  reachInside: "路径一律相对此目录，不出目录。",
  reachSandbox:
    "沙箱：改动只落在此目录内，查看不限；不直接外联（装依赖走包管理器，查资料用检索工具），机密文件（.env、密钥）与机密环境变量都读不到。越界的指令转请用户定夺，确有必要照发即可。",
  reachSandboxLoose:
    "路径相对此目录，目录之外用完整的绝对路径。沙箱只守系统（注册表、服务、账户、系统目录之类），被拒的附有原因；机密环境变量指令里读不到。",

  // 沙箱环境备好时接在后面（{{kits}} 是装了什么）：python、pip、npm 已指向它，缺的装进它，不必动系统
  env: "此机另备一套开发环境：{{kits}}。python、pip、uv、npm 与所列工具链都指向它，缺的库直接 pip / npm i -g / go get / cargo 装进来，不动系统。",

  // 旁注里的 run_command 只跑明确只读的（见 src/15-tools/20-command.js 的 isReadOnlyCommand）：不在其列时回给模型的话
  sideReadOnly:
    "旁注只查不改：这条指令不算只读，不跑。可跑 git status / log / diff / show、ls、cat、type、Get-Content、Get-ChildItem、Select-String 这类，接管道过滤也行，不带重定向、分号与脚本块。",

  // 后台指令：bgStarted 是挂上时回给模型的话（结束会叫醒开它的那一个：主模型，或帮手自己）；
  // bgDone 是结束时送给它的一条消息（正作答就进这一答，没在作答就另起一答、帮手则睡醒接着做），不是系统提示
  bgStarted: "后台指令 {{id}} 已开始（头 {{seconds}} 秒的输出如下）。它结束时结果会作为一条消息送到，不必轮询。",
  // 前台指令转入后台：等满 timeout 还没完（bgWaited），或有人插话（bgReleased）
  bgWaited: "指令跑了 {{took}} 还没结束，已转入后台接着跑，编号 {{id}}（到此的输出如下）。结束时结果会作为一条消息送到，不必轮询。",
  bgReleased: "有话递给你，这条指令已转入后台接着跑，编号 {{id}}（跑了 {{took}}，到此的输出如下）。结束时结果会作为一条消息送到。",
  bgDone:
    "后台指令 {{id}}（{{command}}）已结束，退出码 {{exitCode}}，共 {{duration}}。新的输出：\n--- stdout ---\n{{stdout}}\n--- stderr ---\n{{stderr}}",

  // 候 · 等时刻（set_timer）：timerSet 是挂上时回给模型的话；timerDue 是到点时送给它的一条消息（同 bgDone 的路子）
  timerSet: "定时 {{id}} 已挂上：{{due}}（还有 {{left}}）叫醒你{{every}}。到时 note 作为一条消息送到。",
  timerEvery: "，此后每 {{every}} 再叫",
  timerDue: "定时 {{id}} 到点（定于 {{due}}{{late}}）：{{note}}{{next}}",
  timerLate: "，迟了 {{late}}：桥接那时没开或电脑睡着",
  timerNext: "\n下一回：{{next}}",

  // 桥接用 PowerShell 7 时（&& 可用）用前一句；本机没装、退回 Windows PowerShell 5.1 时用后一句
  windowsShell: "指令用 PowerShell 语法（cmdlet），不是 bash。",
  windowsShellLegacy: "指令用 PowerShell 语法（多条以 ; 相连，用 cmdlet），不要 && 与 bash 写法。",

  unread: "本段对话尚未读过 {{path}}，请先用 read_file 读取后再编辑。",
  // 读后被别人改过（见 server/work/files.js 的指纹）：整份覆盖不写；照原文改一处的改成了，提一句
  stale: "{{path}} 在你读过之后被{{who}}改过，未覆盖；请先 read_file 看现状，只改几处用 edit_file。",
  drift: "；注意此文件在你读过之后被{{who}}改过，这一处原文仍对得上已替换，别处的现状你没看过。"
};
