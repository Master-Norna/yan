// 言 · 听音：放音只有一处——页里常驻的 #listenAudio；预览里的整页与右上角垂下的那一缕，都只是它的两面。
// 所以「离开整页仍在放」不是另做的功能：音频本就不归预览器管，关预览不碰它就接着响。要定的只剩一条：
// 预览上的 × 是「停」，别的关法（点空白、Esc）是「收」——收时正放着就垂下那一缕，停着便一并收掉。
// 那一缕在不在不另记：有曲在放、而预览里没摊着这一曲，就挂着（见 listenSync）。
// 放音、声纹、上下首、随声而摆都在这一件里；往后别处要放一段音（卷宗之外的来源），交一条 track 给 listenLoad 即可。
// 落选的：缩小后另起一个播放器接着放（两份音频要交接进度）；右下角浮一张纸签、顶栏一行、侧栏底一条（见 设计稿/18–23）

/** @typedef {{ key: string, name: string, url: string, where: string, source: {path?: string, attachmentId?: string}, bytes: () => Promise<ArrayBuffer>, list: any[] }} ListenTrack */
/** @type {ListenTrack | null} 喇叭里的这一曲 */
let listenTrack = null,
  /** @type {ListenTrack | null} 预览整页上摆着的那一曲（可能还没放，与 listenTrack 不同） */
  listenShown = null,
  listenOwnUrl = "",
  listenRevision = 0,
  listenSeekCancel = null,
  listenFrameId = 0,
  listenGraph = null,
  listenSwing = { amp: 0, t: 0 };
const listenPeakCache = new Map(),
  LISTEN_BARS = 150;
const listenEl = () => /** @type {HTMLAudioElement} */ ($("#listenAudio"));
const listenClock = seconds => {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ---------- 一曲：卷宗里的一件、或对话里的一件附件 ----------
function listenArchiveTrack(entry) {
  const dir = entry.path.split("/").slice(0, -1),
    file = archiveFile(entry.path);
  return {
    key: `p:${entry.path}`,
    name: entry.name,
    url: localFileUrl(file),
    where: [t("卷宗"), ...dir].join(" › ") + ` · ${fileExtension(entry.name).toUpperCase()} · ${formatFileSize(entry.size || 0)}`,
    source: { file },
    bytes: async () => (await fetch(localFileUrl(file))).arrayBuffer(),
    list: []
  };
}
// 预览器交来的：卷宗那一路连同夹里的其余音频一起列出；别处目录里的（行的工作目录里的成品）、附件、技能里的只有它自己
function listenTrackFrom(source, name, reader) {
  const rel = source?.file ? archiveRel(source.file) : null;
  if (rel !== null) {
    const entry = (archiveEntries || []).find(file => file.path === rel) || { path: rel, name, size: 0 },
      dir = rel.split("/").slice(0, -1).join("/"),
      siblings = (archiveEntries || []).filter(
        file => file.path.split("/").slice(0, -1).join("/") === dir && fileKind(file.name).group === "audio"
      ),
      list = (siblings.length ? siblings : [entry]).map(listenArchiveTrack);
    const track = listenArchiveTrack(entry);
    for (const item of list) item.list = list;
    track.list = list;
    return list.find(item => item.key === track.key) || track;
  }
  // 别处目录里的、附件，或技能带的一件（设置 → 技能里点开）
  const skill = !!source?.skillDir,
    ext = fileExtension(name).toUpperCase(),
    track = {
      key: source?.file ? `r:${source.file}` : skill ? `s:${source.skillDir}/${source.skillPath}` : `a:${source?.attachmentId}`,
      name,
      url: reader.url(),
      where: source?.file ? `${pathTail(parentDir(source.file))} · ${ext}` : skill ? t`Skill · ${ext}` : t`附件 · ${ext}`,
      source,
      bytes: async () => (await reader.blob()).arrayBuffer(),
      list: []
    };
  track.list = [track];
  return track;
}

// ---------- 声纹：本机解开音频，量出每一段的峰 ----------
async function listenPeaks(track) {
  if (listenPeakCache.has(track.key)) return listenPeakCache.get(track.key);
  let peaks;
  try {
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await track.bytes()),
      data = decoded.getChannelData(0),
      step = Math.max(1, Math.floor(data.length / LISTEN_BARS));
    peaks = Array.from({ length: LISTEN_BARS }, (_, i) => {
      let peak = 0;
      for (let j = i * step, end = Math.min(data.length, j + step); j < end; j += 8) peak = Math.max(peak, Math.abs(data[j]));
      return peak;
    });
    const top = Math.max(...peaks) || 1;
    peaks = peaks.map(v => v / top);
  } catch {
    peaks = null;
  }
  listenPeakCache.set(track.key, peaks);
  return peaks;
}
// 圆相：一曲是一笔圆，自正上方偏左起笔、顺时针走 336 度，缺口留在左上；声音的强弱就是笔的粗细。
// 每一段记下角度与笔宽：起笔处渐粗、收笔处出锋；正在放的那一点是笔尖（见 listenRingD）
const LISTEN_RING = { c: 150, r: 118, from: -78, span: 336 };
const listenRings = new Map();
function listenRing(track) {
  const peaks = listenPeakCache.get(track.key);
  if (peaks && listenRings.has(track.key)) return listenRings.get(track.key);
  const n = LISTEN_BARS,
    soft = Array.from({ length: n }, (_, i) => {
      let sum = 0,
        count = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) (sum += peaks ? peaks[j] : 0.18), count++;
      return sum / count;
    }),
    ring = soft.map((peak, i) => {
      let width = 2.4 + peak * 15;
      if (i < 8) width *= 0.55 + (0.45 * i) / 8;
      if (i > n - 10) width *= (n - 1 - i) / 9 + 0.15;
      return { angle: ((LISTEN_RING.from + (LISTEN_RING.span * i) / (n - 1)) * Math.PI) / 180, width };
    });
  if (peaks) listenRings.set(track.key, ring);
  return ring;
}
function listenRingD(ring, from, to, tip = false) {
  const { c, r } = LISTEN_RING,
    outer = [],
    inner = [];
  for (let i = from; i <= to; i++) {
    const half = (ring[i].width * (tip && i === to ? 0.3 : 1)) / 2,
      cos = Math.cos(ring[i].angle),
      sin = Math.sin(ring[i].angle);
    outer.push(`${listenN(c + (r + half) * cos)} ${listenN(c + (r + half) * sin)}`);
    inner.unshift(`${listenN(c + (r - half) * cos)} ${listenN(c + (r - half) * sin)}`);
  }
  return `M${[...outer, ...inner].join("L")}Z`;
}

