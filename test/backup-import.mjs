// 导入备份：分组、预设、MCP 服务随对话一起回来——对话里记着 groupId、presetId，定义不在，组织方式与提示词就丢了；本机已有的不覆盖
import { connect, check, sleep, PAGE } from "./lib.mjs";

const { send, evalJs, waitFor, close } = await connect();
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(500);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 5, settings: { name: "测", theme: "light", inkMotion: "off", activeProfileId: "p1", autoTitle: false, presets: [{ id: "keep", name: "本机预设", prompt: "本机的话" }], mcpServers: { 本机: { command: "node", args: ["a.js"] } } }, profiles: [{ id: "p1", source: "custom", name: "假模型", model: "fake", baseUrl: "http://127.0.0.1:8798/v1", apiKey: "k", quota: "100k", usedTokens: 0 }], conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await waitFor(`!!window.__yanState && !!document.querySelector("#importInput")`);

const backup = await evalJs(`(() => {
  const s = __yanState();
  return JSON.stringify({
    version: s.version,
    settings: {
      ...s.settings,
      groups: [{ id: "g-old", name: "旧组", createdAt: "2026-01-01T00:00:00.000Z", presetId: "p-old", workdir: "" }],
      presets: [{ id: "p-old", name: "旧预设", prompt: "旧的提示词" }, { id: "keep", name: "备份里的同名", prompt: "不该盖掉" }],
      mcpServers: { 旧服务: { command: "python", args: ["srv.py"] }, 本机: { command: "bad" } }
    },
    profiles: [],
    conversations: [{ id: "c-old", title: "旧对话", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", groupId: "g-old", presetId: "p-old", messages: [{ id: "u", role: "user", content: "旧问", timestamp: "2026-01-01T00:00:00.000Z" }], forks: [], threads: [] }],
    library: [],
    drafts: {},
    memory: { enabled: true, items: [] }
  });
})()`);
// 照用户的路走：设置 → 通用 → 导入备份（选文件这一步由 DataTransfer 代劳）
await evalJs(`document.querySelector("#openSettings").click(); true`);
await sleep(300);
await evalJs(`document.querySelector('#settingsModal [data-tab="general"]').click(); true`);
await waitFor(`!!document.querySelector("#importData")`);
await evalJs(`(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(backup)}], "言-备份.json", { type: "application/json" }));
  const input = document.querySelector("#importInput");
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
  return true;
})()`);
await waitFor(`document.querySelector("#toast").textContent.includes("已写入存储目录：1 段对话、配置")`, 8000);
const disk = await evalJs(`(async () => {
  const load = (url, data) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(r => r.json());
  const [chats, config] = await Promise.all([load("/api/chats/load", { ids: ["c-old"] }), load("/api/store/config/load", {})]);
  return { chat: chats.items?.some(item => item.id === "c-old"), group: config.config?.settings?.groups?.some(group => group.id === "g-old") };
})()`);
check(
  "the import reports disk only after both the chat and its configuration are readable there",
  disk.chat && disk.group,
  JSON.stringify(disk)
);
const state = await evalJs(`(() => {
  const s = __yanState().settings, c = __yanState().conversations.find(c => c.id === "c-old");
  return {
    group: s.groups.find(g => g.id === c.groupId)?.name || "",
    preset: s.presets.find(p => p.id === c.presetId)?.prompt || "",
    kept: s.presets.find(p => p.id === "keep")?.prompt || "",
    server: s.mcpServers.旧服务?.command || "",
    local: s.mcpServers.本机?.command || ""
  };
})()`);
check("the imported conversation finds its group again", state.group === "旧组", JSON.stringify(state));
check("and its preset with the prompt", state.preset === "旧的提示词");
check("MCP services come back too", state.server === "python");
check("what is already here is not overwritten", state.kept === "本机的话" && state.local === "node");

// 导出备份不带密钥：模型的，连同专司里审查、生图另配的那两份
await evalJs(`(() => {
  const s = __yanState().settings;
  s.dutyReview.apiKey = "sk-review-secret";
  s.dutyImage.apiKey = "sk-image-secret";
  window.__exportBlobs = new Map();
  window.__download = null;
  const createUrl = URL.createObjectURL;
  URL.createObjectURL = blob => { const url = createUrl(blob); window.__exportBlobs.set(url, blob); return url; };
  HTMLAnchorElement.prototype.click = function () { if (this.download) window.__download = { name: this.download, url: this.href }; };
  document.querySelector("#exportData").click();
  return true;
})()`);
await waitFor(`!!window.__download`, 8000);
const exported = await evalJs(`window.__exportBlobs.get(window.__download.url).text()`);
check(
  "the exported backup carries no API key, duty keys included",
  !exported.includes("sk-review-secret") &&
    !exported.includes("sk-image-secret") &&
    !/"apiKey":\s*"k"/.test(exported) &&
    exported.includes('"dutyReview"')
);
// 改回原样：留着没存的改动，下一个用例开页时会从磁盘换进配置
await evalJs(`(s => { s.dutyReview.apiKey = ""; s.dutyImage.apiKey = ""; return true; })(__yanState().settings)`);
await close();
