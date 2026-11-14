// 言 · 欢迎页：首次引导、提示词与问候
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
function renderWelcome() {
  const work = workMode(),
    group = pendingGroup(),
    seal = $("#welcome .seal");
  // 眉题的印章说这一问落在哪儿：归了组是「集」（旁写组名），绑了目录是「行」，都没有是「言」
  seal.textContent = group ? "集" : work ? "行" : "言";
  seal.title = group ? t`这一问将归入「${group.name}」` : "";
  const mode = $("#welcomeMode");
  mode.textContent = group ? group.name : work ? t("执事") : t("对谈");
  mode.title = group ? group.name : "";
  $("#welcomeSub").textContent = work ? t("以目录为案，言起而事行") : t("长问慢答，尽付纸墨");
  // 节气名只在中文界面注（见 12-season.js）
  $("#welcomeTerm").textContent = LANG === "en" ? "" : solarTerm();
  renderChips(work);
  renderSuggestions(work);
  renderWelcomeNotice();
}
// 首次使用：还没有任何模型配置时，在输入框下给一行引导，而不是等到发送时才弹提示
function renderWelcomeNotice() {
  const el = $("#welcomeNotice");
  if (!el) return;
  const none = !profiles().length;
  el.classList.toggle("hidden", !none);
  if (!none) return;
  el.innerHTML = `<span class="seal" aria-hidden="true">${t(`始`)}</span><span>${t(`尚未接入模型。OpenAI 兼容与 Anthropic 接口皆可，配置只存于本机、不经云端。`)}</span><button type="button" data-open-models>${t(`前往设置 →`)}</button>`;
  el.querySelector("[data-open-models]").onclick = () => openSettings("models");
}
let bindSuggestions = () => {},
  suggestionsMode = "";
function renderSuggestions(work) {
  const mode = work ? "work" : "chat";
  if (mode === suggestionsMode) return;
  suggestionsMode = mode;
  $("#welcome .suggestions").innerHTML = SUGGESTIONS[mode]
    .map(([label, prompt]) => `<button class="suggestion" data-prompt="${escapeHtml(prompt)}">${escapeHtml(label)}</button>`)
    .join("");
  bindSuggestions();
}
// 都是自拟：文白相杂，不借前人成句（成句一眼认得出，反倒像题词）；不必对仗，各按时辰。
// 只写景、留白，不劝人做什么：宜／可以／正好／且这类劝字一用就泄了气
const GREETINGS_ZH = {
  night: [
    "夜深墨浓",
    "长夜无声，一纸独明",
    "更漏迟迟，落字从容",
    "万家灯熄，此处尚明",
    "夜气清，一灯独醒",
    "星沉案角，砚水未寒",
    "夜阑不寐，与纸相对"
  ],
  morning: [
    "晨光入砚",
    "新墨初研",
    "晨露未晞，素纸已展",
    "鸟声隔窗，宿墨未干",
    "茶尚温，题未定",
    "清气满案，诸念未起",
    "朝暾初上，纸色微明"
  ],
  day: [
    "落笔，便有回声",
    "案上清宁，纸有余白",
    "晴光满窗，字字分明",
    "半窗日色，一案清言",
    "日在中天，笔影最短",
    "闲翻旧时书",
    "帘外风轻，砚边日暖",
    "白瓷盏中竹影摇"
  ],
  evening: [
    "灯下长谈，不觉夜深",
    "一灯如豆，纸墨相亲",
    "暮色入窗，墨色渐深",
    "炉上水初沸",
    "月上东墙，砚中有影",
    "晚风叩窗，似有人来",
    "竹幽听雨落"
  ]
};
// 当令的句子（设计稿/84）：每个节气两句，掺进上面按时辰挑的池里，所以不写灯、晨、夜这些时辰；写景在前、落到笔墨在后
const TERM_GREETINGS_ZH = {
  小寒: ["冰在檐下，墨在砚中", "小寒天气，呵笔成字"],
  大寒: ["大寒封河，案上犹暖", "炭火微红，墨香不散"],
  立春: ["东风解冻，砚水先融", "柳眼初开，纸上生春"],
  雨水: ["檐溜如丝，案头微润", "雨落无声，墨色转柔"],
  惊蛰: ["春雷乍动，万物初醒", "雷动土中，笔亦思动"],
  春分: ["昼夜平分，墨分浓淡", "燕子来时，窗前半暖"],
  清明: ["杏花疏雨，案头清明", "新茶初焙，墨亦清香"],
  谷雨: ["牡丹将放，砚边添香", "雨生百谷，字生百意"],
  立夏: ["绿荫初满，日影渐长", "立夏风来，帘幕轻摇"],
  小满: ["麦穗初黄，砚池将满", "小满不满，字有余地"],
  芒种: ["栀子初开，香入墨池", "雨意连日，纸上有潮"],
  夏至: ["蝉声满树，纸上生凉", "昼最长时，落笔从容"],
  小暑: ["竹簟清凉，砚水微温", "荷风过院，墨气清新"],
  大暑: ["暑气蒸人，扇底生风", "冰盘在案，字字清凉"],
  立秋: ["梧桐叶落，秋意入窗", "暑退三分，墨色添深"],
  处暑: ["暑气渐收，笔意转清", "蝉声稀了，纸上安静"],
  白露: ["草头凝露，案前生凉", "秋虫唧唧，墨色清寒"],
  秋分: ["桂子飘香，砚中亦香", "秋色平分，纸墨各半"],
  寒露: ["寒露初凝，砚池微凉", "雁过檐头，墨色渐深"],
  霜降: ["霜降枫丹，纸上添色", "草木摇落，笔意渐瘦"],
  立冬: ["冬意初临，炉火将红", "落叶满阶，案头清旷"],
  小雪: ["小雪微茫，纸色更白", "天欲雪，砚欲冰"],
  大雪: ["雪满前庭，墨暖如春", "窗外琼瑶，案上素笺"],
  冬至: ["日短至极，墨意回长", "冬至数九，砚边围炉"]
};
const WORK_GREETINGS_ZH = [
  "言毕，即行",
  "墨未干，事已行",
  "纸上落言，案前成事",
  "意既明，手便随",
  "墨染太极",
  "一事一毕，不留残笔",
  "议定即行，不尚空谈"
];
// 英文界面不逐句对译（写景的句子译过去就没了味道），另写一套朴素的问候
const GREETINGS_EN = {
  night: ["Working late?", "Still up?", "The night is quiet", "Late-night thoughts?"],
  morning: ["Good morning", "Morning. What's first?", "A fresh start"],
  day: ["Good afternoon", "What's on your mind?", "How can I help?", "Let's get to it"],
  evening: ["Good evening", "Winding down?", "What's on your mind tonight?"]
};
const WORK_GREETINGS_EN = ["Ready when you are", "What are we building?", "Point me at the task", "Let's get it done"];
const GREETINGS = LANG === "en" ? GREETINGS_EN : GREETINGS_ZH,
  WORK_GREETINGS = LANG === "en" ? WORK_GREETINGS_EN : WORK_GREETINGS_ZH;