// ---------- 放音 ----------
function listenInit() {
  const el = listenEl();
  if (el.dataset.bound) return;
  el.dataset.bound = "1";
  for (const type of ["play", "pause", "emptied", "loadedmetadata"]) el.addEventListener(type, listenSync);
  // 放完接下一首，末一首放完回到头一首；只有一首就停在末尾
  el.addEventListener("ended", () => {
    if ((listenTrack?.list.length || 0) > 1) listenStep(1);
  });
  // 浏览器解不了这种编码：整页换成下载提示，喇叭收掉
  el.addEventListener("error", () => {
    if (!listenTrack) return;
    const page = $("#fileViewerStage .listen-page");
    if (page && listenShown?.key === listenTrack.key)
      page.outerHTML = `<div class="file-viewer-empty">${t(`浏览器不支持此编码，可下载后以本机程序打开`)}<br><button type="button" class="outline-btn" data-viewer-download>${t(`下载`)}</button></div>`;
    else toast(t("此曲无法播放"));
    listenRelease();
  });
}
async function listenLoad(track, play = false) {
  const revision = ++listenRevision;
  listenSeekCancel?.();
  listenInit();
  const el = listenEl();
  if (listenOwnUrl) URL.revokeObjectURL(listenOwnUrl);
  listenOwnUrl = "";
  // 整页正摆着喇叭里这一曲时，换曲（上下首、放完接下一首）整页跟着换
  const follow = listenPageLive();
  listenTrack = track;
  if (follow && listenShown?.key !== track.key) listenShowPage(track);
  // 预览器关页时会收回自己造的 blob 地址，喇叭另要一份自己管
  let url = track.url;
  if (url.startsWith("blob:")) {
    const bytes = await track.bytes();
    // 读着字节的工夫已换了曲（快点上下首）或收了喇叭：这一份作废，别盖掉后来那一首
    if (revision !== listenRevision) return;
    if (listenOwnUrl) URL.revokeObjectURL(listenOwnUrl);
    url = listenOwnUrl = URL.createObjectURL(new Blob([bytes]));
  }
  el.src = url;
  if (play) await listenPlay();
  if (revision !== listenRevision) return;
  listenSync();
  listenRenderPage();
}
async function listenPlay() {
  const el = listenEl();
  // 随声而摆要量响度：头一回放时把喇叭接进一张小图（只能接一次，好在喇叭始终是这一个）
  if (!listenGraph && window.AudioContext) {
    try {
      const context = new AudioContext(),
        analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaElementSource(el).connect(analyser).connect(context.destination);
      listenGraph = { context, analyser, buffer: new Uint8Array(analyser.fftSize) };
    } catch {
      listenGraph = { context: null, analyser: null, buffer: null };
    }
  }
  if (listenGraph?.context?.state === "suspended") await listenGraph.context.resume();
  await el.play().catch(() => {});
}
function listenRelease() {
  listenRevision++;
  listenSeekCancel?.();
  const el = listenEl();
  el.pause();
  el.removeAttribute("src");
  el.load();
  if (listenOwnUrl) URL.revokeObjectURL(listenOwnUrl);
  listenOwnUrl = "";
  listenTrack = null;
  listenSync();
}
// 放 / 停：整页上摆着的若不是喇叭里那一曲，按下即换过来放
async function listenToggle(track = listenTrack) {
  if (!track) return;
  if (listenTrack?.key !== track.key) return listenLoad(track, true);
  if (listenEl().paused) await listenPlay();
  else listenEl().pause();
}
function listenStep(dir, track = listenTrack) {
  if (!track) return;
  const list = track.list || [],
    at = list.findIndex(item => item.key === track.key),
    el = listenEl();
  // 上一首：放过三秒先回到这一曲开头
  if (dir < 0 && listenTrack?.key === track.key && el.currentTime > 3) return void (el.currentTime = 0);
  // 列表首尾相接：末一首再往下回到头一首，头一首再往上到末一首
  if (list.length > 1) return void listenLoad(list[(at + dir + list.length) % list.length], true);
  if (dir < 0 && listenTrack?.key === track.key) el.currentTime = 0;
}
async function listenSeek(ratio, track = listenTrack) {
  if (!track) return;
  listenSeekCancel?.();
  const change = listenTrack?.key !== track.key,
    revision = listenRevision + (change ? 1 : 0);
  if (change) await listenLoad(track, false);
  const el = listenEl(),
    go = () => {
      if (revision !== listenRevision || listenTrack?.key !== track.key || !Number.isFinite(el.duration)) return;
      el.currentTime = Math.min(0.999, Math.max(0, ratio)) * el.duration;
      void listenPlay();
    };
  if (revision !== listenRevision || listenTrack?.key !== track.key) return;
  if (Number.isFinite(el.duration)) go();
  else {
    const ready = () => {
      cancel();
      go();
    };
    const cancel = () => {
      el.removeEventListener("loadedmetadata", ready);
      if (listenSeekCancel === cancel) listenSeekCancel = null;
    };
    listenSeekCancel = cancel;
    el.addEventListener("loadedmetadata", ready, { once: true });
  }
}

