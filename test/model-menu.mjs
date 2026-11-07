// 模型菜单（设计稿/148）：主栏只列模型；预设、思考深度各一栏，指上浮出竖列，斜着移过去不丢，移开即收；窄屏就地摊开
import { connect, check, sleep, PAGE } from "./lib.mjs";
const { send, evalJs, waitFor, close } = await connect();
const profile = (id, name) => ({
  id,
  source: "custom",
  name,
  model: "fake",
  baseUrl: "http://127.0.0.1:8798/v1",
  apiKey: "k",
  temperature: 0.7,
  maxTokens: 8192,
  quota: "100k",
  usedTokens: 0,
  systemPrompt: "",
  reasoningLevels: ["low", "medium", "high"]
});
await send("Page.navigate", { url: PAGE + "preview.html" });
await sleep(600);
await evalJs(
  `localStorage.setItem("yan-chat-v1", JSON.stringify({ version: 4, settings: { name: "测", theme: "light", inkMotion: "off", mode: "chat", activeProfileId: "p1", autoTitle: false, presets: [{ id: "s1", name: "自动化", prompt: "照章办事" }] }, profiles: ${JSON.stringify([profile("p1", "甲模型"), profile("p2", "乙模型")])}, conversations: [], library: [], drafts: {} })); true`
);
await send("Page.navigate", { url: PAGE });
await sleep(1200);
const center = selector =>
  evalJs(
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`
  );
const moveTo = async selector => {
  const { x, y } = await center(selector);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
};
const FLY = name => `#modelMenu [data-fly="${name}"]`,
  subOf = name => `document.querySelector(${JSON.stringify(FLY(name))}).nextElementSibling`,
  shown = name => `!${subOf(name)}.classList.contains("hidden")`;
try {
  await evalJs(`document.querySelector("#welcome .model-trigger").click(); true`);
  await waitFor(`!document.querySelector("#modelMenu").classList.contains("hidden")`);
  const main = () =>
    evalJs(
      `[...document.querySelectorAll("#modelMenu > * > button, #modelMenu > button")].filter(b => b.offsetParent).map(b => b.querySelector(".model-option-name")?.textContent || b.firstElementChild?.textContent || b.textContent).join(",")`
    );
  check(
    "the main column lists models, then one row each for presets and depth",
    (await main()) === "甲模型,乙模型,预设,思考深度,模型设置",
    await main()
  );
  check("nothing is open at first", !(await evalJs(shown("preset"))) && !(await evalJs(shown("reasoning"))));
  check(
    "the depth row says 默认 at default",
    (await evalJs(`document.querySelector(${JSON.stringify(`${FLY("reasoning")} .model-fly-value`)}).textContent`)) === "默认"
  );

  await moveTo(FLY("reasoning"));
  await waitFor(shown("reasoning"));
  check("hovering a row opens its column", true);
  const column = await evalJs(
    `(() => { const items = [...${subOf("reasoning")}.querySelectorAll("button")].map(b => b.getBoundingClientRect()); return { vertical: items.every((r, i) => !i || r.top >= items[i - 1].bottom - 1), same: items.every(r => r.left === items[0].left), count: items.length }; })()`
  );
  check("depth levels stand in one vertical column", column.vertical && column.same && column.count === 3, JSON.stringify(column));
  const inView = await evalJs(
    `(() => { const r = ${subOf("reasoning")}.getBoundingClientRect(), m = document.querySelector("#modelMenu").getBoundingClientRect(); return r.left >= m.right && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`
  );
  check("the column sits beside the menu, inside the window", inView);
  check(
    "default takes no row of its own: no empty row, and no level lit",
    await evalJs(
      `!document.querySelector('#modelMenu [data-reasoning=""]') && !${subOf("reasoning")}.querySelector(".active") && [...${subOf("reasoning")}.querySelectorAll("button")].every(b => b.textContent.trim())`
    )
  );

  // 从「思考深度」到「预设」：切栏有宽限，开着的先留一下
  await moveTo(FLY("preset"));
  check("switching rows waits a moment", await evalJs(shown("reasoning")));
  await waitFor(`${shown("preset")} && !(${shown("reasoning")})`);
  check("then the other row's column takes over", true);
  // 路过别的栏就到了浮列上：不换
  await moveTo(FLY("reasoning"));
  await moveTo(`#modelMenu [data-preset="s1"]`).catch(() => {});
  await sleep(250);
  check("moving across a row onto the open column keeps it", (await evalJs(shown("preset"))) && !(await evalJs(shown("reasoning"))));

  await moveTo(FLY("reasoning"));
  await waitFor(shown("reasoning"));
  await moveTo(`#modelMenu [data-reasoning="high"]`);
  const { x, y } = await center(`#modelMenu [data-reasoning="high"]`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await waitFor(`document.querySelector(${JSON.stringify(`${FLY("reasoning")} .model-fly-value`)}).textContent === "高"`);
  check("picking a level writes it on the row and keeps the column open", await evalJs(shown("reasoning")));
  check(
    "the picked level is marked, with a hint for going back",
    await evalJs(
      `(() => { const b = document.querySelector('#modelMenu [data-reasoning="high"]'); return b.classList.contains("active") && b.title === "再点一下退回默认"; })()`
    )
  );
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await waitFor(`document.querySelector(${JSON.stringify(`${FLY("reasoning")} .model-fly-value`)}).textContent === "默认"`);
  check(
    "clicking the picked level again goes back to default, and the trigger drops the level",
    (await evalJs(`!${subOf("reasoning")}.querySelector(".active")`)) &&
      !(await evalJs(`document.querySelector("#welcome .model-trigger .model-extra").textContent`)).includes("思考")
  );

  await moveTo(`#modelMenu [data-profile="p2"]`);
  await waitFor(`!(${shown("reasoning")})`);
  check("moving onto a model closes the column", true);
  await moveTo(FLY("reasoning"));
  await waitFor(shown("reasoning"));
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await waitFor(`!(${shown("reasoning")})`);
  check("leaving the menu closes the column", true);
  check("the menu itself stays until clicked away", await evalJs(`!document.querySelector("#modelMenu").classList.contains("hidden")`));

  // 键盘：→ 开并落到选中的那项，← 收回
  await evalJs(
    `document.querySelector(${JSON.stringify(FLY("reasoning"))}).focus(); document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); true`
  );
  check("ArrowRight opens and focuses inside the column", await evalJs(`${subOf("reasoning")}.contains(document.activeElement)`));
  await evalJs(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); true`);
  check(
    "ArrowLeft closes and returns to the row",
    await evalJs(`!(${shown("reasoning")}) && document.activeElement === document.querySelector(${JSON.stringify(FLY("reasoning"))})`)
  );

  // 选预设：照旧换上、菜单收起
  await evalJs(`document.querySelector('#modelMenu [data-preset="s1"]').click(); true`);
  await waitFor(`document.querySelector("#modelMenu").classList.contains("hidden")`);
  check(
    "picking a preset still applies it and closes the menu",
    (await evalJs(`document.querySelector("#welcome .model-trigger .model-extra").textContent`)).includes("自动化")
  );

  // 窄屏：两边都放不下，就地摊开在栏下
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 760, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  await evalJs(`document.querySelector("#welcome .model-trigger").click(); true`);
  await waitFor(`!document.querySelector("#modelMenu").classList.contains("hidden")`);
  await evalJs(`document.querySelector(${JSON.stringify(FLY("reasoning"))}).click(); true`);
  check("on a narrow window the column unfolds in place", await evalJs(`${subOf("reasoning")}.classList.contains("inline")`));
  const fits = await evalJs(
    `(() => { const r = document.querySelector("#modelMenu").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`
  );
  check("and nothing runs off the window", fits);
} finally {
  await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  await close();
}