const greetingPick = Math.random();
function greeting() {
  if (workMode()) return WORK_GREETINGS[Math.floor(greetingPick * WORK_GREETINGS.length)];
  const h = new Date().getHours(),
    pool = [
      ...GREETINGS[h < 6 || h >= 22 ? "night" : h < 11 ? "morning" : h < 18 ? "day" : "evening"],
      ...(LANG === "en" ? [] : TERM_GREETINGS_ZH[solarTerm()] || [])
    ];
  return pool[Math.floor(greetingPick * pool.length)];
}
// 推荐语是替人起个头，要比人自己随手打的多一层：说清要什么结果、在意什么（讲到什么程度、给谁看、要据此拿主意、会动哪些地方）。
// 做法不定死：画图、分头查、问人这类能力写成条件句（「……可以」），用不用由模型按事情定。
// 落选的：逐条写明领用哪项本事（8e13d60，点了就成硬要求，概念题一上来就要可视化，把短事拖长）；只留一句目标（27f66a7，简单到比自己打字多不了什么）。
// 按钮名用书面的四字词；话写成人自己会说的，不点工具名。点开即选中头一处全角括号（留给人填），别处的引号用「」
const SUGGESTIONS = {
  chat: [
    [
      t("概念讲解"),
      t(
        "帮我讲明白（一个概念，比如复利、傅里叶变换、TCP 三次握手）。从它要解决什么问题讲起，举个具体的例子；画图能讲得更清楚的地方可以画。"
      )
    ],
    [
      t("定时监测"),
      t("帮我盯着（一件会变的事，比如某个商品的价格、某个开源项目的新版本、某个网页上的公告），每隔（一小时）看一眼。有动静戳我。")
    ],
    [
      t("材料分析"),
      t(
        "（附上表格、PDF 或一批文档）帮我看看这些材料：讲了什么，关键数字是多少，有没有前后对不上或可疑的地方。数字要比较的话可以列表或画图。"
      )
    ],
    [
      t("文件生成"),
      t(
        "帮我做一份（要做的东西，比如季度汇报 PPT、Excel 预算表、一页 PDF 简历），给（谁看、用在什么场合）。缺关键内容可以问我，小事你定就好。"
      )
    ]
  ],
  work: [
    [
      t("项目梳理"),
      t(
        "我想把这个项目（往哪里推进，比如加上登录、换一套存储、把某个功能做完整）。先摸清现状，告诉我打算怎么做、会动哪些地方、有什么风险；目标不清楚可以问我。等我看过再动手。"
      )
    ],
    [
      t("深度调研"),
      t(
        "帮我把（一个问题，比如某个领域的主流做法、几种技术方案该选哪个）研究透，我要据此拿主意。先给结论和理由，再列依据和出处，说法打架或证据不足的地方标出来。范围大可以分头查，内容多可以写成文件放在这个目录。"
      )
    ],
    [
      t("网页操作"),
      t("用浏览器帮我（要在网页上办的事，比如在几家网站比价后整理成表、把这份清单逐条填进某个后台）。碰到要我判断的地方向我确认。")
    ],
    [
      t("原型演示"),
      t(
        "在这个目录里做一个（一个小作品，比如番茄钟、记账本、贪吃蛇），一个网页就行，打开就能用。做好自己在浏览器里点一遍，确认能用再告诉我怎么打开。"
      )
    ]
  ]
};