// ---------- 一面：预览里的整页（设计稿/27 一 · 乙 · 圆相）：圆里是题名、时刻与钮，旁边是出处、音量与同夹的曲 ----------
// 落选的：一行灰柱声纹 + 黑圆钮 + 滑杆音量（通用播放器的骨架，见 设计稿/18 二甲）；远山声纹、簿录一行一曲（设计稿/27 一）
const LISTEN_VOLUME_STEPS = 7;
function listenPageHtml(track) {
  listenShown = track;
  const stage = $("#fileViewerStage");
  if (!stage.dataset.listenBound) {
    stage.dataset.listenBound = "1";
    bindListenPage(stage);
  }
  // 喇叭闲着就先把这一曲装上（不放），时长即知；正放着别的就不去动它
  if (!listenTrack || listenEl().paused)
    setTimeout(() => void (listenShown === track && listenTrack?.key !== track.key && listenLoad(track)), 0);
  setTimeout(async () => {
    await listenPeaks(track);
    const rest = $("#fileViewerStage .listen-rest");
    if (rest && listenShown === track) {
      rest.setAttribute("d", listenRingD(listenRing(track), 0, LISTEN_BARS - 1));
      listenRenderPage();
    }
  }, 0);
  setTimeout(listenSync, 0);
  const list =
    track.list.length > 1
      ? `<div class="listen-list">${track.list.map(item => `<button type="button" data-listen-pick="${escapeHtml(item.key)}"${item.key === track.key ? ' class="on"' : ""}>${escapeHtml(item.name.replace(/\.[^.]+$/, ""))}</button>`).join("")}</div>`
      : "";
  const dots = Array.from(
    { length: LISTEN_VOLUME_STEPS },
    (_, i) => `<button type="button" data-listen-volume="${i + 1}" aria-label="${t`音量 ${i + 1}/${LISTEN_VOLUME_STEPS}`}"></button>`
  ).join("");
  return `<div class="listen-page">
    <div class="listen-ring"><svg viewBox="0 0 300 300" data-listen-ring aria-hidden="true"><defs><filter id="listenRough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="5"/><feDisplacementMap in="SourceGraphic" scale="2.4"/></filter></defs>
      <g filter="url(#listenRough)"><path class="listen-rest" d="${listenRingD(listenRing(track), 0, LISTEN_BARS - 1)}"/><path class="listen-past" d=""/></g></svg>
      <div class="listen-mid"><p class="listen-title">${escapeHtml(track.name.replace(/\.[^.]+$/, ""))}</p><span class="listen-clock" data-listen-clock>0:00 / —</span>
        <div class="listen-controls">
          <button type="button" class="listen-step" data-listen-do="prev" title="${t(`上一首`)}" aria-label="${t(`上一首`)}">${brushIcon("back")}</button>
          <button type="button" class="listen-play" data-listen-do="toggle" title="${t(`播放`)}">${t(`奏`)}</button>
          <button type="button" class="listen-step" data-listen-do="next" title="${t(`下一首`)}" aria-label="${t(`下一首`)}">${brushIcon("forward")}</button>
        </div></div></div>
    <div class="listen-aside"><p class="listen-where">${escapeHtml(track.where)}</p><div class="listen-volume" title="${t(`音量`)}">${t`音${dots}`}</div>${list}</div></div>`;
}
// 在预览里换摆另一曲：题名、下载都跟着这一曲
function listenShowPage(track) {
  viewerSource = track.source;
  $("#fileViewerName").textContent = track.name;
  $("#fileViewerStage").innerHTML = listenPageHtml(track);
}
// 整页上的点按：放停、上下首、点声纹跳、点列表换曲、拖音量
function bindListenPage(stage) {
  stage.addEventListener("click", e => {
    if (!listenShown || !e.target.closest(".listen-page")) return;
    const act = e.target.closest("[data-listen-do]")?.dataset.listenDo;
    if (act === "toggle") return void listenToggle(listenShown);
    if (act) return listenStep(act === "next" ? 1 : -1, listenShown);
    const pick = e.target.closest("[data-listen-pick]");
    if (pick) {
      const next = listenShown.list.find(item => item.key === pick.dataset.listenPick);
      if (next) {
        listenShowPage(next);
        void listenLoad(next, true);
      }
      return;
    }
    const volume = e.target.closest("[data-listen-volume]");
    if (volume) {
      listenEl().volume = Number(volume.dataset.listenVolume) / LISTEN_VOLUME_STEPS;
      return listenRenderPage();
    }
    // 点在笔上（圆心一带是钮，不算）：按角度跳；点进缺口，就近归到头或尾
    const ring = e.target.closest("[data-listen-ring]");
    if (ring) {
      const { c, r, from, span } = LISTEN_RING,
        point = new DOMPoint(e.clientX, e.clientY).matrixTransform(ring.getScreenCTM().inverse()),
        dx = point.x - c,
        dy = point.y - c;
      if (Math.abs(Math.hypot(dx, dy) - r) > 30) return;
      const turn = ((((Math.atan2(dy, dx) * 180) / Math.PI - from) % 360) + 360) % 360;
      void listenSeek(turn <= span ? turn / span : turn < span + (360 - span) / 2 ? 1 : 0, listenShown);
    }
  });
}
function listenRenderPage() {
  const page = $("#fileViewerStage .listen-page");
  if (!page || !listenShown) return;
  const el = listenEl(),
    live = listenTrack?.key === listenShown.key,
    ratio = live && el.duration ? el.currentTime / el.duration : 0,
    at = Math.round(ratio * (LISTEN_BARS - 1));
  page.querySelector(".listen-past").setAttribute("d", at > 0 ? listenRingD(listenRing(listenShown), 0, at, true) : "");
  page.querySelector("[data-listen-clock]").textContent =
    `${listenClock(live ? el.currentTime : 0)} / ${live ? listenClock(el.duration) : "—"}`;
  const playing = live && !el.paused,
    button = page.querySelector(".listen-play");
  button.textContent = playing ? t("止") : t("奏");
  button.title = playing ? t("暂停") : t("播放");
  const level = Math.round(el.volume * LISTEN_VOLUME_STEPS);
  page.querySelectorAll("[data-listen-volume]").forEach(dot => dot.classList.toggle("on", Number(dot.dataset.listenVolume) <= level));
}

