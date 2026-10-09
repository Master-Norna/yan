// 言 · 桥接客户端：接上本机桥接、总线、调桥接的口子
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
// 言离不开本机桥接（模型转发、存储、工具都在它那头）：页面与桥接说话只经这一段——接上（connectBridge）、
// 长请求走总线（bridgeFetch，交回与 fetch 一样的 Response）、短请求要 JSON（bridge）、读桥接回的报错（describeResponseError）
const LOCAL_BRIDGE = "http://127.0.0.1:8787";
// 桥接的引导信息（版本、存储根、目录、平台、shell）；notice 是页面自己写的桥接状态提示，在设置 → 模型顶部显示
let bootstrap = { notice: "" };
/** @type {string|null} 桥接的地址：桥接自己开的页面是 ""（同源），别处打开的（VS Code Webview）是 LOCAL_BRIDGE */
let apiBase = null;
// 页面是不是桥接自己开的（http://127.0.0.1:端口）：是的话桥接一定在，探测失败多半只是首次加载时被大文件挤慢了，该多等、多试
function servedByBridge() {
  return /^https?:$/.test(location.protocol) && /^(127\.0\.0\.1|localhost)$/i.test(location.hostname);
}
async function connectBridge(candidates, timeout = 1400) {
  // 从文件直接打开的页面不接桥接：它的浏览器存储与桥接页面分开，常是很久以前的旧记录，接上就可能把它当正本写回 配置.json
  //（VS Code 内置浏览器里曾这样整份冲掉过配置）。桥接那头也不认来源为 null 的请求，这里再守一道，不依赖浏览器发什么头
  if (location.protocol === "file:") return false;
  for (const candidate of candidates) {
    // 同源探测：首次打开时浏览器还在拉 vendor 里的几个大文件，引导请求排在后面，1.4 秒不够，给足时间
    const wait = candidate === "" && servedByBridge() ? Math.max(timeout, 8000) : timeout;
    try {
      const response = await fetch(`${candidate}/api/bootstrap`, { signal: AbortSignal.timeout(wait) });
      if (!response.ok || !(response.headers.get("content-type") || "").includes("application/json")) continue;
      const next = await response.json();
      bootstrap = next;
      apiBase = candidate;
      if (next.stale) toast("本机桥接已更新，请关闭桥接窗口后重新运行 start.cmd", 8000);
      return true;
    } catch {}
  }
  return false;
}
// 言离不开本机桥接（模型转发、存储、工具都在它那头）：接上了才开张。接不上就只挂一句「请先运行 start.cmd」，每隔几秒再探
async function awaitBridge() {
  const candidates = servedByBridge() ? ["", LOCAL_BRIDGE] : [LOCAL_BRIDGE];
  while (!(await connectBridge(candidates))) {
    document.documentElement.dataset.bridge = "waiting";
    $("#bridgeGateUrl").textContent = LOCAL_BRIDGE;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  delete document.documentElement.dataset.bridge;
}
// 总线：长请求（模型流、工具、指令）不再各占一条浏览器连接，响应都从这一页的一条事件流回来（桥接那头见 server/bus.js）。
// 浏览器对同一个 host:port 只开 6 条连接，几段对话连同帮手一起跑，长请求一多，存配置、建目录这类短请求就排队排到超时。
// bridgeFetch 与 fetch 一样交回 Response：接的人照旧读 ok、status、headers、body，不知道底下走的是总线。
// 总线没接通（连不上事件流的环境、桥接刚重启）就直接 fetch，功能一样，只是回到一请求一连接
/** @type {EventSource|null} */
let busSource = null,
  busBase = "",
  busOpen = false,
  busTried = false;
const busJobs = new Map(),
  busWaiters = [];
function busConnect() {
  if (busSource && busBase === apiBase) return;
  busSource?.close();
  busSource = null;
  busOpen = busTried = false;
  busBase = apiBase;
  if (typeof EventSource !== "function") return;
  busSource = new EventSource(`${apiBase}/api/bus?page=${encodeURIComponent(PAGE_ID)}`);
  const settle = open => {
    busOpen = open;
    busTried = true;
    for (const resolve of busWaiters.splice(0)) resolve(open);
  };
  let dropped = false;
  busSource.onopen = () => {
    settle(true);
    // 断过又接上：断着的那会儿存的只进了浏览器，与目录再对一次（见 resyncWithDisk）
    if (dropped) resyncWithDisk();
    dropped = false;
  };
  // 流断了（桥接重启、关了）：在途的一律按连不上结束，与直接 fetch 时掐线一样；EventSource 自己会重连
  busSource.onerror = () => {
    dropped = true;
    for (const job of [...busJobs.values()]) job.fail(new TypeError("Failed to fetch"));
    settle(false);
  };
  busSource.onmessage = event => {
    const message = JSON.parse(event.data);
    busJobs.get(message.id)?.[message.t](message);
  };
}
function busReady() {
  busConnect();
  // 头一回连给一点时间；连过而没连上的不再等，直接走 fetch
  if (busOpen || !busSource || busTried) return Promise.resolve(busOpen);
  return new Promise(resolve => {
    busWaiters.push(resolve);
    setTimeout(() => resolve(busOpen), 3000);
  });
}
/** @returns {Promise<Response>} */
async function bridgeFetch(path, body, signal) {
  const direct = () => fetch(`${apiBase}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal });
  if (!(await busReady())) return direct();
  signal?.throwIfAborted();
  // 回话一定读完：不读，浏览器就一直攥着这次请求连同发出去的整段 body（GC 也收不掉）。
  // 长活每三秒存一次整段对话，十几 MB 一份，几小时就把页面撑爆
  const id = uid(),
    post = (to, payload) =>
      fetch(`${apiBase}${to}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(
        async response => ({ ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) })
      );
  return new Promise((resolve, reject) => {
    const encoder = new TextEncoder();
    /** @type {ReadableStreamDefaultController<Uint8Array>} */
    let stream;
    // 停了（signal 中止，或读的人不读了）：告诉桥接那头作废，接口从 close 事件知道
    const stop = () => {
      if (!busJobs.has(id)) return false;
      busJobs.delete(id);
      signal?.removeEventListener("abort", abort);
      void post("/api/bus/cancel", { page: PAGE_ID, id }).catch(() => {});
      return true;
    };
    const stream_ = new ReadableStream({ start: controller => void (stream = controller), cancel: () => void stop() });
    const finish = () => {
      busJobs.delete(id);
      signal?.removeEventListener("abort", abort);
    };
    const job = {
      head: ({ status, headers }) => resolve(new Response([101, 204, 205, 304].includes(status) ? null : stream_, { status, headers })),
      data: ({ text }) => stream.enqueue(encoder.encode(text)),
      end: () => {
        finish();
        stream.close();
      },
      // 桥接那头没写完就断了：与直接 fetch 时连接被掐一样，报网络错误
      drop: () => job.fail(new TypeError("network error")),
      fail: error => {
        finish();
        reject(error);
        try {
          stream.error(error);
        } catch {}
      }
    };
    // 与 fetch 被中止时一样，以 signal 的缘由结束（超时是 TimeoutError，停止是 AbortError）
    const abort = () => stop() && job.fail(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    busJobs.set(id, job);
    post("/api/bus/send", { page: PAGE_ID, id, path, body }).then(
      ({ ok, status, data }) => {
        if (ok || !busJobs.has(id)) return;
        finish();
        // 桥接那头这一页的流恰好断了：这一次改为直接 fetch
        if (status === 409) return direct().then(resolve, reject);
        reject(Error(data.error || `请求失败（${status}）`));
      },
      error => job.fail(error)
    );
  });
}
// 给端到端测试直接压总线（见 test/bridge-bus.mjs）
window.__yanBridgeFetch = bridgeFetch;
function bridgeTimedOut(error) {
  return error?.name === "TimeoutError" || /signal timed out/i.test(String(error?.message || error));
}
// 调本机桥接：存储、卷宗、工具都走这一个口子；桥接回的错误是一句话，原样抛出（状态码与回来的内容挂在 status / data 上）
async function bridge(path, payload, signal) {
  const response = await bridgeFetch(path, JSON.stringify(payload), signal);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(data.error || `请求失败（${response.status}）`), { status: response.status, data });
  return data;
}

// 桥接没接下请求时回的那句话：桥接一律回 { error }（各家上游的报错样子在桥接那头归一，见 server/model/index.js 的 upstreamError）；
// 不是 JSON 的（桥接之外的什么挡在了中间）取原文开头
async function describeResponseError(response) {
  const raw = await response.text().catch(() => "");
  let error;
  try {
    error = JSON.parse(raw)?.error;
  } catch {
    return raw.trim().slice(0, 300) || `请求失败（${response.status}）`;
  }
  return (typeof error === "string" && error) || `请求失败（${response.status}）`;
}
