// 言 · 技能：照 Claude Code 的写法，一个目录里有 SKILL.md 即一份技能。不另设工具——技能是翻阅文档的又一路来源（见 41-document.js 的 availableDocuments）：
// 名字与何时用列在系统提示里（skills.hint），模型做到相关的事先翻 SKILL.md，同目录的附属文件以「技能名/路径」翻；执事里脚本照技能目录跑。
// 人也可点名：「＋」→「技能」挑一份，那份说明作附件置于案上、随问附上（placeSkill）。
// 只认存储根/技能一处（桥接那头扫，见 server/skills.js），放进来的都给模型、不设开合；别处的要用就拷进来——
// 有执事时系统提示里写着这个目录（skills.home），叫模型去找、拷过来即可。设置 → 技能里就地写、改、删
/** @typedef {{ name: string, description: string, dir: string, files: { path: string, size: number, modifiedAt: string }[], manual?: boolean, hidden?: boolean }} Skill */
const SKILL_FILE = "SKILL.md";
/** @type {{ home: string, skills: Skill[] }|null} */
let skillSet = null;
// 每答开工前取一回：增删了技能下一问就认，扫一处目录不过几毫秒；取不到沿用上回的
async function refreshSkills() {
  try {
    const data = await bridge("/api/skills/list", {}, AbortSignal.timeout(5000));
    skillSet = { home: data.home || "", skills: data.skills || [] };
  } catch {}
}
/** @returns {Skill[]} */
function skillList() {
  return skillSet?.skills || [];
}
// 当作文档的几件：只收文本（脚本、参考、模板）；SKILL.md 另可凭技能名找到
function skillDocuments() {
  return skillList().flatMap(skill =>
    skill.files
      .filter(file => isTextFile({ name: file.path, type: "" }))
      .map(file => ({
        name: `${skill.name}/${file.path}`,
        skill: skill.name,
        skillDir: skill.dir,
        path: file.path,
        main: file.path.toLowerCase() === SKILL_FILE.toLowerCase(),
        manual: !!skill.manual,
        size: file.size,
        modifiedAt: file.modifiedAt,
        kind: "skill"
      }))
  );
}
// 系统提示里的目录（skills.hint）：一份一行，名字与它自己写的何时用。放在系统提示而不在 read_document 的说明里——
// 模型定下怎么做时读的是系统提示，藏在一件工具的说明末尾，只有它已想翻文档时才看得见。只凭点名的（manual）不列；一份都没有就不带这段
function skillCatalog() {
  const skills = skillList().filter(skill => !skill.manual);
  return skills.length ? { list: skills.map(skill => `- ${skill.name}：${skill.description}`).join("\n") } : null;
}
// 行首一只锦囊（页头那只缩小，设计稿/104 甲）：设置里每份、摊开时名前、「＋」里的选件、点名后那件附件，一眼认出是技能。
// 只凭点名的（quiet）淡下去、系口不点朱——模型不自取、不拆；设置里点它即切换（设计稿/105），不另设开关、不写字
function skillMark(className = "skill-mark", quiet = false) {
  return brushIcon("skills", `${className}${quiet ? " quiet" : ""}`);
}
/** @param {Skill} skill */
function skillToggleHtml(skill) {
  return `<button type="button" class="skill-toggle" data-skill-manual="${escapeHtml(skill.dir)}" aria-pressed="${!!skill.manual}" title="${
    skill.manual ? t("只凭点名 · 点此交模型自取") : t("模型自取 · 点此改为只凭点名")
  }">${skillMark("skill-mark", skill.manual)}</button>`;
}
// 何时用的头一句：设置里那行、「＋」里的选件都只摆这一句，全文悬停可见
/** @param {Skill} skill */
function skillGist(skill) {
  return String(skill.description).match(/^.+?(?:[。！？]|[.!?](?=\s|$))/)?.[0] || skill.description;
}
// 人点名用：「＋」→「技能」挑一份，那份说明作一件附件置于案上、随这一问附上，模型不必再去翻。
// 开头写明是点名用它：问话里只放了它、没写话时，免得被当成递来一份文档要看（这句是给模型的，不随界面译）
/** @param {Skill} skill */
async function placeSkill(skill) {
  const key = draftKey();
  try {
    const text = await skillDocumentText({ skillDir: skill.dir, path: SKILL_FILE, main: true }),
      file = new File([`点名用技能「${skill.name}」，照它做。\n${text}`], `${skill.name}.md`, { type: "text/markdown" });
    // 先量放不放得下再收进浏览器：放不下的不留一份没人引的原件。记下是哪份技能：案上、问句下那一件画锦囊、写技能名，不当一件寻常的 .md
    if (!canPlaceAttachment(file.size) || !placeAttachment(key, { ...(await ingestFile(file)), skill: skill.name })) return;
    persistDraft();
    renderAttachments();
    if (draftKey() !== key) return toast(t`${skill.name} 已置于原对话的案上`);
    setTimeout(() => (currentConversation() ? $("#chatInput") : $("#welcomeInput")).focus(), 0);
  } catch (error) {
    toast(t`Skill「${skill.name}」的说明没取到：${tr(String(error.message || error)).slice(0, 80)}`);
  }
}
// 「＋」里的技能选件：与卷宗选件同一副样子——顶上查找，一份一行，名与何时用的头一句；查找也认何时用。不列 user-invocable: false 的
/** @param {HTMLElement} pop @param {Element} anchor */
function renderSkillPicker(pop, anchor) {
  const skills = skillList().filter(skill => !skill.hidden);
  pop.classList.add("attach-picker");
  pop.innerHTML = `<input class="field" placeholder="${t(`按名字查找`)}" aria-label="${t(`查找 Skill`)}"><div class="chip-pop-list"></div>`;
  const input = /** @type {HTMLInputElement} */ (pop.querySelector("input")),
    list = /** @type {HTMLElement} */ (pop.querySelector(".chip-pop-list"));
  const paint = () => {
    const query = input.value.trim().toLowerCase(),
      shown = skills.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(query));
    list.innerHTML = shown.length
      ? shown
          .map(
            skill =>
              `<button type="button" class="skill-pick" data-pick="${escapeHtml(skill.dir)}" title="${escapeHtml(skill.description)}">${skillMark("skill-mark", skill.manual)}<span>${escapeHtml(skill.name)}</span><small>${escapeHtml(skillGist(skill))}</small></button>`
          )
          .join("")
      : `<div class="chip-pop-label">${t(`没有匹配的 Skill`)}</div>`;
    list.scrollTop = 0;
    settlePickerPop(pop, anchor);
  };
  paint();
  input.addEventListener("input", paint);
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    /** @type {HTMLElement|null} */ (list.querySelector("[data-pick]"))?.click();
  });
  list.addEventListener("click", event => {
    const button = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target).closest("[data-pick]"));
    const skill = button && skills.find(item => item.dir === button.dataset.pick);
    if (!skill) return;
    closeChipPop();
    void placeSkill(skill);
  });
  setTimeout(() => input.focus(), 0);
}
// 翻一件：SKILL.md 开头注明技能目录——里头说的相对路径、要跑的脚本都照它
/** @param {{ skillDir: string, path: string, main?: boolean }} doc */
async function skillDocumentText(doc) {
  const data = await bridge("/api/skills/read", { dir: doc.skillDir, path: doc.path }, AbortSignal.timeout(15000));
  return doc.main ? t`技能目录：${doc.skillDir}\n\n${data.text}` : data.text;
}

