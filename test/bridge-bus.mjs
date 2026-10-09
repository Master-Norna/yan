// 总线：十二条模型流同时挂着，发送前的目录检查、配置读取、租约仍须立即响应；停止与超时照 fetch 的样子结束
import { connect, check, PAGE, WORK } from "./lib.mjs";

const { send, evalJs, waitFor, close } = await connect();
const chatBody = tag =>
  JSON.stringify({
    profile: { baseUrl: "http://127.0.0.1:8798/v1", model: "fake", apiKey: "k" },
    messages: [{ role: "user", content: `HOLDSTREAM ${tag}` }]
  });
try {
  await send("Page.navigate", { url: PAGE });
  // 页面接上桥接之后才有 apiBase；页面里调桥接的地方都等这一步，用例也等
  await waitFor(
    "typeof window.__yanBridgeFetch === 'function' && __yanBridgeFetch('/api/store/config/load', '{}').then(r => r.ok, () => false)"
  );
  await evalJs(`(() => {
    const controller = new AbortController();
    window.__bus = { controller, responses: [], errors: [] };
    for (let i = 0; i < 12; i++)
      __yanBridgeFetch('/api/chat', ${JSON.stringify(chatBody("x")).replace("x", '" + i + "')}, controller.signal)
        .then(response => { window.__bus.responses[i] = response; }, error => { window.__bus.errors[i] = String(error); });
    return true;
  })()`);
  await waitFor("window.__bus.responses.filter(Boolean).length + window.__bus.errors.filter(Boolean).length === 12", 8000);
  check(
    "twelve model streams start together over the bus",
    await evalJs("window.__bus.responses.filter(Boolean).length === 12"),
    await evalJs("window.__bus.errors.join(' | ')")
  );
  const first = await evalJs(`(async () => {
    const reader = window.__bus.responses[0].body.getReader();
    window.__bus.reader = reader;
    const { value } = await reader.read();
    return { type: window.__bus.responses[0].headers.get('content-type'), text: new TextDecoder().decode(value) };
  })()`);
  check(
    "stream chunks and headers arrive through the bus",
    /event-stream/.test(first.type) && first.text.includes("已接通"),
    JSON.stringify(first)
  );
  const control = await evalJs(`(async () => {
    const started = performance.now();
    const viaBus = (path, body) => __yanBridgeFetch(path, JSON.stringify(body), AbortSignal.timeout(2500));
    const direct = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(2500) });
    const results = await Promise.all([
      viaBus('/api/work/prepare', { workdir: ${JSON.stringify(WORK)} }),
      viaBus('/api/store/config/load', {}),
      direct('/api/chats/lease', { owner: 'stress-test', ids: [] }),
      direct('/api/store/config/load', {})
    ]);
    return { statuses: results.map(r => r.status), elapsed: Math.round(performance.now() - started) };
  })()`);
  check(
    "short requests stay responsive while twelve streams are open",
    control.statuses.every(status => status === 200) && control.elapsed < 2500,
    JSON.stringify(control)
  );
  const errors = await evalJs(`(async () => {
    const pending = window.__bus.reader.read().then(() => 'no error', error => error.name);
    window.__bus.controller.abort();
    const stopped = await pending;
    const timed = await __yanBridgeFetch('/api/chat', ${JSON.stringify(chatBody("timeout"))}, AbortSignal.timeout(300))
      // 与 readSse 一样用 reader 读（Response.text() 会把流上的错误一律包成 TypeError）
      .then(async response => { const reader = response.body.getReader(); for (;;) if ((await reader.read()).done) break; })
      .then(() => 'no error', error => error.name);
    const failed = await __yanBridgeFetch('/api/chat', '{}', null).then(response => response.status);
    return { stopped, timed, failed };
  })()`);
  check("stopping ends the stream with AbortError", errors.stopped === "AbortError", JSON.stringify(errors));
  check("timeouts end with TimeoutError like fetch", errors.timed === "TimeoutError", JSON.stringify(errors));
  check("error statuses come back unchanged", errors.failed === 400, JSON.stringify(errors));
} finally {
  await evalJs("window.__bus?.controller.abort(); true").catch(() => {});
  close();
}
