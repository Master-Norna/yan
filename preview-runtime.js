(() => {
  "use strict";
  let scriptUrls = [];
  const previewId = location.hash.slice(1);
  const notify = (state, detail = "") =>
    parent.postMessage({ type: "yan-preview-state", id: previewId, state, detail: String(detail).slice(0, 240) }, "*");
  function clearScriptUrls() {
    for (const url of scriptUrls) URL.revokeObjectURL(url);
    scriptUrls = [];
  }
  function showError(error) {
    let box = document.querySelector("#yan-preview-error");
    if (!box) {
      box = document.createElement("div");
      box.id = "yan-preview-error";
      Object.assign(box.style, {
        position: "fixed",
        left: "10px",
        right: "10px",
        bottom: "10px",
        zIndex: "2147483647",
        padding: "9px 11px",
        border: "1px solid #b75b4a",
        borderRadius: "8px",
        background: "#fff7f3",
        color: "#8d3f33",
        font: "12px/1.5 system-ui,sans-serif",
        whiteSpace: "pre-wrap"
      });
      document.body.append(box);
    }
    box.textContent = `运行错误：${String(error?.message || error).slice(0, 220)}`;
    notify("error", error?.message || error);
  }
  window.addEventListener("error", event => showError(event.error || event.message));
  window.addEventListener("unhandledrejection", event => showError(event.reason || "Promise rejected"));
  async function run(source) {
    clearScriptUrls();
    const parsed = new DOMParser().parseFromString(String(source || ""), "text/html");
    const scripts = [...parsed.querySelectorAll("script")]
      .map(node => ({ code: node.textContent || "", type: (node.type || "text/javascript").toLowerCase(), external: !!node.src }))
      .filter(item => ["text/javascript", "application/javascript", "module"].includes(item.type));
    if (scripts.some(item => item.external)) throw Error("交互内容含外部脚本；请把 JavaScript 直接写在 HTML 内");
    parsed.querySelectorAll("script,base,meta[http-equiv],iframe,object,embed").forEach(node => node.remove());
    document.head.querySelectorAll("[data-preview-style]").forEach(node => node.remove());
    for (const style of parsed.head.querySelectorAll("style")) {
      const node = document.createElement("style");
      node.dataset.previewStyle = "";
      node.textContent = style.textContent;
      document.head.append(node);
    }
    document.title = parsed.title || "言 · 交互预览";
    for (const name of ["class", "style", "dir"]) document.documentElement.removeAttribute(name);
    for (const name of ["class", "style", "dir"])
      if (parsed.documentElement.hasAttribute(name)) document.documentElement.setAttribute(name, parsed.documentElement.getAttribute(name));
    document.documentElement.lang = parsed.documentElement.lang || "zh-CN";
    for (const { name } of [...document.body.attributes]) document.body.removeAttribute(name);
    for (const { name, value } of [...parsed.body.attributes]) if (!/^on/i.test(name)) document.body.setAttribute(name, value);
    document.body.innerHTML = parsed.body.innerHTML || source;
    for (const item of scripts) {
      if (!item.code.trim()) continue;
      const url = URL.createObjectURL(new Blob([item.code], { type: "text/javascript" }));
      scriptUrls.push(url);
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        if (item.type === "module") script.type = "module";
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(Error("脚本无法执行"));
        document.body.append(script);
      });
    }
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    window.dispatchEvent(new Event("load"));
    notify("ready");
  }
  window.addEventListener("message", event => {
    if (event.source !== parent || event.data?.type !== "yan-preview-render" || event.data.id !== previewId) return;
    run(event.data.html).catch(showError);
  });
  parent.postMessage({ type: "yan-preview-ready", id: previewId }, "*");
})();