// 设置 → 技能：一栏簿录（设计稿/78 乙，只一处、不分段）——段头写技能目录，右端「＋」新建、「打开」；
// 一份一行：锦囊（点它切只凭点名）、名、说明的头一句（全文悬停可见）、行尾一枚小纸跟附带几件（不分脚本、参考——按扩展名分是猜）。看与改分开，同记忆页：点一行就地摊开看全文（再点收起），
// 底下「改」才换成输入框改名字、何时用、正文，焦点离开即存成那份 SKILL.md、回到看；新建的直接是改。行末悬停一枚「删」
/** @type {{ dir: string, name: string, description: string, body: string, from: string }|null} 正摊开改着的一份（新建的 dir 为空） */
let skillEditing = null;
/** @type {{ dir: string, body: string }|null} 摊开着看的一份，正文是 SKILL.md 去了头的那段 */
let skillViewing = null;
function skillsSettingsHtml() {
  const { home = "", skills = [] } = skillSet || {};
  const rows = skills
    .map(skill =>
      skillEditing?.dir === skill.dir
        ? skillEditorHtml(skillEditing)
        : skillViewing?.dir === skill.dir
          ? skillViewHtml(skill, skillViewing.body)
          : skillRowHtml(skill)
    )
    .join("");
  const adding = skillEditing && !skillEditing.dir;
  return (
    `<div class="settings-head">${brushIcon("skills", "settings-mark")}<h2>${t(`Skill`)}</h2><span class="settings-meta">${t`${skills.length} 份`}</span></div>` +
    `<div class="skill-head"><span class="skill-dir" title="${escapeHtml(home)}">${escapeHtml(home)}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" id="addSkill" title="${t(`新建一份`)}">${brushIcon("add")}</button></span><button type="button" class="skill-open" data-skill-open>${t(`打开`)}</button></div>` +
    `<div class="skill-list">${adding ? skillEditorHtml(skillEditing) : ""}${
      rows || (adding ? "" : `<p class="skill-empty">${t(`尚无一份`)}</p>`)
    }</div>`
  );
}
/** @param {Skill} skill */
function skillRowHtml(skill) {
  const gist = skillGist(skill),
    bundled = skill.files.filter(file => file.path.toLowerCase() !== SKILL_FILE.toLowerCase()).length,
    dir = escapeHtml(skill.dir);
  const row = `<button type="button" class="skill-row" data-skill-edit="${dir}" title="${escapeHtml(skill.description)}"><span class="skill-name">${escapeHtml(skill.name)}</span><span class="skill-gist">${escapeHtml(gist)}</span>${
    bundled ? `<span class="skill-count" title="${t`附带 ${bundled} 件`}">${fileFigure("")}${bundled}</span>` : ""
  }</button>`;
  return `<div class="skill-item">${skillToggleHtml(skill)}${row}<span class="memory-ops"><button type="button" class="memory-del" data-skill-remove="${dir}" title="${t(`删去`)}">${brushIcon("strike")}</button></span></div>`;
}
// 摊开着看的一份：与改时同样三段（名字、何时用、正文），只是字不是框，点不出光标；点字收起，正文后是「附带」一节，底下「改」「删去」。
// 锦囊仍在行首那一列、仍可点着切换，摊开的竖痕从它底下垂下来（设计稿/104），名字、正文与上下几行的名字对齐
/** @param {Skill} skill @param {string} body */
function skillViewHtml(skill, body) {
  const dir = escapeHtml(skill.dir);
  return (
    `<div class="memory-item open skill-editor" data-skill-view="${dir}">${skillToggleHtml(skill)}<div class="skill-view" data-skill-collapse title="${t(`收起`)}">` +
    `<div class="skill-view-name">${escapeHtml(skill.name)}</div>` +
    `<div class="memory-body skill-edit-desc">${escapeHtml(skill.description)}</div>` +
    `<div class="memory-body">${escapeHtml(String(body).trim())}</div></div>` +
    skillFilesHtml(skill) +
    `<div class="memory-meta"><span class="skill-dir" title="${dir}">${dir}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" data-skill-modify title="${t(`修改`)}">${brushIcon("edit")}</button><button type="button" class="memory-del" data-skill-remove="${dir}" title="${t(`删去`)}">${brushIcon("strike")}</button></span></div></div>`
  );
}
// 摊开改着的一份：名字一行，何时用（进系统提示的就是这一句）一段，正文一段；底下注目录，右边「完成」「删去」
/** @param {NonNullable<typeof skillEditing>} draft */
function skillEditorHtml(draft) {
  return (
    `<div class="memory-item open skill-editor" data-skill-editor>${skillMark()}` +
    `<input class="memory-cat-name skill-edit-name" data-skill-field="name" value="${escapeHtml(draft.name)}" maxlength="64" spellcheck="false" placeholder="${t(`名字`)}" aria-label="${t(`名字`)}">` +
    `<textarea class="memory-text skill-edit-desc" data-skill-field="description" rows="1" spellcheck="false" placeholder="${t(`何时用：做什么、遇到什么样的事该翻它（模型只先看到这一句）`)}" aria-label="${t(`何时用`)}">${escapeHtml(draft.description)}</textarea>` +
    `<textarea class="memory-text skill-edit-body" data-skill-field="body" rows="3" spellcheck="false" placeholder="${t(`正文：怎么做`)}" aria-label="${t(`正文`)}">${escapeHtml(draft.body)}</textarea>` +
    `<div class="memory-meta"><span class="skill-dir" title="${escapeHtml(draft.dir)}">${escapeHtml(draft.dir || t("新的一份"))}</span><span class="memory-spacer"></span><span class="memory-ops"><button type="button" data-skill-done title="${t(`完成`)}">${brushIcon("edit")}</button>${
      draft.dir ? `<button type="button" class="memory-del" data-skill-delete title="${t(`删去`)}">${brushIcon("strike")}</button>` : ""
    }</span></div></div>`
  );
}
// 附带一节（设计稿/103 二）：SKILL.md 之外的件按夹归拢——夹照游目书签的「夹与条」（细折角、小函、件数，夹里的以淡墨竖痕收拢），
// 件是卷宗的件图、名字、大小。附件共不过 SKILL_OPEN_ALL 件时夹全开着，多了先收起（docx 一类一份上百件）；一夹至多列 SKILL_LEVEL_ROWS 件，
// 余下的点了在资源管理器里打开那一夹。点一件进预览器看（与卷宗同一个，图、PDF、网页都看得），不在这页里摊开——设置窄，摊开太挤
const SKILL_OPEN_ALL = 12,
  SKILL_LEVEL_ROWS = 12;
