// 言 · 类型声明：只给 tsc --checkJs 与编辑器用，运行时不加载（build.js 只拼 .js）。
// 源码仍是无模块的普通脚本，20 段拼进一个闭包；tsc 把无 import/export 的文件当作共享同一全局作用域的脚本，
// 所以这里的声明是全局的，各段之间的函数引用也能跨文件解析。数据模型的 JSDoc typedef 在 00-state.js 顶部。

// ---- 随项目本地分发的库与提示词：挂在 window 上，按 any 看待 ----
declare var YAN_ANTHROPIC: any;
declare const marked: any;
declare const DOMPurify: any;
declare const hljs: any;
declare const katex: any;
declare const mermaid: any;
declare const echarts: any;
interface Window {
  marked: any;
  DOMPurify: any;
  hljs: any;
  katex: any;
  mermaid: any;
  echarts: any;
  pdfjsLib: any;
  YAN_PROMPTS: any;
  __yanState: () => any; // 端到端测试读内存里的记录
  __yanSave: () => void;
}

// ---- 宽松的 DOM：代码里 querySelector / closest / e.target 拿到的节点直接当表单控件、details、文本节点用，
// 不在每处写类型断言；把常用的属性并进 Element / EventTarget / Node，类型检查的重心放在数据模型而非 DOM ----
interface Element {
  dataset: DOMStringMap;
  value: string;
  disabled: boolean;
  open: boolean;
  title: string;
  onclick: ((this: GlobalEventHandlers, ev: MouseEvent) => any) | null;
  offsetWidth: number;
  offsetHeight: number;
  offsetLeft: number;
  focus(options?: FocusOptions): void;
  blur(): void;
  click(): void;
  select(): void;
  setSelectionRange(start: number, end: number): void;
  style: CSSStyleDeclaration;
  _leaveTimer?: any;
  _settleTimer?: any;
  _motionAnimation?: Animation | null;
  _motionTarget?: boolean;
  _follow?: boolean;
}
interface EventTarget {
  closest(selector: string): Element | null;
  matches(selector: string): boolean;
  classList: DOMTokenList;
  dataset: DOMStringMap;
  value: string;
  open: boolean;
}
interface Node {
  data: string;
  closest(selector: string): Element | null;
  splitText(offset: number): Text;
  after(...nodes: (Node | string)[]): void;
  replaceWith(...nodes: (Node | string)[]): void;
  remove(): void;
}
interface Event {
  key: string;
}
