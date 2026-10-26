// 言 · 类型声明：只给 tsc --checkJs 与编辑器用，运行时不加载（build.js 只拼 .js）。
// 源码仍是无模块的普通脚本，20 段拼进一个闭包；tsc 把无 import/export 的文件当作共享同一全局作用域的脚本，
// 所以这里的声明是全局的，各段之间的函数引用也能跨文件解析。数据模型的 JSDoc typedef 在 00-state.js 顶部。

// ---- 随项目本地分发的库与提示词：挂在 window 上，按 any 看待 ----
declare var YAN_ANTHROPIC: any;
declare var YAN_EN: Record<string, string> | undefined;
declare const marked: any;
declare const DOMPurify: any;
declare const hljs: any;
declare const katex: any;
interface Window {
  marked: any;
  DOMPurify: any;
  hljs: any;
  katex: any;
  pdfjsLib: any;
  YAN_PROMPTS: any;
  __yanState: () => any; // 端到端测试读内存里的记录
  __yanSave: () => void;
  __yanBridgeFetch: (path: string, body: string, signal?: AbortSignal | null) => Promise<Response>; // 端到端测试压总线
  __yanStage: {
    state: any;
    locate: () => Promise<void>;
    go: (raw: string) => void;
    sendFiles: (files: File[], node?: number) => Promise<void>;
    markPinned: () => void;
  }; // 端到端测试读看台的状态、立即去连、在当前页打开、递文件、当作执事亲手定了视口
  __yanSplit: {
    open: (id: string) => void;
    add: (id: string) => boolean;
    close: (slot?: number, id?: string) => void;
    focus: (slot: number) => void;
    state: () => any;
    setWidth: (slot: number, px: number) => void;
  }; // 端到端测试读栏的状态、增删与调宽
  __yanPane: {
    busy: () => boolean;
    id: () => string;
    slot: number;
    refresh: () => void;
    bus: () => boolean;
  }; // 栏页报给主页面：这一栏是谁、在忙什么
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
  // 差遣面板里一趟行迹的开合（20-helper.js 的 foldSubTrail）：要去的那一头、等着收的计时、正走着的动画
  _foldTo?: boolean;
  _foldTimer?: any;
  _foldAnim?: Animation | null;
  _follow?: boolean;
  // 画法（07-paint.js）记在节点上的：部件的键与签名、画过没有、行迹上回的状态、正文已缓存的段落与上回画的原文
  _part?: string;
  _sig?: string;
  _painted?: boolean;
  _status?: string;
  _mdStable?: string;
  _mdText?: string;
  _mdFinal?: boolean;
  _paintedThought?: string;
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
