// 言 · 设置 · 模型栏顶上的用量卡：一年一卷的年历，一日一点墨（设计稿/114 丁、116 乙）。
// 墨分五色：按这一年有用量的日子分五等（分位），清、淡、重、浓、焦，点随之深、也随之大；没用的日子一粒尘点，今天圈一道朱。
// 墨点罩一层洇墨（设计稿/120 戊）：噪声把边扰毛、外晕一圈淡墨，各点毛得不一样，像墨落在纸上渗开；尘点、朱圈不洇。
// 洇得轻了原尺寸下看不出（119 乙一、乙二都嫌不明显），晕再重浓点连成一片（乙三）；也试过金芯、画心（118 丙、丁）
// 图例兼开关：点一类只看那一类，点墨换成那一类的色，再点回到总量。指上一点浮出那天各类的数。
// 数取自桥接的用量簿（见 server/usage.js、16-api.js 的 noteUsage）；收起一行只写「用量」，今天的数指今天那一点看。
// 落选的：标题旁写今日与本月、右上清至焦的色阶、卡底「某日起记」（都嫌多余）；方格、稿纸界格（116 甲、丙）；一日一笔（115）
// 本文件是 support.js 的一段，由桥接按文件名顺序拼进同一个闭包；无需模块系统
/** @type {Record<string, Partial<Record<UsageKind, number>>>|null} 还没问过是 null */
let usageDays = null,
  usageOpen = true,
  usageYear = new Date().getFullYear(),
  /** @type {UsageKind|""} */
  usageKind = "";
/** @type {Array<[UsageKind, () => string, string]>} */
const USAGE_KINDS = [
  ["main", () => t("主答"), "var(--ink)"],
  ["helper", () => t("帮手"), "var(--gold)"],
  ["side", () => t("旁注"), "var(--ink-2)"],
  ["review", () => t("审查"), "var(--qing)"],
  ["memory", () => t("记忆"), "var(--ink-3)"],
  ["image", () => t("生图"), "var(--rouge)"]
];
const USAGE_SHADES = [0.16, 0.32, 0.52, 0.74, 0.95],
  USAGE_CELL = 12,
  // 洇墨：粗噪声把边推毛，再晕一圈淡墨叠在下面
  USAGE_BLEED = `<defs><filter id="usageBleed" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="3" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3.4" result="rough"/><feGaussianBlur in="rough" stdDeviation="1.35" result="blur"/><feComponentTransfer in="blur" result="halo"><feFuncA type="linear" slope=".6"/></feComponentTransfer><feMerge><feMergeNode in="halo"/><feMergeNode in="rough"/></feMerge></filter></defs>`;