/** @type {Map<string, boolean>} 人点过的夹（技能目录 + 夹路径）：开着为 true；没点过的照件数定 */
const skillFolds = new Map();
/** @typedef {{ files: Skill["files"], dirs: Map<string, SkillFolder>, count: number }} SkillFolder */
/** @param {Skill} skill */
function skillFilesHtml(skill) {
  const files = skill.files.filter(file => file.path.toLowerCase() !== SKILL_FILE.toLowerCase());
  if (!files.length) return "";
  /** @type {SkillFolder} */
  const root = { files: [], dirs: new Map(), count: 0 };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    node.count++;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { files: [], dirs: new Map(), count: 0 });
      node = /** @type {SkillFolder} */ (node.dirs.get(part));
      node.count++;
    }
    node.files.push(file);
  }
  const dir = escapeHtml(skill.dir),
    openAll = files.length <= SKILL_OPEN_ALL;
  /** @param {SkillFolder} node @param {string} base */
  const level = (node, base) => {
    const shown = node.files.slice(0, SKILL_LEVEL_ROWS),
      rest = node.files.length - shown.length;
    return (
      shown
        .map(file => {
          const name = file.path.split("/").pop() || file.path;
          return `<button type="button" class="skill-file" data-skill-file="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">${fileFigure(name)}<span>${escapeHtml(name)}</span><small>${formatFileSize(file.size)}</small></button>`;
        })
        .join("") +
      [...node.dirs]
        .map(([name, sub]) => {
          const path = base ? `${base}/${name}` : name,
            open = skillFolds.get(`${skill.dir}\n${path}`) ?? openAll;
          return `<button type="button" class="skill-fold${open ? "" : " shut"}" data-skill-fold="${escapeHtml(path)}" aria-expanded="${open}"><i class="skill-chev" aria-hidden="true"></i>${caseFigure()}<span>${escapeHtml(name)}</span><small>${t`${sub.count} 件`}</small></button>${
            open ? `<div class="skill-fold-group">${level(sub, path)}</div>` : ""
          }`;
        })
        .join("") +
      (rest > 0
        ? `<button type="button" class="skill-more" data-skill-reveal="${escapeHtml(base)}">${t`余下 ${rest} 件 · 打开`}</button>`
        : "")
    );
  };
  return `<div class="skill-files" data-skill-files="${dir}"><div class="skill-files-head">${t`附带 ${files.length} 件`}</div>${level(root, "")}</div>`;
}
// 存下摊开的那一份，回到看着它：没改就只回到看；新建的什么都没写就作罢
let skillSaving = false;
async function settleSkillEditor() {
  const draft = skillEditing;
  if (!draft || skillSaving) return;
  const name = draft.name.trim(),
    description = draft.description.trim(),
    body = draft.body.trim(),
    sent = JSON.stringify([name, description, body]);
  if (!draft.dir && !name && !body && !draft.description.trim()) {
    skillEditing = null;
    return renderSettings();
  }
  if (draft.dir && draft.from === sent) {
    skillEditing = null;
    skillViewing = { dir: draft.dir, body };
    return renderSettings();
  }
  if (!name) {
    toast(t("Skill 要有名字"));
    return /** @type {HTMLElement|null} */ ($("[data-skill-field=name]"))?.focus();
  }
  skillSaving = true;
  try {
    const saved = await bridge("/api/skills/save", { dir: draft.dir, name, description, body }, AbortSignal.timeout(15000));
    // 新建与改名后的目录由桥接定：等待期间继续改的仍属这一份，下一次写须用新目录。
    draft.dir = saved.dir || draft.dir;
    draft.from = sent;
    await refreshSkills();
  } catch (error) {
    toast(tr(String(error.message || error)));
    return;
  } finally {
    skillSaving = false;
  }
  if (skillEditing === draft) {
    // 保存与重翻目录期间编辑框还在：有新字就接着存，不能拿先前那份的回音收掉它。
    if (sent !== JSON.stringify([draft.name.trim(), draft.description.trim(), draft.body.trim()])) return settleSkillEditor();
    skillEditing = null;
    skillViewing = { dir: draft.dir, body };
  }
  renderSettings();
}
function bindSkillSettings() {
  $("[data-skill-open]")?.addEventListener("click", () => bridge("/api/skills/open", {}).catch(error => toast(tr(error.message))));
  const focusEditor = () => {
    const field = /** @type {HTMLInputElement|null} */ ($(skillEditing?.dir ? "[data-skill-field=body]" : "[data-skill-field=name]"));
    field?.focus();
    if (field) field.setSelectionRange(field.value.length, field.value.length);
  };
  $("#addSkill")?.addEventListener("click", async () => {
    await settleSkillEditor();
    if (skillEditing) return;
    skillViewing = null;
    skillEditing = { dir: "", name: "", description: "", body: "", from: "" };
    renderSettings();
    focusEditor();
  });
  // 看一份：正文现取（SKILL.md 去了头的那段），取到才摊开
  for (const button of document.querySelectorAll("[data-skill-edit]"))
    button.addEventListener("click", async () => {
      await settleSkillEditor();
      if (skillEditing) return;
      const skill = skillList().find(item => item.dir === /** @type {HTMLElement} */ (button).dataset.skillEdit);
      if (!skill) return;
      try {
        const { text } = await bridge("/api/skills/read", { dir: skill.dir, path: SKILL_FILE }, AbortSignal.timeout(15000));
        skillViewing = { dir: skill.dir, body: String(text) };
      } catch (error) {
        return toast(tr(String(error.message || error)));
      }
      renderSettings();
    });
  // 看着的那份：点字收起（划选字时不收），「改」换成输入框
  $("[data-skill-collapse]")?.addEventListener("click", () => {
    if (String(window.getSelection()).trim()) return;
    skillViewing = null;
    renderSettings();
  });
  // 点锦囊：切只凭点名（改 SKILL.md 头上那一行），重取一回画上
  for (const button of document.querySelectorAll("[data-skill-manual]"))
    button.addEventListener("click", async event => {
      event.stopPropagation();
      const skill = skillList().find(item => item.dir === /** @type {HTMLElement} */ (button).dataset.skillManual);
      if (!skill) return;
      try {
        await bridge("/api/skills/manual", { dir: skill.dir, manual: !skill.manual }, AbortSignal.timeout(8000));
      } catch (error) {
        return toast(tr(String(error.message || error)));
      }
      await refreshSkills();
      renderSettings();
    });
  // 附带：点夹开合，点一件进预览器，「余下 n 件」在资源管理器里打开那一夹
  const files = /** @type {HTMLElement|null} */ ($("[data-skill-files]"));
  files?.addEventListener("click", event => {
    const target = /** @type {HTMLElement} */ (event.target),
      dir = files.dataset.skillFiles || "",
      fold = /** @type {HTMLElement|null} */ (target.closest("[data-skill-fold]")),
      file = /** @type {HTMLElement|null} */ (target.closest("[data-skill-file]")),
      more = /** @type {HTMLElement|null} */ (target.closest("[data-skill-reveal]"));
    if (fold) {
      skillFolds.set(`${dir}\n${fold.dataset.skillFold}`, fold.getAttribute("aria-expanded") !== "true");
      renderSettings();
    } else if (file) {
      const path = file.dataset.skillFile || "";
      void openFileViewer({ skillDir: dir, skillPath: path }, path.split("/").pop(), file);
    } else if (more)
      bridge("/api/skills/open-item", { dir, path: more.dataset.skillReveal || "" }, AbortSignal.timeout(8000)).catch(error =>
        toast(tr(String(error.message || error)))
      );
  });
  $("[data-skill-modify]")?.addEventListener("click", () => {
    const skill = skillList().find(item => item.dir === skillViewing?.dir);
    if (!skill || !skillViewing) return;
    const body = skillViewing.body;
    skillEditing = {
      dir: skill.dir,
      name: skill.name,
      description: skill.description,
      body,
      from: JSON.stringify([skill.name, skill.description, body.trim()])
    };
    skillViewing = null;
    renderSettings();
    focusEditor();
  });
  const editor = $("[data-skill-editor]");
  if (editor) {
    for (const field of editor.querySelectorAll("[data-skill-field]")) {
      if (field instanceof HTMLTextAreaElement) fitTextarea(field);
      field.addEventListener("input", () => {
        if (!skillEditing) return;
        skillEditing[/** @type {HTMLElement} */ (field).dataset.skillField] = /** @type {HTMLInputElement} */ (field).value;
      });
      field.addEventListener("keydown", e => {
        if (/** @type {KeyboardEvent} */ (e).key !== "Escape") return;
        e.stopPropagation();
        /** @type {HTMLElement} */ (field).blur();
      });
    }
    // 焦点离开这一份即存（挪到它自己的几枚小画上不算）
    editor.addEventListener("focusout", e => {
      if (!editor.contains(/** @type {Node|null} */ (/** @type {FocusEvent} */ (e).relatedTarget))) void settleSkillEditor();
    });
    $("[data-skill-done]")?.addEventListener("click", () => void settleSkillEditor());
    $("[data-skill-delete]")?.addEventListener("click", () => {
      if (skillEditing?.dir) void removeSkill(skillEditing.dir, skillEditing.name);
    });
  }
  // 删一份：先问，连同目录里的脚本与参考一并删
  const removeSkill = async (dir, name) => {
    const ok = await askConfirm({ title: t`删去 Skill「${name}」？`, body: t`连同目录里的脚本与参考一并删去：${dir}`, ok: t("删去") });
    if (!ok) return;
    try {
      await bridge("/api/skills/remove", { dir }, AbortSignal.timeout(15000));
    } catch (error) {
      return toast(tr(String(error.message || error)));
    }
    if (skillEditing?.dir === dir) skillEditing = null;
    if (skillViewing?.dir === dir) skillViewing = null;
    await refreshSkills();
    renderSettings();
  };
  for (const button of document.querySelectorAll("[data-skill-remove]"))
    button.addEventListener("click", () => {
      const skill = skillList().find(item => item.dir === /** @type {HTMLElement} */ (button).dataset.skillRemove);
      if (skill) void removeSkill(skill.dir, skill.name);
    });
  // 认到的随开随取：刚放进目录的，翻到这一页就看得见；与先前一样就不重画（摊开改着的时候不重画，免得吞了正写的字）
  const before = JSON.stringify(skillSet);
  void refreshSkills().then(() => {
    if (
      !skillEditing &&
      JSON.stringify(skillSet) !== before &&
      settingsTab === "skills" &&
      !$("#settingsModal").classList.contains("hidden")
    )
      renderSettings();
  });
}