// ---------- 另一面：右上角垂下的一缕（设计稿/30 甲）：墨线自页顶垂下，坠一个小圆相——放过的那段浓墨、笔尖一粒朱，与整页的圆相同一个意思 ----------
// 点它垂下一张纸签（方角顶朱）：题名（点回整页）、时刻、上一首 · 奏 / 止 · 下一首、×。随声而摆仍在，摆的是这一缕。
// 动作都用笔意记号（设计稿/121 乙）：上下首同整页那两笔，奏止两个都画好、随 .playing 换着显；落选的：奏止缩成小朱印（甲，印里仍是字）、连题名时刻也收起（丙）
// 落选的：顶栏上一整件玉佩（衡、冲牙、璧、穗——染玉的立体小器物，与平的顶栏、笔意小画不是一套；见 设计稿/19–23）
const listenN = n => +n.toFixed(2);
// 28 × 64 的画幅：线长 cord，圆相半径 r
const LISTEN_HANG = { x: 14, cord: 34, r: 10 };
let listenDrawn = -1;
function listenPendantHtml() {
  const { x, cord, r } = LISTEN_HANG;
  return `<svg class="brush listen-svg" viewBox="0 0 28 64" aria-hidden="true">${brushStroke([x, 0, x + 0.4, cord / 2, x, cord], 1.1, { tail: 0.8, head: 1 })}${brushArc(x, cord + r + 1, r, -90, 270, 1.4, { tone: "ghost", tail: 1, head: 1 })}<g class="listen-played"></g><circle class="zhu listen-now" r="1.5" cx="${x}" cy="${cord + 1}"/></svg>
  <button type="button" class="listen-hit" data-listen="rope" aria-label="${t(`听音`)}"></button>
  <div class="listen-card">
    <button type="button" class="listen-name" data-listen="page" title="${t(`回整页`)}"></button>
    <small class="listen-time"></small>
    <div class="listen-acts"><button type="button" data-listen="prev" title="${t(`上一首`)}" aria-label="${t(`上一首`)}">${brushIcon("back")}</button><button type="button" class="listen-toggle" data-listen="toggle">${brushIcon("play", "listen-mk-play")}${brushIcon("pause", "listen-mk-pause")}</button><button type="button" data-listen="next" title="${t(`下一首`)}" aria-label="${t(`下一首`)}">${brushIcon("forward")}</button><button type="button" class="listen-stop" data-listen="stop" title="${t(`停止`)}" aria-label="${t(`停止`)}">✕</button></div>
  </div>`;
}
function listenPendant() {
  const box = $("#listenPendant");
  if (box.childElementCount) return box;
  box.innerHTML = listenPendantHtml();
  listenDrawn = -1;
  box.addEventListener("click", e => {
    const part = e.target.closest("[data-listen]")?.dataset.listen;
    if (!part) return;
    if (part === "rope") return box.classList.toggle("open");
    if (part === "page") return void openFileViewer(listenTrack.source, listenTrack.name);
    if (part === "stop") return listenRelease();
    if (part === "toggle") return void listenToggle();
    if (part === "prev" || part === "next") return listenStep(part === "next" ? 1 : -1);
  });
  // 点签外、按 Esc（见下面登记的一层）：纸签收回，只留那一缕
  document.addEventListener("pointerdown", e => {
    if (box.classList.contains("open") && !box.contains(e.target)) box.classList.remove("open");
  });
  return box;
}
defineLayer({
  name: "listen-card",
  rank: 92,
  open: () => !!$("#listenPendant")?.classList.contains("open"),
  close: () => $("#listenPendant").classList.remove("open")
});
function listenRenderPendant() {
  const box = $("#listenPendant");
  if (!box?.childElementCount || !listenTrack) return;
  const el = listenEl(),
    ratio = el.duration ? Math.min(0.9995, el.currentTime / el.duration) : 0,
    { x, cord, r } = LISTEN_HANG,
    cy = cord + r + 1,
    end = -90 + 360 * ratio,
    // 圆相每走一度才重画一笔
    step = Math.round(ratio * 360);
  if (step !== listenDrawn) {
    listenDrawn = step;
    box.querySelector(".listen-played").innerHTML = step > 2 ? brushArc(x, cy, r, -90, end, 2.8, { tail: 0.2, head: 0.9 }) : "";
    const now = box.querySelector(".listen-now");
    now.setAttribute("cx", String(listenN(x + r * Math.cos((end * Math.PI) / 180))));
    now.setAttribute("cy", String(listenN(cy + r * Math.sin((end * Math.PI) / 180))));
  }
  box.querySelector(".listen-time").textContent = `${listenClock(el.currentTime)} / ${listenClock(el.duration)}`;
}