// 墨（token）是五类之和；生图另计张数，不并进总量
const usageInk = row => (row ? ["main", "helper", "side", "review", "memory"].reduce((sum, k) => sum + (Number(row[k]) || 0), 0) : 0);
const usageValue = row => (usageKind ? Number(row?.[usageKind]) || 0 : usageInk(row));
const usageAmount = (kind, n) => (kind === "image" ? t`${n} 张` : quotaAmount(n));
const usageLocale = () => (LANG === "en" ? "en" : "zh-CN");
// 浮签放在卡外、按视口定位（fixed，见 placeFloating）：details 的内容层为了滑开设了 overflow: clip（见 90-motion-responsive.css），
// 放里头指下面几行就被截掉；设置页的遮罩带 backdrop-filter，是 fixed 的定位框，它铺满视口，坐标与视口一致
function usageCardHtml() {
  return `<details class="profile-card usage-card" id="usageCard"${usageOpen ? " open" : ""}><summary class="profile-head"><strong class="profile-name">${t(`用量`)}</strong></summary><div class="usage-body" id="usageBody">${usageBodyHtml()}</div></details><div class="usage-tip hidden" id="usageTip"></div>`;
}
function usageBodyHtml() {
  if (!usageDays) return "";
  const days = usageDays,
    thisYear = new Date().getFullYear(),
    years = [...new Set([...Object.keys(days).map(day => Number(day.slice(0, 4))), thisYear])].sort();
  if (!years.includes(usageYear)) usageYear = thisYear;
  const first = new Date(usageYear, 0, 1),
    lead = (first.getDay() + 6) % 7,
    count = Math.round((new Date(usageYear + 1, 0, 1).getTime() - first.getTime()) / 864e5),
    cols = Math.floor((count - 1 + lead) / 7) + 1,
    today = localDay(),
    rows = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(usageYear, 0, 1 + i),
      day = localDay(date);
    rows.push({ day, date, row: days[day], col: Math.floor((i + lead) / 7), wd: (i + lead) % 7 });
  }
  // 五等的界：这一年有用量的日子按大小排开，取二、四、六、八成处；另按与最多那天之比再定一回，取重的——
  // 只分位的话，日子少或都差不多时全落在「清」，最多的那天也淡得看不见
  const values = rows
      .map(r => usageValue(r.row))
      .filter(v => v > 0)
      .sort((a, b) => a - b),
    cuts = [0.2, 0.4, 0.6, 0.8].map(q => values[Math.floor(q * (values.length - 1))]),
    most = values.at(-1) || 1,
    color = usageKind ? USAGE_KINDS.find(([k]) => k === usageKind)[2] : "var(--ink)",
    S = USAGE_CELL;
  // 分三层：尘点垫底，墨点一层罩洇墨，朱圈与指的格子在上
  let dust = "",
    dots = "",
    marks = "";
  for (const { day, row, col, wd } of rows) {
    const v = usageValue(row),
      cx = col * S + S / 2,
      cy = wd * S + S / 2;
    if (v > 0) {
      const level = Math.max(cuts.filter(c => v > c).length, Math.min(4, Math.floor(Math.sqrt(v / most) * 5)));
      dots += `<circle cx="${cx}" cy="${cy}" r="${(2.6 + level * 0.66).toFixed(2)}" fill="${color}" fill-opacity="${USAGE_SHADES[level]}"/>`;
    } else dust += `<circle cx="${cx}" cy="${cy}" r=".9" class="usage-dust${day > today ? " later" : ""}"/>`;
    if (day === today) marks += `<circle cx="${cx}" cy="${cy}" r="${S / 2 + 0.2}" class="usage-today"/>`;
    // 指的是这一整格：尘点太小、指不准
    if (day <= today) marks += `<rect x="${col * S}" y="${wd * S}" width="${S}" height="${S}" data-usage-day="${day}"/>`;
  }
  const monthName = new Intl.DateTimeFormat(usageLocale(), { month: LANG === "en" ? "short" : "long" }),
    months = Array.from({ length: 12 }, (_, m) => {
      const at = rows.find(r => r.date.getMonth() === m && r.date.getDate() === 1);
      return `<span style="left:${((at.col * S) / (cols * S)) * 100}%">${escapeHtml(monthName.format(at.date))}</span>`;
    }).join(""),
    totals = Object.fromEntries(USAGE_KINDS.map(([k]) => [k, rows.reduce((sum, r) => sum + (Number(r.row?.[k]) || 0), 0)])),
    legend = USAGE_KINDS.map(
      ([k, name, c]) =>
        `<button type="button" data-usage-kind="${k}" aria-pressed="${usageKind === k}"><i style="background:${c}"></i>${name()}<b>${usageAmount(k, totals[k])}</b></button>`
    ).join("");
  return `${years.length > 1 ? `<div class="usage-years">${years.map(y => `<button type="button" data-usage-year="${y}"${y === usageYear ? ' aria-current="true"' : ""}>${y}</button>`).join("")}</div>` : `<div class="usage-years"><span aria-current="true">${usageYear}</span></div>`}<div class="usage-chart"><div class="usage-months">${months}</div><svg viewBox="0 0 ${cols * S} ${7 * S}" role="img" aria-label="${escapeHtml(t`${usageYear} 年逐日用量`)}">${USAGE_BLEED}${dust}<g filter="url(#usageBleed)">${dots}</g>${marks}</svg></div><div class="usage-legend${usageKind ? " filtered" : ""}">${legend}</div>`;
}
// 浮签：那天各类的数，没用到的淡下去；只看一类时其余也淡下
function usageTipHtml(day) {
  const row = usageDays?.[day] || {},
    [y, m, d] = day.split("-").map(Number),
    date = new Date(y, m - 1, d),
    head = new Intl.DateTimeFormat(usageLocale(), { month: "long", day: "numeric" }).format(date),
    week = new Intl.DateTimeFormat(usageLocale(), { weekday: "short" }).format(date);
  return `<strong>${escapeHtml(head)}<small>${escapeHtml(week)}</small></strong>${USAGE_KINDS.map(([k, name, c]) => {
    const n = Number(row[k]) || 0;
    return `<span class="${!n || (usageKind && usageKind !== k) ? "zero" : ""}"><em><i style="background:${c}"></i>${name()}</em>${n ? usageAmount(k, n) : "—"}</span>`;
  }).join("")}`;
}
function renderUsageBody() {
  const body = $("#usageBody");
  if (body) body.innerHTML = usageBodyHtml();
}
// 每回画模型栏都问一次：先把本页攒着没报的报上去，读回来的才是全的
async function refreshUsage() {
  await flushUsage();
  const root = bootstrap.store?.root,
    data = await bridge("/api/usage/read", {}).catch(() => null);
  if (!data || root !== bootstrap.store?.root) return;
  usageDays = data.days || {};
  renderUsageBody();
}
function bindUsageCard() {
  const card = $("#usageCard");
  if (!card) return;
  void refreshUsage();
  card.addEventListener("toggle", () => (usageOpen = card.open));
  card.addEventListener("click", e => {
    const button = /** @type {HTMLElement} */ (e.target).closest("button");
    if (!button) return;
    if (button.dataset.usageYear) usageYear = Number(button.dataset.usageYear);
    else if (button.dataset.usageKind)
      usageKind = usageKind === button.dataset.usageKind ? "" : /** @type {UsageKind} */ (button.dataset.usageKind);
    else return;
    renderUsageBody();
  });
  card.addEventListener("pointerover", e => {
    const cell = /** @type {HTMLElement} */ (e.target).closest("[data-usage-day]"),
      tip = /** @type {HTMLElement} */ ($("#usageTip"));
    if (!cell || !tip) return;
    tip.innerHTML = usageTipHtml(cell.dataset.usageDay);
    // 先现出来再量：藏着时没有宽高
    tip.classList.remove("hidden");
    // 落在那一点旁边，在设置面板里右边放不下就放左边；上沿略高过那一点，首行与它齐
    const at = cell.getBoundingClientRect();
    placeFloating(tip, new DOMRect(at.x, at.y - 12, at.width, at.height), {
      side: "beside",
      gap: 8,
      within: card.closest(".modal-panel")?.getBoundingClientRect()
    });
  });
  card.addEventListener("pointerout", e => {
    if (!(/** @type {HTMLElement} */ (e.relatedTarget)?.closest?.("[data-usage-day]"))) $("#usageTip")?.classList.add("hidden");
  });
}
