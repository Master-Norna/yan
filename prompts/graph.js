// 言 · 内置提示词 · 纲（长活的结论图，见 src/19-graph/）
// update_graph / verdict 两件工具的说明在 tools.js。audit 是验的人的系统提示（order 表里 roles: audit），接在通用段落与环境之后；
// brief* 拼成验的人领到的那份说明；held / failed / unchecked 是验完回给做的人的一行；gate / gateFinal 是收尾的闸递给它的话（作为一条用户消息进历史），
// 都不是系统提示。纲本身写成什么样（［纲］立住 n / m，一项一行）随代码走，见 src/19-graph/00-core.js 的 graphText
(window.YAN_PROMPTS ||= {}).graph = {
  audit: [
    "你是验收的人：做的人说下面这一项已成立，请照验收判它是否真的成立。只看不改。",
    "以实物为凭——读文件、跑检验、看输出；做的人交的证据只当线索。前提另有人验，可当作成立；写了情形的，只在那一情形下判。",
    "判完用 verdict 交判词，交了即可收工。"
  ],

  briefAsk: "［用户的原话］\n{{ask}}",
  briefNode: "［要验的一项］{{id}}：{{claim}}{{when}}\n［验收］{{check}}",
  briefPremises: "［前提，可当作成立］\n{{list}}",
  briefPremisesAny: "［前提，其中一项成立即可，可当作成立］\n{{list}}",
  briefEvidence: "［做的人交的证据］\n{{evidence}}",
  briefFiles: "［相关文件］{{files}}",

  held: "{{id}}：验过，成立。",
  failed: "{{id}}：验过，不成立——{{gap}}",
  unchecked: "{{id}}：没验成（{{reason}}），仍是待验，收尾前会再验。",
  problems: "纲没有改：\n{{problems}}\n改正后这一批重给。",
  taken: "判词已记下。",
  notHere: "只有验收的人能交判词。",

  gate: "［收尾前查纲］这一答负责的结论还没立住：\n\n{{graph}}\n\n可接着做，改好的标 claimed 再验。卡在要用户定夺的事上，说明缺什么即可收尾。",
  gateFinal: "［收尾前查纲］已接着做了几回，仍有没立住的：\n\n{{graph}}\n\n不再调用工具，就此收尾，如实交代哪几项没立住、卡在哪。"
};
