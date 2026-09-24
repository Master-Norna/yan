// 言 · 计算：run_js 在浏览器里的隔离沙箱跑一段 JS，不经桥接，直连也有。
// 沙箱是一个 sandbox iframe（origin null、CSP 不许联网）里的 Worker，由 preview-runtime.js 承担；每次现起一个 iframe、算完就撤，超时由那头把 Worker 杀掉
defineTool({
  name: "run_js",
  label: "计算",
  lookup: true,
  parallel: true,
  cache: true,
  async run(step, args, { signal }) {
    const code = args.code.trim();
    step.code = code;
    step.title =
      code
        .split("\n")
        .find(line => line.trim())
        ?.trim()
        .slice(0, 80) || "";
    if (!code) return { ok: false, content: "code 为空", display: "代码为空" };
    const timeout = clampNumber(Number(args.timeout) * 1000, 10000, 1000, 60000);
    const result = await computeInSandbox(code, timeout, signal);
    const parts = [];
    if (result.logs) parts.push(result.logs);
    if (result.value !== undefined) parts.push(`→ ${result.value}`);
    if (result.error) parts.push(`✗ ${result.error}`);
    step.output = trimOutput(parts.join("\n"));
    const ms = Number(result.ms) || 0;
    return {
      ok: !!result.ok,
      content: result.ok
        ? `${result.logs ? `输出：\n${result.logs}\n` : ""}返回值：${result.value === undefined ? "（无；用 return 交回结果）" : result.value}`.slice(
            0,
            60000
          )
        : `运行出错：${result.error || "未知错误"}${result.logs ? `\n出错前的输出：\n${result.logs}` : ""}`,
      display: result.ok ? (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`) : "出错"
    };
  }
});
function computeInSandbox(code, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const id = `compute-${uid()}`,
      iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.className = "compute-frame";
    iframe.setAttribute("aria-hidden", "true");
    iframe.src = `./preview.html#${id}`;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
      iframe.remove();
      fn(value);
    };
    const onMessage = event => {
      if (event.source !== iframe.contentWindow || event.data?.id !== id) return;
      if (event.data.type === "yan-preview-ready")
        iframe.contentWindow.postMessage({ type: "yan-compute", id, code, timeout: timeoutMs }, "*");
      else if (event.data.type === "yan-compute-result") finish(resolve, event.data);
    };
    const onAbort = () => finish(reject, Object.assign(Error("已停止"), { name: "AbortError" }));
    // 那头没回话（页没起来、Worker 起不来）：多等 5 秒就算了
    const guard = setTimeout(() => finish(resolve, { ok: false, error: "沙箱没有回话" }), timeoutMs + 5000);
    window.addEventListener("message", onMessage);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    document.body.append(iframe);
  });
}