// ---------- 两面何时各现：都由喇叭此刻的样子推出来 ----------
function listenPageLive() {
  return isShown("#fileViewer") && !!$("#fileViewerStage .listen-page") && listenShown?.key === listenTrack?.key;
}
function listenSync() {
  const box = $("#listenPendant"),
    el = listenEl(),
    hang = !!listenTrack && !listenPageLive();
  if (hang) {
    listenPendant();
    box.querySelector(".listen-name").textContent = listenTrack.name.replace(/\.[^.]+$/, "");
    box.querySelector('[data-listen="rope"]').title = listenTrack.name;
    listenRenderPendant();
  } else box?.classList.remove("open");
  box?.classList.toggle("hidden", !hang);
  box?.classList.toggle("playing", !!listenTrack && !el.paused);
  const toggle = box?.querySelector(".listen-toggle");
  if (toggle) toggle.title = toggle.ariaLabel = el.paused ? t("播放") : t("暂停");
  listenRenderPage();
  if (listenTrack && !el.paused && !listenFrameId) listenFrameId = requestAnimationFrame(listenFrame);
}
// 放着时每帧走一次：整页与那一缕的圆相，与随声而摆——摆幅跟着此刻的响度，停了就慢慢静下来
function listenFrame() {
  listenFrameId = 0;
  const el = listenEl();
  if ($("#fileViewerStage .listen-page")) listenRenderPage();
  const box = $("#listenPendant"),
    shown = !!box && !box.classList.contains("hidden");
  let loud = 0;
  const { analyser, buffer } = listenGraph || {};
  if (shown && analyser && !el.paused) {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const v of buffer) sum += ((v - 128) / 128) ** 2;
    loud = Math.sqrt(sum / buffer.length);
  }
  listenSwing.amp += (Math.min(1, loud * 3.2) - listenSwing.amp) * (loud > listenSwing.amp ? 0.12 : 0.03);
  listenSwing.t += 1 / 60;
  if (shown) {
    listenRenderPendant();
    const angle = inkMotionOff() ? 0 : listenSwing.amp * (box.classList.contains("open") ? 3.2 : 7) * Math.sin(listenSwing.t * 2.4);
    box.style.setProperty("--listen-sway", `${angle.toFixed(2)}deg`);
  }
  if (!el.paused || listenSwing.amp > 0.01) listenFrameId = requestAnimationFrame(listenFrame);
}
// 预览关了：× 是停；别的关法是收——正放着就挂上顶栏，停着（没放过或已停）就一并收掉。
// 整页摆的不是喇叭里那一曲（边放边翻开了另一件），关它不碰正放着的
function listenViewerClosed(stop) {
  const mine = !!listenTrack && listenShown?.key === listenTrack.key && !!$("#fileViewerStage .listen-page");
  listenShown = null;
  if (mine && (stop || listenEl().paused)) listenRelease();
  else setTimeout(listenSync, 0);
}
